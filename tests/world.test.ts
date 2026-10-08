import { describe, expect, it } from 'vitest';
import type { Level } from '../src/game/level';
import { NO_INPUT, World, type PlayerInput } from '../src/game/world';
import type { Segment } from '../src/core/math';

const DT = 1 / 60;

/** Two rooms side by side, 200px each, joined by a doorway in the middle wall. */
function twoRooms(opts: { enemyAt?: { x: number; y: number }[]; door?: boolean } = {}): Level {
  const door = opts.door ?? true;
  const s = (x1: number, y1: number, x2: number, y2: number): Segment => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
  const walls = [s(0, 0, 400, 0), s(400, 0, 400, 200), s(400, 200, 0, 200), s(0, 200, 0, 0)];
  if (door) walls.push(s(200, 0, 200, 70), s(200, 130, 200, 200));
  else walls.push(s(200, 0, 200, 200));
  return {
    seed: 1,
    depth: 1,
    cols: 2,
    rows: 1,
    cellSize: 200,
    width: 400,
    height: 200,
    walls,
    neighbors: door ? [[1], [0]] : [[], []],
    doors: new Map(door ? [['0-1', { x: 200, y: 100 }]] : []),
    roomDistance: [0, 1],
    startCell: 0,
    exitCell: 1,
    start: { x: 60, y: 100 },
    exit: { x: 340, y: 100 },
    enemySpawns: opts.enemyAt ?? [],
    dust: [],
  };
}

function run(world: World, seconds: number, input: PlayerInput = NO_INPUT): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) world.update(DT, input);
}

/** Brightest wall point near (x, y). */
function brightnessNear(world: World, x: number, y: number, r = 6): number {
  let best = 0;
  for (let i = 0; i < world.wallPointCount; i++) {
    if (Math.hypot(world.px[i]! - x, world.py[i]! - y) < r) best = Math.max(best, world.intensity[i]!);
  }
  return best;
}

describe('world', () => {
  it('a clap lights nearby walls but not walls behind an occluder', () => {
    const world = new World(twoRooms({ door: false }));
    world.update(DT, { ...NO_INPUT, clap: true });
    run(world, 0.4);
    // Left room's far wall is lit…
    expect(brightnessNear(world, 0, 100)).toBeGreaterThan(0.2);
    // …but the right room's far wall, hidden behind the solid middle wall, is dark.
    expect(brightnessNear(world, 400, 100)).toBe(0);
  });

  it('echoes travel through doorways', () => {
    const world = new World(twoRooms({ door: true }));
    world.player.pos = { x: 180, y: 100 };
    world.update(DT, { ...NO_INPUT, clap: true });
    run(world, 0.6);
    expect(brightnessNear(world, 400, 100)).toBeGreaterThan(0.05);
  });

  it('walking produces footstep pulses; standing still does not', () => {
    const world = new World(twoRooms());
    run(world, 1);
    expect(world.drainEvents().filter((e) => e.type === 'pulse' && e.source === 'step')).toHaveLength(0);
    run(world, 1, { ...NO_INPUT, moveY: 1 });
    expect(world.drainEvents().filter((e) => e.type === 'pulse' && e.source === 'step').length).toBeGreaterThan(1);
  });

  it('a listener that hears a clap comes hunting', () => {
    const world = new World(twoRooms({ enemyAt: [{ x: 300, y: 100 }] }));
    world.player.pos = { x: 150, y: 100 };
    world.update(DT, { ...NO_INPUT, clap: true });
    run(world, 0.5);
    expect(world.enemies[0]!.state).toBe('hunt');
    const events = world.drainEvents();
    expect(events.some((e) => e.type === 'alert')).toBe(true);
  });

  it('the intro pulse lights the room but never wakes listeners', () => {
    const world = new World(twoRooms({ enemyAt: [{ x: 300, y: 100 }] }));
    world.player.pos = { x: 150, y: 100 };
    world.emitPulse('intro', 150, 100);
    run(world, 0.8);
    expect(world.enemies[0]!.state).not.toBe('hunt');
    expect(world.enemies[0]!.reveal).toBeGreaterThan(0);
    expect(world.drainEvents().some((e) => e.type === 'alert')).toBe(false);
  });

  it('a thrown stone lures the listener to where it lands', () => {
    const world = new World(twoRooms({ enemyAt: [{ x: 300, y: 60 }] }));
    world.player.pos = { x: 60, y: 100 };
    world.update(DT, { ...NO_INPUT, throwAt: { x: 330, y: 110 } });
    expect(world.stonesLeft).toBe(2);
    run(world, 3);
    const e = world.enemies[0]!;
    expect(Math.hypot(e.pos.x - 330, e.pos.y - 110)).toBeLessThan(40);
  });

  it('throwing with an empty hand reports a dry throw and changes nothing', () => {
    const world = new World(twoRooms());
    world.stonesLeft = 0;
    world.update(DT, { ...NO_INPUT, throwAt: { x: 150, y: 100 } });
    expect(world.stones).toHaveLength(0);
    expect(world.stonesLeft).toBe(0);
    const events = world.drainEvents();
    expect(events.some((e) => e.type === 'dryThrow')).toBe(true);
    expect(events.some((e) => e.type === 'throw')).toBe(false);
  });

  it('touching a listener ends the run', () => {
    const world = new World(twoRooms({ enemyAt: [{ x: 70, y: 100 }] }));
    world.update(DT, NO_INPUT);
    expect(world.status).toBe('dead');
    expect(world.drainEvents().some((e) => e.type === 'death')).toBe(true);
  });

  it('reaching the exit wins', () => {
    const world = new World(twoRooms());
    world.player.pos = { x: 330, y: 100 };
    world.update(DT, { ...NO_INPUT, moveX: 1 });
    expect(world.status).toBe('won');
  });

  it('echo light fades over time', () => {
    const world = new World(twoRooms({ door: false }));
    world.update(DT, { ...NO_INPUT, clap: true });
    run(world, 0.4);
    const lit = brightnessNear(world, 0, 100);
    run(world, 5);
    expect(brightnessNear(world, 0, 100)).toBeLessThan(lit * 0.1);
  });
});
