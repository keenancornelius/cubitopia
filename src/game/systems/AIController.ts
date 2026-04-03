// ============================================
// AIController - AI Economy, Commander, Tactics
// ============================================

import * as THREE from 'three';
import {
  Base,
  HexCoord,
  GameContext,
  TerrainType,
  Unit,
  UnitType,
  UnitState,
  UnitStance,
  FormationType,
  AIBuildState,
  createAIBuildState,
  PersistentSquad,
  MAX_SQUADS_PER_TEAM,
  ENABLE_UNDERGROUND,
} from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { UnitFactory } from '../entities/UnitFactory';
import { FOOD_PER_COMBAT_UNIT } from './PopulationSystem';
import type { PlacedBuilding, BuildingKind } from '../../types';
import { TacticalGroupManager, TacticalGroup, getTacticalRole, TacticalRole } from './TacticalGroup';
import { GAME_CONFIG } from '../GameConfig';

/** Slim interface for garrison operations AIController needs */
export interface AIGarrisonOps {
  /** Garrison units into a structure */
  garrison(units: Unit[], structureKey: string): Unit[];
  /** Get garrison capacity info */
  getCapacity(structureKey: string): { current: number; max: number } | null;
  /** Get all garrisoned units for an owner */
  getGarrisonedUnits(owner: number): Unit[];
  /** Get all gate hex keys */
  getGatesBuilt(): Set<string>;
  /** Get gate owner */
  getGateOwner(key: string): number;
}

/** Slim interface for the building operations AIController needs */
export interface AIBuildingOps {
  aiFindBuildTile(baseQ: number, baseR: number, offsetQ: number, offsetR: number): HexCoord | null;
  buildForestryMesh(pos: HexCoord, owner: number): THREE.Group;
  buildBarracksMesh(pos: HexCoord, owner: number): THREE.Group;
  buildMasonryMesh(pos: HexCoord, owner: number): THREE.Group;
  buildFarmhouseMesh(pos: HexCoord, owner: number): THREE.Group;
  buildWorkshopMesh(pos: HexCoord, owner: number): THREE.Group;
  buildSiloMesh(pos: HexCoord, owner: number): THREE.Group;
  buildSmelterMesh(pos: HexCoord, owner: number): THREE.Group;
  buildArmoryMesh(pos: HexCoord, owner: number): THREE.Group;
  buildWizardTowerMesh(pos: HexCoord, owner: number): THREE.Group;
  registerBuilding(kind: BuildingKind, owner: number, pos: HexCoord, mesh: THREE.Group, maxHealth?: number): PlacedBuilding;
}

export default class AIController {
  private ctx: GameContext;
  private buildOps: AIBuildingOps;
  private garrisonOps: AIGarrisonOps | null = null;
  private tacticalGroupManager: TacticalGroupManager | null = null;
  aiState: [AIBuildState, AIBuildState] = [createAIBuildState(), createAIBuildState()];
  // Squad IDs are now managed per-team via PersistentSquad in AIBuildState (1-4)

  constructor(ctx: GameContext, buildOps: AIBuildingOps) {
    this.ctx = ctx;
    this.buildOps = buildOps;
  }

  /** Wire garrison ops after construction (avoids circular init order) */
  setGarrisonOps(ops: AIGarrisonOps): void {
    this.garrisonOps = ops;
  }

  /** Wire tactical group manager after construction */
  setTacticalGroupManager(mgr: TacticalGroupManager): void {
    this.tacticalGroupManager = mgr;
  }

  // ===================== AI ECONOMY =====================

