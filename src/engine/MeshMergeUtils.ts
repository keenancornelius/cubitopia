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
  return mergeGroupMeshes(group, /* skipAnimated */ true);
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
