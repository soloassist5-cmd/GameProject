import type { Vec2 } from '../core/math';

/** Keyboard + mouse state. Edge-triggered presses are consumed on read. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private click: Vec2 | null = null;
  readonly mouse: Vec2 = { x: 0, y: 0 };
  /** Fires on any key/mouse press — used to unlock audio on first gesture. */
  onAnyPress: (() => void) | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.onAnyPress?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    target.addEventListener('pointerdown', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) this.click = { x: e.clientX, y: e.clientY };
      this.onAnyPress?.();
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) {
      if (this.pressed.delete(c)) hit = true;
    }
    return hit;
  }

  /** Screen-space position of the last left click, if any. */
  consumeClick(): Vec2 | null {
    const c = this.click;
    this.click = null;
    return c;
  }

  /** Drop stale edges (e.g. when switching screens). */
  flush(): void {
    this.pressed.clear();
    this.click = null;
  }

  axis(): Vec2 {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    return { x, y };
  }
}

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);
