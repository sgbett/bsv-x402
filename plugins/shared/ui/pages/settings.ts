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
 *  - Recovery placeholder (deferred to Task 8)
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

  container.innerHTML = `
    <section class="settings-section">
      <label>Difficulty <span class="label-hint">(Autospend limit)</span></label>
      <select class="select" id="settings-tier-select">
        ${tierOptions}
      </select>
    </section>

    <section class="settings-section">
      <label>Weapon <span class="label-hint">(Per-transaction cap)</span></label>
      <select class="select" id="settings-weapon-select">
        ${weaponOptions}
      </select>
    </section>

    <section class="settings-section">
      <label>Tools</label>
      <div class="tools-buttons">
        <button class="btn tool-btn" id="settings-verify-btn">Verify UTXOs</button>
        <button class="btn tool-btn" id="settings-admin-btn">UTXO Admin</button>
      </div>
      <div id="settings-verify-result" class="verify-result"></div>
    </section>

    <section class="settings-section">
      <label>Recovery</label>
      <p class="placeholder">Coming soon</p>
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
