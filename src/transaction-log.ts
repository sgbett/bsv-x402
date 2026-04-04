import type {
  PaymentProtocol,
  SyncConfig,
  SyncProvider,
  SyncProviderType,
  TransactionRecord,
  WalletId,
} from "./types"

// ---------------------------------------------------------------------------
// Transaction Log
//
// Accounting layer: records every payment with txid, timestamp, amount,
// sender/recipient public keys, wallet ID, and origin.
//
// Storage: local first (via a StorageBackend), with optional cloud sync.
// Sync providers push/pull records incrementally by timestamp.
// ---------------------------------------------------------------------------

/** Storage interface for the transaction log (decoupled from browser APIs). */
export interface TransactionLogStorage {
  loadRecords(): Promise<TransactionRecord[]>
  saveRecords(records: TransactionRecord[]): Promise<void>
  loadSyncConfigs(): Promise<SyncConfig[]>
  saveSyncConfigs(configs: SyncConfig[]): Promise<void>
}

/** In-memory / localStorage implementation for the library (non-extension) context. */
export class LocalTransactionLogStorage implements TransactionLogStorage {
  private storage: Pick<Storage, "getItem" | "setItem">
  private recordsKey: string
  private syncKey: string

  constructor(
    storage?: Pick<Storage, "getItem" | "setItem">,
    prefix = "x402",
  ) {
    this.storage = storage ?? globalThis.localStorage
    this.recordsKey = `${prefix}:tx-log`
    this.syncKey = `${prefix}:sync-configs`
  }

  async loadRecords(): Promise<TransactionRecord[]> {
    const raw = this.storage.getItem(this.recordsKey)
    if (!raw) return []
    try {
      const records = JSON.parse(raw)
      return Array.isArray(records) ? records.filter(isValidRecord) : []
    } catch {
      return []
    }
  }

  async saveRecords(records: TransactionRecord[]): Promise<void> {
    this.storage.setItem(this.recordsKey, JSON.stringify(records))
  }

  async loadSyncConfigs(): Promise<SyncConfig[]> {
    const raw = this.storage.getItem(this.syncKey)
    if (!raw) return []
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  async saveSyncConfigs(configs: SyncConfig[]): Promise<void> {
    this.storage.setItem(this.syncKey, JSON.stringify(configs))
  }
}

function isValidRecord(r: unknown): r is TransactionRecord {
  if (r == null || typeof r !== "object") return false
  const rec = r as Record<string, unknown>
  return (
    typeof rec.txid === "string" &&
    typeof rec.timestamp === "number" &&
    typeof rec.amount === "number" &&
    typeof rec.fromPublicKey === "string" &&
    typeof rec.toPublicKey === "string" &&
    typeof rec.walletId === "string" &&
    typeof rec.origin === "string" &&
    typeof rec.protocol === "string"
  )
}

export interface RecordPaymentParams {
  txid: string
  amount: number
  fromPublicKey: string
  toPublicKey: string
  walletId: WalletId
  origin: string
  protocol: PaymentProtocol
  description?: string
}

export class TransactionLog {
  private records: TransactionRecord[] = []
  private storage: TransactionLogStorage
  private syncProviders: Map<SyncProviderType, SyncProvider> = new Map()
  private syncConfigs: SyncConfig[] = []
  private loaded = false

  constructor(storage: TransactionLogStorage) {
    this.storage = storage
  }

  /** Ensure records are loaded from storage. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.records = await this.storage.loadRecords()
    this.syncConfigs = await this.storage.loadSyncConfigs()
    this.loaded = true
  }

  /** Record a new payment transaction. */
  async record(params: RecordPaymentParams): Promise<TransactionRecord> {
    await this.ensureLoaded()

    const record: TransactionRecord = {
      txid: params.txid,
      timestamp: Date.now(),
      amount: params.amount,
      fromPublicKey: params.fromPublicKey,
      toPublicKey: params.toPublicKey,
      walletId: params.walletId,
      origin: params.origin,
      protocol: params.protocol,
      description: params.description,
    }

    this.records.push(record)
    await this.storage.saveRecords(this.records)

    // Fire-and-forget sync push
    this.pushToProviders([record]).catch(() => {})

    return record
  }

  /** Get all records, optionally filtered. */
  async query(filter?: {
    walletId?: WalletId
    origin?: string
    since?: number
    until?: number
    limit?: number
  }): Promise<TransactionRecord[]> {
    await this.ensureLoaded()

    let results = this.records

    if (filter?.walletId) {
      results = results.filter((r) => r.walletId === filter.walletId)
    }
    if (filter?.origin) {
      results = results.filter((r) => r.origin === filter.origin)
    }
    if (filter?.since) {
      results = results.filter((r) => r.timestamp >= filter.since!)
    }
    if (filter?.until) {
      results = results.filter((r) => r.timestamp <= filter.until!)
    }

    // Sort newest first
    results = results.sort((a, b) => b.timestamp - a.timestamp)

    if (filter?.limit) {
      results = results.slice(0, filter.limit)
    }

    return results
  }

  /** Get total spent by a wallet in a time range. */
  async totalSpent(walletId: WalletId, since?: number): Promise<number> {
    const records = await this.query({ walletId, since })
    return records.reduce((sum, r) => sum + r.amount, 0)
  }

  /** Register a sync provider. */
  registerSyncProvider(provider: SyncProvider): void {
    this.syncProviders.set(provider.type, provider)
  }

  /** Configure sync for a provider. */
  async configureSyncProvider(config: SyncConfig): Promise<void> {
    await this.ensureLoaded()
    const idx = this.syncConfigs.findIndex((c) => c.provider === config.provider)
    if (idx >= 0) {
      this.syncConfigs[idx] = config
    } else {
      this.syncConfigs.push(config)
    }
    await this.storage.saveSyncConfigs(this.syncConfigs)
  }

  /** Sync with all enabled providers: push local records, pull remote ones. */
  async sync(): Promise<{ pushed: number; pulled: number }> {
    await this.ensureLoaded()
    let totalPushed = 0
    let totalPulled = 0

    for (const config of this.syncConfigs) {
      if (!config.enabled) continue
      const provider = this.syncProviders.get(config.provider)
      if (!provider) continue

      // Push records since last sync
      const since = config.lastSyncAt ?? 0
      const toPush = this.records.filter((r) => r.timestamp > since)
      if (toPush.length > 0) {
        await provider.push(toPush)
        totalPushed += toPush.length
      }

      // Pull new records from remote
      const pulled = await provider.pull(since)
      const newRecords = pulled.filter(
        (remote) => !this.records.some((local) => local.txid === remote.txid),
      )
      if (newRecords.length > 0) {
        this.records.push(...newRecords)
        this.records.sort((a, b) => a.timestamp - b.timestamp)
        await this.storage.saveRecords(this.records)
        totalPulled += newRecords.length
      }

      // Update last sync timestamp
      config.lastSyncAt = Date.now()
    }

    await this.storage.saveSyncConfigs(this.syncConfigs)
    return { pushed: totalPushed, pulled: totalPulled }
  }

  /** Get all sync configs. */
  async getSyncConfigs(): Promise<SyncConfig[]> {
    await this.ensureLoaded()
    return [...this.syncConfigs]
  }

  private async pushToProviders(records: TransactionRecord[]): Promise<void> {
    for (const config of this.syncConfigs) {
      if (!config.enabled) continue
      const provider = this.syncProviders.get(config.provider)
      if (!provider) continue
      await provider.push(records)
    }
  }
}
