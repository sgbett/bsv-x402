import type { CWIMethodName } from './messages'
import type { WalletBackend } from './wallet-backend'
import type { CWIHandlerContext } from './cwi'

// ---------------------------------------------------------------------------
// Built-in wallet backend
//
// Wraps the existing cwi.ts method handlers behind the WalletBackend interface.
// This is a thin adapter — the actual handler logic stays in cwi.ts for now,
// and will eventually be replaced by @bsv/wallet-toolbox-client.
// ---------------------------------------------------------------------------

// Import the internal dispatch machinery from cwi.ts
import {
  methodHandlers,
  contextOnlyMethods,
  allowedWhileLocked,
  type MethodHandler,
  type ContextOnlyHandler,
} from './cwi'

export class BuiltInWalletBackend implements WalletBackend {
  private context: CWIHandlerContext

  constructor(context: CWIHandlerContext) {
    this.context = context
  }

  async call(method: CWIMethodName, params: unknown, _origin: string): Promise<unknown> {
    if (!this.context.isUnlocked() && !allowedWhileLocked.has(method)) {
      throw new Error('Wallet is locked')
    }

    const handler = methodHandlers[method]
    if (!handler) {
      throw new Error(`Unknown method: ${method}`)
    }

    if (contextOnlyMethods.has(method)) {
      return (handler as ContextOnlyHandler)(this.context)
    }
    return (handler as MethodHandler)(params, this.context)
  }

  async isAuthenticated(): Promise<boolean> {
    return this.context.isUnlocked()
  }

  hasOwnUI(): boolean {
    return false
  }
}
