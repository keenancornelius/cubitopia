// ============================================
// CUBITOPIA - Map Presets & Arena Generator
// Data-driven map type configs + flat arena map generation
// ============================================

import {
  GameMap, Tile, HexCoord, TerrainType, BlockType, VoxelBlock,
  ResourceType, MapType, MapPreset, ENABLE_UNDERGROUND,
} from '../types';
import { MapGenerator } from './MapGenerator';
import { GameRNG } from './SeededRandom';
import { Logger } from '../engine/Logger';

// --- Map Preset Definitions ---
const ALL_MAP_PRESETS: MapPreset[] = [
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
  {
    type: MapType.DESERT_TUNNELS,
    label: 'DESERT TUNNELS',
    description: 'Arid desert with plateaus, canyons, and sprawling underground tunnel networks',
    size: 50,
    color: '#d4a056',
  },
];

/** Filtered presets — hides Desert Tunnels when underground is disabled */
export const MAP_PRESETS: MapPreset[] = ENABLE_UNDERGROUND
  ? ALL_MAP_PRESETS
  : ALL_MAP_PRESETS.filter(p => p.type !== MapType.DESERT_TUNNELS);

export function getPreset(type: MapType): MapPreset {
  return MAP_PRESETS.find(p => p.type === type) || MAP_PRESETS[0];
}

// --- Arena Map Generator ---
// Flat hex grid, no resources, no terrain noise. Pure combat sandbox.

export interface ArenaMap extends GameMap {
  wallPositions: HexCoord[];   // Perimeter wall hex coords (colosseum wall ring)
  gatePositions: HexCoord[];   // Gate hex coords (4 cardinal entries)
}

export interface DesertTunnelsMap extends GameMap {
  cavernCenter: { q: number; r: number };  // Central underground cavern position
  cavernFloorY: number;                     // Floor Y level of the cavern
  extraCaverns?: Array<{ center: { q: number; r: number }; floorY: number }>;  // Additional underground outposts
}

export function generateArenaMap(size: number, seed?: number): ArenaMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
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

// --- Desert Tunnels Map Generator ---
// Flat arid desert with plateaus, canyons, and a sprawling underground tunnel network.
// Designed for testing and enjoying underground gameplay.

class SimpleDesertNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  /** Simple 2D value noise */
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = this.hash(ix, iy);
    const n10 = this.hash(ix + 1, iy);
    const n01 = this.hash(ix, iy + 1);
    const n11 = this.hash(ix + 1, iy + 1);
    const nx0 = n00 + sx * (n10 - n00);
    const nx1 = n01 + sx * (n11 - n01);
    return nx0 + sy * (nx1 - nx0);
  }
  private hash(x: number, y: number): number {
    return (this.perm[(this.perm[x & 255] + y) & 255] & 0xffffff) / 0xffffff;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val / max;
  }
}

class DesertRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
}

