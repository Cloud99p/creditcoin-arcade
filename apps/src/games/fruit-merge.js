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
// ax/ay = shape of the fruit's collision profile relative to its base radius:
// ax>1 => wide (watermelon, strawberry), ay>1 => tall (pear, apple).
// Distinct shapes mean fruits CATCH on their real outlines instead of
// sliding around each other — keeping that friction is where the difficulty lives.
export const FRUITS = [
  { tier: 1, name: "Cherry",     emoji: "🍒", r: 0.055, ax: 1.10, ay: 0.95, pts: 10,  color: "#f87171" },
  { tier: 2, name: "Strawberry", emoji: "🍓", r: 0.075, ax: 1.22, ay: 0.88, pts: 20,  color: "#fb7185" },
  { tier: 3, name: "Grape",      emoji: "🍇", r: 0.100, ax: 1.18, ay: 1.05, pts: 40,  color: "#8e7cc3" },
  { tier: 4, name: "Orange",     emoji: "🍊", r: 0.132, ax: 1.00, ay: 1.00, pts: 80,  color: "#fbbf24" },
  { tier: 5, name: "Apple",      emoji: "🍎", r: 0.172, ax: 0.94, ay: 1.12, pts: 160, color: "#f43f5e" },
  { tier: 6, name: "Pear",       emoji: "🍐", r: 0.220, ax: 0.82, ay: 1.34, pts: 320, color: "#4ade80" },
  { tier: 7, name: "Watermelon", emoji: "🍉", r: 0.280, ax: 1.42, ay: 0.90, pts: 640, color: "#22c55e" },
];

