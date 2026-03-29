# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript → dist/ (uses tsup, outputs ESM + CJS + .d.ts)
npm test           # Run tests (vitest)
npm run typecheck  # Type-check without emitting
```

No vitest config file exists — vitest uses defaults. Test files should be colocated in `src/` (e.g. `src/challenge.test.ts`) and `plugins/shared/` (e.g. `plugins/shared/cwi-conformance.test.ts`).

```bash
npm run build:plugins   # Build all 3 browser extensions → dist/plugins/
npm run build:chromium  # Build Chromium only
npm run build:firefox   # Build Firefox only
npm run build:safari    # Build Safari only
npm run build:all       # Build library + all plugins
```

## Architecture

This is a browser-side client library for the [x402 payment protocol](https://x402.merkleworks.io/). It wraps `fetch()` to transparently handle HTTP 402 payment flows using BSV (Bitcoin SV) micropayments.

**Flow:** `x402Fetch(url)` → server returns 402 with `X402-Challenge` header → library parses challenge → constructs payment via BRC-100 wallet (`window.CWI`) → retries request with `X402-Proof` header.

**Key modules:**
- `src/x402-fetch.ts` — the `x402Fetch()` drop-in fetch replacement; `defaultConstructProof()` calls `window.CWI.createAction()`
- `src/challenge.ts` — parses `X402-Challenge` JSON header into a `Challenge` object
- `src/types.ts` — `Challenge`, `Proof`, and full `CWIInterface` (28 BRC-100 methods)

**Browser extension plugins** (`plugins/`):
- `plugins/shared/` — shared code (~90%): CWI dispatch, page/content scripts, background worker, key management, tx builder, UI
- `plugins/chromium/` — Chrome/Edge/Brave manifest + platform adapter
- `plugins/firefox/` — Firefox manifest + platform adapter
- `plugins/safari/` — Safari manifest + platform adapter + Xcode wrapper instructions

**Server counterpart:** [x402-rack](https://github.com/sgbett/x402-rack) (Ruby/Rack middleware that issues challenges and verifies proofs).

## Key Concepts

- **BRC-100 / `window.CWI`** — vendor-neutral wallet interface standard (like `window.ethereum` for BSV). Injected by compliant wallets (e.g. BSV Browser). Provides `createAction()`, `signAction()`, `listOutputs()`, and crypto operations.
- **X402 headers** — `X402-Challenge` (server→client, JSON with nonce/payee/amount/network) and `X402-Proof` (client→server, txid + rawTx).

## BSV Browser CWI Conformance (IMPORTANT)

Our CWI implementation **must stay in sync** with the BSV Browser reference implementation:

- **Upstream repo:** [bsv-blockchain/bsv-browser](https://github.com/bsv-blockchain/bsv-browser) (also forked to [sgbett/bsv-browser](https://github.com/sgbett/bsv-browser))
- **Canonical spec:** [bsv-blockchain/ts-sdk](https://github.com/bsv-blockchain/ts-sdk) `src/wallet/Wallet.interfaces.ts`
- **Our conformance tests:** `plugins/shared/cwi-conformance.test.ts`

### Sync rules

1. **All 28 BRC-100 wallet methods** must be present in our CWI interface. The `BSV_BROWSER_METHODS` array in the conformance test is the authoritative list.
2. **When modifying any CWI-related code**, always run the conformance tests (`npm test`) and verify all 82 conformance tests pass.
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

Active development. Library core is functional (challenge parsing, rate limiting, spend tiers). Browser extension plugins are scaffolded with all 28 BRC-100 methods stubbed. Transaction construction and cryptographic operations require `@bsv/sdk` integration.
