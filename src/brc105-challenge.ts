import type { Brc105Challenge } from "./types"

/**
 * Parses BRC-105 payment headers from a 402 response.
 *
 * Expects four headers:
 *   - x-bsv-payment-version (must be "1.0")
 *   - x-bsv-payment-satoshis-required (positive integer)
 *   - x-bsv-auth-identity-key or x-bsv-payment-identity-key (compressed pubkey)
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

  // Accept identity key from BRC-103 auth layer or standalone BRC-105 header.
  // Treat empty values as absent so the fallback works when auth middleware
  // sends an empty header but the payment header has a valid key.
  const authIdentityKey = response.headers.get("x-bsv-auth-identity-key") || null
  const paymentIdentityKey = response.headers.get("x-bsv-payment-identity-key") || null
  const authenticated = authIdentityKey !== null && authIdentityKey.length > 0
  const serverIdentityKey = authIdentityKey || paymentIdentityKey
  if (serverIdentityKey === null || serverIdentityKey.length === 0) {
    throw new Error("BRC-105: missing identity key (expected x-bsv-auth-identity-key or x-bsv-payment-identity-key)")
  }
  if (!/^0[23][0-9a-fA-F]{64}$/.test(serverIdentityKey)) {
    throw new Error("BRC-105: identity key must be a 33-byte compressed public key (hex)")
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
    authenticated,
  }
}
