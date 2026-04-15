import type { WalletBackend } from './wallet-backend'
import { checkOutpointSpent, type WocNetwork } from './check-outpoint-spent'

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
): Promise<VerifyResult> {
  const result: VerifyResult = { checked: 0, relinquished: 0, failed: 0 }

  // List all spendable outputs from the default basket
  const { outputs } = await backend.call('listOutputs', {
    basket: 'default',
    limit: 10000,
  }, 'self') as { totalOutputs: number; outputs: Array<{ outpoint: string; satoshis: number; spendable: boolean }> }

  const spendable = outputs.filter((o) => o.spendable)
  if (spendable.length === 0) return result

  // Throttled chain verification — 5 concurrent lookups max
  const CONCURRENCY = 5
  let rateLimited = false

  for (let i = 0; i < spendable.length && !rateLimited; i += CONCURRENCY) {
    const batch = spendable.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (output) => {
        const dotIdx = output.outpoint.lastIndexOf('.')
        if (dotIdx === -1) throw new Error(`Invalid outpoint format: ${output.outpoint}`)
        const txid = output.outpoint.slice(0, dotIdx)
        const vout = parseInt(output.outpoint.slice(dotIdx + 1), 10)
        if (isNaN(vout)) throw new Error(`Invalid vout in outpoint: ${output.outpoint}`)

        const spent = await checkOutpointSpent(txid, vout, network)
        return { outpoint: output.outpoint, spent }
      }),
    )

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        result.checked++
        if (r.value.spent) {
          try {
            await backend.call('relinquishOutput', {
              basket: 'default',
              output: r.value.outpoint,
            }, 'self')
            result.relinquished++
          } catch {
            result.failed++
          }
        }
      } else {
        // Check if rate-limited — stop processing further batches
        if (r.reason instanceof Error && r.reason.message.includes('429')) {
          rateLimited = true
        }
        result.failed++
      }
    }
  }

  return result
}
