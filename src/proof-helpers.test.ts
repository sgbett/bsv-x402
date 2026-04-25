import { describe, it, expect, vi } from "vitest"
import { buildLifecycleCallbacks } from "./proof-helpers"

describe("buildLifecycleCallbacks", () => {
  const txid = "abc123"

  describe("abort", () => {
    it("calls wallet.abortAction with the correct reference", async () => {
      const wallet = {
        createAction: vi.fn(),
        abortAction: vi.fn().mockResolvedValue({ aborted: true }),
      }
      const { abort } = buildLifecycleCallbacks(wallet, txid)

      expect(abort).toBeDefined()
      await abort!()
      expect(wallet.abortAction).toHaveBeenCalledWith({ reference: txid })
    })

    it("is undefined when wallet.abortAction is not present", () => {
      const wallet = { createAction: vi.fn() }
      const { abort } = buildLifecycleCallbacks(wallet, txid)

      expect(abort).toBeUndefined()
    })

    it("is undefined when wallet.abortAction is explicitly undefined", () => {
      const wallet = { createAction: vi.fn(), abortAction: undefined }
      const { abort } = buildLifecycleCallbacks(wallet, txid)

      expect(abort).toBeUndefined()
    })

    it("swallows errors and warns", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const error = new Error("abort boom")
      const wallet = {
        createAction: vi.fn(),
        abortAction: vi.fn().mockRejectedValue(error),
      }
      const { abort } = buildLifecycleCallbacks(wallet, txid)

      await expect(abort!()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith("[x402] abortAction failed:", error)
      warn.mockRestore()
    })

    it("includes protocol in warn message when provided", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const error = new Error("abort boom")
      const wallet = {
        createAction: vi.fn(),
        abortAction: vi.fn().mockRejectedValue(error),
      }
      const { abort } = buildLifecycleCallbacks(wallet, txid, "PayGateway")

      await abort!()
      expect(warn).toHaveBeenCalledWith("[x402] PayGateway abortAction failed:", error)
      warn.mockRestore()
    })
  })

  describe("broadcast", () => {
    it("calls wallet.createAction with sendWith", async () => {
      const wallet = { createAction: vi.fn().mockResolvedValue({ txid: "x" }) }
      const { broadcast } = buildLifecycleCallbacks(wallet, txid)

      expect(broadcast).toBeDefined()
      await broadcast()
      expect(wallet.createAction).toHaveBeenCalledWith({
        description: "Broadcast x402 payment",
        outputs: [],
        options: { sendWith: [txid] },
      })
    })

    it("is always defined (unconditional)", () => {
      const wallet = { createAction: vi.fn() }
      const { broadcast } = buildLifecycleCallbacks(wallet, txid)

      expect(broadcast).toBeDefined()
      expect(typeof broadcast).toBe("function")
    })

    it("swallows errors and warns", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const error = new Error("broadcast boom")
      const wallet = { createAction: vi.fn().mockRejectedValue(error) }
      const { broadcast } = buildLifecycleCallbacks(wallet, txid)

      await expect(broadcast()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith("[x402] broadcast failed:", error)
      warn.mockRestore()
    })

    it("includes protocol in warn message when provided", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const error = new Error("broadcast boom")
      const wallet = { createAction: vi.fn().mockRejectedValue(error) }
      const { broadcast } = buildLifecycleCallbacks(wallet, txid, "BRC-105")

      await broadcast()
      expect(warn).toHaveBeenCalledWith("[x402] BRC-105 broadcast failed:", error)
      warn.mockRestore()
    })
  })
})
