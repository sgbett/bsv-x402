import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createX402Fetch, payeeAddressToLockingScript, verifyBase58Checksum } from "./x402-fetch"
import type { Brc105Challenge, Brc105ProofResult } from "./types"

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

  it("propagates original error when abort() throws during server rejection", async () => {
    const abort = vi.fn().mockRejectedValue(new Error("abort failed"))
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
      }
    })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeBrc105Response(1000))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))

    const f = createX402Fetch({ brc105ProofConstructor: brc105Proof })
    await expect(f("https://api.example.com/data")).rejects.toThrow("abort failed")
  })
})
