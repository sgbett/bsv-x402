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

// === BRC-105 payment protocol ===

export interface Brc105Challenge {
  version: string
  satoshisRequired: number
  serverIdentityKey: string
  derivationPrefix: string
}

/** Minimal wallet interface for BRC-105 proof construction.
 *  Works with both CWIInterface (page context) and WalletInterface (SDK). */
export interface Brc105Wallet {
  getPublicKey(params: { protocolID: [number, string]; keyID: string; counterparty: string }): Promise<{ publicKey: string }>
  createHmac(params: { data: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ hmac: number[] }>
  createAction(params: CWICreateActionParams): Promise<CWICreateActionResult>
}

export interface Brc105Proof {
  derivationPrefix: string
  derivationSuffix: string
  transaction: string  // base64-encoded
  txid: string         // from wallet createAction result
}

export type Brc105ProofConstructor = (challenge: Brc105Challenge) => Promise<Brc105Proof>

// === Protocol-agnostic payment request ===

export type PaymentProtocol = 'x402' | 'brc105'

export interface PaymentRequest {
  amount: number
  origin: string
  protocol: PaymentProtocol
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
  brc105ProofConstructor?: Brc105ProofConstructor
  brc105Wallet?: Brc105Wallet
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
  challenge: Challenge | PaymentRequest
}

export interface LedgerEntry {
  timestamp: number
  origin: string
  satoshis: number
  txid: string
  protocol?: PaymentProtocol
}

export interface LimitState {
  entries: LedgerEntry[]
  circuitBroken: boolean
  hmac: string
}

export type BlockSeverity = "reject" | "window" | "trip"

export type LimitCheckResult =
  | { action: "allow" }
  | { action: "yellow-light"; detail: YellowLightEvent }
  | { action: "block"; reason: string; severity: BlockSeverity }

// === Storage ===

export interface StorageAdapter {
  load(): Promise<LimitState | null>
  save(state: LimitState): Promise<void>
  loadSitePolicies(): Promise<Record<string, SitePolicy>>
  saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void>
}

// === BRC-100 CWI interface types ===

export interface CWICreateActionOutput {
  satoshis: number
  lockingScript: string
  description?: string
  customInstructions?: string
}

export interface CWICreateActionParams {
  description: string
  outputs: CWICreateActionOutput[]
  labels?: string[]
  options?: {
    returnTXIDOnly?: boolean
    noSend?: boolean
    randomizeOutputs?: boolean
  }
}

export interface CWICreateActionResult {
  txid: string
  rawTx?: string
  tx?: number[]
}

/**
 * Full BRC-100 CWI (Computing With Integrity) wallet interface.
 *
 * This must stay in sync with the BSV Browser implementation
 * (bsv-blockchain/bsv-browser) and the canonical BRC-100 spec
 * (bsv-blockchain/ts-sdk Wallet.interfaces.ts).
 *
 * All 28 methods are listed. See plugins/shared/cwi-conformance.test.ts
 * for the conformance test suite that validates interface parity.
 */
export interface CWIInterface {
  // Key management
  getPublicKey(params?: { identityKey?: boolean; protocolID?: [number, string]; keyID?: string; counterparty?: string; forSelf?: boolean }): Promise<{ publicKey: string }>
  revealCounterpartyKeyLinkage(params: { counterparty: string; verifier: string; protocolID: [number, string]; keyID: string }): Promise<{ encryptedLinkage: string; encryptedLinkageProof: string }>
  revealSpecificKeyLinkage(params: { counterparty: string; verifier: string; protocolID: [number, string]; keyID: string }): Promise<{ encryptedLinkage: string; encryptedLinkageProof: string }>

