# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript → dist/ (uses tsup, outputs ESM + CJS + .d.ts)
npm test           # Run tests (vitest)
npm run typecheck  # Type-check without emitting
```

No vitest config file exists — vitest uses defaults. Test files should be colocated in `src/` (e.g. `src/challenge.test.ts`).

## Architecture

This is a browser-side client library for the [x402 payment protocol](https://x402.merkleworks.io/). It wraps `fetch()` to transparently handle HTTP 402 payment flows using BSV (Bitcoin SV) micropayments.

**Flow:** `x402Fetch(url)` → server returns 402 with `X402-Challenge` header → library parses challenge → constructs payment via BRC-100 wallet (`window.CWI`) → retries request with `X402-Proof` header.

**Key modules:**
- `src/x402-fetch.ts` — the `x402Fetch()` drop-in fetch replacement; `constructProof()` is stubbed (not yet implemented)
- `src/challenge.ts` — parses `X402-Challenge` JSON header into a `Challenge` object
- `src/types.ts` — `Challenge` and `Proof` interfaces

**Server counterpart:** [x402-rack](https://github.com/sgbett/x402-rack) (Ruby/Rack middleware that issues challenges and verifies proofs).

## Key Concepts

- **BRC-100 / `window.CWI`** — vendor-neutral wallet interface standard (like `window.ethereum` for BSV). Injected by compliant wallets (e.g. BSV Browser). Provides `createAction()`, `signAction()`, `listOutputs()`, and crypto operations.
- **X402 headers** — `X402-Challenge` (server→client, JSON with nonce/payee/amount/network) and `X402-Proof` (client→server, txid + rawTx).

## Status

Early development. Challenge parsing works. The BRC-100 wallet integration (`constructProof`) is not yet implemented.
