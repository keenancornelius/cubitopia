/**
 * BuildingMeshHelpers — Composable builder functions for common building geometry patterns.
 *
 * Extracted from BuildingMeshFactory where the same structural patterns repeat
 * across 9+ buildings. Each helper adds geometry directly to a parent Group.
 *
 * Usage:
 *   const g = createBuildingGroup(pos, owner, 'barracks', getElevation);
 *   addFoundation(g, { width: 1.85, depth: 1.85, color1: 0x6f7c6d, color2: 0x7f8c8d });
 *   addPitchedRoof(g, { width: 1.35, depth: 1.1, y: 1.58, angle: 0.52, color: slate });
 *   addStoneCourses(g, { xs: [0], zs: [-0.15], width: 1.12, depth: 0.77, ys: [0.5, 0.85, 1.2], color: darkStone });
 */

import * as THREE from 'three';

// ── Shared material factories ─────────────────────────────────
const _matCache: Map<number, THREE.MeshLambertMaterial> = new Map();

export function mat(color: number): THREE.MeshLambertMaterial {
  let m = _matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _matCache.set(color, m); }
  return m;
}

export function glow(color: number, intensity = 0.6): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity });
}

// ── Mesh placement helpers ────────────────────────────────────

/** Create a mesh and set its position */
export function bm(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

/** Create a positioned + rotated mesh */
export function bmr(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

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

/** Add a 2-3 tier foundation platform at Y≈0.03/0.11 */
export function addFoundation(g: THREE.Group, opts: FoundationOpts = {}): void {
  const w = opts.width ?? 1.75;
  const d = opts.depth ?? w;
  const shrink = opts.shrink ?? 0.1;
  const c1 = opts.color1 ?? 0x5a5a4a;
  const c2 = opts.color2 ?? 0x6a6a5a;
  g.add(bm(new THREE.BoxGeometry(w, 0.06, d), mat(c1), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(w - shrink, 0.16, d - shrink), mat(c2), 0, 0.11, 0));
  if (opts.tier3) {
    const t = opts.tier3;
    g.add(bm(new THREE.BoxGeometry(t.width, t.height, t.depth), mat(t.color), 0, 0.19 + t.height / 2, 0));
  }
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

/** Add a symmetric pitched roof (two tilted slabs, optional under-layer) */
export function addPitchedRoof(g: THREE.Group, opts: PitchedRoofOpts): void {
  const thick = opts.thickness ?? 0.1;
  const ox = opts.offsetX ?? opts.width * 0.26;
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(opts.width, thick, opts.depth), mat(opts.color));
    slab.position.set(side * ox, opts.y, 0);
    slab.rotation.z = -side * opts.angle;
    g.add(slab);
    if (opts.underColor !== undefined) {
      const layer2 = new THREE.Mesh(new THREE.BoxGeometry(opts.width - 0.03, 0.04, opts.depth - 0.04), mat(opts.underColor));
      layer2.position.set(side * (ox - 0.01), opts.y - 0.06, 0);
      layer2.rotation.z = -side * opts.angle;
      g.add(layer2);
    }
  }
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

/** Add stacked cone layers (spire/turret cap) */
export function addConicalRoof(g: THREE.Group, opts: ConicalRoofOpts): void {
  const seg = opts.segments ?? 6;
  const x = opts.x ?? 0;
  const z = opts.z ?? 0;
  for (const [radius, height, y] of opts.layers) {
    g.add(bm(new THREE.ConeGeometry(radius, height, seg), mat(opts.color), x, y, z));
  }
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

/** Add horizontal stone course lines (box bands at specified Y positions) */
export function addStoneCourses(g: THREE.Group, opts: StoneCourseOpts): void {
  const h = opts.height ?? 0.04;
  const x = opts.x ?? 0;
  const z = opts.z ?? 0;
  for (const y of opts.ys) {
    g.add(bm(new THREE.BoxGeometry(opts.width, h, opts.depth), mat(opts.color), x, y, z));
  }
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

/** Add horizontal ring bands around cylindrical structures */
export function addCylinderBands(g: THREE.Group, opts: CylinderBandOpts): void {
  const h = opts.height ?? 0.04;
  const seg = opts.segments ?? 8;
  const x = opts.x ?? 0;
  const z = opts.z ?? 0;
  for (const y of opts.ys) {
    const r = typeof opts.radius === 'function' ? opts.radius(y) : opts.radius;
    g.add(bm(new THREE.CylinderGeometry(r, r, h, seg), mat(opts.color), x, y, z));
  }
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

/** Add a row of crenellation merlons along an edge */
export function addMerlons(g: THREE.Group, opts: MerlonOpts): void {
  const [w, h, d] = opts.size ?? [0.1, 0.16, 0.1];
  const geo = new THREE.BoxGeometry(w, h, d);
  const material = mat(opts.color);
  for (let i = 0; i < opts.count; i++) {
    g.add(bm(geo, material, opts.startX + i * opts.spacing, opts.y, opts.z));
  }
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

/** Add cylindrical corner towers at specified positions */
export function addCornerTowers(g: THREE.Group, opts: CornerTowerOpts): void {
  const seg = opts.segments ?? 8;
  const geo = new THREE.CylinderGeometry(opts.radiusTop, opts.radiusBottom, opts.height, seg);
  const material = mat(opts.color);
  for (const [x, z] of opts.positions) {
    g.add(bm(geo, material, x, opts.y, z));
  }
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

/** Add horizontal plank trim lines on walls */
export function addPlankCourses(g: THREE.Group, opts: PlankCourseOpts): void {
  const h = opts.height ?? 0.025;
  const d = opts.depth ?? 0.03;
  const material = mat(opts.color);
  for (const y of opts.ys) {
    for (const z of opts.zPositions) {
      g.add(bm(new THREE.BoxGeometry(opts.width, h, d), material, 0, y, z));
    }
  }
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

/** Add a door opening with optional arch and keystone */
export function addDoor(g: THREE.Group, opts: DoorOpts): void {
  const openColor = opts.openingColor ?? 0x1a1408;
  g.add(bm(new THREE.BoxGeometry(opts.width, opts.height, 0.08), mat(openColor), opts.x, opts.y, opts.z));
  if (opts.archColor !== undefined) {
    const archR = opts.width / 2;
    const archGeo = new THREE.CylinderGeometry(archR, archR, 0.08, 8, 1, false, 0, Math.PI);
    g.add(bmr(archGeo, mat(opts.archColor), opts.x, opts.y + opts.height / 2 + archR * 0.3, opts.z + 0.02, Math.PI / 2, 0, 0));
  }
  if (opts.keystoneColor !== undefined) {
    g.add(bm(new THREE.BoxGeometry(0.08, 0.1, 0.06), mat(opts.keystoneColor), opts.x, opts.y + opts.height / 2 + 0.1, opts.z + 0.02));
  }
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

/** Add vertical corner trim boards on building walls */
export function addCornerTrim(g: THREE.Group, opts: CornerTrimOpts): void {
  const s = opts.size ?? 0.04;
  const material = mat(opts.color);
  for (const x of opts.xs) {
    for (let zi = 0; zi < opts.zs.length; zi++) {
      const z = opts.zs[zi];
      if (zi > 0 && opts.skipBackAt?.includes(x)) continue;
      g.add(bm(new THREE.BoxGeometry(s, opts.height, s), material, x, opts.y, z));
    }
  }
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

/** Add a team banner on a pole */
export function addBanner(g: THREE.Group, opts: BannerOpts): void {
  const bh = opts.height ?? 0.35;
  const bw = opts.width ?? 0.2;
  const ph = opts.poleHeight ?? 0.6;
  const pc = opts.poleColor ?? 0x5a5550;
  // Pole
  g.add(bm(new THREE.BoxGeometry(0.03, ph, 0.03), mat(pc), opts.x, opts.y + ph / 2, opts.z));
  // Banner cloth
  g.add(bm(new THREE.BoxGeometry(bw, bh, 0.02), mat(opts.teamColor), opts.x + bw / 2 + 0.02, opts.y + ph - bh / 2, opts.z));
}
