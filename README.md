# bsv-x402

A JavaScript client library for the [x402 payment protocol](https://x402.merkleworks.io/). Wraps `fetch()` to handle HTTP 402 payment flows transparently.

## How It Works

```js
import { x402Fetch } from 'bsv-x402'

const response = await x402Fetch('https://api.example.com/paid-endpoint')
```

When the server responds with `402 Payment Required`, the library:

1. Parses the `X402-Challenge` header
2. Constructs a payment transaction via the browser wallet ([BRC-100](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md) / `window.CWI`)
3. Broadcasts the transaction to the BSV network
4. Retries the original request with an `X402-Proof` header

The app developer just uses `x402Fetch` in place of `fetch`. The browser wallet handles key management and signing.

## Installation

```bash
npm install bsv-x402
```

## Development

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript → dist/
npm test          # Run tests
npm run typecheck # Type-check without emitting
```

## Status

Early development. The fetch wrapper and challenge parsing are in place; the BRC-100 wallet integration (`constructProof`) is not yet implemented.
