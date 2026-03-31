/// <reference types="chrome" />

import type { CWIMethodName } from './messages'
import type { WalletBackend } from './wallet-backend'

// ---------------------------------------------------------------------------
// External wallet backend
//
// Delegates BRC-100 method calls to an external wallet (e.g. BSV Browser)
// via chrome.runtime.sendMessage to another extension.
// The external wallet provides its own UI — our extension is just a
// spending-limits proxy.
// ---------------------------------------------------------------------------

export interface ExternalWalletConfig {
  /** The extension ID of the external BRC-100 wallet. */
  extensionId: string
}

export class ExternalWalletBackend implements WalletBackend {
  private extensionId: string

  constructor(config: ExternalWalletConfig) {
    this.extensionId = config.extensionId
  }

  async call(method: CWIMethodName, params: unknown, origin: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        this.extensionId,
        { method, params, origin },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'External wallet communication failed'))
            return
          }
          if (response?.error) {
            reject(new Error(response.error))
            return
          }
          resolve(response?.result)
        },
      )
    })
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const result = await this.call('isAuthenticated', {}, '')
      return (result as { authenticated?: boolean })?.authenticated ?? false
    } catch {
      return false
    }
  }

  hasOwnUI(): boolean {
    return true
  }
}
