import { describe, expect, it, vi } from "vitest"
import { resolveSitePolicy } from "./site-policy"
import type { SpendLimits, TwoFactorProvider } from "./types"

function baseLimits(overrides: Partial<SpendLimits> = {}): SpendLimits {
  return {
    windows: [],
    perTxMaxSatoshis: 100_000,
    yellowLightThreshold: 0.8,
    requirePerSitePrompt: true,
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

describe("resolveSitePolicy", () => {
  it("returns existing policy when origin already known", async () => {
    const limits = baseLimits({
      sitePolicies: {
        "https://known.com": { origin: "https://known.com", action: "block" },
      },
    })
    const policy = await resolveSitePolicy("https://known.com", limits)
    expect(policy.action).toBe("block")
  })

  it("returns global policy without prompting when requirePerSitePrompt is false", async () => {
    const limits = baseLimits({ requirePerSitePrompt: false })
    const promptFn = vi.fn()
    const policy = await resolveSitePolicy("https://new.com", limits, undefined, promptFn)
    expect(policy.action).toBe("global")
    expect(promptFn).not.toHaveBeenCalled()
  })

  it("prompts user on first visit when requirePerSitePrompt is true", async () => {
    const limits = baseLimits()
    const promptFn = vi.fn().mockResolvedValue("block")
    const policy = await resolveSitePolicy("https://new.com", limits, undefined, promptFn)
    expect(promptFn).toHaveBeenCalledWith("https://new.com")
    expect(policy.action).toBe("block")
  })

  it("blocks site when 2FA verification fails", async () => {
    const limits = baseLimits({
      require2fa: {
        onCircuitBreakerReset: false,
        onTierChange: false,
        onHighValueTx: false,
        highValueThreshold: 0,
        onNewSiteApproval: true,
      },
    })
    const twoFactor: TwoFactorProvider = {
      verify: vi.fn().mockResolvedValue(false),
    }
    const promptFn = vi.fn().mockResolvedValue("global")

    const policy = await resolveSitePolicy("https://new.com", limits, twoFactor, promptFn)
    expect(policy.action).toBe("block")
    expect(promptFn).not.toHaveBeenCalled() // never reached
  })

  it("proceeds to prompt when 2FA verification passes", async () => {
    const limits = baseLimits({
      require2fa: {
        onCircuitBreakerReset: false,
        onTierChange: false,
        onHighValueTx: false,
        highValueThreshold: 0,
        onNewSiteApproval: true,
      },
    })
    const twoFactor: TwoFactorProvider = {
      verify: vi.fn().mockResolvedValue(true),
    }
    const promptFn = vi.fn().mockResolvedValue("global")

    const policy = await resolveSitePolicy("https://new.com", limits, twoFactor, promptFn)
    expect(policy.action).toBe("global")
    expect(promptFn).toHaveBeenCalledWith("https://new.com")
  })
})
