import { describe, expect, it } from 'vitest';
import { bfsDistances, cellOf, findPath, generateLevel } from '../src/game/level';
import { enemyCountForDepth } from '../src/game/config';
import { dist, hasLineOfSight } from '../src/core/math';

describe('level generator', () => {
  const seeds = [1, 2, 3, 99, 12345, 777777];

  it('is deterministic for a seed', () => {
    const a = generateLevel(7, 2);
    const b = generateLevel(7, 2);
    expect(a.walls).toEqual(b.walls);
    expect(a.enemySpawns).toEqual(b.enemySpawns);
    expect(a.exit).toEqual(b.exit);
  });

  it.each(seeds)('connects every room (seed %i)', (seed) => {
    const level = generateLevel(seed, 3);
    const d = bfsDistances(level.neighbors, level.startCell);
    expect(d.every((v) => v >= 0)).toBe(true);
  });

  it.each(seeds)('puts the exit in the farthest room (seed %i)', (seed) => {
    const level = generateLevel(seed, 1);
    const max = Math.max(...level.roomDistance);
    expect(level.roomDistance[level.exitCell]).toBe(max);
    expect(level.exitCell).not.toBe(level.startCell);
  });

  it.each(seeds)('spawns listeners away from the start (seed %i)', (seed) => {
    const level = generateLevel(seed, 4);
    expect(level.enemySpawns.length).toBe(enemyCountForDepth(4));
    for (const s of level.enemySpawns) {
      expect(level.roomDistance[cellOf(level, s)]).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps centre↔door lanes unobstructed across many seeds', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const level = generateLevel(seed, 1 + (seed % 6));
      const path = findPath(level, level.start, level.exit);
      let from = level.start;
      for (const wp of path) {
        expect(hasLineOfSight(from, wp, level.walls), `seed ${seed}`).toBe(true);
        from = wp;
      }
      expect(dist(path[path.length - 1]!, level.exit)).toBe(0);
    }
  });
});
