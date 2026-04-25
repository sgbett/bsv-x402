// === Byte encoding helpers (shared across proof constructors) ===

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex string must have even length")
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function numberArrayToBase64(arr: number[]): string {
  return bytesToBase64(new Uint8Array(arr))
}

// === Transaction data extraction (shared across proof constructors) ===

/** Discriminated result from extractTxData — indicates which wallet field was used. */
export interface TxData {
  bytes: Uint8Array
  hex: string
  base64: string
  /** Which wallet result field the data came from. */
  source: 'tx' | 'rawTx'
}

/**
 * Extract and normalise transaction data from a wallet createAction result.
 *
 * SDK wallets return `tx: number[]`; CWI wallets return `rawTx: string` (hex).
 * This function detects which is available, converts to all three representations,
 * and records the source for callers that need to branch (e.g. PayGateway BEEF conditionality).
 *
 * `tx` takes priority when both are present (existing behaviour).
 * Empty `tx` arrays fall through to `rawTx`.
 */
export function extractTxData(result: { tx?: number[]; rawTx?: string }): TxData {
  if (result.tx && Array.isArray(result.tx) && result.tx.length > 0) {
    const bytes = new Uint8Array(result.tx)
    return {
      bytes,
      hex: bytesToHex(bytes),
      base64: bytesToBase64(bytes),
      source: 'tx',
    }
  }

  if (result.rawTx && typeof result.rawTx === 'string' && result.rawTx.length > 0) {
    const trimmed = result.rawTx.trim()
    if (trimmed.length === 0) {
      throw new Error('Wallet returned no transaction data (neither tx nor rawTx)')
    }
    const bytes = hexToBytes(trimmed)
    return {
      bytes,
      hex: trimmed,
      base64: bytesToBase64(bytes),
      source: 'rawTx',
    }
  }

  throw new Error('Wallet returned no transaction data (neither tx nor rawTx)')
}
