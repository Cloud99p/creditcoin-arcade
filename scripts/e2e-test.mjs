// End-to-end API smoke test for the arcade backend.
// Runs the full economy flow: wallet -> play fee -> score -> leaderboard ->
// room create/join/settle -> market buy -> spin -> stats.
const BASE = process.env.BASE || "http://localhost:8080";
const A = "0x111122223333444455556666777788889999aaaa";
const B = "0xbbbbccccddddeeeeffff00001111222233334444";

async function j(path, { method = "GET", addr, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (addr) headers["x-address"] = addr;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  console.log("── E2E: economy flow ─────────────────────────────");
  const meta = await j("/api/meta");
  check("meta has 2 games", meta.games.length === 2);
  check("market has items", meta.market.length >= 5);

  console.log("── wallet ─────────────────────────────────────────");
  const meA = await j("/api/me", { addr: A });
  check("fresh wallet 100 ARCFT (100,000,000)", meA.balance === 100_000_000);
  check("starts with 3 spins", meA.spins === 3);
  check("skin default", meA.skin === "default");

  console.log("── score submit (play fee 1 ARCFT) ────────────────");
  const s1 = await j("/api/score/submit", { method: "POST", addr: A, body: { gameId: 1, score: 1500, mode: "global" } });
  check("score 1 accepted", s1.ok === true);
  check("house 0.05 + pool 0.95 split", s1.house === 50000 && s1.pool === 950000);
  const meAfter1 = await j("/api/me", { addr: A });
  check("balance 99 ARCFT after fee", meAfter1.balance === 99_000_000, `(${meAfter1.balance})`);

  const s2 = await j("/api/score/submit", { method: "POST", addr: A, body: { gameId: 1, score: 2400, mode: "global" } });
  check("score 2 accepted", s2.ok === true);

  console.log("── attestcoin emission + verify reconciliation ─────────");
  const liveArmed = s2.source === "live";
  check("submit returns a source txHash (live or sim)", typeof s2.txHash === "string" && s2.txHash.length > 0);
  check("source mode is live or sim", s2.source === "live" || s2.source === "sim");
  check("submit leaves score UNVERIFIED until worker relays", !s2.verified);
  // Simulate the worker's /api/verify reconciliation (proven on ScoreASC)
  const verified = await j("/api/verify", { method: "POST", addr: B, body: { player: A, gameId: 1, score: 2400, txHash: "0xproof" } });
  check("verify reconciled exactly 1 pending score", verified.verifiedCount === 1, `(${verified.verifiedCount})`);
  check("verify is idempotent (2nd relay matches 0)", (await j("/api/verify", { method: "POST", addr: B, body: { player: A, gameId: 1, score: 2400, txHash: "0xproof2" } })).verifiedCount === 0);
  const lbAfter = await j("/api/leaderboard?gameId=1");
  check("leaderboard now shows the 2400 as verified", lbAfter.scores.find((s) => s.score === 2400)?.verified === true);
  check("non-matching verify matches 0 (never committed)", (await j("/api/verify", { method: "POST", addr: B, body: { player: A, gameId: 1, score: 999999, txHash: "0x" } })).verifiedCount === 0);

  console.log("── leaderboard ────────────────────────────────────");
  const lb = await j("/api/leaderboard?gameId=1");
  check("leaderboard has 2 scores", lb.scores.length === 2);
  check("top score is 2400", lb.scores[0].score === 2400);

  console.log("── room economy ───────────────────────────────────");
  const room = await j("/api/rooms", { method: "POST", addr: A, body: { gameId: 1, entryFee: 5_000_000, durationSecs: 300, maxPlayers: 4 } });
  check("room created", room.ok === true);
  check("room escrows creator fee", room.room.pot === 5_000_000);

  const join = await j(`/api/rooms/${room.room.id}/join`, { method: "POST", addr: B });
  check("player B joined", join.ok === true);
  check("pot grew to 10 ARCFT", join.room.pot === 10_000_000, `(${join.room.pot})`);

  // B posts a room score then settle
  await j("/api/score/submit", { method: "POST", addr: B, body: { gameId: 1, score: 900, mode: "room", roomId: room.room.id } });
  const settled = await j(`/api/rooms/${room.room.id}/settle`, { method: "POST" });
  check("room settled", settled.ok === true);
  check("winner is B (900 > 0)", settled.room.winner === B);
  check("payouts credit B", settled.room.payouts?.[0]?.player === B && settled.room.payouts?.[0]?.amount === 9_500_000, `(${settled.room.payouts?.[0]?.amount})`);
  check("house took 0.5 ARCFT", settled.room.house === 500_000, `(${settled.room.house})`);

  console.log("── marketplace ────────────────────────────────────");
  const bought = await j("/api/market/buy", { method: "POST", addr: A, body: { itemId: "sk_cherry" } });
  check("bought cherry skin", bought.ok === true);
  const meAfterBuy = await j("/api/me", { addr: A });
  check("cherry in inventory", meAfterBuy.inventory.includes("sk_cherry"));
  // A: 100M - 2 plays(2x1M) - cherry(5M) - room escrow(5M) = 88M
  check("budget math correct", meAfterBuy.balance === 88_000_000, `(${meAfterBuy.balance})`);

  const spin = await j("/api/free-spin", { method: "POST", addr: A });
  check("spin consumed (spins 2)", (await j("/api/me", { addr: A })).spins === 2);
  check("spin returned a result", !!(spin.result && spin.result.label));

  console.log("── stats ──────────────────────────────────────────");
  const stats = await j("/api/stats");
  check("stats: users tracked", stats.users >= 2);
  check("stats: totalSpent > 0", stats.totalSpent > 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
