import type { PopupState } from '../state'
import { sendMessage } from '../state'
import { renderTxRow } from '../components/tx-row'

// ---------------------------------------------------------------------------
// Transactions page — paginated list of wallet actions
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20

interface ListTransactionsResult {
  totalActions: number
  actions: Array<{
    txid: string
    satoshis: number
    status: string
    isOutgoing: boolean
    description: string
    labels?: string[]
  }>
}

/**
 * Render the Transactions page into the given container.
 *
 * Fetches the first page of actions from the background service worker
 * and displays them as a paginated list.
 */
export function render(container: HTMLElement, state: PopupState): void {
  let currentOffset = 0

  container.innerHTML = `
    <div class="tx-loading">Loading transactions\u2026</div>
  `

  fetchAndRender(container, state, currentOffset, (newOffset) => {
    currentOffset = newOffset
  })
}

function fetchAndRender(
  container: HTMLElement,
  state: PopupState,
  offset: number,
  setOffset: (o: number) => void,
): void {
  container.innerHTML = `<div class="tx-loading">Loading transactions\u2026</div>`

  sendMessage<ListTransactionsResult>('listTransactions', { offset })
    .then((result) => {
      renderPage(container, state, result, offset, setOffset)
    })
    .catch((err) => {
      container.innerHTML = `
        <div class="tx-empty">
          Failed to load transactions: ${err instanceof Error ? err.message : String(err)}
        </div>
      `
    })
}

function renderPage(
  container: HTMLElement,
  state: PopupState,
  result: ListTransactionsResult,
  offset: number,
  setOffset: (o: number) => void,
): void {
  container.innerHTML = ''

  if (result.totalActions === 0) {
    container.innerHTML = `<div class="tx-empty">No transactions yet</div>`
    return
  }

  // Transaction list
  const listEl = document.createElement('div')
  listEl.className = 'tx-list'

  for (const action of result.actions) {
    listEl.appendChild(renderTxRow(action, state.network))
  }

  container.appendChild(listEl)

  // Pager
  const totalPages = Math.ceil(result.totalActions / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  if (totalPages > 1) {
    const pagerEl = document.createElement('div')
    pagerEl.className = 'tx-pager'

    const prevBtn = document.createElement('button')
    prevBtn.className = 'tx-pager-btn'
    prevBtn.textContent = 'Previous'
    prevBtn.disabled = currentPage <= 1
    prevBtn.addEventListener('click', () => {
      const newOffset = Math.max(0, offset - PAGE_SIZE)
      setOffset(newOffset)
      fetchAndRender(container, state, newOffset, setOffset)
    })

    const pageInfo = document.createElement('span')
    pageInfo.className = 'tx-pager-info'
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`

    const nextBtn = document.createElement('button')
    nextBtn.className = 'tx-pager-btn'
    nextBtn.textContent = 'Next'
    nextBtn.disabled = currentPage >= totalPages
    nextBtn.addEventListener('click', () => {
      const newOffset = offset + PAGE_SIZE
      setOffset(newOffset)
      fetchAndRender(container, state, newOffset, setOffset)
    })

    pagerEl.appendChild(prevBtn)
    pagerEl.appendChild(pageInfo)
    pagerEl.appendChild(nextBtn)
    container.appendChild(pagerEl)
  }
}
