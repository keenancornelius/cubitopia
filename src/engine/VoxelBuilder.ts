// ============================================
// CUBITOPIA - Chunked Voxel Mesh Builder
// Uses per-chunk instanced meshes for performance.
// Only dirty chunks are rebuilt when terrain changes.
//
// Draw-call optimization: blocks are grouped into
// material categories (opaque / water / gem) so each
// chunk produces at most 3 InstancedMeshes instead of
// one per BlockType.
// ============================================

import * as THREE from 'three';
import { BlockType, VoxelBlock, GridPosition, GameMap } from '../types';
import { Logger } from './Logger';

// Vibrant color palette inspired by Polytopia/Minecraft aesthetic
const BLOCK_COLORS: Record<BlockType, number> = {
  [BlockType.GRASS]: 0x5cb85c,
  [BlockType.DIRT]:  0x8b6e4e,
  [BlockType.STONE]: 0x8a8278,
  [BlockType.WATER]: 0x3498db,
  [BlockType.SAND]:  0xe8c872,
  [BlockType.SNOW]:  0xeef4fa,
  [BlockType.WOOD]:  0x6d4c41,
  [BlockType.IRON]:  0x9aabb8,
  [BlockType.GOLD]:  0xffc107,
  [BlockType.WALL]:  0xd4a373,
  [BlockType.JUNGLE]: 0x2d6b30,
  [BlockType.CLAY]:   0xc2703e,
  [BlockType.CRYSTAL]: 0x88cfef,
  [BlockType.GEM_RUBY]:     0x6b3040,
  [BlockType.GEM_EMERALD]:  0x2a5a3a,
  [BlockType.GEM_SAPPHIRE]: 0x2a3a6b,
  [BlockType.GEM_AMETHYST]: 0x4a2a6b,
  // Skyland pastel palette
  [BlockType.CLOUD]:          0xf0f0ff,  // soft white-blue cloud
  [BlockType.PASTEL_GRASS]:   0x98fb98,  // pale green (mint)
  [BlockType.RAINBOW_BRIDGE]: 0xffb6c1,  // base pink (overridden with position-based rainbow)
  [BlockType.CREAM_STONE]:    0xffefd5,  // warm cream papaya whip
  // Volcanic palette
  [BlockType.BASALT]:         0x2a2a2e,  // very dark charcoal grey
  [BlockType.OBSIDIAN]:       0x0d0d12,  // near-black with purple tint
  [BlockType.ASH]:            0x6b6b6b,  // medium grey ash
  [BlockType.LAVA]:           0xff4400,  // bright orange-red molten
  [BlockType.MAGMA]:          0x3a1a0a,  // dark brown-red with glow
  [BlockType.SCORCHED_EARTH]: 0x5a3020,  // burnt reddish-brown
  // Archipelago palette
  [BlockType.CORAL]:           0xff6b8a,  // vibrant coral pink
  [BlockType.TROPICAL_GRASS]:  0x3cb043,  // bright tropical green
  [BlockType.PALM_WOOD]:       0xc4956a,  // warm tan wood
  // Tundra palette
  [BlockType.ICE]:             0xb8e0f0,  // translucent pale blue ice
  [BlockType.FROZEN_DIRT]:     0x6b6860,  // grey-brown permafrost
  [BlockType.PACKED_SNOW]:     0xdce8f0,  // bluish-white compacted snow
  [BlockType.PINE_WOOD]:       0x3a2820,  // dark brown pine wood
  // Sunken Ruins palette
  [BlockType.MOSSY_STONE]:   0x5a7a5a,  // grey-green mossy stone
  [BlockType.ANCIENT_BRICK]: 0xa08860,  // weathered tan brick
  [BlockType.VINE]:          0x2d5a1e,  // dark green vine
  [BlockType.RUIN_PILLAR]:   0xb0a898,  // pale grey carved stone
  // Badlands palette
  [BlockType.RED_CLAY]:      0xb5472a,  // deep red-orange clay
  [BlockType.CRACKED_EARTH]: 0xc4a060,  // dry tan cracked ground
  [BlockType.MESA_STONE]:    0xc46830,  // layered orange-red rock
  [BlockType.DEAD_WOOD]:     0xb8b0a0,  // bleached grey dead wood
};

