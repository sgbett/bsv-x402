# Plan: Autospend redesign

## Overview

Replace the rate-limiter-based spending controls with a simpler autospend model:

- **Tier** sets the autospend balance cap (max sats you can auto-spend without confirmation)
- **Weapon** sets the per-tx max
- **Autospend balance** (health bar) decreases with payments, increases with pickups
- Payments auto-approve when `amount <= min(weapon, autospendBalance)`
- Otherwise, a popup window prompts for Y/N confirmation

Removes: time windows, tx count limits, circuit breaker, yellow-light, 2FA, site policies, ledger persistence.

## Data model

```ts
// src/types.ts

export type TierName =
  | "I'm Too Young to Die"
  | "Hey, Not Too Rough"
  | "Hurt Me Plenty"
  | "Ultra-Violence"
  | "Nightmare!"

export type WeaponName =
  | "Fists"
  | "Chainsaw"
  | "Pistol"
  | "Shotgun"
  | "Super Shotgun"
  | "Chaingun"
  | "Rocket Launcher"
  | "Plasma Rifle"
  | "BFG9000"

export type PickupName = "Medkit" | "Stimpak" | "Soul Sphere" | "New Game"

export interface AutospendConfig {
  tier: TierName     // → tierCap via TIER_CAPS
  weapon: WeaponName // → perTxMax via WEAPON_CAPS
}

export interface AutospendState {
  balance: number // current autospend balance
}

export const TIER_CAPS: Record<TierName, number> = {
  "I'm Too Young to Die": 1_000_000,
  "Hey, Not Too Rough": 10_000_000,
  "Hurt Me Plenty": 100_000_000,
  "Ultra-Violence": 1_000_000_000,
  "Nightmare!": 100_000_000_000,
}

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

export const PICKUP_PERCENTAGES: Record<PickupName, number> = {
  "Medkit": 0.10,
  "Stimpak": 0.25,
  "Soul Sphere": 1.0,
  "New Game": 1.0, // hard-set to 100%
}
```

## Core logic

```ts
// src/autospend.ts (new file, replaces src/limits.ts)

export type PaymentDecision = 'auto' | 'confirm'

export function checkPayment(
  amount: number,
  state: AutospendState,
  config: AutospendConfig,
): PaymentDecision {
  const perTxMax = WEAPON_CAPS[config.weapon]
  const effectiveMax = Math.min(perTxMax, state.balance)
  return amount <= effectiveMax ? 'auto' : 'confirm'
}

export function recordPayment(
  amount: number,
  state: AutospendState,
): AutospendState {
  return { balance: Math.max(0, state.balance - amount) }
}

export function applyPickup(
  pickup: PickupName,
  state: AutospendState,
  config: AutospendConfig,
  walletBalance: number,
): AutospendState {
  const tierCap = TIER_CAPS[config.tier]
  const cap = Math.min(tierCap, walletBalance)

  if (pickup === 'New Game') {
    return { balance: cap }
  }

  const bonus = Math.floor(tierCap * PICKUP_PERCENTAGES[pickup])
  return { balance: Math.min(cap, state.balance + bonus) }
}

export function clampBalanceToTier(
  state: AutospendState,
  config: AutospendConfig,
  walletBalance: number,
): AutospendState {
  const cap = Math.min(TIER_CAPS[config.tier], walletBalance)
  return { balance: Math.min(state.balance, cap) }
}
```

## Tasks

### Task 1: New autospend core

**File:** `src/autospend.ts` (new), `src/types.ts` (updated)

- Add `TierName`, `WeaponName`, `PickupName`, `AutospendConfig`, `AutospendState`
- Add `TIER_CAPS`, `WEAPON_CAPS`, `PICKUP_PERCENTAGES` constants
- Implement `checkPayment`, `recordPayment`, `applyPickup`, `clampBalanceToTier`
- Tests for each function

### Task 2: Delete rate limiter infrastructure

**Files to delete:**
- `src/limits.ts`
- `src/site-policy.ts`
- `src/two-factor.ts`
- `src/storage.ts` (if only used by limits)

**Types to remove from `src/types.ts`:**
- `SpendLimits`, `WindowLimit`, `TimeWindow`, `SpendMode`
- `TierPreset`, `SitePolicy`, `SitePolicyAction`, `SitePromptFn`
- `TwoFactorProvider`, `TwoFactorAction`, `TwoFactorPolicy`
- `LedgerEntry`, `LimitState`, `LimitCheckResult`, `BlockSeverity`
- `YellowLightEvent`, `StorageAdapter`, `KeyDeriver`

**Tests to delete:**
- `src/limits.test.ts`
- `src/site-policy.test.ts`
- `src/two-factor.test.ts`
- `src/storage.test.ts`

**Exports to remove from `src/index.ts`:**
- Everything related to the deleted types/classes

### Task 3: Extension controller rewrite

**File:** `plugins/shared/x402-controller.ts`

