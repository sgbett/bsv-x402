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

// === Protocol-agnostic payment request ===

export type PaymentProtocol = 'x402' | 'brc105'

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

// === Factory config ===

export interface X402Config {
  proofConstructor?: (challenge: Challenge) => Promise<Proof>
  brc105ProofConstructor?: Brc105ProofConstructor
  brc105Wallet?: Brc105Wallet
  onProofError?: (error: unknown, protocol: PaymentProtocol) => void
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

