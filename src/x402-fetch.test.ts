import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createX402Fetch, payeeAddressToLockingScript, verifyBase58Checksum } from "./x402-fetch"
import type { Brc105Challenge, Brc105ProofResult, Brc121Challenge, Brc121ProofResult } from "./types"

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

describe("verifyBase58Checksum", () => {
  it("accepts a valid mainnet address", async () => {
    await expect(
      verifyBase58Checksum("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
    ).resolves.toBeUndefined()
  })

  it("accepts a valid testnet address", async () => {
    await expect(
      verifyBase58Checksum("mfWxJ45yp2SFn7UciZyNpvDKrzbi36LaVX"),
    ).resolves.toBeUndefined()
  })

  it("rejects a single-character typo", async () => {
    // Change last character before the checksum — 'N' → 'M'
    await expect(
      verifyBase58Checksum("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfMa"),
    ).rejects.toThrow("checksum mismatch")
  })

  it("rejects a truncated address", async () => {
    await expect(
      verifyBase58Checksum("1A1zP1eP5QGefi2DMP"),
    ).rejects.toThrow("Invalid address length")
  })

  it("rejects invalid Base58 characters", async () => {
    await expect(
      verifyBase58Checksum("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf0O"),
    ).rejects.toThrow("Invalid Base58 character")
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

function mockBrc105ProofConstructor(): (challenge: Brc105Challenge) => Promise<Brc105ProofResult> {
  return vi.fn(async (challenge: Brc105Challenge) => ({
    proof: {
      derivationPrefix: challenge.derivationPrefix,
      derivationSuffix: "mock-suffix",
      transaction: "bW9jay10eA==", // "mock-tx" in base64
      clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      txid: "brc105-mock-txid",
    },
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

  it("does not call abort when server returns 200", async () => {
    const abort = vi.fn()
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(abort).not.toHaveBeenCalled()
  })

  it("calls abort and retries with fresh proof when server returns 500", async () => {
    const abort = vi.fn()
    const freshAbort = vi.fn()
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: callCount === 1 ? "original-suffix" : "fresh-suffix",
          transaction: callCount === 1 ? "b3JpZ2luYWw=" : "ZnJlc2g=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: callCount === 1 ? "original-txid" : "fresh-txid",
        },
        abort: callCount === 1 ? abort : freshAbort,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(abort).toHaveBeenCalledOnce()
    expect(freshAbort).not.toHaveBeenCalled()
    expect(brc105Proof).toHaveBeenCalledTimes(2)
  })

  it("handles missing abort gracefully on server rejection with fresh retry", async () => {
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: "dHg=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(brc105Proof).toHaveBeenCalledTimes(2)
  })

  it("throws unknown payment state when all network retries exhausted", async () => {
    const abort = vi.fn()
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockRejectedValue(new TypeError("Failed to fetch"))

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof, maxRetries: 0 })
    await expect(f("https://api.example.com/data")).rejects.toThrow("Payment state unknown")
    expect(abort).not.toHaveBeenCalled()
  })

  it("retries same proof on network error then succeeds on 200", async () => {
    const abort = vi.fn()
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof, maxRetries: 1 })

    vi.useFakeTimers()
    const promise = f("https://api.example.com/data")
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(abort).not.toHaveBeenCalled()
    expect(brc105Proof).toHaveBeenCalledOnce()

    // Same x-bsv-payment header reused on both attempts
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const firstRetryHeaders = (fetchMock.mock.calls[1][1]?.headers as Headers).get("x-bsv-payment")
    const secondRetryHeaders = (fetchMock.mock.calls[2][1]?.headers as Headers).get("x-bsv-payment")
    expect(firstRetryHeaders).toBe(secondRetryHeaders)
  })

  it("retries same proof on network error then aborts + fresh retries on 500", async () => {
    const abort = vi.fn()
    const freshAbort = vi.fn()
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: callCount === 1 ? "original" : "fresh",
          transaction: callCount === 1 ? "b3JpZw==" : "ZnJlc2g=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: callCount === 1 ? "original-txid" : "fresh-txid",
        },
        abort: callCount === 1 ? abort : freshAbort,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof, maxRetries: 1 })

    vi.useFakeTimers()
    const promise = f("https://api.example.com/data")
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    vi.useRealTimers()

    expect(res.status).toBe(200)
    // Original proof aborted after 500, fresh proof used for final attempt
    expect(abort).toHaveBeenCalledOnce()
    expect(freshAbort).not.toHaveBeenCalled()
    expect(brc105Proof).toHaveBeenCalledTimes(2)
  })

  it("reuses same x-bsv-payment header across network retries", async () => {
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
    })

    // Use maxRetries: 0 — single attempt, no delay needed, no timer issues
    // The "retries same proof on network error then succeeds" test already
    // proves retry uses the same proof; this test focuses on header identity
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof, maxRetries: 1 })

    vi.useFakeTimers()
    const promise = f("https://api.example.com/data")
    await vi.runAllTimersAsync()
    const res = await promise
    vi.useRealTimers()

    expect(res.status).toBe(200)

    // Proof constructor called once — same proof reused across retries
    expect(brc105Proof).toHaveBeenCalledOnce()

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const header1 = (fetchMock.mock.calls[1][1]?.headers as Headers).get("x-bsv-payment")
    const header2 = (fetchMock.mock.calls[2][1]?.headers as Headers).get("x-bsv-payment")
    expect(header1).toBe(header2)
  })

  it("uses different proof on fresh retry after server rejection", async () => {
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: callCount === 1 ? "b3JpZ2luYWw=" : "ZnJlc2g=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort: vi.fn(),
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalPayment = (fetchMock.mock.calls[1][1]?.headers as Headers).get("x-bsv-payment")
    const freshPayment = (fetchMock.mock.calls[2][1]?.headers as Headers).get("x-bsv-payment")
    expect(originalPayment).not.toBe(freshPayment)

    const original = JSON.parse(originalPayment!)
    const fresh = JSON.parse(freshPayment!)
    expect(original.transaction).toBe("b3JpZ2luYWw=")
    expect(fresh.transaction).toBe("ZnJlc2g=")
  })

  it("returns error response when server rejects twice (double rejection)", async () => {
    const abort1 = vi.fn()
    const abort2 = vi.fn()
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: "dHg=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort: callCount === 1 ? abort1 : abort2,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
      .mockResolvedValueOnce(new Response("Bad Request Again", { status: 400 }))

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(400)
    expect(abort1).toHaveBeenCalledOnce()
    expect(abort2).toHaveBeenCalledOnce()
    expect(brc105Proof).toHaveBeenCalledTimes(2)
  })

  it("throws unknown state when fresh retry gets network error after server rejection", async () => {
    const abort = vi.fn()
    const freshAbort = vi.fn()
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: "dHg=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort: callCount === 1 ? abort : freshAbort,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    await expect(f("https://api.example.com/data")).rejects.toThrow("Payment state unknown")

    // First proof aborted after server rejection
    expect(abort).toHaveBeenCalledOnce()
    // Fresh proof NOT aborted (tx may be on-chain)
    expect(freshAbort).not.toHaveBeenCalled()
  })

  it("swallows abort error and still performs fresh retry", async () => {
    const abort = vi.fn().mockRejectedValue(new Error("abort failed"))
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: callCount === 1 ? "b3JpZw==" : "ZnJlc2g=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(abort).toHaveBeenCalledOnce()
    expect(brc105Proof).toHaveBeenCalledTimes(2)
  })

  it("calls broadcast on server 200 acceptance", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined)
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      abort: vi.fn(),
      broadcast,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it("does not call broadcast on server 4xx rejection", async () => {
    const broadcast = vi.fn()
    const abort = vi.fn()
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: "dHg=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort,
        broadcast,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
      .mockResolvedValueOnce(new Response("Bad Request Again", { status: 400 }))

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(400)
    expect(broadcast).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalled()
  })

  it("returns response even when broadcast throws", async () => {
    const broadcast = vi.fn().mockRejectedValue(new Error("ARC unavailable"))
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      broadcast,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it("handles undefined broadcast gracefully (custom constructor)", async () => {
    const brc105Proof = vi.fn().mockResolvedValue({
      proof: {
        derivationPrefix: "prefix",
        derivationSuffix: "suffix",
        transaction: "dHg=",
        clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        txid: "abc123",
      },
      // no broadcast
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
  })

  it("calls fresh broadcast on server rejection then fresh retry success", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined)
    const freshBroadcast = vi.fn().mockResolvedValue(undefined)
    let callCount = 0
    const brc105Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          derivationPrefix: "prefix",
          derivationSuffix: "suffix-" + callCount,
          transaction: callCount === 1 ? "b3JpZw==" : "ZnJlc2g=",
          clientIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          txid: "txid-" + callCount,
        },
        abort: vi.fn(),
        broadcast: callCount === 1 ? broadcast : freshBroadcast,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    // Original broadcast NOT called (server rejected original proof)
    expect(broadcast).not.toHaveBeenCalled()
    // Fresh broadcast called on success
    expect(freshBroadcast).toHaveBeenCalledOnce()
  })
})

