/// <reference types="chrome" />

import type { TierName, WeaponName } from "../../../../src/types";
import { TIER_CAPS, WEAPON_CAPS } from "../../../../src/autospend";
import type { PopupState } from "../state";
import { sendMessage } from "../state";

// ---------------------------------------------------------------------------
// Settings page — difficulty, weapon, tools, recovery
// ---------------------------------------------------------------------------

/** Ordered tier names for the dropdown. */
const TIER_NAMES: TierName[] = [
  "I'm Too Young to Die",
  "Hey, Not Too Rough",
  "Hurt Me Plenty",
  "Ultra-Violence",
  "Nightmare!",
];

/** Ordered weapon names for the dropdown. */
const WEAPON_NAMES: WeaponName[] = [
  "Fists",
  "Chainsaw",
  "Pistol",
  "Shotgun",
  "Super Shotgun",
  "Chaingun",
  "Rocket Launcher",
  "Plasma Rifle",
  "BFG9000",
];

/** Format a sats value for display in dropdown options. */
function formatSats(sats: number): string {
  if (!Number.isFinite(sats)) return "unlimited";
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(0)} BSV`;
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M sats`;
  return `${sats.toLocaleString()} sats`;
}

/**
 * Render the Settings page into the given container.
 *
 * Displays:
 *  - Difficulty tier dropdown (autospend limit)
 *  - Weapon dropdown (per-transaction cap)
 *  - Tools: Verify UTXOs, UTXO Admin
 *  - Recovery: seed preview, export, import
 */
