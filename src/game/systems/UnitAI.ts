// ============================================
// CUBITOPIA - RTS Unit AI System
// Handles unit movement, combat, and behaviors
// ============================================

import * as THREE from 'three';
import { Unit, UnitType, UnitState, UnitStance, CommandType, HexCoord, GameMap, TerrainType, Player } from '../../types';
import { Pathfinder } from './Pathfinder';
import { CombatSystem } from './CombatSystem';
import { CombatLog } from '../../ui/ArenaDebugConsole';

export interface UnitAIDebugFlags {
  disableChop?: boolean;
  disableMine?: boolean;
  disableHarvest?: boolean;
  disableBuild?: boolean;
  disableDeposit?: boolean;
  disableAutoReturn?: boolean;
  disableCombat?: boolean;
}

export class UnitAI {
  /** Track which tree tile each lumberjack is targeting — prevents stacking */
  static claimedTrees: Map<string, string> = new Map(); // "q,r" → unitId

  /** Farm patch positions set by player */
  static farmPatches: Set<string> = new Set(); // "q,r" keys
  /** Grass harvest tiles marked by player — villagers harvest tall grass for hay */
  static playerGrassBlueprint: Set<string> = new Set(); // "q,r" keys
  /** Auto-harvestable grass tiles (populated by main.ts with harvestable grass stages) */
  static grassTiles: Set<string> = new Set(); // "q,r" keys
  /** Silo position per player */
  static siloPositions: Map<number, HexCoord> = new Map();
  /** Farmhouse position per player */
  static farmhousePositions: Map<number, HexCoord> = new Map();
  /** Track which farm patch each villager is targeting */
  static claimedFarms: Map<string, string> = new Map(); // "q,r" → unitId
  /** Track built walls (set by main.ts) */
  static wallsBuilt: Set<string> = new Set(); // "q,r" keys
  /** Track wall owners (set by main.ts) */
  static wallOwners: Map<string, number> = new Map(); // "q,r" → owner
  /** Stone stockpile reference (synced from main.ts each frame) */
  static stoneStockpile: number[] = [0, 0];

  /** Per-unit blacklist of tiles that failed pathfinding — avoids retrying same unreachable target every frame.
   *  Key: unitId, Value: Map of "q,r" → expiry timestamp */
  private static unreachableCache: Map<string, Map<string, number>> = new Map();
  private static readonly UNREACHABLE_TIMEOUT = 10_000; // 10 seconds before retrying

  /** Mark a tile as temporarily unreachable for a specific unit */
  private static markUnreachable(unitId: string, tileKey: string): void {
    let unitCache = UnitAI.unreachableCache.get(unitId);
    if (!unitCache) {
      unitCache = new Map();
      UnitAI.unreachableCache.set(unitId, unitCache);
    }
    unitCache.set(tileKey, Date.now() + UnitAI.UNREACHABLE_TIMEOUT);
  }

  /** Clear all unreachable caches (call on new game) */
  static clearUnreachableCache(): void {
    UnitAI.unreachableCache.clear();
  }

