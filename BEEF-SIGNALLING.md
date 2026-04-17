# BEEF Signalling: How BEEF Type Communicates Broadcast Intent

## The two roles

In any BSV payment, there are two parties: a **Sender** and a **Receiver**. Either can act as the broadcaster. The BEEF format they exchange signals which role each is playing.

## BEEF type as a signal

| BEEF type | Signal | Implication for receiver |
|---|---|---|
| **FULL BEEF** (BRC-95 with complete ancestry) | "I have NOT broadcast this. You should." | Receiver should broadcast to ARC, then acknowledge |
| **ATOMIC BEEF** (BRC-95 targeting a single tx) | "I HAVE broadcast this. Here's what you need." | Receiver should verify and internalize, not broadcast |

This distinction isn't explicit in the BRC-95 spec — it emerges from the protocol semantics. Full BEEF carries enough ancestry for independent validation and broadcast. Atomic BEEF carries enough to identify and tag outputs, but not necessarily enough for ARC to accept as a first-time submission.

## The three payment patterns

### Case 1: Sender broadcasts (standard BRC-105 client-pays)

```
Client (Sender)                          Server (Receiver)
     │                                        │
     │  createAction(noSend: false)            │
     │  ├─ tx signed                           │
     │  └─ broadcast to ARC (full BEEF) ──────►│ ARC
     │                                         │
     │── GET /endpoint + ATOMIC BEEF ─────────►│
     │                                         │  internalizeAction(atomicBeef)
     │                                         │  ├─ wallet stores outputs
     │                                         │  └─ POST/GET ARC to verify ──►│ ARC
     │◄── HTTP 200 ───────────────────────────│
```

The client broadcasts first, then sends Atomic BEEF to the server. The server's `internalizeAction` receives Atomic BEEF — the signal is "already broadcast". The server can verify via ARC (POST idempotently or GET status) without needing to broadcast independently.

**This is the reference implementation flow** (AuthFetch in `@bsv/sdk`).

### Case 2: Receiver broadcasts (nosend / adversarial flow)

```
Client (Sender)                          Server (Receiver)
     │                                        │
     │  createAction(noSend: true)             │
     │  ├─ tx signed                           │
     │  └─ NOT broadcast                       │
     │                                         │
     │── GET /endpoint + FULL BEEF ───────────►│
     │                                         │  validate BEEF locally
     │                                         │  broadcast to ARC (full BEEF) ──►│ ARC
     │◄── HTTP 200 + ATOMIC BEEF ─────────────│
     │                                         │
     │  receive ATOMIC BEEF                    │
     │  ├─ signal: "already broadcast"         │
     │  └─ verify via ARC, transition nosend   │
```

The client sends Full BEEF (the signal: "please broadcast"). The server broadcasts and returns Atomic BEEF (the signal: "I've broadcast it"). The client receives Atomic BEEF and knows the tx is on-chain — it can verify and transition its local `nosend` state.

**This is the x402/bsv-x402 adversarial flow.**

### Case 3: Async refund (the "BSV way")

```
Server (Sender of refund)                Client (Receiver of refund)
     │                                        │
     │  create refund tx                       │
     │  broadcast to ARC (full BEEF) ─────────►│ ARC
     │                                         │
     │── HTTP 200 + ATOMIC BEEF (refund) ─────►│
     │                                         │  internalizeAction(atomicBeef)
     │                                         │  ├─ wallet stores outputs
     │                                         │  └─ verify via ARC ──────────►│ ARC
```

The server creates a refund/credit transaction, broadcasts it, and sends Atomic BEEF to the client in the response. The client's `internalizeAction` receives Atomic BEEF — same signal as Case 1: "already broadcast, just verify and store."

**This is the x402-doom health-credit flow** — pioneering async refunds via x402.

## Receiver behaviour on Atomic BEEF

When a receiver gets Atomic BEEF, the protocol is:

1. **Do NOT broadcast (POST)** — the sender already did, and ARC rejects Atomic BEEF even for known txids (see empirical evidence below)
2. **Verify the tx exists on-chain via GET** — `GET /v1/tx/{txid}` returns status + merkle proof if mined
3. **Store locally** — internalize the outputs, mark tx as `unproven`, let Monitor find the merkle proof

### Empirical evidence: ARC is NOT idempotent with Atomic BEEF

Tested 2026-04-17 against GorillaPool ARC with a confirmed MINED transaction:

```
POST /v1/tx  (Atomic BEEF for txid 994c0110...dfd2353)
→ 400: "script(104): got 71 bytes: unexpected EOF"

GET /v1/tx/994c0110...dfd2353
→ 200: { txStatus: "MINED", blockHeight: 944857, merklePath: "..." }
```

ARC processes POST submissions as fresh validations — it does not check "do I already know this txid?" before attempting script validation. Atomic BEEF lacks source transactions needed for script validation, so POST always fails regardless of whether ARC already has the tx.

**The GET path is the only viable verification method for Atomic BEEF.**

### The timing race

There is a window between "sender broadcast" and "ARC has propagated the tx" during which the receiver may not be able to verify. This is inherent in any distributed system.

**Resilience strategy:**
- Retry verification with exponential backoff (e.g., 500ms, 1s, 2s)
- After N failures, mark as "pending verification" and retry in background
- Do NOT mark as `failed` on first verification failure — the tx may still be propagating
- Configurable retry count and timing (protocol-level tuning parameter)

## The wallet-toolbox gap

Currently, `@bsv/wallet-toolbox-client`'s `internalizeAction` (in `internalizeAction.js` lines 336-354) does not distinguish between Atomic and Full BEEF. When it encounters an unknown txid without a mining proof, it:

1. Assumes "the transaction has never been broadcast"
2. Attempts to broadcast using the provided BEEF
3. If ARC rejects (insufficient ancestry in Atomic BEEF), marks the tx as `failed`

This is correct for Full BEEF (Case 2 — receiver should broadcast). It is incorrect for Atomic BEEF (Cases 1 and 3 — sender already broadcast).

**The fix**: `internalizeAction` should detect whether the BEEF is Atomic format (lacks full ancestry). When it is:

1. Do NOT call `shareReqsWithWorld()` (POST to ARC will always fail for Atomic BEEF)
2. Instead, GET the txid status from ARC to verify it exists
3. If ARC confirms (`SEEN_ON_NETWORK`, `MINED`, etc.), store as `unproven` and let Monitor acquire the merkle proof
4. If ARC doesn't know the txid yet (timing race), retry with backoff — do NOT mark as `failed`
5. Only mark as `failed` after exhausting retries with reasonable timeouts

## Connection to broadcasting economics

This document describes the **protocol-level** mechanics of who broadcasts and how. The companion document [ECONOMICS.md](ECONOMICS.md) describes the **economic** rationale for trusting fast confirmation over deep confirmation in micropayment contexts.

Together:
- **BEEF-SIGNALLING.md** (this document): how the protocol communicates broadcast responsibility
- **ECONOMICS.md**: why fast verification is economically rational for micropayments

## Summary

| What you receive | What it means | What you do |
|---|---|---|
| Full BEEF | Sender didn't broadcast | You broadcast, then acknowledge |
| Atomic BEEF | Sender already broadcast | You verify (GET from ARC), then internalize |
| Neither | No payment | Nothing to do |

The BEEF type IS the signal. Wallets that respect this signal avoid redundant broadcasts, timing races, and the `failed` status poisoning that occurs when Atomic BEEF is mistakenly broadcast to an ARC that doesn't yet know the transaction.
