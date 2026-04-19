import type { PickupName } from "../../../../src/types";
import type { PopupState } from "../state";
import { sendMessage } from "../state";
import { renderHealthBar } from "../components/health-bar";

// ---------------------------------------------------------------------------
// Home page — balance, autospend health bar, pickup buttons
// ---------------------------------------------------------------------------

/**
 * Render the Home page into the given container.
 *
 * Displays:
 *  - Current balance in satoshis
 *  - Autospend health bar (via the health-bar component)
 *  - Pickup buttons: Medkit (+10%), Stimpak (+25%), Soul Sphere (+100%),
 *    New Game (reset)
 */
export function render(container: HTMLElement, state: PopupState): void {
  // Build static markup
  container.innerHTML = `
    <section class="balance">
      <label>Balance</label>
      <span class="balance-display">${formatBalance(state.balance)}</span>
    </section>

    <section class="autospend">
      <label>Autospend Balance</label>
      <div class="health-bar-container"></div>
    </section>

    <section class="pickups">
      <label>Pickups (recharge autospend)</label>
      <div class="pickup-buttons">
        <button class="pickup-btn" data-pickup="Medkit">Medkit +10%</button>
        <button class="pickup-btn" data-pickup="Stimpak">Stimpak +25%</button>
        <button class="pickup-btn" data-pickup="Soul Sphere">Soul Sphere +100%</button>
        <button class="pickup-btn new-game" data-pickup="New Game">New Game</button>
      </div>
    </section>
  `;

  // Render health bar into its container
  const healthBarContainer = container.querySelector<HTMLElement>(
    ".health-bar-container",
  );
  if (healthBarContainer) renderHealthBar(healthBarContainer, state);

  // Bind pickup button handlers
  container
    .querySelectorAll<HTMLButtonElement>(".pickup-btn")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pickup = btn.dataset.pickup as PickupName | undefined;
        if (!pickup) return;
        try {
          await sendMessage("pickup", { pickup });
        } catch (err) {
          alert(
            `Pickup failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    });
}

/**
 * Update the Home page in-place without rebuilding the entire DOM.
 * Used by the polling cycle to refresh balance and health bar.
 */
export function update(container: HTMLElement, state: PopupState): void {
  const balanceEl = container.querySelector<HTMLElement>(".balance-display");
  if (balanceEl) balanceEl.textContent = formatBalance(state.balance);

  const healthBarContainer = container.querySelector<HTMLElement>(
    ".health-bar-container",
  );
  if (healthBarContainer) renderHealthBar(healthBarContainer, state);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a balance value, handling the undefined/initialising case. */
function formatBalance(balance: number | undefined): string {
  return balance !== undefined
    ? `${balance.toLocaleString()} sats`
    : "--- sats";
}
