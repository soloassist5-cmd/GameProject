import { lerp, type Vec2 } from '../core/math';
import { type Enemy, type EnemyState, World } from '../game/world';
import { type Card, type Shot, follow, once, sequence } from './director';
import { buildStage, door, room } from './stage';

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

function stage(start: Vec2, enemies: Vec2[] = []): World {
  return new World(buildStage({ start, enemies }));
}

/** Puts a listener on rails: walk this path, then stand still. */
function guide(e: Enemy, path: Vec2[], state: EnemyState = 'wander'): void {
  e.path = path;
  e.state = state;
  e.linger = 99;
}

const pulseAtPlayer = (source: 'intro' | 'sneakStep' | 'step') => (w: World) =>
  w.emitPulse(source, w.player.pos.x, w.player.pos.y);

/*
 * Timeline (global seconds)
 *  0.0  A  blind          — "Ты не видишь."
 *  5.0  B  first sound    — "Ты слышишь." → clap reveals the room
 * 11.0  C  explore        — "Найди выход"
 * 16.0  D  it hears       — "И оно — тоже."
 * 21.5  E  distraction    — stone lures it away, sneak past
 * 27.5  F  montage        — ambush / chase / caught
 * 33.3  G  exit           — "Спустись глубже."
 * 37.3  H  logo
 */
