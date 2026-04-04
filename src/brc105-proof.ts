import type { Brc105Challenge, Brc105Proof, Brc105Wallet } from "./types"

// === Byte encoding helpers ===

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  // Works in both browser and Node 18+ (via global btoa)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function numberArrayToBase64(arr: number[]): string {
  return bytesToBase64(new Uint8Array(arr))
}

/** Decode a hex string into a number[] (matching SDK convention). */
function hexToNumberArray(hex: string): number[] {
  return Array.from(hexToBytes(hex))
}

// === RIPEMD-160 (minimal pure-JS implementation) ===

/* eslint-disable no-bitwise */

const RIPEMD160_CONSTANTS = {
  // Round constants for left and right paths
  KL: [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e],
  KR: [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000],
  // Message schedule (word index per step)
  RL: [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
  ],
  RR: [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
  ],
  // Rotation amounts
  SL: [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
  ],
  SR: [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
  ],
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

function f(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) >>> 0
  if (j < 32) return ((x & y) | (~x & z)) >>> 0
  if (j < 48) return ((x | ~y) ^ z) >>> 0
  if (j < 64) return ((x & z) | (y & ~z)) >>> 0
  return (x ^ (y | ~z)) >>> 0
}

function ripemd160(message: Uint8Array): Uint8Array {
  // Pre-processing: add padding
  const msgLen = message.length
  const bitLen = msgLen * 8

  // Padding: 1 bit, then zeros, then 64-bit length (little-endian)
  const padLen = (55 - msgLen % 64 + 64) % 64 + 1
  const padded = new Uint8Array(msgLen + padLen + 8)
  padded.set(message)
  padded[msgLen] = 0x80

  // Append length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, (bitLen / 0x100000000) >>> 0, true)

  // Initial hash values
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const { KL, KR, RL, RR, SL, SR } = RIPEMD160_CONSTANTS

  // Process each 64-byte block
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, true)
    }

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4

    for (let j = 0; j < 80; j++) {
      const round = j >>> 4

      // Left path
      let t = (al + f(j, bl, cl, dl) + w[RL[j]] + KL[round]) >>> 0
      t = (rotl32(t, SL[j]) + el) >>> 0
      al = el; el = dl; dl = rotl32(cl, 10); cl = bl; bl = t

      // Right path
      t = (ar + f(79 - j, br, cr, dr) + w[RR[j]] + KR[round]) >>> 0
      t = (rotl32(t, SR[j]) + er) >>> 0
      ar = er; er = dr; dr = rotl32(cr, 10); cr = br; br = t
    }

    const t = (h1 + cl + dr) >>> 0
    h1 = (h2 + dl + er) >>> 0
    h2 = (h3 + el + ar) >>> 0
    h3 = (h4 + al + br) >>> 0
    h4 = (h0 + bl + cr) >>> 0
    h0 = t
  }

  // Produce the 20-byte digest (little-endian)
  const digest = new Uint8Array(20)
  const dv = new DataView(digest.buffer)
  dv.setUint32(0, h0, true)
  dv.setUint32(4, h1, true)
  dv.setUint32(8, h2, true)
  dv.setUint32(12, h3, true)
  dv.setUint32(16, h4, true)
  return digest
}

/* eslint-enable no-bitwise */

// === Hash160 (SHA-256 → RIPEMD-160) ===

async function hash160(data: Uint8Array): Promise<Uint8Array> {
  const sha256 = new Uint8Array(await crypto.subtle.digest("SHA-256", data as ArrayBufferView<ArrayBuffer>))
  return ripemd160(sha256)
}

// === P2PKH locking script from compressed public key hex ===

async function pubkeyToP2PKHLockingScript(pubkeyHex: string): Promise<string> {
  const pubkeyBytes = hexToBytes(pubkeyHex)
  const pubkeyHash = await hash160(pubkeyBytes)
  // OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
  return `76a914${bytesToHex(pubkeyHash)}88ac`
}

// === Nonce generation (reimplements SDK's createNonce) ===

/**
 * Generate a derivation suffix using the wallet's HMAC capability.
 * Mirrors the SDK's `createNonce`: 16 random bytes → HMAC → concat → base64.
 */
async function createDerivationSuffix(wallet: Brc105Wallet): Promise<string> {
  const randomBytes = new Uint8Array(16)
  crypto.getRandomValues(randomBytes)
  const firstHalf = Array.from(randomBytes)

  // keyID is the UTF-8 interpretation of the random bytes (matches SDK behaviour)
  const keyID = new TextDecoder().decode(randomBytes)

  const { hmac } = await wallet.createHmac({
    data: firstHalf,
    protocolID: [2, "server hmac"],
    keyID,
    counterparty: "self",
  })

  // Concatenate random bytes + HMAC bytes, then base64-encode
  const nonceBytes = [...firstHalf, ...hmac]
  return numberArrayToBase64(nonceBytes)
}

// === Main proof constructor ===

/**
 * Construct a BRC-105 payment proof from a challenge using BRC-29 key derivation.
 *
 * Algorithm (matching AuthFetch reference implementation):
 * 1. Generate derivation suffix via wallet HMAC
 * 2. Derive payee public key using protocolID [2, '3241645161d8']
 * 3. Build P2PKH locking script from derived public key
 * 4. Call wallet.createAction with the locking script and custom instructions
 * 5. Convert transaction to base64
 */
export async function constructBrc105Proof(
  challenge: Brc105Challenge,
  wallet: Brc105Wallet,
): Promise<Brc105Proof> {
  // Step 1: Generate derivation suffix
  const derivationSuffix = await createDerivationSuffix(wallet)

  // Step 2: Derive the payee's public key via BRC-29
  const keyID = `${challenge.derivationPrefix} ${derivationSuffix}`
  const { publicKey: derivedPublicKey } = await wallet.getPublicKey({
    protocolID: [2, "3241645161d8"],
    keyID,
    counterparty: challenge.serverIdentityKey,
  })

  // Step 3: Build P2PKH locking script
  const lockingScript = await pubkeyToP2PKHLockingScript(derivedPublicKey)

  // Step 4: Create the payment transaction
  const result = await wallet.createAction({
    description: "BRC-105 payment",
    outputs: [{
      satoshis: challenge.satoshisRequired,
      lockingScript,
      description: "BRC-105 payment output",
      customInstructions: JSON.stringify({
        derivationPrefix: challenge.derivationPrefix,
        derivationSuffix,
        payee: challenge.serverIdentityKey,
      }),
    }],
    options: {
      randomizeOutputs: false,
    },
  })

  // Step 5: Convert transaction to base64
  // SDK wallets return `tx: number[]`; CWI wallets return `rawTx: string` (hex)
  let transactionBase64: string
  if (result.tx && Array.isArray(result.tx) && result.tx.length > 0) {
    transactionBase64 = numberArrayToBase64(result.tx)
  } else if (result.rawTx && typeof result.rawTx === "string" && result.rawTx.length > 0) {
    transactionBase64 = bytesToBase64(hexToBytes(result.rawTx))
  } else {
    throw new Error("Wallet returned no transaction data (neither tx nor rawTx)")
  }

  return {
    derivationPrefix: challenge.derivationPrefix,
    derivationSuffix,
    transaction: transactionBase64,
  }
}

// Exported for testing
export { ripemd160, hash160, pubkeyToP2PKHLockingScript, createDerivationSuffix }
