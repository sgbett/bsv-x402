/// <reference types="chrome" />

import type { TierName } from "../../../src/types";

// ---------------------------------------------------------------------------
// Popup state — composed from wallet + x402 controllers
// ---------------------------------------------------------------------------

interface PopupState {
  // Wallet concerns
  isSetUp: boolean;
  isUnlocked: boolean;
  network: string;
  balance?: number;
  // x402 concerns
  tier: TierName;
  limits?: {
    perTxMaxSatoshis: number;
    windows: Array<{ window: string; maxSatoshis: number; maxTransactions: number }>;
  };
}

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Wallet panel UI (only when built-in backend is active)
// ---------------------------------------------------------------------------

function updateWalletPanel(state: PopupState): void {
  const statusEl = document.getElementById("status-indicator");
  const balanceEl = document.getElementById("balance-display");
  const lockBtn = document.getElementById("lock-btn") as HTMLButtonElement | null;
  const setupContainer = document.getElementById("setup-container") as HTMLDivElement | null;

  // Wallet panel elements may not exist if wallet UI has been removed
  if (!statusEl || !balanceEl || !lockBtn || !setupContainer) return;

  if (!state.isSetUp) {
    setupContainer.hidden = false;
    lockBtn.style.display = "none";
    return;
  }

  setupContainer.hidden = true;
  lockBtn.style.display = "";

  if (state.isUnlocked) {
    statusEl.textContent = "Unlocked";
    statusEl.className = "status unlocked";
    lockBtn.textContent = "Lock";
    lockBtn.className = "lock-btn unlocked";
  } else {
    statusEl.textContent = "Locked";
    statusEl.className = "status locked";
    lockBtn.textContent = "Unlock";
    lockBtn.className = "lock-btn locked";
  }

  balanceEl.textContent =
    state.balance !== undefined ? `${state.balance.toLocaleString()} sats` : "--- sats";
}

// ---------------------------------------------------------------------------
// x402 panel UI (always shown)
// ---------------------------------------------------------------------------

function updateX402Panel(state: PopupState): void {
  const currentTierEl = $<HTMLSpanElement>("current-tier");
  const tierSelect = $<HTMLSelectElement>("tier-select");
  const limitsEl = $<HTMLDivElement>("limits-summary");

  currentTierEl.textContent = state.tier;
  tierSelect.value = state.tier;

  if (state.limits) {
    const lines = state.limits.windows.map(
      (w) => `${w.window}: ${w.maxSatoshis.toLocaleString()} sats / ${w.maxTransactions} txs`
    );
    lines.push(`Per-tx max: ${state.limits.perTxMaxSatoshis.toLocaleString()} sats`);
    limitsEl.textContent = lines.join(" | ");
  } else {
    limitsEl.textContent = "No active limits";
  }
}

// ---------------------------------------------------------------------------
// Message helper
// ---------------------------------------------------------------------------

function sendMessage(msg: Record<string, unknown>): Promise<PopupState> {
  return new Promise<PopupState>((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as PopupState);
    });
  });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  const walletPanel = document.getElementById("wallet-panel");

  // Check if wallet backend has its own UI — hide wallet panel if so
  if (walletPanel) {
    try {
      const result = await chrome.storage.local.get("x402_wallet_backend");
      const backendConfig = result.x402_wallet_backend as { type: string } | undefined;
      if (backendConfig?.type === "external") {
        walletPanel.style.display = "none";
      }
    } catch {
      // Default: show wallet panel
    }
  }

  // Fetch initial state
  function updateUI(state: PopupState): void {
    updateWalletPanel(state);
    updateX402Panel(state);
  }

  try {
    const state = await sendMessage({ type: "getState" });
    updateUI(state);
  } catch {
    updateUI({
      isSetUp: false,
      isUnlocked: false,
      network: "mainnet",
      tier: "Hey, Not Too Rough",
    });
  }

  // Wallet: Lock / Unlock (guarded — wallet panel may not exist)
  const lockBtn = document.getElementById("lock-btn");
  if (lockBtn) {
    lockBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("status-indicator");
      if (!statusEl) return;
      const isCurrentlyUnlocked = statusEl.classList.contains("unlocked");

      if (isCurrentlyUnlocked) {
        const state = await sendMessage({ type: "lock" });
        updateUI(state);
      } else {
        const password = prompt("Enter wallet password:");
        if (password === null) return;
        try {
          const state = await sendMessage({ type: "unlock", payload: { password } });
          updateUI(state);
        } catch (err) {
          alert(`Unlock failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }

  // x402: Indicator mode — load saved value
  const indicatorSelect = $<HTMLSelectElement>("indicator-mode-select");
  chrome.storage.local.get("x402_indicator_mode", (result) => {
    const mode = result.x402_indicator_mode as string | undefined;
    if (mode) indicatorSelect.value = mode;
  });

  // x402: Indicator mode — save on change
  indicatorSelect.addEventListener("change", () => {
    chrome.storage.local.set({ x402_indicator_mode: indicatorSelect.value });
  });

  // x402: Tier change
  $<HTMLSelectElement>("tier-select").addEventListener("change", async (e) => {
    const tier = (e.target as HTMLSelectElement).value as TierName;
    try {
      const state = await sendMessage({ type: "setTier", payload: { tier } });
      updateUI(state);
    } catch (err) {
      alert(`Tier change failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Wallet: Set up (guarded — wallet panel may not exist)
  const setupBtn = document.getElementById("setup-btn");
  if (setupBtn) {
    setupBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("ui/wallet/setup.html") });
    });
  }

  // Settings
  $<HTMLAnchorElement>("settings-link").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
