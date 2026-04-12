import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createX402Fetch, payeeAddressToLockingScript } from "./x402-fetch"
import type { Brc105Challenge, Brc105Proof } from "./types"

function make402Response(amount: number = 1000) {
  return new Response("Payment Required", {
    status: 402,
    headers: {
      "X402-Challenge": JSON.stringify({
        nonce: "test-nonce",
        payee: "1TestAddr",
        amount,
        network: "mainnet",
      }),
    },
  })
}

function make200Response() {
  return new Response("OK", { status: 200 })
}

describe("createX402Fetch", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("passes through non-402 responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make200Response())
    const f = createX402Fetch()
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)
  })

  it("passes through 402 without X402-Challenge header", async () => {
    const bare402 = new Response("Payment Required", { status: 402 })
    globalThis.fetch = vi.fn().mockResolvedValue(bare402)
    const f = createX402Fetch()
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
  })

  it("retries with X402-Proof header on valid 402", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402Response(1000))
      .mockResolvedValueOnce(make200Response())

    const proofConstructor = vi.fn().mockResolvedValue({ txid: "mock-txid", beef: btoa("mock-tx") })
    const f = createX402Fetch({ proofConstructor })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)
    expect(proofConstructor).toHaveBeenCalledOnce()

    // Verify the retry request has X402-Proof header with beef field
    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    const proofHeader = retryHeaders.get("X402-Proof")
    expect(proofHeader).toBeTruthy()
    const proof = JSON.parse(proofHeader!)
    expect(proof).toHaveProperty("txid", "mock-txid")
    expect(proof).toHaveProperty("beef", btoa("mock-tx"))
    expect(proof).not.toHaveProperty("rawTx")
  })

  it("returns original 402 when proof construction fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(1000))

    const proofConstructor = vi.fn().mockRejectedValue(new Error("Wallet declined"))
    const f = createX402Fetch({ proofConstructor })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
  })

  it("calls onProofError when proof construction fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(1000))

    const error = new Error("No funds")
    const onProofError = vi.fn()
    const f = createX402Fetch({
      proofConstructor: vi.fn().mockRejectedValue(error),
      onProofError,
    })

    await f("https://api.example.com/data")
    expect(onProofError).toHaveBeenCalledOnce()
    expect(onProofError).toHaveBeenCalledWith(error, "x402")
  })

  it("extracts origin from string URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make200Response())
    const f = createX402Fetch()
    await f("https://api.example.com/data")
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})

describe("payeeAddressToLockingScript", () => {
  it("decodes a valid mainnet P2PKH address", () => {
    const script = payeeAddressToLockingScript("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")
    expect(script).toMatch(/^76a914[0-9a-f]{40}88ac$/)
    expect(script).toBe("76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac")
  })

  it("decodes a valid testnet P2PKH address", () => {
    const script = payeeAddressToLockingScript("mfWxJ45yp2SFn7UciZyNpvDKrzbi36LaVX")
    expect(script).toMatch(/^76a914[0-9a-f]{40}88ac$/)
  })

  it("handles addresses with leading 1s (zero bytes)", () => {
    const script = payeeAddressToLockingScript("1111111111111111111114oLvT2")
    expect(script).toBe("76a914000000000000000000000000000000000000000088ac")
  })

  it("rejects invalid Base58 characters", () => {
    expect(() => payeeAddressToLockingScript("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf0O"))
      .toThrow("Invalid Base58 character")
  })

  it("rejects address with wrong length", () => {
    expect(() => payeeAddressToLockingScript("1234"))
      .toThrow()
  })

  it("rejects unsupported version byte", () => {
    expect(() => payeeAddressToLockingScript("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"))
      .toThrow("Unsupported address version")
  })
})

// === defaultConstructProof tests (via CWI mock) ===

function make402WithValidAddress(amount: number = 1000) {
  return new Response("Payment Required", {
    status: 402,
    headers: {
      "X402-Challenge": JSON.stringify({
        nonce: "test-nonce",
        payee: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        amount,
        network: "mainnet",
      }),
    },
  })
}

