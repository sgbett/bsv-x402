import type {
  FiatCurrency,
  TierName,
  UrlScope,
  WalletId,
  WalletMode,
  WalletProfile,
} from "./types"

// ---------------------------------------------------------------------------
// Wallet Registry
//
// Manages multiple wallet profiles. Each profile has its own spending tier,
// URL scope, and confirmation mode (manual vs auto).
//
// Profiles are stored as a flat array — the registry provides lookup by ID,
// origin matching, and CRUD operations. Persistence is handled by the caller
// (extension storage or localStorage).
// ---------------------------------------------------------------------------

/** Generate a short unique wallet ID. */
export function generateWalletId(): WalletId {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Check if an origin matches a URL scope. */
export function matchesUrlScope(origin: string, scope: UrlScope): boolean {
  // Blacklist takes priority
  if (scope.blacklist.some((pattern) => globMatch(pattern, origin))) return false
  // If whitelist is empty, match everything not blacklisted
  if (scope.whitelist.length === 0) return true
  return scope.whitelist.some((pattern) => globMatch(pattern, origin))
}

/** Simple glob matching for URL patterns. Supports * as wildcard segment. */
function globMatch(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true
  // Convert glob to regex: escape dots, replace * with [^/]* and ** with .*
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

export interface CreateWalletOptions {
  name: string
  mode: WalletMode
  backendType?: "builtin" | "external"
  externalExtensionId?: string
  tier?: TierName
  urlScope?: UrlScope
  autoConfirmThreshold?: number
  fiatCurrency?: FiatCurrency
  isDefault?: boolean
}

export class WalletRegistry {
  private profiles: WalletProfile[]

  constructor(profiles: WalletProfile[] = []) {
    this.profiles = [...profiles]
  }

  /** Get all wallet profiles. */
  list(): WalletProfile[] {
    return [...this.profiles]
  }

  /** Get a wallet by ID. */
  get(id: WalletId): WalletProfile | undefined {
    return this.profiles.find((w) => w.id === id)
  }

  /** Get the default wallet. */
  getDefault(): WalletProfile | undefined {
    return this.profiles.find((w) => w.isDefault)
  }

  /** Create a new wallet profile. */
  create(opts: CreateWalletOptions): WalletProfile {
    const now = Date.now()
    const id = generateWalletId()

    // If this is marked as default, unset any existing default
    if (opts.isDefault) {
      for (const p of this.profiles) p.isDefault = false
    }

    // If this is the first wallet, make it default
    const isDefault = opts.isDefault ?? this.profiles.length === 0

    const profile: WalletProfile = {
      id,
      name: opts.name,
      mode: opts.mode,
      isDefault,
      backendType: opts.backendType ?? "builtin",
      externalExtensionId: opts.externalExtensionId,
      tier: opts.tier ?? "Hey, Not Too Rough",
      spendMode: opts.mode === "auto" ? "programmatic" : "interactive",
      urlScope: opts.urlScope,
      autoConfirmThreshold: opts.autoConfirmThreshold,
      fiatCurrency: opts.fiatCurrency ?? "USD",
      createdAt: now,
      updatedAt: now,
    }

    this.profiles.push(profile)
    return profile
  }

  /** Update an existing wallet profile. */
  update(id: WalletId, updates: Partial<Omit<WalletProfile, "id" | "createdAt">>): WalletProfile {
    const idx = this.profiles.findIndex((w) => w.id === id)
    if (idx === -1) throw new Error(`Wallet not found: ${id}`)

    // If setting as default, unset others
    if (updates.isDefault) {
      for (const p of this.profiles) p.isDefault = false
    }

    this.profiles[idx] = {
      ...this.profiles[idx],
      ...updates,
      id, // immutable
      createdAt: this.profiles[idx].createdAt, // immutable
      updatedAt: Date.now(),
    }

    return this.profiles[idx]
  }

  /** Remove a wallet profile. Cannot remove the last wallet or the default if it's the only one. */
  remove(id: WalletId): void {
    const idx = this.profiles.findIndex((w) => w.id === id)
    if (idx === -1) throw new Error(`Wallet not found: ${id}`)

    if (this.profiles.length === 1) {
      throw new Error("Cannot remove the last wallet")
    }

    const wasDefault = this.profiles[idx].isDefault
    this.profiles.splice(idx, 1)

    // If we removed the default, promote the first remaining wallet
    if (wasDefault && this.profiles.length > 0) {
      this.profiles[0].isDefault = true
    }
  }

  /**
   * Select the best wallet for a given origin and payment amount.
   *
   * Priority:
   * 1. Auto wallets scoped to this origin (if amount within autoConfirmThreshold)
   * 2. Manual wallets scoped to this origin
   * 3. The default wallet (if it has no scope or scope matches)
   * 4. Any manual wallet without a scope
   */
  selectForOrigin(origin: string, amount?: number): WalletProfile | undefined {
    // 1. Scoped auto wallets that match and are within threshold
    if (amount !== undefined) {
      const autoMatch = this.profiles.find(
        (w) =>
          w.mode === "auto" &&
          w.urlScope &&
          matchesUrlScope(origin, w.urlScope) &&
          w.autoConfirmThreshold !== undefined &&
          amount <= w.autoConfirmThreshold,
      )
      if (autoMatch) return autoMatch
    }

    // 2. Scoped manual wallets that match
    const scopedManual = this.profiles.find(
      (w) => w.mode === "manual" && w.urlScope && matchesUrlScope(origin, w.urlScope),
    )
    if (scopedManual) return scopedManual

    // 3. Default wallet (if unscoped or scope matches)
    const defaultWallet = this.getDefault()
    if (defaultWallet) {
      if (!defaultWallet.urlScope || matchesUrlScope(origin, defaultWallet.urlScope)) {
        return defaultWallet
      }
    }

    // 4. Any unscoped manual wallet
    return this.profiles.find((w) => w.mode === "manual" && !w.urlScope)
  }

  /** Serialize profiles for persistence. */
  toJSON(): WalletProfile[] {
    return [...this.profiles]
  }
}
