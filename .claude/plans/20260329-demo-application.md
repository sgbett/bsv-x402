# Self-Contained Demo Application

## Context

Build a demo showing the full x402 spending limits system in action: Doom II tier selection, rate limiting, yellow light warnings, circuit breaker, per-site prompts. All runnable with one command. This is the first step on the path to a full-stack Rails + x402-rack + BSV Browser mainnet demo (separate repo).

## Library modification: inject proof constructor

`constructProof` is currently hardcoded in `src/x402-fetch.ts`. The demo needs to inject a mock. This is also needed for the real wallet integration later.

**Changes:**
- `src/types.ts` — add `proofConstructor?: (challenge: Challenge) => Promise<Proof>` to `X402Config`
- `src/x402-fetch.ts` — use `config.proofConstructor ?? defaultConstructProof` in `createX402Fetch`

Backwards compatible — omitting it keeps the existing "not implemented" stub.

## Demo structure

```
demo/
  server.ts      — Express mock server (402 endpoints + proof verification)
  index.html     — Browser UI
  client.ts      — Client-side logic (bundled inline or via script tag)
```

### Mock server (`demo/server.ts`)

Express app with:
- `GET /api/free` — 200, always accessible (control)
- `GET /api/article` — 402 with X402-Challenge (100k sats, ~$0.15)
- `GET /api/premium` — 402 with X402-Challenge (5M sats, ~$0.75)
- `GET /api/whale` — 402 with X402-Challenge (50M sats, ~$7.50)
- Accepts any proof in `X402-Proof` header and returns 200 with content
- Serves `demo/index.html` at `/`
- Static file serving for built library from `dist/`

Single command: `npx tsx demo/server.ts` → serves on http://localhost:3402

### Browser UI (`demo/index.html`)

Single page with:

**Tier selector** — dropdown with all 5 Doom II names, Nightmare requires typing confirmation. Changing tier reinitialises the client.

**Endpoint buttons:**
- "Free endpoint" — always works
- "Read article (100k sats)" — cheap, many clicks before limits
- "Premium content (5M sats)" — moderate, triggers yellow light faster
- "Whale content (50M sats)" — expensive, may hit per-tx limit on lower tiers

**Auto-fire button** — "Spam requests" that fires 402 requests rapidly to demonstrate rate limiting and circuit breaker tripping.

**Status panel:**
- Current tier + mode
- Wallet balance (mock, starts at 1 BSV)
- Spending state: entries count, sats spent in each window, % of limit
- Circuit breaker status (green/red)
- Event log showing each check result (allow/yellow-light/block), scrolling

**Yellow light** — when onYellowLight fires, show a modal/confirm with the details.

**Circuit breaker** — when tripped, show a red banner. "Reset" button triggers resetLimits().

### Mock proof constructor

Injected via `X402Config.proofConstructor`:
```typescript
async (challenge) => ({
  txid: `mock-${crypto.randomUUID()}`,
  rawTx: "00" // fake
})
```

Also maintains a mock wallet balance (starts at 100M sats = 1 BSV), deducting `challenge.amount` on each proof. Displays balance drain in real time — the health bar.

### Mock storage

Use the real `LocalStorageAdapter` — it works in the browser with actual localStorage. State persists across page reloads. This is a feature of the demo (shows persistence).

## npm scripts

Add to package.json:
```json
"demo": "npm run build && tsx demo/server.ts"
```

## Dev dependencies to add

- `express` + `@types/express` — mock server
- `tsx` — run TypeScript server directly (already commonly used, lighter than ts-node)

## Implementation sequence

1. Add `proofConstructor` to `X402Config` and wire into `createX402Fetch`
2. Install demo dependencies
3. Build mock server (`demo/server.ts`)
4. Build HTML page (`demo/index.html`) with inline JS (no build step for the client — import the ESM bundle directly)
5. Add `npm run demo` script
6. Test end-to-end

## Verification

```bash
npm run demo
# Open http://localhost:3402
# Select "I'm Too Young to Die"
# Click "Read article" a few times — see spending state update
# Click "Premium content" — see yellow light at ~80%
# Click "Whale content" — see per-tx block on lower tiers
# Hit "Spam requests" — watch circuit breaker trip
# Click "Reset" — clears breaker
# Switch to "Nightmare!" — type NIGHTMARE — no limits except BFG
# Refresh page — state persists from localStorage
```
