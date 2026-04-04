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
    label: 'CRYSTIRON RIDGE',
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
    type: MapType.SUNKEN_RUINS,
    label: 'SUNKEN RUINS',
    description: 'Ancient overgrown temple ruins — crumbling walls and mossy pillars',
    size: 50,
    color: '#5a7a5a',
  },
  {
    type: MapType.ARCHIPELAGO,
    label: 'ARCHIPELAGO',
    description: 'Scattered islands separated by water channels',
    size: 50,
    color: '#1abc9c',
  },
  {
    type: MapType.BADLANDS,
    label: 'SCORCHED BADLANDS',
    description: 'Red clay mesas and cracked earth — control the high ground or burn',
    size: 50,
    color: '#b5472a',
  },
  {
    type: MapType.DESERT_TUNNELS,
    label: 'DESERT TUNNELS',
    description: 'Arid desert with plateaus, canyons, and sprawling underground tunnel networks',
    size: 50,
    color: '#d4a056',
  },
  {
    type: MapType.VOLCANIC,
    label: 'VOLCANIC PASS',
    description: 'Narrow chokepoints between towering peaks and lava lakes — control the passes or die',
    size: 50,
    color: '#c0392b',
  },
  {
    type: MapType.TUNDRA,
    label: 'FROZEN WASTE',
    description: 'Barren frozen tundra with scarce resources — every crystal and tree is worth fighting over',
    size: 50,
    color: '#95a5a6',
  },
  {
    type: MapType.SKYLAND,
    label: 'SKYLAND',
    description: 'Floating cloud islands connected by rainbow bridges — control the bridges, control the sky',
    size: 40,
    color: '#FFB6C1',
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
  [MapType.SUNKEN_RUINS]: {
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
  [MapType.BADLANDS]: {
    elevScale: [0.04, 0.08],
    mountainWeight: [0.05, 0.10],
    valleyWeight: [0.05, 0.10],
    mountainClusters: [0, 1],
    riverCount: [2, 4],
  },
  [MapType.VOLCANIC]: {
    elevScale: [0.10, 0.16],
    mountainWeight: [0.35, 0.55],
    valleyWeight: [0.25, 0.40],
    waterLevel: 0.30,
    mountainClusters: [6, 10],
    riverCount: [0, 1],
  },
  [MapType.TUNDRA]: {
    elevScale: [0.06, 0.10],
    mountainWeight: [0.10, 0.20],
    valleyWeight: [0.08, 0.15],
    waterLevel: 0.25,
    mountainClusters: [2, 4],
    riverCount: [1, 2],
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

// ============================================
// SKYLAND MAP GENERATOR
// Floating cloud islands connected by rainbow bridges
// ============================================

interface SkyIsland {
  center: { q: number; r: number };
  radius: number;
  elevation: number;      // base surface elevation (varies per island)
  role: 'home' | 'central' | 'outpost';
  resources: ResourceType[];
}

export interface SkylandMap extends GameMap {
  islands: SkyIsland[];
  bridges: Array<{ from: number; to: number; tiles: HexCoord[] }>;
}

class SkyRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class SkyNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) => (this.perm[(this.perm[a & 255] + b) & 255] & 0xffffff) / 0xffffff;
    return h(ix, iy) * (1 - sx) * (1 - sy) + h(ix + 1, iy) * sx * (1 - sy) +
           h(ix, iy + 1) * (1 - sx) * sy + h(ix + 1, iy + 1) * sx * sy;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return val / max;
  }
}

