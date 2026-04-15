/**
 * UTXO Admin view — lists all wallet outputs for debugging.
 * Opens in a full tab (not the popup).
 */

interface OutputRecord {
  outpoint: string
  satoshis: number
  spendable: boolean
  tags?: string[]
  labels?: string[]
  customInstructions?: string
  txid: string
  txStatus: string
  txDescription: string
  txIsOutgoing: boolean
}

interface ListOutputsResponse {
  totalOutputs: number
  outputs: OutputRecord[]
}

// Message helper — same pattern as popup.ts
function sendMessage(msg: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (response?.status === 'error') {
        reject(new Error(response.error ?? 'Unknown error'))
        return
      }
      resolve(response)
    })
  })
}

const tbody = document.getElementById('output-table') as HTMLTableSectionElement
const statusEl = document.getElementById('status') as HTMLDivElement
const subtitleEl = document.getElementById('subtitle') as HTMLDivElement
const summaryEl = document.getElementById('summary') as HTMLDivElement
const totalCountEl = document.getElementById('total-count') as HTMLSpanElement
const spendableCountEl = document.getElementById('spendable-count') as HTMLSpanElement
const totalValueEl = document.getElementById('total-value') as HTMLSpanElement
const spendableValueEl = document.getElementById('spendable-value') as HTMLSpanElement
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement
const basketFilter = document.getElementById('basket-filter') as HTMLSelectElement
const spendableFilter = document.getElementById('spendable-filter') as HTMLSelectElement
const statusFilter = document.getElementById('status-filter') as HTMLSelectElement

let allOutputs: OutputRecord[] = []
let sortKey = 'index'
let sortAsc = true

function formatSats(n: number): string {
  return n.toLocaleString()
}

function parseOutpoint(op: string): { txid: string; vout: string } {
  const dotIdx = op.lastIndexOf('.')
  if (dotIdx === -1) return { txid: op, vout: '?' }
  return { txid: op.slice(0, dotIdx), vout: op.slice(dotIdx + 1) }
}

function wocTxUrl(txid: string): string {
  return `https://whatsonchain.com/tx/${txid}`
}

const STATUS_COLOURS: Record<string, string> = {
  completed: '#00d4aa',
  unproven: '#f1c40f',
  nosend: '#e74c3c',
  sending: '#e0af68',
  unsigned: '#888',
  unprocessed: '#888',
  nonfinal: '#888',
  failed: '#e74c3c',
  unknown: '#666',
}

