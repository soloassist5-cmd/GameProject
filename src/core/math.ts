export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing towards a target. */
export const damp = (current: number, target: number, sharpness: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-sharpness * dt));

export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const dist = (a: Vec2, b: Vec2): number => Math.sqrt(dist2(a, b));

export const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export function normalize(x: number, y: number): Vec2 {
  const len = length(x, y);
  return len > 1e-9 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/**
 * Parametric intersection of segment p→q with segment s.
 * Returns t along p→q (0..1) or null when they do not cross.
 */
export function segmentIntersectionT(p: Vec2, q: Vec2, s: Segment): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = s.b.x - s.a.x;
  const sy = s.b.y - s.a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel or collinear
  const qpx = s.a.x - p.x;
  const qpy = s.a.y - p.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** True when nothing in `walls` blocks the straight line from `from` to `to`. */
export function hasLineOfSight(from: Vec2, to: Vec2, walls: readonly Segment[]): boolean {
  for (const w of walls) {
    if (segmentIntersectionT(from, to, w) !== null) return false;
  }
  return true;
}

/** Closest distance along p→q to any wall, as t in 0..1 (1 when unobstructed). */
export function firstHitT(p: Vec2, q: Vec2, walls: readonly Segment[]): number {
  let best = 1;
  for (const w of walls) {
    const t = segmentIntersectionT(p, q, w);
    if (t !== null && t < best) best = t;
  }
  return best;
}

export function closestPointOnSegment(p: Vec2, s: Segment): Vec2 {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: s.a.x, y: s.a.y };
  const t = clamp(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2, 0, 1);
  return { x: s.a.x + dx * t, y: s.a.y + dy * t };
}

/**
 * Moves a circle out of all walls it overlaps (in place).
 * A few relaxation passes keep corners stable.
 */
export function resolveCircleWalls(pos: Vec2, radius: number, walls: readonly Segment[]): boolean {
  let collided = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const w of walls) {
      const c = closestPointOnSegment(pos, w);
      const dx = pos.x - c.x;
      const dy = pos.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        if (d > 1e-6) {
          pos.x += (dx / d) * push;
          pos.y += (dy / d) * push;
        } else {
          // Exactly on the wall: push along the wall normal.
          const n = normalize(-(w.b.y - w.a.y), w.b.x - w.a.x);
          pos.x += n.x * radius;
          pos.y += n.y * radius;
        }
        moved = true;
        collided = true;
      }
    }
    if (!moved) break;
  }
  return collided;
}
