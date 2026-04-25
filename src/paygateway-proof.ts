import type { PayGatewayChallenge, PayGatewayProof, PayGatewayProofResult, Brc105Wallet } from "./types"
import { extractTxData } from "./bytes"
import { buildLifecycleCallbacks } from "./proof-helpers"

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
  const txData = extractTxData(result)

  // Step 3: Build proof object
  const proof: PayGatewayProof = { rawtx: txData.hex, txid: result.txid }
  if (txData.source === 'tx') {
    proof.beef = txData.base64
  }

  // Step 4: Build lifecycle callbacks
  const { abort, broadcast } = buildLifecycleCallbacks(wallet, result.txid, 'PayGateway')

  return { proof, abort, broadcast }
}
