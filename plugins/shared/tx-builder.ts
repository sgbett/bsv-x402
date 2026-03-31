/**
 * tx-builder.ts — Construct and broadcast BSV transactions for x402 payments.
 *
 * Fee estimation and UTXO selection are fully functional.
 * Transaction construction (`buildTransaction`) is a stub pending @bsv/sdk.
 * Network calls (broadcast, fetchUTXOs) use the WhatsOnChain API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

export interface TxOutput {
  satoshis: number
  lockingScript: string
  description?: string
}

export interface BuildTxParams {
  outputs: TxOutput[]
  utxos: UTXO[]
  changeAddress: string
  privateKey: Uint8Array
  feePerByte?: number // default 0.5 sat/byte for BSV
}

export interface BuiltTx {
  txid: string
  rawTx: string
  fee: number
}

export interface BroadcastResult {
  txid: string
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FEE_PER_BYTE = 0.5
const BYTES_PER_INPUT = 148 // approximate P2PKH input size
const BYTES_PER_OUTPUT = 34 // approximate P2PKH output size
const TX_OVERHEAD_BYTES = 10 // version + locktime + varint overhead

// ---------------------------------------------------------------------------
// Fee estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the mining fee for a transaction.
 *
 * Approximations:
 *  - ~148 bytes per P2PKH input
 *  - ~34 bytes per output
 *  - ~10 bytes overhead (version, locktime, varint counts)
 *  - Default 0.5 sat/byte (BSV is very cheap)
 */
export function estimateFee(
  numInputs: number,
  numOutputs: number,
  feePerByte: number = DEFAULT_FEE_PER_BYTE,
): number {
  const estimatedBytes =
    TX_OVERHEAD_BYTES +
    numInputs * BYTES_PER_INPUT +
    numOutputs * BYTES_PER_OUTPUT

  return Math.ceil(estimatedBytes * feePerByte)
}

// ---------------------------------------------------------------------------
// UTXO selection
// ---------------------------------------------------------------------------

/**
 * Simple greedy UTXO selection.
 *
 * Sorts UTXOs by satoshis descending and accumulates until the total covers
 * the target amount plus the estimated fee. Throws if funds are insufficient.
 */
export function selectUTXOs(
  utxos: UTXO[],
  targetAmount: number,
  feePerByte: number = DEFAULT_FEE_PER_BYTE,
): { selected: UTXO[]; fee: number; change: number } {
  const sorted = [...utxos].sort((a, b) => b.satoshis - a.satoshis)

  const selected: UTXO[] = []
  let total = 0

  for (const utxo of sorted) {
    selected.push(utxo)
    total += utxo.satoshis

    // +1 output for change
    const fee = estimateFee(selected.length, 2, feePerByte)

    if (total >= targetAmount + fee) {
      const change = total - targetAmount - fee
      return { selected, fee, change }
    }
  }

  const fee = estimateFee(selected.length, 2, feePerByte)
  throw new Error(
    `Insufficient funds: have ${total} satoshis, need ${targetAmount + fee} (${targetAmount} + ${fee} fee)`,
  )
}

// ---------------------------------------------------------------------------
// Transaction construction (STUB — requires @bsv/sdk)
// ---------------------------------------------------------------------------

/**
 * Build a signed BSV transaction.
 *
 * **This is a stub.** The fee estimation and UTXO selection are real, but the
 * actual transaction serialisation and signing require `@bsv/sdk`.
 */
export function buildTransaction(params: BuildTxParams): BuiltTx {
  const feePerByte = params.feePerByte ?? DEFAULT_FEE_PER_BYTE

  const totalOutputSatoshis = params.outputs.reduce(
    (sum, o) => sum + o.satoshis,
    0,
  )

  const { selected, fee, change: _change } = selectUTXOs(
    params.utxos,
    totalOutputSatoshis,
    feePerByte,
  )

  // TODO: Construct actual BSV transaction using @bsv/sdk Transaction class
  //
  // Rough outline once @bsv/sdk is available:
  //
  //   import { Transaction, PrivateKey, P2PKH } from '@bsv/sdk'
  //
  //   const tx = new Transaction()
  //
  //   // Add inputs from selected UTXOs
  //   for (const utxo of selected) {
  //     tx.addInput({
  //       sourceTXID: utxo.txid,
  //       sourceOutputIndex: utxo.vout,
  //       unlockingScriptTemplate: new P2PKH().unlock(privateKey),
  //       sequence: 0xffffffff,
  //     })
  //   }
  //
  //   // Add payment outputs
  //   for (const output of params.outputs) {
  //     tx.addOutput({ satoshis: output.satoshis, lockingScript: output.lockingScript })
  //   }
  //
  //   // Add change output if needed
  //   if (change > 0) {
  //     tx.addOutput({ satoshis: change, lockingScript: P2PKH.lock(changeAddress) })
  //   }

  // TODO: Sign the transaction with the private key
  //   await tx.sign()

  // --- Stub return value ---
  // Generate a deterministic dummy txid from the parameters so callers can
  // exercise the surrounding logic without @bsv/sdk installed.
  const stubPayload = JSON.stringify({
    inputs: selected.map((u) => `${u.txid}:${u.vout}`),
    outputs: params.outputs,
    changeAddress: params.changeAddress,
  })

  const dummyTxid = sha256Hex(stubPayload)

  return {
    txid: dummyTxid,
    rawTx: '', // empty until real serialisation is wired up
    fee,
  }
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast a raw transaction via the WhatsOnChain API.
 *
 * @param rawTx  - hex-encoded raw transaction
 * @param network - 'main' (default) or 'test'
 */
export async function broadcastTransaction(
  rawTx: string,
  network: string = 'main',
): Promise<BroadcastResult> {
  const url = `https://api.whatsonchain.com/v1/bsv/${network}/tx/raw`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawTx }),
    })
  } catch (err) {
    return {
      txid: '',
      success: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!response.ok) {
    let body = ''
    try {
      body = await response.text()
    } catch {
      // ignore read errors
    }
    return {
      txid: '',
      success: false,
      error: `HTTP ${response.status}: ${body}`,
    }
  }

  const txid = (await response.text()).replace(/"/g, '').trim()
  return { txid, success: true }
}

// ---------------------------------------------------------------------------
// Fetch UTXOs
// ---------------------------------------------------------------------------

/**
 * Fetch unspent outputs for an address from WhatsOnChain.
 *
 * @param address - BSV address
 * @param network - 'main' (default) or 'test'
 */
export async function fetchUTXOs(
  address: string,
  network: string = 'main',
): Promise<UTXO[]> {
  const url = `https://api.whatsonchain.com/v1/bsv/${network}/address/${address}/unspent`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch UTXOs for ${address}: HTTP ${response.status}`,
    )
  }

  const data: Array<{
    tx_hash: string
    tx_pos: number
    value: number
    height: number
  }> = await response.json()

  return data.map((item) => ({
    txid: item.tx_hash,
    vout: item.tx_pos,
    satoshis: item.value,
    // WhatsOnChain /unspent doesn't return the locking script; callers that
    // need it should fetch each output individually or supply their own list.
    script: '',
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest (used for the stub txid).
 * Works in browsers and Node 18+ (via the Web Crypto API / globalThis.crypto).
 */
function sha256Hex(input: string): string {
  // Synchronous fallback: produce a simple hash when SubtleCrypto is
  // unavailable or when we want to keep the function synchronous.
  // This is only used for the stub txid — not for any security purpose.
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  // Pad to 64 hex chars to look like a real txid
  return hex.repeat(8)
}
