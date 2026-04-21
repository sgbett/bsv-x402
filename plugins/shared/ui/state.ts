/// <reference types="chrome" />

import type { TierName, WeaponName } from "../../../src/types";

// ---------------------------------------------------------------------------
// PopupState — all state the popup needs from the service worker
// ---------------------------------------------------------------------------

export interface PopupState {
  // Wallet concerns
  isSetUp: boolean;
  isUnlocked: boolean;
  network: string;
  balance?: number;
  // Autospend concerns
  tier: TierName;
  weapon: WeaponName;
  autospendBalance: number;
  tierCap: number;
  weaponCap: number;
}

/** Default state returned when the service worker is unreachable. */
const DEFAULT_STATE: PopupState = {
  isSetUp: false,
  isUnlocked: false,
  network: "mainnet",
  tier: "Hurt Me Plenty",
  weapon: "Shotgun",
  autospendBalance: 0,
  tierCap: 100_000_000,
  weaponCap: 1_000_000,
};

// ---------------------------------------------------------------------------
// Message helper — typed wrapper around chrome.runtime.sendMessage
// ---------------------------------------------------------------------------

/**
 * Send a message to the background service worker and return the typed
 * response. Rejects on `chrome.runtime.lastError` or if the response
 * has `status: 'error'`.
 */
export function sendMessage<T = PopupState>(
  type: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const msg: Record<string, unknown> = { type };
  if (payload !== undefined) msg.payload = payload;

  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.status === "error") {
        reject(new Error(response.error ?? "Unknown error"));
        return;
      }
      resolve(response as T);
    });
  });
}

// ---------------------------------------------------------------------------
// State fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the full popup state from the service worker via `getState`.
 * Returns a sensible default on failure (e.g. service worker cold start).
 */
export async function fetchState(): Promise<PopupState> {
  try {
    return await sendMessage<PopupState>("getState");
  } catch (err) {
    console.warn('[x402] fetchState failed, using defaults:', err)
    return { ...DEFAULT_STATE };
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Poll `fetchState()` on an interval and invoke `callback` with the
 * latest state. Returns a cleanup function that stops the polling.
 *
 * @param callback - called with new state on each successful poll
 * @param intervalMs - polling interval in milliseconds (default 10 000)
 */
export function startPolling(
  callback: (state: PopupState) => void,
  intervalMs = 10_000,
): () => void {
  const id = setInterval(async () => {
    try {
      const state = await sendMessage<PopupState>("getState");
      callback(state);
    } catch (err) {
      console.warn('[x402] State poll failed:', err)
    }
  }, intervalMs);

  return () => clearInterval(id);
}

// ---------------------------------------------------------------------------
// Clipboard utility
// ---------------------------------------------------------------------------

/**
 * Copy text to the clipboard, falling back to `document.execCommand`
 * for older browsers that lack `navigator.clipboard`. Briefly changes
 * the button label to "Copied!" as visual feedback.
 */
export async function copyToClipboard(
  text: string,
  btn: HTMLElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}
