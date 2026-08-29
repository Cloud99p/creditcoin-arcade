/**
 * Arcade backend — full game + economy API.
 *
 * Auth (wallet), games catalog, score submission, global leaderboards,
 * discrete rooms with escrow + settlement, marketplace (shop/spin/equip),
 * economy (ARCFT balance, house cut, winnings pool), and a stats/snapshot
 * endpoint for the hub UI. Settlement triggers are structured for the
 * Attestcoin worker (on-chain provenance via ScoreASC).
 */
import "dotenv/config";
import express from "express";
import { randomBytes } from "node:crypto";
import { Store } from "./store.js";
import { Economy } from "./economy.js";
import { GAME_LIST, GAMES, MARKETPLACE } from "./types.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const store = new Store();
const economy = new Economy(store);

// Simple demo auth: an address header. In prod replace with a signed
// challenge (EIP-1193 personal_sign) verified via ethers.verifyMessage.
function authedAddress(req: express.Request): string {
  const addr = (req.headers["x-address"] as string) || "";
  if (!addr) throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
  return addr.toLowerCase();
}
function userOf(addr: string) {
  return store.ensureUser(addr);
}

const handle = (fn: (req: express.Request, res: express.Response) => unknown | Promise<unknown>) => {
  return async (req: express.Request, res: express.Response) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err: any) {
      const status = err.status || (err.message && err.message.includes("NOT_FOUND") ? 404 : 400);
      res.status(status).json({ error: err.message || "INTERNAL" });
    }
  };
};

// ---------------------------------------------------------------------------
// Health / meta
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, chain: "creditcoin-cc3-testnet", service: "arcade-backend", games: GAME_LIST.length });
});

app.get("/api/meta", (_req, res) => {
  res.json({ games: GAME_LIST, market: MARKETPLACE, arftDecimals: 6 });
});

// ---------------------------------------------------------------------------
// Economy / wallet
// ---------------------------------------------------------------------------
app.get(
  "/api/me",
  handle(async (req) => {
    const u = userOf(authedAddress(req));
    return { address: u.address, balance: u.balance, skin: u.skin, inventory: u.inventory, spins: u.spins };
  }),
);

app.post(
  "/api/me/equip",
  handle(async (req, res) => {
    const u = userOf(authedAddress(req));
    const { itemId } = req.body ?? {};
    return economy.equip(u, itemId as string);
  }),
);

app.post(
  "/api/free-spin",
  handle(async (req) => {
    const u = userOf(authedAddress(req));
    return economy.spin(u);
  }),
);

// ---------------------------------------------------------------------------
// Scores + leaderboard
// ---------------------------------------------------------------------------
app.post(
  "/api/score/submit",
  handle(async (req, res) => {
    const addr = authedAddress(req);
    const u = userOf(addr);
    const { gameId, score, mode = "global", roomId, txHash } = req.body ?? {};
    if (!GAMES[Number(gameId)]) return { error: "invalid gameId" };
    if (typeof score !== "number" || score < 0) return { error: "invalid score" };

    if (mode === "room") {
      const room = store.getRoom(String(roomId));
      if (!room) return { error: "room not found" };
      store.addScore({ id: `${Date.now()}-${addr}-${Math.random().toString(36).slice(2, 7)}`, gameId: Number(gameId), player: addr, score, mode: "room", roomId: room.id, ts: Date.now(), txHash, verified: !!txHash });
      return { ok: true, mode: "room", roomId: room.id };
    }

    const entry = {
      id: `${Date.now()}-${addr}-${Math.random().toString(36).slice(2, 7)}`,
      gameId: Number(gameId),
      player: addr,
      score,
      mode: "global" as const,
      ts: Date.now(),
      txHash: txHash || null,
      verified: !!txHash,
    };
    const result = await economy.recordGlobalScore(entry);
    return { ok: true, score, balance: result.user.balance, house: result.house, pool: result.pool, championPayout: result.championPayout, txHash: entry.txHash };
  }),
);

app.get(
  "/api/leaderboard",
  handle(async (req) => {
    const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;
    const scores = store.topScores(gameId, Number(req.query.limit || 10));
    return {
      gameId: gameId ?? "all",
      scores: scores.map((s) => ({ player: s.player, score: s.score, gameId: s.gameId, verified: s.verified, ts: s.ts })),
    };
  }),
);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
app.post(
  "/api/rooms",
  handle(async (req) => {
    const addr = authedAddress(req);
    const u = userOf(addr);
    const { gameId, entryFee, durationSecs, maxPlayers } = req.body ?? {};
    const room = economy.createRoom(u, Number(gameId), Number(entryFee), Number(durationSecs), Number(maxPlayers));
    return { ok: true, room };
  }),
);

app.post(
  "/api/rooms/:id/join",
  handle(async (req) => {
    const addr = authedAddress(req);
    const u = userOf(addr);
    const room = economy.joinRoom(u, String(req.params.id));
    return { ok: true, room };
  }),
);

app.post(
  "/api/rooms/:id/settle",
  handle(async (req) => {
    const { room, payouts, house } = economy.settleRoom(String(req.params.id));
    return { ok: true, room: { ...room, payouts, house } };
  }),
);

app.get(
  "/api/rooms",
  handle(async () => {
    return { rooms: store.openRooms().map((r) => ({ id: r.id, gameId: r.gameId, entryFee: r.entryFee, maxPlayers: r.maxPlayers, players: r.players, createdBy: r.createdBy, endsAt: r.endsAt, pot: r.pot })) };
  }),
);

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------
app.post(
  "/api/market/buy",
  handle(async (req) => {
    const addr = authedAddress(req);
    const u = userOf(addr);
    const { itemId } = req.body ?? {};
    return economy.buyItem(u, itemId as string);
  }),
);

// ---------------------------------------------------------------------------
// Stats / hub snapshot
// ---------------------------------------------------------------------------
app.get(
  "/api/stats",
  handle(async () => {
    const users = Object.values(store.db.users);
    const globalScores = store.db.scores.filter((s) => s.mode === "global");
    const roomScores = store.db.scores.filter((s) => s.mode === "room");
    const openRooms = store.openRooms();
    const totalSpent = users.reduce((s, u) => s + u.totalSpent, 0);
    const totalEarned = users.reduce((s, u) => s + u.totalEarned, 0);
    return {
      users: users.length,
      totalPlays: users.reduce((s, u) => s + u.plays, 0),
      totalWins: users.reduce((s, u) => s + u.wins, 0),
      globalScores: globalScores.length,
      roomScores: roomScores.length,
      openRooms: openRooms.length,
      arftInCirculation: users.reduce((s, u) => s + u.balance, 0),
      totalSpent,
      totalEarned,
      topScores: store.topScores(undefined, 5).map((s) => ({ player: s.player, score: s.score, gameId: s.gameId })),
    };
  }),
);

app.listen(PORT, () => {
  console.log(`arcade-backend listening on :${PORT}`);
  console.log(`  health      : /health`);
  console.log(`  meta        : /api/meta  |  me: /api/me  |  leaderboard: /api/leaderboard`);
  console.log(`  rooms       : /api/rooms |  market: /api/market/buy |  spin: /api/free-spin`);
  console.log(`  stats       : /api/stats`);
});
