// ============================================
// CUBITOPIA - RTS Unit AI System
// Handles unit movement, combat, and behaviors
// ============================================

import { Unit, UnitType, UnitState, UnitStance, CommandType, HexCoord, GameMap, TerrainType, ResourceType, BlockType, Player, Base, PlacedBuilding, ENABLE_UNDERGROUND } from '../../types';
import { Pathfinder, tileKey } from './Pathfinder';
import { CombatSystem } from './CombatSystem';
import { StatusEffectSystem } from './StatusEffectSystem';
import { CombatLog } from '../../ui/ArenaDebugConsole';
import { TacticalGroupManager, TacticalGroup, getTacticalRole, TacticalRole, isAlive } from './TacticalGroup';
import { GAME_CONFIG } from '../GameConfig';
import { SharedGameState, MineTarget, UnitAIDebugFlags } from '../SharedGameState';
import { Logger } from '../../engine/Logger';

// Re-export interfaces so existing imports from './UnitAI' keep working
export type { MineTarget, UnitAIDebugFlags };

export class UnitAI {
  // ── Deterministic tie-breaking for multiplayer ──
  // When two tiles score equally, Map/Set iteration order differs across
  // browser engines (V8 vs JSC). Always prefer the lower coordinate
  // (q first, then r) so both clients pick the same tile.
  private static tieBreak(candidate: HexCoord, current: HexCoord | null): boolean {
    if (!current) return true;
    return candidate.q < current.q || (candidate.q === current.q && candidate.r < current.r);
  }

  // ── Float quantization for multiplayer determinism ──
  // Math.sqrt and float accumulation can produce subtly different results
  // across browser engines (V8 vs JSC). Quantizing worldPosition to a
  // fine grid (1/512 ≈ 0.002) each tick prevents drift from accumulating.
  // 512 is a power of 2, so 1/512 is exactly representable in IEEE 754.
  private static readonly QUANT = 512;
  private static quantize(v: number): number {
    return Math.round(v * UnitAI.QUANT) / UnitAI.QUANT;
  }
  /** Snap a unit's worldPosition to the quantization grid after movement */
  private static quantizePosition(unit: Unit): void {
    unit.worldPosition.x = UnitAI.quantize(unit.worldPosition.x);
    unit.worldPosition.y = UnitAI.quantize(unit.worldPosition.y);
    unit.worldPosition.z = UnitAI.quantize(unit.worldPosition.z);
  }

  // ── SharedGameState: single injectable container for all mutable game state ──
  // All 30+ statics that were here are now in SharedGameState.
  // Forwarding getters/setters below keep `UnitAI.xxx` working everywhere.
  static state: SharedGameState = new SharedGameState();

  // ── Forwarding getters/setters (backward-compatible) ──────────
  static get claimedTrees() { return UnitAI.state.claimedTrees; }
  static get farmPatches() { return UnitAI.state.farmPatches; }
  static get cropStages() { return UnitAI.state.cropStages; }
  static get cropTimers() { return UnitAI.state.cropTimers; }
  static get playerGrassBlueprint() { return UnitAI.state.playerGrassBlueprint; }
  static get grassTiles() { return UnitAI.state.grassTiles; }
  static get siloPositions() { return UnitAI.state.siloPositions; }
  static get farmhousePositions() { return UnitAI.state.farmhousePositions; }
  static get forestryPositions() { return UnitAI.state.forestryPositions; }
  static get claimedFarms() { return UnitAI.state.claimedFarms; }
  static get wallsBuilt() { return UnitAI.state.wallsBuilt; }
  static get buildingPositions() { return UnitAI.state.buildingPositions; }
  static get buildingOwners() { return UnitAI.state.buildingOwners; }
  static get wallOwners() { return UnitAI.state.wallOwners; }
  static get stoneStockpile() { return UnitAI.state.stoneStockpile; }
  static set stoneStockpile(v) { UnitAI.state.stoneStockpile = v; }
  static get ironStockpile() { return UnitAI.state.ironStockpile; }
  static set ironStockpile(v) { UnitAI.state.ironStockpile = v; }
  static get clayStockpile() { return UnitAI.state.clayStockpile; }
  static set clayStockpile(v) { UnitAI.state.clayStockpile = v; }
  static get crystalStockpile() { return UnitAI.state.crystalStockpile; }
  static set crystalStockpile(v) { UnitAI.state.crystalStockpile = v; }
  static get charcoalStockpile() { return UnitAI.state.charcoalStockpile; }
  static set charcoalStockpile(v) { UnitAI.state.charcoalStockpile = v; }
  static get steelStockpile() { return UnitAI.state.steelStockpile; }
  static set steelStockpile(v) { UnitAI.state.steelStockpile = v; }
  static get goldStockpile() { return UnitAI.state.goldStockpile; }
  static set goldStockpile(v) { UnitAI.state.goldStockpile = v; }
  static get moraleModifiers() { return UnitAI.state.moraleModifiers; }
  static set moraleModifiers(v) { UnitAI.state.moraleModifiers = v; }
  static get placedBuildings() { return UnitAI.state.placedBuildings; }
  static set placedBuildings(v) { UnitAI.state.placedBuildings = v; }
  static get bases() { return UnitAI.state.bases; }
  static set bases(v) { UnitAI.state.bases = v; }
  static get tacticalGroupManager() { return UnitAI.state.tacticalGroupManager; }
  static set tacticalGroupManager(v) { UnitAI.state.tacticalGroupManager = v; }

  // ── Reusable scratch arrays/collections (avoid per-frame allocations) ──
  private static _focusCountScratch: Map<string, number> = new Map();
  private static _peelTargetsScratch: Set<string> = new Set();
  private static readonly _HEX_DIRS: readonly HexCoord[] = [{q:1,r:0},{q:-1,r:0},{q:0,r:1},{q:0,r:-1},{q:1,r:-1},{q:-1,r:1}];

  static get players() { return UnitAI.state.players; }
  static get playerCount() { return UnitAI.state.playerCount; }
  static set playerCount(v) { UnitAI.state.playerCount = v; }

  /** Check if a position is an underground base — used to force tunnel pathing */
  static isUndergroundBase(pos: HexCoord, map: GameMap): boolean {
    const base = UnitAI.bases.find(b => b.position.q === pos.q && b.position.r === pos.r && !b.destroyed);
    if (!base) return false;
    const tile = map.tiles.get(`${pos.q},${pos.r}`);
    return !!tile?.hasTunnel && base.worldPosition.y < (tile.elevation ?? 0) * 0.5;
  }

  /** Per-unit blacklist of tiles that failed pathfinding — avoids retrying same unreachable target every frame.
   *  Key: unitId, Value: Map of "q,r" → expiry timestamp */
  private static unreachableCache: Map<string, Map<string, number>> = new Map();
  private static readonly UNREACHABLE_TIMEOUT = 600; // ~10 seconds at 60fps before retrying

  /** Mark a tile as temporarily unreachable for a specific unit */
  private static markUnreachable(unitId: string, tileKey: string): void {
    let unitCache = UnitAI.unreachableCache.get(unitId);
    if (!unitCache) {
      unitCache = new Map();
      UnitAI.unreachableCache.set(unitId, unitCache);
    }
    unitCache.set(tileKey, UnitAI.gameFrame + UnitAI.UNREACHABLE_TIMEOUT);
  }

  /** Clear all unreachable caches (call on new game) */
  static clearUnreachableCache(): void {
    UnitAI.unreachableCache.clear();
  }

  /** Prune unreachable cache: remove entries for dead units + expired tile entries.
   *  Called periodically from update() to prevent memory leaks. */
  private static readonly PRUNE_INTERVAL = 300; // ~5 seconds at 60fps
  private static lastPruneFrame = 0;

  static pruneUnreachableCache(liveUnitIds: Map<string, unknown>): void {
    const cache = UnitAI.unreachableCache;
    const now = UnitAI.gameFrame;
    for (const [unitId, tileMap] of cache) {
      // Remove entire entry if unit is dead/gone
      if (!liveUnitIds.has(unitId)) {
        cache.delete(unitId);
        continue;
      }
      // Remove expired tile entries
      for (const [tileKey, expiry] of tileMap) {
        if (now > expiry) tileMap.delete(tileKey);
      }
      // Remove empty maps
      if (tileMap.size === 0) cache.delete(unitId);
    }
  }

  /** Check if a tile is still marked unreachable for a unit */
  static isUnreachable(unitId: string, tileKey: string): boolean {
    const unitCache = UnitAI.unreachableCache.get(unitId);
    if (!unitCache) return false;
    const expiry = unitCache.get(tileKey);
    if (!expiry) return false;
    if (UnitAI.gameFrame > expiry) {
      unitCache.delete(tileKey);
      return false;
    }
    return true;
  }

  /**
   * Update all units for one frame
   */
  static get debugFlags() { return UnitAI.state.debugFlags; }
  static set debugFlags(v) { UnitAI.state.debugFlags = v; }
  static get gameFrame() { return UnitAI.state.gameFrame; }
  static set gameFrame(v) { UnitAI.state.gameFrame = v; }

  /** True if unit is dead or dying to a ranged projectile still in flight */
  static isDead(unit: Unit): boolean {
    return unit.state === UnitState.DEAD || !!unit._pendingRangedDeath;
  }

  /**
   * Minimum attack cooldown per unit type (seconds).
   * Ensures the attack animation has time to complete one full cycle
   * before the next attack can fire. Calculated from 1/animSpeed.
   */
  // Each value = 1/animSpeed — prevents re-attack before animation cycle completes
  private static readonly MIN_ATTACK_COOLDOWN: Partial<Record<UnitType, number>> = {
    [UnitType.WARRIOR]:      0.95, // 1/1.05
    [UnitType.PALADIN]:      0.83, // 1/1.2
    [UnitType.RIDER]:        0.83, // 1/1.2
    [UnitType.SCOUT]:        0.71, // 1/1.4
    [UnitType.ASSASSIN]:     0.83, // 1/1.2
    [UnitType.BERSERKER]:    1.00, // 1/1.0
    [UnitType.SHIELDBEARER]: 1.00, // 1/1.0
    [UnitType.GREATSWORD]:   1.25, // 1/0.8
    [UnitType.OGRE]:         1.67, // 1/0.6
    [UnitType.LUMBERJACK]:   0.71, // 1/1.4
  };

  /** Get attack cooldown clamped to animation cycle minimum, modified by morale */
  static getAttackCooldown(unit: Unit): number {
    const moraleMod = UnitAI.moraleModifiers[unit.owner] ?? 1.0;
    // Higher morale → lower cooldown (faster attacks). Divide by morale modifier.
    const baseCooldown = 1 / (unit.attackSpeed * moraleMod);
    const minCooldown = UnitAI.MIN_ATTACK_COOLDOWN[unit.type] ?? 0.40;
    return Math.max(baseCooldown, minCooldown);
  }

  // Reusable collections — avoid per-frame allocation
  private static _allUnitsCache: Unit[] = [];
  private static _unitByIdCache: Map<string, Unit> = new Map();
  private static _idleCombatCache: Unit[] | null = null;

