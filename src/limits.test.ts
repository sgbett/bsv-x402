import { describe, expect, it } from "vitest"
import {
  BFG_DAILY_CEILING_SATOSHIS,
  BFG_PER_TX_CEILING_SATOSHIS,
  RateLimiter,
  TIER_PRESETS,
  resolveSpendLimits,
} from "./limits"
import type { Challenge, LedgerEntry, PaymentRequest, SpendLimits } from "./types"

const NOW = 1_700_000_000_000

function challenge(amount: number): Challenge {
  return { nonce: "test", payee: "1addr", amount, network: "mainnet" }
}

function entry(sats: number, minutesAgo: number): LedgerEntry {
  return {
    timestamp: NOW - minutesAgo * 60_000,
    origin: "https://example.com",
    satoshis: sats,
    txid: `tx-${Math.random().toString(36).slice(2)}`,
  }
}

function simpleLimits(overrides: Partial<SpendLimits> = {}): SpendLimits {
  return {
    windows: [
      { window: "hour", maxSatoshis: 1_000_000, maxTransactions: 10 },
      { window: "day", maxSatoshis: 5_000_000, maxTransactions: 50 },
    ],
    perTxMaxSatoshis: 500_000,
    yellowLightThreshold: 0.8,
    requirePerSitePrompt: false,
    sitePolicies: {},
    require2fa: {
      onCircuitBreakerReset: false,
      onTierChange: false,
      onHighValueTx: false,
      highValueThreshold: 0,
      onNewSiteApproval: false,
    },
    ...overrides,
  }
}

describe("RateLimiter", () => {
  describe("check", () => {
    it("allows a payment within limits", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      const result = limiter.check(challenge(100_000), "https://example.com")
      expect(result.action).toBe("allow")
    })

    it("blocks when per-tx max exceeded", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      const result = limiter.check(challenge(600_000), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("per-tx")
      }
    })

    it("blocks when hourly sats limit would be exceeded", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Record 900k in the last hour
      limiter.record(entry(900_000, 30))
      // Trying to add 200k should exceed 1M hourly limit
      const result = limiter.check(challenge(200_000), "https://example.com")
      expect(result.action).toBe("block")
    })

    it("blocks when hourly tx count limit would be exceeded", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Record 10 txs in the last hour
      for (let i = 0; i < 10; i++) {
        limiter.record(entry(1_000, 30))
      }
      const result = limiter.check(challenge(1_000), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("tx count")
      }
    })

    it("allows when old entries have fallen outside the window", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Record entries from 2 hours ago — outside the 1-hour window
      limiter.record(entry(900_000, 121))
      const result = limiter.check(challenge(200_000), "https://example.com")
      expect(result.action).toBe("allow")
    })

    it("returns yellow-light when approaching limit", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // 80% of 1M hourly = 800k. Record 750k, then try 100k → 850k > 800k threshold
      limiter.record(entry(750_000, 30))
      const result = limiter.check(challenge(100_000), "https://example.com")
      expect(result.action).toBe("yellow-light")
    })

    it("does not yellow-light when threshold is 1.0", () => {
      const limiter = new RateLimiter(
        simpleLimits({ yellowLightThreshold: 1.0 }),
        undefined,
        () => NOW,
      )
      limiter.record(entry(900_000, 30))
      const result = limiter.check(challenge(50_000), "https://example.com")
      expect(result.action).toBe("allow")
    })
  })

  describe("BFG ceiling", () => {
    it("blocks per-tx above BFG ceiling even with no window limits", () => {
      const nightmareLimits = simpleLimits({
        windows: [],
        perTxMaxSatoshis: BFG_PER_TX_CEILING_SATOSHIS,
      })
      const limiter = new RateLimiter(nightmareLimits, undefined, () => NOW)
      const result = limiter.check(
        challenge(BFG_PER_TX_CEILING_SATOSHIS + 1),
        "https://example.com",
      )
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("BFG per-tx")
      }
    })

    it("blocks daily total above BFG ceiling", () => {
      const nightmareLimits = simpleLimits({
        windows: [],
        perTxMaxSatoshis: BFG_PER_TX_CEILING_SATOSHIS,
      })
      const limiter = new RateLimiter(nightmareLimits, undefined, () => NOW)
      // Record near-ceiling spending
      limiter.record({
        timestamp: NOW - 60_000,
        origin: "https://example.com",
        satoshis: BFG_DAILY_CEILING_SATOSHIS - 1000,
        txid: "tx-big",
      })
      const result = limiter.check(challenge(2000), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("BFG daily")
      }
    })
  })

  describe("circuit breaker", () => {
    it("blocks all payments when tripped", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.trip()
      const result = limiter.check(challenge(1), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("Circuit breaker")
      }
    })

    it("allows payments after reset", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.trip()
      limiter.reset()
      const result = limiter.check(challenge(1000), "https://example.com")
      expect(result.action).toBe("allow")
    })

    it("persists broken state via getState", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.trip()
      const state = limiter.getState()
      expect(state.circuitBroken).toBe(true)

      // Restore from state
      const limiter2 = new RateLimiter(simpleLimits(), state, () => NOW)
      expect(limiter2.isBroken()).toBe(true)
    })
  })

  describe("pruning", () => {
    it("removes entries older than the longest window", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Entry from 2 days ago — outside the day window
      limiter.record(entry(1000, 2 * 24 * 60 + 1))
      // Entry from 1 hour ago — inside
      limiter.record(entry(1000, 30))

      const state = limiter.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].satoshis).toBe(1000)
    })
  })
})

