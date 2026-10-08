import { Rng } from '../core/rng';
import {
  type Vec2,
  damp,
  dist,
  dist2,
  firstHitT,
  hasLineOfSight,
  normalize,
  resolveCircleWalls,
} from '../core/math';
import { CONFIG, PLAYER_SOURCES, PULSES, type PulseSource } from './config';
import { type Level, cellCenter, cellOf, findPath } from './level';

export interface PlayerInput {
  /** Movement direction, each axis in -1..1. */
  moveX: number;
  moveY: number;
  sneak: boolean;
  /** Edge-triggered: true only on the tick the button was pressed. */
  clap: boolean;
  /** Edge-triggered throw target in world coordinates. */
  throwAt: Vec2 | null;
}

export const NO_INPUT: PlayerInput = { moveX: 0, moveY: 0, sneak: false, clap: false, throwAt: null };

export interface Pulse {
  x: number;
  y: number;
  radius: number;
  source: PulseSource;
  maxRadius: number;
  speed: number;
  strength: number;
  color: number;
}

export type EnemyState = 'wander' | 'investigate' | 'hunt';

export interface Enemy {
  id: number;
  pos: Vec2;
  state: EnemyState;
  path: Vec2[];
  linger: number;
  stepTimer: number;
  /** 0..1 — how visible it currently is (lit by an echo). */
  reveal: number;
  revealColor: number;
  /** Visual heading, radians. */
  heading: number;
}

export interface Stone {
  from: Vec2;
  to: Vec2;
  t: number;
}

export type GameEvent =
  | { type: 'pulse'; source: PulseSource; x: number; y: number }
  | { type: 'alert'; x: number; y: number }
  | { type: 'throw'; x: number; y: number }
  /** Tried to throw with no stones left. */
  | { type: 'dryThrow'; x: number; y: number }
  | { type: 'death'; x: number; y: number }
  | { type: 'win'; x: number; y: number };

export type WorldStatus = 'playing' | 'dead' | 'won';

const POINT_WALL = 0;
const POINT_DUST = 1;

/**
 * Pure game simulation — no rendering, no audio, no DOM.
 * Presentation layers read its state and drain `events` each frame.
 */
export class World {
  readonly level: Level;
  readonly rng: Rng;

  status: WorldStatus = 'playing';
  time = 0;

  readonly player = {
    pos: { x: 0, y: 0 } as Vec2,
    vel: { x: 0, y: 0 } as Vec2,
    radius: CONFIG.player.radius,
    stepTimer: 0,
    sneaking: false,
  };
  clapCooldown = 0;
  stonesLeft: number = CONFIG.stones.perLevel;
  readonly stones: Stone[] = [];
  readonly pulses: Pulse[] = [];
  readonly enemies: Enemy[] = [];
  exitReveal = 0;
  private beaconTimer = 0.6;

  /** Echo points: wall samples followed by floor dust. Struct-of-arrays for speed. */
  readonly pointCount: number;
  readonly wallPointCount: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly intensity: Float32Array;
  readonly color: Uint32Array;
  readonly kind: Uint8Array;

  events: GameEvent[] = [];

  constructor(level: Level, seed = level.seed) {
    this.level = level;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.player.pos = { ...level.start };
    this.player.stepTimer = CONFIG.player.stepInterval * 0.5;

    const pts: Array<[number, number, number]> = [];
    const spacing = CONFIG.level.wallSampleSpacing;
    for (const w of level.walls) {
      const len = dist(w.a, w.b);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        pts.push([w.a.x + (w.b.x - w.a.x) * t, w.a.y + (w.b.y - w.a.y) * t, POINT_WALL]);
      }
    }
    this.wallPointCount = pts.length;
    for (const d of level.dust) pts.push([d.x, d.y, POINT_DUST]);

    this.pointCount = pts.length;
    this.px = new Float32Array(this.pointCount);
    this.py = new Float32Array(this.pointCount);
    this.intensity = new Float32Array(this.pointCount);
    this.color = new Uint32Array(this.pointCount);
    this.kind = new Uint8Array(this.pointCount);
    pts.forEach(([x, y, k], i) => {
      this.px[i] = x;
      this.py[i] = y;
      this.kind[i] = k;
    });

