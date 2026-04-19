import type { PopupState } from "../state";
import { sendMessage, copyToClipboard } from "../state";
import { renderQR } from "../components/qr";

// ---------------------------------------------------------------------------
// Payments page — send and receive with QR codes
// ---------------------------------------------------------------------------

/** Active panel: send or receive */
type Panel = "send" | "receive";

/** What the receive QR displays */
type ReceiveMode = "identity" | "address";

/** Cached wallet info so we don't re-fetch on every toggle */
let cachedIdentityKey = "";
let cachedAddress = "";
let fetchRetryCount = 0;
const MAX_FETCH_RETRIES = 3;

/**
 * Render the Payments page into the given container.
 */
export function render(container: HTMLElement, _state: PopupState): void {
  container.innerHTML = `
    <div class="payments-toggle">
      <button class="toggle-btn active" data-panel="send">Send</button>
      <button class="toggle-btn" data-panel="receive">Receive</button>
    </div>

    <div class="payments-panel" id="send-panel">
      <input type="text" class="input" id="pay-address" placeholder="Recipient address" autocomplete="off" />
      <input type="number" class="input" id="pay-amount" placeholder="Amount (satoshis)" min="1" step="1" />
      <button class="btn send-btn" id="pay-send-btn">Send</button>
      <div class="send-result" id="pay-result"></div>
    </div>

    <div class="payments-panel hidden" id="receive-panel">
      <div class="qr-container" id="receive-qr"></div>
      <div class="receive-toggles">
        <button class="receive-mode-btn active" data-mode="identity">Identity Key</button>
        <button class="receive-mode-btn" data-mode="address">Legacy Address</button>
      </div>
      <div class="receive-display" id="receive-display">
        <span class="receive-text" id="receive-text"></span>
        <button class="copy-btn" id="receive-copy-btn">Copy</button>
      </div>
    </div>
  `;

  bindToggle(container);
  bindSend(container);
  bindReceive(container);

  // Fetch wallet info eagerly so the receive panel is ready
  fetchWalletInfo();
}

/**
 * Update the Payments page in-place (called by polling cycle).
 * Nothing needs updating — send results persist, receive data is cached.
 */
export function update(_container: HTMLElement, _state: PopupState): void {
  // No periodic updates needed
}

// ---------------------------------------------------------------------------
// Send / Receive toggle
// ---------------------------------------------------------------------------

function bindToggle(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>(".toggle-btn");
  const sendPanel = container.querySelector<HTMLElement>("#send-panel")!;
  const receivePanel = container.querySelector<HTMLElement>("#receive-panel")!;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel as Panel;

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (panel === "send") {
        sendPanel.classList.remove("hidden");
        receivePanel.classList.add("hidden");
      } else {
        sendPanel.classList.add("hidden");
        receivePanel.classList.remove("hidden");
        // Render QR if we have data
        showReceiveData(container, "identity");
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Send panel
// ---------------------------------------------------------------------------

function bindSend(container: HTMLElement): void {
  const sendBtn = container.querySelector<HTMLButtonElement>("#pay-send-btn")!;
  const addressInput = container.querySelector<HTMLInputElement>("#pay-address")!;
  const amountInput = container.querySelector<HTMLInputElement>("#pay-amount")!;
  const resultEl = container.querySelector<HTMLElement>("#pay-result")!;

  sendBtn.addEventListener("click", async () => {
    const address = addressInput.value.trim();
    const amount = parseInt(amountInput.value, 10);

    if (!address) {
      resultEl.textContent = "Enter an address";
      resultEl.className = "send-result error";
      return;
    }
    if (!amount || amount <= 0) {
      resultEl.textContent = "Enter a valid amount";
      resultEl.className = "send-result error";
      return;
    }

    sendBtn.disabled = true;
    resultEl.textContent = "Sending...";
    resultEl.className = "send-result";

    try {
      const result = await sendMessage<{ sendTxid: string }>(
        "sendFunds",
        { address, amount },
      );
      resultEl.textContent = `Sent! txid: ${result.sendTxid.slice(0, 12)}...`;
      resultEl.className = "send-result success";
      addressInput.value = "";
      amountInput.value = "";
    } catch (err) {
      resultEl.textContent =
        err instanceof Error ? err.message : String(err);
      resultEl.className = "send-result error";
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Receive panel
// ---------------------------------------------------------------------------

async function fetchWalletInfo(): Promise<void> {
  try {
    const result = await sendMessage<{ identityKey?: string; address?: string }>(
      "getAddress",
    );
    if (result.identityKey) cachedIdentityKey = result.identityKey;
    if (result.address) cachedAddress = result.address;
    fetchRetryCount = 0;
  } catch {
    // Wallet may be locked — data stays empty until next attempt
  }
}

function bindReceive(container: HTMLElement): void {
  const modeButtons =
    container.querySelectorAll<HTMLButtonElement>(".receive-mode-btn");

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as ReceiveMode;
      modeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showReceiveData(container, mode);
    });
  });

  const copyBtn = container.querySelector<HTMLButtonElement>("#receive-copy-btn")!;
  copyBtn.addEventListener("click", async () => {
    const text =
      container.querySelector<HTMLElement>("#receive-text")?.textContent ?? "";
    if (text) await copyToClipboard(text, copyBtn);
  });
}

function showReceiveData(container: HTMLElement, mode: ReceiveMode): void {
  const qrContainer = container.querySelector<HTMLElement>("#receive-qr");
  const textEl = container.querySelector<HTMLElement>("#receive-text");
  if (!qrContainer || !textEl) return;

  const data = mode === "identity" ? cachedIdentityKey : cachedAddress;

  if (!data) {
    if (fetchRetryCount >= MAX_FETCH_RETRIES) {
      qrContainer.innerHTML = `<p class="qr-placeholder">Unavailable — wallet may be locked</p>`;
      textEl.textContent = "";
      return;
    }
    qrContainer.innerHTML = `<p class="qr-placeholder">Loading...</p>`;
    textEl.textContent = "";
    fetchRetryCount++;
    fetchWalletInfo().then(() => showReceiveData(container, mode));
    return;
  }

  renderQR(qrContainer, data);
  textEl.textContent = data;
}
