/// <reference types="chrome" />

import type { CWIMethodName } from './messages'
import type { WalletBackend } from './wallet-backend'
import { SetupClient, type Wallet } from '@bsv/wallet-toolbox-client'
import type { WalletInterface } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Built-in wallet backend
//
// Wraps @bsv/wallet-toolbox-client Wallet behind the WalletBackend interface.
// Uses IndexedDB storage (browser-compatible) via SetupClient.createWalletIdb.
// ---------------------------------------------------------------------------

// BRC-100 methods that work without authentication
const ALLOWED_WHILE_LOCKED = new Set<CWIMethodName>([
  'isAuthenticated', 'waitForAuthentication', 'getVersion', 'getNetwork',
])

// All 28 BRC-100 method names — used to validate calls
const WALLET_METHODS = new Set<CWIMethodName>([
  'getPublicKey', 'revealCounterpartyKeyLinkage', 'revealSpecificKeyLinkage',
  'encrypt', 'decrypt', 'createHmac', 'verifyHmac',
  'createSignature', 'verifySignature',
  'createAction', 'signAction', 'abortAction', 'listActions', 'internalizeAction',
  'listOutputs', 'relinquishOutput',
  'acquireCertificate', 'listCertificates', 'proveCertificate', 'relinquishCertificate',
  'discoverByIdentityKey', 'discoverByAttributes',
  'isAuthenticated', 'waitForAuthentication',
  'getHeight', 'getHeaderForHeight', 'getNetwork', 'getVersion',
])

export class BuiltInWalletBackend implements WalletBackend {
  private wallet: WalletInterface | null = null
  private chain: 'main' | 'test' = 'main'

  /**
   * Initialise the wallet from a root private key (hex).
   * Uses IndexedDB storage via wallet-toolbox-client.
   */
  async setup(rootKeyHex: string, chain: 'main' | 'test' = 'test'): Promise<void> {
    this.chain = chain
    const result = await SetupClient.createWalletIdb({
      chain,
      rootKeyHex,
      databaseName: `x402-wallet-${chain}`,
    })
    this.wallet = result.wallet
  }

  async call(method: CWIMethodName, params: unknown, origin: string): Promise<unknown> {
    if (!WALLET_METHODS.has(method)) {
      throw new Error(`Unknown method: ${method}`)
    }

    if (!this.wallet && !ALLOWED_WHILE_LOCKED.has(method)) {
      throw new Error('Wallet is not initialised')
    }

    // Methods that work without a wallet instance
    if (!this.wallet) {
      if (method === 'isAuthenticated') return { authenticated: false }
      if (method === 'getVersion') return { version: 'bsv-x402 0.1.0 (wallet-toolbox)' }
      if (method === 'getNetwork') return { network: this.chain === 'main' ? 'mainnet' : 'testnet' }
      if (method === 'waitForAuthentication') return { authenticated: false }
      throw new Error('Wallet is not initialised')
    }

    // Delegate to the wallet-toolbox Wallet instance
    // All BRC-100 methods follow the pattern: wallet.method(args, originator?)
    const fn = (this.wallet as unknown as Record<string, Function>)[method]
    if (typeof fn !== 'function') {
      throw new Error(`Wallet does not implement method: ${method}`)
    }

    return fn.call(this.wallet, params ?? {}, origin || undefined)
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.wallet) return false
    try {
      const result = await this.wallet.isAuthenticated({})
      return result.authenticated
    } catch {
      return false
    }
  }

  hasOwnUI(): boolean {
    return false
  }
}
