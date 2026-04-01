/// <reference types="chrome" />

import type { LedgerEntry, LimitState, SitePolicy, StorageAdapter } from "../../src/types"

const STATE_KEY = "x402_limit_state"
const POLICIES_KEY = "x402_site_policies"

type KeyDeriver = () => Promise<Uint8Array>

async function computeHmac(data: string, key: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const encoded = new TextEncoder().encode(data)
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoded)
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function serializeForHmac(state: LimitState): string {
  return JSON.stringify({
    entries: state.entries,
    circuitBroken: state.circuitBroken,
  })
}

export class ExtensionStorageAdapter implements StorageAdapter {
  private keyDeriver?: KeyDeriver

  constructor(keyDeriver?: KeyDeriver) {
    this.keyDeriver = keyDeriver
  }

  async load(): Promise<LimitState | null> {
    const result = await chrome.storage.local.get(STATE_KEY)
    const raw = result[STATE_KEY]
    if (raw == null) return null

    let state: LimitState
    try {
      state = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      console.warn("x402: limit state JSON parse failed — treating as tampered")
      return { entries: [], circuitBroken: true, hmac: "" }
    }

    if (this.keyDeriver) {
      if (!state.hmac) {
        console.warn("x402: limit state missing HMAC — treating as tampered")
        return { entries: [], circuitBroken: true, hmac: "" }
      }
      const key = await this.keyDeriver()
      const expected = await computeHmac(serializeForHmac(state), key)
      if (expected !== state.hmac) {
        console.warn("x402: limit state HMAC mismatch — state may have been tampered with")
        return { entries: [], circuitBroken: true, hmac: "" }
      }
    }

    // Sanitise loaded entries — drop anything that could corrupt limit calculations
    state.entries = (Array.isArray(state.entries) ? state.entries : []).filter(
      (e): e is LedgerEntry =>
        e != null &&
        typeof e.origin === "string" &&
        typeof e.txid === "string" &&
        typeof e.satoshis === "number" && Number.isFinite(e.satoshis) && e.satoshis >= 0 &&
        typeof e.timestamp === "number" && Number.isFinite(e.timestamp) && e.timestamp > 0,
    )

    return state
  }

  async save(state: LimitState): Promise<void> {
    if (this.keyDeriver) {
      const key = await this.keyDeriver()
      state.hmac = await computeHmac(serializeForHmac(state), key)
    }
    await chrome.storage.local.set({ [STATE_KEY]: state })
  }

  async loadSitePolicies(): Promise<Record<string, SitePolicy>> {
    const empty: Record<string, SitePolicy> = {}
    const result = await chrome.storage.local.get(POLICIES_KEY)
    const raw = result[POLICIES_KEY]
    if (raw == null) return empty
    try {
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, SitePolicy>
    } catch {
      return empty
    }
  }

  async saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void> {
    await chrome.storage.local.set({ [POLICIES_KEY]: policies })
  }
}
