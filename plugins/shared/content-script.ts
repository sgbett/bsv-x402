/// <reference types="chrome" />

import {
  CWI_REQUEST_EVENT,
  CWI_RESPONSE_EVENT,
  CWIRequest,
  CWIResponse,
  ContentToBackgroundMessage,
} from './messages';
import { SpendIndicator, type SpendStatus, type IndicatorMode } from './spend-indicator';

// ---------------------------------------------------------------------------
// Firefox Xray compatibility
//
// In Firefox, objects created in the content script's compartment are not
// directly accessible to page scripts — reading a property raises
// "Permission denied to access property". To expose an object via
// CustomEvent.detail, we must clone it into the page's compartment using
// the Firefox-only global `cloneInto`. On Chrome/Safari, `cloneInto` is
// undefined and objects cross the content/page boundary freely, so we pass
// the detail through as-is.
// ---------------------------------------------------------------------------

declare const cloneInto: (<T>(obj: T, targetScope: unknown) => T) | undefined;

function dispatchToPage(eventName: string, detail: unknown): void {
  const payload =
    typeof cloneInto === 'function' ? cloneInto(detail, window) : detail;
  document.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
}

// ---------------------------------------------------------------------------
// 1. Inject the page script into the page context (runs at document_start)
// ---------------------------------------------------------------------------

const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-script.js');
script.addEventListener('load', () => script.remove());
document.documentElement.prepend(script);

// ---------------------------------------------------------------------------
// 2. Relay CWI requests from the page to the background service worker
// ---------------------------------------------------------------------------

document.addEventListener(CWI_REQUEST_EVENT, (evt: Event) => {
  const detail = (evt as CustomEvent).detail;

  // Validate the request shape before relaying.
  if (
    !detail ||
    typeof detail.id !== 'string' ||
    typeof detail.method !== 'string'
  ) {
    return; // Ignore malformed events silently.
  }

  const request: CWIRequest = {
    id: detail.id,
    method: detail.method,
    params: detail.params,
  };

  // Always derive origin from the actual page location, never from the event.
  const message: ContentToBackgroundMessage = {
    request,
    origin: window.location.origin,
  };

  try {
    chrome.runtime.sendMessage(message, (response: CWIResponse | undefined) => {
      // Handle connection errors (e.g., background not ready).
      if (chrome.runtime.lastError || !response) {
        const errorResponse: CWIResponse = {
          id: request.id,
          status: 'error',
          error: chrome.runtime.lastError?.message ?? 'No response from background',
        };
        dispatchToPage(CWI_RESPONSE_EVENT, errorResponse);
        return;
      }

      dispatchToPage(CWI_RESPONSE_EVENT, response);
    });
  } catch {
    const errorResponse: CWIResponse = {
      id: request.id,
      status: 'error',
      error: 'Extension context invalidated',
    };
    dispatchToPage(CWI_RESPONSE_EVENT, errorResponse);
  }
});

// ---------------------------------------------------------------------------
// 3. Spend indicator — shows x402 budget usage on the page
// ---------------------------------------------------------------------------

const indicator = new SpendIndicator();

function fetchAndUpdateIndicator(): void {
  try {
    chrome.runtime.sendMessage({ type: 'getSpendStatus' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      indicator.update(response as SpendStatus);
    });
  } catch {
    // Extension context invalidated (e.g. service worker restarted).
    // Stop polling — the new content script will take over after page reload.
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    indicator.unmount();
  }
}

// Mount indicator once DOM is ready; only poll when visible
let pollTimer: ReturnType<typeof setInterval> | null = null;

function mountIndicator(): void {
  chrome.storage.local.get('x402_indicator_mode', (result) => {
    const mode = (result.x402_indicator_mode as IndicatorMode) ?? 'bar';
    indicator.mount(mode);
    if (mode !== 'hidden') {
      fetchAndUpdateIndicator();
      pollTimer = setInterval(fetchAndUpdateIndicator, 3000);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountIndicator);
} else {
  mountIndicator();
}

// Listen for push updates from background after payments
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'spendUpdated') {
    indicator.update(message.status as SpendStatus);
  }
});
