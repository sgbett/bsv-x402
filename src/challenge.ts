import type { Challenge } from "./types"

export function parseChallenge(header: string): Challenge {
  let parsed: unknown
  try {
    parsed = JSON.parse(header)
  } catch {
    throw new Error("X402-Challenge: invalid JSON")
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("X402-Challenge: expected object")
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.nonce !== "string" || obj.nonce.length === 0) {
    throw new Error("X402-Challenge: missing or invalid nonce")
  }
  if (typeof obj.payee !== "string" || obj.payee.length === 0) {
    throw new Error("X402-Challenge: missing or invalid payee")
  }
  if (typeof obj.network !== "string" || obj.network.length === 0) {
    throw new Error("X402-Challenge: missing or invalid network")
  }
  if (
    typeof obj.amount !== "number" ||
    !Number.isFinite(obj.amount) ||
    !Number.isInteger(obj.amount) ||
    obj.amount <= 0
  ) {
    throw new Error("X402-Challenge: amount must be a positive integer")
  }

  return {
    nonce: obj.nonce,
    payee: obj.payee,
    amount: obj.amount,
    network: obj.network,
  }
}
