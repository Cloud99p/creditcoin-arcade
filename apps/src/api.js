/**
 * Arcade API client — talks to the full backend (real economy, leaderboard,
 * rooms, marketplace) with graceful local fallback so the app stays playable
 * offline/demo (mock wallet + localStorage ledger).
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// ---------------------------------------------------------------------------
// Wallet (demo mock; swap for a real CC3 signer in prod)
// ---------------------------------------------------------------------------
const WALLET_KEY = "arcade.wallet.v2";

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
    balance: 100_000_000, // 100 ARCFT base units
    skin: "default",
    inventory: [],
    spins: 3,
    display: `${address.slice(0, 6)}…${address.slice(-4)}`,
  };
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

export function ensureWallet() {
  return getWallet() || connectWallet();
}

/** Headers for backend auth (x-address). */
export function authHeaders(extra = {}) {
  return { "Content-Type": "application/json", "x-address": ensureWallet().address, ...extra };
}

export function shortAddr(a) {
  return a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// ---------------------------------------------------------------------------
// Low-level fetch with local fallback
// ---------------------------------------------------------------------------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const localKey = (k) => `arcade.local.${k}`;
function localGet(k, def) {
  try { return JSON.parse(localStorage.getItem(localKey(k))) ?? def; } catch (_) { return def; }
}
function localSet(k, v) { localStorage.setItem(localKey(k), JSON.stringify(v)); }

// ---------------------------------------------------------------------------
// Meta / games / market
// ---------------------------------------------------------------------------
export async function getMeta() {
  try {
    const m = await api("/meta");
    localSet("meta", m);
    return m;
  } catch (_) {
    return localGet("meta", { games: [], market: [] });
  }
}

// ---------------------------------------------------------------------------
// Me / economy
// ---------------------------------------------------------------------------
export async function getMe() {
  const w = ensureWallet();
  try {
    const m = await api("/me");
    w.balance = m.balance;
    w.skin = m.skin;
    w.inventory = m.inventory;
    w.spins = m.spins;
    localStorage.setItem(WALLET_KEY, JSON.stringify(w));
    return m;
  } catch (_) {
    return { address: w.address, balance: w.balance, skin: w.skin, inventory: w.inventory, spins: w.spins };
  }
}

export async function equip(itemId) {
  try { return await api("/me/equip", { method: "POST", body: { itemId } }); }
  catch (_) { return { ok: false, message: "backend offline" }; }
}

export async function freeSpin() {
  try { return await api("/free-spin", { method: "POST" }); }
  catch (_) { return { ok: false, message: "backend offline" }; }
}

// ---------------------------------------------------------------------------
// Scores / leaderboard
// ---------------------------------------------------------------------------
export async function submitScore({ gameId, player, score, mode = "global", roomId, txHash }) {
  const body = { gameId, player, score, mode, roomId, txHash };
  const local = localGet("scores", []);
  local.push({ ...body, ts: Date.now() });
  localSet("scores", local);
  try {
    return await api("/score/submit", { method: "POST", body });
  } catch (_) {
    return { ok: true, local: true };
  }
}

export async function getLeaderboard(gameId, limit = 10) {
  try {
    const q = window.location.search;
    const res = await api(`/leaderboard?gameId=${gameId ?? "all"}&limit=${limit}`);
    const normal = gameId !== undefined;
    void q; void normal;
    return res.scores || [];
  } catch (_) {
    const local = localGet("scores", []);
    return local
      .filter((s) => (gameId == null || s.gameId === gameId) && s.mode === "global")
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({ player: shortAddr(s.player), score: s.score, gameId: s.gameId, verified: false }));
  }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
export async function createRoom(gameId, entryFee, durationSecs, maxPlayers) {
  try { return await api("/rooms", { method: "POST", body: { gameId, entryFee, durationSecs, maxPlayers } }); }
  catch (_) {
    const rooms = localGet("rooms", []);
    const room = { id: Date.now(), gameId, entryFee, maxPlayers, players: [shortAddr(ensureWallet().address)], endsAt: Date.now() + durationSecs * 1000, pot: entryFee, settled: false, createdBy: shortAddr(ensureWallet().address) };
    rooms.push(room);
    localSet("rooms", rooms);
    return { ok: true, room: { ...room, _local: true } };
  }
}

export async function joinRoom(roomId) {
  try { return await api(`/rooms/${roomId}/join`, { method: "POST" }); }
  catch (_) { return { ok: false, message: "backend offline" }; }
}

export async function settleRoom(roomId) {
  try { return await api(`/rooms/${roomId}/settle`, { method: "POST" }); }
  catch (_) { return { ok: false, message: "backend offline" }; }
}

export async function getRooms() {
  try {
    const res = await api("/rooms");
    return res.rooms || [];
  } catch (_) {
    return localGet("rooms", []).filter((r) => !r.settled);
  }
}

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------
export async function buyItem(itemId) {
  try { return await api("/market/buy", { method: "POST", body: { itemId } }); }
  catch (_) { return { ok: false, message: "backend offline" }; }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export async function getStats() {
  try { return await api("/stats"); }
  catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Offline local play fee + spin (for demo without backend)
// ---------------------------------------------------------------------------
export function localSpend(base) {
  const w = ensureWallet();
  if (w.balance < base) return false;
  w.balance -= base;
  localStorage.setItem(WALLET_KEY, JSON.stringify(w));
  return true;
}
