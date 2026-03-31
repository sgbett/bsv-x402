import type {
  Challenge,
  LedgerEntry,
  LimitCheckResult,
  LimitState,
  SpendLimits,
  SpendMode,
  TierName,
  TierPreset,
  TimeWindow,
  WindowLimit,
  YellowLightEvent,
} from "./types"

// The BFG — compiled-in hard ceilings that even Nightmare can't bypass
export const BFG_DAILY_CEILING_SATOSHIS = 10_000_000_000 // 100 BSV (~$1,500)
export const BFG_PER_TX_CEILING_SATOSHIS = 1_000_000_000 // 10 BSV (~$150)

const WINDOW_MS: Record<TimeWindow, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

function windowToMs(window: TimeWindow): number {
  return WINDOW_MS[window]
}

// === Tier presets ===

function makeLimits(
  windows: WindowLimit[],
  perTxMaxSatoshis: number,
  opts: Partial<SpendLimits> = {},
): SpendLimits {
  return {
    windows,
    perTxMaxSatoshis,
    yellowLightThreshold: 0.8,
    requirePerSitePrompt: false,
    sitePolicies: {},
    require2fa: {
      onCircuitBreakerReset: true,
      onTierChange: true,
      onHighValueTx: false,
      highValueThreshold: 0,
      onNewSiteApproval: false,
    },
    ...opts,
  }
}

const TOO_YOUNG_TO_DIE: TierPreset = {
  interactive: makeLimits(
    [{ window: "day", maxSatoshis: 100_000_000, maxTransactions: Infinity }],
    100_000_000,
  ),
  programmatic: makeLimits(
    [{ window: "day", maxSatoshis: 100_000_000, maxTransactions: Infinity }],
    1_000_000,
  ),
}

const HEY_NOT_TOO_ROUGH: TierPreset = {
  interactive: makeLimits(
    [
      { window: "day", maxSatoshis: 100_000_000, maxTransactions: 100 },
      { window: "week", maxSatoshis: 500_000_000, maxTransactions: 500 },
    ],
    10_000_000,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: true,
        highValueThreshold: 50_000_000,
        onNewSiteApproval: true,
      },
    },
  ),
  programmatic: makeLimits(
    [
      { window: "day", maxSatoshis: 100_000_000, maxTransactions: 10_000 },
      { window: "week", maxSatoshis: 500_000_000, maxTransactions: 50_000 },
    ],
    100_000,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: true,
        highValueThreshold: 50_000_000,
        onNewSiteApproval: true,
      },
    },
  ),
}

const HURT_ME_PLENTY: TierPreset = {
  interactive: makeLimits(
    [
      { window: "minute", maxSatoshis: 5_000_000, maxTransactions: 10 },
      { window: "hour", maxSatoshis: 50_000_000, maxTransactions: 60 },
      { window: "day", maxSatoshis: 200_000_000, maxTransactions: 200 },
      { window: "week", maxSatoshis: 1_000_000_000, maxTransactions: 1000 },
    ],
    20_000_000,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: true,
        highValueThreshold: 100_000_000,
        onNewSiteApproval: true,
      },
    },
  ),
  programmatic: makeLimits(
    [
      { window: "minute", maxSatoshis: 5_000_000, maxTransactions: 1_000 },
      { window: "hour", maxSatoshis: 50_000_000, maxTransactions: 6_000 },
      { window: "day", maxSatoshis: 200_000_000, maxTransactions: 20_000 },
      { window: "week", maxSatoshis: 1_000_000_000, maxTransactions: 100_000 },
    ],
    200_000,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: true,
        highValueThreshold: 100_000_000,
        onNewSiteApproval: true,
      },
    },
  ),
}

