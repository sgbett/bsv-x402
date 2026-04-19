// ---------------------------------------------------------------------------
// Transaction row component — renders a single WalletAction
// ---------------------------------------------------------------------------

interface WalletAction {
  txid: string
  satoshis: number
  status: string
  isOutgoing: boolean
  description: string
  labels?: string[]
}

interface StatusStyle {
  label: string
  className: string
}

const STATUS_MAP: Record<string, StatusStyle> = {
  completed:   { label: 'confirmed',   className: 'status-confirmed' },
  unprocessed: { label: 'unprocessed', className: 'status-grey' },
  sending:     { label: 'sending',     className: 'status-amber' },
  unproven:    { label: 'unproven',    className: 'status-amber' },
  unsigned:    { label: 'unsigned',    className: 'status-grey' },
  nosend:      { label: 'nosend',      className: 'status-blue' },
  nonfinal:    { label: 'nonfinal',    className: 'status-grey' },
  failed:      { label: 'failed',      className: 'status-failed' },
}

/**
 * Render a single transaction row element.
 *
 * @param action - A WalletAction from the SDK
 * @param network - 'mainnet' or 'testnet' for WoC link
 */
export function renderTxRow(action: WalletAction, network: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'tx-row'

  // Amount
  const amountEl = document.createElement('span')
  amountEl.className = 'tx-amount'
  if (action.satoshis === 0) {
    amountEl.textContent = '0 sats'
    amountEl.classList.add('tx-amount-zero')
  } else if (action.isOutgoing) {
    amountEl.textContent = `${action.satoshis.toLocaleString()} sats`
    amountEl.classList.add('tx-amount-sent')
  } else {
    amountEl.textContent = `+${action.satoshis.toLocaleString()} sats`
    amountEl.classList.add('tx-amount-received')
  }
  amountEl.title = `${action.satoshis} satoshis`

  // Status badge
  const statusStyle = STATUS_MAP[action.status] ?? { label: action.status, className: 'status-grey' }
  const badgeEl = document.createElement('span')
  badgeEl.className = `tx-status-badge ${statusStyle.className}`
  badgeEl.textContent = statusStyle.label
  badgeEl.title = `Status: ${action.status}`

  // Top line: amount + badge
  const topLine = document.createElement('div')
  topLine.className = 'tx-row-top'
  topLine.appendChild(amountEl)
  topLine.appendChild(badgeEl)

  // Description
  const descEl = document.createElement('div')
  descEl.className = 'tx-description'
  descEl.textContent = action.description || ''
  descEl.title = action.description || ''

  // Txid link to WoC
  const txidEl = document.createElement('div')
  txidEl.className = 'tx-txid'
  if (action.txid) {
    const wocBase = network === 'testnet'
      ? 'https://test.whatsonchain.com/tx/'
      : 'https://whatsonchain.com/tx/'
    const link = document.createElement('a')
    link.href = `${wocBase}${action.txid}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.className = 'tx-txid-link'
    link.textContent = `\u{1F50D} ${action.txid}`
    link.title = action.txid
    txidEl.appendChild(link)
  }

  row.appendChild(topLine)
  row.appendChild(descEl)
  row.appendChild(txidEl)

  return row
}