export function generateDesertTunnelsMap(size: number, seed?: number): GameMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new DesertRng(actualSeed);
  const noise = new SimpleDesertNoise(actualSeed);
  const tiles = new Map<string, Tile>();

  // --- Terrain generation: flat desert with plateaus and canyons ---
  const EDGE_BUFFER = 2;

  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;

      // Edge falloff — prevent walking off the map
      const edgeDist = Math.min(q, r, size - 1 - q, size - 1 - r);
      if (edgeDist < 1) {
        // Outer border: impassable ridge
        tiles.set(key, makeTile(q, r, TerrainType.MOUNTAIN, 12, BlockType.STONE, null));
        continue;
      }

      // Base elevation: mostly flat desert (elevation 2-3)
      const baseNoise = noise.fbm(q * 0.06, r * 0.06, 3);
      let elevation = 2 + Math.floor(baseNoise * 2); // 2-3

      // Large plateaus: flat-topped elevated areas (elevation 5-7)
      const plateauNoise = noise.fbm(q * 0.04 + 100, r * 0.04 + 100, 2);
      const isPlateau = plateauNoise > 0.65;
      if (isPlateau) {
        elevation = 5 + Math.floor((plateauNoise - 0.65) * 20); // 5-7
        elevation = Math.min(7, elevation);
      }

      // Small mesas: scattered short elevated outcrops (elevation 4-5)
      const mesaNoise = noise.fbm(q * 0.1 + 200, r * 0.1 + 200, 2);
      const isMesa = !isPlateau && mesaNoise > 0.72 && edgeDist > 4;
      if (isMesa) {
        elevation = 4 + Math.floor((mesaNoise - 0.72) * 10); // 4-5
        elevation = Math.min(5, elevation);
      }

      // Determine terrain type and block
      let terrain: TerrainType;
      let topBlock: BlockType;
      let resource: ResourceType | null = null;

      if (isPlateau) {
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.STONE;
        // Some plateau tiles have iron
        if (rng.next() < 0.15) resource = ResourceType.IRON;
      } else if (isMesa) {
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.STONE;
        if (rng.next() < 0.1) resource = ResourceType.STONE;
      } else {
        terrain = TerrainType.DESERT;
        topBlock = BlockType.SAND;
        // Crystal deposits scattered in desert
        if (rng.next() < 0.03) resource = ResourceType.CRYSTAL;
        // Stone outcrops
        if (rng.next() < 0.05) resource = ResourceType.STONE;
      }

      tiles.set(key, makeTile(q, r, terrain, elevation, topBlock, resource));
    }
  }

  // --- Base area flattening ---
  const BASE_INSET = 5;
  const midR = Math.floor(size / 2);
  const basePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },
    { q: size - 1 - BASE_INSET, r: BASE_INSET },
  ];
  for (const bp of basePositions) {
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = -4; dr <= 4; dr++) {
        if (Math.abs(dq) + Math.abs(dr) > 5) continue;
        const tq = bp.q + dq, tr = bp.r + dr;
        const tk = `${tq},${tr}`;
        const tile = tiles.get(tk);
        if (tile) {
          tile.elevation = 2;
          tile.walkableFloor = 2;
          tile.terrain = TerrainType.DESERT;
          // Rebuild voxel blocks
          tile.voxelData.blocks = [];
          for (let y = -1; y <= 2; y++) {
            tile.voxelData.blocks.push({
              localPosition: { x: 0, y, z: 0 },
              type: y === 2 ? BlockType.SAND : BlockType.STONE,
              health: 100, maxHealth: 100,
            });
          }
          tile.voxelData.heightMap = [[2]];
        }
      }
    }
  }

  // --- Oasis groves near each base: small clusters of forest tiles for wood ---
  // Each base gets a 3-4 tile oasis grove within 6-8 hex range
  for (const bp of basePositions) {
    // Place 2 oasis clusters per base, offset in different directions
    const oasisOffsets = [
      { dq: 5, dr: 2 },
      { dq: 2, dr: 5 },
      { dq: -3, dr: 6 },
    ];
    for (const off of oasisOffsets) {
      const cq = bp.q + off.dq;
      const cr = bp.r + off.dr;
      // Scatter 3-5 forest tiles around this center
      const clusterSize = 3 + Math.floor(rng.next() * 3); // 3-5
      for (let i = 0; i < clusterSize; i++) {
        const tq = cq + Math.floor(rng.next() * 3) - 1;
        const tr = cr + Math.floor(rng.next() * 3) - 1;
        if (tq < 2 || tr < 2 || tq >= size - 2 || tr >= size - 2) continue;
        const tk = `${tq},${tr}`;
        const existing = tiles.get(tk);
        if (!existing) continue;
        // Don't overwrite base-flattened tiles or mountain tiles
        if (Math.abs(tq - bp.q) <= 3 && Math.abs(tr - bp.r) <= 3) continue;
        if (existing.terrain === TerrainType.MOUNTAIN) continue;
        // Convert to forest oasis tile
        tiles.set(tk, makeTile(tq, tr, TerrainType.FOREST, 2, BlockType.GRASS, ResourceType.WOOD));
      }
    }
  }

  // --- Scattered oasis groves in the mid-map for contested wood sources ---
  const midQ = Math.floor(size / 2);
  const midR2 = Math.floor(size / 2);
  for (let i = 0; i < 4; i++) {
    const oq = midQ + Math.floor(rng.next() * 12) - 6;
    const or2 = midR2 + Math.floor(rng.next() * 12) - 6;
    for (let j = 0; j < 4; j++) {
      const tq = oq + Math.floor(rng.next() * 3) - 1;
      const tr = or2 + Math.floor(rng.next() * 3) - 1;
      if (tq < 2 || tr < 2 || tq >= size - 2 || tr >= size - 2) continue;
      const tk = `${tq},${tr}`;
      const existing = tiles.get(tk);
      if (!existing || existing.terrain === TerrainType.MOUNTAIN) continue;
      tiles.set(tk, makeTile(tq, tr, TerrainType.FOREST, 2, BlockType.GRASS, ResourceType.WOOD));
    }
  }

  const desertMap: GameMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.DESERT_TUNNELS,
  };

  // --- Shell blocks for solid terrain ---
  const shellGen = new MapGenerator(actualSeed);
  shellGen.computeShellBlocks(desertMap, size, size);

  // --- Tunnel network: 3-4 surface openings, deep underground connections, central cavern + side caverns ---
  const { cavernCenter, cavernFloorY, extraCaverns } = carveDesertTunnels(desertMap, shellGen, rng, noise, size);

  // Store cavern info on the map for neutral city placement
  (desertMap as DesertTunnelsMap).cavernCenter = cavernCenter;
  (desertMap as DesertTunnelsMap).cavernFloorY = cavernFloorY;
  (desertMap as DesertTunnelsMap).extraCaverns = extraCaverns;

  return desertMap;
}

