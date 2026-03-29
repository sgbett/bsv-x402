# Copilot Code Review Instructions

## Project Context

bsv-x402 is a browser-side TypeScript client library for the x402 payment protocol. It wraps `fetch()` to transparently handle HTTP 402 micropayment flows using BSV (Bitcoin SV). The library automatically pays servers that return 402 responses — this makes wallet drain attacks the primary threat model.

Key architecture:
- `createX402Fetch(config)` factory returns a drop-in fetch replacement with spending limits
- Tiered rate limiting (sliding window), circuit breaker, yellow light warnings, per-site policies
- Wallet-based 2FA via BRC-100 `window.CWI.createSignature()`
- HMAC-protected localStorage persistence
- `constructProof` is the payment construction path (currently stubbed, will use BRC-100 wallet)

## Threat Model

The **server is the attacker**. A malicious or compromised server can:
- Spam 402 responses to drain the wallet
- Supply crafted `X402-Challenge` headers with malicious values
- Manipulate challenge amounts, nonces, or payee addresses
- Issue rapid-fire challenges to exhaust rate limits

The **browser environment is partially trusted**. Same-origin scripts can access localStorage and DOM, but the BRC-100 wallet (`window.CWI`) is the trust root — its signing prompts cannot be forged by page scripts.

## Review Focus Areas

### Financial Logic (Critical)
- **Amount handling**: All `challenge.amount` values come from untrusted servers. Verify they are validated as positive finite integers before use in arithmetic or ledger recording.
- **Limit bypass paths**: Check that spending limits cannot be circumvented via negative amounts, NaN, Infinity, type coercion, or overflow.
- **Ledger corruption**: Verify that malformed entries cannot be recorded that would corrupt future sliding window calculations (e.g., negative satoshis making window sums go negative).
- **Circuit breaker integrity**: Verify the breaker trips on the correct conditions (BFG daily ceiling only) and that `resetLimits()` requires 2FA when the tier policy demands it.

### 2FA Gate Integrity (High)
- **Silent bypass**: If a tier's policy requires 2FA (e.g., `onHighValueTx: true`) but no `twoFactorProvider` is configured, the action must be **blocked**, not silently allowed.
- **Override paths**: The `limit-override` 2FA flow allows one-shot exceptions to window limits. Verify it only fires for `severity: "window"` blocks, never for per-tx or BFG blocks.
- **Provider trust**: The `TwoFactorProvider.verify()` return value controls payment authorisation. Ensure a `false` return always blocks the payment.

### Rate Limiter Correctness (High)
- **Sliding window maths**: Window limits use `timestamp >= now - windowMs`. Verify the comparison direction, that pruning doesn't delete entries still within a window, and that the BFG daily check always uses a full 24-hour window regardless of configured windows.
- **Block severity**: `reject` (per-tx), `window` (budget exhaustion), `trip` (BFG daily). Verify severity is assigned correctly and that only `trip` triggers the circuit breaker.
- **Entry recording**: Payments should only be recorded in the ledger after `constructProof` succeeds. If proof construction throws, no entry should be written.

### Input Validation (High)
- **`parseChallenge`**: The `X402-Challenge` header is server-supplied and untrusted. All fields must be validated: `amount` as positive finite integer, strings as non-empty, no extra fields passed through.
- **`LimitState` from storage**: Data loaded from localStorage could have been tampered with. When HMAC verification is available (keyDeriver configured), mismatches should trip the circuit breaker.
- **Origin extraction**: `extractOrigin` is used for per-site policy lookups. Verify it handles edge cases (relative URLs, invalid URLs, Request objects) without throwing.

### Storage & Persistence (Medium)
- **HMAC signing**: When `keyDeriver` is configured, verify HMAC is computed on save and verified on load. Mismatched HMAC should return empty state with breaker tripped.
- **Site policy persistence**: New site policies (including "block" decisions) should be persisted to storage so users aren't re-prompted on page reload.

### What NOT to Flag
- The demo (`demo/`) is a development tool, not production code. Don't flag demo-only concerns.
- `constructProof` throwing "Not implemented" is intentional — BRC-100 wallet integration is a separate feature.
- The HMAC being skipped when no `keyDeriver` is configured is documented intentional behaviour for environments without a wallet.
- Per-tx rejections not tripping the circuit breaker is by design — "this item is too expensive" is not an attack signal.
- Global window budgets being shared across origins is by design (documented in the plan).

## Style
- Be specific: cite file paths and line numbers.
- Lead with impact, not description.
- Provide fix recommendations, not just problem statements.
- Skip cosmetic issues, style preferences, and general best practices unless they have security implications.
