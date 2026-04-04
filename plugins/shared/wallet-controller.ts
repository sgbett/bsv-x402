/// <reference types="chrome" />

import type { WalletBackend } from './wallet-backend'
import { BuiltInWalletBackend } from './builtin-wallet-backend'
import { ExternalWalletBackend, type ExternalWalletConfig } from './external-wallet-backend'

// ---------------------------------------------------------------------------
// Wallet controller
//
// Owns the wallet backend lifecycle (setup/unlock/lock) and network selection.
// This is a wallet concern — no x402 spending limits logic.
//
// For the built-in backend, the user provides a root key (hex) during setup.
// This key is encrypted with AES-GCM using a PBKDF2-derived key from the
// user's password, and persisted in chrome.storage.local. On unlock, the
// password decrypts the stored root key, which is then passed to
// wallet-toolbox's SetupClient.createWalletIdb() to initialise the wallet.
// ---------------------------------------------------------------------------

const WALLET_KEY_STORAGE = 'x402_wallet_rootkey'

let walletNetwork: 'main' | 'test' = 'main'
let walletInitialised = false
let rootKeyHexInMemory: string | null = null

/** The active wallet backend. Defaults to built-in. */
let backend: WalletBackend = new BuiltInWalletBackend()

/** Get the active wallet backend. */
export function getBackend(): WalletBackend {
  return backend
}

/** Whether the built-in wallet is initialised and ready. */
export function isUnlocked(): boolean {
  return walletInitialised
}

/**
 * Set up a new wallet — derive root key from password, persist encrypted,
 * and initialise the wallet-toolbox Wallet.
 */
export async function setup(seed: string, password: string): Promise<void> {
  // Validate seed is a valid hex string of expected length (64 hex chars = 32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error('Seed must be a 64-character hex string (32 bytes)')
  }

  // The seed IS the root key hex for wallet-toolbox
  // Persist it encrypted with the password for later unlock
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(seed))

  await chrome.storage.local.set({
    [WALLET_KEY_STORAGE]: {
      ciphertext: bufToBase64(ciphertext),
      iv: bufToBase64(iv.buffer),
      salt: bufToBase64(salt.buffer),
    },
  })

  // Initialise the wallet backend
  if (backend instanceof BuiltInWalletBackend) {
    await backend.setup(seed, walletNetwork)
    walletInitialised = true
    rootKeyHexInMemory = seed
  }
  console.log('x402: wallet set up')
}

/** Unlock the wallet with a password. Decrypts the stored root key and initialises the wallet. */
export async function unlock(password: string): Promise<void> {
  const result = await chrome.storage.local.get(WALLET_KEY_STORAGE)
  const stored = result[WALLET_KEY_STORAGE] as { ciphertext: string; iv: string; salt: string } | undefined
  if (!stored) throw new Error('No wallet found. Please set up the wallet first.')

  const enc = new TextEncoder()
  const salt = new Uint8Array(base64ToBuf(stored.salt))
  const iv = new Uint8Array(base64ToBuf(stored.iv))
  const ciphertext = base64ToBuf(stored.ciphertext)

  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  } catch {
    throw new Error('Incorrect password')
  }

  const rootKeyHex = new TextDecoder().decode(plaintext)

  if (backend instanceof BuiltInWalletBackend) {
    await backend.setup(rootKeyHex, walletNetwork)
    walletInitialised = true
    rootKeyHexInMemory = rootKeyHex
  }
  console.log('x402: wallet unlocked')
}

/** Lock the wallet. Destroys the in-memory wallet instance. */
export function lock(): void {
  // Create a fresh uninitialised backend
  if (backend instanceof BuiltInWalletBackend) {
    backend = new BuiltInWalletBackend()
    walletInitialised = false
    rootKeyHexInMemory = null
  }
  console.log('x402: wallet locked')
}

/** Get the root key hex (only available while unlocked). */
export function getRootKeyHex(): string | null {
  return rootKeyHexInMemory
}

/** Set the network. Only accepts 'main' or 'test'. */
export function setNetwork(network: string): void {
  if (network === 'main' || network === 'test') {
    walletNetwork = network
  }
}

/** Get current wallet state for UI. */
export async function getWalletState(): Promise<Record<string, unknown>> {
  const result = await chrome.storage.local.get(WALLET_KEY_STORAGE)
  const hasStoredKey = result[WALLET_KEY_STORAGE] != null
  const state: Record<string, unknown> = {
    isSetUp: hasStoredKey,
    isUnlocked: walletInitialised,
    network: walletNetwork,
  }

  // Fetch balance from wallet backend when unlocked
  if (walletInitialised && backend) {
    try {
      const outputs = await backend.call('listOutputs', { basket: 'default', limit: 10000 }, 'self') as { outputs: Array<{ satoshis: number; spendable: boolean }> }
      state.balance = outputs.outputs
        .filter((o) => o.spendable)
        .reduce((sum, o) => sum + o.satoshis, 0)
    } catch {
      // Balance unavailable — leave as undefined
    }
  }

  return state
}

/** Switch to a different wallet backend. Persists the choice. */
export async function switchBackend(type: 'builtin' | 'external', config?: ExternalWalletConfig): Promise<void> {
  if (type === 'external') {
    if (!config?.extensionId) throw new Error('extensionId required for external backend')
    backend = new ExternalWalletBackend(config)
    walletInitialised = true // external wallet manages its own state
    await chrome.storage.local.set({ x402_wallet_backend: { type, extensionId: config.extensionId } })
  } else {
    backend = new BuiltInWalletBackend()
    walletInitialised = false
    await chrome.storage.local.set({ x402_wallet_backend: { type: 'builtin' } })
  }
  console.log(`x402: wallet backend switched to ${type}`)
}

/** Restore backend choice from storage on startup. */
export async function restoreBackendChoice(): Promise<void> {
  const result = await chrome.storage.local.get('x402_wallet_backend')
  const saved = result.x402_wallet_backend as { type: string; extensionId?: string } | undefined
  if (saved?.type === 'external' && saved.extensionId) {
    backend = new ExternalWalletBackend({ extensionId: saved.extensionId })
    walletInitialised = true
    console.log('x402: restored external wallet backend')
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
