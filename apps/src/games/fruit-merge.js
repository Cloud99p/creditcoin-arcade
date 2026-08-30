/**
 * Fruit Merge — Suika / watermelon-style merge game.
 *
 * Drop fruits into the bowl; identical fruits merge into the next tier.
 * Merge two Watermelons to BLEND them into juice, clear/compact the board,
 * and pour on points. Fruits unlock progressively: a tier only enters the
 * droppable queue AFTER you have merged your way up to it at least once.
 * Overflow the bowl and it's game over.
 *
 * Pure canvas + physics, flat styling (no gradients), no external deps.
 * Emits the final score via onScore(score) and ends via onEnd(score) so the
 * shell can submit through the Attestcoin pipeline.
 */

// r = radius as a fraction of the bowl's inner width.
export const FRUITS = [
  { tier: 1, name: "Cherry",     emoji: "🍒", r: 0.085, pts: 10,  color: "#f87171" },
  { tier: 2, name: "Strawberry", emoji: "🍓", r: 0.115, pts: 20,  color: "#fb7185" },
  { tier: 3, name: "Grape",      emoji: "🍇", r: 0.150, pts: 40,  color: "#8e7cc3" },
  { tier: 4, name: "Orange",     emoji: "🍊", r: 0.195, pts: 80,  color: "#fbbf24" },
  { tier: 5, name: "Apple",      emoji: "🍎", r: 0.250, pts: 160, color: "#f43f5e" },
  { tier: 6, name: "Pear",       emoji: "🍐", r: 0.315, pts: 320, color: "#4ade80" },
  { tier: 7, name: "Watermelon", emoji: "🍉", r: 0.395, pts: 640, color: "#22c55e" },
];

const GRAVITY = 1300;        // px/s^2
const DAMPING = 0.80;        // collision impulse damping
const ROUNDS = 3;            // physics sub-steps per frame (soft stacking)
const MERGE_EPS = 0.06;      // relative radius diff allowed to merge
const DROP_MAX_TIER = 6;     // never drop watermelons directly — merge two pears
const MIN_OPEN = 46;         // min drop gap (px) before we block drops

// classic-ish weight skew toward low tiers, renormalised over unlocked tiers
const WEIGHTS = { 1: 38, 2: 32, 3: 18, 4: 8, 5: 3, 6: 1 };

export class FruitMerge {
  constructor(canvas, { onScore, onEnd } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScore = onScore || (() => {});
    this.onEnd = onEnd || (() => {});
    this.running = false;

    this.W = 0;          // canvas css width
    this.H = 0;          // canvas css height
    this.bowl = null;    // { x, y, w, h } bowl inner area
    this.rimY = 0;       // y of the danger line near the top
    this.dropY = 0;      // y where the held fruit hovers
    this.fruits = [];
    this.currentTier = 1;
    this.nextTier = 1;
    this.stream = [];    // small queue of upcoming fruits (classic-style)
    this.unlocked = new Set([1, 2]); // start with the two smallest always droppable
    this.score = 0;
    this.mergeCount = 0;
    this.blendCount = 0;
    this.spawnX = 0;
    this.dropLocked = false; // block dropping while a fruit is in flight
    this.gameOver = false;

    // blend feedback
    this.blendFx = null; // { t, x, y, r }

    this._resize();
    this._bind();
  }

  // ------------------------------------------------------------------ layout
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(window.innerWidth - 20, 400);
    const h = Math.min(window.innerHeight - 190, 660);
    // keep a sensible aspect (portrait bowl)
    const canvasH = h;
    this.canvas.width = w * dpr;
    this.canvas.height = canvasH * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${canvasH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 10;                       // margin around the bowl
    const bw = w - pad * 2;               // bowl inner width
    const bh = canvasH - pad * 2;         // bowl inner height
    this.bowl = { x: pad, y: pad, w: bw, h: bh };
    this.rimY = pad + bh * 0.14;          // danger line
    this.dropY = pad + bh * 0.10;         // hover height for held fruit
    this.spawnX = this.bowl.x + this.bowl.w / 2;
  }

