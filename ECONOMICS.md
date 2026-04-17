# The Economics of ARC Broadcasting for Micropayments

## The trust gradient

ARC reports transaction status through a sequence of increasingly strong guarantees:

| Status | What it means | Time to reach |
|---|---|---|
| `RECEIVED` | ARC has the bytes | <50ms |
| `SENT_TO_NETWORK` | ARC forwarded to one or more nodes | ~100ms |
| `ACCEPTED_BY_NETWORK` | At least one node added to mempool | 100–500ms |
| `SEEN_ON_NETWORK` | Multiple nodes have it in mempool | <1s |
| `MINED` | In a block | ~10 minutes (next block) |
| `IMMUTABLE` | N confirmations deep | hours |

Each step adds confidence. Each step also adds latency. For an interactive payment-per-request model, the choice of which status to "trust" determines the entire UX.

## The cost gradient (not what you think)

Naïvely, you might want to wait for `MINED` before considering a payment final. For a per-click micropayment, this means every action has a ~10 minute (best case) latency. The product is dead.

In practice, **the cost of an unconfirmed payment failing is the fee, not the principal.** If a tx flips to `REJECTED` after `SENT_TO_NETWORK`, you lose the network fee — typically sub-cent on BSV. The principal (e.g. the 1000 sats you were paying for an article) is *also* lost from the wallet's perspective if it counted the change as spent — but the actual content was already served. So the failure mode is "user got the content, wallet briefly mis-accounted for change outputs", not "wallet sent money into the void".

The genuine economic risk is the fee, not the payment. The fee is small. The latency cost of being more careful is large.

## Why the trade-off favours speed

For a micropayment system, the optimal stance is:

> **Treat `SENT_TO_NETWORK` (or thereabouts) as good enough.** Accept that some small fraction of payments will fail post-acceptance due to reorgs or rare race conditions. The fee loss per failure is sub-cent; the latency cost of avoiding it is seconds or minutes per request.

This is mathematically correct so long as:

```
P(failure) × cost_of_failure < cost_of_extra_latency_per_request × N_requests
```

For BSV's reorg rate (extremely low) and ARC's well-tested mempool acceptance, P(failure) post-`SENT_TO_NETWORK` is small — sub-1% in practice. Multiply that by sub-cent fees and you get a vanishingly small expected loss per request. Compare to the UX cost of adding a 10-minute wait to every click and the answer is clear.

## When this model breaks

The trade-off inverts when the principal is large. If a single payment is worth £100, then a 1% failure rate becomes £1 expected loss per request — orders of magnitude larger than the fee, and worth waiting for stronger confirmation. At that scale you should not be using per-request payments at all; you should be using:

- **Payment channels** — open once, settle many on-chain payments, each state update a real transaction
- **Pre-funded service accounts** — top up a balance, debit per request, settle periodically
- **Escrow** — hold the principal until the service is confirmed delivered

These give strong guarantees without per-request latency.

## Implications for x402 implementations

Given the above, the correct stance for an x402 wallet is:

1. **Use `noSend: true`** when constructing the payment transaction. Hold the signed BEEF locally.
2. **Send the BEEF to the server** in the payment header.
3. **On HTTP 200**, broadcast immediately via `sendWith`. Don't wait for `MINED`. The server has the BEEF and can broadcast independently — your broadcast is for local state transition (unblocking change outputs) as much as for getting it on-chain.
4. **On HTTP 4xx**, abort. The signed tx never propagated, the inputs are released for reuse.
5. **On network error**, do nothing. Don't broadcast (server may have already done so), don't abort (tx may be on-chain). Surface to the user as "payment state unknown".

For the server side, the symmetric correct stance is:

1. **Accept the BEEF, validate it locally** (signatures, structure, amount).
2. **Return HTTP 200 immediately** on valid BEEF. Do not wait for ARC confirmation.
3. **Commit to broadcasting** the BEEF yourself, asynchronously after responding.
4. **Tolerate the ~1% of payments that fail post-broadcast.** Treat it as the cost of doing business.

When both sides follow this, you get:
- **Adversarial safety**: client only commits to broadcast on server acceptance; server only accepts valid BEEFs
- **Redundant broadcast**: either side's network call lands the tx; ARC deduplicates by txid when receiving Full BEEF (note: Atomic BEEF POST is NOT idempotent — see [BEEF-SIGNALLING.md](BEEF-SIGNALLING.md))
- **Sub-second UX**: no party waits for `MINED`
- **Bounded loss**: failures cost fees, not principal

## The cultural disagreement

The current BSV ecosystem is split on this:

- **AuthFetch / @bsv/sdk reference**: wallet broadcasts immediately (no `noSend`). Pays-before-knowing-server-accepted. Simple, but not adversarially safe — server can take payment and refuse service.
- **bsv-x402 (this implementation)**: `noSend` + broadcast on 200. Adversarial safety preserved. Slightly more complex; relies on either side broadcasting after handshake.
- **Some servers**: expect the wallet to broadcast first and won't return 200 until they see the tx propagate. Stalemate with `noSend` clients.

The convergent answer — the one that satisfies all three positions — is the one above: server commits to broadcast, returns 200 on receipt of valid BEEF. Wallet broadcasts on 200 too. Both broadcasts are belt-and-braces; neither side is left exposed.

## Summary

For micropayments, **fast and slightly lossy beats slow and perfect.** ARC's status progression gives you the option of any point on that curve; the right point is `SENT_TO_NETWORK`-ish. Anything stronger is paying for guarantees you don't need at this scale. Anything weaker (server-side broadcast only, no client commitment) breaks the adversarial model that makes x402 economically meaningful.
