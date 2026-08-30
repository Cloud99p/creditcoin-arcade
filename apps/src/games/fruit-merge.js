/**
 * Fruit Merge — 7-tier Suika-style merge game.
 *
 * Drop fruit into the bowl, same-tier fruits merge into the next tier.
 * Tier 7 (Watermelon) merging = CLEAR (vanish + respawn). Bowl height capped;
 * overflow ends the game. Score = merge points + fruits-in-bowl bonus.
 *
 * Pure canvas + physics, no external deps. Emits final score and calls the
 * onEnd callback so the shell can submit through the Attestcoin pipeline.
 */

export const FRUITS = [
  { tier: 1, name: "Cherry", emoji: "🍒", size: 0.30, pts: 10, color: "#e0244e" },
  { tier: 2, name: "Strawberry", emoji: "🍓", size: 0.42, pts: 20, color: "#f5576c" },
  { tier: 3, name: "Grape", emoji: "🍇", size: 0.56, pts: 40, color: "#8e44ad" },
  { tier: 4, name: "Orange", emoji: "🍊", size: 0.72, pts: 80, color: "#f39c12" },
  { tier: 5, name: "Apple", emoji: "🍎", size: 0.90, pts: 160, color: "#e74c3c" },
  { tier: 6, name: "Pear", emoji: "🍐", size: 1.10, pts: 320, color: "#27ae60" },
  { tier: 7, name: "Watermelon", emoji: "🍉", size: 1.35, pts: 640, color: "#16a085" },
];

const GRAVITY = 1400; // px/s^2
const DAMPING = 0.82;
const MIN_GAP = 0.02; // relative size difference to merge

export class FruitMerge {
  constructor(canvas, { onScore, onEnd } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onScore = onScore || (() => {});
    this.onEnd = onEnd || (() => {});
    this.running = false;

    this.bowlW = 0;
    this.bowlH = 0;
    this.overY = 0; // y above which spawns are forbidden once occupied
    this.fruits = [];
    this.nextTier = 1;
    this.currentTier = 1;
    this.score = 0;
    this.mergeCount = 0;
    this.spawnX = 0; // projected drop x
    this.dropTarget = null; // fruit being dropped
    this.gameOver = false;
    this.overFlagsAt = Infinity;

    this._resize();
    this._bindEvents();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(window.innerWidth - 16, 420);
    const h = Math.min(window.innerHeight - 200, 640);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.scale(dpr, dpr);
    this.bowlW = w;
    this.bowlH = h;
    this.overY = h * 0.12;
    this.spawnX = w / 2;
  }

