import { CONFIG } from '../game/config';
import type { World } from '../game/world';

export type Screen = 'title' | 'playing' | 'paused' | 'dead' | 'won';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

/** Lightweight DOM overlay: crisp text, CSS transitions, zero render cost. */
export class Hud {
  private readonly hud = $('#hud');
  private readonly depth = $('#hud-depth');
  private readonly stones = $('#hud-stones');
  private readonly clap = $<HTMLElement>('#hud-clap');
  private readonly hint = $('#hint');
  private readonly screens = {
    title: $('#screen-title'),
    paused: $('#screen-paused'),
    dead: $('#screen-dead'),
    won: $('#screen-won'),
  };
  private readonly best = $('#title-best');
  private readonly deadStats = $('#dead-stats');
  private readonly fps = $('#fps');
  private hintTimer = 0;
  private lastStones = -1;
  private fpsAcc = 0;
  private fpsFrames = 0;

  show(screen: Screen): void {
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('visible', name === screen);
    this.hud.classList.toggle('visible', screen === 'playing' || screen === 'paused');
    if (screen !== 'playing' && screen !== 'paused') this.hideHint();
  }

  setDepth(depth: number): void {
    this.depth.textContent = `ГЛУБИНА ${depth}`;
  }

  setBest(best: number): void {
    this.best.textContent = best > 1 ? ` · Рекорд: глубина ${best}` : '';
  }

  setDeathStats(depth: number, seconds: number): void {
    this.deadStats.textContent = `Глубина ${depth} · ${seconds.toFixed(1)} с в темноте`;
  }

  showHint(text: string, seconds = 6): void {
    this.hint.innerHTML = text;
    this.hint.classList.add('visible');
    this.hintTimer = seconds;
  }

  hideHint(): void {
    this.hintTimer = 0;
    this.hint.classList.remove('visible');
  }

  setDebug(on: boolean): void {
    this.fps.classList.toggle('visible', on);
  }

  update(world: World, dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hideHint();
    }
    if (world.stonesLeft !== this.lastStones) {
      this.lastStones = world.stonesLeft;
      this.stones.innerHTML = Array.from(
        { length: CONFIG.stones.perLevel },
        (_, i) => `<span class="stone ${i < world.stonesLeft ? 'full' : ''}"></span>`,
      ).join('');
    }
    const ready = 1 - world.clapCooldown / CONFIG.clapCooldown;
    this.clap.style.setProperty('--p', String(ready));
    this.clap.classList.toggle('ready', ready >= 1);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
