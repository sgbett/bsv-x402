/// <reference types="chrome" />

import { fetchState, startPolling } from "./state";
import type { PopupState } from "./state";
import { initRouter, registerPages, navigate, getCurrentPage } from "./router";
import { renderHeader, updateHeader } from "./components/header";
import * as home from "./pages/home";

// Build-time constants injected by tsup --define
declare const __X402_VERSION__: string;
declare const __X402_GIT_REF__: string;

// ---------------------------------------------------------------------------
// Placeholder page for tabs not yet implemented
// ---------------------------------------------------------------------------

const placeholder = {
  render(container: HTMLElement, _state: PopupState): void {
    container.innerHTML = `<p class="placeholder">Coming soon</p>`;
  },
};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  const loadingEl = document.getElementById("loading")!;
  const appEl = document.getElementById("app")!;
  const headerEl = document.getElementById("header")!;
  const pageContainer = document.getElementById("page-container")!;

  // Register page modules — only Home is implemented; others are placeholders
  registerPages({
    home,
    payments: placeholder,
    transactions: placeholder,
    settings: placeholder,
  });

  // Fetch state from service worker (spinner stays visible until this resolves)
  let state = await fetchState();

  // Swap spinner for app content
  loadingEl.hidden = true;
  appEl.hidden = false;

  // Render header with tab navigation
  const currentPage = getCurrentPage();
  renderHeader(headerEl, state, currentPage, (page) => {
    navigate(page, pageContainer, state);
    updateHeader(headerEl, state, getCurrentPage());
  });

  // Initialise router (listens for hashchange)
  initRouter({
    container: pageContainer,
    onNavigated: (page) => updateHeader(headerEl, state, page),
  });

  // Navigate to the current hash (or default to home)
  navigate(currentPage, pageContainer, state);

  // Display version + git ref in footer
  const versionEl = document.getElementById("version-info");
  if (versionEl) {
    versionEl.textContent = `v${__X402_VERSION__} (${__X402_GIT_REF__})`;
  }

  // Poll state to keep the UI fresh
  startPolling((newState) => {
    state = newState;
    // Re-render the active page with updated state
    navigate(getCurrentPage(), pageContainer, state);
    updateHeader(headerEl, state, getCurrentPage());
  });

  // Listen for state changes from header lock/unlock button
  window.addEventListener("x402-state-changed", ((e: CustomEvent<PopupState>) => {
    state = e.detail;
    renderHeader(headerEl, state, getCurrentPage(), (page) => {
      navigate(page, pageContainer, state);
      updateHeader(headerEl, state, getCurrentPage());
    });
    navigate(getCurrentPage(), pageContainer, state);
  }) as EventListener);

  // Listen for balance updates from background (e.g. after UTXO import)
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "balanceUpdated") {
      fetchState().then((newState) => {
        state = newState;
        navigate(getCurrentPage(), pageContainer, state);
        updateHeader(headerEl, state, getCurrentPage());
      }).catch(() => {});
    }
  });
});
