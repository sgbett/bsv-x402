/**
 * BRC-100 CWI method dispatch.
 *
 * This is the core logic that handles each wallet method call arriving from
 * web pages via the content-script / background-worker message pipeline.
 * Individual method handlers are stubbed where they depend on @bsv/sdk
 * primitives that aren't wired up yet.
 */

import type { ContentToBackgroundMessage, CWIMethodName, CWIResponse } from './messages';

// ---------------------------------------------------------------------------
// Context supplied by the background service worker
// ---------------------------------------------------------------------------

export interface CWIHandlerContext {
  getSeed: () => string;
  isUnlocked: () => boolean;
  getNetwork: () => string; // 'main' or 'test'
}

// ---------------------------------------------------------------------------
// Param validation helper
// ---------------------------------------------------------------------------

function validateParams<T>(params: unknown, required: string[]): T {
  if (params == null || typeof params !== 'object') {
    throw new Error('params must be a non-null object');
  }
  for (const key of required) {
    if (!(key in (params as Record<string, unknown>))) {
      throw new Error(`Missing required parameter: ${key}`);
    }
  }
  return params as T;
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function handleCreateAction(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  const validated = validateParams<{ outputs: unknown[] }>(params, ['outputs']);

  if (!Array.isArray(validated.outputs)) {
    throw new Error('outputs must be an array');
  }

  for (const [i, output] of validated.outputs.entries()) {
    if (output == null || typeof output !== 'object') {
      throw new Error(`outputs[${i}] must be an object`);
    }
    const o = output as Record<string, unknown>;
    if (typeof o.satoshis !== 'number' || !Number.isFinite(o.satoshis) || !Number.isInteger(o.satoshis) || o.satoshis <= 0) {
      throw new Error(`outputs[${i}].satoshis must be a positive integer`);
    }
    if (typeof o.lockingScript !== 'string' || o.lockingScript.length === 0) {
      throw new Error(`outputs[${i}].lockingScript must be a non-empty string`);
    }
  }

  // TODO: Wire to tx-builder once @bsv/sdk is integrated.
  // Will call fetchUTXOs, buildTransaction, broadcastTransaction from tx-builder
  return { txid: 'TODO', rawTx: '' };
}

// --- Key management ---

async function handleGetPublicKey(
  _params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  // TODO: Derive from seed via key-manager using protocolID/keyID
  return { publicKey: 'TODO' };
}

async function handleRevealCounterpartyKeyLinkage(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['counterparty', 'verifier']);
  // TODO: Implement with @bsv/sdk
  return { encryptedLinkage: 'TODO', encryptedLinkageProof: 'TODO' };
}

async function handleRevealSpecificKeyLinkage(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['counterparty', 'verifier', 'protocolID', 'keyID']);
  // TODO: Implement with @bsv/sdk
  return { encryptedLinkage: 'TODO', encryptedLinkageProof: 'TODO' };
}

// --- Cryptographic operations ---

async function handleEncrypt(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['plaintext', 'protocolID', 'keyID']);
  // TODO: Implement encryption with @bsv/sdk
  return { ciphertext: [] as number[] };
}

async function handleDecrypt(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['ciphertext', 'protocolID', 'keyID']);
  // TODO: Implement decryption with @bsv/sdk
  return { plaintext: [] as number[] };
}

async function handleCreateHmac(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['data', 'protocolID', 'keyID']);
  // TODO: Implement HMAC with @bsv/sdk
  return { hmac: [] as number[] };
}

async function handleVerifyHmac(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['data', 'hmac', 'protocolID', 'keyID']);
  // TODO: Implement HMAC verification with @bsv/sdk
  return { valid: false };
}

async function handleCreateSignature(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['protocolID', 'keyID']);
  // Requires either data or hashToDirectlySign
  const p = params as Record<string, unknown>;
  if (!p.data && !p.hashToDirectlySign) {
    throw new Error('Either data or hashToDirectlySign is required');
  }
  // TODO: Sign using private key derived from seed via key-manager
  return { signature: 'TODO' };
}

async function handleVerifySignature(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['data', 'signature', 'protocolID', 'keyID']);
  // TODO: Implement signature verification with @bsv/sdk
  return { valid: false };
}

// --- Transaction management ---

async function handleSignAction(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['reference']);
  // TODO: Implement with @bsv/sdk
  return { txid: 'TODO', tx: '' };
}

async function handleAbortAction(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['reference']);
  // TODO: Implement with @bsv/sdk
  return { aborted: true };
}

async function handleListActions(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['labels']);
  // TODO: Implement with @bsv/sdk
  return { totalActions: 0, actions: [] };
}

async function handleInternalizeAction(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['tx', 'outputs']);
  // TODO: Implement with @bsv/sdk
  return { accepted: true };
}

// --- Output management ---

async function handleListOutputs(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['basket']);
  // TODO: Implement with @bsv/sdk
  return { totalOutputs: 0, outputs: [] };
}

async function handleRelinquishOutput(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['basket', 'output']);
  // TODO: Implement with @bsv/sdk
  return { relinquished: true };
}

// --- Certificate management ---

async function handleAcquireCertificate(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['type', 'certifier']);
  // TODO: Implement with @bsv/sdk
  return { type: 'TODO', subject: 'TODO', serialNumber: 'TODO', certifier: 'TODO', fields: {}, signature: 'TODO' };
}