Replace with autospend-based logic:

```ts
let config: AutospendConfig = {
  tier: 'Hey, Not Too Rough',
  weapon: 'Pistol',
}
let state: AutospendState = { balance: TIER_CAPS[config.tier] }

export async function checkSpendLimits(
  request: PaymentRequest,
): Promise<{ allowed: boolean; reason?: string; requiresConfirmation?: boolean }> {
  const decision = checkPayment(request.amount, state, config)
  if (decision === 'auto') return { allowed: true }
  return { allowed: false, requiresConfirmation: true }
}

export function recordAutospendPayment(amount: number): void {
  state = recordPayment(amount, state)
}

export function triggerPickup(pickup: PickupName, walletBalance: number): void {
  state = applyPickup(pickup, state, config, walletBalance)
}

export function setTier(tier: TierName, walletBalance: number): void {
  config = { ...config, tier }
  state = clampBalanceToTier(state, config, walletBalance)
}

export function setWeapon(weapon: WeaponName): void {
  config = { ...config, weapon }
}

export function getAutospendState() {
  return { config, state }
}
```

State is not persisted to storage — resets on extension restart.

### Task 4: CWI proxy confirmation flow

**File:** `plugins/shared/cwi-proxy.ts`

Change `handleCWIRequest` so that when `checkSpendLimits` returns `requiresConfirmation`:

1. Generate a request UUID
2. Store the request details in an in-memory pending map
3. Open `chrome.windows.create({ url: 'ui/x402/approve.html?id=<uuid>', type: 'popup', width: 400, height: 300 })`
4. Return a Promise that resolves when the approval message arrives
5. If approved: proceed with the createAction, then `recordAutospendPayment`
6. If denied: return an error to the page

Add message handler in `background.ts` for `approvalResponse` messages from approve.html.

### Task 5: Approval UI

**Files:** `plugins/shared/ui/x402/approve.html`, `plugins/shared/ui/x402/approve.ts`

Parse query params: `?id=<uuid>&amount=<sats>&origin=<url>`

Display:
- "Confirm payment"
- Amount in sats
- Requesting origin
- Approve button (green)
- Deny button (red)

On click, send message to background with `{ type: 'approvalResponse', id, approved: boolean }`, then close the window.

### Task 6: Popup UI — autospend controls

**File:** `plugins/shared/ui/popup.html`, `plugins/shared/ui/popup.ts`, `plugins/shared/ui/popup.css`

Replace the current tier selector + limits summary with:

**Tier selector** (dropdown) — existing, wires to `setTier`
**Weapon selector** (dropdown) — new, wires to `setWeapon`
**Autospend balance bar** — new, shows current balance as a health bar (% of tier cap)
**Pickup buttons** — new, four buttons: Medkit, Stimpak, Soul Sphere, New Game
**Autospend balance display** — numeric value next to the bar

Poll state every 10s (already polling for wallet balance). Update bar and display.

### Task 7: Remove old popup code

- Remove "indicator mode" selector (currently shows bar/badge/hidden options) — unrelated to autospend, keep separate
  - Actually keep this, the spend indicator on pages is separate from popup autospend display
- Remove limits summary display
- Remove yellow-light / 2FA references
- Update state interface

### Task 8: Extension message types

**File:** `plugins/shared/messages.ts`

Add:
- `pickup` message type (payload: `PickupName`)
- `setWeapon` message type (payload: `WeaponName`)
- `approvalResponse` message type (payload: `{ id, approved }`)
- `getAutospendState` message type

Background handlers for each.

### Task 9: Spend indicator update

**File:** `plugins/shared/spend-indicator.ts`

The indicator currently shows "budget usage". Repurpose it to show autospend balance as a health bar on protected pages (or hide it — might be overkill). Defer if out of scope.

### Task 10: Tests

- `src/autospend.test.ts` — unit tests for pure functions
- `plugins/shared/x402-controller.test.ts` — controller state transitions
- `plugins/shared/cwi-proxy.test.ts` — mock approval flow

### Task 11: Library cleanup

The library no longer needs `RateLimiter` exports (already stripped from `x402Fetch` in #87). After removing `src/limits.ts`, check for any remaining consumers and update exports.

## Order

- **1 → 2**: new core before deleting old
- **3** depends on 1 + 2 (controller needs new types, old types gone)
- **4 + 5** in parallel (backend approval flow + UI)
- **6** depends on 3 (popup needs the controller API)
- **8** in parallel with 4+5+6 (message types)
- **7** follows 6 (cleanup after popup is rewritten)
- **10** follows each task (tests alongside implementation)
- **11** last (export cleanup)

## Out of scope

- Persistence of autospend state across restarts (explicit: resets on restart)
- External pickup triggers (only popup buttons)
- Spend indicator redesign (defer)
- Soul Sphere overflow to 200% with blue bar overlay (deferred in HLR)
- Removing "indicator mode" selector (unrelated feature)
