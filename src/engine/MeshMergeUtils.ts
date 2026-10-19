/**
 * Shared mesh-merge utilities — used by both UnitModels (unit meshes)
 * and BuildingSystem (building meshes) to reduce draw calls by merging
 * static geometry by material color.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ═══════════════════════════════════════════════════════════
// GLOBAL MATERIAL CACHE — shared across all units/buildings
// to reduce GPU state switches. Keyed by hex color integer.
// ═══════════════════════════════════════════════════════════
const materialCache = new Map<number, THREE.MeshLambertMaterial>();
const basicMaterialCache = new Map<number, THREE.MeshBasicMaterial>();

export function getCachedLambert(color: number): THREE.MeshLambertMaterial {
  let mat = materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color });
    materialCache.set(color, mat);
  }
  return mat;
}

export function getCachedBasic(color: number): THREE.MeshBasicMaterial {
  let mat = basicMaterialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color });
    basicMaterialCache.set(color, mat);
  }
  return mat;
}

// ═══════════════════════════════════════════════════════════
// ANIMATED NAME DETECTION — for unit meshes only
// ═══════════════════════════════════════════════════════════

/** Names of groups/objects that are animated and must NOT be merged */
const ANIMATED_NAMES = new Set([
  'arm-left', 'arm-right', 'leg-left', 'leg-right',
  'leg-back-left', 'leg-back-right',
  'throw-arm',
  'wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br',
  // Healer aura
  'heal-crystal', 'heal-crystal-glow', 'heal-palm-orb', 'heal-palm-glow',
  // Paladin aura
  'paladin-halo', 'paladin-aura-ring',
  // Battlemage aura
  'battlemage-orb', 'bm-orb-glow', 'bm-palm-rune', 'bm-circlet-gem',
  'bm-buckle-gem', 'bm-ground-aura',
  // Dynamic
  'carry-wood', 'bowstring', 'nocked-arrow',
]);

/** Check if a name matches animated pattern */
export function isAnimatedName(name: string): boolean {
  if (!name) return false;
  if (ANIMATED_NAMES.has(name)) return true;
  if (name.includes('-mote-')) return true;
  return false;
}

/** Check if a mesh or any of its ancestors is an animated group */
export function hasAnimatedAncestor(obj: THREE.Object3D, root: THREE.Group): boolean {
  let current: THREE.Object3D | null = obj;
  while (current && current !== root) {
    if (current.name && isAnimatedName(current.name)) return true;
    current = current.parent;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// MERGE FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Merge static (non-animated) meshes in a unit group by material color.
 * Animated parts (arms, legs, wheels, auras) are kept separate.
 */
export function mergeStaticMeshes(group: THREE.Group): number {
  return mergeGroupMeshes(group, /* skipAnimated */ true) + mergeAnimatedPartChildren(group);
}

/**
 * Mesh names that code looks up (getObjectByName / name tests in UnitAnimations,
 * UnitVFX, UnitRenderer, ProjectileSystem). Meshes matching these stay separate.
 * Purely descriptive names ("leg-left-shin", "arm-right-upper") may be merged.
 */
const PROTECTED_MESH_NAME = /(hand|mote|eye|pupil|helm|head|plume|crest|visor|crown|rune|sparkle|badge|ring|orb|glow|gem|aura|halo|crystal|arrow|bowstring|carry|wood)/i;

/** Shared white Lambert that takes its colour from per-vertex colours */
let vertexColorLambert: THREE.MeshLambertMaterial | null = null;
function getVertexColorLambert(): THREE.MeshLambertMaterial {
  if (!vertexColorLambert) vertexColorLambert = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  return vertexColorLambert;
}

/** A plain opaque, non-emissive, single-sided Lambert part that can be colour-baked. */
function isPlainLambert(mesh: THREE.Mesh): boolean {
  const mat = mesh.material as THREE.MeshLambertMaterial;
  if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshLambertMaterial)) return false;
  if (mat.vertexColors || mat.map || mat.transparent || mat.opacity < 1 || mat.side !== THREE.FrontSide) return false;
  if (mat.emissive && mat.emissive.getHex() > 0 && mat.emissiveIntensity > 0) return false;
  return true;
}

/**
 * Bake each mesh's material colour into vertex colours and merge them into ONE mesh
 * (in `container`'s local space). Different colours no longer cost separate draw
 * calls. Returns the number of meshes removed.
 */
function mergeVertexColored(container: THREE.Object3D, meshes: THREE.Mesh[], material?: THREE.Material): number {
  if (meshes.length < 2) return 0;
  container.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const src = m.geometry;
    if (!src.attributes.position || !src.attributes.normal) return 0;
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    g.morphAttributes = {};
    g.clearGroups();
    m.updateWorldMatrix(true, false);
    rel.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(rel);
    const c = (m.material as THREE.MeshLambertMaterial).color; // linear working space
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return 0;
  const mm = new THREE.Mesh(merged, material ?? getVertexColorLambert());
  mm.name = 'merged-vc';
  mm.castShadow = meshes.some(m => m.castShadow);
  mm.receiveShadow = meshes.some(m => m.receiveShadow);
  for (const m of meshes) { m.geometry.dispose(); m.parent?.remove(m); }
  container.add(mm);
  return meshes.length;
}

/**
 * Collapse a static wall/gate group (dozens of stone boxes, merlons, collars) into one
 * vertex-coloured mesh. The group gets its OWN material (not the shared one), because
 * WallSystem.applyDamageVisuals darkens/tints each wall's materials in place and
 * WallSystem.cleanup disposes them. Flags, flames and glows (double-sided, emissive,
 * transparent) stay separate. Returns the number of meshes removed.
 */
