import { describe, it, expect } from "vitest"
import { parsePayGatewayChallenge } from "./paygateway-challenge"

/** Helper: build a valid Coinbase v2 PaymentRequired object. */
function makeChallenge(overrides: Record<string, unknown> = {}, acceptOverrides: Record<string, unknown> = {}) {
  const accept = {
    scheme: "exact",
    network: "bsv:mainnet",
    amount: "100",
    asset: "BSV",
    payTo: "76a914aabbccdd88ac",
    maxTimeoutSeconds: 60,
    extra: { payToSig: "hmac123" },
    ...acceptOverrides,
  }
  return {
    x402Version: 2,
    resource: { url: "/api/expensive" },
    accepts: [accept],
    ...overrides,
  }
}

/** Encode a challenge object to a base64 header value. */
function encode(obj: unknown): string {
  return btoa(JSON.stringify(obj))
}

/** Build a mock Response with given headers. */
function mockResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 402, headers })
}

describe("parsePayGatewayChallenge", () => {
  it("parses a valid BSV mainnet challenge", () => {
    const challenge = makeChallenge()
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    const result = parsePayGatewayChallenge(res)

    expect(result).not.toBeNull()
    expect(result!.x402Version).toBe(2)
    expect(result!.resource.url).toBe("/api/expensive")
    expect(result!.selectedAccept.network).toBe("bsv:mainnet")
    expect(result!.selectedAccept.payTo).toBe("76a914aabbccdd88ac")
    expect(result!.selectedAccept.amount).toBe("100")
    expect(result!.selectedAccept.extra.payToSig).toBe("hmac123")
  })

  it("parses a valid BSV testnet challenge", () => {
    const challenge = makeChallenge({}, { network: "bsv:testnet" })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    const result = parsePayGatewayChallenge(res)

    expect(result).not.toBeNull()
    expect(result!.selectedAccept.network).toBe("bsv:testnet")
  })

  it("returns null when Payment-Required header is absent", () => {
    const res = mockResponse({})
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })

  it("returns null for invalid base64", () => {
    const res = mockResponse({ "Payment-Required": "!!!not-base64!!!" })
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })

  it("returns null for valid base64 but invalid JSON", () => {
    const res = mockResponse({ "Payment-Required": btoa("not json {{{") })
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })

  it("returns null for wrong x402Version", () => {
    const challenge = makeChallenge({ x402Version: 1 })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })

  it("returns null when no BSV entry in accepts array", () => {
    const challenge = makeChallenge({
      accepts: [{ scheme: "exact", network: "eth:mainnet", amount: "100", payTo: "0xabc", extra: { payToSig: "hmac" } }],
    })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })

  it("selects BSV entry from multiple accepts entries", () => {
    const ethAccept = { scheme: "exact", network: "eth:mainnet", amount: "50", asset: "ETH", payTo: "0xabc", extra: { payToSig: "hmac" } }
    const bsvAccept = { scheme: "exact", network: "bsv:mainnet", amount: "200", asset: "BSV", payTo: "76a914ff88ac", maxTimeoutSeconds: 30, extra: { payToSig: "hmac456" } }
    const challenge = makeChallenge({ accepts: [ethAccept, bsvAccept] })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    const result = parsePayGatewayChallenge(res)

    expect(result).not.toBeNull()
    expect(result!.selectedAccept.network).toBe("bsv:mainnet")
    expect(result!.selectedAccept.amount).toBe("200")
    expect(result!.selectedAccept.payTo).toBe("76a914ff88ac")
  })

  it("handles amount as integer (defensive)", () => {
    const challenge = makeChallenge({}, { amount: 42 })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    const result = parsePayGatewayChallenge(res)

    expect(result).not.toBeNull()
    expect(result!.selectedAccept.amount).toBe("42")
  })

  it("throws on missing payTo", () => {
    const challenge = makeChallenge({}, { payTo: "" })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(() => parsePayGatewayChallenge(res)).toThrow("[x402] PayGateway: missing or empty payTo")
  })

  it("throws on non-hex payTo", () => {
    const challenge = makeChallenge({}, { payTo: "not-hex!" })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(() => parsePayGatewayChallenge(res)).toThrow("[x402] PayGateway: payTo must be a hex-encoded locking script")
  })

  it("throws on missing extra.payToSig", () => {
    const challenge = makeChallenge({}, { extra: {} })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(() => parsePayGatewayChallenge(res)).toThrow("[x402] PayGateway: missing or empty extra.payToSig")
  })

  it("throws on missing extra object", () => {
    const challenge = makeChallenge({}, { extra: undefined })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    expect(() => parsePayGatewayChallenge(res)).toThrow("[x402] PayGateway: missing extra object")
  })

  it("preserves optional extra fields (partialTx, derivationPrefix, derivationSuffix)", () => {
    const challenge = makeChallenge({}, {
      extra: {
        payToSig: "hmac789",
        partialTx: "base64partial",
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
      },
    })
    const res = mockResponse({ "Payment-Required": encode(challenge) })
    const result = parsePayGatewayChallenge(res)

    expect(result).not.toBeNull()
    expect(result!.selectedAccept.extra.partialTx).toBe("base64partial")
    expect(result!.selectedAccept.extra.derivationPrefix).toBe("prefix")
    expect(result!.selectedAccept.extra.derivationSuffix).toBe("suffix")
  })

  it("discriminates from X402-Challenge (different header)", () => {
    // X402-Challenge uses a different header name — Payment-Required absent
    const res = mockResponse({ "X402-Challenge": '{"nonce":"abc","payee":"def","amount":100,"network":"mainnet"}' })
    expect(parsePayGatewayChallenge(res)).toBeNull()
  })
})
