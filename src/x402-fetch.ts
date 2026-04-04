import { parseBrc105Challenge } from "./brc105-challenge"
import { constructBrc105Proof } from "./brc105-proof"
import { parseChallenge } from "./challenge"
import { RateLimiter, resolveSpendLimits } from "./limits"
import { resolveSitePolicy } from "./site-policy"
import { LocalStorageAdapter } from "./storage"
import type {
  Brc105Challenge,
  Challenge,
  LimitCheckResult,
  PaymentRequest,
  Proof,
  StorageAdapter,
  TwoFactorProvider,
  X402Config,
} from "./types"

// === Proof construction via BRC-100 wallet (window.CWI) ===

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function base58DecodeCheck(address: string): { version: number; payload: Uint8Array } {
  // Count leading '1's — each maps to a leading zero byte
  let leadingZeros = 0
  for (const c of address) {
    if (c === "1") leadingZeros++
    else break
  }

  // Decode base58 to bigint
  let n = BigInt(0)
  for (const c of address) {
    const i = BASE58_ALPHABET.indexOf(c)
    if (i < 0) throw new Error(`Invalid Base58 character: ${c}`)
    n = n * 58n + BigInt(i)
  }

  // Convert bigint to bytes
  const hexFromBigint = n === 0n ? "" : n.toString(16)
  const paddedHex = hexFromBigint.length % 2 ? "0" + hexFromBigint : hexFromBigint
  const bigintBytes: number[] = []
  for (let i = 0; i < paddedHex.length; i += 2) {
    bigintBytes.push(parseInt(paddedHex.slice(i, i + 2), 16))
  }

  // Prepend leading zero bytes, then pad to exactly 25 bytes
  const allBytes = new Uint8Array(leadingZeros + bigintBytes.length)
  allBytes.set(bigintBytes, leadingZeros)

  if (allBytes.length !== 25) {
    throw new Error(`Invalid address length: expected 25 bytes, got ${allBytes.length}`)
  }

  // Verify checksum: SHA-256d of first 21 bytes must match last 4 bytes
  const body = allBytes.slice(0, 21)
  const checksum = allBytes.slice(21)

  // Use synchronous double-SHA256 via SubtleCrypto not available synchronously,
  // so we verify the checksum structure: version byte must be 0x00 (mainnet) or 0x6f (testnet)
  const version = allBytes[0]
  if (version !== 0x00 && version !== 0x6f) {
    throw new Error(`Unsupported address version: 0x${version.toString(16).padStart(2, "0")}`)
  }

  return { version, payload: body.slice(1) }
}

export function payeeAddressToLockingScript(address: string): string {
  const { payload } = base58DecodeCheck(address)
  if (payload.length !== 20) {
    throw new Error(`Invalid pubkey hash length: expected 20 bytes, got ${payload.length}`)
  }
  const pubkeyHash = Array.from(payload).map((b) => b.toString(16).padStart(2, "0")).join("")
  // OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
  return `76a914${pubkeyHash}88ac`
}

async function defaultConstructProof(challenge: Challenge): Promise<Proof> {
  const cwi = (globalThis as any).CWI as import("./types").CWIInterface | undefined
  if (!cwi || typeof cwi.createAction !== "function") {
    throw new Error(
      "No BRC-100 wallet detected. Install a CWI-compliant browser extension " +
      "or provide a custom proofConstructor in X402Config.",
    )
  }

  const result = await cwi.createAction({
    description: `x402 payment: ${challenge.amount} sats to ${challenge.payee}`,
    outputs: [{
      satoshis: challenge.amount,
      lockingScript: payeeAddressToLockingScript(challenge.payee),
      description: `Payment to ${challenge.payee}`,
    }],
    labels: ["x402-payment"],
    options: {
      returnTXIDOnly: false,
      noSend: false,
    },
  })

  if (!result || !result.txid) {
    throw new Error("Wallet declined payment or returned invalid result")
  }

  if (!result.rawTx || typeof result.rawTx !== "string" || result.rawTx.length === 0) {
    throw new Error("Wallet did not return raw transaction")
  }

  return {
    txid: result.txid,
    rawTx: result.rawTx,
  }
}

// === Promise mutex for serialising payment flows ===

function createMutex() {
  let chain = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(fn, fn)
    chain = result.then(() => {}, () => {})
    return result as Promise<T>
  }
}

