/// <reference types="chrome" />

import { ExtensionStorageAdapter } from './storage-bridge'
import { RateLimiter, resolveSpendLimits } from '../../src/limits'
import type { SpendCheckable } from '../../src/limits'
import type { LimitCheckResult, SpendMode, TierName, WalletId } from '../../src/types'

// ---------------------------------------------------------------------------
// Spending limits controller (multi-wallet)
//
// Manages per-wallet rate limiters and spend-limit storage.
// Each wallet has its own tier, mode, storage namespace, and limiter instance.
// Protocol-agnostic — accepts both x402 Challenges and PaymentRequests.
// ---------------------------------------------------------------------------

interface WalletLimiterState {
  tier: TierName
  mode: SpendMode
  storage: ExtensionStorageAdapter
  limiter: RateLimiter | null
}

/** Per-wallet limiter state, keyed by wallet ID. */
const walletLimiters: Map<WalletId, WalletLimiterState> = new Map()

/** Global fallback for wallets with no explicit config. */
let defaultTier: TierName = 'Hey, Not Too Rough'
let defaultMode: SpendMode = 'interactive'

function getOrCreateState(walletId: WalletId): WalletLimiterState {
  let state = walletLimiters.get(walletId)
  if (!state) {
    state = {
      tier: defaultTier,
      mode: defaultMode,
      storage: new ExtensionStorageAdapter(undefined, walletId),
      limiter: null,
    }
    walletLimiters.set(walletId, state)
  }
  return state
}

async function ensureLimiter(walletId: WalletId): Promise<RateLimiter> {
  const state = getOrCreateState(walletId)
  if (state.limiter) return state.limiter
  const limits = resolveSpendLimits(state.tier, state.mode)
  const saved = await state.storage.load()
  state.limiter = new RateLimiter(limits, saved ?? undefined)
  return state.limiter
}

async function persistLimiter(walletId: WalletId): Promise<void> {
  const state = walletLimiters.get(walletId)
  if (!state?.limiter) return
  await state.storage.save(state.limiter.getState())
}

/** Check spend limits for a specific wallet. */
export async function checkSpendLimits(
  request: SpendCheckable,
  origin: string,
  walletId?: WalletId,
): Promise<{ allowed: boolean; reason?: string }> {
  const id = walletId ?? '_default'
  const rl = await ensureLimiter(id)
  const result: LimitCheckResult = rl.check(request, origin)

  if (result.action === 'allow') return { allowed: true }
  if (result.action === 'yellow-light') {
    // TODO: open approve.html popup for user confirmation
    return { allowed: false, reason: 'User approval required for this spend' }
  }
  if (result.action === 'block') {
    if (result.severity === 'trip') {
      rl.trip()
      await persistLimiter(id)
    }
    return { allowed: false, reason: result.reason }
  }
  return { allowed: true }
}

/** Record a completed payment for a specific wallet. */
export async function recordPayment(
  origin: string,
  satoshis: number,
  txid: string,
  walletId?: WalletId,
): Promise<void> {
  const id = walletId ?? '_default'
  const rl = await ensureLimiter(id)
  rl.record({ timestamp: Date.now(), origin, satoshis, txid })
  await persistLimiter(id)
}

/** Configure tier/mode for a specific wallet. Resets its limiter. */
export function setWalletTier(walletId: WalletId, tier: TierName, mode?: SpendMode): void {
  const state = getOrCreateState(walletId)
  state.tier = tier
  if (mode) state.mode = mode
  state.limiter = null // reset to pick up new limits
  console.log(`x402: wallet ${walletId} tier changed to "${tier}"`)
}

/** Change the global default tier (for wallets without explicit config). */
export function setTier(tier: TierName): void {
  defaultTier = tier
  // Reset all limiters to pick up new defaults for unconfigured wallets
  for (const [, state] of walletLimiters) {
    state.limiter = null
  }
  console.log(`x402: default tier changed to "${tier}"`)
}

/** Get x402 state for a specific wallet. */
export function getX402StateForWallet(walletId: WalletId): {
  tier: TierName
  mode: SpendMode
  limits: { perTxMaxSatoshis: number; windows: Array<{ window: string; maxSatoshis: number; maxTransactions: number }> }
} {
  const state = getOrCreateState(walletId)
  const resolved = resolveSpendLimits(state.tier, state.mode)
  return {
    tier: state.tier,
    mode: state.mode,
    limits: {
      perTxMaxSatoshis: resolved.perTxMaxSatoshis,
      windows: resolved.windows.map(w => ({ window: w.window, maxSatoshis: w.maxSatoshis, maxTransactions: w.maxTransactions })),
    },
  }
}

/** Get current x402 state (default/global). */
export function getX402State(): {
  tier: TierName
  mode: SpendMode
  limits: { perTxMaxSatoshis: number; windows: Array<{ window: string; maxSatoshis: number; maxTransactions: number }> }
} {
  const resolved = resolveSpendLimits(defaultTier, defaultMode)
  return {
    tier: defaultTier,
    mode: defaultMode,
    limits: {
      perTxMaxSatoshis: resolved.perTxMaxSatoshis,
      windows: resolved.windows.map(w => ({ window: w.window, maxSatoshis: w.maxSatoshis, maxTransactions: w.maxTransactions })),
    },
  }
}

/** Get spend status for the indicator, optionally per-wallet. */
export async function getSpendStatus(walletId?: WalletId): Promise<{
  spent: number
  limit: number
  window: string
  percentage: number
  circuitBroken: boolean
  walletId?: WalletId
}> {
  const id = walletId ?? '_default'
  const rl = await ensureLimiter(id)
  const rlState = rl.getState()
  const state = getOrCreateState(id)
  const limits = resolveSpendLimits(state.tier, state.mode)

  const firstWindow = limits.windows[0]
  if (!firstWindow) {
    return { spent: 0, limit: 0, window: 'none', percentage: 0, circuitBroken: rlState.circuitBroken, walletId: walletId ?? undefined }
  }

  const WINDOW_MS: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
  }

  const cutoff = Date.now() - (WINDOW_MS[firstWindow.window] ?? 86_400_000)
  const spent = rlState.entries
    .filter((e) => e.timestamp >= cutoff)
    .reduce((sum, e) => sum + e.satoshis, 0)

  return {
    spent,
    limit: firstWindow.maxSatoshis,
    window: firstWindow.window,
    percentage: firstWindow.maxSatoshis > 0 ? spent / firstWindow.maxSatoshis : 0,
    circuitBroken: rlState.circuitBroken,
    walletId: walletId ?? undefined,
  }
}
