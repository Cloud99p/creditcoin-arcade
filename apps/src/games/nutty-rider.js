/**
 * Nutty Rider — tilt-control biker.
 *
 * Hold pointer/touch = gradual rightward tilt (max 90°, eased), release = back
 * to north. Ride through scrolling obstacles: fans (push toward edge), swung
 * logs (knock sideways), oil patches (slippery). 4 characters with one special
 * ability each. Score = distance / segments cleared.
 *
 * Pure canvas + physics. Emits final score to the shell for Attestcoin submit.
 */

export const CHARACTERS = [
  { id: "pig", name: "Pig", emoji: "🐷", ability: "Iron Body", desc: "Resists fan knockback", stat: { tilt: 0.9, knock: 0.4 } },
  { id: "goat", name: "Goat", emoji: "🐐", ability: "Climber", desc: "Recovers balance faster", stat: { tilt: 1.0, knock: 0.7 } },
  { id: "banana", name: "Banana", emoji: "🍌", ability: "Grip", desc: "Hold corners better", stat: { tilt: 1.1, knock: 0.6 } },
  { id: "cricket", name: "Cricket", emoji: "🦗", ability: "Hop", desc: "Clears low logs", stat: { tilt: 1.0, knock: 0.8 } },
];

const MAX_TILT = Math.PI / 2; // 90°
const TILT_EASE = 3.0;
const BASE_SPEED = 220; // px/s scroll
const KNOCKBACK = 90;

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
    this.trackW = 0; // usable track width
    this.tilt = 0;
    this.holding = false;
    this.distance = 0;
    this.speed = BASE_SPEED;
    this.obstacles = [];
    this.dead = false;
    this.posX = 0; // biker lateral offset from center
    this.velX = 0;
    this.hop = 0;

    this._resize();
    this._bindEvents();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(window.innerWidth - 16, 440);
    const h = Math.min(window.innerHeight - 200, 680);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.scale(dpr, dpr);
    this.W = w;
    this.H = h;
    this.trackW = w * 0.7;
    this.posX = 0;
  }

  _bindEvents() {
    const start = (e) => { this.holding = true; e.preventDefault?.(); };
    const end = () => { this.holding = false; };
    this.canvas.addEventListener("pointerdown", start);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft") this.holding = false;
      if (e.code === "ArrowRight" || e.code === "Space") this.holding = true;
      if (e.code === "Space" && this.character.id === "cricket") this._hop();
    });
  }

  _hop() {
    if (this.character.id === "cricket" && !this.dead) this.hop = 60;
  }

  start() {
    this._resize();
    this.tilt = 0;
    this.distance = 0;
    this.speed = BASE_SPEED;
    this.obstacles = [];
    this.dead = false;
    this.posX = 0;
    this.velX = 0;
    this.hop = 0;
    this.running = true;
    this._last = performance.now();
    this._spawnTimer = 0;
    requestAnimationFrame((t) => this._loop(t));
  }

  _spawn(dt) {
    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return;
    this._spawnTimer = 0.6 + Math.random() * 0.9;
    const types = ["fan", "log", "oil"];
    const type = types[Math.floor(Math.random() * types.length)];
    const lane = (Math.random() * 2 - 1) * this.trackW / 2 * 0.8;
    this.obstacles.push({
      type,
      y: -40,
      x: this.character.id === "banana" ? lane * 0.7 : lane, // banana grips closer to track center-ish
      w: type === "oil" ? 46 : 30,
      h: type === "log" ? 14 : 40,
      vx: type === "fan" ? (Math.random() * 2 - 1) * 60 : 0,
      hit: false,
    });
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.033);
    this._last = now;
    this.distance += this.speed * dt;
    this.speed = BASE_SPEED + Math.min(160, this.distance * 0.001);
    this.onScore(Math.floor(this.distance / 10), Math.floor(this.distance / 500) + 1);

    // tilt control (eased)
    const target = this.holding ? MAX_TILT : 0;
    this.tilt += (target - this.tilt) * Math.min(1, TILT_EASE * dt * this.character.stat.tilt);

    // lateral steering from tilt + character knock resistance
    const steer = Math.sin(this.tilt) * 120;
    this.velX = steer * this.character.stat.tilt;

    // spawn + scroll
    this._spawn(dt);
    for (const o of this.obstacles) {
      o.y += this.speed * dt;

      // fan pushes biker toward edge
      if (o.type === "fan") {
        if (Math.abs(o.y + 20 - this.H * 0.6) < 60 && Math.abs(o.x - this.posX) < 40) {
          this.velX += (o.x > 0 ? 1 : -1) * KNOCKBACK * this.character.stat.knock * dt * 6;
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.y < this.H + 60);

    // hop (cricket) decays
    if (this.hop > 0) this.hop -= 120 * dt;

    // integrate lateral position (bounded to track)
    this.posX += this.velX * dt;
    const bound = this.trackW / 2;
    if (this.posX > bound) this.posX = bound;
    if (this.posX < -bound) this.posX = -bound;

    // collisions (skip while hopping clears logs)
    const riderY = this.H * 0.62;
    for (const o of this.obstacles) {
      if (o.hit) continue;
      if (Math.abs(o.x - this.posX) < (o.w + 22) / 2 && Math.abs((o.y + o.h / 2) - riderY) < (o.h + 22) / 2) {
        // hop clears small logs
        if (o.type === "log" && this.hop > 0 && this.character.id === "cricket") continue;
        o.hit = true;
        this._die();
        break;
      }
    }

    this._draw();
    requestAnimationFrame((t) => this._loop(t));
  }

  _die() {
    if (this.dead) return;
    this.dead = true;
    this.running = false;
    const score = Math.floor(this.distance / 10);
    this.onScore(score, Math.floor(this.distance / 500) + 1);
    this.onEnd(score);
  }

  _draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    // background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a192f");
    grad.addColorStop(1, "#112240");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // road
    const cx = W / 2 + this.posX * 0.35;
    const roadW = this.trackW;
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(cx - roadW / 2, 0, roadW, H);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 16]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // obstacles
    for (const o of this.obstacles) {
      ctx.save();
      if (o.type === "fan") {
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.moveTo(o.x - o.w / 2, o.y);
        ctx.lineTo(o.x + o.w / 2, o.y);
        ctx.lineTo(o.x, o.y - 26);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === "log") {
        ctx.fillStyle = "#92400e";
        ctx.beginPath();
        ctx.roundRect(o.x - o.w / 2, o.y, o.w, o.h, 6);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(15,15,15,0.7)";
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // biker
    const bx = W / 2 + this.posX;
    const by = H * 0.62 - this.hop;
    ctx.save();
    ctx.translate(bx, by);
    // tilt the bike with the steer lean
    ctx.rotate(this.tilt * 0.5);
    ctx.font = "42px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.character.emoji, 0, 0);
    // ability label
    ctx.restore();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "center";
    ctx.fillText(`${this.character.name} · ${this.character.ability}`, W / 2, H - 20);
  }
}
