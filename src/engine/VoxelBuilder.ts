// ============================================
// CUBITOPIA - Voxel Mesh Builder
// Uses instanced meshes for performance
// ============================================

import * as THREE from 'three';
import { BlockType, VoxelBlock, GridPosition, GameMap } from '../types';

// Vibrant color palette inspired by Polytopia/Minecraft aesthetic
const BLOCK_COLORS: Record<BlockType, number> = {
  [BlockType.GRASS]: 0x5cb85c,  // slightly warmer, more saturated green
  [BlockType.DIRT]:  0x8b6e4e,  // warm brown
  [BlockType.STONE]: 0x8a8278,  // warm gray stone
  [BlockType.WATER]: 0x3498db,  // deeper blue
  [BlockType.SAND]:  0xe8c872,  // warmer golden sand
  [BlockType.SNOW]:  0xeef4fa,  // crisp white with very slight blue
  [BlockType.WOOD]:  0x6d4c41,
  [BlockType.IRON]:  0x9aabb8,  // slightly lighter iron
  [BlockType.GOLD]:  0xffc107,
  [BlockType.WALL]:  0xd4a373,  // warm brick/clay — distinct from terrain stone
  [BlockType.JUNGLE]: 0x2d6b30,  // dark rich jungle green
};

// Slightly oversized to seal hairline gaps between adjacent tiles
const VOXEL_SIZE = 0.52;

// Simple seeded hash for deterministic color variation
function colorHash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

/** Info returned when a raycast hits a specific voxel block */
export interface VoxelHitInfo {
  tileKey: string;       // "q,r"
  blockIndex: number;    // index into tile.voxelData.blocks
  blockType: BlockType;
  worldPosition: THREE.Vector3;
  faceNormal: THREE.Vector3;
}

export class VoxelBuilder {
  private geometry: THREE.BoxGeometry;
  private materials: Map<BlockType, THREE.MeshLambertMaterial>;
  private instancedMeshes: Map<BlockType, THREE.InstancedMesh>;
  private scene: THREE.Scene;
  private blockCounts: Map<BlockType, number>;
  private maxInstancesPerType: number;
  /** Reverse lookup: blockType → instanceId → { tileKey, blockIndex } */
  private instanceLookup: Map<BlockType, { tileKey: string; blockIndex: number }[]>;

  constructor(scene: THREE.Scene, maxInstancesPerType: number = 500000) {
    this.scene = scene;
    this.maxInstancesPerType = maxInstancesPerType;
    this.geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    this.materials = new Map();
    this.instancedMeshes = new Map();
    this.blockCounts = new Map();
    this.instanceLookup = new Map();

    this.initMaterials();
    this.initInstancedMeshes();
  }

  private initMaterials(): void {
    for (const [type, color] of Object.entries(BLOCK_COLORS)) {
      const material = new THREE.MeshLambertMaterial({
        color,
      });

      // Water gets transparency
      if (type === BlockType.WATER) {
        material.transparent = true;
        material.opacity = 0.6;
      }

      this.materials.set(type as BlockType, material);
    }
  }

