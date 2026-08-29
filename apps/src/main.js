/**
 * Arcade shell — full hub controller.
 * Routes the 5 views (Play/Leaderboard/Marketplace/Rooms/Game), manages the
 * wallet + economy bar, launches both games, renders the leaderboard,
 * marketplace shop + spin wheel, and room create/join/settle — all wired to
 * the backend with offline fallback.
 */
import "./styles.css";
import { FruitMerge } from "./games/fruit-merge.js";
import { NuttyRider, CHARACTERS } from "./games/nutty-rider.js";
import * as api from "./api.js";

const $ = (sel) => document.querySelector(sel);

// --------------------------------------------------------------------------
// Game catalog
// --------------------------------------------------------------------------
const GAMES = {
  "fruit-merge": { title: "Fruit Merge", gameId: 1, color: "#e0244e", make: (c, cb) => new FruitMerge(c, cb) },
  "nutty-rider": { title: "Nutty Rider", gameId: 2, color: "#38bdf8", make: (c, cb) => new NuttyRider(c, cb) },
};

let active = null; // { def, runner }

// --------------------------------------------------------------------------
// View routing
// --------------------------------------------------------------------------
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}
document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => { setGlobalActiveJob(null); showView(b.dataset.view); renderView(b.dataset.view); }));
document.querySelectorAll("[data-game]").forEach((card) => card.addEventListener("click", () => launchGame(card.dataset.game)));

// --------------------------------------------------------------------------
// Wallet + economy bar
// --------------------------------------------------------------------------
async function refreshWallet() {
  const m = await api.getMe().catch(() => null);
  const w = api.getWallet();
  if (!w) { $("#coinBalance").textContent = "₵ 0.00"; $("#walletBtn").textContent = "Connect Wallet"; return; }
  const bal = (m ? m.balance : w.balance) / 1e6;
  $("#coinBalance").textContent = `₵ ${bal.toFixed(2)}`;
  $("#spinBadge").textContent = `🎡 ${m ? m.spins : w.spins}`;
  $("#walletBtn").textContent = `🔗 ${api.shortAddr(w.address)}`;
}
$("#walletBtn").addEventListener("click", async () => { api.connectWallet(); await refreshWallet(); document.querySelectorAll(".view").forEach((v) => v.classList.remove("active")); showView("play"); });

// --------------------------------------------------------------------------
// View renderers
// --------------------------------------------------------------------------
function renderView(name) {
  if (name === "leaderboard") renderLeaderboard("all");
  if (name === "market") renderMarket();
  if (name === "rooms") renderRooms();
  if (name === "play") renderStats();
}
async function renderLeaderboard(gameId) {
  const ul = $("#lbList");
  ul.innerHTML = '<li class="muted">Loading…</li>';
  const scores = await api.getLeaderboard(gameId === "all" ? undefined : Number(gameId), 20);
  if (!scores.length) { ul.innerHTML = '<li class="muted">No scores yet — be the first!</li>'; return; }
  ul.innerHTML = "";
  scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = i === 0 ? "first" : "";
    li.innerHTML = `<span class="rank">${i + 1}</span>
      <span class="who">${i === 0 ? "👑 " : ""}${api.shortAddr(s.player)}</span>
      <span class="game-tag">${s.gameId === 1 ? "🍒" : "🏍️"}</span>
      <span class="pts">${s.score.toLocaleString()}</span>`;
    ul.appendChild(li);
  });
}
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  renderLeaderboard(b.dataset.lb);
}));

async function renderStats() {
  const row = $("#statsRow");
  const st = await api.getStats().catch(() => null);
  if (!st) { row.innerHTML = ""; return; }
  row.innerHTML = `
    <span>👥 ${st.users} players</span>
    <span>🎮 ${st.totalPlays} plays</span>
    <span>🏆 ${st.totalWins} wins</span>
    <span>₵ ${(st.arftInCirculation / 1e6).toFixed(1)} in circulation</span>`;
}

// --------------------------------------------------------------------------
// Marketplace
// --------------------------------------------------------------------------
let marketCache = [];
async function renderMarket() {
  const meta = await api.getMeta();
  marketCache = meta.market || [];
  const grid = $("#shopGrid");
  grid.innerHTML = "";
  const me = await api.getMe().catch(() => ({}));
  const owned = me.inventory || [];
  for (const item of marketCache) {
    const card = document.createElement("div");
    card.className = "shop-item";
    const isOwned = owned.includes(item.id) && item.category !== "consumable";
    const afford = (me.balance || 0) >= item.price;
    card.innerHTML = `<div class="shop-art">${item.emoji}</div>
      <div class="shop-name">${item.name}</div>
      <div class="shop-desc">${item.description}</div>
      <div class="shop-price">${isOwned ? "<span class='owned'>OWNED</span>" : `₵ ${(item.price / 1e6).toFixed(1)}`}</div>`;
    if (!isOwned) {
      const btn = document.createElement("button");
      btn.className = "btn tiny " + (afford ? "" : "disabled");
      btn.textContent = afford ? "Buy" : "No ₵";
      btn.onclick = async () => {
        const r = await api.buyItem(item.id);
        if (r && r.ok) { await refreshWallet(); renderMarket(); }
        else alert(r?.message || "Couldn't buy");
      };
      card.appendChild(btn);
    }
    grid.appendChild(card);
  }
  $("#spinCount").textContent = `(${me.spins ?? 0})`;
}