/** Gem types get special bright sparkle colors overlaid on their dark stone base */
const GEM_SPARKLE_COLORS: Partial<Record<BlockType, number[]>> = {
  [BlockType.GEM_RUBY]:     [0xff1744, 0xff5252, 0xffcdd2],
  [BlockType.GEM_EMERALD]:  [0x00e676, 0x69f0ae, 0xb9f6ca],
  [BlockType.GEM_SAPPHIRE]: [0x2979ff, 0x448aff, 0xbbdefb],
  [BlockType.GEM_AMETHYST]: [0xd500f9, 0xea80fc, 0xf3e5f5],
};

// Slightly oversized to seal hairline gaps between adjacent tiles
export const VOXEL_SIZE = 0.52;

/** Chunk size in hex tiles (each chunk is CHUNK_SIZE×CHUNK_SIZE tiles) */
const CHUNK_SIZE = 8;

// ── Material categories ───────────────────────────────────────────
// All opaque non-emissive blocks share one mesh; water (transparent)
// and gems (emissive) each get their own.
type MatCategory = 'opaque' | 'water' | 'gem';

const GEM_TYPES = new Set<BlockType>([
  BlockType.GEM_RUBY, BlockType.GEM_EMERALD,
  BlockType.GEM_SAPPHIRE, BlockType.GEM_AMETHYST,
]);

function blockCategory(type: BlockType): MatCategory {
  if (type === BlockType.WATER || type === BlockType.LAVA) return 'water';
  if (GEM_TYPES.has(type)) return 'gem';
  return 'opaque';
}

// Simple seeded hash for deterministic color variation
function colorHash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

/** Convert hex tile coordinate to chunk key */
function tileToChunkKey(q: number, r: number): string {
  const cx = Math.floor(q / CHUNK_SIZE);
  const cr = Math.floor(r / CHUNK_SIZE);
  return `${cx},${cr}`;
}

/** Info returned when a raycast hits a specific voxel block */
export interface VoxelHitInfo {
  tileKey: string;       // "q,r"
  blockIndex: number;    // index into tile.voxelData.blocks
  blockType: BlockType;
  worldPosition: THREE.Vector3;
  faceNormal: THREE.Vector3;
}

/** Lookup entry stored per instance slot */
interface InstanceLookup {
  tileKey: string;
  blockIndex: number;
  blockType: BlockType;
}

/** Per-chunk data: one mesh per material category + lookup tables */
interface ChunkData {
  group: THREE.Group;
  meshes: Map<MatCategory, THREE.InstancedMesh>;
  counts: Map<MatCategory, number>;
  lookup: Map<MatCategory, InstanceLookup[]>;
}

