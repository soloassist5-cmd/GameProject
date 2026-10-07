import {
  Application,
  Container,
  Graphics,
  NoiseFilter,
  Particle,
  ParticleContainer,
  Sprite,
  type Texture,
} from 'pixi.js';
import { AdvancedBloomFilter, RGBSplitFilter, ShockwaveFilter } from 'pixi-filters';
import { clamp, damp, type Vec2 } from '../core/math';
import { Rng } from '../core/rng';
import { CONFIG } from '../game/config';
import type { Enemy, World } from '../game/world';
import { createGlowTexture, createVignetteTexture } from './textures';

const PLAYER_COLOR = 0xbffcff;
const EXIT_COLOR = 0xffc35e;
const BG_COLOR = 0x030409;

/**
 * Reads World state and draws it. Owns the camera and all screen-space juice:
 * shake, flashes, shockwaves, chromatic split, bloom and film grain.
 */
export class Renderer {
  readonly app = new Application();
  private glow!: Texture;

  private readonly root = new Container();
  private readonly bg = new Graphics();
  private readonly worldLayer = new Container();
  private dustLayer: ParticleContainer | null = null;
  private wallLayer: ParticleContainer | null = null;
  private particles: Particle[] = [];
  private readonly rings = new Graphics();
  private readonly exitGfx = new Graphics();
  private exitGlow!: Sprite;
  private readonly stonesGfx = new Graphics();
  private readonly enemyLayer = new Container();
  private enemyViews: Graphics[] = [];
  private readonly playerLayer = new Container();
  private playerGlow!: Sprite;
  private readonly playerCore = new Graphics();
  private readonly debugGfx = new Graphics();
  private readonly flashGfx = new Graphics();
  private vignette!: Sprite;

  private bloom!: AdvancedBloomFilter;
  private shockwave!: ShockwaveFilter;
  private rgbSplit!: RGBSplitFilter;
  private noise!: NoiseFilter;

