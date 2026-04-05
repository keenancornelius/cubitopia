// ============================================
// CUBITOPIA — Animation Utilities
// Shared easing functions, phase helpers, and interpolation
// for UnitAnimations.ts attack/gathering/building cycles.
// ============================================

// ─── Named Easing Functions ──────────────────────────────────

/** Quadratic ease-in: slow start, accelerating. p*p */
export function easeIn(p: number): number { return p * p; }

/** Quadratic ease-out: fast start, decelerating. 1-(1-p)^2 */
export function easeOut(p: number): number { return 1 - (1 - p) * (1 - p); }

/** Cubic ease-out: fast start, smoother deceleration. 1-(1-p)^3 */
export function cubicOut(p: number): number { return 1 - (1 - p) * (1 - p) * (1 - p); }

/** Smoothstep: ease-in-out with zero derivatives at endpoints. p²(3-2p) */
export function smoothstep(p: number): number { return p * p * (3 - 2 * p); }

/** Quadratic ease-in-out: smooth acceleration then deceleration. */
export function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

/** Cubic ease-in: p^3 — strong acceleration. */
export function cubicIn(p: number): number { return p * p * p; }

// ─── Interpolation ───────────────────────────────────────────

/** Linear interpolation from a to b by t (0..1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Phase Resolution ────────────────────────────────────────

/**
 * Given a cycle position (0..1) and an array of phase-end thresholds,
 * returns the phase index and normalized progress (0..1) within that phase.
 *
 * Example: phaseOf(0.35, [0.3, 0.5, 0.7, 1.0])
 *   → { index: 1, p: 0.25 }   (phase 1, 25% through)
 *
 * If cycle >= last threshold, returns { index: thresholds.length-1, p: 1 }.
 */
export function phaseOf(cycle: number, thresholds: readonly number[]): { index: number; p: number } {
  let start = 0;
  for (let i = 0; i < thresholds.length; i++) {
    const end = thresholds[i];
    if (cycle < end) {
      const duration = end - start;
      return { index: i, p: duration > 0 ? (cycle - start) / duration : 0 };
    }
    start = end;
  }
  return { index: thresholds.length - 1, p: 1 };
}

/**
 * Compute cycle position and resolve phase in one call.
 * Commonly used as: const { cycle, index, p } = cyclePhase(time, speed, thresholds)
 */
export function cyclePhase(
  time: number, speed: number, thresholds: readonly number[],
): { cycle: number; index: number; p: number } {
  const cycle = (time * speed) % 1;
  const { index, p } = phaseOf(cycle, thresholds);
  return { cycle, index, p };
}
