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
