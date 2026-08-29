/**
 * Arcade shell — routes between the lobby and games, manages the wallet,
 * leaderboard + rooms UI, and wires both games to the Attestcoin score
 * submission pipeline.
 */
import "./styles.css";
import { FruitMerge, FRUITS } from "./games/fruit-merge.js";
import { NuttyRider, CHARACTERS } from "./games/nutty-rider.js";
import {
  connectWallet,
  ensureWallet,
  getWallet,
  getScores,
  getRooms,
  createRoom,
  joinRoom,
  submitScore,
  spendARCFT,
} from "./api.js";

const $ = (sel) => document.querySelector(sel);

// --------------------------------------------------------------------------
// Game definitions
// --------------------------------------------------------------------------
const GAMES = {
  "fruit-merge": {
    title: "Fruit Merge",
    gameId: 1,
    color: "#e0244e",
    make: (canvas, cb) => new FruitMerge(canvas, cb),
  },
  "nutty-rider": {
    title: "Nutty Rider",
    gameId: 2,
    color: "#38bdf8",
    make: (canvas, cb) => new NuttyRider(canvas, cb),
  },
};

let activeGame = null;
let activeRunner = null;
let gameSessionId = null;

// --------------------------------------------------------------------------
// Views
// --------------------------------------------------------------------------
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
}

// --------------------------------------------------------------------------
// Wallet
// --------------------------------------------------------------------------
function refreshWallet() {
  const w = getWallet();
  const balanceEl = $("#coinBalance");
  if (!w) {
    balanceEl.textContent = "₵ 0";
    $("#walletBtn").textContent = "Connect Wallet";
    return;
  }
  balanceEl.textContent = `₵ ${(w.balance / 1e6).toFixed(2)}`;
  $("#walletBtn").textContent = `🔗 ${w.display}`;
}

// --------------------------------------------------------------------------
// Leaderboard + rooms
// --------------------------------------------------------------------------
function renderLeaderboard() {
  const ul = $("#globalLeaderboard");
  ul.innerHTML = "";
  const scores = getScores();
  if (!scores.length) {
    ul.innerHTML = '<li class="muted">No scores yet — be first!</li>';
    return;
  }
  scores.slice(0, 10).forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">${i + 1}</span>
      <span class="who">${s.player} <small>${s.gameId === 1 ? "🍒" : "🏍️"}</small></span>
      <span class="pts">${s.score.toLocaleString()}</span>`;
    ul.appendChild(li);
  });
}

function renderRooms() {
  const ul = $("#roomList");
  const rooms = getRooms().filter((r) => !r.settled);
  ul.innerHTML = "";
  if (!rooms.length) {
    ul.innerHTML = '<li class="muted">No rooms yet.</li>';
    return;
  }
  rooms.forEach((r) => {
    const li = document.createElement("li");
    li.className = "room-item";
    const secsLeft = Math.max(0, Math.ceil((r.endsAt - Date.now()) / 1000));
    li.innerHTML = `<div class="room-info">
        <strong>Room #${r.id}</strong>
        <span class="muted small">${r.gameId === 1 ? "🍒 Fruit Merge" : "🏍️ Nutty Rider"} · entry ₵${(r.entryFee / 1e6).toFixed(1)} · ${r.players.length}/${r.maxPlayers} · ${secsLeft}s</span>
      </div>`;
    const join = document.createElement("button");
    join.className = "btn tiny";
    join.textContent = r.players.includes(shortAddr(ensureWallet().address)) ? "Joined" : "Join";
    join.disabled = r.players.includes(shortAddr(ensureWallet().address)) || secsLeft <= 0 || r.players.length >= r.maxPlayers;
    join.onclick = () => { joinRoom(r.id); refreshWallet(); renderRooms(); };
    li.appendChild(join);
    ul.appendChild(li);
  });
}

function shortAddr(a) {
  return a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// --------------------------------------------------------------------------
// Game runner
// --------------------------------------------------------------------------
function launchGame(gameKey, preset = {}) {
  const def = GAMES[gameKey];
  if (!def) return;
  activeGame = def;
  gameSessionId = Date.now();
  $("#gameTitle").textContent = def.title;
  $("#gameCanvas").style.borderColor = def.color;
  showView("game");
  hideOverlay();

  const canvas = $("#gameCanvas");
  const onEvent = { onScore: (score) => ($("#gameScore").textContent = score.toLocaleString()) };

  // Nutty Rider takes a character preset.
  if (gameKey === "nutty-rider") {
    const char = CHARACTERS.find((c) => c.id === (preset.character || "pig")) || CHARACTERS[0];
    activeRunner = new NuttyRider(canvas, { ...onEvent, character: char, onEnd: finishGame });
  } else {
    activeRunner = new FruitMerge(canvas, { ...onEvent, onEnd: finishGame });
  }
  activeRunner.start();
}

function finishGame(score) {
  const wallet = ensureWallet();
  // submit the attested result through the backend pipeline
  submitScore({
    gameId: activeGame.gameId,
    player: wallet.address,
    score,
    mode: "global",
    txHash: null,
  }).then(() => {
    renderLeaderboard();
    refreshWallet();
  });
  $("#ovTitle").textContent = "GAME OVER";
  $("#ovScore").textContent = score.toLocaleString();
  $("#ovDetail").textContent = `${activeGame.title} · submitted for Attestcoin verification`;
  showOverlay();
}

function showOverlay() {
  $("#gameOverlay").classList.remove("hidden");
}
function hideOverlay() {
  $("#gameOverlay").classList.add("hidden");
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------
$("#walletBtn").addEventListener("click", () => {
  connectWallet();
  refreshWallet();
  renderLeaderboard();
  renderRooms();
});

$("#backBtn").addEventListener("click", () => {
  if (activeRunner) activeRunner.running = false;
  showView("lobby");
  refreshWallet();
});

$("#ovRestart").addEventListener("click", () => {
  const key = activeGame && Object.entries(GAMES).find(([, d]) => d === activeGame)?.[0];
  if (key) launchGame(key);
});
$("#ovLobby").addEventListener("click", () => {
  showView("lobby");
  refreshWallet();
});

document.querySelectorAll(".game-card").forEach((card) => {
  card.addEventListener("click", () => launchGame(card.dataset.game));
});

$("#createRoomBtn").addEventListener("click", () => {
  createRoom(1, 2_000_000, 120, 4);
  renderRooms();
  refreshWallet();
});

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
ensureWallet();
refreshWallet();
renderLeaderboard();
renderRooms();
showView("lobby");