  private initInstancedMeshes(): void {
    for (const [type, material] of this.materials.entries()) {
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        material,
        this.maxInstancesPerType
      );
      mesh.count = 0;  // start with 0 visible instances
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // Instances span the entire map — don't cull
      this.scene.add(mesh);
      this.instancedMeshes.set(type, mesh);
      this.blockCounts.set(type, 0);
    }
  }

  addBlock(position: GridPosition, type: BlockType): void {
    const mesh = this.instancedMeshes.get(type);
    if (!mesh) return;

    const count = this.blockCounts.get(type) || 0;
    if (count >= this.maxInstancesPerType) {
      console.warn(`Max instances reached for block type: ${type}`);
      return;
    }

    const matrix = new THREE.Matrix4();
    matrix.setPosition(
      position.x,
      position.y * VOXEL_SIZE,
      position.z
    );

    mesh.setMatrixAt(count, matrix);

    // Per-instance color variation for natural, painterly look
    const baseColor = BLOCK_COLORS[type];
    const base = new THREE.Color(baseColor);
    // Hash position for deterministic variation
    const hash = colorHash(
      Math.round(position.x * 100),
      Math.round(position.y * 100),
      Math.round(position.z * 100)
    );
    const hash2 = colorHash(
      Math.round(position.z * 100 + 7),
      Math.round(position.x * 100 + 13),
      Math.round(position.y * 100 + 31)
    );

    // Type-specific variation for more natural appearance
    let hueShift = 0;
    let satShift = 0;
    let lightShift = 0;

    switch (type) {
      case BlockType.GRASS:
        // Grass varies from yellow-green to blue-green with patchy brightness
        hueShift = (hash - 0.5) * 0.08;  // ±4% hue (yellow-green to blue-green)
        satShift = (hash2 - 0.5) * 0.15;  // ±7.5% saturation
        lightShift = (hash - 0.5) * 0.18; // ±9% brightness for patchy meadow look
        break;
      case BlockType.SAND:
        // Sand varies from pale yellow to warm tan
        hueShift = (hash - 0.5) * 0.05;
        satShift = (hash2 - 0.5) * 0.2;
        lightShift = (hash - 0.5) * 0.14;
        break;
      case BlockType.STONE:
        // Stone has subtle warm/cool gray variation
        hueShift = (hash - 0.5) * 0.04;
        satShift = (hash2 - 0.5) * 0.1;
        lightShift = (hash - 0.5) * 0.16;
        break;
      case BlockType.DIRT:
        // Dirt varies from reddish-brown to dark umber
        hueShift = (hash - 0.5) * 0.06;
        satShift = (hash2 - 0.5) * 0.12;
        lightShift = (hash - 0.5) * 0.15;
        break;
      case BlockType.SNOW:
        // Snow is mostly white with subtle blue/gray tint variation
        hueShift = (hash - 0.5) * 0.03;
        satShift = (hash2 - 0.5) * 0.08;
        lightShift = (hash - 0.5) * 0.06; // very subtle brightness
        break;
      case BlockType.WATER:
        // Water varies in depth/tone
        hueShift = (hash - 0.5) * 0.06;
        satShift = (hash2 - 0.5) * 0.15;
        lightShift = (hash - 0.5) * 0.12;
        break;
      default:
        // Other block types: moderate variation
        hueShift = (hash - 0.5) * 0.04;
        satShift = (hash2 - 0.5) * 0.1;
        lightShift = (hash - 0.5) * 0.1;
        break;
    }

    // Apply height-based darkening: lower blocks are slightly darker (depth shading)
    const heightDarken = Math.max(-0.08, Math.min(0, (position.y - 5) * -0.005));

    base.offsetHSL(hueShift, satShift, lightShift + heightDarken);
    mesh.setColorAt(count, base);

    mesh.count = count + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.blockCounts.set(type, count + 1);
  }

  /**
   * Build a chunk of voxels from block data
   */
  buildChunk(blocks: VoxelBlock[], worldOffset: GridPosition): void {
    for (const block of blocks) {
      this.addBlock(
        {
          x: block.localPosition.x + worldOffset.x,
          y: block.localPosition.y + worldOffset.y,
          z: block.localPosition.z + worldOffset.z,
        },
        block.type
      );
    }
  }

  /**
   * Clear all voxel instances (for map regeneration)
   */
  clearAll(): void {
    for (const [type, mesh] of this.instancedMeshes.entries()) {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
      this.blockCounts.set(type, 0);
      this.instanceLookup.set(type, []);
    }
  }

  /**
   * Remove a block at a specific position (for destruction)
   */
  removeBlock(_position: GridPosition, _type: BlockType): void {
    // TODO: Implement block removal with instanced mesh rebuild
    // For now, this requires rebuilding the instance buffer
    console.log('Block removal - rebuild required');
  }

  /**
   * Rebuild all voxels from the current map state (used after terrain destruction)
   */
  rebuildFromMap(map: GameMap): void {
    this.clearAll();
    map.tiles.forEach((tile, key) => {
      const [q, r] = key.split(',').map(Number);
      const worldX = q * 1.5;
      const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);

      for (let i = 0; i < tile.voxelData.blocks.length; i++) {
        const block = tile.voxelData.blocks[i];
        this.addBlockWithLookup(
          {
            x: worldX + block.localPosition.x,
            y: block.localPosition.y,
            z: worldZ + block.localPosition.z,
          },
          block.type,
          key,
          i,
        );
      }
    });
  }

  /** Same as addBlock but also records the tile/block mapping for raycast lookups */
  private addBlockWithLookup(position: GridPosition, type: BlockType, tileKey: string, blockIndex: number): void {
    const mesh = this.instancedMeshes.get(type);
    if (!mesh) return;

    const count = this.blockCounts.get(type) || 0;
    if (count >= this.maxInstancesPerType) return;

    const matrix = new THREE.Matrix4();
    matrix.setPosition(position.x, position.y * VOXEL_SIZE, position.z);
    mesh.setMatrixAt(count, matrix);

    // Per-instance color variation (same as addBlock)
    const baseColor = BLOCK_COLORS[type];
    const base = new THREE.Color(baseColor);
    const hash = colorHash(
      Math.round(position.x * 100),
      Math.round(position.y * 100),
      Math.round(position.z * 100)
    );
    const hash2 = colorHash(
      Math.round(position.z * 100 + 7),
      Math.round(position.x * 100 + 13),
      Math.round(position.y * 100 + 31)
    );

    let hueShift = 0, satShift = 0, lightShift = 0;
    switch (type) {
      case BlockType.GRASS: hueShift = (hash - 0.5) * 0.08; satShift = (hash2 - 0.5) * 0.15; lightShift = (hash - 0.5) * 0.18; break;
      case BlockType.SAND: hueShift = (hash - 0.5) * 0.05; satShift = (hash2 - 0.5) * 0.2; lightShift = (hash - 0.5) * 0.14; break;
      case BlockType.STONE: hueShift = (hash - 0.5) * 0.04; satShift = (hash2 - 0.5) * 0.1; lightShift = (hash - 0.5) * 0.16; break;
      case BlockType.DIRT: hueShift = (hash - 0.5) * 0.06; satShift = (hash2 - 0.5) * 0.12; lightShift = (hash - 0.5) * 0.15; break;
      case BlockType.SNOW: hueShift = (hash - 0.5) * 0.03; satShift = (hash2 - 0.5) * 0.08; lightShift = (hash - 0.5) * 0.06; break;
      case BlockType.WATER: hueShift = (hash - 0.5) * 0.06; satShift = (hash2 - 0.5) * 0.15; lightShift = (hash - 0.5) * 0.12; break;
      default: hueShift = (hash - 0.5) * 0.04; satShift = (hash2 - 0.5) * 0.1; lightShift = (hash - 0.5) * 0.1; break;
    }
    const heightDarken = Math.max(-0.08, Math.min(0, (position.y - 5) * -0.005));
    base.offsetHSL(hueShift, satShift, lightShift + heightDarken);
    mesh.setColorAt(count, base);

    mesh.count = count + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.blockCounts.set(type, count + 1);

    // Record lookup
    let lookup = this.instanceLookup.get(type);
    if (!lookup) { lookup = []; this.instanceLookup.set(type, lookup); }
    lookup[count] = { tileKey, blockIndex };
  }

  /**
   * Raycast against all instanced voxel meshes and return info about the hit block.
   * Returns null if no voxel block was hit.
   */
  raycastBlock(raycaster: THREE.Raycaster): VoxelHitInfo | null {
    let bestDist = Infinity;
    let bestHit: VoxelHitInfo | null = null;

    for (const [type, mesh] of this.instancedMeshes.entries()) {
      if (mesh.count === 0) continue;
      const intersects = raycaster.intersectObject(mesh, false);
      for (const hit of intersects) {
        if (hit.distance >= bestDist) break; // sorted by distance
        if (hit.instanceId === undefined) continue;
        const lookup = this.instanceLookup.get(type);
        if (!lookup || !lookup[hit.instanceId]) continue;

        const { tileKey, blockIndex } = lookup[hit.instanceId];
        const worldNormal = hit.face
          ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
          : new THREE.Vector3(0, 1, 0);

        bestDist = hit.distance;
        bestHit = {
          tileKey,
          blockIndex,
          blockType: type,
          worldPosition: hit.point.clone(),
          faceNormal: worldNormal,
        };
        break; // first (closest) hit for this mesh type
      }
    }

    return bestHit;
  }

  /** Get all instanced meshes (for external raycast usage) */
  getInstancedMeshes(): Map<BlockType, THREE.InstancedMesh> {
    return this.instancedMeshes;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    for (const mesh of this.instancedMeshes.values()) {
      this.scene.remove(mesh);
    }
  }
}
