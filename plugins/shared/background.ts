/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest } from './cwi-proxy'
import * as wallet from './wallet-controller'
import * as x402 from './x402-controller'
import * as registry from './wallet-registry-controller'
import { TransactionLog } from '../../src/transaction-log'
import { ExtensionTransactionLogStorage } from './storage-bridge'

// ---------------------------------------------------------------------------
// Transaction log (singleton for the extension)
// ---------------------------------------------------------------------------

const txLog = new TransactionLog(new ExtensionTransactionLogStorage())

// ---------------------------------------------------------------------------
// Message type guards
// ---------------------------------------------------------------------------

interface InternalMessage {
  type:
    | 'unlock' | 'lock' | 'setup' | 'getState' | 'setNetwork' | 'setTier'
    | 'switchBackend' | 'getSpendStatus' | 'openPopupTab'
    // Multi-wallet messages
    | 'listWallets' | 'createWallet' | 'updateWallet' | 'removeWallet'
    | 'selectWallet' | 'getTransactionLog' | 'configureSyncProvider'
    | 'syncTransactions'
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
    // Wallet concerns (now wallet-id-aware)
    case 'unlock': {
      const payload = message.payload as { password: string; walletId?: string } | undefined
      if (!payload?.password) throw new Error('Password required')
      const walletId = payload.walletId ?? wallet.getActiveWalletId()
      if (!walletId) throw new Error('No wallet selected')
      await wallet.unlock(walletId, payload.password)
      break
    }
    case 'lock': {
      const payload = message.payload as { walletId?: string } | undefined
      wallet.lock(payload?.walletId ?? undefined)
      break
    }
    case 'setup': {
      const payload = message.payload as {
        seed: string; password: string; tier?: import('../../src/types').TierName
        walletId?: string; walletName?: string
      } | undefined
      if (!payload?.password || !payload?.seed) throw new Error('Seed and password required')

      // Create wallet profile if it doesn't exist
      let walletId = payload.walletId
      if (!walletId) {
        const profile = await registry.createWallet({
          name: payload.walletName ?? 'Main Wallet',
          mode: 'manual',
          backendType: 'builtin',
          tier: payload.tier,
          isDefault: true,
        })
        walletId = profile.id
      }

      await wallet.setup(walletId, payload.seed, payload.password)
      if (payload.tier) {
        x402.setWalletTier(walletId, payload.tier)
        x402.setTier(payload.tier)
      }
      break
    }
    case 'setNetwork': {
      const payload = message.payload as { network: string } | undefined
      if (payload?.network) wallet.setNetwork(payload.network)
      break
    }

    // x402 concerns
    case 'setTier': {
      const payload = message.payload as { tier: import('../../src/types').TierName; walletId?: string } | undefined
      if (payload?.tier) {
        if (payload.walletId) {
          x402.setWalletTier(payload.walletId, payload.tier)
        } else {
          x402.setTier(payload.tier)
        }
      }
      break
    }

    case 'getState':
      break // just return composed state below

    case 'switchBackend': {
      const payload = message.payload as { type: 'builtin' | 'external'; extensionId?: string; walletId?: string } | undefined
      if (!payload?.type) throw new Error('Backend type required')
      const walletId = payload.walletId ?? wallet.getActiveWalletId()
      if (!walletId) throw new Error('No wallet selected')
      await wallet.switchBackendForWallet(walletId, payload.type, payload.extensionId ? { extensionId: payload.extensionId } : undefined)
      break
    }

    // === Multi-wallet management ===

    case 'listWallets': {
      const wallets = await registry.listWallets()
      return { wallets }
    }
    case 'createWallet': {
      const payload = message.payload as import('../../src/wallet-registry').CreateWalletOptions | undefined
      if (!payload?.name || !payload?.mode) throw new Error('name and mode required')
      const profile = await registry.createWallet(payload)
      return { wallet: profile }
    }
    case 'updateWallet': {
      const payload = message.payload as { walletId: string; updates: Record<string, unknown> } | undefined
      if (!payload?.walletId) throw new Error('walletId required')
      const updated = await registry.updateWallet(payload.walletId, payload.updates)
      return { wallet: updated }
    }
    case 'removeWallet': {
      const payload = message.payload as { walletId: string } | undefined
      if (!payload?.walletId) throw new Error('walletId required')
      await registry.removeWallet(payload.walletId)
      return { removed: true }
    }
    case 'selectWallet': {
      const payload = message.payload as { walletId: string } | undefined
      if (!payload?.walletId) throw new Error('walletId required')
      wallet.setActiveWallet(payload.walletId)
      return { activeWalletId: payload.walletId }
    }

    // === Transaction log / accounting ===

    case 'getTransactionLog': {
      const payload = message.payload as {
        walletId?: string; origin?: string; since?: number; until?: number; limit?: number
      } | undefined
      const records = await txLog.query(payload)
      return { records }
    }
    case 'configureSyncProvider': {
      const payload = message.payload as import('../../src/types').SyncConfig | undefined
      if (!payload?.provider) throw new Error('provider required')
      await txLog.configureSyncProvider(payload)
      return { configured: true }
    }
    case 'syncTransactions': {
      const result = await txLog.sync()
      return { ...result }
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

      // Select the best wallet for this origin + route to its backend
      const origin = message.origin
      registry.selectWalletForOrigin(origin).then((selectedWallet) => {
        const walletId = selectedWallet?.id ?? wallet.getActiveWalletId() ?? undefined
        const backend = wallet.getBackend(walletId)

        return handleCWIRequest(message, backend, sender.tab?.id, walletId)
      })
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
      const payload = message.payload as { walletId?: string } | undefined
      x402.getSpendStatus(payload?.walletId ?? wallet.getActiveWalletId() ?? undefined)
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

// Ensure default wallet profile exists + restore backend choices
Promise.all([
  registry.ensureDefaultWalletExists(),
  wallet.restoreBackendChoice(),
]).catch((err) => {
  console.warn('x402: startup initialisation failed:', err)
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
          // Create a default wallet profile for test setup
          const defaultWallet = await registry.getDefaultWallet()
          const walletId = defaultWallet?.id ?? (await registry.createWallet({
            name: 'Test Wallet',
            mode: 'manual',
            backendType: 'builtin',
            isDefault: true,
          })).id

          await wallet.setup(walletId, testConfig.rootKeyHex, testConfig.password)
          if (testConfig.chain) wallet.setNetwork(testConfig.chain)
          if (testConfig.tier) {
            x402.setWalletTier(walletId, testConfig.tier)
            x402.setTier(testConfig.tier)
          }
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
  } else if (details.reason === 'update') {
    // On update, migrate legacy single-wallet to multi-wallet
    registry.getDefaultWallet().then(async (defaultWallet) => {
      if (defaultWallet) {
        await wallet.migrateLegacyWallet(defaultWallet.id)
      }
    }).catch((err) => {
      console.warn('x402: legacy migration failed:', err)
    })
    console.log(`x402: extension updated (reason: ${details.reason})`)
  }
})

// ---------------------------------------------------------------------------
// Auto-lock after 15 minutes of idle
// ---------------------------------------------------------------------------

chrome.alarms.create('auto-lock', { periodInMinutes: 15 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock' && wallet.anyUnlocked()) {
    wallet.lock()
    console.log('x402: all wallets auto-locked after idle timeout')
  }
})
