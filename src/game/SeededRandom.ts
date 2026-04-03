// ============================================
// CUBITOPIA - Seeded PRNG (Mulberry32)
// Shared utility for deterministic game logic.
// ALL game-logic randomness MUST use GameRNG —
// Math.random() is only allowed in visuals/audio.
// ============================================

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Full-period 32-bit PRNG with excellent avalanche properties.
 * Given the same seed, produces the exact same sequence on any platform.
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    // Hash the seed so even consecutive seeds (1, 2, 3…) diverge immediately
    this.seed = seed ^ 0xDEADBEEF;
    // Warm up: discard a few values to mix the state
    this.next(); this.next(); this.next();
  }

  /** Returns a float in [0, 1) — deterministic replacement for Math.random() */
  next(): number {
    // Mulberry32: full-period 32-bit PRNG with excellent avalanche
    let t = (this.seed += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t = ((t ^ (t >>> 14)) >>> 0);
    return t / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  nextRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns true with the given probability (0–1) */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted random selection. weights[i] is the relative weight for index i. Returns the chosen index. */
  weightedIndex(weights: number[]): number {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }
}

/**
 * Global game RNG singleton.
 * Initialized with match seed at game start.
 * Every system that needs randomness in game logic uses this instance.
 */
class GameRNGManager {
  private _rng: SeededRandom;
  private _seed: number;

  constructor() {
    // Default seed — overwritten by initSeed() at game start
    this._seed = Date.now();
    this._rng = new SeededRandom(this._seed);
  }

  /** Initialize with a specific seed (called at match start). Both players use same seed. */
  initSeed(seed: number): void {
    this._seed = seed;
    this._rng = new SeededRandom(seed);
  }

  /** Get the current seed (for sharing with opponent / saving replays) */
  get seed(): number {
    return this._seed;
  }

  /** The shared RNG instance — use this in all game logic */
  get rng(): SeededRandom {
    return this._rng;
  }
}

/** Singleton game RNG — import and use `GameRNG.rng.next()` etc. */
export const GameRNG = new GameRNGManager();