  static update(players: Player[], map: GameMap, delta: number): UnitEvent[] {
    const events: UnitEvent[] = [];
    // Build allUnits without flatMap (reuse array, no allocation)
    const allUnits = UnitAI._allUnitsCache;
    allUnits.length = 0;
    for (let pi = 0; pi < players.length; pi++) {
      const pu = players[pi].units;
      for (let ui = 0, ulen = pu.length; ui < ulen; ui++) {
        allUnits.push(pu[ui]);
      }
    }
    // Build unit-by-ID lookup for O(1) target resolution
    const unitById = UnitAI._unitByIdCache;
    unitById.clear();
    for (let i = 0, len = allUnits.length; i < len; i++) {
      unitById.set(allUnits[i].id, allUnits[i]);
    }

    // Cache player references for static methods that only receive owner id
    UnitAI.players.clear();
    for (const p of players) {
      UnitAI.players.set(p.id, p);
    }

    // Periodic prune of unreachable cache — removes dead unit entries + expired tiles
    if (UnitAI.gameFrame - UnitAI.lastPruneFrame >= UnitAI.PRUNE_INTERVAL) {
      UnitAI.lastPruneFrame = UnitAI.gameFrame;
      UnitAI.pruneUnreachableCache(unitById);
    }

    for (const player of players) {
      for (const unit of player.units) {
        if (unit.state === UnitState.DEAD) continue;
        if (unit._pendingRangedDeath) continue; // Dying to ranged — wait for projectile visual
        if (unit._garrisoned) continue; // Skip garrisoned units — they're inside a structure

        // Decrease cooldowns
        unit.attackCooldown = Math.max(0, unit.attackCooldown - delta);
        unit.gatherCooldown = Math.max(0, unit.gatherCooldown - delta);
        if ((unit as any)._fleeCooldown > 0) (unit as any)._fleeCooldown -= delta;
        if ((unit as any)._cycloneCooldown > 0) (unit as any)._cycloneCooldown = Math.max(0, (unit as any)._cycloneCooldown - delta);
        if ((unit as any)._synergyCooldown > 0) (unit as any)._synergyCooldown = Math.max(0, (unit as any)._synergyCooldown - delta);

        // Healer caster: pick most-injured ally in range, fire heal projectile
        if (unit.type === UnitType.HEALER) {
          // Deterministic cast-animation timer (replaces setTimeout for multiplayer sync)
          if ((unit as any)._healCastTimer > 0) {
            (unit as any)._healCastTimer -= delta;
            if ((unit as any)._healCastTimer <= 0) {
              (unit as any)._healCastTimer = 0;
              if (unit.state === UnitState.ATTACKING) unit.state = UnitState.IDLE;
            }
          }
          const healed = CombatSystem.processHealerTick(unit, allUnits, delta);
          if (healed.length > 0) {
            unit.state = UnitState.ATTACKING; // triggers cast animation
            // Deterministic timer: healerCastDelay is in ms, convert to seconds
            (unit as any)._healCastTimer = GAME_CONFIG.gather.healerCastDelay / 1000;
          }
          for (const hid of healed) events.push({ type: 'heal', healerId: unit.id, targetId: hid } as any);

          // Healer Cleanse: if not healing, try to cleanse a debuffed ally
          if (healed.length === 0) {
            const cleanseEvts = StatusEffectSystem.processHealerCleanse(unit, allUnits, delta);
            if (cleanseEvts.length > 0 && CombatLog.isEnabled()) {
              // Log the cleanse event with all effects that were removed
              const targetId = cleanseEvts[0]?.unitId;
              const target = allUnits.find(u => u.id === targetId);
              if (target) {
                const effects = cleanseEvts.filter(e => e.effect !== 'cleanse').map(e => e.effect);
                CombatLog.logCleanse(unit, target, effects.length > 0 ? effects : ['debuffs']);
              }
            }
            for (const ce of cleanseEvts) {
              events.push({ type: 'status:cleanse', unitId: ce.unitId, effect: ce.effect, casterId: ce.casterId } as any);
            }
          }
        }

        // Knockup CC: if unit is airborne, skip all actions this frame
        if (StatusEffectSystem.isKnockedUp(unit)) continue;

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
          case UnitState.CONSTRUCTING:
            UnitAI.handleConstructing(unit, delta, events, map);
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

    // ─── Status Effect Tick: burn damage, expiry ───
    const statusTicks = StatusEffectSystem.tickStatusEffects(allUnits, delta);
    for (const se of statusTicks) {
      if (se.type === 'status:tick') {
        events.push({ type: 'status:tick', unitId: se.unitId, effect: se.effect, damage: se.damage } as any);
      }
    }
    // Check for status-tick kills
    for (const unit of allUnits) {
      if (unit.currentHealth <= 0 && unit.state !== UnitState.DEAD) {
        unit.state = UnitState.DEAD;
        events.push({ type: 'unit:killed', unit, killer: undefined });
      }
    }

    // ─── Mage Group Synergy: Arcane Convergence ───
    const synergyResults = CombatSystem.checkMageSynergy(allUnits);
    for (const sr of synergyResults) {
      for (const did of sr.damagedIds) {
        events.push({ type: 'combat:synergy', unitId: did, centerQ: sr.centerQ, centerR: sr.centerR, owner: sr.owner } as any);
      }
    }

    return events;
  }

  /**
   * Issue a move command to a unit
   */
  static commandMove(unit: Unit, target: HexCoord, map: GameMap, preferUnderground = false): void {
    const canTraverseForest = unit.type === UnitType.LUMBERJACK;
    const canTraverseRidge = true; // All units can climb ridges (steep cost but passable)
    // Squad units ignore occupied tile penalties — the penalty creates
    // impassable chokepoints near congested bases
    const ignoreOccupied = unit._squadId != null;

    // Auto-detect underground bases — always route through tunnels
    if (ENABLE_UNDERGROUND && !preferUnderground && UnitAI.isUndergroundBase(target, map)) {
      preferUnderground = true;
    }
    // Disable all underground pathing when feature is off
    if (!ENABLE_UNDERGROUND) preferUnderground = false;

    let path: HexCoord[];

    if (preferUnderground) {
      // Build a multi-segment path: surface → tunnel entrance → tunnel exit → surface
      path = UnitAI.buildUndergroundPath(unit.position, target, map, canTraverseForest, unit.owner, canTraverseRidge);
    } else {
      path = Pathfinder.findPath(unit.position, target, map, canTraverseForest, unit.owner, canTraverseRidge, false, ignoreOccupied);
    }

    // Fallback: if path failed and we weren't already ignoring occupied, retry without occupation penalties
    if (path.length <= 1 && !ignoreOccupied && !preferUnderground) {
      path = Pathfinder.findPath(unit.position, target, map, canTraverseForest, unit.owner, canTraverseRidge, false, true);
    }

    if (path.length > 1) {
      unit.command = { type: CommandType.MOVE, targetPosition: target, targetUnitId: null };
      unit.targetPosition = path[1]; // Next step
      unit.state = UnitState.MOVING;
      unit._path = path;
      unit._pathIndex = 1;
      // Mark as underground command — _underground is set dynamically per-tile in handleMoving
      unit._undergroundCommand = preferUnderground;
      // If not an explicit underground command, check if unit is currently underground
      // AI may re-task underground units (e.g., builder goes to mine, combat unit chases)
      // Keep them underground if they're on a tunnel tile and the path goes through tunnels
      if (!preferUnderground && unit._underground) {
        const curTile = map.tiles.get(`${unit.position.q},${unit.position.r}`);
        if (curTile?.hasTunnel) {
          // Check if the target or any early path tile is also a tunnel
          const targetTile = map.tiles.get(`${target.q},${target.r}`);
          if (targetTile?.hasTunnel) {
            unit._undergroundCommand = true;
          } else {
            // Target is on surface — unit will emerge naturally via dynamic _underground toggle
            unit._undergroundCommand = true; // Keep underground until they leave tunnel tiles
          }
        } else {
          unit._underground = false;
        }
      } else if (!preferUnderground) {
        unit._underground = false;
      }
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
   * Squad-aware idle transition: if unit is in a squad with an active tactical group,
   * resume marching toward the squad objective instead of going IDLE.
   * Returns true if the unit was redirected (caller should `return`), false if it truly went IDLE.
   */
  static tryResumeSquadMarch(unit: Unit, map?: GameMap): boolean {
    if (!unit._squadId || !unit._tacticalGroupId || !map) return false;
    const tgm = UnitAI.tacticalGroupManager;
    if (!tgm) return false;
    const group = tgm.getGroupForUnit(unit);
    if (!group || !group.objective) return false;
    // Don't re-march if we're already at the objective
    const distToObj = Pathfinder.heuristic(unit.position, group.objective);
    if (distToObj <= 2) return false; // Close enough — actually arrived
    // Resume marching
    unit.state = UnitState.MOVING;
    unit.command = { type: CommandType.MOVE, targetPosition: group.objective, targetUnitId: null };
    UnitAI.commandMove(unit, group.objective, map);
    return true;
  }

  /**
   * Build a multi-segment path that routes through underground tunnels.
   * 1. Find nearest tunnel entrance to the unit
   * 2. Find nearest tunnel tile to the destination
   * 3. Chain: unit→entrance (surface), entrance→exit (through tunnels), exit→destination (surface)
   */
  private static buildUndergroundPath(
    start: HexCoord, goal: HexCoord, map: GameMap,
    canTraverseForest: boolean, unitOwner: number, canTraverseRidge: boolean
  ): HexCoord[] {
    // Find tunnel entrances: tunnel tiles that have at least one non-tunnel walkable neighbor
    const entrances: HexCoord[] = [];
    for (const [key, tile] of map.tiles) {
      if (!tile.hasTunnel) continue;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nTile = map.tiles.get(`${n.q},${n.r}`);
        if (nTile && !nTile.hasTunnel && nTile.terrain !== TerrainType.WATER) {
          entrances.push(coord);
          break;
        }
      }
    }
    if (entrances.length === 0) {
      return Pathfinder.findPath(start, goal, map, canTraverseForest, unitOwner, canTraverseRidge);
    }

    // Check if the goal itself is a tunnel tile — if so, we stay underground at the end
    const goalTile = map.tiles.get(`${goal.q},${goal.r}`);
    const goalIsTunnel = !!(goalTile?.hasTunnel);

    // Sort entrances by hex distance to start, try the closest ones first
    // (the nearest by hex distance might be unreachable due to terrain, so try several)
    const entrancesByDistToStart = [...entrances].sort(
      (a, b) => Pathfinder.heuristic(start, a) - Pathfinder.heuristic(start, b)
    );

    // Sort entrances by hex distance to goal for the exit
    const entrancesByDistToGoal = [...entrances].sort(
      (a, b) => Pathfinder.heuristic(goal, a) - Pathfinder.heuristic(goal, b)
    );

    // Try up to 3 closest entrances for each end to find a working path
    let bestPath: HexCoord[] = [];
    let foundPath = false;
    const maxTries = Math.min(3, entrancesByDistToStart.length);
    const maxExitTries = Math.min(3, entrancesByDistToGoal.length);

    for (let ei = 0; ei < maxTries; ei++) {
      const entrance = entrancesByDistToStart[ei];

      // Segment 1: unit → tunnel entrance (surface pathfinding)
      const seg1 = Pathfinder.findPath(start, entrance, map, canTraverseForest, unitOwner, canTraverseRidge);
      if (seg1.length === 0) continue; // Can't reach this entrance, try next

      for (let xi = 0; xi < maxExitTries; xi++) {
        const exit = entrancesByDistToGoal[xi];
        const entranceKey = `${entrance.q},${entrance.r}`;
        const exitKey = `${exit.q},${exit.r}`;

        // Segment 2: entrance → exit (through tunnel network — tunnelMode bypasses surface terrain)
        let seg2: HexCoord[];
        if (entranceKey === exitKey) {
          seg2 = [entrance];
        } else {
          seg2 = Pathfinder.findPath(entrance, exit, map, canTraverseForest, unitOwner, canTraverseRidge, true);
          if (seg2.length === 0) continue;
        }

        // Segment 3: exit → destination
        // If destination is a tunnel tile, path through tunnels (tunnelMode)
        let seg3: HexCoord[];
        const goalKey = `${goal.q},${goal.r}`;
        if (exitKey === goalKey) {
          seg3 = [exit];
        } else if (goalIsTunnel) {
          // Goal is underground — path from exit to goal through the tunnel
          seg3 = Pathfinder.findPath(exit, goal, map, canTraverseForest, unitOwner, canTraverseRidge, true);
          if (seg3.length === 0) continue;
        } else {
          // Goal is on surface — path from exit to goal (normal surface pathfinding)
          seg3 = Pathfinder.findPath(exit, goal, map, canTraverseForest, unitOwner, canTraverseRidge);
          if (seg3.length === 0) continue;
        }

        // Concatenate segments, removing duplicates at junctions
        const fullPath: HexCoord[] = [...seg1];
        for (let i = 1; i < seg2.length; i++) fullPath.push(seg2[i]);
        for (let i = 1; i < seg3.length; i++) fullPath.push(seg3[i]);

        if (!foundPath || fullPath.length < bestPath.length) {
          bestPath = fullPath;
          foundPath = true;
        }
        break; // Found a working exit, move on
      }
      if (foundPath) break; // Found a working path
    }

    if (!foundPath) {
      // No tunnel path found — fall back to normal pathfinding
      return Pathfinder.findPath(start, goal, map, canTraverseForest, unitOwner, canTraverseRidge);
    }

    return bestPath;
  }

  /**
   * Issue an attack-move command
   */
  static commandAttack(unit: Unit, target: HexCoord, targetUnitId: string | null, map: GameMap, preferUnderground = false): void {
    unit.command = { type: CommandType.ATTACK, targetPosition: target, targetUnitId };

    // Berserker: recharge axe throw if this is a new unique target
    if (targetUnitId) UnitAI.rechargeBerserkerAxeThrow(unit, targetUnitId);

    // Determine if we should route underground:
    // - explicit preferUnderground flag, OR
    // - unit is already underground, OR
    // - the target is an underground base (MUST use tunnels, not clip through)
    const shouldGoUnderground = ENABLE_UNDERGROUND && (preferUnderground || !!unit._underground || UnitAI.isUndergroundBase(target, map));

    if (targetUnitId) {
      // Direct attack - move toward target
      let path: HexCoord[];
      if (shouldGoUnderground) {
        path = UnitAI.buildUndergroundPath(unit.position, target, map, false, unit.owner, false);
        if (path.length <= 1) {
          // Fallback to surface path
          path = Pathfinder.findPath(unit.position, target, map, false, unit.owner);
        }
      } else {
        path = Pathfinder.findPath(unit.position, target, map, false, unit.owner);
      }
      if (path.length > 1) {
        unit.targetPosition = path[1];
        unit.state = UnitState.MOVING;
        unit._path = path;
        unit._pathIndex = 1;
        if (shouldGoUnderground) {
          unit._undergroundCommand = true;
        } else if (!unit._underground) {
          unit._undergroundCommand = false;
        }
      }
    } else {
      // Attack-move: move to position, attack anything on the way
      UnitAI.commandMove(unit, target, map, shouldGoUnderground);
      unit.command!.type = CommandType.ATTACK;
    }
  }

  /**
   * Try to resume marching toward the unit's stored _moveDestination after combat ends.
   * Returns true if the unit resumed movement, false if there was no destination to resume.
   */
  static tryResumeMoveDestination(unit: Unit, map?: GameMap): boolean {
    if (!unit._moveDestination || !map) return false;
    const dest = unit._moveDestination;
    // If already at destination, clear and go idle
    if (Pathfinder.heuristic(unit.position, dest) <= 1) {
      unit._moveDestination = undefined;
      return false;
    }
    UnitAI.commandMove(unit, dest, map);
    unit._forceMove = false; // Keep reacting to enemies en route
    return true;
  }

  // ========== PLAYER SQUAD OBJECTIVE SYSTEM ==========
  // Mirrors AI commander logic: player squads with CAPTURE/ASSAULT objectives
  // act autonomously — find targets, march, re-evaluate on completion.

  /** Timer throttle — only re-evaluate player objectives every 2 seconds */
  static _playerObjTimer = 0;
  static readonly PLAYER_OBJ_INTERVAL = 2.0; // seconds

  /**
   * Called every tick from the main game loop. Handles autonomous behavior for
   * local player units with _playerObjective set. Groups units by squad, finds targets,
   * dispatches idle/stuck members.
   *
   * @param allUnits All units in the game
   * @param bases All bases in the game
   * @param map Current game map
   * @param delta Time delta in seconds
   * @param localPlayerIndex Index of the local player (whose objectives to update)
   */
  static updatePlayerObjectives(allUnits: Unit[], bases: Base[], map: GameMap, delta: number, localPlayerIndex: number = 0, skipTimerCheck = false): void {
    if (!skipTimerCheck) {
      UnitAI._playerObjTimer += delta;
      if (UnitAI._playerObjTimer < UnitAI.PLAYER_OBJ_INTERVAL) return;
      UnitAI._playerObjTimer = 0;
    }

    // Collect local player units with objectives, grouped by squad
    const objUnits = allUnits.filter(u => u.owner === localPlayerIndex && u._playerObjective && !UnitAI.isDead(u));
    if (objUnits.length === 0) return;

    // Group by squad ID (null squad = individual objective units grouped together)
    const squads = new Map<number | null, Unit[]>();
    for (const u of objUnits) {
      const key = u._squadId ?? null;
      if (!squads.has(key)) squads.set(key, []);
      squads.get(key)!.push(u);
    }

    for (const [, members] of squads) {
      if (members.length === 0) continue;
      const objective = members[0]._playerObjective!;

      // Compute squad centroid
      const avgQ = Math.round(members.reduce((s, u) => s + u.position.q, 0) / members.length);
      const avgR = Math.round(members.reduce((s, u) => s + u.position.r, 0) / members.length);
      const centroid: HexCoord = { q: avgQ, r: avgR };

      // Find the best target for this objective
      const target = UnitAI.findPlayerObjectiveTarget(objective, centroid, bases, allUnits, localPlayerIndex);
      if (!target) {
        // No valid target — clear objective
        for (const u of members) {
          u._playerObjective = undefined;
          u._playerObjectiveTarget = undefined;
          u._squadObjective = undefined;
        }
        continue;
      }

      // Check if we arrived at current target
      const currentTarget = members[0]._playerObjectiveTarget;
      const atTarget = currentTarget && Pathfinder.heuristic(centroid, currentTarget) <= 3;

      // Check if current target is still valid
      let currentValid = false;
      if (currentTarget) {
        if (objective === 'CAPTURE') {
          currentValid = bases.some(b => b.position.q === currentTarget.q && b.position.r === currentTarget.r && b.owner !== localPlayerIndex && !b.destroyed);
        } else if (objective === 'ASSAULT') {
          currentValid = bases.some(b => b.position.q === currentTarget.q && b.position.r === currentTarget.r && b.owner !== localPlayerIndex && !b.destroyed);
        }
      }

      // Need new target if: arrived, invalid, or no target yet
      const needsNewTarget = !currentTarget || atTarget || !currentValid;

      if (needsNewTarget) {
        // Set new target and dispatch
        const stance = objective === 'CAPTURE' ? UnitStance.DEFENSIVE : UnitStance.AGGRESSIVE;
        for (const u of members) {
          u._playerObjectiveTarget = target.position;
          u._squadObjective = objective;
          u.stance = stance;
          u._playerCommanded = true;
          u._forceMove = false;
          u._moveDestination = target.position;
          UnitAI.commandMove(u, target.position, map);
        }
      } else {
        // Re-kick idle/stuck members toward current target
        for (const u of members) {
          const distToObj = Pathfinder.heuristic(u.position, currentTarget!);
          if (distToObj <= 1) continue; // Already there
          const isStuck = u.state === UnitState.IDLE ||
            (u.state === UnitState.MOVING && (!u.targetPosition || !u._path));
          if (!isStuck) continue;
          u._squadObjective = objective;
          u._playerCommanded = true;
          u._forceMove = false;
          UnitAI.commandMove(u, currentTarget!, map);
        }
      }
    }
  }

  /**
   * Find the best target for a player objective, mirroring AI commander logic.
   * @param localPlayerIndex Index of the player whose objectives we're evaluating
   */
  private static findPlayerObjectiveTarget(
    objective: 'CAPTURE' | 'ASSAULT',
    from: HexCoord,
    bases: Base[],
    allUnits: Unit[],
    localPlayerIndex: number = 0
  ): Base | null {
    if (objective === 'CAPTURE') {
      // Prioritize: nearest neutral base, then nearest enemy or owned base (not local player's owned base)
      const captureTargets = bases
        .filter(b => b.owner !== localPlayerIndex && !b.destroyed)
        .sort((a, b) => {
          // Neutral first (owner >= playerCount), then by distance
          const aN = a.owner >= UnitAI.playerCount ? 0 : 1;
          const bN = b.owner >= UnitAI.playerCount ? 0 : 1;
          if (aN !== bN) return aN - bN;
          return Pathfinder.heuristic(from, a.position) - Pathfinder.heuristic(from, b.position) || a.position.q - b.position.q || a.position.r - b.position.r;
        });
      return captureTargets[0] ?? null;
    } else {
      // ASSAULT: target the enemy capital, or nearest enemy base (not owned by local player)
      const enemyBases = bases
        .filter(b => b.owner !== localPlayerIndex && b.owner < UnitAI.playerCount && !b.destroyed)
        .sort((a, b) => {
          // Capitals first (tier matters), then by distance
          const aTier = a.tier ?? 0;
          const bTier = b.tier ?? 0;
          if (aTier !== bTier) return bTier - aTier; // Higher tier = capital
          return Pathfinder.heuristic(from, a.position) - Pathfinder.heuristic(from, b.position) || a.position.q - b.position.q || a.position.r - b.position.r;
        });
      return enemyBases[0] ?? null;
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
    unit._forceMove = false;
    unit._moveDestination = undefined;
    unit._playerObjective = undefined;
    unit._playerObjectiveTarget = undefined;
  }

  // --- State Handlers ---

  private static handleIdle(unit: Unit, allUnits: Unit[], player: Player, map: GameMap, events: UnitEvent[]): void {
    // --- Healer: seek injured allies and stay near them ---
    if (unit.type === UnitType.HEALER) {
      // Manual heal target: if player right-clicked a friendly, prioritize that target
      if (unit._healTarget) {
        const healTarget = UnitAI._unitByIdCache.get(unit._healTarget!);
        if (healTarget && healTarget.currentHealth > 0 && healTarget.currentHealth < healTarget.stats.maxHealth) {
          const dist = Pathfinder.heuristic(unit.position, healTarget.position);
          if (dist <= unit.stats.range) {
            // In range — heal directly
            unit.state = UnitState.ATTACKING;
            unit.command = { type: CommandType.ATTACK, targetPosition: healTarget.position, targetUnitId: healTarget.id };
            return;
          } else {
            // Move toward heal target
            UnitAI.commandMove(unit, healTarget.position, map);
            return;
          }
        } else {
          // Target fully healed or dead — clear manual target
          unit._healTarget = undefined;
        }
      }

      let bestAlly: Unit | null = null;
      let bestScore = Infinity;
      for (const ally of allUnits) {
        if (ally.owner !== unit.owner || ally === unit || ally.currentHealth <= 0) continue;
        if (ally.currentHealth >= ally.stats.maxHealth) continue;
        const dist = Pathfinder.heuristic(unit.position, ally.position);
        const hpRatio = ally.currentHealth / ally.stats.maxHealth;
        const score = dist + hpRatio * 5; // Prioritize low HP + close
        if (score < bestScore || (score === bestScore && bestAlly && UnitAI.tieBreak(ally.position, bestAlly.position))) { bestScore = score; bestAlly = ally; }
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
          if (d < nearestDist || (d === nearestDist && nearestCombat && UnitAI.tieBreak(ally.position, nearestCombat.position))) { nearestDist = d; nearestCombat = ally; }
        }
        if (nearestCombat && nearestDist > 3) {
          UnitAI.commandMove(unit, nearestCombat.position, map);
        }
      }
      return;
    }

    // --- Worker units: GROUP FLEE from nearby enemies, then do their jobs ---
    // Workers only flee if an enemy is VERY close (2 hex) to avoid constant flee-loops
    // that prevent them from ever doing their jobs. Cooldown prevents re-fleeing immediately.
    if (unit.type === UnitType.BUILDER || unit.type === UnitType.LUMBERJACK || unit.type === UnitType.VILLAGER) {
      // Builders with an active blueprint assignment skip flee entirely — they prioritize construction
      const skipFlee = unit.type === UnitType.BUILDER && !!unit._assignedBlueprintId;
      // Flee cooldown: don't flee again within 5 seconds of last flee
      const fleeCooldown = (unit as any)._fleeCooldown ?? 0;
      if (!skipFlee && fleeCooldown <= 0) {
        const nearEnemy = UnitAI.findNearestEnemy(unit, allUnits, player.id);
        if (nearEnemy) {
          const enemyDist = Pathfinder.heuristic(unit.position, nearEnemy.position);
          // Only flee from very close threats (2 hex) to avoid constant flee-loops
          if (enemyDist <= 2) {
            // Set flee cooldown so workers can work between flee attempts
            (unit as any)._fleeCooldown = 5.0; // seconds
            // Compute flee target toward own base
            const basePos = UnitAI.basePositions.get(unit.owner);
            const fleeDist = GAME_CONFIG.gather.workerFleeDistance;
            const fleeQ = basePos
              ? unit.position.q + Math.sign(basePos.q - unit.position.q) * fleeDist
              : Math.max(0, Math.min(map.width - 1, unit.position.q - fleeDist));
            const fleeR = basePos
              ? unit.position.r + Math.sign(basePos.r - unit.position.r)
              : unit.position.r;
            const fleeTarget: HexCoord = { q: Math.max(0, Math.min(map.width - 1, fleeQ)), r: fleeR };
            UnitAI.commandMove(unit, fleeTarget, map);

            // Group flee: alert all friendly workers within groupFleeRange tiles to run too
            for (let wi = 0, wlen = allUnits.length; wi < wlen; wi++) {
              const w = allUnits[wi];
              if (w === unit || w.owner !== unit.owner) continue;
              if (w.type !== UnitType.BUILDER && w.type !== UnitType.LUMBERJACK && w.type !== UnitType.VILLAGER) continue;
              if (w.state === UnitState.DEAD || w.state === UnitState.MOVING) continue;
              const wDist = Pathfinder.heuristic(unit.position, w.position);
              if (wDist <= GAME_CONFIG.gather.workerGroupFleeRange) {
                (w as any)._fleeCooldown = 5.0;
                const wFleeQ = basePos
                  ? w.position.q + Math.sign(basePos.q - w.position.q) * fleeDist
                  : Math.max(0, Math.min(map.width - 1, w.position.q - fleeDist));
                const wFleeR = basePos
                  ? w.position.r + Math.sign(basePos.r - w.position.r)
                  : w.position.r;
                const wFleeTarget: HexCoord = { q: Math.max(0, Math.min(map.width - 1, wFleeQ)), r: wFleeR };
                UnitAI.commandMove(w, wFleeTarget, map);
              }
            }
            return;
          }
        }
      }
    }

    if (unit.type === UnitType.BUILDER) {
      // Debug: if both mine and build are disabled, skip all builder AI
      if (UnitAI.debugFlags.disableMine && UnitAI.debugFlags.disableBuild) return;

      // === BUILDER IDLE DEBUG (throttled) ===

      // Priority 0: Player-assigned building blueprint (overrides ALL auto-assignment)
      if (unit._assignedBlueprintId) {
        const assigned = UnitAI.placedBuildings.find(pb => pb.id === unit._assignedBlueprintId);
        if (assigned && assigned.isBlueprint) {
          assigned.assignedBuilderId = unit.id;
          const dist = Pathfinder.heuristic(unit.position, assigned.position);
          if (dist <= 1) {
            unit.state = UnitState.CONSTRUCTING;
            unit.command = { type: CommandType.CONSTRUCT, targetPosition: assigned.position, targetUnitId: assigned.id };
            unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
            Logger.debug('Builder', `${unit.id} Priority 0: constructing assigned blueprint ${assigned.id} (${assigned.kind}), adjacent`);
            return;
          } else {
            UnitAI.commandMove(unit, assigned.position, map);
            if (unit.state !== UnitState.MOVING) {
              // Pathfinding failed — blacklist this blueprint and clear assignment
              if (!(unit as any)._failedBlueprintIds?.has(assigned.id))
                Logger.debug('Builder', `${unit.id} path to blueprint ${assigned.id} failed, blacklisting`);
              if (!(unit as any)._failedBlueprintIds) (unit as any)._failedBlueprintIds = new Set<string>();
              (unit as any)._failedBlueprintIds.add(assigned.id);
              unit._assignedBlueprintId = undefined;
              if (assigned.assignedBuilderId === unit.id) assigned.assignedBuilderId = undefined;
              // Fall through to try other tasks
            } else {
              return;
            }
          }
        }
        // Blueprint no longer exists or is complete — clear assignment (guard against double-clear)
        if (unit._assignedBlueprintId) {
          Logger.debug('Builder', `${unit.id} Priority 0: blueprint ${unit._assignedBlueprintId} gone/complete, clearing`);
          unit._assignedBlueprintId = undefined;
        }
      }

      // Builder priority: 1) building blueprints  2) mine blueprints  3) wall building  4) auto-mine
      // Building blueprints take priority over mining so player-placed structures get built first.
      // Both human and AI builders share the same fallback auto-mine behavior.
      UnitAI.releaseMineClaim(unit.id);

      // Periodically clear the pathfind-failure blacklist so builders retry blueprints.
      // Without this, a single pathfind failure permanently hides a blueprint from this builder
      // because the blacklist only clears on successful movement (which never happens if the
      // builder keeps falling through to adjacent auto-mine).
      const failedSet = (unit as any)._failedBlueprintIds as Set<string> | undefined;
      if (failedSet && failedSet.size > 0) {
        const gf = UnitAI.gameFrame;
        const lastClear = (unit as any)._lastBlacklistClear ?? 0;
        if (gf - lastClear > 600) { // retry every ~10 seconds (600 frames at 60fps)
          failedSet.clear();
          (unit as any)._lastBlacklistClear = gf;
          Logger.debug('Builder', `${unit.id} cleared blueprint blacklist (periodic retry)`);
        }
      }

      // Building construction: builders auto-seek unfinished blueprint buildings FIRST
      if (!UnitAI.debugFlags.disableBuild) {
        const blueprint = UnitAI.findNearestBlueprint(unit);
        if (blueprint) {
          blueprint.assignedBuilderId = unit.id;
          unit._assignedBlueprintId = blueprint.id; // Persist so Priority 0 catches it on re-idle
          const dist = Pathfinder.heuristic(unit.position, blueprint.position);
          if (dist <= 1) {
            // Adjacent — start constructing
            unit.state = UnitState.CONSTRUCTING;
            unit.command = { type: CommandType.CONSTRUCT, targetPosition: blueprint.position, targetUnitId: blueprint.id };
            unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
            Logger.debug('Builder', `${unit.id} auto-assigned to adjacent blueprint ${blueprint.id} (${blueprint.kind})`);
            return;
          } else {
            // Walk to blueprint
            UnitAI.commandMove(unit, blueprint.position, map);
            if (unit.state !== UnitState.MOVING) {
              // Pathfinding failed — blacklist and release assignment
              Logger.debug('Builder', `${unit.id} auto-assign path to ${blueprint.id} (${blueprint.kind}) failed, blacklisting`);
              if (!(unit as any)._failedBlueprintIds) (unit as any)._failedBlueprintIds = new Set<string>();
              (unit as any)._failedBlueprintIds.add(blueprint.id);
              unit._assignedBlueprintId = undefined;
              if (blueprint.assignedBuilderId === unit.id) blueprint.assignedBuilderId = undefined;
              // Fall through to try mining/walls
            } else {
              return;
            }
          }
        }
      }

      // Human builders check mine blueprints (skip if disableMine)
      let mineTile: HexCoord | null = null;
      if (!UnitAI.debugFlags.disableMine && !player.isAI && UnitAI.playerMineBlueprint.size > 0) {
        mineTile = UnitAI.findNearestMineBlueprint(unit, map);
      }

      if (mineTile && !UnitAI.debugFlags.disableMine) {
        // Go mine terrain
        const claimKey = `${mineTile.q},${mineTile.r}`;
        UnitAI.claimedMines.set(claimKey, unit.id);

        const dist = Pathfinder.heuristic(unit.position, mineTile);
        if (dist <= 1) {
          unit.state = UnitState.GATHERING;
          unit.command = { type: CommandType.GATHER, targetPosition: mineTile, targetUnitId: null };
          unit.gatherCooldown = GAME_CONFIG.gather.builderMineCooldown;
        } else {
          // Check if mine tile is in a tunnel — route underground if so
          const bpMineKey = `${mineTile.q},${mineTile.r}`;
          const bpMineTile = map.tiles.get(bpMineKey);
          const bpNeedsUnderground = bpMineTile?.hasTunnel === true;
          UnitAI.commandMove(unit, mineTile, map, bpNeedsUnderground);
          if (unit.state !== UnitState.MOVING) {
            // Path to mine failed — release claim and fall through
            UnitAI.claimedMines.delete(claimKey);
          }
        }
        if (unit.state === UnitState.GATHERING || unit.state === UnitState.MOVING) return;
      }

      // Wall building: both AI and human builders build walls when they have stone.
      // AI uses auto-generated choke plans; humans use player-placed blueprints.
      const wallSpot = UnitAI.debugFlags.disableBuild ? null : UnitAI.findWallSpot(unit, map);
      const hasStone = UnitAI.stoneStockpile[unit.owner] >= 1;
      const hasGateStone = UnitAI.stoneStockpile[unit.owner] >= 2;

      if (wallSpot) {
        const isGate = unit._planIsGate === true;
        const enoughStone = isGate ? hasGateStone : hasStone;

        if (enoughStone) {
          const dist = Pathfinder.heuristic(unit.position, wallSpot);
          if (dist <= 1) {
            unit.state = UnitState.BUILDING;
            unit.gatherCooldown = GAME_CONFIG.combat.unitAI.builder.wallBuildCooldown;
            return;
          } else {
            UnitAI.commandMove(unit, wallSpot, map);
            return;
          }
        }
        // Fall through to mining if not enough stone
      }

      // Auto-mine: ALL builders auto-mine for resources when idle.
      // Priority order: building blueprints → mine blueprints → wall building → auto-mine.
      // This keeps builders productive without requiring constant micromanagement.
      if (!UnitAI.debugFlags.disableMine) {
        // Throttled debug log — only every 5 seconds per builder
        // Only log for locally-controlled builders to reduce console spam
        // TODO: Add localPlayerIndex parameter to static update method
        if (unit.owner === UnitAI.state.localPlayerIndex) {
          const gf = UnitAI.gameFrame;
          if (!(unit as any)._lastAutoMineLog || gf - (unit as any)._lastAutoMineLog > 300) {
            (unit as any)._lastAutoMineLog = gf;
            Logger.debug('Builder', `${unit.id} fell through to auto-mine (no blueprints/walls found)`);
          }
        }
        const autoMineTile = UnitAI.findNearestMineSite(unit, map);
        if (autoMineTile) {
          const claimKey = `${autoMineTile.q},${autoMineTile.r}`;
          UnitAI.claimedMines.set(claimKey, unit.id);

          const dist = Pathfinder.heuristic(unit.position, autoMineTile);
          if (dist <= 1) {
            unit.state = UnitState.GATHERING;
            unit.command = { type: CommandType.GATHER, targetPosition: autoMineTile, targetUnitId: null };
            unit.gatherCooldown = GAME_CONFIG.gather.builderMineCooldown;
          } else {
            // Check if mine tile is in a tunnel — route underground if so
            const mineTileKey = `${autoMineTile.q},${autoMineTile.r}`;
            const mineTileData = map.tiles.get(mineTileKey);
            const needsUnderground = mineTileData?.hasTunnel === true;
            UnitAI.commandMove(unit, autoMineTile, map, needsUnderground);
            // If pathfinding failed, blacklist this mine temporarily
            if (unit.state === UnitState.IDLE) {
              UnitAI.claimedMines.delete(claimKey);
              UnitAI.markUnreachable(unit.id, claimKey);
            }
          }
          return;
        }
      }
      // Builder stuck near base with nothing to do — try to escape
      UnitAI.tryEscapeBaseArea(unit, map);
      return;
    }

    if (unit.type === UnitType.LUMBERJACK) {
      // Debug: if chop is disabled, skip lumberjack AI
      if (UnitAI.debugFlags.disableChop) return;

      // Release any previous claims
      UnitAI.releaseTreeClaim(unit.id);

      // Player lumberjacks: only chop trees (mining is for builders)
      let forestTile: HexCoord | null = null;

      if (!player.isAI && UnitAI.playerHarvestBlueprint.size > 0) {
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
          unit.gatherCooldown = GAME_CONFIG.gather.lumberjackChopCooldown;
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

      // Villager IDLE debug logging removed — was spamming console

      // Villager: find farm patch or tall grass to harvest, carry food to silo/base
      UnitAI.releaseTreeClaim(unit.id); // reuse claim system

      let farmTile: HexCoord | null = null;
      let grassTile: HexCoord | null = null;

      // Find nearest unclaimed mature farm patch (stage 3 = harvestable)
      let bestFarmDist = Infinity;
      for (const key of UnitAI.farmPatches) {
        const stage = UnitAI.cropStages.get(key) ?? 0;
        if (stage < 3) continue; // Only target mature crops
        const claimer = UnitAI.claimedFarms.get(key);
        if (claimer && claimer !== unit.id) continue;
        const [q, r] = key.split(',').map(Number);
        const coord = { q, r };
        const dist = Pathfinder.heuristic(unit.position, coord);
        if (dist < bestFarmDist || (dist === bestFarmDist && UnitAI.tieBreak(coord, farmTile))) {
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
        if (dist < bestGrassDist || (dist === bestGrassDist && UnitAI.tieBreak(coord, grassTile))) {
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
          unit.gatherCooldown = isGrass ? GAME_CONFIG.gather.villagerGrassCooldown : GAME_CONFIG.gather.villagerFarmCooldown;
          if (!player.isAI) Logger.verbose('Villager', `${unit.id} harvesting ${isGrass ? 'grass' : 'farm'} at (${target.q},${target.r})`);
        } else {
          UnitAI.commandMove(unit, target, map);
          if (!player.isAI) Logger.verbose('Villager', `${unit.id} moving to ${isGrass ? 'grass' : 'farm'} at (${target.q},${target.r}) dist=${dist}`);
          // If pathfinding failed (unit still idle), blacklist this tile temporarily
          if (unit.state === UnitState.IDLE) {
            UnitAI.claimedFarms.delete(tKey);
            UnitAI.markUnreachable(unit.id, tKey);
            if (!player.isAI) Logger.verbose('Villager', `${unit.id} PATHFIND FAILED to (${target.q},${target.r}), blacklisted`);
          }
        }
      } else {
        // No harvest target found — log diagnostics and try to escape base area
        if (!player.isAI) {
          Logger.throttle(4 /* DEBUG */, 'Villager', 5000,
            `${unit.id} no target: farmPatches=${UnitAI.farmPatches.size} playerGrass=${UnitAI.playerGrassBlueprint.size} autoGrass=${UnitAI.grassTiles.size}`);
        }
        UnitAI.tryEscapeBaseArea(unit, map);
      }
      return;
    }

    // --- Combat units behavior ---
    if (UnitAI.isCombatUnit(unit)) {

      // Detection ranges per unit type
      const detectionRange = UnitAI.getDetectionRange(unit);

      // PLAYER (human) combat units: behavior depends on stance
      if (!player.isAI) {
        // PASSIVE: never attack, just stand still (unless force-move overrides)
        if (unit.stance === UnitStance.PASSIVE && !unit._forceMove) {
          return;
        }

        // Zone control: if player-commanded (via MOVE, not ATTACK) and inside an
        // enemy/neutral base capture zone, hold position to maintain zone control.
        // Skip if unit has an ATTACK command — let building attack logic run.
        if (unit._playerCommanded && unit.command?.type !== CommandType.ATTACK) {
          for (const base of UnitAI.bases) {
            if (base.destroyed || base.owner === unit.owner) continue;
            const distToBase = Pathfinder.heuristic(unit.position, base.position);
            if (distToBase <= 5) { // 5-hex capture zone radius
              // Stay put — we're contesting this capture zone
              return;
            }
          }
        }

        // DEFENSIVE stance: zone-defend behavior for ALL combat units
        // Units chase enemies that enter detection range, then return to their
        // command position when no enemies remain in range.
        // Ranged kiters (archers, mages, battlemages) flee melee threats.
        if (unit.stance === UnitStance.DEFENSIVE) {
          // Force-move suppresses idle re-engage until unit arrives at destination
          if (unit._forceMove) return;
          const enemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);

          if (enemy) {
            const dist = Pathfinder.heuristic(unit.position, enemy.position);

            // Ranged kiting: flee from ANY melee enemy within kite trigger range (weapon range + 1)
            if (UnitAI.isRangedKiter(unit.type)) {
              const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, UnitAI.getKiteTriggerRange(unit));
              if (meleeThreat) {
                if (!unit._postPosition) {
                  unit._postPosition = { ...unit.position };
                }
                // If target is in weapon range, transition to ATTACKING — handleAttacking
                // will fire first THEN kite, preventing the no-fire kite loop
                if (dist <= unit.stats.range) {
                  unit.state = UnitState.ATTACKING;
                  unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
                  return;
                }
                const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
                if (fleeTile) {
                  CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
                  UnitAI.commandMove(unit, fleeTile, map);
                  unit._isKiting = true;
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

          // Siege: attack walls first, then buildings; non-siege: attack buildings while holding position
          if (unit.isSiege) {
            const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
            if (adjacentWall) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
              return;
            }
            const adjacentBuildingSiege = UnitAI.findAdjacentEnemyBuilding(unit, player.id);
            if (adjacentBuildingSiege) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentBuildingSiege } });
              return;
            }
          } else {
            const adjacentBuilding = UnitAI.findAdjacentEnemyBuilding(unit, player.id);
            if (adjacentBuilding) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentBuilding } });
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
            const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, UnitAI.getKiteTriggerRange(unit));
            if (meleeThreat) {
              // If target is in weapon range, transition to ATTACKING — handleAttacking
              // will fire first THEN kite, preventing the no-fire kite loop
              if (dist <= unit.stats.range) {
                unit.state = UnitState.ATTACKING;
                unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
                return;
              }
              const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
              if (fleeTile) {
                CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
                UnitAI.commandMove(unit, fleeTile, map);
                unit._isKiting = true;
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
          // Siege: attack adjacent enemy walls first, then buildings; non-siege: attack buildings only
          if (unit.isSiege) {
            const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
            if (adjacentWall) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
              return;
            }
            const adjacentBuildingSiege = UnitAI.findAdjacentEnemyBuilding(unit, player.id);
            if (adjacentBuildingSiege) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentBuildingSiege } });
              return;
            }
          } else {
            const adjacentBuilding = UnitAI.findAdjacentEnemyBuilding(unit, player.id);
            if (adjacentBuilding) {
              events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentBuilding } });
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

      // Zone control: AI squad units hold position ONLY at their squad's assigned target base.
      // They must be within 3 hex of the base that matches their squad objective — not any
      // random non-owned base they happen to be near (which was trapping them at spawn).
      if (unit._squadId != null && unit._playerCommanded && unit.command?.targetPosition &&
          (unit._squadObjective === 'CAPTURE' || unit._squadObjective === 'ASSAULT')) {
        const cmdTarget = unit.command.targetPosition;
        for (const base of UnitAI.bases) {
          if (base.destroyed || base.owner === unit.owner) continue;
          // Only hold if this base IS the squad's target (within 2 hex of command target)
          const isSquadTarget = Pathfinder.heuristic(base.position, cmdTarget) <= 2;
          if (!isSquadTarget) continue;
          const distToBase = Pathfinder.heuristic(unit.position, base.position);
          if (distToBase <= 3) {
            const zoneEnemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);
            if (zoneEnemy) {
              const eDist = Pathfinder.heuristic(unit.position, zoneEnemy.position);
              if (eDist <= unit.stats.range) {
                unit.state = UnitState.ATTACKING;
                unit.command = { type: CommandType.ATTACK, targetPosition: zoneEnemy.position, targetUnitId: zoneEnemy.id };
              } else if (eDist <= 3) {
                UnitAI.commandAttack(unit, zoneEnemy.position, zoneEnemy.id, map);
              }
            }
            return; // Hold zone — we're at our assigned capture target
          }
        }
      }

      const enemy = UnitAI.findBestTarget(unit, allUnits, player.id, detectionRange);

      if (enemy) {
        const dist = Pathfinder.heuristic(unit.position, enemy.position);

        // AI ranged kiters flee ANY melee threat nearby (not just current target)
        if (UnitAI.isRangedKiter(unit.type)) {
          const meleeThreat = UnitAI.findNearestMeleeThreat(unit, allUnits, UnitAI.getKiteTriggerRange(unit));
          if (meleeThreat) {
            // If target is in weapon range, transition to ATTACKING — handleAttacking
            // will fire first THEN kite, preventing the no-fire kite loop
            if (dist <= unit.stats.range) {
              unit.state = UnitState.ATTACKING;
              unit.command = { type: CommandType.ATTACK, targetPosition: enemy.position, targetUnitId: enemy.id };
              return;
            }
            const fleeTile = UnitAI.findKiteTile(unit, meleeThreat, map);
            if (fleeTile) {
              CombatLog.logKite(unit, meleeThreat, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
              UnitAI.commandMove(unit, fleeTile, map);
              unit._isKiting = true;
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

      // AI: siege attacks walls/buildings; non-siege attacks buildings only
      if (unit.isSiege) {
        const adjacentWall = UnitAI.findAdjacentEnemyWall(unit, player.id);
        if (adjacentWall) {
          events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentWall } });
          return;
        }
      } else {
        const adjacentBuilding = UnitAI.findAdjacentEnemyBuilding(unit, player.id);
        if (adjacentBuilding) {
          events.push({ type: 'unit:attack_wall', unit, result: { position: adjacentBuilding } });
          return;
        }
      }

      // All AI combat units are managed by the persistent squad system.
      // The squad commander (AIController) handles movement, objectives, and re-kicks.
      // Arena mode is the only exception — no squads, just charge.
      if (UnitAI.arenaMode) {
        const nearestEnemy = UnitAI.findNearestEnemy(unit, allUnits, player.id);
        if (nearestEnemy) {
          UnitAI.commandAttack(unit, nearestEnemy.position, nearestEnemy.id, map);
        }
        return;
      }
      // Squad commander will re-dispatch idle units toward their objective
    }
  }

  // --- Building: places wall blocks around the builder ---
  private static handleBuilding(unit: Unit, map: GameMap, delta: number, events: UnitEvent[]): void {
    unit.gatherCooldown -= delta;
    if (unit.gatherCooldown > 0) return;

    // Place a wall block at a nearby empty spot
    unit.gatherCooldown = GAME_CONFIG.combat.unitAI.builder.wallBuildCooldown; // Faster wall placement (was 2.5)

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

  // --- Constructing: builder works on a blueprint building ---
  private static handleConstructing(unit: Unit, delta: number, events: UnitEvent[], map?: GameMap): void {
    unit.gatherCooldown -= delta;
    if (unit.gatherCooldown > 0) return;

    // Find the building we're constructing
    const targetBuildingId = unit.command?.targetUnitId;
    if (!targetBuildingId) {
      unit.state = UnitState.IDLE;
      unit.command = null;
      return;
    }

    const building = UnitAI.placedBuildings.find(pb => pb.id === targetBuildingId);
    if (!building || !building.isBlueprint) {
      // Building complete or destroyed — immediately seek next blueprint
      Logger.debug('Builder', `${unit.id} construction target ${targetBuildingId} complete/gone, seeking next...`);
      unit._assignedBlueprintId = undefined;
      unit.command = null;

      // Try to chain directly to the next unfinished blueprint (skip idle frame)
      const nextBlueprint = UnitAI.findNearestBlueprint(unit);
      if (nextBlueprint) {
        nextBlueprint.assignedBuilderId = unit.id;
        unit._assignedBlueprintId = nextBlueprint.id; // Persist assignment so handleIdle Priority 0 catches it
        const d = Pathfinder.heuristic(unit.position, nextBlueprint.position);
        if (d <= 1) {
          unit.state = UnitState.CONSTRUCTING;
          unit.command = { type: CommandType.CONSTRUCT, targetPosition: nextBlueprint.position, targetUnitId: nextBlueprint.id };
          unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
          Logger.debug('Builder', `${unit.id} chained to adjacent blueprint ${nextBlueprint.id} (${nextBlueprint.kind})`);
        } else if (map) {
          unit.state = UnitState.IDLE;
          UnitAI.commandMove(unit, nextBlueprint.position, map);
          Logger.debug('Builder', `${unit.id} chained to distant blueprint ${nextBlueprint.id} (${nextBlueprint.kind}), moving...`);
        } else {
          unit.state = UnitState.IDLE;
        }
        return;
      }

      Logger.info('Builder', `${unit.id} no more blueprints found, going IDLE`);
      unit.state = UnitState.IDLE;
      return;
    }

    // Check we're still adjacent
    const dist = Pathfinder.heuristic(unit.position, building.position);
    if (dist > 1) {
      // Moved away — go back to idle and re-seek
      building.assignedBuilderId = null;
      unit.state = UnitState.IDLE;
      unit.command = null;
      return;
    }

    // Advance construction: ~8 seconds to build (progress per tick at interval)
    unit.gatherCooldown = GAME_CONFIG.gather.constructionCooldown;
    const CONSTRUCTION_RATE = GAME_CONFIG.gather.constructionRate;
    events.push({
      type: 'builder:construct_tick',
      unit,
      result: { buildingId: targetBuildingId, amount: CONSTRUCTION_RATE },
    } as any);
  }

  /** Find nearest unassigned blueprint building for this builder */
  private static findNearestBlueprint(unit: Unit): PlacedBuilding | null {
    let best: PlacedBuilding | null = null;
    let bestDist = Infinity;
    const buildings = UnitAI.placedBuildings;
    const failed = (unit as any)._failedBlueprintIds as Set<string> | undefined;
    let ownBlueprints = 0;
    let skippedAssigned = 0;
    let skippedFailed = 0;
    for (let i = 0, len = buildings.length; i < len; i++) {
      const pb = buildings[i];
      if (!pb.isBlueprint || pb.owner !== unit.owner) continue;
      ownBlueprints++;
      if (pb.assignedBuilderId && pb.assignedBuilderId !== unit.id) { skippedAssigned++; continue; }
      if (failed && failed.has(pb.id)) { skippedFailed++; continue; }
      const d = Math.abs(pb.position.q - unit.position.q) + Math.abs(pb.position.r - unit.position.r);
      if (d < bestDist || (d === bestDist && best && (pb.position.q < best.position.q || (pb.position.q === best.position.q && pb.position.r < best.position.r)))) {
        bestDist = d;
        best = pb;
      }
    }
    // Diagnostic: log when own blueprints exist but none are eligible
    if (!best && ownBlueprints > 0) {
      Logger.throttle(4 /* DEBUG */, 'Builder', 3000,
        `${unit.id} findNearestBlueprint: ${ownBlueprints} own blueprints, none eligible — ` +
        `skippedAssigned=${skippedAssigned} skippedFailed=${skippedFailed}`);
    }
    return best;
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

    // VILLAGER: harvest farm patch or tall grass — MULTI-HARVEST until carry full
    if (unit.type === UnitType.VILLAGER) {
      const tileKey = `${target.q},${target.r}`;
      const isFarm = UnitAI.farmPatches.has(tileKey);
      const isPlayerGrass = UnitAI.playerGrassBlueprint.has(tileKey);
      const isAutoGrass = UnitAI.grassTiles.has(tileKey);
      const isGrass = isPlayerGrass || isAutoGrass;

      if (isFarm || isGrass) {
        // Farm patches: only harvest when crops are mature (stage 3)
        if (isFarm) {
          const cropStage = UnitAI.cropStages.get(tileKey) ?? 0;
          if (cropStage < 3) {
            // Crops not ready — skip and go idle
            UnitAI.claimedFarms.delete(tileKey);
            unit.state = UnitState.IDLE;
            unit.command = null;
            return;
          }
        }

        // Calculate food yield — farm patches get bonus from nearby farmhouse
        let foodYield = isFarm ? GAME_CONFIG.economy.harvest.crops.foodYield : GAME_CONFIG.economy.harvest.grass.hayBase;
        if (isFarm) {
          const fhPos = UnitAI.farmhousePositions.get(unit.owner);
          if (fhPos) {
            const fhDist = Pathfinder.heuristic(target, fhPos);
            if (fhDist <= GAME_CONFIG.population.farmhouseRadius) {
              foodYield += GAME_CONFIG.population.farmhouseYieldBonus;
            }
          }
          // Reset crop to seedling after harvest — regrow cycle
          UnitAI.cropStages.set(tileKey, 0);
          UnitAI.cropTimers.set(tileKey, GAME_CONFIG.economy.harvest.crops.growTime ?? 8);
        }

        // Accumulate food (multi-harvest like lumberjack multi-chop)
        unit.carryAmount = Math.min((unit.carryAmount || 0) + foodYield, unit.carryCapacity);
        unit.carryType = ResourceType.FOOD;

        const eventType = isGrass ? 'villager:harvest_grass' : 'villager:harvest';
        events.push({
          type: eventType,
          unit,
          result: { position: target, resource: 'food' },
        });

        UnitAI.claimedFarms.delete(tileKey);
        if (isPlayerGrass) UnitAI.playerGrassBlueprint.delete(tileKey);

        // If carry not full, try to find another nearby harvest target (multi-harvest)
        if (unit.carryAmount < unit.carryCapacity) {
          const nextTarget = UnitAI.findNearbyHarvestTarget(unit, target, map, 2);
          if (nextTarget) {
            const nKey = `${nextTarget.q},${nextTarget.r}`;
            UnitAI.claimedFarms.set(nKey, unit.id);
            const nDist = Pathfinder.heuristic(unit.position, nextTarget);
            if (nDist <= 1) {
              // Adjacent — stay gathering with new target
              const nIsFarm = UnitAI.farmPatches.has(nKey);
              unit.command = { type: CommandType.GATHER, targetPosition: nextTarget, targetUnitId: null };
              unit.gatherCooldown = nIsFarm ? GAME_CONFIG.gather.villagerFarmCooldown : GAME_CONFIG.gather.villagerGrassCooldown;
              return;
            } else {
              // 2 hexes away — go idle, idle handler will pick it up
              unit.state = UnitState.IDLE;
              unit.command = null;
              return;
            }
          }
          // No more harvest targets nearby — fall through to return
        }

        // Carry full or no more targets — return to nearest drop-off
        if (UnitAI.debugFlags.disableAutoReturn) {
          unit.state = UnitState.IDLE;
          unit.command = null;
        } else {
          const returnPos = UnitAI.findNearestFoodDropOff(unit);
          if (returnPos) {
            unit.state = UnitState.RETURNING;
            UnitAI.commandMove(unit, returnPos, map);
            unit.state = UnitState.RETURNING;
          } else {
            unit.state = UnitState.IDLE;
            unit.command = null;
          }
        }
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
        unit.gatherCooldown = GAME_CONFIG.gather.builderMineCooldown;
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
            const offset = UnitAI.getStockpileOffset(unit.owner);
            const stockPos: HexCoord = {
              q: basePos.q + offset.q,
              r: basePos.r + offset.r,
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

    // LUMBERJACK: chop trees — multi-chop until carry is full, then return to nearest drop-off
    const tile = map.tiles.get(`${target.q},${target.r}`);

    if (tile && (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.JUNGLE)) {
      unit.gatherCooldown = GAME_CONFIG.gather.lumberjackChopCooldown;
      // Release claim since tree is being chopped
      UnitAI.releaseTreeClaim(unit.id);

      // Fire the chop event (main.ts removes tree, adds to unit.carryAmount)
      events.push({
        type: 'lumberjack:chop',
        unit,
        result: { position: target, resource: 'wood' },
      });

      // --- Multi-chop: if not full, find next adjacent tree and keep chopping ---
      if (unit.carryAmount < unit.carryCapacity) {
        // Look for another tree within 2 hexes
        const nearbyTree = UnitAI.findNearbyUnclaimedTree(unit, target, map, 2);
        if (nearbyTree) {
          const claimKey = `${nearbyTree.q},${nearbyTree.r}`;
          UnitAI.claimedTrees.set(claimKey, unit.id);
          const dist = Pathfinder.heuristic(unit.position, nearbyTree);
          if (dist <= 1) {
            // Adjacent tree — stay in gathering state, chop next
            unit.command = { type: CommandType.GATHER, targetPosition: nearbyTree, targetUnitId: null };
          } else {
            // Tree is 2 hexes away — go idle, idle handler will pick up this claimed tree
            unit.state = UnitState.IDLE;
            unit.command = null;
          }
          return;
        }
        // No nearby trees — fall through to return with partial load
      }

      // --- Return to nearest drop-off (forestry building > base stockpile) ---
      if (UnitAI.debugFlags.disableAutoReturn) {
        unit.state = UnitState.IDLE;
        unit.command = null;
      } else {
        const dropOff = UnitAI.findNearestDropOff(unit);
        if (dropOff) {
          unit.state = UnitState.RETURNING;
          UnitAI.commandMove(unit, dropOff, map);
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

      // Builder: immediately check for blueprints after depositing
      if (unit.type === UnitType.BUILDER) {
        const bp = UnitAI.findNearestBlueprint(unit);
        if (bp) {
          bp.assignedBuilderId = unit.id;
          unit._assignedBlueprintId = bp.id;
          const bpDist = Pathfinder.heuristic(unit.position, bp.position);
          if (bpDist <= 1) {
            unit.state = UnitState.CONSTRUCTING;
            unit.command = { type: CommandType.CONSTRUCT, targetPosition: bp.position, targetUnitId: bp.id };
            unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
            Logger.debug('Builder', `${unit.id} deposited(early) → blueprint ${bp.id} (${bp.kind}) adjacent, constructing`);
            return;
          } else {
            unit.state = UnitState.IDLE;
            unit.command = null;
            UnitAI.commandMove(unit, bp.position, map);
            Logger.debug('Builder', `${unit.id} deposited(early) → blueprint ${bp.id} (${bp.kind}) dist=${bpDist}, moving`);
            return;
          }
        }
      }

      unit.state = UnitState.IDLE;
      unit.command = null;
      return;
    }

    // Move toward stockpile (same movement logic as handleMoving)
    const targetWorld = UnitAI.hexToWorld(unit.targetPosition, map, unit._underground);
    const dx = targetWorld.x - unit.worldPosition.x;
    const dz = targetWorld.z - unit.worldPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) {
      // Arrived at next waypoint
      unit.position = { ...unit.targetPosition };
      unit.worldPosition.x = targetWorld.x;
      unit.worldPosition.z = targetWorld.z;
      unit.worldPosition.y = targetWorld.y;
      UnitAI.quantizePosition(unit);

      const path = unit._path as HexCoord[] | null;
      const pathIndex = (unit._pathIndex ?? 0) || 0;

      if (path && pathIndex < path.length - 1) {
        const nextWp = path[pathIndex + 1];
        const nextKey = `${nextWp.q},${nextWp.r}`;
        // If a wall was built on the next waypoint, re-path around it
        if (Pathfinder.blockedTiles.has(nextKey)) {
          const finalGoal = path[path.length - 1];
          const newPath = Pathfinder.findPath(unit.position, finalGoal, map, unit.type === UnitType.LUMBERJACK, unit.owner, unit.type === UnitType.BUILDER);
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

        // Builder just deposited: immediately check for blueprints instead of
        // going to IDLE first (prevents auto-mine from intercepting)
        if (unit.type === UnitType.BUILDER) {
          const bp = UnitAI.findNearestBlueprint(unit);
          if (bp) {
            bp.assignedBuilderId = unit.id;
            unit._assignedBlueprintId = bp.id;
            const bpDist = Pathfinder.heuristic(unit.position, bp.position);
            if (bpDist <= 1) {
              unit.state = UnitState.CONSTRUCTING;
              unit.command = { type: CommandType.CONSTRUCT, targetPosition: bp.position, targetUnitId: bp.id };
              unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
              unit._path = null;
              Logger.debug('Builder', `${unit.id} deposited → found adjacent blueprint ${bp.id} (${bp.kind}), constructing`);
              return;
            } else {
              unit.state = UnitState.IDLE;
              unit.command = null;
              unit._path = null;
              UnitAI.commandMove(unit, bp.position, map);
              Logger.debug('Builder', `${unit.id} deposited → found blueprint ${bp.id} (${bp.kind}) dist=${bpDist}, moving to it`);
              return;
            }
          }
        }

        unit.state = UnitState.IDLE;
        unit.command = null;
        unit._path = null;
      }
    } else {
      const moraleMod = UnitAI.moraleModifiers[unit.owner] ?? 1.0;
      let speed = unit.moveSpeed * moraleMod * delta;
      // Apply cleanse speed boost
      const clSpeedMult = StatusEffectSystem.getSpeedMultiplier(unit);
      if (clSpeedMult > 1.0) speed *= clSpeedMult;
      const moveX = (dx / dist) * Math.min(speed, dist);
      const moveZ = (dz / dist) * Math.min(speed, dist);
      unit.worldPosition.x += moveX;
      unit.worldPosition.z += moveZ;
      if (unit._underground) {
        unit.worldPosition.y = targetWorld.y;
      } else {
        // Stepped voxel Y movement (same logic as handleMoving)
        const hexProgress = 1 - Math.min(dist / 1.5, 1);
        const STEP_THRESHOLD = 0.65;
        const elevDiff = targetWorld.y - unit.worldPosition.y;
        if (Math.abs(elevDiff) < 0.05) {
          unit.worldPosition.y = targetWorld.y;
          unit._elevActive = false;
          unit._elevProgress = 0;
        } else if (hexProgress < STEP_THRESHOLD) {
          const curTile = map?.tiles.get(`${unit.position.q},${unit.position.r}`);
          if (curTile) {
            const floorY = curTile.elevation * 0.5 + 0.25;
            if (unit.worldPosition.y < floorY - 0.02) unit.worldPosition.y = floorY;
          }
          unit._elevActive = false;
          unit._elevProgress = 0;
        } else {
          const blendT = (hexProgress - STEP_THRESHOLD) / (1 - STEP_THRESHOLD);
          const smooth = blendT * blendT * (3 - 2 * blendT);
          const curTile = map?.tiles.get(`${unit.position.q},${unit.position.r}`);
          const sourceY = curTile ? curTile.elevation * 0.5 + 0.25 : unit.worldPosition.y;
          unit.worldPosition.y = sourceY + (targetWorld.y - sourceY) * smooth;
          unit._elevActive = true;
          unit._elevGoingUp = elevDiff > 0;
          unit._elevProgress = blendT;
        }
      }
      // Quantize worldPosition to prevent cross-browser float drift
      UnitAI.quantizePosition(unit);
    }
  }

  /**
   * Wall building system:
   * - Player (owner 0): uses a blueprint queue set by the player clicking tiles
   * - AI (owner 1): uses an auto-generated keep plan
   */
  private static keepWallPlans: Map<number, HexCoord[]> = new Map();
  private static keepGatePlans: Map<number, HexCoord[]> = new Map();

  static get arenaMode() { return UnitAI.state.arenaMode; }
  static set arenaMode(v) { UnitAI.state.arenaMode = v; }
  static get basePositions() { return UnitAI.state.basePositions; }
  static get mapWidth() { return UnitAI.state.mapWidth; }
  static set mapWidth(v) { UnitAI.state.mapWidth = v; }
  static get mapHeight() { return UnitAI.state.mapHeight; }
  static set mapHeight(v) { UnitAI.state.mapHeight = v; }

  /** Get stockpile offset from base toward map center (for resource drop-off) */
  static getStockpileOffset(owner: number): HexCoord {
    const basePos = UnitAI.basePositions.get(owner);
    if (!basePos) return { q: 0, r: 0 };
    const centerQ = Math.floor(UnitAI.mapWidth / 2);
    const centerR = Math.floor(UnitAI.mapHeight / 2);
    const dq = Math.sign(centerQ - basePos.q) || 1;
    const dr = Math.sign(centerR - basePos.r);
    return { q: dq * 2, r: dr };
  }

  static get barracksPositions() { return UnitAI.state.barracksPositions; }
  static get playerWallBlueprint() { return UnitAI.state.playerWallBlueprint; }
  static get playerGateBlueprint() { return UnitAI.state.playerGateBlueprint; }

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

  static get playerHarvestBlueprint() { return UnitAI.state.playerHarvestBlueprint; }

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
    UnitAI.cropStages.clear();
    UnitAI.cropTimers.clear();
    UnitAI.playerMineBlueprint = new Map();
    UnitAI.claimedMines.clear();
    UnitAI.grassTiles.clear();
    UnitAI.mineOwners.clear();
    UnitAI.wallBlueprintOwners.clear();
    UnitAI.harvestOwners.clear();
  }

  static get playerMineBlueprint() { return UnitAI.state.playerMineBlueprint; }
  static set playerMineBlueprint(v) { UnitAI.state.playerMineBlueprint = v; }
  static get claimedMines() { return UnitAI.state.claimedMines; }
  static get mineOwners() { return UnitAI.state.mineOwners; }
  static get wallBlueprintOwners() { return UnitAI.state.wallBlueprintOwners; }
  static get harvestOwners() { return UnitAI.state.harvestOwners; }

  /** Check if a mine blueprint is fully excavated (no blocks remain in the Y range) */
  static isMineComplete(key: string, tile: { voxelData: { blocks: { localPosition: { y: number } }[] } }): boolean {
    const target = UnitAI.playerMineBlueprint.get(key);
    if (!target) return true;
    const bottomY = target.startY - target.depth + 1;
    const hasBlocks = tile.voxelData.blocks.some(
      b => b.localPosition.y >= bottomY && b.localPosition.y <= target.startY
    );
    return !hasBlocks;
  }

  /** Get the mine target info for a tile */
  static getMineTarget(key: string): MineTarget | undefined {
    return UnitAI.playerMineBlueprint.get(key);
  }

  /** Find nearest minable tile from the player's mine blueprint */
  static findNearestMineBlueprint(unit: Unit, map: GameMap): HexCoord | null {
    let nearest: HexCoord | null = null;
    let nearestDist = Infinity;

    for (const [key, target] of UnitAI.playerMineBlueprint) {
      // Skip blueprints owned by a different player
      const bpOwner = UnitAI.mineOwners.get(key);
      if (bpOwner !== undefined && bpOwner !== unit.owner) continue;

      const tile = map.tiles.get(key);
      if (!tile || tile.terrain === TerrainType.WATER || tile.elevation <= -39) {
        UnitAI.playerMineBlueprint.delete(key);
        UnitAI.mineOwners.delete(key);
        continue;
      }
      // Skip if no blocks remain in the mine's Y range
      const bottomY = target.startY - target.depth + 1;
      const hasBlocks = tile.voxelData.blocks.some(
        b => b.localPosition.y >= bottomY && b.localPosition.y <= target.startY
      );
      if (!hasBlocks) {
        UnitAI.playerMineBlueprint.delete(key);
        UnitAI.mineOwners.delete(key);
        continue;
      }
      // Skip tiles claimed by other workers
      const claimer = UnitAI.claimedMines.get(key);
      if (claimer && claimer !== unit.id) continue;

      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(coord, nearest))) {
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
    // In AI vs AI mode both players are AI, so check the players map
    const ownerPlayer = UnitAI.players?.get(owner);
    if (ownerPlayer && !ownerPlayer.isAI) return;

    // Scan from near the base out to just past the map midpoint
    // to find the tightest choke point in mountain passes through ridges
    const centerQ = Math.floor(map.width / 2);
    const dir = basePos.q < centerQ ? 1 : -1;  // Scan toward map center (toward enemy territory)
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
    plan.sort((a, b) => Math.abs(a.r - centerR) - Math.abs(b.r - centerR) || a.q - b.q || a.r - b.r);

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
    const ownerPlayer = UnitAI.players.get(unit.owner);
    if (ownerPlayer && !ownerPlayer.isAI) {
      // Human player builders: use the player's blueprint queue
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
      // Skip blueprints owned by a different player
      const bpOwner = UnitAI.wallBlueprintOwners.get(key);
      if (bpOwner !== undefined && bpOwner !== unit.owner) continue;

      // Skip if already built
      if (Pathfinder.blockedTiles.has(key)) {
        UnitAI.playerWallBlueprint.delete(key);
        UnitAI.wallBlueprintOwners.delete(key);
        continue;
      }
      const [q, r] = key.split(',').map(Number);
      const tile = map.tiles.get(key);
      if (!tile || !UnitAI.isValidWallTile(tile, key, map)) {
        UnitAI.playerWallBlueprint.delete(key);
        UnitAI.wallBlueprintOwners.delete(key);
        continue;
      }
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(coord, nearest))) {
        nearestDist = dist;
        nearest = coord;
      }
    }

    for (const key of UnitAI.playerGateBlueprint) {
      // Skip blueprints owned by a different player
      const bpOwner = UnitAI.wallBlueprintOwners.get(key);
      if (bpOwner !== undefined && bpOwner !== unit.owner) continue;

      // Skip if already built
      if (Pathfinder.blockedTiles.has(key)) {
        UnitAI.playerGateBlueprint.delete(key);
        UnitAI.wallBlueprintOwners.delete(key);
        continue;
      }
      const [q, r] = key.split(',').map(Number);
      const tile = map.tiles.get(key);
      if (!tile || !UnitAI.isValidWallTile(tile, key, map)) {
        UnitAI.playerGateBlueprint.delete(key);
        UnitAI.wallBlueprintOwners.delete(key);
        continue;
      }
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(coord, nearest))) {
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
      // Skip blueprints owned by a different player
      const bpOwner = UnitAI.harvestOwners.get(key);
      if (bpOwner !== undefined && bpOwner !== unit.owner) continue;

      const tile = map.tiles.get(key);
      if (!tile || (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE)) {
        UnitAI.playerHarvestBlueprint.delete(key);
        UnitAI.harvestOwners.delete(key);
        continue;
      }
      // Skip trees claimed by other lumberjacks
      const claimer = UnitAI.claimedTrees.get(key);
      if (claimer && claimer !== unit.id) continue;

      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(coord, nearest))) {
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
        if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(spot, nearest))) {
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
          if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(spot, nearest))) {
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
      if (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE) return;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(unit.position, coord);
      if (dist < nearestDist || (dist === nearestDist && UnitAI.tieBreak(coord, nearest))) {
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
      if (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE) return;
      // Skip trees claimed by other lumberjacks
      const claimer = UnitAI.claimedTrees.get(key);
      if (claimer && claimer !== unit.id) return;
      // Skip tiles we already failed to path to recently
      if (UnitAI.isUnreachable(unit.id, key)) return;

      const [q, r] = key.split(',').map(Number);
      // Allow lumberjacks to reach up to 70% of map width from their base
      const maxReach = Math.floor(map.width * 0.7);
      const distFromBase = Pathfinder.heuristic(basePos, { q, r });
      if (distFromBase > maxReach) return;
      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      const unitDist = Pathfinder.heuristic(unit.position, coord);
      // Worker spread: PENALIZE trees near other friendly lumberjacks
      // so workers fan out across available forest instead of clustering
      let crowdPenalty = 0;
      const allU = UnitAI._allUnitsCache;
      for (let bi = 0, blen = allU.length; bi < blen; bi++) {
        const buddy = allU[bi];
        if (buddy === unit || buddy.owner !== unit.owner || buddy.type !== UnitType.LUMBERJACK) continue;
        if (buddy.state === UnitState.DEAD) continue;
        const bDist = Pathfinder.heuristic(buddy.position, coord);
        if (bDist <= 3) crowdPenalty += 4;       // Strong push away from nearby workers
        else if (bDist <= 6) crowdPenalty += 1.5; // Mild push for medium distance
      }
      // Weight: proximity to unit first, moderate base pull, avoid crowds
      const score = baseDist * 1.0 + unitDist * 1.5 + crowdPenalty;
      if (score < bestScore || (score === bestScore && UnitAI.tieBreak(coord, best))) {
        bestScore = score;
        best = coord;
      }
    });

    // Fallback to any forest if nothing on own side
    return best ?? UnitAI.findNearestForest(unit, map);
  }

  /**
   * Find an unclaimed tree within `radius` hexes of a position.
   * Used by multi-chop to find the next tree without going back to idle.
   */
  private static findNearbyUnclaimedTree(unit: Unit, origin: HexCoord, map: GameMap, radius: number): HexCoord | null {
    let best: HexCoord | null = null;
    let bestDist = Infinity;
    map.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE) return;
      const claimer = UnitAI.claimedTrees.get(key);
      if (claimer && claimer !== unit.id) return;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(origin, coord);
      if (dist <= radius && (dist < bestDist || (dist === bestDist && UnitAI.tieBreak(coord, best)))) {
        bestDist = dist;
        best = coord;
      }
    });
    return best;
  }

  /**
   * Find the nearest wood drop-off point for a lumberjack:
   * 1. Nearest forestry building owned by same player
   * 2. Fallback: base stockpile position
   */
  private static findNearestDropOff(unit: Unit): HexCoord | null {
    const basePos = UnitAI.basePositions.get(unit.owner);
    // Offset stockpile drop-off location: player 0 → -2q, player 1 → +2q, others → based on modulo
    const stockPos = basePos ? {
      q: basePos.q + (unit.owner % 2 === 0 ? -2 : 2),
      r: basePos.r,
    } : null;

    // Check forestry buildings
    const forestries = UnitAI.forestryPositions.get(unit.owner);
    if (forestries && forestries.length > 0) {
      let nearest: HexCoord | null = null;
      let nearestDist = stockPos ? Pathfinder.heuristic(unit.position, stockPos) : Infinity;
      for (const fp of forestries) {
        const d = Pathfinder.heuristic(unit.position, fp);
        if (d < nearestDist || (d === nearestDist && UnitAI.tieBreak(fp, nearest))) {
          nearestDist = d;
          nearest = fp;
        }
      }
      if (nearest) return nearest;
    }

    return stockPos;
  }

  /**
   * Find nearest harvestable tile (farm or grass) within radius of origin.
   * Used for villager multi-harvest — find next crop after harvesting current one.
   */
  private static findNearbyHarvestTarget(unit: Unit, origin: HexCoord, map: GameMap, radius: number): HexCoord | null {
    let best: HexCoord | null = null;
    let bestDist = Infinity;

    // Check farm patches
    for (const key of UnitAI.farmPatches) {
      const claimer = UnitAI.claimedFarms.get(key);
      if (claimer && claimer !== unit.id) continue;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(origin, coord);
      if (dist <= radius && (dist < bestDist || (dist === bestDist && UnitAI.tieBreak(coord, best)))) {
        bestDist = dist;
        best = coord;
      }
    }

    // Check player grass blueprints
    for (const key of UnitAI.playerGrassBlueprint) {
      const claimer = UnitAI.claimedFarms.get(key);
      if (claimer && claimer !== unit.id) continue;
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain !== TerrainType.PLAINS) continue;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(origin, coord);
      if (dist <= radius && (dist < bestDist || (dist === bestDist && UnitAI.tieBreak(coord, best)))) {
        bestDist = dist;
        best = coord;
      }
    }

    // Check auto-harvestable grass
    for (const key of UnitAI.grassTiles) {
      const claimer = UnitAI.claimedFarms.get(key);
      if (claimer && claimer !== unit.id) continue;
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain !== TerrainType.PLAINS) continue;
      const [q, r] = key.split(',').map(Number);
      const coord = { q, r };
      const dist = Pathfinder.heuristic(origin, coord);
      if (dist <= radius && (dist < bestDist || (dist === bestDist && UnitAI.tieBreak(coord, best)))) {
        bestDist = dist;
        best = { q, r };
      }
    }

    return best;
  }

  /**
   * Find nearest food drop-off point for villagers.
   * Priority: 1. Farmhouse  2. Silo  3. Base stockpile
   */
  private static findNearestFoodDropOff(unit: Unit): HexCoord | null {
    const basePos = UnitAI.basePositions.get(unit.owner);
    // Offset stockpile drop-off location: player 0 → -2q, player 1 → +2q, others → based on modulo
    const stockPos = basePos ? {
      q: basePos.q + (unit.owner % 2 === 0 ? -2 : 2),
      r: basePos.r,
    } : null;

    let nearest: HexCoord | null = stockPos;
    let nearestDist = stockPos ? Pathfinder.heuristic(unit.position, stockPos) : Infinity;

    // Check farmhouse
    const fhPos = UnitAI.farmhousePositions.get(unit.owner);
    if (fhPos) {
      const d = Pathfinder.heuristic(unit.position, fhPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fhPos;
      }
    }

    // Check silo
    const siloPos = UnitAI.siloPositions.get(unit.owner);
    if (siloPos) {
      const d = Pathfinder.heuristic(unit.position, siloPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = siloPos;
      }
    }

    return nearest;
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
    // Fallback: best grass ignoring min-distance filter (used if all grass is near base)
    let bestClose: HexCoord | null = null;
    let bestCloseScore = Infinity;
    const midQ = Math.floor(map.width / 2);
    const basePos = UnitAI.basePositions.get(unit.owner);
    if (!basePos) return null;

    // Get silo/return position — grass too close to it causes stuck-at-base loops
    // where the villager harvests without moving, returns without moving, repeat
    const siloPos = UnitAI.siloPositions.get(unit.owner) ?? basePos;
    const MIN_DIST_FROM_RETURN = 2; // Must be at least 2 hexes from silo/base

    for (const key of UnitAI.grassTiles) {
      const tile = map.tiles.get(key);
      if (!tile || tile.terrain !== TerrainType.PLAINS) continue;

      // Skip grass claimed by other villagers
      const claimer = UnitAI.claimedFarms.get(key);
      if (claimer && claimer !== unit.id) continue;
      // Skip tiles we already failed to path to recently
      if (UnitAI.isUnreachable(unit.id, key)) continue;

      const [q, r] = key.split(',').map(Number);
      // Only look at grass reasonably close to own base
      const distFromBase = Pathfinder.heuristic(basePos, { q, r });
      if (distFromBase > Math.floor(map.width * 0.5) + 2) continue;

      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      const unitDist = Pathfinder.heuristic(unit.position, coord);

      // Skip grass too close to the return point (base/silo) —
      // villagers would harvest in place and never venture outward
      const returnDist = Pathfinder.heuristic(siloPos, coord);
      if (returnDist < MIN_DIST_FROM_RETURN) {
        // Track as close fallback in case no distant grass exists
        const closeScore = baseDist * 2 + unitDist;
        if (closeScore < bestCloseScore || (closeScore === bestCloseScore && UnitAI.tieBreak(coord, bestClose))) {
          bestCloseScore = closeScore;
          bestClose = coord;
        }
        continue;
      }

      // Worker clustering: prefer tiles near other friendly villagers
      let buddyBonus = 0;
      const allU = UnitAI._allUnitsCache;
      for (let bi = 0, blen = allU.length; bi < blen; bi++) {
        const buddy = allU[bi];
        if (buddy === unit || buddy.owner !== unit.owner || buddy.type !== UnitType.VILLAGER) continue;
        if (buddy.state === UnitState.DEAD) continue;
        const bDist = Pathfinder.heuristic(buddy.position, coord);
        if (bDist <= 4) buddyBonus -= 3;
      }
      // Weight proximity to base so villagers harvest nearby grass first
      const score = baseDist * 2 + unitDist + buddyBonus;
      if (score < bestScore || (score === bestScore && UnitAI.tieBreak(coord, best))) {
        bestScore = score;
        best = coord;
      }
    }

    // Fallback: if all grass is near the silo/base, allow harvesting close grass
    // rather than leaving villagers completely idle
    return best ?? bestClose;
  }

  /** If a villager/builder is stuck near a base with no work, try to move it outward to open ground */
  private static tryEscapeBaseArea(unit: Unit, map: GameMap): void {
    // Find the nearest friendly base
    let nearestBase: HexCoord | null = null;
    let nearestBaseDist = Infinity;
    for (const base of UnitAI.bases) {
      if (base.destroyed) continue;
      if (base.owner !== unit.owner) continue;
      const d = Pathfinder.heuristic(unit.position, base.position);
      if (d < nearestBaseDist) {
        nearestBaseDist = d;
        nearestBase = base.position;
      }
    }
    // Only escape if within 3 tiles of a base
    if (!nearestBase || nearestBaseDist > 3) return;

    // Try to move outward from the base — check tiles at radius 4-6 from base
    let bestTile: HexCoord | null = null;
    let bestDist = Infinity;
    for (let radius = 4; radius <= 7; radius++) {
      for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.abs(dq) + Math.abs(dr) < radius) continue; // only check the ring
          const q = nearestBase.q + dq;
          const r = nearestBase.r + dr;
          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (!tile) continue;
          if (tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.FOREST
            || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.RIVER
            || tile.terrain === TerrainType.LAKE) continue;
          if (Pathfinder.blockedTiles.has(key)) continue;
          const d = Pathfinder.heuristic(unit.position, { q, r });
          if (d < bestDist) {
            bestDist = d;
            bestTile = { q, r };
          }
        }
      }
      if (bestTile) break; // found a tile at this radius, don't go further
    }
    if (bestTile) {
      UnitAI.commandMove(unit, bestTile, map);
    }
  }

  /** Determine what resource the AI needs most right now.
   *  Returns a priority-ordered list of resource targets for mining. */
  private static getAIMiningPriorities(owner: number): { resource: string; urgency: number }[] {
    const priorities: { resource: string; urgency: number }[] = [];

    const stone = UnitAI.stoneStockpile[owner];
    const iron = UnitAI.ironStockpile[owner];
    const clay = UnitAI.clayStockpile[owner];
    const crystal = UnitAI.crystalStockpile[owner];
    const charcoal = UnitAI.charcoalStockpile[owner];
    const steel = UnitAI.steelStockpile[owner];
    const gold = UnitAI.goldStockpile[owner];

    // Crystal: needed for wizard tower (3) and mage units (1 each)
    // High priority if we have none and need it for buildings/units
    if (crystal < GAME_CONFIG.combat.unitAI.miningPriorities.crystal.threshold) {
      priorities.push({
        resource: 'crystal',
        urgency: crystal < GAME_CONFIG.combat.unitAI.miningPriorities.crystal.criticalThreshold
          ? GAME_CONFIG.combat.unitAI.miningPriorities.crystal.criticalUrgency
          : GAME_CONFIG.combat.unitAI.miningPriorities.crystal.urgency,
      });
    }

    // Iron: needed for steel (2 iron + 1 charcoal → 1 steel)
    // Steel needed for armory (3), armored units (1 each)
    if (iron < GAME_CONFIG.combat.unitAI.miningPriorities.iron.threshold
        && steel < GAME_CONFIG.combat.unitAI.miningPriorities.steelDependencyThreshold) {
      priorities.push({
        resource: 'iron',
        urgency: iron < GAME_CONFIG.combat.unitAI.miningPriorities.iron.criticalThreshold
          ? GAME_CONFIG.combat.unitAI.miningPriorities.iron.criticalUrgency
          : GAME_CONFIG.combat.unitAI.miningPriorities.iron.urgency,
      });
    }

    // Gold: needed for training combat units (5-12g each)
    // Moderate priority — combat units are gold-hungry
    if (gold < GAME_CONFIG.combat.unitAI.miningPriorities.gold.threshold) {
      priorities.push({
        resource: 'gold',
        urgency: gold < GAME_CONFIG.combat.unitAI.miningPriorities.gold.criticalThreshold
          ? GAME_CONFIG.combat.unitAI.miningPriorities.gold.criticalUrgency
          : GAME_CONFIG.combat.unitAI.miningPriorities.gold.urgency,
      });
    }

    // Clay: needed for charcoal (3 wood + 2 clay → 2 charcoal)
    // Charcoal needed for steel smelting
    if (clay < GAME_CONFIG.combat.unitAI.miningPriorities.clay.threshold
        && charcoal < GAME_CONFIG.combat.unitAI.miningPriorities.charcoalDependencyThreshold) {
      priorities.push({
        resource: 'clay',
        urgency: clay < GAME_CONFIG.combat.unitAI.miningPriorities.clay.criticalThreshold
          ? GAME_CONFIG.combat.unitAI.miningPriorities.clay.criticalUrgency
          : GAME_CONFIG.combat.unitAI.miningPriorities.clay.urgency,
      });
    }

    // Stone: always useful — walls, buildings, general construction
    if (stone < GAME_CONFIG.combat.unitAI.miningPriorities.stone.threshold) {
      priorities.push({
        resource: 'stone',
        urgency: stone < GAME_CONFIG.combat.unitAI.miningPriorities.stone.criticalThreshold
          ? GAME_CONFIG.combat.unitAI.miningPriorities.stone.criticalUrgency
          : GAME_CONFIG.combat.unitAI.miningPriorities.stone.urgency,
      });
    }

    // Default: always mine stone as fallback
    if (priorities.length === 0) {
      priorities.push({
        resource: 'stone',
        urgency: GAME_CONFIG.combat.unitAI.miningPriorities.stone.fallbackUrgency,
      });
    }

    // Sort by urgency descending
    priorities.sort((a, b) => b.urgency - a.urgency || a.resource.localeCompare(b.resource));
    return priorities;
  }

  /** Find best mine site for AI builders — resource-aware strategy.
   *  Considers what the AI needs (iron, crystal, clay, stone) and searches
   *  appropriate terrain types with expanded range for rare resources. */
  private static findNearestMineSite(unit: Unit, map: GameMap): HexCoord | null {
    const basePos = UnitAI.basePositions.get(unit.owner);
    if (!basePos) return null;

    const midQ = Math.floor(map.width / 2);
    const priorities = UnitAI.getAIMiningPriorities(unit.owner);

    const MIN_MINE_RANGE = GAME_CONFIG.combat.unitAI.miningSearch.minBaseDistance; // Don't mine right under the base
    // Expand search range for rare resources — crystal/iron may be far away
    const MAX_MINE_RANGE_STONE = GAME_CONFIG.combat.unitAI.miningSearch.maxRangeStone;
    const MAX_MINE_RANGE_RARE = GAME_CONFIG.combat.unitAI.miningSearch.maxRangeRare; // Iron, crystal, clay can be further

    let best: HexCoord | null = null;
    let bestScore = Infinity;

    // Track top candidates for desync diagnostics
    const _mineDiag: Array<{key: string; score: number; res: string}> = [];
    map.tiles.forEach((tile, key) => {
      // Skip water, forest, and bedrock
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.RIVER
          || tile.terrain === TerrainType.LAKE || tile.terrain === TerrainType.WATERFALL
          || tile.terrain === TerrainType.FOREST) return;
      if (tile.elevation <= -39) return; // Bedrock
      if (tile.voxelData.blocks.length === 0) return; // Empty tile

      // Skip tiles claimed by other builders
      const claimer = UnitAI.claimedMines.get(key);
      if (claimer && claimer !== unit.id) return;
      if (UnitAI.isUnreachable(unit.id, key)) return;

      const [q, r] = key.split(',').map(Number);
      // Allow mining up to a generous distance from own base — rare resources may be far away.
      const maxReach = Math.floor(map.width * GAME_CONFIG.combat.unitAI.miningSearch.maxReachFactor);
      const distFromBase = Pathfinder.heuristic(basePos, { q, r });
      if (distFromBase > maxReach) return;

      const coord = { q, r };
      const baseDist = Pathfinder.heuristic(basePos, coord);
      if (baseDist < MIN_MINE_RANGE) return;

      const unitDist = Pathfinder.heuristic(unit.position, coord);

      // Classify what this tile yields — check gem blocks in tunnels, tile.resource, then terrain
      let tileResource = 'stone'; // default

      // Check actual block types for high-value resources
      const hasGemBlock = tile.voxelData.blocks.some(b =>
        b.type === BlockType.GEM_RUBY || b.type === BlockType.GEM_EMERALD ||
        b.type === BlockType.GEM_SAPPHIRE || b.type === BlockType.GEM_AMETHYST
      );
      const hasIronBlock = tile.voxelData.blocks.some(b => b.type === BlockType.IRON);
      const hasGoldBlock = tile.voxelData.blocks.some(b => b.type === BlockType.GOLD);
      if (hasGemBlock) {
        tileResource = 'crystal';
      } else if (hasIronBlock) {
        tileResource = 'iron';
      } else if (hasGoldBlock) {
        tileResource = 'gold';
      } else if (tile.resource === ResourceType.CRYSTAL) {
        tileResource = 'crystal';
      } else if (tile.resource === ResourceType.IRON) {
        tileResource = 'iron';
      } else if (tile.resource === ResourceType.GOLD) {
        tileResource = 'gold';
      } else if (tile.resource === ResourceType.CLAY) {
        tileResource = 'clay';
      } else if (tile.terrain === TerrainType.MOUNTAIN) {
        // Any mountain terrain has iron potential (plateaus, mesas, peaks)
        tileResource = 'iron';
      } else if (tile.terrain === TerrainType.DESERT) {
        // Desert sand yields clay when mined
        tileResource = 'clay';
      }

      // Apply range limits: stone is close, rare resources can be further
      const maxRange = tileResource === 'stone' ? MAX_MINE_RANGE_STONE : MAX_MINE_RANGE_RARE;
      if (baseDist > maxRange) return;

      // Score this tile based on how urgently we need its resource
      let resourceBonus = 0;
      let matched = false;
      for (const p of priorities) {
        if (p.resource === tileResource) {
          resourceBonus = -p.urgency; // Negative = better score
          matched = true;
          break;
        }
      }
      // Small bonus for tiles that match ANY need (even low priority)
      if (!matched) resourceBonus = 2;

      // Quarry clustering: prefer tiles near active mines
      let clusterBonus = 0;
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (UnitAI.claimedMines.has(nKey)) clusterBonus += GAME_CONFIG.combat.unitAI.miningSearch.clusterClaimBonus;
        const nTile = map.tiles.get(nKey);
        if (nTile && nTile.elevation <= -1) clusterBonus += GAME_CONFIG.combat.unitAI.miningSearch.clusterCaveBonus;
      }

      // Worker clustering: prefer tiles near other friendly builders
      let buddyBonus = 0;
      const allU = UnitAI._allUnitsCache;
      for (let bi = 0, blen = allU.length; bi < blen; bi++) {
        const buddy = allU[bi];
        if (buddy === unit || buddy.owner !== unit.owner || buddy.type !== UnitType.BUILDER) continue;
        if (buddy.state === UnitState.DEAD) continue;
        const bDist = Pathfinder.heuristic(buddy.position, coord);
        if (bDist <= GAME_CONFIG.combat.unitAI.miningSearch.buddyDistance) {
          buddyBonus += GAME_CONFIG.combat.unitAI.miningSearch.buddyBonus;
        }
      }

      // Distance scoring: closer to unit is better, ideal 6-8 from base
      const idealDist = tileResource === 'stone'
        ? GAME_CONFIG.combat.unitAI.miningSearch.idealBaseDistanceStone
        : GAME_CONFIG.combat.unitAI.miningSearch.idealBaseDistanceRare;
      const distPenalty = Math.abs(baseDist - idealDist) * GAME_CONFIG.combat.unitAI.miningSearch.baseDistancePenaltyFactor;
      const travelPenalty = unitDist * GAME_CONFIG.combat.unitAI.miningSearch.travelPenaltyFactor;

      const score = distPenalty + travelPenalty + resourceBonus + clusterBonus + buddyBonus;
      // Track top 3 candidates for desync diagnostics
      if (_mineDiag.length < 3 || score < _mineDiag[_mineDiag.length - 1].score) {
        _mineDiag.push({key, score, res: tileResource});
        _mineDiag.sort((a, b) => a.score - b.score);
        if (_mineDiag.length > 3) _mineDiag.length = 3;
      }
      if (score < bestScore || (score === bestScore && UnitAI.tieBreak(coord, best))) {
        bestScore = score;
        best = coord;
      }
    });

    // Log mine selection for desync diagnostics (builders only, throttled)
    const chosen = best as HexCoord | null;
    if (chosen && unit.type === UnitType.BUILDER) {
      const gf = UnitAI.gameFrame;
      if (!(unit as any)._lastMineSelLog || gf - (unit as any)._lastMineSelLog > 100) {
        (unit as any)._lastMineSelLog = gf;
        const top = _mineDiag.map(d => `${d.key}(${d.res}:${d.score.toFixed(2)})`).join(', ');
        console.log(`[MineSel] ${unit.id} @${unit.position.q},${unit.position.r} → ${chosen.q},${chosen.r} score=${bestScore.toFixed(2)} top=[${top}]`);
      }
    }
    return best;
  }

  private static handleMoving(unit: Unit, allUnits: Unit[], map: GameMap, delta: number, events: UnitEvent[]): void {
    if (!unit.targetPosition) {
      unit._isKiting = false;

      // Builder arrived at destination: if assigned to a blueprint, try to start constructing immediately
      // (skip the IDLE → handleIdle round-trip that can cause the builder to wander off to auto-mine)
      if (unit.type === UnitType.BUILDER && unit._assignedBlueprintId) {
        const assigned = UnitAI.placedBuildings.find(pb => pb.id === unit._assignedBlueprintId);
        if (assigned && assigned.isBlueprint) {
          const dist = Pathfinder.heuristic(unit.position, assigned.position);
          if (dist <= 1) {
            assigned.assignedBuilderId = unit.id;
            unit.state = UnitState.CONSTRUCTING;
            unit.command = { type: CommandType.CONSTRUCT, targetPosition: assigned.position, targetUnitId: assigned.id };
            unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
            Logger.debug('Builder', `${unit.id} arrived adjacent to blueprint ${assigned.id} (${assigned.kind}), starting construction`);
            return;
          }
        }
      }

      // Builder arrived but has no assignment: check for any nearby blueprints immediately
      if (unit.type === UnitType.BUILDER && !unit._assignedBlueprintId) {
        const blueprint = UnitAI.findNearestBlueprint(unit);
        if (blueprint) {
          const dist = Pathfinder.heuristic(unit.position, blueprint.position);
          if (dist <= 1) {
            blueprint.assignedBuilderId = unit.id;
            unit._assignedBlueprintId = blueprint.id;
            unit.state = UnitState.CONSTRUCTING;
            unit.command = { type: CommandType.CONSTRUCT, targetPosition: blueprint.position, targetUnitId: blueprint.id };
            unit.gatherCooldown = GAME_CONFIG.gather.initialConstructionDelay;
            Logger.debug('Builder', `${unit.id} arrived near unassigned blueprint ${blueprint.id} (${blueprint.kind}), starting construction`);
            return;
          }
        }
      }

      if (!UnitAI.tryResumeSquadMarch(unit, map)) {
        unit.state = UnitState.IDLE;
        // Builder moved to a new position — clear path-failure blacklist so it can retry
        if (unit.type === UnitType.BUILDER && (unit as any)._failedBlueprintIds) {
          (unit as any)._failedBlueprintIds.clear();
        }
      }
      return;
    }

    // Re-aggro check: combat units on MOVE (not ATTACK) commands react to nearby threats
    // This gives natural "snap to target" behavior when enemies enter range while marching
    // Skip re-aggro when unit is actively kiting — let the flee complete first
    //
    // SQUAD DISCIPLINE: Units in a squad (with _squadId) have tighter re-aggro rules:
    // - They only break formation if an enemy is within WEAPON RANGE (not detection range)
    // - They stay in their squad while engaging (don't clear _squadId for weapon-range fights)
    // - Only aggressive stance units chase beyond weapon range
    // This prevents the entire squad from scattering the moment one enemy appears.
    if (UnitAI.isCombatUnit(unit) && !UnitAI.debugFlags.disableCombat && !unit._isKiting && !unit._forceMove) {
      const isAttackMove = unit.command?.type === CommandType.ATTACK;
      const inSquad = !!unit._squadId;

      // Squad units use tighter aggro range — only react to enemies in weapon range
      // unless on an explicit attack-move command
      const reaggroRange = inSquad
        ? (isAttackMove ? unit.stats.range + GAME_CONFIG.combat.unitAI.moveReaggro.squadAttackMoveBonus : unit.stats.range)
        : (isAttackMove || unit.stance === UnitStance.AGGRESSIVE
          ? UnitAI.getDetectionRange(unit)
          : (unit.stance === UnitStance.DEFENSIVE ? unit.stats.range + GAME_CONFIG.combat.unitAI.moveReaggro.defensiveBonus : 0));

      if (reaggroRange > 0) {
        const threat = UnitAI.findBestTarget(unit, allUnits, unit.owner, reaggroRange);
        if (threat) {
          const threatDist = Pathfinder.heuristic(unit.position, threat.position);
          if (threatDist <= unit.stats.range) {
            // Can fire right now — switch to attacking
            UnitAI.rechargeBerserkerAxeThrow(unit, threat.id);
            unit.state = UnitState.ATTACKING;
            unit.targetPosition = null;
            unit._path = null;
            // Squad units KEEP their squad ID when engaging at weapon range —
            // they'll rejoin movement once the threat is dead
            if (!inSquad) {
              unit._squadId = null;
              unit._squadSpeed = undefined;
            }
            unit.command = { type: CommandType.ATTACK, targetPosition: threat.position, targetUnitId: threat.id };
            return;
          } else if (!inSquad && (isAttackMove || unit.stance === UnitStance.AGGRESSIVE)) {
            // Non-squad units: chase into range
            const alreadyChasingThis = unit.command?.targetUnitId === threat.id;
            if (!alreadyChasingThis) {
              unit._squadId = null;
              unit._squadSpeed = undefined;
              UnitAI.commandAttack(unit, threat.position, threat.id, map);
              return;
            }
          }
          // Squad units with enemies just outside weapon range: keep marching
          // The formation will carry them into range naturally
        }
      }
    }

    // Compute target world position (underground units use tunnel floor Y)
    const useUndergroundY = unit._underground;
    const targetWorld = UnitAI.hexToWorld(unit.targetPosition, map, useUndergroundY);
    const dx = targetWorld.x - unit.worldPosition.x;
    const dz = targetWorld.z - unit.worldPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // ── Stuck detection: re-path if unit isn't making progress ──
    // Track the closest distance the unit has reached toward its waypoint.
    // If it hasn't improved in 2 seconds, it's oscillating (blocked by
    // other units, terrain, etc.) — force a re-path.
    if ((unit as any)._stuckBestDist === undefined || dist < (unit as any)._stuckBestDist - 0.05) {
      (unit as any)._stuckBestDist = dist;
      (unit as any)._stuckTimer = 0;
    } else {
      (unit as any)._stuckTimer = ((unit as any)._stuckTimer || 0) + delta;
      if ((unit as any)._stuckTimer > 2.0) {
        // Unit is stuck — re-path from current position
        (unit as any)._stuckTimer = 0;
        (unit as any)._stuckBestDist = Infinity;
        const path = unit._path as HexCoord[] | null;
        if (path && path.length > 1) {
          const finalGoal = path[path.length - 1];
          const canForest = unit.type === UnitType.LUMBERJACK;
          const canRidge = unit.type === UnitType.BUILDER;
          const newPath = Pathfinder.findPath(unit.position, finalGoal, map, canForest, unit.owner, canRidge);
          if (newPath.length > 1) {
            unit._path = newPath;
            unit._pathIndex = 1;
            unit.targetPosition = newPath[1];
          } else {
            // Still no path — skip this waypoint entirely
            const pathIndex = (unit._pathIndex ?? 0) || 0;
            if (path && pathIndex < path.length - 2) {
              unit._pathIndex = pathIndex + 2;
              unit.targetPosition = path[pathIndex + 2];
            }
          }
        }
      }
    }

    if (dist < 0.1) {
      // Reset stuck tracking on waypoint arrival
      (unit as any)._stuckBestDist = undefined;
      (unit as any)._stuckTimer = 0;
      // Arrived at next waypoint
      unit.position = { ...unit.targetPosition };
      unit.worldPosition.x = targetWorld.x;
      unit.worldPosition.z = targetWorld.z;
      unit.worldPosition.y = targetWorld.y;
      UnitAI.quantizePosition(unit);

      // Dynamic underground state: transition at tunnel entrances
      // Only units with an underground command auto-transition when entering tunnel tiles.
      // Units on surface-only commands (lumberjack chopping, builder mining surface, etc.)
      // walk OVER tunnel tiles without dropping underground.
      const curTile = map.tiles.get(`${unit.position.q},${unit.position.r}`);
      if (ENABLE_UNDERGROUND && curTile?.hasTunnel && unit._undergroundCommand) {
        if (!unit._underground) {
          // Entering tunnel — transition underground and snap Y to tunnel floor
          unit._underground = true;
          const undergroundWorld = UnitAI.hexToWorld(unit.position, map, true);
          unit.worldPosition.y = undergroundWorld.y;
        }
      } else if (unit._underground && !curTile?.hasTunnel) {
        // Left tunnel tile — back to surface
        unit._underground = false;
        unit._undergroundCommand = false;
        const surfaceWorld = UnitAI.hexToWorld(unit.position, map, false);
        unit.worldPosition.y = surfaceWorld.y;
      }

      // Ranged units with attack command: check if we're now in range to stop early
      // BUT NOT while kiting — kiting archers must complete their flee before re-engaging
      if (unit.stats.range > 1 && unit.command?.type === CommandType.ATTACK && unit.command.targetUnitId && !unit._isKiting) {
        const attackTarget = UnitAI._unitByIdCache.get(unit.command.targetUnitId);
        if (attackTarget && !UnitAI.isDead(attackTarget)) {
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
        // Throttle wall-repath to once every ~500ms (30 frames) per unit to avoid pathfind spam
        if (Pathfinder.blockedTiles.has(nextKey) && nextKey !== `${path[path.length - 1].q},${path[path.length - 1].r}`
            && (UnitAI.gameFrame - (unit._lastRepathTime ?? 0) > 30)) {
          unit._lastRepathTime = UnitAI.gameFrame;
          const finalGoal = path[path.length - 1];
          const canForest = unit.type === UnitType.LUMBERJACK;
          const canRidge = unit.type === UnitType.BUILDER;
          const newPath = Pathfinder.findPath(unit.position, finalGoal, map, canForest, unit.owner, canRidge);
          if (newPath.length > 1) {
            unit._path = newPath;
            unit._pathIndex = 1;
            unit.targetPosition = newPath[1];
          } else {
            // No path — try to rejoin squad, otherwise stop
            unit.targetPosition = null;
            unit._path = null;
            unit._isKiting = false;
            if (!UnitAI.tryResumeSquadMarch(unit, map)) {
              unit.state = UnitState.IDLE;
              unit.command = null;
              events.push({ type: 'unit:arrived', unit });
            }
          }
        } else {
          unit._pathIndex = pathIndex + 1;
          unit.targetPosition = nextWp;
        }
      } else {
        // Reached final destination
        unit.targetPosition = null;
        unit._path = null;
        unit._isKiting = false;
        unit._forceMove = false;
        unit._moveDestination = undefined; // Arrived — clear resume destination
        // Squad units that arrived at their objective stay formed — KEEP squad ID.
        // The commander will reassign them on the next tick if needed.
        if (!UnitAI.tryResumeSquadMarch(unit, map)) {
          unit.state = UnitState.IDLE;
          // Do NOT clear _squadId/_squadObjective here — units at their objective
          // are still part of the squad. The AI commander sweep will reassign if needed.
          events.push({ type: 'unit:arrived', unit });
        }
      }
    } else {
      // Move toward target — use squad march speed if assigned, otherwise individual speed
      const squadMoraleMod = UnitAI.moraleModifiers[unit.owner] ?? 1.0;
      let effectiveSpeed = ((unit._squadId && unit._squadSpeed) ? unit._squadSpeed : unit.moveSpeed) * squadMoraleMod;
      // Berserker slow debuff — reduce speed while debuffed (frame-based)
      if (unit._slowUntil && UnitAI.gameFrame < unit._slowUntil && unit._slowFactor) {
        effectiveSpeed *= unit._slowFactor;
      }
      // Berserker chase boost — increase speed while chasing slowed target (frame-based)
      if (unit._chaseBoostUntil && UnitAI.gameFrame < unit._chaseBoostUntil) {
        effectiveSpeed *= 1.6;
      }
      // Healer cleanse speed boost — golden trail speed boost
      const cleanseSpeedMult = StatusEffectSystem.getSpeedMultiplier(unit);
      if (cleanseSpeedMult > 1.0) {
        effectiveSpeed *= cleanseSpeedMult;
      }

      // ── Squad leash: fast units ahead of centroid slow down to stay tight ──
      // Skip for joining units — they're catching up at their own speed.
      // Always active (even during deployment) — the march speed formula already
      // accounts for speed differences, so the leash won't freeze the group.
      if (unit._squadId != null && unit._tacticalGroupId != null && !unit._squadJoining) {
        const tgm = UnitAI.tacticalGroupManager;
        if (tgm) {
          const group = tgm.getGroupForUnit(unit);
          if (group && group.objective) {
            const living = group.livingUnits;
            let cx = 0, cz = 0, coreCount = 0;
            for (let li = 0; li < living.length; li++) {
              if (living[li]._squadJoining) continue;
              cx += living[li].worldPosition.x;
              cz += living[li].worldPosition.z;
              coreCount++;
            }
            if (coreCount > 1) {
              cx /= coreCount;
              cz /= coreCount;

              const objWorld = UnitAI.hexToWorld(group.objective, map);
              const objDx = objWorld.x - cx, objDz = objWorld.z - cz;
              const centroidDistToObj = Math.sqrt(objDx * objDx + objDz * objDz);

              // Two-phase leash:
              // APPROACH phase (<12 units from objective): tight leash, units arrive together
              // MARCH phase (far from objective): moderate leash to keep formation cohesion
              const uDx = objWorld.x - unit.worldPosition.x, uDz = objWorld.z - unit.worldPosition.z;
              const unitDistToObj = Math.sqrt(uDx * uDx + uDz * uDz);

              if (centroidDistToObj < 12) {
                // Approach phase: tight throttle so fast units don't arrive alone
                const aheadBy = centroidDistToObj - unitDistToObj;
                if (aheadBy > 2.0) {
                  const throttle = Math.max(0.35, 1.0 - (aheadBy - 2.0) * 0.18);
                  effectiveSpeed *= throttle;
                }
              } else {
                // March phase: keep units within ~3 world units of centroid
                const distToCentroid = Math.sqrt(
                  (unit.worldPosition.x - cx) * (unit.worldPosition.x - cx) +
                  (unit.worldPosition.z - cz) * (unit.worldPosition.z - cz)
                );
                const aheadOfCentroid = centroidDistToObj - unitDistToObj;
                // Tighter: threshold 3.0, floor 45%, steeper slope 0.12
                if (aheadOfCentroid > 3.0 && distToCentroid > 2.5) {
                  const throttle = Math.max(0.45, 1.0 - (aheadOfCentroid - 3.0) * 0.12);
                  effectiveSpeed *= throttle;
                }
              }
            }
          }
        }
      }

      const speed = effectiveSpeed * delta;
      // Core path movement — always valid (pathfinder already verified the route)
      const pathMoveX = (dx / dist) * Math.min(speed, dist);
      const pathMoveZ = (dz / dist) * Math.min(speed, dist);

      unit.worldPosition.x += pathMoveX;
      unit.worldPosition.z += pathMoveZ;

      // Underground units: snap to tunnel floor (no interpolation — prevents
      // rising over gem blocks or other floor objects)
      if (unit._underground) {
        unit.worldPosition.y = targetWorld.y;
      } else {
        // ── Stepped voxel Y movement ──
        // Unit rises/drops exactly at the block edge (50% progress across hex).
        // Transition is a fast cubic ease over a short window for smooth visuals
        // without any floaty delay or hang time.
        const hexProgress = 1 - Math.min(dist / 1.5, 1);

        const curTile = map?.tiles.get(`${unit.position.q},${unit.position.r}`);
        const sourceY = curTile ? curTile.elevation * 0.5 + 0.25 : unit.worldPosition.y;
        const elevDiff = targetWorld.y - sourceY;
        const hasElevChange = Math.abs(elevDiff) > 0.05;

        if (!hasElevChange) {
          // Flat terrain — snap to target Y
          unit.worldPosition.y = targetWorld.y;
          unit._elevActive = false;
          unit._elevProgress = 0;
        } else {
          // Asymmetric transition window:
          // Going UP: start early (20%) to avoid walking into cliff face
          // Going DOWN: start later (40%) since there's no cliff to clip into
          const goingUp = elevDiff > 0;
          const EDGE_START = goingUp ? 0.20 : 0.40;
          const EDGE_END = goingUp ? 0.50 : 0.65;
          if (hexProgress <= EDGE_START) {
            unit.worldPosition.y = sourceY;
            unit._elevActive = false;
            unit._elevProgress = 0;
          } else if (hexProgress >= EDGE_END) {
            unit.worldPosition.y = targetWorld.y;
            unit._elevActive = false;
            unit._elevProgress = 1;
          } else {
            // Fast cubic ease within the edge window
            const t = (hexProgress - EDGE_START) / (EDGE_END - EDGE_START);
            const smooth = t * t * (3 - 2 * t);
            unit.worldPosition.y = sourceY + elevDiff * smooth;
            // Expose transition state for the renderer's organic movement effects
            unit._elevActive = true;
            unit._elevGoingUp = goingUp;
            unit._elevProgress = t; // 0→1 within the transition window
          }
        }

      }
      // Quantize worldPosition to prevent cross-browser float drift
      UnitAI.quantizePosition(unit);
    }
  }

  private static handleAttacking(unit: Unit, allUnits: Unit[], player: Player, delta: number, events: UnitEvent[], map?: GameMap): void {
    if (!unit.command?.targetUnitId) {
      if (!UnitAI.tryResumeSquadMarch(unit, map)) {
        unit.state = UnitState.IDLE;
      }
      return;
    }

    // Find the target — O(1) via cached Map
    const target = UnitAI._unitByIdCache.get(unit.command.targetUnitId);
    if (!target || UnitAI.isDead(target)) {
      // Target dead — immediately look for another nearby enemy to chain attacks
      const detRange = UnitAI.getDetectionRange(unit);
      const nextEnemy = UnitAI.findBestTarget(unit, allUnits, player.id, detRange);
      if (nextEnemy && map) {
        const nextDist = Pathfinder.heuristic(unit.position, nextEnemy.position);
        if (nextDist <= unit.stats.range) {
          UnitAI.rechargeBerserkerAxeThrow(unit, nextEnemy.id);
          unit.command = { type: CommandType.ATTACK, targetPosition: nextEnemy.position, targetUnitId: nextEnemy.id };
          // Continue attacking immediately — don't drop to IDLE
          return;
        }
        // Out of range but detected — chase
        UnitAI.commandAttack(unit, nextEnemy.position, nextEnemy.id, map);
        return;
      }
      // No more enemies — try to resume movement toward stored destination
      if (!UnitAI.tryResumeSquadMarch(unit, map)) {
        if (!UnitAI.tryResumeMoveDestination(unit, map)) {
          unit.state = UnitState.IDLE;
          unit.command = null;
        }
      }
      return;
    }

    const dist = Pathfinder.heuristic(unit.position, target.position);

    // Ranged kiting: if ANY melee enemy is too close, fire then reposition
    const meleeThreatAtk = (UnitAI.isRangedKiter(unit.type) && map) ? UnitAI.findNearestMeleeThreat(unit, allUnits, UnitAI.getKiteTriggerRange(unit)) : null;
    if (meleeThreatAtk) {
      // Fire first if we can
      if (unit.attackCooldown <= 0 && dist <= unit.stats.range) {
        const result = CombatSystem.resolve(unit, target, allUnits, map);
        const applyInfo = CombatSystem.apply(unit, target, result);
        unit.attackCooldown = UnitAI.getAttackCooldown(unit);
        CombatLog.logDamage(unit, target, result.defenderDamage, result.attackerDamage);
        events.push({ type: 'combat', attacker: unit, defender: target, result });
        // XP and level-up events
        if (applyInfo.xpGained > 0) events.push({ type: 'combat:xp', unitId: unit.id, xp: applyInfo.xpGained } as any);
        if (applyInfo.leveledUp) events.push({ type: 'combat:levelup', unitId: unit.id, newLevel: applyInfo.newLevel } as any);
        // Battlemage AoE splash
        const splashed = CombatSystem.applyBattlemageAoE(unit, target, allUnits);
        for (const sid of splashed) events.push({ type: 'combat:splash', unitId: sid, attackerId: unit.id, element: unit.element } as any);
        // Greatsword cleave + knockback
        const isTileBlocked = (q: number, r: number) => {
          const k = tileKey(q, r);
          if (Pathfinder.blockedTiles.has(k)) return true;
          return Pathfinder.occupiedTiles.has(k);
        };
        // Battlemage cyclone pull — sucks nearby enemies toward target
        const cycloneResult = CombatSystem.applyBattlemageCyclone(unit, target, allUnits, isTileBlocked);
        for (const pid of cycloneResult.damaged) events.push({ type: 'combat:splash', unitId: pid } as any);
        for (const pr of cycloneResult.pulled) events.push({ type: 'combat:cyclone', unitId: pr.unitId, knockQ: pr.knockQ, knockR: pr.knockR } as any);
        const cleaveResults = CombatSystem.applyGreatswordCleave(unit, target, allUnits, isTileBlocked);
        for (const cr of cleaveResults) events.push({ type: 'combat:cleave', unitId: cr.unitId, knockQ: cr.knockQ, knockR: cr.knockR } as any);
        // Ogre club swipe — 2-hex AOE knockback with ground pound VFX
        const ogreResults = CombatSystem.applyOgreClubSwipe(unit, target, allUnits, isTileBlocked);
        if (ogreResults.length > 0) events.push({ type: 'combat:ogreSlam', attackerWorldPos: { x: unit.worldPosition.x, y: unit.worldPosition.y, z: unit.worldPosition.z }, targetWorldPos: { x: target.worldPosition.x, y: target.worldPosition.y, z: target.worldPosition.z } } as any);
        for (const or of ogreResults) events.push({ type: 'combat:cleave', unitId: or.unitId, knockQ: or.knockQ, knockR: or.knockR, attackerType: UnitType.OGRE } as any);
        // Shieldbearer shield bash knockback
        const bashResult = CombatSystem.applyShieldBash(unit, target, isTileBlocked);
        if (bashResult) events.push({ type: 'combat:cleave', unitId: bashResult.unitId, knockQ: bashResult.knockQ, knockR: bashResult.knockR } as any);
        if (!result.defenderSurvived) {
          // Ranged kills: defer DEAD state until projectile lands (avoids "frozen unit" visual)
          if (unit.stats.range > 1 && unit.type !== UnitType.OGRE) {
            target._pendingRangedDeath = true;
          } else {
            target.state = UnitState.DEAD;
          }
          unit.kills = (unit.kills ?? 0) + 1;
          CombatLog.logKill(unit, target);
          events.push({ type: 'unit:killed', unit: target, killer: unit });
        }
        // Check attacker death too — mutual kills (e.g., rider kills target but dies
        // to counter-damage) must process BOTH deaths or the attacker mesh lingers
        if (!result.attackerSurvived) {
          unit.state = UnitState.DEAD;
          target.kills = (target.kills ?? 0) + 1;
          CombatLog.logKill(target, unit);
          events.push({ type: 'unit:killed', unit, killer: target });
          return;
        }
        if (!result.defenderSurvived) {
          if (!UnitAI.tryResumeSquadMarch(unit, map)) {
            if (!UnitAI.tryResumeMoveDestination(unit, map)) {
              unit.state = UnitState.IDLE;
            }
          }
          unit.command = null;
          return;
        }
      }
      // Now kite away from the melee threat (defensive units kite toward destination)
      const fleeTile = (unit.stance === UnitStance.DEFENSIVE && unit._moveDestination)
        ? UnitAI.findDefensiveKiteTile(unit, meleeThreatAtk, unit._moveDestination, map!)
        : UnitAI.findKiteTile(unit, meleeThreatAtk, map!);
      if (fleeTile) {
        CombatLog.logKite(unit, meleeThreatAtk, true, unit.position.q, unit.position.r, fleeTile.q, fleeTile.r);
        UnitAI.commandMove(unit, fleeTile, map!);
        unit._isKiting = true;
        unit.command = { type: CommandType.ATTACK, targetPosition: target.position, targetUnitId: target.id };
        return;
      } else {
        CombatLog.logKite(unit, meleeThreatAtk, false);
      }
    }

    if (dist <= unit.stats.range) {
      // In range — attack if cooldown is ready
      if (unit.attackCooldown <= 0) {
        // Check if this attack should be a secondary (spin/jump/charge)
        CombatSystem.checkSecondaryAttack(unit);
        const result = CombatSystem.resolve(unit, target, allUnits, map);
        const applyInfo2 = CombatSystem.apply(unit, target, result);
        unit.attackCooldown = UnitAI.getAttackCooldown(unit);
        CombatLog.logDamage(unit, target, result.defenderDamage, result.attackerDamage);

        events.push({ type: 'combat', attacker: unit, defender: target, result });
        // XP and level-up events
        if (applyInfo2.xpGained > 0) events.push({ type: 'combat:xp', unitId: unit.id, xp: applyInfo2.xpGained } as any);
        if (applyInfo2.leveledUp) events.push({ type: 'combat:levelup', unitId: unit.id, newLevel: applyInfo2.newLevel } as any);
        // Battlemage AoE splash
        const splashed2 = CombatSystem.applyBattlemageAoE(unit, target, allUnits);
        for (const sid of splashed2) events.push({ type: 'combat:splash', unitId: sid, attackerId: unit.id, element: unit.element } as any);
        // Greatsword cleave + knockback
        const isTileBlocked2 = (q: number, r: number) => {
          const k = tileKey(q, r);
          if (Pathfinder.blockedTiles.has(k)) return true;
          return Pathfinder.occupiedTiles.has(k);
        };
        // Battlemage cyclone pull
        const cycloneResult2 = CombatSystem.applyBattlemageCyclone(unit, target, allUnits, isTileBlocked2);
        for (const pid of cycloneResult2.damaged) events.push({ type: 'combat:splash', unitId: pid } as any);
        for (const pr of cycloneResult2.pulled) events.push({ type: 'combat:cyclone', unitId: pr.unitId, knockQ: pr.knockQ, knockR: pr.knockR } as any);
        const cleaveResults2 = CombatSystem.applyGreatswordCleave(unit, target, allUnits, isTileBlocked2);
        for (const cr of cleaveResults2) events.push({ type: 'combat:cleave', unitId: cr.unitId, knockQ: cr.knockQ, knockR: cr.knockR } as any);
        // Greatsword level-up sweep crit VFX
        if ((unit as any)._sweepCritHitCount) {
          const hitCount = (unit as any)._sweepCritHitCount;
          events.push({ type: 'combat:sweepCrit', attackerId: unit.id, hitCount, worldPos: unit.worldPosition } as any);
          delete (unit as any)._sweepCritHitCount;
        }
        // Ogre club swipe — 2-hex AOE knockback with ground pound VFX
        const ogreResults2 = CombatSystem.applyOgreClubSwipe(unit, target, allUnits, isTileBlocked2);
        if (ogreResults2.length > 0) events.push({ type: 'combat:ogreSlam', attackerWorldPos: { x: unit.worldPosition.x, y: unit.worldPosition.y, z: unit.worldPosition.z }, targetWorldPos: { x: target.worldPosition.x, y: target.worldPosition.y, z: target.worldPosition.z } } as any);
        for (const or2 of ogreResults2) events.push({ type: 'combat:cleave', unitId: or2.unitId, knockQ: or2.knockQ, knockR: or2.knockR, attackerType: UnitType.OGRE } as any);
        // Shieldbearer shield bash knockback
        const bashResult2 = CombatSystem.applyShieldBash(unit, target, isTileBlocked2);
        if (bashResult2) events.push({ type: 'combat:cleave', unitId: bashResult2.unitId, knockQ: bashResult2.knockQ, knockR: bashResult2.knockR } as any);
        // Secondary attack AoE: greatsword spin hits nearby enemies, paladin rally buffs allies
        if (unit._useSecondaryAttack && unit.type === UnitType.GREATSWORD) {
          // Spin was used this attack — apply AoE splash to nearby enemies
          const spinHits = CombatSystem.applyGreatswordSpin(unit, target, allUnits);
          for (const sid of spinHits) events.push({ type: 'combat:splash', unitId: sid, attackerId: unit.id } as any);
        }
        if (unit._useSecondaryAttack && unit.type === UnitType.PALADIN) {
          // Charge was used — apply rally buff to nearby allies
          CombatSystem.applyPaladinRally(unit, allUnits);
        }
        if (unit._useSecondaryAttack && unit.type === UnitType.CHAMPION) {
          // Hammer slam — AoE ground pound hits nearby enemies
          const slamHits = CombatSystem.applyChampionHammerSlam(unit, target, allUnits);
          for (const sid of slamHits) events.push({ type: 'combat:splash', unitId: sid, attackerId: unit.id } as any);
        }

        if (!result.defenderSurvived) {
          // Ranged kills: defer DEAD state until projectile lands (avoids "frozen unit" visual)
          if (unit.stats.range > 1 && unit.type !== UnitType.OGRE) {
            target._pendingRangedDeath = true;
          } else {
            target.state = UnitState.DEAD;
          }
          unit.kills = (unit.kills ?? 0) + 1;
          CombatLog.logKill(unit, target);
          events.push({ type: 'unit:killed', unit: target, killer: unit });
          if (!UnitAI.tryResumeSquadMarch(unit, map)) {
            if (!UnitAI.tryResumeMoveDestination(unit, map)) {
              unit.state = UnitState.IDLE;
            }
          }
          unit.command = null;
        }
        if (!result.attackerSurvived) {
          // Counter-kill is always "melee retaliation" — set DEAD immediately
          unit.state = UnitState.DEAD;
          target.kills = (target.kills ?? 0) + 1;
          CombatLog.logKill(target, unit);
          events.push({ type: 'unit:killed', unit, killer: target });
        }

        // Defensive kite-toward-destination: after attacking, step toward _moveDestination
        // Both melee and ranged defensive units retreat toward their goal while fighting
        if (result.attackerSurvived && result.defenderSurvived &&
            unit.stance === UnitStance.DEFENSIVE && unit._moveDestination && map) {
          const kiteTile = UnitAI.findDefensiveKiteTile(unit, target, unit._moveDestination, map);
          if (kiteTile) {
            UnitAI.commandMove(unit, kiteTile, map);
            unit._isKiting = true;
            // Keep the attack command so we re-engage after the kite step
            unit.command = { type: CommandType.ATTACK, targetPosition: target.position, targetUnitId: target.id };
            return;
          }
        }
      }
    } else {
      // Out of range — move closer (ranged units stop at max range)
      if (unit.stats.range > 1 && unit.type !== UnitType.OGRE) {
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
        // Throttle: only repath every ~500ms (30 frames) to avoid pathfind spam
        const gf = UnitAI.gameFrame;
        const lastRepath = (unit as any)._lastRepathFrame ?? 0;
        if (gf - lastRepath < 30) {
          // On cooldown — just keep moving toward current target if we have one
          if (!unit.targetPosition && !UnitAI.tryResumeSquadMarch(unit, map)) unit.state = UnitState.IDLE;
        } else {
          (unit as any)._lastRepathFrame = gf;
          // Try pathing to an adjacent hex first (target's hex may be occupied)
          let bestPath: HexCoord[] = [];
          let bestLen = Infinity;
          for (let di = 0; di < 6; di++) {
            const d = UnitAI._HEX_DIRS[di];
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
            // No path to target — resume squad march or idle
            if (!UnitAI.tryResumeSquadMarch(unit, map)) {
              unit.state = UnitState.IDLE;
            }
          }
        }
      }
    }
  }

  // --- Helpers ---

  static findNearestEnemy(unit: Unit, allUnits: Unit[], playerId: number): Unit | null {
    let nearest: Unit | null = null;
    let nearestDist = Infinity;
    const isUnderground = !!unit._underground;

    for (const other of allUnits) {
      if (other.owner === playerId || UnitAI.isDead(other)) continue;
      // Underground units only see underground enemies, surface only sees surface
      if (!!other._underground !== isUnderground) continue;
      const dist = Pathfinder.heuristic(unit.position, other.position);
      if (dist < nearestDist || (dist === nearestDist && nearest && UnitAI.tieBreak(other.position, nearest.position))) {
        nearestDist = dist;
        nearest = other;
      }
    }
    return nearest;
  }

  /**
   * Berserker axe throw recharge: if engaging a NEW unique target (not yet thrown at),
   * set range back to 7 and mark throw as ready. No-op for non-berserkers.
   */
  static rechargeBerserkerAxeThrow(unit: Unit, targetId: string): void {
    if (unit.type !== UnitType.BERSERKER) return;
    if (!unit._axeThrowTargets) unit._axeThrowTargets = new Set();
    if (unit._axeThrowTargets.has(targetId)) return; // already thrown at this target
    // Recharge!
    unit._axeThrowReady = true;
    unit.stats.range = 7;
  }

  /** Is this unit a combat unit? Exclusion-based — new combat types auto-included */
  static isCombatUnit(unit: Unit): boolean {
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

  /** Kite trigger range — how close a melee enemy must be before a ranged kiter flees.
   *  Scales with weapon range so all kiters react proportionally. */
  private static getKiteTriggerRange(unit: Unit): number {
    return unit.stats.range + GAME_CONFIG.combat.unitAI.kiteTriggerBonus;
  }

  /** Get detection range for a unit type — how far it can "see" threats */
  private static getDetectionRange(unit: Unit): number {
    switch (unit.type) {
      case UnitType.ARCHER:       return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.ARCHER];
      case UnitType.PALADIN:      return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.PALADIN];
      case UnitType.SCOUT:        return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.SCOUT];
      case UnitType.RIDER:        return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.RIDER];
      case UnitType.TREBUCHET:    return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.TREBUCHET];
      case UnitType.HEALER:       return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.HEALER];
      case UnitType.ASSASSIN:     return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.ASSASSIN];
      case UnitType.SHIELDBEARER: return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.SHIELDBEARER];
      case UnitType.BERSERKER:    return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.BERSERKER];
      case UnitType.BATTLEMAGE:   return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.BATTLEMAGE];
      case UnitType.GREATSWORD:   return GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.GREATSWORD];
      default:                    return GAME_CONFIG.combat.unitAI.detectionRanges.default;
    }
  }

  /**
   * Find best target with spread — avoids all units targeting the same enemy.
   * Each enemy gets a "focus penalty" based on how many allies are already attacking them.
   * Within the given maxRange, picks the enemy with the lowest effective score.
   */
  static findBestTarget(unit: Unit, allUnits: Unit[], playerId: number, maxRange: number): Unit | null {
    const isUnderground = !!unit._underground;

    // Manual focus target: if player specified a target, use it if still valid
    if (unit._focusTarget) {
      const focus = UnitAI._unitByIdCache.get(unit._focusTarget!);
      const focusValid = focus && focus.owner !== playerId && !UnitAI.isDead(focus);
      if (focusValid) {
        return focus!;
      }
      // Focus target dead or gone — clear it
      unit._focusTarget = undefined;
    }

    // Count how many friendly units are already targeting each enemy (reuse scratch Map)
    const focusCount = UnitAI._focusCountScratch;
    focusCount.clear();
    for (const ally of allUnits) {
      if (ally.owner !== playerId || UnitAI.isDead(ally) || ally === unit) continue;
      if (ally.command?.targetUnitId) {
        focusCount.set(ally.command.targetUnitId, (focusCount.get(ally.command.targetUnitId) ?? 0) + 1);
      }
    }

    // Tank peeling: find enemies that are threatening nearby squishies
    // Build set of enemy IDs currently attacking our ranged/support allies within 4 hex
    // Uses O(n) approach: scan enemies once to build target→enemy map, then check squishies
    const peelTargets = UnitAI._peelTargetsScratch;
    peelTargets.clear();
    if (UnitAI.isTankPeeler(unit.type)) {
      // Single pass: for each enemy, check if they're targeting a nearby squishy ally
      for (const enemy of allUnits) {
        if (enemy.owner === playerId || UnitAI.isDead(enemy)) continue;
        const targetId = enemy.command?.targetUnitId;
        if (!targetId) continue;
        // Look up the target — is it our nearby squishy?
        const target = UnitAI._unitByIdCache.get(targetId);
        if (!target || target.owner !== playerId || UnitAI.isDead(target)) continue;
        if (!UnitAI.isRangedKiter(target.type) && target.type !== UnitType.HEALER) continue;
        if (Pathfinder.heuristic(unit.position, target.position) <= 4) {
          peelTargets.add(enemy.id);
        }
      }
    }

    let bestEnemy: Unit | null = null;
    let bestScore = Infinity;

    for (const other of allUnits) {
      if (other.owner === playerId || UnitAI.isDead(other)) continue;
      // Underground units only fight underground enemies, surface only fights surface
      if (!!other._underground !== isUnderground) continue;
      const dist = Pathfinder.heuristic(unit.position, other.position);
      if (dist > maxRange) continue;

      // Score = distance + penalty for each ally already targeting this enemy
      const alreadyTargeting = focusCount.get(other.id) ?? 0;
      const focusPenalty = alreadyTargeting * 2.5;
      // Slight bonus for low-health enemies (finish them off)
      const hpRatio = other.currentHealth / other.stats.maxHealth;
      const hpBonus = (1 - hpRatio) * 1.5;
      // Tank peeling bonus: strong priority for enemies attacking our squishies
      let peelBonus = peelTargets.has(other.id) ? 6.0 : 0;
      // Blackboard coordination: if another tank already claimed this peel, reduce bonus
      if (peelBonus > 0 && UnitAI.isTankPeeler(unit.type) && UnitAI.tacticalGroupManager) {
        const group = UnitAI.tacticalGroupManager.getGroupForUnit(unit);
        if (group && !group.claimPeel(unit.id, other.id)) {
          peelBonus = 1.0; // Drastically reduce — another tank is handling this
        }
      }

      // Ranged kiter target priority: prefer high-value squishies over melee tanks.
      // Kiters should shoot at mages/healers/siege while fleeing from warriors.
      let kiterBonus = 0;
      if (UnitAI.isRangedKiter(unit.type)) {
        // Bonus for high-value targets (squishies, support, siege)
        if (UnitAI.isRangedKiter(other.type) || other.type === UnitType.HEALER) {
          kiterBonus = 4.0; // Prioritize enemy ranged/support
        } else if (other.isSiege) {
          kiterBonus = 3.0; // Siege is high value too
        } else if (other.stats.range <= 1) {
          kiterBonus = -2.0; // Deprioritize melee tanks — let our melee handle them
        }
        // Prefer targets already in weapon range (no chase needed)
        if (dist <= unit.stats.range) {
          kiterBonus += 2.0;
        }
      }

      // Click-point proximity bonus: when A-click was used, bias toward enemies
      // closest to where the player actually clicked (not where the unit is)
      let clickPointBonus = 0;
      if (unit._attackMoveClickPoint) {
        const distToClick = Pathfinder.heuristic(other.position, unit._attackMoveClickPoint);
        // Strong bonus (up to 8) for enemies near the click point; falls off with distance
        clickPointBonus = Math.max(0, 8 - distToClick * 1.5);
      }

      const score = dist + focusPenalty - hpBonus - peelBonus - kiterBonus - clickPointBonus;

      if (score < bestScore || (score === bestScore && bestEnemy && UnitAI.tieBreak(other.position, bestEnemy.position))) {
        bestScore = score;
        bestEnemy = other;
      }
    }
    // Clear click-point bias once we've found a target (one-shot influence)
    if (bestEnemy && unit._attackMoveClickPoint) {
      unit._attackMoveClickPoint = undefined;
    }

    // Log targeting decision
    if (bestEnemy && CombatLog.isEnabled()) {
      const dist = Pathfinder.heuristic(unit.position, bestEnemy.position);
      CombatLog.logTarget(unit, bestEnemy, bestScore, dist);
      // Log peel decision if applicable
      if (peelTargets.size > 0 && peelTargets.has(bestEnemy.id)) {
        // Find which squishy we're peeling for
        for (const ally of allUnits) {
          if (ally.owner !== playerId || UnitAI.isDead(ally)) continue;
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
      if (other.owner === unit.owner || UnitAI.isDead(other)) continue;
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
   * Ranged unit flees AWAY from a melee threat, trying to land at roughly weapon range distance.
   * Scales with each unit's weapon range so mages, battlemages, and archers all kite correctly.
   */
  private static findKiteTile(unit: Unit, threat: Unit, map: GameMap): HexCoord | null {
    const fleeRange = unit.stats.range; // Try to get to max weapon range
    const moveRange = unit.stats.movement + 1; // How far the unit can realistically reach
    // Direction away from the threat
    const dq = unit.position.q - threat.position.q;
    const dr = unit.position.r - threat.position.r;

    // Blackboard: if unit is in a tactical group, bias kite direction toward tank line
    let tankLineBias: HexCoord | null = null;
    const tgm = UnitAI.tacticalGroupManager;
    if (tgm) {
      const group = tgm.getGroupForUnit(unit);
      if (group && group.blackboard.tankLineCenter) {
        tankLineBias = group.blackboard.tankLineCenter;
      }
    }

    // Try several candidate tiles in the "away" direction
    let bestTile: HexCoord | null = null;
    let bestScore = -Infinity;

    // Search radius scales with weapon range — long-range units can consider wider flee area
    const searchRadius = Math.max(3, fleeRange);
    for (let aq = -searchRadius; aq <= searchRadius; aq++) {
      for (let ar = -searchRadius; ar <= searchRadius; ar++) {
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
        // Tank line bias: bonus for tiles closer to our tank line (kite toward protection)
        let tankBonus = 0;
        if (tankLineBias) {
          const distToTanks = Pathfinder.heuristic({ q, r }, tankLineBias);
          tankBonus = Math.max(0, 5 - distToTanks) * 0.8; // Closer to tanks = more bonus
        }
        const score = awayDot * 2 + rangeFit * 3 - distFromUs * 1.5 + tankBonus;

        // Must be reachable (within moveRange) and land at least at weapon range from threat
        if (score > bestScore && distFromUs <= moveRange && distFromThreat >= fleeRange) {
          bestScore = score;
          bestTile = { q, r };
        }
      }
    }

    // Fallback: if no tile at weapon range is reachable, accept anything farther than current position
    if (!bestTile) {
      const currentDist = Pathfinder.heuristic(unit.position, threat.position);
      bestScore = -Infinity;
      for (let aq = -moveRange; aq <= moveRange; aq++) {
        for (let ar = -moveRange; ar <= moveRange; ar++) {
          const q = unit.position.q + aq;
          const r = unit.position.r + ar;
          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (!tile || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.MOUNTAIN
              || tile.terrain === TerrainType.FOREST || Pathfinder.blockedTiles.has(key)) continue;
          const distFromThreat = Pathfinder.heuristic({ q, r }, threat.position);
          const distFromUs = Pathfinder.heuristic(unit.position, { q, r });
          if (distFromUs > moveRange || distFromThreat <= currentDist) continue;
          const awayDot = aq * Math.sign(dq) + ar * Math.sign(dr);
          const score = awayDot * 2 + distFromThreat - distFromUs * 1.5;
          if (score > bestScore) {
            bestScore = score;
            bestTile = { q, r };
          }
        }
      }
    }
    return bestTile;
  }

  /**
   * Find a kite tile for defensive units retreating toward their _moveDestination.
   * Prioritizes tiles closer to destination while maintaining distance from threat.
   * Works for both melee and ranged units.
   */
  private static findDefensiveKiteTile(unit: Unit, threat: Unit, destination: HexCoord, map: GameMap): HexCoord | null {
    const moveRange = unit.stats.movement + 1;
    let bestTile: HexCoord | null = null;
    let bestScore = -Infinity;

    for (let aq = -moveRange; aq <= moveRange; aq++) {
      for (let ar = -moveRange; ar <= moveRange; ar++) {
        const q = unit.position.q + aq;
        const r = unit.position.r + ar;
        const key = `${q},${r}`;
        const tile = map.tiles.get(key);
        if (!tile || tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.MOUNTAIN
            || tile.terrain === TerrainType.FOREST || Pathfinder.blockedTiles.has(key)) continue;

        const distFromUs = Pathfinder.heuristic(unit.position, { q, r });
        if (distFromUs > moveRange || distFromUs === 0) continue;

        const distFromThreat = Pathfinder.heuristic({ q, r }, threat.position);
        const distToDest = Pathfinder.heuristic({ q, r }, destination);
        const currentDistToDest = Pathfinder.heuristic(unit.position, destination);

        // Must move closer to destination (or at least not further)
        const destProgress = currentDistToDest - distToDest;
        // Bonus for maintaining distance from threat
        const threatDist = Math.min(distFromThreat, 4); // Cap to avoid over-weighting

        // Score: heavily favor progress toward destination, moderately favor distance from threat
        const score = destProgress * 4 + threatDist * 1.5 - distFromUs * 0.5;

        if (score > bestScore) {
          bestScore = score;
          bestTile = { q, r };
        }
      }
    }
    return bestTile;
  }

  static hexToWorld(coord: HexCoord, map: GameMap, underground = false): { x: number; y: number; z: number } {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const tile = map.tiles.get(`${coord.q},${coord.r}`);
    let elev = tile ? tile.elevation : 0;
    // If unit is traveling underground and this tile has a tunnel, use the tunnel floor
    if (underground && tile?.hasTunnel) {
      elev = tile.walkableFloor ?? tile.tunnelFloorY ?? tile.elevation;
    }
    const y = elev * 0.5 + 0.25;
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
              tile.terrain === TerrainType.MOUNTAIN) continue;
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
   * Find an adjacent enemy building (non-wall structure) to attack.
   * All units can attack buildings (at reduced damage); only siege can attack walls.
   */
  static findAdjacentEnemyBuilding(unit: Unit, playerOwnerId: number): HexCoord | null {
    const neighbors = Pathfinder.getHexNeighbors(unit.position);
    for (const neighbor of neighbors) {
      const nKey = `${neighbor.q},${neighbor.r}`;
      if (UnitAI.buildingPositions.has(nKey)) {
        const bOwner = UnitAI.buildingOwners.get(nKey);
        if (bOwner !== undefined && bOwner !== playerOwnerId) {
          return neighbor;
        }
      }
    }
    return null;
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
