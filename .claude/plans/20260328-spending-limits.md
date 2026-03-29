# Spending Limits System for bsv-x402

## Context

`x402Fetch` automatically pays 402 challenges — a malicious or compromised server could spam 402 responses and drain the user's wallet. This plan adds a tiered spending limits system (using Doom II difficulty names), per-site policies, a circuit breaker, auto back-off, 2FA for sensitive actions, and tamper-resistant storage.

## API Design

### Factory pattern

```typescript
// Simple: defaults to "Hey, Not Too Rough"
const f = createX402Fetch()

// Pick a tier
const f = createX402Fetch({ tier: "Hurt Me Plenty" })

// Tier + overrides
const f = createX402Fetch({
  tier: "Hey, Not Too Rough",
  limits: { perTxMaxSatoshis: 50_000 },
})

// Nightmare requires confirmation
const f = createX402Fetch({
  tier: "Nightmare!",
  nightmareConfirmation: "NIGHTMARE",
})

// Returned function is a drop-in fetch replacement
const response = await f("https://api.example.com/article")

// Circuit breaker reset (requires 2FA)
f.resetLimits()

// Inspect current state
f.getState()
```

The bare `x402Fetch` remains exported for backwards compatibility, using "Hey, Not Too Rough" defaults with a lazily-initialised singleton limiter.

### Tier presets (Doom II difficulty)

| Tier | Config burden | What you set |
|---|---|---|
| **I'm Too Young to Die** | One number | Max BSV per day. Training wheels. |
| **Hey, Not Too Rough** ★ | ~4-6 numbers | Daily/weekly caps (sats + tx count), per-tx max, per-site prompts. DEFAULT. |
| **Hurt Me Plenty** | Full windows | Minute/hour/day/week granularity, per-site policies, auto back-off tuning. |
| **Ultra-Violence** | Raw config | Every knob exposed. Same base as Hurt Me Plenty, user overrides everything. |
| **Nightmare!** | None | All safeties off except the BFG. Requires typing "NIGHTMARE" to confirm. |

Each tier is a preset that populates the same underlying `SpendLimits` config. No tier-specific branching in the rate limiter — it only sees a resolved config.

### Preset defaults

```
Calibrated at BSV ≈ $15 USD. All values in satoshis (1 BSV = 100,000,000 sats).

Two spend modes — same daily sats budget, different tx-count and per-tx profiles:
  interactive:   user clicked something → low tx count, higher per-tx cap
  programmatic:  library background calls → 100x tx count, 1/100th per-tx cap

I'm Too Young to Die:
  interactive:
    day: 100,000,000 sats (~$15) / unlimited tx
    perTx: 100,000,000 sats
  programmatic:
    day: 100,000,000 sats (~$15) / unlimited tx
    perTx: 1,000,000 sats (~$0.15)
  No per-site prompts

Hey, Not Too Rough (default):
  interactive:
    day:  100,000,000 sats (~$15) / 100 tx
    week: 500,000,000 sats (~$75) / 500 tx
    perTx: 10,000,000 sats (~$1.50)
  programmatic:
    day:  100,000,000 sats (~$15) / 10,000 tx
    week: 500,000,000 sats (~$75) / 50,000 tx
    perTx: 100,000 sats (~$0.015)
  Per-site prompts: yes

Hurt Me Plenty:
  interactive:
    minute:   5,000,000 sats / 10 tx
    hour:    50,000,000 sats / 60 tx
    day:   200,000,000 sats (~$30) / 200 tx
    week: 1,000,000,000 sats (~$150) / 1000 tx
    perTx: 20,000,000 sats (~$3)
  programmatic:
    minute:   5,000,000 sats / 1,000 tx
    hour:    50,000,000 sats / 6,000 tx
    day:   200,000,000 sats (~$30) / 20,000 tx
    week: 1,000,000,000 sats (~$150) / 100,000 tx
    perTx: 200,000 sats (~$0.03)
  Per-site prompts: yes

Ultra-Violence:
  Same base as Hurt Me Plenty (user overrides everything)

Nightmare!:
  No window limits
  perTx: BFG ceiling
  No per-site prompts
```

