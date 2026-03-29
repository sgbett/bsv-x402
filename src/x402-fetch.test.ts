import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createX402Fetch } from "./x402-fetch"
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

  it("blocks payment when per-tx limit exceeded and trips circuit breaker", async () => {
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
    expect(res.status).toBe(402) // Original 402 returned
    expect(onLimitReached).toHaveBeenCalledOnce()
    expect(f.getState().circuitBroken).toBe(true)
  })

  it("blocks all payments after circuit breaker trips", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(make402Response(999_999_999))
    const storage = mockStorage()

    const f = createX402Fetch({
      tier: "I'm Too Young to Die",
      storage,
      now: () => NOW,
    })

    // Trip the breaker
    await f("https://api.example.com/expensive")
    expect(f.getState().circuitBroken).toBe(true)

    // Even a cheap payment should be blocked
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
      globalThis.fetch = vi.fn().mockResolvedValue(make402Response(999_999_999))
      const storage = mockStorage()
      const f = createX402Fetch({
        tier: "I'm Too Young to Die",
        storage,
        now: () => NOW,
      })

      // Trip the breaker
      await f("https://api.example.com/expensive")
      expect(f.getState().circuitBroken).toBe(true)

      // Reset
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
  })
})
