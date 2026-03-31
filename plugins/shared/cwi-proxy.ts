import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import type { WalletBackend } from './wallet-backend'
import { checkSpendLimits, recordPayment, getSpendStatus } from './x402-controller'
import type { Challenge } from '../../src/types'

// ---------------------------------------------------------------------------
// CWI proxy — spending limits middleware before wallet backend calls
//
// For createAction: extract total satoshis, check spend limits, delegate
// to the wallet backend, then record the payment on success.
// All other methods pass straight through.
// ---------------------------------------------------------------------------

export async function handleCWIRequest(
  message: ContentToBackgroundMessage,
  backend: WalletBackend,
  senderTabId?: number,
): Promise<CWIResponse> {
  const { request } = message
  const origin = message.origin

  try {
    // Spending limits check — only on createAction (the method that commits satoshis)
    if (request.method === 'createAction') {
      const params = request.params as { outputs?: Array<{ satoshis: number }> } | undefined
      const totalSatoshis = (params?.outputs ?? []).reduce((sum, o) => sum + (o.satoshis ?? 0), 0)

      const challenge: Challenge = {
        nonce: request.id,
        payee: '',
        amount: totalSatoshis,
        network: 'main',
      }

      const limitCheck = await checkSpendLimits(challenge, origin)
      if (!limitCheck.allowed) {
        return { id: request.id, status: 'error', error: limitCheck.reason ?? 'Spending limit exceeded' }
      }
    }

    // Delegate to wallet backend
    const result = await backend.call(request.method, request.params, origin)

    // Record payment on successful createAction
    if (request.method === 'createAction' && result != null) {
      const actionResult = result as { txid?: string }
      if (actionResult.txid) {
        const params = request.params as { outputs?: Array<{ satoshis: number }> } | undefined
        const totalSatoshis = (params?.outputs ?? []).reduce((sum, o) => sum + (o.satoshis ?? 0), 0)
        await recordPayment(origin, totalSatoshis, actionResult.txid)

        // Push spend update to the originating tab's indicator
        if (senderTabId !== undefined) {
          getSpendStatus().then((status) => {
            chrome.tabs.sendMessage(senderTabId, { type: 'spendUpdated', status }).catch(() => {})
          }).catch(() => {})
        }
      }
    }

    return { id: request.id, status: 'ok', result }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { id: request.id, status: 'error', error: errorMessage }
  }
}
