import { AudioEngine } from '../audio/audio';
import { Input } from '../input/input';
import { generateLevel } from '../game/level';
import { NO_INPUT, World, type GameEvent, type PlayerInput } from '../game/world';
import { Renderer } from '../render/renderer';
import { Hud, type Screen } from '../ui/hud';
import { loadBest, saveBest } from './storage';

const CONTROLS_HINT =
  '<b>WASD</b> идти · <b>Shift</b> красться · <b>Пробел</b> хлопок · <b>ЛКМ</b> бросить камень<br>' +
  'Иди на <span class="gold">золотой гул</span>. Не шуми рядом с <span class="red">красным</span>.';

/** Glue between simulation, presentation and screens. */
export class Game {
  private world!: World;
  private screen: Screen = 'title';
  private depth = 1;
  private levelSeed = 0;
  private readonly baseSeed: number;
  private timeScale = 1;
  private slowmo = 0;
  private screenTimer = 0;
  private runTime = 0;
  private best = loadBest();

  constructor(
    private readonly renderer: Renderer,
    private readonly audio: AudioEngine,
    private readonly hud: Hud,
    private readonly input: Input,
  ) {
    const params = new URLSearchParams(location.search);
    this.baseSeed = Number(params.get('seed')) || (Math.random() * 2 ** 31) >>> 0;
    this.renderer.debug = params.has('debug');
    this.hud.setDebug(this.renderer.debug);
    this.input.onAnyPress = () => this.audio.unlock();
    this.hud.setBest(this.best);
    this.loadLevel(1);
    this.setScreen('title');
  }

  private loadLevel(depth: number, sameSeed = false): void {
    this.depth = depth;
    if (!sameSeed) this.levelSeed = (this.baseSeed + depth * 7919) >>> 0;
    this.world = new World(generateLevel(this.levelSeed, depth));
    this.renderer.bindWorld(this.world);
    this.hud.setDepth(depth);
    this.runTime = 0;
    this.timeScale = 1;
    this.slowmo = 0;
  }

  private setScreen(screen: Screen): void {
    this.screen = screen;
    this.screenTimer = 0;
    this.hud.show(screen);
    this.renderer.hidePlayer = screen === 'title';
    this.input.flush();
  }

  private startRun(): void {
    this.audio.unlock();
    this.loadLevel(1);
    this.setScreen('playing');
    this.hud.showHint(CONTROLS_HINT, 9);
    this.introPulse();
  }

  /** Establishing shot: show the room around the player without waking anything. */
  private introPulse(): void {
    this.world.emitPulse('intro', this.world.player.pos.x, this.world.player.pos.y);
  }

  update(dt: number): void {
    const inp = this.input;
    this.screenTimer += dt;

    if (inp.wasPressed('F1', 'Backquote')) {
      this.renderer.debug = !this.renderer.debug;
      this.hud.setDebug(this.renderer.debug);
    }
    if (inp.wasPressed('KeyM')) this.audio.toggleMute();

    switch (this.screen) {
      case 'title':
        if (inp.wasPressed('Enter', 'Space') || inp.consumeClick()) this.startRun();
        // Attract mode: the level breathes behind the title.
        if (this.screenTimer > 3.2) {
          this.screenTimer = 0;
          this.introPulse();
        }
        this.world.update(dt, NO_INPUT);
        if (this.world.status !== 'playing') this.loadLevel(1);
        break;
      case 'paused':
        if (inp.wasPressed('Escape', 'KeyP') || inp.consumeClick()) this.setScreen('playing');
        return;
      case 'playing': {
        if (inp.wasPressed('Escape', 'KeyP')) {
          this.setScreen('paused');
          return;
        }
        if (inp.wasPressed('KeyR')) {
          this.loadLevel(this.depth, true);
          return;
        }
        this.runTime += dt;
        this.world.update(dt, this.playerInput());
        break;
      }
      case 'dead':
        this.world.update(dt * this.timeScale, NO_INPUT);
        if (this.screenTimer > 0.6 && (inp.wasPressed('KeyR', 'Space', 'Enter') || inp.consumeClick())) {
          this.loadLevel(this.depth, true);
          this.setScreen('playing');
        }
        break;
      case 'won':
        this.world.update(dt, NO_INPUT);
        if (this.screenTimer > 1.8) {
          this.loadLevel(this.depth + 1);
          this.setScreen('playing');
          this.introPulse();
        }
        break;
    }

    // Slow motion recovers smoothly back to real time.
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      this.timeScale = this.slowmo > 0 ? 0.25 : 1;
    }

    this.handleEvents(this.world.drainEvents());
  }

  private playerInput(): PlayerInput {
    const axis = this.input.axis();
    const click = this.input.consumeClick();
    return {
      moveX: axis.x,
      moveY: axis.y,
      sneak: this.input.isDown('ShiftLeft', 'ShiftRight'),
      clap: this.input.wasPressed('Space'),
      throwAt: click ? this.renderer.screenToWorld(click.x, click.y) : null,
    };
  }

  private handleEvents(events: GameEvent[]): void {
    const live = this.screen === 'playing' || this.screen === 'dead' || this.screen === 'won';
    for (const ev of events) {
      const at = { x: ev.x, y: ev.y };
      switch (ev.type) {
        case 'pulse':
          if (!live) {
            if (ev.source === 'intro') this.renderer.shockwaveAt(at);
            break;
          }
          switch (ev.source) {
            case 'step':
              this.audio.step(at, false);
              this.renderer.onStep();
              break;
            case 'sneakStep':
              this.audio.step(at, true);
              this.renderer.onStep();
              break;
            case 'clap':
              this.audio.clap(at);
              this.renderer.shockwaveAt(at);
              this.renderer.addTrauma(0.25);
              break;
            case 'intro':
              this.audio.intro(at);
              this.renderer.shockwaveAt(at);
              break;
            case 'stone':
              this.audio.stoneLand(at);
              this.renderer.addTrauma(0.08);
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
        case 'alert':
          if (!live) break;
          this.audio.enemyAlert(at);
          this.renderer.addTrauma(0.35);
          break;
        case 'death':
          if (this.screen !== 'playing') break;
          this.audio.death();
          this.renderer.addTrauma(1);
          this.renderer.flashScreen(0xff1040, 0.45);
          this.slowmo = 1.1;
          this.timeScale = 0.25;
          this.hud.setDeathStats(this.depth, this.runTime);
          this.setScreen('dead');
          break;
        case 'win':
          if (this.screen !== 'playing') break;
          this.audio.win();
          this.renderer.flashScreen(0xfff2d0, 0.6);
          this.renderer.addTrauma(0.2);
          if (this.depth + 1 > this.best) {
            this.best = this.depth + 1;
            saveBest(this.best);
            this.hud.setBest(this.best);
          }
          this.setScreen('won');
          break;
      }
    }
  }

  render(dt: number): void {
    const aim = this.screen === 'playing' ? this.renderer.screenToWorld(this.input.mouse.x, this.input.mouse.y) : null;
    this.renderer.render(this.world, dt, aim);
    this.hud.update(this.world, dt);
    this.audio.setListener(this.world.player.pos);
    this.audio.updateBeacon(this.world.level.exit, this.screen !== 'title');
  }
}
