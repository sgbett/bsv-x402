# Plan: Popup UI/UX Overhaul

## Context

The current popup is a single 454-line `popup.ts` with inline DOM manipulation, no routing, and a flash-of-locked-state bug. The user wants multi-page navigation (Home, Payments, Transactions, Settings), a transaction list with paging, QR receive codes, and wallet recovery (SQLite export/import). Requirements in `/opt/js/bsv-x402/tmp/ui-ux.md`.

The model layer (service worker) and controller (message protocol) don't change. This is purely a view restructure.

## Architecture

```
plugins/shared/ui/
  popup.html          → shell: header tabs + container div (minimal HTML)
  popup.css           → all styles (rewritten for new layout)
  popup.ts            → init, router, state fetcher (tiny ~60 lines)
  state.ts            → PopupState type, sendMessage helper, state polling
  router.ts           → hash-based page switching, renders active page into container
  pages/
    home.ts           → balance, autospend health bar, pickups
    payments.ts       → send/receive toggle, send form, QR code, identity/address
    transactions.ts   → tx list with pager, tx rows linking to WoC
    settings.ts       → tier, weapon, tools (verify/admin), recovery (export/import)
  components/
    header.ts         → tab navigation (Home | Payments | Transactions | Settings)
    tx-row.ts         → single transaction row (amount, status badge, description, txid link)
    health-bar.ts     → autospend health bar (reused from current code)
    qr.ts             → QR code rendering (lightweight library or canvas-based)
```

### Page rendering pattern

Each page exports a `render(container, state)` function:

```typescript
// pages/home.ts
export function render(el: HTMLElement, state: PopupState): void {
  el.innerHTML = `
    <section class="balance">...</section>
    <section class="autospend">...</section>
    <section class="pickups">...</section>
  `
  // bind event listeners
}
```

### Router

Hash-based routing (`#home`, `#payments`, `#transactions`, `#settings`):

```typescript
// router.ts
const pages = { home, payments, transactions, settings }

export function navigate(page: string, container: HTMLElement, state: PopupState) {
  location.hash = page
  const render = pages[page] ?? pages.home
  render(container, state)
}
```

### State lifecycle (fixes the flash bug)

The popup shell shows a loading spinner by default. The app container is hidden until state arrives:

```html
<!-- popup.html -->
<div id="loading" class="loading">
  <div class="spinner"></div>
  <span>Loading...</span>
</div>
<div id="app" hidden>
  <!-- header tabs + page container -->
</div>
```

```typescript
// popup.ts
document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('app')!
  const state = await fetchState()       // wait for service worker
  document.getElementById('loading')!.hidden = true
  container.hidden = false               // swap spinner for content
  renderHeader(state)
  navigate(location.hash || 'home', container, state)
  startPolling(state => updateActivePage(container, state))
})
```

The spinner shows immediately on popup open (no flash of locked state). When the service worker responds, the spinner is replaced by the actual content. If the service worker is cold (needs to wake up), the spinner remains visible until ready.

### Lock screen

When `state.isUnlocked === false`, ALL pages show the lock screen instead of their content. This is handled in the router — if locked, render the unlock form regardless of which tab is active. On successful unlock, re-render the active page.

## Page breakdown

### Home
- [KEEP] Balance display
- [KEEP] Autospend health bar (extracted to `components/health-bar.ts`)
- [KEEP] Pickup buttons (Medkit, Stimpak, Soul Sphere, New Game)
- Lock/unlock button moves to header (always visible)

### Payments
- [NEW] Large slide-toggle: Send | Receive
- **Send panel**: [KEEP] address input, amount input, send button, result display
- **Receive panel**:
  - [NEW] QR code of the wallet's identity key (or funding address)
  - [NEW] Small toggle: Show Identity → identity key display
  - [NEW] Small toggle: Legacy → root key / receive address display
  - [KEEP] Copy buttons for identity key and address

### Transactions
- [NEW] `listActions` call to service worker (new message type: `listTransactions`)
- [NEW] List of top 20 transactions, each showing:
  - Amount: green `+` for received, red `-` for sent
  - Status badge: confirmed/unconfirmed (like the status indicator)
  - Description in light grey
  - Txid: smaller font, blue, 🔍 prefix, links to WoC, highlight on hover
  - No labels on any of these — use `title` attributes instead
- [NEW] Pager control when >20 transactions exist
- Requires new background handler: `case 'listTransactions'` → calls `backend.call('listActions', { labels: [], limit, offset, includeLabels: true })`

