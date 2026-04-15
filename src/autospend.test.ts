import { describe, expect, it } from "vitest"
import {
  TIER_CAPS,
  WEAPON_CAPS,
  PICKUP_PERCENTAGES,
  checkPayment,
  recordPayment,
  recordRefund,
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

  it("rejects invalid amounts (NaN, Infinity, negative, zero)", () => {
    const state: AutospendState = { balance: 1_000_000 }
    expect(checkPayment(NaN, state, HMP)).toBe("confirm")
    expect(checkPayment(Infinity, state, HMP)).toBe("confirm")
    expect(checkPayment(-100, state, HMP)).toBe("confirm")
    expect(checkPayment(0, state, HMP)).toBe("confirm")
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

  it("ignores invalid amounts (does not increase balance on negative)", () => {
    const state: AutospendState = { balance: 1_000_000 }
    expect(recordPayment(-500, state)).toEqual({ balance: 1_000_000 })
    expect(recordPayment(NaN, state)).toEqual({ balance: 1_000_000 })
    expect(recordPayment(Infinity, state)).toEqual({ balance: 1_000_000 })
    expect(recordPayment(0, state)).toEqual({ balance: 1_000_000 })
  })
})

describe("recordRefund", () => {
  const walletBalance = 10_000_000_000

  it("increases balance by the refund amount", () => {
    const state: AutospendState = { balance: 50_000_000 }
    const result = recordRefund(10_000_000, state, HMP, walletBalance)
    expect(result.balance).toBe(60_000_000)
  })

  it("caps refund at tier cap", () => {
    const state: AutospendState = { balance: 95_000_000 }
    const result = recordRefund(20_000_000, state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000) // HMP tier cap, not 115M
  })

  it("caps refund at wallet balance when wallet balance < tier cap", () => {
    const state: AutospendState = { balance: 40_000_000 }
    const result = recordRefund(20_000_000, state, HMP, 50_000_000)
    expect(result.balance).toBe(50_000_000) // wallet balance cap, not 60M
  })

  it("returns state unchanged for invalid amounts", () => {
    const state: AutospendState = { balance: 50_000_000 }
    expect(recordRefund(NaN, state, HMP, walletBalance)).toBe(state)
    expect(recordRefund(Infinity, state, HMP, walletBalance)).toBe(state)
    expect(recordRefund(-100, state, HMP, walletBalance)).toBe(state)
    expect(recordRefund(0, state, HMP, walletBalance)).toBe(state)
  })

  it("refund after spend restores balance correctly", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }
    let state = initialState(config, walletBalance) // 100_000_000
    state = recordPayment(30_000_000, state) // 70_000_000
    state = recordRefund(15_000_000, state, config, walletBalance) // 85_000_000
    expect(state.balance).toBe(85_000_000)
  })

  it("refund at full balance is a no-op", () => {
    const state: AutospendState = { balance: 100_000_000 } // at HMP tier cap
    const result = recordRefund(10_000_000, state, HMP, walletBalance)
    expect(result.balance).toBe(100_000_000)
  })

  it("refund after full depletion restores balance to refund amount", () => {
    const state: AutospendState = { balance: 0 }
    const result = recordRefund(25_000_000, state, HMP, walletBalance)
    expect(result.balance).toBe(25_000_000)
  })

  it("does not mutate the input state", () => {
    const state: AutospendState = { balance: 50_000_000 }
    recordRefund(10_000_000, state, HMP, walletBalance)
    expect(state.balance).toBe(50_000_000)
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

describe("spend/refund cycle integration", () => {
  it("spend then partial refund yields correct net spend", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }
    const walletBalance = 10_000_000_000
    let state = initialState(config, walletBalance) // 100_000_000

    state = recordPayment(50_000, state) // 99_950_000
    expect(state.balance).toBe(99_950_000)

    state = recordRefund(30_000, state, config, walletBalance) // 99_980_000
    expect(state.balance).toBe(99_980_000)
  })

  it("refund exceeding original spend is capped at tier cap", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }
    const walletBalance = 10_000_000_000
    let state = initialState(config, walletBalance) // 100_000_000

    state = recordPayment(50_000, state) // 99_950_000
    state = recordRefund(100_000, state, config, walletBalance) // capped at 100_000_000
    expect(state.balance).toBe(100_000_000)
  })

  it("multiple spend/refund cycles yield correct net balance", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }
    const walletBalance = 10_000_000_000
    let state = initialState(config, walletBalance) // 100_000_000

    state = recordPayment(10_000, state)   // 99_990_000
    state = recordPayment(20_000, state)   // 99_970_000
    state = recordRefund(15_000, state, config, walletBalance) // 99_985_000
    state = recordPayment(5_000, state)    // 99_980_000
    state = recordRefund(10_000, state, config, walletBalance) // 99_990_000
    // net: -10k -20k +15k -5k +10k = -10k
    expect(state.balance).toBe(99_990_000)
  })

  it("wallet balance constrains refund during cycle", () => {
    const config: AutospendConfig = { tier: "Hurt Me Plenty", weapon: "Pistol" }
    const walletBalance = 50_000_000 // below tier cap of 100M
    let state = initialState(config, walletBalance) // 50_000_000

    state = recordPayment(10_000, state) // 49_990_000
    state = recordRefund(20_000, state, config, walletBalance) // capped at 50_000_000
    expect(state.balance).toBe(50_000_000)
  })
})