/** Compute per-instance color for a block at the given position */
function computeBlockColor(type: BlockType, position: GridPosition): THREE.Color {
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
    case BlockType.GRASS:
      hueShift = (hash - 0.5) * 0.08;
      satShift = (hash2 - 0.5) * 0.15;
      lightShift = (hash - 0.5) * 0.18;
      break;
    case BlockType.SAND:
      hueShift = (hash - 0.5) * 0.05;
      satShift = (hash2 - 0.5) * 0.2;
      lightShift = (hash - 0.5) * 0.14;
      break;
    case BlockType.STONE:
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.16;
      break;
    case BlockType.DIRT:
      hueShift = (hash - 0.5) * 0.06;
      satShift = (hash2 - 0.5) * 0.12;
      lightShift = (hash - 0.5) * 0.15;
      break;
    case BlockType.SNOW:
      hueShift = (hash - 0.5) * 0.03;
      satShift = (hash2 - 0.5) * 0.08;
      lightShift = (hash - 0.5) * 0.06;
      break;
    case BlockType.WATER:
      hueShift = (hash - 0.5) * 0.06;
      satShift = (hash2 - 0.5) * 0.15;
      lightShift = (hash - 0.5) * 0.12;
      break;
    case BlockType.RAINBOW_BRIDGE: {
      // Position-based rainbow: hue cycles across world XZ position
      const rainbowHue = ((position.x + position.z) * 0.15 + hash * 0.08) % 1.0;
      base.setHSL(rainbowHue, 0.65, 0.72 + hash * 0.08);
      return base; // skip normal HSL offset
    }
    case BlockType.PASTEL_GRASS:
      // Soft pastel variation: green-pink-lavender
      hueShift = (hash - 0.5) * 0.15;  // wider hue range for pastel variety
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.08;
      break;
    case BlockType.CLOUD:
      // Very subtle white-pink-blue shimmer
      hueShift = (hash - 0.5) * 0.06;
      satShift = -0.02 + hash2 * 0.06;
      lightShift = (hash - 0.5) * 0.04;
      break;
    case BlockType.CREAM_STONE:
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.08;
      lightShift = (hash - 0.5) * 0.06;
      break;
    case BlockType.BASALT:
      // Dark volcanic rock with subtle blue-grey variation
      hueShift = (hash - 0.5) * 0.03;
      satShift = (hash2 - 0.5) * 0.06;
      lightShift = (hash - 0.5) * 0.08;
      break;
    case BlockType.OBSIDIAN:
      // Near-black with faint purple/blue shimmer
      hueShift = (hash - 0.5) * 0.06;
      satShift = hash2 * 0.15;
      lightShift = hash * 0.04;
      break;
    case BlockType.ASH:
      // Grey ash with slight warm/cool variation
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.05;
      lightShift = (hash - 0.5) * 0.12;
      break;
    case BlockType.LAVA: {
      // Pulsing orange-red-yellow molten effect
      const lavaHue = 0.03 + hash * 0.06; // orange to red range
      base.setHSL(lavaHue, 0.95, 0.45 + hash2 * 0.15);
      return base;
    }
    case BlockType.MAGMA:
      // Dark rock with random bright orange cracks
      if (hash < 0.3) {
        base.set(0xff6600); // glowing crack
        lightShift = hash2 * 0.1;
      } else {
        hueShift = (hash - 0.5) * 0.02;
        lightShift = (hash - 0.5) * 0.06;
      }
      break;
    case BlockType.SCORCHED_EARTH:
      // Burnt terrain with red-brown variation
      hueShift = (hash - 0.5) * 0.06;
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.12;
      break;
    case BlockType.CORAL: {
      // Vibrant coral — wide hue shift between pink, orange, purple
      const coralHue = 0.92 + hash * 0.16; // wraps from pink to orange
      base.setHSL(coralHue % 1.0, 0.7 + hash2 * 0.2, 0.55 + hash * 0.1);
      return base;
    }
    case BlockType.TROPICAL_GRASS:
      // Rich bright green with warm-cool variation
      hueShift = (hash - 0.5) * 0.08;
      satShift = (hash2 - 0.5) * 0.12;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.PALM_WOOD:
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.08;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.ICE:
      // Icy blue-white with subtle shimmer variation
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.15;
      lightShift = (hash - 0.5) * 0.08;
      break;
    case BlockType.FROZEN_DIRT:
      // Grey-brown permafrost with cold variation
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.06;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.PACKED_SNOW:
      // Bluish compacted snow — subtle blue/white shifts
      hueShift = (hash - 0.5) * 0.03;
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.06;
      break;
    case BlockType.PINE_WOOD:
      hueShift = (hash - 0.5) * 0.03;
      satShift = (hash2 - 0.5) * 0.06;
      lightShift = (hash - 0.5) * 0.08;
      break;
    case BlockType.MOSSY_STONE:
      // Green-grey with mossy patches
      hueShift = (hash - 0.5) * 0.06;
      satShift = (hash2 - 0.5) * 0.15;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.ANCIENT_BRICK:
      // Weathered brick with warm variation
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.08;
      lightShift = (hash - 0.5) * 0.12;
      break;
    case BlockType.VINE:
      hueShift = (hash - 0.5) * 0.05;
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.08;
      break;
    case BlockType.RUIN_PILLAR:
      hueShift = (hash - 0.5) * 0.02;
      satShift = (hash2 - 0.5) * 0.04;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.RED_CLAY:
      // Deep red-orange with warm shifts
      hueShift = (hash - 0.5) * 0.06;
      satShift = (hash2 - 0.5) * 0.12;
      lightShift = (hash - 0.5) * 0.1;
      break;
    case BlockType.CRACKED_EARTH:
      // Dry ground with tan-brown variation
      hueShift = (hash - 0.5) * 0.04;
      satShift = (hash2 - 0.5) * 0.08;
      lightShift = (hash - 0.5) * 0.14;
      break;
    case BlockType.MESA_STONE:
      // Layered sedimentary with band variation
      hueShift = (hash - 0.5) * 0.05;
      satShift = (hash2 - 0.5) * 0.1;
      lightShift = (hash - 0.5) * 0.12;
      break;
    case BlockType.DEAD_WOOD:
      hueShift = (hash - 0.5) * 0.02;
      satShift = (hash2 - 0.5) * 0.04;
      lightShift = (hash - 0.5) * 0.06;
      break;
    default: {
      const sparkleColors = GEM_SPARKLE_COLORS[type];
      if (sparkleColors) {
        const sparkleChance = hash;
        if (sparkleChance < 0.35) {
          const colorIdx = Math.floor(hash2 * sparkleColors.length) % sparkleColors.length;
          base.set(sparkleColors[colorIdx]);
          lightShift = hash * 0.15;
        } else {
          hueShift = (hash - 0.5) * 0.03;
          satShift = (hash2 - 0.5) * 0.06;
          lightShift = (hash - 0.5) * 0.08;
        }
      } else {
        hueShift = (hash - 0.5) * 0.04;
        satShift = (hash2 - 0.5) * 0.1;
        lightShift = (hash - 0.5) * 0.1;
      }
      break;
    }
  }

  const heightDarken = Math.max(-0.08, Math.min(0, (position.y - 5) * -0.005));
  base.offsetHSL(hueShift, satShift, lightShift + heightDarken);
  return base;
}