export function generateSkylandMap(size: number, seed?: number, playerCount: number = 2): SkylandMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new SkyRng(actualSeed);
  const noise = new SkyNoise(actualSeed);
  const tiles = new Map<string, Tile>();

  // ── Step 1: Place islands ──
  const GOLDEN_ANGLE = Math.PI * 2 * (1 - 1 / ((1 + Math.sqrt(5)) / 2));
  const center = Math.floor(size / 2);
  const islands: SkyIsland[] = [];
  const BASE_INSET = 6;

  // Home islands — one per player, matching MapInitializer's base positions
  // 2-player: opposite corners (BL, TR)
  // 4-player: all four corners (BL, TR, TL, BR)
  const homePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },             // P0: bottom-left
    { q: size - 1 - BASE_INSET, r: BASE_INSET },             // P1: top-right
    { q: BASE_INSET, r: BASE_INSET },                         // P2: top-left
    { q: size - 1 - BASE_INSET, r: size - 1 - BASE_INSET },  // P3: bottom-right
  ];
  const numHomes = Math.min(playerCount, 4);
  for (let i = 0; i < numHomes; i++) {
    islands.push({
      center: homePositions[i],
      radius: 7, elevation: 3, role: 'home',
      resources: [ResourceType.WOOD, ResourceType.STONE, ResourceType.FOOD],
    });
  }

  // Central contested island
  islands.push({
    center: { q: center, r: center },
    radius: rng.range(6, 8), elevation: 4, role: 'central',
    resources: [ResourceType.CRYSTAL, ResourceType.IRON, ResourceType.GOLD],
  });

  // Outpost islands: more for FFA to give more strategic points
  // 2-player: 4-6 outposts, 4-player: 5-8 outposts
  const numOutposts = playerCount <= 2 ? rng.range(4, 6) : rng.range(5, 8);
  const maxSpread = size * 0.38;
  const angleOffset = rng.next() * Math.PI * 2;
  const outpostResources: ResourceType[][] = [
    [ResourceType.WOOD, ResourceType.FOOD],
    [ResourceType.STONE, ResourceType.IRON],
    [ResourceType.IRON, ResourceType.GOLD],
    [ResourceType.CRYSTAL],
    [ResourceType.WOOD, ResourceType.STONE],
    [ResourceType.GOLD, ResourceType.FOOD],
    [ResourceType.STONE, ResourceType.CRYSTAL],
    [ResourceType.WOOD, ResourceType.IRON],
  ];

  for (let i = 0; i < numOutposts + 3; i++) { // attempt more than needed, skip collisions
    if (islands.filter(isl => isl.role === 'outpost').length >= numOutposts) break;

    const angle = angleOffset + (i + numHomes + 1) * GOLDEN_ANGLE;
    const dist = maxSpread * (0.4 + rng.next() * 0.6);
    let iq = Math.round(center + Math.cos(angle) * dist);
    let ir = Math.round(center + Math.sin(angle) * dist);
    // Clamp to safe zone
    iq = Math.max(4, Math.min(size - 5, iq));
    ir = Math.max(4, Math.min(size - 5, ir));

    // Ensure minimum distance from existing islands
    const tooClose = islands.some(isl => {
      const d = Math.sqrt((iq - isl.center.q) ** 2 + (ir - isl.center.r) ** 2);
      return d < isl.radius + 4;
    });
    if (tooClose) continue;

    islands.push({
      center: { q: iq, r: ir },
      radius: rng.range(3, 5),
      elevation: rng.range(2, 4),
      role: 'outpost',
      resources: outpostResources[i % outpostResources.length],
    });
  }

  Logger.info('Skyland', `Placed ${islands.length} islands`);

  // ── Step 2: Generate all tiles — void by default ──
  // First, fill everything as void (impassable sky)
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;
      tiles.set(key, {
        position: { q, r },
        terrain: TerrainType.WATER, // WATER terrain = void (cloud plane below)
        elevation: -3,
        walkableFloor: -3,
        resource: null,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks: [], destructible: false, heightMap: [[-3]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 3: Stamp islands onto the tile grid with terrain variety ──
  // Each island gets internal terrain zones driven by noise:
  //   Cloud Peaks  (MOUNTAIN) — high ridges with stone, iron, crystal veins
  //   Cloud Valleys (DESERT)  — sandy dips with gold, clay deposits
  //   Meadows      (PLAINS)   — default pastel grass, food
  //   Groves       (FOREST)   — wood-rich tree zones
  for (const island of islands) {
    const { center: ic, radius, elevation } = island;

    for (let dq = -radius - 1; dq <= radius + 1; dq++) {
      for (let dr = -radius - 1; dr <= radius + 1; dr++) {
        const q = ic.q + dq;
        const r = ic.r + dr;
        if (q < 0 || r < 0 || q >= size || r >= size) continue;

        const dist = Math.sqrt(dq * dq + dr * dr);
        // Noise-distorted edge for organic shape
        const edgeNoise = noise.fbm(q * 0.3 + 100, r * 0.3 + 100, 2);
        const effectiveRadius = radius * (0.8 + edgeNoise * 0.4);

        if (dist > effectiveRadius) continue;

        const key = `${q},${r}`;
        const edgeFactor = dist / effectiveRadius;

        // ── Terrain zone noise ──
        const hillNoise = noise.fbm(q * 0.15, r * 0.15, 3);          // elevation variation
        const zoneNoise = noise.fbm(q * 0.25 + 200, r * 0.25 + 200, 2); // terrain zone selector
        const forestNoise = noise.fbm(q * 0.2 + 50, r * 0.2 + 50, 2);   // forest patches

        // ── Elevation: peaks rise, valleys dip ──
        let tileElev = elevation + Math.round(hillNoise * 2 - 0.5);
        // Wider thresholds → ~30% peak, ~30% valley, rest meadow/forest
        const isPeak = zoneNoise > 0.52 && edgeFactor < 0.75;
        const isValley = zoneNoise < 0.38 && edgeFactor < 0.70;
        if (isPeak) tileElev += 3;    // dramatic peaks rise high
        if (isValley) tileElev -= 2;  // deep valleys dip down
        // Edge tiles slope down for cliff effect
        if (edgeFactor > 0.7) {
          tileElev = Math.max(elevation - 1, tileElev - Math.round((edgeFactor - 0.7) * 5));
        }
        tileElev = Math.max(1, tileElev);

        // ── Determine terrain type, surface block, and resource ──
        let terrain = TerrainType.PLAINS;
        let topBlock = BlockType.PASTEL_GRASS;
        let subBlock = BlockType.CREAM_STONE;
        let resource: ResourceType | null = null;

        if (isPeak) {
          // ── Cloud Peak: exposed stone mountain with ore veins ──
          terrain = TerrainType.MOUNTAIN;
          topBlock = BlockType.STONE;
          subBlock = BlockType.STONE;
          // Resource assignment for peaks
          if (island.resources.includes(ResourceType.CRYSTAL) && rng.next() < 0.12) {
            resource = ResourceType.CRYSTAL;
          } else if (island.resources.includes(ResourceType.IRON) && rng.next() < 0.15) {
            resource = ResourceType.IRON;
          } else if (rng.next() < 0.10) {
            resource = ResourceType.STONE;
          }
        } else if (isValley) {
          // ── Cloud Valley: sandy lowland with gold and clay ──
          terrain = TerrainType.DESERT;
          topBlock = BlockType.SAND;
          subBlock = BlockType.SAND;
          // Resource assignment for valleys
          if (island.resources.includes(ResourceType.GOLD) && rng.next() < 0.12) {
            resource = ResourceType.GOLD;
          } else if (rng.next() < 0.15) {
            resource = ResourceType.CLAY;
          }
        } else if (forestNoise > 0.55 && edgeFactor < 0.6 && island.resources.includes(ResourceType.WOOD)) {
          // ── Forest grove ──
          terrain = TerrainType.FOREST;
          topBlock = BlockType.PASTEL_GRASS;
          resource = ResourceType.WOOD;
        } else {
          // ── Meadow: default pastel plains ──
          // Scatter remaining resources
          if (edgeFactor < 0.7) {
            const RESOURCE_RATES: Partial<Record<ResourceType, number>> = {
              [ResourceType.FOOD]: 0.10,
              [ResourceType.STONE]: 0.06,
              [ResourceType.IRON]: 0.04,
              [ResourceType.CRYSTAL]: 0.03,
              [ResourceType.GOLD]: 0.03,
            };
            for (const res of island.resources) {
              if (res === ResourceType.WOOD) continue;
              const rate = RESOURCE_RATES[res] ?? 0.05;
              if (rng.next() < rate) { resource = res; break; }
            }
          }
        }

        // ── Build voxel column with 3x3 sub-voxel offsets ──
        const ISLAND_DEPTH = -5;
        const blocks: VoxelBlock[] = [];
        const offsets = [-0.5, 0, 0.5];
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = ISLAND_DEPTH; y < tileElev; y++) {
              let blockType: BlockType;
              if (y === tileElev - 1) blockType = topBlock;           // surface
              else if (y >= tileElev - 3) blockType = subBlock;       // sub-surface
              else blockType = BlockType.CLOUD;                       // deep = cloud
              blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: blockType, health: 100, maxHealth: 100,
              });
            }
          }
        }

        // ── Inject ore veins into subsurface blocks ──
        if (resource === ResourceType.IRON && terrain === TerrainType.MOUNTAIN) {
          for (const b of blocks) {
            if (b.type === BlockType.STONE && b.localPosition.y < tileElev - 2 && rng.next() < 0.30) {
              b.type = BlockType.IRON;
            }
          }
        }
        if (resource === ResourceType.GOLD && terrain === TerrainType.DESERT) {
          for (const b of blocks) {
            if (b.type === BlockType.SAND && b.localPosition.y < tileElev - 2 && rng.next() < 0.20) {
              b.type = BlockType.GOLD;
            }
          }
        }
        if (resource === ResourceType.CRYSTAL) {
          for (const b of blocks) {
            if (b.type === BlockType.STONE && b.localPosition.y < tileElev - 1 && rng.next() < 0.25) {
              b.type = BlockType.CRYSTAL;
            }
          }
        }
        if (resource === ResourceType.CLAY) {
          for (const b of blocks) {
            if (b.type === BlockType.SAND && b.localPosition.y < tileElev - 1 && rng.next() < 0.25) {
              b.type = BlockType.CLAY;
            }
          }
        }

        tiles.set(key, {
          position: { q, r },
          terrain,
          elevation: tileElev,
          walkableFloor: tileElev,
          resource,
          improvement: null,
          unit: null,
          owner: null,
          voxelData: { blocks, destructible: true, heightMap: [[tileElev]] },
          visible: true,
          explored: true,
        });
      }
    }
  }

  // ── Step 4: Connect islands with rainbow bridges ──
  // Build minimum spanning tree via Prim's algorithm for guaranteed connectivity
  const bridgeData: Array<{ from: number; to: number; tiles: HexCoord[] }> = [];
  const connected = new Set<number>([0]); // start from first home island
  const edgeCandidates: Array<{ from: number; to: number; dist: number }> = [];

  // Seed initial edges from island 0
  const islandDist = (a: SkyIsland, b: SkyIsland) =>
    Math.sqrt((a.center.q - b.center.q) ** 2 + (a.center.r - b.center.r) ** 2);

  for (let j = 1; j < islands.length; j++) {
    edgeCandidates.push({ from: 0, to: j, dist: islandDist(islands[0], islands[j]) });
  }

  while (connected.size < islands.length && edgeCandidates.length > 0) {
    // Sort by distance, pick shortest that connects a new island
    edgeCandidates.sort((a, b) => a.dist - b.dist);
    let picked = -1;
    for (let i = 0; i < edgeCandidates.length; i++) {
      if (!connected.has(edgeCandidates[i].to)) {
        picked = i;
        break;
      }
    }
    if (picked < 0) break;

    const edge = edgeCandidates.splice(picked, 1)[0];
    connected.add(edge.to);

    // Add edges from newly connected island
    for (let j = 0; j < islands.length; j++) {
      if (!connected.has(j)) {
        edgeCandidates.push({ from: edge.to, to: j, dist: islandDist(islands[edge.to], islands[j]) });
      }
    }

    // Trace bridge tiles between nearest edges of the two islands
    const bridgeTiles = traceBridgePath(
      islands[edge.from], islands[edge.to], tiles, size, rng
    );
    bridgeData.push({ from: edge.from, to: edge.to, tiles: bridgeTiles });
  }

  // Add 1-2 extra bridge connections for alternate routes
  const extraBridges = rng.range(1, 2);
  for (let e = 0; e < extraBridges; e++) {
    const a = rng.range(0, islands.length - 1);
    let b = rng.range(0, islands.length - 1);
    if (a === b) b = (a + 1) % islands.length;
    // Don't duplicate existing bridges
    const exists = bridgeData.some(br =>
      (br.from === a && br.to === b) || (br.from === b && br.to === a)
    );
    if (exists) continue;

    const bridgeTiles = traceBridgePath(islands[a], islands[b], tiles, size, rng);
    bridgeData.push({ from: a, to: b, tiles: bridgeTiles });
  }

  Logger.info('Skyland', `Built ${bridgeData.length} bridges`);

  // ── Step 5: Mark neutral outpost islands as surface bases for capture zones ──
  const surfaceBases: Array<{ center: { q: number; r: number }; terrain: string }> = [];
  for (const island of islands) {
    if (island.role === 'outpost' || island.role === 'central') {
      surfaceBases.push({ center: island.center, terrain: 'skyland' });
    }
  }

  // ── Step 6: Shell blocks for solid terrain ──
  const skyMap: SkylandMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.SKYLAND,
    islands,
    bridges: bridgeData,
    surfaceBases,
  };
  const shellGen = new MapGenerator(actualSeed);
  shellGen.computeShellBlocks(skyMap, size, size);

  return skyMap;
}

