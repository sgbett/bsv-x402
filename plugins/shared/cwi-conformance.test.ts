/**
 * BSV Browser CWI Conformance Tests
 *
 * These tests verify that our CWI implementation exposes the same interface
 * as the BSV Browser (bsv-blockchain/bsv-browser) and the canonical BRC-100
 * wallet specification (bsv-blockchain/ts-sdk Wallet.interfaces.ts).
 *
 * Reference: BSV Browser handles CWI calls in app/browser.tsx via a message
 * handler that forwards `{ call, args, id }` messages to the wallet object.
 * The wallet implements all 28 BRC-100 WalletInterface methods.
 *
 * These tests should be kept in sync with BSV Browser's interface. If new
 * methods are added upstream, they must be added here and to our implementation.
 *
 * SYNC REFERENCE:
 *   - bsv-blockchain/bsv-browser  app/browser.tsx  (handleMessage wallet methods)
 *   - bsv-blockchain/ts-sdk       src/wallet/Wallet.interfaces.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { handleCWIRequest, type CWIHandlerContext } from './cwi'
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
// Test context (unlocked wallet)
// ---------------------------------------------------------------------------

let context: CWIHandlerContext

beforeEach(() => {
  context = {
    getSeed: () => 'test-seed-conformance',
    isUnlocked: () => true,
    getNetwork: () => 'main',
  }
})

function makeMessage(method: CWIMethodName, params: unknown = {}): ContentToBackgroundMessage {
  return {
    request: { id: `test-${method}`, method, params },
    origin: 'https://example.com',
  }
}

// ---------------------------------------------------------------------------
// 1. Interface completeness — every BSV Browser method is handled
// ---------------------------------------------------------------------------

describe('CWI conformance: interface completeness', () => {
  it('handles all 28 BSV Browser wallet methods', () => {
    expect(BSV_BROWSER_METHODS).toHaveLength(28)
  })

  for (const method of BSV_BROWSER_METHODS) {
    it(`handles "${method}" without returning "Unknown method" error`, async () => {
      const msg = makeMessage(method, getMinimalParams(method))
      const response = await handleCWIRequest(msg, context)
      expect(response.status).toBe('ok')
      expect(response.error).toBeUndefined()
    })
  }
})

// ---------------------------------------------------------------------------
// 2. Message format — matches BSV Browser's { call, args, id } → { type: 'CWI', id, result, status }
// ---------------------------------------------------------------------------

describe('CWI conformance: message format', () => {
  it('response includes id matching request', async () => {
    const msg = makeMessage('getNetwork')
    const response = await handleCWIRequest(msg, context)
    expect(response.id).toBe('test-getNetwork')
  })

  it('successful response has status "ok" and result', async () => {
    const msg = makeMessage('getNetwork')
    const response = await handleCWIRequest(msg, context)
    expect(response.status).toBe('ok')
    expect(response.result).toBeDefined()
  })

  it('error response has status "error" and error string', async () => {
    // Missing required params for createAction
    const msg = makeMessage('createAction', {})
    const response = await handleCWIRequest(msg, context)
    expect(response.status).toBe('error')
    expect(response.error).toBeDefined()
    expect(typeof response.error).toBe('string')
  })

  it('locked wallet returns error for all methods except isAuthenticated pattern', async () => {
    const lockedContext: CWIHandlerContext = {
      ...context,
      isUnlocked: () => false,
    }
    const msg = makeMessage('createAction', { outputs: [] })
    const response = await handleCWIRequest(msg, lockedContext)
    expect(response.status).toBe('error')
    expect(response.error).toContain('locked')
  })
})

// ---------------------------------------------------------------------------
// 3. Response shapes — verify each method returns expected fields
// ---------------------------------------------------------------------------

describe('CWI conformance: response shapes', () => {
  // Key management
  it('getPublicKey returns { publicKey }', async () => {
    const r = await handleCWIRequest(makeMessage('getPublicKey'), context)
    expect(r.result).toHaveProperty('publicKey')
  })

  it('revealCounterpartyKeyLinkage returns { encryptedLinkage, encryptedLinkageProof }', async () => {
    const r = await handleCWIRequest(makeMessage('revealCounterpartyKeyLinkage', {
      counterparty: 'abc', verifier: 'def', protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('encryptedLinkage')
    expect(r.result).toHaveProperty('encryptedLinkageProof')
  })

  it('revealSpecificKeyLinkage returns { encryptedLinkage, encryptedLinkageProof }', async () => {
    const r = await handleCWIRequest(makeMessage('revealSpecificKeyLinkage', {
      counterparty: 'abc', verifier: 'def', protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('encryptedLinkage')
    expect(r.result).toHaveProperty('encryptedLinkageProof')
  })

  // Cryptographic operations
  it('encrypt returns { ciphertext }', async () => {
    const r = await handleCWIRequest(makeMessage('encrypt', {
      plaintext: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('ciphertext')
  })

  it('decrypt returns { plaintext }', async () => {
    const r = await handleCWIRequest(makeMessage('decrypt', {
      ciphertext: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('plaintext')
  })

  it('createHmac returns { hmac }', async () => {
    const r = await handleCWIRequest(makeMessage('createHmac', {
      data: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('hmac')
  })

  it('verifyHmac returns { valid }', async () => {
    const r = await handleCWIRequest(makeMessage('verifyHmac', {
      data: [1, 2, 3], hmac: [4, 5, 6], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('valid')
  })

  it('createSignature returns { signature }', async () => {
    const r = await handleCWIRequest(makeMessage('createSignature', {
      data: [1, 2, 3], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('signature')
  })

  it('verifySignature returns { valid }', async () => {
    const r = await handleCWIRequest(makeMessage('verifySignature', {
      data: [1, 2, 3], signature: [4, 5, 6], protocolID: [1, 'test'], keyID: '1',
    }), context)
    expect(r.result).toHaveProperty('valid')
  })

  // Transaction management
  it('createAction returns { txid }', async () => {
    const r = await handleCWIRequest(makeMessage('createAction', {
      description: 'test payment',
      outputs: [{ satoshis: 100, lockingScript: '76a914aabb88ac', outputDescription: 'test' }],
    }), context)
    expect(r.result).toHaveProperty('txid')
  })

  it('signAction returns { txid }', async () => {
    const r = await handleCWIRequest(makeMessage('signAction', { reference: 'ref-123' }), context)
    expect(r.result).toHaveProperty('txid')
  })

  it('abortAction returns { aborted }', async () => {
    const r = await handleCWIRequest(makeMessage('abortAction', { reference: 'ref-123' }), context)
    expect(r.result).toHaveProperty('aborted')
  })

  it('listActions returns { totalActions, actions }', async () => {
    const r = await handleCWIRequest(makeMessage('listActions', { labels: ['test'] }), context)
    expect(r.result).toHaveProperty('totalActions')
    expect(r.result).toHaveProperty('actions')
  })

  it('internalizeAction returns { accepted }', async () => {
    const r = await handleCWIRequest(makeMessage('internalizeAction', { tx: [0], outputs: [] }), context)
    expect(r.result).toHaveProperty('accepted')
  })

  // Output management
  it('listOutputs returns { totalOutputs, outputs }', async () => {
    const r = await handleCWIRequest(makeMessage('listOutputs', { basket: 'default' }), context)
    expect(r.result).toHaveProperty('totalOutputs')
    expect(r.result).toHaveProperty('outputs')
  })

  it('relinquishOutput returns { relinquished }', async () => {
    const r = await handleCWIRequest(makeMessage('relinquishOutput', { basket: 'default', output: 'abc:0' }), context)
    expect(r.result).toHaveProperty('relinquished')
  })

  // Certificate management
  it('acquireCertificate returns { type, subject, serialNumber, certifier, fields, signature }', async () => {
    const r = await handleCWIRequest(makeMessage('acquireCertificate', { type: 'test', certifier: 'abc' }), context)
    const result = r.result as Record<string, unknown>
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('serialNumber')
    expect(result).toHaveProperty('certifier')
    expect(result).toHaveProperty('fields')
    expect(result).toHaveProperty('signature')
  })

  it('listCertificates returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('listCertificates', { certifiers: ['abc'], types: ['test'] }), context)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  it('proveCertificate returns { keyForVerifier }', async () => {
    const r = await handleCWIRequest(makeMessage('proveCertificate', {
      certificate: {}, fieldsToReveal: ['name'], verifier: 'abc',
    }), context)
    expect(r.result).toHaveProperty('keyForVerifier')
  })

  it('relinquishCertificate returns { relinquished }', async () => {
    const r = await handleCWIRequest(makeMessage('relinquishCertificate', {
      type: 'test', serialNumber: '123', certifier: 'abc',
    }), context)
    expect(r.result).toHaveProperty('relinquished')
  })

  // Certificate discovery
  it('discoverByIdentityKey returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('discoverByIdentityKey', { identityKey: 'abc' }), context)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  it('discoverByAttributes returns { totalCertificates, certificates }', async () => {
    const r = await handleCWIRequest(makeMessage('discoverByAttributes', { attributes: { name: 'test' } }), context)
    expect(r.result).toHaveProperty('totalCertificates')
    expect(r.result).toHaveProperty('certificates')
  })

  // Authentication & status
  it('isAuthenticated returns { authenticated }', async () => {
    const r = await handleCWIRequest(makeMessage('isAuthenticated'), context)
    expect(r.result).toHaveProperty('authenticated')
    expect((r.result as { authenticated: boolean }).authenticated).toBe(true)
  })

  it('waitForAuthentication returns { authenticated }', async () => {
    const r = await handleCWIRequest(makeMessage('waitForAuthentication'), context)
    expect(r.result).toHaveProperty('authenticated')
  })

  // Blockchain information
  it('getHeight returns { height }', async () => {
    const r = await handleCWIRequest(makeMessage('getHeight'), context)
    expect(r.result).toHaveProperty('height')
  })

  it('getHeaderForHeight returns { header }', async () => {
    const r = await handleCWIRequest(makeMessage('getHeaderForHeight', { height: 1 }), context)
    expect(r.result).toHaveProperty('header')
  })

  it('getNetwork returns { network } with "mainnet" or "testnet"', async () => {
    const r = await handleCWIRequest(makeMessage('getNetwork'), context)
    const result = r.result as { network: string }
    expect(result).toHaveProperty('network')
    expect(['mainnet', 'testnet']).toContain(result.network)
  })

  it('getVersion returns { version }', async () => {
    const r = await handleCWIRequest(makeMessage('getVersion'), context)
    expect(r.result).toHaveProperty('version')
  })
})

// ---------------------------------------------------------------------------
// 4. Parameter validation — methods reject missing required params
// ---------------------------------------------------------------------------

describe('CWI conformance: parameter validation', () => {
  const methodsWithRequiredParams: Array<[CWIMethodName, string[]]> = [
    ['createAction', ['outputs']],
    ['signAction', ['reference']],
    ['abortAction', ['reference']],
    ['listActions', ['labels']],
    ['internalizeAction', ['tx', 'outputs']],
    ['listOutputs', ['basket']],
    ['relinquishOutput', ['basket', 'output']],
    ['acquireCertificate', ['type', 'certifier']],
    ['listCertificates', ['certifiers', 'types']],
    ['proveCertificate', ['certificate', 'fieldsToReveal', 'verifier']],
    ['relinquishCertificate', ['type', 'serialNumber', 'certifier']],
    ['discoverByIdentityKey', ['identityKey']],
    ['discoverByAttributes', ['attributes']],
    ['getHeaderForHeight', ['height']],
    ['encrypt', ['plaintext', 'protocolID', 'keyID']],
    ['decrypt', ['ciphertext', 'protocolID', 'keyID']],
    ['createHmac', ['data', 'protocolID', 'keyID']],
    ['verifyHmac', ['data', 'hmac', 'protocolID', 'keyID']],
    ['revealCounterpartyKeyLinkage', ['counterparty', 'verifier']],
    ['revealSpecificKeyLinkage', ['counterparty', 'verifier', 'protocolID', 'keyID']],
  ]

  for (const [method, requiredKeys] of methodsWithRequiredParams) {
    it(`${method} rejects empty params (requires: ${requiredKeys.join(', ')})`, async () => {
      const msg = makeMessage(method, {})
      const response = await handleCWIRequest(msg, context)
      expect(response.status).toBe('error')
      expect(response.error).toContain('Missing required parameter')
    })
  }
})

// ---------------------------------------------------------------------------
// 5. CWIMethodName type completeness — compile-time check
// ---------------------------------------------------------------------------

describe('CWI conformance: CWIMethodName type completeness', () => {
  it('BSV_BROWSER_METHODS array covers all CWIMethodName values', () => {
    // This is a runtime check that the constant array matches.
    // A compile-time check exists via the dispatch table in cwi.ts —
    // TypeScript will error if a CWIMethodName is missing from the Record.
    const methodSet = new Set<string>(BSV_BROWSER_METHODS)
    expect(methodSet.size).toBe(28)
  })
})

// ---------------------------------------------------------------------------
// Minimal params helper — provides just enough params for each method to
// pass validation (not necessarily produce real results)
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
