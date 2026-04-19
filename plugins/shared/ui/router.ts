/// <reference types="chrome" />

import type { PopupState } from "./state";
import { sendMessage } from "./state";

// ---------------------------------------------------------------------------
// Page interface — each page module implements this
// ---------------------------------------------------------------------------

export interface Page {
  render(container: HTMLElement, state: PopupState): void;
}

// ---------------------------------------------------------------------------
// Valid page names
// ---------------------------------------------------------------------------

const VALID_PAGES = ["home", "payments", "transactions", "settings"] as const;
export type PageName = (typeof VALID_PAGES)[number];

function isValidPage(page: string): page is PageName {
  return (VALID_PAGES as readonly string[]).includes(page);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const pages: Partial<Record<PageName, Page>> = {};

/** Register page modules the router can navigate to. */
export function registerPages(entries: Partial<Record<PageName, Page>>): void {
  Object.assign(pages, entries);
}

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

/**
 * Render the lock/unlock form. When the wallet is locked the router shows
 * this instead of any page content. On successful unlock the supplied
 * `onUnlock` callback re-renders the active page.
 */
function renderLockScreen(
  container: HTMLElement,
  state: PopupState,
  onUnlock: (state: PopupState) => void,
): void {
  // If the wallet has not been set up yet, show the setup prompt
  if (!state.isSetUp) {
    container.innerHTML = `
      <div class="lock-screen">
        <p class="lock-title">Wallet not set up</p>
        <button class="btn setup-btn" id="lock-setup-btn">Set Up Wallet</button>
      </div>
    `;
    const setupBtn = container.querySelector("#lock-setup-btn") as HTMLButtonElement;
    setupBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("ui/wallet/setup.html") });
    });
    return;
  }

  container.innerHTML = `
    <div class="lock-screen">
      <p class="lock-title">Wallet is locked</p>
      <div class="lock-form">
        <input
          type="password"
          id="lock-password"
          class="input"
          placeholder="Password"
          autocomplete="current-password"
        />
        <div id="lock-error" class="lock-error"></div>
        <button class="btn unlock-btn" id="lock-unlock-btn">Unlock</button>
      </div>
    </div>
  `;

  const passwordInput = container.querySelector("#lock-password") as HTMLInputElement;
  const unlockBtn = container.querySelector("#lock-unlock-btn") as HTMLButtonElement;
  const errorEl = container.querySelector("#lock-error") as HTMLDivElement;

  passwordInput.focus();

  async function attemptUnlock(): Promise<void> {
    const password = passwordInput.value;
    if (!password) {
      passwordInput.focus();
      return;
    }

    unlockBtn.disabled = true;
    errorEl.textContent = "";

    try {
      const newState = await sendMessage<PopupState>("unlock", { password });
      passwordInput.value = "";
      onUnlock(newState);
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      unlockBtn.disabled = false;
    }
  }

  unlockBtn.addEventListener("click", attemptUnlock);
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptUnlock();
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** The container element that pages render into — set by `initRouter`. */
let pageContainer: HTMLElement | null = null;

/** Callback invoked after navigation so the header can update. */
let onNavigated: ((page: PageName) => void) | null = null;

/**
 * Read the current page from `location.hash`, defaulting to `home`
 * for empty or invalid hashes.
 */
export function getCurrentPage(): PageName {
  const raw = location.hash.replace(/^#/, "");
  return isValidPage(raw) ? raw : "home";
}

/**
 * Navigate to a page. Sets `location.hash` and renders the page into the
 * container. If the wallet is locked the lock screen is shown instead,
 * preserving the hash so that unlocking returns to the intended page.
 */
export function navigate(page: string, container: HTMLElement, state: PopupState): void {
  const target = isValidPage(page) ? page : "home";

  // Update hash without triggering our own hashchange listener
  if (location.hash !== `#${target}`) {
    location.hash = target;
  }

  // Lock screen intercept
  if (!state.isUnlocked) {
    renderLockScreen(container, state, (newState) => {
      // Re-navigate after unlock — the page will now render
      navigate(getCurrentPage(), container, newState);
    });
    onNavigated?.(target);
    return;
  }

  // Render the requested page (or nothing if not yet registered)
  const pageModule = pages[target];
  if (pageModule) {
    pageModule.render(container, state);
  } else {
    container.innerHTML = `<p class="placeholder">Coming soon</p>`;
  }

  onNavigated?.(target);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

export interface RouterOptions {
  /** The element that page content renders into. */
  container: HTMLElement;
  /** Called after each navigation with the new active page name. */
  onNavigated?: (page: PageName) => void;
}

/**
 * Initialise the router. Listens for `hashchange` events and re-renders
 * when the hash changes. Call `navigate()` after this to render the
 * initial page.
 */
export function initRouter(opts: RouterOptions): void {
  pageContainer = opts.container;
  onNavigated = opts.onNavigated ?? null;

  window.addEventListener("hashchange", () => {
    if (!pageContainer) return;
    // State is not available synchronously here — fetch it and re-render.
    // The caller should set up polling; this handler covers manual hash
    // changes (e.g. user editing the URL bar or back/forward navigation).
    import("./state").then(({ fetchState }) => {
      fetchState().then((state) => {
        navigate(getCurrentPage(), pageContainer!, state);
      });
    });
  });
}