  /** Check if a tile is still marked unreachable for a unit */
  static isUnreachable(unitId: string, tileKey: string): boolean {
    const unitCache = UnitAI.unreachableCache.get(unitId);
    if (!unitCache) return false;
    const expiry = unitCache.get(tileKey);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      unitCache.delete(tileKey);
      return false;
    }
    return true;
  }

  /**
   * Update all units for one frame
   */
  /** Debug flags passed from HUD — controls worker/combat behaviors */
  static debugFlags: UnitAIDebugFlags = {};

  static update(players: Player[], map: GameMap, delta: number): UnitEvent[] {
    const events: UnitEvent[] = [];
    const allUnits = players.flatMap(p => p.units);

    for (const player of players) {
      for (const unit of player.units) {
        if (unit.state === UnitState.DEAD) continue;

        // Decrease cooldowns
        unit.attackCooldown = Math.max(0, unit.attackCooldown - delta);
        unit.gatherCooldown = Math.max(0, unit.gatherCooldown - delta);

        // Healer passive: heal nearby allies every tick
        if (unit.type === UnitType.HEALER) {
          const healed = CombatSystem.processHealerTick(unit, allUnits, delta);
          for (const hid of healed) events.push({ type: 'heal', healerId: unit.id, targetId: hid } as any);
        }

        switch (unit.state) {
          case UnitState.IDLE:
            UnitAI.handleIdle(unit, allUnits, player, map, events);
            break;
          case UnitState.MOVING:
            UnitAI.handleMoving(unit, allUnits, map, delta, events);
            break;
          case UnitState.ATTACKING:
            if (!UnitAI.debugFlags.disableCombat) {
              UnitAI.handleAttacking(unit, allUnits, player, delta, events, map);
            } else {
              unit.state = UnitState.IDLE;
              unit.command = null;
            }
            break;
          case UnitState.BUILDING:
            UnitAI.handleBuilding(unit, map, delta, events);
            break;
          case UnitState.GATHERING:
            UnitAI.handleGathering(unit, map, delta, events);
            break;
          case UnitState.RETURNING:
            UnitAI.handleReturning(unit, map, delta, events);
            break;
        }
      }
    }

    return events;
  }

  /**
   * Issue a move command to a unit
   */
  static commandMove(unit: Unit, target: HexCoord, map: GameMap): void {
    const canTraverseForest = unit.type === UnitType.LUMBERJACK;
    const path = Pathfinder.findPath(unit.position, target, map, canTraverseForest, unit.owner);
    if (path.length > 1) {
      unit.command = { type: CommandType.MOVE, targetPosition: target, targetUnitId: null };
      unit.targetPosition = path[1]; // Next step
      unit.state = UnitState.MOVING;
      unit._path = path;
      unit._pathIndex = 1;
      // For DEFENSIVE stance: the move destination becomes the unit's new "post"
      // so it returns here after chasing enemies away.
      // Only set if no post exists yet — AI kite/chase moves must not overwrite
      // the original player-commanded position.
      if (unit.stance === UnitStance.DEFENSIVE && !unit._postPosition) {
        unit._postPosition = { ...target };
      }
    }
  }

  /**
   * Issue an attack-move command
   */
  static commandAttack(unit: Unit, target: HexCoord, targetUnitId: string | null, map: GameMap): void {
    unit.command = { type: CommandType.ATTACK, targetPosition: target, targetUnitId };

    if (targetUnitId) {
      // Direct attack - move toward target
      const path = Pathfinder.findPath(unit.position, target, map, false, unit.owner);
      if (path.length > 1) {
        unit.targetPosition = path[1];
        unit.state = UnitState.MOVING;
        unit._path = path;
        unit._pathIndex = 1;
      }
    } else {
      // Attack-move: move to position, attack anything on the way
      UnitAI.commandMove(unit, target, map);
      unit.command!.type = CommandType.ATTACK;
    }
  }

  /**
   * Stop a unit
   */
  static commandStop(unit: Unit): void {
    unit.command = null;
    unit.targetPosition = null;
    unit.state = UnitState.IDLE;
    unit._path = null;
    unit._pathIndex = 0;
  }

  // --- State Handlers ---

  private static handleIdle(unit: Unit, allUnits: Unit[], player: Player, map: GameMap, events: UnitEvent[]): void {
    // --- Healer: seek injured allies and stay near them ---
    if (unit.type === UnitType.HEALER) {
      let bestAlly: Unit | null = null;
      let bestScore = Infinity;
      for (const ally of allUnits) {
        if (ally.owner !== unit.owner || ally === unit || ally.currentHealth <= 0) continue;
        if (ally.currentHealth >= ally.stats.maxHealth) continue;
        const dist = Pathfinder.heuristic(unit.position, ally.position);
        const hpRatio = ally.currentHealth / ally.stats.maxHealth;
        const score = dist + hpRatio * 5; // Prioritize low HP + close
        if (score < bestScore) { bestScore = score; bestAlly = ally; }
      }
      if (bestAlly) {
        const dist = Pathfinder.heuristic(unit.position, bestAlly.position);
        if (dist > unit.stats.range) {
          UnitAI.commandMove(unit, bestAlly.position, map);
        }
      } else {
        // No injured allies — follow nearest combat unit
        let nearestCombat: Unit | null = null;
        let nearestDist = Infinity;
        for (const ally of allUnits) {
          if (ally.owner !== unit.owner || ally === unit || ally.currentHealth <= 0) continue;
          if (ally.type === UnitType.HEALER || ally.type === UnitType.BUILDER ||
              ally.type === UnitType.LUMBERJACK || ally.type === UnitType.VILLAGER) continue;
          const d = Pathfinder.heuristic(unit.position, ally.position);
          if (d < nearestDist) { nearestDist = d; nearestCombat = ally; }
        }
        if (nearestCombat && nearestDist > 3) {
          UnitAI.commandMove(unit, nearestCombat.position, map);
        }
      }
      return;
    }

    // --- Worker units: flee from nearby enemies, then do their jobs ---
    if (unit.type === UnitType.BUILDER || unit.type === UnitType.LUMBERJACK || unit.type === UnitType.VILLAGER) {
      // FLEE CHECK: if an enemy is within 3 tiles, run away toward own base
      const nearEnemy = UnitAI.findNearestEnemy(unit, allUnits, player.id);
      if (nearEnemy) {
        const enemyDist = Pathfinder.heuristic(unit.position, nearEnemy.position);
        if (enemyDist <= 3) {
          // Flee: move away from the enemy (toward lower q for p0, higher q for p1)
          const fleeQ = unit.owner === 0
            ? Math.max(0, unit.position.q - 2)
            : Math.min(map.width - 1, unit.position.q + 2);
          const fleeTarget: HexCoord = { q: fleeQ, r: unit.position.r };
          UnitAI.commandMove(unit, fleeTarget, map);
          return;
        }
      }
    }

    if (unit.type === UnitType.BUILDER) {
      // Debug: if both mine and build are disabled, skip all builder AI
      if (UnitAI.debugFlags.disableMine && UnitAI.debugFlags.disableBuild) return;

      // Builders: mine terrain OR build walls — prioritize mine tasks
      UnitAI.releaseMineClaim(unit.id);

      // Player builders check mine blueprints first (skip if disableMine)
      let mineTile: HexCoord | null = null;
      if (!UnitAI.debugFlags.disableMine && unit.owner === 0 && UnitAI.playerMineBlueprint.size > 0) {
        mineTile = UnitAI.findNearestMineBlueprint(unit, map);
      }

      if (mineTile && !UnitAI.debugFlags.disableMine) {
        // Go mine terrain
        const claimKey = `${mineTile.q},${mineTile.r}`;
        UnitAI.claimedMines.set(claimKey, unit.id);

        const dist = Pathfinder.heuristic(unit.position, mineTile);
        // Allow mining from 2 tiles away for ridge tiles (elevation >= 10) since adjacent may also be impassable
        const mineData = map.tiles.get(claimKey);
        const mineReach = (mineData && mineData.elevation >= 10) ? 2 : 1;
        if (dist <= mineReach) {
          unit.state = UnitState.GATHERING;
          unit.command = { type: CommandType.GATHER, targetPosition: mineTile, targetUnitId: null };
          unit.gatherCooldown = 2.5;
        } else {
          // For impassable tiles (ridges, elevation >= 10), pathfind to nearest walkable tile
          // within 2 hex rings (ridges can be clustered, so ring-1 may all be impassable)
          const mineTileData = map.tiles.get(claimKey);
          if (mineTileData && mineTileData.elevation >= 10) {
            let bestAdj: HexCoord | null = null;
            let bestAdjDist = Infinity;
            // Search ring 1 first, then ring 2 if needed
            for (let ring = 1; ring <= 2 && !bestAdj; ring++) {
              const candidates = ring === 1
                ? Pathfinder.getHexNeighbors(mineTile)
                : Pathfinder.getHexNeighbors(mineTile).flatMap(n => Pathfinder.getHexNeighbors(n));
              for (const n of candidates) {
                const nKey = `${n.q},${n.r}`;
                const nTile = map.tiles.get(nKey);
                if (nTile && nTile.terrain !== TerrainType.WATER && nTile.elevation < 10
                    && !Pathfinder.blockedTiles.has(nKey)) {
                  const d = Pathfinder.heuristic(unit.position, n);
                  if (d < bestAdjDist) {
                    bestAdjDist = d;
                    bestAdj = n;
                  }
                }
              }
            }
            if (bestAdj) {
              UnitAI.commandMove(unit, bestAdj, map);
            }
          } else {
            UnitAI.commandMove(unit, mineTile, map);
          }
        }
        return;
      }

      // AI builders: mine for stone when needed, build when they have stone
      // Player builders: auto-mine only if no wall blueprints pending
      const wallSpot = UnitAI.debugFlags.disableBuild ? null : UnitAI.findWallSpot(unit, map);
      const hasStone = UnitAI.stoneStockpile[unit.owner] >= 1;
      const hasGateStone = UnitAI.stoneStockpile[unit.owner] >= 2;

      // AI: if there are wall spots AND they have stone, go build
      if (wallSpot && unit.owner !== 0) {
        // Check if we have enough stone (gates cost 2, walls cost 1)
        const isGate = unit._planIsGate === true;
        const enoughStone = isGate ? hasGateStone : hasStone;

        if (enoughStone) {
          const dist = Pathfinder.heuristic(unit.position, wallSpot);
          if (dist <= 1) {
            unit.state = UnitState.BUILDING;
            unit.gatherCooldown = 1.5;
            return;
          } else {
            UnitAI.commandMove(unit, wallSpot, map);
            return;
          }
        }
        // Fall through to mining if no stone
      }

      // Auto-mine: AI mines when it needs stone for walls or has nothing else to do
      // Player: auto-mine only if no wall blueprints pending
      const shouldAutoMine = !UnitAI.debugFlags.disableMine
        && (unit.owner !== 0 || UnitAI.playerWallBlueprint.size === 0);
      if (shouldAutoMine) {
        const autoMineTile = UnitAI.findNearestMineSite(unit, map);
        if (autoMineTile) {
          const claimKey = `${autoMineTile.q},${autoMineTile.r}`;
          UnitAI.claimedMines.set(claimKey, unit.id);

          const autoMineData = map.tiles.get(claimKey);
          const autoMineReach = (autoMineData && autoMineData.elevation >= 10) ? 2 : 1;
          const dist = Pathfinder.heuristic(unit.position, autoMineTile);
          if (dist <= autoMineReach) {
            unit.state = UnitState.GATHERING;
            unit.command = { type: CommandType.GATHER, targetPosition: autoMineTile, targetUnitId: null };
            unit.gatherCooldown = 2.5;
          } else {
            let bestAdj: HexCoord | null = null;
            let bestAdjDist = Infinity;
            // Search ring 1 first, then ring 2 for ridge tiles
            for (let ring = 1; ring <= 2 && !bestAdj; ring++) {
              const candidates = ring === 1
                ? Pathfinder.getHexNeighbors(autoMineTile)
                : Pathfinder.getHexNeighbors(autoMineTile).flatMap(n => Pathfinder.getHexNeighbors(n));
              for (const n of candidates) {
                const nKey = `${n.q},${n.r}`;
                const nTile = map.tiles.get(nKey);
                if (nTile && nTile.terrain !== TerrainType.WATER && nTile.elevation < 10
                    && !Pathfinder.blockedTiles.has(nKey)) {
                  const d = Pathfinder.heuristic(unit.position, n);
                  if (d < bestAdjDist) {
                    bestAdjDist = d;
                    bestAdj = n;
                  }
                }
              }
            }
            if (bestAdj) {
              UnitAI.commandMove(unit, bestAdj, map);
              // If pathfinding failed, blacklist this mine temporarily
              if (unit.state === UnitState.IDLE) {
                UnitAI.claimedMines.delete(claimKey);
                UnitAI.markUnreachable(unit.id, claimKey);
              }
            }
          }
          return;
        }
      }

      // Player builders: check for wall building (skip if disableBuild)
      if (wallSpot && unit.owner === 0) {
        const dist = Pathfinder.heuristic(unit.position, wallSpot);
        if (dist <= 1) {
          unit.state = UnitState.BUILDING;
          unit.gatherCooldown = 1.5;
        } else {
          UnitAI.commandMove(unit, wallSpot, map);
        }
      }
      return;
    }

    if (unit.type === UnitType.LUMBERJACK) {
      // Debug: if chop is disabled, skip lumberjack AI
      if (UnitAI.debugFlags.disableChop) return;

      // Release any previous claims
      UnitAI.releaseTreeClaim(unit.id);

      // Player lumberjacks: only chop trees (mining is for builders)
      let forestTile: HexCoord | null = null;

      if (unit.owner === 0 && UnitAI.playerHarvestBlueprint.size > 0) {
        forestTile = UnitAI.findNearestHarvestBlueprint(unit, map);
      }

      // Fallback: auto-find safe forest (both player and AI)
      if (!forestTile) {
        forestTile = UnitAI.findNearestSafeForest(unit, map);
      }

      if (forestTile) {
        const claimKey = `${forestTile.q},${forestTile.r}`;
        UnitAI.claimedTrees.set(claimKey, unit.id);

        const dist = Pathfinder.heuristic(unit.position, forestTile);
        if (dist <= 1) {
          unit.state = UnitState.GATHERING;
          unit.command = { type: CommandType.GATHER, targetPosition: forestTile, targetUnitId: null };
          unit.gatherCooldown = 3.0;
        } else {
          UnitAI.commandMove(unit, forestTile, map);
          // If pathfinding failed (unit still idle), blacklist this tree temporarily
          if (unit.state === UnitState.IDLE) {
            UnitAI.claimedTrees.delete(claimKey);
            UnitAI.markUnreachable(unit.id, claimKey);
          }
        }
      }
      return;
    }

    if (unit.type === UnitType.VILLAGER) {
      // Debug: if harvest is disabled, skip villager AI
      if (UnitAI.debugFlags.disableHarvest) return;

      // Villager: find farm patch or tall grass to harvest, carry food to silo/base
      UnitAI.releaseTreeClaim(unit.id); // reuse claim system

      let farmTile: HexCoord | null = null;
      let grassTile: HexCoord | null = null;

      // Find nearest unclaimed ready farm patch
      let bestFarmDist = Infinity;
      for (const key of UnitAI.farmPatches) {
        const claimer = UnitAI.claimedFarms.get(key);
        if (claimer && claimer !== unit.id) continue;
        const [q, r] = key.split(',').map(Number);
        const coord = { q, r };
        const dist = Pathfinder.heuristic(unit.position, coord);
        if (dist < bestFarmDist) {
          bestFarmDist = dist;
          farmTile = coord;
        }
      }

      // Find nearest marked tall grass tile
      let bestGrassDist = Infinity;
      for (const key of UnitAI.playerGrassBlueprint) {
        const tile = map.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.PLAINS) {
          UnitAI.playerGrassBlueprint.delete(key);
          continue;
        }
        const claimer = UnitAI.claimedFarms.get(key);
        if (claimer && claimer !== unit.id) continue;
        const [q, r] = key.split(',').map(Number);
        const coord = { q, r };
        const dist = Pathfinder.heuristic(unit.position, coord);
        if (dist < bestGrassDist) {
          bestGrassDist = dist;
          grassTile = coord;
        }
      }

      // Fallback: auto-harvest nearest tall grass if no unclaimed farm/grass targets found
      if (!grassTile && !farmTile) {
        grassTile = UnitAI.findNearestTallGrass(unit, map);
        if (grassTile) {
          bestGrassDist = Pathfinder.heuristic(unit.position, grassTile);
        }
      }

      // Pick whichever food source is closer
      let target: HexCoord | null = null;
      if (grassTile && farmTile) {
        target = bestGrassDist <= bestFarmDist ? grassTile : farmTile;
      } else {
        target = grassTile || farmTile;
      }
      const isGrass = target === grassTile && grassTile !== null;

      if (target) {
        const tKey = `${target.q},${target.r}`;
        UnitAI.claimedFarms.set(tKey, unit.id);

        const dist = Pathfinder.heuristic(unit.position, target);
        if (dist <= 1) {
          unit.state = UnitState.GATHERING;
          unit.command = { type: CommandType.GATHER, targetPosition: target, targetUnitId: null };
          unit.gatherCooldown = isGrass ? 2.5 : 4.0; // Grass is faster to cut than farming
        } else {
          UnitAI.commandMove(unit, target, map);
          // If pathfinding failed (unit still idle), blacklist this tile temporarily
          if (unit.state === UnitState.IDLE) {
            UnitAI.claimedFarms.delete(tKey);
            UnitAI.markUnreachable(unit.id, tKey);
          }
        }
      }
      return;
    }

    // --- Combat units behavior ---
    if (UnitAI.isCombatUnit(unit)) {

      // Detection ranges per unit type
      const detectionRange = UnitAI.getDetectionRange(unit);

      // PLAYER combat units: behavior depends on stance
      if (unit.owner === 0) {
        // PASSIVE: never attack, just stand still
        if (unit.stance === UnitStance.PASSIVE) {
          return;
        }

        // DEFENSIVE stance: zone-defend behavior for ALL combat units
        // Units chase enemies that enter detection range, then return to their
        // command position when no enemies remain in range.
        // Archers additionally kite melee threats.
        if (unit.stance === UnitStance.DEFENSIVE) {
          const enemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);

          if (enemy) {
            const dist = Pathfinder.heuristic(unit.position, enemy.position);

            // Ranged kiting: flee from ANY melee enemy within 2 hexes (not just current target)
            if (UnitAI.isRangedKiter(unit.type)) {
              const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, 2);
              if (meleeThreat) {
                if (!unit._postPosition) {
                  unit._postPosition = { ...unit.position };
                }
                const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
                if (fleeTile) {
                  CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
                  UnitAI.commandMove(unit, fleeTile, map);
                  unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
                  return;
                } else {
                  CombatLog.logKite(unit, meleeThreat, false);
                }
              }
            }

            if (dist <= detectionRange) {
              // Enemy within our defend zone — engage
              // Remember where we were posted so we can return later
              if (!unit._postPosition) {
                unit._postPosition = { ...unit.position };
              }
              if (dist <= unit.stats.range) {
                // In weapon range — attack
                unit.state = UnitState.ATTACKING;
                unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
              } else {
                // Chase into range (ranged kiters hold position in defensive — they only fire at weapon range)
                if (UnitAI.isRangedKiter(unit.type)) {
                  // Ranged units hold and wait for targets to enter weapon range
                } else {
                  UnitAI.commandAttack(unit, enemy.position, enemy.id, map);
                }
              }
              return;
            }
          }

          // No enemy in defend zone — return to post if we have one
          const post = unit._postPosition;
          if (post) {
            const distToPost = Pathfinder.heuristic(unit.position, post);
            if (distToPost > 1) {
              UnitAI.commandMove(unit, post, map);
              return;
            }
            // Back at post — clear it
            unit._postPosition = null;
          }

          // Siege units can attack walls while holding position
          if (unit.isSiege) {
            const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
            if (adjacentWall) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
              return;
            }
          }
          return; // Hold position
        }

        // AGGRESSIVE: patrol and auto-attack enemies found within detection range
        if (unit.stance === UnitStance.AGGRESSIVE && !UnitAI.debugFlags.disableCombat) {
          const enemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);

          if (UnitAI.isRangedKiter(unit.type) && enemy) {
            const dist = Pathfinder.heuristic(unit.position, enemy.position);
            // Ranged kiters in AGGRESSIVE: engage but still kite ANY melee threat nearby
            const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, 2);
            if (meleeThreat) {
              const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
              if (fleeTile) {
                CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
                UnitAI.commandMove(unit, fleeTile, map);
                unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
                return;
              } else {
                CombatLog.logKite(unit, meleeThreat, false);
              }
            }
            if (dist <= unit.stats.range) {
              unit.state = UnitState.ATTACKING;
              unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
              return;
            }
            // In aggressive mode ranged kiters WILL chase into detection range
            if (dist <= detectionRange) {
              UnitAI.commandAttack(unit, enemy.position, enemy.id, map);
              return;
            }
          } else if (enemy) {
            const dist = Pathfinder.heuristic(unit.position, enemy.position);
            if (dist <= unit.stats.range) {
              unit.state = UnitState.ATTACKING;
              unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
              return;
            }
            if (dist <= detectionRange) {
              UnitAI.commandAttack(unit, enemy.position, enemy.id, map);
              return;
            }
          }
          // Siege: attack adjacent enemy walls
          if (unit.isSiege) {
            const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
            if (adjacentWall) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
              return;
            }
          }
          // Arena mode: actively seek nearest enemy and charge
          if (UnitAI.arenaMode) {
            const nearestEnemy = UnitAI.findNearestEnemy(unit, allUnits, player.id);
            if (nearestEnemy) {
              UnitAI.commandAttack(unit, nearestEnemy.position, nearestEnemy.id, map);
            }
            return;
          }
          // Patrol: if unit has a patrol route, walk it
          const patrolRoute = unit._patrolRoute;
          if (patrolRoute && patrolRoute.length > 0) {
            const patrolIdx = (unit._patrolIdx ?? 0) || 0;
            const target = patrolRoute[patrolIdx % patrolRoute.length];
            unit._patrolIdx = (patrolIdx + 1) % patrolRoute.length;
            UnitAI.commandMove(unit, target, map);
            return;
          }
          return; // No patrol route, just stand and scan
        }

        return; // Fallback: do nothing
      }

      // ===== AI combat units: auto-engage nearby enemies, attack walls, then rally/wave =====
      if (UnitAI.debugFlags.disableCombat) return;
      const enemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);

      if (enemy) {
        const dist = Pathfinder.heuristic(unit.position, enemy.position);

        // AI ranged kiters flee ANY melee threat nearby (not just current target)
        if (UnitAI.isRangedKiter(unit.type)) {
          const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, 2);
          if (meleeThreat) {
            const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
            if (fleeTile) {
              CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
              UnitAI.commandMove(unit, fleeTile, map);
              unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
              return;
            } else {
              CombatLog.logKite(unit, meleeThreat, false);
            }
          }
        }

        if (dist <= unit.stats.range) {
          unit.state = UnitState.ATTACKING;
          unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
          return;
        }
        if (dist <= detectionRange) {
          UnitAI.commandAttack(unit, enemy.position, enemy.id, map);
          return;
        }
      }

      // AI: only siege units attack walls/structures
      if (unit.isSiege) {
        const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
        if (adjacentWall) {
          events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
          return;
        }
      }

      // Arena mode: always seek nearest enemy and charge — no rally/wave
      if (UnitAI.arenaMode) {
        const nearestEnemy = UnitAI.findNearestEnemy(unit, allUnits, player.id);
        if (nearestEnemy) {
          UnitAI.commandAttack(unit, nearestEnemy.position, nearestEnemy.id, map);
        }
        return;
      }

      // AI: rally near barracks, then attack in waves
      const rallyPoint = UnitAI.barracksPositions.get(unit.owner) ?? UnitAI.basePositions.get(unit.owner);
      if (!rallyPoint) return;

      const idleCombat = allUnits.filter(u =>
        u.owner === unit.owner && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u)
      );
      const distToRally = Pathfinder.heuristic(unit.position, rallyPoint);

      // AI: once enough combat units are idle, send them all on an attack wave
      const idleCount = idleCombat.filter(u => u.state === UnitState.IDLE).length;
      if (idleCount >= 4) {
        const enemyBase = UnitAI.basePositions.get(unit.owner === 0 ? 1 : 0);
        if (enemyBase) {
          const spread = Math.floor(Math.random() * 5) - 2;
          const attackTarget: HexCoord = { q: enemyBase.q + spread, r: enemyBase.r + Math.floor(Math.random() * 3) - 1 };
          UnitAI.commandMove(unit, attackTarget, map);
          return;
        }
      }

      // Hold formation: if too far from rally point, move closer
      if (distToRally > 3) {
        const formationPos = UnitAI.getFormationSlot(unit, idleCombat, rallyPoint, map);
        if (formationPos) {
          UnitAI.commandMove(unit, formationPos, map);
        }
      }
      // Otherwise stay put — AI unit is already near rally in formation
    }
  }

  // --- Building: places wall blocks around the builder ---
  private static handleBuilding(unit: Unit, map: GameMap, delta: number, events: UnitEvent[]): void {
    unit.gatherCooldown -= delta;
    if (unit.gatherCooldown > 0) return;

    // Place a wall block at a nearby empty spot
    unit.gatherCooldown = 1.5; // Faster wall placement (was 2.5)

    // Find a suitable wall placement tile near the unit
    const wallTarget = UnitAI.findWallSpot(unit, map);
    if (wallTarget) {
      const isGate = unit._planIsGate === true;
      events.push({
        type: isGate ? 'builder:place_gate' : 'builder:place_wall',
        unit,
        result: { position: wallTarget },
      });
    }
  }

  // --- Gathering: chops trees (lumberjack) or harvests crops (villager) ---
  // After gathering, unit picks up resource and transitions to RETURNING
  private static handleGathering(unit: Unit, map: GameMap, delta: number, events: UnitEvent[]): void {
    unit.gatherCooldown -= delta;
    if (unit.gatherCooldown > 0) return;

    const target = unit.command?.targetPosition;
    if (!target) {
      unit.state = UnitState.IDLE;
      return;
    }

    // VILLAGER: harvest farm patch or tall grass
    if (unit.type === UnitType.VILLAGER) {
      const tileKey = `${target.q},${target.r}`;
      const isFarm = UnitAI.farmPatches.has(tileKey);
      const isPlayerGrass = UnitAI.playerGrassBlueprint.has(tileKey);
      const isAutoGrass = UnitAI.grassTiles.has(tileKey);
      const isGrass = isPlayerGrass || isAutoGrass;

      if (isFarm || isGrass) {
        const eventType = isGrass ? 'villager:harvest_grass' : 'villager:harvest';
        events.push({
          type: eventType,
          unit,
          result: { position: target, resource: 'food' },
        });
        unit.gatherCooldown = isGrass ? 2.5 : 4.0;

        // Transition to RETURNING — carry food to silo or base (skip if disableAutoReturn)
        if (UnitAI.debugFlags.disableAutoReturn) {
          unit.state = UnitState.IDLE;
          unit.command = null;
        } else {
          const siloPos = UnitAI.siloPositions.get(unit.owner);
          const returnPos = siloPos || UnitAI.basePositions.get(unit.owner);
          if (returnPos) {
            unit.state = UnitState.RETURNING;
            UnitAI.commandMove(unit, returnPos, map);
            unit.state = UnitState.RETURNING;
          } else {
            unit.state = UnitState.IDLE;
            unit.command = null;
          }
        }
        UnitAI.claimedFarms.delete(tileKey);
        if (isPlayerGrass) UnitAI.playerGrassBlueprint.delete(tileKey);
      } else {
        unit.state = UnitState.IDLE;
        unit.command = null;
      }
      return;
    }

    // BUILDER: mine terrain
    if (unit.type === UnitType.BUILDER) {
      const tile = map.tiles.get(`${target.q},${target.r}`);
      const targetKey = `${target.q},${target.r}`;

      if (tile && tile.terrain !== TerrainType.WATER && tile.terrain !== TerrainType.FOREST) {
        unit.gatherCooldown = 2.5;
        UnitAI.releaseMineClaim(unit.id);

        // Fire the mine event (main.ts destroys voxels, calculates yield, sets unit.carryAmount)
        events.push({
          type: 'builder:mine',
          unit,
          result: { position: target, resource: 'stone' },
        });

        // Transition to returning state (skip if disableAutoReturn)
        if (UnitAI.debugFlags.disableAutoReturn) {
          unit.state = UnitState.IDLE;
          unit.command = null;
        } else {
          const basePos = UnitAI.basePositions.get(unit.owner);
          if (basePos) {
            const stockPos: HexCoord = {
              q: basePos.q + (unit.owner === 0 ? -2 : 2),
              r: basePos.r,
            };
            unit.state = UnitState.RETURNING;
            UnitAI.commandMove(unit, stockPos, map);
            unit.state = UnitState.RETURNING;
          } else {
            unit.state = UnitState.IDLE;
            unit.command = null;
          }
        }
      } else {
        UnitAI.releaseMineClaim(unit.id);
        unit.state = UnitState.IDLE;
        unit.command = null;
      }
      return;
    }

    // LUMBERJACK: chop trees only
    const tile = map.tiles.get(`${target.q},${target.r}`);

    if (tile && tile.terrain === TerrainType.FOREST) {
      unit.gatherCooldown = 3.0;
      // Release claim since tree is being chopped
      UnitAI.releaseTreeClaim(unit.id);

      // Fire the chop event (main.ts removes tree, calculates yield, sets unit.carryAmount)
      events.push({
        type: 'lumberjack:chop',
        unit,
        result: { position: target, resource: 'wood' },
      });
      // Transition to returning state — path back to base stockpile (skip if disableAutoReturn)
      if (UnitAI.debugFlags.disableAutoReturn) {
        unit.state = UnitState.IDLE;
        unit.command = null;
      } else {
        const basePos = UnitAI.basePositions.get(unit.owner);
        if (basePos) {
          const stockPos: HexCoord = {
            q: basePos.q + (unit.owner === 0 ? -2 : 2),
            r: basePos.r,
          };
          unit.state = UnitState.RETURNING;
          UnitAI.commandMove(unit, stockPos, map);
          unit.state = UnitState.RETURNING;
        } else {
          unit.state = UnitState.IDLE;
          unit.command = null;
        }
      }
    } else {
      // Target gone — go idle to find another
      UnitAI.releaseTreeClaim(unit.id);
      UnitAI.releaseMineClaim(unit.id);
      unit.state = UnitState.IDLE;
      unit.command = null;
    }
  }

  // --- Returning: unit carrying resource back to stockpile/silo ---
  private static handleReturning(unit: Unit, map: GameMap, delta: number, events: UnitEvent[]): void {
    // Reuse the movement logic
    if (!unit.targetPosition) {
      // Arrived at destination — deposit resource
      if (unit.carryAmount > 0) {
        const isVillager = unit.type === UnitType.VILLAGER;
        const isBuilder = unit.type === UnitType.BUILDER;
        const eventType = isVillager ? 'villager:deposit' : (isBuilder ? 'builder:deposit_stone' : 'lumberjack:deposit');
        const resource = isVillager ? 'food' : (isBuilder ? 'stone' : 'wood');
        events.push({
          type: eventType,
          unit,
          result: { position: unit.position, resource },
        });
      }
      unit.state = UnitState.IDLE;
      unit.command = null;
      return;
    }

    // Move toward stockpile (same movement logic as handleMoving)
    const targetWorld = UnitAI.hexToWorld(unit.targetPosition, map);
    const dx = targetWorld.x - unit.worldPosition.x;
    const dz = targetWorld.z - unit.worldPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) {
      // Arrived at next waypoint
      unit.position = { ...unit.targetPosition };
      unit.worldPosition.x = targetWorld.x;
      unit.worldPosition.z = targetWorld.z;
      unit.worldPosition.y = targetWorld.y;

      const path = unit._path as HexCoord[] | null;
      const pathIndex = (unit._pathIndex ?? 0) || 0;

      if (path && pathIndex < path.length - 1) {
        const nextWp = path[pathIndex + 1];
        const nextKey = `${nextWp.q},${nextWp.r}`;
        // If a wall was built on the next waypoint, re-path around it
        if (Pathfinder.blockedTiles.has(nextKey)) {
          const finalGoal = path[path.length - 1];
          const newPath = Pathfinder.findPath(unit.position, finalGoal, map, unit.type === UnitType.LUMBERJACK, unit.owner);
          if (newPath.length > 1) {
            unit._path = newPath;
            unit._pathIndex = 1;
            unit.targetPosition = newPath[1];
          } else {
            // Can't reach destination anymore — stop
            unit.targetPosition = null;
            unit.state = UnitState.IDLE;
            unit._path = null;
          }
        } else {
          unit._pathIndex = pathIndex + 1;
          unit.targetPosition = nextWp;
        }
      } else {
        // Reached destination — deposit resource
        unit.targetPosition = null;
        if (unit.carryAmount > 0) {
          const isVillager = unit.type === UnitType.VILLAGER;
          const isBuilder = unit.type === UnitType.BUILDER;
          const eventType = isVillager ? 'villager:deposit' : (isBuilder ? 'builder:deposit_stone' : 'lumberjack:deposit');
          const resource = isVillager ? 'food' : (isBuilder ? 'stone' : 'wood');
          events.push({
            type: eventType,
            unit,
            result: { position: unit.position, resource },
          });
        }
        unit.state = UnitState.IDLE;
        unit.command = null;
        unit._path = null;
      }
    } else {
      const speed = unit.moveSpeed * delta;
      const moveX = (dx / dist) * Math.min(speed, dist);
      const moveZ = (dz / dist) * Math.min(speed, dist);
      unit.worldPosition.x += moveX;
      unit.worldPosition.z += moveZ;
      const t = 1 - (dist - speed) / dist;
      unit.worldPosition.y = unit.worldPosition.y + (targetWorld.y - unit.worldPosition.y) * Math.min(t, 1);
    }
  }

  /**
   * Wall building system:
   * - Player (owner 0): uses a blueprint queue set by the player clicking tiles
   * - AI (owner 1): uses an auto-generated keep plan
   */
  private static keepWallPlans: Map<number, HexCoord[]> = new Map();
  private static keepGatePlans: Map<number, HexCoord[]> = new Map();

  /** Arena mode: all units seek and destroy, no rally/wave */
  static arenaMode = false;

  /** Base positions per player — set by main.ts on game init */
  static basePositions: Map<number, HexCoord> = new Map();

  /** Barracks positions per player — set by main.ts when barracks is built */
  static barracksPositions: Map<number, HexCoord> = new Map();

  /** Player's wall blueprint queue — tiles the player has clicked to designate */
  static playerWallBlueprint: Set<string> = new Set(); // "q,r" keys
  static playerGateBlueprint: Set<string> = new Set(); // "q,r" keys — gates marked for building

  /** Add a tile to the player's wall blueprint */
  static addBlueprint(coord: HexCoord): boolean {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerWallBlueprint.has(key)) {
      // Toggle off
      UnitAI.playerWallBlueprint.delete(key);
      return false;
    }
    UnitAI.playerWallBlueprint.add(key);
    return true;
  }

  /** Add a tile to the player's gate blueprint */
  static addGateBlueprint(coord: HexCoord): boolean {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerGateBlueprint.has(key)) {
      // Toggle off
      UnitAI.playerGateBlueprint.delete(key);
      return false;
    }
    UnitAI.playerGateBlueprint.add(key);
    return true;
  }

  /** Clear all player blueprints */
  static clearBlueprints(): void {
    UnitAI.playerWallBlueprint.clear();
    UnitAI.playerGateBlueprint.clear();
  }

  /** Player's harvest blueprint queue — trees the player wants chopped */
  static playerHarvestBlueprint: Set<string> = new Set(); // "q,r" keys

  /** Add a tree tile to the player's harvest blueprint */
  static addHarvestBlueprint(coord: HexCoord): boolean {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerHarvestBlueprint.has(key)) {
      UnitAI.playerHarvestBlueprint.delete(key);
      return false;
    }
    UnitAI.playerHarvestBlueprint.add(key);
    return true;
  }

  /** Clear all harvest blueprints */
  static clearHarvestBlueprints(): void {
    UnitAI.playerHarvestBlueprint.clear();
    UnitAI.claimedTrees.clear();
    UnitAI.claimedFarms.clear();
    UnitAI.farmPatches.clear();
    UnitAI.playerMineBlueprint = new Map();
    UnitAI.claimedMines.clear();
    UnitAI.grassTiles.clear();
  }

  /** Player's mine blueprint queue — tiles the player wants mined, value = target elevation */
  static playerMineBlueprint: Map<string, number> = new Map(); // "q,r" → target elevation
  /** Track which mine tile each worker is targeting */
  static claimedMines: Map<string, string> = new Map(); // "q,r" → unitId

  /** Add a tile to the player's mine blueprint with a target elevation */
  static addMineBlueprint(coord: HexCoord, targetElevation: number): boolean {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerMineBlueprint.has(key)) {
      UnitAI.playerMineBlueprint.delete(key);
      return false;
    }
    UnitAI.playerMineBlueprint.set(key, targetElevation);
    return true;
  }

  /** Check if a mine blueprint has reached its target depth */
  static isMineComplete(key: string, currentElevation: number): boolean {
    const target = UnitAI.playerMineBlueprint.get(key);
    if (target === undefined) return true;
    return currentElevation <= target;
  }

  /** Find nearest minable tile from the player's mine blueprint */
  static findNearestMineBlueprint(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    for (const [key, targetElev] of UnitAI.playerMineBlueprint) {
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain === TerrainType.WATER || tile.elevation <= -39) {
        UnitAI.playerMineBlueprint.delete(key); // Fully excavated or water
        continue;
      }
      // Skip tiles that have reached their target depth
      if (tile.elevation <= targetElev) {
        UnitAI.playerMineBlueprint.delete(key);
        continue;
      }
      // Skip tiles claimed by other workers
      const claimer = UnitAI.claimedMines.get(key);
      if (claimer && claimer !== unit.id) continue;

      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = coord;
      }
    }
    return nearest;
  }

  /** Release mine claim for a unit */
  static releaseMineClaim(unitId: string): void {
    for (const [key, id] of UnitAI.claimedMines) {
      if (id === unitId) {
        UnitAI.claimedMines.delete(key);
        break;
      }
    }
  }

  /** Whether a tile is impassable terrain (ridge, forest, water, mountain) — natural wall anchor */
  private static isNaturalBarrier(tile: { terrain: TerrainType; elevation: number }): boolean {
    return tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.FOREST
      || tile.terrain === TerrainType.MOUNTAIN || tile.elevation >= 10;
  }

  /**
   * AI wall strategy: scan for choke points between impassable features
   * (ridges, forests, water) and plan walls to connect them, with a gate in the middle.
   * Scans far out to exploit natural mountain pass corridors carved through ridges.
   */
  static generateKeepWallPlan(owner: number, basePos: HexCoord, map: GameMap): void {
    // Only generate auto-plans for AI players
    if (owner === 0) return;

    // Scan from near the base out to just past the map midpoint
    // to find the tightest choke point in mountain passes through ridges
    const dir = owner === 0 ? 1 : -1;
    const SCAN_MIN = 5;
    const midQ = Math.floor(map.width / 2);
    // Scan up to the midpoint of the map (or a bit past it)
    const SCAN_MAX = Math.abs(midQ - basePos.q) + 2;

    // For each column in the scan zone, find the best choke point
    // A choke point is a column where the gap between impassable features is smallest
    let bestColumn = -1;
    let bestGapTiles: HexCoord[] = [];
    let bestGapSize = Infinity;
    let bestDist = Infinity; // tiebreaker: prefer closer to base for equal gap sizes

    for (let dq = SCAN_MIN; dq <= SCAN_MAX; dq++) {
      const scanQ = basePos.q + dq * dir;
      if (scanQ < 0 || scanQ >= map.width) continue;

      // Walk along the FULL R axis for this column and find gaps between barriers
      const barriers: number[] = [];

      // Scan the entire map height (passes are carved diagonally and may be far from base R)
      for (let r = 0; r < map.height; r++) {
        const key = `${scanQ},${r}`;
        const tile = map.tiles.get(key);
        if (!tile || UnitAI.isNaturalBarrier(tile)) {
          barriers.push(r);
        }
      }

      // Add map edges as implicit barriers
      if (barriers.length === 0 || barriers[0] > 0) barriers.unshift(-1);
      if (barriers[barriers.length - 1] < map.height - 1) barriers.push(map.height);

      // Find ALL gap segments and pick the narrowest one that's reachable
      for (let i = 0; i < barriers.length - 1; i++) {
        const topBarrier = barriers[i];
        const botBarrier = barriers[i + 1];
        const gapSize = botBarrier - topBarrier - 1;
        if (gapSize < 1 || gapSize > 15) continue; // Skip trivial or huge gaps

        // Check if a path from base could plausibly go through this gap
        // (the gap's R range should overlap with a reasonable approach corridor)
        const gapMidR = (topBarrier + botBarrier) / 2;
        const approachR = basePos.r + (gapMidR - basePos.r) * 0.5; // rough interpolation

        // Score: prefer smallest gap, then closest to base for tiebreaker
        const distPenalty = dq * 0.1; // slight preference for closer walls
        if (gapSize < bestGapSize || (gapSize === bestGapSize && dq < bestDist)) {
          // Collect the gap tiles
          const tiles: HexCoord[] = [];
          for (let r = topBarrier + 1; r < botBarrier; r++) {
            const gKey = `${scanQ},${r}`;
            const gTile = map.tiles.get(gKey);
            if (gTile && UnitAI.isValidWallTile(gTile, gKey, map)) {
              tiles.push({ q: scanQ, r });
            }
          }
          if (tiles.length > 0) {
            bestGapSize = gapSize;
            bestColumn = scanQ;
            bestGapTiles = tiles;
            bestDist = dq;
          }
        }
      }
    }

    // If no good choke found, fall back to a simple wall line 8 tiles out
    if (bestGapTiles.length === 0 || bestGapSize > 15) {
      const fallbackQ = basePos.q + 8 * dir;
      const tiles: HexCoord[] = [];
      for (let dr = -8; dr <= 8; dr++) {
        const r = basePos.r + dr;
        const key = `${fallbackQ},${r}`;
        const tile = map.tiles.get(key);
        if (tile && UnitAI.isValidWallTile(tile, key, map)) {
          tiles.push({ q: fallbackQ, r });
        }
      }
      bestGapTiles = tiles;
    }

    // Build plan: walls for all gap tiles, with a gate near the center
    const plan: HexCoord[] = [];
    const gatePlan: HexCoord[] = [];

    if (bestGapTiles.length > 0) {
      // Sort by R so the gate goes in the middle
      bestGapTiles.sort((a, b) => a.r - b.r);
      const midIdx = Math.floor(bestGapTiles.length / 2);

      for (let i = 0; i < bestGapTiles.length; i++) {
        if (i === midIdx) {
          // Place gate at the middle of the wall line
          gatePlan.push(bestGapTiles[i]);
        } else {
          plan.push(bestGapTiles[i]);
        }
      }
    }

    // Sort walls: build from center outward (so the wall grows from the middle)
    const centerR = bestGapTiles.length > 0
      ? bestGapTiles[Math.floor(bestGapTiles.length / 2)].r
      : basePos.r;
    plan.sort((a, b) => Math.abs(a.r - centerR) - Math.abs(b.r - centerR));

    UnitAI.keepWallPlans.set(owner, plan);
    UnitAI.keepGatePlans.set(owner, gatePlan);
  }

  /** Check if a tile is valid for wall placement (any terrain except forest, mountain — water allowed for damming) */
  static isValidWallTile(tile: { terrain: TerrainType }, key: string, _map: GameMap): boolean {
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) {
      return false;
    }
    if (Pathfinder.blockedTiles.has(key)) {
      return false;
    }
    return true;
  }

  private static findWallSpot(unit: Unit, map: GameMap): HexCoord | null {
    if (unit.owner === 0) {
      // Player builders: use the player's blueprint queue
      return UnitAI.findBlueprintSpot(unit, map);
    } else {
      // AI builders: use auto-generated plan
      return UnitAI.findPlanSpot(unit, map);
    }
  }

  /** Find nearest un-built spot from the player's blueprint (walls or gates) */
  private static findBlueprintSpot(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    // Check both wall and gate blueprints
    for (const key of UnitAI.playerWallBlueprint) {
      // Skip if already built
      if (Pathfinder.blockedTiles.has(key)) {
        UnitAI.playerWallBlueprint.delete(key); // Clean up built spots
        continue;
      }
      const [q, r] = key.split(',').map(Number);
      const tile = map.tiles.get(key);
      if (!tile || !UnitAI.isValidWallTile(tile, key, map)) {
        UnitAI.playerWallBlueprint.delete(key);
        continue;
      }
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = coord;
      }
    }

    for (const key of UnitAI.playerGateBlueprint) {
      // Skip if already built
      if (Pathfinder.blockedTiles.has(key)) {
        UnitAI.playerGateBlueprint.delete(key); // Clean up built spots
        continue;
      }
      const [q, r] = key.split(',').map(Number);
      const tile = map.tiles.get(key);
      if (!tile || !UnitAI.isValidWallTile(tile, key, map)) {
        UnitAI.playerGateBlueprint.delete(key);
        continue;
      }
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = coord;
      }
    }

    return nearest;
  }

  /** Find nearest tree from the player's harvest blueprint (lumberjacks only — trees) */
  private static findNearestHarvestBlueprint(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    for (const key of UnitAI.playerHarvestBlueprint) {
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain !== TerrainType.FOREST) {
        UnitAI.playerHarvestBlueprint.delete(key);
        continue;
      }
      // Skip trees claimed by other lumberjacks
      const claimer = UnitAI.claimedTrees.get(key);
      if (claimer && claimer !== unit.id) continue;

      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = coord;
      }
    }
    return nearest;
  }

  /** Find nearest un-built spot from the AI's auto-plan (walls + gates) */
  private static findPlanSpot(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    // Check wall plan
    const plan = UnitAI.keepWallPlans.get(unit.owner);
    if (plan) {
      for (const spot of plan) {
        const key = `${spot.q},${spot.r}`;
        if (Pathfinder.blockedTiles.has(key)) continue;
        const tile = map.tiles.get(key);
        if (!tile || !UnitAI.isValidWallTile(tile, key, map)) continue;
        const dist = Pathfinder.heuristic(unit.position, spot);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = spot;
          unit._planIsGate = false;
        }
      }
    }

    // Check gate plan (only if all walls are built, so walls go up first)
    const wallsRemaining = plan ? plan.filter(s => {
      const k = `${s.q},${s.r}`;
      return !Pathfinder.blockedTiles.has(k);
    }).length : 0;

    if (wallsRemaining === 0) {
      const gatePlan = UnitAI.keepGatePlans.get(unit.owner);
      if (gatePlan) {
        for (const spot of gatePlan) {
          const key = `${spot.q},${spot.r}`;
          if (Pathfinder.blockedTiles.has(key)) continue;
          const tile = map.tiles.get(key);
          if (!tile || !UnitAI.isValidWallTile(tile, key, map)) continue;
          const dist = Pathfinder.heuristic(unit.position, spot);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = spot;
            unit._planIsGate = true;
          }
        }
      }
    }

    return nearest;
  }

  /** Find nearest forest tile to a unit */
  private static findNearestForest(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    map.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.FOREST) return;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = coord;
      }
    });

    return nearest;
  }

  /** Find nearest forest tile prioritizing trees close to the player's base.
   *  Skips trees already claimed by other lumberjacks (auto-sort: one per tree). */
  private static findNearestSafeForest(unit: Unit, map: GameMap): HexCoord | null {
    let best: HexCoord | null = null;
    let bestScore = Infinity;
    const midQ = Math.floor(map.width / 2);
    const basePos = UnitAI.basePositions.get(unit.owner);
    if (!basePos) return UnitAI.findNearestForest(unit, map);

    map.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.FOREST) return;
      // Skip trees claimed by other lumberjacks
      const claimer = UnitAI.claimedTrees.get(key);
      if (claimer && claimer !== unit.id) return;
      // Skip tiles we already failed to path to recently
      if (UnitAI.isUnreachable(unit.id, key)) return;

      const [q, r] = key.split(',').map(Number);
      // Allow lumberjacks to reach up to 70% of map width past midpoint
      // (they still prefer own side via scoring, but can push forward)
      const maxReach = Math.floor(map.width * 0.7);
      if (unit.owner === 0 && q > midQ + maxReach) return;
      if (unit.owner === 1 && q < midQ - maxReach) return;
      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      const unitDist = Pathfinder.heuristic(unit.position, coord);
      // Weight proximity to unit more than base so lumberjacks push outward
      const score = baseDist * 1.5 + unitDist;
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    });

    // Fallback to any forest if nothing on own side
    return best ?? UnitAI.findNearestForest(unit, map);
  }

  /** Release a lumberjack's tree claim */
  static releaseTreeClaim(unitId: string): void {
    for (const [key, id] of UnitAI.claimedTrees) {
      if (id === unitId) {
        UnitAI.claimedTrees.delete(key);
        break;
      }
    }
    for (const [key, id] of UnitAI.claimedFarms) {
      if (id === unitId) {
        UnitAI.claimedFarms.delete(key);
        break;
      }
    }
  }

  /** Find nearest tall grass tile for auto-harvest (villagers only) */
  private static findNearestTallGrass(unit: Unit, map: GameMap): HexCoord | null {
    let best: HexCoord | null = null;
    let bestScore = Infinity;
    const midQ = Math.floor(map.width / 2);
    const basePos = UnitAI.basePositions.get(unit.owner);
    if (!basePos) return null;

    for (const key of UnitAI.grassTiles) {
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain !== TerrainType.PLAINS) continue;

      // Skip grass claimed by other villagers
      const claimer = UnitAI.claimedFarms.get(key);
      if (claimer && claimer !== unit.id) continue;
      // Skip tiles we already failed to path to recently
      if (UnitAI.isUnreachable(unit.id, key)) continue;

      const [q, r] = key.split(',').map(Number);
      // Only look at grass on the unit's own half (+2 buffer)
      if (unit.owner === 0 && q > midQ + 2) continue;
      if (unit.owner === 1 && q < midQ - 2) continue;

      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      const unitDist = Pathfinder.heuristic(unit.position, coord);
      // Weight proximity to base so villagers harvest nearby grass first
      const score = baseDist * 2 + unitDist;
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    }

    return best;
  }

  /** Find nearest minable tile for auto-mine (builders only, within range of base).
   *  Mines any solid terrain: mountains (stone), plains (stone), desert (clay), etc. */
  /** Find best mine site for AI builders — quarry pattern: not too close to base,
   *  not too far, prefer clustered mining near already-mined tiles */
  private static findNearestMineSite(unit: Unit, map: GameMap): HexCoord | null {
    let best: HexCoord | null = null;
    let bestScore = Infinity;
    const midQ = Math.floor(map.width / 2);
    const basePos = UnitAI.basePositions.get(unit.owner);
    if (!basePos) return null;

    const MIN_MINE_RANGE = 4; // Don't mine right under the base
    const MAX_MINE_RANGE = 10; // Not too far — stone must be carried back

    map.tiles.forEach((tile, key) => {
      // Skip water, forest (lumberjacks handle trees), and already-mined bedrock
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.RIVER
          || tile.terrain === TerrainType.LAKE || tile.terrain === TerrainType.WATERFALL
          || tile.terrain === TerrainType.FOREST) return;
      if (tile.elevation <= -39) return; // Bedrock

      // Skip tiles claimed by other builders
      const claimer = UnitAI.claimedMines.get(key);
      if (claimer && claimer !== unit.id) return;
      // Skip tiles we already failed to path to recently
      if (UnitAI.isUnreachable(unit.id, key)) return;

      const [q, r] = key.split(',').map(Number);
      // Only look at tiles on the unit's own half (+2 buffer)
      if (unit.owner === 0 && q > midQ + 2) return;
      if (unit.owner === 1 && q < midQ - 2) return;

      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      if (baseDist < MIN_MINE_RANGE) return; // Too close to base — keep clear
      if (baseDist > MAX_MINE_RANGE) return; // Too far — slow stone transport

      const unitDist = Pathfinder.heuristic(unit.position, coord);

      // Quarry clustering bonus: prefer tiles adjacent to already-mined tiles or other claimed mines
      let clusterBonus = 0;
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (UnitAI.claimedMines.has(nKey)) clusterBonus -= 2; // Near active quarry
        const nTile = map.tiles.get(nKey);
        if (nTile && nTile.elevation <= -1) clusterBonus -= 1; // Near already-dug tile
      }

      // Prefer mountains (high value stone) > desert (clay) > plains (stone)
      const terrainBonus = tile.terrain === TerrainType.MOUNTAIN ? -6
        : tile.terrain === TerrainType.DESERT ? -3 : 0;

      // Score: balance distance, terrain value, and clustering
      // Sweet spot distance (~6-7 from base) gets best score
      const idealDist = 6;
      const distPenalty = Math.abs(baseDist - idealDist) * 1.5;
      const score = distPenalty + unitDist * 0.5 + terrainBonus + clusterBonus;
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    });

    return best;
  }

  private static handleMoving(unit: Unit, allUnits: Unit[], map: GameMap, delta: number, events: UnitEvent[]): void {
    if (!unit.targetPosition) {
      unit.state = UnitState.IDLE;
      return;
    }

    // Re-aggro check: combat units on MOVE (not ATTACK) commands react to nearby threats
    // This gives natural "snap to target" behavior when enemies enter range while marching
    if (UnitAI.isCombatUnit(unit) && !UnitAI.debugFlags.disableCombat) {
      const isAttackMove = unit.command?.type === CommandType.ATTACK;
      // Aggressive/attack-move units re-aggro on enemies entering weapon range
      // Defensive units only re-aggro if enemy is adjacent (range 1-2)
      const reaggroRange = isAttackMove || unit.stance === UnitStance.AGGRESSIVE
        ? UnitAI.getDetectionRange(unit)
        : (unit.stance === UnitStance.DEFENSIVE ? unit.stats.range + 1 : 0);

      if (reaggroRange > 0) {
        const threat = UnitAI.findBestTarget(unit, allUnits, unit.owner, reaggroRange);
        if (threat) {
          const threatDist = Pathfinder.heuristic(unit.position, threat.position);
          if (threatDist <= unit.stats.range) {
            // Can fire right now — switch to attacking
            unit.state = UnitState.ATTACKING;
            unit.targetPosition = null;
            unit._path = null;
            unit.command = { type: CommandType.ATTACK, targetPosition: threat.position, targetUnitId: threat.id };
            return;
          } else if (isAttackMove || unit.stance === UnitStance.AGGRESSIVE) {
            // Close enough to chase — redirect, but ONLY if switching to a different target.
            // Re-pathing to the same target every frame resets _pathIndex and freezes the unit.
            const alreadyChasingThis = unit.command?.targetUnitId === threat.id;
            if (!alreadyChasingThis) {
              UnitAI.commandAttack(unit, threat.position, threat.id, map);
              return;
            }
            // Already chasing this target — let movement continue
          }
        }
      }
    }

    // Compute target world position
    const targetWorld = UnitAI.hexToWorld(unit.targetPosition, map);
    const dx = targetWorld.x - unit.worldPosition.x;
    const dz = targetWorld.z - unit.worldPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) {
      // Arrived at next waypoint
      unit.position = { ...unit.targetPosition };
      unit.worldPosition.x = targetWorld.x;
      unit.worldPosition.z = targetWorld.z;
      unit.worldPosition.y = targetWorld.y;

      // Ranged units with attack command: check if we're now in range to stop early
      if (unit.stats.range > 1 && unit.command?.type === CommandType.ATTACK && unit.command.targetUnitId) {
        const attackTarget = allUnits.find(u => u.id === unit.command!.targetUnitId);
        if (attackTarget && attackTarget.state !== UnitState.DEAD) {
          const rangeDist = Pathfinder.heuristic(unit.position, attackTarget.position);
          if (rangeDist <= unit.stats.range) {
            // In range — switch to attacking
            unit.state = UnitState.ATTACKING;
            unit.targetPosition = null;
            unit._path = null;
            return;
          }
        }
      }

      // Advance along path
      const path = unit._path as HexCoord[] | null;
      const pathIndex = (unit._pathIndex ?? 0) || 0;

      if (path && pathIndex < path.length - 1) {
        const nextWp = path[pathIndex + 1];
        const nextKey = `${nextWp.q},${nextWp.r}`;
        // If a wall was built on the next waypoint since path was computed, re-path around it
        if (Pathfinder.blockedTiles.has(nextKey) && nextKey !== `${path[path.length - 1].q},${path[path.length - 1].r}`) {
          const finalGoal = path[path.length - 1];
          const canForest = unit.type === UnitType.LUMBERJACK;
          const newPath = Pathfinder.findPath(unit.position, finalGoal, map, canForest, unit.owner);
          if (newPath.length > 1) {
            unit._path = newPath;
            unit._pathIndex = 1;
            unit.targetPosition = newPath[1];
          } else {
            // No path — stop moving
            unit.targetPosition = null;
            unit.state = UnitState.IDLE;
            unit.command = null;
            unit._path = null;
            events.push({ type: 'unit:arrived', unit });
          }
        } else {
          unit._pathIndex = pathIndex + 1;
          unit.targetPosition = nextWp;
        }
      } else {
        // Reached final destination
        unit.targetPosition = null;
        unit.state = UnitState.IDLE;
        unit._path = null;
        events.push({ type: 'unit:arrived', unit });
      }
    } else {
      // Move toward target
      const speed = unit.moveSpeed * delta;
      let moveX = (dx / dist) * Math.min(speed, dist);
      let moveZ = (dz / dist) * Math.min(speed, dist);

      // Soft-body separation: nudge away from nearby units to avoid visual overlap
      const SEPARATION_RADIUS = 0.8;
      const SEPARATION_FORCE = 0.3;
      for (const other of allUnits) {
        if (other === unit || other.state === UnitState.DEAD) continue;
        const sx = unit.worldPosition.x - other.worldPosition.x;
        const sz = unit.worldPosition.z - other.worldPosition.z;
        const sDist = Math.sqrt(sx * sx + sz * sz);
        if (sDist < SEPARATION_RADIUS && sDist > 0.01) {
          const pushStrength = SEPARATION_FORCE * (1 - sDist / SEPARATION_RADIUS) * delta;
          moveX += (sx / sDist) * pushStrength;
          moveZ += (sz / sDist) * pushStrength;
        }
      }

      unit.worldPosition.x += moveX;
      unit.worldPosition.z += moveZ;

      // Interpolate Y based on terrain
      const t = 1 - (dist - speed) / dist;
      unit.worldPosition.y = unit.worldPosition.y + (targetWorld.y - unit.worldPosition.y) * Math.min(t, 1);
    }
  }

  private static handleAttacking(unit: Unit, allUnits: Unit[], player: Player, delta: number, events: UnitEvent[], map?: GameMap): void {
    if (!unit.command?.targetUnitId) {
      unit.state = UnitState.IDLE;
      return;
    }

    // Find the target
    const target = allUnits.find(u => u.id === unit.command!.targetUnitId);
    if (!target || target.state === UnitState.DEAD) {
      // Target dead — immediately look for another nearby enemy to chain attacks
      const detRange = UnitAI.getDetectionRange(unit);
      const nextEnemy = UnitAI.findBestTarget(unit, allUnits, player.id, detRange);
      if (nextEnemy && map) {
        const nextDist = Pathfinder.heuristic(unit.position, nextEnemy.position);
        if (nextDist <= unit.stats.range) {
          unit.command = { type: CommandType.ATTACK, targetPosition: nextEnemy.position, targetUnitId: nextEnemy.id };
          // Continue attacking immediately — don't drop to IDLE
          return;
        }
        // Out of range but detected — chase
        UnitAI.commandAttack(unit, nextEnemy.position, nextEnemy.id, map);
        return;
      }
      unit.state = UnitState.IDLE;
      unit.command = null;
      return;
    }

    const dist = Pathfinder.heuristic(unit.position, target.position);

    // Ranged kiting: if ANY melee enemy is too close, fire then reposition
    const meleeThreatAtk = (UnitAI.isRangedKiter(unit.type) && map) ? UnitAI.findNearestMeleeThreat(unit, allUnits, 2) : null;
    if (meleeThreatAtk) {
      // Fire first if we can
      if (unit.attackCooldown <= 0 && dist <= unit.stats.range) {
        const result = CombatSystem.resolve(unit, target, allUnits);
        const applyInfo = CombatSystem.apply(unit, target, result);
        unit.attackCooldown = 1 / unit.attackSpeed;
        CombatLog.logDamage(unit, target, result.defenderDamage, result.attackerDamage);
        events.push({ type: 'combat', attacker: unit, defender: target, result });
        // XP and level-up events
        if (applyInfo.xpGained > 0) events.push({ type: 'combat:xp', unitId: unit.id, xp: applyInfo.xpGained } as any);
        if (applyInfo.leveledUp) events.push({ type: 'combat:levelup', unitId: unit.id, newLevel: applyInfo.newLevel } as any);
        // Battlemage AoE splash
        const splashed = CombatSystem.applyBattlemageAoE(unit, target, allUnits);
        for (const sid of splashed) events.push({ type: 'combat:splash', unitId: sid } as any);
        // Greatsword cleave + knockback
        const isTileBlocked = (q: number, r: number) => {
          const k = `${q},${r}`;
          if (Pathfinder.blockedTiles.has(k)) return true;
          return allUnits.some(u => u.position.q === q && u.position.r === r && u.state !== UnitState.DEAD && u !== target);
        };
        const cleaveResults = CombatSystem.applyGreatswordCleave(unit, target, allUnits, isTileBlocked);
        for (const cr of cleaveResults) events.push({ type: 'combat:cleave', unitId: cr.unitId, knockQ: cr.knockQ, knockR: cr.knockR } as any);
        // Shieldbearer shield bash knockback
        const bashResult = CombatSystem.applyShieldBash(unit, target, isTileBlocked);
        if (bashResult) events.push({ type: 'combat:cleave', unitId: bashResult.unitId, knockQ: bashResult.knockQ, knockR: bashResult.knockR } as any);
        if (!result.defenderSurvived) {
          target.state = UnitState.DEAD;
          CombatLog.logKill(unit, target);
          events.push({ type: 'unit:killed', unit: target, killer: unit });
          unit.state = UnitState.IDLE;
          unit.command = null;
          return;
        }
        if (!result.attackerSurvived) {
          unit.state = UnitState.DEAD;
          CombatLog.logKill(target, unit);
          events.push({ type: 'unit:killed', unit, killer: target });
          return;
        }
      }
      // Now kite away from the melee threat
      const fleeTile = UnitAI.findKiteTile(unit, meleeThreatAtk, map!);
      if (fleeTile) {
        CombatLog.logKite(unit, meleeThreatAtk, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
        UnitAI.commandMove(unit, fleeTile, map!);
        unit.command = { type: CommandType.ATTACK, targetPosition: target.position, targetUnitId: target.id };
        return;
      } else {
        CombatLog.logKite(unit, meleeThreatAtk, false);
      }
    }

    if (dist <= unit.stats.range) {
      // In range — attack if cooldown is ready
      if (unit.attackCooldown <= 0) {
        const result = CombatSystem.resolve(unit, target, allUnits);
        const applyInfo2 = CombatSystem.apply(unit, target, result);
        unit.attackCooldown = 1 / unit.attackSpeed;
        CombatLog.logDamage(unit, target, result.defenderDamage, result.attackerDamage);

        events.push({ type: 'combat', attacker: unit, defender: target, result });
        // XP and level-up events
        if (applyInfo2.xpGained > 0) events.push({ type: 'combat:xp', unitId: unit.id, xp: applyInfo2.xpGained } as any);
        if (applyInfo2.leveledUp) events.push({ type: 'combat:levelup', unitId: unit.id, newLevel: applyInfo2.newLevel } as any);
        // Battlemage AoE splash
        const splashed = CombatSystem.applyBattlemageAoE(unit, target, allUnits);
        for (const sid of splashed) events.push({ type: 'combat:splash', unitId: sid } as any);
        // Greatsword cleave + knockback
        const isTileBlocked2 = (q: number, r: number) => {
          const k = `${q},${r}`;
          if (Pathfinder.blockedTiles.has(k)) return true;
          return allUnits.some(u => u.position.q === q && u.position.r === r && u.state !== UnitState.DEAD && u !== target);
        };
        const cleaveResults2 = CombatSystem.applyGreatswordCleave(unit, target, allUnits, isTileBlocked2);
        for (const cr of cleaveResults2) events.push({ type: 'combat:cleave', unitId: cr.unitId, knockQ: cr.knockQ, knockR: cr.knockR } as any);
        // Shieldbearer shield bash knockback
        const bashResult2 = CombatSystem.applyShieldBash(unit, target, isTileBlocked2);
        if (bashResult2) events.push({ type: 'combat:cleave', unitId: bashResult2.unitId, knockQ: bashResult2.knockQ, knockR: bashResult2.knockR } as any);

        if (!result.defenderSurvived) {
          target.state = UnitState.DEAD;
          CombatLog.logKill(unit, target);
          events.push({ type: 'unit:killed', unit: target, killer: unit });
          unit.state = UnitState.IDLE;
          unit.command = null;
        }
        if (!result.attackerSurvived) {
          unit.state = UnitState.DEAD;
          CombatLog.logKill(target, unit);
          events.push({ type: 'unit:killed', unit, killer: target });
        }
      }
    } else {
      // Out of range — move closer (ranged units stop at max range)
      if (unit.stats.range > 1) {
        // Ranged unit: find a tile within weapon range of the target
        const targetPos = target.position;
        let bestTile: HexCoord | null = null;
        let bestDist = Infinity;
        // Search tiles near the target that are within our range
        for (let dq = -unit.stats.range; dq <= unit.stats.range; dq++) {
          for (let dr = -unit.stats.range; dr <= unit.stats.range; dr++) {
            const q = targetPos.q + dq;
            const r = targetPos.r + dr;
            const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
            if (hexDist < 1 || hexDist > unit.stats.range) continue;
            const key = `${q},${r}`;
            const tile = map!.tiles.get(key);
            if (!tile || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.MOUNTAIN
                || tile.terrain === TerrainType.FOREST || Pathfinder.blockedTiles.has(key)) continue;
            const unitDist = Pathfinder.heuristic(unit.position, { q, r });
            if (unitDist < bestDist) {
              bestDist = unitDist;
              bestTile = { q, r };
            }
          }
        }
        if (bestTile && bestDist > 0) {
          UnitAI.commandMove(unit, bestTile, map!);
          // Preserve the attack command so we resume attacking once in range
          unit.command = { type: CommandType.ATTACK, targetPosition: target.position, targetUnitId: target.id };
        }
      } else {
        // Melee unit: re-path toward target (respects walls)
        // Try pathing to an adjacent hex first (target's hex may be occupied)
        const HEX_DIRS: HexCoord[] = [{q:1,r:0},{q:-1,r:0},{q:0,r:1},{q:0,r:-1},{q:1,r:-1},{q:-1,r:1}];
        let bestPath: HexCoord[] = [];
        let bestLen = Infinity;
        for (const d of HEX_DIRS) {
          const adj = { q: target.position.q + d.q, r: target.position.r + d.r };
          const p = Pathfinder.findPath(unit.position, adj, map!, false, unit.owner);
          if (p.length > 1 && p.length < bestLen) { bestPath = p; bestLen = p.length; }
        }
        // Fallback: try direct path to target hex
        if (bestPath.length === 0) {
          bestPath = Pathfinder.findPath(unit.position, target.position, map!, false, unit.owner);
        }
        if (bestPath.length > 1) {
          unit.targetPosition = bestPath[1];
          unit.state = UnitState.MOVING;
          unit._path = bestPath;
          unit._pathIndex = 1;
          // Preserve the attack command so we resume attacking once in range
          unit.command = { type: CommandType.ATTACK, targetPosition: target.position, targetUnitId: target.id };
        } else {
          // No path to target — keep command so we retry next tick
          unit.state = UnitState.IDLE;
        }
      }
    }
  }

  // --- Helpers ---

  static findNearestEnemy(unit: Unit, allUnits: Unit[], playerId: number): Unit | null {
    let nearest: Unit | null = null;
    let nearestDist = Infinity;

    for (const other of allUnits) {
      if (other.owner === playerId || other.state === UnitState.DEAD) continue;
      const dist = Pathfinder.heuristic(unit.position, other.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = other;
      }
    }
    return nearest;
  }

  /** Is this unit a combat unit? Exclusion-based — new combat types auto-included */
  private static isCombatUnit(unit: Unit): boolean {
    return unit.type !== UnitType.BUILDER
      && unit.type !== UnitType.LUMBERJACK
      && unit.type !== UnitType.VILLAGER;
  }

  /**
   * Combat roles — data-driven classification for behavior.
   * 'ranged' units kite melee threats to max weapon range.
   * 'tank' units peel for nearby squishies (prioritize enemies attacking allies).
   * 'melee' units standard chase-and-attack.
   * 'support' units follow allies, avoid combat.
   */
  private static readonly RANGED_KITERS: Set<UnitType> = new Set([
    UnitType.ARCHER, UnitType.MAGE, UnitType.BATTLEMAGE,
  ]);
  private static readonly TANK_PEELERS: Set<UnitType> = new Set([
    UnitType.SHIELDBEARER, UnitType.PALADIN,
  ]);
  static isRangedKiter(t: UnitType): boolean { return UnitAI.RANGED_KITERS.has(t); }
  static isTankPeeler(t: UnitType): boolean { return UnitAI.TANK_PEELERS.has(t); }

  /** Get detection range for a unit type — how far it can "see" threats */
  private static getDetectionRange(unit: Unit): number {
    switch (unit.type) {
      case UnitType.ARCHER:       return 6;
      case UnitType.PALADIN:     return 5;
      case UnitType.SCOUT:        return 7;
      case UnitType.RIDER:        return 4;
      case UnitType.TREBUCHET:    return 7;
      case UnitType.CATAPULT:     return 5;
      case UnitType.HEALER:       return 5;  // Sees allies in need
      case UnitType.ASSASSIN:     return 6;  // Keen senses
      case UnitType.SHIELDBEARER: return 3;  // Short range tank
      case UnitType.BERSERKER:    return 5;  // Sees red
      case UnitType.BATTLEMAGE:   return 6;  // Ranged caster
      case UnitType.GREATSWORD:   return 4;  // Heavy melee — standard sight
      default:                    return 4;
    }
  }

  /**
   * Find best target with spread — avoids all units targeting the same enemy.
   * Each enemy gets a "focus penalty" based on how many allies are already attacking them.
   * Within the given maxRange, picks the enemy with the lowest effective score.
   */
  static findBestTarget(unit: Unit, allUnits: Unit[], playerId: number, maxRange: number): Unit | null {
    // Count how many friendly units are already targeting each enemy
    const focusCount: Map<string, number> = new Map();
    for (const ally of allUnits) {
      if (ally.owner !== playerId || ally.state === UnitState.DEAD || ally === unit) continue;
      if (ally.command?.targetUnitId) {
        focusCount.set(ally.command.targetUnitId, (focusCount.get(ally.command.targetUnitId) ?? 0) + 1);
      }
    }

    // Tank peeling: find enemies that are threatening nearby squishies
    // Build set of enemy IDs currently attacking our ranged/support allies within 4 hex
    const peelTargets: Set<string> = new Set();
    if (UnitAI.isTankPeeler(unit.type)) {
      for (const ally of allUnits) {
        if (ally.owner !== playerId || ally.state === UnitState.DEAD || ally === unit) continue;
        if (!UnitAI.isRangedKiter(ally.type) && ally.type !== UnitType.HEALER) continue;
        const allyDist = Pathfinder.heuristic(unit.position, ally.position);
        if (allyDist > 4) continue; // only peel for nearby squishies
        // Find enemies targeting this squishy
        for (const enemy of allUnits) {
          if (enemy.owner === playerId || enemy.state === UnitState.DEAD) continue;
          if (enemy.command?.targetUnitId === ally.id) {
            peelTargets.add(enemy.id);
          }
        }
      }
    }

    let bestEnemy: Unit | null = null;
    let bestScore = Infinity;

    for (const other of allUnits) {
      if (other.owner === playerId || other.state === UnitState.DEAD) continue;
      const dist = Pathfinder.heuristic(unit.position, other.position);
      if (dist > maxRange) continue;

      // Score = distance + penalty for each ally already targeting this enemy
      const alreadyTargeting = focusCount.get(other.id) ?? 0;
      const focusPenalty = alreadyTargeting * 2.5;
      // Slight bonus for low-health enemies (finish them off)
      const hpRatio = other.currentHealth / other.stats.maxHealth;
      const hpBonus = (1 - hpRatio) * 1.5;
      // Tank peeling bonus: strong priority for enemies attacking our squishies
      const peelBonus = peelTargets.has(other.id) ? 6.0 : 0;
      const score = dist + focusPenalty - hpBonus - peelBonus;

      if (score < bestScore) {
        bestScore = score;
        bestEnemy = other;
      }
    }
    // Log targeting decision
    if (bestEnemy && CombatLog.isEnabled()) {
      const dist = Pathfinder.heuristic(unit.position, bestEnemy.position);
      CombatLog.logTarget(unit, bestEnemy, bestScore, dist);
      // Log peel decision if applicable
      if (peelTargets.size > 0 && peelTargets.has(bestEnemy.id)) {
        // Find which squishy we're peeling for
        for (const ally of allUnits) {
          if (ally.owner !== playerId || ally.state === UnitState.DEAD) continue;
          if (!UnitAI.isRangedKiter(ally.type) && ally.type !== UnitType.HEALER) continue;
          if (bestEnemy.command?.targetUnitId === ally.id) {
            CombatLog.logPeel(unit, bestEnemy, ally);
            break;
          }
        }
      }
    }
    return bestEnemy;
  }

  /**
   * Find the nearest melee enemy within kiteRange hexes. Used by ranged kiters to
   * detect threats independently of findBestTarget (which may pick a ranged target).
   */
  private static findNearestMeleeThreat(unit: Unit, allUnits: Unit[], kiteRange: number): Unit | null {
    let closest: Unit | null = null;
    let closestDist = Infinity;
    for (const other of allUnits) {
      if (other.owner === unit.owner || other.state === UnitState.DEAD) continue;
      if (other.stats.range > 1) continue; // Only melee threats
      const dist = Pathfinder.heuristic(unit.position, other.position);
      if (dist <= kiteRange && dist < closestDist) {
        closestDist = dist;
        closest = other;
      }
    }
    return closest;
  }

  /**
   * Find a tile to kite to — move away from a melee threat while staying near max range.
   * Archer flees AWAY from the enemy, trying to land at roughly weapon range distance.
   */
  private static findKiteTile(unit: Unit, threat: Unit, map: GameMap): HexCoord | null {
    const fleeRange = unit.stats.range; // Try to get to max weapon range
    // Direction away from the threat
    const dq = unit.position.q - threat.position.q;
    const dr = unit.position.r - threat.position.r;

    // Try several candidate tiles in the "away" direction
    let bestTile: HexCoord | null = null;
    let bestScore = -Infinity;

    for (let aq = -3; aq <= 3; aq++) {
      for (let ar = -3; ar <= 3; ar++) {
        const q = unit.position.q + aq;
        const r = unit.position.r + ar;
        const key = `${q},${r}`;
        const tile = map.tiles.get(key);
        if (!tile || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.MOUNTAIN
            || tile.terrain === TerrainType.FOREST || Pathfinder.blockedTiles.has(key)) continue;

        const distFromThreat = Pathfinder.heuristic({ q, r }, threat.position);
        const distFromUs = Pathfinder.heuristic(unit.position, { q, r });

        // We want: far from threat, close to us, and ideally at our weapon range
        // Moving "away" direction is rewarded
        const awayDot = aq * Math.sign(dq) + ar * Math.sign(dr);
        const rangeFit = 1 - Math.abs(distFromThreat - fleeRange) * 0.5; // Prefer landing at weapon range
        const score = awayDot * 2 + rangeFit * 3 - distFromUs * 1.5;

        if (score > bestScore && distFromUs <= 3 && distFromThreat >= 2) {
          bestScore = score;
          bestTile = { q, r };
        }
      }
    }
    return bestTile;
  }

  static hexToWorld(coord: HexCoord, map: GameMap): { x: number; y: number; z: number } {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const tile = map.tiles.get(`${coord.q},${coord.r}`);
    const y = tile ? tile.elevation * 0.5 + 0.25 : 0.5;
    return { x, y, z };
  }

  /**
   * Get a formation slot for a combat unit near a rally point.
   * Uses concentric rings around the rally point, assigning each unit a unique slot.
   */
  static getFormationSlot(unit: Unit, allCombat: Unit[], rallyPoint: HexCoord, map: GameMap): HexCoord | null {
    // Find this unit's index among combat units of the same owner
    const sameOwner = allCombat.filter(u => u.owner === unit.owner);
    const unitIdx = sameOwner.indexOf(unit);
    if (unitIdx < 0) return null;

    // Generate formation positions in expanding rings around rally point
    const slots: HexCoord[] = [];
    for (let radius = 1; radius <= 4; radius++) {
      // Walk hex ring at this radius
      for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = -radius; dr <= radius; dr++) {
          // Only include tiles on the ring perimeter (not interior)
          if (Math.abs(dq) !== radius && Math.abs(dr) !== radius) continue;
          const q = rallyPoint.q + dq;
          const r = rallyPoint.r + dr;
          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (!tile) continue;
          if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.FOREST ||
              tile.terrain === TerrainType.MOUNTAIN || tile.elevation >= 10) continue;
          if (Pathfinder.blockedTiles.has(key)) continue;
          slots.push({ q, r });
        }
      }
    }

    // Assign this unit to its slot (wrapping if more units than slots)
    if (slots.length === 0) return null;
    const slot = slots[unitIdx % slots.length];

    // Only move there if we're not already there
    if (unit.position.q === slot.q && unit.position.r === slot.r) return null;
    return slot;
  }

  /**
   * Find an adjacent enemy wall to attack
   */
  static findAdjacentEnemyWall(unit: Unit, playerOwnerId: number): HexCoord | null {
    const neighbors = Pathfinder.getHexNeighbors(unit.position);

    for (const neighbor of neighbors) {
      const nKey = `${neighbor.q},${neighbor.r}`;
      // Check if wall exists at this position and if it's not owned by this player
      if (UnitAI.wallsBuilt.has(nKey)) {
        const wallOwner = UnitAI.wallOwners.get(nKey);
        if (wallOwner !== undefined && wallOwner !== playerOwnerId) {
          return neighbor;
        }
      }
    }
    return null;
  }
}

// Event types emitted by the AI system
export interface UnitEvent {
  type: string;
  unit?: Unit;
  attacker?: Unit;
  defender?: Unit;
  killer?: Unit;
  result?: any;
}
