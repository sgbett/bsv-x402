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
    if (typeof o.satoshis !== 'number') {
      throw new Error(`outputs[${i}].satoshis must be a number`);
    }
    if (typeof o.lockingScript !== 'string') {
      throw new Error(`outputs[${i}].lockingScript must be a string`);
    }
  }

  // TODO: Wire to tx-builder once @bsv/sdk is integrated.
  // Will call fetchUTXOs, buildTransaction, broadcastTransaction from tx-builder
  return { txid: 'TODO', rawTx: '' };
}

async function handleGetPublicKey(
  _params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  // TODO: Derive from seed via key-manager
  return { publicKey: 'TODO' };
}

async function handleCreateSignature(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams<{ data: string }>(params, ['data']);

  // TODO: Sign using private key derived from seed via key-manager
  return { signature: 'TODO' };
}

async function handleVerifySignature(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams<{ data: string; signature: string; publicKey: string }>(params, [
    'data',
    'signature',
    'publicKey',
  ]);

  // TODO: Implement signature verification with @bsv/sdk
  return { valid: false };
}

async function handleEncrypt(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams<{ plaintext: string }>(params, ['plaintext']);

  // TODO: Implement encryption with @bsv/sdk
  return { ciphertext: 'TODO' };
}

async function handleDecrypt(
  params: unknown,
  _context: CWIHandlerContext,
): Promise<unknown> {
  validateParams<{ ciphertext: string }>(params, ['ciphertext']);

  // TODO: Implement decryption with @bsv/sdk
  return { plaintext: 'TODO' };
}

async function handleIsAuthenticated(
  context: CWIHandlerContext,
): Promise<unknown> {
  return context.isUnlocked();
}

async function handleGetNetwork(
  context: CWIHandlerContext,
): Promise<unknown> {
  return { network: context.getNetwork() };
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type MethodHandler = (params: unknown, context: CWIHandlerContext) => Promise<unknown>;
type ContextOnlyHandler = (context: CWIHandlerContext) => Promise<unknown>;

const methodHandlers: Record<CWIMethodName, MethodHandler | ContextOnlyHandler> = {
  createAction: handleCreateAction,
  getPublicKey: handleGetPublicKey,
  createSignature: handleCreateSignature,
  verifySignature: handleVerifySignature,
  encrypt: handleEncrypt,
  decrypt: handleDecrypt,
  isAuthenticated: handleIsAuthenticated as ContextOnlyHandler,
  getNetwork: handleGetNetwork as ContextOnlyHandler,
};

// Methods that only need the context (no params)
const contextOnlyMethods: Set<CWIMethodName> = new Set([
  'isAuthenticated',
  'getNetwork',
]);

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleCWIRequest(
  message: ContentToBackgroundMessage,
  context: CWIHandlerContext,
): Promise<CWIResponse> {
  const { request, origin: _origin } = message;

  try {
    if (!context.isUnlocked()) {
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
