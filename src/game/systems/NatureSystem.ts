/**
 * NatureSystem — Tree regrowth/sprouting and grass growth/spreading.
 * Owns all vegetation lifecycle state; main.ts calls update() each frame.
 */

import { HexCoord, TerrainType, GameMap } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { GAME_CONFIG } from '../GameConfig';
import { GameRNG } from '../SeededRandom';
import { hexDistQR } from '../HexMath';

/** Position of a completed forestry building */
export interface ForestryBuildingInfo {
  q: number;
  r: number;
  owner: number;
}

/** Slim interface — only what NatureSystem needs from the outside */
export interface NatureOps {
  getMap(): GameMap | null;
  /** TerrainDecorator facade */
  removeDecoration(pos: HexCoord): void;
  addTreeAtStage(pos: HexCoord, baseY: number, stage: number): void;
  removeGrassClump(key: string): void;
  addGrassAtStage(pos: HexCoord, baseY: number, stage: number): void;
  hasGrass(key: string): boolean;
  /** Forestry building awareness */
  getForestryBuildings(): ForestryBuildingInfo[];
  addWoodToStockpile(owner: number, amount: number): void;
  /** Update farm patch visual for crop growth stage */
  updateCropVisual(key: string, stage: number): void;
}

// ── Hex neighbor helper (offset coords) ─────────────────────────
function getHexNeighbors(q: number, r: number): [number, number][] {
  const even = q % 2 === 0;
  if (even) {
    return [
      [q + 1, r - 1], [q + 1, r],
      [q - 1, r - 1], [q - 1, r],
      [q, r - 1], [q, r + 1],
    ];
  } else {
    return [
      [q + 1, r], [q + 1, r + 1],
      [q - 1, r], [q - 1, r + 1],
      [q, r - 1], [q, r + 1],
    ];
  }
}

export default class NatureSystem {
  private ops: NatureOps;

  // ── Tree state ───────────────────────────────────────────────
  treeRegrowthTimers: Map<string, number> = new Map();
  treeAge: Map<string, number> = new Map();
  treeGrowthTimers: Map<string, number> = new Map();
  private treeSproutTimer = 0;

  /** Tiles that originally had forest at map creation — only these can regrow */
  originalForestTiles: Set<string> = new Set();
  /** How many times each tile has been harvested — regrowth chance decreases */
  harvestCount: Map<string, number> = new Map();
  /** Max harvests before a tile stops regrowing entirely */
  private readonly MAX_HARVESTS = GAME_CONFIG.timers.nature.maxHarvests;

  readonly TREE_REGROW_TIME = GAME_CONFIG.timers.nature.treeRegrowTime;
  readonly TREE_GROWTH_TIME = GAME_CONFIG.timers.nature.treeGrowthTime;
  private readonly TREE_SPROUT_INTERVAL = GAME_CONFIG.timers.nature.treeSproutInterval;
  private readonly TREE_SPROUT_CHANCE = GAME_CONFIG.timers.nature.treeSproutChance;

  // ── Grass state ──────────────────────────────────────────────
  grassAge: Map<string, number> = new Map();
  grassGrowthTimers: Map<string, number> = new Map();
  private grassSpreadTimer = 0;

  readonly GRASS_GROWTH_TIME = GAME_CONFIG.timers.nature.grassGrowthTime;
  private readonly GRASS_SPREAD_INTERVAL = GAME_CONFIG.timers.nature.grassSpreadInterval;
  private readonly GRASS_SPREAD_CHANCE = GAME_CONFIG.timers.nature.grassSpreadChance;

  /** Tiles where grass was harvested — eligible for crops */
  clearedPlains: Set<string> = new Set();

  // ── Forestry aura state ─────────────────────────────────────
  private forestryAutoPlantTimer = 0;
  private forestryTrickleTimer = 0;
  /** Cached set of tile keys within forestry aura range — rebuilt when forestry buildings change */
  private forestryAuraTiles: Set<string> = new Set();
  private lastForestryCount = 0;