/** Trace a 1-hex-wide rainbow bridge path between two islands */
function traceBridgePath(
  fromIsland: SkyIsland, toIsland: SkyIsland,
  tiles: Map<string, Tile>, size: number, rng: SkyRng
): HexCoord[] {
  const fc = fromIsland.center;
  const tc = toIsland.center;

  // Find closest edge points (from center toward the other island)
  const angle = Math.atan2(tc.r - fc.r, tc.q - fc.q);
  const fromEdge = {
    q: Math.round(fc.q + Math.cos(angle) * (fromIsland.radius - 1)),
    r: Math.round(fc.r + Math.sin(angle) * (fromIsland.radius - 1)),
  };
  const backAngle = angle + Math.PI;
  const toEdge = {
    q: Math.round(tc.q + Math.cos(backAngle) * (toIsland.radius - 1)),
    r: Math.round(tc.r + Math.sin(backAngle) * (toIsland.radius - 1)),
  };

  // Interpolate along the line with slight arc (bridge curves up in the middle)
  const bridgeTiles: HexCoord[] = [];
  const dist = Math.sqrt((toEdge.q - fromEdge.q) ** 2 + (toEdge.r - fromEdge.r) ** 2);
  const steps = Math.max(3, Math.ceil(dist));

  // Get elevations at endpoints for smooth ramp
  const fromTile = tiles.get(`${fromEdge.q},${fromEdge.r}`);
  const toTile = tiles.get(`${toEdge.q},${toEdge.r}`);
  const fromElev = fromTile && fromTile.elevation > 0 ? fromTile.elevation : fromIsland.elevation;
  const toElev = toTile && toTile.elevation > 0 ? toTile.elevation : toIsland.elevation;

  // Compute perpendicular direction for bridge width
  const dx = toEdge.q - fromEdge.q;
  const dz = toEdge.r - fromEdge.r;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  // Perpendicular unit vector (rotated 90°)
  const perpQ = -dz / len;
  const perpR = dx / len;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const centerQ = fromEdge.q + (toEdge.q - fromEdge.q) * t;
    const centerR = fromEdge.r + (toEdge.r - fromEdge.r) * t;

    // Bridge elevation: lerp endpoints with a gentle upward arc in the middle
    const arcHeight = Math.sin(t * Math.PI) * 1.5; // subtle arc
    const bridgeElev = Math.round(fromElev + (toElev - fromElev) * t + arcHeight);
    const elev = Math.max(1, bridgeElev);

    // Place 3-wide bridge: center walkway + cloud rail on each side
    const offsets = [
      { oq: 0, or: 0, isCenter: true },
      { oq: Math.round(perpQ), or: Math.round(perpR), isCenter: false },
      { oq: Math.round(-perpQ), or: Math.round(-perpR), isCenter: false },
    ];

    for (const off of offsets) {
      const bq = Math.round(centerQ) + off.oq;
      const br = Math.round(centerR) + off.or;
      if (bq < 0 || br < 0 || bq >= size || br >= size) continue;

      const key = `${bq},${br}`;
      const existing = tiles.get(key);
      // Don't overwrite island tiles or previously placed bridge tiles
      if (existing && existing.elevation > 0) continue;

      // Center tiles are rainbow walkway, side tiles are cloud rails (slightly taller)
      const tileElev = off.isCenter ? elev : elev + 1;
      const topBlock = off.isCenter ? BlockType.RAINBOW_BRIDGE : BlockType.CLOUD;

      // Build bridge voxel column with 3x3 sub-voxel offsets for solid rendering
      const blocks: VoxelBlock[] = [];
      const bOffsets = [-0.5, 0, 0.5];
      for (const lx of bOffsets) {
        for (const lz of bOffsets) {
          for (let y = elev - 2; y < tileElev; y++) {
            blocks.push({
              localPosition: { x: lx, y, z: lz },
              type: y === tileElev - 1 ? topBlock : BlockType.CLOUD,
              health: 100, maxHealth: 100,
            });
          }
        }
      }

      tiles.set(key, {
        position: { q: bq, r: br },
        terrain: TerrainType.PLAINS, // walkable
        elevation: tileElev,
        walkableFloor: off.isCenter ? elev : tileElev, // units walk on center level
        resource: null,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: false, heightMap: [[tileElev]] },
        visible: true,
        explored: true,
        isBridge: true,
      } as Tile);

      if (off.isCenter) {
        bridgeTiles.push({ q: bq, r: br });
      }
    }
  }

  return bridgeTiles;
}

// ============================================

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

// ============================================
// VOLCANIC PASS MAP GENERATOR
// Volcanic wasteland with towering basalt peaks, lava rivers,
// obsidian formations, ash plains, and narrow passes.
// ============================================

export interface VolcanicMap extends GameMap {
  volcanoes: Array<{ q: number; r: number; radius: number; height: number }>;
  lavaRivers: Array<HexCoord[]>;
}

class VolcRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class VolcNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) => (this.perm[(this.perm[a & 255] + b) & 255] & 0xffffff) / 0xffffff;
    return h(ix, iy) * (1 - sx) * (1 - sy) + h(ix + 1, iy) * sx * (1 - sy) +
           h(ix, iy + 1) * (1 - sx) * sy + h(ix + 1, iy + 1) * sx * sy;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return val / max;
  }
}

