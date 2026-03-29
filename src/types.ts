// === Protocol types (existing) ===

export interface Challenge {
  nonce: string
  payee: string
  amount: number
  network: string
}

export interface Proof {
  txid: string
  rawTx: string
}

// === Spending limits ===

export type SpendMode = "interactive" | "programmatic"
export type TimeWindow = "minute" | "hour" | "day" | "week"

export interface WindowLimit {
  window: TimeWindow
  maxSatoshis: number
  maxTransactions: number
}

export interface SpendLimits {
  windows: WindowLimit[]
  perTxMaxSatoshis: number
  yellowLightThreshold: number // 0-1, default 0.8
  requirePerSitePrompt: boolean
  sitePolicies: Record<string, SitePolicy>
  require2fa: TwoFactorPolicy
}

export type SitePolicyAction = "global" | "custom" | "block"

export interface SitePolicy {
  origin: string
  action: SitePolicyAction
  limits?: WindowLimit[]
  perTxMaxSatoshis?: number
}

export interface TwoFactorPolicy {
  onCircuitBreakerReset: boolean
  onTierChange: boolean
  onHighValueTx: boolean
  highValueThreshold: number // sats — txs above this require 2FA
  onNewSiteApproval: boolean
}

// === Tier presets (Doom II difficulty) ===

export type TierName =
  | "I'm Too Young to Die"
  | "Hey, Not Too Rough"
  | "Hurt Me Plenty"
  | "Ultra-Violence"
  | "Nightmare!"

export interface TierPreset {
  interactive: SpendLimits
  programmatic: SpendLimits
}

// === Factory config ===

export interface X402Config {
  tier?: TierName
  mode?: SpendMode
  limits?: Partial<SpendLimits>
  storage?: StorageAdapter
  twoFactorProvider?: TwoFactorProvider
  proofConstructor?: (challenge: Challenge) => Promise<Proof>
  nightmareConfirmation?: string
  onLimitReached?: (reason: string) => void
  onYellowLight?: (detail: YellowLightEvent) => Promise<boolean>
  now?: () => number
}

// === Rate limiter ===

export interface YellowLightEvent {
  origin: string
  currentSpend: number
  limit: number
  window: TimeWindow
  challenge: Challenge
}

export interface LedgerEntry {
  timestamp: number
  origin: string
  satoshis: number
  txid: string
}

export interface LimitState {
  entries: LedgerEntry[]
  circuitBroken: boolean
  hmac: string
}

export type LimitCheckResult =
  | { action: "allow" }
  | { action: "yellow-light"; detail: YellowLightEvent }
  | { action: "block"; reason: string }

// === Storage ===

export interface StorageAdapter {
  load(): Promise<LimitState | null>
  save(state: LimitState): Promise<void>
  loadSitePolicies(): Promise<Record<string, SitePolicy>>
  saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void>
}

// === 2FA ===

export type TwoFactorAction =
  | { type: "circuit-breaker-reset" }
  | { type: "tier-change"; from: TierName; to: TierName }
  | { type: "high-value-tx"; amount: number; origin: string }
  | { type: "new-site-approval"; origin: string }

export interface TwoFactorProvider {
  verify(action: TwoFactorAction): Promise<boolean>
}