  constructor(ops: NatureOps) {
    this.ops = ops;
  }

  // ── Public update (called every frame) ──────────────────────
  update(delta: number): void {
    this.refreshForestryAuraCache();
    this.updateTreeRegrowth(delta);
    this.updateTreeGrowth(delta);
    this.updateGrassGrowth(delta);
    this.updateGrassSpread(delta);
    this.updateForestryAutoPlant(delta);
    this.updateForestryTrickle(delta);
    this.updateCropGrowth(delta);
  }

  // ── Record original forest tiles (call after map generation) ──
  initializeForestTracking(): void {
    const map = this.ops.getMap();
    if (!map) return;
    for (const [key, tile] of map.tiles) {
      if (tile.terrain === TerrainType.FOREST) {
        this.originalForestTiles.add(key);
      }
    }
  }

  // ── Tree harvest callback (called by main.ts handleChopWood) ──
  onTreeChopped(key: string): void {
    this.treeAge.delete(key);
    this.treeGrowthTimers.delete(key);

    // Only allow regrowth on original forest tiles, with diminishing chance
    if (!this.originalForestTiles.has(key)) return;
    const harvests = (this.harvestCount.get(key) ?? 0) + 1;
    this.harvestCount.set(key, harvests);

    // Forestry aura grants extra harvests before exhaustion
    const nearForestry = this.forestryAuraTiles.has(key);
    const maxH = this.MAX_HARVESTS + (nearForestry ? GAME_CONFIG.timers.nature.forestryExtraHarvests : 0);
    if (harvests >= maxH) return; // exhausted — no more regrowth

    // Longer regrowth time with each harvest, but forestry aura speeds it up
    let regrowTime = this.TREE_REGROW_TIME * (1 + harvests * GAME_CONFIG.timers.nature.regrowHarvestScale);
    if (nearForestry) {
      regrowTime *= GAME_CONFIG.timers.nature.forestryRegrowMultiplier;
    }
    this.treeRegrowthTimers.set(key, regrowTime);
  }

  /** Mark a tile as eligible for tree regrowth (auto-replant by lumberjacks) */
  markAsReGrowable(key: string): void {
    this.originalForestTiles.add(key);
  }

  /** Get tree age for wood yield calculation */
  getTreeAge(key: string): number | undefined {
    return this.treeAge.get(key);
  }

  /** Check if a tile is within a forestry building's aura */
  isInForestryAura(key: string): boolean {
    return this.forestryAuraTiles.has(key);
  }

  // ── Grass harvest callback (called by main.ts handleHarvestGrass) ──
  onGrassHarvested(key: string, pos: HexCoord, elevation: number): void {
    this.ops.addGrassAtStage(pos, elevation, 0);
    this.grassAge.set(key, 0);
    this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
    this.clearedPlains.add(key);
  }

  /** Get grass stage (for BlueprintOps.getGrassAge) */
  getGrassAge(key: string): number | undefined {
    return this.grassAge.get(key);
  }

  // ── Initialization (after map creation) ─────────────────────
  initializeGrassTracking(): void {
    const map = this.ops.getMap();
    if (!map) return;
    for (const [key, tile] of map.tiles) {
      if (tile.terrain === TerrainType.PLAINS && this.ops.hasGrass(key)) {
        const stage = GameRNG.rng.next() > GAME_CONFIG.timers.nature.initialGrassMatureChance ? 2 : 1;
        this.grassAge.set(key, stage);
        if (stage < 2) {
          this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
        }
      }
    }
    this.syncGrassTiles();
  }

