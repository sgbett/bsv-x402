/// <reference types="chrome" />

import type { PopupState } from "../state";
import { sendMessage } from "../state";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: "home", label: "Home" },
  { id: "payments", label: "Payments" },
  { id: "transactions", label: "Txns" },
  { id: "settings", label: "Settings" },
] as const;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render the header bar with tab navigation and lock/unlock button.
 *
 * @param container - element to render the header into
 * @param state - current popup state
 * @param activePage - the currently active page id
 * @param onNavigate - called when a tab is clicked with the page id
 */
export function renderHeader(
  container: HTMLElement,
  state: PopupState,
  activePage: string,
  onNavigate: (page: string) => void,
): void {
  container.innerHTML = "";

  const nav = document.createElement("nav");
  nav.className = "header-nav";

  // Tab buttons
  const tabBar = document.createElement("div");
  tabBar.className = "header-tabs";

  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.className = `header-tab${tab.id === activePage ? " active" : ""}`;
    btn.dataset.page = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener("click", () => onNavigate(tab.id));
    tabBar.appendChild(btn);
  }

  // Lock/unlock button
  const lockBtn = document.createElement("button");
  lockBtn.id = "header-lock-btn";
  lockBtn.className = `header-lock-btn ${state.isUnlocked ? "unlocked" : "locked"}`;
  lockBtn.textContent = state.isUnlocked ? "Lock" : "Unlock";
  lockBtn.title = state.isUnlocked ? "Lock wallet" : "Unlock wallet";

  lockBtn.addEventListener("click", async () => {
    if (state.isUnlocked) {
      try {
        const newState = await sendMessage<PopupState>("lock");
        // Trigger a re-render by dispatching a custom event the shell
        // can listen for, or let the caller handle via onNavigate.
        // For simplicity, fire a custom event the shell listens to.
        window.dispatchEvent(
          new CustomEvent("x402-state-changed", { detail: newState }),
        );
      } catch (err) {
        console.error("Lock failed:", err);
      }
    } else {
      // When locked, clicking navigates to current page which triggers
      // the lock screen via the router.
      window.dispatchEvent(
        new CustomEvent("x402-state-changed", { detail: state }),
      );
    }
  });

  nav.appendChild(tabBar);
  nav.appendChild(lockBtn);
  container.appendChild(nav);
}

// ---------------------------------------------------------------------------
// Update (partial — avoids full re-render)
// ---------------------------------------------------------------------------

/**
 * Update the header's active tab and lock button state without a full
 * re-render. Call this after navigation or state changes.
 */
export function updateHeader(
  container: HTMLElement,
  state: PopupState,
  activePage: string,
): void {
  // Update active tab
  const tabs = container.querySelectorAll<HTMLButtonElement>(".header-tab");
  for (const tab of tabs) {
    if (tab.dataset.page === activePage) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  }

  // Update lock button
  const lockBtn = container.querySelector("#header-lock-btn") as HTMLButtonElement | null;
  if (lockBtn) {
    lockBtn.className = `header-lock-btn ${state.isUnlocked ? "unlocked" : "locked"}`;
    lockBtn.textContent = state.isUnlocked ? "Lock" : "Unlock";
    lockBtn.title = state.isUnlocked ? "Lock wallet" : "Unlock wallet";
  }
}