const ULTRA_VIOLENCE: TierPreset = {
  interactive: makeLimits(
    [...HURT_ME_PLENTY.interactive.windows],
    HURT_ME_PLENTY.interactive.perTxMaxSatoshis,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: false,
        highValueThreshold: 0,
        onNewSiteApproval: true,
      },
    },
  ),
  programmatic: makeLimits(
    [...HURT_ME_PLENTY.programmatic.windows],
    HURT_ME_PLENTY.programmatic.perTxMaxSatoshis,
    {
      requirePerSitePrompt: true,
      require2fa: {
        onCircuitBreakerReset: true,
        onTierChange: true,
        onHighValueTx: false,
        highValueThreshold: 0,
        onNewSiteApproval: true,
      },
    },
  ),
}

const NIGHTMARE: TierPreset = {
  interactive: makeLimits([], BFG_PER_TX_CEILING_SATOSHIS),
  programmatic: makeLimits([], BFG_PER_TX_CEILING_SATOSHIS),
}

export const TIER_PRESETS: Record<TierName, TierPreset> = {
  "I'm Too Young to Die": TOO_YOUNG_TO_DIE,
  "Hey, Not Too Rough": HEY_NOT_TOO_ROUGH,
  "Hurt Me Plenty": HURT_ME_PLENTY,
  "Ultra-Violence": ULTRA_VIOLENCE,
  "Nightmare!": NIGHTMARE,
}

function cloneSpendLimits(preset: SpendLimits): SpendLimits {
  return {
    ...preset,
    windows: preset.windows.map((w) => ({ ...w })),
    require2fa: { ...preset.require2fa },
    sitePolicies: { ...preset.sitePolicies },
  }
}

export function resolveSpendLimits(
  tier: TierName = "Hey, Not Too Rough",
  mode: SpendMode = "interactive",
  overrides?: Partial<SpendLimits>,
): SpendLimits {
  const preset = TIER_PRESETS[tier][mode]
  const base = cloneSpendLimits(preset)

  if (!overrides) return base

  return {
    ...base,
    ...overrides,
    // Deep-merge require2fa if provided
    require2fa: overrides.require2fa
      ? { ...base.require2fa, ...overrides.require2fa }
      : base.require2fa,
    // Deep-merge sitePolicies if provided
    sitePolicies: overrides.sitePolicies
      ? { ...base.sitePolicies, ...overrides.sitePolicies }
      : base.sitePolicies,
  }
}

// === Rate limiter ===

export class RateLimiter {
  private entries: LedgerEntry[]
  private limits: SpendLimits
  private broken: boolean
  private now: () => number

  constructor(
    limits: SpendLimits,
    state?: LimitState,
    now?: () => number,
  ) {
    this.limits = limits
    this.entries = state?.entries ?? []
    this.broken = state?.circuitBroken ?? false
    this.now = now ?? Date.now
  }