export function generateVolcanicMap(size: number, seed?: number, playerCount: number = 2): VolcanicMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new VolcRng(actualSeed);
  const noise = new VolcNoise(actualSeed);
  const tiles = new Map<string, Tile>();
  const offsets = [-0.5, 0, 0.5]; // 3x3 sub-voxel for solid rendering

  // ── Step 1: Place volcanic peaks ──
  // Central ridge runs diagonally with additional scattered volcanic cones
  const volcanoes: Array<{ q: number; r: number; radius: number; height: number }> = [];
  const center = Math.floor(size / 2);

  // Central mega-volcano
  volcanoes.push({ q: center, r: center, radius: 7, height: 12 });

  // Ridge volcanoes along diagonal
  const ridgeCount = rng.range(3, 5);
  for (let i = 0; i < ridgeCount; i++) {
    const t = (i + 1) / (ridgeCount + 1);
    const rq = Math.floor(size * 0.15 + t * size * 0.7) + rng.range(-3, 3);
    const rr = Math.floor(size * 0.85 - t * size * 0.7) + rng.range(-3, 3);
    volcanoes.push({ q: rq, r: rr, radius: rng.range(4, 6), height: rng.range(8, 11) });
  }

  // Scattered smaller volcanic cones
  const coneCount = rng.range(4, 7);
  for (let i = 0; i < coneCount; i++) {
    const cq = rng.range(4, size - 5);
    const cr = rng.range(4, size - 5);
    // Don't overlap with existing volcanoes too much
    const tooClose = volcanoes.some(v => Math.sqrt((cq - v.q) ** 2 + (cr - v.r) ** 2) < v.radius + 3);
    if (!tooClose) {
      volcanoes.push({ q: cq, r: cr, radius: rng.range(2, 4), height: rng.range(5, 8) });
    }
  }

  // ── Step 2: Generate base terrain for all tiles ──
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;

      // Base elevation from noise
      const baseNoise = noise.fbm(q * 0.08, r * 0.08, 3);
      let elev = 2 + Math.round(baseNoise * 3);

      // Volcanic influence — peaks raise nearby terrain
      let volcInfluence = 0;
      let closestVolcDist = Infinity;
      let closestVolc: typeof volcanoes[0] | null = null;
      for (const v of volcanoes) {
        const dist = Math.sqrt((q - v.q) ** 2 + (r - v.r) ** 2);
        if (dist < closestVolcDist) {
          closestVolcDist = dist;
          closestVolc = v;
        }
        if (dist < v.radius * 2) {
          const factor = 1 - dist / (v.radius * 2);
          volcInfluence = Math.max(volcInfluence, factor);
        }
      }

      // Terrain zone noise
      const zoneNoise = noise.fbm(q * 0.12 + 100, r * 0.12 + 100, 2);
      const lavaNoiseVal = noise.fbm(q * 0.2 + 300, r * 0.2 + 300, 3);

      // Determine terrain type and blocks
      let terrain = TerrainType.MOUNTAIN;
      let topBlock = BlockType.BASALT;
      let subBlock = BlockType.BASALT;
      let resource: ResourceType | null = null;

      // Inside volcano cone — steep peak
      if (closestVolc && closestVolcDist < closestVolc.radius) {
        const peakFactor = 1 - closestVolcDist / closestVolc.radius;
        elev = closestVolc.height - 2 + Math.round(peakFactor * 4);
        // Very center of volcano = crater (lower)
        if (closestVolcDist < 1.5) {
          elev = closestVolc.height - 3;
          topBlock = BlockType.MAGMA;
          subBlock = BlockType.OBSIDIAN;
          terrain = TerrainType.MOUNTAIN;
        } else {
          topBlock = BlockType.OBSIDIAN;
          subBlock = BlockType.BASALT;
          terrain = TerrainType.MOUNTAIN;
          if (rng.next() < 0.12) resource = ResourceType.CRYSTAL;
          else if (rng.next() < 0.10) resource = ResourceType.IRON;
        }
      }
      // Lava rivers/pools — low areas between volcanoes
      else if (lavaNoiseVal > 0.62 && volcInfluence > 0.15 && volcInfluence < 0.7) {
        elev = 1;
        topBlock = BlockType.LAVA;
        subBlock = BlockType.MAGMA;
        terrain = TerrainType.WATER; // pathfinding: impassable
      }
      // Volcanic slopes — near volcanoes
      else if (volcInfluence > 0.3) {
        elev += Math.round(volcInfluence * 4);
        topBlock = BlockType.BASALT;
        subBlock = BlockType.BASALT;
        terrain = TerrainType.MOUNTAIN;
        if (rng.next() < 0.08) resource = ResourceType.IRON;
        else if (rng.next() < 0.06) resource = ResourceType.STONE;
      }
      // Ash plains — medium distance from volcanoes
      else if (zoneNoise < 0.4 && volcInfluence < 0.3) {
        terrain = TerrainType.PLAINS;
        topBlock = BlockType.ASH;
        subBlock = BlockType.SCORCHED_EARTH;
        if (rng.next() < 0.08) resource = ResourceType.FOOD;
        else if (rng.next() < 0.04) resource = ResourceType.STONE;
      }
      // Scorched forest — some areas have charred trees
      else if (zoneNoise > 0.55 && volcInfluence < 0.25) {
        terrain = TerrainType.FOREST;
        topBlock = BlockType.SCORCHED_EARTH;
        subBlock = BlockType.BASALT;
        elev = Math.max(2, elev);
        if (rng.next() < 0.15) resource = ResourceType.WOOD;
        else if (rng.next() < 0.05) resource = ResourceType.STONE;
      }
      // Default scorched terrain
      else {
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.SCORCHED_EARTH;
        subBlock = BlockType.BASALT;
        if (rng.next() < 0.06) resource = ResourceType.STONE;
        else if (rng.next() < 0.04) resource = ResourceType.GOLD;
      }

      elev = Math.max(1, Math.min(elev, 14));

      // ── Build voxel column with 3x3 sub-voxel offsets ──
      const blocks: VoxelBlock[] = [];
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = -1; y < elev; y++) {
            let blockType: BlockType;
            if (y === elev - 1) blockType = topBlock;
            else if (y >= elev - 3) blockType = subBlock;
            else blockType = BlockType.BASALT; // deep = basalt
            blocks.push({
              localPosition: { x: lx, y, z: lz },
              type: blockType, health: 100, maxHealth: 100,
            });
          }
        }
      }

      // ── Inject ore veins ──
      if (resource === ResourceType.IRON) {
        for (const b of blocks) {
          if (b.type === BlockType.BASALT && b.localPosition.y < elev - 2 && rng.next() < 0.25) {
            b.type = BlockType.IRON;
          }
        }
      }
      if (resource === ResourceType.CRYSTAL) {
        for (const b of blocks) {
          if ((b.type === BlockType.OBSIDIAN || b.type === BlockType.BASALT) && b.localPosition.y < elev - 1 && rng.next() < 0.20) {
            b.type = BlockType.CRYSTAL;
          }
        }
      }
      if (resource === ResourceType.GOLD) {
        for (const b of blocks) {
          if (b.type === BlockType.BASALT && b.localPosition.y < elev - 1 && rng.next() < 0.15) {
            b.type = BlockType.GOLD;
          }
        }
      }

      tiles.set(key, {
        position: { q, r },
        terrain,
        elevation: elev,
        walkableFloor: elev,
        resource,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: true, heightMap: [[elev]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 3: Carve lava rivers from volcano craters downhill ──
  const lavaRivers: Array<HexCoord[]> = [];
  for (const v of volcanoes) {
    if (v.radius < 4) continue; // only big volcanoes get rivers
    const riverCount = rng.range(1, 3);
    for (let ri = 0; ri < riverCount; ri++) {
      const angle = rng.next() * Math.PI * 2;
      const river: HexCoord[] = [];
      let rq = v.q + Math.round(Math.cos(angle) * 1.5);
      let rr = v.r + Math.round(Math.sin(angle) * 1.5);
      const dirQ = Math.cos(angle + (rng.next() - 0.5) * 0.5);
      const dirR = Math.sin(angle + (rng.next() - 0.5) * 0.5);

      for (let step = 0; step < 15; step++) {
        if (rq < 1 || rr < 1 || rq >= size - 1 || rr >= size - 1) break;
        const key = `${rq},${rr}`;
        const tile = tiles.get(key);
        if (tile && tile.terrain !== TerrainType.WATER) {
          // Convert to lava river
          tile.terrain = TerrainType.WATER;
          tile.elevation = Math.max(1, tile.elevation - 2);
          tile.walkableFloor = tile.elevation;
          tile.voxelData.heightMap = [[tile.elevation]];
          // Rebuild blocks as lava
          tile.voxelData.blocks = [];
          for (const lx of offsets) {
            for (const lz of offsets) {
              for (let y = -1; y < tile.elevation; y++) {
                let blockType: BlockType;
                if (y === tile.elevation - 1) blockType = BlockType.LAVA;
                else blockType = BlockType.MAGMA;
                tile.voxelData.blocks.push({
                  localPosition: { x: lx, y, z: lz },
                  type: blockType, health: 100, maxHealth: 100,
                });
              }
            }
          }
          river.push({ q: rq, r: rr });
          // Also widen the river — set adjacent tiles
          const adj = [
            { q: rq + 1, r: rr }, { q: rq - 1, r: rr },
            { q: rq, r: rr + 1 }, { q: rq, r: rr - 1 },
          ];
          for (const a of adj) {
            if (rng.next() < 0.35) {
              const aKey = `${a.q},${a.r}`;
              const at = tiles.get(aKey);
              if (at && at.terrain !== TerrainType.WATER) {
                at.terrain = TerrainType.WATER;
                at.elevation = Math.max(1, at.elevation - 2);
                at.walkableFloor = at.elevation;
                at.voxelData.heightMap = [[at.elevation]];
                at.voxelData.blocks = [];
                for (const lx of offsets) {
                  for (const lz of offsets) {
                    for (let y = -1; y < at.elevation; y++) {
                      at.voxelData.blocks.push({
                        localPosition: { x: lx, y, z: lz },
                        type: y === at.elevation - 1 ? BlockType.LAVA : BlockType.MAGMA,
                        health: 100, maxHealth: 100,
                      });
                    }
                  }
                }
              }
            }
          }
        }
        // Meander downhill
        rq += Math.round(dirQ + (rng.next() - 0.5) * 0.8);
        rr += Math.round(dirR + (rng.next() - 0.5) * 0.8);
      }
      if (river.length > 0) lavaRivers.push(river);
    }
  }

  // ── Step 4: Clear safe zones around player bases ──
  const BASE_INSET = 6;
  const homePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },           // P0: bottom-left
    { q: size - 1 - BASE_INSET, r: BASE_INSET },           // P1: top-right
    { q: BASE_INSET, r: BASE_INSET },                       // P2: top-left
    { q: size - 1 - BASE_INSET, r: size - 1 - BASE_INSET }, // P3: bottom-right
  ];
  const usedHomes = homePositions.slice(0, playerCount);

  for (const home of usedHomes) {
    // Clear a safe area around each base — ash plains with resources
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = -4; dr <= 4; dr++) {
        const tq = home.q + dq;
        const tr = home.r + dr;
        if (tq < 0 || tr < 0 || tq >= size || tr >= size) continue;
        const dist = Math.sqrt(dq * dq + dr * dr);
        if (dist > 4.5) continue;

        const key = `${tq},${tr}`;
        const tile = tiles.get(key);
        if (!tile) continue;

        // Flatten and make habitable
        tile.terrain = dist < 2 ? TerrainType.PLAINS : TerrainType.FOREST;
        tile.elevation = 3;
        tile.walkableFloor = 3;
        tile.voxelData.heightMap = [[3]];

        const sBlock = dist < 2 ? BlockType.SCORCHED_EARTH : BlockType.ASH;
        const dBlock = BlockType.BASALT;
        tile.voxelData.blocks = [];
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = -1; y < 3; y++) {
              tile.voxelData.blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: y === 2 ? sBlock : dBlock,
                health: 100, maxHealth: 100,
              });
            }
          }
        }

        // Scatter resources around base
        if (dist > 1.5 && dist < 4) {
          if (rng.next() < 0.15) tile.resource = ResourceType.WOOD;
          else if (rng.next() < 0.12) tile.resource = ResourceType.FOOD;
          else if (rng.next() < 0.10) tile.resource = ResourceType.STONE;
          else if (rng.next() < 0.06) tile.resource = ResourceType.IRON;
        }
      }
    }
  }

  return {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.VOLCANIC,
    volcanoes, lavaRivers,
  };
}

