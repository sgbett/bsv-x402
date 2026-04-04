/// <reference types="chrome" />

import type { WalletBackend } from './wallet-backend'
import type { WalletId } from '../../src/types'
import { BuiltInWalletBackend } from './builtin-wallet-backend'
import { ExternalWalletBackend, type ExternalWalletConfig } from './external-wallet-backend'

// ---------------------------------------------------------------------------
// Wallet controller (multi-wallet)
//
// Manages multiple wallet backend instances keyed by WalletId.
// Each wallet has its own encrypted root key, backend instance, and lifecycle.
//
// The "active" wallet is the one currently selected — typically the default
// or the one chosen by the registry for a given origin.
// ---------------------------------------------------------------------------

const WALLET_KEY_PREFIX = 'x402_wallet_rootkey'

function walletKeyStorageKey(walletId: WalletId): string {
  return `${WALLET_KEY_PREFIX}:${walletId}`
}

/** Legacy key for migration from single-wallet. */
const LEGACY_WALLET_KEY_STORAGE = 'x402_wallet_rootkey'

let walletNetwork: 'main' | 'test' = 'main'

/** Map of wallet ID → backend instance. */
const backends: Map<WalletId, WalletBackend> = new Map()

/** Map of wallet ID → initialised state. */
const initialisedState: Map<WalletId, boolean> = new Map()

/** The currently active wallet ID. */
let activeWalletId: WalletId | null = null

/** Get a wallet backend by ID. Falls back to active wallet if no ID given. */
export function getBackend(walletId?: WalletId): WalletBackend {
  const id = walletId ?? activeWalletId
  if (id) {
    const backend = backends.get(id)
    if (backend) return backend
  }
  // Fallback: create a fresh uninitialised built-in backend
  return new BuiltInWalletBackend()
}

/** Get the active wallet ID. */
export function getActiveWalletId(): WalletId | null {
  return activeWalletId
}

/** Set the active wallet ID. */
export function setActiveWallet(walletId: WalletId): void {
  activeWalletId = walletId
}

/** Whether a specific wallet is initialised and ready. */
export function isUnlocked(walletId?: WalletId): boolean {
  const id = walletId ?? activeWalletId
  if (!id) return false
  return initialisedState.get(id) ?? false
}

/** Whether any wallet is unlocked. */
export function anyUnlocked(): boolean {
  for (const [, v] of initialisedState) {
    if (v) return true
  }
  return false
}

/**
 * Set up a new wallet — encrypt root key with password, persist, and initialise.
 */
export async function setup(walletId: WalletId, seed: string, password: string): Promise<void> {
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error('Seed must be a 64-character hex string (32 bytes)')
  }

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

  const storageKey = walletKeyStorageKey(walletId)
  await chrome.storage.local.set({
    [storageKey]: {
      ciphertext: bufToBase64(ciphertext),
      iv: bufToBase64(iv.buffer),
      salt: bufToBase64(salt.buffer),
    },
  })

  // Initialise the backend
  const backend = new BuiltInWalletBackend()
  await backend.setup(seed, walletNetwork)
  backends.set(walletId, backend)
  initialisedState.set(walletId, true)

  if (!activeWalletId) activeWalletId = walletId
  console.log(`x402: wallet ${walletId} set up`)
}

/** Unlock a wallet with its password. */
export async function unlock(walletId: WalletId, password: string): Promise<void> {
  const storageKey = walletKeyStorageKey(walletId)
  const result = await chrome.storage.local.get(storageKey)
  const stored = result[storageKey] as { ciphertext: string; iv: string; salt: string } | undefined
  if (!stored) throw new Error(`No wallet key found for ${walletId}. Please set up the wallet first.`)

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
  const backend = new BuiltInWalletBackend()
  await backend.setup(rootKeyHex, walletNetwork)
  backends.set(walletId, backend)
  initialisedState.set(walletId, true)

  if (!activeWalletId) activeWalletId = walletId
  console.log(`x402: wallet ${walletId} unlocked`)
}

