// ============================================
// AIController - AI Economy, Commander, Tactics
// ============================================

import * as THREE from 'three';
import {
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
} from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { UnitFactory } from '../entities/UnitFactory';
import type { PlacedBuilding, BuildingKind } from '../../types';

/** Slim interface for the building operations AIController needs */
export interface AIBuildingOps {
  aiFindBuildTile(baseQ: number, baseR: number, offsetQ: number, offsetR: number): HexCoord | null;
  buildForestryMesh(pos: HexCoord, owner: number): THREE.Group;
  buildBarracksMesh(pos: HexCoord, owner: number): THREE.Group;
  buildMasonryMesh(pos: HexCoord, owner: number): THREE.Group;
  buildFarmhouseMesh(pos: HexCoord, owner: number): THREE.Group;
  buildWorkshopMesh(pos: HexCoord, owner: number): THREE.Group;
  buildSiloMesh(pos: HexCoord, owner: number): THREE.Group;
  registerBuilding(kind: BuildingKind, owner: number, pos: HexCoord, mesh: THREE.Group, maxHealth?: number): PlacedBuilding;
}

export default class AIController {
  private ctx: GameContext;
  private buildOps: AIBuildingOps;
  aiState: [AIBuildState, AIBuildState] = [createAIBuildState(), createAIBuildState()];

  constructor(ctx: GameContext, buildOps: AIBuildingOps) {
    this.ctx = ctx;
    this.buildOps = buildOps;
  }

  // ===================== AI ECONOMY =====================

