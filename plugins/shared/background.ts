/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest } from './cwi-proxy'
import { BuiltInWalletBackend } from './builtin-wallet-backend'
import * as wallet from './wallet-controller'
import * as x402 from './x402-controller'

// ---------------------------------------------------------------------------
// Pubkey → P2PKH address (for popup display)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

async function hash160(data: Uint8Array): Promise<Uint8Array> {
  // Import ripemd160 inline to avoid circular deps — same impl as brc105-proof.ts
  const { ripemd160 } = await import('../../src/brc105-proof')
  const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', data as ArrayBufferView<ArrayBuffer>))
  return ripemd160(sha256)
}

async function pubkeyToAddress(pubkeyHex: string): Promise<string> {
  const pubkeyBytes = hexToBytes(pubkeyHex)
  const pubkeyHash = await hash160(pubkeyBytes)

  // Version byte (0x00 for mainnet) + 20-byte hash
  const payload = new Uint8Array(21)
  payload[0] = 0x00
  payload.set(pubkeyHash, 1)

  // Double-SHA256 checksum (first 4 bytes)
  const hash1 = new Uint8Array(await crypto.subtle.digest('SHA-256', payload as ArrayBufferView<ArrayBuffer>))
  const hash2 = new Uint8Array(await crypto.subtle.digest('SHA-256', hash1 as ArrayBufferView<ArrayBuffer>))
  const checksum = hash2.slice(0, 4)

  // Concatenate payload + checksum
  const addressBytes = new Uint8Array(25)
  addressBytes.set(payload)
  addressBytes.set(checksum, 21)

  // Base58 encode
  let num = 0n
  for (const b of addressBytes) num = num * 256n + BigInt(b)

  let encoded = ''
  while (num > 0n) {
    encoded = BASE58_ALPHABET[Number(num % 58n)] + encoded
    num = num / 58n
  }

  // Preserve leading zero bytes as '1's
  for (const b of addressBytes) {
    if (b !== 0) break
    encoded = '1' + encoded
  }

  return encoded
}

// ---------------------------------------------------------------------------
// Scan for legacy P2PKH UTXOs at the identity key address
// ---------------------------------------------------------------------------

const FUNDED_ADDRESS_KEY = 'x402_funded_addresses'

async function isAddressAlreadyFunded(address: string): Promise<boolean> {
  const result = await chrome.storage.local.get(FUNDED_ADDRESS_KEY)
  const arr = result[FUNDED_ADDRESS_KEY] as string[] | undefined
  return arr?.includes(address) ?? false
}

async function markAddressFunded(address: string): Promise<void> {
  const result = await chrome.storage.local.get(FUNDED_ADDRESS_KEY)
  const arr = result[FUNDED_ADDRESS_KEY] as string[] | undefined ?? []
  if (!arr.includes(address)) {
    arr.push(address)
    await chrome.storage.local.set({ [FUNDED_ADDRESS_KEY]: arr })
  }
}

async function scanAndImportUtxos(): Promise<void> {
  const rootKeyHex = wallet.getRootKeyHex()
  if (!rootKeyHex) return

  const backend = wallet.getBackend()
  const { publicKey: identityKeyHex } = await backend.call('getPublicKey', { identityKey: true }, 'self') as { publicKey: string }
  const address = await pubkeyToAddress(identityKeyHex)

  // Skip if we've already imported from this address
  if (await isAddressAlreadyFunded(address)) {
    console.log('x402: identity address already funded, skipping scan')
    return
  }

  // Look up UTXOs at the identity key's P2PKH address
  const utxos = await fetchUtxos(address)
  if (utxos.length === 0) {
    console.log('x402: no legacy UTXOs found at identity address')
    return
  }

  console.log(`x402: found ${utxos.length} UTXO(s) at identity address, importing...`)

  // Build outpoints and KeyPairAddress for fundWalletFromP2PKHOutpoints
  const outpoints = utxos.map((u) => `${u.tx_hash}.${u.tx_pos}`)
  const { PrivateKey } = await import('@bsv/sdk')
  const privateKey = PrivateKey.fromHex(rootKeyHex)
  const publicKey = privateKey.toPublicKey()
  const p2pkhKey = { privateKey, publicKey, address }

  const { SetupClient } = await import('@bsv/wallet-toolbox-client')
  if (!(backend instanceof BuiltInWalletBackend)) return
  const walletInterface = backend.getWalletInterface()
  if (!walletInterface) {
    console.warn('x402: wallet instance not available for UTXO import')
    return
  }

  const results = await SetupClient.fundWalletFromP2PKHOutpoints(walletInterface, outpoints, p2pkhKey)
  let anySuccess = false
  for (const r of results) {
    if (r.success) {
      console.log(`x402: imported UTXO ${r.outpoint} → ${r.txid}`)
      anySuccess = true
    } else {
      console.warn(`x402: failed to import UTXO ${r.outpoint}: ${r.error}`)
    }
  }
  if (anySuccess) {
    await markAddressFunded(address)
    // Notify any open popup to refresh balance
    chrome.runtime.sendMessage({ type: 'balanceUpdated' }).catch(() => {})
  }
}

