/// <reference types="chrome" />

import { SessionManager, encryptSeed, saveSeed, loadSeed } from './key-manager'
import type { CWIHandlerContext } from './cwi'
import type { WalletBackend } from './wallet-backend'
import { BuiltInWalletBackend } from './builtin-wallet-backend'
import { ExternalWalletBackend, type ExternalWalletConfig } from './external-wallet-backend'

// ---------------------------------------------------------------------------
// Wallet controller
//
// Owns the wallet session (unlock/lock/setup) and network selection.
// This is a wallet concern — no x402 spending limits logic.
// ---------------------------------------------------------------------------

const session = new SessionManager()
let walletNetwork = 'main'

/** Context object passed to CWI method handlers. */
export const cwiContext: CWIHandlerContext = {
  getSeed: () => session.getSeed(),
  isUnlocked: () => session.isUnlocked(),
  getNetwork: () => walletNetwork,
}

/** The active wallet backend. Defaults to built-in. */
let backend: WalletBackend = new BuiltInWalletBackend(cwiContext)

/** Get the active wallet backend. */
export function getBackend(): WalletBackend {
  return backend
}

/** Switch to a different wallet backend. Persists the choice. */
export async function switchBackend(type: 'builtin' | 'external', config?: ExternalWalletConfig): Promise<void> {
  if (type === 'external') {
    if (!config?.extensionId) throw new Error('extensionId required for external backend')
    backend = new ExternalWalletBackend(config)
    await chrome.storage.local.set({ x402_wallet_backend: { type, extensionId: config.extensionId } })
  } else {
    backend = new BuiltInWalletBackend(cwiContext)
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
    console.log('x402: restored external wallet backend')
  }
}

/** Whether the wallet is currently unlocked. */
export function isUnlocked(): boolean {
  return session.isUnlocked()
}

/** Lock the wallet. */
export function lock(): void {
  session.lock()
  console.log('x402: wallet locked')
}

/** Unlock the wallet with a password. Throws on wrong password. */
export async function unlock(password: string): Promise<void> {
  await session.unlock(password)
  console.log('x402: wallet unlocked')
}

/** Set up a new wallet — encrypt and persist seed, then unlock. */
export async function setup(seed: string, password: string): Promise<void> {
  const encrypted = await encryptSeed(seed, password)
  await saveSeed(encrypted)
  await session.unlock(password)
  console.log('x402: wallet set up')
}

/** Set the network. Only accepts 'main' or 'test'. */
export function setNetwork(network: string): void {
  if (network === 'main' || network === 'test') {
    walletNetwork = network
  }
}

/** Get current wallet state for UI. */
export async function getWalletState(): Promise<Record<string, unknown>> {
  const encrypted = await loadSeed()
  return {
    isSetUp: encrypted !== null,
    isUnlocked: session.isUnlocked(),
    network: walletNetwork,
  }
}
