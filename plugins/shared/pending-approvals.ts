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
}

const pending = new Map<string, PendingApproval>()

export interface ApprovalRequest {
  amount: number
  origin: string
}

/**
 * Request user approval for a payment. Opens a popup window and waits
 * for the user to click Approve or Deny.
 */
export function requestApproval(req: ApprovalRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID()
    const approval: PendingApproval = {
      id,
      amount: req.amount,
      origin: req.origin,
      resolve,
    }
    pending.set(id, approval)

    // Open approve.html in a popup window
    const url = chrome.runtime.getURL(
      `ui/x402/approve.html?id=${encodeURIComponent(id)}&amount=${req.amount}&origin=${encodeURIComponent(req.origin)}`,
    )

    chrome.windows.create({
      url,
      type: 'popup',
      width: 400,
      height: 320,
    }, (window) => {
      if (window?.id !== undefined) {
        approval.windowId = window.id
      }
    })
  })
}

/** Resolve a pending approval with the user's response. */
export function resolveApproval(id: string, approved: boolean): boolean {
  const approval = pending.get(id)
  if (!approval) return false

  pending.delete(id)
  approval.resolve(approved)

  // Close the popup window
  if (approval.windowId !== undefined) {
    chrome.windows.remove(approval.windowId).catch(() => {
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
      pending.delete(approval.id)
      approval.resolve(false)
      return
    }
  }
}
