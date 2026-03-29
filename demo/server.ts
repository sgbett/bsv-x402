import express from "express"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3402

// Parse JSON bodies (for future use)
app.use(express.json())

// Serve the demo page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

// Serve the built library from dist/
app.use("/dist", express.static(path.join(__dirname, "..", "dist")))

// --- Endpoints ---

// Free endpoint — always 200
app.get("/api/free", (_req, res) => {
  res.json({
    content: "This content is free! No payment required.",
    timestamp: new Date().toISOString(),
  })
})

// Helper: check for proof or return 402
function paidEndpoint(
  amount: number,
  content: string,
) {
  return (req: express.Request, res: express.Response) => {
    const proofHeader = req.headers["x402-proof"]

    if (proofHeader) {
      // Accept any proof (mock server — no real verification)
      let proof
      try {
        proof = JSON.parse(proofHeader as string)
      } catch {
        res.status(400).json({ error: "Invalid X402-Proof header" })
        return
      }

      res.json({
        content,
        paid: true,
        txid: proof.txid,
        amount,
        timestamp: new Date().toISOString(),
      })
      return
    }

    // No proof — return 402 with challenge
    const challenge = {
      nonce: `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payee: "1DemoPayeeAddress1234567890abcdef",
      amount,
      network: "mainnet",
    }

    res.status(402)
      .set("X402-Challenge", JSON.stringify(challenge))
      .json({
        error: "Payment Required",
        challenge,
      })
  }
}

// Article — cheap (100k sats ≈ $0.15)
app.get("/api/article", paidEndpoint(
  100_000,
  "The x402 protocol enables seamless micropayments on the web. This article was paid for with BSV — the original Bitcoin.",
))

// Premium — moderate (5M sats ≈ $0.75)
app.get("/api/premium", paidEndpoint(
  5_000_000,
  "PREMIUM: Deep dive into BRC-100 wallet integration. The CWI (Common Wallet Interface) provides a vendor-neutral API...",
))

// Whale — expensive (50M sats ≈ $7.50)
app.get("/api/whale", paidEndpoint(
  50_000_000,
  "WHALE CONTENT: Exclusive on-chain analytics dashboard with real-time mempool data and mining pool distribution.",
))

// VIP — triggers 2FA on "Hey, Not Too Rough" (threshold 50M, this is 60M)
app.get("/api/vip", paidEndpoint(
  60_000_000,
  "VIP ACCESS: Full historical blockchain dataset with raw block data, transaction graphs, and UTXO snapshots.",
))

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║          x402 Spending Limits Demo           ║
  ║                                              ║
  ║   http://localhost:${PORT}                     ║
  ║                                              ║
  ║   Endpoints:                                 ║
  ║     GET /api/free      — 200 (always free)   ║
  ║     GET /api/article   — 402 (100k sats)     ║
  ║     GET /api/premium   — 402 (5M sats)       ║
  ║     GET /api/whale     — 402 (50M sats)      ║
  ║     GET /api/vip       — 402 (60M sats) 2FA  ║
  ╚══════════════════════════════════════════════╝
  `)
})
