import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/audio';
import { Director } from '../src/trailer/director';
import { createShots, CARDS } from '../src/trailer/shots';
import type { World } from '../src/game/world';

/** Runs the whole trailer headless and keeps each shot's final world. */
function runTrailer(): Map<string, World> {
  const director = new Director(createShots(), CARDS, new AudioEngine(), null, null, null);
  const out = new Map<string, World>();
  while (!director.done) {
    director.step();
    out.set(director.shotName, director.world);
  }
  return out;
}

describe('trailer script', () => {
  const shots = runTrailer();

  it('plays every shot', () => {
    expect([...shots.keys()]).toEqual(createShots().map((s) => s.name));
  });

  it('the stone lures the listener away and the player slips past alive', () => {
    const world = shots.get('E-distraction')!;
    expect(world.status).toBe('playing');
    const e = world.enemies[0]!;
    expect(e.pos.y).toBeLessThan(120); // drawn up to the corner where the stone landed
    expect(world.player.pos.y).toBeGreaterThan(250); // through the lower doorway
  });

  it('the ambush clap wakes both listeners but the player escapes', () => {
    const world = shots.get('F1-ambush')!;
    expect(world.status).toBe('playing');
    expect(world.enemies.every((e) => e.state !== 'wander')).toBe(true);
  });

  it('the chase does not end in a catch', () => {
    expect(shots.get('F2-chase')!.status).toBe('playing');
  });

  it('the player gets caught in the montage finale', () => {
    expect(shots.get('F3-caught')!.status).toBe('dead');
  });

  it('the player reaches the exit', () => {
    expect(shots.get('G-exit')!.status).toBe('won');
  });

  it('nothing kills the player outside the scripted death', () => {
    for (const [name, world] of shots) {
      if (name !== 'F3-caught') expect(world.status, name).not.toBe('dead');
    }
  });
});
