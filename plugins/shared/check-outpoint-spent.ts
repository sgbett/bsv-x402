/**
 * Chain lookup: check whether a specific outpoint (txid.vout) has been spent
 * on-chain, using the WhatsOnChain API.
 *
 * Endpoint: GET /v1/bsv/{network}/tx/{txid}/out/{vout}/spent
 *   - Returns the spending txid (string) when the outpoint is spent
 *   - Returns 404 when the outpoint is unspent (or vout is out of range)
 *   - Rate-limited (429) — bubbled up to caller
 */

export type WocNetwork = 'main' | 'test'

/** Thrown when WoC returns HTTP 429 — used by callers to stop further requests. */
export class WocRateLimitError extends Error {
  constructor() {
    super('WoC rate limit exceeded (429)')
    this.name = 'WocRateLimitError'
  }
}

/**
 * Check whether a specific outpoint is spent on-chain.
 *
 * @returns `true` if the outpoint has been spent, `false` if unspent.
 * @throws On network errors, rate limiting (429), or timeouts.
 */
export async function checkOutpointSpent(
  txid: string,
  vout: number,
  network: WocNetwork,
): Promise<boolean> {
  const url = `https://api.whatsonchain.com/v1/bsv/${network}/tx/${txid}/out/${vout}/spent`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)

  try {
    const res = await fetch(url, { signal: ctrl.signal })

    if (res.ok) {
      return true
    }

    if (res.status === 404) {
      return false
    }

    if (res.status === 429) {
      throw new WocRateLimitError()
    }

    throw new Error(`WoC returned unexpected status ${res.status}`)
  } catch (err) {
    // Wrap AbortError from timeout into a plain Error
    if (err instanceof DOMException || (err instanceof Error && err.name === 'AbortError')) {
      throw new Error('WoC request timed out after 8 seconds')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