// === BEEF acknowledgement tests ===

function make200WithPendingBeefs(beefs: Array<{
  txid: string
  beef: string
  derivationPrefix: string
  derivationSuffix: string
  outputIndex?: number
  senderIdentityKey?: string
}>) {
  return new Response(JSON.stringify({ pendingBeefs: beefs }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makePendingBeef(overrides: Partial<{
  txid: string
  beef: string
  derivationPrefix: string
  derivationSuffix: string
  outputIndex: number
  senderIdentityKey: string
}> = {}) {
  return {
    txid: overrides.txid ?? 'beef-txid-1',
    beef: overrides.beef ?? btoa('test beef data'),
    derivationPrefix: overrides.derivationPrefix ?? 'prefix-1',
    derivationSuffix: overrides.derivationSuffix ?? 'suffix-1',
    ...(overrides.outputIndex !== undefined ? { outputIndex: overrides.outputIndex } : {}),
    ...(overrides.senderIdentityKey !== undefined ? { senderIdentityKey: overrides.senderIdentityKey } : {}),
  }
}

describe("createX402Fetch — BEEF acknowledgement", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // --- Ack header injection ---

  it("does not add x-bsv-ack header when no ack wallet configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make200Response())
    const f = createX402Fetch()

    await f("https://api.example.com/data")

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = call[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBeNull()
  })

  it("sends x-bsv-ack with one txid on next request after processing pendingBeefs", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'txid-abc' })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    const secondCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const headers = secondCall[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBe('txid-abc')
  })

  it("sends x-bsv-ack with multiple txids on next request", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([
        makePendingBeef({ txid: 'txid-1' }),
        makePendingBeef({ txid: 'txid-2' }),
      ]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    const secondCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const headers = secondCall[1]?.headers as Headers
    const ackHeader = headers.get('x-bsv-ack')!
    const txids = ackHeader.split(',')
    expect(txids).toContain('txid-1')
    expect(txids).toContain('txid-2')
    expect(txids).toHaveLength(2)
  })

  it("clears x-bsv-ack after sending — subsequent request has no ack header", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'txid-clear' })]))
      .mockResolvedValueOnce(make200Response())  // second request carries ack
      .mockResolvedValueOnce(make200Response())  // third request should not

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")
    await f("https://api.example.com/third")

    const thirdCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2]
    const headers = thirdCall[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBeNull()
  })

  it("includes x-bsv-ack on the initial request (not just retries)", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    // First call gets pendingBeefs, second call should have ack on initial (non-retry) request
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'txid-initial' })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    // The second call is a plain 200, no 402 retry — the ack is on the initial request
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls).toHaveLength(2)
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers
    expect(secondHeaders.get('x-bsv-ack')).toBe('txid-initial')
  })

  // --- Pending BEEF processing ---

  it("internalises each entry in pendingBeefs array via internalizeAction", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    const beefs = [
      makePendingBeef({ txid: 'tx-a', derivationPrefix: 'pA', derivationSuffix: 'sA' }),
      makePendingBeef({ txid: 'tx-b', derivationPrefix: 'pB', derivationSuffix: 'sB' }),
    ]

    globalThis.fetch = vi.fn().mockResolvedValueOnce(make200WithPendingBeefs(beefs))

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(2)

    // Verify first call parameters
    const firstCallParams = ackWallet.internalizeAction.mock.calls[0][0]
    expect(firstCallParams.outputs[0].paymentRemittance.derivationPrefix).toBe('pA')
    expect(firstCallParams.outputs[0].paymentRemittance.derivationSuffix).toBe('sA')
    expect(firstCallParams.outputs[0].paymentRemittance.senderIdentityKey).toBe(serverIdentityKey)
    expect(firstCallParams.description).toBe('x402 refund receipt')

    // Verify tx bytes are decoded from base64
    const expectedBytes = Array.from(atob(beefs[0].beef), c => c.charCodeAt(0))
    expect(firstCallParams.tx).toEqual(expectedBytes)
  })

  it("does not call internalizeAction when response has no pendingBeefs", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn().mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    expect(ackWallet.internalizeAction).not.toHaveBeenCalled()
  })

  it("handles non-JSON response body without error", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("not json at all", { status: 200 })
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey: 'some-key' })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(ackWallet.internalizeAction).not.toHaveBeenCalled()
  })

  it("deduplicates same txid within one response — internalizeAction called once", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([
        makePendingBeef({ txid: 'dup-txid' }),
        makePendingBeef({ txid: 'dup-txid', derivationSuffix: 'different-suffix' }),
      ]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    // First call internalises, second is skipped because txid is in internalisedTxids
    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(1)

    // But the txid should still be acked
    await f("https://api.example.com/next")
    const secondCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const headers = secondCall[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBe('dup-txid')
  })

  it("skips internalizeAction for previously internalised txid but still acks it", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    // First response: internalise txid-re
    // Second response: re-deliver txid-re — should skip internalizeAction
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'txid-re' })]))
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'txid-re' })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    await f("https://api.example.com/first")   // internalises txid-re
    await f("https://api.example.com/second")   // re-delivered, skips internalise, acks again
    await f("https://api.example.com/third")    // should carry ack

    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(1)

    const thirdCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2]
    const headers = thirdCall[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBe('txid-re')
  })

  it("does not ack txid when internalizeAction throws — other entries still processed", async () => {
    const ackWallet = {
      internalizeAction: vi.fn()
        .mockRejectedValueOnce(new Error("wallet error"))
        .mockResolvedValueOnce({ accepted: true }),
    }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([
        makePendingBeef({ txid: 'fail-txid' }),
        makePendingBeef({ txid: 'ok-txid' }),
      ]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(2)

    // Only ok-txid should be acked (fail-txid was not added to ackedTxids)
    const secondCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const headers = secondCall[1]?.headers as Headers
    expect(headers.get('x-bsv-ack')).toBe('ok-txid')
  })

  it("skips entries with missing required fields (no derivationPrefix)", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    // Construct response manually with an entry missing derivationPrefix
    const beefs = [
      { txid: 'incomplete-txid', beef: btoa('data'), derivationSuffix: 'suffix-1' },
      { txid: 'complete-txid', beef: btoa('data'), derivationPrefix: 'pref', derivationSuffix: 'suf' },
    ]
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ pendingBeefs: beefs }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    // Only the complete entry should be internalised
    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(1)
    expect(ackWallet.internalizeAction.mock.calls[0][0].outputs[0].paymentRemittance.derivationPrefix).toBe('pref')
  })

  it("defaults outputIndex to 0 when missing from entry", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    // Entry without outputIndex
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      make200WithPendingBeefs([makePendingBeef({ txid: 'no-idx' })])
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    const params = ackWallet.internalizeAction.mock.calls[0][0]
    expect(params.outputs[0].outputIndex).toBe(0)
  })

  // --- End-to-end integration ---

  it("full round-trip: 200 with pendingBeefs → internalised → next request has x-bsv-ack", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([
        makePendingBeef({ txid: 'round-trip-1' }),
        makePendingBeef({ txid: 'round-trip-2' }),
      ]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey })

    // First call: gets pendingBeefs, internalises both
    const res1 = await f("https://api.example.com/first")
    expect(res1.status).toBe(200)
    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(2)

    // Second call: ack header present with both txids
    const res2 = await f("https://api.example.com/second")
    expect(res2.status).toBe(200)

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const ackHeader = (fetchMock.mock.calls[1][1]?.headers as Headers).get('x-bsv-ack')!
    const txids = ackHeader.split(',')
    expect(txids).toContain('round-trip-1')
    expect(txids).toContain('round-trip-2')

    // Caller's response body should still be consumable (response.clone() was used)
    const body1 = await res1.json()
    expect(body1.pendingBeefs).toHaveLength(2)
  })

  it("BRC-105 402 → 200 with pendingBeefs → internalised → next call has ack header", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    const brc105ProofConstructor = mockBrc105ProofConstructor()

    // 402 → proof → 200 with pendingBeefs
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(500))
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'brc105-ack' })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey, brc105ProofConstructor })

    // First call: 402 → BRC-105 payment → 200 with pendingBeefs → internalised
    const res1 = await f("https://api.example.com/paid")
    expect(res1.status).toBe(200)
    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(1)

    // Second call: should carry x-bsv-ack
    await f("https://api.example.com/next")

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const nextHeaders = fetchMock.mock.calls[2][1]?.headers as Headers
    expect(nextHeaders.get('x-bsv-ack')).toBe('brc105-ack')
  })

  it("no ackWallet in config → full passthrough, no ack headers, no BEEF processing", async () => {
    // Response has pendingBeefs but no ackWallet configured
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: 'ignored' })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch()

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    // No ack header on either request
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Headers
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers
    expect(firstHeaders.get('x-bsv-ack')).toBeNull()
    expect(secondHeaders.get('x-bsv-ack')).toBeNull()
  })

  // --- senderIdentityKey resolution ---

  it("uses per-entry senderIdentityKey when present", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '02server-fallback-key'
    const entryKey = '02entry-specific-key'

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      make200WithPendingBeefs([makePendingBeef({ txid: 'entry-key-txid', senderIdentityKey: entryKey })])
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    const params = ackWallet.internalizeAction.mock.calls[0][0]
    expect(params.outputs[0].paymentRemittance.senderIdentityKey).toBe(entryKey)
  })

  it("falls back to config serverIdentityKey when entry lacks senderIdentityKey", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '02config-fallback-key'

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      make200WithPendingBeefs([makePendingBeef({ txid: 'fallback-txid' })])
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    const params = ackWallet.internalizeAction.mock.calls[0][0]
    expect(params.outputs[0].paymentRemittance.senderIdentityKey).toBe(serverIdentityKey)
  })

  it("skips BEEF processing when neither entry nor config provides senderIdentityKey", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    // No serverIdentityKey in config, no senderIdentityKey in entry

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      make200WithPendingBeefs([makePendingBeef({ txid: 'no-key-txid' })])
    )

    const f = createX402Fetch({ ackWallet })
    await f("https://api.example.com/data")

    expect(ackWallet.internalizeAction).not.toHaveBeenCalled()
  })

  it("uses explicit outputIndex from entry when provided", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      make200WithPendingBeefs([makePendingBeef({ txid: 'idx-txid', outputIndex: 3 })])
    )

    const f = createX402Fetch({ ackWallet, serverIdentityKey })
    await f("https://api.example.com/data")

    const params = ackWallet.internalizeAction.mock.calls[0][0]
    expect(params.outputs[0].outputIndex).toBe(3)
  })
})