export class VoxelBuilder {
  private geometry: THREE.BoxGeometry;
  private scene: THREE.Scene;
  private maxInstancesPerChunk: number;

  /** Shared materials — one per category */
  private opaqueMat: THREE.MeshLambertMaterial;
  private waterMat: THREE.MeshLambertMaterial;
  private gemMat: THREE.MeshLambertMaterial;

  /** Temp color used to tint instance colors by base block color */
  private readonly _tintColor = new THREE.Color();

  /** Per-chunk data keyed by "cx,cr" */
  private chunks: Map<string, ChunkData> = new Map();
  /** Set of chunk keys that need rebuilding */
  private dirtyChunks: Set<string> = new Set();

  /** Clipping plane for Y-level slicer */
  private clipPlane: THREE.Plane;
  /** Current slice Y level (null = no slicing) */
  private sliceY: number | null = null;

  constructor(scene: THREE.Scene, maxInstancesPerType: number = 300000) {
    this.scene = scene;
    // With merged materials, a single opaque mesh holds ALL block types in the chunk.
    // Mountainous 8×8 chunks can have 4000+ blocks; allow up to 16k per mesh.
    this.maxInstancesPerChunk = Math.min(16000, Math.ceil(maxInstancesPerType / 10));
    this.geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 999);

