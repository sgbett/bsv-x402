/// <reference types="chrome" />

import type { TierName, WeaponName, PickupName } from "../../../src/types";

// ---------------------------------------------------------------------------
// Popup state — composed from wallet + x402 controllers
// ---------------------------------------------------------------------------

interface PopupState {
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

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function copyToClipboard(text: string, btn: HTMLElement): Promise<void> {
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
  setTimeout(() => { btn.textContent = original; }, 1500);
}

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

  const unlockForm = document.getElementById("unlock-form") as HTMLDivElement | null;
  const unlockPassword = document.getElementById("unlock-password") as HTMLInputElement | null;
  const unlockError = document.getElementById("unlock-error") as HTMLDivElement | null;

  if (state.isUnlocked) {
    statusEl.textContent = "Unlocked";
    statusEl.className = "status unlocked";
    lockBtn.textContent = "Lock";
    lockBtn.className = "lock-btn unlocked";
    if (unlockForm) unlockForm.hidden = true;
  } else {
    statusEl.textContent = "Locked";
    statusEl.className = "status locked";
    lockBtn.textContent = "Unlock";
    lockBtn.className = "lock-btn locked";
    // Show password form automatically when locked
    if (unlockForm && unlockPassword) {
      unlockForm.hidden = false;
      if (unlockError) unlockError.textContent = "";
      if (!unlockPassword.value) unlockPassword.focus();
    }
  }

  balanceEl.textContent =
    state.balance !== undefined ? `${state.balance.toLocaleString()} sats` : "--- sats";

  // Show/hide address and identity sections based on unlock state
  const addressSection = document.getElementById("address-section") as HTMLDivElement | null;
  const identitySection = document.getElementById("identity-section") as HTMLDivElement | null;
  if (addressSection) addressSection.hidden = !state.isUnlocked;
  if (identitySection) identitySection.hidden = !state.isUnlocked;
}

// ---------------------------------------------------------------------------
// x402 panel UI (always shown)
// ---------------------------------------------------------------------------

function updateX402Panel(state: PopupState): void {
  const tierSelect = document.getElementById("tier-select") as HTMLSelectElement | null;
  const weaponSelect = document.getElementById("weapon-select") as HTMLSelectElement | null;
  const healthFill = document.getElementById("health-bar-fill") as HTMLDivElement | null;
  const autospendValue = document.getElementById("autospend-value") as HTMLSpanElement | null;
  const autospendCap = document.getElementById("autospend-cap") as HTMLSpanElement | null;

  if (tierSelect) tierSelect.value = state.tier;
  if (weaponSelect) weaponSelect.value = state.weapon;

  // Health bar: percentage of tier cap
  if (healthFill && state.tierCap > 0) {
    const pct = Math.max(0, Math.min(100, (state.autospendBalance / state.tierCap) * 100));
    healthFill.style.width = `${pct}%`;
    healthFill.classList.remove("low", "critical");
    if (pct < 25) healthFill.classList.add("critical");
    else if (pct < 50) healthFill.classList.add("low");
  }

  if (autospendValue) {
    autospendValue.textContent = `${state.autospendBalance.toLocaleString()} sats`;
  }
  if (autospendCap) {
    autospendCap.textContent = `/ ${state.tierCap.toLocaleString()} sats`;
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
      if (response?.status === 'error') {
        reject(new Error(response.error ?? 'Unknown error'));
        return;
      }
      resolve(response as PopupState);
    });
  });
}

