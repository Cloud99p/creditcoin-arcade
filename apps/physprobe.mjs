// Physics probe for the NEW centreline model. Loads nutty-rider (module), runs
// _step in a headless loop, and exercises a few input strategies to sanity
// check that: (a) perfect "chase the bed centre" survives, (b) holding forever
// dies, (c) never holding on a long right bend dies, and code never throws.
const mod = await import("./src/games/nutty-rider.js");

function makeCanvas() {
  return { getContext: () => new Proxy({}, { get: ()=>()=>({}), set: ()=>true, has: ()=>false }),
    addEventListener: () => {}, style: {}, width: 0, height: 0 };
}
globalThis.window = { devicePixelRatio: 1, innerWidth: 460, innerHeight: 800, addEventListener: () => {} };
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => {};

function newGame(cid) {
  const ch = mod.CHARACTERS.find((x) => x.id === cid);
  const g = new mod.NuttyRider(makeCanvas(), { onScore: () => {}, onEnd: () => {}, character: ch });
  g._resize(); g._restart();
  g.W = 460; g.H = 800; g.horizonY = 240; g.playerY = 592;
  g.roadHalf = 184; g.topHalf = 27; g.bermHalf = 39;
  return g;
}

const dt = 1 / 60;
function run(label, cid, policy, maxSec = 90) {
  const g = newGame(cid);
  let frames = 0, threw = null;
  const maxF = maxSec * 60;
  try {
    while (!g.dead && frames < maxF) {
      const hold = policy(g);
      g.hold = !!hold;
      g._step(dt);
      frames++;
    }
  } catch (e) { threw = e.message; }
  console.log(label.padEnd(28), cid.padEnd(8),
    "survived=" + (frames >= maxF ? "60s+" : frames + "f"),
    "dist=" + Math.floor(g.distance), "lane=" + g.lane.toFixed(2),
    "bias=" + g._centerBias(g.distance).toFixed(2), threw ? "THREW:" + threw : "");
}

// Policy A: chase the bed centre — if rider is LEFT of centre, hold; if RIGHT
// of centre, release. = "do the right thing" near-ideal hover.
const chase = (g) => g.lane < g._centerBias(g.distance) - 0.03;
// Policy B: always hold (goes to the far right, off the dirt on return).
const holdAll = () => true;
// Policy C: never hold (should wash off on a sustained right bend).
const never = () => false;
// Policy D: antichase the same as chase but noobier threshold — nudge right a
// little past centre each frame works if the road is mostly-right biased.
const centerish = (g) => { const b = g._centerBias(g.distance); return g.lane < b; };

for (const cid of ["pig", "banana", "goat", "cricket"]) {
  run("chase-centre (ideal)", cid, chase);
  run("hold-always", cid, holdAll);
  run("never-hold", cid, never, 12);
}
console.log("\n+ domain checks");
run("centerish", "banana", centerish, 8);
