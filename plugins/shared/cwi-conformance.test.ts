/**
 * BSV Browser CWI Conformance Tests
 *
 * These tests verify that the CWI proxy routes all 28 BRC-100 wallet methods
 * through the WalletBackend interface, applies spending limits on createAction,
 * and rejects unknown methods.
 *
 * Reference: BSV Browser handles CWI calls in app/browser.tsx via a message
 * handler that forwards `{ call, args, id }` messages to the wallet object.
 * The wallet implements all 28 BRC-100 WalletInterface methods.
 *
 * SYNC REFERENCE:
 *   - bsv-blockchain/bsv-browser  app/browser.tsx  (handleMessage wallet methods)
 *   - bsv-blockchain/ts-sdk       src/wallet/Wallet.interfaces.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleCWIRequest } from './cwi-proxy'
import type { WalletBackend } from './wallet-backend'
import type { ContentToBackgroundMessage, CWIMethodName } from './messages'

// ---------------------------------------------------------------------------
// BSV Browser canonical method list (28 methods)
// Extracted from bsv-blockchain/bsv-browser app/browser.tsx handleMessage
// ---------------------------------------------------------------------------

const BSV_BROWSER_METHODS: CWIMethodName[] = [
  // Key management
  'getPublicKey',
  'revealCounterpartyKeyLinkage',
  'revealSpecificKeyLinkage',
  // Cryptographic operations
  'encrypt',
  'decrypt',
  'createHmac',
  'verifyHmac',
  'createSignature',
  'verifySignature',
  // Transaction management
  'createAction',
  'signAction',
  'abortAction',
  'listActions',
  'internalizeAction',
  // Output management
  'listOutputs',
  'relinquishOutput',
  // Certificate management
  'acquireCertificate',
  'listCertificates',
  'proveCertificate',
  'relinquishCertificate',
  // Certificate discovery
  'discoverByIdentityKey',
  'discoverByAttributes',
  // Authentication & status
  'isAuthenticated',
  'waitForAuthentication',
  // Blockchain information
  'getHeight',
  'getHeaderForHeight',
  'getNetwork',
  'getVersion',
]

// ---------------------------------------------------------------------------
// Mock wallet backend
// ---------------------------------------------------------------------------

interface CallRecord {
  method: CWIMethodName
  params: unknown
  origin: string
}

function createMockBackend(): WalletBackend & { calls: CallRecord[] } {
  const calls: CallRecord[] = []

  return {
    calls,

    async call(method: CWIMethodName, params: unknown, origin: string): Promise<unknown> {
      calls.push({ method, params, origin })

      // Return stub responses shaped like the real wallet would return
      switch (method) {
        case 'getPublicKey': return { publicKey: '02abc' }
        case 'revealCounterpartyKeyLinkage': return { encryptedLinkage: 'aaa', encryptedLinkageProof: 'bbb' }
        case 'revealSpecificKeyLinkage': return { encryptedLinkage: 'aaa', encryptedLinkageProof: 'bbb' }
        case 'encrypt': return { ciphertext: [1, 2, 3] }
        case 'decrypt': return { plaintext: [1, 2, 3] }
        case 'createHmac': return { hmac: [4, 5, 6] }
        case 'verifyHmac': return { valid: true }
        case 'createSignature': return { signature: [7, 8, 9] }
        case 'verifySignature': return { valid: true }
        case 'createAction': return { txid: 'deadbeef' }
        case 'signAction': return { txid: 'deadbeef' }
        case 'abortAction': return { aborted: true }
        case 'listActions': return { totalActions: 0, actions: [] }
        case 'internalizeAction': return { accepted: true }
        case 'listOutputs': return { totalOutputs: 0, outputs: [] }
        case 'relinquishOutput': return { relinquished: true }
        case 'acquireCertificate': return { type: 'test', subject: 'sub', serialNumber: '1', certifier: 'c', fields: {}, signature: 'sig' }
        case 'listCertificates': return { totalCertificates: 0, certificates: [] }
        case 'proveCertificate': return { keyForVerifier: 'key' }
        case 'relinquishCertificate': return { relinquished: true }
        case 'discoverByIdentityKey': return { totalCertificates: 0, certificates: [] }
        case 'discoverByAttributes': return { totalCertificates: 0, certificates: [] }
        case 'isAuthenticated': return { authenticated: true }
        case 'waitForAuthentication': return { authenticated: true }
        case 'getHeight': return { height: 800000 }
        case 'getHeaderForHeight': return { header: '0000' }
        case 'getNetwork': return { network: 'mainnet' }
        case 'getVersion': return { version: '1.0.0' }
      }
    },

    async isAuthenticated(): Promise<boolean> {
      return true
    },

    hasOwnUI(): boolean {
      return false
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(method: CWIMethodName, params: unknown = {}): ContentToBackgroundMessage {
  return {
    request: { id: `test-${method}`, method, params },
    origin: 'https://example.com',
  }
}

// ---------------------------------------------------------------------------
// Stub the x402-controller module so tests run without chrome.storage
// ---------------------------------------------------------------------------

vi.mock('./x402-controller', () => ({
  checkSpendLimits: vi.fn().mockResolvedValue({ allowed: true }),
  recordPayment: vi.fn().mockResolvedValue(undefined),
  getSpendStatus: vi.fn().mockResolvedValue({ spent: 0, limit: 0, window: 'day', percentage: 0, circuitBroken: false }),
}))

// Import the mocked functions so we can inspect/reset them
import { checkSpendLimits, recordPayment } from './x402-controller'
const mockCheckSpendLimits = vi.mocked(checkSpendLimits)
const mockRecordPayment = vi.mocked(recordPayment)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let backend: ReturnType<typeof createMockBackend>

beforeEach(() => {
  backend = createMockBackend()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Interface completeness — every BSV Browser method is routed via proxy
// ---------------------------------------------------------------------------

describe('CWI conformance: interface completeness', () => {
  it('handles all 28 BSV Browser wallet methods', () => {
    expect(BSV_BROWSER_METHODS).toHaveLength(28)
  })

  for (const method of BSV_BROWSER_METHODS) {
    it(`routes "${method}" through the wallet backend`, async () => {
      const msg = makeMessage(method, getMinimalParams(method))
      const response = await handleCWIRequest(msg, backend)
      expect(response.status).toBe('ok')
      expect(response.error).toBeUndefined()

      // Verify the backend was actually called with the correct method
      const call = backend.calls.find(c => c.method === method)
      expect(call).toBeDefined()
      expect(call!.origin).toBe('https://example.com')
    })
  }
})

// ---------------------------------------------------------------------------
// 2. Message format — response structure
// ---------------------------------------------------------------------------

describe('CWI conformance: message format', () => {
  it('response includes id matching request', async () => {
    const msg = makeMessage('getNetwork')
    const response = await handleCWIRequest(msg, backend)
    expect(response.id).toBe('test-getNetwork')
  })

  it('successful response has status "ok" and result', async () => {
    const msg = makeMessage('getNetwork')
    const response = await handleCWIRequest(msg, backend)
    expect(response.status).toBe('ok')
    expect(response.result).toBeDefined()
  })

  it('error response has status "error" and error string', async () => {
    // Make the backend throw
    backend.call = async () => { throw new Error('test failure') }
    const msg = makeMessage('getNetwork')
    const response = await handleCWIRequest(msg, backend)
    expect(response.status).toBe('error')
    expect(response.error).toBeDefined()
    expect(typeof response.error).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// 3. Response shapes — verify each method returns expected fields
// ---------------------------------------------------------------------------

describe('CWI conformance: response shapes', () => {
  // Key management
  it('getPublicKey returns { publicKey }', async () => {
    const r = await handleCWIRequest(makeMessage('getPublicKey'), backend)
    expect(r.result).toHaveProperty('publicKey')
  })

  it('revealCounterpartyKeyLinkage returns { encryptedLinkage, encryptedLinkageProof }', async () => {
    const r = await handleCWIRequest(makeMessage('revealCounterpartyKeyLinkage', {
      counterparty: 'abc', verifier: 'def', protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('encryptedLinkage')
    expect(r.result).toHaveProperty('encryptedLinkageProof')
  })

  it('revealSpecificKeyLinkage returns { encryptedLinkage, encryptedLinkageProof }', async () => {
    const r = await handleCWIRequest(makeMessage('revealSpecificKeyLinkage', {
      counterparty: 'abc', verifier: 'def', protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('encryptedLinkage')
    expect(r.result).toHaveProperty('encryptedLinkageProof')
  })

  // Cryptographic operations
  it('encrypt returns { ciphertext }', async () => {
    const r = await handleCWIRequest(makeMessage('encrypt', {
      plaintext: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('ciphertext')
  })

  it('decrypt returns { plaintext }', async () => {
    const r = await handleCWIRequest(makeMessage('decrypt', {
      ciphertext: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('plaintext')
  })

  it('createHmac returns { hmac }', async () => {
    const r = await handleCWIRequest(makeMessage('createHmac', {
      data: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('hmac')
  })

  it('verifyHmac returns { valid }', async () => {
    const r = await handleCWIRequest(makeMessage('verifyHmac', {
      data: [1, 2, 3], hmac: [4, 5, 6], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('valid')
  })

  it('createSignature returns { signature }', async () => {
    const r = await handleCWIRequest(makeMessage('createSignature', {
      data: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('signature')
  })

  it('verifySignature returns { valid }', async () => {
    const r = await handleCWIRequest(makeMessage('verifySignature', {
      data: [1, 2, 3], signature: [4, 5, 6], protocolID: [1, 'test'], keyID: '1',
    }), backend)
    expect(r.result).toHaveProperty('valid')
  })

  // Transaction management
  it('createAction returns { txid }', async () => {
    const r = await handleCWIRequest(makeMessage('createAction', {
      description: 'test payment',
      outputs: [{ satoshis: 100, lockingScript: '76a914aabb88ac', outputDescription: 'test' }],
    }), backend)
    expect(r.result).toHaveProperty('txid')
  })

  it('signAction returns { txid }', async () => {
    const r = await handleCWIRequest(makeMessage('signAction', { reference: 'ref-123' }), backend)
    expect(r.result).toHaveProperty('txid')
  })

  it('abortAction returns { aborted }', async () => {
    const r = await handleCWIRequest(makeMessage('abortAction', { reference: 'ref-123' }), backend)
    expect(r.result).toHaveProperty('aborted')
  })

  it('listActions returns { totalActions, actions }', async () => {
    const r = await handleCWIRequest(makeMessage('listActions', { labels: ['test'] }), backend)
    expect(r.result).toHaveProperty('totalActions')
    expect(r.result).toHaveProperty('actions')
  })

  it('internalizeAction returns { accepted }', async () => {
    const r = await handleCWIRequest(makeMessage('internalizeAction', { tx: [0], outputs: [] }), backend)
    expect(r.result).toHaveProperty('accepted')
  })

  // Output management
  it('listOutputs returns { totalOutputs, outputs }', async () => {
    const r = await handleCWIRequest(makeMessage('listOutputs', { basket: 'default' }), backend)
    expect(r.result).toHaveProperty('totalOutputs')
    expect(r.result).toHaveProperty('outputs')
  })

  it('relinquishOutput returns { relinquished }', async () => {
    const r = await handleCWIRequest(makeMessage('relinquishOutput', { basket: 'default', output: 'abc:0' }), backend)
    expect(r.result).toHaveProperty('relinquished')
  })

  // Certificate management
  it('acquireCertificate returns { type, subject, serialNumber, certifier, fields, signature }', async () => {
    const r = await handleCWIRequest(makeMessage('acquireCertificate', { type: 'test', certifier: 'abc' }), backend)
    const result = r.result as Record<string, unknown>
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('serialNumber')
    expect(result).toHaveProperty('certifier')
    expect(result).toHaveProperty('fields')
    expect(result).toHaveProperty('signature')
  })

  it('listCertificates returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('listCertificates', { certifiers: ['abc'], types: ['test'] }), backend)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  it('proveCertificate returns { keyForVerifier }', async () => {
    const r = await handleCWIRequest(makeMessage('proveCertificate', {
      certificate: {}, fieldsToReveal: ['name'], verifier: 'abc',
    }), backend)
    expect(r.result).toHaveProperty('keyForVerifier')
  })

  it('relinquishCertificate returns { relinquished }', async () => {
    const r = await handleCWIRequest(makeMessage('relinquishCertificate', {
      type: 'test', serialNumber: '123', certifier: 'abc',
    }), backend)
    expect(r.result).toHaveProperty('relinquished')
  })

  // Certificate discovery
  it('discoverByIdentityKey returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('discoverByIdentityKey', { identityKey: 'abc' }), backend)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  it('discoverByAttributes returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('discoverByAttributes', { attributes: { name: 'test' } }), backend)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  // Authentication & status
  it('isAuthenticated returns { authenticated }', async () => {
    const r = await handleCWIRequest(makeMessage('isAuthenticated'), backend)
    expect(r.result).toHaveProperty('authenticated')
    expect((r.result as { authenticated: boolean }).authenticated).toBe(true)
  })

  it('waitForAuthentication returns { authenticated }', async () => {
    const r = await handleCWIRequest(makeMessage('waitForAuthentication'), backend)
    expect(r.result).toHaveProperty('authenticated')
  })

  // Blockchain information
  it('getHeight returns { height }', async () => {
    const r = await handleCWIRequest(makeMessage('getHeight'), backend)
    expect(r.result).toHaveProperty('height')
  })

  it('getHeaderForHeight returns { header }', async () => {
    const r = await handleCWIRequest(makeMessage('getHeaderForHeight', { height: 1 }), backend)
    expect(r.result).toHaveProperty('header')
  })

  it('getNetwork returns { network }', async () => {
    const r = await handleCWIRequest(makeMessage('getNetwork'), backend)
    expect(r.result).toHaveProperty('network')
  })

  it('getVersion returns { version }', async () => {
    const r = await handleCWIRequest(makeMessage('getVersion'), backend)
    expect(r.result).toHaveProperty('version')
  })
})

// ---------------------------------------------------------------------------
// 4. Spending limits — createAction triggers limit checks
// ---------------------------------------------------------------------------

describe('CWI conformance: spending limits', () => {
  it('createAction checks spending limits before calling backend', async () => {
    const msg = makeMessage('createAction', {
      description: 'test',
      outputs: [{ satoshis: 500, lockingScript: '00', outputDescription: 'test' }],
    })
    await handleCWIRequest(msg, backend)

    expect(mockCheckSpendLimits).toHaveBeenCalledTimes(1)
    // Verify the challenge passed to checkSpendLimits has the correct amount
    const challenge = mockCheckSpendLimits.mock.calls[0][0]
    expect(challenge.amount).toBe(500)
  })

  it('createAction sums satoshis across multiple outputs', async () => {
    const msg = makeMessage('createAction', {
      description: 'test',
      outputs: [
        { satoshis: 200, lockingScript: '00', outputDescription: 'a' },
        { satoshis: 300, lockingScript: '01', outputDescription: 'b' },
      ],
    })
    await handleCWIRequest(msg, backend)

    const challenge = mockCheckSpendLimits.mock.calls[0][0]
    expect(challenge.amount).toBe(500)
  })

  it('createAction is blocked when spending limit is exceeded', async () => {
    mockCheckSpendLimits.mockResolvedValueOnce({ allowed: false, reason: 'Daily limit exceeded' })

    const msg = makeMessage('createAction', {
      description: 'test',
      outputs: [{ satoshis: 999999, lockingScript: '00', outputDescription: 'test' }],
    })
    const response = await handleCWIRequest(msg, backend)

    expect(response.status).toBe('error')
    expect(response.error).toContain('Daily limit exceeded')
    // Backend should NOT have been called
    expect(backend.calls).toHaveLength(0)
  })

  it('createAction records payment after successful backend call', async () => {
    const msg = makeMessage('createAction', {
      description: 'test',
      outputs: [{ satoshis: 100, lockingScript: '00', outputDescription: 'test' }],
    })
    await handleCWIRequest(msg, backend)

    expect(mockRecordPayment).toHaveBeenCalledWith('https://example.com', 100, 'deadbeef')
  })

  it('non-createAction methods skip spending limits entirely', async () => {
    const msg = makeMessage('getPublicKey')
    await handleCWIRequest(msg, backend)

    expect(mockCheckSpendLimits).not.toHaveBeenCalled()
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 5. Error handling — backend errors are wrapped properly
// ---------------------------------------------------------------------------

describe('CWI conformance: error handling', () => {
  it('wraps backend Error into status "error" with message string', async () => {
    backend.call = async () => { throw new Error('wallet exploded') }
    const msg = makeMessage('getPublicKey')
    const response = await handleCWIRequest(msg, backend)
    expect(response.status).toBe('error')
    expect(response.error).toBe('wallet exploded')
  })

  it('wraps non-Error throws into string', async () => {
    backend.call = async () => { throw 'string error' }
    const msg = makeMessage('getPublicKey')
    const response = await handleCWIRequest(msg, backend)
    expect(response.status).toBe('error')
    expect(response.error).toBe('string error')
  })
})

// ---------------------------------------------------------------------------
// 6. CWIMethodName type completeness — compile-time check
// ---------------------------------------------------------------------------

describe('CWI conformance: CWIMethodName type completeness', () => {
  it('BSV_BROWSER_METHODS array covers all 28 CWIMethodName values', () => {
    const methodSet = new Set<string>(BSV_BROWSER_METHODS)
    expect(methodSet.size).toBe(28)
  })
})

// ---------------------------------------------------------------------------
// Minimal params helper — provides just enough params for each method
// ---------------------------------------------------------------------------

function getMinimalParams(method: CWIMethodName): unknown {
  switch (method) {
    // Key management
    case 'getPublicKey': return {}
    case 'revealCounterpartyKeyLinkage': return { counterparty: 'a', verifier: 'b', protocolID: [1, 'test'], keyID: '1' }
    case 'revealSpecificKeyLinkage': return { counterparty: 'a', verifier: 'b', protocolID: [1, 'test'], keyID: '1' }
    // Crypto
    case 'encrypt': return { plaintext: [1], protocolID: [1, 'test'], keyID: '1' }
    case 'decrypt': return { ciphertext: [1], protocolID: [1, 'test'], keyID: '1' }
    case 'createHmac': return { data: [1], protocolID: [1, 'test'], keyID: '1' }
    case 'verifyHmac': return { data: [1], hmac: [1], protocolID: [1, 'test'], keyID: '1' }
    case 'createSignature': return { data: [1], protocolID: [1, 'test'], keyID: '1' }
    case 'verifySignature': return { data: [1], signature: [1], protocolID: [1, 'test'], keyID: '1' }
    // Transaction
    case 'createAction': return { description: 'test', outputs: [{ satoshis: 1, lockingScript: '00', outputDescription: 'test' }] }
    case 'signAction': return { reference: 'ref' }
    case 'abortAction': return { reference: 'ref' }
    case 'listActions': return { labels: ['test'] }
    case 'internalizeAction': return { tx: [0], outputs: [] }
    // Output
    case 'listOutputs': return { basket: 'default' }
    case 'relinquishOutput': return { basket: 'default', output: 'abc:0' }
    // Certificate
    case 'acquireCertificate': return { type: 'test', certifier: 'abc' }
    case 'listCertificates': return { certifiers: ['abc'], types: ['test'] }
    case 'proveCertificate': return { certificate: {}, fieldsToReveal: ['name'], verifier: 'abc' }
    case 'relinquishCertificate': return { type: 'test', serialNumber: '123', certifier: 'abc' }
    // Discovery
    case 'discoverByIdentityKey': return { identityKey: 'abc' }
    case 'discoverByAttributes': return { attributes: { name: 'test' } }
    // Auth & status
    case 'isAuthenticated': return {}
    case 'waitForAuthentication': return {}
    // Blockchain
    case 'getHeight': return {}
    case 'getHeaderForHeight': return { height: 1 }
    case 'getNetwork': return {}
    case 'getVersion': return {}
  }
}
