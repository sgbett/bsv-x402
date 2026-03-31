/// <reference types="chrome" />

// ---------------------------------------------------------------------------
// Spend indicator — injected into page DOM by content script
//
// Shows x402 spend progress against the active window limit.
// Three display modes: bar (top strip), badge (corner), hidden.
// Uses Shadow DOM for style isolation.
// ---------------------------------------------------------------------------

export interface SpendStatus {
  spent: number
  limit: number
  window: string
  percentage: number
  circuitBroken: boolean
}

export type IndicatorMode = 'bar' | 'badge' | 'hidden'

const INDICATOR_ID = 'x402-spend-indicator'

export class SpendIndicator {
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private mode: IndicatorMode = 'bar'

  mount(mode: IndicatorMode = 'bar'): void {
    if (document.getElementById(INDICATOR_ID)) return
    this.mode = mode
    if (mode === 'hidden') return

    this.host = document.createElement('div')
    this.host.id = INDICATOR_ID
    this.shadow = this.host.attachShadow({ mode: 'closed' })
    this.shadow.innerHTML = this.getTemplate()

    // Click opens extension popup
    this.shadow.querySelector('.x402-indicator')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openPopup' })
    })

    document.documentElement.appendChild(this.host)
  }

  update(status: SpendStatus): void {
    if (!this.shadow || this.mode === 'hidden') return

    const fill = this.shadow.querySelector<HTMLElement>('.x402-fill')
    const label = this.shadow.querySelector<HTMLElement>('.x402-label')
    if (!fill || !label) return

    const pct = Math.min(status.percentage * 100, 100)
    fill.style.width = `${pct}%`

    // Colour: green → yellow → red
    if (status.circuitBroken) {
      fill.style.backgroundColor = '#dc3545'
    } else if (status.percentage >= 0.8) {
      fill.style.backgroundColor = '#ffc107'
    } else {
      fill.style.backgroundColor = '#28a745'
    }

    const spentStr = status.spent.toLocaleString()
    const limitStr = status.limit.toLocaleString()
    label.textContent = `${spentStr}/${limitStr} sats`
    label.title = `${spentStr} of ${limitStr} sats spent this ${status.window}`

    if (status.circuitBroken) {
      label.title = 'Circuit breaker tripped — payments blocked'
    }
  }

  unmount(): void {
    this.host?.remove()
    this.host = null
    this.shadow = null
  }

  private getTemplate(): string {
    if (this.mode === 'badge') return this.getBadgeTemplate()
    return this.getBarTemplate()
  }

  private getBarTemplate(): string {
    return `
      <style>
        .x402-indicator {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: rgba(0, 0, 0, 0.1);
          z-index: 2147483647;
          cursor: pointer;
          transition: height 0.2s;
        }
        .x402-indicator:hover {
          height: 20px;
        }
        .x402-fill {
          height: 100%;
          width: 0%;
          background-color: #28a745;
          transition: width 0.3s, background-color 0.3s;
        }
        .x402-label {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font: 11px/1 -apple-system, BlinkMacSystemFont, sans-serif;
          color: transparent;
          transition: color 0.2s;
          pointer-events: none;
        }
        .x402-indicator:hover .x402-label {
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
      </style>
      <div class="x402-indicator">
        <div class="x402-fill"></div>
        <div class="x402-label"></div>
      </div>
    `
  }

  private getBadgeTemplate(): string {
    return `
      <style>
        .x402-indicator {
          position: fixed;
          bottom: 12px;
          right: 12px;
          background: rgba(0, 0, 0, 0.75);
          color: #fff;
          font: 11px/1 -apple-system, BlinkMacSystemFont, monospace;
          padding: 4px 8px;
          border-radius: 4px;
          z-index: 2147483647;
          cursor: pointer;
          backdrop-filter: blur(4px);
          transition: opacity 0.2s;
        }
        .x402-indicator:hover {
          opacity: 0.8;
        }
        .x402-fill { display: none; }
        .x402-label { display: inline; }
      </style>
      <div class="x402-indicator">
        <div class="x402-fill"></div>
        <span class="x402-label"></span>
      </div>
    `
  }
}
