/// <reference types="chrome" />

import {
  CWI_REQUEST_EVENT,
  CWI_RESPONSE_EVENT,
  CWIRequest,
  CWIResponse,
  ContentToBackgroundMessage,
} from './messages';

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

  chrome.runtime.sendMessage(message, (response: CWIResponse | undefined) => {
    // Handle connection errors (e.g., background not ready).
    if (chrome.runtime.lastError || !response) {
      const errorResponse: CWIResponse = {
        id: request.id,
        status: 'error',
        error: chrome.runtime.lastError?.message ?? 'No response from background',
      };
      document.dispatchEvent(
        new CustomEvent(CWI_RESPONSE_EVENT, { detail: errorResponse }),
      );
      return;
    }

    document.dispatchEvent(
      new CustomEvent(CWI_RESPONSE_EVENT, { detail: response }),
    );
  });
});
