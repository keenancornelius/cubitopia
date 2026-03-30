// ============================================
// CUBITOPIA - Map Presets & Arena Generator
// Data-driven map type configs + flat arena map generation
// ============================================

import {
  GameMap, Tile, HexCoord, TerrainType, BlockType, VoxelBlock,
  ResourceType, MapType, MapPreset,
} from '../types';
import { MapGenerator } from './MapGenerator';

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
    description: 'Colosseum combat arena — walled ring, sand floor, tiered seating',
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

export interface ArenaMap extends GameMap {
  wallPositions: HexCoord[];   // Perimeter wall hex coords (colosseum wall ring)
  gatePositions: HexCoord[];   // Gate hex coords (4 cardinal entries)
}

export function generateArenaMap(size: number, seed?: number): ArenaMap {
  const actualSeed = seed ?? Math.floor(Math.random() * 999999);
  const tiles = new Map<string, Tile>();
  const center = Math.floor(size / 2);
  const wallRing: HexCoord[] = [];
  const gateRing: HexCoord[] = [];

  // Colosseum dimensions
  const floorRadius = Math.floor(size / 2) - 5;  // Sand fighting floor
  const wallRadius = floorRadius + 1;              // Wall ring just outside floor
  const tierRadius = wallRadius + 3;               // Spectator tiers outside walls
  const outerEdge = (size / 2) - 1;

  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;
      const dist = Math.sqrt((q - center) ** 2 + (r - center) ** 2);

      let terrain: TerrainType;
      let elevation: number;
      let topBlock: BlockType;

      if (dist > outerEdge) {
        // Outside — water void
        terrain = TerrainType.WATER;
        elevation = -2;
        topBlock = BlockType.WATER;
      } else if (dist > tierRadius) {
        // Outer ground — stone walkway
        terrain = TerrainType.PLAINS;
        elevation = 4;
        topBlock = BlockType.STONE;
      } else if (dist > wallRadius + 0.5) {
        // Spectator tiers — rising stone seating (colosseum effect)
        terrain = TerrainType.PLAINS;
        const tierStep = dist - wallRadius;
        elevation = Math.min(5, Math.floor(tierStep) + 2);
        topBlock = BlockType.STONE;
      } else if (dist > floorRadius + 0.5) {
        // Wall ring zone — flat at elevation 1 (walls go on top)
        terrain = TerrainType.PLAINS;
        elevation = 1;
        topBlock = BlockType.STONE;
      } else {
        // Arena floor — flat sand at elevation 0
        terrain = TerrainType.DESERT; // Desert = sand texture, no grass spawns
        elevation = 0;
        topBlock = BlockType.SAND;
      }

      // Build voxel column
      const blocks: VoxelBlock[] = [];
      if (terrain !== TerrainType.WATER) {
        for (let y = -1; y <= elevation; y++) {
          blocks.push({
            localPosition: { x: 0, y, z: 0 },
            type: y === elevation ? topBlock : (y >= elevation - 1 ? BlockType.STONE : BlockType.DIRT),
            health: 100,
            maxHealth: 100,
          });
        }
      }

      tiles.set(key, {
        position: { q, r },
        terrain,
        elevation,
        walkableFloor: elevation,
        resource: null,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: false, heightMap: [[elevation]] },
        visible: true,
        explored: true,
      });

      // Compute wall ring positions
      const ringDist = Math.abs(dist - wallRadius);
      if (ringDist < 0.8 && terrain !== TerrainType.WATER) {
        const dq = q - center;
        const dr = r - center;
        // Gates at 4 cardinal entries
        const isGate =
          (dr < -floorRadius + 0.5 && Math.abs(dq) <= 1) ||  // North
          (dr > floorRadius - 0.5 && Math.abs(dq) <= 1) ||   // South
          (dq > floorRadius - 0.5 && Math.abs(dr) <= 1) ||   // East
          (dq < -floorRadius + 0.5 && Math.abs(dr) <= 1);    // West

        if (isGate) {
          gateRing.push({ q, r });
        } else {
          wallRing.push({ q, r });
        }
      }
    }
  }

  // Compute shell blocks (3x3 voxel columns per hex) so the floor is solid
  const arenaMap: ArenaMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.ARENA,
    wallPositions: wallRing,
    gatePositions: gateRing,
  };
  const shellGen = new MapGenerator();
  shellGen.computeShellBlocks(arenaMap, size, size);

  return arenaMap;
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