  _bindEvents() {
    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.spawnX = Math.min(Math.max(e.clientX - rect.left, 40), this.bowlW - 40);
    });
    this.canvas.addEventListener("pointerdown", () => this._drop());
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft") this.spawnX = Math.max(40, this.spawnX - 16);
      if (e.code === "ArrowRight") this.spawnX = Math.min(this.bowlW - 40, this.spawnX + 16);
      if (e.code === "Space" || e.code === "ArrowDown") this._drop();
    });
  }

  start() {
    this._resize();
    this.fruits = [];
    this.score = 0;
    this.mergeCount = 0;
    this.currentTier = this.nextTier = 1;
    this.gameOver = false;
    this.overFlagsAt = Infinity;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _spawnNew() {
    // Only spawn while the bowl is open enough.
    return this.bowlW / 2 - this.bowlW * 0.08 > 12;
  }

  _drop() {
    if (!this.running || this.gameOver) return;
    const f = FRUITS[this.currentTier - 1];
    const r = (f.size * this.bowlW) / 2;
    this.fruits.push({
      tier: this.currentTier,
      x: this.spawnX,
      y: -r,
      r,
      vx: 0,
      vy: 0,
      emoji: f.emoji,
      color: f.color,
      pts: f.pts,
      merging: false,
    });
    // next fruit up to tier 7; random pick between 1..4 weighted to low tiers
    this.currentTier = 1 + Math.floor(Math.random() * Math.min(4, FRUITS.length));
  }

  _merge(a, b) {
    const nextTier = a.tier + 1;
    const target = FRUITS[nextTier - 1];
    this.score += target.pts;
    this.mergeCount++;
    const r = (target.size * this.bowlW) / 2;
    this.fruits.push({
      tier: nextTier,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      r,
      vx: (a.vx + b.vx) / 2,
      vy: Math.min(a.vy, b.vy) / 2,
      emoji: target.emoji,
      color: target.color,
      pts: target.pts,
      merging: false,
    });
    if (nextTier === 7) this.mergeCount += 10; // big merge bonus
    this.onScore(this.score, this.mergeCount);
    this._popFruit(a, true);
    // Watermelon clear: vanish the new fruit + respawn room
    if (nextTier === 7) this._clearWatermelon(this.fruits[this.fruits.length - 1]);
  }

  _clearWatermelon(f) {
    // respawn: remove the watermelon and briefly scatter low fruit
    f.dead = true;
    this.mergeCount += 25; // clear bonus
    this.onScore(this.score, this.mergeCount);
  }

  _popFruit(f, dead) {
    f.dead = true;
  }

  _collide(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = a.r + b.r;
    if (dist === 0 || dist >= minDist) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    const push = overlap / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
    // impulse
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const dot = rvx * nx + rvy * ny;
    if (dot < 0) {
      const imp = -dot * DAMPING;
      a.vx -= imp * nx;
      a.vy -= imp * ny;
      b.vx += imp * nx;
      b.vy += imp * ny;
    }
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.033);
    this._last = now;

    // gravity + integrate
    for (const f of this.fruits) {
      if (f.dead) continue;
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // walls
      if (f.x - f.r < 0) { f.x = f.r; f.vx *= -0.3; }
      if (f.x + f.r > this.bowlW) { f.x = this.bowlW - f.r; f.vx *= -0.3; }
      // floor
      if (f.y + f.r > this.bowlH) { f.y = this.bowlH - f.r; f.vy *= -0.25; }
    }

    // pairwise collision + merges
    for (let i = 0; i < this.fruits.length; i++) {
      for (let j = i + 1; j < this.fruits.length; j++) {
        const a = this.fruits[i];
        const b = this.fruits[j];
        if (a.dead || b.dead) continue;
        if (a.tier === b.tier) {
          const sizeRatio = Math.abs(a.r - b.r) / Math.max(a.r, b.r);
          if (sizeRatio < MIN_GAP) {
            this._merge(a, b);
            this.fruits[i].dead = true;
            this.fruits[j].dead = true;
            continue;
          }
        }
        this._collide(a, b);
      }
    }

    // prune dead + game-over check (a fruit resting above the line)
    this.fruits = this.fruits.filter((f) => !f.dead);
    for (const f of this.fruits) {
      if (f.y - f.r < this.overY && Math.abs(f.vy) < 20) {
        this._endGame();
        break;
      }
    }

    this._draw();
    requestAnimationFrame((t) => this._loop(t));
  }

  _endGame() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.running = false;
    // bonus: fruits still in bowl
    const bowlBonus = this.fruits.reduce((s, f) => s + (f.dead ? 0 : 10 * f.tier), 0);
    this.score += bowlBonus;
    this.onScore(this.score, this.mergeCount);
    this.onEnd(this.score);
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.bowlW;
    const h = this.bowlH;
    ctx.clearRect(0, 0, w, h);

    // bowl
    ctx.fillStyle = "#12151c";
    ctx.strokeStyle = "#262c38";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 16);
    ctx.fill();
    ctx.stroke();

    // over line
    ctx.strokeStyle = "rgba(255,80,80,0.4)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, this.overY);
    ctx.lineTo(w, this.overY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ghost of next fruit at spawnX
    const ghost = FRUITS[this.currentTier - 1];
    ctx.globalAlpha = 0.55;
    this._drawFruit(ghost, this.spawnX, this.overY + 22, (this.spawnX > 40 ? 1 : 1));
    ctx.globalAlpha = 1;

    // fruits
    for (const f of this.fruits) {
      if (f.dead) continue;
      const spec = FRUITS[f.tier - 1];
      this._drawFruit(spec, f.x, f.y, f.r / ((spec.size * w) / 2));
    }
  }

  _drawFruit(spec, x, y, scale) {
    const ctx = this.ctx;
    const base = (spec.size * this.bowlW) / 2;
    const r = base * scale;
    // flat fruit (no glow)
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = spec.color;
    ctx.fill();
    // emoji on top
    const emojiSize = Math.max(10, r * 1.1);
    ctx.font = `${emojiSize}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.emoji, x, y + 1);
  }
}