async function doSpin() {
  const r = await api.freeSpin();
  const box = $("#spinResult");
  box.classList.remove("hidden");
  const me = await api.getMe().catch(() => ({ spins: 0 }));
  $("#spinCount").textContent = `(${me.spins ?? 0})`;
  if (!r || !r.ok || !r.result) {
    box.innerHTML = `<div class="spin-badge-result">🚫 ${r?.message || "No spins left — buy one or earn more!"} 🎡</div>`;
  } else {
    let extra = "";
    if (r.creditAmount) extra = ` <span class="good">(+₵${(r.creditAmount / 1e6).toFixed(1)})</span>`;
    box.innerHTML = `<div class="spin-badge-result">${r.result.emoji} ${r.result.label}${extra}</div>`;
  }
  await refreshWallet();
  renderMarket();
}
$("#spinWheelBtn").addEventListener("click", doSpin);

// --------------------------------------------------------------------------
// Rooms
// --------------------------------------------------------------------------
function openRoomForm(show) { $("#roomForm").classList.toggle("hidden", !show); }
$("#openCreateRoom").addEventListener("click", () => openRoomForm(true));
$("#btnCancelRoom").addEventListener("click", () => openRoomForm(false));
$("#btnCreateRoom").addEventListener("click", async () => {
  const gameId = Number($("#rmGame").value);
  const entryFee = Math.max(1, Number($("#rmFee").value)) * 1e6;
  const dur = Number($("#rmDur").value);
  const max = Number($("#rmMax").value);
  const r = await api.createRoom(gameId, entryFee, dur, max);
  openRoomForm(false);
  if (r && r.ok) { await refreshWallet(); renderRooms(); }
  else alert(r?.message || "Could not create room");
});

async function renderRooms() {
  const rooms = await api.getRooms();
  const list = $("#roomList");
  list.innerHTML = "";
  $("#roomEmpty").style.display = rooms.length ? "none" : "block";
  const wallet = api.getWallet();
  for (const r of rooms) {
    const secs = Math.max(0, Math.ceil((r.endsAt - Date.now()) / 1000));
    const li = document.createElement("li");
    li.className = "room-item";
    const jointed = r.players?.includes(api.shortAddr(wallet?.address)) || r.players?.includes(wallet?.address);
    li.innerHTML = `<div class="room-info">
        <strong>${r.gameId === 1 ? "🍒" : "🏍️"} Room</strong>
        <span class="muted small">entry ₵${((r.entryFee||r.pot||5000000)/1e6).toFixed(1)} · ${r.players?.length||1}/${r.maxPlayers} · ${secs}s</span>
        <span class="muted small">pot ₵${((r.pot||0)/1e6).toFixed(1)} · by ${api.shortAddr(r.createdBy||"")}</span>
      </div>`;
    const btn = document.createElement("button");
    btn.className = "btn tiny";
    if (jointed) {
      btn.textContent = "Joined";
      btn.disabled = true;
    } else {
      btn.textContent = "Join";
      btn.disabled = secs <= 0 || (r.players?.length||1) >= r.maxPlayers;
      btn.onclick = async () => { const rr = await api.joinRoom(r.id); if (rr?.ok) { await refreshWallet(); renderRooms(); } else alert(rr?.message || "join failed"); };
    }
    li.appendChild(btn);
    list.appendChild(li);
  }
}

// --------------------------------------------------------------------------
// Game runner
// --------------------------------------------------------------------------
function launchGame(key) {
  const def = GAMES[key];
  if (!def) return;
  active = { def, runner: null };
  $("#gameTitle").textContent = def.title;
  $("#gameScore").textContent = "0";
  document.getElementById("gameCanvas").style.borderColor = def.color;
  showView("game");
  hideOverlay();

  // character picker for Nutty Rider
  const picker = $("#characterPicker");
  if (key === "nutty-rider") {
    picker.classList.remove("hidden");
    picker.innerHTML = CHARACTERS.map((c) => `<button class="char-btn" data-char="${c.id}" title="${c.ability}: ${c.desc}">${c.emoji}</button>`).join("");
    picker.querySelectorAll(".char-btn").forEach((b) => b.addEventListener("click", () => startRunner(def, b.dataset.char)));
  } else {
    picker.classList.add("hidden");
    picker.innerHTML = "";
  }
  startRunner(def, "pig");
}

function startRunner(def, char) {
  const canvas = $("#gameCanvas");
  const onEvent = {
    onScore: (s) => ($("#gameScore").textContent = s.toLocaleString()),
    onEnd: finishGame,
  };
  const runner = def.make(canvas, def.gameId === 2 ? { ...onEvent, character: CHARACTERS.find((c) => c.id === char) || CHARACTERS[0] } : onEvent);
  active.runner = runner;
  runner.start();
}

function finishGame(score) {
  const w = api.getWallet();
  api.submitScore({ gameId: active.def.gameId, player: w.address, score, mode: "global" });
  $("#ovTitle").textContent = "GAME OVER";
  $("#ovScore").textContent = score.toLocaleString();
  $("#ovDetail").textContent = `${active.def.title} · score pending — queued for Attestcoin verification`;
  showOverlay();
  refreshWallet();
}
function showOverlay() { $("#gameOverlay").classList.remove("hidden"); }
function hideOverlay() { $("#gameOverlay").classList.add("hidden"); }
$("#backBtn").addEventListener("click", () => { if (active?.runner) active.runner.running = false; showView("play"); renderView("play"); refreshWallet(); });
$("#ovRestart").addEventListener("click", () => { if (active) startRunner(active.def, "pig"); });
$("#ovLobby").addEventListener("click", () => { showView("play"); renderView("play"); refreshWallet(); });

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
let bootJob = null;
function setGlobalActiveJob(_j) { bootJob = null; }
(async function boot() {
  api.ensureWallet();
  await refreshWallet();
  showView("play");
  await renderStats();
})();
