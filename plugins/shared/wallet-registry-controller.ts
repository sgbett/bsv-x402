/// <reference types="chrome" />

import {
  WalletRegistry,
  type CreateWalletOptions,
} from '../../src/wallet-registry'
import type { WalletId, WalletProfile } from '../../src/types'

// ---------------------------------------------------------------------------
// Wallet Registry Controller (extension context)
//
// Wraps WalletRegistry with chrome.storage persistence. The background
// service worker uses this to manage wallet profiles across sessions.
// ---------------------------------------------------------------------------

const REGISTRY_STORAGE_KEY = 'x402_wallet_registry'

let registry: WalletRegistry | null = null

async function ensureRegistry(): Promise<WalletRegistry> {
  if (registry) return registry
  const result = await chrome.storage.local.get(REGISTRY_STORAGE_KEY)
  const stored = result[REGISTRY_STORAGE_KEY] as WalletProfile[] | undefined
  registry = new WalletRegistry(stored ?? [])
  return registry
}

async function persist(): Promise<void> {
  if (!registry) return
  await chrome.storage.local.set({ [REGISTRY_STORAGE_KEY]: registry.toJSON() })
}

/** List all wallet profiles. */
export async function listWallets(): Promise<WalletProfile[]> {
  const reg = await ensureRegistry()
  return reg.list()
}

/** Get a specific wallet profile. */
export async function getWallet(id: WalletId): Promise<WalletProfile | undefined> {
  const reg = await ensureRegistry()
  return reg.get(id)
}

/** Get the default wallet. */
export async function getDefaultWallet(): Promise<WalletProfile | undefined> {
  const reg = await ensureRegistry()
  return reg.getDefault()
}

/** Create a new wallet profile. */
export async function createWallet(opts: CreateWalletOptions): Promise<WalletProfile> {
  const reg = await ensureRegistry()
  const profile = reg.create(opts)
  await persist()
  return profile
}

/** Update an existing wallet profile. */
export async function updateWallet(
  id: WalletId,
  updates: Partial<Omit<WalletProfile, 'id' | 'createdAt'>>,
): Promise<WalletProfile> {
  const reg = await ensureRegistry()
  const profile = reg.update(id, updates)
  await persist()
  return profile
}

/** Remove a wallet profile. */
export async function removeWallet(id: WalletId): Promise<void> {
  const reg = await ensureRegistry()
  reg.remove(id)
  await persist()
}

/** Select the best wallet for an origin + optional amount. */
export async function selectWalletForOrigin(
  origin: string,
  amount?: number,
): Promise<WalletProfile | undefined> {
  const reg = await ensureRegistry()
  return reg.selectForOrigin(origin, amount)
}

/**
 * Migrate from single-wallet to multi-wallet.
 * If no wallets exist, creates a default "Main Wallet" profile.
 * Called once during extension startup.
 */
export async function ensureDefaultWalletExists(): Promise<void> {
  const reg = await ensureRegistry()
  if (reg.list().length > 0) return

  reg.create({
    name: 'Main Wallet',
    mode: 'manual',
    backendType: 'builtin',
    isDefault: true,
  })
  await persist()
  console.log('x402: created default wallet profile for migration')
}