// ============================================
// ARCHIPELAGO MAP GENERATOR
// Tropical island chain: scattered islands in bright turquoise ocean,
// sandy beaches, dense jungles, coral reefs, and mountain peaks.
// ============================================

interface ArchIsland {
  center: { q: number; r: number };
  radius: number;
  elevation: number;
  type: 'home' | 'large' | 'medium' | 'small' | 'reef';
  resources: ResourceType[];
}

export interface ArchipelagoMap extends GameMap {
  islands: ArchIsland[];
}

class ArchRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class ArchNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) => (this.perm[(this.perm[a & 255] + b) & 255] & 0xffffff) / 0xffffff;
    return h(ix, iy) * (1 - sx) * (1 - sy) + h(ix + 1, iy) * sx * (1 - sy) +
           h(ix, iy + 1) * (1 - sx) * sy + h(ix + 1, iy + 1) * sx * sy;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return val / max;
  }
}

export function generateArchipelagoMap(size: number, seed?: number, playerCount: number = 2): ArchipelagoMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new ArchRng(actualSeed);
  const noise = new ArchNoise(actualSeed);
  const tiles = new Map<string, Tile>();
  const offsets = [-0.5, 0, 0.5];

  // ── Step 1: Place islands ──
  const islands: ArchIsland[] = [];
  const BASE_INSET = 6;

  // Home islands at corners
  const homePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },
    { q: size - 1 - BASE_INSET, r: BASE_INSET },
    { q: BASE_INSET, r: BASE_INSET },
    { q: size - 1 - BASE_INSET, r: size - 1 - BASE_INSET },
  ];
  for (let i = 0; i < playerCount; i++) {
    islands.push({
      center: homePositions[i],
      radius: rng.range(6, 8),
      elevation: 4,
      type: 'home',
      resources: [ResourceType.WOOD, ResourceType.FOOD, ResourceType.STONE],
    });
  }

  // Large resource islands — placed between players with good separation
  const center = Math.floor(size / 2);
  const largeCount = rng.range(2, 3);
  for (let i = 0; i < largeCount; i++) {
    const angle = (i / largeCount) * Math.PI * 2 + rng.next() * 0.5;
    const dist = size * 0.18 + rng.next() * size * 0.1;
    const lq = center + Math.round(Math.cos(angle) * dist);
    const lr = center + Math.round(Math.sin(angle) * dist);
    if (lq < 3 || lr < 3 || lq >= size - 3 || lr >= size - 3) continue;
    islands.push({
      center: { q: lq, r: lr },
      radius: rng.range(5, 7),
      elevation: rng.range(4, 6),
      type: 'large',
      resources: [ResourceType.IRON, ResourceType.CRYSTAL, ResourceType.STONE, ResourceType.WOOD],
    });
  }

  // Medium islands scattered around
  const medCount = rng.range(5, 8);
  for (let i = 0; i < medCount; i++) {
    const mq = rng.range(5, size - 6);
    const mr = rng.range(5, size - 6);
    const tooClose = islands.some(isl => {
      const d = Math.sqrt((mq - isl.center.q) ** 2 + (mr - isl.center.r) ** 2);
      return d < isl.radius + 5;
    });
    if (tooClose) continue;
    const resPool: ResourceType[][] = [
      [ResourceType.WOOD, ResourceType.FOOD],
      [ResourceType.GOLD, ResourceType.STONE],
      [ResourceType.IRON, ResourceType.WOOD],
      [ResourceType.CRYSTAL, ResourceType.STONE],
      [ResourceType.FOOD, ResourceType.GOLD],
    ];
    islands.push({
      center: { q: mq, r: mr },
      radius: rng.range(3, 5),
      elevation: rng.range(3, 5),
      type: 'medium',
      resources: resPool[i % resPool.length],
    });
  }

  // Small islands and reef clusters
  const smallCount = rng.range(6, 10);
  for (let i = 0; i < smallCount; i++) {
    const sq = rng.range(3, size - 4);
    const sr = rng.range(3, size - 4);
    const tooClose = islands.some(isl => {
      const d = Math.sqrt((sq - isl.center.q) ** 2 + (sr - isl.center.r) ** 2);
      return d < isl.radius + 3;
    });
    if (tooClose) continue;
    const isReef = rng.next() < 0.3;
    islands.push({
      center: { q: sq, r: sr },
      radius: isReef ? rng.range(2, 3) : rng.range(1, 3),
      elevation: isReef ? 1 : rng.range(2, 3),
      type: isReef ? 'reef' : 'small',
      resources: isReef ? [ResourceType.GOLD] : [ResourceType.FOOD, ResourceType.STONE],
    });
  }

  // ── Step 2: Fill ocean tiles ──
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const key = `${q},${r}`;
      // Ocean: water tile with blue water blocks
      const blocks: VoxelBlock[] = [];
      for (const lx of offsets) {
        for (const lz of offsets) {
          blocks.push({
            localPosition: { x: lx, y: 0, z: lz },
            type: BlockType.WATER,
            health: 100, maxHealth: 100,
          });
        }
      }
      tiles.set(key, {
        position: { q, r },
        terrain: TerrainType.WATER,
        elevation: 1,
        walkableFloor: 1,
        resource: null,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: false, heightMap: [[1]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 3: Stamp islands onto ocean ──
  for (const island of islands) {
    const { center: ic, radius, elevation } = island;

    for (let dq = -radius - 2; dq <= radius + 2; dq++) {
      for (let dr = -radius - 2; dr <= radius + 2; dr++) {
        const q = ic.q + dq;
        const r = ic.r + dr;
        if (q < 0 || r < 0 || q >= size || r >= size) continue;

        const dist = Math.sqrt(dq * dq + dr * dr);
        const edgeNoise = noise.fbm(q * 0.3 + 50, r * 0.3 + 50, 2);
        const effectiveRadius = radius * (0.8 + edgeNoise * 0.4);

        if (dist > effectiveRadius + 1.5) continue; // beyond reef zone

        const key = `${q},${r}`;
        const edgeFactor = dist / effectiveRadius;

        // Terrain zone noise
        const hillNoise = noise.fbm(q * 0.15, r * 0.15, 3);
        const jungleNoise = noise.fbm(q * 0.2 + 100, r * 0.2 + 100, 2);

        let tileElev = elevation + Math.round(hillNoise * 2 - 0.5);
        let terrain = TerrainType.JUNGLE;
        let topBlock = BlockType.TROPICAL_GRASS;
        let subBlock = BlockType.DIRT;
        let resource: ResourceType | null = null;

        if (island.type === 'reef' || (dist > effectiveRadius && dist <= effectiveRadius + 1.5)) {
          // ── Coral reef: shallow water with coral blocks ──
          terrain = TerrainType.WATER;
          tileElev = 1;
          topBlock = BlockType.CORAL;
          subBlock = BlockType.SAND;
          if (rng.next() < 0.15) resource = ResourceType.GOLD;
        } else if (edgeFactor > 0.7) {
          // ── Beach ring: sandy shoreline ──
          terrain = TerrainType.DESERT;
          tileElev = Math.max(2, elevation - 1);
          topBlock = BlockType.SAND;
          subBlock = BlockType.SAND;
          if (rng.next() < 0.06) resource = ResourceType.GOLD;
          if (rng.next() < 0.05) resource = ResourceType.FOOD;
        } else if (hillNoise > 0.65 && edgeFactor < 0.5 && island.type !== 'small') {
          // ── Mountain peak: rocky interior ──
          terrain = TerrainType.MOUNTAIN;
          tileElev = elevation + 2 + Math.round(hillNoise * 2);
          topBlock = BlockType.STONE;
          subBlock = BlockType.STONE;
          if (island.resources.includes(ResourceType.CRYSTAL) && rng.next() < 0.12) {
            resource = ResourceType.CRYSTAL;
          } else if (island.resources.includes(ResourceType.IRON) && rng.next() < 0.15) {
            resource = ResourceType.IRON;
          } else if (rng.next() < 0.08) {
            resource = ResourceType.STONE;
          }
        } else if (jungleNoise > 0.45 && edgeFactor < 0.65) {
          // ── Dense jungle: tall trees, wood ──
          terrain = TerrainType.JUNGLE;
          topBlock = BlockType.TROPICAL_GRASS;
          subBlock = BlockType.DIRT;
          if (island.resources.includes(ResourceType.WOOD) && rng.next() < 0.15) {
            resource = ResourceType.WOOD;
          }
        } else {
          // ── Tropical clearing: grass plains ──
          terrain = TerrainType.PLAINS;
          topBlock = BlockType.TROPICAL_GRASS;
          subBlock = BlockType.DIRT;
          if (island.resources.includes(ResourceType.FOOD) && rng.next() < 0.12) {
            resource = ResourceType.FOOD;
          }
        }

        tileElev = Math.max(1, Math.min(tileElev, 12));

        // ── Build voxel column ──
        const blocks: VoxelBlock[] = [];
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = 0; y < tileElev; y++) {
              let blockType: BlockType;
              if (terrain === TerrainType.WATER) {
                // Reef: coral on top, sand below
                blockType = y === tileElev - 1 ? topBlock : subBlock;
              } else if (y === tileElev - 1) {
                blockType = topBlock;
              } else if (y >= tileElev - 3) {
                blockType = subBlock;
              } else {
                blockType = BlockType.STONE;
              }
              blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: blockType, health: 100, maxHealth: 100,
              });
            }
          }
        }

        // ── Inject ore veins ──
        if (resource === ResourceType.IRON) {
          for (const b of blocks) {
            if (b.type === BlockType.STONE && b.localPosition.y < tileElev - 2 && rng.next() < 0.25) {
              b.type = BlockType.IRON;
            }
          }
        }
        if (resource === ResourceType.CRYSTAL) {
          for (const b of blocks) {
            if (b.type === BlockType.STONE && b.localPosition.y < tileElev - 1 && rng.next() < 0.20) {
              b.type = BlockType.CRYSTAL;
            }
          }
        }

        tiles.set(key, {
          position: { q, r },
          terrain,
          elevation: tileElev,
          walkableFloor: tileElev,
          resource,
          improvement: null,
          unit: null,
          owner: null,
          voxelData: { blocks, destructible: terrain !== TerrainType.WATER, heightMap: [[tileElev]] },
          visible: true,
          explored: true,
        });
      }
    }
  }

  // ── Step 4: Sand bar bridges so units can traverse between islands ──
  // Connect each home island to its nearest non-home island,
  // then connect large/medium islands to each other to form a traversable network.
  const bridged = new Set<string>();

  function bridgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  function stampBridge(fromIsland: ArchIsland, toIsland: ArchIsland): void {
    const fq = fromIsland.center.q;
    const fr = fromIsland.center.r;
    const tq = toIsland.center.q;
    const tr = toIsland.center.r;
    const dist = Math.sqrt((tq - fq) ** 2 + (tr - fr) ** 2);
    const steps = Math.ceil(dist);

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bq = Math.round(fq + (tq - fq) * t);
      const br = Math.round(fr + (tr - fr) * t);
      if (bq < 0 || br < 0 || bq >= size || br >= size) continue;

      // Wobble the path slightly for natural look
      const wobble = Math.sin(s * 0.7 + actualSeed * 0.01) * 0.8;
      const perpQ = -(tr - fr) / dist;
      const perpR = (tq - fq) / dist;
      const wq = Math.round(bq + perpQ * wobble);
      const wr = Math.round(br + perpR * wobble);

      // Stamp a 1-2 tile wide sand bar at this position
      for (const [dq, dr] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][]) {
        const sq = (dq === 0 && dr === 0) ? wq : wq + dq;
        const sr = (dq === 0 && dr === 0) ? wr : wr + dr;
        if (sq < 0 || sr < 0 || sq >= size || sr >= size) continue;

        // Only place bridge on water tiles (don't overwrite island terrain)
        const key = `${sq},${sr}`;
        const existing = tiles.get(key);
        if (!existing || existing.terrain !== TerrainType.WATER) continue;

        // Skip outer ring of the path to keep it narrow (only center + cardinal neighbors at 50% chance)
        if (dq !== 0 || dr !== 0) {
          if (rng.next() > 0.5) continue;
        }

        const bridgeElev = 2;
        const blocks: VoxelBlock[] = [];
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = 0; y < bridgeElev; y++) {
              blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: BlockType.SAND,
                health: 100, maxHealth: 100,
              });
            }
          }
        }
        tiles.set(key, {
          position: { q: sq, r: sr },
          terrain: TerrainType.DESERT, // walkable sand
          elevation: bridgeElev,
          walkableFloor: bridgeElev,
          resource: null,
          improvement: null,
          unit: null,
          owner: null,
          voxelData: { blocks, destructible: true, heightMap: [[bridgeElev]] },
          visible: true,
          explored: true,
        });
      }
    }
  }

  // Connect each home island to its nearest non-home island
  for (let i = 0; i < islands.length; i++) {
    if (islands[i].type !== 'home') continue;
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < islands.length; j++) {
      if (i === j) continue;
      if (islands[j].type === 'reef') continue; // don't bridge to tiny reefs
      const d = Math.sqrt(
        (islands[i].center.q - islands[j].center.q) ** 2 +
        (islands[i].center.r - islands[j].center.r) ** 2
      );
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    if (bestIdx >= 0) {
      const bk = bridgeKey(i, bestIdx);
      if (!bridged.has(bk)) {
        stampBridge(islands[i], islands[bestIdx]);
        bridged.add(bk);
      }
    }
  }

  // Connect large/medium islands to their nearest neighbor for a traversable network
  for (let i = 0; i < islands.length; i++) {
    if (islands[i].type !== 'large' && islands[i].type !== 'medium') continue;
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < islands.length; j++) {
      if (i === j) continue;
      if (islands[j].type === 'reef' || islands[j].type === 'small') continue;
      const bk = bridgeKey(i, j);
      if (bridged.has(bk)) continue;
      const d = Math.sqrt(
        (islands[i].center.q - islands[j].center.q) ** 2 +
        (islands[i].center.r - islands[j].center.r) ** 2
      );
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestDist < size * 0.6) {
      const bk = bridgeKey(i, bestIdx);
      if (!bridged.has(bk)) {
        stampBridge(islands[i], islands[bestIdx]);
        bridged.add(bk);
      }
    }
  }

  return {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.ARCHIPELAGO,
    islands,
  };
}