export function render(container: HTMLElement, state: PopupState): void {
  const tierOptions = TIER_NAMES.map(
    (name) =>
      `<option value="${name}"${state.tier === name ? " selected" : ""}>${name} (${formatSats(TIER_CAPS[name])})</option>`,
  ).join("");

  const weaponOptions = WEAPON_NAMES.map(
    (name) =>
      `<option value="${name}"${state.weapon === name ? " selected" : ""}>${name} (${formatSats(WEAPON_CAPS[name])})</option>`,
  ).join("");

  const locked = !state.isUnlocked;

  container.innerHTML = `
    <section class="settings-section">
      <label>Difficulty <span class="label-hint">(Autospend limit)</span></label>
      <select class="select" id="settings-tier-select"${locked ? " disabled" : ""}>
        ${tierOptions}
      </select>
    </section>

    <section class="settings-section">
      <label>Weapon <span class="label-hint">(Per-transaction cap)</span></label>
      <select class="select" id="settings-weapon-select"${locked ? " disabled" : ""}>
        ${weaponOptions}
      </select>
    </section>

    <section class="settings-section">
      <label>Tools</label>
      <div class="tools-buttons">
        <button class="btn tool-btn" id="settings-verify-btn"${locked ? " disabled" : ""}>Verify UTXOs</button>
        <button class="btn tool-btn" id="settings-admin-btn"${locked ? " disabled" : ""}>UTXO Admin</button>
      </div>
      <div id="settings-verify-result" class="verify-result"></div>
    </section>

    <section class="settings-section">
      <label>Recovery</label>
      <div class="recovery-seed">
        <span class="recovery-seed-label">Seed:</span>
        <span class="recovery-seed-value" id="settings-seed-preview">${locked ? "locked" : "---"}</span>
      </div>
      <div class="recovery-buttons">
        <button class="btn tool-btn" id="settings-export-btn"${locked ? " disabled" : ""}>Export Wallet</button>
        <button class="btn tool-btn" id="settings-import-btn">Import Wallet</button>
      </div>
      <div id="settings-recovery-status" class="recovery-status"></div>
      ${state.isSetUp ? '<div class="recovery-warning">WARNING: Import will destroy existing wallet</div>' : ""}
      <input type="file" id="settings-import-input" accept=".json" style="display:none">
    </section>
  `;

  // --- Tier change ---
  const tierSelect = container.querySelector<HTMLSelectElement>(
    "#settings-tier-select",
  )!;
  tierSelect.addEventListener("change", async () => {
    const tier = tierSelect.value as TierName;
    try {
      await sendMessage("setTier", { tier });
    } catch (err) {
      alert(
        `Tier change failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  // --- Weapon change ---
  const weaponSelect = container.querySelector<HTMLSelectElement>(
    "#settings-weapon-select",
  )!;
  weaponSelect.addEventListener("change", async () => {
    const weapon = weaponSelect.value as WeaponName;
    try {
      await sendMessage("setWeapon", { weapon });
    } catch (err) {
      alert(
        `Weapon change failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  // --- Verify UTXOs ---
  const verifyBtn = container.querySelector<HTMLButtonElement>(
    "#settings-verify-btn",
  )!;
  const verifyResult = container.querySelector<HTMLDivElement>(
    "#settings-verify-result",
  )!;

  verifyBtn.addEventListener("click", async () => {
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying...";
    verifyResult.textContent = "";
    verifyResult.className = "verify-result";

    try {
      const result = await sendMessage<PopupState & {
        verifyResult?: { checked: number; relinquished: number; failed: number };
      }>("verifyUtxos");

      const vr = result.verifyResult;

      if (!vr || vr.checked === 0) {
        verifyResult.textContent = "No outputs to verify";
        verifyResult.classList.add("verify-success");
      } else if (vr.relinquished === 0 && vr.failed === 0) {
        verifyResult.textContent = `Checked ${vr.checked} output${vr.checked !== 1 ? "s" : ""}: all valid`;
        verifyResult.classList.add("verify-success");
      } else {
        const parts: string[] = [`Checked ${vr.checked}`];
        if (vr.relinquished > 0) {
          parts.push(
            `released ${vr.relinquished} spent output${vr.relinquished !== 1 ? "s" : ""}`,
          );
        }
        if (vr.failed > 0) {
          parts.push(
            `${vr.failed} lookup failure${vr.failed !== 1 ? "s" : ""}`,
          );
        }
        verifyResult.textContent = parts.join(", ");
        verifyResult.classList.add(
          vr.failed > 0 ? "verify-error" : "verify-warning",
        );
      }
    } catch (err) {
      verifyResult.className = "verify-result verify-error";
      verifyResult.textContent =
        err instanceof Error ? err.message : String(err);
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify UTXOs";
    }
  });

  // --- UTXO Admin ---
  const adminBtn = container.querySelector<HTMLButtonElement>(
    "#settings-admin-btn",
  )!;
  adminBtn.addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("ui/admin/utxos.html"),
    });
  });

  // --- Seed preview ---
  const seedPreview = container.querySelector<HTMLSpanElement>(
    "#settings-seed-preview",
  )!;

  if (state.isUnlocked) {
    sendMessage<{ preview: string }>("getRootKeyPreview")
      .then((result) => {
        seedPreview.textContent = result.preview;
      })
      .catch(() => {
        seedPreview.textContent = "unavailable";
      });
  } else {
    seedPreview.textContent = "locked";
  }

  // --- Recovery status helper ---
  const recoveryStatus = container.querySelector<HTMLDivElement>(
    "#settings-recovery-status",
  )!;

  function showRecoveryStatus(
    text: string,
    type: "success" | "error" | "info",
  ): void {
    recoveryStatus.textContent = text;
    recoveryStatus.className = `recovery-status recovery-${type}`;
  }

  // --- Export Wallet ---
  const exportBtn = container.querySelector<HTMLButtonElement>(
    "#settings-export-btn",
  )!;
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting...";
    recoveryStatus.textContent = "";
    recoveryStatus.className = "recovery-status";

    try {
      const result = await sendMessage<{ json: string }>("adminExportWallet");
      // Trigger download
      const blob = new Blob([result.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `x402-wallet-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showRecoveryStatus("Backup downloaded", "success");
    } catch (err) {
      showRecoveryStatus(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export Wallet";
    }
  });

  // --- Import Wallet ---
  const importBtn = container.querySelector<HTMLButtonElement>(
    "#settings-import-btn",
  )!;
  const importInput = container.querySelector<HTMLInputElement>(
    "#settings-import-input",
  )!;

  importBtn.addEventListener("click", () => {
    recoveryStatus.textContent = "";
    recoveryStatus.className = "recovery-status";
    importInput.click();
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    // Confirmation dialog — importing is destructive
    const confirmed = confirm(
      "This will replace your current wallet data. Are you sure you want to continue?",
    );
    if (!confirmed) {
      importInput.value = "";
      return;
    }

    importBtn.disabled = true;
    importBtn.textContent = "Importing...";

    try {
      const json = await file.text();
      const result = await sendMessage<{ success: boolean; message: string }>(
        "adminImportWallet",
        { json },
      );
      showRecoveryStatus(result.message, "success");
      // Reload the popup after a short delay to pick up the locked state
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      showRecoveryStatus(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import Wallet";
      importInput.value = "";
    }
  });
}

/**
 * Update the Settings page in-place without rebuilding the entire DOM.
 * Used by the polling cycle to keep dropdown values in sync.
 */
export function update(container: HTMLElement, state: PopupState): void {
  const tierSelect = container.querySelector<HTMLSelectElement>(
    "#settings-tier-select",
  );
  if (tierSelect && tierSelect.value !== state.tier) {
    tierSelect.value = state.tier;
  }

  const weaponSelect = container.querySelector<HTMLSelectElement>(
    "#settings-weapon-select",
  );
  if (weaponSelect && weaponSelect.value !== state.weapon) {
    weaponSelect.value = state.weapon;
  }
}
