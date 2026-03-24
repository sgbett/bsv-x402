import type { Challenge } from "./types"

export function parseChallenge(header: string): Challenge {
  return JSON.parse(header)
}
