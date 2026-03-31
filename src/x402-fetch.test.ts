import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createX402Fetch, payeeAddressToLockingScript } from "./x402-fetch"
import type { LimitState, SitePolicy, StorageAdapter } from "./types"

const NOW = 1_700_000_000_000

function mockStorage(): StorageAdapter {
  let state: LimitState | null = null
  let policies: Record<string, SitePolicy> = {}
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async (s: LimitState) => { state = s }),
    loadSitePolicies: vi.fn(async () => policies),
    saveSitePolicies: vi.fn(async (p: Record<string, SitePolicy>) => { policies = p }),
  }
}

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
    const f = createX402Fetch({
      storage: mockStorage(),
      now: () => NOW,
    })
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(200)
  })

  it("passes through 402 without X402-Challenge header", async () => {
    const bare402 = new Response("Payment Required", { status: 402 })
    globalThis.fetch = vi.fn().mockResolvedValue(bare402)
    const f = createX402Fetch({
      storage: mockStorage(),
      now: () => NOW,
    })
    const res = await f("https://api.example.com/data")
    expect(res.status).toBe(402)
  })

  it("blocks per-tx limit exceeded without tripping circuit breaker", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(999_999_999))
    const onLimitReached = vi.fn()
    const storage = mockStorage()

    const f = createX402Fetch({
      tier: "I'm Too Young to Die",
      storage,
      now: () => NOW,
      onLimitReached,
    })

    // 999M sats exceeds per-tx max (100M for interactive Too Young to Die)
    const res = await f("https://api.example.com/expensive")
    expect(res.status).toBe(402)
    expect(onLimitReached).toHaveBeenCalledOnce()
    // Per-tx blocks are routine rejections — breaker should NOT trip
    expect(f.getState().circuitBroken).toBe(false)
  })

  it("trips circuit breaker on BFG daily ceiling", async () => {
    // Use Nightmare with tight limits to accumulate spend then hit BFG daily ceiling
    // BFG per-tx ceiling is 1B, BFG daily ceiling is 10B
    // Make 11 payments of 999M each (under per-tx BFG) to exceed daily BFG
    const storage = mockStorage()
    const proofConstructor = vi.fn().mockResolvedValue({ txid: "mock", rawTx: "00" })

    const f = createX402Fetch({
      tier: "Nightmare!",
      nightmareConfirmation: "NIGHTMARE",
      storage,
      proofConstructor,
      now: () => NOW,
    })

    // Make 10 payments of 999M each = 9.99B (just under 10B daily BFG)
    for (let i = 0; i < 10; i++) {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(make402Response(999_000_000))
        .mockResolvedValueOnce(make200Response())
      await f("https://api.example.com/big")
    }
    expect(f.getState().circuitBroken).toBe(false)

    // 11th payment pushes over 10B daily BFG ceiling → trips breaker
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(999_000_000))
    await f("https://api.example.com/toomuch")
    expect(f.getState().circuitBroken).toBe(true)
  })

  it("blocks all payments after circuit breaker trips", async () => {
    const storage = mockStorage()
    const proofConstructor = vi.fn().mockResolvedValue({ txid: "mock", rawTx: "00" })

    const f = createX402Fetch({
      tier: "Nightmare!",
      nightmareConfirmation: "NIGHTMARE",
      storage,
      proofConstructor,
      now: () => NOW,
    })

    // Accumulate past BFG daily ceiling
    for (let i = 0; i < 11; i++) {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(make402Response(999_000_000))
        .mockResolvedValueOnce(make200Response())
      await f("https://api.example.com/big")
    }
    // 11th should have tripped (10.989B > 10B)... but the 11th payment succeeded
    // because check runs before record. The 12th will see the accumulated total.
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(1))
    await f("https://api.example.com/trip")
    expect(f.getState().circuitBroken).toBe(true)

    // Now even a cheap payment should be blocked
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(1))
    const res = await f("https://api.example.com/cheap")
    expect(res.status).toBe(402)
  })

  it("invokes onYellowLight callback when approaching limits", async () => {
    // Use tight limits to trigger yellow light easily
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(90_000))
    const onYellowLight = vi.fn().mockResolvedValue(false)
    const storage = mockStorage()

    const f = createX402Fetch({
      storage,
      now: () => NOW,
      onYellowLight,
      limits: {
        windows: [{ window: "hour", maxSatoshis: 100_000, maxTransactions: 100 }],
        perTxMaxSatoshis: 100_000,
        yellowLightThreshold: 0.5,
        requirePerSitePrompt: false,
      },
    })

    const res = await f("https://api.example.com/data")
    // 90k is 90% of 100k limit, above 50% threshold → yellow light
    expect(onYellowLight).toHaveBeenCalledOnce()
    expect(res.status).toBe(402) // Payment blocked because callback returned false
  })

  it("throws when Nightmare tier used without confirmation", () => {
    expect(() => createX402Fetch({ tier: "Nightmare!" })).toThrow(
      'nightmareConfirmation: "NIGHTMARE"',
    )
  })

  it("allows Nightmare tier with correct confirmation", () => {
    const f = createX402Fetch({
      tier: "Nightmare!",
      nightmareConfirmation: "NIGHTMARE",
      storage: mockStorage(),
    })
    expect(f).toBeDefined()
  })

  it("extracts origin from string URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make200Response())
    const storage = mockStorage()
    const f = createX402Fetch({ storage, now: () => NOW })
    await f("https://api.example.com/data")
    // Just verifying it doesn't throw on origin extraction
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  describe("resetLimits", () => {
    it("clears the circuit breaker", async () => {
      const twoFactor = { verify: vi.fn().mockResolvedValue(true) }
      const storage = mockStorage()
      const proofConstructor = vi.fn().mockResolvedValue({ txid: "mock", rawTx: "00" })

      const f = createX402Fetch({
        tier: "Nightmare!",
        nightmareConfirmation: "NIGHTMARE",
        twoFactorProvider: twoFactor,
        storage,
        proofConstructor,
        now: () => NOW,
      })

      // Accumulate past BFG daily ceiling to trip breaker
      for (let i = 0; i < 11; i++) {
        globalThis.fetch = vi.fn()
          .mockResolvedValueOnce(make402Response(999_000_000))
          .mockResolvedValueOnce(make200Response())
        await f("https://api.example.com/big")
      }
      globalThis.fetch = vi.fn().mockResolvedValue(make402Response(1))
      await f("https://api.example.com/trip")
      expect(f.getState().circuitBroken).toBe(true)

      // Reset (2FA provider approves)
      await f.resetLimits()
      expect(f.getState().circuitBroken).toBe(false)
    })

    it("requires 2FA when configured", async () => {
      const twoFactor = { verify: vi.fn().mockResolvedValue(false) }
      const storage = mockStorage()
      const f = createX402Fetch({
        storage,
        twoFactorProvider: twoFactor,
        limits: {
          require2fa: {
            onCircuitBreakerReset: true,
            onTierChange: false,
            onHighValueTx: false,
            highValueThreshold: 0,
            onNewSiteApproval: false,
          },
        },
        now: () => NOW,
      })

      await expect(f.resetLimits()).rejects.toThrow("2FA verification failed")
    })

    it("throws when 2FA required but no provider configured", async () => {
      const storage = mockStorage()
      const f = createX402Fetch({
        storage,
        // No twoFactorProvider — but tier default requires 2FA for reset
        limits: {
          require2fa: {
            onCircuitBreakerReset: true,
            onTierChange: false,
            onHighValueTx: false,
            highValueThreshold: 0,
            onNewSiteApproval: false,
          },
        },
        now: () => NOW,
      })

      await expect(f.resetLimits()).rejects.toThrow("no twoFactorProvider configured")
    })
  })

  describe("2FA without provider", () => {
    it("blocks high-value tx when 2FA required but no provider configured", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(make402Response(60_000_000))
      const storage = mockStorage()

      const f = createX402Fetch({
        storage,
        // No twoFactorProvider
        limits: {
          require2fa: {
            onCircuitBreakerReset: false,
            onTierChange: false,
            onHighValueTx: true,
            highValueThreshold: 50_000_000,
            onNewSiteApproval: false,
          },
        },
        now: () => NOW,
      })

      // 60M exceeds 50M threshold — should be blocked without provider
      const res = await f("https://api.example.com/expensive")
      expect(res.status).toBe(402)
    })

    it("allows tx below 2FA threshold even without provider", async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(make402Response(10_000))
        .mockResolvedValueOnce(make200Response())
      const storage = mockStorage()

      const f = createX402Fetch({
        storage,
        proofConstructor: async (c) => ({ txid: `mock-${c.nonce}`, rawTx: "00" }),
        limits: {
          require2fa: {
            onCircuitBreakerReset: false,
            onTierChange: false,
            onHighValueTx: true,
            highValueThreshold: 50_000_000,
            onNewSiteApproval: false,
          },
        },
        now: () => NOW,
      })

      // 10k is well below 50M threshold — should proceed
      const res = await f("https://api.example.com/cheap")
      expect(res.status).toBe(200)
    })
  })
})

describe("payeeAddressToLockingScript", () => {
  it("decodes a valid mainnet P2PKH address", () => {
    // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa (Satoshi's address on BTC, version 0x00)
    const script = payeeAddressToLockingScript("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")
    expect(script).toMatch(/^76a914[0-9a-f]{40}88ac$/)
    expect(script).toBe("76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac")
  })

  it("decodes a valid testnet P2PKH address", () => {
    // mfWxJ45yp2SFn7UciZyNpvDKrzbi36LaVX (testnet, version 0x6f)
    const script = payeeAddressToLockingScript("mfWxJ45yp2SFn7UciZyNpvDKrzbi36LaVX")
    expect(script).toMatch(/^76a914[0-9a-f]{40}88ac$/)
  })

  it("handles addresses with leading 1s (zero bytes)", () => {
    // 1111111111111111111114oLvT2 is a valid address (all-zero pubkey hash)
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
    // 3-prefixed addresses are P2SH (version 0x05), not P2PKH
    expect(() => payeeAddressToLockingScript("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"))
      .toThrow("Unsupported address version")
  })
})
