import { Rng } from '../core/rng';
import { type Segment, type Vec2, clamp } from '../core/math';
import { CONFIG, enemyCountForDepth } from './config';

/**
 * A level is a grid of rooms ("cells") connected by doorways.
 * The room graph is a random maze with a few extra loops, so the player
 * can always sneak around a listener instead of only running into it.
 */
export interface Level {
  seed: number;
  depth: number;
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
  walls: Segment[];
  /** Adjacency list of the room graph. */
  neighbors: number[][];
  /** Doorway centre between two rooms, keyed by `doorKey(a, b)`. */
  doors: Map<string, Vec2>;
  /** BFS distance (in rooms) from the start room. */
  roomDistance: number[];
  startCell: number;
  exitCell: number;
  start: Vec2;
  exit: Vec2;
  enemySpawns: Vec2[];
  /** Floor speckles that catch faint echoes. */
  dust: Vec2[];
}

export const doorKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function cellCenter(level: Pick<Level, 'cols' | 'cellSize'>, cell: number): Vec2 {
  const c = cell % level.cols;
  const r = Math.floor(cell / level.cols);
  return { x: (c + 0.5) * level.cellSize, y: (r + 0.5) * level.cellSize };
}

export function cellOf(level: Pick<Level, 'cols' | 'rows' | 'cellSize'>, p: Vec2): number {
  const c = clamp(Math.floor(p.x / level.cellSize), 0, level.cols - 1);
  const r = clamp(Math.floor(p.y / level.cellSize), 0, level.rows - 1);
  return r * level.cols + c;
}

export function generateLevel(seed: number, depth: number): Level {
  const rng = new Rng(seed);
  const cs = CONFIG.level.cellSize;
  const cols = 5 + Math.min(depth - 1, 3);
  const rows = 4 + Math.min(Math.floor((depth - 1) / 2), 2);
  const count = cols * rows;
  const width = cols * cs;
  const height = rows * cs;

  // --- Room graph: randomized DFS maze + a few extra doors for loops.
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  const open = new Set<string>();
  const connect = (a: number, b: number) => {
    open.add(doorKey(a, b));
    neighbors[a]!.push(b);
    neighbors[b]!.push(a);
  };
  const gridNeighbors = (i: number): number[] => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const out: number[] = [];
    if (c > 0) out.push(i - 1);
    if (c < cols - 1) out.push(i + 1);
    if (r > 0) out.push(i - cols);
    if (r < rows - 1) out.push(i + cols);
    return out;
  };

  const visited = new Array<boolean>(count).fill(false);
  const stack = [rng.int(0, count - 1)];
  visited[stack[0]!] = true;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const options = gridNeighbors(cur).filter((n) => !visited[n]);
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const next = rng.pick(options);
    visited[next] = true;
    connect(cur, next);
    stack.push(next);
  }
  for (let i = 0; i < count; i++) {
    for (const n of gridNeighbors(i)) {
      if (n > i && !open.has(doorKey(i, n)) && rng.chance(CONFIG.level.extraDoorChance)) connect(i, n);
    }
  }

  // --- Start in a corner-ish room, exit in the farthest room.
  const startCell = rng.pick([0, cols - 1, count - cols, count - 1]);
  const roomDistance = bfsDistances(neighbors, startCell);
  let exitCell = startCell;
  for (let i = 0; i < count; i++) if (roomDistance[i]! > roomDistance[exitCell]!) exitCell = i;

  // --- Walls with doorway gaps.
  const walls: Segment[] = [];
  const doors = new Map<string, Vec2>();
  const half = CONFIG.level.doorWidth / 2;
  // Doors stay near the wall's middle so centre↔door lanes never cross quadrant obstacles.
  const maxOffset = cs / 2 - half - 60;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // Vertical wall on the right side of the room.
      if (c < cols - 1) {
        const x = (c + 1) * cs;
        const y0 = r * cs;
        const y1 = y0 + cs;
        if (open.has(doorKey(i, i + 1))) {
          const dy = y0 + cs / 2 + rng.range(-maxOffset, maxOffset);
          walls.push(seg(x, y0, x, dy - half), seg(x, dy + half, x, y1));
          doors.set(doorKey(i, i + 1), { x, y: dy });
        } else {
          walls.push(seg(x, y0, x, y1));
        }
      }
      // Horizontal wall below the room.
      if (r < rows - 1) {
        const y = (r + 1) * cs;
        const x0 = c * cs;
        const x1 = x0 + cs;
        if (open.has(doorKey(i, i + cols))) {
          const dx = x0 + cs / 2 + rng.range(-maxOffset, maxOffset);
          walls.push(seg(x0, y, dx - half, y), seg(dx + half, y, x1, y));
          doors.set(doorKey(i, i + cols), { x: dx, y });
        } else {
          walls.push(seg(x0, y, x1, y));
        }
      }
    }
  }
  walls.push(seg(0, 0, width, 0), seg(width, 0, width, height), seg(width, height, 0, height), seg(0, height, 0, 0));

  // --- Obstacles: rotated boxes and free-standing slabs in room quadrants,
  //     keeping room centres clear for spawns, the start and the exit.
  for (let i = 0; i < count; i++) {
    if (i === startCell || i === exitCell) continue;
    if (!rng.chance(CONFIG.level.obstacleChance)) continue;
    const center = cellCenter({ cols, cellSize: cs }, i);
    const quadrants = rng.shuffle([
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]);
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const [qx, qy] = quadrants[k]!;
      const ox = center.x + qx! * (cs / 4) + rng.range(-8, 8);
      const oy = center.y + qy! * (cs / 4) + rng.range(-8, 8);
      if (rng.chance(0.7)) {
        walls.push(...box(ox, oy, rng.range(16, 34), rng.range(16, 34), rng.range(0, Math.PI)));
      } else {
        const len = rng.range(30, 48) / 2;
        const a = rng.range(0, Math.PI);
        walls.push(seg(ox - Math.cos(a) * len, oy - Math.sin(a) * len, ox + Math.cos(a) * len, oy + Math.sin(a) * len));
      }
    }
  }

  // --- Listeners spawn far from the start.
  const candidates = [];
  for (let i = 0; i < count; i++) if (roomDistance[i]! >= 2 && i !== exitCell) candidates.push(i);
  rng.shuffle(candidates);
  const enemySpawns = candidates
    .slice(0, enemyCountForDepth(depth))
    .map((i) => cellCenter({ cols, cellSize: cs }, i));

  // --- Floor dust.
  const dust: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let k = 0; k < CONFIG.level.dustPerCell; k++) {
      dust.push({ x: (c + rng.range(0.03, 0.97)) * cs, y: (r + rng.range(0.03, 0.97)) * cs });
    }
  }

  return {
    seed,
    depth,
    cols,
    rows,
    cellSize: cs,
    width,
    height,
    walls,
    neighbors,
    doors,
    roomDistance,
    startCell,
    exitCell,
    start: cellCenter({ cols, cellSize: cs }, startCell),
    exit: cellCenter({ cols, cellSize: cs }, exitCell),
    enemySpawns,
    dust,
  };
}

