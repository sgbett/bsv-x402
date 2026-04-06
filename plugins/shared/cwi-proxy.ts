import type { ContentToBackgroundMessage, CWIResponse } from './messages'
import type { WalletBackend } from './wallet-backend'
import { checkSpendLimits, recordPayment, getSpendStatus } from './x402-controller'
import { requestApproval } from './pending-approvals'
import type { PaymentRequest } from '../../src/types'

// ---------------------------------------------------------------------------
// CWI proxy — autospend middleware before wallet backend calls
//
// For createAction: extract total satoshis, check autospend, prompt user
// if confirmation is required, delegate to the wallet backend, then record
// the payment on success. All other methods pass straight through.
// ---------------------------------------------------------------------------

export async function handleCWIRequest(
  message: ContentToBackgroundMessage,
  backend: WalletBackend,
  senderTabId?: number,
): Promise<CWIResponse> {
  const { request } = message
  const origin = message.origin

  try {
    // Spending check — only on createAction (the method that commits satoshis)
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

      const check = checkSpendLimits(paymentRequest)
      if (!check.allowed) {
        if (check.requiresConfirmation) {
          // Payment exceeds autospend — prompt the user
          const approved = await requestApproval({ amount: validatedSatoshis, origin })
          if (!approved) {
            return { id: request.id, status: 'error', error: 'Payment denied by user' }
          }
          // User approved — proceed
        } else {
          return { id: request.id, status: 'error', error: check.reason ?? 'Payment blocked' }
        }
      }
    }

    // Delegate to wallet backend
    const result = await backend.call(request.method, request.params, origin)

    // Record payment on successful createAction — reuse the validated total
    if (request.method === 'createAction' && result != null && validatedSatoshis !== undefined) {
      const actionResult = result as { txid?: string }
      if (actionResult.txid) {
        recordPayment(validatedSatoshis)

        // Push spend update to the originating tab's indicator
        if (senderTabId !== undefined) {
          const status = getSpendStatus()
          chrome.tabs.sendMessage(senderTabId, { type: 'spendUpdated', status }, () => {
            // Best-effort update — suppress unchecked lastError warnings
            void chrome.runtime?.lastError
          })
        }
      }
    }

    return { id: request.id, status: 'ok', result }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { id: request.id, status: 'error', error: errorMessage }
  }
}
