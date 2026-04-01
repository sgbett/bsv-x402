import type { CWIMethodName } from './messages'

// ---------------------------------------------------------------------------
// Pluggable wallet backend interface
//
// The extension delegates all BRC-100 wallet operations through this interface.
// Two implementations:
// - BuiltInWalletBackend: wraps @bsv/wallet-toolbox-client (default)
// - ExternalWalletBackend: delegates to an external BRC-100 wallet
// ---------------------------------------------------------------------------

export interface WalletBackend {
  /** Proxy a BRC-100 method call to the underlying wallet. */
  call(method: CWIMethodName, params: unknown, origin: string): Promise<unknown>

  /** Whether the wallet is currently authenticated/unlocked. */
  isAuthenticated(): Promise<boolean>

  /** Whether this backend provides its own UI (external wallets do). */
  hasOwnUI(): boolean
}
