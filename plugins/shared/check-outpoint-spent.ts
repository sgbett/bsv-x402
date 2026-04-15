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
    clearTimeout(timer)

    if (res.ok) {
      // WoC returns the spending txid as a JSON string when the outpoint is spent
      return true
    }

    if (res.status === 404) {
      // Unspent, or vout index out of range — either way, not spent
      return false
    }

    if (res.status === 429) {
      throw new Error('WoC rate limit exceeded (429)')
    }

    throw new Error(`WoC returned unexpected status ${res.status}`)
  } catch (err) {
    clearTimeout(timer)

    // Re-throw our own errors (rate limit, unexpected status)
    if (err instanceof Error && !err.name.includes('Abort')) {
      throw err
    }

    // AbortError from timeout
    if (err instanceof DOMException || (err instanceof Error && err.name === 'AbortError')) {
      throw new Error('WoC request timed out after 8 seconds')
    }

    throw err
  }
}
