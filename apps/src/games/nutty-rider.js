/**
 * Nutty Rider — pseudo-3D tilt-control biker (Option A).
 *
 * Press & hold  = lean the bike RIGHT (eased, up to 90°). The road bends
 * right to pull you into the curve; hard lean = drift with skid particles,
 * straight fast riding = speed-line motion streaks. Release eases back north.
 * Single-direction steer is an intentional difficulty spike: you chase the
 * curve and can only *lean into* right bends by pressing your own way through
 * the slaloming track.
 *
 * Ride through scroll obstacles: FANS (push you off the low bank toward the
 * rim), SWUNG LOGS (knock sideways), OIL (slippery — you skid wider). 4
 * characters, one special ability each. Score = distance / segments cleared.
 *
 * Pure canvas: perspective road, horizon, code-drawn bike + rider sprites,
 * drift + motion particles. Emits final score to the shell for Attestcoin.
 */

export const CHARACTERS = [
  { id: "pig", name: "Pig", emoji: "🐷", color: "#f9a8d4", ability: "Iron Body", desc: "Resists fan knockback", stat: { tilt: 0.90, knock: 0.35, grip: 1.0 } },
  { id: "goat", name: "Goat", emoji: "🐐", color: "#fdba74", ability: "Climber", desc: "Recovers balance faster", stat: { tilt: 1.00, knock: 0.70, grip: 1.0 } },
  { id: "banana", name: "Banana", emoji: "🍌", color: "#fde047", ability: "Grip", desc: "Hold corners better", stat: { tilt: 1.05, knock: 0.60, grip: 1.30 } },
  { id: "cricket", name: "Cricket", emoji: "🦗", color: "#bef264", ability: "Hop", desc: "Clears low logs", stat: { tilt: 1.00, knock: 0.80, grip: 1.05 } },
];

const MAX_LEAN = 0.92;             // max lean ~ 84°, keeps rider on screen visually
const LEAN_EASE = 3.2;             // how fast lean responds once holding
const LEAN_RECOVER = 4.5;          // recovery back to north (goat is fastest)
const BASE_SPEED = 260;            // road scroll speed in "world units"
const MAX_SPEED_UP = 220;
const PLAYER_Y_FRAC = 0.74;        // vertical spot of the rider on screen

export class NuttyRider {
  constructor(canvas, { onScore, onEnd, character = CHARACTERS[0] } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScore = onScore || (() => {});
    this.onEnd = onEnd || (() => {});
    this.character = character;
    this.running = false;

    this.W = 0;
    this.H = 0;
    this.dpr = 1;

    // world model
    this.t = 0;                     // global time (drive phase for road wiggle)
    this.distance = 0;              // units travelled
    this.speed = 0;
    this.lean = 0;                  // eased lean in [-1..1], 0=north, +1=right
    this.steer = 0;                 // requested steer: press => +1 (RIGHT only)
    this.holding = false;
    this.laneRoad = 0;              // rider position expressed as offset from road centreline (px world)
    this.velLane = 0;
    this.roadBank = 0;              // how bent-right the road currently is (-1..1)
    this.roadTarget = 0;
    this.hop = 0;                   // cricket hop height (px)
    this.dead = false;

    // obstacles / props are in CAR space: normalised frac of road half-width
    // plus a "depth ahead" in world units measured from the rider.
    this.obstacles = [];
    this.propZ = [];                // world-space z-spacing of roadside speed markers
    this.particles = [];            // drift skids + speed streaks

    this._resize();
    this._bind();
  }