// ============================================
// TUNDRA / FROZEN WASTE MAP GENERATOR
// Barren frozen landscape: windswept snow plains, frozen lakes,
// icy ridges, sparse pine groves, and scarce resources.
// ============================================

export interface TundraMap extends GameMap {
  frozenLakes: Array<{ center: { q: number; r: number }; radius: number }>;
}

class TundraRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class TundraNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 12345) & 0x7fffffff;
      this.perm.push(i);
    }
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
    }
  }
  private fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  noise2d(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const aa = this.perm[(this.perm[X] + Y) & 255];
    const ab = this.perm[(this.perm[X] + Y + 1) & 255];
    const ba = this.perm[(this.perm[(X + 1) & 255] + Y) & 255];
    const bb = this.perm[(this.perm[(X + 1) & 255] + Y + 1) & 255];
    return this.lerp(
      this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
      this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
      v,
    );
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return (val / max + 1) * 0.5; // normalise to 0..1
  }
}

export function generateTundraMap(size: number, seed?: number, playerCount: number = 2): TundraMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new TundraRng(actualSeed);
  const noise = new TundraNoise(actualSeed);
  const tiles = new Map<string, Tile>();
  const offsets = [-0.5, 0, 0.5];

  // ── Step 1: Generate base terrain ──
  // Mostly flat with gentle rolling hills and occasional sharp ridges
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const nx = q * 0.08;
      const ny = r * 0.08;

      // Base elevation: gentle rolling tundra
      const baseElev = noise.fbm(nx, ny, 3);
      // Ridge noise: sharp icy ridges cutting through the landscape
      const ridgeRaw = noise.fbm(q * 0.04 + 200, r * 0.04 + 200, 2);
      const ridgeFactor = Math.pow(Math.abs(ridgeRaw * 2 - 1), 0.5) * 0.4;

      let elev = Math.round(baseElev * 5 + ridgeFactor * 4 + 2);
      elev = Math.max(2, Math.min(elev, 10));

      // Determine terrain type using noise layers
      const moistureNoise = noise.fbm(q * 0.12 + 50, r * 0.12 + 50, 2);
      const forestNoise = noise.fbm(q * 0.15 + 150, r * 0.15 + 150, 2);

      let terrain: TerrainType;
      let topBlock: BlockType;
      let subBlock: BlockType;
      let resource: ResourceType | null = null;

      if (elev >= 7 && ridgeFactor > 0.15) {
        // ── Icy ridge peaks ──
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.ICE;
        subBlock = BlockType.STONE;
        if (rng.next() < 0.08) resource = ResourceType.CRYSTAL;
        else if (rng.next() < 0.06) resource = ResourceType.IRON;
      } else if (elev >= 6) {
        // ── Snowy highlands ──
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.PACKED_SNOW;
        subBlock = BlockType.STONE;
        if (rng.next() < 0.06) resource = ResourceType.STONE;
        else if (rng.next() < 0.04) resource = ResourceType.IRON;
      } else if (forestNoise > 0.58 && elev >= 3 && elev <= 5) {
        // ── Sparse pine forest ──
        terrain = TerrainType.FOREST;
        topBlock = BlockType.PACKED_SNOW;
        subBlock = BlockType.FROZEN_DIRT;
        if (rng.next() < 0.12) resource = ResourceType.WOOD;
      } else if (moistureNoise < 0.32 && elev <= 3) {
        // ── Frozen lake beds (will be overridden in Step 2) ──
        terrain = TerrainType.PLAINS;
        topBlock = BlockType.PACKED_SNOW;
        subBlock = BlockType.FROZEN_DIRT;
      } else {
        // ── Open snow plains ──
        terrain = TerrainType.PLAINS;
        topBlock = rng.next() < 0.7 ? BlockType.SNOW : BlockType.PACKED_SNOW;
        subBlock = BlockType.FROZEN_DIRT;
        if (rng.next() < 0.04) resource = ResourceType.FOOD;
        else if (rng.next() < 0.02) resource = ResourceType.GOLD;
      }

      // Build voxel column
      const blocks: VoxelBlock[] = [];
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = 0; y < elev; y++) {
            let blockType: BlockType;
            if (y === elev - 1) {
              blockType = topBlock;
            } else if (y >= elev - 3) {
              blockType = subBlock;
            } else {
              blockType = BlockType.STONE;
            }
            blocks.push({
              localPosition: { x: lx, y, z: lz },
              type: blockType, health: 100, maxHealth: 100,
            });
          }
        }
      }

      tiles.set(`${q},${r}`, {
        position: { q, r },
        terrain,
        elevation: elev,
        walkableFloor: elev,
        resource,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: true, heightMap: [[elev]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 2: Stamp frozen lakes ──
  const frozenLakes: Array<{ center: { q: number; r: number }; radius: number }> = [];
  const lakeCount = rng.range(3, 6);
  for (let i = 0; i < lakeCount; i++) {
    const lq = rng.range(8, size - 9);
    const lr = rng.range(8, size - 9);
    // Don't place too close to other lakes
    const tooClose = frozenLakes.some(lake => {
      const d = Math.sqrt((lq - lake.center.q) ** 2 + (lr - lake.center.r) ** 2);
      return d < lake.radius + 6;
    });
    if (tooClose) continue;

    const lakeRadius = rng.range(3, 6);
    frozenLakes.push({ center: { q: lq, r: lr }, radius: lakeRadius });

    for (let dq = -lakeRadius - 1; dq <= lakeRadius + 1; dq++) {
      for (let dr = -lakeRadius - 1; dr <= lakeRadius + 1; dr++) {
        const q = lq + dq;
        const r = lr + dr;
        if (q < 0 || r < 0 || q >= size || r >= size) continue;

        const dist = Math.sqrt(dq * dq + dr * dr);
        const edgeNoise = noise.fbm(q * 0.4 + 300, r * 0.4 + 300, 2);
        const effectiveRadius = lakeRadius * (0.8 + edgeNoise * 0.4);

        if (dist > effectiveRadius) continue;

        const key = `${q},${r}`;
        const lakeElev = 2;

        // Frozen lake: flat ice surface
        const blocks: VoxelBlock[] = [];
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = 0; y < lakeElev; y++) {
              blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: y === lakeElev - 1 ? BlockType.ICE : BlockType.FROZEN_DIRT,
                health: 100, maxHealth: 100,
              });
            }
          }
        }

        // Edge tiles get a snowy shore
        const isEdge = dist > effectiveRadius - 1.2;

        tiles.set(key, {
          position: { q, r },
          terrain: isEdge ? TerrainType.PLAINS : TerrainType.WATER,
          elevation: lakeElev,
          walkableFloor: lakeElev, // frozen = walkable!
          resource: (rng.next() < 0.06 && !isEdge) ? ResourceType.GOLD : null,
          improvement: null,
          unit: null,
          owner: null,
          voxelData: { blocks, destructible: false, heightMap: [[lakeElev]] },
          visible: true,
          explored: true,
        });
      }
    }
  }

  // ── Step 3: Place resource clusters (scarce!) ──
  // Crystal veins near ridges
  const crystalClusters = rng.range(2, 4);
  for (let c = 0; c < crystalClusters; c++) {
    const cq = rng.range(5, size - 6);
    const cr = rng.range(5, size - 6);
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (rng.next() > 0.6) continue;
        const key = `${cq + dq},${cr + dr}`;
        const tile = tiles.get(key);
        if (tile && tile.terrain === TerrainType.MOUNTAIN) {
          tile.resource = ResourceType.CRYSTAL;
          // Inject crystal blocks into subsurface
          for (const b of tile.voxelData.blocks) {
            if (b.type === BlockType.STONE && b.localPosition.y < tile.elevation - 2 && rng.next() < 0.3) {
              b.type = BlockType.CRYSTAL;
            }
          }
        }
      }
    }
  }

  // Iron deposits in highlands
  const ironClusters = rng.range(3, 5);
  for (let c = 0; c < ironClusters; c++) {
    const iq = rng.range(5, size - 6);
    const ir = rng.range(5, size - 6);
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (rng.next() > 0.5) continue;
        const key = `${iq + dq},${ir + dr}`;
        const tile = tiles.get(key);
        if (tile && (tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.PLAINS)) {
          tile.resource = ResourceType.IRON;
          for (const b of tile.voxelData.blocks) {
            if (b.type === BlockType.STONE && rng.next() < 0.25) {
              b.type = BlockType.IRON;
            }
          }
        }
      }
    }
  }

  // Compute shell blocks so terrain has proper underground depth
  // (reskinTundra in MapInitializer swaps GRASS/DIRT → frozen variants afterward)
  const tundraMap: TundraMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.TUNDRA,
    frozenLakes,
  };
  const shellGen = new MapGenerator();
  shellGen.computeShellBlocks(tundraMap, size, size);

  return tundraMap;
}

