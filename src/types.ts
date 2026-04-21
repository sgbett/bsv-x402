// === Protocol types (existing) ===

export interface Challenge {
  nonce: string
  payee: string
  amount: number
  network: string
}

export interface Proof {
  txid: string
  beef: string  // base64-encoded AtomicBEEF
}

// === BRC-105 payment protocol ===

export interface Brc105Challenge {
  version: string
  satoshisRequired: number
  serverIdentityKey: string
  derivationPrefix: string
  /** Whether the identity key came from BRC-103 auth (vs standalone x-bsv-payment-identity-key). */
  authenticated: boolean
}

/** Minimal wallet interface for BRC-105 proof construction.
 *  Works with both CWIInterface (page context) and WalletInterface (SDK). */
export interface Brc105Wallet {
  getPublicKey(params:
    | { protocolID: [number, string]; keyID: string; counterparty: string }
    | { identityKey: true }
  ): Promise<{ publicKey: string }>
  createHmac(params: { data: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ hmac: number[] }>
  createAction(params: CWICreateActionParams): Promise<CWICreateActionResult>
  abortAction?: (args: { reference: string }) => Promise<{ aborted: boolean }>
}

export interface Brc105Proof {
  derivationPrefix: string
  derivationSuffix: string
  transaction: string  // base64-encoded AtomicBEEF
  clientIdentityKey: string  // client's compressed public key (hex)
  txid: string         // from wallet createAction result
}

export interface Brc105ProofResult {
  proof: Brc105Proof
  abort?: () => Promise<void>
  broadcast?: () => Promise<void>
}

export type Brc105ProofConstructor = (challenge: Brc105Challenge) => Promise<Brc105ProofResult>

// === BRC-121 Simple 402 types ===

/** BRC-121 challenge parsed from 402 response headers. */
export interface Brc121Challenge {
  satoshis: number
  serverIdentityKey: string
}

/** BRC-121 proof — maps to 5 individual HTTP headers. */
export interface Brc121Proof {
  beef: string               // base64-encoded BEEF (x-bsv-beef)
  senderIdentityKey: string  // client identity key hex (x-bsv-sender)
  nonce: string              // base64-encoded derivation prefix (x-bsv-nonce)
  time: string               // Unix ms timestamp decimal string (x-bsv-time)
  vout: string               // output index decimal string (x-bsv-vout)
  txid: string               // for abort tracking (not sent as header)
}

/** Result from BRC-121 proof construction, with optional abort. */
export interface Brc121ProofResult {
  proof: Brc121Proof
  abort?: () => Promise<void>
  broadcast?: () => Promise<void>
}

/** Custom BRC-121 proof constructor. */
export type Brc121ProofConstructor = (challenge: Brc121Challenge) => Promise<Brc121ProofResult>

// === PayGateway (BSV-pay / Coinbase v2) types ===

/** A single entry from the PayGateway `accepts` array. */
export interface PayGatewayAccept {
  scheme: string
  network: string
  /** Satoshi amount as a string (Coinbase v2 convention). */
  amount: string
  asset: string
  /** Locking script hex (not an address). */
  payTo: string
  maxTimeoutSeconds: number
  extra: {
    /** Pre-built partial transaction template (base64). Optional progressive enhancement. */
    partialTx?: string
    /** HMAC-SHA256 of payTo — tamper protection, echoed back untouched. */
    payToSig: string
    /** BRC-29 derivation prefix (base64), when wallet-derived. */
    derivationPrefix?: string
    /** BRC-29 derivation suffix (base64), when wallet-derived. */
    derivationSuffix?: string
  }
}

/** Parsed PayGateway challenge from the `Payment-Required` header. */
export interface PayGatewayChallenge {
  x402Version: number
  resource: { url: string }
  accepts: PayGatewayAccept[]
  /** The BSV entry selected from the accepts array. */
  selectedAccept: PayGatewayAccept
}

/** Payment proof sent back to the server in the `Payment-Signature` header. */
export interface PayGatewayProof {
  rawtx: string   // hex-encoded raw transaction
  txid: string
  beef?: string   // base64-encoded AtomicBEEF (optional)
}

/** Result from PayGateway proof construction, with abort/broadcast callbacks. */
export interface PayGatewayProofResult {
  proof: PayGatewayProof
  abort?: () => Promise<void>
  broadcast?: () => Promise<void>
}

/** Custom PayGateway proof constructor. */
export type PayGatewayProofConstructor = (challenge: PayGatewayChallenge) => Promise<PayGatewayProofResult>

// === Protocol-agnostic payment request ===

export type PaymentProtocol = 'x402' | 'brc105' | 'brc121' | 'paygateway'

export interface PaymentRequest {
  amount: number
  origin: string
  protocol: PaymentProtocol
}

// === Autospend model ===

export type TierName =
  | "I'm Too Young to Die"
  | "Hey, Not Too Rough"
  | "Hurt Me Plenty"
  | "Ultra-Violence"
  | "Nightmare!"

export type WeaponName =
  | "Fists"
  | "Chainsaw"
  | "Pistol"
  | "Shotgun"
  | "Super Shotgun"
  | "Chaingun"
  | "Rocket Launcher"
  | "Plasma Rifle"
  | "BFG9000"

export type PickupName = "Medkit" | "Stimpak" | "Soul Sphere" | "New Game"

export interface AutospendConfig {
  tier: TierName
  weapon: WeaponName
}

export interface AutospendState {
  balance: number
}

// === BEEF acknowledgement ===

/** Shape of each entry in the server's `pendingBeefs` response array. */
export interface PendingBeef {
  txid: string
  beef: string              // base64-encoded AtomicBEEF
  derivationPrefix: string
  derivationSuffix: string
  senderIdentityKey: string // server's identity key for paymentRemittance
  outputIndex: number
}

/** Narrow wallet interface for BEEF acknowledgement (subset of CWIInterface). */
export interface AckWallet {
  internalizeAction(params: {
    tx: number[]
    outputs: Array<{
      outputIndex: number
      protocol: 'wallet payment'
      paymentRemittance: {
        derivationPrefix: string
        derivationSuffix: string
        senderIdentityKey: string
      }
    }>
    description: string
    labels?: string[]
  }): Promise<{ accepted: boolean }>
}

// === Factory config ===

export interface X402Config {
  proofConstructor?: (challenge: Challenge) => Promise<Proof>
  brc105ProofConstructor?: Brc105ProofConstructor
  brc105Wallet?: Brc105Wallet
  /** Custom BRC-121 proof constructor. */
  brc121ProofConstructor?: Brc121ProofConstructor
  /** Wallet for BRC-121 payments (reuses Brc105Wallet interface). */
  brc121Wallet?: Brc105Wallet
  /** Custom PayGateway proof constructor. */
  payGatewayProofConstructor?: PayGatewayProofConstructor
  /** Wallet for PayGateway payments (reuses Brc105Wallet interface — only needs createAction + abortAction). */
  payGatewayWallet?: Brc105Wallet
  onProofError?: (error: unknown, protocol: PaymentProtocol) => void
  /** Maximum number of retries for network errors during BRC-105 payment (default: 2). */
  maxRetries?: number
  /** Wallet for internalising received BEEFs and enabling ack headers. */
  ackWallet?: AckWallet
  /** Server identity key for paymentRemittance.senderIdentityKey (fallback when not per-entry). */
  serverIdentityKey?: string
}

// === BRC-100 CWI interface types ===

export interface CWICreateActionOutput {
  satoshis: number
  lockingScript: string
  description?: string
  outputDescription?: string
  customInstructions?: string
}

export interface CWICreateActionParams {
  description: string
  outputs: CWICreateActionOutput[]
  labels?: string[]
  options?: {
    returnTXIDOnly?: boolean
    noSend?: boolean
    randomizeOutputs?: boolean
    sendWith?: string[]
  }
}

export interface CWICreateActionResult {
  txid: string
  rawTx?: string
  tx?: number[]
}

/**
 * Full BRC-100 CWI (Computing With Integrity) wallet interface.
 *
 * This must stay in sync with the BSV Browser implementation
 * (bsv-blockchain/bsv-browser) and the canonical BRC-100 spec
 * (bsv-blockchain/ts-sdk Wallet.interfaces.ts).
 *
 * All 28 methods are listed. See plugins/shared/cwi-conformance.test.ts
 * for the conformance test suite that validates interface parity.
 */
export interface CWIInterface {
  // Key management
  getPublicKey(params?: { identityKey?: boolean; protocolID?: [number, string]; keyID?: string; counterparty?: string; forSelf?: boolean }): Promise<{ publicKey: string }>
  revealCounterpartyKeyLinkage(params: { counterparty: string; verifier: string; protocolID: [number, string]; keyID: string }): Promise<{ encryptedLinkage: string; encryptedLinkageProof: string }>
  revealSpecificKeyLinkage(params: { counterparty: string; verifier: string; protocolID: [number, string]; keyID: string }): Promise<{ encryptedLinkage: string; encryptedLinkageProof: string }>

