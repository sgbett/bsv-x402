/// <reference types="chrome" />

import {
  TIER_CAPS,
  WEAPON_CAPS,
  checkPayment,
  recordPayment as recordPaymentFn,
  applyPickup as applyPickupFn,
  clampBalanceToTier as clampFn,
  initialState,
} from '../../src/autospend'
import type {
  AutospendConfig,
  AutospendState,
  PickupName,
  PaymentRequest,
  TierName,
  WeaponName,
} from '../../src/types'

// ---------------------------------------------------------------------------
// Autospend controller
//
// Owns the autospend config (tier + weapon) and balance state.
// State is in-memory only — resets on extension restart.
// ---------------------------------------------------------------------------

let config: AutospendConfig = {
  tier: 'Hurt Me Plenty',
  weapon: 'Shotgun',
}

// Start with tier cap; will be clamped to wallet balance when we know it.
let state: AutospendState = { balance: TIER_CAPS[config.tier] }

export interface SpendCheckResult {
  allowed: boolean
  requiresConfirmation?: boolean
  reason?: string
}

/**
 * Check whether a payment can be auto-approved.
 * Returns `allowed: true` for auto-approve, or `requiresConfirmation: true`
 * when the payment exceeds the weapon cap or current autospend balance.
 */
export function checkSpendLimits(request: PaymentRequest): SpendCheckResult {
  const decision = checkPayment(request.amount, state, config)
  if (decision === 'auto') return { allowed: true }
  return { allowed: false, requiresConfirmation: true, reason: 'User confirmation required' }
}

/** Deduct a completed payment from the autospend balance. */
export function recordPayment(amount: number): void {
  state = recordPaymentFn(amount, state)
}

/** Apply a pickup. Caller supplies the current wallet balance for the cap. */
export function triggerPickup(pickup: PickupName, walletBalance: number): void {
  state = applyPickupFn(pickup, state, config, walletBalance)
  console.log(`x402: pickup "${pickup}" applied. Balance: ${state.balance}`)
}

/** Change the difficulty tier. Clamps balance to the new cap. */
export function setTier(tier: TierName, walletBalance: number): void {
  config = { ...config, tier }
  state = clampFn(state, config, walletBalance)
  console.log(`x402: tier changed to "${tier}". Balance clamped to ${state.balance}`)
}

/** Change the weapon (per-tx max). */
export function setWeapon(weapon: WeaponName): void {
  config = { ...config, weapon }
  console.log(`x402: weapon changed to "${weapon}"`)
}

/** Reset the autospend state to full for the current tier. */
export function resetAutospend(walletBalance: number): void {
  state = initialState(config, walletBalance)
}

/** Clamp the autospend balance to the wallet balance (e.g. after unlock). */
export function clampToWallet(walletBalance: number): void {
  state = clampFn(state, config, walletBalance)
}

/** Get current autospend state for UI. */
export function getX402State(walletBalance?: number): {
  tier: TierName
  weapon: WeaponName
  autospendBalance: number
  tierCap: number
  weaponCap: number
} {
  const rawTierCap = TIER_CAPS[config.tier]
  // Effective cap: never exceed wallet balance when known
  const tierCap = walletBalance !== undefined ? Math.min(rawTierCap, walletBalance) : rawTierCap
  return {
    tier: config.tier,
    weapon: config.weapon,
    autospendBalance: state.balance,
    tierCap,
    weaponCap: WEAPON_CAPS[config.weapon],
  }
}

/** Get spend status for the indicator (balance as % of tier cap). */
export function getSpendStatus(walletBalance?: number): {
  balance: number
  tierCap: number
  percentage: number
} {
  const rawTierCap = TIER_CAPS[config.tier]
  const tierCap = walletBalance !== undefined ? Math.min(rawTierCap, walletBalance) : rawTierCap
  return {
    balance: state.balance,
    tierCap,
    percentage: tierCap > 0 ? state.balance / tierCap : 0,
  }
}