const GRAVITY = 1250;        // px/s^2
const DAMPING = 0.80;        // collision impulse damping
const ROUNDS = 4;            // physics sub-steps per frame
const MERGE_EPS = 0.06;      // relative radius diff allowed to merge
const DROP_MAX_TIER = 6;     // never drop watermelons — merge two pears
const SPAWN_GRACE = 0.7;     // seconds a fresh fruit is safe from overflow
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
    this.juice = 0.08; // juice fill fraction (rises = difficulty)

    // jar geometry
    this.W = 0;
    this.H = 0;
    this.jar = null;    // { x, y, w, h } outer jar
    this.inner = null;  // { x, y, w, h } play area inside the jar
    this.rimY = 0;      // rim opening Y (top) — where fruits drop in
    this.crushY = 0;    // kill line: overflow when the pile passes this

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
    // kill line sits just under the rim: the run ends when the settled pile
    // (or the juice as it fills) pushes a fruit up here.
    this.crushY = this.inner.y + this.inner.h * 0.12;
    this.spawnX = this.inner.x + this.inner.w / 2;
  }

  /** Physics floor = top of the juice. Juice fills from the BOTTOM upward,
   *  so a low fraction leaves most of the jar empty. 0 => jar empty,
   *  0.93 => liquid nearly at the rim. */
  _floorY() {
    const { y: iy, h: ih } = this.inner;
    const f = Math.max(0.05, Math.min(0.93, this.juice));
    return (iy + ih) - ih * f;
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
    const rx = s.r * s.ax * w;
    return Math.min(Math.max(x, ix + rx + 4), ix + w - rx - 4);
  }

  // ------------------------------------------------------------- public API
  start() {
    this._resize();
    this.fruits = [];
    this.score = 0;
    this.mergeCount = 0;
    this.blendCount = 0;
    this.juice = 0.10;
    this.unlocked = new Set([1, 2]);
    this.currentTier = 1;
    this.t = 0;
    this.gameOver = false;
    this.dropLocked = false;
    this.blendFx = null;
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
    const rx = spec.r * spec.ax * w;
    const ry = spec.r * spec.ay * w;
    // spawn just above the rim so it visibly drops IN, with spawn grace
    this.fruits.push({
      tier: this.currentTier, x: this.spawnX,
      y: this.rimY - ry - 4, rx, ry,
      vx: 0, vy: 0,
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
    const nextTier = a.tier + 1;
    const target = FRUITS[nextTier - 1];
    const rx = target.r * target.ax * w;
    const ry = target.r * target.ay * w;

    this.fruits[aIdx].dead = true;
    this.fruits[bIdx].dead = true;
    this.mergeCount++;
    this.score += target.pts;
    this.onScore(this.score);
    this.unlocked.add(nextTier); // merge-to-unlock

    if (nextTier === 7) {
      // two watermelons => BLEND into juice, big points + compact pile
      this.blendCount++;
      this.score += 1000;
      this.onScore(this.score);
      const { x: ix, w: iw } = this.inner;
      this.blendFx = { t: 1.2, x: ix + iw / 2, y: this.inner.y + this.inner.h * 0.4, r: rx };
      this._blendClear();
      return;
    }

    this.fruits.push({
      tier: nextTier, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, rx, ry,
      vx: (a.vx + b.vx) / 2, vy: Math.min(a.vy, b.vy) * 0.5,
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
      f.rx *= 0.96;
      f.ry *= 0.96;
      f.vy = 0;
    }
  }

  // ---------------------------------------------------------------- physics
  // Ellipse-ellipse collision: each fruit keeps its real shape (rx/ry half
  // axes), so grapes are wide, pears are tall, etc. Neighbours CATCH on their
  // outlines instead of sliding around perfect circles — that friction is the
  // actual difficulty and the reason the leaderboard has a spread.
  _step(dt) {
    const { x: ix, y: iy, w, h } = this.inner;
    const floor = this._floorY(); // top of the rising juice

    for (const f of this.fruits) {
      if (f.dead) continue;
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      if (f.x - f.rx < ix) { f.x = ix + f.rx; f.vx *= -0.3; }
      if (f.x + f.rx > ix + w) { f.x = ix + w - f.rx; f.vx *= -0.3; }
      // rising juice = the floor; clamp onto it (no sinking, no bouncing up)
      if (f.y + f.ry > floor) { f.y = floor - f.ry; f.vy = Math.min(f.vy, 0); }
    }

    for (let pass = 0; pass < ROUNDS; pass++) {
      for (let i = 0; i < this.fruits.length; i++) {
        for (let j = i + 1; j < this.fruits.length; j++) {
          const a = this.fruits[i];
          const b = this.fruits[j];
          if (a.dead || b.dead) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const ux = dx / dist;
          const uy = dy / dist;

          // effective radius of each ellipse along the contact direction
          const ra = (a.rx * a.ry) / Math.sqrt((a.ry * ux) ** 2 + (a.rx * uy) ** 2);
          const rb = (b.rx * b.ry) / Math.sqrt((b.ry * ux) ** 2 + (b.rx * uy) ** 2);
          const touch = ra + rb;
          if (dist >= touch) continue;

          // merge check uses mean radius so equal-shape fruits combine
          const sizeA = (a.rx + a.ry) / 2;
          const sizeB = (b.rx + b.ry) / 2;
          if (a.tier === b.tier && Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB) < MERGE_EPS && a.ignore <= 0 && b.ignore <= 0) {
            this._merge(i, j);
            continue;
          }

          const overlap = touch - dist;
          const push = overlap / 2;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;

          const dot = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
          if (dot < 0) {
            const imp = -dot * DAMPING;
            a.vx -= imp * ux; a.vy -= imp * uy;
            b.vx += imp * ux; b.vy += imp * uy;
          }
        }
      }
    }

    for (const f of this.fruits) if (f.ignore > 0) f.ignore--;

    this.fruits = this.fruits.filter((f) => !f.dead);

    // overflow: only a fruit that has TRULY SETTLED (both velocities ~0) and
    // whose top gets pushed up past the kill line pops out the top opening.
    // A fruit falling through the juice never triggers this — it must land
    // and rest first, and even then only when the pile is genuinely near the rim.
    for (const f of this.fruits) {
      const pastGrace = this.t - f.born > SPAWN_GRACE;
      const atRest = Math.abs(f.vy) < 14 && Math.abs(f.vx) < 14;
      if (pastGrace && atRest && f.y - f.ry < this.crushY) {
        this._end("OVERSIZED!");
        return;
      }
    }
  }

  // -------------------------------------------------------------------- loop
  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.033);
    this._last = now;
    this.t += dt;

    // ---- difficulty: the juice rises over time, faster as you score ----
    // Early game ~2min of room, tightening toward ~30s as your score climbs.
    const rate = Math.min(0.03, 0.006 + this.score * 0.00001);
    this.juice = Math.min(0.93, this.juice + dt * rate * (1 + this.blendCount * 0.03));

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
    ctx.strokeStyle = "#3f4356";
    ctx.lineWidth = 3;
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

    // blade + motor base at the very bottom
    const bladeY = baseY - 10;
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(jx + jw * 0.18, bladeY);
    ctx.lineTo(jx + jw * 0.82, bladeY);
    ctx.stroke();
    ctx.fillStyle = "#1b202a";
    ctx.beginPath();
    ctx.roundRect(jx + jw * 0.12, bladeY - 6, jw * 0.76, 16, 6);
    ctx.fill();

    // label
    ctx.fillStyle = "#8b93a3";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🍉 WATERMELON BLENDER", jx + jw / 2, jy + jh - 16);

    // --- rising JUICE (the liquid floor / difficulty meter) ---
    const juiceTop = this._floorY();
    ctx.fillStyle = "rgba(52,211,153,0.22)";
    ctx.beginPath();
    ctx.moveTo(jx + taper, juiceTop);
    ctx.lineTo(jx + jw - taper, juiceTop);
    ctx.lineTo(jx + jw - taper, baseY);
    ctx.lineTo(jx + taper, baseY);
    ctx.closePath();
    ctx.fill();
    // liquid surface line
    ctx.strokeStyle = "rgba(52,211,153,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(jx + taper, juiceTop);
    ctx.lineTo(jx + jw - taper, juiceTop);
    ctx.stroke();
    // a few bubbles just under the surface
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let b = 0; b < 6; b++) {
      const bx2 = jx + jw * (0.2 + 0.6 * (((b * 37) % 100) / 100));
      const by2 = juiceTop + 12 + ((b * 53) % 40);
      ctx.beginPath();
      ctx.arc(bx2, by2, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- fruits ---
    for (const f of this.fruits) {
      if (f.dead) continue;
      this._drawFruit(f);
    }

    // --- held fruit ghost + landing outline (matches its real shape) ---
    if (!this.dropLocked && !this.gameOver) {
      const hold = FRUITS[this.currentTier - 1];
      const w = this.inner.w;
      const gx = hold.r * hold.ax * w;
      const gy = hold.r * hold.ay * w;
      ctx.globalAlpha = 0.85;
      this._drawRing(this.spawnX, this.rimY - 30, gx, gy);
      this._drawFruit({ x: this.spawnX, y: this.rimY - 30, rx: gx, ry: gy, color: hold.color, emoji: hold.emoji });
      ctx.globalAlpha = 1;
    }

    // --- upcoming stream ---
    this._drawStream();

    // --- blend FX ---
    if (this.blendFx) this._drawBlend();

    // --- HUD ---
    this._drawHud(W);
  }

  _drawFruit(f) {
    const ctx = this.ctx;
    // faint flat backing shaped like the fruit (NO ring/circle outline)
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, Math.abs(f.rx), Math.abs(f.ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
    // emoji sized to the fruit's real footprint so it matches its physics
    const emoji = Math.max(10, f.rx * 1.7);
    ctx.font = `${emoji}px "Segoe UI Emoji", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.emoji, f.x, f.y + 1);
  }

  _drawRing(x, y, rx, ry) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(139,147,163,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawStream() {
    const ctx = this.ctx;
    const preview = this.stream.slice(0, 3);
    let x = this.spawnX;
    for (let i = 0; i < preview.length; i++) {
      const spec = FRUITS[preview[i] - 1];
      ctx.globalAlpha = 0.9 - i * 0.22;
      ctx.font = `${i === 0 ? 14 : 12 - i}px "Segoe UI Emoji", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.emoji, x, this.rimY + 40 + i * 14);
      x += 12;
    }
    ctx.globalAlpha = 1;
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
    // juice fill gauge (pressure / difficulty meter)
    const gW = 90, gH = 8;
    const gx = W - gW - 12, gy = 16;
    ctx.fillStyle = "#1b202a";
    ctx.fillRect(gx, gy, gW, gH);
    const fill = Math.max(0, Math.min(1, this.juice));
    ctx.fillStyle = fill > 0.8 ? "#ef4444" : "#34d399";
    ctx.fillRect(gx, gy, gW * fill, gH);
    ctx.strokeStyle = "#262c38";
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gW, gH);
    ctx.fillStyle = "#8b93a3";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`FILL ${Math.round(fill * 100)}%`, W - 12, gy + gH + 12);
  }
}
