/**
 * geometry.ts — Composable building mesh configuration interfaces
 *
 * Extracted from BuildingMeshHelpers. These represent configuration
 * options for mesh-building functions, not runtime state.
 */

// ── Foundation ────────────────────────────────────────────────
export interface FoundationOpts {
  /** Width/depth of bottom tier (default 1.75) */
  width?: number;
  depth?: number;
  /** Color of bottom tier */
  color1?: number;
  /** Color of top tier */
  color2?: number;
  /** Width/depth shrink for top tier (default 0.1) */
  shrink?: number;
  /** Optional 3rd tier */
  tier3?: { width: number; depth: number; height: number; color: number };
}

// ── Pitched (A-frame) Roof ────────────────────────────────────
export interface PitchedRoofOpts {
  /** Slab width along the slope */
  width: number;
  /** Slab depth (along ridge) */
  depth: number;
  /** Y position of the ridge */
  y: number;
  /** Tilt angle in radians (0.52 = steep, 0.22 = gentle) */
  angle: number;
  /** X offset of each slab from center (default width*0.26) */
  offsetX?: number;
  /** Main roof color */
  color: number;
  /** Optional under-layer color + thickness */
  underColor?: number;
  /** Slab thickness (default 0.1) */
  thickness?: number;
}

// ── Conical Roof / Spire ──────────────────────────────────────
export interface ConicalRoofOpts {
  /** Array of [radius, height, y] cone layers from bottom to top */
  layers: [number, number, number][];
  /** Cone color */
  color: number;
  /** Number of sides (6 for hex, 8 for round) */
  segments?: number;
  /** X/Z offset */
  x?: number;
  z?: number;
}

// ── Stone Courses / Horizontal Bands ──────────────────────────
export interface StoneCourseOpts {
  /** Y positions for each band */
  ys: number[];
  /** Band width */
  width: number;
  /** Band depth */
  depth: number;
  /** Band color */
  color: number;
  /** Band height (default 0.04) */
  height?: number;
  /** X offset (default 0) */
  x?: number;
  /** Z offset (default 0) */
  z?: number;
}

// ── Cylindrical Bands (for round buildings) ───────────────────
export interface CylinderBandOpts {
  /** Y positions for each band */
  ys: number[];
  /** Band radius (or function: (y) => radius) */
  radius: number | ((y: number) => number);
  /** Band color */
  color: number;
  /** Band height (default 0.04) */
  height?: number;
  /** Number of sides (default 8) */
  segments?: number;
  /** X/Z offset */
  x?: number;
  z?: number;
}

// ── Merlons / Crenellations ───────────────────────────────────
export interface MerlonOpts {
  /** Number of merlons */
  count: number;
  /** Starting X position */
  startX: number;
  /** Spacing between merlons */
  spacing: number;
  /** Y position */
  y: number;
  /** Z position */
  z: number;
  /** Merlon size [w, h, d] (default [0.1, 0.16, 0.1]) */
  size?: [number, number, number];
  /** Color */
  color: number;
}

// ── Corner Towers / Pillars ───────────────────────────────────
export interface CornerTowerOpts {
  /** [x, z] positions for each tower */
  positions: [number, number][];
  /** Top radius */
  radiusTop: number;
  /** Bottom radius */
  radiusBottom: number;
  /** Height */
  height: number;
  /** Y position (center) */
  y: number;
  /** Color */
  color: number;
  /** Segments (default 8) */
  segments?: number;
}

// ── Plank Courses (horizontal trim lines) ─────────────────────
export interface PlankCourseOpts {
  /** Y positions for each plank line */
  ys: number[];
  /** Plank width */
  width: number;
  /** Z positions (both sides of wall) — each Z gets a plank line */
  zPositions: number[];
  /** Plank color */
  color: number;
  /** Plank height (default 0.025) */
  height?: number;
  /** Plank depth (default 0.03) */
  depth?: number;
}

// ── Door / Archway Opening ────────────────────────────────────
export interface DoorOpts {
  /** Door width */
  width: number;
  /** Door height */
  height: number;
  /** X, Y, Z position */
  x: number;
  y: number;
  z: number;
  /** Dark opening color (default 0x1a1408) */
  openingColor?: number;
  /** Arch stone color (optional — omit for no arch) */
  archColor?: number;
  /** Keystone color (optional — omit for no keystone) */
  keystoneColor?: number;
}

// ── Vertical Corner Trim ──────────────────────────────────────
export interface CornerTrimOpts {
  /** X positions of trim boards */
  xs: number[];
  /** Z positions (front/back walls) */
  zs: number[];
  /** Trim height */
  height: number;
  /** Y center */
  y: number;
  /** Trim color */
  color: number;
  /** Trim thickness (default 0.04) */
  size?: number;
  /** Skip back-wall for center X (e.g., for doors). Pass the X values to skip on back Z. */
  skipBackAt?: number[];
}

// ── Team Banner ───────────────────────────────────────────────
export interface BannerOpts {
  x: number;
  y: number;
  z: number;
  /** Banner height (default 0.35) */
  height?: number;
  /** Banner width (default 0.2) */
  width?: number;
  /** Pole height (default 0.6) */
  poleHeight?: number;
  /** Pole color (default 0x5a5550 iron) */
  poleColor?: number;
  /** Team color hex number */
  teamColor: number;
}