  _bind() {
    this.canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      this.spawnX = this._clampX(x);
    });
    this.canvas.addEventListener("pointerdown", () => this._drop());
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft") this.spawnX = this._clampX(this.spawnX - 18);
      if (e.code === "ArrowRight") this.spawnX = this._clampX(this.spawnX + 18);
      if (e.code === "Space" || e.code === "ArrowDown") this._drop();
    });
  }

  _clampX(x) {
    const { x: bx, w } = this.bowl;
    return Math.min(Math.max(x, bx + 18), bx + w - 18);
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
    this.gameOver = false;
    this.dropLocked = false;
    this.blendFx = null;
    this._prime();
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // -------------------------------------------------------- progression
  /** A fruit only enters the droppable pool after the player has merged it. */
  _pickTier() {
    const pool = [...this.unlocked].filter((t) => t <= DROP_MAX_TIER);
    const wsum = pool.reduce((s, t) => s + (WEIGHTS[t] ?? 1), 0);
    let roll = Math.random() * wsum;
    for (const t of pool) {
      roll -= (WEIGHTS[t] ?? 1);
      if (roll <= 0) return t;
    }
    return pool[pool.length - 1] || 1;
  }

  _prime() {
    // fill the stream so the player always sees what's coming
    while (this.stream.length < 5) this.stream.push(this._pickTier());
    this.currentTier = this.stream.shift();
    this.nextTier = this.stream[0];
  }

  _advanceStream() {
    while (this.stream.length < 5) this.stream.push(this._pickTier());
    this.currentTier = this.stream.shift();
    this.nextTier = this.stream[0];
  }

  // ------------------------------------------------------------- dropping
  _drop() {
    if (!this.running || this.gameOver || this.dropLocked) return;
    const { x: bx, w } = this.bowl;
    this.dropLocked = true;

    const spec = FRUITS[this.currentTier - 1];
    const r = spec.r * w;
    this.fruits.push({
      tier: this.currentTier, x: this.spawnX, y: this.dropY, r,
      vx: 0, vy: 0, emoji: spec.emoji, color: spec.color, pts: spec.pts,
      resting: false, dead: false, ignore: 0,
    });
    this._advanceStream();
  }

  // ------------------------------------------------------------- merging
  _merge(aIdx, bIdx) {
    const a = this.fruits[aIdx];
    const b = this.fruits[bIdx];
    const { w } = this.bowl;
    const nextTier = a.tier + 1;
    const target = FRUITS[nextTier - 1];
    const r = target.r * w;

    this.fruits[aIdx].dead = true;
    this.fruits[bIdx].dead = true;
    this.mergeCount++;
    this.score += target.pts;
    this.onScore(this.score);

    // unlock this tier — it can now appear in the drop stream
    this.unlocked.add(nextTier);

    const nx = (a.x + b.x) / 2;
    const ny = (a.y + b.y) / 2;

    if (nextTier === 7) {
      // Two watermelons => BLEND into juice in the juicer. Big points + clear.
      this.blendCount++;
      this.score += 1000;
      this.onScore(this.score);
      const j = this._blenderRect();
      this.blendFx = { t: 1, x: j.jx + j.jw / 2, y: j.jy - j.jh * 0.2, r: r };
      this._blendClear();
      return;
    }

    this.fruits.push({
      tier: nextTier, x: nx, y: ny, r,
      vx: (a.vx + b.vx) / 2, vy: Math.min(a.vy, b.vy) * 0.5,
      emoji: target.emoji, color: target.color, pts: target.pts,
      resting: false, dead: false, ignore: 6,
    });
  }

  /** After a blend, shrink/compact the pile so the run keeps going. */
  _blendClear() {
    // easiest robust "recovery": drop a random assortment of small fruit blocks
    // is wrong for a score game — instead compact everything down 30%.
    const { y: by, h } = this.bowl;
    for (const f of this.fruits) {
      if (f.dead) continue;
      f.y = by + (f.y - by) * 0.72;
      f.r *= 0.96;
      f.vy = 0;
    }
  }

  // ------------------------------------------------------------- physics
  _step(dt) {
    const { x: bx, y: by, w, h } = this.bowl;
    // gravity + integrate + walls/floor
    for (const f of this.fruits) {
      if (f.dead) continue;
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // side walls
      if (f.x - f.r < bx) { f.x = bx + f.r; f.vx *= -0.3; }
      if (f.x + f.r > bx + w) { f.x = bx + w - f.r; f.vx *= -0.3; }
      // floor (bowl base)
      if (f.y + f.r > by + h) { f.y = by + h - f.r; f.vy *= -0.28; }
    }

    // collisions + merges (iterated for soft stacking)
    for (let pass = 0; pass < ROUNDS; pass++) {
      for (let i = 0; i < this.fruits.length; i++) {
        for (let j = i + 1; j < this.fruits.length; j++) {
          const a = this.fruits[i];
          const b = this.fruits[j];
          if (a.dead || b.dead) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const minDist = a.r + b.r;
          if (dist >= minDist) continue;

          // same tier + similar size => merge
          if (a.tier === b.tier && Math.abs(a.r - b.r) / Math.max(a.r, b.r) < MERGE_EPS && a.ignore <= 0 && b.ignore <= 0) {
            this._merge(i, j);
            continue;
          }

          // resolve overlap
          const overlap = minDist - dist;
          const push = overlap / 2;
          a.x -= (dx / dist) * push;
          a.y -= (dy / dist) * push;
          b.x += (dx / dist) * push;
          b.y += (dy / dist) * push;

          // impulse (softer for resting piles)
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const dot = rvx * (dx / dist) + rvy * (dy / dist);
          if (dot < 0) {
            const imp = -dot * DAMPING;
            a.vx -= imp * (dx / dist);
            a.vy -= imp * (dy / dist);
            b.vx += imp * (dx / dist);
            b.vy += imp * (dy / dist);
          }
        }
      }
    }

    // decay merge cooldown
    for (const f of this.fruits) if (f.ignore > 0) f.ignore--;

    // prune dead
    this.fruits = this.fruits.filter((f) => !f.dead);

    // game over: a fruit sitting on/near the rim line
    for (const f of this.fruits) {
      if (f.y - f.r < this.rimY && Math.abs(f.vy) < 24) {
        this._end();
        return;
      }
    }
  }

  // ------------------------------------------------------------- loop
  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.033);
    this._last = now;

    // small wake-up for recently dropped fruit so it actually comes to rest
    this._step(dt);

    // unblock dropping once the current fruit is well below the drop zone
    if (this.dropLocked) {
      const inFlight = this.fruits.some((f) => f.y < this.dropY + 60);
      if (!inFlight) this.dropLocked = false;
    }

    // blend FX decay
    if (this.blendFx) { this.blendFx.t -= dt; if (this.blendFx.t <= 0) this.blendFx = null; }

    this._draw();
    if (!this.gameOver) requestAnimationFrame((t) => this._loop(t));
  }

  _end() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.running = false;
    // bowl bonus: fruits still in the bowl
    const bonus = this.fruits.reduce((s, f) => s + (f.dead ? 0 : 10 * f.tier), 0);
    this.score += bonus;
    this.onScore(this.score);
    this._draw();
    this.onEnd(this.score);
  }

  // ------------------------------------------------------------- rendering
  _draw() {
    const ctx = this.ctx;
    const { x: bx, y: by, w, h } = this.bowl;
    const W = this.canvas.width / (window.devicePixelRatio || 1);
    const H = this.canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);

    // ---- page background (flat, subtle texture via dots) ----
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, W, H);

    // ---- bowl shell (outer) ----
    ctx.fillStyle = "#161a22";
    ctx.beginPath();
    ctx.roundRect(bx - 12, by - 12, w + 24, h + 24, 22);
    ctx.fill();
    ctx.strokeStyle = "#262c38";
    ctx.lineWidth = 2;
    ctx.stroke();

    // ---- bowl interior ----
    ctx.fillStyle = "#12151c";
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 14);
    ctx.fill();

    // subtle grid to make it feel like a proper arena (flat dots)
    ctx.fillStyle = "rgba(139,147,163,0.06)";
    const gs = 26;
    for (let gx = bx + 13; gx < bx + w; gx += gs) {
      for (let gy = by + 13; gy < by + h; gy += gs) {
        ctx.fillRect(gx, gy, 2, 2);
      }
    }

    // ---- danger line near the top rim ----
    ctx.strokeStyle = "rgba(239,68,68,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(bx + 6, this.rimY);
    ctx.lineTo(bx + w - 6, this.rimY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(239,68,68,0.75)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("DANGER", bx + w - 10, this.rimY - 5);

    // ---- blender jar (backdrop of the bowl base) ----
    this._drawBlender();

    // ---- fruits ----
    for (const f of this.fruits) {
      if (f.dead) continue;
      this._drawFruit(f);
    }

    // ---- hover/droprate ghost of held fruit ----
    if (!this.dropLocked && !this.gameOver) {
      const hold = FRUITS[this.currentTier - 1];
      ctx.globalAlpha = 0.9;
      this._drawRing(hold, this.spawnX, this.dropY, hold.r * w);
      this._drawFruit({ ...hold, x: this.spawnX, y: this.dropY, r: hold.r * w, dead: false });
      ctx.globalAlpha = 1;
    }

    // ---- upcoming stream (next fruits) under the held one ----
    this._drawStream();

    // ---- blend FX (juice burst) ----
    if (this.blendFx) this._drawBlend();

    // ---- HUD ----
    this._drawHud(W);
  }

  _drawFruit(f) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    // subtle rim so fruits read against the bowl
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const emoji = Math.max(11, f.r * 1.15);
    ctx.font = `${emoji}px "Segoe UI Emoji", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.emoji, f.x, f.y + 1);
  }

  _drawRing(spec, x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(139,147,163,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** Blender jar bounds — wide relative to fruits, sits on the bowl floor. */
  _blenderRect() {
    const { x: bx, y: by, w, h } = this.bowl;
    const jw = w * 0.56;                 // wide relative to fruits
    const jh = h * 0.26;                 // tall enough to read as a jar
    const jx = bx + (w - jw) / 2;
    const jy = by + h - jh;              // sits on the bowl floor
    return { jx, jy, jw, jh };
  }

  _drawBlender() {
    const ctx = this.ctx;
    const { jx, jy, jw, jh } = this._blenderRect();
    const baseW = jw * 0.92;
    const baseX = jx + (jw - baseW) / 2;

    // glass body (jar silhouette)
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.lineTo(jx + jw, jy);
    ctx.lineTo(jx + jw, jy + jh * 0.72);
    ctx.lineTo(baseX + baseW, jy + jh);
    ctx.lineTo(baseX, jy + jh);
    ctx.lineTo(jx, jy + jh * 0.72);
    ctx.closePath();
    ctx.fillStyle = "rgba(99,102,241,0.14)";
    ctx.fill();
    ctx.strokeStyle = "#3f4356";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // glass vertical highlight (flat line)
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(jx + jw * 0.2, jy + 6);
    ctx.lineTo(jx + jw * 0.16, jy + jh * 0.7);
    ctx.stroke();

    // handle (right side)
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#262c38";
    ctx.beginPath();
    ctx.moveTo(jx + jw, jy + jh * 0.20);
    ctx.arc(jx + jw, jy + jh * 0.30, jw * 0.12, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // blade line across the base
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(jx + jw * 0.15, jy + jh * 0.80);
    ctx.lineTo(jx + jw * 0.85, jy + jh * 0.80);
    ctx.stroke();

    // motor base just above the bowl floor (inside the jar silhouette)
    ctx.fillStyle = "#1b202a";
    ctx.beginPath();
    ctx.roundRect(jx + jw * 0.1, jy + jh * 0.88, jw * 0.8, jh * 0.12, 6);
    ctx.fill();
    ctx.strokeStyle = "#262c38";
    ctx.lineWidth = 2;
    ctx.stroke();

    // label
    ctx.fillStyle = "#8b93a3";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("WATERMELON JUICER", jx + jw / 2, jy + jh + 12);
  }

  _drawStream() {
    const { w } = this.bowl;
    const ctx = this.ctx;
    const previewTiers = this.stream.slice(0, 3);
    const size = 16;
    let x = this.spawnX;
    for (let i = 0; i < previewTiers.length; i++) {
      const spec = FRUITS[previewTiers[i] - 1];
      ctx.globalAlpha = 0.35 - i * 0.08;
      ctx.font = `${size - i}px "Segoe UI Emoji", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.emoji, x, this.rimY - 16 - i * 15);
      x += spec.emoji.length > 2 ? size : size - 2; // rough advance
    }
    ctx.globalAlpha = 1;
  }

  _drawBlend() {
    const ctx = this.ctx;
    const fx = this.blendFx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fx.t);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.r * (1.3 - (1 - fx.t)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("BLEND!", fx.x, fx.y - fx.r - 18);
    ctx.restore();
  }

  _drawHud(W) {
    const ctx = this.ctx;
    ctx.fillStyle = "#8b93a3";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`MERGES ${this.mergeCount}   ·   BLENDS ${this.blendCount}`, 12, 16);
    ctx.textAlign = "right";
    ctx.fillText(`UNLOCKED ${this.unlocked.size}/${FRUITS.length - 1}`, W - 12, 16);
  }
}
