import { describe, expect, it, vi } from "vitest"
import { constructPayGatewayProof } from "./paygateway-proof"
import type { PayGatewayChallenge, Brc105Wallet } from "./types"

// === Test fixtures ===

const CHALLENGE: PayGatewayChallenge = {
  x402Version: 2,
  resource: { url: "/api/expensive" },
  accepts: [
    {
      scheme: "exact",
      network: "bsv:mainnet",
      amount: "100",
      asset: "BSV",
      payTo: "76a914abcdef012345678900000000000000000000000088ac",
      maxTimeoutSeconds: 60,
      extra: {
        payToSig: "hmac-signature-value",
      },
    },
  ],
  selectedAccept: {
    scheme: "exact",
    network: "bsv:mainnet",
    amount: "100",
    asset: "BSV",
    payTo: "76a914abcdef012345678900000000000000000000000088ac",
    maxTimeoutSeconds: 60,
    extra: {
      payToSig: "hmac-signature-value",
    },
  },
}

function mockWallet(overrides: Partial<Brc105Wallet> = {}): Brc105Wallet {
  return {
    getPublicKey: vi.fn().mockResolvedValue({
      publicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    }),
    createHmac: vi.fn().mockResolvedValue({
      hmac: Array.from({ length: 32 }, (_, i) => i),
    }),
    createAction: vi.fn().mockResolvedValue({
      txid: "aabbccdd",
      rawTx: "0100000001000000000000000000",
    }),
    ...overrides,
  }
}

// === constructPayGatewayProof ===