// ============================================
// SUNKEN RUINS MAP GENERATOR
// Ancient overgrown civilization with temple ruins
// ============================================

class RuinsRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class RuinsNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) => (this.perm[(this.perm[a & 255] + b) & 255] & 0xffffff) / 0xffffff;
    return h(ix, iy) * (1 - sx) * (1 - sy) + h(ix + 1, iy) * sx * (1 - sy) +
           h(ix, iy + 1) * (1 - sx) * sy + h(ix + 1, iy + 1) * sx * sy;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return val / max;
  }
}

export function generateSunkenRuinsMap(size: number, seed?: number, playerCount: number = 2): GameMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new RuinsRng(actualSeed);
  const noise = new RuinsNoise(actualSeed);
  const tiles = new Map<string, Tile>();
  const offsets = [-0.5, 0, 0.5];

  // ── Step 1: Base terrain with multi-layered ruins and elevation variety ──
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const ruinsNoise = noise.fbm(q * 0.08, r * 0.08, 3);
      const platformNoise = noise.fbm(q * 0.06 + 100, r * 0.06 + 100, 2);
      const lushNoise = noise.fbm(q * 0.1 + 200, r * 0.1 + 200, 2);

      // Base elevation with platform zones
      let elev = Math.round(ruinsNoise * 5 + platformNoise * 3 + 2);
      elev = Math.max(2, Math.min(elev, 10));

      let terrain: TerrainType;
      let topBlock: BlockType;
      let subBlock: BlockType;
      let resource: ResourceType | null = null;

      if (ruinsNoise > 0.65) {
        // High noise = ruins zones with stone and ancient brick
        terrain = TerrainType.MOUNTAIN;
        topBlock = rng.next() < 0.6 ? BlockType.MOSSY_STONE : BlockType.ANCIENT_BRICK;
        subBlock = BlockType.ANCIENT_BRICK;
        if (rng.next() < 0.08) resource = ResourceType.CRYSTAL;
        else if (rng.next() < 0.06) resource = ResourceType.STONE;
      } else if (ruinsNoise > 0.4) {
        // Medium noise = overgrown floor
        terrain = TerrainType.FOREST;
        topBlock = BlockType.MOSSY_STONE;
        subBlock = BlockType.DIRT;
        if (rng.next() < 0.06) resource = ResourceType.IRON;
      } else {
        // Low noise = vine-covered paths
        terrain = TerrainType.FOREST;
        topBlock = BlockType.GRASS;
        subBlock = BlockType.DIRT;
        if (rng.next() < 0.04) resource = ResourceType.FOOD;
      }

      // Build voxel column
      const blocks: VoxelBlock[] = [];
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = 0; y < elev; y++) {
            let blockType: BlockType;
            if (y === elev - 1) blockType = topBlock;
            else if (y >= elev - 2) blockType = subBlock;
            else blockType = BlockType.STONE;
            blocks.push({
              localPosition: { x: lx, y, z: lz },
              type: blockType, health: 100, maxHealth: 100,
            });
          }
        }
      }

      tiles.set(`${q},${r}`, {
        position: { q, r },
        terrain,
        elevation: elev,
        walkableFloor: elev,
        resource,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: true, heightMap: [[elev]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 2: Scatter ruin structures (pillars and walls) ──
  const numStructures = rng.range(8, 15);
  for (let s = 0; s < numStructures; s++) {
    const sq = rng.range(6, size - 7);
    const sr = rng.range(6, size - 7);
    const key = `${sq},${sr}`;
    const centerTile = tiles.get(key);
    if (!centerTile) continue;

    if (rng.next() < 0.5) {
      // Pillar: 2x2 area of RUIN_PILLAR going up 2-4 above surface
      const pillarHeight = centerTile.elevation + rng.range(2, 4);
      for (let dq = 0; dq <= 1; dq++) {
        for (let dr = 0; dr <= 1; dr++) {
          const pq = sq + dq;
          const pr = sr + dr;
          const pk = `${pq},${pr}`;
          const tile = tiles.get(pk);
          if (!tile) continue;
          // Add pillar blocks
          for (const lx of offsets) {
            for (const lz of offsets) {
              for (let y = tile.elevation; y < pillarHeight; y++) {
                tile.voxelData.blocks.push({
                  localPosition: { x: lx, y, z: lz },
                  type: BlockType.RUIN_PILLAR,
                  health: 100, maxHealth: 100,
                });
              }
            }
          }
        }
      }
    } else {
      // Wall segment: line of ANCIENT_BRICK
      const wallLength = rng.range(3, 6);
      const isHorizontal = rng.next() < 0.5;
      const wallHeight = rng.range(1, 3);
      for (let w = 0; w < wallLength; w++) {
        const wq = sq + (isHorizontal ? w : 0);
        const wr = sr + (isHorizontal ? 0 : w);
        const wk = `${wq},${wr}`;
        const tile = tiles.get(wk);
        if (!tile) continue;
        for (const lx of offsets) {
          for (const lz of offsets) {
            for (let y = tile.elevation; y < tile.elevation + wallHeight; y++) {
              tile.voxelData.blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: BlockType.ANCIENT_BRICK,
                health: 100, maxHealth: 100,
              });
            }
          }
        }
      }
    }
  }

  // ── Step 3: Place base areas with flattening ──
  const BASE_INSET = 5;
  const basePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },
    { q: size - 1 - BASE_INSET, r: BASE_INSET },
  ];
  for (const bp of basePositions) {
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = -4; dr <= 4; dr++) {
        if (Math.abs(dq) + Math.abs(dr) > 5) continue;
        const bq = bp.q + dq;
        const br = bp.r + dr;
        const bk = `${bq},${br}`;
        const tile = tiles.get(bk);
        if (tile) {
          tile.elevation = 3;
          tile.walkableFloor = 3;
          tile.terrain = TerrainType.FOREST;
          tile.voxelData.blocks = [];
          for (const lx of offsets) {
            for (const lz of offsets) {
              for (let y = 0; y < 3; y++) {
                tile.voxelData.blocks.push({
                  localPosition: { x: lx, y, z: lz },
                  type: y === 2 ? BlockType.MOSSY_STONE : BlockType.STONE,
                  health: 100, maxHealth: 100,
                });
              }
            }
          }
          tile.voxelData.heightMap = [[3]];
        }
      }
    }
  }

  const ruinsMap: GameMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.SUNKEN_RUINS,
  };
  const shellGen = new MapGenerator();
  shellGen.computeShellBlocks(ruinsMap, size, size);

  return ruinsMap;
}

