import type { Brc105Challenge } from "./types"

/**
 * Parses BRC-105 payment headers from a 402 response.
 *
 * Expects four headers:
 *   - x-bsv-payment-version (must be "1.0")
 *   - x-bsv-payment-satoshis-required (positive integer)
 *   - x-bsv-auth-identity-key (non-empty)
 *   - x-bsv-payment-derivation-prefix (non-empty)
 */
export function parseBrc105Challenge(response: Response): Brc105Challenge {
  const version = response.headers.get("x-bsv-payment-version")
  if (version === null) {
    throw new Error("BRC-105: missing x-bsv-payment-version header")
  }
  if (version !== "1.0") {
    throw new Error(`BRC-105: unsupported version "${version}", expected "1.0"`)
  }

  const satoshisRaw = response.headers.get("x-bsv-payment-satoshis-required")
  if (satoshisRaw === null) {
    throw new Error("BRC-105: missing x-bsv-payment-satoshis-required header")
  }
  const satoshisRequired = Number(satoshisRaw)
  if (
    !Number.isFinite(satoshisRequired) ||
    !Number.isInteger(satoshisRequired) ||
    satoshisRequired <= 0
  ) {
    throw new Error("BRC-105: satoshis-required must be a positive integer")
  }

  const serverIdentityKey = response.headers.get("x-bsv-auth-identity-key")
  if (serverIdentityKey === null || serverIdentityKey.length === 0) {
    throw new Error("BRC-105: missing or empty x-bsv-auth-identity-key header")
  }
  if (!/^0[23][0-9a-fA-F]{64}$/.test(serverIdentityKey)) {
    throw new Error("BRC-105: x-bsv-auth-identity-key must be a 33-byte compressed public key (hex)")
  }

  const derivationPrefix = response.headers.get("x-bsv-payment-derivation-prefix")
  if (derivationPrefix === null || derivationPrefix.length === 0) {
    throw new Error("BRC-105: missing or empty x-bsv-payment-derivation-prefix header")
  }

  return {
    version,
    satoshisRequired,
    serverIdentityKey,
    derivationPrefix,
  }
}
