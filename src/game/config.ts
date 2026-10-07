/** All gameplay tuning lives here so balance changes never touch logic code. */

export type PulseSource =
  | 'step'
  | 'sneakStep'
  | 'clap'
  | 'stone'
  | 'enemyStep'
  | 'enemyScream'
  | 'beacon'
  /** Silent "establishing shot" pulse on level start — enemies ignore it. */
  | 'intro';

export interface PulseSpec {
  /** How far the ring travels before fading out, px. */
  maxRadius: number;
  /** Ring expansion speed, px/s. */
  speed: number;
  /** Brightness/loudness at the origin, 0..1. */
  strength: number;
  color: number;
}

export const PULSES: Record<PulseSource, PulseSpec> = {
  step: { maxRadius: 150, speed: 420, strength: 0.55, color: 0x5ef2ff },
  sneakStep: { maxRadius: 60, speed: 260, strength: 0.32, color: 0x5ef2ff },
  clap: { maxRadius: 580, speed: 540, strength: 1.0, color: 0xb4fdff },
  stone: { maxRadius: 300, speed: 450, strength: 0.85, color: 0xf4f1ff },
  enemyStep: { maxRadius: 110, speed: 300, strength: 0.5, color: 0xff2d55 },
  enemyScream: { maxRadius: 400, speed: 480, strength: 0.9, color: 0xff2d55 },
  beacon: { maxRadius: 180, speed: 190, strength: 0.65, color: 0xffc35e },
  intro: { maxRadius: 520, speed: 380, strength: 0.85, color: 0x5ef2ff },
};

/** Pulse sources the player is responsible for — these make enemies hunt. */
export const PLAYER_SOURCES: ReadonlySet<PulseSource> = new Set(['step', 'sneakStep', 'clap', 'stone']);

export const CONFIG = {
  level: {
    cellSize: 260,
    doorWidth: 84,
    extraDoorChance: 0.14,
    obstacleChance: 0.6,
    wallSampleSpacing: 5,
    dustPerCell: 46,
  },
  player: {
    radius: 9,
    walkSpeed: 120,
    sneakSpeed: 55,
    /** Velocity smoothing sharpness — higher = snappier. */
    accel: 16,
    stepInterval: 0.4,
    sneakStepInterval: 0.65,
  },
  clapCooldown: 1.4,
  stones: {
    perLevel: 3,
    maxRange: 340,
    flightTime: 0.55,
  },
  echo: {
    /** Seconds for a lit point to fade to ~37%. */
    wallDecay: 1.7,
    dustDecay: 0.9,
    dustBrightness: 0.45,
    revealDecay: 0.9,
  },
  enemy: {
    radius: 12,
    wanderSpeed: 38,
    investigateSpeed: 85,
    huntSpeed: 150,
    /** Minimum loudness at the enemy to come and check the noise. */
    hearInvestigate: 0.06,
    /** Loudness that makes it rush in. */
    hearHunt: 0.3,
    /** Loudness multiplier when a wall stands between sound and enemy. */
    wallMuffle: 0.45,
    lingerMin: 1.2,
    lingerMax: 3,
    stepInterval: 0.85,
    huntStepInterval: 0.32,
  },
  beaconInterval: 2.6,
  exitRadius: 26,
} as const;

export function enemyCountForDepth(depth: number): number {
  return Math.min(6, 1 + Math.floor(depth / 2));
}
