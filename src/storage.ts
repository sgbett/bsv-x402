import type { LedgerEntry, LimitState, SitePolicy, StorageAdapter } from "./types"

const STATE_KEY = "x402:limit-state"
const POLICIES_KEY = "x402:site-policies"

export type KeyDeriver = () => Promise<Uint8Array>

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

export class LocalStorageAdapter implements StorageAdapter {
  private keyDeriver?: KeyDeriver
  private storage: Pick<Storage, "getItem" | "setItem">

  constructor(
    keyDeriver?: KeyDeriver,
    storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    this.keyDeriver = keyDeriver
    this.storage = storage ?? globalThis.localStorage
  }

  async load(): Promise<LimitState | null> {
    const raw = this.storage.getItem(STATE_KEY)
    if (!raw) return null

    let state: LimitState
    try {
      state = JSON.parse(raw)
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
    this.storage.setItem(STATE_KEY, JSON.stringify(state))
  }

  async loadSitePolicies(): Promise<Record<string, SitePolicy>> {
    const raw = this.storage.getItem(POLICIES_KEY)
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  async saveSitePolicies(policies: Record<string, SitePolicy>): Promise<void> {
    this.storage.setItem(POLICIES_KEY, JSON.stringify(policies))
  }
}

// === On-chain anchoring (stubs) ===

export async function anchorToChain(_entries: LimitState["entries"]): Promise<string> {
  throw new Error("Not implemented — requires BRC-100 wallet integration")
}

export async function reconstructFromChain(_anchorTxid: string): Promise<LimitState> {
  throw new Error("Not implemented — requires BRC-100 wallet integration")
}
