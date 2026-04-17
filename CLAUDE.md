# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript → dist/ (uses tsup, outputs ESM + CJS + .d.ts)
npm test           # Run tests (vitest)
npm run typecheck  # Type-check without emitting
npm run docs       # Generate API docs (TypeDoc → docs/)
```

No vitest config file exists — vitest uses defaults. Test files should be colocated in `src/` (e.g. `src/challenge.test.ts`) and `plugins/shared/` (e.g. `plugins/shared/cwi-conformance.test.ts`).

```bash
npm run build:plugins   # Build all 3 browser extensions → dist/plugins/
npm run build:chromium  # Build Chromium only
npm run build:firefox   # Build Firefox only
npm run build:safari    # Build Safari only
npm run build:all       # Build library + all plugins
```

## Specifications

This project implements published protocol specifications (BRC-105, BRC-29, BRC-100, etc.). When writing or modifying code that implements a spec, consult the spec directly (via `bsv-protocol-docs` MCP) and verify conformance — including optional features unless there is a documented reason to omit them. Tests should be anchored to spec requirements, not just implementation behaviour.

The `AuthFetch` reference implementation in `@bsv/sdk` (`node_modules/@bsv/sdk/src/auth/clients/AuthFetch.ts`) is the canonical BRC-105 client — our implementation should match its behaviour.

## Architecture

This is a browser-side client library for BSV micropayments over HTTP 402. It wraps `fetch()` to transparently handle payment flows using multiple protocols.

**Multi-protocol flow:** `x402Fetch(url)` → server returns 402 → library detects protocol from response headers → constructs payment → retries request with payment proof.

Supported protocols:
- **Custom (X402):** `X402-Challenge` / `X402-Proof` headers. Direct P2PKH to payee address. Wallet broadcasts immediately (`noSend: false`).
- **BRC-105:** `x-bsv-payment-*` headers. BRC-29 key derivation with derivation prefix/suffix, identity keys, AtomicBEEF base64 encoding. Adversarial flow: `noSend: true`, broadcast on 200, abort on 4xx.
- **BRC-121:** `x-bsv-sats` / `x-bsv-server` headers. Simpler than BRC-105, similar key derivation. Same adversarial flow.

Protocol detection is automatic — custom (`X402-Challenge`) takes priority, then BRC-105, then BRC-121.

**Key modules:**
- `src/x402-fetch.ts` — `x402Fetch()` / `createX402Fetch()` drop-in fetch replacement. Handles broadcast-on-200 and abort-on-4xx for BRC-105/BRC-121 flows.
- `src/challenge.ts` — parses custom `X402-Challenge` header
- `src/brc105-challenge.ts` — parses BRC-105 `x-bsv-payment-*` headers
- `src/brc105-proof.ts` — BRC-105 proof construction: BRC-29 derivation, RIPEMD-160, P2PKH, base64 encoding. Returns `{ proof, abort, broadcast }`.
- `src/brc121-challenge.ts` — parses BRC-121 `x-bsv-sats` / `x-bsv-server` headers
- `src/brc121-proof.ts` — BRC-121 proof construction. Same `{ proof, abort, broadcast }` pattern.
- `src/types.ts` — all types including `Brc105Wallet` (wallet interface with `createAction`, `getPublicKey`, `createHmac`, `abortAction`)

**Browser extension plugins** (`plugins/`):
- `plugins/shared/` — shared code (~90%): CWI proxy (spending controls), page/content scripts, background worker, wallet controller, UI
- `plugins/chromium/` — Chrome/Edge/Brave manifest + platform adapter
- `plugins/firefox/` — Firefox manifest + platform adapter
- `plugins/safari/` — Safari manifest + platform adapter + Xcode wrapper instructions

The extension is a **BRC-100 wallet with native x402 support** — it provides `window.CWI` (all 28 wallet methods), built-in wallet via `@bsv/wallet-toolbox-client`, and x402 spending controls (tiers, rate limits, spend indicator).

**Server counterpart:** [x402-rack](https://github.com/sgbett/x402-rack) (Ruby/Rack middleware — PayGateway, BRC105Gateway, PaymentObserver).

## Key Concepts

- **BRC-100 / `window.CWI`** — vendor-neutral wallet interface standard (like `window.ethereum` for BSV). Injected by compliant wallets (e.g. BSV Browser) or our extension. Provides `createAction()`, `signAction()`, `listOutputs()`, and crypto operations.
- **BRC-105** — HTTP Service Monetisation Framework. Server sends 402 with `x-bsv-payment-version`, `x-bsv-payment-satoshis-required`, `x-bsv-payment-derivation-prefix`. Client responds with `x-bsv-payment` JSON containing `derivationPrefix`, `derivationSuffix`, `transaction` (base64).
- **BRC-29** — key derivation for payments. ProtocolID `[2, '3241645161d8']`, keyID `"${prefix} ${suffix}"`, counterparty is the server's identity key. Used by BRC-105 proof construction.
- **Custom X402 headers** — `X402-Challenge` (server→client, JSON with nonce/payee/amount/network) and `X402-Proof` (client→server, txid + rawTx). Simpler than BRC-105, no key derivation.
- **Spending controls** — autospend with Doom II difficulty tiers, per-tx weapon caps, health-bar balance model. Protocol-agnostic via `PaymentRequest` interface.
- **Broadcast-on-200** — BRC-105/BRC-121 proofs return `broadcast` and `abort` callbacks. On server 200, `broadcast()` calls `createAction({ sendWith: [txid] })` to transition `nosend` → `unproven`. On 4xx, `abort()` frees locked UTXOs. See [ECONOMICS.md](ECONOMICS.md) and [BEEF-SIGNALLING.md](BEEF-SIGNALLING.md).

## BSV Browser CWI Conformance (IMPORTANT)

Our CWI implementation **must stay in sync** with the BSV Browser reference implementation:

- **Upstream repo:** [bsv-blockchain/bsv-browser](https://github.com/bsv-blockchain/bsv-browser) (also forked to [sgbett/bsv-browser](https://github.com/sgbett/bsv-browser))
- **Canonical spec:** [bsv-blockchain/ts-sdk](https://github.com/bsv-blockchain/ts-sdk) `src/wallet/Wallet.interfaces.ts`
- **Our conformance tests:** `plugins/shared/cwi-conformance.test.ts`

### Sync rules

1. **All 28 BRC-100 wallet methods** must be present in our CWI interface. The `BSV_BROWSER_METHODS` array in the conformance test is the authoritative list.
2. **When modifying any CWI-related code**, always run the conformance tests (`npm test`) and verify all conformance tests pass.
3. **When BSV Browser adds new methods upstream**, add them to:
   - `plugins/shared/messages.ts` (`CWIMethodName` union)
   - `plugins/shared/page-script.ts` (the `cwi` object)
   - `plugins/shared/cwi.ts` (handler + dispatch table)
   - `src/types.ts` (`CWIInterface`)
   - `plugins/shared/cwi-conformance.test.ts` (new tests)
4. **Message format must match BSV Browser's protocol:**
   - Request: `{ call: method, args: params, id: requestId }` (BSV Browser uses `call`/`args`; our extension uses `method`/`params` internally but the page-facing interface is equivalent)
   - Response: `{ type: 'CWI', id, isInvocation: false, result, status: 'ok' | 'error' }`
5. **Response shapes must match** — each method's return object must have the same fields as BSV Browser returns.
6. **The `CWIInterface` type in `src/types.ts`** is the TypeScript contract. It should mirror the upstream `WalletInterface` from `ts-sdk`.

### Key reference files in BSV Browser
- `app/browser.tsx` — `handleMessage` function, wallet method dispatch
- `components/SpendingAuthorizationModal.tsx` — payment approval UI (tiered "Allow Up To" grants)
- `context/WalletContext.tsx` — wallet state management

## Status

Active development (v0.9.1). Library core: multi-protocol 402 handling (Custom X402, BRC-105, BRC-121), adversarial `noSend` payment flow with broadcast-on-200/abort-on-4xx, BEEF acknowledgement mechanism. Browser extensions: full BRC-100 wallet via `@bsv/wallet-toolbox-client`, CWI injection, autospend controls, UTXO admin/recovery tools.