export function mergeDefenseGroup(group: THREE.Group): number {
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.children.length === 0 && isPlainLambert(m)) meshes.push(m);
  });
  if (meshes.length < 2) return 0;
  return mergeVertexColored(group, meshes, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
}

/**
 * Collapse a unit into a handful of draw calls:
 *  - static parts (anything not under an animated group) → one vertex-coloured mesh
 *  - inside every animated group (arms, elbows, legs, wheels, throw-arm...) its direct
 *    mesh children → one vertex-coloured mesh in that group's local space.
 * Animations rotate the groups (and the protected named meshes above), never these
 * children, so the merged result animates identically: ~50 → ~15 draw calls per unit.
 * Protected names, sprites, glows (emissive/basic/transparent) are left untouched.
 */
function mergeAnimatedPartChildren(root: THREE.Group): number {
  const canMerge = (m: THREE.Mesh) => !(m as any).isSprite && m.children.length === 0 && isPlainLambert(m)
    && !(m.name && m.name !== 'merged-vc' && !m.name.startsWith('merged-') && (PROTECTED_MESH_NAME.test(m.name) || isAnimatedName(m.name)));
  // Static parts (direct or nested, but not under an animated group)
  const staticMeshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === (root as unknown)) return;
    if (hasAnimatedAncestor(m, root)) return;
    if (canMerge(m)) staticMeshes.push(m);
  });
  let removed = mergeVertexColored(root, staticMeshes);
  // Animated groups: merge each group's direct children
  const targets: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj === root || (obj as THREE.Mesh).isMesh) return;
    if (hasAnimatedAncestor(obj, root)) targets.push(obj);
  });
  for (const parent of targets) {
    const kids = parent.children.filter(c => (c as THREE.Mesh).isMesh && canMerge(c as THREE.Mesh)) as THREE.Mesh[];
    removed += mergeVertexColored(parent, kids);
  }
  return removed;
}

/**
 * Merge ALL meshes in a group by material color.
 * Use for buildings and other fully-static objects with no animation.
 */
export function mergeAllMeshes(group: THREE.Group): number {
  return mergeGroupMeshes(group, /* skipAnimated */ false);
}

/**
 * Core merge implementation. Groups meshes by material color,
 * bakes world-relative transforms, and merges via BufferGeometryUtils.
 */
function mergeGroupMeshes(group: THREE.Group, skipAnimated: boolean): number {
  // Force matrix update on entire hierarchy (group may not be in scene yet)
  group.updateMatrixWorld(true);

  // Collect meshes grouped by material color hex
  const buckets = new Map<number, { meshes: THREE.Mesh[], material: THREE.Material }>();

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child instanceof THREE.Sprite) return;

    // Skip animated parts when merging unit meshes
    if (skipAnimated) {
      if (hasAnimatedAncestor(child, group)) return;
      if (child.name && isAnimatedName(child.name)) return;
    }

    const mat = child.material as THREE.Material;
    if (!mat || !(mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshBasicMaterial)) return;

    const colorHex = (mat as THREE.MeshLambertMaterial).color?.getHex() ?? 0;
    const isBasic = mat instanceof THREE.MeshBasicMaterial;
    // Use high bit to separate Lambert vs Basic materials
    const key = isBasic ? (colorHex | 0x1000000) : colorHex;

    // Also separate emissive materials (glow effects on buildings)
    const emissiveHex = (mat as THREE.MeshLambertMaterial).emissive?.getHex() ?? 0;
    const emissiveIntensity = (mat as THREE.MeshLambertMaterial).emissiveIntensity ?? 0;
    const emissiveKey = emissiveHex > 0 ? (emissiveHex ^ (Math.round(emissiveIntensity * 100) << 24)) : 0;
    const finalKey = key + emissiveKey * 0x2000000;

    let bucket = buckets.get(finalKey);
    if (!bucket) {
      bucket = { meshes: [], material: mat };
      buckets.set(finalKey, bucket);
    }
    bucket.meshes.push(child);
  });

  let removed = 0;

  for (const [key, bucket] of buckets) {
    if (bucket.meshes.length < 2) continue;

    const geos: THREE.BufferGeometry[] = [];
    for (const mesh of bucket.meshes) {
      const geo = mesh.geometry.clone();
      mesh.updateWorldMatrix(true, false);
      group.updateWorldMatrix(true, false);
      const relativeMatrix = new THREE.Matrix4();
      relativeMatrix.copy(group.matrixWorld).invert().multiply(mesh.matrixWorld);
      geo.applyMatrix4(relativeMatrix);
      geos.push(geo);
    }

    const merged = mergeGeometries(geos, false);
    if (!merged) {
      for (const g of geos) g.dispose();
      continue;
    }

    for (const g of geos) g.dispose();

    // Create merged mesh with cached material
    const colorHex = key & 0xFFFFFF;
    const isBasic = (key & 0x1000000) !== 0;
    const refMat = bucket.material as THREE.MeshLambertMaterial;

    let cachedMat: THREE.Material;
    // If the reference material has emissive properties, clone it for the cache
    if (refMat.emissive && refMat.emissive.getHex() > 0) {
      // Emissive (glow) materials — create unique material to preserve glow
      cachedMat = refMat;
    } else {
      cachedMat = isBasic ? getCachedBasic(colorHex) : getCachedLambert(colorHex);
    }

    const mergedMesh = new THREE.Mesh(merged, cachedMat);
    mergedMesh.name = `merged-${colorHex.toString(16)}`;

    // Remove originals
    for (const mesh of bucket.meshes) {
      mesh.geometry.dispose();
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
      removed++;
    }

    group.add(mergedMesh);
  }

  return removed;
}
