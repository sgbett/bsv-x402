/// <reference types="chrome" />

// ---------------------------------------------------------------------------
// Key Manager — handles key generation, encryption, storage, and derivation
// for the BSV x402 browser extension wallet.
//
// Uses chrome.storage.local and the Web Crypto API. Does NOT depend on
// @bsv/sdk (that lives in tx-builder).
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'x402_wallet_seed'

// Flag indicating a real BIP-39 wordlist has not been integrated yet.
export const WORDLIST_REQUIRED = true

// ---- Types ----------------------------------------------------------------

export interface EncryptedSeed {
  ciphertext: string // base64
  iv: string         // base64
  salt: string       // base64
}

export interface WalletState {
  isSetUp: boolean
  isUnlocked: boolean
}

// ---- Base64 helpers -------------------------------------------------------

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// ---- PBKDF2 key derivation helper -----------------------------------------

async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---- Public API -----------------------------------------------------------

/**
 * Generate a placeholder seed (hex-encoded 16 random bytes).
 *
 * TODO: Replace with proper BIP-39 mnemonic generation using a real wordlist.
 * This should produce a 12-word mnemonic from 128 bits of entropy per BIP-39.
 */
export function generateMnemonic(): string {
  const entropy = new Uint8Array(16)
  crypto.getRandomValues(entropy)
  return Array.from(entropy)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Encrypt a seed string with a user-supplied password using PBKDF2 + AES-GCM.
 */
export async function encryptSeed(
  seed: string,
  password: string,
): Promise<EncryptedSeed> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const key = await deriveEncryptionKey(password, salt)

  const enc = new TextEncoder()
  const cipherbuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(seed),
  )

  return {
    ciphertext: bufferToBase64(cipherbuf),
    iv: bufferToBase64(iv.buffer),
    salt: bufferToBase64(salt.buffer),
  }
}

/**
 * Decrypt a previously encrypted seed. Throws if the password is wrong.
 */
export async function decryptSeed(
  encrypted: EncryptedSeed,
  password: string,
): Promise<string> {
  const salt = new Uint8Array(base64ToBuffer(encrypted.salt))
  const iv = new Uint8Array(base64ToBuffer(encrypted.iv))
  const ciphertext = base64ToBuffer(encrypted.ciphertext)

  const key = await deriveEncryptionKey(password, salt)

  const plainbuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(plainbuf)
}

/**
 * Persist an encrypted seed to chrome.storage.local.
 */
export async function saveSeed(encrypted: EncryptedSeed): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: encrypted })
}

/**
 * Load a previously stored encrypted seed, or null if none exists.
 */
export async function loadSeed(): Promise<EncryptedSeed | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result[STORAGE_KEY] as EncryptedSeed) ?? null
}

/**
 * Derive a key pair from a seed and a child index.
 *
 * TODO: Replace with BRC-42/BRC-43 compliant HD key derivation via `@bsv/sdk`.
 * Currently this uses a simple SHA-256(seed + ':' + index) approach, which is
 * NOT suitable for production use.
 *
 * TODO: Public key derivation requires secp256k1 point multiplication, which
 * is not available without `@bsv/sdk`. For now publicKey is set to the same
 * SHA-256 hash as a placeholder.
 */
export async function deriveKeyPair(
  seed: string,
  index: number,
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const enc = new TextEncoder()
  const hashBuf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${seed}:${index}`),
  )
  const hash = new Uint8Array(hashBuf)

  return {
    privateKey: hash,
    // TODO: Compute real compressed public key via secp256k1 once @bsv/sdk is available.
    publicKey: hash,
  }
}

// ---- SessionManager -------------------------------------------------------

/**
 * Manages the in-memory decrypted seed for the lifetime of the extension
 * background service worker.
 */
export class SessionManager {
  private decryptedSeed: string | null = null

  /**
   * Unlock the wallet by decrypting the stored seed with the given password.
   * Throws if no seed is stored or the password is wrong.
   */
  async unlock(password: string): Promise<void> {
    const encrypted = await loadSeed()
    if (!encrypted) {
      throw new Error('No wallet seed found. Please set up the wallet first.')
    }
    this.decryptedSeed = await decryptSeed(encrypted, password)
  }

  /** Lock the wallet, clearing the in-memory seed. */
  lock(): void {
    this.decryptedSeed = null
  }

  /** Whether the wallet is currently unlocked. */
  isUnlocked(): boolean {
    return this.decryptedSeed !== null
  }

  /** Return the decrypted seed. Throws if the wallet is locked. */
  getSeed(): string {
    if (this.decryptedSeed === null) {
      throw new Error('Wallet is locked. Call unlock() first.')
    }
    return this.decryptedSeed
  }

  /** Return the current wallet state. */
  async getState(): Promise<WalletState> {
    const encrypted = await loadSeed()
    return {
      isSetUp: encrypted !== null,
      isUnlocked: this.decryptedSeed !== null,
    }
  }
}
