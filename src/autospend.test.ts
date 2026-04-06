import { describe, expect, it } from "vitest"
import {
  TIER_CAPS,
  WEAPON_CAPS,
  PICKUP_PERCENTAGES,
  checkPayment,
  recordPayment,
  applyPickup,
  clampBalanceToTier,
  initialState,
} from "./autospend"
import type { AutospendConfig, AutospendState } from "./types"

const HMP: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }

describe("TIER_CAPS", () => {
  it("has Doom II difficulty progression", () => {
    expect(TIER_CAPS["I'm Too Young to Die"]).toBe(1_000_000)
    expect(TIER_CAPS["Hey, Not Too Rough"]).toBe(10_000_000)
    expect(TIER_CAPS["Hurt Me Plenty"]).toBe(100_000_000)
    expect(TIER_CAPS["Ultra-Violence"]).toBe(1_000_000_000)
    expect(TIER_CAPS["Nightmare!"]).toBe(100_000_000_000)
  })
})

describe("WEAPON_CAPS", () => {
  it("has weapon progression with BFG9000 uncapped", () => {
    expect(WEAPON_CAPS["Fists"]).toBe(100_000)
    expect(WEAPON_CAPS["Pistol"]).toBe(500_000)
    expect(WEAPON_CAPS["BFG9000"]).toBe(Infinity)
  })
})

describe("checkPayment", () => {
  it("auto-approves when amount is under both weapon and balance", () => {
    const state: AutospendState = { balance: 10_000_000 }
    expect(checkPayment(100_000, state, HMP)).toBe("auto")
  })

  it("requires confirmation when amount exceeds weapon cap", () => {
    const state: AutospendState = { balance: 100_000_000 } // plenty of balance
    expect(checkPayment(600_000, state, HMP)).toBe("confirm") // Pistol = 500k
  })

  it("requires confirmation when amount exceeds balance", () => {
    const state: AutospendState = { balance: 50_000 } // small balance
    // Amount under weapon cap (500k Pistol) but over balance
    expect(checkPayment(100_000, state, HMP)).toBe("confirm")
  })

  it("auto-approves exact match of effective max", () => {
    const state: AutospendState = { balance: 500_000 }
    expect(checkPayment(500_000, state, HMP)).toBe("auto")
  })

  it("BFG9000 is bound only by balance", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "BFG9000" }
    const state: AutospendState = { balance: 100_000_000 }
    expect(checkPayment(100_000_000, state, config)).toBe("auto")
    expect(checkPayment(100_000_001, state, config)).toBe("confirm")
  })
})

describe("recordPayment", () => {
  it("deducts the payment amount from balance", () => {
    const state: AutospendState = { balance: 1_000_000 }
    expect(recordPayment(250_000, state)).toEqual({ balance: 750_000 })
  })

  it("clamps to zero (never negative)", () => {
    const state: AutospendState = { balance: 100_000 }
    expect(recordPayment(500_000, state)).toEqual({ balance: 0 })
  })

  it("does not mutate the input state", () => {
    const state: AutospendState = { balance: 1_000_000 }
    recordPayment(250_000, state)
    expect(state.balance).toBe(1_000_000)
  })
})

describe("applyPickup", () => {
  const walletBalance = 10_000_000_000 // 100 BSV, well above any tier cap

  it("Medkit adds 10% of tier cap", () => {
    const state: AutospendState = { balance: 0 }
    const result = applyPickup("Medkit", state, HMP, walletBalance)
    expect(result.balance).toBe(10_000_000) // 10% of 100M
  })

  it("Stimpak adds 25% of tier cap", () => {
    const state: AutospendState = { balance: 0 }
    const result = applyPickup("Stimpak", state, HMP, walletBalance)
    expect(result.balance).toBe(25_000_000)
  })

  it("Soul Sphere adds 100% of tier cap", () => {
    const state: AutospendState = { balance: 0 }
    const result = applyPickup("Soul Sphere", state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000)
  })

  it("New Game hard-sets balance to tier cap", () => {
    const state: AutospendState = { balance: 50_000_000 }
    const result = applyPickup("New Game", state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000)
  })

  it("pickups cap at tier cap (no overflow)", () => {
    const state: AutospendState = { balance: 99_000_000 }
    const result = applyPickup("Soul Sphere", state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000) // not 199M
  })

  it("pickups cap at wallet balance", () => {
    const state: AutospendState = { balance: 0 }
    const result = applyPickup("Soul Sphere", state, HMP, 5_000_000) // only 5M in wallet
    expect(result.balance).toBe(5_000_000) // not 100M
  })

  it("New Game respects wallet balance cap", () => {
    const state: AutospendState = { balance: 100_000 }
    const result = applyPickup("New Game", state, HMP, 5_000_000)
    expect(result.balance).toBe(5_000_000)
  })

  it("pickup on full balance is a no-op", () => {
    const state: AutospendState = { balance: 100_000_000 }
    const result = applyPickup("Medkit", state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000)
  })
})

describe("clampBalanceToTier", () => {
  it("leaves balance unchanged if under cap", () => {
    const state: AutospendState = { balance: 50_000_000 }
    const result = clampBalanceToTier(state, HMP, 10_000_000_000)
    expect(result.balance).toBe(50_000_000)
  })

  it("clamps balance to tier cap when above", () => {
    const state: AutospendState = { balance: 500_000_000 }
    const newTier: AutospendConfig = { tier: "Hey, Not Too Rough", weapon: "Pistol" }
    const result = clampBalanceToTier(state, newTier, 10_000_000_000)
    expect(result.balance).toBe(10_000_000) // Hey Not Too Rough cap
  })

  it("clamps to wallet balance when lower than tier cap", () => {
    const state: AutospendState = { balance: 50_000_000 }
    const result = clampBalanceToTier(state, HMP, 20_000_000) // wallet < tier cap
    expect(result.balance).toBe(20_000_000)
  })
})

describe("initialState", () => {
  it("starts at tier cap", () => {
    const state = initialState(HMP, 10_000_000_000)
    expect(state.balance).toBe(100_000_000)
  })

  it("starts at wallet balance when lower than tier cap", () => {
    const state = initialState(HMP, 50_000_000)
    expect(state.balance).toBe(50_000_000)
  })
})
