import type { Brc121Challenge, Brc121ProofResult, Brc105Wallet } from "./types"
import { pubkeyToP2PKHLockingScript } from "./brc105-proof"
import { extractTxData } from "./bytes"
import { buildLifecycleCallbacks } from "./proof-helpers"

// === Main proof constructor ===

/**
 * Construct a BRC-121 payment proof from a challenge using BRC-29 key derivation.
 *
 * Algorithm (matching @bsv/402-pay reference):
 * 1. Get client's identity key
 * 2. Generate nonce (derivation prefix): 8 random bytes → base64
 * 3. Generate derivation suffix: btoa(Date.now().toString())
 * 4. Derive payee public key using BRC-29 protocol
 * 5. Build P2PKH locking script from derived public key
 * 6. Create transaction via wallet with noSend: true
 * 7. Convert transaction to base64
 */
export async function constructBrc121Proof(
  challenge: Brc121Challenge,
  wallet: Brc105Wallet,
  origin?: string,
): Promise<Brc121ProofResult> {
  // Step 1: Get client's identity key
  let clientIdentityKey: string
  try {
    const r = await wallet.getPublicKey({ identityKey: true })
    clientIdentityKey = r.publicKey
  } catch (err) {
    console.error('[x402] BRC-121 proof: failed to get identity key:', err)
    throw err
  }

  // Step 2: Generate nonce (derivation prefix) — 8 random bytes → base64
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8))
  const nonce = btoa(String.fromCharCode(...nonceBytes))

  // Step 3: Generate derivation suffix — base64 of timestamp string
  const time = String(Date.now())
  const timeSuffixB64 = btoa(time)

  // Step 4: Derive the payee's public key via BRC-29
  const keyID = `${nonce} ${timeSuffixB64}`
  let derivedPublicKey: string
  try {
    const r = await wallet.getPublicKey({
      protocolID: [2, "3241645161d8"],
      keyID,
      counterparty: challenge.serverIdentityKey,
    })
    derivedPublicKey = r.publicKey
  } catch (err) {
    console.error('[x402] BRC-121 proof: BRC-29 key derivation failed:', err)
    throw err
  }

  // Step 5: Build P2PKH locking script
  let lockingScript: string
  try {
    lockingScript = await pubkeyToP2PKHLockingScript(derivedPublicKey)
  } catch (err) {
    console.error('[x402] BRC-121 proof: P2PKH script generation failed:', err)
    throw err
  }

  // Step 6: Create the payment transaction
  const description = origin
    ? `Payment for request to ${origin}`
    : "BRC-121 payment"
  let result: Awaited<ReturnType<typeof wallet.createAction>>
  try {
    result = await wallet.createAction({
      description,
      outputs: [{
        satoshis: challenge.satoshis,
        lockingScript,
        outputDescription: "BRC-121 payment",
      }],
      options: {
        randomizeOutputs: false,
        noSend: true,
        returnTXIDOnly: false,
      },
    })
  } catch (err) {
    console.error(`[x402] BRC-121 proof: createAction failed (${challenge.satoshis} sats):`, err)
    throw err
  }

  // Step 7: Convert transaction to base64
  const txData = extractTxData(result)

  const proof = {
    beef: txData.base64,
    senderIdentityKey: clientIdentityKey,
    nonce,
    time,
    vout: "0",
    txid: result.txid,
  }

  const { abort, broadcast } = buildLifecycleCallbacks(wallet, result.txid, 'BRC-121')

  return { proof, abort, broadcast }
}
