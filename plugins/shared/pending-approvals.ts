/// <reference types="chrome" />

// ---------------------------------------------------------------------------
// Pending approvals — tracks in-flight payment confirmation requests
//
// When a payment requires user confirmation, the CWI proxy:
//   1. Creates a request with a UUID
//   2. Opens approve.html in a popup window
//   3. Awaits the user's response via a Promise
//
// The approve.html page sends an approvalResponse message with the id,
// which resolves the Promise.
// ---------------------------------------------------------------------------

interface PendingApproval {
  id: string
  amount: number
  origin: string
  resolve: (approved: boolean) => void
  windowId?: number
  timeoutId?: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingApproval>()

/** Auto-deny approvals that don't get a response within this window. */
const APPROVAL_TIMEOUT_MS = 65_000 // slightly longer than the UI's 60s countdown

export interface ApprovalRequest {
  amount: number
  origin: string
}

/**
 * Request user approval for a payment. Opens a popup window and waits
 * for the user to click Approve or Deny. Auto-denies on timeout or
 * window creation failure.
 */
export function requestApproval(req: ApprovalRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID()

    const settle = (approved: boolean) => {
      const approval = pending.get(id)
      if (!approval) return
      pending.delete(id)
      if (approval.timeoutId) clearTimeout(approval.timeoutId)
      resolve(approved)
    }

    const approval: PendingApproval = {
      id,
      amount: req.amount,
      origin: req.origin,
      resolve: settle,
    }
    pending.set(id, approval)

    // Auto-deny if no response within the timeout
    approval.timeoutId = setTimeout(() => {
      console.warn(`x402: approval ${id} timed out — auto-denying`)
      settle(false)
    }, APPROVAL_TIMEOUT_MS)

    // Open approve.html in a popup window
    const url = chrome.runtime.getURL(
      `ui/x402/approve.html?id=${encodeURIComponent(id)}&amount=${req.amount}&origin=${encodeURIComponent(req.origin)}`,
    )

    try {
      chrome.windows.create({
        url,
        type: 'popup',
        width: 400,
        height: 500,
      }, (window) => {
        if (chrome.runtime.lastError || !window?.id) {
          console.warn('x402: failed to open approval popup, auto-denying:', chrome.runtime.lastError?.message)
          settle(false)
          return
        }
        approval.windowId = window.id
      })
    } catch (err) {
      console.warn('x402: chrome.windows.create threw, auto-denying:', err)
      settle(false)
    }
  })
}

/** Resolve a pending approval with the user's response. */
export function resolveApproval(id: string, approved: boolean): boolean {
  const approval = pending.get(id)
  if (!approval) return false

  // Close the popup window before settling so window-removed events
  // don't double-resolve
  const windowId = approval.windowId
  approval.resolve(approved)
  if (windowId !== undefined) {
    chrome.windows.remove(windowId).catch(() => {
      // Ignore — window may already be closed
    })
  }
  return true
}

/** Get pending approval details (for the approve.html page to display). */
export function getPendingApproval(id: string): { amount: number; origin: string } | null {
  const approval = pending.get(id)
  if (!approval) return null
  return { amount: approval.amount, origin: approval.origin }
}

/** Clean up if the window is closed without a response (treat as deny). */
export function handleWindowClosed(windowId: number): void {
  for (const approval of pending.values()) {
    if (approval.windowId === windowId) {
      approval.resolve(false)
      return
    }
  }
}
