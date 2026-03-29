import { describe, expect, it, vi } from "vitest"
import { WalletTwoFactorProvider } from "./two-factor"

describe("WalletTwoFactorProvider", () => {
  it("returns false when no window/CWI is available", async () => {
    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "circuit-breaker-reset" })
    expect(result).toBe(false)
  })

  it("returns true when CWI.createSignature succeeds", async () => {
    const mockSig = new Uint8Array([1, 2, 3])
    const mockCWI = {
      createSignature: vi.fn().mockResolvedValue(mockSig),
    }
    vi.stubGlobal("window", { CWI: mockCWI })

    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "circuit-breaker-reset" })
    expect(result).toBe(true)
    expect(mockCWI.createSignature).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })

  it("returns false when CWI.createSignature returns null (user declined)", async () => {
    const mockCWI = {
      createSignature: vi.fn().mockResolvedValue(null),
    }
    vi.stubGlobal("window", { CWI: mockCWI })

    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "high-value-tx", amount: 50_000, origin: "https://example.com" })
    expect(result).toBe(false)

    vi.unstubAllGlobals()
  })

  it("returns false when CWI.createSignature throws", async () => {
    const mockCWI = {
      createSignature: vi.fn().mockRejectedValue(new Error("wallet error")),
    }
    vi.stubGlobal("window", { CWI: mockCWI })

    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "circuit-breaker-reset" })
    expect(result).toBe(false)

    vi.unstubAllGlobals()
  })

  it("falls back to prompt when CWI not available but window.prompt is", async () => {
    vi.stubGlobal("window", { prompt: vi.fn().mockReturnValue("CONFIRM") })

    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "new-site-approval", origin: "https://example.com" })
    expect(result).toBe(true)

    vi.unstubAllGlobals()
  })

  it("rejects prompt fallback when user types wrong value", async () => {
    vi.stubGlobal("window", { prompt: vi.fn().mockReturnValue("yes") })

    const provider = new WalletTwoFactorProvider()
    const result = await provider.verify({ type: "circuit-breaker-reset" })
    expect(result).toBe(false)

    vi.unstubAllGlobals()
  })
})
