import type { WalletBackend } from './wallet-backend'
import { checkOutpointSpent, WocRateLimitError, type WocNetwork } from './check-outpoint-spent'

export interface VerifyResult {
  checked: number
  relinquished: number
  failed: number
}

/**
 * Verify all spendable outputs in the default basket against the chain.
 * Relinquishes any outputs confirmed spent on-chain.
 *
 * Safety: only relinquishes on confirmed spent (checkOutpointSpent returns true).
 * Errors and timeouts are counted as failures — never relinquished.
 */
export async function verifyUtxos(
  backend: WalletBackend,
  network: WocNetwork,
  { delayMs = 500, backoffMs = 2000 } = {},
): Promise<VerifyResult> {
  const result: VerifyResult = { checked: 0, relinquished: 0, failed: 0 }

  // List all spendable outputs from the default basket
  const { outputs } = await backend.call('listOutputs', {
    basket: 'default',
    limit: 10000, // effectively "all" — wallets rarely exceed this
  }, 'self') as { totalOutputs: number; outputs: Array<{ outpoint: string; satoshis: number; spendable: boolean }> }

  const spendable = outputs.filter((o) => o.spendable)
  console.log(`[x402] verifyUtxos: ${outputs.length} outputs, ${spendable.length} spendable, network=${network}`)
  if (spendable.length === 0) return result

  // Sequential verification with delay — WoC free tier limits to ~3 req/s

  for (const output of spendable) {
    const dotIdx = output.outpoint.lastIndexOf('.')
    if (dotIdx === -1) { result.failed++; continue }
    const txid = output.outpoint.slice(0, dotIdx)
    const vout = parseInt(output.outpoint.slice(dotIdx + 1), 10)
    if (isNaN(vout)) { result.failed++; continue }

    try {
      const spent = await checkOutpointSpent(txid, vout, network)
      result.checked++
      if (spent) {
        try {
          await backend.call('relinquishOutput', {
            basket: 'default',
            output: output.outpoint,
          }, 'self')
          result.relinquished++
        } catch {
          result.failed++
        }
      }
    } catch (err) {
      if (err instanceof WocRateLimitError) {
        // Back off and retry once after 2s
        console.warn(`[x402] verifyUtxos: rate-limited, backing off ${backoffMs}ms`)
        if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs))
        try {
          const spent = await checkOutpointSpent(txid, vout, network)
          result.checked++
          if (spent) {
            try {
              await backend.call('relinquishOutput', {
                basket: 'default',
                output: output.outpoint,
              }, 'self')
              result.relinquished++
            } catch {
              result.failed++
            }
          }
        } catch (retryErr) {
          console.warn(`[x402] verifyUtxos: retry failed, stopping`, retryErr)
          break
        }
      } else {
        console.warn(`[x402] verifyUtxos lookup failed:`, err)
        result.failed++
      }
    }

    // Pace requests to stay within WoC rate limits
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }

  return result
}
