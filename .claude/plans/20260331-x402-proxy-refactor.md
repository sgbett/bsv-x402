# Plan: Refactor Extension to x402 Spending-Limits Proxy (#21)

## Context

The browser extension currently mixes wallet operations (key management, tx building, 28 CWI method stubs) with x402 spending control. This plan refactors it into a spending-limits proxy with a pluggable BRC-100 wallet backend, shipping `@bsv/wallet-toolbox-client` as the default. Also adds a spend indicator (the "health bar") injected into pages.

## Phases

### Phase 1: Extract controllers from background.ts

Pure refactor — no behaviour change, no new features.

**Create:**
- `plugins/shared/x402-controller.ts` — Owns `currentTier`, `currentMode`, `RateLimiter`, `ExtensionStorageAdapter`. Exports `ensureLimiter()`, `checkSpendLimits()`, `recordPayment()`, `setTier()`, `getX402State()`, `getSpendStatus()`.
- `plugins/shared/wallet-controller.ts` — Owns the wallet backend instance. Handles `unlock`/`lock`/`setup`/`setNetwork`. Exposes `getBackend()`.

**Modify:**
- `plugins/shared/background.ts` — Strip to ~80 lines: message router only. Imports controllers, routes CWI → cwi handler, internal → appropriate controller. `getState` composes from both. Retains `onInstalled` + auto-lock alarm.

### Phase 2: Introduce WalletBackend interface

**Create:**
- `plugins/shared/wallet-backend.ts` — Interface definition:
  ```typescript
  interface WalletBackend {
    call(method: CWIMethodName, params: unknown, origin: string): Promise<unknown>
    isAuthenticated(): Promise<boolean>
    hasOwnUI(): boolean
  }
  ```
- `plugins/shared/builtin-wallet-backend.ts` — Wraps existing `cwi.ts` handler map + `key-manager.ts` into a class implementing `WalletBackend`. `hasOwnUI() = false`. Absorbs `CWIHandlerContext` as private state.

**Modify:**
- `plugins/shared/wallet-controller.ts` — Instantiate `BuiltInWalletBackend`, expose via `getBackend()`.

### Phase 3: Create cwi-proxy.ts

The spending-limits-before-wallet flow goes live.

**Create:**
- `plugins/shared/cwi-proxy.ts` — ~50 lines. For `createAction`: extract total satoshis from `params.outputs`, call `checkSpendLimits()`, delegate to `walletBackend.call()`, on success call `recordPayment()`. All other methods pass straight through. `allowedWhileLocked` only applies when backend is built-in.

**Modify:**
- `plugins/shared/background.ts` — Replace `import { handleCWIRequest } from './cwi'` with `import { handleCWIRequest } from './cwi-proxy'`

**Delete:**
- `plugins/shared/cwi.ts` — Logic absorbed into `builtin-wallet-backend.ts`

### Phase 4: Add ExternalWalletBackend

**Create:**
- `plugins/shared/external-wallet-backend.ts` — Implements `WalletBackend`. `call()` forwards to external BRC-100 wallet. `hasOwnUI() = true`.

**Modify:**
- `plugins/shared/wallet-controller.ts` — Add `switchBackend(type, config?)`. Persist choice in `chrome.storage.local`.
- `plugins/shared/background.ts` — Handle `switchBackend` internal message.

### Phase 5: Split UI directories

**Restructure:**
```
plugins/shared/ui/
  x402/
    popup-panel.html/ts  ← tier, policies, circuit breaker, indicator config
    approve.html/ts      ← payment approval (moved from ui/)
  wallet/
    popup-panel.html/ts  ← lock/unlock, balance (built-in backend only)
    setup.html/ts        ← wallet creation/import (moved from ui/)
  popup.html             ← shell composing both panels
  popup.ts               ← queries hasOwnUI(), hides wallet panel if true
  popup.css              ← shared styles
```

**Strict boundary:** wallet UI only imports from `wallet-backend.ts` interface, never from `x402-controller.ts`.

### Phase 6: Spend indicator

**Create:**
- `plugins/shared/spend-indicator.ts` — Shadow DOM component. Three modes (bar/badge/hidden). Renders spend progress with green → yellow → red colour transitions at `yellowLightThreshold`. Click opens extension popup.

**Modify:**
- `plugins/shared/content-script.ts` — Import and mount indicator. Poll background every 2-3s for `getSpendStatus`. Listen for `spendUpdated` push after payments.
- `plugins/shared/x402-controller.ts` — Add `getSpendStatus()` returning `{ spent, limit, window, percentage, circuitBroken }`.
- `plugins/shared/background.ts` — Handle `getSpendStatus` message. After `recordPayment` in cwi-proxy, call `chrome.tabs.sendMessage(sender.tab.id, { type: 'spendUpdated', ... })`.

## Dependency graph (after refactor)

```
background.ts (router only)
  ├→ cwi-proxy.ts
  │    ├→ wallet-backend.ts (interface)
  │    └→ x402-controller.ts → storage-bridge.ts, src/limits.ts
  ├→ wallet-controller.ts
  │    ├→ builtin-wallet-backend.ts → key-manager.ts, tx-builder.ts
  │    └→ external-wallet-backend.ts
  └→ x402-controller.ts

content-script.ts
  ├→ messages.ts
  └→ spend-indicator.ts
```

The wallet subtree (`wallet/`, `builtin-wallet-backend.ts`, `key-manager.ts`, `tx-builder.ts`) is deletable without breaking x402 code.

## Key design decisions

1. **Spending limits check only on `createAction`** — it's the only method that commits satoshis. `signAction` completes a previously-checked action.
2. **Spend indicator uses poll + push** — polls every 2-3s for window rollover, plus instant push from background after each payment via `chrome.tabs.sendMessage`.
3. **Shadow DOM for indicator** — style isolation so it doesn't break page layout and pages can't style it.
4. **Phase 1 is a pure refactor** — enables all subsequent phases without changing behaviour. Safe checkpoint.

## Files unchanged
- `plugins/shared/page-script.ts`
- `plugins/shared/messages.ts` (may add new internal message types)
- `plugins/shared/storage-bridge.ts`
- `src/*` (the library)
- Platform manifests and adapters

## Verification

- `npm test` after each phase — 152 existing tests must pass
- Phase 3: verify CWI conformance tests still pass through the proxy
- Phase 6: manual test — load extension, visit demo page, verify indicator appears and updates after payments
- `npm run build:plugins` — all 3 targets build

## Estimated scope

| Phase | Files created | Files modified | Files deleted | Complexity |
|---|---|---|---|---|
| 1 | 2 | 1 | 0 | Medium (extract, no logic change) |
| 2 | 2 | 1 | 0 | Medium (interface + wrapper) |
| 3 | 1 | 1 | 1 | Low (thin proxy) |
| 4 | 1 | 2 | 0 | Medium (external wallet transport) |
| 5 | 4+ | 2 | 2 | Medium (UI restructure) |
| 6 | 1 | 3 | 0 | Medium (DOM component + messaging) |