    level.enemySpawns.forEach((p, id) => {
      this.enemies.push({
        id,
        pos: { ...p },
        state: 'wander',
        path: [],
        linger: this.rng.range(0.5, 2),
        stepTimer: this.rng.range(0, CONFIG.enemy.stepInterval),
        reveal: 0,
        revealColor: PULSES.enemyStep.color,
        heading: this.rng.range(0, Math.PI * 2),
      });
    });
  }

  emitPulse(source: PulseSource, x: number, y: number): Pulse {
    const spec = PULSES[source];
    const pulse: Pulse = { x, y, radius: 0, source, ...spec };
    this.pulses.push(pulse);
    this.events.push({ type: 'pulse', source, x, y });
    return pulse;
  }

  update(dt: number, input: PlayerInput): void {
    this.time += dt;
    if (this.status === 'playing') this.updatePlayer(dt, input);
    this.updateStones(dt);
    this.updateBeacon(dt);
    this.updatePulses(dt);
    this.updateEnemies(dt);
    this.decay(dt);
    if (this.status === 'playing') this.checkEndConditions();
  }

  private updatePlayer(dt: number, input: PlayerInput): void {
    const p = this.player;
    const dir = normalize(input.moveX, input.moveY);
    p.sneaking = input.sneak;
    const speed = input.sneak ? CONFIG.player.sneakSpeed : CONFIG.player.walkSpeed;
    p.vel.x = damp(p.vel.x, dir.x * speed, CONFIG.player.accel, dt);
    p.vel.y = damp(p.vel.y, dir.y * speed, CONFIG.player.accel, dt);
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    resolveCircleWalls(p.pos, p.radius, this.level.walls);

    const moving = Math.hypot(p.vel.x, p.vel.y) > 20 && (dir.x !== 0 || dir.y !== 0);
    if (moving) {
      const interval = input.sneak ? CONFIG.player.sneakStepInterval : CONFIG.player.stepInterval;
      p.stepTimer += dt;
      if (p.stepTimer >= interval) {
        p.stepTimer -= interval;
        this.emitPulse(input.sneak ? 'sneakStep' : 'step', p.pos.x, p.pos.y);
      }
    } else {
      // Next step after standing still comes quickly — the first footfall is audible.
      p.stepTimer = Math.max(p.stepTimer, CONFIG.player.stepInterval * 0.6);
    }

    this.clapCooldown = Math.max(0, this.clapCooldown - dt);
    if (input.clap && this.clapCooldown === 0) {
      this.clapCooldown = CONFIG.clapCooldown;
      this.emitPulse('clap', p.pos.x, p.pos.y);
    }

    if (input.throwAt && this.stonesLeft > 0) {
      this.stonesLeft--;
      const dx = input.throwAt.x - p.pos.x;
      const dy = input.throwAt.y - p.pos.y;
      const len = Math.hypot(dx, dy);
      const range = Math.min(len, CONFIG.stones.maxRange);
      const n = normalize(dx, dy);
      const far = { x: p.pos.x + n.x * range, y: p.pos.y + n.y * range };
      // Stop just before the first wall on the way.
      const t = firstHitT(p.pos, far, this.level.walls);
      const reach = Math.max(0, range * t - 6);
      const to = { x: p.pos.x + n.x * reach, y: p.pos.y + n.y * reach };
      this.stones.push({ from: { ...p.pos }, to, t: 0 });
      this.events.push({ type: 'throw', x: p.pos.x, y: p.pos.y });
    } else if (input.throwAt) {
      this.events.push({ type: 'dryThrow', x: p.pos.x, y: p.pos.y });
    }
  }

  private updateStones(dt: number): void {
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i]!;
      s.t += dt / CONFIG.stones.flightTime;
      if (s.t >= 1) {
        this.emitPulse('stone', s.to.x, s.to.y);
        this.stones.splice(i, 1);
      }
    }
  }

  private updateBeacon(dt: number): void {
    this.beaconTimer -= dt;
    if (this.beaconTimer <= 0) {
      this.beaconTimer += CONFIG.beaconInterval;
      this.emitPulse('beacon', this.level.exit.x, this.level.exit.y);
    }
  }

  private updatePulses(dt: number): void {
    const walls = this.level.walls;
    for (let pi = this.pulses.length - 1; pi >= 0; pi--) {
      const pulse = this.pulses[pi]!;
      const prev = pulse.radius;
      const next = Math.min(pulse.maxRadius, prev + pulse.speed * dt);
      pulse.radius = next;
      const prev2 = prev * prev;
      const next2 = next * next;
      // Ring energy fades as it spreads.
      const falloff = Math.pow(1 - next / pulse.maxRadius, 0.7);
      const brightness = pulse.strength * falloff;
      const origin = { x: pulse.x, y: pulse.y };

      // Light up every echo point the ring front crossed this tick.
      for (let i = 0; i < this.pointCount; i++) {
        const dx = this.px[i]! - pulse.x;
        const dy = this.py[i]! - pulse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < prev2 || d2 >= next2) continue;
        const isDust = this.kind[i] === POINT_DUST;
        const value = isDust ? brightness * CONFIG.echo.dustBrightness : brightness;
        if (value <= this.intensity[i]!) continue;
        // Nudge the target towards the origin so the wall it sits on doesn't occlude it.
        const d = Math.sqrt(d2);
        const nudge = d > 2 ? 1.5 / d : 0;
        const target = { x: this.px[i]! - dx * nudge, y: this.py[i]! - dy * nudge };
        if (!hasLineOfSight(origin, target, walls)) continue;
        this.intensity[i] = value;
        this.color[i] = pulse.color;
      }

      for (const e of this.enemies) {
        const d2 = dist2(e.pos, origin);
        if (d2 < prev2 || d2 >= next2) continue;
        const los = hasLineOfSight(origin, e.pos, walls);
        if (los && pulse.source !== 'enemyStep' && pulse.source !== 'enemyScream') {
          e.reveal = Math.max(e.reveal, Math.min(1, brightness * 1.6));
          e.revealColor = pulse.color;
        } else if (los && (pulse.source === 'enemyStep' || pulse.source === 'enemyScream')) {
          // Its own footsteps reveal its outline faintly.
          e.reveal = Math.max(e.reveal, 0.25);
          e.revealColor = pulse.color;
        }
        this.hear(e, pulse, brightness * (los ? 1 : CONFIG.enemy.wallMuffle));
      }

      const ed2 = dist2(this.level.exit, origin);
      if (ed2 >= prev2 && ed2 < next2 && hasLineOfSight(origin, this.level.exit, walls)) {
        this.exitReveal = Math.max(this.exitReveal, pulse.source === 'beacon' ? 1 : brightness);
      }

      if (next >= pulse.maxRadius) this.pulses.splice(pi, 1);
    }
  }

  private hear(e: Enemy, pulse: Pulse, loudness: number): void {
    if (!PLAYER_SOURCES.has(pulse.source)) return;
    if (loudness < CONFIG.enemy.hearInvestigate) return;
    const target = { x: pulse.x, y: pulse.y };
    if (loudness >= CONFIG.enemy.hearHunt) {
      if (e.state !== 'hunt') {
        this.events.push({ type: 'alert', x: e.pos.x, y: e.pos.y });
        this.emitPulse('enemyScream', e.pos.x, e.pos.y);
      }
      e.state = 'hunt';
    } else if (e.state === 'wander') {
      e.state = 'investigate';
    }
    e.path = findPath(this.level, e.pos, target);
    e.linger = this.rng.range(CONFIG.enemy.lingerMin, CONFIG.enemy.lingerMax);
  }

  private updateEnemies(dt: number): void {
    const cfg = CONFIG.enemy;
    const revealK = Math.exp(-dt / CONFIG.echo.revealDecay);
    for (const e of this.enemies) {
      e.reveal *= revealK;

      if (e.path.length === 0) {
        e.linger -= dt;
        if (e.linger <= 0) {
          e.state = 'wander';
          e.path = this.wanderPath(e);
          e.linger = this.rng.range(cfg.lingerMin, cfg.lingerMax);
        }
        continue;
      }

      const speed = e.state === 'hunt' ? cfg.huntSpeed : e.state === 'investigate' ? cfg.investigateSpeed : cfg.wanderSpeed;
      const target = e.path[0]!;
      const dx = target.x - e.pos.x;
      const dy = target.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      const stepLen = speed * dt;
      if (d <= Math.max(stepLen, 4)) {
        e.path.shift();
        if (e.path.length === 0 && e.state === 'hunt') e.state = 'investigate';
      } else {
        e.pos.x += (dx / d) * stepLen;
        e.pos.y += (dy / d) * stepLen;
        e.heading = Math.atan2(dy, dx);
      }
      resolveCircleWalls(e.pos, cfg.radius, this.level.walls);

      e.stepTimer += dt;
      const interval = e.state === 'hunt' ? cfg.huntStepInterval : cfg.stepInterval;
      if (e.stepTimer >= interval) {
        e.stepTimer -= interval;
        this.emitPulse('enemyStep', e.pos.x, e.pos.y);
      }
    }
  }

  private wanderPath(e: Enemy): Vec2[] {
    const here = cellOf(this.level, e.pos);
    const options = this.level.neighbors[here]!;
    const cell = options.length > 0 && this.rng.chance(0.75) ? this.rng.pick(options) : here;
    const c = cellCenter(this.level, cell);
    const jitter = this.level.cellSize * 0.12;
    const goal = { x: c.x + this.rng.range(-jitter, jitter), y: c.y + this.rng.range(-jitter, jitter) };
    return findPath(this.level, e.pos, goal);
  }

  private decay(dt: number): void {
    const wallK = Math.exp(-dt / CONFIG.echo.wallDecay);
    const dustK = Math.exp(-dt / CONFIG.echo.dustDecay);
    for (let i = 0; i < this.pointCount; i++) {
      this.intensity[i]! *= this.kind[i] === POINT_DUST ? dustK : wallK;
    }
    this.exitReveal *= Math.exp(-dt / CONFIG.echo.revealDecay);
  }

  private checkEndConditions(): void {
    const p = this.player.pos;
    const touch = this.player.radius + CONFIG.enemy.radius;
    for (const e of this.enemies) {
      if (dist2(e.pos, p) < touch * touch) {
        this.status = 'dead';
        e.reveal = 1;
        e.revealColor = PULSES.enemyScream.color;
        this.events.push({ type: 'death', x: p.x, y: p.y });
        this.emitPulse('enemyScream', e.pos.x, e.pos.y);
        return;
      }
    }
    if (dist2(this.level.exit, p) < CONFIG.exitRadius * CONFIG.exitRadius) {
      this.status = 'won';
      this.events.push({ type: 'win', x: p.x, y: p.y });
    }
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
