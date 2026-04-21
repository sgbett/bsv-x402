import { parseBrc105Challenge } from "./brc105-challenge"
import { constructBrc105Proof } from "./brc105-proof"
import { parseBrc121Challenge } from "./brc121-challenge"
import { constructBrc121Proof } from "./brc121-proof"
import { parseChallenge } from "./challenge"
import { parsePayGatewayChallenge } from "./paygateway-challenge"
import { constructPayGatewayProof } from "./paygateway-proof"
import type {
  Brc105Challenge,
  Brc121Challenge,
  Challenge,
  PayGatewayChallenge,
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
  const brc121ProofConstructor = config.brc121ProofConstructor
  const brc121Wallet = config.brc121Wallet
  const payGatewayProofConstructor = config.payGatewayProofConstructor
  const payGatewayWallet = config.payGatewayWallet
  const maxRetries = config.maxRetries ?? 2
  const ackWallet = config.ackWallet
  const serverIdentityKey = config.serverIdentityKey
  const ackedTxids = new Set<string>()
  const internalisedTxids = new Set<string>()

  function injectAckHeader(headers: Headers): void {
    if (ackedTxids.size > 0) {
      headers.set('x-bsv-ack', [...ackedTxids].join(','))
      ackedTxids.clear()
    }
  }

  async function processPendingBeefs(response: Response): Promise<void> {
    if (!ackWallet) return

    let body: any
    try {
      const clone = response.clone()
      body = await clone.json()
    } catch {
      return // Not JSON — nothing to process
    }

    if (!Array.isArray(body?.pendingBeefs)) return

    for (const entry of body.pendingBeefs) {
      if (!entry?.txid || !entry?.beef) continue
      if (!entry.derivationPrefix || !entry.derivationSuffix) continue

      if (internalisedTxids.has(entry.txid)) {
        ackedTxids.add(entry.txid)
        continue
      }

      const senderKey = entry.senderIdentityKey ?? serverIdentityKey
      if (!senderKey) {
        console.warn(`[x402] Cannot internalise BEEF ${entry.txid}: no senderIdentityKey`)
        continue
      }

      try {
        const txBytes = Array.from(atob(entry.beef), c => c.charCodeAt(0))
        await ackWallet.internalizeAction({
          tx: txBytes,
          outputs: [{
            outputIndex: entry.outputIndex ?? 0,
            protocol: 'wallet payment',
            paymentRemittance: {
              derivationPrefix: entry.derivationPrefix,
              derivationSuffix: entry.derivationSuffix,
              senderIdentityKey: senderKey,
            },
          }],
          description: 'x402 refund receipt',
        })
        internalisedTxids.add(entry.txid)
        ackedTxids.add(entry.txid)
      } catch (err) {
        console.warn(`[x402] Failed to internalise BEEF ${entry.txid}:`, err)
        // Do NOT ack — server will re-deliver
      }
    }
  }

  return async function x402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const initialHeaders = new Headers(init?.headers)
    injectAckHeader(initialHeaders)
    const response = await fetch(input, { ...init, headers: initialHeaders })

    if (response.status !== 402) {
      await processPendingBeefs(response)
      return response
    }

    const origin = extractOrigin(input)

    // Protocol detection: X402-Challenge takes priority over BRC-105
    const challengeHeader = response.headers.get("X402-Challenge")
    if (challengeHeader) {
      let challenge: Challenge
      try {
        challenge = parseChallenge(challengeHeader)
      } catch (err) {
        console.warn('[x402] Malformed X402-Challenge header, treating as non-payable:', err)
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
      injectAckHeader(headers)
      const retryResp = await fetch(input, { ...init, headers })
      await processPendingBeefs(retryResp)
      return retryResp
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
        console.warn('[x402] Malformed BRC-105 challenge headers, treating as non-payable:', err)
        return response
      }

      // Helper: build proof using whichever constructor is configured
      const buildProof = async () => {
        if (brc105ProofConstructor) {
          return brc105ProofConstructor(brc105Challenge)
        }
        return constructBrc105Proof(brc105Challenge, brc105Wallet!, origin)
      }

      // Helper: build headers from a proof
      const proofHeaders = (proof: import("./types").Brc105Proof) => {
        const h = new Headers(init?.headers)
        h.set("x-bsv-payment", JSON.stringify(proof))
        h.set("x-bsv-auth-identity-key", proof.clientIdentityKey)
        injectAckHeader(h)
        return h
      }

      let proof: import("./types").Brc105Proof
      let abort: (() => Promise<void>) | undefined
      let broadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        proof = result.proof
        abort = result.abort
        broadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Proof construction failed (brc105):", err)
        config.onProofError?.(err, "brc105")
        return response
      }

      // --- Network retry loop: resend the same signed tx ---
      let retryResponse: Response | undefined
      let networkError = false
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          await delay(1000 * 2 ** (attempt - 1))
        }
        try {
          retryResponse = await fetch(input, { ...init, headers: proofHeaders(proof) })
          networkError = false
          break
        } catch (err) {
          console.warn(`[x402] Network error on retry attempt ${attempt + 1}/${maxRetries + 1}:`, err)
          networkError = true
        }
      }

      // Network error: all retries exhausted — do NOT abort (tx may be on-chain)
      if (networkError) {
        throw new Error(
          "[x402] Payment state unknown: network error after " +
          `${maxRetries + 1} attempts. The transaction may have been broadcast — ` +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      // Success
      if (retryResponse!.ok) {
        if (broadcast) {
          broadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
        await processPendingBeefs(retryResponse!)
        return retryResponse!
      }

      // --- Server rejection: abort, then single fresh retry ---
      if (abort) {
        try {
          await abort()
          console.warn('[x402] Server rejected BRC-105 payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] abortAction failed during server rejection:', err)
        }
      }

      let freshProof: import("./types").Brc105Proof
      let freshAbort: (() => Promise<void>) | undefined
      let freshBroadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        freshProof = result.proof
        freshAbort = result.abort
        freshBroadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Fresh proof construction failed (brc105):", err)
        config.onProofError?.(err, "brc105")
        return retryResponse!
      }

      let freshResponse: Response
      try {
        freshResponse = await fetch(input, { ...init, headers: proofHeaders(freshProof) })
      } catch {
        // Network error on fresh attempt — do NOT abort (tx may be on-chain)
        throw new Error(
          "[x402] Payment state unknown: network error on fresh retry. " +
          "The transaction may have been broadcast — " +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      if (freshResponse.ok) {
        if (freshBroadcast) {
          freshBroadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
      } else if (freshAbort) {
        try {
          await freshAbort()
          console.warn('[x402] Server rejected fresh BRC-105 payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] freshAbort failed during double rejection:', err)
        }
      }

      await processPendingBeefs(freshResponse)
      return freshResponse
    }

    // BRC-121 protocol: x-bsv-sats + x-bsv-server (no x-bsv-payment-version)
    let brc121Challenge: Brc121Challenge | null
    try {
      brc121Challenge = parseBrc121Challenge(response)
    } catch (err) {
      console.warn('[x402] Malformed BRC-121 challenge headers, treating as non-payable:', err)
      return response
    }

    if (brc121Challenge) {
      // No BRC-121 wallet or proof constructor configured — pass through silently
      if (!brc121ProofConstructor && !brc121Wallet) {
        await processPendingBeefs(response)
        return response
      }

      // Helper: build proof using whichever constructor is configured
      const buildProof = async () => {
        if (brc121ProofConstructor) {
          return brc121ProofConstructor(brc121Challenge!)
        }
        return constructBrc121Proof(brc121Challenge!, brc121Wallet!, origin)
      }

      // Helper: build headers from a proof
      const proofHeaders = (proof: import("./types").Brc121Proof) => {
        const h = new Headers(init?.headers)
        h.set("x-bsv-beef", proof.beef)
        h.set("x-bsv-sender", proof.senderIdentityKey)
        h.set("x-bsv-nonce", proof.nonce)
        h.set("x-bsv-time", proof.time)
        h.set("x-bsv-vout", proof.vout)
        injectAckHeader(h)
        return h
      }

      let proof: import("./types").Brc121Proof
      let abort: (() => Promise<void>) | undefined
      let broadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        proof = result.proof
        abort = result.abort
        broadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Proof construction failed (brc121):", err)
        config.onProofError?.(err, "brc121")
        return response
      }

      // --- Network retry loop: resend the same signed tx ---
      let retryResponse: Response | undefined
      let networkError = false
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          await delay(1000 * 2 ** (attempt - 1))
        }
        try {
          retryResponse = await fetch(input, { ...init, headers: proofHeaders(proof) })
          networkError = false
          break
        } catch (err) {
          console.warn(`[x402] Network error on retry attempt ${attempt + 1}/${maxRetries + 1}:`, err)
          networkError = true
        }
      }

      // Network error: all retries exhausted — do NOT abort (tx may be on-chain)
      if (networkError) {
        throw new Error(
          "[x402] Payment state unknown: network error after " +
          `${maxRetries + 1} attempts. The transaction may have been broadcast — ` +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      // Success
      if (retryResponse!.ok) {
        if (broadcast) {
          broadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
        await processPendingBeefs(retryResponse!)
        return retryResponse!
      }

      // --- Server rejection: abort, then single fresh retry ---
      if (abort) {
        try {
          await abort()
          console.warn('[x402] Server rejected BRC-121 payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] abortAction failed during server rejection:', err)
        }
      }

      let freshProof: import("./types").Brc121Proof
      let freshAbort: (() => Promise<void>) | undefined
      let freshBroadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        freshProof = result.proof
        freshAbort = result.abort
        freshBroadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Fresh proof construction failed (brc121):", err)
        config.onProofError?.(err, "brc121")
        return retryResponse!
      }

      let freshResponse: Response
      try {
        freshResponse = await fetch(input, { ...init, headers: proofHeaders(freshProof) })
      } catch {
        // Network error on fresh attempt — do NOT abort (tx may be on-chain)
        throw new Error(
          "[x402] Payment state unknown: network error on fresh retry. " +
          "The transaction may have been broadcast — " +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      if (freshResponse.ok) {
        if (freshBroadcast) {
          freshBroadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
      } else if (freshAbort) {
        try {
          await freshAbort()
          console.warn('[x402] Server rejected fresh BRC-121 payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] freshAbort failed during double rejection:', err)
        }
      }

      await processPendingBeefs(freshResponse)
      return freshResponse
    }

    // PayGateway protocol: Payment-Required header (x402 v2 / Coinbase format)
    let payGatewayChallenge: PayGatewayChallenge | null
    try {
      payGatewayChallenge = parsePayGatewayChallenge(response)
    } catch (err) {
      console.warn('[x402] Malformed PayGateway challenge, treating as non-payable:', err)
      return response
    }

    if (payGatewayChallenge) {
      // No PayGateway wallet or proof constructor configured — pass through silently
      if (!payGatewayProofConstructor && !payGatewayWallet) {
        await processPendingBeefs(response)
        return response
      }

      // Helper: build proof using whichever constructor is configured
      const buildProof = async () => {
        if (payGatewayProofConstructor) {
          return payGatewayProofConstructor(payGatewayChallenge!)
        }
        return constructPayGatewayProof(payGatewayChallenge!, payGatewayWallet!, origin)
      }

      // Helper: build Payment-Signature header from a proof result
      const proofHeaders = (proof: import("./types").PayGatewayProof, challenge: PayGatewayChallenge) => {
        const h = new Headers(init?.headers)
        const signaturePayload = {
          x402Version: challenge.x402Version,
          accepted: challenge.selectedAccept,
          payload: {
            rawtx: proof.rawtx,
            txid: proof.txid,
            ...(proof.beef ? { beef: proof.beef } : {}),
          },
        }
        h.set("Payment-Signature", btoa(JSON.stringify(signaturePayload)))
        injectAckHeader(h)
        return h
      }

      let proof: import("./types").PayGatewayProof
      let abort: (() => Promise<void>) | undefined
      let broadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        proof = result.proof
        abort = result.abort
        broadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Proof construction failed (paygateway):", err)
        config.onProofError?.(err, "paygateway")
        return response
      }

      // --- Network retry loop: resend the same signed tx ---
      let retryResponse: Response | undefined
      let networkError = false
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          await delay(1000 * 2 ** (attempt - 1))
        }
        try {
          retryResponse = await fetch(input, { ...init, headers: proofHeaders(proof, payGatewayChallenge) })
          networkError = false
          break
        } catch (err) {
          console.warn(`[x402] Network error on retry attempt ${attempt + 1}/${maxRetries + 1}:`, err)
          networkError = true
        }
      }

      // Network error: all retries exhausted — do NOT abort (tx may be on-chain)
      if (networkError) {
        throw new Error(
          "[x402] Payment state unknown: network error after " +
          `${maxRetries + 1} attempts. The transaction may have been broadcast — ` +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      // Success
      if (retryResponse!.ok) {
        if (broadcast) {
          broadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
        await processPendingBeefs(retryResponse!)
        return retryResponse!
      }

      // --- Server rejection: abort, then single fresh retry ---
      if (abort) {
        try {
          await abort()
          console.warn('[x402] Server rejected PayGateway payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] abortAction failed during server rejection:', err)
        }
      }

      let freshProof: import("./types").PayGatewayProof
      let freshAbort: (() => Promise<void>) | undefined
      let freshBroadcast: (() => Promise<void>) | undefined
      try {
        const result = await buildProof()
        freshProof = result.proof
        freshAbort = result.abort
        freshBroadcast = result.broadcast
      } catch (err) {
        console.error("[x402] Fresh proof construction failed (paygateway):", err)
        config.onProofError?.(err, "paygateway")
        return retryResponse!
      }

      let freshResponse: Response
      try {
        freshResponse = await fetch(input, { ...init, headers: proofHeaders(freshProof, payGatewayChallenge) })
      } catch {
        // Network error on fresh attempt — do NOT abort (tx may be on-chain)
        throw new Error(
          "[x402] Payment state unknown: network error on fresh retry. " +
          "The transaction may have been broadcast — " +
          "do not retry with a new transaction without checking on-chain state.",
        )
      }

      if (freshResponse.ok) {
        if (freshBroadcast) {
          freshBroadcast().catch(err => console.warn('[x402] broadcast failed:', err))
        }
      } else if (freshAbort) {
        try {
          await freshAbort()
          console.warn('[x402] Server rejected fresh PayGateway payment, UTXOs released via abortAction')
        } catch (err) {
          console.warn('[x402] freshAbort failed during double rejection:', err)
        }
      }

      await processPendingBeefs(freshResponse)
      return freshResponse
    }

    // Neither protocol header present — pass through
    await processPendingBeefs(response)
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
