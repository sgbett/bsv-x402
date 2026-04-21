import type { PayGatewayAccept, PayGatewayChallenge } from "./types"

/**
 * Parses a PayGateway (Coinbase v2) challenge from a 402 response.
 *
 * Returns `null` when the `Payment-Required` header is absent or when
 * the payload is not a valid PayGateway challenge (wrong format, wrong
 * version, no BSV entry). Throws on structurally valid but malformed
 * challenges (missing required fields) — these indicate a real
 * PayGateway server sending bad data.
 */
export function parsePayGatewayChallenge(response: Response): PayGatewayChallenge | null {
  const header = response.headers.get("Payment-Required")
  if (header === null || header.length === 0) {
    return null
  }

  let json: string
  try {
    json = atob(header)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null
  }

  const obj = parsed as Record<string, unknown>

  // Must be x402 version 2
  if (obj.x402Version !== 2) {
    return null
  }

  if (!Array.isArray(obj.accepts) || obj.accepts.length === 0) {
    return null
  }

  // Find the first BSV entry
  const bsvAccept = (obj.accepts as unknown[]).find((entry): entry is Record<string, unknown> => {
    if (typeof entry !== "object" || entry === null) return false
    const e = entry as Record<string, unknown>
    return typeof e.network === "string" && e.network.startsWith("bsv:")
  }) as Record<string, unknown> | undefined

  if (!bsvAccept) {
    return null
  }

  // --- From here, we've identified this as a PayGateway challenge.
  // Validation failures now throw (malformed server data). ---

  if (typeof bsvAccept.payTo !== "string" || bsvAccept.payTo.length === 0) {
    throw new Error("[x402] PayGateway: missing or empty payTo in BSV accept entry")
  }

  if (!/^[0-9a-fA-F]+$/.test(bsvAccept.payTo)) {
    throw new Error("[x402] PayGateway: payTo must be a hex-encoded locking script")
  }

  // Amount: spec sends string, be defensive about integer too
  let amountStr: string
  if (typeof bsvAccept.amount === "string") {
    amountStr = bsvAccept.amount
  } else if (typeof bsvAccept.amount === "number") {
    amountStr = String(bsvAccept.amount)
  } else {
    throw new Error("[x402] PayGateway: missing or invalid amount in BSV accept entry")
  }

  const amountNum = Number(amountStr)
  if (!Number.isFinite(amountNum) || !Number.isInteger(amountNum) || amountNum <= 0) {
    throw new Error("[x402] PayGateway: amount must be a positive integer")
  }

  // extra.payToSig is required
  const extra = bsvAccept.extra as Record<string, unknown> | undefined
  if (typeof extra !== "object" || extra === null) {
    throw new Error("[x402] PayGateway: missing extra object in BSV accept entry")
  }

  if (typeof extra.payToSig !== "string" || extra.payToSig.length === 0) {
    throw new Error("[x402] PayGateway: missing or empty extra.payToSig in BSV accept entry")
  }

  const selectedAccept: PayGatewayAccept = {
    scheme: typeof bsvAccept.scheme === "string" ? bsvAccept.scheme : "exact",
    network: bsvAccept.network as string,
    amount: amountStr,
    asset: typeof bsvAccept.asset === "string" ? bsvAccept.asset : "BSV",
    payTo: bsvAccept.payTo as string,
    maxTimeoutSeconds: typeof bsvAccept.maxTimeoutSeconds === "number" ? bsvAccept.maxTimeoutSeconds : 60,
    extra: {
      payToSig: extra.payToSig as string,
      ...(typeof extra.partialTx === "string" ? { partialTx: extra.partialTx } : {}),
      ...(typeof extra.derivationPrefix === "string" ? { derivationPrefix: extra.derivationPrefix } : {}),
      ...(typeof extra.derivationSuffix === "string" ? { derivationSuffix: extra.derivationSuffix } : {}),
    },
  }

  const resource = typeof obj.resource === "object" && obj.resource !== null
    ? obj.resource as { url: string }
    : { url: "" }

  return {
    x402Version: 2,
    resource,
    accepts: [selectedAccept],
    selectedAccept,
  }
}