    // Opaque: white base, tinted per-instance via vertex colors
    this.opaqueMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Water: transparent blue base, tinted per-instance
    this.waterMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
    });

    // Gems: white base + emissive glow, colored per-instance
    this.gemMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x8040c0),
      emissiveIntensity: 0.6,
    });
  }

  // ── Slicing ──────────────────────────────────────────────────────

  setSliceY(y: number | null): void {
    this.sliceY = y;
    const allMats = [this.opaqueMat, this.waterMat, this.gemMat];
    if (y === null) {
      this.clipPlane.constant = 999;
      for (const mat of allMats) mat.clippingPlanes = null;
    } else {
      this.clipPlane.constant = (y + 1) * VOXEL_SIZE;
      for (const mat of allMats) mat.clippingPlanes = [this.clipPlane];
    }
  }

  getSliceY(): number | null { return this.sliceY; }
  getClipPlane(): THREE.Plane { return this.clipPlane; }

  /** Get the material for a category */
  private getMaterial(cat: MatCategory): THREE.MeshLambertMaterial {
    if (cat === 'water') return this.waterMat;
    if (cat === 'gem') return this.gemMat;
    return this.opaqueMat;
  }

  // ── Chunk lifecycle ──────────────────────────────────────────────

  /** Create or get a chunk's data structure */
  private getOrCreateChunk(chunkKey: string): ChunkData {
    let chunk = this.chunks.get(chunkKey);
    if (chunk) return chunk;

    const group = new THREE.Group();
    group.name = `voxel-chunk-${chunkKey}`;
    this.scene.add(group);

    chunk = {
      group,
      meshes: new Map(),
      counts: new Map(),
      lookup: new Map(),
    };
    this.chunks.set(chunkKey, chunk);
    return chunk;
  }

  /** Dispose and remove a chunk's meshes from the scene */
  private disposeChunk(chunkKey: string): void {
    const chunk = this.chunks.get(chunkKey);
    if (!chunk) return;

    for (const mesh of chunk.meshes.values()) {
      chunk.group.remove(mesh);
      mesh.dispose();
    }
    chunk.meshes.clear();
    chunk.counts.clear();
    chunk.lookup.clear();
  }

  /** Fully rebuild a single chunk's meshes from the map */
  private buildChunkFromMap(chunkKey: string, map: GameMap): void {
    // 1. Dispose old meshes for this chunk
    this.disposeChunk(chunkKey);
    const chunk = this.getOrCreateChunk(chunkKey);

    // 2. Parse chunk coordinates
    const [cx, cr] = chunkKey.split(',').map(Number);
    const qMin = cx * CHUNK_SIZE;
    const qMax = qMin + CHUNK_SIZE;
    const rMin = cr * CHUNK_SIZE;
    const rMax = rMin + CHUNK_SIZE;

    // 3. First pass: count blocks per material category
    const catCounts = new Map<MatCategory, number>();
    for (let q = qMin; q < qMax; q++) {
      for (let r = rMin; r < rMax; r++) {
        const tile = map.tiles.get(`${q},${r}`);
        if (!tile) continue;
        for (const block of tile.voxelData.blocks) {
          const cat = blockCategory(block.type);
          catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
        }
      }
    }

    // 4. Create right-sized InstancedMeshes per category
    for (const [cat, count] of catCounts) {
      if (count === 0) continue;
      const material = this.getMaterial(cat);

      // Allocate with 50% headroom — pit walls from neighbor chunks can add many blocks
      const capacity = Math.min(Math.ceil(count * 1.5), this.maxInstancesPerChunk);
      const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      chunk.group.add(mesh);
      chunk.meshes.set(cat, mesh);
      chunk.counts.set(cat, 0);
      chunk.lookup.set(cat, []);
    }

    // 5. Second pass: populate instances
    const matrix = new THREE.Matrix4();
    for (let q = qMin; q < qMax; q++) {
      for (let r = rMin; r < rMax; r++) {
        const tileKey = `${q},${r}`;
        const tile = map.tiles.get(tileKey);
        if (!tile) continue;

        const worldX = q * 1.5;
        const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);

        for (let i = 0; i < tile.voxelData.blocks.length; i++) {
          const block = tile.voxelData.blocks[i];
          const cat = blockCategory(block.type);
          const mesh = chunk.meshes.get(cat);
          if (!mesh) continue;

          const count = chunk.counts.get(cat) || 0;
          if (count >= mesh.instanceMatrix.array.length / 16) continue; // safety

          const pos: GridPosition = {
            x: worldX + block.localPosition.x,
            y: block.localPosition.y,
            z: worldZ + block.localPosition.z,
          };
          matrix.setPosition(pos.x, pos.y * VOXEL_SIZE, pos.z);
          mesh.setMatrixAt(count, matrix);

          const color = computeBlockColor(block.type, pos);
          // Multiply by base block color to match old per-material tinting
          // (old system: GPU multiplied material.color × instanceColor in shader)
          this._tintColor.set(BLOCK_COLORS[block.type]);
          color.multiply(this._tintColor);
          mesh.setColorAt(count, color);

          // Record lookup with blockType for raycast
          const lookup = chunk.lookup.get(cat)!;
          lookup[count] = { tileKey, blockIndex: i, blockType: block.type };

          chunk.counts.set(cat, count + 1);
        }
      }
    }

    // 6. Finalize mesh counts and flag updates
    for (const [cat, mesh] of chunk.meshes) {
      mesh.count = chunk.counts.get(cat) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  // ── Public API: dirty flagging ───────────────────────────────────

  /**
   * Mark the chunk containing a tile as dirty (needs rebuild).
   * Also marks immediate neighbor chunks to handle pit wall seams.
   */
  markTileDirty(tileKey: string): void {
    const [q, r] = tileKey.split(',').map(Number);
    const chunkKey = tileToChunkKey(q, r);
    this.dirtyChunks.add(chunkKey);

    // If tile is on a chunk edge, mark neighbor chunks too
    const localQ = ((q % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localR = ((r % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const cx = Math.floor(q / CHUNK_SIZE);
    const cr = Math.floor(r / CHUNK_SIZE);

    if (localQ === 0)              this.dirtyChunks.add(`${cx - 1},${cr}`);
    if (localQ === CHUNK_SIZE - 1) this.dirtyChunks.add(`${cx + 1},${cr}`);
    if (localR === 0)              this.dirtyChunks.add(`${cx},${cr - 1}`);
    if (localR === CHUNK_SIZE - 1) this.dirtyChunks.add(`${cx},${cr + 1}`);
  }

  /** Check if any chunks need rebuilding */
  hasDirtyChunks(): boolean {
    return this.dirtyChunks.size > 0;
  }

  /**
   * Rebuild all dirty chunks. Call this once per frame from the game loop.
   * Only rebuilds chunks that were marked dirty since the last flush.
   */
  flushDirtyChunks(map: GameMap): void {
    if (this.dirtyChunks.size === 0) return;

    for (const chunkKey of this.dirtyChunks) {
      this.buildChunkFromMap(chunkKey, map);
    }
    this.dirtyChunks.clear();
  }

  // ── Public API: full rebuild (backward compatible) ───────────────

  /**
   * Rebuild all voxels from the current map state.
   * This is the legacy full-rebuild path — used at map init and for debug.
   */
  rebuildFromMap(map: GameMap): void {
    // Determine which chunks have tiles
    const chunkKeys = new Set<string>();
    map.tiles.forEach((_, key) => {
      const [q, r] = key.split(',').map(Number);
      chunkKeys.add(tileToChunkKey(q, r));
    });

    // Dispose chunks that no longer have tiles
    for (const existingKey of this.chunks.keys()) {
      if (!chunkKeys.has(existingKey)) {
        this.disposeChunk(existingKey);
        this.scene.remove(this.chunks.get(existingKey)!.group);
        this.chunks.delete(existingKey);
      }
    }

    // Build all chunks
    for (const chunkKey of chunkKeys) {
      this.buildChunkFromMap(chunkKey, map);
    }
    this.dirtyChunks.clear();
  }

  /**
   * Clear all voxel instances (for map regeneration).
   */
  clearAll(): void {
    for (const [_key, chunk] of this.chunks) {
      for (const mesh of chunk.meshes.values()) {
        chunk.group.remove(mesh);
        mesh.dispose();
      }
      this.scene.remove(chunk.group);
    }
    this.chunks.clear();
    this.dirtyChunks.clear();
  }

  // ── Legacy API: addBlock (used during initial map setup) ─────────

  /**
   * Add a single block. Used by MapGenerator during initial terrain setup.
   * NOTE: For incremental changes, prefer markTileDirty + flushDirtyChunks.
   */
  addBlock(position: GridPosition, type: BlockType): void {
    const approxQ = Math.round(position.x / 1.5);
    const approxR = Math.round((position.z - (approxQ % 2 === 1 ? 0.75 : 0)) / 1.5);
    const chunkKey = tileToChunkKey(approxQ, approxR);
    const chunk = this.getOrCreateChunk(chunkKey);

    const cat = blockCategory(type);
    let mesh = chunk.meshes.get(cat);
    if (!mesh) {
      const material = this.getMaterial(cat);
      mesh = new THREE.InstancedMesh(this.geometry, material, this.maxInstancesPerChunk);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      chunk.group.add(mesh);
      chunk.meshes.set(cat, mesh);
      chunk.counts.set(cat, 0);
      chunk.lookup.set(cat, []);
    }

    const count = chunk.counts.get(cat) || 0;
    if (count >= this.maxInstancesPerChunk) return;

    const matrix = new THREE.Matrix4();
    matrix.setPosition(position.x, position.y * VOXEL_SIZE, position.z);
    mesh.setMatrixAt(count, matrix);

    const color = computeBlockColor(type, position);
    // Multiply by base block color to match old per-material tinting
    this._tintColor.set(BLOCK_COLORS[type]);
    color.multiply(this._tintColor);
    mesh.setColorAt(count, color);

    mesh.count = count + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    chunk.counts.set(cat, count + 1);
  }

  /**
   * Build a chunk of voxels from block data (legacy API used by MapGenerator).
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

  // ── Legacy API: removeBlock ──────────────────────────────────────

  removeBlock(_position: GridPosition, _type: BlockType): void {
    Logger.warn('VoxelBuilder', 'Block removal — use markTileDirty + flushDirtyChunks instead');
  }

  // ── Raycast ──────────────────────────────────────────────────────

  /**
   * Raycast against all voxel meshes across all chunks.
   * Returns info about the closest hit block, or null.
   */
  raycastBlock(raycaster: THREE.Raycaster): VoxelHitInfo | null {
    let bestDist = Infinity;
    let bestHit: VoxelHitInfo | null = null;

    for (const chunk of this.chunks.values()) {
      for (const [_cat, mesh] of chunk.meshes) {
        if (mesh.count === 0) continue;
        const intersects = raycaster.intersectObject(mesh, false);
        for (const hit of intersects) {
          if (hit.distance >= bestDist) break; // sorted by distance
          if (hit.instanceId === undefined) continue;
          const lookup = chunk.lookup.get(_cat);
          if (!lookup || !lookup[hit.instanceId]) continue;

          const { tileKey, blockIndex, blockType } = lookup[hit.instanceId];

          // If slicer is active, skip blocks above the slice Y level
          if (this.sliceY !== null) {
            const blockWorldY = hit.point.y / VOXEL_SIZE;
            if (blockWorldY > this.sliceY + 0.5) continue;
          }

          const worldNormal = hit.face
            ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
            : new THREE.Vector3(0, 1, 0);

          bestDist = hit.distance;
          bestHit = {
            tileKey,
            blockIndex,
            blockType,
            worldPosition: hit.point.clone(),
            faceNormal: worldNormal,
          };
          break; // first (closest) hit for this mesh type
        }
      }
    }

    return bestHit;
  }

  /** Get all instanced meshes across all chunks (backward-compat shim) */
  getInstancedMeshes(): Map<BlockType, THREE.InstancedMesh> {
    // NOTE: With merged materials, this returns the opaque mesh mapped to GRASS
    // as a placeholder. External code should use raycastBlock() instead.
    const result = new Map<BlockType, THREE.InstancedMesh>();
    for (const chunk of this.chunks.values()) {
      const opaque = chunk.meshes.get('opaque');
      if (opaque && !result.has(BlockType.GRASS)) {
        result.set(BlockType.GRASS, opaque);
      }
    }
    return result;
  }

  // ── Dispose ──────────────────────────────────────────────────────

  dispose(): void {
    this.clearAll();
    this.geometry.dispose();
    this.opaqueMat.dispose();
    this.waterMat.dispose();
    this.gemMat.dispose();
  }
}
