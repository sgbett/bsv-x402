import { describe, expect, it } from "vitest"
import { parseBrc121Challenge } from "./brc121-challenge"

function makeResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 402, headers })
}

const VALID_KEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"

const VALID_HEADERS = {
  "x-bsv-sats": "100",
  "x-bsv-server": VALID_KEY,
}

describe("parseBrc121Challenge", () => {
  it("parses valid headers", () => {
    const c = parseBrc121Challenge(makeResponse(VALID_HEADERS))
    expect(c).not.toBeNull()
    expect(c!.satoshis).toBe(100)
    expect(c!.serverIdentityKey).toBe(VALID_KEY)
  })

  it("returns null when x-bsv-sats is missing", () => {
    const { "x-bsv-sats": _, ...rest } = VALID_HEADERS
    expect(parseBrc121Challenge(makeResponse(rest))).toBeNull()
  })

  it("returns null when x-bsv-server is missing", () => {
    const { "x-bsv-server": _, ...rest } = VALID_HEADERS
    expect(parseBrc121Challenge(makeResponse(rest))).toBeNull()
  })

  it("returns null when x-bsv-payment-version is present (BRC-105 discrimination)", () => {
    expect(parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-payment-version": "1.0",
    }))).toBeNull()
  })

  it("rejects x-bsv-sats of 0", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-sats": "0",
    }))).toThrow("positive integer")
  })

  it("rejects negative x-bsv-sats", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-sats": "-1",
    }))).toThrow("positive integer")
  })

  it("rejects fractional x-bsv-sats", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-sats": "1.5",
    }))).toThrow("positive integer")
  })

  it("rejects non-numeric x-bsv-sats", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-sats": "abc",
    }))).toThrow("positive integer")
  })

  it("rejects x-bsv-server with wrong length", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-server": "02abc123",
    }))).toThrow("compressed public key")
  })

  it("rejects x-bsv-server with wrong prefix (uncompressed key)", () => {
    expect(() => parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-server": "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }))).toThrow("compressed public key")
  })

  it("accepts key with 03 prefix", () => {
    const key03 = "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    const c = parseBrc121Challenge(makeResponse({
      ...VALID_HEADERS,
      "x-bsv-server": key03,
    }))
    expect(c).not.toBeNull()
    expect(c!.serverIdentityKey).toBe(key03)
  })
})
