/**
 * Fruit Merge — Suika / watermelon-style merge game.
 *
 * The entire play container IS a big blender jar (it replaces the bowl
 * outline). Fruits drop in through the top opening; identical fruits merge
 * into the next tier. Merge two Watermelons to BLEND them into juice and
 * compact the pile. Fruits unlock progressively: a tier only enters the
 * droppable queue after you've merged your way up to it once. Overflow the
 * rim and it's game over.
 *
 * Pure canvas + physics, flat styling, no external deps. Emits the final
 * score via onScore(score) and ends via onEnd(score) for the Attestcoin pipe.
 */

// radius as a fraction of the JAR's inner width (play container).
// poly = the fruit's REAL collision silhouette as a normalized convex polygon
// (vertices scaled by r*w, half-extent ~1). Pears are tall with a narrow neck,
// watermelons wide, strawberries wide with a pointy top... so neighbours
// CATCH on the actual fruit outline instead of sliding around a circle. That
// interlocking is what makes every drop need thought and separates skill.
export const FRUITS = [
  { tier: 1, name: "Cherry",     emoji: "🍒", r: 0.055, pts: 10,  color: "#f87171", poly: oct(1.10, 0.95) },
  { tier: 2, name: "Strawberry", emoji: "🍓", r: 0.075, pts: 20,  color: "#fb7185", poly: [[0, -1.05], [1.05, -0.2], [0.9, 0.85], [0, 1.0], [-0.9, 0.85], [-1.05, -0.2]] },
  { tier: 3, name: "Grape",      emoji: "🍇", r: 0.100, pts: 40,  color: "#8e7cc3", poly: oct(1.05, 1.05) },
  { tier: 4, name: "Orange",     emoji: "🍊", r: 0.132, pts: 80,  color: "#fbbf24", poly: oct(1.0, 1.0) },
  { tier: 5, name: "Apple",      emoji: "🍎", r: 0.172, pts: 160, color: "#f43f5e", poly: [[0.9, -0.25], [0.5, -1.05], [-0.5, -1.05], [-0.9, -0.25], [-0.65, 0.9], [0, 1.1], [0.65, 0.9]] },
  { tier: 6, name: "Pear",       emoji: "🍐", r: 0.220, pts: 320, color: "#4ade80", poly: [[0.32, -1.12], [0.88, -0.5], [0.85, 0.15], [0.45, 0.78], [0, 1.05], [-0.45, 0.78], [-0.85, 0.15], [-0.88, -0.5], [-0.32, -1.12]] },
  { tier: 7, name: "Watermelon", emoji: "🍉", r: 0.280, pts: 640, color: "#22c55e", poly: [[-1.3, 0], [-1.05, 1.0], [0, 1.28], [1.05, 1.0], [1.3, 0], [1.05, -1.0], [0, -1.28], [-1.05, -1.0]] },
];

// build a rounded polygon (octagon) for round-ish fruits; sx/sy squash it
function oct(sx, sy) {
  const p = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.push([Math.cos(a) * sx, Math.sin(a) * sy]);
  }
  return p;
}

const GRAVITY = 1250;        // px/s^2
const DAMPING = 0.80;        // collision impulse damping
const ROUNDS = 4;            // physics sub-steps per frame
const MERGE_EPS = 0.06;      // relative radius diff allowed to merge
const DROP_MAX_TIER = 6;     // never drop watermelons — merge two pears
const SPAWN_GRACE = 0.7;     // seconds a fresh fruit is safe from overflow
const OVERFLOW_HOLD = 0.55;  // seconds the pile-top must sit above the line to end (anti-spam)
const MIN_OPEN = 40;         // min drop gap (px) before we block drops

const WEIGHTS = { 1: 38, 2: 32, 3: 18, 4: 8, 5: 3, 6: 1 };

