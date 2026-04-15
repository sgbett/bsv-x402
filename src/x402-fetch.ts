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

// Base64/hex helpers (inlined to avoid cross-module dependency on brc105-proof)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function numberArrayToBase64(arr: number[]): string {
  return bytesToBase64(new Uint8Array(arr))
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex string must have even length")
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

/**
 * Decode a Base58 string to raw bytes (no checksum verification).
 * Returns all decoded bytes (e.g. 25 bytes for a standard address).
 */
function base58ToBytes(encoded: string): Uint8Array {
  // Count leading '1's — each maps to a leading zero byte
  let leadingZeros = 0
  for (const c of encoded) {
    if (c === "1") leadingZeros++
    else break
  }

  // Decode base58 to bigint
  let n = BigInt(0)
  for (const c of encoded) {
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

  // Prepend leading zero bytes
  const allBytes = new Uint8Array(leadingZeros + bigintBytes.length)
  allBytes.set(bigintBytes, leadingZeros)

  return allBytes
}

function base58DecodeCheck(address: string): { version: number; payload: Uint8Array } {
  const allBytes = base58ToBytes(address)

  if (allBytes.length !== 25) {
    throw new Error(`Invalid address length: expected 25 bytes, got ${allBytes.length}`)
  }

  const body = allBytes.slice(0, 21)

  // SubtleCrypto is async-only, so we verify the version byte only in this sync path
  const version = allBytes[0]
  if (version !== 0x00 && version !== 0x6f) {
    throw new Error(`Unsupported address version: 0x${version.toString(16).padStart(2, "0")}`)
  }

  return { version, payload: body.slice(1) }
}

/**
 * Verify the Base58Check checksum of a BSV address using double-SHA256.
 * Throws if the address is malformed or the checksum is invalid.
 */
export async function verifyBase58Checksum(address: string): Promise<void> {
  const allBytes = base58ToBytes(address)

  if (allBytes.length !== 25) {
    throw new Error(`Invalid address length: expected 25 bytes, got ${allBytes.length}`)
  }

  const body = allBytes.slice(0, 21)
  const checksum = allBytes.slice(21)

  const hash1 = new Uint8Array(await crypto.subtle.digest("SHA-256", body))
  const hash2 = new Uint8Array(await crypto.subtle.digest("SHA-256", hash1))

  if (
    hash2[0] !== checksum[0] ||
    hash2[1] !== checksum[1] ||
    hash2[2] !== checksum[2] ||
    hash2[3] !== checksum[3]
  ) {
    throw new Error("Base58Check: checksum mismatch")
  }
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

  // Convert transaction to base64 BEEF
  // SDK wallets return `tx: number[]`; CWI wallets return `rawTx: string` (hex)
  let beef: string
  if (result.tx && Array.isArray(result.tx) && result.tx.length > 0) {
    beef = numberArrayToBase64(result.tx)
  } else if (result.rawTx && typeof result.rawTx === "string" && result.rawTx.length > 0) {
    beef = bytesToBase64(hexToBytes(result.rawTx))
  } else {
    throw new Error("Wallet returned no transaction data (neither tx nor rawTx)")
  }

  return {
    txid: result.txid,
    beef,
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
      } catch {
        // Malformed or unsupported version — treat as non-payable
        return response
      }

      let proof: import("./types").Brc105Proof
      let abort: (() => Promise<void>) | undefined
      try {
        if (brc105ProofConstructor) {
          const result = await brc105ProofConstructor(brc105Challenge)
          proof = result.proof
          abort = result.abort
        } else {
          const result = await constructBrc105Proof(brc105Challenge, brc105Wallet!, origin)
          proof = result.proof
          abort = result.abort
        }
      } catch (err) {
        console.error("[x402] Proof construction failed (brc105):", err)
        config.onProofError?.(err, "brc105")
        return response
      }

      const headers = new Headers(init?.headers)
      headers.set("x-bsv-payment", JSON.stringify(proof))
      headers.set("x-bsv-auth-identity-key", proof.clientIdentityKey)

      let retryResponse: Response
      try {
        retryResponse = await fetch(input, { ...init, headers })
      } catch (err) {
        // Network error, timeout, etc. — abort to release locked UTXOs
        if (abort) {
          await abort()
          console.warn('[x402] BRC-105 retry fetch failed, UTXOs released via abortAction')
        }
        throw err
      }

      if (!retryResponse.ok && abort) {
        await abort()
        console.warn('[x402] Server rejected BRC-105 payment, UTXOs released via abortAction')
      }

      return retryResponse
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
