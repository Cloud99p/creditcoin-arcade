# Arcade Backend — full game + economy API

Coordinate the arcade's off-chain economy and relay Attestcoin-verified results.
This is the service the game clients hit; the **worker** settles scores on-chain
via the Attestcoin Protocol (ScoreASC + Block Prover `0x0FD2`), and this backend
keeps the demo economy consistent and live.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + meta |
| GET | `/api/meta` | Games catalog + marketplace catalog |
| GET | `/api/me` | Auth'd wallet: balance, skin, inventory, spins |
| POST | `/api/me/equip` | Equip an owned cosmetic skin |
| POST | `/api/free-spin` | Spend a spin on the marketplace wheel |
| POST | `/api/score/submit` | Submit a global / room score (charges play fee) |
| GET | `/api/leaderboard?gameId=` | Top scores, optional per-game |
| POST | `/api/rooms` | Create a room (escrows creator entry fee) |
| POST | `/api/rooms/:id/join` | Join a room (escrows entry fee) |
| POST | `/api/rooms/:id/settle` | Settle: rank players, house cut, credit winner |
| GET | `/api/rooms` | Open rooms |
| POST | `/api/market/buy` | Buy a marketplace item |
| GET | `/api/stats` | Hub snapshot (users, plays, wins, ARCFT in circulation) |

**Auth (demo):** pass `x-address: <evm-address>` header. Real deployment should
replace `authedAddress()` with an EIP-1193 `personal_sign` challenge verified
via `ethers.verifyMessage`.

## Economy model (mirrors on-chain ArcadeBank)

- **Play fee** = 1 ARCFT per run → split **house cut 5%** (funds the arcade) +
  **winner pool 95%**.
- When a new score **beats the current champion**, the champion is **micro-paid**
  the loser's pool (continuous leaderboard credit).
- **Rooms**: entry-fee escrow on create/join; at settle, players ranked by best
  room score; winner-takes-all pot minus house cut.
- **Marketplace**: skins/cosmetics/consumables; **spin wheel** consumes spins,
  awards cosmetics or ARCFT.

## Run

```bash
cp .env.example .env
npm run dev -w backend     # tsx watch on :8080
npm run typecheck -w backend
npm run build -w backend
npm start -w backend       # run dist/index.js
```

State persists to JSON (`backend/arcade-state.json`) across restarts. Swap
`store.ts` for a real DB in prod — the API surface is unchanged.

## Test

```bash
node scripts/e2e-test.mjs   # 26 assertions over the whole economy flow
```
