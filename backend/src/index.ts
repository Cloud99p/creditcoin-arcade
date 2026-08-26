/**
 * Arcade backend — game API.
 * Auth, score validation, room clock hooks, settlement triggers, and the
 * omnilearn "Arcade Intelligence" layer. On-chain settlement lives in the
 * contracts; this service coordinates off-chain state + fires recordings of
 * every Attestcoin-verified result to the knowledge graph.
 */
import "dotenv/config";
import express from "express";
import { recordScore } from "./intelligence/omniClient.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);

app.get("/health", (_req, res) => {
  res.json({ ok: true, chain: "creditcoin-cc3-testnet", service: "arcade-backend" });
});

/**
 * POST /score/submit — called by the worker after an Attestcoin ScoreVerified
 * event lands. Records the verified result to the omnilearn graph (Arcade
 * Intelligence) for adaptive leaderboard payouts and room discovery.
 */
app.post("/score/submit", async (req, res) => {
  const { gameId, player, score, mode, roomId, txHash } = req.body ?? {};
  if (!gameId || !player || typeof score !== "number") {
    res.status(400).json({ error: "gameId, player (address), and numeric score required" });
    return;
  }
  // fire-and-forget recording; never blocks the response
  void recordScore({ gameId, player, score, mode: mode || "global", roomId, txHash });
  res.json({ ok: true, recorded: true, gameId, player, score, txHash });
});

app.listen(PORT, () => {
  console.log(`arcade-backend listening on :${PORT}`);
});
