/**
 * MapInitializer — Handles map setup for new games.
 *
 * Responsibilities:
 * - Generate map from preset/generator
 * - Smooth terrain around bases (player capitals and neutral outposts)
 * - Seed forests near bases
 * - Build voxel terrain
 * - Decorate tiles (trees, grass, etc.)
 * - Place water decorations (ocean plane, waterfalls)
 * - Set up base placement and capture zones
 * - Place arena walls if needed
 * - Initialize grass/forest tracking for NatureSystem
 *
 * Integration:
 * - Instantiate with MapInitOps
 * - Call setupMap() from startNewGame()
 * - Returns the initialized GameMap with all decorations/terrain built
 */

import * as THREE from 'three';
import { Pathfinder, tileKey } from '../game/systems/Pathfinder';
import { MapGenerator } from './MapGenerator';
import { Logger } from '../engine/Logger';
import {
  GameMap,
  HexCoord,
  TerrainType,
  BlockType,
  MapType,
  Base,
  BaseTier,
  VoxelBlock,
  ENABLE_UNDERGROUND,
} from '../types';
import { getPreset, generateArenaMap, generateDesertTunnelsMap, generateSkylandMap, generateVolcanicMap, generateArchipelagoMap, generateTundraMap, generateSunkenRuinsMap, generateBadlandsMap, ArenaMap, DesertTunnelsMap, SkylandMap, VolcanicMap, ArchipelagoMap, TundraMap, MAP_GEN_PARAMS } from './MapPresets';
import { NEUTRAL_OWNER } from './PlayerConfig';

/**
 * Slim interface — only what MapInitializer needs from the outside.
 * Follows the pattern of RallyPointOps, WallSystemOps, etc.
 */
export interface MapInitOps {
  // Scene management
  addToScene(mesh: THREE.Object3D): void;
  removeFromScene(mesh: THREE.Object3D): void;

  // VoxelBuilder access
  addBlock(pos: { x: number; y: number; z: number }, blockType: BlockType): void;
  setSliceY(y: number | null): void;

  // TerrainDecorator access
  decorateTile(pos: HexCoord, terrain: TerrainType, scaledElev: number, maxNeighborElev: number, resource: any): void;
  setDecorationClipPlane(plane: THREE.Plane | null): void;
  removeDecoration(pos: HexCoord): void;
  addWaterEdgeCurtain(worldX: number, scaledElev: number, worldZ: number, faceDx: number, faceDz: number, dropHeight: number): void;

  // BaseRenderer access
  addBase(base: Base, elevation: number): void;

  // WallSystem access
  placeWallDirect(pos: HexCoord, owner: number): void;
  placeGateDirect(pos: HexCoord, owner: number): void;
  rebuildAllConnections(): void;

  // CaptureZoneSystem access
  disposeCaptureSystems(): void;
  addCaptureZone(base: Base, isMainBase: boolean, isUnderground: boolean): void;

  // Pathfinder/search
  findSpawnTile(map: GameMap, pq: number, pr: number, skip?: boolean): HexCoord;

  // World/elevation queries
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getElevation(pos: HexCoord): number;

  // Rebuild/visual updates
  rebuildTileShell(pos: HexCoord): void;
  isWaterTerrain(terrain: string): boolean;

  // NatureSystem access
  initializeGrassTracking(): void;
  initializeForestTracking(): void;

  // Camera setup
  setMapBounds(x0: number, y0: number, x1: number, y1: number): void;
  focusCameraOnCenter(centerQ: number, centerZ: number): void;

  // Resource/building setup
  getBaseTiles(): Set<string>;
  updateStockpileVisual(owner: number): void;

  // Debug/logging
  getDebugPanel(): any;
}

export default class MapInitializer {
  private ops: MapInitOps;
  private static readonly DEPTH = ENABLE_UNDERGROUND ? -40 : -10;

  constructor(ops: MapInitOps) {
    this.ops = ops;
  }