async function fetchUtxos(address: string): Promise<Array<{ tx_hash: string; tx_pos: number; value: number }>> {
  const providers = [
    `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
  ]
  for (const url of providers) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(t)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) return data
      }
    } catch {
      // Try next provider
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Message type guards
// ---------------------------------------------------------------------------

interface InternalMessage {
  type: 'unlock' | 'lock' | 'setup' | 'getState' | 'getAddress' | 'setNetwork' | 'setTier' | 'switchBackend' | 'getSpendStatus' | 'openPopupTab'
  payload?: unknown
}

function isInternalMessage(msg: unknown): msg is InternalMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg
}

function isCWIMessage(msg: unknown): msg is ContentToBackgroundMessage {
  return typeof msg === 'object' && msg !== null && 'request' in msg
}

// ---------------------------------------------------------------------------
// Internal message handler — routes to appropriate controller
// ---------------------------------------------------------------------------

async function handleInternalMessage(message: InternalMessage): Promise<Record<string, unknown>> {
  switch (message.type) {
    // Wallet concerns
    case 'unlock': {
      const payload = message.payload as { password: string } | undefined
      if (!payload?.password) throw new Error('Password required')
      await wallet.unlock(payload.password)
      // Scan for legacy P2PKH UTXOs in the background (don't block unlock)
      scanAndImportUtxos().catch((err) => {
        console.warn('x402: UTXO scan failed (non-blocking):', err)
      })
      break
    }
    case 'lock':
      wallet.lock()
      break
    case 'setup': {
      const payload = message.payload as { seed: string; password: string; tier?: import('../../src/types').TierName } | undefined
      if (!payload?.password || !payload?.seed) throw new Error('Seed and password required')
      await wallet.setup(payload.seed, payload.password)
      if (payload.tier) x402.setTier(payload.tier)
      break
    }
    case 'setNetwork': {
      const payload = message.payload as { network: string } | undefined
      if (payload?.network) wallet.setNetwork(payload.network)
      break
    }

    // x402 concerns
    case 'setTier': {
      const payload = message.payload as { tier: import('../../src/types').TierName } | undefined
      if (payload?.tier) x402.setTier(payload.tier)
      break
    }

    case 'getState':
      break // just return composed state below

    case 'getAddress': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      const result = await backend.call('getPublicKey', { identityKey: true }, 'self') as { publicKey: string }
      const address = await pubkeyToAddress(result.publicKey)
      const walletState = await wallet.getWalletState()
      const x402State = x402.getX402State()
      return { ...walletState, ...x402State, identityKey: result.publicKey, address }
    }

    case 'switchBackend': {
      const payload = message.payload as { type: 'builtin' | 'external'; extensionId?: string } | undefined
      if (!payload?.type) throw new Error('Backend type required')
      await wallet.switchBackend(payload.type, payload.extensionId ? { extensionId: payload.extensionId } : undefined)
      break
    }

    default:
      throw new Error(`Unknown message type: ${(message as InternalMessage).type}`)
  }

  // All internal messages return composed state from both controllers
  const walletState = await wallet.getWalletState()
  const x402State = x402.getX402State()
  return { ...walletState, ...x402State }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ContentToBackgroundMessage | InternalMessage, sender, sendResponse) => {
    // Route CWI requests from content scripts
    if (isCWIMessage(message)) {
      if (!message.origin) {
        sendResponse({ id: message.request?.id ?? '', status: 'error', error: 'Missing origin' } satisfies CWIResponse)
        return true
      }
      if (!sender.tab) {
        sendResponse({ id: message.request.id, status: 'error', error: 'Message must come from a content script' } satisfies CWIResponse)
        return true
      }

      handleCWIRequest(message, wallet.getBackend(), sender.tab?.id)
        .then((response) => sendResponse(response))
        .catch((err) => {
          sendResponse({
            id: message.request.id,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          } satisfies CWIResponse)
        })

      return true
    }

    // Open popup in a tab — allowed from content scripts (for the indicator click)
    if (isInternalMessage(message) && message.type === 'openPopupTab') {
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/popup.html') })
      sendResponse({ ok: true })
      return true
    }

    // Spend status — allowed from content scripts (for the indicator)
    if (isInternalMessage(message) && message.type === 'getSpendStatus') {
      x402.getSpendStatus()
        .then((status) => sendResponse(status))
        .catch(() => sendResponse(null))
      return true
    }

    // Route internal messages from popup / setup UI — must come from our
    // own extension (same extension ID + extension origin URL).  Extension
    // pages opened as tabs (e.g. wallet/setup.html) have sender.tab set,
    // so we cannot reject on that alone.
    if (isInternalMessage(message)) {
      const isOwnExtension = sender.id === chrome.runtime.id
        && (!sender.url || sender.url.startsWith(chrome.runtime.getURL('')))
      if (!isOwnExtension) {
        sendResponse({ id: '', status: 'error', error: 'Unauthorised sender' })
        return true
      }
      handleInternalMessage(message)
        .then((response) => sendResponse(response))
        .catch((err) => {
          sendResponse({ id: '', status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
      return true
    }

    // Unrecognised message
    sendResponse({ id: '', status: 'error', error: 'Unrecognised message format' })
    return true
  },
)

// ---------------------------------------------------------------------------
// Extension install / update handler
// ---------------------------------------------------------------------------

// Restore wallet backend choice on startup
wallet.restoreBackendChoice().catch((err) => {
  console.warn('x402: failed to restore wallet backend:', err)
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Check for test-mode auto-setup (e.g. Selenium e2e tests)
    chrome.storage.local.get(['x402_test_config', 'x402_wallet_backend'], async (result) => {
      const testConfig = result.x402_test_config as {
        rootKeyHex: string
        password: string
        chain?: 'main' | 'test'
        tier?: import('../../src/types').TierName
      } | undefined

      if (testConfig?.rootKeyHex && testConfig?.password) {
        try {
          await wallet.setup(testConfig.rootKeyHex, testConfig.password)
          if (testConfig.chain) wallet.setNetwork(testConfig.chain)
          if (testConfig.tier) x402.setTier(testConfig.tier)
          await chrome.storage.local.remove('x402_test_config')
          console.log('x402: test-mode auto-setup complete')
        } catch (err) {
          console.error('x402: test-mode auto-setup failed:', err)
        }
        return
      }

      // Only open wallet setup if using built-in backend
      const backend = result.x402_wallet_backend as { type: string } | undefined
      if (backend?.type === 'external') {
        console.log('x402: extension installed — external wallet backend, skipping setup page')
        return
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/wallet/setup.html') })
      console.log('x402: extension installed — opening setup page')
    })
  } else {
    console.log(`x402: extension updated (reason: ${details.reason})`)
  }
})

// ---------------------------------------------------------------------------
// Auto-lock after 15 minutes of idle
// ---------------------------------------------------------------------------

chrome.alarms.create('auto-lock', { periodInMinutes: 15 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock' && wallet.isUnlocked()) {
    wallet.lock()
    console.log('x402: wallet auto-locked after idle timeout')
  }
})