/** Lock a specific wallet. Destroys the in-memory backend. */
export function lock(walletId?: WalletId): void {
  if (walletId) {
    backends.delete(walletId)
    initialisedState.set(walletId, false)
    if (activeWalletId === walletId) {
      // Switch active to next unlocked wallet, or null
      activeWalletId = null
      for (const [id, unlocked] of initialisedState) {
        if (unlocked) { activeWalletId = id; break }
      }
    }
    console.log(`x402: wallet ${walletId} locked`)
  } else {
    // Lock all wallets
    backends.clear()
    initialisedState.clear()
    activeWalletId = null
    console.log('x402: all wallets locked')
  }
}

/** Set the network for all wallets. */
export function setNetwork(network: string): void {
  if (network === 'main' || network === 'test') {
    walletNetwork = network
  }
}

/** Switch a wallet to an external backend. */
export async function switchBackendForWallet(
  walletId: WalletId,
  type: 'builtin' | 'external',
  config?: ExternalWalletConfig,
): Promise<void> {
  if (type === 'external') {
    if (!config?.extensionId) throw new Error('extensionId required for external backend')
    const backend = new ExternalWalletBackend(config)
    backends.set(walletId, backend)
    initialisedState.set(walletId, true)
  } else {
    backends.set(walletId, new BuiltInWalletBackend())
    initialisedState.set(walletId, false)
  }
  console.log(`x402: wallet ${walletId} backend switched to ${type}`)
}

/** Get current wallet state for UI. */
export async function getWalletState(): Promise<Record<string, unknown>> {
  const wallets: Record<string, { isSetUp: boolean; isUnlocked: boolean }> = {}

  // Check all stored keys to find set-up wallets
  const allStorage = await chrome.storage.local.get(null)
  for (const key of Object.keys(allStorage)) {
    if (key.startsWith(WALLET_KEY_PREFIX + ':')) {
      const id = key.slice(WALLET_KEY_PREFIX.length + 1)
      wallets[id] = {
        isSetUp: true,
        isUnlocked: initialisedState.get(id) ?? false,
      }
    }
  }

  return {
    activeWalletId,
    wallets,
    network: walletNetwork,
    anyUnlocked: anyUnlocked(),
  }
}

/**
 * Migrate legacy single-wallet storage to multi-wallet format.
 * Moves x402_wallet_rootkey → x402_wallet_rootkey:<defaultWalletId>
 */
export async function migrateLegacyWallet(defaultWalletId: WalletId): Promise<boolean> {
  const result = await chrome.storage.local.get(LEGACY_WALLET_KEY_STORAGE)
  const legacyKey = result[LEGACY_WALLET_KEY_STORAGE]
  if (!legacyKey) return false

  // Check it hasn't already been migrated (the legacy key has no colon suffix)
  const newKey = walletKeyStorageKey(defaultWalletId)
  const existing = await chrome.storage.local.get(newKey)
  if (existing[newKey]) return false // already migrated

  await chrome.storage.local.set({ [newKey]: legacyKey })
  await chrome.storage.local.remove(LEGACY_WALLET_KEY_STORAGE)
  console.log(`x402: migrated legacy wallet key to ${defaultWalletId}`)
  return true
}

/** Restore backend choices from storage on startup. */
export async function restoreBackendChoice(): Promise<void> {
  const result = await chrome.storage.local.get('x402_wallet_backend')
  const saved = result.x402_wallet_backend as { type: string; extensionId?: string } | undefined
  if (saved?.type === 'external' && saved.extensionId) {
    // For legacy compat, apply to the active wallet
    if (activeWalletId) {
      const backend = new ExternalWalletBackend({ extensionId: saved.extensionId })
      backends.set(activeWalletId, backend)
      initialisedState.set(activeWalletId, true)
    }
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
