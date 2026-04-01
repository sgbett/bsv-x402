# Changelog

## [0.2.0] - 2026-04-01

### Added

- **Browser extension plugins** — Chromium, Firefox, and Safari extensions that inject `window.CWI` (BRC-100 wallet interface) into web pages, enabling transparent x402 payment flows
- **Spending-limits proxy architecture** — extension acts as middleware enforcing tiered spending limits, circuit breakers, per-site policies, and 2FA gates before delegating to a wallet backend
- **Pluggable wallet backend** — `WalletBackend` interface with two implementations:
  - `BuiltInWalletBackend` — wraps `@bsv/wallet-toolbox-client` (ships as default)
  - `ExternalWalletBackend` — delegates to an external BRC-100 wallet via `chrome.runtime.sendMessage`
- **Spend indicator** — on-page bar/badge/hidden element showing x402 budget usage (Shadow DOM, configurable via popup)
- **`defaultConstructProof`** — calls `window.CWI.createAction()` with proper P2PKH locking script construction
- **`payeeAddressToLockingScript`** — Base58Check address decoder with checksum, version, and length validation
- **Test-mode auto-setup** — pre-populate `x402_test_config` in `chrome.storage.local` for Selenium e2e testing
- **CI pipeline** — GitHub Actions workflow: typecheck (library + plugins), test, build (library + all 3 browser targets), Node 20 + 22 matrix

### Changed

- **UI split** — `ui/x402/` (permanent: tier, policies, approvals) and `ui/wallet/` (removable: setup, unlock, balance) with strict separation
- **Background.ts** — refactored from monolithic to thin message router importing `x402-controller`, `wallet-controller`, and `cwi-proxy`
- **Yellow-light spends** — blocked until approval UI is implemented (was auto-allowing)

### Removed

- `cwi.ts` — 28 stub BRC-100 method handlers (replaced by wallet-toolbox delegation)
- `key-manager.ts` — custom key management (replaced by wallet-toolbox)
- `tx-builder.ts` — custom transaction building (replaced by wallet-toolbox)

### Security

- Sender validation on internal message handler — content scripts and other extensions rejected
- Satoshis validation in cwi-proxy — rejects negative, zero, NaN, Infinity, non-safe-integer, overflow
- Defence-in-depth in `RateLimiter.check()` — rejects invalid challenge amounts
- HMAC bypass fix — requires HMAC when `keyDeriver` is configured
- JSON.parse crash fix — try/catch on storage load with circuit breaker trip
- Entry sanitisation on storage load — drops malformed ledger entries
- Origin filtering in rate limiter — `entriesInWindow()` correctly filters by origin for custom site policies
- `resolveSpendLimits()` deep-clones nested objects (no cross-instance mutation)
- 2FA bypass fix — blocks new-site approval when provider unavailable
- Wallet 2FA signature bound to full action details
- `parseChallenge()` wrapped in try/catch for malformed server headers
- `extractOrigin()` resolves relative URLs against `globalThis.location`
- Test config cleaned up after auto-setup (no persisted key material)

## [0.1.1] - 2026-03-28

### Added

- Spending limits system with Doom II tiered protection
- Per-site policies, circuit breaker, 2FA gates
- `createX402Fetch()` factory with configurable tiers and overrides