describe("constructPayGatewayProof", () => {
  it("returns correct proof shape with rawtx, txid", async () => {
    const abortAction = vi.fn().mockResolvedValue({ aborted: true })
    const wallet = mockWallet({ abortAction })
    const { proof, abort, broadcast } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(proof).toHaveProperty("rawtx")
    expect(proof).toHaveProperty("txid")
    expect(typeof proof.rawtx).toBe("string")
    expect(proof.txid).toBe("aabbccdd")
    expect(abort).toBeDefined()
    expect(broadcast).toBeDefined()
  })

  it("calls createAction with correct satoshis and lockingScript", async () => {
    const wallet = mockWallet()
    await constructPayGatewayProof(CHALLENGE, wallet)

    expect(wallet.createAction).toHaveBeenCalledOnce()
    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.outputs).toHaveLength(1)
    expect(params.outputs[0].satoshis).toBe(100)
    expect(params.outputs[0].lockingScript).toBe(CHALLENGE.selectedAccept.payTo)
  })

  it("calls createAction with noSend: true and returnTXIDOnly: false", async () => {
    const wallet = mockWallet()
    await constructPayGatewayProof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.options.noSend).toBe(true)
    expect(params.options.returnTXIDOnly).toBe(false)
    expect(params.options.randomizeOutputs).toBe(false)
  })

  it("includes origin in action description when provided", async () => {
    const wallet = mockWallet()
    await constructPayGatewayProof(CHALLENGE, wallet, "https://api.example.com")

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("Payment for request to https://api.example.com")
  })

  it("uses generic description when origin is not provided", async () => {
    const wallet = mockWallet()
    await constructPayGatewayProof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("PayGateway payment")
  })

  // === tx format handling ===

  it("handles rawTx hex string directly as rawtx", async () => {
    const rawTxHex = "deadbeef01020304"
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", rawTx: rawTxHex }),
    })
    const { proof } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(proof.rawtx).toBe(rawTxHex)
    expect(proof.beef).toBeUndefined()
  })

  it("handles tx number array → hex conversion and includes beef", async () => {
    const txBytes = [0xca, 0xfe, 0xba, 0xbe]
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", tx: txBytes }),
    })
    const { proof } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(proof.rawtx).toBe("cafebabe")
    expect(proof.beef).toBeDefined()
    // Verify beef is valid base64 that decodes to the same bytes
    const decoded = atob(proof.beef!)
    const bytes = Array.from(decoded).map((c) => c.charCodeAt(0))
    expect(bytes).toEqual(txBytes)
  })

  it("prefers tx number array over rawTx when both are present", async () => {
    const txBytes = [0xca, 0xfe]
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({
        txid: "aabb",
        tx: txBytes,
        rawTx: "deadbeef",
      }),
    })
    const { proof } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(proof.rawtx).toBe("cafe")
    expect(proof.beef).toBeDefined()
  })

  it("throws when wallet returns no transaction data", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb" }),
    })
    await expect(constructPayGatewayProof(CHALLENGE, wallet)).rejects.toThrow(
      "Wallet returned no transaction data",
    )
  })

  // === Error handling ===

  it("propagates wallet errors from createAction", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockRejectedValue(new Error("Insufficient funds")),
    })
    await expect(constructPayGatewayProof(CHALLENGE, wallet)).rejects.toThrow(
      "Insufficient funds",
    )
  })

  it("throws on invalid amount", async () => {
    const badChallenge: PayGatewayChallenge = {
      ...CHALLENGE,
      selectedAccept: { ...CHALLENGE.selectedAccept, amount: "not-a-number" },
    }
    const wallet = mockWallet()
    await expect(constructPayGatewayProof(badChallenge, wallet)).rejects.toThrow(
      'invalid amount "not-a-number"',
    )
  })

  it("throws on zero amount", async () => {
    const badChallenge: PayGatewayChallenge = {
      ...CHALLENGE,
      selectedAccept: { ...CHALLENGE.selectedAccept, amount: "0" },
    }
    const wallet = mockWallet()
    await expect(constructPayGatewayProof(badChallenge, wallet)).rejects.toThrow(
      'invalid amount "0"',
    )
  })

  // === Abort callback ===

  it("abort callback calls wallet.abortAction with txid", async () => {
    const abortAction = vi.fn().mockResolvedValue({ aborted: true })
    const wallet = mockWallet({ abortAction })
    const { proof, abort } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(abort).toBeDefined()
    await abort!()
    expect(abortAction).toHaveBeenCalledOnce()
    expect(abortAction).toHaveBeenCalledWith({ reference: proof.txid })
  })

  it("abort callback swallows errors", async () => {
    const abortAction = vi.fn().mockRejectedValue(new Error("abort failed"))
    const wallet = mockWallet({ abortAction })
    const { abort } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(abort).toBeDefined()
    await expect(abort!()).resolves.toBeUndefined()
  })

  it("returns undefined abort when wallet lacks abortAction", async () => {
    const wallet = mockWallet()
    delete (wallet as any).abortAction
    const { abort } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(abort).toBeUndefined()
  })

  // === Broadcast callback ===

  it("broadcast callback calls wallet.createAction with sendWith", async () => {
    const wallet = mockWallet()
    const { proof, broadcast } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(broadcast).toBeDefined()
    await broadcast!()
    // createAction is called once for the payment, once for broadcast
    const calls = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toEqual({
      description: 'Broadcast x402 payment',
      outputs: [],
      options: { sendWith: [proof.txid] },
    })
  })

  it("broadcast callback swallows errors", async () => {
    const createAction = vi.fn()
      .mockResolvedValueOnce({ txid: "aabbccdd", rawTx: "0100000001000000000000000000" })
      .mockRejectedValueOnce(new Error("broadcast failed"))
    const wallet = mockWallet({ createAction })
    const { broadcast } = await constructPayGatewayProof(CHALLENGE, wallet)

    expect(broadcast).toBeDefined()
    await expect(broadcast!()).resolves.toBeUndefined()
  })

  // === Amount parsing ===

  it("parses amount string to integer satoshis", async () => {
    const challenge: PayGatewayChallenge = {
      ...CHALLENGE,
      selectedAccept: { ...CHALLENGE.selectedAccept, amount: "5000" },
    }
    const wallet = mockWallet()
    await constructPayGatewayProof(challenge, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.outputs[0].satoshis).toBe(5000)
  })
})
