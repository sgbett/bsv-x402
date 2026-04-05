import { describe, expect, it } from "vitest"
import { parseBrc105Challenge } from "./brc105-challenge"

function makeResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 402, headers })
}

const VALID_HEADERS = {
  "x-bsv-payment-version": "1.0",
  "x-bsv-payment-satoshis-required": "5",
  "x-bsv-auth-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "x-bsv-payment-derivation-prefix": "AQID",
}

describe("parseBrc105Challenge", () => {
  it("parses valid headers", () => {
    const c = parseBrc105Challenge(makeResponse(VALID_HEADERS))
    expect(c.version).toBe("1.0")
    expect(c.satoshisRequired).toBe(5)
    expect(c.serverIdentityKey).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
    expect(c.derivationPrefix).toBe("AQID")
    expect(c.authenticated).toBe(true)
  })

  it("handles case-insensitive header names", () => {
    const c = parseBrc105Challenge(makeResponse({
      "X-BSV-Payment-Version": "1.0",
      "X-BSV-Payment-Satoshis-Required": "5",
      "X-BSV-Auth-Identity-Key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      "X-BSV-Payment-Derivation-Prefix": "AQID",
    }))
    expect(c.version).toBe("1.0")
    expect(c.satoshisRequired).toBe(5)
  })

  it("rejects missing version header", () => {
    const { "x-bsv-payment-version": _, ...rest } = VALID_HEADERS
    expect(() => parseBrc105Challenge(makeResponse(rest))).toThrow("missing x-bsv-payment-version")
  })

  it("rejects unsupported version", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-version": "2.0",
    }))).toThrow('unsupported version "2.0"')
  })

  it("rejects missing satoshis-required header", () => {
    const { "x-bsv-payment-satoshis-required": _, ...rest } = VALID_HEADERS
    expect(() => parseBrc105Challenge(makeResponse(rest))).toThrow("missing x-bsv-payment-satoshis-required")
  })

  it("rejects non-numeric satoshis", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-satoshis-required": "abc",
    }))).toThrow("positive integer")
  })

  it("rejects zero satoshis", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-satoshis-required": "0",
    }))).toThrow("positive integer")
  })

  it("rejects negative satoshis", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-satoshis-required": "-1",
    }))).toThrow("positive integer")
  })

  it("rejects fractional satoshis", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-satoshis-required": "5.5",
    }))).toThrow("positive integer")
  })

  it("accepts x-bsv-payment-identity-key as fallback (no-auth mode)", () => {
    const { "x-bsv-auth-identity-key": _, ...rest } = VALID_HEADERS
    const c = parseBrc105Challenge(makeResponse({
      ...rest,
      "x-bsv-payment-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }))
    expect(c.serverIdentityKey).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
    expect(c.authenticated).toBe(false)
  })

  it("falls back to payment header when auth header is empty", () => {
    const c = parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-auth-identity-key": "",
      "x-bsv-payment-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }))
    expect(c.serverIdentityKey).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
    expect(c.authenticated).toBe(false)
  })

  it("prefers x-bsv-auth-identity-key when both are present", () => {
    const c = parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-identity-key": "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }))
    expect(c.serverIdentityKey).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
  })

  it("rejects missing identity key header", () => {
    const { "x-bsv-auth-identity-key": _, ...rest } = VALID_HEADERS
    expect(() => parseBrc105Challenge(makeResponse(rest))).toThrow("missing identity key")
  })

  it("rejects empty identity key", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-auth-identity-key": "",
    }))).toThrow("missing identity key")
  })

  it("rejects identity key that is not a compressed public key", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-auth-identity-key": "not-a-pubkey",
    }))).toThrow("compressed public key")
  })

  it("rejects identity key with wrong prefix byte", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-auth-identity-key": "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }))).toThrow("compressed public key")
  })

  it("rejects identity key with wrong length", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-auth-identity-key": "02abc123",
    }))).toThrow("compressed public key")
  })

  it("rejects missing derivation prefix header", () => {
    const { "x-bsv-payment-derivation-prefix": _, ...rest } = VALID_HEADERS
    expect(() => parseBrc105Challenge(makeResponse(rest))).toThrow("missing or empty x-bsv-payment-derivation-prefix")
  })

  it("rejects empty derivation prefix", () => {
    expect(() => parseBrc105Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-derivation-prefix": "",
    }))).toThrow("missing or empty x-bsv-payment-derivation-prefix")
  })
})