describe("resolveSpendLimits", () => {
  it("defaults to Hey, Not Too Rough interactive", () => {
    const limits = resolveSpendLimits()
    expect(limits.requirePerSitePrompt).toBe(true)
    expect(limits.perTxMaxSatoshis).toBe(10_000_000)
  })

  it("applies overrides on top of tier preset", () => {
    const limits = resolveSpendLimits("Hey, Not Too Rough", "interactive", {
      perTxMaxSatoshis: 50_000,
    })
    expect(limits.perTxMaxSatoshis).toBe(50_000)
    // Other fields unchanged
    expect(limits.requirePerSitePrompt).toBe(true)
  })

  it("selects programmatic profile", () => {
    const limits = resolveSpendLimits("Hey, Not Too Rough", "programmatic")
    expect(limits.perTxMaxSatoshis).toBe(100_000)
  })
})

describe("TIER_PRESETS", () => {
  it("has all five tiers", () => {
    const tiers = Object.keys(TIER_PRESETS)
    expect(tiers).toHaveLength(5)
    expect(tiers).toContain("Nightmare!")
    expect(tiers).toContain("I'm Too Young to Die")
  })

  it("each tier has both interactive and programmatic profiles", () => {
    for (const [name, preset] of Object.entries(TIER_PRESETS)) {
      expect(preset.interactive, `${name} missing interactive`).toBeDefined()
      expect(preset.programmatic, `${name} missing programmatic`).toBeDefined()
    }
  })

  it("programmatic profiles have lower per-tx max than interactive", () => {
    for (const [name, preset] of Object.entries(TIER_PRESETS)) {
      expect(
        preset.programmatic.perTxMaxSatoshis,
        `${name}: programmatic perTx should be <= interactive`,
      ).toBeLessThanOrEqual(preset.interactive.perTxMaxSatoshis)
    }
  })

  it("Nightmare has no window limits", () => {
    expect(TIER_PRESETS["Nightmare!"].interactive.windows).toHaveLength(0)
  })
})

// === PaymentRequest support ===

function paymentRequest(amount: number, protocol: 'x402' | 'brc105' = 'x402'): PaymentRequest {
  return { amount, origin: "https://example.com", protocol }
}

