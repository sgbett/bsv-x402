/// <reference types="chrome" />

/**
 * approve.ts — Script for the x402 payment approval popup.
 *
 * Query params (provided by the background via requestApproval):
 *   - id: UUID of the pending approval
 *   - amount: sats
 *   - origin: requesting origin
 *
 * On click, sends an approvalResponse message to the background and closes.
 */

const params = new URLSearchParams(window.location.search);
const requestId = params.get('id');
const amount = parseInt(params.get('amount') ?? '0', 10);
const origin = params.get('origin') ?? 'unknown origin';

// DOM elements
const originDisplay = document.getElementById('origin-display') as HTMLElement;
const amountValue = document.getElementById('amount-value') as HTMLElement;
const usdEstimate = document.getElementById('usd-estimate') as HTMLElement;
const descriptionEl = document.getElementById('description') as HTMLElement;
const spendStatus = document.getElementById('spend-status') as HTMLElement;
const warningEl = document.getElementById('warning') as HTMLElement;
const countdownEl = document.getElementById('countdown') as HTMLElement;
const approveBtn = document.getElementById('approve-btn') as HTMLButtonElement;
const denyBtn = document.getElementById('deny-btn') as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Populate UI from query params
// ---------------------------------------------------------------------------

originDisplay.textContent = origin;
amountValue.textContent = amount.toLocaleString();
descriptionEl.textContent = 'This payment exceeds your autospend limit.';
usdEstimate.style.display = 'none';
spendStatus.style.display = 'none';
warningEl.style.display = 'none';

// ---------------------------------------------------------------------------
// Auto-deny countdown
// ---------------------------------------------------------------------------

let secondsRemaining = 60;
let countdownTimer: ReturnType<typeof setInterval>;

function startCountdown(): void {
  countdownEl.textContent = `Auto-deny in ${secondsRemaining}s`;
  countdownTimer = setInterval(() => {
    secondsRemaining--;
    countdownEl.textContent = `Auto-deny in ${secondsRemaining}s`;
    if (secondsRemaining <= 0) {
      clearInterval(countdownTimer);
      sendDecision(false);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Send decision
// ---------------------------------------------------------------------------

function sendDecision(approved: boolean): void {
  clearInterval(countdownTimer);
  chrome.runtime.sendMessage(
    { type: 'approvalResponse', payload: { id: requestId, approved } },
    () => {
      window.close();
    },
  );
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

approveBtn.addEventListener('click', () => sendDecision(true));
denyBtn.addEventListener('click', () => sendDecision(false));

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

if (!requestId) {
  descriptionEl.textContent = 'Error: missing request ID.';
  approveBtn.disabled = true;
  denyBtn.disabled = true;
} else {
  startCountdown();
}
