/// <reference types="chrome" />

/**
 * approve.ts — Script for the x402 payment approval popup.
 *
 * Reads request ID from URL params, fetches details from background,
 * populates the UI, and sends the user's decision back.
 */

const params = new URLSearchParams(window.location.search);
const requestId = params.get('id');

// DOM elements
const originDisplay = document.getElementById('origin-display') as HTMLElement;
const amountValue = document.getElementById('amount-value') as HTMLElement;
const usdEstimate = document.getElementById('usd-estimate') as HTMLElement;
const descriptionEl = document.getElementById('description') as HTMLElement;
const spentAmount = document.getElementById('spent-amount') as HTMLElement;
const spendLimit = document.getElementById('spend-limit') as HTMLElement;
const spendWindow = document.getElementById('spend-window') as HTMLElement;
const spendStatus = document.getElementById('spend-status') as HTMLElement;
const warningEl = document.getElementById('warning') as HTMLElement;
const countdownEl = document.getElementById('countdown') as HTMLElement;
const approveBtn = document.getElementById('approve-btn') as HTMLButtonElement;
const denyBtn = document.getElementById('deny-btn') as HTMLButtonElement;

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
// Communication with background
// ---------------------------------------------------------------------------

function sendDecision(approved: boolean): void {
  clearInterval(countdownTimer);
  chrome.runtime.sendMessage(
    { type: 'approvePayment', payload: { id: requestId, approved } },
    () => {
      window.close();
    }
  );
}

function loadRequest(): void {
  if (!requestId) {
    descriptionEl.textContent = 'Error: missing request ID.';
    return;
  }

  chrome.runtime.sendMessage(
    { type: 'getApprovalRequest', payload: { id: requestId } },
    (response) => {
      if (!response) {
        descriptionEl.textContent = 'Error: request not found.';
        return;
      }
      populateUI(response);
    }
  );
}

// ---------------------------------------------------------------------------
// UI population
// ---------------------------------------------------------------------------

interface ApprovalRequestDetails {
  origin: string;
  amount: number;
  description?: string;
  usdEstimate?: string;
  spent?: number;
  limit?: number;
  window?: string;
  warningLevel?: 'yellow' | 'red';
  warningMessage?: string;
}

function populateUI(details: ApprovalRequestDetails): void {
  originDisplay.textContent = details.origin || 'unknown origin';
  amountValue.textContent = details.amount != null ? details.amount.toLocaleString() : '--';

  if (details.usdEstimate) {
    usdEstimate.textContent = `\u2248 ${details.usdEstimate} USD`;
  }

  if (details.description) {
    descriptionEl.textContent = details.description;
  } else {
    descriptionEl.textContent = '';
  }

  // Spend status
  if (details.spent != null && details.limit != null) {
    spentAmount.textContent = details.spent.toLocaleString();
    spendLimit.textContent = details.limit.toLocaleString();
    if (details.window) {
      spendWindow.textContent = details.window;
    }
  } else {
    spendStatus.style.display = 'none';
  }

  // Warning indicator
  if (details.warningLevel === 'yellow' || details.warningLevel === 'red') {
    warningEl.classList.add(details.warningLevel);
    warningEl.textContent = details.warningMessage || (
      details.warningLevel === 'red' ? 'High-value payment' : 'Elevated spending'
    );
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

approveBtn.addEventListener('click', () => sendDecision(true));
denyBtn.addEventListener('click', () => sendDecision(false));

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadRequest();
startCountdown();
