import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import type { WalletBackend } from './wallet-backend'
import { checkSpendLimits, recordPayment, getSpendStatus } from './x402-controller'
import type { PaymentRequest } from '../../src/types'

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
    let validatedSatoshis: number | undefined
    if (request.method === 'createAction') {
      const params = request.params as { outputs?: Array<{ satoshis: unknown }> } | undefined
      const outputs = params?.outputs

      if (!Array.isArray(outputs) || outputs.length === 0) {
        return { id: request.id, status: 'error', error: 'Missing or empty outputs for createAction' }
      }

      // Validate each output's satoshis — must be a positive safe integer, total must stay safe
      let total = 0
      for (const o of outputs) {
        if (typeof o.satoshis !== 'number' || !Number.isSafeInteger(o.satoshis) || o.satoshis <= 0) {
          return { id: request.id, status: 'error', error: 'Invalid satoshis value in outputs' }
        }
        total += o.satoshis
        if (!Number.isSafeInteger(total)) {
          return { id: request.id, status: 'error', error: 'Total satoshis exceeds safe integer range' }
        }
      }
      validatedSatoshis = total

      const paymentRequest: PaymentRequest = {
        amount: validatedSatoshis,
        origin,
        protocol: 'x402',
      }

      const limitCheck = await checkSpendLimits(paymentRequest, origin)
      if (!limitCheck.allowed) {
        return { id: request.id, status: 'error', error: limitCheck.reason ?? 'Spending limit exceeded' }
      }
    }

    // Delegate to wallet backend
    const result = await backend.call(request.method, request.params, origin)

    // Record payment on successful createAction — reuse the validated total
    if (request.method === 'createAction' && result != null && validatedSatoshis !== undefined) {
      const actionResult = result as { txid?: string }
      if (actionResult.txid) {
        await recordPayment(origin, validatedSatoshis, actionResult.txid)

        // Push spend update to the originating tab's indicator
        if (senderTabId !== undefined) {
          getSpendStatus().then((status) => {
            chrome.tabs.sendMessage(senderTabId, { type: 'spendUpdated', status }, () => {
              // Best-effort update — suppress unchecked lastError warnings
              void chrome.runtime?.lastError
            })
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