  // ── Tree regrowth (chopped stumps → saplings) ──────────────
  private updateTreeRegrowth(delta: number): void {
    const map = this.ops.getMap();
    if (!map) return;

    for (const [key, remaining] of this.treeRegrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        this.treeRegrowthTimers.delete(key);
        const tile = map.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.PLAINS || Pathfinder.blockedTiles.has(key)) continue;
        if (!this.originalForestTiles.has(key)) continue;

        // Forestry aura grants extra harvest tolerance
        const nearForestry = this.forestryAuraTiles.has(key);
        const harvests = this.harvestCount.get(key) ?? 0;
        const maxH = this.MAX_HARVESTS + (nearForestry ? GAME_CONFIG.timers.nature.forestryExtraHarvests : 0);
        if (harvests >= maxH) continue;

        // Diminishing regrowth chance — but forestry aura boosts it
        const baseChance = 1 / (1 + harvests); // 100%, 50%, 33%...
        const regrowChance = nearForestry ? Math.min(1, baseChance + 0.3) : baseChance;
        if (GameRNG.rng.next() > regrowChance) continue;

        tile.terrain = TerrainType.FOREST;
        const [q, r] = key.split(',').map(Number);
        this.ops.addTreeAtStage({ q, r }, tile.elevation * 0.5, 0);
        this.treeAge.set(key, 0);
        // Forestry aura speeds up growth too
        const growTime = nearForestry
          ? this.TREE_GROWTH_TIME * GAME_CONFIG.timers.nature.forestryGrowthMultiplier
          : this.TREE_GROWTH_TIME;
        this.treeGrowthTimers.set(key, growTime);
      } else {
        this.treeRegrowthTimers.set(key, newTime);
      }
    }
  }

  // ── Tree growth (saplings → young → mature) ───────────────
  private updateTreeGrowth(delta: number): void {
    const map = this.ops.getMap();
    if (!map) return;

    for (const [key, remaining] of this.treeGrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        const currentStage = this.treeAge.get(key) ?? 0;
        const newStage = currentStage + 1;

        if (newStage > 2) {
          this.treeGrowthTimers.delete(key);
          this.treeAge.set(key, 2);
          continue;
        }

        const tile = map.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.FOREST) {
          this.treeGrowthTimers.delete(key);
          this.treeAge.delete(key);
          continue;
        }

        const [q, r] = key.split(',').map(Number);
        this.ops.removeDecoration({ q, r });
        this.ops.addTreeAtStage({ q, r }, tile.elevation * 0.5, newStage);
        this.treeAge.set(key, newStage);

        if (newStage < 2) {
          // Forestry aura speeds growth
          const nearForestry = this.forestryAuraTiles.has(key);
          const growTime = nearForestry
            ? this.TREE_GROWTH_TIME * GAME_CONFIG.timers.nature.forestryGrowthMultiplier
            : this.TREE_GROWTH_TIME;
          this.treeGrowthTimers.set(key, growTime);
        } else {
          this.treeGrowthTimers.delete(key);
        }
      } else {
        this.treeGrowthTimers.set(key, newTime);
      }
    }
  }

  // ── Forestry aura cache ────────────────────────────────────
  /** Rebuild the set of tiles in range of any forestry building.
   *  Only recomputes when the building count changes. */
  private refreshForestryAuraCache(): void {
    const buildings = this.ops.getForestryBuildings();
    if (buildings.length === this.lastForestryCount) return;
    this.lastForestryCount = buildings.length;

    this.forestryAuraTiles.clear();
    const map = this.ops.getMap();
    if (!map) return;
    const radius = GAME_CONFIG.timers.nature.forestryAuraRadius;

    for (const fb of buildings) {
      for (const [key] of map.tiles) {
        if (this.forestryAuraTiles.has(key)) continue; // already covered
        const [tq, tr] = key.split(',').map(Number);
        if (hexDistQR(fb.q, fb.r, tq, tr) <= radius) {
          this.forestryAuraTiles.add(key);
        }
      }
    }
  }

  // ── Crop growth ─────────────────────────────────────────────
  /** Advance crop stages on farm patches: 0→1→2→3 (seedling→sprout→growing→mature) */
  private updateCropGrowth(delta: number): void {
    const growTime = GAME_CONFIG.economy.harvest.crops.growTime ?? 8;

    for (const key of UnitAI.farmPatches) {
      // Initialize new crops that don't have a stage yet
      if (!UnitAI.cropStages.has(key)) {
        UnitAI.cropStages.set(key, 0);
        UnitAI.cropTimers.set(key, growTime);
        this.ops.updateCropVisual(key, 0);
      }

      const stage = UnitAI.cropStages.get(key)!;
      if (stage >= 3) continue; // Mature — wait for harvest

      let timer = UnitAI.cropTimers.get(key) ?? growTime;
      timer -= delta;
      if (timer <= 0) {
        const newStage = stage + 1;
        UnitAI.cropStages.set(key, newStage);
        UnitAI.cropTimers.set(key, growTime);
        this.ops.updateCropVisual(key, newStage);
      } else {
        UnitAI.cropTimers.set(key, timer);
      }
    }

    // Clean up orphaned crop state for removed farm patches
    for (const key of UnitAI.cropStages.keys()) {
      if (!UnitAI.farmPatches.has(key)) {
        UnitAI.cropStages.delete(key);
        UnitAI.cropTimers.delete(key);
      }
    }
  }

  // ── Forestry auto-planting ─────────────────────────────────
  /** Each forestry building periodically plants a sapling on a nearby
   *  empty plains tile that was originally forest (or any plains within radius). */
  private updateForestryAutoPlant(delta: number): void {
    this.forestryAutoPlantTimer += delta;
    if (this.forestryAutoPlantTimer < GAME_CONFIG.timers.nature.forestryAutoPlantInterval) return;
    this.forestryAutoPlantTimer = 0;

    const map = this.ops.getMap();
    if (!map) return;
    const buildings = this.ops.getForestryBuildings();
    const plantRadius = GAME_CONFIG.timers.nature.forestryAutoPlantRadius;

    for (const fb of buildings) {
      // Find a suitable empty tile near this forestry
      let bestKey: string | null = null;
      let bestDist = Infinity;

      for (const [key, tile] of map.tiles) {
        if (tile.terrain !== TerrainType.PLAINS) continue;
        if (Pathfinder.blockedTiles.has(key)) continue;
        if (this.treeRegrowthTimers.has(key)) continue; // already regrowing
        if (this.treeAge.has(key)) continue; // already has a tree
        // Don't plant on farm patches
        if (UnitAI.farmPatches.has(key)) continue;

        const [tq, tr] = key.split(',').map(Number);
        const d = hexDistQR(fb.q, fb.r, tq, tr);
        if (d > plantRadius) continue;

        // Prefer planting on original forest tiles first, then any plains
        const isOriginal = this.originalForestTiles.has(key);
        const score = d + (isOriginal ? 0 : 5);
        if (score < bestDist) {
          bestDist = score;
          bestKey = key;
        }
      }

      if (bestKey) {
        const tile = map.tiles.get(bestKey)!;
        tile.terrain = TerrainType.FOREST;
        const [q, r] = bestKey.split(',').map(Number);
        this.ops.addTreeAtStage({ q, r }, tile.elevation * 0.5, 0);
        this.treeAge.set(bestKey, 0);
        // Track as original so it can regrow in the future
        this.originalForestTiles.add(bestKey);
        const growTime = this.TREE_GROWTH_TIME * GAME_CONFIG.timers.nature.forestryGrowthMultiplier;
        this.treeGrowthTimers.set(bestKey, growTime);
      }
    }
  }

  // ── Forestry passive wood trickle ──────────────────────────
  /** Each completed forestry building produces a small passive wood income. */
  private updateForestryTrickle(delta: number): void {
    this.forestryTrickleTimer += delta;
    if (this.forestryTrickleTimer < GAME_CONFIG.timers.nature.forestryTrickleInterval) return;
    this.forestryTrickleTimer = 0;

    const buildings = this.ops.getForestryBuildings();
    // Group by owner
    const ownerCounts = new Map<number, number>();
    for (const fb of buildings) {
      ownerCounts.set(fb.owner, (ownerCounts.get(fb.owner) ?? 0) + 1);
    }
    for (const [owner, count] of ownerCounts) {
      const amount = count * GAME_CONFIG.timers.nature.forestryWoodTrickle;
      this.ops.addWoodToStockpile(owner, amount);
    }
  }

  // ── Grass growth ────────────────────────────────────────────
  private updateGrassGrowth(delta: number): void {
    const map = this.ops.getMap();
    if (!map) return;

    for (const [key, remaining] of this.grassGrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        const currentStage = this.grassAge.get(key) ?? 0;
        const newStage = currentStage + 1;

        if (newStage > 2) {
          this.grassGrowthTimers.delete(key);
          this.grassAge.set(key, 2);
          continue;
        }

        const tile = map.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.PLAINS) {
          this.grassGrowthTimers.delete(key);
          this.grassAge.delete(key);
          continue;
        }

        const [q, r] = key.split(',').map(Number);
        this.ops.addGrassAtStage({ q, r }, tile.elevation * 0.5, newStage);
        this.grassAge.set(key, newStage);

        if (newStage < 2) {
          this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
        } else {
          this.grassGrowthTimers.delete(key);
        }
      } else {
        this.grassGrowthTimers.set(key, newTime);
      }
    }

    this.syncGrassTiles();
  }

  // ── Grass spread ────────────────────────────────────────────
  private updateGrassSpread(delta: number): void {
    const map = this.ops.getMap();
    if (!map) return;
    this.grassSpreadTimer += delta;
    if (this.grassSpreadTimer < this.GRASS_SPREAD_INTERVAL) return;
    this.grassSpreadTimer = 0;

    const spreadCandidates: string[] = [];
    for (const [key, stage] of this.grassAge) {
      if (stage >= 1) spreadCandidates.push(key);
    }

    let spreadCount = 0;
    for (const key of spreadCandidates) {
      if (spreadCount >= GAME_CONFIG.timers.nature.grassSpreadMaxPerTick) break;
      const [q, r] = key.split(',').map(Number);
      const neighbors = getHexNeighbors(q, r);

      for (const [nq, nr] of neighbors) {
        if (spreadCount >= GAME_CONFIG.timers.nature.grassSpreadMaxPerTick) break;
        const nKey = `${nq},${nr}`;
        const nTile = map.tiles.get(nKey);
        if (!nTile) continue;
        if (nTile.terrain !== TerrainType.PLAINS) continue;
        if (this.grassAge.has(nKey)) continue;
        if (Pathfinder.blockedTiles.has(nKey)) continue;
        if (UnitAI.farmPatches.has(nKey)) continue;
        if (nTile.elevation * 0.5 >= GAME_CONFIG.timers.nature.grassSpreadElevationCap) continue;

        if (GameRNG.rng.next() < this.GRASS_SPREAD_CHANCE) {
          this.ops.addGrassAtStage({ q: nq, r: nr }, nTile.elevation * 0.5, 0);
          this.grassAge.set(nKey, 0);
          this.grassGrowthTimers.set(nKey, this.GRASS_GROWTH_TIME);
          spreadCount++;
        }
      }
    }
  }

  // ── Sync harvestable grass to UnitAI ────────────────────────
  private syncGrassTiles(): void {
    UnitAI.grassTiles.clear();
    for (const [key, stage] of this.grassAge) {
      if (stage >= 2) {
        UnitAI.grassTiles.add(key);
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────
  cleanup(): void {
    this.treeRegrowthTimers.clear();
    this.treeAge.clear();
    this.treeGrowthTimers.clear();
    this.treeSproutTimer = 0;
    this.originalForestTiles.clear();
    this.harvestCount.clear();
    this.grassAge.clear();
    this.grassGrowthTimers.clear();
    this.grassSpreadTimer = 0;
    this.clearedPlains.clear();
    this.forestryAuraTiles.clear();
    this.forestryAutoPlantTimer = 0;
    this.forestryTrickleTimer = 0;
    this.lastForestryCount = 0;
  }
}
