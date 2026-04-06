import type {
  AutospendConfig,
  AutospendState,
  PickupName,
  TierName,
  WeaponName,
} from "./types"

/**
 * Autospend balance cap per tier (max sats that can be auto-spent without confirmation).
 * Doom II difficulty progression — each tier is 10x the previous.
 */
export const TIER_CAPS: Record<TierName, number> = {
  "I'm Too Young to Die": 1_000_000,       // 0.01 BSV
  "Hey, Not Too Rough": 10_000_000,        // 0.1 BSV
  "Hurt Me Plenty": 100_000_000,           // 1 BSV
  "Ultra-Violence": 1_000_000_000,         // 10 BSV
  "Nightmare!": 100_000_000_000,           // 100 BSV
}

/**
 * Per-tx max per weapon. BFG9000 has no hard cap — it's bound only by the
 * autospend balance at payment time.
 */
export const WEAPON_CAPS: Record<WeaponName, number> = {
  "Fists": 100_000,
  "Chainsaw": 250_000,
  "Pistol": 500_000,
  "Shotgun": 1_000_000,
  "Super Shotgun": 10_000_000,
  "Chaingun": 50_000_000,
  "Rocket Launcher": 250_000_000,
  "Plasma Rifle": 1_000_000_000,
  "BFG9000": Infinity,
}

/**
 * Pickup percentages — how much of the tier cap each pickup restores.
 */
export const PICKUP_PERCENTAGES: Record<PickupName, number> = {
  "Medkit": 0.10,
  "Stimpak": 0.25,
  "Soul Sphere": 1.0,
  "New Game": 1.0, // hard-set to 100% (not additive)
}

export type PaymentDecision = "auto" | "confirm"

/**
 * Check whether a payment can be auto-approved.
 * Auto-approve if `amount <= min(weapon cap, autospend balance)`.
 */
export function checkPayment(
  amount: number,
  state: AutospendState,
  config: AutospendConfig,
): PaymentDecision {
  const perTxMax = WEAPON_CAPS[config.weapon]
  const effectiveMax = Math.min(perTxMax, state.balance)
  return amount <= effectiveMax ? "auto" : "confirm"
}

/**
 * Deduct a payment from the autospend balance.
 * Balance can never go below zero.
 */
export function recordPayment(
  amount: number,
  state: AutospendState,
): AutospendState {
  return { balance: Math.max(0, state.balance - amount) }
}

/**
 * Apply a pickup to the autospend state.
 *
 * - Medkit / Stimpak / Soul Sphere: add a percentage of tier cap to current balance
 * - New Game: reset balance to tier cap (not additive)
 *
 * All pickups are capped by `min(tierCap, walletBalance)`.
 */
export function applyPickup(
  pickup: PickupName,
  state: AutospendState,
  config: AutospendConfig,
  walletBalance: number,
): AutospendState {
  const tierCap = TIER_CAPS[config.tier]
  const cap = Math.min(tierCap, walletBalance)

  if (pickup === "New Game") {
    return { balance: cap }
  }

  const bonus = Math.floor(tierCap * PICKUP_PERCENTAGES[pickup])
  return { balance: Math.min(cap, state.balance + bonus) }
}

/**
 * Clamp the autospend balance to the current tier cap and wallet balance.
 * Used after a tier change to ensure the balance doesn't exceed the new cap.
 */
export function clampBalanceToTier(
  state: AutospendState,
  config: AutospendConfig,
  walletBalance: number,
): AutospendState {
  const cap = Math.min(TIER_CAPS[config.tier], walletBalance)
  return { balance: Math.min(state.balance, cap) }
}

/**
 * Create a fresh autospend state at the tier cap.
 */
export function initialState(config: AutospendConfig, walletBalance: number): AutospendState {
  const cap = Math.min(TIER_CAPS[config.tier], walletBalance)
  return { balance: cap }
}
