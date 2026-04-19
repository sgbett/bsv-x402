import type { PopupState } from "../state";

// ---------------------------------------------------------------------------
// Health bar component — renders autospend balance as a percentage of tier cap
// ---------------------------------------------------------------------------

/**
 * Render the autospend health bar into the given container.
 *
 * Colour coding:
 *  - Green (default): balance >= 50% of tier cap
 *  - Yellow/orange ("low"): balance 25%-49%
 *  - Red ("critical"): balance < 25%
 *
 * Preserves the existing percentage clamping logic from popup.ts.
 */
export function renderHealthBar(
  container: HTMLElement,
  state: PopupState,
): void {
  const pct =
    state.tierCap > 0
      ? Math.max(0, Math.min(100, (state.autospendBalance / state.tierCap) * 100))
      : 0;

  // Determine colour class
  let colourClass = "";
  if (pct < 25) colourClass = "critical";
  else if (pct < 50) colourClass = "low";

  container.innerHTML = `
    <div class="health-bar">
      <div class="health-bar-fill${colourClass ? ` ${colourClass}` : ""}"
           style="width: ${pct}%"></div>
    </div>
    <div class="autospend-text">
      <span class="autospend-value">${state.autospendBalance.toLocaleString()} sats</span>
      <span class="autospend-cap">/ ${state.tierCap.toLocaleString()} sats</span>
    </div>
  `;
}