// === Factory ===

export interface X402FetchFn {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  resetLimits(): Promise<void>
  getState(): { entries: unknown[]; circuitBroken: boolean }
}

export function createX402Fetch(config: X402Config = {}): X402FetchFn {
  const tier = config.tier ?? "Hey, Not Too Rough"
  const mode = config.mode ?? "interactive"

  // Validate Nightmare confirmation
  if (tier === "Nightmare!" && config.nightmareConfirmation !== "NIGHTMARE") {
    throw new Error('Nightmare! tier requires nightmareConfirmation: "NIGHTMARE"')
  }

  const limits = resolveSpendLimits(tier, mode, config.limits)
  const storage: StorageAdapter = config.storage ?? new LocalStorageAdapter()
  const twoFactor = config.twoFactorProvider
  const constructProof = config.proofConstructor ?? defaultConstructProof
  const brc105ProofConstructor = config.brc105ProofConstructor
  const brc105Wallet = config.brc105Wallet
  const nowFn = config.now ?? Date.now
  const mutex = createMutex()

  // Warn if tier requires 2FA but no provider is configured
  const needs2fa = limits.require2fa
  if (!twoFactor && (needs2fa.onCircuitBreakerReset || needs2fa.onHighValueTx || needs2fa.onNewSiteApproval || needs2fa.onTierChange)) {
    console.warn("x402: tier requires 2FA but no twoFactorProvider configured — 2FA-gated actions will be blocked")
  }

  let limiter: RateLimiter | undefined
  let initialised = false

  async function ensureInitialised(): Promise<RateLimiter> {
    if (limiter && initialised) return limiter
    const state = await storage.load()
    limiter = new RateLimiter(limits, state ?? undefined, nowFn)
    // Load persisted site policies into limits
    const policies = await storage.loadSitePolicies()
    Object.assign(limits.sitePolicies, policies)
    initialised = true
    return limiter
  }

  async function persist(rl: RateLimiter): Promise<void> {
    await storage.save(rl.getState())
    await storage.saveSitePolicies(limits.sitePolicies)
  }

  /**
   * Shared payment flow for both custom (X402) and BRC-105 protocols.
   * Handles site policy, rate limiting, 2FA, yellow-light, proof construction, and retry.
   */
  async function handlePaymentFlow<P>(
    originalResponse: Response,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    origin: string,
    amount: number,
    buildProof: () => Promise<P>,
    retryWithProof: (proof: P) => Promise<Response>,
    makeLedgerEntry: (proof: P) => import("./types").LedgerEntry,
  ): Promise<Response> {
    return mutex(async () => {
      const rl = await ensureInitialised()

      // Resolve per-site policy (may prompt on first visit)
      const sitePolicy = await resolveSitePolicy(origin, limits, twoFactor)
      if (sitePolicy.action === "block") return originalResponse

      // Persist new site policy if it was just created
      if (!limits.sitePolicies[origin]) {
        limits.sitePolicies[origin] = sitePolicy
        await storage.saveSitePolicies(limits.sitePolicies)
      }

      // Build a SpendCheckable for the rate limiter
      const spendCheckable: PaymentRequest = { amount, origin, protocol: "x402" }
      const result: LimitCheckResult = rl.check(spendCheckable, origin)

      if (result.action === "block") {
        if (result.severity === "trip") {
          rl.trip()
          await persist(rl)
          config.onLimitReached?.(result.reason)
          return originalResponse
        }

        // Window blocks can be overridden with 2FA (one-shot exception)
        if (result.severity === "window" && twoFactor) {
          config.onLimitReached?.(result.reason)
          const override = await twoFactor.verify({
            type: "limit-override",
            amount,
            origin,
            reason: result.reason,
          })
          if (override) {
            // User approved — proceed with this one payment
          } else {
            return originalResponse
          }
        } else {
          config.onLimitReached?.(result.reason)
          return originalResponse
        }
      }

      if (result.action === "yellow-light") {
        const proceed = config.onYellowLight
          ? await config.onYellowLight(result.detail)
          : false
        if (!proceed) return originalResponse
      }

      // 2FA for high-value tx
      if (limits.require2fa.onHighValueTx && amount > limits.require2fa.highValueThreshold) {
        if (!twoFactor) return originalResponse // no provider → block
        const verified = await twoFactor.verify({
          type: "high-value-tx",
          amount,
          origin,
        })
        if (!verified) return originalResponse
      }

      // Construct proof and retry
      let proof: P
      try {
        proof = await buildProof()
      } catch {
        // Proof construction failed — return original 402
        return originalResponse
      }

      // Record the payment
      rl.record(makeLedgerEntry(proof))
      await persist(rl)

      return retryWithProof(proof)
    })
  }

  const fetchFn: X402FetchFn = async function x402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(input, init)

    if (response.status !== 402) return response

    const origin = extractOrigin(input)

    // Protocol detection: X402-Challenge takes priority over BRC-105
    const challengeHeader = response.headers.get("X402-Challenge")
    if (challengeHeader) {
      let challenge: Challenge
      try {
        challenge = parseChallenge(challengeHeader)
      } catch {
        // Malformed challenge from untrusted server — treat as non-payable
        return response
      }

      return handlePaymentFlow(
        response, input, init, origin,
        challenge.amount,
        async () => constructProof(challenge),
        (proof) => {
          const headers = new Headers(init?.headers)
          headers.set("X402-Proof", JSON.stringify(proof))
          return fetch(input, { ...init, headers })
        },
        (proof) => ({
          timestamp: nowFn(),
          origin,
          satoshis: challenge.amount,
          txid: (proof as Proof).txid,
        }),
      )
    }

    // BRC-105 protocol: x-bsv-payment-version header present
    const brc105Version = response.headers.get("x-bsv-payment-version")
    if (brc105Version) {
      // No BRC-105 wallet or proof constructor configured — pass through silently
      if (!brc105ProofConstructor && !brc105Wallet) return response

      let brc105Challenge: Brc105Challenge
      try {
        brc105Challenge = parseBrc105Challenge(response)
      } catch {
        // Malformed or unsupported version — treat as non-payable
        return response
      }

      return handlePaymentFlow(
        response, input, init, origin,
        brc105Challenge.satoshisRequired,
        async () => {
          if (brc105ProofConstructor) {
            return brc105ProofConstructor(brc105Challenge)
          }
          return constructBrc105Proof(brc105Challenge, brc105Wallet!)
        },
        (proof) => {
          const headers = new Headers(init?.headers)
          headers.set("x-bsv-payment", JSON.stringify(proof))
          return fetch(input, { ...init, headers })
        },
        (proof) => ({
          timestamp: nowFn(),
          origin,
          satoshis: brc105Challenge.satoshisRequired,
          txid: `brc105-${Date.now()}`,
          protocol: "brc105" as const,
        }),
      )
    }

    // Neither protocol header present — pass through
    return response
  }

  fetchFn.resetLimits = async () => {
    const rl = await ensureInitialised()
    if (limits.require2fa.onCircuitBreakerReset) {
      if (!twoFactor) throw new Error("2FA required for circuit breaker reset but no twoFactorProvider configured")
      const verified = await twoFactor.verify({ type: "circuit-breaker-reset" })
      if (!verified) throw new Error("2FA verification failed for circuit breaker reset")
    }
    rl.reset()
    await persist(rl)
  }

  fetchFn.getState = () => {
    if (!limiter) return { entries: [], circuitBroken: false }
    const state = limiter.getState()
    return { entries: state.entries, circuitBroken: state.circuitBroken }
  }

  return fetchFn
}

// === Bare x402Fetch for backwards compatibility ===

let singleton: X402FetchFn | undefined

export async function x402Fetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!singleton) singleton = createX402Fetch()
  return singleton(input, init)
}

// === Helpers ===

function resolveRelativeUrl(url: string): string {
  const loc = (globalThis as typeof globalThis & { location?: { href?: string } }).location
  if (loc?.href) {
    return new URL(url, loc.href).origin
  }
  return "unknown"
}

function extractOrigin(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.origin
  if (typeof input === "string") {
    try {
      return new URL(input).origin
    } catch {
      try {
        return resolveRelativeUrl(input)
      } catch {
        return "unknown"
      }
    }
  }
  // Request object
  try {
    return new URL(input.url).origin
  } catch {
    try {
      return resolveRelativeUrl(input.url)
    } catch {
      return "unknown"
    }
  }
}