async function handleListCertificates(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['certifiers', 'types']);
  // TODO: Implement with @bsv/sdk
  return { totalCertificates: 0, certificates: [] };
}

async function handleProveCertificate(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['certificate', 'fieldsToReveal', 'verifier']);
  // TODO: Implement with @bsv/sdk
  return { keyForVerifier: 'TODO' };
}

async function handleRelinquishCertificate(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['type', 'serialNumber', 'certifier']);
  // TODO: Implement with @bsv/sdk
  return { relinquished: true };
}

// --- Certificate discovery ---

async function handleDiscoverByIdentityKey(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['identityKey']);
  // TODO: Implement with @bsv/sdk
  return { totalCertificates: 0, certificates: [] };
}

async function handleDiscoverByAttributes(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['attributes']);
  // TODO: Implement with @bsv/sdk
  return { totalCertificates: 0, certificates: [] };
}

// --- Authentication & status ---

async function handleIsAuthenticated(
  context: CWIHandlerContext,
): Promise<unknown> {
  return { authenticated: context.isUnlocked() };
}

async function handleWaitForAuthentication(
  context: CWIHandlerContext,
): Promise<unknown> {
  // TODO: Implement blocking wait (poll/event) for unlock
  return { authenticated: context.isUnlocked() };
}

// --- Blockchain information ---

async function handleGetHeight(
  _context: CWIHandlerContext,
): Promise<unknown> {
  // TODO: Query current block height from network
  return { height: 0 };
}

async function handleGetHeaderForHeight(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams(params, ['height']);
  // TODO: Query block header from network
  return { header: 'TODO' };
}

async function handleGetNetwork(
  context: CWIHandlerContext,
): Promise<unknown> {
  return { network: context.getNetwork() === 'main' ? 'mainnet' : 'testnet' };
}

async function handleGetVersion(
  _context: CWIHandlerContext,
): Promise<unknown> {
  return { version: 'bsv-x402 0.1.0' };
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type MethodHandler = (params: unknown, context: CWIHandlerContext) => Promise<unknown>;
type ContextOnlyHandler = (context: CWIHandlerContext) => Promise<unknown>;

const methodHandlers: Record<CWIMethodName, MethodHandler | ContextOnlyHandler> = {
  // Key management
  getPublicKey: handleGetPublicKey,
  revealCounterpartyKeyLinkage: handleRevealCounterpartyKeyLinkage,
  revealSpecificKeyLinkage: handleRevealSpecificKeyLinkage,
  // Cryptographic operations
  encrypt: handleEncrypt,
  decrypt: handleDecrypt,
  createHmac: handleCreateHmac,
  verifyHmac: handleVerifyHmac,
  createSignature: handleCreateSignature,
  verifySignature: handleVerifySignature,
  // Transaction management
  createAction: handleCreateAction,
  signAction: handleSignAction,
  abortAction: handleAbortAction,
  listActions: handleListActions,
  internalizeAction: handleInternalizeAction,
  // Output management
  listOutputs: handleListOutputs,
  relinquishOutput: handleRelinquishOutput,
  // Certificate management
  acquireCertificate: handleAcquireCertificate,
  listCertificates: handleListCertificates,
  proveCertificate: handleProveCertificate,
  relinquishCertificate: handleRelinquishCertificate,
  // Certificate discovery
  discoverByIdentityKey: handleDiscoverByIdentityKey,
  discoverByAttributes: handleDiscoverByAttributes,
  // Authentication & status
  isAuthenticated: handleIsAuthenticated as ContextOnlyHandler,
  waitForAuthentication: handleWaitForAuthentication as ContextOnlyHandler,
  // Blockchain information
  getHeight: handleGetHeight as ContextOnlyHandler,
  getHeaderForHeight: handleGetHeaderForHeight,
  getNetwork: handleGetNetwork as ContextOnlyHandler,
  getVersion: handleGetVersion as ContextOnlyHandler,
};

// Methods that only need the context (no params from the caller)
const contextOnlyMethods: Set<CWIMethodName> = new Set([
  'isAuthenticated',
  'waitForAuthentication',
  'getHeight',
  'getNetwork',
  'getVersion',
]);

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleCWIRequest(
  message: ContentToBackgroundMessage,
  context: CWIHandlerContext,
): Promise<CWIResponse> {
  const { request, origin: _origin } = message;

  // Methods that work even when the wallet is locked
  const allowedWhileLocked: Set<CWIMethodName> = new Set([
    'isAuthenticated', 'waitForAuthentication', 'getVersion', 'getNetwork',
  ]);

  try {
    if (!context.isUnlocked() && !allowedWhileLocked.has(request.method)) {
      return { id: request.id, status: 'error', error: 'Wallet is locked' };
    }

    const handler = methodHandlers[request.method];
    if (!handler) {
      return {
        id: request.id,
        status: 'error',
        error: `Unknown method: ${request.method}`,
      };
    }

    let result: unknown;
    if (contextOnlyMethods.has(request.method)) {
      result = await (handler as ContextOnlyHandler)(context);
    } else {
      result = await (handler as MethodHandler)(request.params, context);
    }

    return { id: request.id, status: 'ok', result };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { id: request.id, status: 'error', error: errorMessage };
  }
}