  /**
   * Rebuild a tile's voxel blocks in-place from its current elevation/terrain.
   * Works during init (before this.currentMap is set) — operates directly on
   * the tile object without needing the full game context.
   * Produces a clean solid column with NO ridge/snow cap blocks.
   */
  private rebuildTileBlocksDirect(map: GameMap, coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const tile = map.tiles.get(key);
    if (!tile) return;

    const height = tile.elevation;
    const terrain = height <= 2 ? TerrainType.PLAINS : tile.terrain;
    const offsets = [-0.5, 0, 0.5];
    const blocks: VoxelBlock[] = [];

    // Surface block type — match MapGenerator.generateShellColumn logic:
    // elevation >= 8 always gets stone (STONE_LAYER_HEIGHT)
    const isHighEnoughForStone = height >= 8;
    const topBlock = isHighEnoughForStone ? BlockType.STONE
      : terrain === TerrainType.DESERT ? BlockType.SAND
      : terrain === TerrainType.MOUNTAIN ? BlockType.STONE
      : terrain === TerrainType.SNOW ? BlockType.SNOW
      : terrain === TerrainType.JUNGLE ? BlockType.DIRT
      : BlockType.GRASS;
    const subBlock = isHighEnoughForStone ? BlockType.STONE
      : terrain === TerrainType.DESERT ? BlockType.SAND
      : terrain === TerrainType.SNOW ? BlockType.SNOW
      : terrain === TerrainType.MOUNTAIN ? BlockType.STONE
      : BlockType.DIRT;

    // Solid fill from depth to surface — no ridges, no snow caps
    for (const lx of offsets) {
      for (const lz of offsets) {
        for (let y = MapInitializer.DEPTH; y < height; y++) {
          let blockType: BlockType;
          if (y === height - 1) blockType = topBlock;
          else if (y >= height - 2) blockType = subBlock;
          else blockType = BlockType.STONE;
          blocks.push({ localPosition: { x: lx, y, z: lz }, type: blockType, health: 100, maxHealth: 100 });
        }
      }
    }

    tile.voxelData.blocks = blocks;
    tile.voxelData.heightMap = [[height]];
    tile.walkableFloor = height;
  }