// === BRC-121 tests ===

function makeBrc121Response(satoshis: number = 1000, overrides: Record<string, string> = {}) {
  return new Response("Payment Required", {
    status: 402,
    headers: {
      "x-bsv-sats": String(satoshis),
      "x-bsv-server": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      ...overrides,
    },
  })
}

function mockBrc121ProofConstructor(): (challenge: Brc121Challenge) => Promise<Brc121ProofResult> {
  return vi.fn(async () => ({
    proof: {
      beef: btoa("test-beef"),
      senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      nonce: btoa("12345678"),
      time: "1719500000000",
      vout: "0",
      txid: "brc121-test-txid",
    },
    abort: vi.fn(),
  }))
}

describe("createX402Fetch — BRC-121", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("detects BRC-121 402 and retries with 5 proof headers", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const proofConstructor = mockBrc121ProofConstructor()
    const f = createX402Fetch({ brc121ProofConstructor: proofConstructor })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)
    expect(proofConstructor).toHaveBeenCalledOnce()

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    expect(retryHeaders.get("x-bsv-beef")).toBe(btoa("test-beef"))
    expect(retryHeaders.get("x-bsv-sender")).toBe("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
    expect(retryHeaders.get("x-bsv-nonce")).toBe(btoa("12345678"))
    expect(retryHeaders.get("x-bsv-time")).toBe("1719500000000")
    expect(retryHeaders.get("x-bsv-vout")).toBe("0")
  })

  it("passes through BRC-121 402 when no wallet or proof constructor configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeBrc121Response(1000))
    const f = createX402Fetch()

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
  })

  it("returns original 402 when proof construction fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeBrc121Response(1000))

    const onProofError = vi.fn()
    const f = createX402Fetch({
      brc121ProofConstructor: vi.fn().mockRejectedValue(new Error("Wallet declined")),
      onProofError,
    })

    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
    expect(onProofError).toHaveBeenCalledOnce()
    expect(onProofError).toHaveBeenCalledWith(expect.any(Error), "brc121")
  })

  it("BRC-105 takes priority over BRC-121 when both headers present", async () => {
    const bothHeaders = new Response("Payment Required", {
      status: 402,
      headers: {
        "x-bsv-payment-version": "1.0",
        "x-bsv-payment-satoshis-required": "1000",
        "x-bsv-auth-identity-key": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        "x-bsv-payment-derivation-prefix": "prefix",
        "x-bsv-sats": "1000",
        "x-bsv-server": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      },
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(bothHeaders)
      .mockResolvedValueOnce(make200Response())

    const brc105Proof = mockBrc105ProofConstructor()
    const brc121Proof = mockBrc121ProofConstructor()

    const f = createX402Fetch({
      brc105ProofConstructor: brc105Proof,
      brc121ProofConstructor: brc121Proof,
    })

    await f("https://api.example.com/data")

    expect(brc105Proof).toHaveBeenCalledOnce()
    expect(brc121Proof).not.toHaveBeenCalled()

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    expect(retryHeaders.get("x-bsv-payment")).toBeTruthy()
    expect(retryHeaders.get("x-bsv-beef")).toBeNull()
  })

  it("X402 takes priority over BRC-121 when both headers present", async () => {
    const bothHeaders = new Response("Payment Required", {
      status: 402,
      headers: {
        "X402-Challenge": JSON.stringify({
          nonce: "test-nonce",
          payee: "1TestAddr",
          amount: 1000,
          network: "mainnet",
        }),
        "x-bsv-sats": "1000",
        "x-bsv-server": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      },
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(bothHeaders)
      .mockResolvedValueOnce(make200Response())

    const customProof = vi.fn().mockResolvedValue({ txid: "custom-txid", beef: btoa("mock-tx") })
    const brc121Proof = mockBrc121ProofConstructor()

    const f = createX402Fetch({
      proofConstructor: customProof,
      brc121ProofConstructor: brc121Proof,
    })

    await f("https://api.example.com/data")

    expect(customProof).toHaveBeenCalledOnce()
    expect(brc121Proof).not.toHaveBeenCalled()

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers
    expect(retryHeaders.get("X402-Proof")).toBeTruthy()
    expect(retryHeaders.get("x-bsv-beef")).toBeNull()
  })

  it("does not call abort when server returns 200", async () => {
    const abort = vi.fn()
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-ok-txid",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(abort).not.toHaveBeenCalled()
  })

  it("calls abort and retries with fresh proof when server returns 500", async () => {
    const abort = vi.fn()
    const freshAbort = vi.fn()
    let callCount = 0
    const brc121Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          beef: callCount === 1 ? btoa("original-beef") : btoa("fresh-beef"),
          senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          nonce: btoa("12345678"),
          time: "1719500000000",
          vout: "0",
          txid: callCount === 1 ? "original-txid" : "fresh-txid",
        },
        abort: callCount === 1 ? abort : freshAbort,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(abort).toHaveBeenCalledOnce()
    expect(freshAbort).not.toHaveBeenCalled()
    expect(brc121Proof).toHaveBeenCalledTimes(2)
  })

  it("retries same proof on network error then succeeds on 200", async () => {
    const abort = vi.fn()
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-retry-txid",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof, maxRetries: 1 })

    vi.useFakeTimers()
    const promise = f("https://api.example.com/data")
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(abort).not.toHaveBeenCalled()
    expect(brc121Proof).toHaveBeenCalledOnce()

    // Same proof headers reused on both attempts
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const firstRetryBeef = (fetchMock.mock.calls[1][1]?.headers as Headers).get("x-bsv-beef")
    const secondRetryBeef = (fetchMock.mock.calls[2][1]?.headers as Headers).get("x-bsv-beef")
    expect(firstRetryBeef).toBe(secondRetryBeef)
  })

  it("throws 'payment state unknown' when all network retries exhausted", async () => {
    const abort = vi.fn()
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-fail-txid",
      },
      abort,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockRejectedValue(new TypeError("Failed to fetch"))

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof, maxRetries: 0 })
    await expect(f("https://api.example.com/data")).rejects.toThrow("Payment state unknown")
    expect(abort).not.toHaveBeenCalled()
  })

  it("processes pendingBeefs on successful BRC-121 response", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    const brc121Proof = mockBrc121ProofConstructor()

    // 402 → proof → 200 with pendingBeefs
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(500))
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: "brc121-ack" })]))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey, brc121ProofConstructor: brc121Proof })

    const res1 = await f("https://api.example.com/paid")
    expect(res1.status).toBe(200)
    expect(ackWallet.internalizeAction).toHaveBeenCalledTimes(1)

    // Second call: should carry x-bsv-ack
    await f("https://api.example.com/next")

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const nextHeaders = fetchMock.mock.calls[2][1]?.headers as Headers
    expect(nextHeaders.get("x-bsv-ack")).toBe("brc121-ack")
  })

  it("injects ack headers on BRC-121 retry requests", async () => {
    const ackWallet = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const serverIdentityKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    const brc121Proof = mockBrc121ProofConstructor()

    // First call: 200 with pendingBeefs (primes the ack)
    // Second call: 402 BRC-121 → retry should carry ack header
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(make200WithPendingBeefs([makePendingBeef({ txid: "pre-ack" })]))
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ ackWallet, serverIdentityKey, brc121ProofConstructor: brc121Proof })

    await f("https://api.example.com/first")
    await f("https://api.example.com/second")

    // The second fetch (index 1) is the initial 402 — the third (index 2) is the retry
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    // The initial request of the second call should have carried the ack from first response
    const secondInitialHeaders = fetchMock.mock.calls[1][1]?.headers as Headers
    expect(secondInitialHeaders.get("x-bsv-ack")).toBe("pre-ack")
  })

  it("uses exact header names matching @bsv/402-pay format", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const brc121Proof = mockBrc121ProofConstructor()
    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })

    await f("https://api.example.com/data")

    const retryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const retryHeaders = retryCall[1]?.headers as Headers

    // Verify exact header names (lowercase x-bsv-* per convention)
    const headerNames = [...(retryHeaders as any).entries()].map(([k]: [string, string]) => k)
    expect(headerNames).toContain("x-bsv-beef")
    expect(headerNames).toContain("x-bsv-sender")
    expect(headerNames).toContain("x-bsv-nonce")
    expect(headerNames).toContain("x-bsv-time")
    expect(headerNames).toContain("x-bsv-vout")
  })

  it("calls broadcast on server 200 acceptance", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined)
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-broadcast-txid",
      },
      abort: vi.fn(),
      broadcast,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it("does not call broadcast on server 4xx rejection", async () => {
    const broadcast = vi.fn()
    const abort = vi.fn()
    let callCount = 0
    const brc121Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          beef: btoa("test-beef"),
          senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          nonce: btoa("12345678"),
          time: "1719500000000",
          vout: "0",
          txid: "txid-" + callCount,
        },
        abort,
        broadcast,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
      .mockResolvedValueOnce(new Response("Bad Request Again", { status: 400 }))

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(400)
    expect(broadcast).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalled()
  })

  it("returns response even when broadcast throws", async () => {
    const broadcast = vi.fn().mockRejectedValue(new Error("ARC unavailable"))
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-err-txid",
      },
      broadcast,
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it("handles undefined broadcast gracefully (custom constructor)", async () => {
    const brc121Proof = vi.fn().mockResolvedValue({
      proof: {
        beef: btoa("test-beef"),
        senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        nonce: btoa("12345678"),
        time: "1719500000000",
        vout: "0",
        txid: "brc121-nobc-txid",
      },
      // no broadcast
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
  })

  it("calls fresh broadcast on server rejection then fresh retry success", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined)
    const freshBroadcast = vi.fn().mockResolvedValue(undefined)
    let callCount = 0
    const brc121Proof = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        proof: {
          beef: callCount === 1 ? btoa("original-beef") : btoa("fresh-beef"),
          senderIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          nonce: btoa("12345678"),
          time: "1719500000000",
          vout: "0",
          txid: callCount === 1 ? "original-txid" : "fresh-txid",
        },
        abort: vi.fn(),
        broadcast: callCount === 1 ? broadcast : freshBroadcast,
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc121Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(make200Response())

    const f = createX402Fetch({ brc121ProofConstructor: brc121Proof })
    const res = await f("https://api.example.com/data")

    expect(res.status).toBe(200)
    // Original broadcast NOT called (server rejected original proof)
    expect(broadcast).not.toHaveBeenCalled()
    // Fresh broadcast called on success
    expect(freshBroadcast).toHaveBeenCalledOnce()
  })
})
