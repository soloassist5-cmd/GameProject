import type { AudioEngine } from '../audio/audio';
import { Feedback } from '../app/feedback';
import { clamp, normalize, type Vec2 } from '../core/math';
import { NO_INPUT, type PlayerInput, World } from '../game/world';
import type { Renderer } from '../render/renderer';

export const TICK = 1 / 60;

export interface Shot {
  name: string;
  duration: number;
  /** Build a fresh world (a hard cut). Omit to keep rolling the previous one. */
  world?: () => World;
  /** Camera zoom multiplier, constant or animated over shot-local time. */
  zoom?: number | ((t: number) => number);
  /** Fixed camera focus; defaults to following the player. */
  focus?: (w: World, t: number) => Vec2 | null;
  hidePlayer?: boolean;
  input?: (w: World, t: number) => PlayerInput;
  /** One-shot actions at shot-local times: scripted pulses, music hits… */
  cues?: Array<[at: number, run: (w: World, audio: AudioEngine) => void]>;
}

export interface Card {
  from: number;
  to: number;
  html: string;
  className?: string;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Plays a list of scripted shots through the real game simulation.
 * Deterministic: the same tick sequence always yields the same frames and the
 * same sound events, so video and offline-rendered audio line up exactly.
 */
export class Director {
  time = 0;
  world!: World;
  private shotIndex = -1;
  private shotTime = 0;
  private timeScale = 1;
  private slowmo = 0;
  private readonly feedback: Feedback;
  private cardEls: HTMLElement[] = [];
  readonly duration: number;

  constructor(
    private readonly shots: Shot[],
    private readonly cards: Card[],
    private readonly audio: AudioEngine,
    private readonly renderer: Renderer | null,
    cardHost: HTMLElement | null,
    private readonly fadeEl: HTMLElement | null,
  ) {
    this.duration = shots.reduce((sum, s) => sum + s.duration, 0);
    this.feedback = new Feedback(audio, renderer);
    if (cardHost) {
      this.cardEls = cards.map((c) => {
        const el = document.createElement('div');
        el.className = `card ${c.className ?? ''}`;
        el.innerHTML = c.html;
        cardHost.appendChild(el);
        return el;
      });
    }
    this.enterShot(0);
  }

  get done(): boolean {
    return this.time >= this.duration;
  }

  get shotName(): string {
    return this.shot.name;
  }

  private get shot(): Shot {
    return this.shots[this.shotIndex]!;
  }

  private enterShot(index: number): void {
    const prev = this.shotIndex;
    this.shotIndex = index;
    this.shotTime = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    const shot = this.shot;
    const fresh = shot.world !== undefined || prev < 0;
    if (shot.world) this.world = shot.world();
    if (this.renderer) {
      if (fresh) this.renderer.bindWorld(this.world);
      this.renderer.hidePlayer = shot.hidePlayer ?? false;
      this.applyCamera();
      if (fresh) this.renderer.cut(this.world);
    }
  }

  private applyCamera(): void {
    if (!this.renderer) return;
    const shot = this.shot;
    const z = shot.zoom;
    this.renderer.shot.zoomMul = typeof z === 'function' ? z(this.shotTime) : (z ?? 1);
    this.renderer.shot.focus = shot.focus?.(this.world, this.shotTime) ?? null;
  }

  /** Advance the film by one fixed simulation tick. */
  step(): void {
    if (this.done) return;
    if (this.shotTime >= this.shot.duration - 1e-9 && this.shotIndex < this.shots.length - 1) {
      this.enterShot(this.shotIndex + 1);
    }
    const shot = this.shot;
    const t0 = this.shotTime;
    this.audio.seek(this.time);
    for (const [at, run] of shot.cues ?? []) {
      if (at >= t0 && at < t0 + TICK) run(this.world, this.audio);
    }

    const input = shot.input?.(this.world, t0) ?? NO_INPUT;
    this.world.update(TICK * this.timeScale, input);
    for (const ev of this.world.drainEvents()) {
      this.feedback.apply(ev);
      if (ev.type === 'death') {
        this.slowmo = 1.6;
        this.timeScale = 0.22;
      }
    }
    if (this.slowmo > 0) {
      this.slowmo -= TICK;
      if (this.slowmo <= 0) this.timeScale = 1;
    }
    this.audio.setListener(this.world.player.pos);
    this.audio.updateBeacon(this.world.level.exit, !shot.hidePlayer);

    this.shotTime += TICK;
    this.time += TICK;
  }

  /** Draw the current state (call once per video/animation frame). */
  frame(frameDt: number): void {
    if (this.renderer) {
      this.applyCamera();
      this.renderer.render(this.world, frameDt, null);
    }
    this.cards.forEach((c, i) => {
      const el = this.cardEls[i];
      if (!el) return;
      const fi = c.fadeIn ?? 0.5;
      const fo = c.fadeOut ?? 0.6;
      const a = clamp(Math.min((this.time - c.from) / fi, (c.to - this.time) / fo), 0, 1);
      el.style.opacity = String(a * a * (3 - 2 * a));
      // Slow push-in while the card is up.
      const k = clamp((this.time - c.from) / Math.max(0.01, c.to - c.from), 0, 1);
      el.style.transform = `translate(-50%, -50%) scale(${0.96 + k * 0.06})`;
      el.style.letterSpacing = '';
    });
    if (this.fadeEl) {
      const tail = clamp((this.time - (this.duration - 1.2)) / 1.2, 0, 1);
      const head = clamp(1 - this.time / 0.6, 0, 1);
      this.fadeEl.style.opacity = String(Math.max(tail, head));
    }
  }
}

// --- Scripting helpers ------------------------------------------------------

/** Steers the player through waypoints; returns NO_INPUT once there. */
export function follow(path: Vec2[], opts: { sneak?: boolean; start?: number } = {}) {
  let i = 0;
  return (w: World, t: number): PlayerInput => {
    if (t < (opts.start ?? 0) || w.status !== 'playing') return NO_INPUT;
    const p = w.player.pos;
    while (i < path.length && Math.hypot(path[i]!.x - p.x, path[i]!.y - p.y) < 10) i++;
    if (i >= path.length) return NO_INPUT;
    const d = normalize(path[i]!.x - p.x, path[i]!.y - p.y);
    return { ...NO_INPUT, moveX: d.x, moveY: d.y, sneak: opts.sneak ?? false };
  };
}

/** Run different input scripts in sequence by shot-local time. */
export function sequence(...parts: Array<[from: number, script: (w: World, t: number) => PlayerInput]>) {
  return (w: World, t: number): PlayerInput => {
    let active: ((w: World, t: number) => PlayerInput) | null = null;
    for (const [from, script] of parts) if (t >= from) active = script;
    return active ? active(w, t) : NO_INPUT;
  };
}

export const once = (at: number, input: Partial<PlayerInput>) => (_w: World, t: number): PlayerInput =>
  t >= at && t < at + TICK ? { ...NO_INPUT, ...input } : NO_INPUT;
