# bsv-x402 Design Notes (DRAFT)

For server-side design (Rack middleware, protocol layer, nonce management), see [x402-rack](https://github.com/sgbett/x402-rack/blob/master/DESIGN.md).

## Role in the x402 Flow

The x402 protocol splits cleanly between server and client:

- **Server** ([x402-rack](https://github.com/sgbett/x402-rack)) — issues 402 challenges, verifies proofs, gates access
- **Client** (this library) — intercepts 402 responses, constructs payments, retries with proof

This library is the client half. It runs in the browser and depends on a BRC-100 compliant wallet for key management and transaction signing.

## Architecture

The library wraps `fetch()` and handles the payment flow transparently:

1. App calls `x402Fetch(url)` — a drop-in `fetch()` replacement
2. On 402 response → parse `X402-Challenge` header
3. Call `window.CWI.createAction()` to build the payment transaction (nonce spend + payee output)
4. Broadcast to BSV network
5. Retry original request with `X402-Proof` header

The app developer just uses the wrapped fetch. The browser wallet handles key management and signing. This library is the glue.

## BRC-100 and `window.CWI`

[BRC-100](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md) is a BSV Association standard defining a vendor-neutral wallet-to-application interface. Compliant wallets (e.g. [BSV Browser](https://github.com/bsv-blockchain/bsv-browser)) inject a `window.CWI` object into web pages — analogous to `window.ethereum` in the Ethereum ecosystem.

CWI exposes 28 methods including `createAction()` (construct transactions), `signAction()` (sign them), `listOutputs()` (find available UTXOs), and cryptographic operations. This is the building block for client-side x402.

Because this uses BRC-100 (not a browser-specific API), it works with any compliant wallet — not just one particular browser.

## Fee Delegation Context

The server-side Fee Delegator exists primarily because the BSV client ecosystem is immature. If clients could construct, sign, and broadcast transactions natively, the delegator wouldn't be needed — the client would just pay.

As wallet tooling matures and BRC-100 adoption grows, the fee delegation layer on the server can be peeled away. This library is part of that maturation: it enables direct client-to-network payment, removing the need for server-side transaction construction.

## Starting Points

- **BRC-100 spec** — complete TypeScript interface definitions ([`bitcoin-sv/BRCs/wallet/0100.md`](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0100.md))
- **BRC-7** — defines the `window` object transport mechanism ([`bitcoin-sv/BRCs/wallet/0007.md`](https://github.com/bitcoin-sv/BRCs/blob/master/wallet/0007.md))
- **`@bsv/sdk`** — current TypeScript SDK with `WalletClient` class ([`bitcoin-sv/ts-sdk`](https://github.com/bitcoin-sv/ts-sdk))
- **`@merkleworks/x402-client`** — reference implementation's TypeScript client (delegates to gateway for tx construction; a CWI-aware version would do it locally via the wallet)
- **`babbage-hello-world`** — example React app using CWI ([`p2ppsr/babbage-hello-world`](https://github.com/p2ppsr/babbage-hello-world))

Note: the old `@babbage/sdk` is deprecated (March 2024) in favour of `@bsv/sdk`. The deprecated code is still useful as a reference for CWI interaction patterns.

## Adjacent: BRC-100 as Identity

There is [emerging thinking](https://medium.com/@bsvj/skgremont-ff4f192a3c21) around using BRC-100 for wallet-based authentication ("Sign-In with BRC-100"). This is a different problem to x402 (identity vs payment), but they share plumbing — both use `window.CWI` for challenge signing. A mature x402 ecosystem may integrate both: authenticated clients with billing relationships alongside anonymous clients paying per-request.
