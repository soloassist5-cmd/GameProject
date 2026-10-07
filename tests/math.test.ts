import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  firstHitT,
  hasLineOfSight,
  resolveCircleWalls,
  segmentIntersectionT,
  type Segment,
} from '../src/core/math';
import { Rng } from '../src/core/rng';

const wall: Segment = { a: { x: 0, y: -10 }, b: { x: 0, y: 10 } };

describe('math', () => {
  it('finds segment crossings', () => {
    expect(segmentIntersectionT({ x: -5, y: 0 }, { x: 5, y: 0 }, wall)).toBeCloseTo(0.5);
    expect(segmentIntersectionT({ x: -5, y: 20 }, { x: 5, y: 20 }, wall)).toBeNull();
    expect(segmentIntersectionT({ x: 1, y: 0 }, { x: 5, y: 0 }, wall)).toBeNull();
  });

  it('checks line of sight and first hit', () => {
    expect(hasLineOfSight({ x: -5, y: 0 }, { x: 5, y: 0 }, [wall])).toBe(false);
    expect(hasLineOfSight({ x: 1, y: 0 }, { x: 5, y: 0 }, [wall])).toBe(true);
    expect(firstHitT({ x: -10, y: 0 }, { x: 10, y: 0 }, [wall])).toBeCloseTo(0.5);
  });

  it('projects onto segments with clamping', () => {
    expect(closestPointOnSegment({ x: 3, y: 4 }, wall)).toEqual({ x: 0, y: 4 });
    expect(closestPointOnSegment({ x: 3, y: 40 }, wall)).toEqual({ x: 0, y: 10 });
  });

  it('pushes circles out of walls', () => {
    const pos = { x: 2, y: 0 };
    expect(resolveCircleWalls(pos, 5, [wall])).toBe(true);
    expect(pos.x).toBeCloseTo(5);
    const free = { x: 20, y: 0 };
    expect(resolveCircleWalls(free, 5, [wall])).toBe(false);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Rng(43).next()).not.toEqual(seqA[0]);
  });

  it('keeps int() within inclusive bounds', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});