  // Cryptographic operations
  encrypt(params: { plaintext: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ ciphertext: number[] }>
  decrypt(params: { ciphertext: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ plaintext: number[] }>
  createHmac(params: { data: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ hmac: number[] }>
  verifyHmac(params: { data: number[]; hmac: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ valid: boolean }>
  createSignature(params: { data?: number[]; hashToDirectlySign?: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ signature: number[] }>
  verifySignature(params: { data: number[]; signature: number[]; protocolID: [number, string]; keyID: string; counterparty?: string; forSelf?: boolean }): Promise<{ valid: boolean }>

  // Transaction management
  createAction(params: CWICreateActionParams): Promise<CWICreateActionResult>
  signAction(params: { reference: string }): Promise<{ txid?: string; tx?: number[] }>
  abortAction(params: { reference: string }): Promise<{ aborted: boolean }>
  listActions(params: { labels: string[]; labelQueryMode?: 'any' | 'all'; includeLabels?: boolean; includeInputs?: boolean; includeOutputs?: boolean; limit?: number; offset?: number }): Promise<{ totalActions: number; actions: unknown[] }>
  internalizeAction(params: { tx: number[]; outputs: unknown[] }): Promise<{ accepted: boolean }>

  // Output management
  listOutputs(params: { basket: string; tags?: string[]; tagQueryMode?: 'any' | 'all'; include?: string; includeCustomInstructions?: boolean; includeTags?: boolean; includeLabels?: boolean; limit?: number; offset?: number }): Promise<{ totalOutputs: number; outputs: unknown[] }>
  relinquishOutput(params: { basket: string; output: string }): Promise<{ relinquished: boolean }>

  // Certificate management
  acquireCertificate(params: { type: string; certifier: string; acquisitionProtocol?: string; fields?: Record<string, string> }): Promise<{ type: string; subject: string; serialNumber: string; certifier: string; fields: Record<string, string>; signature: string }>
  listCertificates(params: { certifiers: string[]; types: string[]; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>
  proveCertificate(params: { certificate: unknown; fieldsToReveal: string[]; verifier: string }): Promise<{ keyForVerifier: string }>
  relinquishCertificate(params: { type: string; serialNumber: string; certifier: string }): Promise<{ relinquished: boolean }>

  // Certificate discovery
  discoverByIdentityKey(params: { identityKey: string; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>
  discoverByAttributes(params: { attributes: Record<string, string>; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>

  // Authentication & status
  isAuthenticated(params?: object): Promise<{ authenticated: boolean }>
  waitForAuthentication(params?: object): Promise<{ authenticated: boolean }>

  // Blockchain information
  getHeight(params?: object): Promise<{ height: number }>
  getHeaderForHeight(params: { height: number }): Promise<{ header: string }>
  getNetwork(params?: object): Promise<{ network: 'mainnet' | 'testnet' }>
  getVersion(params?: object): Promise<{ version: string }>
}

// === Multi-wallet types ===

/** Unique identifier for a wallet profile. */
export type WalletId = string

/** How a wallet handles payment confirmations. */
export type WalletMode = 'manual' | 'auto'

/** Currency code for fiat display (ISO 4217). */
export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY'

/** URL scope — restricts which origins a wallet can pay. */
export interface UrlScope {
  /** Glob patterns for allowed origins (e.g. "https://example.com", "https://*.example.com") */
  whitelist: string[]
  /** Glob patterns for blocked origins — takes priority over whitelist. */
  blacklist: string[]
}

/** A wallet profile — either manual (click-to-pay) or automated. */
export interface WalletProfile {
  id: WalletId
  name: string
  mode: WalletMode
  /** When true, this is the default wallet for unscoped origins. */
  isDefault: boolean
  /** Backend type: built-in (local key) or external extension. */
  backendType: 'builtin' | 'external'
  /** For external backends, the extension ID to delegate to. */
  externalExtensionId?: string
  /** Spending tier for this wallet's limits. */
  tier: TierName
  /** Spend mode within the tier. */
  spendMode: SpendMode
  /** URL scope — if set, this wallet only activates for matching origins. */
  urlScope?: UrlScope
  /** For auto wallets: auto-confirm payments up to this many satoshis. */
  autoConfirmThreshold?: number
  /** Preferred fiat currency for display. */
  fiatCurrency: FiatCurrency
  /** Created timestamp (ms since epoch). */
  createdAt: number
  /** Last modified timestamp (ms since epoch). */
  updatedAt: number
}

/** Payment confirmation info shown to the user for manual wallets. */
export interface PaymentConfirmation {
  walletId: WalletId
  walletName: string
  /** Amount in satoshis. */
  amount: number
  /** Fiat equivalent string (e.g. "$0.15 USD"). */
  fiatAmount?: string
  /** Current wallet balance in satoshis. */
  currentBalance?: number
  /** Current balance in fiat. */
  currentBalanceFiat?: string
  /** Balance after payment in satoshis. */
  balanceAfter?: number
  /** Balance after payment in fiat. */
  balanceAfterFiat?: string
  /** The origin requesting payment. */
  origin: string
  /** The payee address or identity key. */
  payee: string
}

// === Transaction log / accounting ===

/** A recorded transaction for accounting purposes. */
export interface TransactionRecord {
  /** Transaction ID on the blockchain. */
  txid: string
  /** When the transaction was created (ms since epoch). */
  timestamp: number
  /** Amount in satoshis. */
  amount: number
  /** Sender's public key (our wallet). */
  fromPublicKey: string
  /** Recipient's public key or address. */
  toPublicKey: string
  /** Which wallet profile made this payment. */
  walletId: WalletId
  /** Origin that triggered the payment. */
  origin: string
  /** Protocol used. */
  protocol: PaymentProtocol
  /** Optional human-readable description. */
  description?: string
}

/** Cloud sync provider identifier. */
export type SyncProviderType = 'local' | 'icloud' | 'google' | 'microsoft' | 'merkleworks'

/** Configuration for cloud sync. */
export interface SyncConfig {
  provider: SyncProviderType
  /** Whether sync is currently enabled. */
  enabled: boolean
  /** Last successful sync timestamp (ms since epoch). */
  lastSyncAt?: number
  /** Provider-specific credentials/tokens (encrypted at rest). */
  credentials?: Record<string, string>
}

/** Interface for sync provider implementations. */
export interface SyncProvider {
  readonly type: SyncProviderType
  push(records: TransactionRecord[]): Promise<void>
  pull(since: number): Promise<TransactionRecord[]>
  getLastSyncTimestamp(): Promise<number>
}

// === 2FA ===

export type TwoFactorAction =
  | { type: "circuit-breaker-reset" }
  | { type: "tier-change"; from: TierName; to: TierName }
  | { type: "high-value-tx"; amount: number; origin: string }
  | { type: "new-site-approval"; origin: string }
  | { type: "limit-override"; amount: number; origin: string; reason: string }

export interface TwoFactorProvider {
  verify(action: TwoFactorAction): Promise<boolean>
}
