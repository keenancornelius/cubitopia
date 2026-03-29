// ============================================
// CUBITOPIA - Map Presets & Arena Generator
// Data-driven map type configs + flat arena map generation
// ============================================

import {
  GameMap, Tile, HexCoord, TerrainType, BlockType, VoxelBlock,
  ResourceType, MapType, MapPreset,
} from '../types';

// --- Map Preset Definitions ---
export const MAP_PRESETS: MapPreset[] = [
  {
    type: MapType.STANDARD,
    label: 'STANDARD',
    description: 'Balanced terrain with mountains, rivers, and forests',
    size: 50,
    color: '#3498db',
  },
  {
    type: MapType.ARENA,
    label: 'ARENA',
    description: 'Flat combat arena — test units and watch armies clash',
    size: 30,
    color: '#e74c3c',
  },
  {
    type: MapType.HIGHLAND,
    label: 'HIGHLAND',
    description: 'Elevated terrain with steep ridges and narrow passes',
    size: 50,
    color: '#8e44ad',
  },
  {
    type: MapType.ARCHIPELAGO,
    label: 'ARCHIPELAGO',
    description: 'Scattered islands separated by water channels',
    size: 50,
    color: '#1abc9c',
  },
  {
    type: MapType.FLATLAND,
    label: 'FLATLAND',
    description: 'Wide open plains with sparse cover — fast aggression',
    size: 50,
    color: '#f39c12',
  },
];

export function getPreset(type: MapType): MapPreset {
  return MAP_PRESETS.find(p => p.type === type) || MAP_PRESETS[0];
}

// --- Arena Map Generator ---
// Flat hex grid, no resources, no terrain noise. Pure combat sandbox.

export function generateArenaMap(size: number, seed?: number): GameMap {
  const actualSeed = seed ?? Math.floor(Math.random() * 999999);
  const tiles = new Map<string, Tile>();
  const center = Math.floor(size / 2);

  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;
      const distFromCenter = Math.sqrt(
        (q - center) ** 2 + (r - center) ** 2
      );

      // Circular arena with sand border ring
      const arenaRadius = (size / 2) - 2;
      const borderRadius = (size / 2) - 1;

      let terrain: TerrainType;
      let elevation: number;

      if (distFromCenter > borderRadius) {
        // Outside arena — water moat
        terrain = TerrainType.WATER;
        elevation = -2;
      } else if (distFromCenter > arenaRadius) {
        // Border ring — sand/desert edge
        terrain = TerrainType.DESERT;
        elevation = 1;
      } else {
        // Arena floor — flat plains
        terrain = TerrainType.PLAINS;
        elevation = 0;

        // Small raised center platform (3-hex radius)
        if (distFromCenter <= 3) {
          elevation = 1;
        }

        // Scatter a few stone pillars for cover (deterministic based on seed)
        const pillarHash = ((q * 73856093) ^ (r * 19349663) ^ actualSeed) >>> 0;
        if (distFromCenter > 5 && distFromCenter < arenaRadius - 3) {
          if (pillarHash % 47 === 0) {
            terrain = TerrainType.MOUNTAIN;
            elevation = 3;
          }
        }
      }

      // Build voxel blocks for this tile
      const blocks: VoxelBlock[] = [];
      if (terrain !== TerrainType.WATER) {
        const topBlock = terrain === TerrainType.MOUNTAIN ? BlockType.STONE
          : terrain === TerrainType.DESERT ? BlockType.SAND
          : BlockType.GRASS;
        for (let y = -1; y <= elevation; y++) {
          blocks.push({
            localPosition: { x: 0, y, z: 0 },
            type: y === elevation ? topBlock : BlockType.DIRT,
            health: 100,
            maxHealth: 100,
          });
        }
      }

      tiles.set(key, {
        position: { q, r },
        terrain,
        elevation,
        resource: null,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: false, heightMap: [[elevation]] },
        visible: true,
        explored: true,
      });
    }
  }

  return { width: size, height: size, tiles, seed: actualSeed, mapType: MapType.ARENA };
}

// --- Map Generator Parameter Overrides ---
// These will be passed to the standard MapGenerator to create different map feels.
export interface MapGenParams {
  elevScale?: [number, number];       // [min, max] for elevation noise frequency
  mountainWeight?: [number, number];  // [min, max] mountain ridge contribution
  valleyWeight?: [number, number];    // [min, max] valley carve depth
  waterLevel?: number;                // threshold for lake formation
  mountainClusters?: [number, number]; // [min, max] number of mountain biomes
  riverCount?: [number, number];      // [min, max] rivers to carve
  flattenRadius?: number;             // base area flattening radius
}

export const MAP_GEN_PARAMS: Partial<Record<MapType, MapGenParams>> = {
  [MapType.HIGHLAND]: {
    elevScale: [0.06, 0.10],
    mountainWeight: [0.30, 0.50],
    valleyWeight: [0.05, 0.15],
    mountainClusters: [5, 8],
    riverCount: [1, 2],
  },
  [MapType.ARCHIPELAGO]: {
    elevScale: [0.12, 0.20],
    mountainWeight: [0.10, 0.20],
    valleyWeight: [0.25, 0.45],
    waterLevel: 0.35,
    mountainClusters: [1, 3],
    riverCount: [0, 1],
  },
  [MapType.FLATLAND]: {
    elevScale: [0.04, 0.08],
    mountainWeight: [0.05, 0.10],
    valleyWeight: [0.05, 0.10],
    mountainClusters: [0, 1],
    riverCount: [2, 4],
  },
};