  check(challenge: Challenge, origin: string): LimitCheckResult {
    if (this.broken) {
      return { action: "block", reason: "Circuit breaker tripped — call resetLimits() to clear", severity: "trip" }
    }

    // Reject negative amounts — defence in depth against upstream bypass
    if (challenge.amount < 0) {
      return { action: "block", reason: "Negative transaction amount rejected", severity: "reject" }
    }

    // BFG per-tx ceiling — unconditional
    if (challenge.amount > BFG_PER_TX_CEILING_SATOSHIS) {
      return { action: "block", reason: `Exceeds BFG per-tx ceiling (${BFG_PER_TX_CEILING_SATOSHIS} sats)`, severity: "reject" }
    }

    // BFG daily ceiling — unconditional, trips breaker (something catastrophic)
    const dayAgo = this.now() - WINDOW_MS.day
    const dailyTotal = this.sumSatoshis(dayAgo)
    if (dailyTotal + challenge.amount > BFG_DAILY_CEILING_SATOSHIS) {
      return { action: "block", reason: `Exceeds BFG daily ceiling (${BFG_DAILY_CEILING_SATOSHIS} sats)`, severity: "trip" }
    }

    // Per-tx max from config — routine rejection, no breaker
    if (challenge.amount > this.limits.perTxMaxSatoshis) {
      return { action: "block", reason: `Exceeds per-tx limit (${this.limits.perTxMaxSatoshis} sats)`, severity: "reject" }
    }

    // Check each window limit — also resolve per-site overrides
    const isCustomSite = this.hasCustomPolicy(origin)
    const effectiveLimits = this.effectiveWindows(origin)
    const effectivePerTx = this.effectivePerTxMax(origin)

    if (effectivePerTx !== undefined && challenge.amount > effectivePerTx) {
      return { action: "block", reason: `Exceeds per-tx limit for ${origin} (${effectivePerTx} sats)`, severity: "reject" }
    }

    let yellowLight: YellowLightEvent | undefined

    for (const wl of effectiveLimits) {
      const cutoff = this.now() - windowToMs(wl.window)
      // Custom site policies filter by origin; global windows include all origins
      const windowEntries = this.entriesInWindow(cutoff, isCustomSite ? origin : undefined)
      const totalSats = windowEntries.reduce((sum, e) => sum + e.satoshis, 0)
      const totalTx = windowEntries.length

      if (totalSats + challenge.amount > wl.maxSatoshis) {
        return { action: "block", reason: `Exceeds ${wl.window} sats limit (${wl.maxSatoshis})`, severity: "window" }
      }

      if (totalTx + 1 > wl.maxTransactions) {
        return { action: "block", reason: `Exceeds ${wl.window} tx count limit (${wl.maxTransactions})`, severity: "window" }
      }

      // Yellow light check
      if (
        this.limits.yellowLightThreshold < 1.0 &&
        !yellowLight &&
        totalSats + challenge.amount > wl.maxSatoshis * this.limits.yellowLightThreshold
      ) {
        yellowLight = {
          origin,
          currentSpend: totalSats,
          limit: wl.maxSatoshis,
          window: wl.window,
          challenge,
        }
      }
    }

    if (yellowLight) {
      return { action: "yellow-light", detail: yellowLight }
    }

    return { action: "allow" }
  }

  record(entry: LedgerEntry): void {
    this.entries.push(entry)
    this.prune()
  }

  trip(): void {
    this.broken = true
  }

  reset(): void {
    this.broken = false
  }

  isBroken(): boolean {
    return this.broken
  }

  getState(): LimitState {
    return {
      entries: [...this.entries],
      circuitBroken: this.broken,
      hmac: "",
    }
  }

  private hasCustomPolicy(origin: string): boolean {
    const policy = this.limits.sitePolicies[origin]
    return policy?.action === "custom" && !!policy.limits
  }

  private effectiveWindows(origin: string): WindowLimit[] {
    const policy = this.limits.sitePolicies[origin]
    if (policy?.action === "custom" && policy.limits) {
      return policy.limits
    }
    return this.limits.windows
  }

  private effectivePerTxMax(origin: string): number | undefined {
    const policy = this.limits.sitePolicies[origin]
    if (policy?.action === "custom" && policy.perTxMaxSatoshis !== undefined) {
      return policy.perTxMaxSatoshis
    }
    return undefined
  }

  private entriesInWindow(cutoff: number, filterOrigin?: string): LedgerEntry[] {
    return this.entries.filter(
      (e) => e.timestamp >= cutoff && (filterOrigin === undefined || e.origin === filterOrigin),
    )
  }

  private sumSatoshis(cutoff: number): number {
    return this.entries
      .filter((e) => e.timestamp >= cutoff)
      .reduce((sum, e) => sum + e.satoshis, 0)
  }

  private prune(): void {
    let longestWindow = WINDOW_MS.day // Always keep at least a day for BFG daily check

    // Global windows
    for (const wl of this.limits.windows) {
      longestWindow = Math.max(longestWindow, windowToMs(wl.window))
    }

    // Custom per-site windows — entries for these must also be retained
    if (this.limits.sitePolicies) {
      for (const policy of Object.values(this.limits.sitePolicies)) {
        if (policy?.action === "custom" && Array.isArray(policy.limits)) {
          for (const wl of policy.limits) {
            longestWindow = Math.max(longestWindow, windowToMs(wl.window))
          }
        }
      }
    }

    const cutoff = this.now() - longestWindow
    this.entries = this.entries.filter((e) => e.timestamp >= cutoff)
  }
}
