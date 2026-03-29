export interface Challenge {
  nonce: string
  payee: string
  amount: number
  network: string
}

export interface Proof {
  txid: string
  rawTx: string
}