// ============================================
// BADLANDS MAP GENERATOR
// Scorched red clay with mesas and riverbeds
// ============================================

class BadlandsRng {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 16807 + 0) % 2147483647;
    return (this.state & 0xffffff) / 0xffffff;
  }
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

class BadlandsNoise {
  private perm: number[];
  constructor(seed: number) {
    this.perm = [];
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 16807 + 0) % 2147483647;
      this.perm.push(s);
    }
  }
  noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & 255;
    const iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) => (this.perm[(this.perm[a & 255] + b) & 255] & 0xffffff) / 0xffffff;
    return h(ix, iy) * (1 - sx) * (1 - sy) + h(ix + 1, iy) * sx * (1 - sy) +
           h(ix, iy + 1) * (1 - sx) * sy + h(ix + 1, iy + 1) * sx * sy;
  }
  fbm(x: number, y: number, octaves: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise2d(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return val / max;
  }
}

export function generateBadlandsMap(size: number, seed?: number, playerCount: number = 2): GameMap {
  const actualSeed = seed ?? GameRNG.rng.nextRange(0, 999999);
  const rng = new BadlandsRng(actualSeed);
  const noise = new BadlandsNoise(actualSeed);
  const tiles = new Map<string, Tile>();
  const offsets = [-0.5, 0, 0.5];

  // ── Step 1: Base terrain with mesa formations ──
  for (let q = 0; q < size; q++) {
    for (let r = 0; r < size; r++) {
      const mesaNoise = noise.fbm(q * 0.06, r * 0.06, 2);
      const riverNoise = noise.fbm(q * 0.08 + 100, r * 0.08 + 100, 2);
      const terrainNoise = noise.fbm(q * 0.1 + 200, r * 0.1 + 200, 2);

      let elev = 2;
      let terrain: TerrainType;
      let topBlock: BlockType;
      let subBlock: BlockType;
      let resource: ResourceType | null = null;

      // Mesa formation logic
      if (mesaNoise > 0.72) {
        // Very high noise = mesa top with steep cliff sides
        elev = 6 + Math.floor((mesaNoise - 0.72) * 20);
        elev = Math.min(8, elev);
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.RED_CLAY;
        subBlock = BlockType.MESA_STONE;
        if (rng.next() < 0.12) resource = ResourceType.IRON;
      } else if (mesaNoise > 0.55) {
        // High noise = mesa slope (steep terrain between mesa and floor)
        elev = 4 + Math.floor((mesaNoise - 0.55) * 10);
        terrain = TerrainType.MOUNTAIN;
        topBlock = BlockType.MESA_STONE;
        subBlock = BlockType.MESA_STONE;
      } else if (riverNoise < 0.3 && terrainNoise > 0.5) {
        // Dried riverbeds at lowest elevation
        elev = 1;
        terrain = TerrainType.DESERT;
        topBlock = BlockType.SAND;
        subBlock = BlockType.CRACKED_EARTH;
        if (rng.next() < 0.10) resource = ResourceType.GOLD;
      } else {
        // Flat desert floor
        elev = 2;
        terrain = TerrainType.PLAINS;
        topBlock = BlockType.CRACKED_EARTH;
        subBlock = BlockType.RED_CLAY;
        if (rng.next() < 0.08) resource = ResourceType.STONE;
      }

      // Build voxel column
      const blocks: VoxelBlock[] = [];
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = 0; y < elev; y++) {
            let blockType: BlockType;
            if (y === elev - 1) blockType = topBlock;
            else if (y >= elev - 2) blockType = subBlock;
            else blockType = BlockType.STONE;
            blocks.push({
              localPosition: { x: lx, y, z: lz },
              type: blockType, health: 100, maxHealth: 100,
            });
          }
        }
      }

      tiles.set(`${q},${r}`, {
        position: { q, r },
        terrain,
        elevation: elev,
        walkableFloor: elev,
        resource,
        improvement: null,
        unit: null,
        owner: null,
        voxelData: { blocks, destructible: true, heightMap: [[elev]] },
        visible: true,
        explored: true,
      });
    }
  }

  // ── Step 2: Place base areas with flattening ──
  const BASE_INSET = 5;
  const basePositions = [
    { q: BASE_INSET, r: size - 1 - BASE_INSET },
    { q: size - 1 - BASE_INSET, r: BASE_INSET },
  ];
  for (const bp of basePositions) {
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = -4; dr <= 4; dr++) {
        if (Math.abs(dq) + Math.abs(dr) > 5) continue;
        const bq = bp.q + dq;
        const br = bp.r + dr;
        const bk = `${bq},${br}`;
        const tile = tiles.get(bk);
        if (tile) {
          tile.elevation = 2;
          tile.walkableFloor = 2;
          tile.terrain = TerrainType.PLAINS;
          tile.voxelData.blocks = [];
          for (const lx of offsets) {
            for (const lz of offsets) {
              for (let y = 0; y < 2; y++) {
                tile.voxelData.blocks.push({
                  localPosition: { x: lx, y, z: lz },
                  type: y === 1 ? BlockType.CRACKED_EARTH : BlockType.RED_CLAY,
                  health: 100, maxHealth: 100,
                });
              }
            }
          }
          tile.voxelData.heightMap = [[2]];
        }
      }
    }
  }

  const badlandsMap: GameMap = {
    width: size, height: size, tiles, seed: actualSeed, mapType: MapType.BADLANDS,
  };
  const shellGen = new MapGenerator();
  shellGen.computeShellBlocks(badlandsMap, size, size);

  return badlandsMap;
}