  updateSmartAIEconomy(ownerId: number, delta: number): void {
    if (!this.ctx.currentMap) return;
    const st = this.aiState[ownerId];
    st.econTimer += delta;
    if (st.econTimer < GAME_CONFIG.timers.ai.economyTick) return;
    st.econTimer = 0;

    const player = this.ctx.players[ownerId];
    if (!player) return;
    const base = this.ctx.bases.find(b => b.owner === ownerId);
    if (!base) return;

    const wood = this.ctx.woodStockpile[ownerId];
    const stone = this.ctx.stoneStockpile[ownerId];
    const gold = player.resources.gold;
    const toward = ownerId === 0 ? 3 : -3;

    const lumberjacks = player.units.filter(u => u.type === UnitType.LUMBERJACK).length;
    const builders = player.units.filter(u => u.type === UnitType.BUILDER).length;
    const villagers = player.units.filter(u => u.type === UnitType.VILLAGER).length;

    // --- PHASE 0: Build Forestry ---
    if (st.buildPhase === 0) {
      if (!st.forestry && wood >= GAME_CONFIG.buildings.forestry.cost.ai.wood) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, -2);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.forestry.cost.ai.wood;
          player.resources.wood -= GAME_CONFIG.buildings.forestry.cost.ai.wood;
          const mesh = this.buildOps.buildForestryMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('forestry', ownerId, pos, mesh);
          st.forestry = { position: pos, worldPosition: pb.worldPosition };
          st.meshes.push(mesh);
        }
      }
      if (st.forestry) st.buildPhase = 1;
    }

    // --- PHASE 1: Build Barracks ---
    if (st.buildPhase === 1) {
      if (!st.barracks && wood >= GAME_CONFIG.buildings.barracks.cost.ai.wood) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, 0);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.barracks.cost.ai.wood;
          player.resources.wood -= GAME_CONFIG.buildings.barracks.cost.ai.wood;
          const mesh = this.buildOps.buildBarracksMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('barracks', ownerId, pos, mesh, GAME_CONFIG.defenses.barracks.maxHealth);
          st.barracks = { position: pos, worldPosition: pb.worldPosition };
          UnitAI.barracksPositions.set(ownerId, pos);
          st.meshes.push(mesh);
        }
      }
      if (st.barracks) st.buildPhase = 2;
    }

    // --- PHASE 2: Build Masonry ---
    if (st.buildPhase === 2) {
      if (!st.masonry && wood >= GAME_CONFIG.buildings.masonry.cost.ai.wood) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, 2);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.masonry.cost.ai.wood;
          player.resources.wood -= GAME_CONFIG.buildings.masonry.cost.ai.wood;
          const mesh = this.buildOps.buildMasonryMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('masonry', ownerId, pos, mesh);
          st.masonry = { position: pos, worldPosition: pb.worldPosition };
          st.meshes.push(mesh);
        }
      }
      if (st.masonry) st.buildPhase = 3;
    }

    // --- PHASE 3: Build Farmhouse ---
    if (st.buildPhase === 3) {
      if (!st.farmhouse && wood >= GAME_CONFIG.buildings.farmhouse.cost.ai.wood) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, 0, toward);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.farmhouse.cost.ai.wood;
          player.resources.wood -= GAME_CONFIG.buildings.farmhouse.cost.ai.wood;
          const mesh = this.buildOps.buildFarmhouseMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('farmhouse', ownerId, pos, mesh);
          st.farmhouse = { position: pos, worldPosition: pb.worldPosition };
          UnitAI.farmhousePositions.set(ownerId, pos);
          st.meshes.push(mesh);
        }
      }
      if (st.farmhouse) st.buildPhase = 4;
    }

    // --- PHASE 4: Build Workshop ---
    if (st.buildPhase === 4) {
      if (!st.workshop
          && wood >= GAME_CONFIG.buildings.workshop.cost.ai.wood
          && stone >= GAME_CONFIG.buildings.workshop.cost.ai.stone) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward * 2, 0);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.workshop.cost.ai.wood;
          this.ctx.stoneStockpile[ownerId] -= GAME_CONFIG.buildings.workshop.cost.ai.stone;
          player.resources.wood -= GAME_CONFIG.buildings.workshop.cost.ai.wood;
          player.resources.stone -= GAME_CONFIG.buildings.workshop.cost.ai.stone;
          const mesh = this.buildOps.buildWorkshopMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('workshop', ownerId, pos, mesh);
          st.workshop = { position: pos, worldPosition: pb.worldPosition };
          st.meshes.push(mesh);
        }
      }
      if (st.workshop) st.buildPhase = 5;
    }

    // --- PHASE 5: Build Silo ---
    if (st.buildPhase === 5) {
      if (!st.silo && wood >= GAME_CONFIG.buildings.silo.cost.ai.wood) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, 0, -toward);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.silo.cost.ai.wood;
          player.resources.wood -= GAME_CONFIG.buildings.silo.cost.ai.wood;
          const mesh = this.buildOps.buildSiloMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('silo', ownerId, pos, mesh);
          st.silo = { position: pos, worldPosition: pb.worldPosition };
          UnitAI.siloPositions.set(ownerId, pos);
          st.meshes.push(mesh);
        }
      }
      if (st.silo) st.buildPhase = 6;
    }

    // --- PHASE 6: Build Smelter ---
    if (st.buildPhase === 6) {
      if (!st.smelter
          && wood >= GAME_CONFIG.buildings.smelter.cost.ai.wood
          && stone >= GAME_CONFIG.buildings.smelter.cost.ai.stone) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, -toward);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.smelter.cost.ai.wood;
          this.ctx.stoneStockpile[ownerId] -= GAME_CONFIG.buildings.smelter.cost.ai.stone;
          player.resources.wood -= GAME_CONFIG.buildings.smelter.cost.ai.wood;
          player.resources.stone -= GAME_CONFIG.buildings.smelter.cost.ai.stone;
          const mesh = this.buildOps.buildSmelterMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('smelter', ownerId, pos, mesh);
          st.smelter = { position: pos, worldPosition: pb.worldPosition };
          st.meshes.push(mesh);
        }
      }
      if (st.smelter) st.buildPhase = 7;
    }

    // --- PHASE 7: Build Armory ---
    if (st.buildPhase === 7) {
      if (!st.armory
          && wood >= GAME_CONFIG.buildings.armory.cost.ai.wood
          && stone >= GAME_CONFIG.buildings.armory.cost.ai.stone) {
        const steel = this.ctx.steelStockpile[ownerId];
        if (steel >= GAME_CONFIG.buildings.armory.cost.ai.steel) {
          const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward * 2, -toward);
          if (pos) {
            this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.armory.cost.ai.wood;
            this.ctx.stoneStockpile[ownerId] -= GAME_CONFIG.buildings.armory.cost.ai.stone;
            this.ctx.steelStockpile[ownerId] -= GAME_CONFIG.buildings.armory.cost.ai.steel;
            player.resources.wood -= GAME_CONFIG.buildings.armory.cost.ai.wood;
            player.resources.stone -= GAME_CONFIG.buildings.armory.cost.ai.stone;
            player.resources.steel -= GAME_CONFIG.buildings.armory.cost.ai.steel;
            const mesh = this.buildOps.buildArmoryMesh(pos, ownerId);
            const pb = this.buildOps.registerBuilding('armory', ownerId, pos, mesh);
            st.armory = { position: pos, worldPosition: pb.worldPosition };
            st.meshes.push(mesh);
          }
        }
      }
      if (st.armory) st.buildPhase = 8;
    }

    // --- PHASE 8: Build Wizard Tower ---
    if (st.buildPhase === 8) {
      if (!st.wizard_tower
          && wood >= GAME_CONFIG.buildings.wizard_tower.cost.ai.wood
          && stone >= GAME_CONFIG.buildings.wizard_tower.cost.ai.stone) {
        const crystal = player.resources.crystal;
        if (crystal >= GAME_CONFIG.buildings.wizard_tower.cost.ai.crystal) {
          const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, -toward, -toward);
          if (pos) {
            this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.buildings.wizard_tower.cost.ai.wood;
            this.ctx.stoneStockpile[ownerId] -= GAME_CONFIG.buildings.wizard_tower.cost.ai.stone;
            player.resources.wood -= GAME_CONFIG.buildings.wizard_tower.cost.ai.wood;
            player.resources.stone -= GAME_CONFIG.buildings.wizard_tower.cost.ai.stone;
            player.resources.crystal -= GAME_CONFIG.buildings.wizard_tower.cost.ai.crystal;
            const mesh = this.buildOps.buildWizardTowerMesh(pos, ownerId);
            const pb = this.buildOps.registerBuilding('wizard_tower', ownerId, pos, mesh);
            st.wizard_tower = { position: pos, worldPosition: pb.worldPosition };
            st.meshes.push(mesh);
          }
        }
      }
      if (st.wizard_tower) st.buildPhase = 9;
    }

    // --- ONGOING: Sell excess wood for gold ---
    if (st.barracks && this.ctx.woodStockpile[ownerId] >= GAME_CONFIG.economy.trade.sellWoodThreshold) {
      this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.economy.trade.sellWood.input.wood;
      player.resources.wood -= GAME_CONFIG.economy.trade.sellWood.input.wood;
      this.ctx.goldStockpile[ownerId] += GAME_CONFIG.economy.trade.sellWood.output.gold;
      player.resources.gold += GAME_CONFIG.economy.trade.sellWood.output.gold;
    }

    // --- ONGOING: Auto-craft charcoal ---
    const charcoal = player.resources.charcoal;
    const clay = this.ctx.clayStockpile[ownerId];
    if (wood >= GAME_CONFIG.economy.recipes.charcoal.input.wood
        && clay >= GAME_CONFIG.economy.recipes.charcoal.input.clay
        && charcoal < GAME_CONFIG.economy.ai.charcoalTarget) {
      this.ctx.woodStockpile[ownerId] -= GAME_CONFIG.economy.recipes.charcoal.input.wood;
      this.ctx.clayStockpile[ownerId] -= GAME_CONFIG.economy.recipes.charcoal.input.clay;
      player.resources.wood -= GAME_CONFIG.economy.recipes.charcoal.input.wood;
      player.resources.clay -= GAME_CONFIG.economy.recipes.charcoal.input.clay;
      player.resources.charcoal += GAME_CONFIG.economy.recipes.charcoal.output.charcoal;
      this.ctx.charcoalStockpile[ownerId] += GAME_CONFIG.economy.recipes.charcoal.output.charcoal;
    }

    // --- ONGOING: Auto-smelt steel (if smelter is built) ---
    if (st.smelter) {
      const steel = this.ctx.steelStockpile[ownerId];
      const iron = player.resources.iron;
      const charcoalNeeded = player.resources.charcoal;
      if (iron >= GAME_CONFIG.economy.recipes.steel.input.iron
          && charcoalNeeded >= GAME_CONFIG.economy.recipes.steel.input.charcoal
          && steel < GAME_CONFIG.economy.ai.steelTarget) {
        player.resources.iron -= GAME_CONFIG.economy.recipes.steel.input.iron;
        this.ctx.ironStockpile[ownerId] -= GAME_CONFIG.economy.recipes.steel.input.iron;
        player.resources.charcoal -= GAME_CONFIG.economy.recipes.steel.input.charcoal;
        this.ctx.charcoalStockpile[ownerId] -= GAME_CONFIG.economy.recipes.steel.input.charcoal;
        player.resources.steel += GAME_CONFIG.economy.recipes.steel.output.steel;
        this.ctx.steelStockpile[ownerId] += GAME_CONFIG.economy.recipes.steel.output.steel;
      }
    }

    // --- ONGOING: Queue workers ---
    if (st.forestry && lumberjacks < GAME_CONFIG.economy.ai.workerCaps.lumberjack && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.LUMBERJACK, building: 'forestry' });
    }
    if (st.masonry && builders < GAME_CONFIG.economy.ai.workerCaps.builder && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.BUILDER, building: 'masonry' });
    }
    if (st.farmhouse && villagers < GAME_CONFIG.economy.ai.workerCaps.villager && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.VILLAGER, building: 'farmhouse' });
    }

    // --- ONGOING: Queue combat units ---
    const maxQueue = Math.min(
      GAME_CONFIG.economy.ai.spawnQueue.baseSize + st.waveNumber,
      GAME_CONFIG.economy.ai.spawnQueue.maxSize
    );
    const steel = this.ctx.steelStockpile[ownerId];
    const crystal = player.resources.crystal;

    // Pop cap check: count live combat units vs food-based cap
    const FREE_TYPES = new Set([UnitType.BUILDER, UnitType.LUMBERJACK, UnitType.VILLAGER]);
    const combatCount = this.ctx.allUnits.filter(u => u.owner === ownerId && u.currentHealth > 0 && !FREE_TYPES.has(u.type)).length;
    const food = this.ctx.foodStockpile[ownerId] ?? 0;
    const popCap = Math.floor(food / FOOD_PER_COMBAT_UNIT);
    const atPopCap = combatCount >= popCap;

    if (st.barracks && gold >= GAME_CONFIG.units[UnitType.WARRIOR].costs.ai.gold && st.spawnQueue.length < maxQueue && !atPopCap) {
      const wave = st.waveNumber;

      // Build a weighted roster from ALL available buildings
      const roster: Array<{ type: UnitType; cost: number; weight: number }> = [];

      // --- Barracks core (always available) ---
      roster.push({
        type: UnitType.WARRIOR,
        cost: GAME_CONFIG.units[UnitType.WARRIOR].costs.ai.gold,
        weight: GAME_CONFIG.units[UnitType.WARRIOR].aiWeight,
      });
      roster.push({
        type: UnitType.ARCHER,
        cost: GAME_CONFIG.units[UnitType.ARCHER].costs.ai.gold,
        weight: GAME_CONFIG.units[UnitType.ARCHER].aiWeight,
      });
      roster.push({
        type: UnitType.SCOUT,
        cost: GAME_CONFIG.units[UnitType.SCOUT].costs.ai.gold,
        weight: GAME_CONFIG.units[UnitType.SCOUT].aiWeight,
      });

      // --- Armory units (require steel) ---
      if (st.armory && steel >= GAME_CONFIG.units[UnitType.GREATSWORD].costs.ai.steel) {
        if (gold >= GAME_CONFIG.units[UnitType.GREATSWORD].costs.ai.gold) {
          roster.push({ type: UnitType.GREATSWORD, cost: GAME_CONFIG.units[UnitType.GREATSWORD].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.GREATSWORD].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.BERSERKER].costs.ai.gold) {
          roster.push({ type: UnitType.BERSERKER, cost: GAME_CONFIG.units[UnitType.BERSERKER].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.BERSERKER].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.ai.gold) {
          roster.push({ type: UnitType.SHIELDBEARER, cost: GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.SHIELDBEARER].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.ASSASSIN].costs.ai.gold) {
          roster.push({ type: UnitType.ASSASSIN, cost: GAME_CONFIG.units[UnitType.ASSASSIN].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.ASSASSIN].aiWeight });
        }
      }

      // --- Wizard Tower units (require crystal) ---
      if (st.wizard_tower && crystal >= GAME_CONFIG.units[UnitType.MAGE].costs.ai.crystal) {
        if (gold >= GAME_CONFIG.units[UnitType.MAGE].costs.ai.gold) {
          roster.push({ type: UnitType.MAGE, cost: GAME_CONFIG.units[UnitType.MAGE].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.MAGE].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.ai.gold) {
          roster.push({ type: UnitType.BATTLEMAGE, cost: GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.BATTLEMAGE].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.HEALER].costs.ai.gold) {
          roster.push({ type: UnitType.HEALER, cost: GAME_CONFIG.units[UnitType.HEALER].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.HEALER].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.PALADIN].costs.ai.gold && crystal >= GAME_CONFIG.units[UnitType.PALADIN].costs.ai.crystal) {
          roster.push({ type: UnitType.PALADIN, cost: GAME_CONFIG.units[UnitType.PALADIN].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.PALADIN].aiWeight });
        }
      }

      // --- Workshop units (wave 2+) ---
      if (st.workshop && wave >= 2) {
        if (gold >= GAME_CONFIG.units[UnitType.RIDER].costs.ai.gold) {
          roster.push({ type: UnitType.RIDER, cost: GAME_CONFIG.units[UnitType.RIDER].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.RIDER].aiWeight });
        }
        if (gold >= GAME_CONFIG.units[UnitType.TREBUCHET].costs.ai.gold) {
          roster.push({ type: UnitType.TREBUCHET, cost: GAME_CONFIG.units[UnitType.TREBUCHET].costs.ai.gold, weight: GAME_CONFIG.units[UnitType.TREBUCHET].aiWeight });
        }
      }

      // Weighted random selection from the full roster
      const totalWeight = roster.reduce((sum, r) => sum + r.weight, 0);
      let roll = Math.random() * totalWeight;
      let pick = roster[roster.length - 1]; // fallback
      for (const entry of roster) {
        roll -= entry.weight;
        if (roll <= 0) { pick = entry; break; }
      }

      if (gold >= pick.cost) {
        st.spawnQueue.push({ type: pick.type, cost: pick.cost });
      }
    }

    // --- ONGOING: Direct lumberjacks toward enemy ---
    if (lumberjacks >= 2) {
      const enemyBase = this.ctx.bases.find(b => b.owner !== ownerId && !b.destroyed);
      if (enemyBase) {
        const idleLumberjacks = player.units.filter(u =>
          u.type === UnitType.LUMBERJACK && u.state === UnitState.IDLE
        );
        for (let i = 0; i < Math.min(idleLumberjacks.length, 2); i++) {
          const lj = idleLumberjacks[i];
          const dirQ = enemyBase.position.q > base.position.q ? 1 : -1;
          let bestForest: HexCoord | null = null;
          let bestDist = Infinity;
          for (let dq = 0; dq < 15; dq++) {
            for (let dr = -5; dr <= 5; dr++) {
              const q = lj.position.q + dq * dirQ;
              const r = lj.position.r + dr;
              const key = `${q},${r}`;
              const tile = this.ctx.currentMap!.tiles.get(key);
              if (tile && tile.terrain === TerrainType.FOREST) {
                const dist = Math.abs(q - lj.position.q) + Math.abs(r - lj.position.r);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestForest = { q, r };
                }
              }
            }
          }
          if (bestForest) {
            UnitAI.commandMove(lj, bestForest, this.ctx.currentMap!);
          }
        }
      }
    }
  }

  // ===================== AI SPAWN QUEUE =====================

  updateSmartAISpawnQueue(ownerId: number, delta: number): void {
    if (!this.ctx.currentMap) return;
    const st = this.aiState[ownerId];
    const player = this.ctx.players[ownerId];
    if (!player) return;

    const getAISteelCost = (type: UnitType): number => {
      switch (type) {
        case UnitType.GREATSWORD:   return GAME_CONFIG.units[UnitType.GREATSWORD].costs.ai.steel;
        case UnitType.BERSERKER:    return GAME_CONFIG.units[UnitType.BERSERKER].costs.ai.steel;
        case UnitType.SHIELDBEARER: return GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.ai.steel;
        case UnitType.ASSASSIN:     return GAME_CONFIG.units[UnitType.ASSASSIN].costs.ai.steel;
        default:                    return 0;
      }
    };

    const getAICrystalCost = (type: UnitType): number => {
      switch (type) {
        case UnitType.MAGE:       return GAME_CONFIG.units[UnitType.MAGE].costs.ai.crystal;
        case UnitType.BATTLEMAGE: return GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.ai.crystal;
        case UnitType.HEALER:     return GAME_CONFIG.units[UnitType.HEALER].costs.ai.crystal;
        case UnitType.PALADIN:    return GAME_CONFIG.units[UnitType.PALADIN].costs.ai.crystal;
        default:                  return 0;
      }
    };

    // Combat unit spawning from barracks, armory, and wizard tower
    if (st.barracks && st.spawnQueue.length > 0) {
      st.spawnTimer += delta;
      if (st.spawnTimer >= GAME_CONFIG.timers.ai.combatSpawn) {
        st.spawnTimer = 0;
        const next = st.spawnQueue[0];

        // Check if we have the required resources
        let canSpawn = player.resources.gold >= next.cost;

        // Armory units require steel
        const armoryUnits = [UnitType.GREATSWORD, UnitType.BERSERKER, UnitType.SHIELDBEARER, UnitType.ASSASSIN];
        if (canSpawn && armoryUnits.includes(next.type)) {
          canSpawn = this.ctx.steelStockpile[ownerId] >= getAISteelCost(next.type);
        }

        // Wizard tower units require crystal
        const wizardUnits = [UnitType.MAGE, UnitType.BATTLEMAGE, UnitType.HEALER, UnitType.PALADIN];
        if (canSpawn && wizardUnits.includes(next.type)) {
          canSpawn = player.resources.crystal >= getAICrystalCost(next.type);
        }

        // Workshop units require rope and stone
        const workshopUnits = [UnitType.TREBUCHET];
        if (canSpawn && workshopUnits.includes(next.type)) {
          canSpawn = true; // Trebuchet has no rope requirement
        }

        if (canSpawn) {
          this.ctx.goldStockpile[ownerId] -= next.cost;
          player.resources.gold -= next.cost;

          // Deduct steel for armory units
          if (armoryUnits.includes(next.type)) {
            this.ctx.steelStockpile[ownerId] -= getAISteelCost(next.type);
            player.resources.steel -= getAISteelCost(next.type);
          }

          // Deduct crystal for wizard tower units
          if (wizardUnits.includes(next.type)) {
            player.resources.crystal -= getAICrystalCost(next.type);
          }

          st.spawnQueue.shift();

          // Determine spawn building based on unit type
          let spawnFrom = st.barracks;
          if (armoryUnits.includes(next.type) && st.armory) {
            spawnFrom = st.armory;
          } else if (wizardUnits.includes(next.type) && st.wizard_tower) {
            spawnFrom = st.wizard_tower;
          } else if (workshopUnits.includes(next.type) && st.workshop) {
            spawnFrom = st.workshop;
          }

          const pos = this.ctx.findSpawnTile(this.ctx.currentMap!, spawnFrom.position.q, spawnFrom.position.r, true);
          const unit = UnitFactory.create(next.type, ownerId, pos);
          const wp = this.ctx.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          player.units.push(unit);
          this.ctx.allUnits.push(unit);
          this.ctx.unitRenderer.addUnit(unit, this.ctx.getElevation(pos));
          if (ownerId === 0) this.ctx.selectionManager.setPlayerUnits(this.ctx.allUnits, 0);
        }
      }
    }

    // Worker unit spawning from respective buildings
    if (st.workerSpawnQueue.length > 0) {
      st.workerSpawnTimer += delta;
      if (st.workerSpawnTimer >= GAME_CONFIG.timers.ai.workerSpawn) {
        st.workerSpawnTimer = 0;
        const next = st.workerSpawnQueue[0];
        const building = next.building === 'forestry' ? st.forestry :
                         next.building === 'masonry' ? st.masonry :
                         next.building === 'farmhouse' ? st.farmhouse : null;
        if (building) {
          st.workerSpawnQueue.shift();
          const pos = this.ctx.findSpawnTile(this.ctx.currentMap!, building.position.q, building.position.r, true);
          const unit = UnitFactory.create(next.type, ownerId, pos);
          const wp = this.ctx.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          player.units.push(unit);
          this.ctx.allUnits.push(unit);
          this.ctx.unitRenderer.addUnit(unit, this.ctx.getElevation(pos));
          if (ownerId === 0) this.ctx.selectionManager.setPlayerUnits(this.ctx.allUnits, 0);
        }
      }
    }
  }

  // ===================== AI COMMANDER =====================

  updateSmartAICommander(ownerId: number, delta: number): void {
    if (!this.ctx.currentMap) return;
    const MAP_SIZE = 50;
    const centerQ = Math.floor(MAP_SIZE / 2);
    const centerR = Math.floor(MAP_SIZE / 2);
    const st = this.aiState[ownerId];

    st.autoMarchTimer += delta;
    if (!st.battleStarted && st.autoMarchTimer >= GAME_CONFIG.timers.ai.autoMarchStart) st.battleStarted = true;
    if (!st.battleStarted) return;

    st.cmdTimer += delta;
    if (st.cmdTimer < GAME_CONFIG.timers.ai.commanderTick) return; // Run every 1.5s for responsive squad management
    st.cmdTimer = 0;

    const player = this.ctx.players[ownerId];
    if (!player) return;

    // ===== Categorize all bases =====
    const ownBase = this.ctx.bases.find(b => b.owner === ownerId && !b.destroyed);
    if (!ownBase) return;

    const ownOutposts = this.ctx.bases.filter(b => b.owner === ownerId && !b.destroyed && b !== ownBase);
    const neutralBases = this.ctx.bases.filter(b => b.owner === 2 && !b.destroyed);
    const enemyCapitalId = ownerId === 0 ? 'base_1' : 'base_0';
    const enemyCapital = this.ctx.bases.find(b => b.id === enemyCapitalId && !b.destroyed);
    const enemyOutposts = this.ctx.bases.filter(b => b.owner !== ownerId && b.owner !== 2 && !b.destroyed && b.id !== enemyCapitalId);

    // All capture targets sorted by distance from own base
    const captureTargets = [...neutralBases, ...enemyOutposts].sort((a, b) =>
      Pathfinder.heuristic(ownBase.position, a.position) - Pathfinder.heuristic(ownBase.position, b.position)
    );
    const allNonOwnBases = [...captureTargets, ...(enemyCapital ? [enemyCapital] : [])];
    const hasUnclaimedTerritory = captureTargets.length > 0;

    // ===== Combat unit census =====
    const combatUnits = player.units.filter(u =>
      u.type !== UnitType.BUILDER && u.type !== UnitType.LUMBERJACK && u.type !== UnitType.VILLAGER
      && !UnitAI.isDead(u)
    );
    const totalAlive = combatUnits.length;

    // ===== Structure garrison — put archers/mages in gates for ranged defense =====
    if (this.garrisonOps) {
      const gates = this.garrisonOps.getGatesBuilt();
      for (const gateKey of gates) {
        const gateOwner = this.garrisonOps.getGateOwner(gateKey);
        if (gateOwner !== ownerId) continue;
        const cap = this.garrisonOps.getCapacity(gateKey);
        if (!cap || cap.current >= cap.max) continue;
        const [gq, gr] = gateKey.split(',').map(Number);
        const gatePos: HexCoord = { q: gq, r: gr };
        const rangedIdle = combatUnits.filter(u =>
          u.state === UnitState.IDLE && !u._squadId &&
          (u.type === UnitType.ARCHER || u.type === UnitType.MAGE) &&
          Pathfinder.heuristic(u.position, gatePos) <= 3 && !u._garrisoned
        );
        if (rangedIdle.length > 0) {
          const toGarrison = rangedIdle.slice(0, cap.max - cap.current);
          this.garrisonOps.garrison(toGarrison, gateKey);
        }
      }
    }

    // ===== PERSISTENT SQUAD SYSTEM (max 4 squads per team) =====
    // Every combat unit must be in a squad. Squads always have a real objective.
    // Unassigned units join the nearest squad. If no squads exist, form one.

    // 1. Build objective list — real objectives only
    const objectives: { pos: HexCoord; label: string; stance: UnitStance; priority: number }[] = [];

    // Detect enemy units near our bases for DEFEND objectives
    const enemyId = ownerId === 0 ? 1 : 0;
    const enemyUnits = this.ctx.players[enemyId]?.units.filter(u => !UnitAI.isDead(u)) ?? [];

    // DEFEND — own bases being contested (enemy units within 5 hex) — HIGHEST priority
    // Require 2+ enemies for outposts, 1+ for capital to avoid over-reacting to scouts
    const ownBases = [ownBase, ...ownOutposts];
    for (const base of ownBases) {
      const enemyNearby = enemyUnits.filter(u =>
        Pathfinder.heuristic(u.position, base.position) <= 5
      ).length;
      const threshold = base === ownBase ? 1 : 2; // Capital: 1 enemy, outposts: 2+ enemies
      if (enemyNearby >= threshold) {
        objectives.push({
          pos: base.position,
          label: 'DEFEND',
          stance: UnitStance.AGGRESSIVE,
          priority: base === ownBase ? 8 : 7, // Capital defense is top priority
        });
      }
    }

    // CAPTURE — all non-owned bases (neutral and enemy outposts)
    // Enemy outposts get slightly higher priority than neutrals
    for (const target of captureTargets) {
      const isEnemyOutpost = target.owner !== 2; // Not neutral = enemy-held
      objectives.push({
        pos: target.position,
        label: 'CAPTURE',
        stance: isEnemyOutpost ? UnitStance.AGGRESSIVE : UnitStance.DEFENSIVE,
        priority: isEnemyOutpost ? 5 : 4, // Enemy outposts slightly above neutrals
      });
    }

    // ASSAULT — enemy capital, always available
    if (enemyCapital) {
      objectives.push({
        pos: enemyCapital.position,
        label: 'ASSAULT',
        stance: UnitStance.AGGRESSIVE,
        priority: hasUnclaimedTerritory ? 2 : 6, // Top priority when no unclaimed territory
      });
    }

    objectives.sort((a, b) => b.priority - a.priority);

    // 2. Collect all units currently in each squad
    const squadMembers = new Map<number, Unit[]>(); // squadDisplayId -> units
    for (const sq of st.squads) {
      squadMembers.set(sq.id, []);
    }
    for (const u of combatUnits) {
      if (u._squadId != null && squadMembers.has(u._squadId)) {
        squadMembers.get(u._squadId)!.push(u);
      }
    }

    // 2b. Graduate joining units or re-path them toward the moving squad
    for (const sq of st.squads) {
      const core = (squadMembers.get(sq.id) ?? []).filter(u => !u._squadJoining);
      if (core.length === 0) continue;
      const centroid = this.centroidOf(core);
      for (const u of (squadMembers.get(sq.id) ?? []).filter(u => u._squadJoining)) {
        const dist = Pathfinder.heuristic(u.position, centroid);
        if (dist <= 5) {
          // Graduate — close enough to join the formation
          u._squadJoining = false;
          // Match the squad's march speed (25th percentile based)
          const grpSpeeds = [...core, u].map(m => m.moveSpeed).sort((a, b) => a - b);
          const gp25 = grpSpeeds[Math.max(0, Math.floor(grpSpeeds.length * 0.25))];
          u._squadSpeed = gp25 + (u.moveSpeed - gp25) * 0.3;
          if (sq.target && this.ctx.currentMap) UnitAI.commandMove(u, sq.target, this.ctx.currentMap);
          if (this.tacticalGroupManager) {
            const tgm = core.find(m => m._tacticalGroupId != null);
            if (tgm) { const g = this.tacticalGroupManager.getGroupForUnit(tgm); if (g) g.addUnit(u); }
          }
          core.push(u);
        } else if (this.ctx.currentMap) {
          // Intercept: path to objective if it's closer than centroid, else path to centroid
          let target = centroid;
          if (sq.target) {
            const dObj = Pathfinder.heuristic(u.position, sq.target);
            const dCen = Pathfinder.heuristic(u.position, centroid);
            if (dObj < dCen && Pathfinder.heuristic(centroid, sq.target) > 3) target = sq.target;
          }
          UnitAI.commandMove(u, target, this.ctx.currentMap);
        }
      }
    }

    // 3. Prune empty squads
    st.squads = st.squads.filter(sq => ((squadMembers.get(sq.id) ?? []).length > 0));

    // 4. Update squad objectives — advance completed/invalid/stale objectives to next target
    for (const sq of st.squads) {
      const members = squadMembers.get(sq.id) ?? [];
      if (members.length === 0) continue;
      const centroid = this.centroidOf(members);
      const atObj = sq.target && Pathfinder.heuristic(centroid, sq.target) <= 3;
      const stale = !sq.objective || sq.objective === 'RALLY' || sq.objective === '';

      // Check objective validity
      let valid = false;
      if (!stale && sq.target) {
        if (sq.objective === 'ASSAULT') {
          // ASSAULT is valid as long as the target base is still enemy-owned
          const targetBase = this.ctx.bases.find(b =>
            b.position.q === sq.target!.q && b.position.r === sq.target!.r);
          valid = !!targetBase && targetBase.owner !== ownerId && !targetBase.destroyed;
        }
        else if (sq.objective === 'CAPTURE') valid = this.ctx.bases.some(b =>
          b.position.q === sq.target!.q && b.position.r === sq.target!.r && b.owner !== ownerId && !b.destroyed);
        else if (sq.objective === 'DEFEND') valid = enemyUnits.some(u => Pathfinder.heuristic(u.position, sq.target!) <= 6);
      }

      // Also detect stalled squads: majority IDLE, far from objective
      const idleCount = members.filter(u => u.state === UnitState.IDLE).length;
      const stalled = !atObj && idleCount > members.length * 0.5 && Pathfinder.heuristic(centroid, sq.target!) > 5;

      if (stale || atObj || !valid) {
        const taken = new Set(st.squads.filter(s => s.id !== sq.id && s.target).map(s => `${s.target!.q},${s.target!.r}`));
        const next = objectives.find(o => !taken.has(`${o.pos.q},${o.pos.r}`)) || objectives[0];
        if (next) { sq.objective = next.label; sq.target = next.pos; sq.stance = next.stance; }
        this.dispatchToSquad(members, sq, st);
      } else if (stalled) {
        // Squad is valid but stalled far from objective — re-dispatch to get them moving again
        this.dispatchToSquad(members, sq, st);
      }
    }

    // 4b. Emergency DEFEND redirect — pull nearest non-ASSAULT squad to unhandled defense.
    //     Never pull ASSAULT squads (they target the enemy capital — most important).
    //     Only redirect squads that are closer to the defend point than to their current target.
    for (const urgent of objectives.filter(o => o.label === 'DEFEND')) {
      if (st.squads.some(sq => sq.target?.q === urgent.pos.q && sq.target?.r === urgent.pos.r)) continue;
      let best: PersistentSquad | null = null, bestScore = Infinity;
      for (const sq of st.squads) {
        if (sq.objective === 'ASSAULT') continue; // Never pull assault squads to defend
        const m = squadMembers.get(sq.id) ?? [];
        if (m.length === 0) continue;
        const centroid = this.centroidOf(m);
        const distToDefend = Pathfinder.heuristic(centroid, urgent.pos);
        // Only redirect if squad is closer to the defend point than to its own target
        const distToOwn = sq.target ? Pathfinder.heuristic(centroid, sq.target) : Infinity;
        if (distToDefend > distToOwn) continue; // Don't pull squads far from the threat
        const pri = objectives.find(o => sq.target && o.pos.q === sq.target.q && o.pos.r === sq.target.r)?.priority ?? 0;
        const score = distToDefend + pri * 5;
        if (score < bestScore) { bestScore = score; best = sq; }
      }
      if (best) {
        best.objective = urgent.label; best.target = urgent.pos; best.stance = urgent.stance;
        this.dispatchToSquad(squadMembers.get(best.id) ?? [], best, st);
      }
    }

    // 5. Assign unassigned units to squads (or create first squad)
    const unassigned = combatUnits.filter(u =>
      !UnitAI.isDead(u) && !u._garrisoned &&
      (u._squadId == null || !st.squads.some(sq => sq.id === u._squadId))
    );
    for (const u of unassigned) {
      if (st.squads.length > 0) {
        let bestSq: PersistentSquad | null = null, bestD = Infinity;
        for (const sq of st.squads) {
          const m = squadMembers.get(sq.id) ?? [];
          if (m.length === 0) continue;
          const d = Pathfinder.heuristic(u.position, this.centroidOf(m));
          if (d < bestD) { bestD = d; bestSq = sq; }
        }
        if (!bestSq) bestSq = st.squads[0];
        this.assignUnitToSquad(u, bestSq, st);
        squadMembers.get(bestSq.id)!.push(u);
      } else {
        const obj = objectives[0];
        const usedIds = new Set(st.squads.map(s => s.id));
        let newId = 1;
        while (usedIds.has(newId) && newId <= MAX_SQUADS_PER_TEAM) newId++;
        const newSquad: PersistentSquad = {
          id: newId,
          objective: obj?.label ?? 'ASSAULT',
          target: obj?.pos ?? (enemyCapital?.position ?? ownBase.position),
          stance: obj?.stance ?? UnitStance.AGGRESSIVE,
        };
        st.squads.push(newSquad);
        squadMembers.set(newId, [u]);
        this.assignUnitToSquad(u, newSquad, st);
      }
    }

    // 6. Split large squads if more objectives available
    if (st.squads.length < MAX_SQUADS_PER_TEAM && objectives.length > st.squads.length) {
      const taken = new Set(st.squads.filter(s => s.target).map(s => `${s.target!.q},${s.target!.r}`));
      for (const obj of objectives.filter(o => !taken.has(`${o.pos.q},${o.pos.r}`))) {
        if (st.squads.length >= MAX_SQUADS_PER_TEAM) break;
        let largest: PersistentSquad | null = null, lSize = 0;
        for (const sq of st.squads) {
          const sz = (squadMembers.get(sq.id) ?? []).length;
          if (sz > lSize) { lSize = sz; largest = sq; }
        }
        if (!largest || lSize < 4) break;
        const members = squadMembers.get(largest.id) ?? [];
        members.sort((a, b) => Pathfinder.heuristic(a.position, obj.pos) - Pathfinder.heuristic(b.position, obj.pos));
        const splitOff = members.splice(0, Math.floor(members.length / 2));
        const usedIds = new Set(st.squads.map(s => s.id));
        let newId = 1;
        while (usedIds.has(newId) && newId <= MAX_SQUADS_PER_TEAM) newId++;
        const newSquad: PersistentSquad = { id: newId, objective: obj.label, target: obj.pos, stance: obj.stance };
        st.squads.push(newSquad);
        squadMembers.set(newId, splitOff);
        this.dispatchToSquad(splitOff, newSquad, st);
      }
    }

    // 7. Merge squads at same target or very close with tiny membership
    if (st.squads.length > 1) {
      for (let i = 0; i < st.squads.length; i++) {
        for (let j = i + 1; j < st.squads.length; j++) {
          const a = st.squads[i], b = st.squads[j];
          if (!a.target || !b.target) continue;
          const mA = squadMembers.get(a.id) ?? [], mB = squadMembers.get(b.id) ?? [];
          const same = a.target.q === b.target.q && a.target.r === b.target.r;
          const close = Pathfinder.heuristic(this.centroidOf(mA), this.centroidOf(mB)) <= 5;
          if (same || (close && (mA.length <= 2 || mB.length <= 2))) {
            const [keeper, absorbed] = mA.length >= mB.length ? [a, b] : [b, a];
            for (const u of (squadMembers.get(absorbed.id) ?? [])) {
              this.assignUnitToSquad(u, keeper, st);
              squadMembers.get(keeper.id)!.push(u);
            }
            st.squads.splice(st.squads.indexOf(absorbed), 1);
            squadMembers.delete(absorbed.id);
            j--;
          }
        }
      }
    }

    // 8. ★ CRITICAL: Re-kick idle/stuck squad members toward their objective every tick.
    //    Catches: units that finished a path, lost tactical group, got stuck, or are
    //    "moving" with no actual path progress.
    for (const sq of st.squads) {
      if (!sq.target || !this.ctx.currentMap) continue;
      const members = squadMembers.get(sq.id) ?? [];
      for (const u of members) {
        if (u._squadJoining) continue; // Handled in step 2b
        const distToObj = Pathfinder.heuristic(u.position, sq.target);
        if (distToObj <= 1) continue; // Already at objective (tight: 1 hex)

        // Re-kick if: IDLE, or MOVING but lost path/target (stuck in movement limbo)
        const isStuck = u.state === UnitState.IDLE ||
          (u.state === UnitState.MOVING && (!u.targetPosition || !u._path));
        if (!isStuck) continue;

        u._squadObjective = sq.objective;
        u.stance = sq.stance;
        u._playerCommanded = true;
        UnitAI.commandMove(u, sq.target, this.ctx.currentMap);
      }
    }
  }

  /** Assign a single unit to an existing persistent squad */
  private assignUnitToSquad(unit: Unit, sq: PersistentSquad, st: AIBuildState): void {
    if (!this.ctx.currentMap || !sq.target) return;
    unit._squadId = sq.id;
    unit._squadObjective = sq.objective;
    unit.stance = sq.stance;
    unit._playerCommanded = true;
    unit._postPosition = null;
    st.guardAssignments.delete(unit.id);

    // Check if unit is far from the squad — if so, mark as "joining" (independent pathing)
    const player = this.ctx.players[unit.owner];
    const squadUnits = player?.units.filter(u =>
      u._squadId === sq.id && !UnitAI.isDead(u) && u !== unit && !u._squadJoining
    ) ?? [];

    if (squadUnits.length > 0) {
      const centroid = this.centroidOf(squadUnits);
      const distToSquad = Pathfinder.heuristic(unit.position, centroid);
      if (distToSquad > 4) {
        // Far from squad — use own speed to catch up, don't drag the formation
        unit._squadJoining = true;
        unit._squadSpeed = unit.moveSpeed; // Own speed, not march speed
        // Path toward squad centroid, not the objective
        if (unit.state === UnitState.IDLE || unit.state === UnitState.MOVING) {
          UnitAI.commandMove(unit, centroid, this.ctx.currentMap!);
        }
        // Don't add to tactical group yet — will be added when joining completes
        return;
      }
    }

    // Already near squad or first member — normal assignment
    unit._squadJoining = false;
    const allSquadUnits = player?.units.filter(u => u._squadId === sq.id && !UnitAI.isDead(u)) ?? [];
    // Use 25th percentile speed so one slow unit doesn't drag everyone
    const squadSpeeds = allSquadUnits.map(u => u.moveSpeed).sort((a, b) => a - b);
    const p25 = squadSpeeds[Math.max(0, Math.floor(squadSpeeds.length * 0.25))];
    const fastest = squadSpeeds[squadSpeeds.length - 1] ?? unit.moveSpeed;
    const marchSpeed = p25 + (fastest - p25) * 0.3;
    unit._squadSpeed = marchSpeed;

    // Command to move to squad target
    if (unit.state === UnitState.IDLE || unit.state === UnitState.MOVING) {
      UnitAI.commandMove(unit, sq.target, this.ctx.currentMap!);
    }

    // Add to tactical group if one exists for this squad
    if (this.tacticalGroupManager) {
      const existingMember = allSquadUnits.find(u => u._tacticalGroupId != null && u !== unit);
      if (existingMember) {
        const group = this.tacticalGroupManager.getGroupForUnit(existingMember);
        if (group) group.addUnit(unit);
      }
    }
  }

  /** Dispatch a group of units to a persistent squad's objective */
  private dispatchToSquad(units: Unit[], sq: PersistentSquad, st: AIBuildState): void {
    if (!this.ctx.currentMap || !sq.target || units.length === 0) return;

    // Choose formation based on composition
    const archerCount = units.filter(u =>
      u.type === UnitType.ARCHER || u.type === UnitType.MAGE || u.type === UnitType.BATTLEMAGE
    ).length;
    let formation: FormationType;
    if (archerCount > units.length * GAME_CONFIG.formation.aiRangedLineThreshold) formation = FormationType.LINE;
    else if (units.length >= GAME_CONFIG.formation.aiWedgeMinUnits) formation = FormationType.WEDGE;
    else formation = FormationType.BOX;

    const sorted = [...units].sort((a, b) =>
      Pathfinder.heuristic(a.position, sq.target!) - Pathfinder.heuristic(b.position, sq.target!)
    );

    const slots = this.generateFormationTyped(sq.target, sorted.length, formation);

    // Compute march speed using 25th percentile — prevents one slow unit dragging everyone
    const speeds = sorted.map(u => u.moveSpeed).sort((a, b) => a - b);
    const p25Idx = Math.max(0, Math.floor(speeds.length * 0.25));
    const baseSpeed = speeds[p25Idx];
    const fastestSpeed = speeds[speeds.length - 1];
    const marchSpeed = baseSpeed + (fastestSpeed - baseSpeed) * GAME_CONFIG.formation.aiMarchSpeedCatchupFactor;

    // Create or find tactical group
    let tGroup: TacticalGroup | null = null;
    if (this.tacticalGroupManager && sorted.length >= 2) {
      // Check if squad already has a tactical group
      const existingMember = sorted.find(u => u._tacticalGroupId != null);
      if (existingMember) {
        tGroup = this.tacticalGroupManager.getGroupForUnit(existingMember) ?? null;
      }
      if (!tGroup) {
        tGroup = this.tacticalGroupManager.createGroup(sorted[0].owner, sq.target);
      }
    }

    for (let i = 0; i < sorted.length; i++) {
      const unit = sorted[i];
      unit.stance = sq.stance;
      unit._playerCommanded = true;
      unit._postPosition = null;
      unit._squadId = sq.id;
      unit._squadSpeed = marchSpeed;
      unit._squadObjective = sq.objective;
      st.guardAssignments.delete(unit.id);
      const dest = slots[i] || sq.target;
      UnitAI.commandMove(unit, dest, this.ctx.currentMap!);
      if (tGroup) tGroup.addUnit(unit);
    }
  }

  /** Find the nearest non-owned base for an AI unit to capture */
  private findNearestCaptureTarget(from: HexCoord, ownerId: number): Base | null {
    const targets = this.ctx.bases.filter(b => b.owner !== ownerId && !b.destroyed);
    if (targets.length === 0) return null;
    // Sort: neutral first (easier to capture), then by distance
    targets.sort((a, b) => {
      const aNeutral = a.owner === 2 ? 0 : 1;
      const bNeutral = b.owner === 2 ? 0 : 1;
      if (aNeutral !== bNeutral) return aNeutral - bNeutral;
      return Pathfinder.heuristic(from, a.position) - Pathfinder.heuristic(from, b.position);
    });
    return targets[0];
  }

  /** Check if the target is an underground base (reliable check via capture zone or worldPosition). */
  isTargetBaseUnderground(pos: HexCoord): boolean {
    const base = this.ctx.bases.find(b => b.position.q === pos.q && b.position.r === pos.r && !b.destroyed);
    if (!base) return false;
    const tile = this.ctx.currentMap?.tiles.get(`${pos.q},${pos.r}`);
    return !!tile?.hasTunnel && base.worldPosition.y < (tile.elevation ?? 0) * 0.5;
  }

  /** Check if underground movement is beneficial between two points.
   *  Always returns true if the destination is an underground base.
   *  Otherwise returns true if the path is long enough and there are tunnel tiles near both endpoints. */
  private shouldUseUnderground(from: HexCoord, to: HexCoord): boolean {
    if (!ENABLE_UNDERGROUND) return false;
    const map = this.ctx.currentMap;
    if (!map) return false;

    // Always route underground if targeting an underground base
    if (this.isTargetBaseUnderground(to)) return true;

    const dist = Pathfinder.heuristic(from, to);
    if (dist < 8) return false; // Too short to bother with tunnels

    // Check if there are tunnel tiles within 5 hexes of both endpoints
    let nearFrom = false, nearTo = false;
    map.tiles.forEach((tile, key) => {
      if (!tile.hasTunnel) return;
      const [tq, tr] = key.split(',').map(Number);
      if (Pathfinder.heuristic(from, { q: tq, r: tr }) <= 5) nearFrom = true;
      if (Pathfinder.heuristic(to, { q: tq, r: tr }) <= 5) nearTo = true;
    });
    return nearFrom && nearTo;
  }

  // ===================== AI STRATEGIC OBJECTIVES =====================
  // Handles army merging, patrol objectives, harassment, scouting, and worker escorts.
  // Runs every 5 seconds and evaluates higher-level objectives beyond base capture.

  private _stratTimer: number[] = [0, 0];

  /** Strategy tick — currently handled by persistent squad system in commander.
   *  This method is kept for future advanced behaviors (flanking, feints, etc.)
   */
  updateSmartAIStrategy(ownerId: number, _delta: number): void {
    // All squad management (creation, merging, objective assignment, straggler absorption)
    // is now handled by the persistent squad system in updateSmartAICommander.
    // This method is intentionally minimal — no patrol/escort/scout dispatching.
    void ownerId;
  }

  /** Compute hex centroid of a group of units */
  private centroidOf(units: { position: HexCoord }[]): HexCoord {
    if (units.length === 0) return { q: 0, r: 0 };
    let sumQ = 0, sumR = 0;
    for (const u of units) { sumQ += u.position.q; sumR += u.position.r; }
    return { q: Math.round(sumQ / units.length), r: Math.round(sumR / units.length) };
  }

  // ===================== AI TACTICS =====================

  /** Tactics tick — guard assignments are now folded into the persistent squad system.
   *  Individual guard posts no longer create separate squad IDs.
   */
  updateSmartAITactics(ownerId: number, delta: number): void {
    // Guard assignment is no longer needed — all combat units are managed
    // through the persistent squad system (max 4 squads per team).
    // All squad objectives are handled by the persistent squad system in the commander.
    void ownerId; void delta;
  }

  // ===================== CHOKE POINT =====================

  findChokePoint(from: HexCoord, to: HexCoord): HexCoord | null {
    if (!this.ctx.currentMap) return null;
    const steps = 20;
    let bestTile: HexCoord | null = null;
    let bestScore = 0;

    for (let i = 3; i < steps - 3; i++) {
      const t = i / steps;
      const q = Math.round(from.q + (to.q - from.q) * t);
      const r = Math.round(from.r + (to.r - from.r) * t);
      const key = `${q},${r}`;
      const tile = this.ctx.currentMap.tiles.get(key);
      if (!tile || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.MOUNTAIN) continue;
      if (Pathfinder.blockedTiles.has(key)) continue;

      const neighbors = Pathfinder.getHexNeighbors({ q, r });
      let blockedCount = 0;
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        const nTile = this.ctx.currentMap.tiles.get(nKey);
        if (!nTile || nTile.terrain === TerrainType.WATER || nTile.terrain === TerrainType.MOUNTAIN
            || nTile.terrain === TerrainType.FOREST || Pathfinder.blockedTiles.has(nKey)
            || (nTile.elevation >= 8)) {
          blockedCount++;
        }
      }

      const midBonus = 1 - Math.abs(t - 0.4) * 2;
      const score = blockedCount * 2 + midBonus;
      if (blockedCount >= 2 && score > bestScore) {
        bestScore = score;
        bestTile = { q, r };
      }
    }
    return bestTile;
  }

  // ===================== FORMATIONS =====================

  getUnitFormationPriority(unit: Unit): number {
    switch (unit.type) {
      case UnitType.PALADIN:
      case UnitType.GREATSWORD:
      case UnitType.SHIELDBEARER:   return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.WARRIOR:
      case UnitType.BERSERKER:      return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.RIDER:          return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.LUMBERJACK:
      case UnitType.BUILDER:
      case UnitType.VILLAGER:       return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.ARCHER:
      case UnitType.MAGE:
      case UnitType.BATTLEMAGE:     return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.ASSASSIN:
      case UnitType.SCOUT:          return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.HEALER:         return GAME_CONFIG.formation.aiPriorities[unit.type];
      case UnitType.TREBUCHET:      return GAME_CONFIG.formation.aiPriorities[unit.type];
      default:                      return GAME_CONFIG.formation.aiPriorities.default;
    }
  }

  generateFormationTyped(center: HexCoord, count: number, formation: FormationType): HexCoord[] {
    if (count <= 1) return [center];
    switch (formation) {
      case FormationType.LINE:   return this.generateLineFormation(center, count);
      case FormationType.BOX:    return this.generateFormation(center, count);
      case FormationType.WEDGE:  return this.generateWedgeFormation(center, count);
      case FormationType.CIRCLE: return this.generateCircleFormation(center, count);
      default:                   return this.generateFormation(center, count);
    }
  }

  private generateFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [center];
    for (let radius = 1; slots.length < count && radius <= GAME_CONFIG.formation.boxMaxRadius; radius++) {
      const ring = this.getHexRing(center, radius);
      for (const hex of ring) {
        if (slots.length >= count) break;
        const key = `${hex.q},${hex.r}`;
        const tile = this.ctx.currentMap?.tiles.get(key);
        if (tile && !this.ctx.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
            && !Pathfinder.blockedTiles.has(key)) {
          slots.push(hex);
        }
      }
    }
    return slots;
  }

  // Old dispatchSquad removed — replaced by persistent squad system (dispatchToSquad + assignUnitToSquad)

  private generateLineFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [];
    const half = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      const offset = i - half;
      const q = center.q;
      const r = center.r + offset;
      const key = `${q},${r}`;
      const tile = this.ctx.currentMap?.tiles.get(key);
      if (tile && !this.ctx.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
          && !Pathfinder.blockedTiles.has(key)) {
        slots.push({ q, r });
      } else {
        slots.push(center);
      }
    }
    return slots;
  }

  private generateWedgeFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [center];
    let row = 1;
    while (slots.length < count) {
      for (let col = -row; col <= row && slots.length < count; col++) {
        const q = center.q - row;
        const r = center.r + col;
        const key = `${q},${r}`;
        const tile = this.ctx.currentMap?.tiles.get(key);
        if (tile && !this.ctx.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
            && !Pathfinder.blockedTiles.has(key)) {
          slots.push({ q, r });
        }
      }
      row++;
      if (row > GAME_CONFIG.formation.wedgeMaxRows) break;
    }
    return slots;
  }

  private generateCircleFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [];
    for (let radius = 1; slots.length < count && radius <= GAME_CONFIG.formation.circleMaxRadius; radius++) {
      const ring = this.getHexRing(center, radius);
      const step = Math.max(1, Math.floor(ring.length / Math.min(count - slots.length, ring.length)));
      for (let i = 0; i < ring.length && slots.length < count; i += step) {
        const hex = ring[i];
        const key = `${hex.q},${hex.r}`;
        const tile = this.ctx.currentMap?.tiles.get(key);
        if (tile && !this.ctx.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
            && !Pathfinder.blockedTiles.has(key)) {
          slots.push(hex);
        }
      }
    }
    return slots.length > 0 ? slots : [center];
  }

  getHexRing(center: HexCoord, radius: number): HexCoord[] {
    const ring: HexCoord[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-dq - dr));
        if (dist === radius) {
          ring.push({ q: center.q + dq, r: center.r + dr });
        }
      }
    }
    return ring;
  }

  findSurroundTile(base: { position: HexCoord }, unit: Unit): HexCoord {
    const bq = base.position.q;
    const br = base.position.r;
    const ring: HexCoord[] = [];
    for (let dq = -2; dq <= 2; dq++) {
      for (let dr = -2; dr <= 2; dr++) {
        const dist = Math.abs(dq) + Math.abs(dr);
        if (dist === 2) {
          const q = bq + dq;
          const r = br + dr;
          const tile = this.ctx.currentMap?.tiles.get(`${q},${r}`);
          if (tile && !this.ctx.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN) {
            ring.push({ q, r });
          }
        }
      }
    }
    if (ring.length === 0) {
      return { q: bq + (unit.position.q < bq ? -1 : 1), r: br };
    }
    let best = ring[0];
    let bestDist = Infinity;
    for (const t of ring) {
      // Offset (odd-q) to cube distance
      const x1 = t.q, z1 = t.r - (t.q - (t.q & 1)) / 2, y1 = -x1 - z1;
      const x2 = unit.position.q, z2 = unit.position.r - (unit.position.q - (unit.position.q & 1)) / 2, y2 = -x2 - z2;
      const d = Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  // ===================== CLEANUP =====================

  cleanup(): void {
    this.aiState = [createAIBuildState(), createAIBuildState()];
  }
}
