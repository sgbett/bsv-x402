/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest } from './cwi-proxy'
import * as wallet from './wallet-controller'
import * as x402 from './x402-controller'

// ---------------------------------------------------------------------------
// Message type guards
// ---------------------------------------------------------------------------

interface InternalMessage {
  type: 'unlock' | 'lock' | 'setup' | 'getState' | 'setNetwork' | 'setTier' | 'switchBackend' | 'getSpendStatus' | 'openPopupTab'
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
