import { parseChallenge } from "./challenge"
import { RateLimiter, resolveSpendLimits } from "./limits"
import { resolveSitePolicy } from "./site-policy"
import { LocalStorageAdapter } from "./storage"
import type {
  Challenge,
  LimitCheckResult,
  Proof,
  StorageAdapter,
  TwoFactorProvider,
  X402Config,
} from "./types"

// === Proof construction (stub — requires BRC-100 wallet) ===

async function defaultConstructProof(_challenge: Challenge): Promise<Proof> {
  // TODO: Call window.CWI.createAction() to build payment transaction
  // TODO: Broadcast to BSV network
  throw new Error("Not implemented — requires BRC-100 wallet (window.CWI)")
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

  const fetchFn: X402FetchFn = async function x402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(input, init)

    if (response.status !== 402) return response

    const challengeHeader = response.headers.get("X402-Challenge")
    if (!challengeHeader) return response

    const challenge = parseChallenge(challengeHeader)
    const origin = extractOrigin(input)

    // Serialise the payment decision + construction
    return mutex(async () => {
      const rl = await ensureInitialised()

      // Resolve per-site policy (may prompt on first visit)
      const sitePolicy = await resolveSitePolicy(origin, limits, twoFactor)
      if (sitePolicy.action === "block") return response

      // Persist new site policy if it was just created
      if (!limits.sitePolicies[origin]) {
        limits.sitePolicies[origin] = sitePolicy
        await storage.saveSitePolicies(limits.sitePolicies)
      }

      // Rate limit check
      const result: LimitCheckResult = rl.check(challenge, origin)

      if (result.action === "block") {
        if (result.severity === "trip") {
          rl.trip()
          await persist(rl)
        }
        config.onLimitReached?.(result.reason)
        return response
      }

      if (result.action === "yellow-light") {
        const proceed = config.onYellowLight
          ? await config.onYellowLight(result.detail)
          : false
        if (!proceed) return response
      }

      // 2FA for high-value tx
      if (limits.require2fa.onHighValueTx && challenge.amount > limits.require2fa.highValueThreshold) {
        if (!twoFactor) return response // no provider → block
        const verified = await twoFactor.verify({
          type: "high-value-tx",
          amount: challenge.amount,
          origin,
        })
        if (!verified) return response
      }

      // Construct proof and retry
      const proof = await constructProof(challenge)

      // Record the payment
      rl.record({
        timestamp: nowFn(),
        origin,
        satoshis: challenge.amount,
        txid: proof.txid,
      })
      await persist(rl)

      const headers = new Headers(init?.headers)
      headers.set("X402-Proof", JSON.stringify(proof))
      return fetch(input, { ...init, headers })
    })
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

function extractOrigin(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.origin
  if (typeof input === "string") {
    try {
      return new URL(input).origin
    } catch {
      return "unknown"
    }
  }
  // Request object
  return new URL(input.url).origin
}