The mode is set at factory creation time:

```typescript
type SpendMode = 'interactive' | 'programmatic'

// In X402Config:
interface X402Config {
  // ... existing fields ...
  mode?: SpendMode  // default: 'interactive'
}
```

Each tier preset contains both profiles. The factory selects the appropriate profile based on `mode`. The sats budgets (daily/weekly totals) are shared — a programmatic client burning through micro-payments depletes the same daily budget as an interactive one. Only the tx-count allowance and per-tx cap differ.

## Type System

All types go in `src/types.ts`:

```typescript
type SpendMode = 'interactive' | 'programmatic'
type TimeWindow = 'minute' | 'hour' | 'day' | 'week'

interface WindowLimit {
  window: TimeWindow
  maxSatoshis: number
  maxTransactions: number
}

interface SpendLimits {
  windows: WindowLimit[]
  perTxMaxSatoshis: number
  yellowLightThreshold: number    // 0-1, default 0.8
  requirePerSitePrompt: boolean
  sitePolicies: Record<string, SitePolicy>
  require2fa: TwoFactorPolicy
}

type SitePolicyAction = 'global' | 'custom' | 'block'

interface SitePolicy {
  origin: string
  action: SitePolicyAction
  limits?: WindowLimit[]          // when action === 'custom'
  perTxMaxSatoshis?: number
}

interface TwoFactorPolicy {
  onCircuitBreakerReset: boolean
  onTierChange: boolean
  onHighValueTx: boolean
  highValueThreshold: number      // sats — txs above this require 2FA
  onNewSiteApproval: boolean
}

type TierName =
  | "I'm Too Young to Die"
  | "Hey, Not Too Rough"
  | "Hurt Me Plenty"
  | "Ultra-Violence"
  | "Nightmare!"

interface X402Config {
  tier?: TierName
  mode?: SpendMode                // default: 'interactive'
  limits?: Partial<SpendLimits>
  storage?: StorageAdapter
  twoFactorProvider?: TwoFactorProvider
  nightmareConfirmation?: string
  onLimitReached?: () => void
  onYellowLight?: (detail: YellowLightEvent) => Promise<boolean>
  now?: () => number              // injectable clock for testing
}

interface YellowLightEvent {
  origin: string
  currentSpend: number
  limit: number
  window: TimeWindow
  challenge: Challenge
}

interface LedgerEntry {
  timestamp: number
  origin: string
  satoshis: number
  txid: string
}

interface LimitState {
  entries: LedgerEntry[]
  circuitBroken: boolean
  hmac: string
}

type LimitCheckResult =
  | { action: 'allow' }
  | { action: 'yellow-light'; detail: YellowLightEvent }
  | { action: 'block'; reason: string }
```

## Core Mechanics

### Sliding window rate limiter (`src/limits.ts`)

`RateLimiter` class holds the `LedgerEntry[]` array and resolved `SpendLimits`.

**`check(challenge, origin)`** does:
1. If circuit breaker is tripped → block.
2. If `challenge.amount > BFG_PER_TX_CEILING_SATOSHIS` → block (even Nightmare). Also track daily total against `BFG_DAILY_CEILING_SATOSHIS`.
3. If `challenge.amount > perTxMaxSatoshis` → block.
4. For each `WindowLimit`: filter entries with `timestamp >= now - windowMs`, sum sats and count. If adding this challenge would exceed → block.
5. If adding would exceed `yellowLightThreshold` fraction → yellow-light.
6. Otherwise → allow.

**`record(entry)`** appends to entries, prunes anything older than the longest configured window.

Plain array scan — for browser micropayments the array will rarely exceed a few hundred entries. No need for fancy data structures.

