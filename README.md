# arcade-ctc — Creditcoin Attestcoin Arcade

An **on-chain arcade hub on Creditcoin** built for BUIDL CTC 2026 Fall.
Two games at MVP — **Fruit Merge** (7-tier Suika-style) and **Nutty Rider**
(tilt-control biker) — with a **withdrawable in-game economy**, an adaptive
**leaderboard payout engine** (global + discrete rooms), and settlement of every
score through the **Attestcoin Protocol**.

```
🎮 Fruit Merge ── 7-tier merge, top tier CLEARS, score = merges + bowl count
🏍️ Nutty Rider ── 4 characters (Pig/Goat/Banana/Cricket) + tilt control + obstacles
💱 Economy ────── ARCFT ERC-20, 1:1 coin vault, house cut, winnings pool
🔗 Attestcoin ───▸ every game result is cryptographically verified on-chain
```

---

## Architecture at a glance

```
┌─────────────┐   game sim   ┌──────────────┐   verified score   ┌──────────────────┐
│ Game clients │ ───────────▶ │  backend +   │ ─────────────────▶ │  ScoreASC (CC3)  │
└─────────────┘  (off-chain)  │  Worker      │  (Attestcoin proof)│  0x0FD2 prover   │
                              └──────────────┘                    └────────┬─────────┘
                                                                           │ ScoreVerified
                                                                           ▼
              ┌───────────────────────────────┐   settle   ┌────────────────────────────┐
              │ LeaderboardEngine / RoomEngine │ ─────────▶ │ ArcadeBank + CoinVault +   │
              └───────────────────────────────┘            │ ARCFT token                │
                                                           └────────────────────────────┘
```

**Attestcoin integration (core):**
- Source contract on **Sepolia** emits `GameResultSubmitted` on game end.
- An **off-chain worker** builds a Merkle + continuity proof via `@gluwa/usc-sdk`.
- **ScoreASC** (Creditcoin) verifies it via the **Block Prover precompile `0x0FD2`**,
  enforces **replay protection**, checks `receiptStatus == 1`, emits `ScoreVerified`.
- **LeaderboardEngine / RoomEngine** settle the economy in ARCFT through ArcadeBank.

---

## Repo layout

| Path | Purpose |
|------|---------|
| `contracts/` | Foundry project — Solidity on CC3 (ARCFT, CoinVault, ArcadeBank, ScoreASC, engines) |
| `worker/` | Off-chain Attestcoin readability worker (`@gluwa/usc-sdk`) |
| `backend/` | Game API — auth, validation, room clock, settlement triggers, omni-intelligence |
| `apps/` | Game clients (Fruit Merge + Nutty Rider) |
| `docs/` | Technical docs, integration summary, deck outline |

---

## Contracts (deployed on CC3 Testnet)

| Contract | Role |
|----------|------|
| `ARCFT.sol` | In-game ERC-20, withdrawable 1:1, mint/burn via CoinVault |
| `CoinVault.sol` | Testnet-coin reserve backing all ARCFT |
| `ArcadeBank.sol` | House cut + winnings pool ledger |
| `GameArbiter.sol` | Sepolia source contract, emits `GameResultSubmitted` |
| `ScoreASC.sol` | Attestcoin Smart Contract — proof verify + replay protection |
| `LeaderboardEngine.sol` | Global continuous payouts |
| `RoomEngine.sol` | Discrete room rounds |

---

## Local dev

```bash
# Contracts (Creditcoin Foundry template, Docker devnet)
cd contracts
cp .env.example .env
docker compose up --build          # local CC3 devnet on 127.0.0.1:9944
forge build
forge test

# Deploy (auto-fund from Alith, or supply PRIVATE_KEY)
docker compose up --build          # with AUTO_DEPLOY=1 / AUTO_FUND_FROM_NODE=1
# or
forge script script/DeployArcade.s.sol:DeployArcade --rpc-url cc3-local \
  --broadcast --slow --gas-estimate-multiplier 500 --evm-version shanghai
```

Requires **Foundry** (`forge`/`cast`) and **Docker** (for the local CC3 devnet).

---

## Fruit Merge — 7-tier progression

