/**
 * Message types for communication between page script, content script,
 * and background service worker in the BSV x402 browser extension.
 */

// ---------------------------------------------------------------------------
// CWI method names (BRC-100 wallet interface)
// ---------------------------------------------------------------------------

export type CWIMethodName =
  // Key management
  | 'getPublicKey'
  | 'revealCounterpartyKeyLinkage'
  | 'revealSpecificKeyLinkage'
  // Cryptographic operations
  | 'encrypt'
  | 'decrypt'
  | 'createHmac'
  | 'verifyHmac'
  | 'createSignature'
  | 'verifySignature'
  // Transaction management
  | 'createAction'
  | 'signAction'
  | 'abortAction'
  | 'listActions'
  | 'internalizeAction'
  // Output management
  | 'listOutputs'
  | 'relinquishOutput'
  // Certificate management
  | 'acquireCertificate'
  | 'listCertificates'
  | 'proveCertificate'
  | 'relinquishCertificate'
  // Certificate discovery
  | 'discoverByIdentityKey'
  | 'discoverByAttributes'
  // Authentication & status
  | 'isAuthenticated'
  | 'waitForAuthentication'
  // Blockchain information
  | 'getHeight'
  | 'getHeaderForHeight'
  | 'getNetwork'
  | 'getVersion';

// ---------------------------------------------------------------------------
// Page <-> Content script messages (via CustomEvent)
// ---------------------------------------------------------------------------

export interface CWIRequest {
  id: string;
  method: CWIMethodName;
  params: unknown;
}

export interface CWIResponse {
  id: string;
  status: 'ok' | 'error';
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Content script <-> Background service worker messages
// ---------------------------------------------------------------------------

export interface ContentToBackgroundMessage {
  request: CWIRequest;
  origin: string;
}

export type BackgroundToContentMessage = CWIResponse;

// ---------------------------------------------------------------------------
// Custom event names
// ---------------------------------------------------------------------------

export const CWI_REQUEST_EVENT = 'x402-cwi-request' as const;
export const CWI_RESPONSE_EVENT = 'x402-cwi-response' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}
