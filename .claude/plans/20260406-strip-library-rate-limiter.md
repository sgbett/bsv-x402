# Plan: Strip library rate limiter (#87)

## Overview

Remove spending controls from the library's `x402Fetch`. The library becomes a thin fetch wrapper + proof constructor. Spending controls remain in the extension's CWI proxy, configured via popup.

## Tasks

### Task 1: Simplify `X402Config` and `X402FetchFn` types

**File:** `src/types.ts`

Strip spending-control fields from `X402Config`:
```ts
// Before (14 fields)
export interface X402Config {
  tier?: TierName
  mode?: SpendMode
  limits?: Partial<SpendLimits>
  storage?: StorageAdapter
  twoFactorProvider?: TwoFactorProvider
  proofConstructor?: ...
  brc105ProofConstructor?: ...
  brc105Wallet?: ...
  nightmareConfirmation?: string
  onLimitReached?: ...
  onYellowLight?: ...
  onProofError?: ...
  now?: () => number
}

// After (4 fields)
export interface X402Config {
  proofConstructor?: (challenge: Challenge) => Promise<Proof>
  brc105ProofConstructor?: Brc105ProofConstructor
  brc105Wallet?: Brc105Wallet
  onProofError?: (error: unknown, protocol: PaymentProtocol) => void
}
```

Strip `resetLimits()` and `getState()` from `X402FetchFn`:
```ts
// Before
export interface X402FetchFn {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  resetLimits(): Promise<void>
  getState(): { entries: unknown[]; circuitBroken: boolean }
}

// After — just a fetch function
export type X402FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
```

Keep all other type exports (`TierName`, `SpendLimits`, `RateLimiter`, etc.) — the extension imports them.

### Task 2: Simplify `createX402Fetch` and `handlePaymentFlow`

**File:** `src/x402-fetch.ts`

Remove from `createX402Fetch`:
- Tier/limits/mode resolution
- Storage adapter
- 2FA provider
- Nightmare confirmation check
- Yellow-light callback
- `onLimitReached` callback
- `ensureInitialised` / `persist` / limiter state
- `resetLimits()` and `getState()` attached methods

Simplify `handlePaymentFlow` to:
```ts
async function handlePaymentFlow<P>(
  originalResponse: Response,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  buildProof: () => Promise<P>,
  retryWithProof: (proof: P) => Promise<Response>,
): Promise<Response> {
  let proof: P
  try {
    proof = await buildProof()
  } catch (err) {
    console.error('[x402] Proof construction failed:', err)
    config.onProofError?.(err, protocol)
    return originalResponse
  }
  return retryWithProof(proof)
}
```

Remove: mutex, site policy resolution, rate limit check, 2FA check, yellow-light check, ledger recording, retry backoff loop.

Remove imports: `RateLimiter`, `resolveSpendLimits`, `resolveSitePolicy`, `LocalStorageAdapter`.

### Task 3: Remove `defaultConstructProof` CWI dependency or simplify

**File:** `src/x402-fetch.ts`

`defaultConstructProof` calls `window.CWI.createAction` directly for the custom X402 protocol. This still works without rate limiting — the CWI proxy gates it. Keep it as-is.

### Task 4: Update tests

**File:** `src/x402-fetch.test.ts`

- Remove all tests for rate limiting, circuit breaker, yellow-light, site policy, 2FA gating
- Remove `mockStorage()` helper
- Remove tier/limits config from test `createX402Fetch` calls
- Keep: protocol detection, proof construction, retry, BRC-105 flow, error handling tests
- Update `X402FetchFn` usage (no more `resetLimits()` / `getState()`)

### Task 5: Remove dead imports and unused files

**Files:** `src/index.ts`, `src/site-policy.ts`, `src/storage.ts`

- `src/site-policy.ts` — `resolveSitePolicy` is only used by `handlePaymentFlow`. After removal, check if anything else imports it. If not, the file can be deleted.
- `src/storage.ts` — `LocalStorageAdapter` is only used as the default storage in `createX402Fetch`. After removal, check if the extension imports it. If not, can be deleted.
- `src/index.ts` — update re-exports to remove anything that's gone.
- Keep: `src/limits.ts` (RateLimiter, resolveSpendLimits) — extension imports these.

### Task 6: Update x402-doom client

**File:** `/opt/js/x402-doom/client/x402-config.ts`

Strip spending-control config:
```ts
// Before
const x402Fetch = createX402Fetch({
  tier: 'Hurt Me Plenty',
  mode: 'programmatic',
  limits: { perTxMaxSatoshis: 2_000_000, ... },
  brc105Wallet: walletStatus.cwi as unknown as Brc105Wallet,
})

// After
const x402Fetch = createX402Fetch({
  brc105Wallet: walletStatus.cwi as unknown as Brc105Wallet,
})
```

## Order

Tasks 1-2 are the core change (sequential — types first, then implementation).
Task 3 is a review (no change likely needed).
Task 4 follows 1-2 (tests reflect new API).
Task 5 follows 4 (clean up after tests confirm nothing's broken).
Task 6 is independent (x402-doom, separate repo).

## Not in scope

- Yellow-light approval UI (separate HLR)
- Enhancing CWI proxy spending checks (already working)
- Removing `RateLimiter` / tier types from library exports (still used by extension)
