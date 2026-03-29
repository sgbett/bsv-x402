/// <reference types="chrome" />

import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import { handleCWIRequest, type CWIHandlerContext } from './cwi'
import { ExtensionStorageAdapter } from './storage-bridge'
import { RateLimiter, resolveSpendLimits } from '../../src/limits'
import type { Challenge, LimitCheckResult, SpendMode, TierName } from '../../src/types'

// ---------------------------------------------------------------------------
// Session state (placeholder — real SessionManager from key-manager.ts will
// be wired in later)
// ---------------------------------------------------------------------------

let sessionSeed: string | null = null
let walletNetwork = 'main'
let currentTier: TierName = 'Hey, Not Too Rough'
let currentMode: SpendMode = 'interactive'

const context: CWIHandlerContext = {
  getSeed: () => {
    if (!sessionSeed) throw new Error('Wallet is locked')
    return sessionSeed
  },
  isUnlocked: () => sessionSeed !== null,
  getNetwork: () => walletNetwork,
}

// ---------------------------------------------------------------------------
// Spend limits integration
// ---------------------------------------------------------------------------

const storage = new ExtensionStorageAdapter()
let limiter: RateLimiter | null = null

async function ensureLimiter(): Promise<RateLimiter> {
  if (limiter) return limiter
  const limits = resolveSpendLimits(currentTier, currentMode)
  const state = await storage.load()
  limiter = new RateLimiter(limits, state ?? undefined)
  return limiter
}

async function persistLimiter(rl: RateLimiter): Promise<void> {
  await storage.save(rl.getState())
}

/** Check spend limits before a payment. Returns null if allowed, error string if blocked. */
export async function checkSpendLimits(challenge: Challenge, origin: string): Promise<{ allowed: boolean; reason?: string }> {
  const rl = await ensureLimiter()
  const result: LimitCheckResult = rl.check(challenge, origin)

  if (result.action === 'allow') return { allowed: true }
  if (result.action === 'yellow-light') {
    // TODO: open approve.html popup for user confirmation
    return { allowed: true } // permissive for now
  }
  if (result.action === 'block') {
    if (result.severity === 'trip') {
      rl.trip()
      await persistLimiter(rl)
    }
    return { allowed: false, reason: result.reason }
  }
  return { allowed: true }
}

/** Record a completed payment in the rate limiter. */
export async function recordPayment(origin: string, satoshis: number, txid: string): Promise<void> {
  const rl = await ensureLimiter()
  rl.record({ timestamp: Date.now(), origin, satoshis, txid })
  await persistLimiter(rl)
}

// ---------------------------------------------------------------------------
// Internal messages from popup / setup UI
// ---------------------------------------------------------------------------

interface InternalMessage {
  type: 'unlock' | 'lock' | 'setup' | 'getState' | 'setNetwork' | 'setTier'
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
      return { isUnlocked: context.isUnlocked(), network: walletNetwork, tier: currentTier }

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

    case 'setTier': {
      const payload = message.payload as { tier: TierName } | undefined
      if (payload?.tier) {
        currentTier = payload.tier
        limiter = null // reset limiter so it picks up new tier
        console.log(`x402: tier changed to "${currentTier}"`)
      }
      return { id: '', status: 'ok', result: { tier: currentTier } }
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
