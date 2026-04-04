import { describe, it, expect, beforeEach } from "vitest"
import { TransactionLog, LocalTransactionLogStorage } from "./transaction-log"
import type { TransactionRecord, SyncConfig } from "./types"

/** In-memory storage for testing. */
class MemoryStorage {
  private data: Record<string, string> = {}
  getItem(key: string): string | null { return this.data[key] ?? null }
  setItem(key: string, value: string): void { this.data[key] = value }
}

describe("TransactionLog", () => {
  let storage: LocalTransactionLogStorage
  let log: TransactionLog

  beforeEach(() => {
    storage = new LocalTransactionLogStorage(new MemoryStorage())
    log = new TransactionLog(storage)
  })

  it("records a transaction", async () => {
    const record = await log.record({
      txid: "abc123",
      amount: 50_000,
      fromPublicKey: "02aaa",
      toPublicKey: "02bbb",
      walletId: "wallet1",
      origin: "https://example.com",
      protocol: "x402",
    })

    expect(record.txid).toBe("abc123")
    expect(record.amount).toBe(50_000)
    expect(record.timestamp).toBeGreaterThan(0)
  })

  it("queries all records", async () => {
    await log.record({
      txid: "tx1", amount: 100, fromPublicKey: "pk1", toPublicKey: "pk2",
      walletId: "w1", origin: "https://a.com", protocol: "x402",
    })
    await log.record({
      txid: "tx2", amount: 200, fromPublicKey: "pk1", toPublicKey: "pk3",
      walletId: "w1", origin: "https://b.com", protocol: "brc105",
    })

    const all = await log.query()
    expect(all).toHaveLength(2)
    // Both records present
    expect(all.map((r) => r.txid).sort()).toEqual(["tx1", "tx2"])
  })

  it("filters by walletId", async () => {
    await log.record({
      txid: "tx1", amount: 100, fromPublicKey: "pk1", toPublicKey: "pk2",
      walletId: "w1", origin: "https://a.com", protocol: "x402",
    })
    await log.record({
      txid: "tx2", amount: 200, fromPublicKey: "pk3", toPublicKey: "pk4",
      walletId: "w2", origin: "https://a.com", protocol: "x402",
    })

    const w1Records = await log.query({ walletId: "w1" })
    expect(w1Records).toHaveLength(1)
    expect(w1Records[0].txid).toBe("tx1")
  })

  it("filters by origin", async () => {
    await log.record({
      txid: "tx1", amount: 100, fromPublicKey: "pk1", toPublicKey: "pk2",
      walletId: "w1", origin: "https://a.com", protocol: "x402",
    })
    await log.record({
      txid: "tx2", amount: 200, fromPublicKey: "pk1", toPublicKey: "pk3",
      walletId: "w1", origin: "https://b.com", protocol: "x402",
    })

    const filtered = await log.query({ origin: "https://b.com" })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].txid).toBe("tx2")
  })

  it("computes total spent by wallet", async () => {
    await log.record({
      txid: "tx1", amount: 100, fromPublicKey: "pk1", toPublicKey: "pk2",
      walletId: "w1", origin: "https://a.com", protocol: "x402",
    })
    await log.record({
      txid: "tx2", amount: 300, fromPublicKey: "pk1", toPublicKey: "pk3",
      walletId: "w1", origin: "https://b.com", protocol: "x402",
    })
    await log.record({
      txid: "tx3", amount: 500, fromPublicKey: "pk5", toPublicKey: "pk6",
      walletId: "w2", origin: "https://c.com", protocol: "x402",
    })

    expect(await log.totalSpent("w1")).toBe(400)
    expect(await log.totalSpent("w2")).toBe(500)
  })

  it("respects limit in query", async () => {
    for (let i = 0; i < 10; i++) {
      await log.record({
        txid: `tx${i}`, amount: i * 100, fromPublicKey: "pk1", toPublicKey: "pk2",
        walletId: "w1", origin: "https://a.com", protocol: "x402",
      })
    }

    const limited = await log.query({ limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it("persists records across instances", async () => {
    await log.record({
      txid: "tx1", amount: 100, fromPublicKey: "pk1", toPublicKey: "pk2",
      walletId: "w1", origin: "https://a.com", protocol: "x402",
    })

    // Create new instance with same storage
    const log2 = new TransactionLog(storage)
    const records = await log2.query()
    expect(records).toHaveLength(1)
    expect(records[0].txid).toBe("tx1")
  })

  it("configures sync provider", async () => {
    const config: SyncConfig = {
      provider: "local",
      enabled: true,
    }
    await log.configureSyncProvider(config)
    const configs = await log.getSyncConfigs()
    expect(configs).toHaveLength(1)
    expect(configs[0].provider).toBe("local")
  })
})
