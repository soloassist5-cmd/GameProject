import type { Segment, Vec2 } from '../core/math';
import { Rng } from '../core/rng';
import { type Level, bfsDistances, box, cellCenter, doorKey, seg } from '../game/level';

/**
 * Hand-authored 4×3 "film set" for the trailer: a fixed layout,
 * so every shot can be blocked like a scene.
 *
 *   0  1  2  3
 *   4  5  6  7
 *   8  9 10 11   ← exit in 11
 */
const COLS = 4;
const ROWS = 3;
const CS = 260;
const DOOR = 84;

/** [roomA, roomB, offset of the doorway from the wall's middle]. */
const DOORS: Array<[number, number, number]> = [
  [0, 1, -30],
  [1, 2, 20],
  [2, 3, 0],
  [4, 5, 25],
  [5, 6, -20],
  [6, 7, 30],
  [8, 9, 0],
  [9, 10, -25],
  [10, 11, 15],
  [0, 4, 30],
  [1, 5, -20],
  [3, 7, -25],
  [4, 8, 0],
  [6, 10, -30],
  [7, 11, 10],
];

/** Obstacles: [room, quadrantX, quadrantY, kind]. */
const PROPS: Array<[number, -1 | 1, -1 | 1, 'box' | 'slab']> = [
  [1, 1, -1, 'box'],
  [1, -1, 1, 'slab'],
  [2, -1, -1, 'box'],
  [2, 1, 1, 'box'],
  [5, 1, 1, 'box'],
  [6, -1, -1, 'slab'],
  [8, 1, 1, 'box'],
  [9, -1, -1, 'box'],
  [9, 1, 1, 'slab'],
  [10, 1, -1, 'box'],
];

export const STAGE = { cols: COLS, rows: ROWS, cellSize: CS };

export const room = (i: number): Vec2 => cellCenter(STAGE, i);

export function door(a: number, b: number): Vec2 {
  const d = DOORS.find(([x, y]) => doorKey(x, y) === doorKey(a, b));
  if (!d) throw new Error(`No door ${a}-${b}`);
  const [lo, hi, off] = d[0] < d[1] ? d : [d[1], d[0], d[2]];
  const c = lo % COLS;
  const r = Math.floor(lo / COLS);
  return hi === lo + 1
    ? { x: (c + 1) * CS, y: (r + 0.5) * CS + off }
    : { x: (c + 0.5) * CS + off, y: (r + 1) * CS };
}

export function buildStage(opts: { start: Vec2; enemies?: Vec2[]; seed?: number }): Level {
  const rng = new Rng(opts.seed ?? 7);
  const count = COLS * ROWS;
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  const doors = new Map<string, Vec2>();
  for (const [a, b] of DOORS) {
    neighbors[a]!.push(b);
    neighbors[b]!.push(a);
    doors.set(doorKey(a, b), door(a, b));
  }

  const walls: Segment[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (c < COLS - 1) {
        const x = (c + 1) * CS;
        const d = doors.get(doorKey(i, i + 1));
        if (d) walls.push(seg(x, r * CS, x, d.y - DOOR / 2), seg(x, d.y + DOOR / 2, x, (r + 1) * CS));
        else walls.push(seg(x, r * CS, x, (r + 1) * CS));
      }
      if (r < ROWS - 1) {
        const y = (r + 1) * CS;
        const d = doors.get(doorKey(i, i + COLS));
        if (d) walls.push(seg(c * CS, y, d.x - DOOR / 2, y), seg(d.x + DOOR / 2, y, (c + 1) * CS, y));
        else walls.push(seg(c * CS, y, (c + 1) * CS, y));
      }
    }
  }
  const w = COLS * CS;
  const h = ROWS * CS;
  walls.push(seg(0, 0, w, 0), seg(w, 0, w, h), seg(w, h, 0, h), seg(0, h, 0, 0));

  for (const [i, qx, qy, kind] of PROPS) {
    const c = room(i);
    const ox = c.x + qx * (CS / 4);
    const oy = c.y + qy * (CS / 4);
    if (kind === 'box') walls.push(...box(ox, oy, rng.range(22, 32), rng.range(22, 32), rng.range(0, Math.PI)));
    else {
      const a = rng.range(0, Math.PI);
      walls.push(seg(ox - Math.cos(a) * 22, oy - Math.sin(a) * 22, ox + Math.cos(a) * 22, oy + Math.sin(a) * 22));
    }
  }

  const dust: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (let k = 0; k < 70; k++) dust.push({ x: (c + rng.range(0.03, 0.97)) * CS, y: (r + rng.range(0.03, 0.97)) * CS });
  }

  const startCell = Math.floor(opts.start.y / CS) * COLS + Math.floor(opts.start.x / CS);
  return {
    seed: opts.seed ?? 7,
    depth: 1,
    cols: COLS,
    rows: ROWS,
    cellSize: CS,
    width: w,
    height: h,
    walls,
    neighbors,
    doors,
    roomDistance: bfsDistances(neighbors, startCell),
    startCell,
    exitCell: 11,
    start: opts.start,
    exit: room(11),
    enemySpawns: opts.enemies ?? [],
    dust,
  };
}
