/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest } from './cwi-proxy'
import { BuiltInWalletBackend } from './builtin-wallet-backend'
import * as wallet from './wallet-controller'
import * as x402 from './x402-controller'
import { resolveApproval, handleWindowClosed } from './pending-approvals'
import { payeeAddressToLockingScript, verifyBase58Checksum } from '../../src/x402-fetch'
import { verifyUtxos } from './verify-utxos'

// Helper: fetch current wallet balance (for autospend tier clamping)
async function getWalletBalance(): Promise<number> {
  try {
    const state = await wallet.getWalletState()
    const balance = Number(state.balance)
    return Number.isFinite(balance) && balance >= 0 ? balance : 0
  } catch {
    return 0
  }
}

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

async function scanAndImportUtxos(): Promise<void> {
  // Clean up orphaned storage from previous dedup implementations (#55, #57)
  chrome.storage.local.remove(['x402_funded_addresses', 'x402_imported_outpoints'])

  const rootKeyHex = wallet.getRootKeyHex()
  if (!rootKeyHex) return

  const backend = wallet.getBackend()
  const { publicKey: identityKeyHex } = await backend.call('getPublicKey', { identityKey: true }, 'self') as { publicKey: string }
  const address = await pubkeyToAddress(identityKeyHex)

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

  // No dedup — let the wallet handle it. If a previous sweep tx failed,
  // the inputs were released and the retry will succeed. If a previous
  // sweep is already confirmed, the wallet will reject the double-spend
  // harmlessly. See: https://github.com/bsv-blockchain/ts-sdk/pull/510
  const results = await SetupClient.fundWalletFromP2PKHOutpoints(walletInterface, outpoints, p2pkhKey)
  for (const r of results) {
    if (r.success) {
      console.log(`x402: imported UTXO ${r.outpoint} → ${r.txid}`)
    } else {
      console.warn(`x402: failed to import UTXO ${r.outpoint}: ${r.error}`)
    }
  }
  if (results.some((r) => r.success)) {
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
  type:
    | 'unlock'
    | 'lock'
    | 'setup'
    | 'getState'
    | 'getAddress'
    | 'setNetwork'
    | 'setTier'
    | 'setWeapon'
    | 'pickup'
    | 'resetAutospend'
    | 'switchBackend'
    | 'getSpendStatus'
    | 'openPopupTab'
    | 'approvalResponse'
    | 'sendFunds'
    | 'verifyUtxos'
    | 'listTransactions'
    | 'adminListOutputs'
    | 'adminAbortNosend'
    | 'getRootKeyPreview'
    | 'adminExportWallet'
    | 'adminImportWallet'
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
      // Clamp autospend balance to actual wallet balance
      x402.clampToWallet(await getWalletBalance())
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
      if (payload.tier) x402.setTier(payload.tier, await getWalletBalance())
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
      if (payload?.tier) x402.setTier(payload.tier, await getWalletBalance())
      break
    }
    case 'setWeapon': {
      const payload = message.payload as { weapon: import('../../src/types').WeaponName } | undefined
      if (payload?.weapon) x402.setWeapon(payload.weapon)
      break
    }
    case 'pickup': {
      const payload = message.payload as { pickup: import('../../src/types').PickupName } | undefined
      if (payload?.pickup) x402.triggerPickup(payload.pickup, await getWalletBalance())
      break
    }
    case 'resetAutospend':
      x402.resetAutospend(await getWalletBalance())
      break

    case 'getState':
      break // just return composed state below

    case 'getAddress': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      const result = await backend.call('getPublicKey', { identityKey: true }, 'self') as { publicKey: string }
      const address = await pubkeyToAddress(result.publicKey)
      const walletState = await wallet.getWalletState()
      x402.clampToWallet(Number(walletState.balance) || 0)
      const x402State = x402.getX402State()
      return { ...walletState, ...x402State, identityKey: result.publicKey, address }
    }

    case 'switchBackend': {
      const payload = message.payload as { type: 'builtin' | 'external'; extensionId?: string } | undefined
      if (!payload?.type) throw new Error('Backend type required')
      await wallet.switchBackend(payload.type, payload.extensionId ? { extensionId: payload.extensionId } : undefined)
      break
    }

    case 'sendFunds': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const payload = message.payload as { address: string; amount: number } | undefined
      if (!payload?.address || !payload?.amount) throw new Error('Address and amount required')

      const amount = Math.floor(payload.amount)
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive integer')

      // Verify address checksum (async — catches typos before spending)
      await verifyBase58Checksum(payload.address)

      // Build P2PKH locking script
      const lockingScript = payeeAddressToLockingScript(payload.address)

      // Create and broadcast the transaction
      const backend = wallet.getBackend()
      const result = await backend.call('createAction', {
        outputs: [{
          satoshis: amount,
          lockingScript,
          outputDescription: `Send to ${payload.address}`,
        }],
        labels: ['wallet-send'],
        description: `Send ${amount} sats to ${payload.address}`,
        options: {
          noSend: false,
          returnTXIDOnly: false,
        },
      }, 'self') as { txid: string }

      const walletState = await wallet.getWalletState()
      if (wallet.isUnlocked() && walletState.balance !== undefined) {
        x402.clampToWallet(Number(walletState.balance) || 0)
      }
      const x402State = x402.getX402State()
      return { ...walletState, ...x402State, sendTxid: result.txid }
    }

    case 'verifyUtxos': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      const verifyResult = await verifyUtxos(backend, wallet.getNetwork())

      // Notify popup of balance change if any outputs were relinquished
      if (verifyResult.relinquished > 0) {
        chrome.runtime.sendMessage({ type: 'balanceUpdated' }).catch(() => {})
      }

      const walletState = await wallet.getWalletState()
      if (wallet.isUnlocked() && walletState.balance !== undefined) {
        x402.clampToWallet(Number(walletState.balance) || 0)
      }
      const x402State = x402.getX402State()
      return { ...walletState, ...x402State, verifyResult }
    }

    case 'listTransactions': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      const payload = message.payload as { offset?: number } | undefined
      const result = await backend.call('listActions', {
        labels: [],
        limit: 20,
        offset: payload?.offset ?? 0,
        includeLabels: true,
        includeInputs: true,
        includeOutputs: true,
      }, 'self') as { totalActions: number; actions: Array<{ txid: string; satoshis: number; status: string; isOutgoing: boolean; description: string; labels?: string[] }> }
      return { totalActions: result.totalActions, actions: result.actions }
    }

    case 'adminListOutputs': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      const params = (message.payload ?? {}) as Record<string, unknown>
      const outputsResult = await backend.call('listOutputs', params, 'self') as {
        totalOutputs: number
        outputs: Array<{ outpoint: string; satoshis: number; spendable: boolean; tags?: string[]; labels?: string[]; customInstructions?: string }>
      }

      // Fetch all actions to get transaction statuses
      // listActions requires labels — fetch with common labels, then all
      const actionsResult = await backend.call('listActions', {
        labels: [],
        includeOutputs: true,
        limit: 10000,
      }, 'self') as {
        totalActions: number
        actions: Array<{ txid: string; status: string; description: string; satoshis: number; isOutgoing: boolean; outputs?: Array<{ outputIndex: number }> }>
      }

      // Build txid → status map
      console.log(`[x402] adminListOutputs: ${actionsResult.totalActions} actions, ${actionsResult.actions.length} returned`)
      if (actionsResult.actions.length > 0) {
        console.log(`[x402] sample action:`, JSON.stringify(actionsResult.actions[0]))
      }
      const txStatusMap = new Map<string, { status: string; description: string; isOutgoing: boolean }>()
      for (const action of actionsResult.actions) {
        txStatusMap.set(action.txid, { status: action.status, description: action.description, isOutgoing: action.isOutgoing })
      }

      // Log unique txids from outputs vs actions for debugging
      const outputTxids = new Set(outputsResult.outputs.map(o => { const d = o.outpoint.lastIndexOf('.'); return d !== -1 ? o.outpoint.slice(0, d) : o.outpoint }))
      const actionTxids = new Set(actionsResult.actions.map(a => a.txid))
      const missing = [...outputTxids].filter(t => !actionTxids.has(t))
      if (missing.length > 0) console.warn(`[x402] ${missing.length} output txids not found in actions:`, missing)

      // Enrich outputs with parent tx status
      const enriched = outputsResult.outputs.map((o) => {
        const dotIdx = o.outpoint.lastIndexOf('.')
        const txid = dotIdx !== -1 ? o.outpoint.slice(0, dotIdx) : o.outpoint
        const txInfo = txStatusMap.get(txid)
        return {
          ...o,
          txid,
          txStatus: txInfo?.status ?? 'unknown',
          txDescription: txInfo?.description ?? '',
          txIsOutgoing: txInfo?.isOutgoing ?? false,
        }
      })

      return { totalOutputs: outputsResult.totalOutputs, outputs: enriched }
    }

    case 'adminAbortNosend': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const backend = wallet.getBackend()
      // specOpNoSendActions + 'abort' label aborts all nosend transactions via wallet-toolbox
      const SPEC_OP_NOSEND = 'ac6b20a3bb320adafecd637b25c84b792ad828d3aa510d05dc841481f664277d'
      const result = await backend.call('listActions', {
        labels: [SPEC_OP_NOSEND, 'abort'],
        limit: 10000,
      }, 'self') as { totalActions: number; actions: Array<{ txid: string; status: string }> }
      console.log(`[x402] adminAbortNosend: aborted ${result.totalActions} nosend transactions`)
      // Refresh balance
      chrome.runtime.sendMessage({ type: 'balanceUpdated' }).catch(() => {})
      const walletState = await wallet.getWalletState()
      return { aborted: result.totalActions, balance: walletState.balance }
    }

    case 'getRootKeyPreview': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const rootKey = wallet.getRootKeyHex()
      if (!rootKey) throw new Error('Root key not available')
      // Only expose first 4 + last 2 characters — never the full key
      const preview = rootKey.slice(0, 4) + '...' + rootKey.slice(-2)
      return { preview }
    }

    case 'adminExportWallet': {
      if (!wallet.isUnlocked()) throw new Error('Wallet is locked')
      const chain = wallet.getNetwork()
      const dbName = `x402-wallet-${chain}`
      const exportData = await exportIndexedDB(dbName)
      // Also export chaintracks database
      const chainTracksDbName = `chaintracks-${chain}net`
      let chainTracksData: Record<string, unknown[]> | null = null
      try {
        chainTracksData = await exportIndexedDB(chainTracksDbName)
      } catch {
        // Chaintracks DB may not exist yet — not critical
      }
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        chain,
        databases: {
          [dbName]: exportData,
          ...(chainTracksData ? { [chainTracksDbName]: chainTracksData } : {}),
        },
      }
      // Encode as JSON string (popup will handle the download)
      return { json: JSON.stringify(backup) }
    }

    case 'adminImportWallet': {
      // No unlock check — import must work when locked (recovery scenario)
      const importPayload = message.payload as { json: string } | undefined
      if (!importPayload?.json) throw new Error('No backup data provided')

      let backup: {
        version: number
        chain: string
        databases: Record<string, Record<string, unknown[]>>
      }
      try {
        backup = JSON.parse(importPayload.json)
      } catch {
        throw new Error('Invalid backup file — could not parse JSON')
      }

      if (!backup.version || !backup.databases) {
        throw new Error('Invalid backup file — missing version or databases')
      }

      // Import each database
      for (const [dbName, stores] of Object.entries(backup.databases)) {
        await importIndexedDB(dbName, stores)
      }

      // Ensure locked state so re-unlock picks up imported data
      if (wallet.isUnlocked()) wallet.lock()
      return { success: true, message: 'Wallet data imported. Please unlock to continue.' }
    }

    default:
      throw new Error(`Unknown message type: ${(message as InternalMessage).type}`)
  }

  // All internal messages return composed state from both controllers
  const walletState = await wallet.getWalletState()
  // Clamp autospend to wallet balance on every state fetch
  if (wallet.isUnlocked() && walletState.balance !== undefined) {
    x402.clampToWallet(Number(walletState.balance) || 0)
  }
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

      // Reset idle timer — wallet is actively being used
      chrome.alarms.create('auto-lock', { delayInMinutes: 60, periodInMinutes: 60 })

      handleCWIRequest(message, wallet.getBackend(), sender.tab?.id)
        .then((response) => {
          sendResponse(response)
          // Notify popup of potential balance change after CWI payment
          chrome.runtime.sendMessage({ type: 'balanceUpdated' }).catch(() => {})
        })
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
      sendResponse(x402.getSpendStatus())
      return true
    }

    // Approval response — only accepted from our own approve.html popup.
    // The id is a capability-bearing UUID, but we still validate the sender
    // URL to prevent any other extension page (or future content-script
    // relay) from resolving approvals.
    if (isInternalMessage(message) && message.type === 'approvalResponse') {
      const isFromApprovePopup = sender.id === chrome.runtime.id
        && sender.url?.startsWith(chrome.runtime.getURL('ui/x402/approve.html'))
      if (!isFromApprovePopup) {
        sendResponse({ ok: false, error: 'Unauthorised sender' })
        return true
      }
      const payload = message.payload as { id?: string; approved?: boolean } | undefined
      if (payload?.id && typeof payload.approved === 'boolean') {
        resolveApproval(payload.id, payload.approved)
      }
      sendResponse({ ok: true })
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
          if (testConfig.tier) x402.setTier(testConfig.tier, await getWalletBalance())
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
// IndexedDB export/import helpers — used for wallet backup/restore
// ---------------------------------------------------------------------------

/**
 * Export all object stores from an IndexedDB database as a JSON-friendly object.
 * Dynamically enumerates stores rather than hardcoding names.
 */
function exportIndexedDB(dbName: string): Promise<Record<string, unknown[]>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onerror = () => reject(new Error(`Failed to open database: ${dbName}`))
    request.onsuccess = () => {
      const db = request.result
      const storeNames = Array.from(db.objectStoreNames)
      if (storeNames.length === 0) {
        db.close()
        resolve({})
        return
      }

      const result: Record<string, unknown[]> = {}
      let completed = 0

      const tx = db.transaction(storeNames, 'readonly')
      tx.onerror = () => {
        db.close()
        reject(new Error(`Transaction failed while reading ${dbName}`))
      }

      for (const storeName of storeNames) {
        const store = tx.objectStore(storeName)
        const getAllReq = store.getAll()
        getAllReq.onsuccess = () => {
          result[storeName] = getAllReq.result
          completed++
          if (completed === storeNames.length) {
            db.close()
            resolve(result)
          }
        }
        getAllReq.onerror = () => {
          db.close()
          reject(new Error(`Failed to read store: ${storeName}`))
        }
      }
    }
  })
}

