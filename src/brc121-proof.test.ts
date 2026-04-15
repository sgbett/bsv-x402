import { describe, expect, it, vi } from "vitest"
import { constructBrc121Proof } from "./brc121-proof"
import type { Brc121Challenge, Brc105Wallet } from "./types"

// === Test fixtures ===

const CHALLENGE: Brc121Challenge = {
  satoshis: 1000,
  serverIdentityKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
}

const TEST_PUBKEY_HEX = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"

function mockWallet(overrides: Partial<Brc105Wallet> = {}): Brc105Wallet {
  return {
    getPublicKey: vi.fn().mockResolvedValue({
      publicKey: TEST_PUBKEY_HEX,
    }),
    createHmac: vi.fn().mockResolvedValue({
      hmac: Array.from({ length: 32 }, () => 0xab),
    }),
    createAction: vi.fn().mockResolvedValue({
      txid: "abc123def456",
      tx: Array.from({ length: 20 }, (_, i) => i),
    }),
    ...overrides,
  }
}

// === constructBrc121Proof ===

describe("constructBrc121Proof", () => {
  it("returns correct proof shape with all 6 fields", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(proof).toHaveProperty("beef")
    expect(proof).toHaveProperty("senderIdentityKey")
    expect(proof).toHaveProperty("nonce")
    expect(proof).toHaveProperty("time")
    expect(proof).toHaveProperty("vout")
    expect(proof).toHaveProperty("txid")
    expect(typeof proof.beef).toBe("string")
    expect(typeof proof.senderIdentityKey).toBe("string")
    expect(typeof proof.nonce).toBe("string")
    expect(typeof proof.time).toBe("string")
    expect(typeof proof.vout).toBe("string")
    expect(typeof proof.txid).toBe("string")
  })

  it("sets vout to '0'", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(proof.vout).toBe("0")
  })

  it("sets time to a valid decimal Unix ms timestamp string", async () => {
    const before = Date.now()
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)
    const after = Date.now()

    const parsed = Number(proof.time)
    expect(Number.isFinite(parsed)).toBe(true)
    expect(Number.isInteger(parsed)).toBe(true)
    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(after)
  })

  it("sets nonce to valid base64 that decodes to 8 bytes", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    // Should not throw
    const decoded = atob(proof.nonce)
    expect(decoded).toHaveLength(8)
  })

  it("uses derivation suffix that is base64 of the UTF-8 time string", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    // The suffix used in keyID should be btoa(time)
    const expectedSuffix = btoa(proof.time)
    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    // Second call is BRC-29 derivation
    const keyID: string = calls[1][0].keyID
    const parts = keyID.split(" ")
    expect(parts[1]).toBe(expectedSuffix)
  })

  it("calls getPublicKey with identityKey: true for sender key", async () => {
    const wallet = mockWallet()
    await constructBrc121Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toEqual({ identityKey: true })
  })

  it("calls getPublicKey with BRC-29 protocol for key derivation", async () => {
    const wallet = mockWallet()
    await constructBrc121Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    const derivationCall = calls[1][0]
    expect(derivationCall.protocolID).toEqual([2, "3241645161d8"])
    expect(derivationCall.counterparty).toBe(CHALLENGE.serverIdentityKey)
  })

  it("uses space-separated keyID format: nonce + base64 timestamp", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    const derivationCall = calls[1][0]
    const parts = derivationCall.keyID.split(" ")
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBe(proof.nonce)
    expect(parts[1]).toBe(btoa(proof.time))
  })

  it("calls createAction with correct satoshis, noSend: true, randomizeOutputs: false", async () => {
    const wallet = mockWallet()
    await constructBrc121Proof(CHALLENGE, wallet)

    expect(wallet.createAction).toHaveBeenCalledOnce()
    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.outputs).toHaveLength(1)
    expect(params.outputs[0].satoshis).toBe(CHALLENGE.satoshis)
    expect(params.options.noSend).toBe(true)
    expect(params.options.randomizeOutputs).toBe(false)
    expect(params.options.returnTXIDOnly).toBe(false)
  })

  it("handles tx (number[]) to base64 conversion", async () => {
    const txBytes = [0xca, 0xfe, 0xba, 0xbe]
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", tx: txBytes }),
    })
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    const decoded = atob(proof.beef)
    const bytes = Array.from(decoded).map((c) => c.charCodeAt(0))
    expect(bytes).toEqual(txBytes)
  })

  it("handles rawTx (hex string) to base64 conversion", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", rawTx: "deadbeef" }),
    })
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    const decoded = atob(proof.beef)
    const bytes = Array.from(decoded).map((c) => c.charCodeAt(0))
    expect(bytes).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it("throws when wallet returns no transaction data", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb" }),
    })
    await expect(constructBrc121Proof(CHALLENGE, wallet)).rejects.toThrow(
      "Wallet returned no transaction data",
    )
  })

  it("returns abort callback when wallet has abortAction", async () => {
    const abortAction = vi.fn().mockResolvedValue({ aborted: true })
    const wallet = mockWallet({ abortAction })
    const { proof, abort } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(abort).toBeDefined()
    await abort!()
    expect(abortAction).toHaveBeenCalledOnce()
    expect(abortAction).toHaveBeenCalledWith({ reference: proof.txid })
  })

  it("returns undefined abort when wallet lacks abortAction", async () => {
    const wallet = mockWallet()
    const { abort } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(abort).toBeUndefined()
  })

  it("abort callback swallows errors from wallet.abortAction", async () => {
    const abortAction = vi.fn().mockRejectedValue(new Error("abort failed"))
    const wallet = mockWallet({ abortAction })
    const { abort } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(abort).toBeDefined()
    await expect(abort!()).resolves.toBeUndefined()
  })

  it("sets senderIdentityKey from wallet identity key", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc121Proof(CHALLENGE, wallet)

    expect(proof.senderIdentityKey).toBe(TEST_PUBKEY_HEX)
  })

  it("includes origin in action description when provided", async () => {
    const wallet = mockWallet()
    await constructBrc121Proof(CHALLENGE, wallet, "https://api.example.com")

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("Payment for request to https://api.example.com")
  })

  it("uses generic description when origin is not provided", async () => {
    const wallet = mockWallet()
    await constructBrc121Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("BRC-121 payment")
  })
})