**The BFG (hidden hard ceiling):**
```typescript
const BFG_DAILY_CEILING_SATOSHIS = 10_000_000_000  // 100 BSV (~$1,500)
const BFG_PER_TX_CEILING_SATOSHIS = 1_000_000_000  // 10 BSV (~$150)
```
Compiled-in constants. Checked unconditionally. Not configurable.

### Circuit breaker

When any limit is exceeded:
1. `check()` returns `{ action: 'block' }`.
2. `x402Fetch` calls `limiter.trip()`.
3. `trip()` sets `circuitBroken = true`, persists state, calls `onLimitReached`.
4. All subsequent `check()` calls → block.
5. `reset()` requires 2FA (see below), then clears the flag.

### Auto back-off (yellow light)

When spending is within limits but above `yellowLightThreshold` (default 80%):
- `check()` returns `{ action: 'yellow-light', detail }`.
- `x402Fetch` calls `onYellowLight(detail)`. If it returns `true`, proceed. If `false` or absent, return the raw 402 to the caller.
- Default `onYellowLight`: `window.confirm("You've spent 82% of your daily limit...")`.

### Concurrency

Multiple in-flight `x402Fetch` calls could race past limits. The factory closure holds a simple promise-chain mutex so only one payment-construction flow runs at a time. Acceptable for browser use.

## 2FA

### `TwoFactorProvider` interface (`src/types.ts`)

```typescript
interface TwoFactorProvider {
  verify(action: TwoFactorAction): Promise<boolean>
}

type TwoFactorAction =
  | { type: 'circuit-breaker-reset' }
  | { type: 'tier-change'; from: TierName; to: TierName }
  | { type: 'high-value-tx'; amount: number; origin: string }
  | { type: 'new-site-approval'; origin: string }
```

### Default: wallet-based 2FA (`src/two-factor.ts`)

Uses BRC-100 `createSignature()` as the second factor — sign a challenge string to prove wallet control. This is natural because:
- The wallet is already the trust root (it holds the keys).
- Signing a nonce proves the user is present and controls the wallet (not just a script with localStorage access).
- A malicious page script can't forge a wallet signature.

```typescript
class WalletTwoFactorProvider implements TwoFactorProvider {
  async verify(action: TwoFactorAction): Promise<boolean> {
    const challenge = `x402-2fa:${action.type}:${Date.now()}`
    // Ask user to approve via wallet signing prompt
    const sig = await window.CWI.createSignature({ data: challenge, ... })
    return !!sig
  }
}
```

The wallet's own approval UI (e.g. BSV Browser popup) becomes the 2FA prompt. No TOTP codes, no SMS — the wallet *is* the authenticator.

Fallback when no wallet available: `window.prompt("Type CONFIRM to proceed")` — weaker but functional.

### Where 2FA gates apply

Controlled by `TwoFactorPolicy` in `SpendLimits`. Defaults by tier:

| Action | Too Young | Not Too Rough | Hurt Me Plenty | Ultra-Violence | Nightmare |
|---|---|---|---|---|---|
| Circuit breaker reset | yes | yes | yes | yes | n/a |
| Tier change (upgrade) | yes | yes | yes | yes | yes |
| High-value tx | no | yes (>50k) | yes (>100k) | no | no |
| New site approval | no | yes | yes | yes | no |

## Per-Site Policies (`src/site-policy.ts`)

On first 402 from an unknown origin (when `requirePerSitePrompt` is true):

```
First payment to api.example.com →
  "This site wants to charge you. Use global limits, or set custom limits?"
  [Use Global] [Customise] [Block This Site]
```

If 2FA is enabled for new site approval, the wallet signing prompt fires before the policy is saved. Policies persist in storage alongside `LimitState`.

## Storage & Tamper Proofing (`src/storage.ts`)

### `StorageAdapter` interface

