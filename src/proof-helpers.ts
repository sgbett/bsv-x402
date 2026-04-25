import type { Brc105Wallet } from "./types"

/**
 * Build the abort/broadcast lifecycle callbacks used by noSend proof flows.
 *
 * - `abort` is conditional on `wallet.abortAction` existing (genuinely optional).
 * - `broadcast` is unconditional — `wallet.createAction` is required on `Brc105Wallet`.
 * - Both callbacks swallow errors with `console.warn`.
 */
export function buildLifecycleCallbacks(
  wallet: Pick<Brc105Wallet, "createAction" | "abortAction">,
  txid: string,
  protocol?: string,
): { abort?: () => Promise<void>; broadcast: () => Promise<void> } {
  const tag = protocol ? `${protocol} ` : ""

  const abort = wallet.abortAction
    ? async () => {
        try {
          await wallet.abortAction!({ reference: txid })
        } catch (err) {
          console.warn(`[x402] ${tag}abortAction failed:`, err)
        }
      }
    : undefined

  const broadcast = async () => {
    try {
      await wallet.createAction({
        description: "Broadcast x402 payment",
        outputs: [],
        options: { sendWith: [txid] },
      })
    } catch (err) {
      console.warn(`[x402] ${tag}broadcast failed:`, err)
    }
  }

  return { abort, broadcast }
}
