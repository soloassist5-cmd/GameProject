import { CONFIG } from '../game/config';
import type { World } from '../game/world';

export type Screen = 'title' | 'playing' | 'paused' | 'dead' | 'won';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

/** Three slightly different pebble silhouettes (viewBox 20×16), so the row reads as stones, not dots. */
const PEBBLES = [
  'M3 9C2 5 6 2 10 2.5C15 3 18 6 17.5 9.5C17 13 13 14.5 9 14C5 13.6 3.5 12 3 9Z',
  'M2.5 8C3 4.5 7 2 11 3C15.5 4 18 7.5 16.5 11C15 14 10 14.5 7 13.5C4 12.5 2.2 10.8 2.5 8Z',
  'M4 10C2.5 6.5 5 3 9.5 3C14 3 17.5 5 17.5 8.5C17.5 12.5 14 14 10 14C6.8 14 4.8 12.3 4 10Z',
];

const PEBBLE_TILT = [-14, 9, -4];

/** Replay a CSS animation class even if it is already applied. */
function restartAnimation(el: Element, cls: string): void {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
}

/** Lightweight DOM overlay: crisp text, CSS transitions, zero render cost. */
export class Hud {
  private readonly parts = document.querySelectorAll<HTMLElement>('.hud-part');
  private readonly depth = $('#hud-depth');
  private readonly stones = $('#hud-stones');
  private readonly stoneSlot = $('#ability-stones');
  private readonly stoneCount = $('#hud-stones-count');
  private readonly stoneNote = $('#hud-stones-note');
  private readonly pebbles: SVGSVGElement[];
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

  constructor() {
    this.stones.innerHTML = Array.from(
      { length: CONFIG.stones.perLevel },
      (_, i) =>
        `<svg class="pebble" viewBox="0 0 20 16" data-i="${i}">` +
        `<path d="${PEBBLES[i % PEBBLES.length]}" transform="rotate(${PEBBLE_TILT[i % PEBBLE_TILT.length]} 10 8)"/></svg>`,
    ).join('');
    this.pebbles = [...this.stones.querySelectorAll<SVGSVGElement>('.pebble')];
    for (const p of this.pebbles) {
      p.addEventListener('animationend', () => {
        p.classList.remove('launch', 'refill');
        p.style.animationDelay = '';
        // The dashed ghost appears only after the lit pebble has flown off.
        p.classList.toggle('spent', Number(p.dataset.i) >= this.lastStones);
      });
    }
    this.stoneSlot.addEventListener('animationend', () => this.stoneSlot.classList.remove('denied'));
  }

  show(screen: Screen): void {
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('visible', name === screen);
    const inGame = screen === 'playing' || screen === 'paused';
    this.parts.forEach((el) => el.classList.toggle('visible', inGame));
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

  /** Clicked with an empty hand: shake the stone slot. */
  denyStone(): void {
    restartAnimation(this.stoneSlot, 'denied');
  }

  private setStones(left: number, prev: number): void {
    const total = this.pebbles.length;
    this.stoneCount.innerHTML = `${left}<i>/${total}</i>`;
    this.stoneNote.textContent = left === 0 ? 'камней нет' : '';
    this.stoneSlot.classList.toggle('empty', left === 0);
    this.stoneSlot.setAttribute('aria-label', `Камни: ${left} из ${total}`);
    this.pebbles.forEach((p, i) => {
      const thrown = prev >= 0 && i >= left && i < prev;
      p.classList.toggle('spent', i >= left && !thrown);
      if (prev < 0) return;
      // Thrown: the pebble hops out of the hand. New level: pebbles pop back one by one.
      if (thrown) {
        p.style.animationDelay = '';
        restartAnimation(p, 'launch');
      }
      if (i >= prev && i < left) {
        p.style.animationDelay = `${(i - prev) * 90}ms`;
        restartAnimation(p, 'refill');
      }
    });
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
      this.setStones(world.stonesLeft, this.lastStones);
      this.lastStones = world.stonesLeft;
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
