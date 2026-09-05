// Headless smoke for NuttyRider (ESM). Stub canvas ctx, drive frames. Node only.
const noop = () => {};
const grad = () => ({ addColorStop: noop });
const ctxStub = new Proxy({}, {
  get: (t, p) => {
    if (typeof p !== "string") return undefined;
    if (p === "canvas") return {};
    if (["createLinearGradient", "createRadialGradient", "createPattern"].includes(p)) return grad;
    return noop;
  },
  set: () => true,
});
const canvas = {
  getContext: () => ctxStub,
  width: 0, height: 0, style: {},
  addEventListener: () => {},
};

globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 460,
  innerHeight: 820,
  addEventListener: () => {},
};
globalThis.requestAnimationFrame = () => {};

const { NuttyRider, CHARACTERS } = await import("./src/games/nutty-rider.js");

function run(g, n, hold) {
  g._restart?.(); g.running = true;
  g.steer = hold ? 1 : 0; g.holding = hold;
  for (let i = 0; i < n; i++) {
    const dt = 0.016;
    g._step(dt);
    g._drawSceneBack(); g._drawRoad();
    g._drawObstacles(); g._drawParticles(); g._drawRider();
  }
  return {
    dist: Math.floor(g.distance),
    lean: +g.lean.toFixed(2),
    laneRoad: +g.laneRoad.toFixed(1),
    vel: +g.velLane.toFixed(1),
    obs: g.obstacles.length,
    parts: g.particles.length,
    dead: g.dead,
  };
}

console.log("NuttyRider smoke >>>");
const c = CHARACTERS.find((x) => x.id === "cricket");
const g = new NuttyRider(canvas, { onScore: () => {}, onEnd: () => {}, character: c });
console.log("  coast   ", JSON.stringify(run(g, 700, false)));
console.log("  holdR   ", JSON.stringify(run(g, 700, true)));
console.log("  sprint  ", JSON.stringify(run(g, 2600, true)));

let okAll = true;
for (const ch of CHARACTERS) {
  try {
    const gg = new NuttyRider(canvas, { onScore: () => {}, onEnd: () => {}, character: ch });
    for (let i = 0; i < 140; i++) { gg._step(0.016); gg._drawRider(); }
    console.log("  char clean: " + ch.id);
  } catch (e) { okAll = false; console.log("  CHAR ERR " + ch.id + ": " + e.message); }
}
console.log(okAll ? "OK smoke finished, no throw" : "FAILED");
