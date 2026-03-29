import { parseChallenge } from "./challenge"
import type { Proof } from "./types"

export async function x402Fetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)

  if (response.status !== 402) {
    return response
  }

  const challengeHeader = response.headers.get("X402-Challenge")
  if (!challengeHeader) {
    return response
  }

  const challenge = parseChallenge(challengeHeader)
  const proof = await constructProof(challenge)

  const headers = new Headers(init?.headers)
  headers.set("X402-Proof", JSON.stringify(proof))

  return fetch(input, { ...init, headers })
}

async function constructProof(challenge: { nonce: string; payee: string; amount: number; network: string }): Promise<Proof> {
  // TODO: Call window.CWI.createAction() to build payment transaction
  // TODO: Broadcast to BSV network
  throw new Error("Not implemented — requires BRC-100 wallet (window.CWI)")
}