  // Cryptographic operations
  encrypt(params: { plaintext: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ ciphertext: number[] }>
  decrypt(params: { ciphertext: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ plaintext: number[] }>
  createHmac(params: { data: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ hmac: number[] }>
  verifyHmac(params: { data: number[]; hmac: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ valid: boolean }>
  createSignature(params: { data?: number[]; hashToDirectlySign?: number[]; protocolID: [number, string]; keyID: string; counterparty?: string }): Promise<{ signature: number[] }>
  verifySignature(params: { data: number[]; signature: number[]; protocolID: [number, string]; keyID: string; counterparty?: string; forSelf?: boolean }): Promise<{ valid: boolean }>

  // Transaction management
  createAction(params: CWICreateActionParams): Promise<CWICreateActionResult>
  signAction(params: { reference: string }): Promise<{ txid?: string; tx?: number[] }>
  abortAction(params: { reference: string }): Promise<{ aborted: boolean }>
  listActions(params: { labels: string[]; labelQueryMode?: 'any' | 'all'; includeLabels?: boolean; includeInputs?: boolean; includeOutputs?: boolean; limit?: number; offset?: number }): Promise<{ totalActions: number; actions: unknown[] }>
  internalizeAction(params: { tx: number[]; outputs: unknown[] }): Promise<{ accepted: boolean }>

  // Output management
  listOutputs(params: { basket: string; tags?: string[]; tagQueryMode?: 'any' | 'all'; include?: string; includeCustomInstructions?: boolean; includeTags?: boolean; includeLabels?: boolean; limit?: number; offset?: number }): Promise<{ totalOutputs: number; outputs: unknown[] }>
  relinquishOutput(params: { basket: string; output: string }): Promise<{ relinquished: boolean }>

  // Certificate management
  acquireCertificate(params: { type: string; certifier: string; acquisitionProtocol?: string; fields?: Record<string, string> }): Promise<{ type: string; subject: string; serialNumber: string; certifier: string; fields: Record<string, string>; signature: string }>
  listCertificates(params: { certifiers: string[]; types: string[]; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>
  proveCertificate(params: { certificate: unknown; fieldsToReveal: string[]; verifier: string }): Promise<{ keyForVerifier: string }>
  relinquishCertificate(params: { type: string; serialNumber: string; certifier: string }): Promise<{ relinquished: boolean }>

  // Certificate discovery
  discoverByIdentityKey(params: { identityKey: string; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>
  discoverByAttributes(params: { attributes: Record<string, string>; limit?: number; offset?: number }): Promise<{ totalCertificates: number; certificates: unknown[] }>

  // Authentication & status
  isAuthenticated(params?: object): Promise<{ authenticated: boolean }>
  waitForAuthentication(params?: object): Promise<{ authenticated: boolean }>

  // Blockchain information
  getHeight(params?: object): Promise<{ height: number }>
  getHeaderForHeight(params: { height: number }): Promise<{ header: string }>
  getNetwork(params?: object): Promise<{ network: 'mainnet' | 'testnet' }>
  getVersion(params?: object): Promise<{ version: string }>
}