/**
 * Import data into an IndexedDB database, clearing existing stores first.
 * Opens the database (which must already exist with the correct schema)
 * and replaces all data in the matching object stores.
 */
function importIndexedDB(dbName: string, stores: Record<string, unknown[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onerror = () => reject(new Error(`Failed to open database: ${dbName}`))
    request.onsuccess = () => {
      const db = request.result
      const existingStores = Array.from(db.objectStoreNames)
      const storeNames = Object.keys(stores).filter((name) => existingStores.includes(name))

      if (storeNames.length === 0) {
        db.close()
        resolve()
        return
      }

      const tx = db.transaction(storeNames, 'readwrite')
      tx.onerror = () => {
        db.close()
        reject(new Error(`Transaction failed while writing to ${dbName}`))
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }

      for (const storeName of storeNames) {
        const store = tx.objectStore(storeName)
        // Clear existing data before importing
        store.clear()
        for (const record of stores[storeName]) {
          store.put(record)
        }
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Auto-lock after 60 minutes of idle
// ---------------------------------------------------------------------------

chrome.alarms.create('auto-lock', { delayInMinutes: 60, periodInMinutes: 60 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock' && wallet.isUnlocked()) {
    wallet.lock()
    console.log('x402: wallet auto-locked after idle timeout')
  }
})

// ---------------------------------------------------------------------------
// Treat closing the approval popup as a deny
// ---------------------------------------------------------------------------

chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowClosed(windowId)
})