export function bfsDistances(neighbors: number[][], from: number): number[] {
  const dist = new Array<number>(neighbors.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    for (const n of neighbors[cur]!) {
      if (dist[n] === -1) {
        dist[n] = dist[cur]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * Waypoints from `from` to `to`: doorway → room centre → doorway … → target.
 * Going through room centres keeps walkers on lanes the generator leaves clear.
 */
export function findPath(level: Level, from: Vec2, to: Vec2): Vec2[] {
  const a = cellOf(level, from);
  const b = cellOf(level, to);
  if (a === b) return [to];
  const prev = new Array<number>(level.neighbors.length).fill(-1);
  prev[a] = a;
  const queue = [a];
  for (let head = 0; head < queue.length && prev[b] === -1; head++) {
    const cur = queue[head]!;
    for (const n of level.neighbors[cur]!) {
      if (prev[n] === -1) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  if (prev[b] === -1) return [to];
  const rooms = [b];
  while (rooms[rooms.length - 1] !== a) rooms.push(prev[rooms[rooms.length - 1]!]!);
  rooms.reverse();
  const path: Vec2[] = [];
  for (let k = 0; k < rooms.length - 1; k++) {
    path.push(level.doors.get(doorKey(rooms[k]!, rooms[k + 1]!))!);
    if (k + 1 < rooms.length - 1) path.push(cellCenter(level, rooms[k + 1]!));
  }
  path.push(to);
  return path;
}

export function seg(x1: number, y1: number, x2: number, y2: number): Segment {
  return { a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
}

export function box(cx: number, cy: number, w: number, h: number, angle: number): Segment[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x! * cos - y! * sin, y: cy + x! * sin + y! * cos }));
  return corners.map((p, i) => ({ a: p, b: corners[(i + 1) % 4]! }));
}
