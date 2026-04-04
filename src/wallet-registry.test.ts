import { describe, it, expect } from "vitest"
import { WalletRegistry, matchesUrlScope } from "./wallet-registry"
import type { WalletProfile } from "./types"

describe("WalletRegistry", () => {
  it("creates a default wallet when the first wallet is added", () => {
    const reg = new WalletRegistry()
    const w = reg.create({ name: "My Wallet", mode: "manual" })
    expect(w.isDefault).toBe(true)
    expect(w.name).toBe("My Wallet")
    expect(w.mode).toBe("manual")
    expect(w.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it("second wallet is not default", () => {
    const reg = new WalletRegistry()
    reg.create({ name: "First", mode: "manual" })
    const second = reg.create({ name: "Second", mode: "auto" })
    expect(second.isDefault).toBe(false)
  })

  it("explicitly setting isDefault unsets previous default", () => {
    const reg = new WalletRegistry()
    const first = reg.create({ name: "First", mode: "manual" })
    reg.create({ name: "Second", mode: "auto", isDefault: true })

    const all = reg.list()
    const firstUpdated = all.find((w) => w.id === first.id)!
    expect(firstUpdated.isDefault).toBe(false)
    expect(reg.getDefault()!.name).toBe("Second")
  })

  it("update changes fields and updatedAt", () => {
    const reg = new WalletRegistry()
    const w = reg.create({ name: "Original", mode: "manual" })
    const updated = reg.update(w.id, { name: "Renamed" })
    expect(updated.name).toBe("Renamed")
    expect(updated.createdAt).toBe(w.createdAt)
  })

  it("remove promotes next wallet to default", () => {
    const reg = new WalletRegistry()
    const first = reg.create({ name: "A", mode: "manual" })
    reg.create({ name: "B", mode: "manual" })
    reg.remove(first.id)
    expect(reg.list()).toHaveLength(1)
    expect(reg.getDefault()!.name).toBe("B")
  })

  it("cannot remove last wallet", () => {
    const reg = new WalletRegistry()
    const w = reg.create({ name: "Only", mode: "manual" })
    expect(() => reg.remove(w.id)).toThrow("Cannot remove the last wallet")
  })

  describe("selectForOrigin", () => {
    it("returns default wallet when no scopes defined", () => {
      const reg = new WalletRegistry()
      reg.create({ name: "Default", mode: "manual", isDefault: true })
      const selected = reg.selectForOrigin("https://example.com")
      expect(selected!.name).toBe("Default")
    })

    it("prefers scoped auto wallet within threshold", () => {
      const reg = new WalletRegistry()
      reg.create({ name: "Default", mode: "manual", isDefault: true })
      reg.create({
        name: "Auto for example",
        mode: "auto",
        urlScope: { whitelist: ["https://example.com"], blacklist: [] },
        autoConfirmThreshold: 10_000,
      })

      const selected = reg.selectForOrigin("https://example.com", 5_000)
      expect(selected!.name).toBe("Auto for example")
    })

    it("falls back to default when auto wallet threshold exceeded", () => {
      const reg = new WalletRegistry()
      reg.create({ name: "Default", mode: "manual", isDefault: true })
      reg.create({
        name: "Auto for example",
        mode: "auto",
        urlScope: { whitelist: ["https://example.com"], blacklist: [] },
        autoConfirmThreshold: 10_000,
      })

      const selected = reg.selectForOrigin("https://example.com", 50_000)
      expect(selected!.name).toBe("Default")
    })

    it("prefers scoped manual wallet over default", () => {
      const reg = new WalletRegistry()
      reg.create({ name: "Default", mode: "manual", isDefault: true })
      reg.create({
        name: "Manual for example",
        mode: "manual",
        urlScope: { whitelist: ["https://example.com"], blacklist: [] },
      })

      const selected = reg.selectForOrigin("https://example.com")
      expect(selected!.name).toBe("Manual for example")
    })

    it("blacklist takes priority over whitelist", () => {
      const reg = new WalletRegistry()
      reg.create({ name: "Default", mode: "manual", isDefault: true })
      reg.create({
        name: "Scoped",
        mode: "manual",
        urlScope: {
          whitelist: ["https://*.example.com"],
          blacklist: ["https://evil.example.com"],
        },
      })

      const blocked = reg.selectForOrigin("https://evil.example.com")
      expect(blocked!.name).toBe("Default")

      const allowed = reg.selectForOrigin("https://good.example.com")
      expect(allowed!.name).toBe("Scoped")
    })
  })

  it("serializes and restores profiles", () => {
    const reg1 = new WalletRegistry()
    reg1.create({ name: "A", mode: "manual" })
    reg1.create({ name: "B", mode: "auto" })

    const json = reg1.toJSON()
    const reg2 = new WalletRegistry(json)
    expect(reg2.list()).toHaveLength(2)
    expect(reg2.list().map((w) => w.name)).toEqual(["A", "B"])
  })
})

describe("matchesUrlScope", () => {
  it("matches exact origin", () => {
    expect(matchesUrlScope("https://example.com", { whitelist: ["https://example.com"], blacklist: [] })).toBe(true)
  })

  it("matches wildcard subdomain", () => {
    expect(matchesUrlScope("https://api.example.com", { whitelist: ["https://*.example.com"], blacklist: [] })).toBe(true)
  })

  it("rejects non-matching origin", () => {
    expect(matchesUrlScope("https://other.com", { whitelist: ["https://example.com"], blacklist: [] })).toBe(false)
  })

  it("empty whitelist matches everything", () => {
    expect(matchesUrlScope("https://anything.com", { whitelist: [], blacklist: [] })).toBe(true)
  })

  it("blacklist blocks matching origin", () => {
    expect(matchesUrlScope("https://blocked.com", { whitelist: [], blacklist: ["https://blocked.com"] })).toBe(false)
  })
})
