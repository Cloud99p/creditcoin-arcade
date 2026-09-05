/**
 * Nutty Rider — pseudo-3D desert drift racer (Option A).
 *
 * THE TRACK
 *   A lone DIRT road runs through the desert. It is straight most of the time,
 *   but it has BEND segments of RANDOM LENGTH. Coming out of a straight the
 *   road bends RIGHT for a while, then bends LEFT and returns to straight.
 *   You can only ever REDRIFT RIGHT (press & hold). So timing is everything:
 *     - a RIGHT bend sweeping under you  -> HOLD to drift right with it
 *     - the road turning back LEFT/straight -> RELEASE so you settle centre.
 *   Hold too long after it straightened, or too early before the bend, and the
 *   dirt sweeps out from under you.
 *
 * LOSE = the rider leaves the DIRT (you rode off the platform) — either by
 * drifting too far as a bend whips past, or being KNOCKED off by a hazard.
 * Obstacles: FANS blow you toward the rim; swinging LOGS knock you sideways.
 * They appear anywhere, and sometimes right after a bend.
 *
 * Background = desert (sun, mesas, heat haze). Track = graded DIRT.
 * Characters are code-drawn pseudo-3D "from behind" riders on a real
 * volumetric bike. Pure canvas, no assets. Emits score via onEnd / onScore.
 */

export const CHARACTERS = [
  { id: "pig",     name: "Pig",     emoji: "🐷", color: "#f9a8d4", dark: "#be185d", ability: "Iron Body", desc: "Shrugs off fans",        stat: { turn: 1.0,  knock: 0.20, grip: 1.00 } },
  { id: "goat",    name: "Goat",    emoji: "🐐", color: "#fdba74", dark: "#c2410c", ability: "Climber",   desc: "Recovers off the rim",   stat: { turn: 1.12, knock: 0.42, grip: 0.96 } },
  { id: "banana",  name: "Banana",  emoji: "🍌", color: "#fde047", dark: "#a16207", ability: "Grip",      desc: "Holds the tight drift", stat: { turn: 0.92, knock: 0.38, grip: 1.52 } },
  { id: "cricket", name: "Cricket", emoji: "🦗", color: "#bef264", dark: "#4d7c0f", ability: "Hop",       desc: "Jumps the log",         stat: { turn: 1.05, knock: 0.58, grip: 1.10 } },
];

const MAX_LEAN = 0.98;
const PRESS_ACCEL = 5.6;     // lean-easing speed (feel only)
const RECOVER = 3.2;         // lean-easing recovery (feel only)
const BASE_SPEED = 300;
const MAX_SPEED_UP = 300;
const PLAYER_Y_FRAC = 0.74;
// Rider lateral units. Bed half-width is 1.0 lane-unit wide on each side of
// the ribbon centre. The rider moves in these SAME units across the screen.
const LANE_W = 1.0;
// How far a bend is allowed to sweep the dirt centre off-screen-centre, in
// lane units. Bigger = more aggressive pushes toward the lip.
const BEND_AMP = 0.96;
const BEND_SLOPE = 0.00085;   // lane-units of centreline-lean per distance unit
// Controls the rider's own lateral physics (velLane in lane-units/sec).
const SCRUB = 0.7;           // passive scrub: slowly eases rider left on release
const GRIP_DRAG = 2.2;       // tyre scrub multiplies velocity decay

export class NuttyRider {
  constructor(canvas, { onScore, onEnd, character = CHARACTERS[0] } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScore = onScore || (() => {});
    this.onEnd = onEnd || (() => {});
    this.character = character;
    this.running = false;

    // screen geometry
    this.W = 0; this.H = 0; this.dpr = 1;
    this.horizonY = 0; this.playerY = 0;
    this.roadHalf = 0; this.topHalf = 0; this.bermHalf = 0;

    // kinematics
    this.t = 0; this.distance = 0; this.speed = 0;
    this.lane = 0; this.velLane = 0; this.lean = 0;
    this.hold = false; this.hop = 16; this.dead = false;
    this.shiftPx = 0;

    // course + world
    this.courseSegs = [];
    this.nextSpawn = 90;
    this.obstacles = [];
    this.particles = [];
    this.score = 0; this.level = 1;

    this._resize();
    this._buildCourse();
    this._bind();
  }