  readonly camera = { x: 0, y: 0, zoom: 1 };
  private trauma = 0;
  private flash = { color: 0xffffff, alpha: 0 };
  private shockTime = -1;
  private stepPop = 0;
  private time = 0;
  debug = false;
  /** Hide the player dot (title screen keeps the centre clean for the logo). */
  hidePlayer = false;

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: BG_COLOR,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);

    this.glow = createGlowTexture();
    this.exitGlow = this.makeGlow(EXIT_COLOR);
    this.playerGlow = this.makeGlow(PLAYER_COLOR);
    this.vignette = new Sprite(createVignetteTexture());

    this.playerCore.circle(0, 0, 3.2).fill({ color: 0xffffff });
    this.playerLayer.addChild(this.playerGlow, this.playerCore);

    this.worldLayer.addChild(this.rings, this.exitGlow, this.exitGfx, this.stonesGfx, this.enemyLayer, this.playerLayer, this.debugGfx);
    this.root.addChild(this.bg, this.worldLayer, this.vignette, this.flashGfx);
    this.app.stage.addChild(this.root);

    this.bloom = new AdvancedBloomFilter({ threshold: 0.12, bloomScale: 1.5, brightness: 1.05, blur: 7, quality: 6 });
    this.shockwave = new ShockwaveFilter({
      center: { x: 0, y: 0 },
      amplitude: 14,
      wavelength: 110,
      speed: 650,
      brightness: 1.15,
      radius: 900,
    });
    this.shockwave.enabled = false;
    this.rgbSplit = new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } });
    this.rgbSplit.enabled = false;
    this.noise = new NoiseFilter({ noise: 0.07 });
    this.root.filters = [this.shockwave, this.bloom, this.rgbSplit, this.noise];
    this.root.filterArea = this.app.screen;

    this.app.renderer.on('resize', () => this.layoutScreen());
    this.layoutScreen();
  }

  /** Rebuild per-level display objects. */
  bindWorld(world: World): void {
    this.dustLayer?.destroy();
    this.wallLayer?.destroy();
    const make = () =>
      new ParticleContainer({
        texture: this.glow,
        dynamicProperties: { position: false, rotation: false, vertex: false, uvs: false, color: true },
      });
    this.dustLayer = make();
    this.wallLayer = make();
    this.dustLayer.blendMode = 'add';
    this.wallLayer.blendMode = 'add';

    this.particles = [];
    for (let i = 0; i < world.pointCount; i++) {
      const isWall = i < world.wallPointCount;
      const scale = isWall ? 0.2 : 0.09 + (i % 7) * 0.012;
      const p = new Particle({
        texture: this.glow,
        x: world.px[i]!,
        y: world.py[i]!,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: scale,
        scaleY: scale,
        alpha: 0,
      });
      this.particles.push(p);
      (isWall ? this.wallLayer : this.dustLayer).addParticle(p);
    }
    this.dustLayer.update();
    this.wallLayer.update();
    this.worldLayer.addChildAt(this.dustLayer, 0);
    this.worldLayer.addChildAt(this.wallLayer, 1);

    for (const v of this.enemyViews) v.destroy();
    this.enemyViews = world.enemies.map((e) => this.makeEnemyView(e));
    this.enemyViews.forEach((v) => this.enemyLayer.addChild(v));

    this.exitGfx.clear();
    const r = 11;
    this.exitGfx.poly([0, -r, r, 0, 0, r, -r, 0]).stroke({ color: EXIT_COLOR, width: 2 });
    this.exitGfx.poly([0, -r * 0.45, r * 0.45, 0, 0, r * 0.45, -r * 0.45, 0]).fill({ color: EXIT_COLOR });
    this.exitGfx.position.set(world.level.exit.x, world.level.exit.y);
    this.exitGlow.position.copyFrom(this.exitGfx.position);

    this.camera.x = world.player.pos.x;
    this.camera.y = world.player.pos.y;
    this.trauma = 0;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.worldLayer.x) / this.camera.zoom,
      y: (sy - this.worldLayer.y) / this.camera.zoom,
    };
  }

  worldToScreen(p: Vec2): Vec2 {
    return { x: p.x * this.camera.zoom + this.worldLayer.x, y: p.y * this.camera.zoom + this.worldLayer.y };
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  flashScreen(color: number, alpha: number): void {
    this.flash = { color, alpha: Math.max(this.flash.alpha, alpha) };
  }

  shockwaveAt(p: Vec2): void {
    const s = this.worldToScreen(p);
    this.shockwave.center = { x: s.x, y: s.y };
    this.shockTime = 0;
    this.shockwave.enabled = true;
  }

  onStep(): void {
    this.stepPop = 1;
  }

  render(world: World, dt: number, aim: Vec2 | null): void {
    this.time += dt;
    this.updateCamera(world, dt, aim);
    this.drawEcho(world);
    this.drawRings(world);
    this.drawActors(world);
    this.drawDebug(world);
    this.updateScreenFx(dt);
  }

  // --- internals -----------------------------------------------------------

  private updateCamera(world: World, dt: number, aim: Vec2 | null): void {
    const screen = this.app.screen;
    this.camera.zoom = clamp(Math.min(screen.width, screen.height) / 640, 0.6, 2.4);
    const p = world.player.pos;
    let tx = p.x;
    let ty = p.y;
    if (aim) {
      // Look slightly towards the cursor.
      tx += clamp((aim.x - p.x) * 0.18, -90, 90);
      ty += clamp((aim.y - p.y) * 0.18, -90, 90);
    }
    this.camera.x = damp(this.camera.x, tx, 5, dt);
    this.camera.y = damp(this.camera.y, ty, 5, dt);

    // Trauma-based shake: offset ∝ trauma², smooth pseudo-noise.
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const shake = this.trauma * this.trauma * 18;
    const t = this.time * 38;
    const sx = shake * (Math.sin(t * 1.3) + Math.sin(t * 2.7 + 1.7)) * 0.5;
    const sy = shake * (Math.sin(t * 1.7 + 0.5) + Math.sin(t * 3.1 + 2.3)) * 0.5;

    this.worldLayer.scale.set(this.camera.zoom);
    this.worldLayer.position.set(
      screen.width / 2 - this.camera.x * this.camera.zoom + sx,
      screen.height / 2 - this.camera.y * this.camera.zoom + sy,
    );
  }

  private drawEcho(world: World): void {
    const { intensity, color } = world;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const v = intensity[i]!;
      p.alpha = v > 0.004 ? Math.min(1, v * 1.15) : 0;
      p.tint = color[i]!;
    }
  }

  private drawRings(world: World): void {
    const g = this.rings;
    g.clear();
    const w = 1.6 / this.camera.zoom;
    for (const pulse of world.pulses) {
      const fade = Math.pow(1 - pulse.radius / pulse.maxRadius, 0.8);
      const enemy = pulse.source === 'enemyStep' || pulse.source === 'enemyScream';
      const alpha = pulse.strength * fade * (enemy ? 0.22 : 0.3);
      if (alpha < 0.01 || pulse.radius < 1) continue;
      g.circle(pulse.x, pulse.y, pulse.radius).stroke({ color: pulse.color, width: w, alpha });
    }
  }

  private drawActors(world: World): void {
    // Player: always faintly present — you are the only light you can trust.
    const pl = world.player;
    this.stepPop = Math.max(0, this.stepPop - 0.08);
    const breathe = 1 + Math.sin(this.time * 2.2) * 0.05;
    const dead = world.status === 'dead';
    this.playerLayer.position.set(pl.pos.x, pl.pos.y);
    this.playerLayer.alpha = dead || this.hidePlayer ? 0 : 1;
    this.playerGlow.scale.set((pl.sneaking ? 0.55 : 0.8) * breathe * (1 + this.stepPop * 0.35));
    this.playerGlow.alpha = pl.sneaking ? 0.3 : 0.5;
    this.playerCore.scale.set(1 + this.stepPop * 0.4);

    // Exit.
    const er = world.exitReveal;
    this.exitGfx.alpha = 0.06 + er * 0.94;
    this.exitGfx.rotation = this.time * 0.6;
    this.exitGlow.alpha = er * 0.7;
    this.exitGlow.scale.set(1.4 + Math.sin(this.time * 3) * 0.1);

    // Stones in flight.
    const sg = this.stonesGfx;
    sg.clear();
    for (const s of world.stones) {
      const x = s.from.x + (s.to.x - s.from.x) * s.t;
      const y = s.from.y + (s.to.y - s.from.y) * s.t;
      const hop = Math.sin(Math.PI * s.t);
      sg.circle(x, y - hop * 14, 2.2 + hop * 1.8).fill({ color: 0xffffff, alpha: 0.9 });
    }

    // Listeners: invisible until an echo washes over them.
    world.enemies.forEach((e, i) => {
      const v = this.enemyViews[i]!;
      v.position.set(e.pos.x, e.pos.y);
      const jitter = e.state === 'hunt' ? 0.12 : 0.04;
      v.rotation = e.heading + Math.sin(this.time * 9 + i) * jitter;
      v.scale.set(1 + Math.sin(this.time * 4 + i * 1.7) * 0.06);
      v.tint = e.revealColor;
      v.alpha = Math.min(1, e.reveal * 1.2);
    });
  }

  private drawDebug(world: World): void {
    const g = this.debugGfx;
    g.clear();
    if (!this.debug) return;
    const w = 1 / this.camera.zoom;
    for (const s of world.level.walls) g.moveTo(s.a.x, s.a.y).lineTo(s.b.x, s.b.y);
    g.stroke({ color: 0x3355ff, width: w, alpha: 0.5 });
    for (const e of world.enemies) {
      g.circle(e.pos.x, e.pos.y, CONFIG.enemy.radius).stroke({ color: 0xff0000, width: w * 2 });
      let from = e.pos;
      for (const wp of e.path) {
        g.moveTo(from.x, from.y).lineTo(wp.x, wp.y);
        from = wp;
      }
      g.stroke({ color: 0xff8800, width: w, alpha: 0.6 });
    }
  }

  private updateScreenFx(dt: number): void {
    const screen = this.app.screen;
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 1.6);
    this.flashGfx.clear();
    if (this.flash.alpha > 0.005) {
      this.flashGfx.rect(0, 0, screen.width, screen.height).fill({ color: this.flash.color, alpha: this.flash.alpha });
    }

    if (this.shockTime >= 0) {
      this.shockTime += dt;
      this.shockwave.time = this.shockTime;
      if (this.shockTime > 1.2) {
        this.shockTime = -1;
        this.shockwave.enabled = false;
      }
    }

    const split = this.trauma * this.trauma * 7;
    this.rgbSplit.enabled = split > 0.3;
    this.rgbSplit.red = { x: -split, y: 0 };
    this.rgbSplit.blue = { x: split, y: split * 0.3 };

    this.noise.seed = Math.random();
  }

  private layoutScreen(): void {
    const { width, height } = this.app.screen;
    this.bg.clear().rect(0, 0, width, height).fill({ color: BG_COLOR });
    this.vignette.width = width;
    this.vignette.height = height;
  }

  private makeGlow(tint: number): Sprite {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.tint = tint;
    s.blendMode = 'add';
    return s;
  }

  /** A jagged, asymmetric silhouette — never quite the same twice. */
  private makeEnemyView(e: Enemy): Graphics {
    const rng = new Rng(e.id * 7919 + 13);
    const spikes = 11;
    const pts: number[] = [];
    const base = CONFIG.enemy.radius * 1.15;
    for (let k = 0; k < spikes * 2; k++) {
      const a = (k / (spikes * 2)) * Math.PI * 2;
      const r = k % 2 === 0 ? base * rng.range(1.15, 1.75) : base * rng.range(0.45, 0.7);
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new Graphics();
    g.poly(pts).fill({ color: 0xffffff, alpha: 0.18 }).stroke({ color: 0xffffff, width: 1.6, alpha: 1 });
    // Two hollow "ears" — it hunts by sound.
    g.circle(base * 0.35, -base * 0.3, 2).fill({ color: 0xffffff });
    g.circle(base * 0.35, base * 0.3, 2).fill({ color: 0xffffff });
    g.alpha = 0;
    return g;
  }
}
