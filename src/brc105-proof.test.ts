import { describe, expect, it, vi } from "vitest"
import {
  constructBrc105Proof,
  ripemd160,
  hash160,
  pubkeyToP2PKHLockingScript,
  createDerivationSuffix,
} from "./brc105-proof"
import type { Brc105Challenge, Brc105Wallet } from "./types"

// === Test fixtures ===

const CHALLENGE: Brc105Challenge = {
  version: "1.0",
  satoshisRequired: 1000,
  serverIdentityKey: "02c0d1f9a09e0f6f5e1d8b3d3f9c6c5c1e4b2a0f8d7e6c5b4a3928170605041234",
  derivationPrefix: "AQID",
  authenticated: false,
}

// Known compressed public key (33 bytes hex) for testing locking script derivation
const TEST_PUBKEY_HEX = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
// Expected hash160 of the above (secp256k1 generator point)
const TEST_PUBKEY_HASH160 = "751e76e8199196d454941c45d1b3a323f1433bd6"

function mockWallet(overrides: Partial<Brc105Wallet> = {}): Brc105Wallet {
  return {
    getPublicKey: vi.fn().mockResolvedValue({ publicKey: TEST_PUBKEY_HEX }),
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

// === RIPEMD-160 ===

describe("ripemd160", () => {
  it("produces correct digest for empty input", () => {
    // RIPEMD-160("") = 9c1185a5c5e9fc54612808977ee8f548b2258d31
    const result = ripemd160(new Uint8Array(0))
    const hex = Array.from(result).map((b) => b.toString(16).padStart(2, "0")).join("")
    expect(hex).toBe("9c1185a5c5e9fc54612808977ee8f548b2258d31")
  })

  it("produces correct digest for 'abc'", () => {
    // RIPEMD-160("abc") = 8eb208f7e05d987a9b044a8e98c6b087f15a0bfc
    const input = new TextEncoder().encode("abc")
    const result = ripemd160(input)
    const hex = Array.from(result).map((b) => b.toString(16).padStart(2, "0")).join("")
    expect(hex).toBe("8eb208f7e05d987a9b044a8e98c6b087f15a0bfc")
  })

  it("produces correct digest for 'message digest'", () => {
    // RIPEMD-160("message digest") = 5d0689ef49d2fae572b881b123a85ffa21595f36
    const input = new TextEncoder().encode("message digest")
    const result = ripemd160(input)
    const hex = Array.from(result).map((b) => b.toString(16).padStart(2, "0")).join("")
    expect(hex).toBe("5d0689ef49d2fae572b881b123a85ffa21595f36")
  })

  it("produces 20-byte output", () => {
    const result = ripemd160(new Uint8Array([1, 2, 3]))
    expect(result.length).toBe(20)
  })
})

// === hash160 ===

describe("hash160", () => {
  it("correctly hashes the secp256k1 generator point public key", async () => {
    const pubkeyBytes = new Uint8Array(
      TEST_PUBKEY_HEX.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
    )
    const result = await hash160(pubkeyBytes)
    const hex = Array.from(result).map((b) => b.toString(16).padStart(2, "0")).join("")
    expect(hex).toBe(TEST_PUBKEY_HASH160)
  })
})

// === pubkeyToP2PKHLockingScript ===

describe("pubkeyToP2PKHLockingScript", () => {
  it("builds correct P2PKH locking script from compressed pubkey", async () => {
    const script = await pubkeyToP2PKHLockingScript(TEST_PUBKEY_HEX)
    expect(script).toBe(`76a914${TEST_PUBKEY_HASH160}88ac`)
  })

  it("produces a valid P2PKH script pattern", async () => {
    const script = await pubkeyToP2PKHLockingScript(TEST_PUBKEY_HEX)
    expect(script).toMatch(/^76a914[0-9a-f]{40}88ac$/)
  })
})

// === createDerivationSuffix ===

describe("createDerivationSuffix", () => {
  it("calls createHmac with correct protocol parameters", async () => {
    const wallet = mockWallet()
    await createDerivationSuffix(wallet)

    expect(wallet.createHmac).toHaveBeenCalledOnce()
    const call = (wallet.createHmac as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.protocolID).toEqual([2, "server hmac"])
    expect(call.counterparty).toBe("self")
    expect(call.data).toHaveLength(16)
    expect(typeof call.keyID).toBe("string")
  })

  it("returns a base64 string", async () => {
    const wallet = mockWallet()
    const suffix = await createDerivationSuffix(wallet)
    // Base64 should decode without error
    expect(typeof suffix).toBe("string")
    expect(suffix.length).toBeGreaterThan(0)
    // 16 random bytes + 32 HMAC bytes = 48 bytes → 64 base64 chars
    expect(atob(suffix)).toHaveLength(48)
  })
})

// === constructBrc105Proof ===

describe("constructBrc105Proof", () => {
  it("returns correct proof shape including clientIdentityKey", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc105Proof(CHALLENGE, wallet)

    expect(proof).toHaveProperty("derivationPrefix")
    expect(proof).toHaveProperty("derivationSuffix")
    expect(proof).toHaveProperty("transaction")
    expect(proof).toHaveProperty("clientIdentityKey")
    expect(proof).toHaveProperty("txid")
    expect(proof.derivationPrefix).toBe(CHALLENGE.derivationPrefix)
    expect(typeof proof.derivationSuffix).toBe("string")
    expect(typeof proof.transaction).toBe("string")
    expect(proof.clientIdentityKey).toBe(TEST_PUBKEY_HEX)
    expect(proof.txid).toBe("aabbccdd")
  })

  it("fetches client identity key via getPublicKey({ identityKey: true })", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    // First call: identity key
    expect(calls[0][0]).toEqual({ identityKey: true })
    // Second call: BRC-29 derivation
    expect(calls[1][0].protocolID).toEqual([2, "3241645161d8"])
  })

  it("always uses server identity key as counterparty", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    // Second call is the BRC-29 derivation
    expect(calls[1][0].counterparty).toBe(CHALLENGE.serverIdentityKey)
    // keyID must be "${prefix} ${suffix}" (space-separated)
    expect(calls[1][0].keyID).toMatch(new RegExp(`^${CHALLENGE.derivationPrefix} .+$`))
  })

  it("uses space-separated keyID format (static test vector)", async () => {
    // Given derivationPrefix = "AQID" and a known suffix, keyID must be "AQID <suffix>"
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const calls = (wallet.getPublicKey as ReturnType<typeof vi.fn>).mock.calls
    const derivationCall = calls[1][0]
    const parts = derivationCall.keyID.split(" ")
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBe("AQID")
    expect(parts[1].length).toBeGreaterThan(0)
  })

  it("calls createAction with correct satoshis and lockingScript", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    expect(wallet.createAction).toHaveBeenCalledOnce()
    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.outputs).toHaveLength(1)
    expect(params.outputs[0].satoshis).toBe(CHALLENGE.satoshisRequired)
    expect(params.outputs[0].lockingScript).toMatch(/^76a914[0-9a-f]{40}88ac$/)
  })

  it("sets outputDescription on the payment output", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.outputs[0].outputDescription).toBe("HTTP request payment")
  })

  it("includes origin in action description when provided", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet, "https://api.example.com")

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("Payment for request to https://api.example.com")
  })

  it("uses generic description when origin is not provided", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.description).toBe("BRC-105 payment")
  })

  it("includes customInstructions with derivation data and payee", async () => {
    const wallet = mockWallet()
    const { proof } = await constructBrc105Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const instructions = JSON.parse(params.outputs[0].customInstructions)
    expect(instructions.derivationPrefix).toBe(CHALLENGE.derivationPrefix)
    expect(instructions.derivationSuffix).toBe(proof.derivationSuffix)
    expect(instructions.payee).toBe(CHALLENGE.serverIdentityKey)
  })

  it("sets randomizeOutputs to false", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.options.randomizeOutputs).toBe(false)
  })

  it("calls createAction with noSend: true and returnTXIDOnly: false", async () => {
    const wallet = mockWallet()
    await constructBrc105Proof(CHALLENGE, wallet)

    const params = (wallet.createAction as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.options.noSend).toBe(true)
    expect(params.options.returnTXIDOnly).toBe(false)
  })

  it("returns abort callback when wallet has abortAction", async () => {
    const wallet = mockWallet({
      abortAction: vi.fn().mockResolvedValue({ aborted: true }),
    })
    const { proof, abort } = await constructBrc105Proof(CHALLENGE, wallet)

    expect(proof).toBeDefined()
    expect(abort).toBeDefined()
  })

  it("returns undefined abort when wallet lacks abortAction", async () => {
    const wallet = mockWallet()
    const { proof, abort } = await constructBrc105Proof(CHALLENGE, wallet)

    expect(proof).toBeDefined()
    expect(abort).toBeUndefined()
  })

  it("handles rawTx hex string → base64 conversion", async () => {
    const rawTxHex = "deadbeef"
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", rawTx: rawTxHex }),
    })
    const { proof } = await constructBrc105Proof(CHALLENGE, wallet)

    // deadbeef → base64 = "3q2+7w=="
    const decoded = atob(proof.transaction)
    const bytes = Array.from(decoded).map((c) => c.charCodeAt(0))
    expect(bytes).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it("throws on odd-length rawTx hex string", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", rawTx: "deadbee" }),
    })
    await expect(constructBrc105Proof(CHALLENGE, wallet)).rejects.toThrow("even length")
  })

  it("handles tx number array → base64 conversion", async () => {
    const txBytes = [0xca, 0xfe, 0xba, 0xbe]
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb", tx: txBytes }),
    })
    const { proof } = await constructBrc105Proof(CHALLENGE, wallet)

    const decoded = atob(proof.transaction)
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
    const { proof } = await constructBrc105Proof(CHALLENGE, wallet)

    const decoded = atob(proof.transaction)
    const bytes = Array.from(decoded).map((c) => c.charCodeAt(0))
    expect(bytes).toEqual(txBytes)
  })

  it("throws when wallet returns no transaction data", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockResolvedValue({ txid: "aabb" }),
    })
    await expect(constructBrc105Proof(CHALLENGE, wallet)).rejects.toThrow(
      "Wallet returned no transaction data",
    )
  })

  it("propagates wallet errors from getPublicKey", async () => {
    const wallet = mockWallet({
      getPublicKey: vi.fn().mockRejectedValue(new Error("Key derivation failed")),
    })
    await expect(constructBrc105Proof(CHALLENGE, wallet)).rejects.toThrow(
      "Key derivation failed",
    )
  })

  it("propagates wallet errors from createAction", async () => {
    const wallet = mockWallet({
      createAction: vi.fn().mockRejectedValue(new Error("Insufficient funds")),
    })
    await expect(constructBrc105Proof(CHALLENGE, wallet)).rejects.toThrow(
      "Insufficient funds",
    )
  })

  it("propagates wallet errors from createHmac", async () => {
    const wallet = mockWallet({
      createHmac: vi.fn().mockRejectedValue(new Error("HMAC generation failed")),
    })
    await expect(constructBrc105Proof(CHALLENGE, wallet)).rejects.toThrow(
      "HMAC generation failed",
    )
  })
})
