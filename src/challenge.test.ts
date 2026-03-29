import { describe, expect, it } from "vitest"
import { parseChallenge } from "./challenge"

const VALID = JSON.stringify({
  nonce: "test-nonce",
  payee: "1TestAddr",
  amount: 100000,
  network: "mainnet",
})

describe("parseChallenge", () => {
  it("parses a valid challenge", () => {
    const c = parseChallenge(VALID)
    expect(c.nonce).toBe("test-nonce")
    expect(c.payee).toBe("1TestAddr")
    expect(c.amount).toBe(100000)
    expect(c.network).toBe("mainnet")
  })

  it("rejects invalid JSON", () => {
    expect(() => parseChallenge("not json")).toThrow("invalid JSON")
  })

  it("rejects non-object", () => {
    expect(() => parseChallenge('"string"')).toThrow("expected object")
    expect(() => parseChallenge("42")).toThrow("expected object")
    expect(() => parseChallenge("null")).toThrow("expected object")
  })

  it("rejects missing nonce", () => {
    expect(() => parseChallenge(JSON.stringify({ payee: "a", amount: 1, network: "m" }))).toThrow("nonce")
  })

  it("rejects missing payee", () => {
    expect(() => parseChallenge(JSON.stringify({ nonce: "a", amount: 1, network: "m" }))).toThrow("payee")
  })

  it("rejects missing network", () => {
    expect(() => parseChallenge(JSON.stringify({ nonce: "a", payee: "b", amount: 1 }))).toThrow("network")
  })

  it("rejects negative amount", () => {
    const header = JSON.stringify({ nonce: "a", payee: "b", amount: -1000, network: "m" })
    expect(() => parseChallenge(header)).toThrow("positive integer")
  })

  it("rejects zero amount", () => {
    const header = JSON.stringify({ nonce: "a", payee: "b", amount: 0, network: "m" })
    expect(() => parseChallenge(header)).toThrow("positive integer")
  })

  it("rejects NaN amount", () => {
    // NaN can't be in JSON directly, but a non-number type triggers the same guard
    const header = JSON.stringify({ nonce: "a", payee: "b", amount: "100", network: "m" })
    expect(() => parseChallenge(header)).toThrow("positive integer")
  })

  it("rejects Infinity amount", () => {
    // Infinity serialises as null in JSON, so amount becomes null
    const header = '{"nonce":"a","payee":"b","amount":1e999,"network":"m"}'
    expect(() => parseChallenge(header)).toThrow("positive integer")
  })

  it("rejects fractional amount", () => {
    const header = JSON.stringify({ nonce: "a", payee: "b", amount: 100.5, network: "m" })
    expect(() => parseChallenge(header)).toThrow("positive integer")
  })

  it("does not pass through extra fields", () => {
    const header = JSON.stringify({ nonce: "a", payee: "b", amount: 1, network: "m", evil: "<script>" })
    const c = parseChallenge(header)
    expect((c as unknown as Record<string, unknown>).evil).toBeUndefined()
  })
})