describe("defaultConstructProof (via CWI)", () => {
  let originalFetch: typeof globalThis.fetch
  let originalCWI: any

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalCWI = (globalThis as any).CWI
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as any).CWI = originalCWI
  })

  it("converts tx (number[]) to base64 beef (modern wallet)", async () => {
    const txBytes = [0xca, 0xfe]
    ;(globalThis as any).CWI = {
      createAction: vi.fn().mockResolvedValue({ txid: "abc123", tx: txBytes }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402WithValidAddress())
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch()
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    const proof = JSON.parse(retryHeaders.get("X402-Proof")!)
    expect(proof.txid).toBe("abc123")
    // base64 of [0xca, 0xfe]
    const expectedBase64 = btoa(String.fromCharCode(0xca, 0xfe))
    expect(proof.beef).toBe(expectedBase64)
    expect(proof).not.toHaveProperty("rawTx")
  })

  it("converts rawTx hex to base64 beef (legacy wallet)", async () => {
    ;(globalThis as any).CWI = {
      createAction: vi.fn().mockResolvedValue({ txid: "abc123", rawTx: "deadbeef" }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402WithValidAddress())
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch()
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    const proof = JSON.parse(retryHeaders.get("X402-Proof")!)
    expect(proof.txid).toBe("abc123")
    // base64 of [0xde, 0xad, 0xbe, 0xef]
    const expectedBase64 = btoa(String.fromCharCode(0xde, 0xad, 0xbe, 0xef))
    expect(proof.beef).toBe(expectedBase64)
  })

  it("prefers tx over rawTx when both present", async () => {
    const txBytes = [0xca]
    ;(globalThis as any).CWI = {
      createAction: vi.fn().mockResolvedValue({ txid: "abc123", tx: txBytes, rawTx: "dead" }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402WithValidAddress())
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch()
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    const proof = JSON.parse(retryHeaders.get("X402-Proof")!)
    // Should use tx, not rawTx
    const expectedBase64 = btoa(String.fromCharCode(0xca))
    expect(proof.beef).toBe(expectedBase64)
  })

  it("throws when neither tx nor rawTx present", async () => {
    ;(globalThis as any).CWI = {
      createAction: vi.fn().mockResolvedValue({ txid: "abc123" }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402WithValidAddress())

    const onProofError = vi.fn()
    const f = createX402Fetch({ onProofError })
    const res = await f("https://api.example.com/data")

    // Should fall back to returning the original 402
    expect(res.status).toBe(402)
    expect(onProofError).toHaveBeenCalledOnce()
    expect(onProofError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect((onProofError.mock.calls[0][0] as Error).message).toMatch(/no transaction data/i)
  })

  it("throws when tx is empty array and rawTx absent", async () => {
    ;(globalThis as any).CWI = {
      createAction: vi.fn().mockResolvedValue({ txid: "abc123", tx: [] }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make402WithValidAddress())

    const onProofError = vi.fn()
    const f = createX402Fetch({ onProofError })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(402)
    expect(onProofError).toHaveBeenCalledOnce()
    expect((onProofError.mock.calls[0][0] as Error).message).toMatch(/no transaction data/i)
  })
})

// === BRC-105 tests ===

function makeBrc105Response(
  satoshis: number = 1000,
  overrides: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    "x-bsv-payment-version": "1.0",
    "x-bsv-payment-satoshis-required": String(satoshis),
    "x-bsv-auth-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "x-bsv-payment-derivation-prefix": "test-prefix",
    ...overrides,
  }
  return new Response("Payment Required", {
    status: 402,
    headers,
  })
}

function mockBrc105ProofConstructor(): (challenge: Brc105Challenge) => Promise<Brc105Proof> {
  return vi.fn(async (challenge: Brc105Challenge) => ({
    derivationPrefix: challenge.derivationPrefix,
    derivationSuffix: "mock-suffix",
    transaction: "bW9jay10eA==", // "mock-tx" in base64
    clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    txid: "brc105-mock-txid",
  }))
}

describe("createX402Fetch — BRC-105", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("retries with x-bsv-payment header on valid BRC-105 402", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(make200Response())

    const proofConstructor = mockBrc105ProofConstructor()
    const f = createX402Fetch({
      brc105ProofConstructor: proofConstructor,
    })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)
    expect(proofConstructor).toHaveBeenCalledOnce()

    // Verify the retry request has x-bsv-payment header
    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    const paymentHeader = retryHeaders.get("x-bsv-payment")
    expect(paymentHeader).toBeTruthy()

    const proof = JSON.parse(paymentHeader!)
    expect(proof).toHaveProperty("derivationPrefix")
    expect(proof).toHaveProperty("derivationSuffix")
    expect(proof).toHaveProperty("transaction")
    expect(proof.clientIdentityKey).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")

    // Verify x-bsv-auth-identity-key header is set separately
    expect(retryHeaders.get("x-bsv-auth-identity-key")).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
  })

  it("prefers custom protocol when both X402-Challenge and BRC-105 headers present", async () => {
    const bothHeaders = new Response("Payment Required", {
      status: 402,
      headers: {
        "X402-Challenge": JSON.stringify({
          nonce: "test-nonce",
          payee: "1TestAddr",
          amount: 1000,
          network: "mainnet",
        }),
        "x-bsv-payment-version": "1.0",
        "x-bsv-payment-satoshis-required": "1000",
        "x-bsv-auth-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        "x-bsv-payment-derivation-prefix": "prefix",
      },
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(bothHeaders)
      .mockResolvedValueOnce(make200Response())

    const customProof = vi.fn().mockResolvedValue({ txid: "custom-txid", beef: btoa("mock-tx") })
    const brc105Proof = mockBrc105ProofConstructor()

    const f = createX402Fetch({
      proofConstructor: customProof,
      brc105ProofConstructor: brc105Proof,
    })

    await f("https://api.example.com/both")

    expect(customProof).toHaveBeenCalledOnce()
    expect(brc105Proof).not.toHaveBeenCalled()

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    expect(retryHeaders.get("X402-Proof")).toBeTruthy()
    expect(retryHeaders.get("x-bsv-payment")).toBeNull()
  })

  it("passes through BRC-105 402 with unsupported version", async () => {
    const badVersion = makeBrc105Response(1000, { "x-bsv-payment-version": "2.0" })
    globalThis.fetch = vi.fn().mockResolvedValue(badVersion)

    const brc105Proof = mockBrc105ProofConstructor()
    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
    expect(brc105Proof).not.toHaveBeenCalled()
  })

  it("passes through BRC-105 402 when no wallet or proof constructor configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeBrc105Response(1000))
    const f = createX402Fetch()

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
  })

  it("returns original 402 when BRC-105 proof construction throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeBrc105Response(1000))

    const failingProof = vi.fn().mockRejectedValue(new Error("Wallet declined"))
    const f = createX402Fetch({ brc105ProofConstructor: failingProof })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
    expect(failingProof).toHaveBeenCalledOnce()
  })

  it("calls onProofError when BRC-105 proof construction fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeBrc105Response(1000))

    const error = new Error("Wallet locked")
    const onProofError = vi.fn()
    const f = createX402Fetch({
      brc105ProofConstructor: vi.fn().mockRejectedValue(error),
      onProofError,
    })

    await f("https://api.example.com/data")
    expect(onProofError).toHaveBeenCalledOnce()
    expect(onProofError).toHaveBeenCalledWith(error, "brc105")
  })
})
