# ARCFT Arcade — RESUME HERE (checkpoint 2026-08-30)

Full-stack arcade is BUILT, TESTED, and PUSHED. All commits on `master` origin
(`github.com/Cloud99p/creditcoin-arcade`). Working tree **clean**.

## Commits (newest first)
| Hash | What |
|------|------|
| `9034578` | **Loop closed** — backend→Sepolia `GameResultSubmitted` emission (`emitSource.ts`) + worker `POST /api/verify` idempotent reconciliation. E2E 33/33. |
| `8294d84` | Full-stack: economy backend, marketplace, rooms, 5-view hub UX |
| `fe0019e` | Game clients: Fruit Merge + Nutty Rider, lobby, leaderboard, rooms |
| `08bba2d` | Attested score settlement: ScoreASC, engines, GameArbiter, wiring |
| `7f40a27` | Foundation: DeFi economy contracts, Attestcoin worker, backend |

## What exists (all verified locally)
- **Contracts** (`contracts/`): ARCFT, CoinVault, ArcadeBank(+operator), GameArbiter
  (Sepolia), ScoreASC, LeaderboardEngine, RoomEngine. **16/16 forge tests.**
  `script/DeployArcade.s.sol` = dependency-ordered deploy + role wiring (ready).
- **Worker** (`worker/`): watches Sepolia GameArbiter → @gluwa/usc-sdk proof →
  CC3 Block Prover `0x0FD2` → ScoreASC; relays verified result to backend `POST /api/verify`.
- **Backend** (`backend/`): full REST API (auth x-address, meta, me, equip,
  free-spin, score/submit, leaderboard, rooms create/join/settle, market/buy, stats,
  **verify**). Economy: play fee 1 ARCFT → 5% house + 95% pool, champion micro-pay,
  room escrow→settle. JSON persistence.
- **Frontend** (`apps/`): 5-view hub (Play/Leaderboard/Marketplace/Rooms/Game),
  economy bar, wired to backend w/ offline fallback.
- **E2E** (`scripts/e2e-test.mjs`): **33/33 assertions** over the whole economy +
  emission + verification reconciliation.

## How to run locally
```
cd arcade-ctc
npm install
npm run dev -w backend   # API :8080
npm run dev -w apps      # UI :5173, proxy /api->:8080
node scripts/e2e-test.mjs
```

## ⚠️ THE ONE REMAINING STEP = LIVE DEPLOY (needs funded keys)
Everything is deploy-ready but **NOT deployed**. No funded Sepolia/CC3 key exists in
this environment, so I could not broadcast real txs. To finish (documented in README.md):

1. **Sepolia**: fund deployer → `forge script DeployArcade.s.sol` → set backend .env:
   `USCTEST_SOURCE_RPC`, `USCTEST_GAME_ARBITER`, `USCTEST_SOURCE_KEY` (VERIFIER role).
2. **CC3 testnet**: fund deployer → full `DeployArcade.s.sol` → capture addresses.
3. **Worker .env**: `USCTEST_RELAYER_KEY`, `USCTEST_CC3_RPC`, `USCTEST_PROVER_URL`,
   `USCTEST_GAME_ARBITER`, `USCTEST_SCORE_ASC`, `ARCFT_BACKEND_ADDRESS`,
   `ARCFT_WORKER_TOKEN` (match backend). Run worker → watches real arbiter, proves,
   reconciles verified scores.

Also pending from earlier: **real CC3 wallet + testnet funding in the FRONTEND**
(instead of demo mock wallet) so scores post chain-verified from the browser.

## Key gotchas (so future-me doesn't re-learn)
- **Kill backend by PORT OWNER, not cmdline filter.** A stale process with relative
  cmdline `backend\dist\index.js` (no `arcade-ctc` in path) slipped past the
  `*arcade-ctc*` filter and served OLD code on :8080 → `404 /api/verify` + stale
  balance. Fix: kill `Get-NetTCPConnection -LocalPort 8080` owner, delete
  `backend\arcade-state.json`, restart once.
- **PowerShell + curl mangles JSON** (`-d '{...}'` strips quotes; `-H $hash` fails).
  Use Node fetch scripts for API tests (that's why `scripts/e2e-test.mjs` is Node).
- **GameArbiter.submitGameResult** enforces `msg.sender == verifier || msg.sender == player`
  → backend source key MUST be verifier role, else revert `OnlyVerifier`.
- **`/api/verify` reconciliation** matches pending unverified (player,gameId,score),
  is idempotent, and does NOT charge a second play fee (it's reconciliation, not submit).
- **Root README + `.env.example`** have emoji/box-char mangling from older sessions —
  append, don't rewrite, to avoid corrupting further.

## Memory files updated
- `memory/2026-08-30.md` — session log (full-stack build + loop-closed + lessons)
