import { describe, it, expect } from "vitest"
import { extractTxData, bytesToHex, bytesToBase64 } from "./bytes"

describe("extractTxData", () => {
  it("converts tx number array to all formats", () => {
    const result = extractTxData({ tx: [0xca, 0xfe] })
    expect(result.bytes).toEqual(new Uint8Array([0xca, 0xfe]))
    expect(result.hex).toBe("cafe")
    expect(result.base64).toBe(bytesToBase64(new Uint8Array([0xca, 0xfe])))
    expect(result.source).toBe("tx")
  })

  it("converts rawTx hex string to all formats", () => {
    const result = extractTxData({ rawTx: "deadbeef" })
    expect(result.bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    expect(result.hex).toBe("deadbeef")
    expect(result.base64).toBe(bytesToBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef])))
    expect(result.source).toBe("rawTx")
  })

  it("prefers tx over rawTx when both are present", () => {
    const result = extractTxData({ tx: [0xca, 0xfe], rawTx: "deadbeef" })
    expect(result.hex).toBe("cafe")
    expect(result.source).toBe("tx")
  })

  it("throws when neither tx nor rawTx is present", () => {
    expect(() => extractTxData({})).toThrow(
      "Wallet returned no transaction data (neither tx nor rawTx)"
    )
  })

  it("falls through to rawTx when tx is an empty array", () => {
    const result = extractTxData({ tx: [], rawTx: "deadbeef" })
    expect(result.hex).toBe("deadbeef")
    expect(result.source).toBe("rawTx")
  })

  it("throws when tx is empty and rawTx is not present", () => {
    expect(() => extractTxData({ tx: [] })).toThrow(
      "Wallet returned no transaction data (neither tx nor rawTx)"
    )
  })

  it("throws when rawTx is an empty string", () => {
    expect(() => extractTxData({ rawTx: "" })).toThrow(
      "Wallet returned no transaction data (neither tx nor rawTx)"
    )
  })

  it("throws when rawTx is whitespace-only", () => {
    expect(() => extractTxData({ rawTx: "   " })).toThrow(
      "Wallet returned no transaction data (neither tx nor rawTx)"
    )
  })

  it("throws on odd-length rawTx hex", () => {
    expect(() => extractTxData({ rawTx: "abc" })).toThrow(
      "Hex string must have even length"
    )
  })
})