function renderTable() {
  const spFilter = spendableFilter.value
  const stFilter = statusFilter.value
  let filtered = allOutputs
  if (spFilter === 'spendable') filtered = filtered.filter(o => o.spendable)
  else if (spFilter === 'non-spendable') filtered = filtered.filter(o => !o.spendable)
  if (stFilter) filtered = filtered.filter(o => o.txStatus === stFilter)

  // Sort
  const sorted = [...filtered]
  sorted.sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'satoshis': cmp = a.satoshis - b.satoshis; break
      case 'spendable': cmp = (a.spendable ? 1 : 0) - (b.spendable ? 1 : 0); break
      case 'outpoint': cmp = a.outpoint.localeCompare(b.outpoint); break
      case 'txStatus': cmp = a.txStatus.localeCompare(b.txStatus); break
      case 'tags': cmp = (a.tags?.join(',') ?? '').localeCompare(b.tags?.join(',') ?? ''); break
      default: cmp = 0
    }
    return sortAsc ? cmp : -cmp
  })

  // Summary — group by txStatus
  const byStatus = new Map<string, { count: number; sats: number }>()
  for (const o of allOutputs) {
    const entry = byStatus.get(o.txStatus) ?? { count: 0, sats: 0 }
    entry.count++
    entry.sats += o.satoshis
    byStatus.set(o.txStatus, entry)
  }

  const spendable = allOutputs.filter(o => o.spendable)
  totalCountEl.textContent = allOutputs.length.toString()
  spendableCountEl.textContent = spendable.length.toString()
  totalValueEl.textContent = formatSats(allOutputs.reduce((s, o) => s + o.satoshis, 0)) + ' sats'
  spendableValueEl.textContent = formatSats(spendable.reduce((s, o) => s + o.satoshis, 0)) + ' sats'

  // Status breakdown
  const breakdownEl = document.getElementById('status-breakdown')!
  breakdownEl.innerHTML = Array.from(byStatus.entries())
    .sort(([, a], [, b]) => b.sats - a.sats)
    .map(([status, { count, sats }]) =>
      `<div class="stat">
        <span class="label" style="color: ${STATUS_COLOURS[status] ?? '#888'}">${status}</span>
        <span class="value">${count} / ${formatSats(sats)}</span>
      </div>`
    ).join('')

  summaryEl.hidden = false

  // Table
  tbody.innerHTML = ''
  sorted.forEach((output, idx) => {
    const { txid, vout } = parseOutpoint(output.outpoint)
    const statusColour = STATUS_COLOURS[output.txStatus] ?? '#888'
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="outpoint">
        <a href="${wocTxUrl(txid)}" target="_blank" rel="noopener">
          <span class="txid">${txid.slice(0, 8)}...${txid.slice(-8)}</span>.<span class="vout">${vout}</span>
        </a>
      </td>
      <td class="sats">${formatSats(output.satoshis)}</td>
      <td class="${output.spendable ? 'spendable-yes' : 'spendable-no'}">${output.spendable ? 'yes' : 'no'}</td>
      <td style="color: ${statusColour}">${output.txStatus}</td>
      <td class="tx-desc">${output.txDescription || ''}</td>
      <td class="tags">${(output.tags ?? []).map(t => `<span class="tag">${t}</span>`).join('')}</td>
    `
    tr.title = output.outpoint
    tbody.appendChild(tr)
  })

  statusEl.textContent = `Showing ${sorted.length} of ${allOutputs.length} outputs`
  statusEl.className = 'status'
}

async function loadOutputs() {
  refreshBtn.disabled = true
  statusEl.textContent = 'Loading...'
  statusEl.className = 'status'
  tbody.innerHTML = ''

  try {
    const basket = basketFilter.value
    const params: Record<string, unknown> = { limit: 10000 }
    if (basket) params.basket = basket

    const response = await sendMessage({ type: 'adminListOutputs', payload: params })
    const data = response as ListOutputsResponse
    allOutputs = data.outputs ?? []
    subtitleEl.textContent = `Wallet outputs — ${basket || 'all baskets'}`

    // Populate status filter from actual data
    const statuses = [...new Set(allOutputs.map(o => o.txStatus))].sort()
    const current = statusFilter.value
    statusFilter.innerHTML = '<option value="">all statuses</option>'
    for (const s of statuses) {
      const opt = document.createElement('option')
      opt.value = s
      opt.textContent = s
      if (s === current) opt.selected = true
      statusFilter.appendChild(opt)
    }

    renderTable()
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err)
    statusEl.className = 'status error'
    subtitleEl.textContent = 'Error loading outputs'
  } finally {
    refreshBtn.disabled = false
  }
}

// Sort on header click
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = (th as HTMLElement).dataset.sort!
    if (sortKey === key) { sortAsc = !sortAsc }
    else { sortKey = key; sortAsc = true }
    renderTable()
  })
})

// Abort all nosend transactions
const abortBtn = document.getElementById('abort-nosend-btn') as HTMLButtonElement
abortBtn.addEventListener('click', async () => {
  const nosendCount = allOutputs.filter(o => o.txStatus === 'nosend').length
  if (nosendCount === 0) {
    statusEl.textContent = 'No nosend transactions to abort'
    statusEl.className = 'status'
    return
  }
  if (!confirm(`Abort all nosend transactions? This will free ${nosendCount} locked outputs.`)) return

  abortBtn.disabled = true
  abortBtn.textContent = 'Aborting...'
  statusEl.textContent = 'Aborting nosend transactions...'
  try {
    const result = await sendMessage({ type: 'adminAbortNosend' }) as { aborted: number; balance: number }
    statusEl.textContent = `Aborted ${result.aborted} transactions. New balance: ${formatSats(result.balance)} sats`
    statusEl.className = 'status'
    await loadOutputs()
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err)
    statusEl.className = 'status error'
  } finally {
    abortBtn.disabled = false
    abortBtn.textContent = 'Abort nosend txs'
  }
})

refreshBtn.addEventListener('click', loadOutputs)
basketFilter.addEventListener('change', loadOutputs)
spendableFilter.addEventListener('change', renderTable)
statusFilter.addEventListener('change', renderTable)

// Load on open
loadOutputs()
