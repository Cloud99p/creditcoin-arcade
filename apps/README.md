# ARCFT Arcade — Game Clients

Client-side game hub for the Creditcoin arcade. Two games, both pure-canvas,
zero external game deps, wired to the backend + Attestcoin score pipeline.

## Games

| Game | gameId | How it works | Scoring |
|------|:------:|--------------|---------|
| **Fruit Merge** 🍒 | 1 | Drop fruit, same-tier merges to next tier. Tier 7 **CLEARS** (vanish + respawn). | Merge points + bowl bonus |
| **Nutty Rider** 🏍️ | 2 | Hold = tilt right (max 90°, eased). Dodge fans, swung logs, oil. 4 characters. | Distance / segments |

### Nutty Rider characters
| Char | Ability |
|------|---------|
| 🐷 Pig | Iron Body — resists fan knockback |
| 🐐 Goat | Climber — recovers balance faster |
| 🍌 Banana | Grip — holds corners better |
| 🦗 Cricket | Hop — clears low logs (Space) |

## Run

```bash
npm install                 # from repo root (workspace)
npm run dev -w apps         # http://localhost:5173
npm run build -w apps       # production build -> apps/dist
```

Dev proxy forwards `/api/*` → `http://localhost:8080` (arcade backend).

## Score pipeline

On game end the client calls `POST /api/score/submit` with
`{ gameId, player, score, mode, roomId }`. In production the backend
authenticates the wallet, relays the authoritative result to the worker, which
proves it via the Attestcoin Protocol onto **ScoreASC** for on-chain
verification and economy settlement.

## Files

```
apps/
  index.html          Lobby + game + overlay shells
  vite.config.js      Dev server + /api proxy
  src/main.js         Router, wallet, leaderboard, rooms, game wiring
  src/api.js          Backend client + mock wallet + local ledger
  src/styles.css      Arcade theme
  src/games/
    fruit-merge.js    Suika-style merge engine
    nutty-rider.js    Tilt-control biker engine
```

## Demo notes

- Uses a **mock wallet** (localStorage) and **local ledger/rooms** so the app
  is fully playable offline/demo. Swap `connectWallet()`/`submitScore()` in
  `src/api.js` for a real CC3 browser signer when testnet funding is wired.
- Verified headless: fruit merge overflow + merge cascade fire correctly;
  rider collision, distance, speed scaling and steering all function.
