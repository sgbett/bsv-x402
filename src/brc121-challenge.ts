import type { Brc121Challenge } from "./types"

/**
 * Parses BRC-121 challenge headers from a 402 response.
 *
 * Returns `null` when the required headers are absent or when
 * `x-bsv-payment-version` is present (indicating BRC-105, not BRC-121).
 *
 * Throws on malformed values once the headers are confirmed present,
 * matching the validation pattern of `parseBrc105Challenge`.
 */
export function parseBrc121Challenge(response: Response): Brc121Challenge | null {
  // BRC-105 discrimination: if x-bsv-payment-version is present, this is BRC-105
  if (response.headers.get("x-bsv-payment-version") !== null) {
    return null
  }

  const satsHeader = response.headers.get("x-bsv-sats")
  const serverHeader = response.headers.get("x-bsv-server")

  if (!satsHeader || !serverHeader) {
    return null
  }

  const satoshis = Number(satsHeader)
  if (
    !Number.isFinite(satoshis) ||
    !Number.isInteger(satoshis) ||
    satoshis <= 0
  ) {
    throw new Error(`BRC-121: x-bsv-sats must be a positive integer, got "${satsHeader}"`)
  }

  if (!/^0[23][0-9a-fA-F]{64}$/.test(serverHeader)) {
    throw new Error("BRC-121: x-bsv-server must be a 33-byte compressed public key (hex)")
  }

  return { satoshis, serverIdentityKey: serverHeader }
}
