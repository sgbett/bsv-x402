# Implementation Plan: Browser Extension Plugins for bsv-x402

## 1. Overview and Architecture

The goal is to add three browser extension packages (Chromium, Firefox, Safari) to the existing monorepo. These extensions inject a `window.CWI` object (the BRC-100 wallet interface) into web pages, enabling the existing `bsv-x402` library to construct payment proofs without requiring an external wallet like BSV Browser to already be installed.

The extensions share approximately 90% of their code. The browser-specific portions are limited to manifest files and minor API adapter shims (Chrome uses `chrome.runtime`, Firefox uses `browser.runtime`, Safari wraps via a native app container).

### Reference Implementation

The [bsv-blockchain/bsv-browser](https://github.com/bsv-blockchain/bsv-browser) is a React Native mobile app (not a Chrome extension). It injects wallet functionality into a WebView via `postMessage` / `injectJavaScript`. Its message protocol uses `type: 'CWI'` events with request IDs — we adopt this same request/response pattern for our extension's page script.

Key reference files: `app/browser.tsx` (WebView + message handler), `components/SpendingAuthorizationModal.tsx` (approval UI with tiered spending).

## 2. Repository Structure

```
bsv-x402/
├── src/                          # existing library (unchanged except defaultConstructProof)
├── plugins/
│   ├── shared/
│   │   ├── cwi.ts                # BRC-100 CWI interface implementation
│   │   ├── content-script.ts     # Content script: injects page script, relays messages
│   │   ├── page-script.ts        # Injected into page context: defines window.CWI
│   │   ├── background.ts         # Service worker: key mgmt, signing, tx construction
│   │   ├── messages.ts           # Message type definitions (content <-> background)
│   │   ├── key-manager.ts        # HD key derivation, encrypted storage
│   │   ├── tx-builder.ts         # BSV transaction construction for x402 payments
│   │   ├── storage-bridge.ts     # StorageAdapter that uses extension storage API
│   │   └── ui/
│   │       ├── popup.html        # Main popup (balance, settings, tier)
│   │       ├── popup.ts          # Popup logic
│   │       ├── popup.css
│   │       ├── setup.html        # First-run wallet setup
│   │       ├── setup.ts
│   │       ├── approve.html      # Payment approval prompt
│   │       ├── approve.ts
│   │       └── icons/            # Extension icons (16, 48, 128 px)
│   ├── chromium/
│   │   ├── manifest.json         # Manifest V3
│   │   └── platform.ts           # chrome.* API adapter
│   ├── firefox/
│   │   ├── manifest.json         # Manifest V2/V3 hybrid (Firefox supports both)
│   │   └── platform.ts           # browser.* API adapter
│   ├── safari/
│   │   ├── manifest.json         # Safari Web Extension manifest
│   │   ├── platform.ts           # Safari-specific API adapter
│   │   └── xcode/                # Xcode project wrapper (required for Safari)
│   │       └── README.md         # Instructions for Xcode setup
│   └── build.ts                  # Unified build script for all three
├── package.json                  # Updated with new scripts and dependencies
├── tsup.config.ts                # Library build (unchanged)
└── tsconfig.plugins.json         # Separate tsconfig for plugin code
```

## 3. Detailed Component Design

### 3.1 Implement `defaultConstructProof` in `src/x402-fetch.ts`

The existing stub at line 16-19 needs to call `window.CWI.createAction()`. This is the bridge between the library and whatever BRC-100 wallet is present.

**Implementation:**

```typescript
async function defaultConstructProof(challenge: Challenge): Promise<Proof> {
  const cwi = (globalThis as any).CWI
  if (!cwi || typeof cwi.createAction !== 'function') {
    throw new Error(
      'No BRC-100 wallet detected. Install a CWI-compliant browser extension ' +
      'or provide a custom proofConstructor in X402Config.'
    )
  }

  const result = await cwi.createAction({
    description: `x402 payment: ${challenge.amount} sats to ${challenge.payee}`,
    outputs: [{
      satoshis: challenge.amount,
      lockingScript: payeeAddressToLockingScript(challenge.payee),
      description: `Payment to ${challenge.payee}`,
    }],
    labels: ['x402-payment'],
    options: {
      returnTXIDOnly: false,  // We need the raw tx
      noSend: false,          // Broadcast immediately
    },
  })

  if (!result || !result.txid) {
    throw new Error('Wallet declined payment or returned invalid result')
  }

  return {
    txid: result.txid,
    rawTx: result.rawTx ?? '',
  }
}
```

A helper `payeeAddressToLockingScript` will convert a BSV address to a P2PKH locking script (25-byte standard script). This can use `@bsv/sdk` or a minimal inline implementation to keep the library dependency-light.

New type declarations for `src/types.ts`:

```typescript
export interface CWICreateActionResult {
  txid: string
  rawTx?: string
}

export interface CWICreateActionParams {
  description: string
  outputs: Array<{
    satoshis: number
    lockingScript: string
    description?: string
  }>
  labels?: string[]
  options?: {
    returnTXIDOnly?: boolean
    noSend?: boolean
  }
}
```

### 3.2 The `window.CWI` Injection Mechanism

Browser extensions cannot directly set properties on the page's `window` object from a content script, because content scripts run in an isolated world. The injection requires a two-layer approach:

**Layer 1: Content Script (`plugins/shared/content-script.ts`)**
- Registered in the manifest to run on all pages (or a configurable set of origins)
- Injects the page script into the page context via a `<script>` element
- Listens for `CustomEvent` messages from the page script and forwards them to the background service worker via `chrome.runtime.sendMessage` (or the platform-equivalent)
- Receives responses from the background and relays them back to the page via `CustomEvent`

**Layer 2: Page Script (`plugins/shared/page-script.ts`)**
- Injected into the actual page context (runs as if it were page JavaScript)
- Defines `window.CWI` as a proxy object implementing the BRC-100 interface
- Each CWI method call creates a `Promise`, dispatches a `CustomEvent` with a unique request ID and the method name/args, and waits for a response event
- The event name should be namespaced to avoid collisions: `x402-cwi-request` / `x402-cwi-response`

**Message flow:**
```
Page JS calls window.CWI.createAction(params)
  → page-script.ts dispatches CustomEvent('x402-cwi-request', {id, method, params})
  → content-script.ts receives CustomEvent, calls chrome.runtime.sendMessage({id, method, params})
  → background.ts receives message, performs wallet operation
  → background.ts sends response via chrome.runtime.sendMessage callback
  → content-script.ts receives response, dispatches CustomEvent('x402-cwi-response', {id, result/error})
  → page-script.ts resolves/rejects the Promise
```

**Security considerations:**
- The page script must be injected with `world: 'MAIN'` in Manifest V3 (Chromium) to run in the page context
- Firefox uses `wrappedJSObject` or `exportFunction` from content scripts, or can inject via DOM script element
- All messages between page and content script must include an origin check
- The background service worker must validate that requests come from the extension's own content script

### 3.3 Background Service Worker (`plugins/shared/background.ts`)

The background script is the security boundary. It holds the wallet keys and performs all sensitive operations. It should never expose private keys to content scripts or page scripts.

**Responsibilities:**
- Listen for messages from content scripts
- Route CWI method calls to the appropriate handler
- Manage encrypted key storage (using `chrome.storage.local` / `browser.storage.local`)
- Construct and sign BSV transactions
- Broadcast transactions to the BSV network
- Enforce spend limits (by importing from the existing `bsv-x402` library directly)
- Show approval popups for payments exceeding thresholds

**Key message handlers:**
- `createAction` -- the primary payment method; constructs a BSV transaction
- `createSignature` -- used by the 2FA provider
- `getPublicKey` -- returns the wallet's public key for the requesting app
- `isAuthenticated` -- checks if the wallet is set up and unlocked
- `getNetwork` -- returns 'mainnet' or 'testnet'

### 3.4 Key Management (`plugins/shared/key-manager.ts`)

**Setup flow:**
1. On first install, extension opens `setup.html`
2. User either generates a new seed phrase (BIP-39 mnemonic) or imports an existing one
3. Seed is encrypted with a user-supplied password using PBKDF2 + AES-GCM (via Web Crypto API)
4. Encrypted seed stored in `chrome.storage.local`
5. Session key derived on unlock, held in memory only (cleared on lock/idle timeout)

**Key derivation:**
- BRC-42/BRC-43 compliant key derivation from BRC-100 spec
- `protocolID` and `keyID` parameters from CWI calls determine the derivation path
- For x402 payments, a standard derivation path is used for the wallet's spending key

**Dependencies:** `@bsv/sdk` provides HD key derivation, transaction construction, and script building.

### 3.5 Transaction Builder (`plugins/shared/tx-builder.ts`)

Constructs the BSV payment transaction for x402 challenges:

1. Receive the `createAction` params (which include the challenge amount and payee output)
2. Find available UTXOs from the wallet's key (either tracked locally or via a UTXO lookup service)
3. Construct a transaction with:
   - Input: wallet's UTXO(s)
   - Output 1: payment to the payee (from the challenge)
   - Output 2: change back to wallet (if needed)
4. Sign the transaction
5. Broadcast to the BSV network (via a configurable node endpoint, defaulting to WhatsOnChain API or similar)
6. Return `{txid, rawTx}`

**UTXO tracking options:**
- Use a public API like WhatsOnChain to query UTXOs for the wallet address
- Maintain a local UTXO set, updated after each transaction
- Hybrid: bootstrap from API, then track locally

### 3.6 Storage Bridge (`plugins/shared/storage-bridge.ts`)

The existing `StorageAdapter` interface from `src/types.ts` uses `load/save/loadSitePolicies/saveSitePolicies`. The extension needs an implementation that uses `chrome.storage.local` instead of `localStorage`, because:
- Service workers have no `localStorage`
- Extension storage is synced across contexts (popup, background, content script)

```typescript
class ExtensionStorageAdapter implements StorageAdapter {
  async load(): Promise<LimitState | null> { /* chrome.storage.local.get */ }
  async save(state: LimitState): Promise<void> { /* chrome.storage.local.set */ }
  async loadSitePolicies(): Promise<Record<string, SitePolicy>> { /* chrome.storage.local.get */ }
  async saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void> { /* chrome.storage.local.set */ }
}
```

### 3.7 Spend Limits Integration

The background service worker imports the library's `RateLimiter`, `resolveSpendLimits`, and `TIER_PRESETS` directly. The extension's popup UI allows the user to select their tier (the Doom II difficulty system already defined in the codebase). The background enforces limits before signing any transaction.

**Flow when a payment request arrives:**
1. Background receives `createAction` message
2. Creates/loads a `RateLimiter` instance with the user's configured tier
3. Calls `limiter.check(challenge, origin)`
4. If `allow` -- proceed with tx construction
5. If `yellow-light` -- show the approve popup (`approve.html`) with the yellow-light details
6. If `block` -- reject the request, send error back to content script
7. After successful payment, calls `limiter.record(entry)` and persists via `ExtensionStorageAdapter`

### 3.8 Platform Adapters and Manifest Differences

Each platform needs a thin adapter (`platform.ts`) that normalizes the extension API.

| Feature | Chromium (V3) | Firefox (V2) | Safari |
|---------|---------------|--------------|--------|
| `manifest_version` | 3 | 2 | 3 |
| Background | `service_worker` | `scripts` | `service_worker` |
| Content script world | `world: "MAIN"` supported | Use DOM injection | `world: "MAIN"` supported |
| CSP | `content_security_policy.extension_pages` | `content_security_policy` (string) | Same as Chromium |
| Host permissions | `host_permissions: ["<all_urls>"]` | `permissions: ["<all_urls>"]` | `host_permissions` |
| Action | `action` | `browser_action` | `action` |

### 3.9 Build System

A unified build script at `plugins/build.ts` uses `tsup` (already a devDependency) to produce three extension packages.

**New scripts in `package.json`:**
```json
{
  "build:plugins": "tsx plugins/build.ts",
  "build:chromium": "tsx plugins/build.ts --target chromium",
  "build:firefox": "tsx plugins/build.ts --target firefox",
  "build:safari": "tsx plugins/build.ts --target safari",
  "build:all": "npm run build && npm run build:plugins"
}
```

**Build process per target:**
1. Compile shared TypeScript + platform-specific adapter into JavaScript using tsup
2. Three separate entry points: `background.ts`, `content-script.ts`, `page-script.ts`
3. Copy the target-specific `manifest.json` into the output directory
4. Copy UI HTML/CSS files into the output directory
5. Output to `dist/plugins/{chromium,firefox,safari}/`

### 3.10 Approval UI (`plugins/shared/ui/approve.html` + `approve.ts`)

When a payment requires user confirmation (yellow-light, high-value tx, new site), the background opens a popup window. The approve page:
- Reads the pending request details from the background via messaging
- Displays: origin, amount in sats and approximate USD, current spend vs. limits, tier name
- Two buttons: Approve / Deny
- Sends the decision back to the background, which resolves or rejects the pending CWI call

## 4. Implementation Sequence

### Phase 1: Foundation (files 1-5)
1. Add CWI type declarations to `src/types.ts`
2. Implement `defaultConstructProof` in `src/x402-fetch.ts`
3. Create `plugins/shared/messages.ts` (message type definitions)
4. Create `plugins/shared/page-script.ts` (window.CWI proxy)
5. Create `plugins/shared/content-script.ts` (message relay)

### Phase 2: Background Core (files 6-9)
6. Create `plugins/shared/key-manager.ts` (key generation, encryption, derivation)
7. Create `plugins/shared/tx-builder.ts` (transaction construction, UTXO management)
8. Create `plugins/shared/cwi.ts` (CWI method dispatch, connects key-manager and tx-builder)
9. Create `plugins/shared/background.ts` (message listener, routes to cwi.ts, enforces limits)

### Phase 3: Storage and Limits (files 10-11)
10. Create `plugins/shared/storage-bridge.ts` (ExtensionStorageAdapter)
11. Wire spend limits into background.ts using imported `RateLimiter`

### Phase 4: UI (files 12-15)
12. Create `plugins/shared/ui/popup.html` + `popup.ts` + `popup.css`
13. Create `plugins/shared/ui/setup.html` + `setup.ts`
14. Create `plugins/shared/ui/approve.html` + `approve.ts`
15. Create extension icons

### Phase 5: Platform Packages (files 16-21)
16. Create `plugins/chromium/manifest.json`
17. Create `plugins/chromium/platform.ts`
18. Create `plugins/firefox/manifest.json`
19. Create `plugins/firefox/platform.ts`
20. Create `plugins/safari/manifest.json` + `plugins/safari/platform.ts`
21. Create `plugins/safari/xcode/README.md`

### Phase 6: Build and Config (files 22-25)
22. Create `plugins/build.ts`
23. Create `tsconfig.plugins.json`
24. Update `package.json` with new scripts and dependencies
25. Update `.gitignore` to add `dist/plugins/`

## 5. Testing Strategy

**Unit tests (colocated in `plugins/shared/`):**
- `messages.test.ts` -- serialization/deserialization of all message types
- `key-manager.test.ts` -- key generation, encryption/decryption round-trip, derivation paths
- `tx-builder.test.ts` -- transaction construction with mock UTXOs, output verification
- `cwi.test.ts` -- CWI method routing, error handling
- `storage-bridge.test.ts` -- mock `chrome.storage.local`, verify load/save cycle

**Integration tests:**
- `page-script.test.ts` -- mock content script relay, verify window.CWI calls produce correct messages
- `background.test.ts` -- mock message passing, verify full flow from CWI call to signed transaction
- Verify that the existing `x402-fetch.test.ts` patterns work with a mock `window.CWI`

**End-to-end tests:**
- Use Puppeteer/Playwright with the Chromium extension loaded
- Load the demo page (already exists at `demo/`)
- Verify that `window.CWI` is injected
- Verify that a 402 flow completes with the extension providing the proof
- This can be a separate `test:e2e` script

## 6. Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| CSP blocks page script injection | Use `web_accessible_resources` + `<script src>` (not inline) |
| Race condition: page calls CWI before injection | Content script runs at `document_start`; CWI getter queues calls |
| `@bsv/sdk` bundle size inflates extension | Tree-shake via tsup; only import `Transaction`, `P2PKH`, `PrivateKey`, `HD` |
| Safari requires Xcode wrapper | `xcrun safari-web-extension-converter` generates it from extension dir |

## 7. Critical Files

- `src/x402-fetch.ts` -- implement `defaultConstructProof` to call `window.CWI.createAction()`
- `src/types.ts` -- add CWI-related type declarations
- `src/two-factor.ts` -- already references `window.CWI.createSignature`; extension must implement this
- `package.json` -- new build scripts and `@bsv/sdk` dependency