### Settings
- [KEEP] Difficulty dropdown (add "(Autospend limit)" label + sats in dropdown items)
- [KEEP] Weapon dropdown
- [KEEP] Tools section (Verify UTXOs button, UTXO Admin button)
- [NEW] Recovery section:
  - Seed display: first 4 chars `...` last 2 chars (from `getRootKeyHex()`)
  - Export Wallet button → downloads IndexedDB as SQLite file
  - Import Wallet button → uploads SQLite file, replaces IndexedDB
- Recovery requires new background handlers: `adminExportWallet`, `adminImportWallet`

## New message types needed

| Message type | Direction | Purpose |
|---|---|---|
| `listTransactions` | popup → bg | Paginated tx list via `listActions` |
| `adminExportWallet` | popup → bg | Dump IndexedDB → SQLite binary |
| `adminImportWallet` | popup → bg | Load SQLite binary → IndexedDB |

## Build changes

Current build compiles `plugins/shared/ui/popup.ts` as a single IIFE entry point. The new structure has multiple files but they should still bundle into a single IIFE — tsup handles this if `popup.ts` imports the other modules.

No changes to `plugins/build.ts` needed — `popup.ts` remains the entry point, it just imports from `state.ts`, `router.ts`, `pages/*.ts`, `components/*.ts`.

## QR code dependency

Need a lightweight QR code generator. Options:
- `qr-creator` (~4KB, no dependencies, canvas-based)
- `qrcode-generator` (~8KB)
- Hand-roll using canvas (complex, not worth it)

Add as a devDependency, bundled into the IIFE.

## SQLite export/import dependency

Need `sql.js` (SQLite compiled to WASM) for reading/writing SQLite files:
- Export: read all IndexedDB object stores → write to SQLite tables → download as `.sqlite` file
- Import: read `.sqlite` file → write to IndexedDB object stores → reload wallet

This runs in the popup context (not service worker) since it needs file download/upload UI. The popup sends the data to the service worker for IndexedDB writes via the existing message protocol.

Alternative: use the service worker + `chrome.downloads` API for export. Needs investigation.

## Implementation sequence

### Phase 1: Shell + Router + Home (gets the architecture right)
1. Create `state.ts` — extract PopupState type, sendMessage, fetchState
2. Create `router.ts` — hash-based routing
3. Create `components/header.ts` — tab navigation
4. Create `pages/home.ts` — balance, autospend, pickups (move from popup.ts)
5. Rewrite `popup.html` — minimal shell with `<div id="app" hidden>`
6. Rewrite `popup.ts` — init, router setup, state lifecycle (fixes flash bug)
7. Rewrite `popup.css` — new layout with tab navigation

### Phase 2: Remaining pages
8. Create `pages/settings.ts` — tier, weapon, tools (move from popup.ts)
9. Create `pages/payments.ts` — send (move from popup.ts) + receive (new)
10. Create `components/qr.ts` — QR code rendering
11. Create `pages/transactions.ts` — tx list + pager (new)
12. Create `components/tx-row.ts` — transaction row component
13. Add `listTransactions` handler to `background.ts`

### Phase 3: Recovery
14. Add `adminExportWallet` handler — IndexedDB → SQLite
15. Add `adminImportWallet` handler — SQLite → IndexedDB
16. Add recovery section to `pages/settings.ts`

## Files to modify
- `plugins/shared/ui/popup.html` — rewrite (minimal shell)
- `plugins/shared/ui/popup.ts` — rewrite (tiny init)
- `plugins/shared/ui/popup.css` — rewrite (new layout)
- `plugins/shared/background.ts` — add `listTransactions`, `adminExportWallet`, `adminImportWallet` handlers

## Files to create
- `plugins/shared/ui/state.ts`
- `plugins/shared/ui/router.ts`
- `plugins/shared/ui/pages/home.ts`
- `plugins/shared/ui/pages/payments.ts`
- `plugins/shared/ui/pages/transactions.ts`
- `plugins/shared/ui/pages/settings.ts`
- `plugins/shared/ui/components/header.ts`
- `plugins/shared/ui/components/tx-row.ts`
- `plugins/shared/ui/components/health-bar.ts`
- `plugins/shared/ui/components/qr.ts`

## Verification
- All existing functionality preserved (unlock, lock, balance, send, tier, weapon, pickups, verify UTXOs, UTXO admin)
- Flash-of-locked-state bug fixed (hidden until state arrives)
- Tab navigation works (hash-based, persists on popup reopen)
- Transaction list populated from real wallet data
- QR code renders on Payments → Receive
- Build still produces single IIFE bundle per platform
- `npm run build:all` succeeds
- Extension loads and popup functions in Chrome