  updateSmartAIEconomy(ownerId: number, delta: number): void {
    if (!this.ctx.currentMap) return;
    const st = this.aiState[ownerId];
    st.econTimer += delta;
    if (st.econTimer < 3) return;
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
      if (!st.forestry && wood >= 8) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, -2);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 8;
          player.resources.wood -= 8;
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
      if (!st.barracks && wood >= 10) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, 0);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 10;
          player.resources.wood -= 10;
          const mesh = this.buildOps.buildBarracksMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('barracks', ownerId, pos, mesh, 40);
          st.barracks = { position: pos, worldPosition: pb.worldPosition };
          UnitAI.barracksPositions.set(ownerId, pos);
          st.meshes.push(mesh);
        }
      }
      if (st.barracks) st.buildPhase = 2;
    }

    // --- PHASE 2: Build Masonry ---
    if (st.buildPhase === 2) {
      if (!st.masonry && wood >= 10) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward, 2);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 10;
          player.resources.wood -= 10;
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
      if (!st.farmhouse && wood >= 8) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, 0, toward);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 8;
          player.resources.wood -= 8;
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
      if (!st.workshop && wood >= 15 && stone >= 5) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, toward * 2, 0);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 15;
          this.ctx.stoneStockpile[ownerId] -= 5;
          player.resources.wood -= 15;
          player.resources.stone -= 5;
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
      if (!st.silo && wood >= 6) {
        const pos = this.buildOps.aiFindBuildTile(base.position.q, base.position.r, 0, -toward);
        if (pos) {
          this.ctx.woodStockpile[ownerId] -= 6;
          player.resources.wood -= 6;
          const mesh = this.buildOps.buildSiloMesh(pos, ownerId);
          const pb = this.buildOps.registerBuilding('silo', ownerId, pos, mesh);
          st.silo = { position: pos, worldPosition: pb.worldPosition };
          UnitAI.siloPositions.set(ownerId, pos);
          st.meshes.push(mesh);
        }
      }
      if (st.silo) st.buildPhase = 6;
    }

    // --- ONGOING: Sell excess wood for gold ---
    if (st.barracks && this.ctx.woodStockpile[ownerId] >= 15) {
      this.ctx.woodStockpile[ownerId] -= 4;
      player.resources.wood -= 4;
      player.resources.gold += 5;
    }

    // --- ONGOING: Queue workers ---
    if (st.forestry && lumberjacks < 4 && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.LUMBERJACK, building: 'forestry' });
    }
    if (st.masonry && builders < 3 && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.BUILDER, building: 'masonry' });
    }
    if (st.farmhouse && villagers < 3 && st.workerSpawnQueue.length < 2) {
      st.workerSpawnQueue.push({ type: UnitType.VILLAGER, building: 'farmhouse' });
    }

    // --- ONGOING: Queue combat units ---
    const maxQueue = Math.min(3 + st.waveNumber, 8);
    if (st.barracks && gold >= 5 && st.spawnQueue.length < maxQueue) {
      const roll = Math.random();
      const wave = st.waveNumber;
      if (st.workshop && wave >= 3 && roll < 0.1) {
        st.spawnQueue.push({ type: UnitType.TREBUCHET, cost: 15 });
      } else if (wave >= 2 && roll < 0.25 && gold >= 10) {
        st.spawnQueue.push({ type: UnitType.RIDER, cost: 10 });
      } else if (roll < 0.45 && gold >= 8) {
        st.spawnQueue.push({ type: UnitType.ARCHER, cost: 8 });
      } else if (roll < 0.55 && gold >= 6) {
        st.spawnQueue.push({ type: UnitType.PALADIN, cost: 6 });
      } else {
        st.spawnQueue.push({ type: UnitType.WARRIOR, cost: 5 });
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

    // Combat unit spawning from barracks
    if (st.barracks && st.spawnQueue.length > 0) {
      st.spawnTimer += delta;
      if (st.spawnTimer >= 5) {
        st.spawnTimer = 0;
        const next = st.spawnQueue[0];
        if (player.resources.gold >= next.cost) {
          player.resources.gold -= next.cost;
          st.spawnQueue.shift();
          const spawnFrom = next.type === UnitType.TREBUCHET && st.workshop ? st.workshop : st.barracks;
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
      if (st.workerSpawnTimer >= 4) {
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
    if (!st.battleStarted && st.autoMarchTimer >= 3) st.battleStarted = true;
    if (!st.battleStarted) return;

    st.cmdTimer += delta;
    if (st.cmdTimer < 3) return;
    st.cmdTimer = 0;

    const player = this.ctx.players[ownerId];
    if (!player) return;

    const enemyBase = this.ctx.bases.find(b => b.owner !== ownerId && !b.destroyed);

    const combatUnits = player.units.filter(u =>
      u.type !== UnitType.BUILDER && u.type !== UnitType.LUMBERJACK && u.type !== UnitType.VILLAGER
    );
    const idleCombat = combatUnits.filter(u => u.state === UnitState.IDLE);
    st.armySize = idleCombat.length;

    const minArmySize = Math.min(3 + st.waveNumber, 6);

    if (st.mustering && st.armySize >= minArmySize) {
      st.mustering = false;
      st.waveNumber++;

      const archerCount = idleCombat.filter(u => u.type === UnitType.ARCHER).length;
      const totalCount = idleCombat.length;
      let formation: FormationType;
      if (archerCount > totalCount * 0.5) formation = FormationType.LINE;
      else if (totalCount >= 5) formation = FormationType.WEDGE;
      else formation = FormationType.BOX;

      let targetCenter: HexCoord;
      if (enemyBase) {
        const approachQ = enemyBase.position.q + (enemyBase.position.q < centerQ ? 3 : -3);
        targetCenter = { q: approachQ, r: enemyBase.position.r };
      } else {
        targetCenter = { q: centerQ, r: centerR };
      }

      const sortedCombat = [...idleCombat].sort((a, b) =>
        this.getUnitFormationPriority(a) - this.getUnitFormationPriority(b)
      );
      const formationSlots = this.generateFormationTyped(targetCenter, sortedCombat.length, formation);

      for (let i = 0; i < sortedCombat.length; i++) {
        sortedCombat[i].stance = UnitStance.AGGRESSIVE;
        (sortedCombat[i] as any)._postPosition = null;
        st.guardAssignments.delete(sortedCombat[i].id);
        UnitAI.commandMove(sortedCombat[i], formationSlots[i] || targetCenter, this.ctx.currentMap!);
      }

    } else if (!st.mustering) {
      const totalCombat = combatUnits.length;
      const idleRatio = totalCombat > 0 ? idleCombat.length / totalCombat : 1;
      if (idleRatio > 0.6 || totalCombat <= 2) st.mustering = true;

      for (const unit of idleCombat) {
        const enemy = UnitAI.findNearestEnemy(unit, this.ctx.allUnits, ownerId);
        if (enemy) {
          UnitAI.commandAttack(unit, enemy.position, enemy.id, this.ctx.currentMap!);
        } else if (enemyBase) {
          const surroundTile = this.findSurroundTile(enemyBase, unit);
          UnitAI.commandMove(unit, surroundTile, this.ctx.currentMap!);
        }
      }
    } else {
      st.rallyTimer += 3;
      if (st.rallyTimer >= 8) {
        st.rallyTimer = 0;
        if (st.barracks) {
          const rallyQ = st.barracks.position.q + (st.barracks.position.q > centerQ ? -2 : 2);
          const rallyPos: HexCoord = { q: rallyQ, r: st.barracks.position.r };
          for (const unit of idleCombat) {
            if (Pathfinder.heuristic(unit.position, rallyPos) > 3) {
              unit.stance = UnitStance.DEFENSIVE;
              UnitAI.commandMove(unit, rallyPos, this.ctx.currentMap!);
            }
          }
        }
      }
    }
  }

  // ===================== AI TACTICS =====================

  updateSmartAITactics(ownerId: number, delta: number): void {
    if (!this.ctx.currentMap) return;
    const st = this.aiState[ownerId];
    const player = this.ctx.players[ownerId];
    if (!player) return;

    st.tacticsTimer += delta;
    if (st.tacticsTimer < 8) return;
    st.tacticsTimer = 0;

    const base = this.ctx.bases.find(b => b.owner === ownerId && !b.destroyed);
    if (!base) return;

    const combatUnits = player.units.filter(u =>
      u.state !== UnitState.DEAD &&
      (u.type === UnitType.WARRIOR || u.type === UnitType.PALADIN ||
       u.type === UnitType.ARCHER || u.type === UnitType.RIDER)
    );
    const workers = player.units.filter(u =>
      u.state !== UnitState.DEAD &&
      (u.type === UnitType.BUILDER || u.type === UnitType.LUMBERJACK || u.type === UnitType.VILLAGER)
    );

    if (combatUnits.length < 4) {
      for (const [uid] of st.guardAssignments) {
        const u = combatUnits.find(c => c.id === uid);
        if (u && u.stance === UnitStance.DEFENSIVE && u.state === UnitState.IDLE) {
          u.stance = UnitStance.AGGRESSIVE;
        }
      }
      st.guardAssignments.clear();
      return;
    }

    // Clean up dead guard assignments
    for (const [uid] of st.guardAssignments) {
      const u = player.units.find(c => c.id === uid);
      if (!u || u.state === UnitState.DEAD) {
        st.guardAssignments.delete(uid);
      }
    }

    const maxGuards = Math.min(Math.floor(combatUnits.length * 0.3), 4);
    const currentGuards = st.guardAssignments.size;
    if (currentGuards >= maxGuards) return;

    // Identify guard posts
    const guardPosts: { pos: HexCoord; priority: number; label: string }[] = [];

    const enemyBase = this.ctx.bases.find(b => b.owner !== ownerId && !b.destroyed);
    if (enemyBase) {
      const chokePoint = this.findChokePoint(base.position, enemyBase.position);
      if (chokePoint) {
        guardPosts.push({ pos: chokePoint, priority: 3, label: 'choke' });
      }
    }

    const farWorkers = workers.filter(w => Pathfinder.heuristic(w.position, base.position) > 5);
    if (farWorkers.length >= 2) {
      const avgQ = Math.round(farWorkers.reduce((s, w) => s + w.position.q, 0) / farWorkers.length);
      const avgR = Math.round(farWorkers.reduce((s, w) => s + w.position.r, 0) / farWorkers.length);
      guardPosts.push({ pos: { q: avgQ, r: avgR }, priority: 2, label: 'workers' });
    }

    if (enemyBase) {
      const midQ = Math.round((base.position.q + enemyBase.position.q) / 2);
      const loneWorkers = workers.filter(w => {
        const distToMid = Math.abs(w.position.q - midQ);
        return distToMid < 5 || Pathfinder.heuristic(w.position, enemyBase!.position) < 10;
      });
      for (const lw of loneWorkers.slice(0, 1)) {
        const alreadyEscorted = [...st.guardAssignments.values()].some(
          gp => Pathfinder.heuristic(gp, lw.position) <= 3
        );
        if (!alreadyEscorted) {
          guardPosts.push({ pos: { ...lw.position }, priority: 2, label: 'escort' });
        }
      }
    }

    const buildingsToGuard: { position: HexCoord }[] = [];
    if (st.forestry) buildingsToGuard.push(st.forestry);
    if (st.farmhouse) buildingsToGuard.push(st.farmhouse);
    if (st.silo) buildingsToGuard.push(st.silo);
    for (const bld of buildingsToGuard) {
      const alreadyGuarded = [...st.guardAssignments.values()].some(
        gp => Pathfinder.heuristic(gp, bld.position) <= 3
      );
      if (!alreadyGuarded) {
        guardPosts.push({ pos: bld.position, priority: 1, label: 'building' });
      }
    }

    guardPosts.sort((a, b) => b.priority - a.priority);

    const alreadyGuarding = new Set(st.guardAssignments.keys());
    const availableUnits = combatUnits.filter(u =>
      u.state === UnitState.IDLE &&
      u.stance !== UnitStance.DEFENSIVE &&
      !alreadyGuarding.has(u.id)
    );
    availableUnits.sort((a, b) => {
      const prioA = a.type === UnitType.PALADIN ? 0 : a.type === UnitType.WARRIOR ? 1 : 2;
      const prioB = b.type === UnitType.PALADIN ? 0 : b.type === UnitType.WARRIOR ? 1 : 2;
      return prioA - prioB;
    });

    for (const post of guardPosts) {
      if (st.guardAssignments.size >= maxGuards) break;
      if (availableUnits.length === 0) break;
      const alreadyCovered = [...st.guardAssignments.values()].some(
        gp => Pathfinder.heuristic(gp, post.pos) <= 2
      );
      if (alreadyCovered) continue;
      const guard = availableUnits.shift()!;
      guard.stance = UnitStance.DEFENSIVE;
      UnitAI.commandMove(guard, post.pos, this.ctx.currentMap!);
      st.guardAssignments.set(guard.id, post.pos);
    }

    // Re-position drifted guards
    for (const [uid, postPos] of st.guardAssignments) {
      const guard = player.units.find(c => c.id === uid);
      if (!guard || guard.state !== UnitState.IDLE) continue;
      if (Pathfinder.heuristic(guard.position, postPos) > 4) {
        UnitAI.commandMove(guard, postPos, this.ctx.currentMap!);
      }
    }

    // Release guards during attack waves
    if (!st.mustering) {
      for (const [uid] of st.guardAssignments) {
        const u = player.units.find(c => c.id === uid);
        if (u && u.state === UnitState.IDLE && u.stance === UnitStance.DEFENSIVE) {
          const postPos = st.guardAssignments.get(uid)!;
          const isChokeGuard = enemyBase && this.findChokePoint(base.position, enemyBase.position)
            && Pathfinder.heuristic(postPos, this.findChokePoint(base.position, enemyBase.position)!) <= 2;
          if (!isChokeGuard && combatUnits.length <= 6) {
            u.stance = UnitStance.AGGRESSIVE;
            st.guardAssignments.delete(uid);
          }
        }
      }
    }
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
      case UnitType.PALADIN:       return 0;
      case UnitType.WARRIOR:        return 1;
      case UnitType.RIDER:          return 2;
      case UnitType.LUMBERJACK:
      case UnitType.BUILDER:
      case UnitType.VILLAGER:       return 3;
      case UnitType.ARCHER:
      case UnitType.MAGE:           return 4;
      case UnitType.CATAPULT:
      case UnitType.TREBUCHET:
      case UnitType.SCOUT:          return 5;
      default:                      return 3;
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
    for (let radius = 1; slots.length < count && radius <= 5; radius++) {
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
      if (row > 6) break;
    }
    return slots;
  }

  private generateCircleFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [];
    for (let radius = 1; slots.length < count && radius <= 5; radius++) {
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
      const d = Math.abs(t.q - unit.position.q) + Math.abs(t.r - unit.position.r);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  // ===================== CLEANUP =====================

  cleanup(): void {
    this.aiState = [createAIBuildState(), createAIBuildState()];
  }
}
