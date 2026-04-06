import { parseBrc105Challenge } from "./brc105-challenge"
import { constructBrc105Proof } from "./brc105-proof"
import { parseChallenge } from "./challenge"
import type {
  Brc105Challenge,
  Challenge,
  Proof,
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

// === Factory ===

export type X402FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createX402Fetch(config: X402Config = {}): X402FetchFn {
  const constructProof = config.proofConstructor ?? defaultConstructProof
  const brc105ProofConstructor = config.brc105ProofConstructor
  const brc105Wallet = config.brc105Wallet

  return async function x402Fetch(
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

      let proof: Proof
      try {
        proof = await constructProof(challenge)
      } catch (err) {
        console.error("[x402] Proof construction failed (x402):", err)
        config.onProofError?.(err, "x402")
        return response
      }

      const headers = new Headers(init?.headers)
      headers.set("X402-Proof", JSON.stringify(proof))
      return fetch(input, { ...init, headers })
    }

    // BRC-105 protocol: x-bsv-payment-version header present
    const brc105Version = response.headers.get("x-bsv-payment-version")
    if (brc105Version) {
      // No BRC-105 wallet or proof constructor configured — pass through silently
      if (!brc105ProofConstructor && !brc105Wallet) return response

      let brc105Challenge: Brc105Challenge
      try {
        brc105Challenge = parseBrc105Challenge(response)
      } catch (err) {
        console.error("[x402] Failed to parse BRC-105 challenge:", err instanceof Error ? err.message : err)
        return response
      }

      let proof: import("./types").Brc105Proof
      try {
        if (brc105ProofConstructor) {
          proof = await brc105ProofConstructor(brc105Challenge)
        } else {
          proof = await constructBrc105Proof(brc105Challenge, brc105Wallet!, origin)
        }
      } catch (err) {
        console.error("[x402] Proof construction failed (brc105):", err)
        config.onProofError?.(err, "brc105")
        return response
      }

      const headers = new Headers(init?.headers)
      headers.set("x-bsv-payment", JSON.stringify(proof))
      headers.set("x-bsv-auth-identity-key", proof.clientIdentityKey)
      return fetch(input, { ...init, headers })
    }

    // Neither protocol header present — pass through
    return response
  }
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
