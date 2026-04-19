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
  { delayMs = 500, initialBackoffMs = 2000, maxRetries = 4 } = {},
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

  let currentBackoff = initialBackoffMs

  for (const output of spendable) {
    const dotIdx = output.outpoint.lastIndexOf('.')
    if (dotIdx === -1) { result.failed++; continue }
    const txid = output.outpoint.slice(0, dotIdx)
    const vout = parseInt(output.outpoint.slice(dotIdx + 1), 10)
    if (isNaN(vout)) { result.failed++; continue }

    // Retry loop with exponential backoff on rate limits
    let checked = false
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const spent = await checkOutpointSpent(txid, vout, network)
        result.checked++
        checked = true
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
        // Reset backoff on success
        currentBackoff = initialBackoffMs
        break
      } catch (err) {
        if (err instanceof WocRateLimitError && attempt < maxRetries) {
          console.warn(`[x402] verifyUtxos: rate-limited, backing off ${currentBackoff}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise((r) => setTimeout(r, currentBackoff))
          currentBackoff = Math.min(currentBackoff * 2, 30_000)
        } else if (err instanceof WocRateLimitError) {
          console.warn(`[x402] verifyUtxos: rate limit persists after ${maxRetries} retries, skipping output`)
          result.failed++
          break
        } else {
          console.warn(`[x402] verifyUtxos lookup failed:`, err)
          result.failed++
          break
        }
      }
    }

    // Pace requests to stay within WoC rate limits
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }

  return result
}
