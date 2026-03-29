import type { TwoFactorAction, TwoFactorProvider } from "./types"

declare const window: {
  CWI?: {
    createSignature(params: { data: Uint8Array; protocolID: [number, string]; keyID: string }): Promise<Uint8Array | null>
  }
  prompt?(message: string): string | null
}

/**
 * Wallet-based 2FA using BRC-100 createSignature().
 * The wallet's own approval UI (e.g. BSV Browser popup) serves as the 2FA prompt.
 * A malicious page script cannot forge a wallet signature.
 */
export class WalletTwoFactorProvider implements TwoFactorProvider {
  async verify(action: TwoFactorAction): Promise<boolean> {
    if (typeof window === "undefined" || !window.CWI) {
      return this.promptFallback(action)
    }

    const challengeData = `x402-2fa:${JSON.stringify(action)}:${Date.now()}`
    try {
      const sig = await window.CWI.createSignature({
        data: new TextEncoder().encode(challengeData),
        protocolID: [1, "x402-2fa"],
        keyID: "spending-limits",
      })
      return sig !== null
    } catch {
      return false
    }
  }

  private promptFallback(action: TwoFactorAction): boolean {
    if (typeof window === "undefined" || !window.prompt) return false

    const message = describeAction(action)
    const result = window.prompt(`${message}\n\nType CONFIRM to proceed:`)
    return result === "CONFIRM"
  }
}

function describeAction(action: TwoFactorAction): string {
  switch (action.type) {
    case "circuit-breaker-reset":
      return "Reset spending circuit breaker? This re-enables automated payments."
    case "tier-change":
      return `Change spending tier from "${action.from}" to "${action.to}"?`
    case "high-value-tx":
      return `Approve high-value payment of ${action.amount} sats to ${action.origin}?`
    case "new-site-approval":
      return `Allow automated payments to ${action.origin}?`
    case "limit-override":
      return `Spending limit reached: ${action.reason}\nAllow this payment of ${action.amount} sats to ${action.origin}?`
  }
}