export class FruitMerge {
  constructor(canvas, { onScore, onEnd } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScore = onScore || (() => {});
    this.onEnd = onEnd || (() => {});
    this.running = false;
    this.t = 0; // runtime seconds (for spawn grace)

    // jar geometry
    this.W = 0;
    this.H = 0;
    this.jar = null;    // { x, y, w, h } outer jar
    this.inner = null;  // { x, y, w, h } play area inside the jar
    this.rimY = 0;      // rim opening Y (top) — where fruits drop in
    this.bottomY = 0;   // static floor: fruits rest on the jar base
    this.crushY = 0;    // kill line: overflow when a settled fruit sits above it

    this.fruits = [];
    this.currentTier = 1;
    this.nextTier = 1;
    this.stream = [];
    this.unlocked = new Set([1, 2]);
    this.score = 0;
    this.mergeCount = 0;
    this.blendCount = 0;
    this.spawnX = 0;
    this.dropLocked = false;
    this.gameOver = false;
    this.blendFx = null;

    this._resize();
    this._bind();
  }

  // ------------------------------------------------------------------ layout
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    // big jar: fill most of the left-over screen, portrait-ish
    const w = Math.min(window.innerWidth - 16, 420);
    const h = Math.min(window.innerHeight - 150, 720);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // the jar spans the full canvas (it IS the outline)
    const t = 12; // stroke thickness
    this.jar = { x: 4, y: 4, w: w - 8, h: h - 8 };
    // play area: below the rim opening, above the blade base
    const rim = this.jar.h * 0.06;         // opening band at the very top
    const base = this.jar.h * 0.08;        // blade/base zone at the bottom
    this.inner = {
      x: this.jar.x + t + 6,
      y: this.jar.y + rim + 12,
      w: this.jar.w - (t + 6) * 2,
      h: this.jar.h - rim - base - 20,
    };
    this.rimY = this.inner.y - 6;          // rim opening (top)
    this.bottomY = this.inner.y + this.inner.h; // static floor (jar base)
    // kill line sits just under the rim: the run ends when a truly-settled
    // fruit is pushed up here — poor placements pile up and overflow.
    this.crushY = this.inner.y + this.inner.h * 0.12;
    this.spawnX = this.inner.x + this.inner.w / 2;
  }

  /** World-space polygon vertices for a fruit, from its normalized silhouette.
   *  Rebuilt each physics step from the fruit's current position/scale. */
  _polyPts(f) {
    const { w } = this.inner;
    const s = f.r * w; // scale factor (f.r is a NORMALIZED fraction)
    if (!f.polyPts) f.polyPts = new Array(f.poly.length);
    for (let i = 0; i < f.poly.length; i++) {
      f.polyPts[i] = [f.x + f.poly[i][0] * s, f.y + f.poly[i][1] * s];
    }
    return f.polyPts;
  }

  _bind() {
    this.canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.spawnX = this._clampX(e.clientX - r.left);
    });
    this.canvas.addEventListener("pointerdown", () => this._drop());
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft") this.spawnX = this._clampX(this.spawnX - 18);
      if (e.code === "ArrowRight") this.spawnX = this._clampX(this.spawnX + 18);
      if (e.code === "Space" || e.code === "ArrowDown") this._drop();
    });
  }

  _clampX(x) {
    const { x: ix, w } = this.inner;
    const s = FRUITS[this.currentTier - 1];
    // furthest |x| vertex = widest half-extent (keeps the fruit inside walls)
    let hw = s.r;
    for (const [vx] of s.poly) hw = Math.max(hw, Math.abs(vx) * s.r);
    const px = hw * w;
    return Math.min(Math.max(x, ix + px + 4), ix + w - px - 4);
  }

  // ------------------------------------------------------------- public API
  start() {
    this._resize();
    this.fruits = [];
    this.score = 0;
    this.mergeCount = 0;
    this.blendCount = 0;
    this.unlocked = new Set([1, 2]);
    this.currentTier = 1;
    this.t = 0;
    this.gameOver = false;
    this.dropLocked = false;
    this.blendFx = null;
    this._overflowHold = 0;
    this._prime();
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // -------------------------------------------------------------- progression
  _pickTier() {
    const pool = [...this.unlocked].filter((th) => th <= DROP_MAX_TIER);
    const wsum = pool.reduce((s, th) => s + (WEIGHTS[th] ?? 1), 0);
    let roll = Math.random() * wsum;
    for (const th of pool) {
      roll -= (WEIGHTS[th] ?? 1);
      if (roll <= 0) return th;
    }
    return pool[pool.length - 1] || 1;
  }

  _prime() {
    while (this.stream.length < 5) this.stream.push(this._pickTier());
    this.currentTier = this.stream.shift();
    this.nextTier = this.stream[0];
  }

  _advanceStream() {
    while (this.stream.length < 5) this.stream.push(this._pickTier());
    this.currentTier = this.stream.shift();
    this.nextTier = this.stream[0];
  }

  // --------------------------------------------------------------- dropping
  _drop() {
    if (!this.running || this.gameOver || this.dropLocked) return;
    this.dropLocked = true;

    const { w } = this.inner;
    const spec = FRUITS[this.currentTier - 1];
    const px = spec.r * w;       // actual pixel radius of the dropped fruit
    // furthest negative-Y vertex = top of the silhouette (for spawn height)
    let top = 0;
    for (const [, vy] of spec.poly) top = Math.min(top, vy);
    // spawn just above the rim so it visibly drops IN, with spawn grace.
    // r is stored NORMALIZED (fraction of inner width); geometry helpers
    // multiply by inner.w to get pixels, so do NOT pre-multiply here.
    this.fruits.push({
      tier: this.currentTier, x: this.spawnX,
      y: this.rimY - top * px - 4, r: spec.r,
      poly: spec.poly, vx: 0, vy: 0,
      emoji: spec.emoji, color: spec.color, pts: spec.pts,
      born: this.t, dead: false, ignore: 0,
    });
    this._advanceStream();
  }

  // ---------------------------------------------------------------- merging
  _merge(aIdx, bIdx) {
    const a = this.fruits[aIdx];
    const b = this.fruits[bIdx];
    const { w } = this.inner;

    // BLEND: two top-tier fruits (WATERMELON, tier 7) together => they
    // burst into juice and disappear, compacting the pile. Detect this
    // FIRST (before touching FRUITS[nextTier]) because there is no tier 8.
    if (a.tier >= 7) {
      this.fruits[aIdx].dead = true;
      this.fruits[bIdx].dead = true;
      this.blendCount++;
      this.score += 1000;
      this.onScore(this.score);
      const { x: ix, w: iw } = this.inner;
      const wm = FRUITS[6];
      const px = wm.r * w;
      this.blendFx = { t: 1.2, x: ix + iw / 2, y: this.inner.y + this.inner.h * 0.4, r: px };
      this._blendClear();
      return;
    }

    // Normal merge: two identical fruits of tier < 7 fuse into the NEXT
    // visible fruit (pears, tier 6, fuse into WATERMELON, tier 7 — which
    // then STAYS on the board until a second watermelon blends it away).
    const nextTier = a.tier + 1;
    const target = FRUITS[nextTier - 1];
    const px = target.r * w;   // actual pixel radius of the merged fruit

    this.fruits[aIdx].dead = true;
    this.fruits[bIdx].dead = true;
    this.mergeCount++;
    this.score += target.pts;
    this.onScore(this.score);
    this.unlocked.add(nextTier); // merge-to-unlock

    this.fruits.push({
      tier: nextTier, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: target.r,
      poly: target.poly, vx: (a.vx + b.vx) / 2, vy: Math.min(a.vy, b.vy) * 0.5,
      emoji: target.emoji, color: target.color, pts: target.pts,
      born: this.t, dead: false, ignore: 6,
    });
  }

  /** After a blend, compact the pile so the run keeps going. */
  _blendClear() {
    const { y: iy, h: ih } = this.inner;
    for (const f of this.fruits) {
      if (f.dead) continue;
      f.y = iy + (f.y - iy) * 0.72;
      f.r *= 0.96;
      f.polyPts = null;
      f.vy = 0;
    }
  }

  // ---------------------------------------------------------------- physics
  // Ellipse-ellipse collision: each fruit keeps its real shape (rx/ry half
  // axes), so grapes are wide, pears are tall, etc. Neighbours CATCH on their
  // outlines instead of sliding around perfect circles — that friction is the
  /** SAT: if two convex polygons overlap, return the min overlap + normal.
   *  Null when they don't collide. Axes come from both polygons' edges. */
  _sat(aPts, bPts) {
    let bestOverlap = Infinity, bestNx = 0, bestNy = 0;
    const axes = [];
    for (const pts of [aPts, bPts]) {
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        let ex = p2[0] - p1[0];
        let ey = p2[1] - p1[1];
        axes.push([-ey, ex]); // edge normal
      }
    }
    for (const [nx, ny] of axes) {
      const len = Math.hypot(nx, ny) || 1;
      const ux = nx / len, uy = ny / len;
      let aMin = Infinity, aMax = -Infinity;
      for (const p of aPts) {
        const d = p[0] * ux + p[1] * uy;
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      let bMin = Infinity, bMax = -Infinity;
      for (const p of bPts) {
        const d = p[0] * ux + p[1] * uy;
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap < 0) return null; // separating axis found
      if (overlap < bestOverlap) { bestOverlap = overlap; bestNx = ux; bestNy = uy; }
    }
    // point the normal from a toward b
    const cx = (bPts[0][0] + bPts[2][0]) / 2 - (aPts[0][0] + aPts[2][0]) / 2;
    const cy = (bPts[0][1] + bPts[2][1]) / 2 - (aPts[0][1] + aPts[2][1]) / 2;
    if (cx * bestNx + cy * bestNy < 0) { bestNx = -bestNx; bestNy = -bestNy; }
    return { overlap: bestOverlap, nx: bestNx, ny: bestNy };
  }

  /** lowest vertex (max Y) of a fruit's silhouette — used for floor contact. */
  _lowY(f) {
    let y = -Infinity;
    for (const [, vy] of f.poly) y = Math.max(y, vy);
    return y * (f.r * this.inner.w) + f.y;
  }

  _topY(f) {
    let y = Infinity;
    for (const [, vy] of f.poly) y = Math.min(y, vy);
    return y * (f.r * this.inner.w) + f.y;
  }

  /** widest horizontal half-extent in px — keeps fruits inside the walls. */
  _halfW(f) {
    let hw = 0;
    for (const [vx] of f.poly) hw = Math.max(hw, Math.abs(vx));
    return hw * (f.r * this.inner.w);
  }

  /** Polygon-shape collision. Fruits carry their REAL silhouette (poly), so
   *  pears, watermelons and strawberries interlock on their true outlines.
   *  Friction makes a dropped fruit stick where it lands — no free-sliding
   *  into a perfect merge — so every drop needs placement thought. */
  _step(dt) {
    const { x: ix, w } = this.inner;
    const floor = this.bottomY;

    for (const f of this.fruits) {
      if (f.dead) continue;
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.contact = false;

      // walls
      const hw = this._halfW(f);
      if (f.x - hw < ix) { f.x = ix + hw; f.vx *= -0.25; }
      if (f.x + hw > ix + w) { f.x = ix + w - hw; f.vx *= -0.25; }
      // static floor
      if (this._lowY(f) > floor) {
        f.foot = true;
        f.y -= this._lowY(f) - floor;
        f.vy = Math.min(f.vy, 0);
        f.contact = true;
      }
    }

    for (let pass = 0; pass < ROUNDS; pass++) {
      for (let i = 0; i < this.fruits.length; i++) {
        for (let j = i + 1; j < this.fruits.length; j++) {
          const a = this.fruits[i];
          const b = this.fruits[j];
          if (a.dead || b.dead) continue;

          const hit = this._sat(this._polyPts(a), this._polyPts(b));
          if (!hit) continue;

          // merge equal tiers that overlap (they touch => they fuse).
          // Tiny epsilon avoids jitter-fusing at the exact boundary.
          if (a.tier === b.tier && hit.overlap > 1 && a.ignore <= 0 && b.ignore <= 0) {
            this._merge(i, j);
            continue;
          }

          a.contact = true;
          b.contact = true;
          const ox = hit.nx * hit.overlap * 0.5;
          const oy = hit.ny * hit.overlap * 0.5;
          a.x -= ox; a.y -= oy;
          b.x += ox; b.y += oy;

          // impulse along the collision normal (restitution = damping)
          const rel = (b.vx - a.vx) * hit.nx + (b.vy - a.vy) * hit.ny;
          if (rel < 0) {
            const j = -rel * (1 + DAMPING) * 0.5;
            a.vx -= j * hit.nx; a.vy -= j * hit.ny;
            b.vx += j * hit.nx; b.vy += j * hit.ny;
          }
        }
      }
    }

    for (const f of this.fruits) if (f.ignore > 0) f.ignore--;

    // ---- friction: a fruit resting on something locks its lateral slide ----
    for (const f of this.fruits) {
      if (f.dead) continue;
      if (f.contact) {
        // stick fast once it comes to (near) rest against a surface
        f.vx *= 0.55;
        if (Math.abs(f.vy) < 40) f.vx *= 0.5; // stronger grip when nearly resting
      }
      // global air/rolling drag so piles calm quickly
      f.vx *= 0.985;
    }

    this.fruits = this.fruits.filter((f) => !f.dead);

    // overflow: the run ends when any fruit is shoved up past the kill line
    // near the rim. We deliberately do NOT require the pile to be settled -
    // a "must be perfectly at rest" rule let spammers dodge it by keeping a
    // too-tall pile jiggling forever (drop-in-one-spot never dies). A short
    // sustained-above window plus a per-fruit spawn grace stops one stray
    // fresh drop from being an unfair instant loss, but a genuinely
    // overflowing pile now always ends the run.
    let overflowing = false;
    for (const f of this.fruits) {
      if (this.t - f.born > SPAWN_GRACE && this._topY(f) < this.crushY) {
        overflowing = true;
        break;
      }
    }
    if (overflowing) {
      this._overflowHold = (this._overflowHold || 0) + dt;
      if (this._overflowHold > OVERFLOW_HOLD) {
        this._end("OVERSIZED!");
        return;
      }
    } else {
      this._overflowHold = 0;
    }
  }

  // -------------------------------------------------------------------- loop
  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.033);
    this._last = now;
    this.t += dt;

    this._step(dt);

    // unblock dropping once the last fruit has fallen clear of the rim
    if (this.dropLocked) {
      const inFlight = this.fruits.some((f) => f.y < this.rimY + 40 && this.t - f.born < 0.25);
      if (!inFlight) this.dropLocked = false;
    }

    if (this.blendFx) { this.blendFx.t -= dt; if (this.blendFx.t <= 0) this.blendFx = null; }

    this._draw();
    if (!this.gameOver) requestAnimationFrame((t) => this._loop(t));
  }

  _end(reason = "") {
    if (this.gameOver) return;
    this.gameOver = true;
    this.running = false;
    this.endReason = reason;
    const bonus = this.fruits.reduce((s, f) => s + (f.dead ? 0 : 10 * f.tier), 0);
    this.score += bonus;
    this.onScore(this.score);
    this._draw();
    this.onEnd(this.score);
  }

  // -------------------------------------------------------------- rendering
  _blenderRect() {
    // the WHOLE jar is the blender now
    return this.jar;
  }

  _draw() {
    const ctx = this.ctx;
    const { x: jx, y: jy, w: jw, h: jh } = this.jar;
    const W = this.canvas.width / (window.devicePixelRatio || 1);
    const H = this.canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);

    // --- page bg ---
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, W, H);

    // --- BIG BLENDER JAR (the container itself) ---
    // metal lid rim at the top opening
    ctx.fillStyle = "#262c38";
    ctx.beginPath();
    ctx.roundRect(jx - 6, jy, jw + 12, 14, 6);
    ctx.fill();
    // lid cap
    ctx.fillStyle = "#3f4356";
    ctx.beginPath();
    ctx.roundRect(jx + jw / 2 - 26, jy - 16, 52, 20, 6);
    ctx.fill();

    // glass body (tapering jar) — full height
    const taper = jw * 0.06;
    const baseY = jy + jh;
    ctx.beginPath();
    ctx.moveTo(jx, jy + 14);
    ctx.lineTo(jx + jw, jy + 14);
    ctx.lineTo(jx + jw - taper, baseY);
    ctx.lineTo(jx + taper, baseY);
    ctx.closePath();
    ctx.fillStyle = "rgba(99,102,241,0.10)";
    ctx.fill();
    // faint neutral border (no colored/red outline — just defines the glass)
    ctx.strokeStyle = "rgba(139,147,163,0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // subtle inner grid (play area texture)
    ctx.fillStyle = "rgba(139,147,163,0.05)";
    const gs = 24;
    for (let gx = jx + 14; gx < jx + jw - 14; gx += gs) {
      for (let gy = jy + 20; gy < baseY - 24; gy += gs) {
        ctx.fillRect(gx, gy, 2, 2);
      }
    }

    // glass vertical highlight
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(jx + jw * 0.18, jy + 18);
    ctx.lineTo(jx + jw * 0.13, baseY - 8);
    ctx.stroke();

    // handle (right)
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#262c38";
    ctx.beginPath();
    ctx.moveTo(jx + jw, jy + jh * 0.18);
    ctx.arc(jx + jw, jy + jh * 0.30, jw * 0.10, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // blade + motor base (neutral dark casing, no bright outline line)
    const bladeY = baseY - 10;
    ctx.fillStyle = "#1b202a";
    ctx.beginPath();
    ctx.roundRect(jx + jw * 0.12, bladeY - 6, jw * 0.76, 16, 6);
    ctx.fill();

    // label
    ctx.fillStyle = "#8b93a3";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🍉 WATERMELON BLENDER", jx + jw / 2, jy + jh - 16);

    // --- fruits (drawn purely as their emoji silhouette, no boxes) ---
    for (const f of this.fruits) {
      if (f.dead) continue;
      this._drawFruit(f);
    }

    // --- NEXT fruit to drop: the ONE visible fruit. It rides the drop line
    // (just under the mouth) and tracks the cursor left-to-right, so you can
    // aim precisely before clicking. Everything else (stream, queue, outlines)
    // is intentionally hidden — you only ever see what you're about to drop.
    if (!this.dropLocked && !this.gameOver) this._drawHeldPreview();
    // --- blend FX ---
    if (this.blendFx) this._drawBlend();

    // --- HUD ---
    this._drawHud(W);
  }

  /** Draw a fruit as PURE emoji — no backing colour, no collision box.
   *  The emoji is sized to the silhouette footprint so it matches physics. */
  _drawFruit(f) {
    const ctx = this.ctx;
    // footprint ≈ bounding box of the polygon, scaled from r
    const { w } = this.inner;
    let hw = 0, hh = 0;
    for (const [vx, vy] of f.poly) { hw = Math.max(hw, Math.abs(vx)); hh = Math.max(hh, Math.abs(vy)); }
    const s = f.r * w;
    const size = Math.max(10, Math.max(hw, hh) * s * 2.05);
    ctx.font = `${size}px "Segoe UI Emoji", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.emoji, f.x, f.y + 1);
  }

  /** The single next fruit to drop, drawn fully opaque so it's clearly
   *  visible riding the drop line under the mouth. Position matches where it
   *  enters, so what you see is exactly what drops — nothing else on screen. */
  _drawHeldPreview() {
    const { w } = this.inner;
    const hold = FRUITS[this.currentTier - 1];
    const hr = hold.r * w;                 // pixel radius
    const x = this.spawnX;
    const y = this.rimY - hr * 0.9;        // centered a hair below the opening

    this._drawFruit({
      x: x, y: y, r: hold.r, poly: hold.poly,
      emoji: hold.emoji, color: hold.color, pts: hold.pts,
    });
  }

  /** Stream is intentionally not drawn (see header note) — only the next
   *  single fruit is shown each frame. Kept as a stub to avoid layout churn. */
  _drawStream() {
    // hidden on purpose
  }

  _drawBlend() {
    const ctx = this.ctx;
    const fx = this.blendFx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fx.t);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.r * (1.4 - (1.2 - fx.t)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("BLEND!", fx.x, fx.y - fx.r - 20);
    ctx.restore();
  }

  _drawHud(W) {
    const ctx = this.ctx;
    ctx.fillStyle = "#8b93a3";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`MERGES ${this.mergeCount}  ·  BLENDS ${this.blendCount}`, 12, 14);
    ctx.textAlign = "right";
    ctx.fillText(`UNLOCKED ${this.unlocked.size}/${FRUITS.length - 1}`, W - 12, 14);
  }
}
