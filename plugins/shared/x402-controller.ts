/// <reference types="chrome" />

import { ExtensionStorageAdapter } from './storage-bridge'
import { RateLimiter, resolveSpendLimits } from '../../src/limits'
import type { SpendCheckable } from '../../src/limits'
import type { LimitCheckResult, SpendMode, TierName } from '../../src/types'

// ---------------------------------------------------------------------------
// Spending limits controller
//
// Owns tier configuration, the rate limiter, and spend-limit storage.
// Protocol-agnostic — accepts both x402 Challenges and PaymentRequests.
// ---------------------------------------------------------------------------

let currentTier: TierName = 'Hey, Not Too Rough'
let currentMode: SpendMode = 'interactive'

const storage = new ExtensionStorageAdapter()
let limiter: RateLimiter | null = null

async function ensureLimiter(): Promise<RateLimiter> {
  if (limiter) return limiter
  const limits = resolveSpendLimits(currentTier, currentMode)
  const state = await storage.load()
  limiter = new RateLimiter(limits, state ?? undefined)
  return limiter
}

async function persistLimiter(rl: RateLimiter): Promise<void> {
  await storage.save(rl.getState())
}

/** Check spend limits before a payment. Accepts either a Challenge or PaymentRequest. */
export async function checkSpendLimits(request: SpendCheckable, origin: string): Promise<{ allowed: boolean; reason?: string }> {
  const rl = await ensureLimiter()
  const result: LimitCheckResult = rl.check(request, origin)

  if (result.action === 'allow') return { allowed: true }
  if (result.action === 'yellow-light') {
    // TODO: open approve.html popup for user confirmation
    return { allowed: false, reason: 'User approval required for this spend' }
  }
  if (result.action === 'block') {
    if (result.severity === 'trip') {
      rl.trip()
      await persistLimiter(rl)
    }
    return { allowed: false, reason: result.reason }
  }
  return { allowed: true }
}

/** Record a completed payment in the rate limiter. */
export async function recordPayment(origin: string, satoshis: number, txid: string): Promise<void> {
  const rl = await ensureLimiter()
  rl.record({ timestamp: Date.now(), origin, satoshis, txid })
  await persistLimiter(rl)
}

/** Change the spending tier. Resets the limiter to pick up new limits. */
export function setTier(tier: TierName): void {
  currentTier = tier
  limiter = null
  console.log(`x402: tier changed to "${currentTier}"`)
}

/** Get current x402 state for UI, including resolved limits. */
export function getX402State(): {
  tier: TierName
  mode: SpendMode
  limits: { perTxMaxSatoshis: number; windows: Array<{ window: string; maxSatoshis: number; maxTransactions: number }> }
} {
  const resolved = resolveSpendLimits(currentTier, currentMode)
  return {
    tier: currentTier,
    mode: currentMode,
    limits: {
      perTxMaxSatoshis: resolved.perTxMaxSatoshis,
      windows: resolved.windows.map(w => ({ window: w.window, maxSatoshis: w.maxSatoshis, maxTransactions: w.maxTransactions })),
    },
  }
}

/** Get spend status for the indicator. */
export async function getSpendStatus(): Promise<{
  spent: number
  limit: number
  window: string
  percentage: number
  circuitBroken: boolean
}> {
  const rl = await ensureLimiter()
  const state = rl.getState()
  const limits = resolveSpendLimits(currentTier, currentMode)

  // Use the first (shortest) window for the indicator
  const firstWindow = limits.windows[0]
  if (!firstWindow) {
    return { spent: 0, limit: 0, window: 'none', percentage: 0, circuitBroken: state.circuitBroken }
  }

  const WINDOW_MS: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
  }

  const cutoff = Date.now() - (WINDOW_MS[firstWindow.window] ?? 86_400_000)
  const spent = state.entries
    .filter((e) => e.timestamp >= cutoff)
    .reduce((sum, e) => sum + e.satoshis, 0)

  return {
    spent,
    limit: firstWindow.maxSatoshis,
    window: firstWindow.window,
    percentage: firstWindow.maxSatoshis > 0 ? spent / firstWindow.maxSatoshis : 0,
    circuitBroken: state.circuitBroken,
  }
}