  /**
   * Main entry point — sets up the complete map.
   * Called from startNewGame() after game state is reset.
   *
   * @param mapType - The map preset to generate
   * @param gameMode - 'pvai' or 'aivai'
   * @returns The initialized GameMap
   */
  public setupMap(
    mapType: MapType,
    gameMode: 'pvai' | 'aivai' | 'ffa' | '2v2',
    isArena: boolean,
    playerCount: number = 2,
  ): {
    map: GameMap;
    bases: Base[];
    /** Base coordinates for each player (index = player ID) */
    baseCoords: HexCoord[];
    /** @deprecated Use baseCoords[0] */
    p1BaseCoord: HexCoord;
    /** @deprecated Use baseCoords[1] */
    p2BaseCoord: HexCoord;
    baseInset: number;
    mapSize: number;
  } {
    // Step 1: Generate map
    const map = this.generateMap(mapType, playerCount);
    const preset = getPreset(mapType);
    const MAP_SIZE = preset.size;
    const BASE_INSET = mapType === MapType.ARENA ? 3 : 5;

    // Step 2: Calculate base positions for N players
    const arenaCenter = Math.floor(MAP_SIZE / 2);
    const basePositions: { q: number; r: number }[] = [];

    if (isArena) {
      // Arena: evenly spaced around center at equal distance for perfect symmetry.
      // Angle starts at π so P0 lands on West (matching historical convention),
      // then distributes remaining players evenly around the circle.
      const arenaOffset = Math.floor(MAP_SIZE / 2) - 7; // stay inside floor radius
      for (let i = 0; i < playerCount; i++) {
        const angle = Math.PI + (Math.PI * 2 * i) / playerCount;
        basePositions.push({
          q: arenaCenter + Math.round(Math.cos(angle) * arenaOffset),
          r: arenaCenter + Math.round(Math.sin(angle) * arenaOffset),
        });
      }
    } else {
      // Standard maps: position players based on count
      if (playerCount <= 2) {
        // Classic 2-player: opposite corners
        basePositions.push({ q: BASE_INSET, r: MAP_SIZE - 1 - BASE_INSET });         // P0: bottom-left
        basePositions.push({ q: MAP_SIZE - 1 - BASE_INSET, r: BASE_INSET });         // P1: top-right
      } else {
        // 4-player: four corners
        basePositions.push({ q: BASE_INSET, r: MAP_SIZE - 1 - BASE_INSET });         // P0: bottom-left
        basePositions.push({ q: MAP_SIZE - 1 - BASE_INSET, r: BASE_INSET });         // P1: top-right
        basePositions.push({ q: BASE_INSET, r: BASE_INSET });                         // P2: top-left
        basePositions.push({ q: MAP_SIZE - 1 - BASE_INSET, r: MAP_SIZE - 1 - BASE_INSET }); // P3: bottom-right
      }
    }

    // Step 3: Smooth terrain around ALL player bases (skip for arena)
    if (mapType !== MapType.ARENA && mapType !== MapType.SKYLAND && mapType !== MapType.ARCHIPELAGO) {
      for (const bp of basePositions) {
        this.smoothBaseArea(map, bp.q, bp.r, 3, 4, 3, TerrainType.PLAINS);
        this.seedBaseForest(map, bp.q, bp.r);
      }

      // Smooth neutral surface bases
      if (map.surfaceBases) {
        const MIN_DIST = 12;
        const hexDist = (a: HexCoord, b: HexCoord) =>
          (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((-a.q - a.r) - (-b.q - b.r))) / 2;
        const placed: HexCoord[] = [];
        for (const sb of map.surfaceBases) {
          const c = sb.center;
          // Skip if too close to ANY player base
          if (basePositions.some(bp => hexDist(c, bp) < MIN_DIST)) continue;
          if (placed.some(p => hexDist(c, p) < MIN_DIST)) continue;
          placed.push(c);
          Logger.debug('BaseSmooth', `Smoothing neutral ${sb.terrain} base at (${c.q},${c.r})`);
          this.smoothNeutralBaseArea(map, c, sb.terrain);
        }
      }
    }

    // Step 4a: Map-specific re-skin — swap standard blocks to variant materials BEFORE building meshes
    if (mapType === MapType.TUNDRA) {
      this.reskinTundra(map);
    } else if (mapType === MapType.SUNKEN_RUINS) {
      this.reskinRuins(map);
    } else if (mapType === MapType.BADLANDS) {
      this.reskinBadlands(map);
    }

    // Step 4: Build terrain voxels and decorate tiles
    this.buildTerrainAndDecorate(map);

    // Step 5: Add water decorations
    this.addOceanPlane(MAP_SIZE);

    // Step 6: Initialize nature tracking
    this.ops.initializeGrassTracking();
    this.ops.initializeForestTracking();

    // Step 7: Create bases for ALL players
    const BASE_MAX_HEALTH = 500;
    const bases: Base[] = [];
    const baseCoords: HexCoord[] = [];

    for (let i = 0; i < playerCount; i++) {
      const bp = basePositions[i];
      const coord = isArena ? { q: bp.q, r: bp.r } : this.ops.findSpawnTile(map, bp.q, bp.r);
      const wp = this.ops.hexToWorld(coord);
      const base: Base = {
        id: `base_${i}`,
        owner: i,
        position: coord,
        worldPosition: wp,
        health: BASE_MAX_HEALTH,
        maxHealth: BASE_MAX_HEALTH,
        destroyed: false,
        tier: BaseTier.CAMP,
        ogresSpawned: 0,
      };
      bases.push(base);
      baseCoords.push(coord);
    }

    // Step 8: Add ALL bases to renderer
    for (const base of bases) {
      const tile = map.tiles.get(`${base.position.q},${base.position.r}`);
      const elev = tile ? tile.elevation * 0.5 : 1;
      this.ops.addBase(base, elev);
    }

    // Step 9: Add underground/neutral bases
    this.addUndergroundBases(map, bases);
    this.addSurfaceBases(map, bases, baseCoords[0], baseCoords[1] ?? baseCoords[0]);

    // Step 10: Setup capture zones
    this.ops.disposeCaptureSystems();
    const playerBaseIds = new Set(bases.filter(b => b.owner < playerCount).map(b => b.id));
    for (const b of bases) {
      if (playerBaseIds.has(b.id)) {
        this.ops.addCaptureZone(b, true, false);
      } else {
        const bTile = map.tiles.get(`${b.position.q},${b.position.r}`);
        const bUnderground = !!bTile?.hasTunnel && b.worldPosition.y < (bTile.elevation ?? 0) * 0.5;
        this.ops.addCaptureZone(b, false, bUnderground);
      }
    }

    // Step 11: Update pathfinder and walls
    Pathfinder.blockedTiles = this.ops.getBaseTiles();
    Pathfinder.gateTiles.clear();

    // Arena: place colosseum walls
    if (isArena && (map as ArenaMap).wallPositions) {
      const arenaMap = map as ArenaMap;
      for (const pos of arenaMap.wallPositions) {
        const wallOwner = pos.q < arenaCenter ? 0 : pos.q > arenaCenter ? 1 : 0;
        this.ops.placeWallDirect(pos, wallOwner);
      }
      for (const pos of arenaMap.gatePositions) {
        const gateOwner = pos.q < arenaCenter ? 0 : pos.q > arenaCenter ? 1 : 0;
        this.ops.placeGateDirect(pos, gateOwner);
      }
      this.ops.rebuildAllConnections();
    }

    // Step 12: Camera and HUD setup
    this.ops.setMapBounds(-3, -3, MAP_SIZE * 1.5 + 3, MAP_SIZE * 1.5 + 3);
    const centerQ = Math.floor(MAP_SIZE / 2);
    const midR = Math.floor(MAP_SIZE / 2);
    this.ops.focusCameraOnCenter(centerQ * 1.5, midR * 1.5);

    // Step 13: Update stockpile visuals for all players
    for (let i = 0; i < playerCount; i++) {
      this.ops.updateStockpileVisual(i);
    }

    return {
      map,
      bases,
      baseCoords,
      p1BaseCoord: baseCoords[0],
      p2BaseCoord: baseCoords[1] ?? baseCoords[0],
      baseInset: BASE_INSET,
      mapSize: MAP_SIZE,
    };
  }