/** Carve the desert tunnel network:
 *  - Only 3-4 surface openings (cave mouths)
 *  - Deep underground-only tunnels connecting everything
 *  - Central cavern for battle staging
 *  - Underdark neutral city in the cavern
 *  - 2 smaller side caverns with additional neutral outposts
 *  Returns cavern center info for neutral city placement. */
function carveDesertTunnels(
  map: GameMap, gen: MapGenerator, rng: DesertRng, noise: SimpleDesertNoise, size: number
): { cavernCenter: { q: number; r: number }; cavernFloorY: number; extraCaverns: Array<{ center: { q: number; r: number }; floorY: number }> } {
  const EDGE = 5;
  const center = Math.floor(size / 2);

  // --- Step 1: Central cavern ---
  // Large open underground space near map center for battle staging
  const cavernCenter = { q: center, r: center };
  const CAVERN_RADIUS = 8;
  const CAVERN_FLOOR_Y = -16;
  const CAVERN_HEIGHT = 12; // tall ceiling for an epic feel
  gen.carveCavern(cavernCenter, CAVERN_RADIUS, CAVERN_FLOOR_Y, CAVERN_HEIGHT, map);
  Logger.debug('DesertTunnels', `Central cavern at (${center},${center}), floorY=${CAVERN_FLOOR_Y}, radius=${CAVERN_RADIUS}`);

  // --- Step 2: Pick 3-4 surface entrance locations ---
  // Spread them around the map edges (NW, NE, SW, SE quadrants)
  const NUM_ENTRANCES = 3 + (rng.next() > 0.5 ? 1 : 0); // 3 or 4
  const entranceZones = [
    { q: Math.floor(size * 0.2), r: Math.floor(size * 0.2) },  // NW
    { q: Math.floor(size * 0.8), r: Math.floor(size * 0.2) },  // NE
    { q: Math.floor(size * 0.2), r: Math.floor(size * 0.8) },  // SW
    { q: Math.floor(size * 0.8), r: Math.floor(size * 0.8) },  // SE
  ];
  // Shuffle and take NUM_ENTRANCES
  for (let i = entranceZones.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [entranceZones[i], entranceZones[j]] = [entranceZones[j], entranceZones[i]];
  }
  const entrances = entranceZones.slice(0, NUM_ENTRANCES);

  // Jitter entrance positions slightly and find valid tiles
  const entranceCoords: { q: number; r: number }[] = [];
  for (const zone of entrances) {
    const jq = zone.q + Math.floor((rng.next() - 0.5) * 6);
    const jr = zone.r + Math.floor((rng.next() - 0.5) * 6);
    const cq = Math.max(EDGE, Math.min(size - EDGE - 1, jq));
    const cr = Math.max(EDGE, Math.min(size - EDGE - 1, jr));
    entranceCoords.push({ q: cq, r: cr });
  }

  // --- Step 3: Carve surface-opening tunnels from each entrance to the central cavern ---
  // These are the ONLY tunnels with cave mouths (deepOnly=false)
  for (const entrance of entranceCoords) {
    const path = gen.traceTubePath(entrance, cavernCenter, map, size, size);
    if (path.length >= 6) {
      gen.carveTunnelBlocks(path, map, false, true); // Cave mouth at surface entrance only, not at cavern end
      Logger.debug('DesertTunnels', `Surface entrance at (${entrance.q},${entrance.r}) -> cavern`);
    }
  }

  // --- Step 4: Deep underground-only tunnel network ---
  // These tunnels connect to each other and the cavern but never break surface
  const numDeepTubes = 4 + Math.floor(rng.next() * 4); // 4-7 deep tunnels
  const tunnelEndpoints: { q: number; r: number }[] = [];

  // Collect candidate points spread across the map for deep tunnels
  for (let i = 0; i < numDeepTubes * 2 + 4; i++) {
    const tq = EDGE + Math.floor(rng.next() * (size - EDGE * 2));
    const tr = EDGE + Math.floor(rng.next() * (size - EDGE * 2));
    const tile = map.tiles.get(`${tq},${tr}`);
    if (tile) tunnelEndpoints.push({ q: tq, r: tr });
  }

  // Carve deep tunnels between random endpoint pairs
  for (let t = 0; t < numDeepTubes; t++) {
    if (tunnelEndpoints.length < 2) break;
    const si = Math.floor(rng.next() * tunnelEndpoints.length);
    const start = tunnelEndpoints.splice(si, 1)[0];
    const ei = Math.floor(rng.next() * tunnelEndpoints.length);
    const end = tunnelEndpoints.splice(ei, 1)[0];
    const d = Math.sqrt((end.q - start.q) ** 2 + (end.r - start.r) ** 2);
    if (d < 8) continue; // too short

    const path = gen.traceTubePath(start, end, map, size, size);
    if (path.length >= 6) {
      gen.carveTunnelBlocks(path, map, true); // Deep only — no surface openings
    }
  }

  // --- Step 5: Connect deep tunnels to the central cavern ---
  // Pick some tunnel tiles far from cavern and route them in
  const tunnelTiles: { q: number; r: number }[] = [];
  map.tiles.forEach((tile, key) => {
    if (tile.hasTunnel) {
      const [tq, tr] = key.split(',').map(Number);
      const distToCavern = Math.sqrt((tq - center) ** 2 + (tr - center) ** 2);
      if (distToCavern > CAVERN_RADIUS + 5) {
        tunnelTiles.push({ q: tq, r: tr });
      }
    }
  });

  // Connect 3-5 distant tunnel tiles to cavern edge
  const numConnections = Math.min(5, Math.max(3, Math.floor(tunnelTiles.length / 20)));
  for (let c = 0; c < numConnections && tunnelTiles.length > 0; c++) {
    const idx = Math.floor(rng.next() * tunnelTiles.length);
    const src = tunnelTiles.splice(idx, 1)[0];
    // Target a point on the cavern perimeter
    const angle = rng.next() * Math.PI * 2;
    const edgeQ = Math.round(center + Math.cos(angle) * (CAVERN_RADIUS - 2));
    const edgeR = Math.round(center + Math.sin(angle) * (CAVERN_RADIUS - 2));
    const path = gen.traceTubePath(src, { q: edgeQ, r: edgeR }, map, size, size);
    if (path.length >= 3) {
      gen.carveTunnelBlocks(path, map, true);
    }
  }

  // --- Step 6: Cross-connect deep tunnels to each other ---
  // Refresh tunnel tile list and add some branch connections
  const allTunnelTiles: { q: number; r: number }[] = [];
  map.tiles.forEach((tile, key) => {
    if (tile.hasTunnel) {
      const [tq, tr] = key.split(',').map(Number);
      allTunnelTiles.push({ q: tq, r: tr });
    }
  });

  const numBranches = 3 + Math.floor(rng.next() * 3);
  for (let b = 0; b < numBranches; b++) {
    if (allTunnelTiles.length < 20) break;
    const si = Math.floor(rng.next() * allTunnelTiles.length);
    const src = allTunnelTiles[si];
    let bestDist = Infinity;
    let bestTarget: { q: number; r: number } | null = null;

    for (const tt of allTunnelTiles) {
      const d = Math.sqrt((tt.q - src.q) ** 2 + (tt.r - src.r) ** 2);
      if (d > 6 && d < 18 && d < bestDist) {
        bestDist = d;
        bestTarget = tt;
      }
    }

    if (bestTarget) {
      const branchPath = gen.traceTubePath(src, bestTarget, map, size, size);
      if (branchPath.length >= 3 && branchPath.length <= 30) {
        gen.carveTunnelBlocks(branchPath, map, true);
      }
    }
  }

  // --- Step 7: Carve 2 smaller side caverns for additional underground outposts ---
  const SIDE_CAVERN_RADIUS = 5;
  const SIDE_CAVERN_FLOOR_Y = -12;
  const SIDE_CAVERN_HEIGHT = 8;
  const extraCaverns: Array<{ center: { q: number; r: number }; floorY: number }> = [];

  // Place side caverns far from center — roughly 1/3 of map from each player base
  // NW quadrant (closer to blue base side) and SE quadrant (closer to red base side)
  const sideCavernOffsets = [
    { dq: -Math.floor(size * 0.3), dr: -Math.floor(size * 0.25) },
    { dq: Math.floor(size * 0.3), dr: Math.floor(size * 0.25) },
  ];
  for (const offset of sideCavernOffsets) {
    const scCenter = {
      q: Math.max(SIDE_CAVERN_RADIUS + 2, Math.min(size - SIDE_CAVERN_RADIUS - 2, center + offset.dq)),
      r: Math.max(SIDE_CAVERN_RADIUS + 2, Math.min(size - SIDE_CAVERN_RADIUS - 2, center + offset.dr)),
    };
    gen.carveCavern(scCenter, SIDE_CAVERN_RADIUS, SIDE_CAVERN_FLOOR_Y, SIDE_CAVERN_HEIGHT, map);
    Logger.debug('DesertTunnels', `Side cavern at (${scCenter.q},${scCenter.r}), floorY=${SIDE_CAVERN_FLOOR_Y}, radius=${SIDE_CAVERN_RADIUS}`);

    // Connect side cavern to central cavern via deep tunnel
    const connPath = gen.traceTubePath(scCenter, cavernCenter, map, size, size);
    if (connPath.length >= 3) {
      gen.carveTunnelBlocks(connPath, map, true); // Deep only, no surface opening
      Logger.debug('DesertTunnels', `Connected side cavern (${scCenter.q},${scCenter.r}) to central cavern`);
    }

    extraCaverns.push({ center: scCenter, floorY: SIDE_CAVERN_FLOOR_Y });
  }

  return { cavernCenter, cavernFloorY: CAVERN_FLOOR_Y, extraCaverns };
}

function makeTile(q: number, r: number, terrain: TerrainType, elevation: number, topBlock: BlockType, resource: ResourceType | null): Tile {
  const blocks: VoxelBlock[] = [];
  for (let y = -1; y <= elevation; y++) {
    let blockType: BlockType;
    if (y === elevation) {
      blockType = topBlock;
    } else if (y >= elevation - 1) {
      blockType = terrain === TerrainType.DESERT ? BlockType.SAND : BlockType.STONE;
    } else {
      blockType = BlockType.STONE;
    }
    blocks.push({
      localPosition: { x: 0, y, z: 0 },
      type: blockType,
      health: 100,
      maxHealth: 100,
    });
  }

  return {
    position: { q, r },
    terrain,
    elevation,
    walkableFloor: elevation,
    resource,
    improvement: null,
    unit: null,
    owner: null,
    voxelData: { blocks, destructible: true, heightMap: [[elevation]] },
    visible: true,
    explored: true,
  };
}
