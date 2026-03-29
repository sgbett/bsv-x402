/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest, type CWIHandlerContext } from './cwi'

// ---------------------------------------------------------------------------
// Session state (placeholder — real SessionManager from key-manager.ts will
// be wired in later)
// ---------------------------------------------------------------------------

let sessionSeed: string | null = null
let walletNetwork = 'main'

const context: CWIHandlerContext = {
  getSeed: () => {
    if (!sessionSeed) throw new Error('Wallet is locked')
    return sessionSeed
  },
  isUnlocked: () => sessionSeed !== null,
  getNetwork: () => walletNetwork,
}

// ---------------------------------------------------------------------------
// Internal messages from popup / setup UI
// ---------------------------------------------------------------------------

interface InternalMessage {
  type: 'unlock' | 'lock' | 'setup' | 'getState' | 'setNetwork'
  payload?: unknown
}

function isInternalMessage(msg: unknown): msg is InternalMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg
}

function isCWIMessage(msg: unknown): msg is ContentToBackgroundMessage {
  return typeof msg === 'object' && msg !== null && 'request' in msg
}

function handleInternalMessage(message: InternalMessage): CWIResponse | Record<string, unknown> {
  switch (message.type) {
    case 'unlock': {
      const payload = message.payload as { password: string } | undefined
      if (!payload?.password) {
        return { id: '', status: 'error', error: 'Password required' }
      }
      // TODO: use SessionManager to derive seed from password
      sessionSeed = 'placeholder-seed'
      console.log('x402: wallet unlocked')
      return { id: '', status: 'ok', result: { unlocked: true } }
    }

    case 'lock':
      sessionSeed = null
      console.log('x402: wallet locked')
      return { id: '', status: 'ok', result: { unlocked: false } }

    case 'getState':
      return { isUnlocked: context.isUnlocked(), network: walletNetwork }

    case 'setNetwork': {
      const payload = message.payload as { network: string } | undefined
      if (payload?.network) {
        walletNetwork = payload.network
      }
      return { id: '', status: 'ok', result: { network: walletNetwork } }
    }

    case 'setup': {
      const payload = message.payload as { password: string } | undefined
      if (!payload?.password) {
        return { id: '', status: 'error', error: 'Password required' }
      }
      // TODO: real key generation via SessionManager
      sessionSeed = 'new-wallet-seed'
      console.log('x402: wallet set up')
      return { id: '', status: 'ok', result: { unlocked: true } }
    }

    default:
      return { id: '', status: 'error', error: `Unknown message type: ${(message as InternalMessage).type}` }
  }
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

      handleCWIRequest(message, context)
        .then((response) => sendResponse(response))
        .catch((err) => {
          sendResponse({
            id: message.request.id,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          } satisfies CWIResponse)
        })

      return true // keep the message channel open for async sendResponse
    }

    // Route internal messages from popup / setup UI (no sender.tab)
    if (isInternalMessage(message)) {
      const response = handleInternalMessage(message)
      sendResponse(response)
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/setup.html') })
    console.log('x402: extension installed — opening setup page')
  } else {
    console.log(`x402: extension updated (reason: ${details.reason})`)
  }
})

// ---------------------------------------------------------------------------
// Auto-lock after 15 minutes of idle
// ---------------------------------------------------------------------------

chrome.alarms.create('auto-lock', { periodInMinutes: 15 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock' && sessionSeed) {
    // Only lock if idle — for now always lock on timer
    sessionSeed = null
    console.log('x402: wallet auto-locked after idle timeout')
  }
})
