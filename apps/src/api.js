/**
 * Arcade API client — talks to the backend (worker-relayed settlement) and
 * keeps a local mock wallet + leaderboard so the app is fully demoable even
 * when the backend/chain are not running (e.g. local offline demos).
 *
 * In production the backend authenticates the wallet and relays authoritative
 * results to the worker, which proves them via Attestcoin Protocol.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// ---------------------------------------------------------------------------
// Mock wallet + ARCFT balance (demo). Swap for a real CC3 wallet (e.g. a
// browser coin/JSON-RPC signer) when testnet funding is wired.
// ---------------------------------------------------------------------------
const WALLET_KEY = "arcft.wallet";

export function getWallet() {
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

export function connectWallet() {
  const address =
    "0x" + Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const wallet = {
    address,
    balance: 100_000, // demo ARCFT base units (0.001 ARCFT)
    display: `${address.slice(0, 6)}…${address.slice(-4)}`,
  };
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

export function ensureWallet() {
  return getWallet() || connectWallet();
}

export function spendARCFT(amountBase) {
  const w = ensureWallet();
  if (w.balance < amountBase) return false;
  w.balance -= amountBase;
  localStorage.setItem(WALLET_KEY, JSON.stringify(w));
  return true;
}

export function creditARCFT(amountBase) {
  const w = ensureWallet();
  w.balance += amountBase;
  localStorage.setItem(WALLET_KEY, JSON.stringify(w));
}

// ---------------------------------------------------------------------------
// Score submission. Fails gracefully (queues locally) if backend is down.
// ---------------------------------------------------------------------------
export async function submitScore({ gameId, player, score, mode = "global", roomId, txHash }) {
  const body = { gameId, player, score, mode, roomId, txHash };

  // Local ledger always records (demo persistence + offline support).
  const local = JSON.parse(localStorage.getItem("arcft.scores") || "[]");
  local.push({ ...body, ts: Date.now() });
  localStorage.setItem("arcft.scores", JSON.stringify(local));

  let posted = false;
  try {
    const res = await fetch(`${API_BASE}/score/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    posted = res.ok;
  } catch (_) {
    posted = false;
  }
  return { posted, local: true };
}

// ---------------------------------------------------------------------------
// Local leaderboard + rooms (mirrors the backend state; backend is source of
// truth in production, this is the demo/offline layer).
// ---------------------------------------------------------------------------
export function getScores(gameId) {
  const local = JSON.parse(localStorage.getItem("arcft.scores") || "[]");
  return local
    .filter((s) => (gameId == null || s.gameId === gameId) && s.mode === "global")
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => ({ ...s, player: shortAddr(s.player) }));
}

export function createRoom(gameId, entryFee, durationSecs, maxPlayers) {
  const rooms = JSON.parse(localStorage.getItem("arcft.rooms") || "[]");
  const room = {
    id: Date.now(),
    gameId,
    entryFee,
    durationSecs,
    maxPlayers,
    players: [shortAddr(ensureWallet().address)],
    endsAt: Date.now() + durationSecs * 1000,
    settled: false,
    winner: null,
  };
  rooms.push(room);
  localStorage.setItem("arcft.rooms", JSON.stringify(rooms));
  return room;
}

export function joinRoom(roomId) {
  const rooms = JSON.parse(localStorage.getItem("arcft.rooms") || "[]");
  const r = rooms.find((x) => x.id === roomId);
  if (!r || r.players.length >= r.maxPlayers || Date.now() >= r.endsAt) return null;
  const addr = shortAddr(ensureWallet().address);
  if (!r.players.includes(addr)) r.players.push(addr);
  localStorage.setItem("arcft.rooms", JSON.stringify(rooms));
  return r;
}

export function getRooms() {
  return JSON.parse(localStorage.getItem("arcft.rooms") || "[]");
}

function shortAddr(a) {
  return a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