```typescript
interface StorageAdapter {
  load(): Promise<LimitState | null>
  save(state: LimitState): Promise<void>
  loadSitePolicies(): Promise<Record<string, SitePolicy>>
  saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void>
}
```

### `LocalStorageAdapter` (default)

- Keys: `x402:limit-state`, `x402:site-policies`
- HMAC-SHA256 over serialised state using wallet-derived key.
- On `load()`: recompute HMAC, if mismatch → treat as tampered (reconstruct from chain or reset to empty + trip circuit breaker).
- When no wallet available: skip HMAC, log warning.

### On-chain anchoring (stub)

- `anchorToChain(entries)` — OP_RETURN tx containing hash of recent ledger entries.
- `reconstructFromChain(anchorTxid)` — recover state from chain.
- Both initially throw "not implemented" (same as `constructProof`). Depends on BRC-100 wallet integration.
- Called periodically (every N transactions or on limit changes), not on every payment.

## Module Structure

```
src/
  types.ts        — all interfaces (existing + new)
  limits.ts       — RateLimiter class, tier presets, BFG constants
  storage.ts      — StorageAdapter interface, LocalStorageAdapter, HMAC
  site-policy.ts  — per-site prompt flow, policy resolution
  two-factor.ts   — TwoFactorProvider interface, WalletTwoFactorProvider
  x402-fetch.ts   — createX402Fetch factory, updated x402Fetch
  challenge.ts    — unchanged
  index.ts        — re-exports
```

## Exports from `index.ts`

```typescript
export { createX402Fetch, x402Fetch } from "./x402-fetch"
export { parseChallenge } from "./challenge"
export { TIER_PRESETS, RateLimiter } from "./limits"
export type { StorageAdapter } from "./storage"
export { LocalStorageAdapter } from "./storage"
export type {
  Challenge, Proof,
  SpendLimits, WindowLimit, TimeWindow,
  SitePolicy, TwoFactorProvider, TwoFactorAction,
  X402Config, TierName, LedgerEntry, LimitState,
  YellowLightEvent, LimitCheckResult,
} from "./types"
```

## Implementation Sequence

1. **Types** (`src/types.ts`) — add all new interfaces
2. **Rate limiter** (`src/limits.ts`) — tier presets, RateLimiter class, sliding window, circuit breaker, yellow light, BFG + tests
3. **Storage** (`src/storage.ts`) — StorageAdapter, LocalStorageAdapter, HMAC + tests
4. **2FA** (`src/two-factor.ts`) — TwoFactorProvider, WalletTwoFactorProvider + tests
5. **Site policy** (`src/site-policy.ts`) — policy resolution, prompt flow + tests
6. **Wire together** (`src/x402-fetch.ts`) — createX402Fetch factory, integrate all layers, mutex + tests
7. **Exports** (`src/index.ts`) — update re-exports
8. **Build verification** — `npm run build && npm run typecheck`

## Test Strategy

All tests colocated in `src/`. Vitest with built-in mocking.

| Test file | Covers |
|---|---|
| `limits.test.ts` | Sliding window maths, pruning, circuit breaker trip/reset, yellow light thresholds, BFG ceiling, per-tx max, tier preset validation. Injectable `now()` for clock control. |
| `storage.test.ts` | HMAC compute/verify, tamper detection, LocalStorageAdapter with mock localStorage. |
| `two-factor.test.ts` | Provider interface, verify calls, fallback behaviour. |
| `site-policy.test.ts` | First-visit prompting (mock prompt fn), policy caching, block action. |
| `x402-fetch.test.ts` | Integration: mock fetch returning 402, payments within/exceeding limits, circuit breaker, yellow light callback, Nightmare confirmation, 2FA gating, concurrent request mutex. |
| `challenge.test.ts` | Basic parseChallenge coverage. |

## Verification

```bash
npm run typecheck   # all new types compile cleanly
npm test            # all test files pass
npm run build       # tsup produces ESM + CJS + .d.ts without errors
```
