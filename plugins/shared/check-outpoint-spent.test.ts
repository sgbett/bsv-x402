import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { checkOutpointSpent, WocRateLimitError } from './check-outpoint-spent'

const TXID = 'aabbccddee00112233445566778899aabbccddee00112233445566778899aabb'
const SPENDING_TXID = '"ff00112233445566778899aabbccddee00112233445566778899aabbccddee00"'

describe('checkOutpointSpent', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true for a spent outpoint', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(SPENDING_TXID, { status: 200 }))

    const result = await checkOutpointSpent(TXID, 0, 'main')
    expect(result).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `https://api.whatsonchain.com/v1/bsv/main/tx/${TXID}/out/0/spent`,
    )
  })

  it('returns false for an unspent outpoint (404)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }))

    const result = await checkOutpointSpent(TXID, 1, 'main')
    expect(result).toBe(false)
  })

  it('uses correct URL for testnet', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(SPENDING_TXID, { status: 200 }))

    await checkOutpointSpent(TXID, 2, 'test')
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `https://api.whatsonchain.com/v1/bsv/test/tx/${TXID}/out/2/spent`,
    )
  })

  it('uses correct URL for mainnet', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }))

    await checkOutpointSpent(TXID, 0, 'main')
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `https://api.whatsonchain.com/v1/bsv/main/tx/${TXID}/out/0/spent`,
    )
  })

  it('throws on rate limit (429)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))

    await expect(checkOutpointSpent(TXID, 0, 'main')).rejects.toBeInstanceOf(WocRateLimitError)
  })

  it('throws on unexpected status codes', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

    await expect(checkOutpointSpent(TXID, 0, 'main')).rejects.toThrow('unexpected status 500')
  })

  it('throws on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(checkOutpointSpent(TXID, 0, 'main')).rejects.toThrow('fetch failed')
  })

  it('throws on timeout (AbortError)', async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))

    await expect(checkOutpointSpent(TXID, 0, 'main')).rejects.toThrow('timed out')
  })

  it('passes an AbortSignal to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }))

    await checkOutpointSpent(TXID, 0, 'main')
    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal)
  })
})
