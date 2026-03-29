/**
 * Page-context script that defines window.CWI (BRC-100 wallet interface).
 *
 * This file is injected into the actual web page context (NOT the content
 * script isolated world). It must be fully self-contained -- no imports from
 * other extension modules are allowed because they are not accessible here.
 *
 * Communication with the content script happens via CustomEvents:
 *   page  --[CWI_REQUEST_EVENT]-->  content script
 *   page  <--[CWI_RESPONSE_EVENT]-- content script
 */

(function cwiPageScript() {
  // -----------------------------------------------------------------------
  // Constants (mirrored from messages.ts -- cannot import)
  // -----------------------------------------------------------------------

  const CWI_REQUEST_EVENT = 'x402-cwi-request';
  const CWI_RESPONSE_EVENT = 'x402-cwi-response';

  const CWI_READY_EVENT = 'x402-cwi-ready';

  const TIMEOUT_MS = 60_000;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function createRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return (
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2)
    );
  }

  // -----------------------------------------------------------------------
  // Core RPC helper
  // -----------------------------------------------------------------------

  interface CWIResponseDetail {
    id: string;
    status: 'ok' | 'error';
    result?: unknown;
    error?: string;
  }

  function callCWI(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = createRequestId();
      let settled = false;

      function cleanup() {
        document.removeEventListener(CWI_RESPONSE_EVENT, onResponse);
        clearTimeout(timer);
      }

      function settle() {
        if (settled) return false;
        settled = true;
        cleanup();
        return true;
      }

      function onResponse(evt: Event) {
        const detail = (evt as CustomEvent<CWIResponseDetail>).detail;
        if (!detail || detail.id !== id) return;

        if (!settle()) return;

        if (detail.status === 'ok') {
          resolve(detail.result);
        } else {
          reject(new Error(detail.error ?? 'Unknown CWI error'));
        }
      }

      document.addEventListener(CWI_RESPONSE_EVENT, onResponse);

      const timer = setTimeout(() => {
        if (!settle()) return;
        reject(new Error('CWI request timed out'));
      }, TIMEOUT_MS);

      document.dispatchEvent(
        new CustomEvent(CWI_REQUEST_EVENT, {
          detail: { id, method, params },
        }),
      );
    });
  }

  // -----------------------------------------------------------------------
  // CWI object (BRC-100 wallet interface)
  // -----------------------------------------------------------------------

  const cwi = {
    createAction(params: unknown) {
      return callCWI('createAction', params);
    },

    getPublicKey(params?: unknown) {
      return callCWI('getPublicKey', params);
    },

    createSignature(params: unknown) {
      return callCWI('createSignature', params);
    },

    verifySignature(params: unknown) {
      return callCWI('verifySignature', params);
    },

    encrypt(params: unknown) {
      return callCWI('encrypt', params);
    },

    decrypt(params: unknown) {
      return callCWI('decrypt', params);
    },

    isAuthenticated() {
      return callCWI('isAuthenticated');
    },

    getNetwork() {
      return callCWI('getNetwork');
    },
  };

  // -----------------------------------------------------------------------
  // Queue mechanism -- process any calls that arrived before injection
  //
  // Pages that load before the extension can push requests onto
  // window.__x402_cwi_queue (an array of {method, params, resolve, reject}).
  // We drain that queue now.
  // -----------------------------------------------------------------------

  interface QueuedCall {
    method: string;
    params?: unknown;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }

  const pendingQueue: QueuedCall[] =
    (window as unknown as Record<string, unknown>).__x402_cwi_queue as QueuedCall[] ?? [];

  if (pendingQueue.length > 0) {
    for (const queued of pendingQueue) {
      callCWI(queued.method, queued.params).then(queued.resolve, queued.reject);
    }
    // Clear the queue array so nothing processes it twice
    pendingQueue.length = 0;
  }

  // -----------------------------------------------------------------------
  // Install on window -- non-configurable, non-writable
  // -----------------------------------------------------------------------

  Object.defineProperty(window, 'CWI', {
    value: cwi,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  // -----------------------------------------------------------------------
  // Signal readiness
  // -----------------------------------------------------------------------

  document.dispatchEvent(new CustomEvent(CWI_READY_EVENT));
})();
