# bsv-x402 Design Notes

For server-side design (Rack middleware, protocol layer, nonce management), see [x402-rack](https://github.com/sgbett/x402-rack/blob/master/DESIGN.md).

## Role in the x402 Flow

The x402 protocol splits cleanly between server and client:

- **Server** ([x402-rack](https://github.com/sgbett/x402-rack)) — issues 402 challenges, verifies proofs, gates access, broadcasts payment transactions
- **Client** (this library + extension) — intercepts 402 responses, constructs payments, retries with proof, broadcasts on acceptance

This library is the client half. It runs in the browser and depends on a BRC-100 compliant wallet for key management and transaction signing.

## Architecture

The library wraps `fetch()` and handles the payment flow transparently:

1. App calls `x402Fetch(url)` — a drop-in `fetch()` replacement
2. On 402 response → detect protocol from headers (X402-Challenge, BRC-105, or BRC-121)
3. Call `wallet.createAction({ noSend: true })` to build the payment transaction
4. Send proof to server (BEEF in payment headers)
5. On server 200 → call `broadcast()` to transition `nosend` → `unproven` (via `sendWith`)
6. On server 4xx → call `abort()` to release locked UTXOs
7. On network error → neither broadcast nor abort (state unknown)

### The adversarial payment model

Transactions are created with `noSend: true` — the wallet signs the tx but does not broadcast. The signed BEEF is sent to the server as proof. The server validates and broadcasts. Only when the server confirms acceptance (HTTP 200) does the client broadcast via `sendWith`, transitioning the wallet's local state from `nosend` to `unproven`.

This model ensures:
- Client doesn't pay for rejected service (abort on 4xx)
- Server gets valid BEEF before committing to serve content
- Both sides broadcast the same tx (ARC deduplicates by txid)
- Change outputs are unblocked in the wallet after successful payment

See [BEEF-SIGNALLING.md](BEEF-SIGNALLING.md) for the full analysis of how BEEF type communicates broadcast intent, and [ECONOMICS.md](ECONOMICS.md) for the economic rationale.

## Supported Protocols

### Custom X402
- Headers: `X402-Challenge` / `X402-Proof`
- Direct P2PKH to payee address
- Simplest protocol — no key derivation
- Wallet broadcasts immediately (`noSend: false`)

### BRC-105 (HTTP Service Monetisation)
- Headers: `x-bsv-payment-*`
- BRC-29 key derivation with derivation prefix/suffix
- Mutual authentication via identity keys
- Adversarial flow: `noSend: true` with broadcast on 200

### BRC-121 (Simple 402)
- Headers: `x-bsv-sats`, `x-bsv-server`
- Simpler than BRC-105, similar key derivation
- Same adversarial flow as BRC-105

## BRC-100 and `window.CWI`

[BRC-100](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md) is a BSV Association standard defining a vendor-neutral wallet-to-application interface. Compliant wallets (e.g. [BSV Browser](https://github.com/bsv-blockchain/bsv-browser)) inject a `window.CWI` object into web pages — analogous to `window.ethereum` in the Ethereum ecosystem.

CWI exposes 28 methods including `createAction()` (construct transactions), `signAction()` (sign them), `listOutputs()` (find available UTXOs), and cryptographic operations.

## Key Modules

### Library (`src/`)
- `x402-fetch.ts` — `x402Fetch()` / `createX402Fetch()` drop-in fetch replacement
- `challenge.ts` — parses custom `X402-Challenge` header
- `brc105-challenge.ts` — parses BRC-105 `x-bsv-payment-*` headers
- `brc105-proof.ts` — BRC-105 proof construction with `broadcast` and `abort` callbacks
- `brc121-challenge.ts` — parses BRC-121 headers
- `brc121-proof.ts` — BRC-121 proof construction
- `types.ts` — all types including `Brc105Wallet`, `CWICreateActionParams`

### Browser Extension (`plugins/`)
- `plugins/shared/` — shared code (~90%): CWI proxy, page/content scripts, background worker, wallet controller, UTXO admin, verify tools
- `plugins/chromium/` — Chrome/Edge/Brave manifest
- `plugins/firefox/` — Firefox manifest
- `plugins/safari/` — Safari manifest + Xcode wrapper

The extension is a **BRC-100 wallet with native x402 support** — it provides `window.CWI` (all 28 wallet methods), built-in wallet via `@bsv/wallet-toolbox-client`, and autospend controls with Doom II difficulty tiers.

## Server Counterpart

[x402-rack](https://github.com/sgbett/x402-rack) — Ruby/Rack middleware providing PayGateway, BRC105Gateway, and PaymentObserver.