  /**
   * Generate map from preset or map generator.
   */
  private generateMap(mapType: MapType, playerCount: number = 2): GameMap {
    const preset = getPreset(mapType);
    const MAP_SIZE = preset.size;

    if (mapType === MapType.ARENA) {
      return generateArenaMap(MAP_SIZE);
    } else if (ENABLE_UNDERGROUND && mapType === MapType.DESERT_TUNNELS) {
      return generateDesertTunnelsMap(MAP_SIZE);
    } else if (mapType === MapType.SKYLAND) {
      return generateSkylandMap(MAP_SIZE, undefined, playerCount);
    } else if (mapType === MapType.VOLCANIC) {
      return generateVolcanicMap(MAP_SIZE, undefined, playerCount);
    } else if (mapType === MapType.ARCHIPELAGO) {
      return generateArchipelagoMap(MAP_SIZE, undefined, playerCount);
    } else if (mapType === MapType.TUNDRA) {
      return generateTundraMap(MAP_SIZE, undefined, playerCount);
    } else if (mapType === MapType.SUNKEN_RUINS) {
      return generateSunkenRuinsMap(MAP_SIZE, undefined, playerCount);
    } else if (mapType === MapType.BADLANDS) {
      return generateBadlandsMap(MAP_SIZE, undefined, playerCount);
    } else {
      const params = MAP_GEN_PARAMS[mapType];
      const mapGen = new MapGenerator(undefined, params);
      const gameMap = mapGen.generate(MAP_SIZE, MAP_SIZE);
      gameMap.mapType = mapType;
      return gameMap;
    }
  }

  /**
   * Smooth terrain around a base into a natural valley shape.
   * Core tiles are flat, outer tiles blend gradually toward natural elevation.
   */
  private smoothBaseArea(
    map: GameMap,
    baseQ: number,
    baseR: number,
    coreRadius: number,
    blendRadius: number,
    targetElev: number | null = 3,
    terrainOverride: TerrainType | null = TerrainType.PLAINS,
  ): void {
    // If no target elevation, use the center tile's natural elevation
    if (targetElev === null) {
      const centerTile = map.tiles.get(`${baseQ},${baseR}`);
      targetElev = centerTile ? centerTile.elevation : 3;
    }

    const totalRadius = coreRadius + blendRadius;
    const rebuilt = new Set<string>();

    for (let dq = -totalRadius; dq <= totalRadius; dq++) {
      for (let dr = -totalRadius; dr <= totalRadius; dr++) {
        const q = baseQ + dq;
        const r = baseR + dr;
        const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
        if (hexDist > totalRadius) continue;

        const key = `${q},${r}`;
        const tile = map.tiles.get(key);
        if (!tile) continue;

        let changed = false;

        if (hexDist <= coreRadius) {
          // Core: flat at target elevation, passable terrain
          if (tile.elevation !== targetElev) {
            tile.elevation = targetElev!;
            tile.walkableFloor = targetElev!;
            changed = true;
          }
          if (terrainOverride && tile.terrain !== terrainOverride && tile.terrain !== TerrainType.FOREST) {
            tile.terrain = terrainOverride;
            changed = true;
          }
          // Convert impassable terrain in core
          if (
            tile.terrain === TerrainType.MOUNTAIN ||
            tile.terrain === TerrainType.SNOW ||
            tile.terrain === TerrainType.WATER ||
            tile.terrain === TerrainType.LAKE
          ) {
            tile.terrain = terrainOverride ?? TerrainType.PLAINS;
            changed = true;
          }
        } else {
          // Blend zone: lerp elevation from target toward natural elevation
          const blendT = (hexDist - coreRadius) / blendRadius; // 0 at core edge → 1 at outer edge
          const smoothT = blendT * blendT; // quadratic ease
          const blendedElev = Math.round(targetElev! + (tile.elevation - targetElev!) * smoothT);

          if (tile.elevation !== blendedElev) {
            tile.elevation = blendedElev;
            tile.walkableFloor = blendedElev;
            changed = true;
          }
          // Soften impassable terrain in inner blend zone
          if (blendT < 0.5 && (tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.SNOW)) {
            tile.terrain = TerrainType.PLAINS;
            changed = true;
          }
        }

        if (changed) {
          this.rebuildTileBlocksDirect(map, { q, r });
          rebuilt.add(key);
        }
      }
    }

    // Rebuild immediate neighbors of modified tiles to fix cliff walls
    for (const key of rebuilt) {
      const [q, r] = key.split(',').map(Number);
      for (const n of Pathfinder.getHexNeighbors({ q, r })) {
        const nk = `${n.q},${n.r}`;
        if (!rebuilt.has(nk)) {
          this.rebuildTileBlocksDirect(map, n);
        }
      }
    }
  }