| Tier | Fruit | Rel. size | Merge → | Points |
|:----:|-------|:--------:|---------|:------:|
| 1 | 🍒 Cherry | 1.0x | Strawberry | 10 |
| 2 | 🍓 Strawberry | 1.7x | Grape | 20 |
| 3 | 🍇 Grape | 2.6x | Orange | 40 |
| 4 | 🍊 Orange | 3.9x | Apple | 80 |
| 5 | 🍎 Apple | 5.5x | Pear | 160 |
| 6 | 🍐 Pear | 7.6x | Watermelon | 320 |
| 7 | 🍉 Watermelon | 10x | 💥 CLEAR | 640 + respawn |

## Nutty Rider — characters

Pig (Iron Body) · Goat (Climber) · Banana (Grip) · Cricket (Hop)

---

## Built with

- **Foundry** + `gluwa/creditcoin-foundry-template` (CC3 Frontier EVM)
- **`@gluwa/usc-sdk`** — Attestcoin proofs (ethers v6)
- **OpenZeppelin** contracts v5
- **omnilearn-agent** — arcade intelligence / adaptive economy layer

## License

MIT (see `contracts/LICENSE` — template MIT; subject to change before submission).

---

## Full-stack status (Aug 29, 2026)

End-to-end arcade is built and verified � contracts, worker, backend, frontend.

| Layer | Status | Notes |
|-------|:------:|-------|
| Contracts (CC3) | Done | ARCFT, CoinVault, ArcadeBank (+operator), GameArbiter, ScoreASC, LeaderboardEngine, RoomEngine � 16/16 forge tests, deployed by DeployArcade.s.sol |
| Worker | Done | Attestcoin readability worker: watches Sepolia GameArbiter, builds Merkle+continuity proof, verifies via 0x0FD2, relays verified result to backend |
| Backend | Done | Full REST API: wallet/economy, leaderboard, rooms (escrow+settle), marketplace, spin, stats � 26/26 e2e assertions |
| Frontend (apps/) | Done | Vite hub: Play (2 games), Leaderboard, Marketplace (shop+spin), Rooms; wired to backend with offline fallback |

### Run the full stack
`ash
npm install
npm run dev -w backend     # API on :8080
npm run dev -w apps        # UI on :5173, proxy /api -> :8080
node scripts/e2e-test.mjs  # backend economy e2e smoke test (26 checks)
`

### Economy model (off-chain mirror of on-chain ArcadeBank)
- Play fee 1 ARCFT -> 5% house cut + 95% winner pool.
- Beating the champion micro-pays them the pool.
- Rooms: entry-fee escrow on create/join, settle = rank players + house cut + winner payout.
- Marketplace: skins/cosmetics + spin wheel.

### Loop closed (Aug 30): backend <-> worker <-> chain emission
- Backend now **emits GameResultSubmitted** on the Sepolia GameArbiter for every
  authoritative score (simulated with a synthetic txHash when no Sepolia env is
  set; live broadcast when armed). See \ackend/src/emitSource.ts\.
- Worker relays the **ScoreASC proof-verification** to a dedicated
  \POST /api/verify\ � an idempotent reconciliation that flips the matching
  pending (player, gameId, score) to \erified\ **without** charging a second
  play fee. Auth via optional \ARCFT_WORKER_TOKEN\ (\x-worker-token\).
- E2E now covers the emission + verify reconciliation path: **33/33 assertions**
  (\scripts/e2e-test.mjs\).

### To go fully LIVE (needs funded keys � I cannot deploy without them)
1. **Sepolia**: fund a deployer, run \orge script DeployArcade.s.sol\ (or deploy
   just GameArbiter) ? set \USCTEST_GAME_ARBITER\, \USCTEST_SOURCE_RPC\,
   \USCTEST_SOURCE_KEY\ (verifier role) in backend .env.
2. **CC3 testnet**: fund a deployer, run the full \DeployArcade.s.sol\ script ?
   capture ScoreASC + engines addresses.
3. **Worker**: set \USCTEST_RELAYER_KEY\ (CC3 gas), \USCTEST_CC3_RPC\,
   \USCTEST_PROVER_URL\, \USCTEST_GAME_ARBITER\, \USCTEST_SCORE_ASC\,
   \ARCFT_BACKEND_ADDRESS\ + \ARCFT_WORKER_TOKEN\, and run the worker.
   It will then watch the real Sepolia arbiter, prove on ScoreASC, and reconcile
   verified scores back to the backend.
