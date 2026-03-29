import { describe, expect, it } from "vitest"
import { LocalStorageAdapter } from "./storage"
import type { LimitState } from "./types"

function mockStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  }
}

const TEST_KEY = new Uint8Array(32).fill(42)

function testState(): LimitState {
  return {
    entries: [
      { timestamp: 1_700_000_000_000, origin: "https://example.com", satoshis: 5000, txid: "tx-1" },
    ],
    circuitBroken: false,
    hmac: "",
  }
}

describe("LocalStorageAdapter", () => {
  describe("without HMAC", () => {
    it("returns null when no state is stored", async () => {
      const adapter = new LocalStorageAdapter(undefined, mockStorage())
      const state = await adapter.load()
      expect(state).toBeNull()
    })

    it("round-trips state through save/load", async () => {
      const storage = mockStorage()
      const adapter = new LocalStorageAdapter(undefined, storage)

      const state = testState()
      await adapter.save(state)

      const loaded = await adapter.load()
      expect(loaded).not.toBeNull()
      expect(loaded!.entries).toHaveLength(1)
      expect(loaded!.entries[0].txid).toBe("tx-1")
      expect(loaded!.circuitBroken).toBe(false)
    })
  })

  describe("with HMAC", () => {
    const keyDeriver = async () => TEST_KEY

    it("round-trips state with valid HMAC", async () => {
      const storage = mockStorage()
      const adapter = new LocalStorageAdapter(keyDeriver, storage)

      await adapter.save(testState())
      const loaded = await adapter.load()
      expect(loaded).not.toBeNull()
      expect(loaded!.entries).toHaveLength(1)
      expect(loaded!.circuitBroken).toBe(false)
    })

    it("detects tampered state and trips circuit breaker", async () => {
      const storage = mockStorage()
      const adapter = new LocalStorageAdapter(keyDeriver, storage)

      await adapter.save(testState())

      // Tamper with stored data
      const raw = storage.getItem("x402:limit-state")!
      const tampered = JSON.parse(raw)
      tampered.entries[0].satoshis = 999_999
      storage.setItem("x402:limit-state", JSON.stringify(tampered))

      const loaded = await adapter.load()
      expect(loaded).not.toBeNull()
      expect(loaded!.entries).toHaveLength(0)
      expect(loaded!.circuitBroken).toBe(true)
    })

    it("writes HMAC to state on save", async () => {
      const storage = mockStorage()
      const adapter = new LocalStorageAdapter(keyDeriver, storage)

      await adapter.save(testState())
      const raw = JSON.parse(storage.getItem("x402:limit-state")!)
      expect(raw.hmac).toBeTruthy()
      expect(raw.hmac.length).toBe(64) // SHA-256 hex
    })
  })

  describe("site policies", () => {
    it("returns empty object when no policies stored", async () => {
      const adapter = new LocalStorageAdapter(undefined, mockStorage())
      const policies = await adapter.loadSitePolicies()
      expect(policies).toEqual({})
    })

    it("round-trips site policies", async () => {
      const storage = mockStorage()
      const adapter = new LocalStorageAdapter(undefined, storage)

      const policies = {
        "https://example.com": {
          origin: "https://example.com",
          action: "global" as const,
        },
        "https://blocked.com": {
          origin: "https://blocked.com",
          action: "block" as const,
        },
      }

      await adapter.saveSitePolicies(policies)
      const loaded = await adapter.loadSitePolicies()
      expect(loaded["https://example.com"].action).toBe("global")
      expect(loaded["https://blocked.com"].action).toBe("block")
    })
  })
})