  /**
   * Smooth terrain around a neutral base — adapts to terrain type.
   * Desert bases get a flat valley. Mountain bases get a raised plateau.
   */
  private smoothNeutralBaseArea(map: GameMap, coord: HexCoord, terrain: string): void {
    if (terrain === 'mountain') {
      // Mountain fort: raised stone plateau with cleared flat top for combat.
      // Elevation 8 keeps it dramatic but safely below ridge threshold (10),
      // and leaves room for the base building + army formations.
      const PLATEAU_ELEV = 8;
      const CORE = 1;       // Tight flat fighting area
      const BLEND = 3;      // Smooth ramp down to surrounding terrain
      const totalRadius = CORE + BLEND;

      const rebuilt = new Set<string>();
      for (let dq = -totalRadius; dq <= totalRadius; dq++) {
        for (let dr = -totalRadius; dr <= totalRadius; dr++) {
          const q = coord.q + dq;
          const r = coord.r + dr;
          const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
          if (hexDist > totalRadius) continue;

          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (!tile) continue;

          let changed = false;
          if (hexDist <= CORE) {
            // Flat plateau top — force elevation and clear terrain for combat
            if (tile.elevation !== PLATEAU_ELEV) {
              tile.elevation = PLATEAU_ELEV;
              tile.walkableFloor = PLATEAU_ELEV;
              changed = true;
            }
            // Core is PLAINS so units can move freely; stone visual comes
            // from the elevation being high (stone surface blocks at elev >= 8)
            if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.LAKE ||
                tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.SNOW ||
                tile.terrain === TerrainType.FOREST) {
              tile.terrain = TerrainType.PLAINS;
              changed = true;
            }
          } else {
            // Blend zone: ramp DOWN from plateau toward lower terrain.
            // Note: tile.elevation may be inflated by ridge blocks (computeShellBlocks
            // recalculates elevation from max block Y). We cap at PLATEAU_ELEV so the
            // blend never produces tiles above the plateau.
            const blendT = (hexDist - CORE) / BLEND; // 0 at core edge → 1 at outer edge
            const smoothT = blendT * blendT; // quadratic ease-out
            // Target: plateau at inner edge, natural terrain at outer edge.
            // Cap naturalElev so ridge-inflated values don't keep blend tiles too high.
            const clampedNatural = Math.min(tile.elevation, PLATEAU_ELEV);
            const blendedElev = Math.round(PLATEAU_ELEV + (clampedNatural - PLATEAU_ELEV) * smoothT);
            const finalElev = Math.max(blendedElev, 3); // don't go below plains level
            if (tile.elevation !== finalElev) {
              tile.elevation = finalElev;
              tile.walkableFloor = finalElev;
              changed = true;
            }
            // Inner blend: convert to mountain stone for visual ramp
            if (blendT < 0.5) {
              if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.LAKE ||
                  tile.terrain === TerrainType.SNOW) {
                tile.terrain = TerrainType.MOUNTAIN;
                changed = true;
              }
            }
            // Outer blend: soften impassable terrain
            if (blendT >= 0.5 && (tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.SNOW)) {
              tile.terrain = TerrainType.PLAINS;
              changed = true;
            }
          }

          if (changed) {
            this.rebuildTileBlocksDirect(map, { q, r });
            rebuilt.add(key);
          }
        }
      }
      // Rebuild neighbors of modified tiles to fix cliff walls
      for (const key of rebuilt) {
        const [q, r] = key.split(',').map(Number);
        for (const n of Pathfinder.getHexNeighbors({ q, r })) {
          const nk = `${n.q},${n.r}`;
          if (!rebuilt.has(nk)) this.rebuildTileBlocksDirect(map, n);
        }
      }
    } else {
      // Desert / other: open valley with room to fight
      this.smoothBaseArea(map, coord.q, coord.r, 1, 3, 3, TerrainType.PLAINS);
    }
  }

  /**
   * Guarantee forest tiles in a ring around a base (radius 3-6).
   * Converts PLAINS tiles to FOREST and adds WOOD resources.
   */
  private seedBaseForest(map: GameMap, baseQ: number, baseR: number): void {
    const MIN_FOREST = 6;
    const INNER_RADIUS = 3;
    const OUTER_RADIUS = 7;

    // Count existing forest tiles in the zone
    const candidates: { q: number; r: number; dist: number }[] = [];
    let existingForest = 0;

    for (let dq = -OUTER_RADIUS; dq <= OUTER_RADIUS; dq++) {
      for (let dr = -OUTER_RADIUS; dr <= OUTER_RADIUS; dr++) {
        const q = baseQ + dq;
        const r = baseR + dr;
        const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
        if (hexDist < INNER_RADIUS || hexDist > OUTER_RADIUS) continue;

        const key = `${q},${r}`;
        const tile = map.tiles.get(key);
        if (!tile) continue;

        if (tile.terrain === TerrainType.FOREST) {
          existingForest++;
        } else if (tile.terrain === TerrainType.PLAINS || tile.terrain === TerrainType.DESERT) {
          candidates.push({ q, r, dist: hexDist });
        }
      }
    }

    if (existingForest >= MIN_FOREST) return; // Already enough trees

    // Sort candidates: prefer closer tiles
    candidates.sort((a, b) => a.dist - b.dist);

    const needed = MIN_FOREST - existingForest;
    for (let i = 0; i < Math.min(needed, candidates.length); i++) {
      const c = candidates[i];
      const key = `${c.q},${c.r}`;
      const tile = map.tiles.get(key);
      if (!tile) continue;
      tile.terrain = TerrainType.FOREST;
      if (!tile.resource) {
        // Don't import ResourceType here, use string literal
        tile.resource = 'wood' as any;
      }
      this.rebuildTileBlocksDirect(map, { q: c.q, r: c.r });
    }
  }

  /**
   * Ocean plane removed — terrain is a solid voxel mass.
   * This is now a no-op but kept for compatibility.
   */
  private addOceanPlane(_mapSize: number): void {
    // No-op: ocean removed for cube planet preparation
  }

  /**
   * Post-shell-block re-skin for tundra: swap standard blocks to frozen variants.
   * computeShellBlocks rebuilds all voxel data with standard types (GRASS, DIRT, etc.),
   * so we remap them to tundra equivalents for the frozen aesthetic.
   */
  private reskinTundra(map: GameMap): void {
    const TUNDRA_SWAP: Partial<Record<BlockType, BlockType>> = {
      [BlockType.GRASS]: BlockType.PACKED_SNOW,
      [BlockType.DIRT]: BlockType.FROZEN_DIRT,
      [BlockType.JUNGLE]: BlockType.PACKED_SNOW,
      [BlockType.SAND]: BlockType.PACKED_SNOW,
    };

    map.tiles.forEach((tile) => {
      for (const block of tile.voxelData.blocks) {
        const swap = TUNDRA_SWAP[block.type];
        if (swap) block.type = swap;
      }
    });
  }

  /**
   * Post-shell-block re-skin for Sunken Ruins: swap standard blocks to ruin variants.
   */
  private reskinRuins(map: GameMap): void {
    const RUINS_SWAP: Partial<Record<BlockType, BlockType>> = {
      [BlockType.GRASS]: BlockType.MOSSY_STONE,
      [BlockType.DIRT]: BlockType.ANCIENT_BRICK,
      [BlockType.SAND]: BlockType.MOSSY_STONE,
    };

    map.tiles.forEach((tile) => {
      for (const block of tile.voxelData.blocks) {
        const swap = RUINS_SWAP[block.type];
        if (swap) block.type = swap;
      }
    });
  }

  /**
   * Post-shell-block re-skin for Badlands: swap standard blocks to badlands variants.
   */
  private reskinBadlands(map: GameMap): void {
    const BADLANDS_SWAP: Partial<Record<BlockType, BlockType>> = {
      [BlockType.GRASS]: BlockType.RED_CLAY,
      [BlockType.DIRT]: BlockType.CRACKED_EARTH,
      [BlockType.SAND]: BlockType.CRACKED_EARTH,
    };

    map.tiles.forEach((tile) => {
      for (const block of tile.voxelData.blocks) {
        const swap = BADLANDS_SWAP[block.type];
        if (swap) block.type = swap;
      }
    });
  }

  /**
   * Build voxel terrain and decorate all tiles.
   */
  private buildTerrainAndDecorate(map: GameMap): void {
    // Build terrain voxels
    map.tiles.forEach((tile, key) => {
      const [q, r] = key.split(',').map(Number);
      const worldX = q * 1.5;
      const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);

      if (this.ops.isWaterTerrain(tile.terrain)) {
        // Water tiles: render underground blocks but skip surface water
        for (const block of tile.voxelData.blocks) {
          if (block.type === BlockType.WATER) continue; // surface water handled by decorator
          this.ops.addBlock(
            {
              x: worldX + block.localPosition.x,
              y: block.localPosition.y,
              z: worldZ + block.localPosition.z,
            },
            block.type,
          );
        }
      } else {
        for (const block of tile.voxelData.blocks) {
          this.ops.addBlock(
            {
              x: worldX + block.localPosition.x,
              y: block.localPosition.y,
              z: worldZ + block.localPosition.z,
            },
            block.type,
          );
        }
      }

      const scaledElevation = tile.elevation * 0.5;

      // Find max neighbor elevation to prevent tree clipping
      let maxNeighborElev = scaledElevation;
      const neighbors =
        q % 2 === 0
          ? [[q - 1, r - 1], [q, r - 1], [q + 1, r - 1], [q - 1, r], [q + 1, r], [q, r + 1]]
          : [[q, r - 1], [q - 1, r], [q + 1, r], [q - 1, r + 1], [q, r + 1], [q + 1, r + 1]];
      for (const [nq, nr] of neighbors) {
        const nTile = map.tiles.get(`${nq},${nr}`);
        if (nTile) {
          maxNeighborElev = Math.max(maxNeighborElev, nTile.elevation * 0.5);
        }
      }

      // Decorate tile (no arena decorations handled in caller)
      // Note: The caller (main.ts) must pass the isArena flag to avoid decorating arena
      // This method doesn't know about game mode, so decorate everything
      this.ops.decorateTile({ q, r }, tile.terrain as TerrainType, scaledElevation, maxNeighborElev, tile.resource);
    });

    // Remove decorations from tunnel tiles
    map.tiles.forEach((tile, key) => {
      if (!tile.hasTunnel) return;
      const [q, r] = key.split(',').map(Number);
      this.ops.removeDecoration({ q, r });
    });

    // Add water curtains on river/lake tiles
    map.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.RIVER && tile.terrain !== TerrainType.LAKE) return;
      const [q, r] = key.split(',').map(Number);
      const myElev = tile.elevation;
      const worldX = q * 1.5;
      const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);
      const scaledElev = myElev * 0.5;

      const nCoords =
        q % 2 === 0
          ? [[q - 1, r - 1], [q, r - 1], [q + 1, r - 1], [q - 1, r], [q + 1, r], [q, r + 1]]
          : [[q, r - 1], [q - 1, r], [q + 1, r], [q - 1, r + 1], [q, r + 1], [q + 1, r + 1]];
      const nDirs =
        q % 2 === 0
          ? [
              { dx: -1, dz: -1 },
              { dx: 0, dz: -1 },
              { dx: 1, dz: -1 },
              { dx: -1, dz: 0 },
              { dx: 1, dz: 0 },
              { dx: 0, dz: 1 },
            ]
          : [
              { dx: 0, dz: -1 },
              { dx: -1, dz: 0 },
              { dx: 1, dz: 0 },
              { dx: -1, dz: 1 },
              { dx: 0, dz: 1 },
              { dx: 1, dz: 1 },
            ];

      for (let i = 0; i < nCoords.length; i++) {
        const [nq, nr] = nCoords[i];
        const nTile = map.tiles.get(`${nq},${nr}`);
        if (!nTile) continue;
        const nElev = nTile.elevation;
        const elevDrop = myElev - nElev;
        if (elevDrop >= 2) {
          const dropHeight = Math.min(elevDrop * 0.5, 4);
          const dir = nDirs[i];
          const absDx = Math.abs(dir.dx);
          const absDz = Math.abs(dir.dz);
          let faceDx = 0,
            faceDz = 0;
          if (absDx >= absDz) {
            faceDx = dir.dx > 0 ? 1 : -1;
          } else {
            faceDz = dir.dz > 0 ? 1 : -1;
          }
          this.ops.addWaterEdgeCurtain(worldX, scaledElev, worldZ, faceDx, faceDz, dropHeight);
        }
      }
    });
  }

  /**
   * Add underground cavern bases (Desert Tunnels and generic underground).
   */
  private addUndergroundBases(map: GameMap, bases: Base[]): void {
    // Neutral underdark city (Desert Tunnels only)
    if (ENABLE_UNDERGROUND && map.mapType === MapType.DESERT_TUNNELS) {
      const dtMap = map as DesertTunnelsMap;
      if (dtMap.cavernCenter) {
        const neutralCoord = { q: dtMap.cavernCenter.q, r: dtMap.cavernCenter.r };
        const neutralY = (dtMap.cavernFloorY ?? -16) * 0.5;
        const neutralBase: Base = {
          id: 'base_neutral',
          owner: NEUTRAL_OWNER,
          position: neutralCoord,
          worldPosition: {
            x: neutralCoord.q * 1.5,
            y: neutralY + 0.25,
            z: neutralCoord.r * 1.5 + (neutralCoord.q % 2 === 1 ? 0.75 : 0),
          },
          health: 300,
          maxHealth: 300,
          destroyed: false,
          tier: BaseTier.CAMP,
          ogresSpawned: 0,
        };
        bases.push(neutralBase);
        this.ops.addBase(neutralBase, neutralY);
        Logger.info('DesertTunnels', `Neutral underdark city at (${neutralCoord.q},${neutralCoord.r}), Y=${neutralY}`);
      }

      // Extra underground outposts
      if (dtMap.extraCaverns) {
        for (let i = 0; i < dtMap.extraCaverns.length; i++) {
          const cavern = dtMap.extraCaverns[i];
          const coord = cavern.center;
          const yLevel = cavern.floorY * 0.5;
          const extraBase: Base = {
            id: `base_neutral_${i + 2}`,
            owner: NEUTRAL_OWNER,
            position: { ...coord },
            worldPosition: {
              x: coord.q * 1.5,
              y: yLevel + 0.25,
              z: coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0),
            },
            health: 300,
            maxHealth: 300,
            destroyed: false,
            tier: BaseTier.CAMP,
            ogresSpawned: 0,
          };
          bases.push(extraBase);
          this.ops.addBase(extraBase, yLevel);
          Logger.debug('DesertTunnels', `Extra underground outpost ${i + 1} at (${coord.q},${coord.r}), Y=${yLevel}`);
        }
      }
    }

    // Generic underground bases (any map type except Desert Tunnels)
    if (ENABLE_UNDERGROUND && map.undergroundBases && map.undergroundBases.length > 0 && map.mapType !== MapType.DESERT_TUNNELS) {
      for (let i = 0; i < map.undergroundBases.length; i++) {
        const cavern = map.undergroundBases[i];
        const coord = cavern.center;
        const yLevel = cavern.floorY * 0.5;
        const ugBase: Base = {
          id: `base_neutral_ug_${i}`,
          owner: NEUTRAL_OWNER,
          position: { q: coord.q, r: coord.r },
          worldPosition: {
            x: coord.q * 1.5,
            y: yLevel + 0.25,
            z: coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0),
          },
          health: 300,
          maxHealth: 300,
          destroyed: false,
          tier: BaseTier.CAMP,
          ogresSpawned: 0,
        };
        bases.push(ugBase);
        this.ops.addBase(ugBase, yLevel);
        Logger.info('Underground', `Neutral base ${i} at (${coord.q},${coord.r}), Y=${yLevel}`);
      }
    }
  }

  /**
   * Add surface neutral bases (desert outposts, mountain forts).
   */
  private addSurfaceBases(map: GameMap, bases: Base[], p1BaseCoord: HexCoord, p2BaseCoord: HexCoord): void {
    const MIN_DIST_FROM_CAPITAL = 12;
    if (!map.surfaceBases || map.surfaceBases.length === 0) return;

    for (let i = 0; i < map.surfaceBases.length; i++) {
      const sb = map.surfaceBases[i];
      const coord = sb.center;

      // Skip if too close to either player capital
      const distP1 =
        (Math.abs(coord.q - p1BaseCoord.q) +
          Math.abs(coord.r - p1BaseCoord.r) +
          Math.abs((-coord.q - coord.r) - (-p1BaseCoord.q - p1BaseCoord.r))) /
        2;
      const distP2 =
        (Math.abs(coord.q - p2BaseCoord.q) +
          Math.abs(coord.r - p2BaseCoord.r) +
          Math.abs((-coord.q - coord.r) - (-p2BaseCoord.q - p2BaseCoord.r))) /
        2;
      if (distP1 < MIN_DIST_FROM_CAPITAL || distP2 < MIN_DIST_FROM_CAPITAL) {
        Logger.debug('Surface', `Skipped neutral ${sb.terrain} base at (${coord.q},${coord.r}) — too close to capital (d1=${distP1}, d2=${distP2})`);
        continue;
      }

      // Also skip if too close to any existing neutral base
      const tooCloseToOther = bases.some((b) => {
        if (b.owner !== NEUTRAL_OWNER) return false;
        const d =
          (Math.abs(coord.q - b.position.q) +
            Math.abs(coord.r - b.position.r) +
            Math.abs((-coord.q - coord.r) - (-b.position.q - b.position.r))) /
          2;
        return d < MIN_DIST_FROM_CAPITAL;
      });
      if (tooCloseToOther) {
        Logger.debug('Surface', `Skipped neutral ${sb.terrain} base at (${coord.q},${coord.r}) — too close to another neutral base`);
        continue;
      }

      // Get final elevation directly from map tiles (this.currentMap isn't set yet during init)
      const baseTile = map.tiles.get(`${coord.q},${coord.r}`);
      const surfY = baseTile ? baseTile.elevation * 0.5 : this.ops.getElevation({ q: coord.q, r: coord.r });
      const surfBase: Base = {
        id: `base_neutral_surf_${i}`,
        owner: NEUTRAL_OWNER,
        position: { q: coord.q, r: coord.r },
        worldPosition: {
          x: coord.q * 1.5,
          y: surfY + 0.25,
          z: coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0),
        },
        health: 300,
        maxHealth: 300,
        destroyed: false,
        tier: BaseTier.CAMP,
        ogresSpawned: 0,
      };
      bases.push(surfBase);
      this.ops.addBase(surfBase, surfY);
      Logger.info('Surface', `Neutral ${sb.terrain} base ${i} at (${coord.q},${coord.r}), Y=${surfY}`);
    }
  }
}
