/// <reference types="chrome" />

import type { TierName } from "../../../src/types";

interface WalletState {
  isSetUp: boolean;
  isUnlocked: boolean;
  network: string;
  tier: TierName;
  balance?: number;
  limits?: {
    perTxMaxSatoshis: number;
    windows: Array<{ window: string; maxSatoshis: number; maxTransactions: number }>;
  };
}

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function updateUI(state: WalletState): void {
  const statusEl = $<HTMLSpanElement>("status-indicator");
  const balanceEl = $<HTMLSpanElement>("balance-display");
  const currentTierEl = $<HTMLSpanElement>("current-tier");
  const tierSelect = $<HTMLSelectElement>("tier-select");
  const lockBtn = $<HTMLButtonElement>("lock-btn");
  const setupContainer = $<HTMLDivElement>("setup-container");
  const limitsEl = $<HTMLDivElement>("limits-summary");

  // Not set up — show setup prompt, hide everything else
  if (!state.isSetUp) {
    setupContainer.hidden = false;
    lockBtn.style.display = "none";
    return;
  }

  setupContainer.hidden = true;
  lockBtn.style.display = "";

  // Lock / unlock status
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

  // Balance
  balanceEl.textContent =
    state.balance !== undefined ? `${state.balance.toLocaleString()} sats` : "--- sats";

  // Tier
  currentTierEl.textContent = state.tier;
  tierSelect.value = state.tier;

  // Limits summary
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

function sendMessage(msg: Record<string, unknown>): Promise<WalletState> {
  return new Promise<WalletState>((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as WalletState);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // Fetch initial state
  try {
    const state = await sendMessage({ type: "getState" });
    updateUI(state);
  } catch {
    // Background not ready — show setup
    updateUI({
      isSetUp: false,
      isUnlocked: false,
      network: "mainnet",
      tier: "Hey, Not Too Rough",
    });
  }

  // Lock / Unlock
  $<HTMLButtonElement>("lock-btn").addEventListener("click", async () => {
    const statusEl = $<HTMLSpanElement>("status-indicator");
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

  // Tier change
  $<HTMLSelectElement>("tier-select").addEventListener("change", async (e) => {
    const tier = (e.target as HTMLSelectElement).value as TierName;
    try {
      const state = await sendMessage({ type: "setTier", payload: { tier } });
      updateUI(state);
    } catch (err) {
      alert(`Tier change failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Set up wallet
  $<HTMLButtonElement>("setup-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/setup.html") });
  });

  // Settings
  $<HTMLAnchorElement>("settings-link").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
