# bsv-x402

A JavaScript client library and browser extension for BSV micropayments over HTTP 402. Wraps `fetch()` to transparently handle payment flows using multiple protocols (Custom X402, BRC-105, BRC-121).

## How It Works

```js
import { createX402Fetch } from 'bsv-x402'

const x402Fetch = createX402Fetch({ brc105Wallet: window.CWI })
const response = await x402Fetch('https://api.example.com/paid-endpoint')
```

When the server responds with `402 Payment Required`, the library:

1. Detects the protocol from response headers (X402-Challenge, BRC-105, or BRC-121)
2. Constructs a payment transaction via the browser wallet ([BRC-100](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md) / `window.CWI`)
3. Sends the proof to the server and retries the request
4. On server 200: broadcasts the transaction (transitioning `nosend` → `unproven`)
5. On server 4xx: aborts the transaction (freeing locked UTXOs)

The app developer just uses `x402Fetch` in place of `fetch`. The browser wallet handles key management and signing.

## Browser Extension

The repository also includes browser extensions (Chromium, Firefox, Safari) that provide a full BRC-100 wallet with native x402 support:

- `window.CWI` injection (all 28 BRC-100 wallet methods)
- Built-in wallet via `@bsv/wallet-toolbox-client`
- Autospend controls with Doom II difficulty tiers
- UTXO Admin view for wallet diagnostics

## Installation

```bash
npm install bsv-x402
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm test             # Run tests (vitest)
npm run typecheck    # Type-check without emitting
npm run build:all    # Build library + all browser extensions
```

## Documentation

- [DESIGN.md](DESIGN.md) — architecture and protocol details
- [ECONOMICS.md](ECONOMICS.md) — economics of ARC broadcasting for micropayments
- [BEEF-SIGNALLING.md](BEEF-SIGNALLING.md) — how BEEF type communicates broadcast intent
- [CHANGELOG.md](CHANGELOG.md) — version history

## Status

Active development (v0.9.1). Library core: multi-protocol 402 handling (Custom X402, BRC-105, BRC-121), adversarial `noSend` payment flow with broadcast-on-200, BEEF acknowledgement mechanism. Browser extensions: full BRC-100 wallet, autospend controls, UTXO recovery tools.

Server counterpart: [x402-rack](https://github.com/sgbett/x402-rack) (Ruby/Rack middleware).
