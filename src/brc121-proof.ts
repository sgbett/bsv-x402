import type { Brc121Challenge, Brc121ProofResult, Brc105Wallet } from "./types"
import { pubkeyToP2PKHLockingScript } from "./brc105-proof"

// === Byte encoding helpers ===

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function numberArrayToBase64(arr: number[]): string {
  return bytesToBase64(new Uint8Array(arr))
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex string must have even length")
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

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
  const { publicKey: clientIdentityKey } = await wallet.getPublicKey({ identityKey: true })

  // Step 2: Generate nonce (derivation prefix) — 8 random bytes → base64
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8))
  const nonce = btoa(String.fromCharCode(...nonceBytes))

  // Step 3: Generate derivation suffix — base64 of timestamp string
  const time = String(Date.now())
  const timeSuffixB64 = btoa(time)

  // Step 4: Derive the payee's public key via BRC-29
  const keyID = `${nonce} ${timeSuffixB64}`
  const { publicKey: derivedPublicKey } = await wallet.getPublicKey({
    protocolID: [2, "3241645161d8"],
    keyID,
    counterparty: challenge.serverIdentityKey,
  })

  // Step 5: Build P2PKH locking script
  const lockingScript = await pubkeyToP2PKHLockingScript(derivedPublicKey)

  // Step 6: Create the payment transaction
  const description = origin
    ? `Payment for request to ${origin}`
    : "BRC-121 payment"
  const result = await wallet.createAction({
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

  // Step 7: Convert transaction to base64
  // SDK wallets return `tx: number[]`; CWI wallets return `rawTx: string` (hex)
  let transactionBase64: string
  if (result.tx && Array.isArray(result.tx) && result.tx.length > 0) {
    transactionBase64 = numberArrayToBase64(result.tx)
  } else if (result.rawTx && typeof result.rawTx === "string" && result.rawTx.length > 0) {
    transactionBase64 = bytesToBase64(hexToBytes(result.rawTx))
  } else {
    throw new Error("Wallet returned no transaction data (neither tx nor rawTx)")
  }

  const proof = {
    beef: transactionBase64,
    senderIdentityKey: clientIdentityKey,
    nonce,
    time,
    vout: "0",
    txid: result.txid,
  }

  const abort = wallet.abortAction
    ? async () => {
        try {
          await wallet.abortAction!({ reference: result.txid })
        } catch (err) {
          console.warn('[x402] abortAction failed:', err)
        }
      }
    : undefined

  const broadcast = wallet.createAction
    ? async () => {
        try {
          await wallet.createAction({
            description: 'Broadcast x402 payment',
            outputs: [],
            options: { sendWith: [result.txid] },
          })
        } catch (err) {
          console.warn('[x402] broadcast failed:', err)
        }
      }
    : undefined

  return { proof, abort, broadcast }
}