// Build-time constants injected by tsup --define
declare const __X402_VERSION__: string;
declare const __X402_GIT_REF__: string;

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

  // Fetch and display wallet identity key + address when unlocked
  async function fetchWalletInfo(): Promise<void> {
    const addressDisplay = document.getElementById("address-display");
    const identityDisplay = document.getElementById("identity-display");
    const identitySection = document.getElementById("identity-section");
    try {
      const result = await sendMessage({ type: "getAddress" }) as PopupState & { identityKey?: string; address?: string };
      if (identityDisplay && result.identityKey) {
        identityDisplay.textContent = result.identityKey;
        if (identitySection) identitySection.hidden = false;
      }
      if (addressDisplay && result.address) {
        addressDisplay.textContent = result.address;
      }
    } catch {
      if (addressDisplay) addressDisplay.textContent = "";
      if (identityDisplay) identityDisplay.textContent = "";
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
    if (state.isUnlocked) fetchWalletInfo();
  } catch {
    updateUI({
      isSetUp: false,
      isUnlocked: false,
      network: "mainnet",
      tier: "Hurt Me Plenty",
      weapon: "Shotgun",
      autospendBalance: 0,
      tierCap: 100_000_000,
      weaponCap: 1_000_000,
    });
  }

  // Display version + git ref in footer
  const versionEl = document.getElementById("version-info");
  if (versionEl) {
    versionEl.textContent = `v${__X402_VERSION__} (${__X402_GIT_REF__})`;
  }

  // Poll balance every 10s while popup is open
  setInterval(async () => {
    try {
      const state = await sendMessage({ type: "getState" });
      updateUI(state);
    } catch {
      // Ignore — background may be restarting
    }
  }, 10_000);

  // Wallet: Lock / Unlock (guarded — wallet panel may not exist)
  const lockBtn = document.getElementById("lock-btn") as HTMLButtonElement | null;

  if (lockBtn) {
    lockBtn.addEventListener("click", async () => {
      const statusEl = document.getElementById("status-indicator");
      if (!statusEl) return;
      const isCurrentlyUnlocked = statusEl.classList.contains("unlocked");

      if (isCurrentlyUnlocked) {
        const state = await sendMessage({ type: "lock" });
        updateUI(state);
      } else {
        // Submit password
        const unlockPassword = document.getElementById("unlock-password") as HTMLInputElement | null;
        const unlockError = document.getElementById("unlock-error") as HTMLDivElement | null;
        if (unlockPassword) {
          const password = unlockPassword.value;
          if (!password) {
            unlockPassword.focus();
            return;
          }

          lockBtn.disabled = true;
          try {
            const state = await sendMessage({ type: "unlock", payload: { password } });
            unlockPassword.value = "";
            updateUI(state);
            fetchWalletInfo();
          } catch (err) {
            if (unlockError) unlockError.textContent = err instanceof Error ? err.message : String(err);
          } finally {
            lockBtn.disabled = false;
          }
        }
      }
    });

    // Allow Enter key to submit password
    const passwordInput = document.getElementById("unlock-password") as HTMLInputElement | null;
    if (passwordInput) {
      passwordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") lockBtn.click();
      });
    }
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

  // x402: Weapon change
  $<HTMLSelectElement>("weapon-select").addEventListener("change", async (e) => {
    const weapon = (e.target as HTMLSelectElement).value as WeaponName;
    try {
      const state = await sendMessage({ type: "setWeapon", payload: { weapon } });
      updateUI(state);
    } catch (err) {
      alert(`Weapon change failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // x402: Pickup buttons
  document.querySelectorAll<HTMLButtonElement>(".pickup-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pickup = btn.dataset.pickup as PickupName | undefined;
      if (!pickup) return;
      try {
        const state = await sendMessage({ type: "pickup", payload: { pickup } });
        updateUI(state);
      } catch (err) {
        alert(`Pickup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });

  // Wallet: Set up (guarded — wallet panel may not exist)
  const setupBtn = document.getElementById("setup-btn");
  if (setupBtn) {
    setupBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("ui/wallet/setup.html") });
    });
  }

  // Wallet: Copy identity key
  const copyIdentityBtn = document.getElementById("copy-identity-btn");
  if (copyIdentityBtn) {
    copyIdentityBtn.addEventListener("click", async () => {
      const identityDisplay = document.getElementById("identity-display");
      const text = identityDisplay?.textContent ?? "";
      if (!text) return;
      await copyToClipboard(text, copyIdentityBtn);
    });
  }

  // Wallet: Copy address
  const copyAddressBtn = document.getElementById("copy-address-btn");
  if (copyAddressBtn) {
    copyAddressBtn.addEventListener("click", async () => {
      const text = document.getElementById("address-display")?.textContent ?? "";
      if (text) await copyToClipboard(text, copyAddressBtn);
    });
  }

  // Listen for balance updates from background (e.g. after UTXO import)
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'balanceUpdated') {
      sendMessage({ type: "getState" }).then(updateUI).catch(() => {});
    }
  });

});
