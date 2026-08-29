# ARCFT Arcade — Frontend Hub

The complete arcade UI: **Play** (both games selectable), **Leaderboard**,
**Marketplace** (shop + spin wheel), **Rooms** (create/join/settle), and a live
**economy bar** (ARCFT balance + spins). Wired to the backend with offline
fallback.

## Views

| View | Contents |
|------|----------|
| 🎮 **Play** | 2 selectable games + economy explainer + live hub stats |
| 🏆 **Leaderboard** | Global top scores, filter by all / Fruit Merge / Nutty Rider |
| 🛍️ **Marketplace** | Shop (skins/cosmetics/consumables) + **Spin Wheel** 🎡 |
| 🕹️ **Rooms** | Create (entry fee/duration/max) → join → settle, payouts |
| ⚙️ **Game** | Canvas games + Nutty Rider character picker |

## Games

- **Fruit Merge** (gameId 1) — 7-tier Suika merge, tier-7 CLEAR, overflow game-over.
- **Nutty Rider** (gameId 2) — tilt biker, 4 characters, fans/logs/oil.

## Run

```bash
npm install                  # repo root (workspaces)
npm run dev -w apps          # http://localhost:5173 (proxy /api -> :8080)
npm run build -w apps        # -> apps/dist
```

For the full stack: `npm run dev -w backend` (API on :8080) alongside `-w apps`.

## Stack (frontend)

Vanilla ES modules + Canvas — zero game-framework dependency, fast to deploy
(Vite static). `src/api.js` is the single backend client; swap the mock wallet
(`connectWallet`) for a real CC3 signer when testnet funding is wired.

Score flow: game end → `submitScore()` → backend `/score/submit` → (prod) worker
proves via Attestcoin → ScoreASC verified event → leaderboard/economy settle.
