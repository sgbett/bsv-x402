import type { PayGatewayChallenge, PayGatewayProof, PayGatewayProofResult, Brc105Wallet } from "./types"
import { bytesToHex, bytesToBase64 } from "./bytes"

// === Main proof constructor ===

/**
 * Construct a PayGateway payment proof from a challenge.
 *
 * Unlike BRC-105/BRC-121, PayGateway uses hex-encoded raw transactions (not base64)
 * and the server broadcasts — the client sends with `noSend: true`.
 *
 * The `accepted` block in the payload echoes back the challenge's selected accept
 * entry verbatim, including `payToSig` and any `extra` fields.
 */
export async function constructPayGatewayProof(
  challenge: PayGatewayChallenge,
  wallet: Brc105Wallet,
  origin?: string,
): Promise<PayGatewayProofResult> {
  const accept = challenge.selectedAccept
  const satoshis = parseInt(accept.amount, 10)

  if (isNaN(satoshis) || satoshis <= 0) {
    const msg = `[x402] PayGateway proof: invalid amount "${accept.amount}"`
    console.error(msg)
    throw new Error(msg)
  }

  // Step 1: Create the payment transaction
  const description = origin
    ? `Payment for request to ${origin}`
    : "PayGateway payment"
  let result: Awaited<ReturnType<typeof wallet.createAction>>
  try {
    result = await wallet.createAction({
      description,
      outputs: [{
        satoshis,
        lockingScript: accept.payTo,
        outputDescription: "PayGateway payment",
      }],
      options: {
        noSend: true,
        returnTXIDOnly: false,
        randomizeOutputs: false,
      },
    })
  } catch (err) {
    console.error(`[x402] PayGateway proof: createAction failed (${satoshis} sats):`, err)
    throw err
  }

  // Step 2: Extract raw tx hex and optional BEEF base64
  // SDK wallets return `tx: number[]`; CWI wallets return `rawTx: string` (hex)
  let rawtx: string
  let beef: string | undefined
  if (result.tx && Array.isArray(result.tx) && result.tx.length > 0) {
    const txBytes = new Uint8Array(result.tx)
    rawtx = bytesToHex(txBytes)
    beef = bytesToBase64(txBytes)
  } else if (result.rawTx && typeof result.rawTx === "string" && result.rawTx.length > 0) {
    rawtx = result.rawTx
    // No BEEF available from rawTx-only wallets
  } else {
    const msg = "[x402] PayGateway proof: wallet returned no transaction data (neither tx nor rawTx)"
    console.error(msg)
    throw new Error("Wallet returned no transaction data (neither tx nor rawTx)")
  }

  // Step 3: Build proof object
  const proof: PayGatewayProof = { rawtx, txid: result.txid }
  if (beef) {
    proof.beef = beef
  }

  // Step 4: Build abort callback
  const abort = wallet.abortAction
    ? async () => {
        try {
          await wallet.abortAction!({ reference: result.txid })
        } catch (err) {
          console.warn('[x402] PayGateway abortAction failed:', err)
        }
      }
    : undefined

  // Step 5: Build broadcast callback
  const broadcast = wallet.createAction
    ? async () => {
        try {
          await wallet.createAction({
            description: 'Broadcast x402 payment',
            outputs: [],
            options: { sendWith: [result.txid] },
          })
        } catch (err) {
          console.warn('[x402] PayGateway broadcast failed:', err)
        }
      }
    : undefined

  return { proof, abort, broadcast }
}
