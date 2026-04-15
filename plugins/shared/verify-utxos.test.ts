import { describe, expect, it, vi, beforeEach } from 'vitest'
import { verifyUtxos } from './verify-utxos'
import type { WalletBackend } from './wallet-backend'
import * as checkModule from './check-outpoint-spent'

// Mock checkOutpointSpent so we don't hit the network
vi.mock('./check-outpoint-spent', async (importOriginal) => {
  const actual = await importOriginal<typeof checkModule>()
  return {
    ...actual,
    checkOutpointSpent: vi.fn(),
  }
})

const checkOutpointSpent = vi.mocked(checkModule.checkOutpointSpent)

function makeOutput(txid: string, vout: number, satoshis = 1000) {
  return { outpoint: `${txid}.${vout}`, satoshis, spendable: true }
}

const TX1 = 'aabb'.repeat(16)
const TX2 = 'ccdd'.repeat(16)
const TX3 = 'eeff'.repeat(16)

/** Skip inter-request delay in tests */
const opts = { delayMs: 0, backoffMs: 0 }

describe('verifyUtxos', () => {
  let backend: WalletBackend
  let callSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    callSpy = vi.fn()
    backend = {
      call: callSpy,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      hasOwnUI: vi.fn().mockReturnValue(false),
    }
  })

  it('returns zeroes when no outputs exist', async () => {
    callSpy.mockResolvedValueOnce({ totalOutputs: 0, outputs: [] })

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 0, relinquished: 0, failed: 0 })
    expect(checkOutpointSpent).not.toHaveBeenCalled()
  })

  it('returns zeroes when all outputs are non-spendable', async () => {
    callSpy.mockResolvedValueOnce({
      totalOutputs: 1,
      outputs: [{ outpoint: `${TX1}.0`, satoshis: 1000, spendable: false }],
    })

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 0, relinquished: 0, failed: 0 })
    expect(checkOutpointSpent).not.toHaveBeenCalled()
  })

  it('checks spendable outputs and does not relinquish unspent ones', async () => {
    callSpy.mockResolvedValueOnce({
      totalOutputs: 2,
      outputs: [makeOutput(TX1, 0), makeOutput(TX2, 1)],
    })
    checkOutpointSpent.mockResolvedValue(false)

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 2, relinquished: 0, failed: 0 })
    expect(checkOutpointSpent).toHaveBeenCalledTimes(2)
    // Should NOT have called relinquishOutput
    expect(callSpy).toHaveBeenCalledTimes(1) // only listOutputs
  })

  it('relinquishes outputs confirmed spent on-chain', async () => {
    callSpy
      .mockResolvedValueOnce({
        totalOutputs: 2,
        outputs: [makeOutput(TX1, 0), makeOutput(TX2, 1)],
      })
      .mockResolvedValue({ relinquished: true }) // relinquishOutput responses

    checkOutpointSpent
      .mockResolvedValueOnce(true)  // TX1.0 spent
      .mockResolvedValueOnce(false) // TX2.1 unspent

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 2, relinquished: 1, failed: 0 })
    expect(callSpy).toHaveBeenCalledWith('relinquishOutput', {
      basket: 'default',
      output: `${TX1}.0`,
    }, 'self')
  })

  it('counts relinquishOutput failures without stopping', async () => {
    callSpy
      .mockResolvedValueOnce({
        totalOutputs: 2,
        outputs: [makeOutput(TX1, 0), makeOutput(TX2, 1)],
      })
      .mockRejectedValueOnce(new Error('relinquish failed')) // TX1 relinquish fails
      .mockResolvedValueOnce({ relinquished: true })          // TX2 relinquish succeeds

    checkOutpointSpent.mockResolvedValue(true) // both spent

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 2, relinquished: 1, failed: 1 })
  })

  it('does not relinquish on chain lookup error', async () => {
    callSpy.mockResolvedValueOnce({
      totalOutputs: 1,
      outputs: [makeOutput(TX1, 0)],
    })
    checkOutpointSpent.mockRejectedValueOnce(new Error('network error'))

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 0, relinquished: 0, failed: 1 })
    // Should NOT have called relinquishOutput
    expect(callSpy).toHaveBeenCalledTimes(1)
  })

  it('retries once on rate limit then continues', async () => {
    const outputs = Array.from({ length: 3 }, (_, i) => makeOutput(TX1, i))
    callSpy.mockResolvedValueOnce({ totalOutputs: 3, outputs })

    checkOutpointSpent
      .mockResolvedValueOnce(false) // output 0: unspent
      .mockRejectedValueOnce(new checkModule.WocRateLimitError()) // output 1: rate-limited
      .mockResolvedValueOnce(false) // output 1 retry: unspent
      .mockResolvedValueOnce(false) // output 2: unspent

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result.checked).toBe(3)
    expect(result.failed).toBe(0)
    expect(checkOutpointSpent).toHaveBeenCalledTimes(4) // 3 outputs + 1 retry
  })

  it('stops after retry also hits rate limit', async () => {
    const outputs = Array.from({ length: 5 }, (_, i) => makeOutput(TX1, i))
    callSpy.mockResolvedValueOnce({ totalOutputs: 5, outputs })

    checkOutpointSpent
      .mockResolvedValueOnce(false) // output 0: unspent
      .mockRejectedValueOnce(new checkModule.WocRateLimitError()) // output 1: rate-limited
      .mockRejectedValueOnce(new checkModule.WocRateLimitError()) // output 1 retry: still limited

    const result = await verifyUtxos(backend, 'main', opts)

    // Checked output 0, then rate-limited twice on output 1 — stops
    expect(result.checked).toBe(1)
    expect(result.failed).toBe(0)
    expect(checkOutpointSpent).toHaveBeenCalledTimes(3)
  })

  it('passes correct network to checkOutpointSpent', async () => {
    callSpy.mockResolvedValueOnce({
      totalOutputs: 1,
      outputs: [makeOutput(TX1, 3)],
    })
    checkOutpointSpent.mockResolvedValueOnce(false)

    await verifyUtxos(backend, 'test', opts)

    expect(checkOutpointSpent).toHaveBeenCalledWith(TX1, 3, 'test')
  })

  it('parses outpoint format correctly (txid.vout)', async () => {
    callSpy.mockResolvedValueOnce({
      totalOutputs: 1,
      outputs: [makeOutput(TX3, 42)],
    })
    checkOutpointSpent.mockResolvedValueOnce(false)

    await verifyUtxos(backend, 'main', opts)

    expect(checkOutpointSpent).toHaveBeenCalledWith(TX3, 42, 'main')
  })

  it('handles mixed results correctly', async () => {
    callSpy
      .mockResolvedValueOnce({
        totalOutputs: 3,
        outputs: [makeOutput(TX1, 0), makeOutput(TX2, 1), makeOutput(TX3, 2)],
      })
      .mockResolvedValue({ relinquished: true }) // relinquishOutput

    checkOutpointSpent
      .mockResolvedValueOnce(true)   // TX1 spent
      .mockResolvedValueOnce(false)  // TX2 unspent
      .mockRejectedValueOnce(new Error('timeout')) // TX3 lookup failed

    const result = await verifyUtxos(backend, 'main', opts)

    expect(result).toEqual({ checked: 2, relinquished: 1, failed: 1 })
    // Only TX1 should be relinquished — TX3's lookup failed, so no relinquish
    expect(callSpy).toHaveBeenCalledWith('relinquishOutput', {
      basket: 'default',
      output: `${TX1}.0`,
    }, 'self')
  })

  it('calls listOutputs with correct parameters', async () => {
    callSpy.mockResolvedValueOnce({ totalOutputs: 0, outputs: [] })

    await verifyUtxos(backend, 'main', opts)

    expect(callSpy).toHaveBeenCalledWith('listOutputs', {
      basket: 'default',
      limit: 10000,
    }, 'self')
  })
})
