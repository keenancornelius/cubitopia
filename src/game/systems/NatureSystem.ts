/**
 * NatureSystem — Tree regrowth/sprouting and grass growth/spreading.
 * Owns all vegetation lifecycle state; main.ts calls update() each frame.
 */

import { HexCoord, TerrainType, GameMap } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { GAME_CONFIG } from '../GameConfig';

/** Slim interface — only what NatureSystem needs from the outside */
export interface NatureOps {
  getMap(): GameMap | null;
  /** TerrainDecorator facade */
  removeDecoration(pos: HexCoord): void;
  addTreeAtStage(pos: HexCoord, baseY: number, stage: number): void;
  removeGrassClump(key: string): void;
  addGrassAtStage(pos: HexCoord, baseY: number, stage: number): void;
  hasGrass(key: string): boolean;
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

  constructor(ops: NatureOps) {
    this.ops = ops;
  }

  // ── Public update (called every frame) ──────────────────────
  update(delta: number): void {
    this.updateTreeRegrowth(delta);
    this.updateTreeSprouts(delta);
    this.updateGrassGrowth(delta);
    this.updateGrassSpread(delta);
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
    if (harvests >= this.MAX_HARVESTS) return; // exhausted — no more regrowth

    // Longer regrowth time with each harvest
    const regrowTime = this.TREE_REGROW_TIME * (1 + harvests * GAME_CONFIG.timers.nature.regrowHarvestScale);
    this.treeRegrowthTimers.set(key, regrowTime);
  }

  /** Get tree age for wood yield calculation */
  getTreeAge(key: string): number | undefined {
    return this.treeAge.get(key);
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
        const stage = Math.random() > GAME_CONFIG.timers.nature.initialGrassMatureChance ? 2 : 1;
        this.grassAge.set(key, stage);
        if (stage < 2) {
          this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
        }
      }
    }
    this.syncGrassTiles();
  }

  // ── Tree regrowth ───────────────────────────────────────────
  private updateTreeRegrowth(delta: number): void {
    const map = this.ops.getMap();
    if (!map) return;

    // 1. Regrowth timers: chopped stumps → saplings (only on original forest tiles)
    for (const [key, remaining] of this.treeRegrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        this.treeRegrowthTimers.delete(key);
        const tile = map.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.PLAINS || Pathfinder.blockedTiles.has(key)) continue;
        // Only regrow on original forest tiles
        if (!this.originalForestTiles.has(key)) continue;
        // Diminishing regrowth chance based on harvest count
        const harvests = this.harvestCount.get(key) ?? 0;
        if (harvests >= this.MAX_HARVESTS) continue;
        const regrowChance = 1 / (1 + harvests); // 100%, 50%, 33%
        if (Math.random() > regrowChance) continue;

        tile.terrain = TerrainType.FOREST;
        const [q, r] = key.split(',').map(Number);
        this.ops.addTreeAtStage({ q, r }, tile.elevation * 0.5, 0);
        this.treeAge.set(key, 0);
        this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
      } else {
        this.treeRegrowthTimers.set(key, newTime);
      }
    }

    // 2. Growth timers: saplings → young → mature
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
          this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
        } else {
          this.treeGrowthTimers.delete(key);
        }
      } else {
        this.treeGrowthTimers.set(key, newTime);
      }
    }
  }

  // ── Tree sprouting (disabled — trees no longer spread to new tiles) ──
  private updateTreeSprouts(_delta: number): void {
    // Trees only regrow on original forest tiles via regrowth timers.
    // No new tree spawning on non-forest tiles.
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

        if (Math.random() < this.GRASS_SPREAD_CHANCE) {
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
  }
}
