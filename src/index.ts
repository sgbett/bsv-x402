// Core fetch
export { createX402Fetch, x402Fetch } from "./x402-fetch"
export type { X402FetchFn } from "./x402-fetch"

// Challenge parsing
export { parseChallenge } from "./challenge"
export { parseBrc105Challenge } from "./brc105-challenge"
export { constructBrc105Proof } from "./brc105-proof"
export { parseBrc121Challenge } from "./brc121-challenge"
export { constructBrc121Proof } from "./brc121-proof"

// Autospend (tier + weapon + health bar)
export {
  TIER_CAPS,
  WEAPON_CAPS,
  PICKUP_PERCENTAGES,
  checkPayment,
  recordPayment,
  applyPickup,
  clampBalanceToTier,
  initialState,
} from "./autospend"
export type { PaymentDecision } from "./autospend"

// Types
export type {
  AckWallet,
  AutospendConfig,
  AutospendState,
  Brc105Challenge,
  Brc105Proof,
  Brc105ProofConstructor,
  Brc105Wallet,
  Brc121Challenge,
  Brc121Proof,
  Brc121ProofConstructor,
  Brc121ProofResult,
  Challenge,
  CWICreateActionOutput,
  CWICreateActionParams,
  CWICreateActionResult,
  PayGatewayAccept,
  PayGatewayChallenge,
  PayGatewayProof,
  PayGatewayProofConstructor,
  PayGatewayProofResult,
  PaymentProtocol,
  PaymentRequest,
  PendingBeef,
  PickupName,
  Proof,
  TierName,
  WeaponName,
  X402Config,
} from "./types"
