// ============================================
// CUBITOPIA — Unit Model Composable Helpers
// Shared building blocks for voxel unit construction.
// Used by UnitModels.ts to reduce repetition across 17 unit types.
// ============================================

import * as THREE from 'three';
import { getCachedLambert } from './MeshMergeUtils';

// ─── Tribe Skin Context ─────────────────────────────────────
// Passed through unit model builders to apply tribe-specific colors.
// Falls back to default (Ironveil) colors when undefined.

export interface TribeSkin {
  /** Armor/secondary color (breastplate, leg armor, shield face). */
  secondary: number;
  /** Accent color (buckles, decorative details, insignia). */
  accent: number;
  /** Metallic trim (pauldron edges, weapon guards, gold/silver highlights). */
  trim: number;
}

/** Default skin matching Ironveil/Stoneguard hardcoded colors. */
export const DEFAULT_SKIN: TribeSkin = {
  secondary: 0x9e9e9e,  // Polished steel
  accent: 0xb8860b,     // Brass/gold
  trim: 0xffd700,       // Bright gold
};

/** Lighten a hex color by a factor (0–1). 0.3 = 30% brighter. */
export function lightenColor(hex: number, amount: number): number {
  const r = Math.min(255, ((hex >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((hex >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (hex & 0xff) + Math.round(255 * amount));
  return (r << 16) | (g << 8) | b;
}

/** Darken a hex color by a factor (0–1). 0.2 = 20% darker. */
export function darkenColor(hex: number, amount: number): number {
  const r = Math.max(0, Math.round(((hex >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((hex >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((hex & 0xff) * (1 - amount)));
  return (r << 16) | (g << 8) | b;
}

// ─── Common Colors ──────────────────────────────────────────

export const SKIN = 0xffdbac;     // Universal skin tone
export const BOOT_BROWN = 0x5d4037; // Dark brown boot
export const BLACK = 0x000000;
export const WHITE_ISH = 0xf0f0f0;

// ─── Eyes ────────────────────────────────────────────────────

export interface EyeOpts {
  /** X offset from center for each eye (symmetric ±). Default 0.07 */
  spacing?: number;
  /** Y position. Default 0.80 */
  y?: number;
  /** Z position (positive = front-facing for +Z forward, negative for -Z forward). Default 0.16 */
  z?: number;
  /** Eye white size [w, h, d]. Default [0.055, 0.04, 0.03] */
  whiteSize?: [number, number, number];
  /** Pupil size [w, h, d]. Default [0.03, 0.04, 0.03] */
  pupilSize?: [number, number, number];
  /** Eye white color. Default 0xf0f0f0 */
  whiteColor?: number;
  /** Pupil color. Default 0x222222 */
  pupilColor?: number;
  /** Z offset from white to pupil (pupil sits slightly in front). Default 0.01 */
  pupilZOffset?: number;
}

/**
 * Add a pair of eyes (white + pupil) symmetrically on the face.
 * Supports both +Z forward and -Z forward head orientations.
 */
export function addEyes(group: THREE.Group, opts: EyeOpts = {}): void {
  const spacing = opts.spacing ?? 0.07;
  const y = opts.y ?? 0.80;
  const z = opts.z ?? 0.16;
  const ws = opts.whiteSize ?? [0.055, 0.04, 0.03];
  const ps = opts.pupilSize ?? [0.03, 0.04, 0.03];
  const wCol = opts.whiteColor ?? WHITE_ISH;
  const pCol = opts.pupilColor ?? 0x222222;
  const pzOff = opts.pupilZOffset ?? 0.01;
  const zSign = z >= 0 ? 1 : -1;

  const whiteMat = getCachedLambert(wCol);
  const pupilMat = getCachedLambert(pCol);

  for (const ex of [-spacing, spacing]) {
    const eWhite = new THREE.Mesh(new THREE.BoxGeometry(ws[0], ws[1], ws[2]), whiteMat);
    eWhite.position.set(ex, y, z);
    group.add(eWhite);
    const ePupil = new THREE.Mesh(new THREE.BoxGeometry(ps[0], ps[1], ps[2]), pupilMat);
    ePupil.position.set(ex, y, z + pzOff * zSign);
    group.add(ePupil);
  }
}

/**
 * Add simple dark-box eyes (no whites, just dark rectangles).
 * Used by Archer, Mage, and some other units.
 */
export function addSimpleEyes(
  group: THREE.Group,
  spacing: number, y: number, z: number,
  size: [number, number, number] = [0.04, 0.04, 0.02],
  color: number = BLACK,
): void {
  const mat = getCachedLambert(color);
  for (const ex of [-spacing, spacing]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    eye.position.set(ex, y, z);
    group.add(eye);
  }
}

// ─── Eyebrows ────────────────────────────────────────────────

export function addEyebrows(
  group: THREE.Group,
  spacing: number, y: number, z: number,
  size: [number, number, number] = [0.08, 0.025, 0.04],
  color: number = 0x3c2415,
): void {
  const mat = getCachedLambert(color);
  for (const ex of [-spacing, spacing]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    brow.position.set(ex, y, z);
    group.add(brow);
  }
}

// ─── Mouth / Nose ────────────────────────────────────────────

export function addMouth(
  group: THREE.Group,
  y: number, z: number,
  size: [number, number, number] = [0.08, 0.02, 0.03],
  color: number = 0xa06050,
): void {
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    getCachedLambert(color),
  );
  mouth.position.set(0, y, z);
  group.add(mouth);
}

export function addNose(
  group: THREE.Group,
  y: number, z: number,
  size: [number, number, number] = [0.04, 0.05, 0.04],
  color: number = SKIN,
): void {
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    getCachedLambert(color),
  );
  nose.position.set(0, y, z);
  group.add(nose);
}

// ─── Belt + Buckle ───────────────────────────────────────────

export interface BeltOpts {
  /** Belt Y position. Default 0.18 */
  y?: number;
  /** Belt width. Default 0.48 */
  width?: number;
  /** Belt height. Default 0.07 */
  height?: number;
  /** Belt depth. Default 0.48 */
  depth?: number;
  /** Belt color */
  color: number;
  /** Buckle color (gold/brass). Set to null to skip buckle. Default 0xb8860b */
  buckleColor?: number | null;
  /** Buckle Z position (front). Default 0.24 */
  buckleZ?: number;
  /** Buckle size [w, h, d]. Default [0.10, 0.08, 0.04] */
  buckleSize?: [number, number, number];
}

export function addBelt(group: THREE.Group, opts: BeltOpts): void {
  const y = opts.y ?? 0.18;
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(opts.width ?? 0.48, opts.height ?? 0.07, opts.depth ?? 0.48),
    getCachedLambert(opts.color),
  );
  belt.position.set(0, y, 0);
  group.add(belt);

  const bColor = opts.buckleColor !== undefined ? opts.buckleColor : 0xb8860b;
  if (bColor !== null) {
    const bs = opts.buckleSize ?? [0.10, 0.08, 0.04];
    const buckle = new THREE.Mesh(
      new THREE.BoxGeometry(bs[0], bs[1], bs[2]),
      getCachedLambert(bColor),
    );
    buckle.position.set(0, y, opts.buckleZ ?? 0.24);
    group.add(buckle);
  }
}

// ─── Tabard (Team Color Front Piece) ─────────────────────────

export interface TabardOpts {
  /** Y position. Default 0.08 */
  y?: number;
  /** Z position (front). Default 0.22 */
  z?: number;
  /** Tabard size [w, h, d]. Default [0.16, 0.14, 0.04] */
  size?: [number, number, number];
  /** Team color */
  teamColor: number;
  /** Border color (usually gold). Set null to skip. Default 0xb8860b */
  borderColor?: number | null;
  /** Border height. Default 0.02 */
  borderHeight?: number;
}

export function addTabard(group: THREE.Group, opts: TabardOpts): void {
  const y = opts.y ?? 0.08;
  const z = opts.z ?? 0.22;
  const sz = opts.size ?? [0.16, 0.14, 0.04];

  const tabard = new THREE.Mesh(
    new THREE.BoxGeometry(sz[0], sz[1], sz[2]),
    getCachedLambert(opts.teamColor),
  );
  tabard.position.set(0, y, z);
  group.add(tabard);

  const bCol = opts.borderColor !== undefined ? opts.borderColor : 0xb8860b;
  if (bCol !== null) {
    const bh = opts.borderHeight ?? 0.02;
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(sz[0] + 0.02, bh, sz[2] + 0.01),
      getCachedLambert(bCol),
    );
    border.position.set(0, y - sz[1] / 2 + bh / 2, z);
    group.add(border);
  }
}

// ─── Pauldrons (Shoulder Armor) ──────────────────────────────

export interface PauldronOpts {
  /** X offset from center (positive, mirrored). Default 0.32 */
  offsetX?: number;
  /** Base Y position. Default 0.58 */
  y?: number;
  /** Lower plate size [w, h, d]. Default [0.20, 0.09, 0.24] */
  baseSize?: [number, number, number];
  /** Upper plate size [w, h, d]. Default [0.16, 0.06, 0.20] */
  topSize?: [number, number, number];
  /** Lower plate color */
  baseColor: number;
  /** Upper plate color (highlight) */
  topColor: number;
  /** Gap between base and top. Default 0.06 */
  gap?: number;
}

export function addPauldrons(group: THREE.Group, opts: PauldronOpts): void {
  const ox = opts.offsetX ?? 0.32;
  const y = opts.y ?? 0.58;
  const bs = opts.baseSize ?? [0.20, 0.09, 0.24];
  const ts = opts.topSize ?? [0.16, 0.06, 0.20];
  const gap = opts.gap ?? 0.06;

  const baseMat = getCachedLambert(opts.baseColor);
  const topMat = getCachedLambert(opts.topColor);

  for (const px of [-ox, ox]) {
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(bs[0], bs[1], bs[2]), baseMat);
    p1.position.set(px, y, 0);
    group.add(p1);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(ts[0], ts[1], ts[2]), topMat);
    p2.position.set(px, y + gap, 0);
    group.add(p2);
  }
}

// ─── Head Block ──────────────────────────────────────────────

export function addHead(
  group: THREE.Group,
  y: number = 0.85,
  size: [number, number, number] = [0.30, 0.30, 0.30],
  color: number = SKIN,
): THREE.Mesh {
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    getCachedLambert(color),
  );
  head.position.set(0, y, 0);
  head.name = 'head';
  group.add(head);
  return head;
}

// ─── Torso / Breastplate ─────────────────────────────────────

export function addTorso(
  group: THREE.Group,
  y: number, z: number,
  size: [number, number, number],
  color: number,
  name?: string,
): THREE.Mesh {
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    getCachedLambert(color),
  );
  torso.position.set(0, y, z);
  if (name) torso.name = name;
  group.add(torso);
  return torso;
}

// ─── Generic Symmetric Pair ──────────────────────────────────

/**
 * Add a mirrored pair of meshes at ±offsetX.
 * Useful for rivets, side plates, pouches, etc.
 */
export function addMirroredPair(
  group: THREE.Group,
  offsetX: number, y: number, z: number,
  size: [number, number, number],
  color: number,
): void {
  const mat = getCachedLambert(color);
  for (const px of [-offsetX, offsetX]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(px, y, z);
    group.add(mesh);
  }
}