describe("RateLimiter with PaymentRequest", () => {
  describe("check", () => {
    it("allows a PaymentRequest within limits", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      const result = limiter.check(paymentRequest(100_000), "https://example.com")
      expect(result.action).toBe("allow")
    })

    it("blocks a PaymentRequest exceeding per-tx max", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      const result = limiter.check(paymentRequest(600_000), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("per-tx")
      }
    })

    it("enforces window limits identically to Challenge", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.record(entry(900_000, 30))
      // PaymentRequest should be blocked just like a Challenge would be
      const result = limiter.check(paymentRequest(200_000), "https://example.com")
      expect(result.action).toBe("block")
    })

    it("returns yellow-light for PaymentRequest approaching limit", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.record(entry(750_000, 30))
      const result = limiter.check(paymentRequest(100_000), "https://example.com")
      expect(result.action).toBe("yellow-light")
      if (result.action === "yellow-light") {
        expect(result.detail.challenge).toEqual(paymentRequest(100_000))
      }
    })

    it("blocks BRC-105 PaymentRequest exceeding BFG ceiling", () => {
      const nightmareLimits = simpleLimits({
        windows: [],
        perTxMaxSatoshis: BFG_PER_TX_CEILING_SATOSHIS,
      })
      const limiter = new RateLimiter(nightmareLimits, undefined, () => NOW)
      const result = limiter.check(
        paymentRequest(BFG_PER_TX_CEILING_SATOSHIS + 1, "brc105"),
        "https://example.com",
      )
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("BFG per-tx")
      }
    })
  })

  describe("mixed protocol entries", () => {
    it("sums x402 and brc105 entries in the same window", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Record an x402 entry
      limiter.record({ ...entry(400_000, 30), protocol: "x402" })
      // Record a brc105 entry
      limiter.record({ ...entry(400_000, 20), protocol: "brc105" })
      // Total is 800k — adding 300k should exceed the 1M hourly limit
      const result = limiter.check(paymentRequest(300_000, "brc105"), "https://example.com")
      expect(result.action).toBe("block")
    })

    it("counts mixed protocol entries towards tx count limits", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      // Fill up to the tx count limit with mixed protocols
      for (let i = 0; i < 5; i++) {
        limiter.record({ ...entry(1_000, 30), protocol: "x402" })
      }
      for (let i = 0; i < 5; i++) {
        limiter.record({ ...entry(1_000, 20), protocol: "brc105" })
      }
      // 10 txs recorded — next one should be blocked
      const result = limiter.check(paymentRequest(1_000), "https://example.com")
      expect(result.action).toBe("block")
      if (result.action === "block") {
        expect(result.reason).toContain("tx count")
      }
    })
  })

  describe("LedgerEntry backwards compatibility", () => {
    it("loads entries without protocol field gracefully", () => {
      const oldEntries: LedgerEntry[] = [
        { timestamp: NOW - 30 * 60_000, origin: "https://example.com", satoshis: 100_000, txid: "tx-old" },
      ]
      const state = { entries: oldEntries, circuitBroken: false, hmac: "" }
      const limiter = new RateLimiter(simpleLimits(), state, () => NOW)

      // Old entries should still count towards limits
      const result = limiter.check(paymentRequest(950_000), "https://example.com")
      expect(result.action).toBe("block")
    })

    it("persists and loads entries with protocol field", () => {
      const limiter = new RateLimiter(simpleLimits(), undefined, () => NOW)
      limiter.record({ ...entry(50_000, 10), protocol: "brc105" })

      const state = limiter.getState()
      expect(state.entries[0].protocol).toBe("brc105")

      // Reload from state
      const limiter2 = new RateLimiter(simpleLimits(), state, () => NOW)
      const state2 = limiter2.getState()
      expect(state2.entries[0].protocol).toBe("brc105")
    })

    it("mixes old entries (no protocol) with new entries (with protocol)", () => {
      const oldEntry: LedgerEntry = {
        timestamp: NOW - 30 * 60_000,
        origin: "https://example.com",
        satoshis: 400_000,
        txid: "tx-legacy",
      }
      const state = { entries: [oldEntry], circuitBroken: false, hmac: "" }
      const limiter = new RateLimiter(simpleLimits(), state, () => NOW)

      // Add a new entry with protocol
      limiter.record({ ...entry(400_000, 10), protocol: "brc105" })

      // Total is 800k — adding 300k should exceed the 1M hourly limit
      const result = limiter.check(paymentRequest(300_000), "https://example.com")
      expect(result.action).toBe("block")
    })
  })
})
