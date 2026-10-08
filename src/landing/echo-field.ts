import { Rng } from '../core/rng';

/**
 * The landing hero: a hidden maze that only shows up where sound travels.
 * Mouse movement makes soft footsteps, clicks make claps, and a red listener
 * drifts through the dark. Plain Canvas 2D — no engine needed for this.
 */

interface Pulse {
  x: number;
  y: number;
  r: number;
  max: number;
  speed: number;
  strength: number;
  color: number;
}

const COLORS = ['#5ef2ff', '#ff2d55', '#ffc35e'] as const;
const CYAN = 0;
const RED = 1;
const GOLD = 2;

export class EchoField {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: HTMLCanvasElement[];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private lit = new Float32Array(0);
  private tint = new Uint8Array(0);
  private dust = new Uint8Array(0);
  private pulses: Pulse[] = [];
  private listener = { x: 0, y: 0, vx: 0, vy: 0, reveal: 0, stepTimer: 0, angle: 0 };
  private beacon = { x: 0, y: 0, timer: 1.2 };
  private auto = 0.6;
  private last = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private traveled = 0;
  private running = false;
  private raf = 0;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.sprites = COLORS.map((c) => glowSprite(c));
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);

    const host = canvas.parentElement ?? canvas;
    host.addEventListener('pointermove', (e) => this.onMove(e));
    host.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('a, button')) return;
      const { x, y } = this.local(e);
      this.emit(x, y, 620, 560, 1, CYAN);
      this.listenerHears(x, y, 620);
    });
    new IntersectionObserver(([entry]) => (entry?.isIntersecting ? this.start() : this.stop())).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  private local(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.lastPointer) this.traveled += Math.hypot(p.x - this.lastPointer.x, p.y - this.lastPointer.y);
    this.lastPointer = p;
    if (this.traveled > 70) {
      this.traveled = 0;
      this.emit(p.x, p.y, 150, 380, 0.5, CYAN);
      this.listenerHears(p.x, p.y, 150);
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.build();
  }

  /** Random maze of wall stubs on a grid, sampled into echo points, plus floor dust. */
  private build(): void {
    const rng = new Rng(1337);
    const cell = Math.max(110, Math.min(170, this.w / 9));
    const cols = Math.ceil(this.w / cell) + 1;
    const rows = Math.ceil(this.h / cell) + 1;
    const pts: number[] = [];
    const flags: number[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 6));
      for (let k = 0; k <= n; k++) {
        pts.push(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
        flags.push(0);
      }
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const door = cell * 0.34;
        // Each wall keeps a doorway gap, like rooms in the game.
        if (rng.chance(0.6)) {
          const g = rng.range(0.2, 0.8) * (cell - door);
          line(x, y, x + g, y);
          line(x + g + door, y, x + cell, y);
        }
        if (rng.chance(0.6)) {
          const g = rng.range(0.2, 0.8) * (cell - door);
          line(x, y, x, y + g);
          line(x, y + g + door, x, y + cell);
        }
        if (rng.chance(0.25)) {
          const bx = x + cell * rng.range(0.3, 0.7);
          const by = y + cell * rng.range(0.3, 0.7);
          const s = rng.range(10, 18);
          line(bx - s, by - s, bx + s, by - s);
          line(bx + s, by - s, bx + s, by + s);
          line(bx + s, by + s, bx - s, by + s);
          line(bx - s, by + s, bx - s, by - s);
        }
      }
    }
    const dustCount = Math.round((this.w * this.h) / 1800);
    for (let i = 0; i < dustCount; i++) {
      pts.push(rng.range(0, this.w), rng.range(0, this.h));
      flags.push(1);
    }
    const n = flags.length;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.lit = new Float32Array(n);
    this.tint = new Uint8Array(n);
    this.dust = Uint8Array.from(flags);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i * 2]!;
      this.py[i] = pts[i * 2 + 1]!;
    }
    Object.assign(this.listener, { x: this.w * 0.78, y: this.h * 0.62, vx: -12, vy: 6 });
    Object.assign(this.beacon, { x: this.w * 0.14, y: this.h * 0.24 });
  }

  private emit(x: number, y: number, max: number, speed: number, strength: number, color: number): void {
    this.pulses.push({ x, y, r: 0, max, speed, strength, color });
  }

  private listenerHears(x: number, y: number, radius: number): void {
    const L = this.listener;
    const d = Math.hypot(x - L.x, y - L.y);
    if (d > radius * 1.3) return;
    // It turns towards the noise and hurries over.
    const k = 70 / Math.max(d, 1);
    L.vx = (x - L.x) * k;
    L.vy = (y - L.y) * k;
    L.reveal = 1;
    this.emit(L.x, L.y, 260, 420, 0.8, RED);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number): void {
    // Ambient life: occasional distant sounds so the page is never fully dead.
    if (!this.reducedMotion) {
      this.auto -= dt;
      if (this.auto <= 0) {
        this.auto = 2.6;
        this.emit(this.w * (0.3 + Math.random() * 0.4), this.h * (0.35 + Math.random() * 0.4), 300, 300, 0.55, CYAN);
      }
    }
    this.beacon.timer -= dt;
    if (this.beacon.timer <= 0) {
      this.beacon.timer = 2.8;
      this.emit(this.beacon.x, this.beacon.y, 170, 170, 0.7, GOLD);
    }

    const L = this.listener;
    L.x += L.vx * dt;
    L.y += L.vy * dt;
    L.vx *= 0.995;
    L.vy *= 0.995;
    if (Math.hypot(L.vx, L.vy) < 10) {
      L.vx += (Math.random() - 0.5) * 8;
      L.vy += (Math.random() - 0.5) * 8;
    }
    if (L.x < 40 || L.x > this.w - 40) L.vx = -L.vx;
    if (L.y < 40 || L.y > this.h - 40) L.vy = -L.vy;
    L.x = Math.min(this.w - 40, Math.max(40, L.x));
    L.y = Math.min(this.h - 40, Math.max(40, L.y));
    L.angle = Math.atan2(L.vy, L.vx);
    L.stepTimer -= dt;
    if (L.stepTimer <= 0) {
      L.stepTimer = 1.1;
      this.emit(L.x, L.y, 90, 240, 0.45, RED);
      L.reveal = Math.max(L.reveal, 0.3);
    }
    L.reveal *= Math.exp(-dt / 0.9);

    for (let pi = this.pulses.length - 1; pi >= 0; pi--) {
      const p = this.pulses[pi]!;
      const prev = p.r;
      p.r = Math.min(p.max, p.r + p.speed * dt);
      const b = p.strength * Math.pow(1 - p.r / p.max, 0.7);
      const prev2 = prev * prev;
      const next2 = p.r * p.r;
      for (let i = 0; i < this.lit.length; i++) {
        const dx = this.px[i]! - p.x;
        const dy = this.py[i]! - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < prev2 || d2 >= next2) continue;
        const v = this.dust[i] ? b * 0.45 : b;
        if (v > this.lit[i]!) {
          this.lit[i] = v;
          this.tint[i] = p.color;
        }
      }
      if (p.color !== RED) {
        const d2 = (L.x - p.x) ** 2 + (L.y - p.y) ** 2;
        if (d2 >= prev2 && d2 < next2) L.reveal = Math.max(L.reveal, b * 1.5);
      }
      if (p.r >= p.max) this.pulses.splice(pi, 1);
    }
    const wallK = Math.exp(-dt / 1.6);
    const dustK = Math.exp(-dt / 0.9);
    for (let i = 0; i < this.lit.length; i++) this.lit[i]! *= this.dust[i] ? dustK : wallK;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.lit.length; i++) {
      const v = this.lit[i]!;
      if (v < 0.01) continue;
      const s = this.dust[i] ? 7 : 12;
      ctx.globalAlpha = Math.min(1, v * 1.1);
      ctx.drawImage(this.sprites[this.tint[i]!]!, this.px[i]! - s / 2, this.py[i]! - s / 2, s, s);
    }

    ctx.lineWidth = 1;
    for (const p of this.pulses) {
      const a = p.strength * Math.pow(1 - p.r / p.max, 0.8) * 0.3;
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = COLORS[p.color]!;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const L = this.listener;
    if (L.reveal > 0.02) {
      ctx.globalAlpha = Math.min(1, L.reveal);
      ctx.strokeStyle = COLORS[RED];
      ctx.fillStyle = 'rgba(255,45,85,0.18)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const spikes = 11;
      for (let k = 0; k < spikes * 2; k++) {
        const a = L.angle + (k / (spikes * 2)) * Math.PI * 2;
        const r = k % 2 === 0 ? 20 + ((k * 7) % 5) * 2.4 : 8;
        const x = L.x + Math.cos(a) * r;
        const y = L.y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function glowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.5, color + '44');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}
