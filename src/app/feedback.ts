import type { AudioEngine } from '../audio/audio';
import type { Vec2 } from '../core/math';
import type { GameEvent } from '../game/world';

/** Screen-space juice a simulation event can trigger. Implemented by Renderer. */
export interface FxSink {
  onStep(): void;
  shockwaveAt(p: Vec2): void;
  addTrauma(amount: number): void;
  flashScreen(color: number, alpha: number): void;
}

/**
 * Maps simulation events to sound and screen feedback.
 * Shared by the game and the trailer so both feel identical.
 */
export class Feedback {
  constructor(
    private readonly audio: AudioEngine,
    private readonly fx: FxSink | null,
  ) {}

  /** `audible: false` keeps only the visual echo (title-screen attract mode). */
  apply(ev: GameEvent, audible = true): void {
    const at = { x: ev.x, y: ev.y };
    const fx = this.fx;
    if (!audible) {
      if (ev.type === 'pulse' && ev.source === 'intro') fx?.shockwaveAt(at);
      return;
    }
    switch (ev.type) {
      case 'pulse':
        switch (ev.source) {
          case 'step':
          case 'sneakStep':
            this.audio.step(at, ev.source === 'sneakStep');
            fx?.onStep();
            break;
          case 'clap':
            this.audio.clap(at);
            fx?.shockwaveAt(at);
            fx?.addTrauma(0.25);
            break;
          case 'intro':
            this.audio.intro(at);
            fx?.shockwaveAt(at);
            break;
          case 'stone':
            this.audio.stoneLand(at);
            fx?.addTrauma(0.08);
            break;
          case 'enemyStep':
            this.audio.enemyStep(at);
            break;
          default:
            break;
        }
        break;
      case 'throw':
        this.audio.throwStone(at);
        break;
      case 'dryThrow':
        this.audio.dryThrow();
        break;
      case 'alert':
        this.audio.enemyAlert(at);
        fx?.addTrauma(0.35);
        break;
      case 'death':
        this.audio.death();
        fx?.addTrauma(1);
        fx?.flashScreen(0xff1040, 0.45);
        break;
      case 'win':
        this.audio.win();
        fx?.flashScreen(0xfff2d0, 0.6);
        fx?.addTrauma(0.2);
        break;
    }
  }
}