/** Fresh shot list each time — input scripts keep per-run state. */
export function createShots(): Shot[] {
  return [
    {
      name: 'A-blind',
      duration: 5,
      world: () => stage({ x: 60, y: 330 }),
      zoom: 1.7,
      cues: [
        [0.8, (_w, a) => a.heartbeat(0.7)],
        [2.3, (_w, a) => a.heartbeat(0.8)],
        [3.2, pulseAtPlayer('sneakStep')],
        [3.8, (_w, a) => a.heartbeat(0.9)],
      ],
    },
    {
      name: 'B-first-sound',
      duration: 6,
      zoom: (t) => (t < 3.6 ? 1.7 : lerp(1.7, 1.1, ease((t - 3.6) / 1.6))),
      input: sequence(
        [0.3, follow([{ x: 200, y: 410 }, door(4, 5), { x: 340, y: 405 }])],
        [3.4, once(3.6, { clap: true })],
      ),
      cues: [
        [1.0, (_w, a) => a.heartbeat(0.9)],
        [2.4, (_w, a) => a.heartbeat(1)],
        [3.6, (_w, a) => a.hit(0.5)],
      ],
    },
    {
      name: 'C-explore',
      duration: 5,
      world: () => stage({ x: 330, y: 420 }),
      zoom: (t) => lerp(0.95, 0.82, ease(t / 5)),
      input: sequence(
        [0.2, follow([room(5), door(5, 6), { x: 620, y: 420 }, door(6, 10)])],
        [2.4, once(2.45, { clap: true })],
        [2.5, follow([door(6, 10), { x: 640, y: 560 }])],
      ),
      cues: [
        [0.0, pulseAtPlayer('intro')],
        [0.5, (_w, a) => a.heartbeat(1)],
        [1.6, (_w, a) => a.heartbeat(1)],
        [2.7, (_w, a) => a.heartbeat(1)],
        [3.8, (_w, a) => a.heartbeat(1)],
      ],
    },
    {
      name: 'D-it-hears',
      duration: 5.5,
      world: () => {
        const w = stage({ x: 640, y: 150 }, [{ x: 1000, y: 90 }]);
        guide(w.enemies[0]!, [
          { x: 940, y: 150 },
          { x: 890, y: 205 },
        ]);
        return w;
      },
      zoom: 1.25,
      focus: () => ({ x: 790, y: 150 }),
      cues: [
        [0.4, pulseAtPlayer('intro')],
        [
          1.1,
          (w, a) => {
            a.braam(3.2, 0.28);
            const e = w.enemies[0]!;
            w.emitPulse('enemyScream', e.pos.x, e.pos.y);
            e.reveal = 1;
            e.revealColor = 0xff2d55;
          },
        ],
        [3.2, (_w, a) => a.heartbeat(1)],
        [3.9, (_w, a) => a.heartbeat(1)],
        [4.6, (_w, a) => a.heartbeat(1)],
      ],
    },
    {
      name: 'E-distraction',
      duration: 6,
      zoom: (t) => lerp(1.2, 1.5, ease((t - 1.5) / 2.5)),
      focus: (w) => ({ x: Math.max(w.player.pos.x, 700), y: 150 }),
      input: sequence(
        [0.4, once(0.4, { throwAt: { x: 1000, y: 40 } })],
        [1.6, follow([door(2, 3)])],
        [
          2.8,
          follow([{ x: 850, y: 215 }, door(3, 7), { x: 890, y: 320 }], {
            sneak: true,
          }),
        ],
      ),
      cues: [
        [2.0, (w) => (w.enemies[0]!.linger = 99)],
        [4.0, (_w, a) => a.riser(2)],
      ],
    },
    {
      name: 'F1-ambush',
      duration: 1.6,
      world: () => {
        const w = stage({ x: 390, y: 430 }, [
          { x: 290, y: 300 },
          { x: 300, y: 490 },
        ]);
        w.enemies.forEach((e) => guide(e, []));
        return w;
      },
      zoom: 1.35,
      input: sequence([0.1, once(0.1, { clap: true })], [0.25, follow([door(5, 6), { x: 600, y: 380 }])]),
      cues: [[0, (_w, a) => a.hit(1)]],
    },
    {
      name: 'F2-chase',
      duration: 1.6,
      world: () => {
        const w = stage({ x: 300, y: 640 }, [{ x: 190, y: 650 }]);
        guide(w.enemies[0]!, [{ x: 300, y: 640 }], 'hunt');
        return w;
      },
      zoom: 1.15,
      input: follow([door(9, 10), { x: 620, y: 640 }]),
      cues: [[0, (_w, a) => a.hit(1)]],
    },
    {
      name: 'F3-caught',
      duration: 2.6,
      world: () => {
        const w = stage({ x: 580, y: 690 }, [{ x: 770, y: 690 }]);
        guide(w.enemies[0]!, [{ x: 600, y: 690 }], 'hunt');
        return w;
      },
      zoom: 1.5,
      input: follow([{ x: 720, y: 690 }], { sneak: true }),
      cues: [[0, (_w, a) => a.hit(1)]],
    },
    {
      name: 'G-exit',
      duration: 4,
      world: () => stage({ x: 790, y: 600 }),
      zoom: (t) => lerp(1.35, 1.6, ease(t / 4)),
      input: follow([room(11)], { start: 0.9 }),
      cues: [[0.2, pulseAtPlayer('intro')]],
    },
    {
      name: 'H-logo',
      duration: 8,
      world: () => stage({ x: 520, y: 390 }),
      hidePlayer: true,
      zoom: 0.78,
      focus: () => ({ x: 520, y: 390 }),
      cues: [
        [
          0.0,
          (w, a) => {
            a.braam(4.5, 0.3);
            w.emitPulse('intro', 520, 390);
          },
        ],
        [0.4, (_w, a) => a.pad(7)],
        [2.6, (w) => w.emitPulse('intro', 260, 520)],
        [4.6, (w) => w.emitPulse('intro', 780, 260)],
      ],
    },
  ];
}

export const CARDS: Card[] = [
  { from: 0.8, to: 3.4, html: 'Ты не видишь.' },
  { from: 5.6, to: 8.4, html: 'Ты слышишь.' },
  { from: 12.0, to: 15.2, html: 'Найди выход', className: 'gold small' },
  { from: 17.1, to: 20.8, html: 'И оно — тоже.', className: 'red' },
  { from: 35.0, to: 37.1, html: 'Спустись глубже.', className: 'gold' },
  {
    from: 37.8,
    to: 46,
    html: '<div class="logo">ЭХО</div>',
    className: 'logo-card',
    fadeIn: 1.2,
  },
  {
    from: 39.8,
    to: 46,
    html: 'Стелс-хоррор, где мир видно только на слух<br><span>Играй бесплатно в браузере · 🎧</span>',
    className: 'cta-card',
    fadeIn: 0.8,
  },
];