  // ---------------------------------------------------------------- geomet --
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = Math.min(window.innerWidth - 16, 460);
    const h = Math.min(window.innerHeight - 188, 700);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    this.horizonY = Math.round(h * 0.30);
    // road half width just above the horizon edge and at the bottom
    this.topHalf = Math.max(10, w * 0.10);
    this.botHalf = w * 0.40;
    // rider vertical (screen Y)
    this.playerY = h * PLAYER_Y_FRAC;
  }

  // world param "k": k=1 at the rider row, k=0 far at the horizon. Map to screen.
  kToY(k) { return this.horizonY + (this.playerY - this.horizonY) * k; }
  halfAt(k) { return this.topHalf + (this.botHalf - this.topHalf) * k; }

  // ------------------------------------------------------------ input ------
  _bind() {
    const press = (e) => {
      this.holding = true;
      // press = lean right => steer +1 (single-direction dynamic). The rider
      // counter-drifts by releasing to let the speed + curve carry it back.
      this.steer = 1;
      e.preventDefault && e.preventDefault();
    };
    const release = () => {
      this.holding = false;
      this.steer = 0;
    };
    this.canvas.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("pointerleave", release);
    window.addEventListener("keydown", (e) => {
      const c = e.code;
      if (c === "ArrowRight" || c === "KeyD" || c === "Space") { if (!this._keyRt) { this._keyRt = true; this.holding = true; this.steer = 1; } e.preventDefault && e.preventDefault(); }
      if (c === "Space" && this.character.id === "cricket" && this.running && !this.dead) this.hop = Math.max(this.hop, 54);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "ArrowRight" || e.code === "KeyD" || e.code === "Space") { this._keyRt = false; release(); }
    });
  }

  // ------------------------------------------------------------ run --------
  _restart() {
    this.t = 0;
    this.distance = 0;
    this.speed = 0;
    this.lean = 0;
    this.steer = 0;
    this.holding = false;
    this.laneRoad = 0;
    this.velLane = 0;
    this.roadBank = 0;
    this.roadTarget = 0;
    this.hop = 0;
    this.dead = false;
    this.obstacles = [];
    this.particles = [];
    this._spawnNext = 20; // first obstacle appears after a beat
    this._marker = 0;
  }

  start() {
    this._resize();
    this._restart();
    this.running = true;
    this._last = performance.now();
    this._loop(this._last);
  }

  _hop() { if (this.character.id === "cricket") this.hop = Math.max(this.hop, 54); }

  _addObstacle(type, aheadZ, frac, extra = {}) {
    this.obstacles.push(Object.assign({
      type, aheadZ, frac, hit: false, yaw: 0,
    }, extra));
  }

  _spawnAgent() {
    const type = ["fan", "log", "oil"][Math.floor(Math.random() * 3)];
    // bias spawns slightly toward the central riding lane (+/-0.5) so a pure
    // lean never feels like a wall; hazards earn their kills.
    const frac = (Math.random() * 2 - 1) * 0.5;
    const aheadZ = 210 + Math.random() * 90;
    const extra = {};
    if (type === "fan") extra.yDir = Math.random() < 0.5 ? -1 : 1;
    else if (type === "log") extra.angle = Math.random() * 2 - 1;
    this._addObstacle(type, aheadZ, frac, extra);
  }

  // ------------------------------------------------------------ step -------
  _step(dt) {
    this.t += dt;

    // speed ramps up with distance (a "pace" difficulty curve)
    this.speed += (BASE_SPEED + Math.min(MAX_SPEED_UP, this.distance * 0.0012) - this.speed) * Math.min(1, dt * 1.5);
    this.distance += this.speed * dt;

    // --- LEAN (the core dynamic). Press => lean right, eased by char. ---
    const targetLean = this.steer * MAX_LEAN;
    if (this.steer > 0) {
      this.lean += (targetLean - this.lean) * Math.min(1, LEAN_EASE * this.character.stat.tilt * dt);
      this.roadTarget = 1;                       // press pulls the road right
    } else {
      // recover to north (goat climbs back fastest via stat.tilt)
      const recv = LEAN_RECOVER * (0.7 + 0.5 * this.character.stat.tilt);
      this.lean += (0 - this.lean) * Math.min(1, recv * dt);
      this.roadTarget = 0;
    }

    // --- steering: lean shoves the rider across the road to the right. ---
    const grip = this.character.stat.grip * (this._onOil() ? 0.45 : 1.0);
    this.velLane += this.lean * 900 * dt;          // lean pushes right
    this.velLane *= Math.max(0, 1 - 2.6 * grip * dt); // friction
    // released: let the tire find its line back toward the middle of the road
    // (single-direction control, so the "release" is the only way to unwind).
    if (this.steer <= 0 && Math.abs(this.laneRoad) > 4) {
      this.velLane -= Math.sign(this.laneRoad) * 240 * dt * (0.6 + 0.5 * grip);
    }

    // rider is free to move a good chunk of the road (dodge corridor)
    const maxOff = this.botHalf * 0.62;
    this.laneRoad += this.velLane * dt;
    this.laneRoad = Math.max(-maxOff, Math.min(maxOff, this.laneRoad));

    // --- road banking itself follows the lean (eases to target). ---
    this.roadBank += (this.roadTarget - this.roadBank) * Math.min(1, 2.4 * dt);
    this.roadBank += (0 - this.roadBank) * Math.min(1, 1.6 * dt); // slight ease back drift

    // a slow autonomous wiggle so the track slaloms even when you stop steering,
    // giving the single-direction hold real job: briefly release to carve left.
    this.roadTargetMath = Math.sin(this.t * 0.6) * 0.6 + Math.sin(this.t * 0.23 + 1.7) * 0.4;
    // blend: pressed attempts to *override* toward the right; released drifts
    // back toward the gentle sinusoidal left (the "return" difficulty).
    this.roadCurve = this.roadBank * 1.0 + (1 - Math.abs(this.roadBank)) * this.roadTargetMath * 0.9;

    // --- hop decay ---
    if (this.hop > 0) this.hop = Math.max(0, this.hop - 150 * dt);

    // --- spawn obstacles & scroll them toward the rider ---
    this._spawnNext -= this.speed * dt;
    if (this._spawnNext <= 0) {
      this._spawnAgent();
      this._spawnNext = 240 + Math.random() * 260;
    }
    for (const o of this.obstacles) {
      o.aheadZ -= this.speed * dt;
      // fans drift / oscillate laterally while in view
      if (o.type === "fan") o.frac += Math.sin(this.t * 3 + o.aheadZ) * 0.002;
      if (o.type === "log") o.yaw = Math.sin(this.t * 2 + o.aheadZ) * 0.4;
    }
    this.obstacles = this.obstacles.filter((o) => o.aheadZ > -30 && !o.hit);

    // --- particle emission (drift + motion) tied to lean & speed. ---
    const riderX = this.W / 2 + Math.max(-this.botHalf * 0.6, Math.min(this.botHalf * 0.6, this.laneRoad));
    const speedK = this.speed / (BASE_SPEED + MAX_SPEED_UP);
    const leanMag = Math.abs(this.lean);
    // DRIFT: rear tyre skids while pressing hard (lean high) — throw dust out
    // to the outside of the rear wheel, which way depends on which way you're
    // being swung; we simplest spray opposite the lean direction + slight rear.
    if (this.lean > 0.35 && Math.random() < (0.5 + leanMag * 1.4) * dt * 60) {
      // after the bike banks right, the rear wheel sits at rider x - offset
      this._emit("skid", riderX - 18 * Math.cos(this.lean * 0.42) - 6, this.playerY - this.hop + 14,
        (Math.random() - 0.6) * 40, (10 + Math.random() * 40), 0.5 + Math.random() * 0.35, 2.5 + Math.random() * 2.5, 0.75);
    }
    // STRAIGHT-LINE: faint speed streaks racing along the road when going fast.
    if (speedK > 0.6 && Math.random() < (30 + speedK * 120) * dt) {
      this._emit("streak", (Math.random() - 0.5) * this.W * 0.5, this.horizonY + Math.random() * (this.H - this.horizonY),
        0, 120 + Math.random() * 160, 0.35 + Math.random() * 0.3, 1 + Math.random(), 0.35);
    }
    // CORNERING dust kicked off the banked verge
    if (leanMag > 0.2 && Math.random() < 40 * dt) {
      this._emit("dust", riderX - Math.sign(this.lean) * this.botHalf * 0.5 + (Math.random() - 0.5) * 18, this.playerY + (Math.random() - 0.5) * 24,
        Math.sign(this.lean) * (40 + Math.random() * 60), -20 - Math.random() * 40, 0.55 + Math.random() * 0.3, 4 + Math.random() * 4, 0.8);
    }

    // particles lifecycle
    for (const p of this.particles) p.life -= dt;
    this.particles = this.particles.filter((p) => p.life > 0);

    // --- collision: only when obstacle passes the rider row ---
    const crossed = this.obstacles.filter((o) => o.aheadZ <= 0 && o.aheadZ > -40 && !o.hit);
    for (const o of crossed) {
      if (o.hit) continue;
      // measure horizontal gap in the same units as the rider's lane offset.
      const halfRoad = this.botHalf;
      const obx = o.frac * halfRoad;
      const gap = Math.abs(obx - this.laneRoad);
      const riderHalf = this._riderHalfW();
      const obHalf = (o.type === "oil" ? halfRoad * 0.30 : halfRoad * 0.16);
      if (gap < riderHalf + obHalf) {
        // cricket hops over logs
        if (o.type === "log" && o.hopClearable !== false && this.hop > 0) { o.hit = true; continue; }
        o.hit = true;
        this._resolveHit(o);
        if (this.dead) break;
      }
    }
    this.score = Math.floor(this.distance / 10);
    this.level = Math.floor(this.distance / 500) + 1;
    this.onScore(this.score, this.level);
  }

  _riderHalfW() { return this.botHalf * 0.14; }

  _onOil() {
    // checks if an oil patch is currently under the rider band
    return this.obstacles.some((o) => o.type === "oil" && Math.abs(o.aheadZ) < 20 && !o.hit);
  }

  _resolveHit(o) {
    if (o.type === "oil") return; // slipping handled implicitly (grip reduced); no death
    if (o.hit === true && o.type !== "fan" && o.type !== "log") return;
    // FAN: iron-body pig resists its shove; otherwise a knock sideways.
    if (o.type === "fan") {
      const edge = o.frac > (0) ? 1 : -1;
      const knock = this.character.stat.knock; // pig low => shrugs off
      this.velLane += edge * (1.6 - knock * 0.9) * 2600 * 0.5;
      if (Math.abs(this.laneRoad) > this.botHalf * 0.5) { this._die(); }
      return;
    }
    if (o.type === "log") {
      // pushed off toward the outside of the curve. cricket hops over them.
      const dir = this.roadCurve >= 0 ? 1 : -1;
      this.velLane += dir * (2.2) * 1200;
      if (Math.abs(this.laneRoad) >= this.botHalf * 0.5) { this._die(); }
      return;
    }
  }

  _die() {
    if (this.dead) return;
    this.dead = true;
    this.running = false;
    this.onEnd(this.score);
  }

  // ------------------------------------------------------------ draw -------
  _drawSceneBack() {
    const ctx = this.ctx, W = this.W, H = this.H;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY + 4);
    sky.addColorStop(0, "#0e1626");
    sky.addColorStop(1, "#1b2437");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, this.horizonY + 4);
    // stars
    ctx.fillStyle = "rgba(226,232,240,0.4)";
    let seed = 12345;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W, y = rnd() * this.horizonY;
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(this.t * 2 + i * 3));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    // horizon band: distant neon city silhouette
    ctx.fillStyle = "#0a1020";
    ctx.fillRect(0, this.horizonY - 6, W, 8);
  }

  // Draws the road using the "roadway strips to the horizon" technique.
  _drawRoad() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const skew = this.roadCurve;              // -1..1 lateral curve intensity

    // ground fill under the road so there is always pavement below the bike
    const ground = ctx.createLinearGradient(0, this.horizonY, 0, H);
    ground.addColorStop(0, "#111a27");
    ground.addColorStop(1, "#090d16");
    ctx.fillStyle = ground;
    ctx.fillRect(0, this.horizonY, W, H - this.horizonY);

    // build road rows from the horizon (k=0) down PAST the player row so the
    // road runs to the bottom edge of the screen.
    const SEG = 40;
    const kBottom = (H - this.horizonY) / (this.playerY - this.horizonY); // ~1.4
    const N = Math.ceil(SEG * kBottom);
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const kRaw = (i / N) * kBottom;          // 0..kBottom
      const k = Math.min(1, kRaw);             // perspective clamped at player
      const yRow = this.kToY(k);
      const y = kRaw > 1 ? this.playerY + (kRaw - 1) * (H - this.playerY) : yRow;
      const half = k < 1 ? this.halfAt(k) : this.botHalf * (1 + (kRaw - 1) * 0.0);
      const ease = 1 - Math.pow(1 - k, 1.7);
      // the ROAD is fixed around screen-center; only the perspective sway of a
      // nominal curve helps it feel alive — the RIDER crosses it, not the other
      // way round.
      const cx = (W / 2) + skew * Math.pow(k, 1.55) * W * 0.16;
      rows.push({ y, cx, half });
    }

    // contiguous pavement quads
    ctx.fillStyle = "#151b28";
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.cx - a.half, a.y);
      ctx.lineTo(b.cx - b.half, b.y);
      ctx.lineTo(b.cx + b.half, b.y);
      ctx.lineTo(a.cx + a.half, a.y);
      ctx.closePath();
      ctx.fill();
    }
    // lane divider dashes racing toward the player = straight-line speed motion
    ctx.strokeStyle = "#3d4b63";
    ctx.lineWidth = 2;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (((i % 2) + Math.floor(this.distance / 14)) % 2 === 0) {
        ctx.globalAlpha = 0.45 + 0.4 * (a.y - this.horizonY) / (H - this.horizonY);
        ctx.beginPath(); ctx.moveTo(a.cx, a.y); ctx.lineTo(b.cx, b.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // bright left edge + green right verge so left/right reads instantly
    const edges = [
      { s: "#e8eefb", side: -1 },
      { s: "#34d399", side: 1 },
    ];
    for (const e of edges) {
      ctx.strokeStyle = e.s;
      ctx.lineWidth = 4;
      ctx.beginPath();
      rows.forEach((r, i) => { const x = r.cx + e.side * r.half; if (i === 0) ctx.moveTo(x, r.y); else ctx.lineTo(x, r.y); });
      ctx.stroke();
    }
  }


  _emit(kind, x, y, vx, vy, life, size, baseA) {
    if (this.particles.length > 220) this.particles.shift();
    this.particles.push({ kind, x, y, vx, vy, life, maxLife: life, size, baseA });
  }

  _drawObstacles() {
    const ctx = this.ctx;
    // draw from far (high k) to near.
    const sorted = this.obstacles.slice().sort((p, q) => p.aheadZ - q.aheadZ);
    for (const o of sorted) {
      const depth = Math.max(0, o.aheadZ);
      const k = Math.max(0.01, Math.min(1, 1 - depth / 280));
      const y = this.kToY(Math.min(1, k));
      const half = this.halfAt(k);
      const cx = (this.W / 2) + this.roadCurve * Math.pow(k, 1.55) * this.W * 0.16 + o.frac * half;
      this._drawObstacleShape(o, cx, y, k);
    }
  }

  _drawObstacleShape(o, cx, y, k) {
    const ctx = this.ctx;
    const scale = Math.max(0.2, 0.35 + k * 0.85);
    if (o.type === "fan") {
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(scale, scale * 0.9);
      // pedestal
      ctx.fillStyle = "#243041";
      ctx.fillRect(-16, -2, 32, 20);
      // fan housing + spinning blades
      const spin = this.t * 20;
      ctx.translate(0, -18);
      ctx.fillStyle = "#0f1520";
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = o.yDir > 0 ? "#67e8f9" : "#f0abfc"; ctx.lineWidth = 3;
      for (let b = 0; b < 3; b++) {
        const a0 = spin + b * Math.PI * 2 / 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a0) * 13, Math.sin(a0) * 13); ctx.stroke();
      }
      // gust direction arrows
      ctx.fillStyle = o.yDir > 0 ? "#22d3ee" : "#e879f9";
      const ar = o.yDir > 0 ? 0 : Math.PI;
      ctx.fillRect(-1, 3, 2, 12);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ar - 2.4) * 3, o.yDir > 0 ? 14 : -14); ctx.lineTo(Math.cos(ar) * 3, o.yDir > 0 ? 20 : -20); ctx.lineTo(Math.cos(ar + 2.4) * 3, o.yDir > 0 ? 14 : -14);
      ctx.restore();
    } else if (o.type === "log") {
      ctx.save();
      ctx.translate(cx, y - 4 * scale);
      ctx.scale(scale, scale);
      ctx.rotate(o.yaw || 0);
      const grad = ctx.createLinearGradient(-22, 0, 22, 0);
      grad.addColorStop(0, "#7c4a12"); grad.addColorStop(0.5, "#a16207"); grad.addColorStop(1, "#713f12");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(-24, -5, 48, 11, 5); ctx.fill();
      ctx.strokeStyle = "#fcd34d"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    } else { // oil
      ctx.save();
      ctx.translate(cx, y + 2 * scale);
      ctx.scale(scale, scale * 0.8);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
      g.addColorStop(0, "rgba(30,41,59,0.85)"); g.addColorStop(0.7, "rgba(56,65,85,0.7)"); g.addColorStop(1, "rgba(56,65,85,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
      // rainbow glint
      ctx.strokeStyle = "rgba(94,234,212,0.5)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // ----------------------------------------------------------------------- rider
  _drawRider() {
    const ctx = this.ctx;
    const baseY = this.playerY - this.hop;
    const halfRoad = this.botHalf;
    const x = this.W / 2 + Math.max(-halfRoad * 0.6, Math.min(halfRoad * 0.6, this.laneRoad));

    ctx.save();
    ctx.translate(x, baseY);

    // shadow under the bike that widens as we hop (cricket)
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 2 + this.hop * 0.12, 34 - this.hop * 0.18, 8 - this.hop * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // bank the whole (rider + bike) to the RIGHT as lean grows: leaning is
    // clockwise on screen, so negative rotation tips the top over to the right.
    ctx.rotate(-this.lean * 0.42);
    this._drawBikeSprites();
    ctx.restore();

    // ability chip
    ctx.font = "12px system-ui, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    ctx.textAlign = "center";
    ctx.fillText(this.character.name + " · " + this.character.ability, this.W / 2, this.H - 14);
  }

  _wheelAt(wx, r, spin) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(wx, 0);
    ctx.fillStyle = "#0b0f18";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(spin);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r + 2); ctx.stroke();
    }
    ctx.restore();
  }

  _drawBikeSprites() {
    const ctx = this.ctx;
    const ch = this.character;
    const spin = this.distance * 0.4;
    const rearR = 15, frontR = 15;

    // --- rear wheel ---
    this._wheelAt(-18, rearR, spin);
    // --- front wheel ---
    this._wheelAt(20, frontR, spin);

    // --- chassis (frame low to wheels) ---
    ctx.fillStyle = "#dc2626";
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-26, -10);
    ctx.quadraticCurveTo(-6, -20, 14, -14);   // tail rises toward seat
    ctx.lineTo(30, -6);                       // fork top
    ctx.quadraticCurveTo(34, 0, 28, 2);
    ctx.quadraticCurveTo(6, 6, -24, 4);
    ctx.quadraticCurveTo(-32, 0, -26, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // seat
    ctx.fillStyle = "#1f2937";
    ctx.beginPath(); ctx.roundRect(2, -20, 16, 6, 3); ctx.fill();
    // handlebar
    ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(27, -8); ctx.lineTo(31, -2); ctx.stroke();

    // --- rider torso over the seat ---
    ctx.fillStyle = ch.color;
    ctx.fillRect(-2, -34, 16, 18);            // torso leaning forward
    ctx.strokeStyle = ch.color; ctx.lineWidth = 3; ctx.lineCap = "round";
    // forward arm to the handlebar
    ctx.beginPath(); ctx.moveTo(8, -28); ctx.lineTo(28, -8); ctx.stroke();
    // far wheel cover hint

    // --- head (character emoji) ---
    const faceSize = Math.round(ch.id === "cricket" ? 22 : 24);
    ctx.font = faceSize + 'px serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ch.emoji, 4, -40);

    // helmet / little stick leg if visible bottom
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-16, -14); ctx.lineTo(-22, 6); ctx.stroke(); // rear leg to peg
  }

  _drawParticles() {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 1; p.y += p.vy * 1;
      p.alpha = Math.max(0, p.life / p.maxLife) * p.baseA;
      const a = Math.max(0, Math.min(1, p.alpha));
      if (p.kind === "skid") {
        ctx.fillStyle = "rgba(214,226,244," + a.toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "streak") {
        ctx.strokeStyle = "rgba(148,163,184," + (a * 0.5).toFixed(3) + ")";
        ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.len); ctx.stroke();
      } else if (p.kind === "dust") {
        ctx.fillStyle = "rgba(196,181,253," + (a * 0.7).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000 || 0.016, 0.035);
    this._last = now;
    this._step(dt);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawSceneBack();
    this._drawRoad();
    this._drawObstacles();
    this._drawParticles();
    this._drawRider();

    // HUD: distance + lean gauge
    ctx.fillStyle = "rgba(226,232,240,0.85)";
    ctx.font = "13px system-ui, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(this.score + " m · L" + this.level, this.W - 12, 20);
    ctx.fillStyle = "rgba(226,232,240,0.45)";
    ctx.font = "10px system-ui, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("HOLD ➡ to lean into the curve", 10, this.H - 8);
    requestAnimationFrame((t) => this._loop(t));
  }
}