  // ------------------------------------------------------------ geometry --
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = Math.min(window.innerWidth - 16, 460);
    const h = Math.min(window.innerHeight - 188, 700);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    this.horizonY = Math.round(h * 0.30);
    this.playerY = h * PLAYER_Y_FRAC;
    this.roadHalf = w * 0.42;      // half dirt width at the rider row (px)
    this.topHalf = Math.max(8, w * 0.06);
    this.bermHalf = w * 0.10;      // shoulder/berm width (px)
  }
  kToY(k) { return this.horizonY + (this.playerY - this.horizonY) * k; }
  bedHalfAt(k) { return this.topHalf + (this.roadHalf - this.topHalf) * k; }
  // lane-unit -> px from the playable centre anchor:
  laneToPx(l) { return l * (this.roadHalf - 6); }

  // ------------------------------------------------------------- input --
  _bind() {
    const down = (e) => { if (this.running && !this.dead) { this.hold = true; if (e && e.cancelable) e.preventDefault(); } };
    const up = () => { this.hold = false; };
    this.canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("pointerleave", up);
    window.addEventListener("keydown", (e) => {
      const c = e.code;
      if ((c === "ArrowRight" || c === "KeyD" || c === "Space") && this.running && !this.dead) { this.hold = true; if (e.cancelable) e.preventDefault(); }
      if ((c === "ArrowUp" || c === "KeyW" || c === "Space") && this.character.id === "cricket" && this.running && !this.dead) this._hop();
    });
    window.addEventListener("keyup", (e) => {
      const c = e.code;
      if (c === "ArrowRight" || c === "KeyD" || c === "Space") this.hold = false;
    });
  }

  // ------------------------------------------------------------- course --
  // Alternating segments: straight / RIGHT-bend / LEFT (return) / straight ...
  // Lengths vary so a drift can be a short flick or a long sustained lean.
  _buildCourse() {
    const segs = [];
    let sign = Math.random() < 0.5 ? 1 : -1;   // which way the NEXT real bend leans
    let total = 0;
    while (total < 26000) {
      // lead straight
      const a = 140 + Math.random() * 220; segs.push({ d: 0, len: a }); total += a;
      // a real bend, random length, leaning `sign` (mostly right=+1 by design?)
      // we make right bends (+1) common so HOLD is the frequent ask
      const bl = 520 + Math.random() * (sign > 0 ? 900 : 640);
      segs.push({ d: sign, len: bl }); total += bl;
      // the return leg that brings the road back to straight-ish
      const rl = 520 + Math.random() * 640;
      segs.push({ d: -sign, len: rl }); total += rl;
      if (Math.random() < 0.6) sign = -sign;
    }
    // bias every segment toward +1 somewhat more often => HOLD is the common
    // sustained tool (fits "you drift right") without making left-only tracks.
    this.courseSegs = segs;
  }

  // Where the dirt CENTRE has been pushed (lane units) at distance d, clamped
  // to BEND_AMP so the road stays drawable/lovable, plus a little s-curve.
  _centerBias(d) {
    const s = this.courseSegs;
    let acc = 0, lat = 0, i = 0;
    // accumulate full segments before d
    for (i = 0; i < s.length && acc + s[i].len <= d; i++) { lat += s[i].d * BEND_SLOPE * s[i].len; acc += s[i].len; }
    const seg = s[Math.min(i, s.length - 1)];
    const part = seg.len ? Math.max(0, Math.min(1, (d - acc) / seg.len)) : 0;
    lat += seg.d * BEND_SLOPE * seg.len * part;
    // clamp
    return Math.max(-BEND_AMP, Math.min(BEND_AMP, lat));
  }

  _hop() { if (this.character.id === "cricket") this.hop = Math.max(this.hop, 60); }

  start() { this._resize(); this._restart(); this.running = true; this._last = performance.now(); this._loop(this._last); }

  _restart() {
    this.t = 0; this.distance = 0; this.speed = 0;
    this.lane = 0; this.velLane = 0; this.lean = 0;
    this.hold = false; this.hop = 16; this.dead = false;
    this.obstacles = []; this.particles = []; this.nextSpawn = 90;
    this.score = 0; this.level = 1;
  }

  // -------------------------------------------------------------- step --
  _step(dt) {
    if (this.dead) return;
    this.t += dt;
    this.speed += (BASE_SPEED + Math.min(MAX_SPEED_UP, this.distance * 0.5) - this.speed) * Math.min(1, dt * 1.4);
    this.distance += this.speed * dt;

    const grip = this.character.stat.grip;
    const bias = this._centerBias(this.distance);   // road centre lateral (units)
    // ribbon fade for render: the drawn dirt centre follows the bend smoothly
    this.shiftPx += (this.laneToPx(bias) - this.shiftPx) * Math.min(1, dt * 5);

    // --- RIDER LATERAL ------------------------------------------------
    // The rider's absolute screen-lane is driven by steering. ONLY a HOLD
    // pushes right (HARD lean = right). Released, the bike scrubs back LEFT a
    // little on its own. Falls occur RELATIVE to the dirt centre (`bias`),
    // which a bend sweeps sideways underneath you — so you must HOLD to ride a
    // right sweep right, and RELEASE so the return lets you settle centre.
    const turn = this.character.stat.turn;
    const leanLim = 1 - Math.min(0.9, this.lean);  // deeper lean = less room to keep steering
    if (this.hold) {
      this.lean += (MAX_LEAN - this.lean) * Math.min(1, PRESS_ACCEL * turn * dt);
      this.velLane += 1.15 * turn * 46 * dt;              // push RIGHT (units/s)
    } else {
      this.lean += (0 - this.lean) * Math.min(1, RECOVER * turn * dt);
      this.velLane -= SCRUB * 30 * dt;                    // gentle leftward scrub
    }
    // grip = how well the slide is collected;
    this.velLane *= Math.max(0, 1 - GRIP_DRAG * graspOf(grip) * dt);
    this.lane += this.velLane * dt;
    // screen-coherent reach: never drawn past a modest half-screen envelope
    this.lane = Math.max(-0.96, Math.min(0.96, this.lane));
    void leanLim;

    // --- hop ------------------------------------------------
    if (this.character.id === "cricket") {
      if (this.hold && this.lane > bias + 0.55 && this.hop <= 16) {
        // (cricket hop is input-triggered only; nothing forced here)
      }
    }
    if (this.hop > 16) this.hop = Math.max(16, this.hop - 260 * dt);
    else this.hop = 16;

    // --- FALL: left the dirt -------------------------------------------
    const riderToRoad = Math.abs(bias - this.lane);   // abs lane-units from bed centre
    if (this.character.id === "goat") {
      // Climber claws back from the outer couple of % (tiny grace only)
      if (riderToRoad > LANE_W + 0.030) this._fall();
    } else if (riderToRoad >= LANE_W - 0.012) {
      this._fall();
    }

    // --- obstacles --------------------------------------------
    this.nextSpawn -= this.speed * dt;
    if (this.nextSpawn <= 0) { this._spawnOb(); this.nextSpawn = 240 + Math.random() * 220 + (this.speed > BASE_SPEED ? 40 : 0); }
    for (const o of this.obstacles) { o.ahead -= this.speed * dt; o.t += dt; if (o.type === "log") o.swing = Math.sin(o.t * 1.4 + o.phase) * 0.55; }
    this.obstacles = this.obstacles.filter((o) => o.ahead > -60 && !o.hit);

    this._emitAmbient(dt);

    // collisions at the rider's current band
    for (const o of this.obstacles) {
      if (o.hit || o.ahead > 60 || o.ahead < -60) continue;
      // near contact if within ~ a band around the rider on screen distance
      const oBand = o.band !== undefined ? o.band : 0; // obstacle's own lateral band offset from road centre
      const obxRel = o.type === "log" ? o.swing : o.frac;
      const obxC = bias + obxRel;                       // absolute lane of hazard
      const gap = Math.abs(obxC - this.lane);
      const half = o.type === "log" ? 0.16 : 0.12;
      if (gap < 0.12 + half) {
        // only when the obstacle is actually AT the rider's depth
        const krel = 1 + o.ahead / 40;
        if (o.ahead > -40 && o.ahead < 2) this._resolveHit(o);
      }
    }

    this.score = Math.max(this.score || 0, Math.floor(this.distance / 12));
    this.level = Math.floor(this.distance / 600) + 1;
    this.onScore(this.score, this.level);
  }

  _spawnOb() {
    // pick a lateral band offset from the current road CENTRE; a fan may sit
    // on the shoulder pressing you off, a log swings across a wider arc
    const type = Math.random() < 0.5 ? "fan" : "log";
    if (type === "log") {
      this._addOb(type, 0, 300 + Math.random() * 160, Math.random() * 6.28);
    } else {
      // fans: some sit near your line; the hardest sit just off the shoulder
      const edge = Math.random() < 0.45;
      const frac = edge ? (Math.random() < 0.5 ? -0.78 : 0.78) : (Math.random() * 2 - 1) * 0.5;
      this._addOb(type, frac, 300 + Math.random() * 160, 0);
    }
  }
  _addOb(type, frac, ahead, phase) {
    this.obstacles.push({ type, frac, ahead, phase, hit: false, t: 0, swing: 0 });
  }

  _resolveHit(o) {
    if (this.dead) return;
    if (o.type === "log" && this.character.id === "cricket" && this.hop > 16) { o.hit = true; this.hop = 16; return; }
    o.hit = true;
    // a hazard shoves the rider toward an edge, and takes a bite of lean
    const pushDir = Math.abs(this.lane) < 0.05 ? (Math.random() < 0.5 ? 1 : -1)
      : (this.lane >= 0 ? 1 : -1);
    const useKnock = this.character.stat.knock * (o.type === "fan" ? 1.0 : 0.85);
    const resist = 1 - useKnock;
    const mag = (o.type === "fan" ? 0.30 : 0.30) * (1.25 - this.character.stat.grip * 0.15);
    this.velLane += pushDir * resist * mag * 3.0;
    this.lean = Math.min(MAX_LEAN, this.lean + 0.25);
    // knock may put you over the edge at once — check now (goat can still claw)
    const bias = this._centerBias(this.distance);
    if (Math.abs(bias - this.lane) > (this.character.id === "goat" ? LANE_W + 0.02 : LANE_W - 0.012)) {
      if (this.character.id === "goat") { this.velLane *= -0.5; /* bounced back in */ }
      else this._fall();
    }
  }

  _fall() {
    if (this.dead) return;
    this.dead = true;
    this.running = false;
    const s = Math.max(this.score || 0, Math.floor(this.distance / 12));
    this.score = s;
    this.onEnd(s);
  }

  // =============================================================== render ==
  _roadCX(k) { return this.W / 2 + this.shiftPx * k; }
  _riderX() { return this.W / 2 + this.laneToPx(this.lane); }

  _drawDesert() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const g = ctx.createLinearGradient(0, 0, 0, this.horizonY + 2);
    g.addColorStop(0, "#37146a"); g.addColorStop(0.45, "#c64a1e"); g.addColorStop(1, "#ffcf6e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, this.horizonY + 2);
    // sun + halo
    ctx.fillStyle = "rgba(255,206,120,0.25)";
    ctx.beginPath(); ctx.arc(W * 0.78, this.horizonY - 2, Math.max(30, H * 0.05), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd27d";
    ctx.beginPath(); ctx.arc(W * 0.78, this.horizonY - 2, Math.max(18, H * 0.03), 0, Math.PI * 2); ctx.fill();
    // far mesas
    ctx.fillStyle = "#a0391d";
    ctx.fillRect(0, this.horizonY - 24, W * 0.20, 32); ctx.fillRect(W * 0.40, this.horizonY - 40, W * 0.12, 48);
    ctx.fillRect(W * 0.92, this.horizonY - 14, W * 0.09, 22);
    ctx.fillStyle = "#6f2712";
    ctx.beginPath(); ctx.moveTo(0, this.horizonY);
    ctx.lineTo(W * 0.16, this.horizonY - 18); ctx.lineTo(W * 0.32, this.horizonY - 4);
    ctx.lineTo(W * 0.5, this.horizonY - 28); ctx.lineTo(W * 0.68, this.horizonY - 6);
    ctx.lineTo(W * 0.85, this.horizonY - 18); ctx.lineTo(W, this.horizonY - 2);
    ctx.closePath(); ctx.fill();
    // desert floor you fall INTO past the dirt
    const d = ctx.createLinearGradient(0, this.horizonY, 0, H);
    d.addColorStop(0, "#d99545"); d.addColorStop(1, "#7c431c");
    ctx.fillStyle = d; ctx.fillRect(0, this.horizonY, W, H - this.horizonY);
    ctx.strokeStyle = "rgba(120,60,20,0.22)"; ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const x0 = (i * 149) % W, y0 = this.horizonY + 8 + ((i * 61) % (H - this.horizonY - 12));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + 11, y0 + 3); ctx.stroke();
    }
    if (this.lean > 0.5) ctx.fillStyle = "rgba(255,240,210,0.10)"; // heat haze
  }

  _drawRoad() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const bottomK = (H - this.horizonY) / (this.playerY - this.horizonY);
    const N = 30, Kmax = bottomK;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const kRaw = Kmax * i / N;
      const far = kRaw <= 1;
      const k = Math.min(1, kRaw);
      const y = far ? this.kToY(k) : this.playerY + (kRaw - 1) * (H - this.playerY);
      const half = far ? this.bedHalfAt(k) : this.roadHalf + (kRaw - 1) * this.roadHalf * 0.3;
      const cx = this._roadCX(k);
      const left = cx - half, right = cx + half;
      if (prev) {
        const g = ctx.createLinearGradient(0, prev.y, 0, y);
        g.addColorStop(0, "#c98a3f"); g.addColorStop(1, "#ae6d2c");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(prev.l, prev.y); ctx.lineTo(prev.r, prev.y);
        ctx.lineTo(right, y); ctx.lineTo(left, y); ctx.closePath(); ctx.fill();
        // side berms (shoulder drop)
        ctx.fillStyle = "#8a5a26";
        ctx.beginPath(); ctx.moveTo(prev.l - this.bermHalf, prev.y); ctx.lineTo(prev.l, prev.y);
        ctx.lineTo(left, y); ctx.lineTo(left - this.bermHalf, y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(prev.r, prev.y); ctx.lineTo(prev.r + this.bermHalf, prev.y);
        ctx.lineTo(right + this.bermHalf, y); ctx.lineTo(right, y); ctx.closePath(); ctx.fill();
      }
      prev = { l: left, r: right, y };
    }
    // pale worn edge lines on the dirt lips
    ctx.strokeStyle = "rgba(255,236,200,0.8)"; ctx.lineWidth = 2.4;
    const trace = (side) => {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= N; i++) {
        const kRaw = Kmax * i / N; const sp = kRaw > 1; const k = Math.min(1, kRaw);
        const y = sp ? this.playerY + (kRaw - 1) * (H - this.playerY) : this.kToY(k);
        const half = sp ? this.roadHalf + (kRaw - 1) * this.roadHalf * 0.3 : this.bedHalfAt(k);
        const x = side(this._roadCX(k), half);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    trace((cx, h) => cx - h);
    trace((cx, h) => cx + h);
    // centre dashed line
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 3;
    for (let i = 0; i < N - 1; i += 2) {
      const kA = Kmax * i / N, kB = Kmax * (i + 1) / N;
      ctx.beginPath();
      ctx.moveTo(this._roadCX(Math.min(1, kA)), this.kToY(Math.min(1, kA)));
      ctx.lineTo(this._roadCX(Math.min(1, kB)), this.kToY(Math.min(1, kB))); ctx.stroke();
    }
  }

  _drawObstacleShape(o, cx, y, k) {
    const ctx = this.ctx;
    const s = Math.max(0.16, 0.3 + k * 1.1);
    ctx.save();
    ctx.translate(cx, y);
    if (o.type === "fan") {
      ctx.scale(s, s);
      ctx.fillStyle = "#7f6a2f";
      ctx.beginPath(); ctx.ellipse(0, 9, 34, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#474747"; ctx.strokeStyle = "#2c2c2c"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-20, -13, 40, 32, 6); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.translate(0, -20);
      ctx.fillStyle = "#161616"; ctx.strokeStyle = "#8a8a8a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // rotating danger blades
      const a = this.t * 20;
      for (let b = 0; b < 3; b++) {
        const an = a + b * 2.094;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(an) * 26, Math.sin(an) * 26);
        ctx.strokeStyle = "rgba(255,120,120,0.8)"; ctx.lineWidth = 6; ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,190,90,0.95)"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // gust toward the play lane (drawn pointing whichever the hazard blows)
      ctx.fillStyle = "rgba(255,255,240,0.3)";
      for (let gIdx = 0; gIdx < 3; gIdx++) { const yy = -14 - gIdx * 9; ctx.fillRect(-58, yy - 1, 16 + gIdx * 6, 2); }
      ctx.restore();
    } else {
      // LOG pendulum: a timber beam hinged on one side swinging across
      ctx.scale(s, s);
      const L = 30;
      // pivot post
      ctx.fillStyle = "#5d4118"; ctx.fillRect(6, 0, 7, 20);
      ctx.fillStyle = "#6e501f"; ctx.fillRect(0, 20, 20, 6);
      ctx.save();
      ctx.translate(0, 0);
      // beam angled by the swing when NOT centred on the hinge is complex;
      // draw the log as a horizontal swinging board at this position
      const grad = ctx.createLinearGradient(-L, 0, L, 0);
      grad.addColorStop(0, "#8a4a12"); grad.addColorStop(0.5, "#c9842a"); grad.addColorStop(1, "#6b3a10");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(-L, -5, L * 2, 10, 5); ctx.fill();
      ctx.strokeStyle = "#f0b54a"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = "rgba(70,35,6,0.6)";
      for (let gIdx = 0; gIdx < 3; gIdx++) ctx.fillRect(-L + 5 + gIdx * 18, -3, 2, 6);
      ctx.restore();
      ctx.restore();
    }
  }

  _drawObstacles() {
    const ctx = this.ctx;
    const sorted = this.obstacles.slice().sort((a, b) => b.ahead - a.ahead);
    for (const o of sorted) {
      if (o.hit || o.ahead < -80) continue;
      const depth = Math.max(0, o.ahead);
      const k = Math.max(0.03, Math.min(1, 1 - depth / 320));
      const y = this.kToY(k);
      const cx = this._roadCX(k) + this.laneToPx(o.type === "log" ? 0 : o.frac);
      this._drawObstacleShape(o, cx, y, k);
    }
  }

  _drawParticles() {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p || p.life <= 0) continue;
      const a = Math.max(0, p.life / p.maxLife);
      if (p.kind === "dust") {
        const rx = this._riderX() + p.x;
        const ry = this.playerY + p.y - Math.max(0, this.hop - 16) * 0.4;
        ctx.globalAlpha = a * 0.9; ctx.fillStyle = "#e8c98a";
        ctx.beginPath(); ctx.arc(rx, ry, Math.max(1, p.size * (1 - a * 0.3)), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = a * 0.5; ctx.strokeStyle = "#f7ebb7"; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - p.vy * 0.05); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawRiderBack(pX, y, scale) {
    const ctx = this.ctx;
    const c = this.character;
    const wheelR = 16 * scale;
    ctx.save();
    ctx.translate(pX, y + this.roadHalf * 0.10);
    ctx.rotate(-this.lean * 0.55);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    // ground shadow (ground-linked)
    ctx.save(); ctx.rotate(this.lean * 0.55); ctx.globalAlpha = 0.26; ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(0, 0, 40, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const tyre = (x, r) => {
      ctx.fillStyle = "#241a12"; ctx.strokeStyle = "#40301c"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const sp = this.distance * 0.25; ctx.strokeStyle = "#6b522f"; ctx.lineWidth = 1.5;
      for (let s = 0; s < 3; s++) { const an = sp + s * 2.094; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + Math.cos(an) * (r - 2), Math.sin(an) * (r - 2)); ctx.stroke(); }
    };
    tyre(-13, wheelR); tyre(11, 11);
    ctx.strokeStyle = c.dark; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(6, -26); ctx.stroke();
    ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(6, -26); ctx.lineTo(16, -10); ctx.stroke();
    ctx.strokeStyle = "#202020"; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(8, -22); ctx.lineTo(10, -2); ctx.stroke();
    // torso (back)
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.moveTo(2, -24); ctx.quadraticCurveTo(10, -44, 2, -50);
    ctx.quadraticCurveTo(-8, -50, -8, -38); ctx.quadraticCurveTo(-9, -30, 2, -24);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(-0.5, -27); ctx.lineTo(-1, -45); ctx.stroke(); ctx.globalAlpha = 1;
    // arm toward bars
    ctx.strokeStyle = c.dark; ctx.lineWidth = 4.4; ctx.beginPath(); ctx.moveTo(6, -34); ctx.lineTo(-11, -16); ctx.stroke();
    // helmet
    const cy = -52; ctx.fillStyle = c.dark; ctx.beginPath(); ctx.arc(-2, cy, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(-2, cy, 8.2, 0, Math.PI * 2); ctx.fill();
    if (c.id === "cricket") {
      ctx.strokeStyle = c.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, cy - 8); ctx.lineTo(-7, cy - 15); ctx.moveTo(1, cy - 9); ctx.lineTo(3, cy - 16); ctx.stroke();
    }
    ctx.strokeStyle = "#141414"; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(-16, -14); ctx.lineTo(12, -14); ctx.stroke();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-7, -18); ctx.lineTo(-7, -6); ctx.moveTo(8, -16); ctx.lineTo(8, -6); ctx.stroke();
    ctx.restore();
  }

  _drawRider() {
    const ctx = this.ctx;
    const hopPx = Math.max(0, this.hop - 16) * 1.1;
    const rx = this._riderX();
    this._drawRiderBack(rx, this.playerY - hopPx, 1.0);
    ctx.fillStyle = "#fff7e8"; ctx.font = "11px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(this.character.name + "  ·  " + this.character.ability, this.W / 2, this.H - 12);
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.035) || 0.016;
    this._last = now;
    this._step(dt);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawDesert();
    this._drawRoad();
    this._drawObstacles();
    this._drawParticles();
    this._drawRider();
    ctx.fillStyle = "#ffe9b0"; ctx.font = "13px system-ui"; ctx.textAlign = "left";
    ctx.fillText(this.score + " m  ·  L" + this.level, 10, 18);
    if (!this.dead) {
      ctx.font = "10px system-ui"; ctx.fillStyle = "#ffe2a8"; ctx.textAlign = "center";
      ctx.fillText("HOLD = drift RIGHT   ·   RELEASE = settle", this.W / 2, this.H - 2);
    }
    requestAnimationFrame((tt) => this._loop(tt));
  }

  _emitAmbient(dt) {
    if (this.dead) return;
    const lean = Math.abs(this.lean);
    if (lean > 0.2 && Math.random() < 34 * dt) {
      const dir = this.lean >= 0 ? -1 : 1;
      this.particles.push({ kind: "dust", x: 0, y: 22, vx: dir * (20 + Math.random() * 60), vy: (Math.random() - 0.5) * 30, life: 0.5 + Math.random() * 0.4, maxLife: 1, size: 3 + Math.random() * 3 });
    }
    const spd = (this.speed - BASE_SPEED) / MAX_SPEED_UP;
    if (spd > 0 && Math.random() < (24 + spd * 90) * dt) {
      this.particles.push({ kind: "streak", x: (Math.random() - 0.5) * this.W * 0.9, y: this.horizonY + Math.random() * (this.H - this.horizonY), vx: 0, vy: 220 + Math.random() * 220, life: 0.35 + Math.random() * 0.3, maxLife: 1, size: 1 + Math.random() * 2 });
    }
    if (this.particles.length > 90) this.particles = this.particles.slice(-90);
    for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}

// helper predicate used above
function graspOf(g) { return g; }
