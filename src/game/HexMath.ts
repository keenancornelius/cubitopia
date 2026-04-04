/**
 * HexMath — Shared hex grid math utilities.
 *
 * Consolidates hex distance calculations that were previously duplicated
 * across 9+ files (CombatSystem, TacticalGroup, CombatEventHandler,
 * StatusEffectSystem, UnitAI, MapInitializer, BaseUpgradeSystem,
 * TitleScene, main.ts).
 *
 * Offset hex coordinates: worldX = q * 1.5, worldZ = r * 1.5 + (q%2===1 ? 0.75 : 0)
 */

import type { HexCoord } from '../types';

/**
 * Hex distance between two HexCoord objects.
 * Converts offset coordinates to cube, then computes Chebyshev distance.
 */
export function hexDist(a: HexCoord, b: HexCoord): number {
  return hexDistQR(a.q, a.r, b.q, b.r);
}

/**
 * Hex distance from raw q,r coordinates.
 * Converts offset coordinates to cube, then computes Chebyshev distance.
 */
export function hexDistQR(q1: number, r1: number, q2: number, r2: number): number {
  // Offset → cube conversion: x = q, z = r - (q - (q&1)) / 2, y = -x - z
  const x1 = q1, z1 = r1 - (q1 - (q1 & 1)) / 2, y1 = -x1 - z1;
  const x2 = q2, z2 = r2 - (q2 - (q2 & 1)) / 2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

/**
 * Hex distance from delta q,r (when you already have dq = q1-q2, dr = r1-r2).
 * Uses the (|dq| + |dr| + |-dq-dr|) / 2 formula.
 */
export function hexDistFromDeltas(dq: number, dr: number): number {
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
}
