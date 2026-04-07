# Changelog

## [0.6.0] - 2026-04-07

### Changed

- **BREAKING: Autospend redesign** — replaced rate-limiter-based spending controls with a Doom-themed autospend model: tier sets max balance, weapon sets per-tx max, balance decreases with payments and is restored via Medkit/Stimpak/Soul Sphere/New Game pickups (#91)
- **Library API**: removed `RateLimiter`, `resolveSpendLimits`, tier presets, `SpendLimits`, `WindowLimit`, `TwoFactorProvider`, `LedgerEntry`, `StorageAdapter`, `LocalStorageAdapter`, `resolveSitePolicy`, `WalletTwoFactorProvider`, `BFG_DAILY_CEILING_SATOSHIS`, `BFG_PER_TX_CEILING_SATOSHIS` and related types
- **New library exports**: `TIER_CAPS`, `WEAPON_CAPS`, `PICKUP_PERCENTAGES`, `checkPayment`, `recordPayment`, `applyPickup`, `clampBalanceToTier`, `initialState`, `AutospendConfig`, `AutospendState`, `WeaponName`, `PickupName`
- **Popup UI**: difficulty selector, weapon selector, autospend health bar, pickup buttons (Medkit +10%, Stimpak +25%, Soul Sphere +100%, New Game)
- **Approval flow**: payments exceeding `min(weapon, balance)` open `approve.html` in a popup window for Y/N confirmation (60s auto-deny)
- **Spend indicator**: now shows autospend balance as a health bar (green/yellow/red) instead of spent/limit
- **Default tier/weapon**: Hurt Me Plenty / Shotgun

### Fixed

- **Approval handler sender validation** — `approvalResponse` message handler now requires sender URL to be the approve.html popup (defence in depth)
- **Approval timeout** — auto-deny after 65s if no response, or if `chrome.windows.create` fails (prevents the payment promise from hanging)
- **Input validation** — `checkPayment`/`recordPayment` reject NaN/Infinity/negative/zero amounts; `getWalletBalance` safely coerces with finite check

## [0.5.0] - 2026-04-06

### Changed

- **BREAKING: Removed library rate limiter** — `createX402Fetch` no longer accepts tier, limits, 2FA, storage, site policy, or yellow-light config. Spending controls are enforced by the extension's CWI proxy only. The library is now a thin fetch wrapper + proof constructor. (#87)
- **`X402FetchFn`** simplified to a plain fetch function type (no more `resetLimits()` or `getState()` methods)

### Fixed

- **Wallet approval gates removed** — built-in wallet backend no longer passes page origin as originator, preventing wallet-toolbox's internal approval limits from blocking mid-gameplay (#82)
- **Auto-lock reset on activity** — idle timer resets on every CWI call so the wallet only locks after 15 minutes of genuine idle (#80)
- **Popup variable references** — fixed broken `unlockForm` and `unlockPassword` references from PR #78 refactor (#79, #83)

## [0.4.1] - 2026-04-05

### Added

- **Balance polling** — popup refreshes balance every 10 seconds (#72)
- **Auto-show password field** — password input shown automatically when wallet is locked (#77)

### Fixed

- **BRC-105 auth header** — client identity key now sent as `x-bsv-auth-identity-key` HTTP header alongside the `x-bsv-payment` JSON (#71)
- **ARC fee model** — set 100 sat/kb (ARC minimum) instead of wallet-toolbox default of 1 sat/kb (#74)
- **UTXO sweep retry** — removed outpoint dedup tracking; scan imports all on-chain UTXOs on every unlock, letting the wallet handle dedup naturally (#68)
- **@bsv/sdk service worker HTTP** — patch-package fix for `defaultHttpClient()` to detect `globalThis.fetch` in service worker contexts (upstream: bsv-blockchain/ts-sdk#510)

## [0.4.0] - 2026-04-05

### Added

- **Client identity key in BRC-105 proofs** — `constructBrc105Proof` now fetches the client's identity key and includes `clientIdentityKey` in the `x-bsv-payment` JSON (#63)
- **`Brc105Wallet.getPublicKey`** accepts `{ identityKey: true }` for identity key retrieval (union type alongside derivation params) (#66)
- **TypeDoc API documentation** — `npm run docs` generates API reference (#39)

### Changed

- **BRC-105 always uses server identity key as counterparty** — removed `"anyone"` fallback; BRC-29 derivation always uses `challenge.serverIdentityKey` (#64)
- **`Brc105Proof.clientIdentityKey` is required** — custom `Brc105ProofConstructor` implementations must include this field (**breaking change**) (#65)
- **`Brc105Challenge.authenticated` flag** — indicates whether the server identity key came from BRC-103 auth or standalone `x-bsv-payment-identity-key` header (#59)

### Fixed

- **UTXO sweep for repeat deposits** — changed from per-address to per-outpoint dedup so new deposits to an already-funded identity address are imported (#57)
- **Popup balance display** — shows wallet balance from `listOutputs` (#53)
- **Wallet funding address** — identity key P2PKH address displayed correctly (#52)
- **BRC-105 compliance gaps** — derivation suffix, proof error reporting, payment identity key header fallback (#48, #45, #42)
- **Wallet Monitor startup** — UTXO imports now start the Monitor for tx processing; deduplicates imports on repeated unlock (#55)
- **Popup receive address** — displays identity address for funding (#46)

## [0.3.0] - 2026-04-04

### Added

- **BRC-105 payment protocol support** — `x402Fetch` now handles BRC-105 402 responses (`x-bsv-payment-*` headers) with BRC-29 key derivation, proof construction, and automatic retry. Runs alongside the existing custom `X402-Challenge`/`X402-Proof` protocol.
- **Protocol detection** — on a 402 response, `x402Fetch` auto-detects the protocol from response headers. Custom (`X402-Challenge`) takes priority when both are present.
- **`Brc105Wallet` interface** — minimal 3-method abstraction (`getPublicKey`, `createHmac`, `createAction`) that works with both `CWIInterface` (page context) and SDK `WalletInterface` (extension context)
- **`parseBrc105Challenge()`** — parses and validates BRC-105 402 headers including compressed public key format validation on `serverIdentityKey`
- **`constructBrc105Proof()`** — BRC-29 key derivation with inline RIPEMD-160 implementation (no `@bsv/sdk` dependency in core library), P2PKH locking script construction, base64 BEEF encoding
- **`PaymentRequest` interface** — protocol-agnostic payment abstraction for spending controls
- **Browser extension icons** — 16/48/128px icons for Chromium, Firefox, and Safari
- **Inline unlock form** — replaces `prompt()` with masked password input in extension popup, with Enter key support and inline error display

### Changed

- **`RateLimiter.check()`** — now accepts `Challenge | PaymentRequest` (backwards compatible), enabling protocol-agnostic spending control
- **`LedgerEntry`** — gains optional `protocol` field for audit trail (backwards compatible with persisted state)
- **`handlePaymentFlow` helper** — shared payment flow for both protocols, deduplicating site policy, rate limiting, 2FA, yellow-light, and proof construction logic
- **`X402Config`** — gains `brc105ProofConstructor` and `brc105Wallet` options
- **CWI proxy** — uses `PaymentRequest` instead of synthetic `Challenge` objects
- **Extension sender check** — allows messages from extension pages opened as tabs (fixes wallet setup page)

### Fixed

- Extension messaging hardened against context invalidation — content script catches `chrome.runtime.sendMessage` throws on service worker restart, stops polling, and unmounts indicator
- `hexToBytes` guards against odd-length hex input (prevents silent truncation of transaction data)
- Popup `sendMessage` rejects error responses instead of treating them as valid state (fixes silent "Set Up Wallet" corruption on bad password)
- Settings link removed (no options page existed; was a no-op click handler)

### Security

- Compressed public key format validation on `serverIdentityKey` — rejects values not matching 33-byte hex (`/^0[23][0-9a-fA-F]{64}$/`)
- Real txid from wallet `createAction` result threaded into BRC-105 ledger entries (auditable, unique)
- `handlePaymentFlow` protocol parameter prevents BRC-105 payments being misrecorded as "x402" in rate limiter checks
- RIPEMD-160 implementation verified against standard test vectors (empty, "abc", "message digest")

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
