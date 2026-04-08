/**
 * SpawnQueueSystem — Manages all player spawn queues for unit-producing buildings.
 * Handles queue processing, cost deduction, unit creation, and HUD updates.
 * Extracted from main.ts to reduce central orchestrator size.
 */

import { Unit, UnitType, UnitStance, HexCoord, BuildingKind, PlacedBuilding, Player } from '../../types';
import { UnitFactory } from '../entities/UnitFactory';
import { UnitAI } from './UnitAI';
import { HUD } from '../../ui/HUD';
import { FOOD_PER_COMBAT_UNIT } from './PopulationSystem';
import { Pathfinder } from './Pathfinder';
import { GAME_CONFIG } from '../GameConfig';

// ── Queue item types ──

export type SimpleQueueItem = { type: UnitType; cost: number; owner: number };
export type WorkshopQueueItem = { type: UnitType; cost: { wood: number; stone: number; rope: number }; owner: number };
export type ArmoryQueueItem = { type: UnitType; cost: { gold: number; steel: number }; owner: number };
export type WizardTowerQueueItem = { type: UnitType; cost: { gold: number; crystal: number }; owner: number };

/** Slim interface — only what SpawnQueueSystem needs from the outside */
export interface SpawnQueueOps {
  // Player/game state
  getPlayers(): Player[];
  getAllUnits(): Unit[];
  getCurrentMap(): any;

  // Local player index (for UI validation in doSpawnQueue* methods)
  getLocalPlayerIndex(): number;

  // Resource access (local player — used by doSpawnQueue* for UI validation)
  getGold(): number;
  setGold(v: number): void;
  getWood(): number;
  setWood(v: number): void;
  getStone(): number;
  setStone(v: number): void;
  getRope(): number;
  setRope(v: number): void;
  getSteel(): number;
  setSteel(v: number): void;
  getCrystal(): number;
  setCrystal(v: number): void;

  // Owner-parameterized resource access (for multiplayer queue processing)
  getResourceForOwner(resource: 'gold' | 'wood' | 'stone' | 'rope' | 'steel' | 'crystal', owner: number): number;
  setResourceForOwner(resource: 'gold' | 'wood' | 'stone' | 'rope' | 'steel' | 'crystal', owner: number, value: number): void;

  // Building queries
  getNextSpawnBuilding(kind: BuildingKind, owner: number): PlacedBuilding | null;
  advanceSpawnIndex(kind: BuildingKind): void;
  getFirstBuilding(kind: BuildingKind, owner: number): { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;

  // Spawning helpers
  findSpawnTile(map: any, q: number, r: number, allowTerritory: boolean): HexCoord;
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getElevation(pos: HexCoord): number;
  addUnitToRenderer(unit: Unit, elevation: number): void;
  addUnitToGame(unit: Unit): void;
  getRallyFormationSlot(buildingKind: BuildingKind, unit: Unit): HexCoord | null;

  // HUD & audio
  showNotification(message: string, color: string): void;
  updateResources(): void;
  playSound(name: string, volume?: number): void;

  // Debug
  getDebugFlags(): { freeBuild: boolean; instantSpawn: boolean };

  // Mode toggles (for "place building first" flow)
  toggleBuildingPlaceMode(kind: BuildingKind): void;

  // Population cap (food-based)
  canSpawnCombatUnit(owner: number): boolean;
  getCombatPopInfo(owner: number): { current: number; cap: number };

  // Food access — deducted when combat units spawn
  getFoodStockpile(owner: number): number;
  setFoodStockpile(owner: number, v: number): void;

  // Optional: how much food needed for next combat unit
  getFoodNeededForNext?(owner: number): number;

  // Squad auto-assignment: returns the squad slot for a building (by hex key), or null
  getBuildingSquadAssignment?(buildingHexKey: string): number | null;
  // Assign a freshly spawned unit to a squad slot
  assignUnitToSquad?(unit: Unit, squadSlot: number): void;
}

const isCombatType = (t: UnitType) =>
  t !== UnitType.BUILDER && t !== UnitType.LUMBERJACK && t !== UnitType.VILLAGER;

export default class SpawnQueueSystem {
  private ops: SpawnQueueOps;

  // ── Queue state ──
  spawnQueue: SimpleQueueItem[] = [];
  forestrySpawnQueue: SimpleQueueItem[] = [];
  masonrySpawnQueue: SimpleQueueItem[] = [];
  farmhouseSpawnQueue: SimpleQueueItem[] = [];
  workshopSpawnQueue: WorkshopQueueItem[] = [];
  armorySpawnQueue: ArmoryQueueItem[] = [];
  wizardTowerSpawnQueue: WizardTowerQueueItem[] = [];

  /** Per-owner timers: ownerTimers[buildingKind][ownerIndex] */
  private ownerTimers: Record<string, number[]> = {};
  private getOwnerTimer(kind: string, owner: number): number {
    if (!this.ownerTimers[kind]) this.ownerTimers[kind] = [0, 0];
    return this.ownerTimers[kind][owner] ?? 0;
  }
  private setOwnerTimer(kind: string, owner: number, v: number): void {
    if (!this.ownerTimers[kind]) this.ownerTimers[kind] = [0, 0];
    this.ownerTimers[kind][owner] = v;
  }

  constructor(ops: SpawnQueueOps) {
    this.ops = ops;
  }

  // ── Config for simple (single-resource) buildings (used by doSpawnQueueGeneric) ──
  private readonly SPAWN_QUEUE_CONFIG: Record<string, {
    buildingKind: BuildingKind;
    resourceType: 'gold' | 'wood';
    getResource: () => number;
    getQueue: () => SimpleQueueItem[];
  }> = {
    barracks:  { buildingKind: 'barracks',  resourceType: 'gold', getResource: () => this.ops.getGold(),  getQueue: () => this.spawnQueue },
    forestry:  { buildingKind: 'forestry',  resourceType: 'wood', getResource: () => this.ops.getWood(),  getQueue: () => this.forestrySpawnQueue },
    masonry:   { buildingKind: 'masonry',   resourceType: 'wood', getResource: () => this.ops.getWood(),  getQueue: () => this.masonrySpawnQueue },
    farmhouse: { buildingKind: 'farmhouse', resourceType: 'wood', getResource: () => this.ops.getWood(),  getQueue: () => this.farmhouseSpawnQueue },
  };

  /** Queue configs for update() — maps building kind to its queue + spawn time */
  private getQueueConfigs() {
    return [
      { kind: 'barracks', spawnTime: GAME_CONFIG.buildings.barracks.spawnTime, queue: this.spawnQueue },
      { kind: 'forestry', spawnTime: GAME_CONFIG.buildings.forestry.spawnTime, queue: this.forestrySpawnQueue },
      { kind: 'masonry', spawnTime: GAME_CONFIG.buildings.masonry.spawnTime, queue: this.masonrySpawnQueue },
      { kind: 'farmhouse', spawnTime: GAME_CONFIG.buildings.farmhouse.spawnTime, queue: this.farmhouseSpawnQueue },
      { kind: 'workshop', spawnTime: GAME_CONFIG.buildings.workshop.spawnTime, queue: this.workshopSpawnQueue as any[] },
      { kind: 'armory', spawnTime: GAME_CONFIG.buildings.armory.spawnTime, queue: this.armorySpawnQueue as any[] },
      { kind: 'wizard_tower', spawnTime: GAME_CONFIG.buildings.wizard_tower.spawnTime, queue: this.wizardTowerSpawnQueue as any[] },
    ];
  }

  /** Queue a unit for a simple (single-resource) building */
  doSpawnQueueGeneric(buildingKey: string, type: UnitType, cost: number, name: string): void {
    const cfg = this.SPAWN_QUEUE_CONFIG[buildingKey];
    if (!cfg) return;
    const ops = this.ops;
    const lp = ops.getLocalPlayerIndex();
    if (!ops.getFirstBuilding(cfg.buildingKind, lp)) {
      ops.showNotification(`Place a ${cfg.buildingKind.charAt(0).toUpperCase() + cfg.buildingKind.slice(1)} first, then press ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode(cfg.buildingKind);
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(lp)) {
      const info = ops.getCombatPopInfo(lp);
      ops.playSound('queue_error', 0.4);
      const foodHint = ops.getFoodNeededForNext ? ` Need ${ops.getFoodNeededForNext(lp)} more food` : '';
      ops.showNotification(`Pop cap reached! (${info.current}/${info.cap}) — build farms for more food.${foodHint}`, '#e67e22');
      return;
    }
    if (!debugFlags.freeBuild && cfg.getResource() < cost) {
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Need ${cost} ${cfg.resourceType} for ${name}! (have ${cfg.getResource()})`, '#e67e22');
      return;
    }
    cfg.getQueue().push({ type, cost: debugFlags.freeBuild ? 0 : cost, owner: lp });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`${name} queued (${debugFlags.freeBuild ? 'FREE' : cost + ' ' + cfg.resourceType})`, '#2ecc71');
  }

  /** Queue a unit for Workshop (multi-resource: rope + stone + wood) */
  doSpawnQueueWorkshop(type: UnitType, name: string): void {
    const ops = this.ops;
    const lp = ops.getLocalPlayerIndex();
    if (!ops.getFirstBuilding('workshop', lp)) {
      ops.showNotification(`📍 Place a Workshop first [W], then press 7 again`, '#e67e22');
      ops.toggleBuildingPlaceMode('workshop');
      return;
    }
    const cost = { ...GAME_CONFIG.units[UnitType.TREBUCHET].costs.playerQueue };
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(lp)) {
      const info = ops.getCombatPopInfo(lp);
      ops.playSound('queue_error', 0.4);
      const foodHint = ops.getFoodNeededForNext ? ` Need ${ops.getFoodNeededForNext(lp)} more food` : '';
      ops.showNotification(`Pop cap reached! (${info.current}/${info.cap}) — build farms for more food.${foodHint}`, '#e67e22');
      return;
    }
    if (!debugFlags.freeBuild) {
      if (ops.getRope() < cost.rope) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${cost.rope} rope! (have ${ops.getRope()}). Craft rope at Workshop.`, '#e67e22');
        return;
      }
      if (ops.getStone() < cost.stone) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${cost.stone} stone! (have ${ops.getStone()})`, '#e67e22');
        return;
      }
      if (ops.getWood() < cost.wood) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${cost.wood} wood! (have ${ops.getWood()})`, '#e67e22');
        return;
      }
    }
    const actualCost = debugFlags.freeBuild ? { wood: 0, stone: 0, rope: 0 } : cost;
    this.workshopSpawnQueue.push({ type, cost: actualCost, owner: lp });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : cost.rope + ' rope + ' + cost.stone + ' stone + ' + cost.wood + ' wood'})`, '#2ecc71');
  }

  /** Queue a unit for Armory (gold + steel) */
  doSpawnQueueArmory(type: UnitType, name: string, goldCost: number, steelCost: number): void {
    const ops = this.ops;
    const lp = ops.getLocalPlayerIndex();
    if (!ops.getFirstBuilding('armory', lp)) {
      ops.showNotification(`📍 Place an Armory first [A], then queue ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode('armory');
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(lp)) {
      const info = ops.getCombatPopInfo(lp);
      ops.playSound('queue_error', 0.4);
      const foodHint = ops.getFoodNeededForNext ? ` Need ${ops.getFoodNeededForNext(lp)} more food` : '';
      ops.showNotification(`Pop cap reached! (${info.current}/${info.cap}) — build farms for more food.${foodHint}`, '#e67e22');
      return;
    }
    if (!debugFlags.freeBuild) {
      if (ops.getGold() < goldCost) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${goldCost} gold for ${name}! (have ${ops.getGold()})`, '#e67e22');
        return;
      }
      if (ops.getSteel() < steelCost) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${steelCost} steel for ${name}! (have ${ops.getSteel()})`, '#e67e22');
        return;
      }
    }
    const cost = debugFlags.freeBuild ? { gold: 0, steel: 0 } : { gold: goldCost, steel: steelCost };
    this.armorySpawnQueue.push({ type, cost, owner: lp });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : goldCost + 'g + ' + steelCost + ' steel'})`, '#2ecc71');
  }

  /** Queue a unit for Wizard Tower (gold + crystal) */
  doSpawnQueueWizardTower(type: UnitType, name: string, goldCost: number, crystalCost: number): void {
    const ops = this.ops;
    const lp = ops.getLocalPlayerIndex();
    if (!ops.getFirstBuilding('wizard_tower', lp)) {
      ops.showNotification(`📍 Place a Wizard Tower first [Y], then queue ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode('wizard_tower');
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(lp)) {
      const info = ops.getCombatPopInfo(lp);
      ops.playSound('queue_error', 0.4);
      const foodHint = ops.getFoodNeededForNext ? ` Need ${ops.getFoodNeededForNext(lp)} more food` : '';
      ops.showNotification(`Pop cap reached! (${info.current}/${info.cap}) — build farms for more food.${foodHint}`, '#e67e22');
      return;
    }
    if (!debugFlags.freeBuild) {
      if (ops.getGold() < goldCost) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${goldCost} gold for ${name}! (have ${ops.getGold()})`, '#e67e22');
        return;
      }
      if (ops.getCrystal() < crystalCost) {
        ops.playSound('queue_error', 0.4);
        ops.showNotification(`⚠️ Need ${crystalCost} crystal for ${name}! (have ${ops.getCrystal()})`, '#e67e22');
        return;
      }
    }
    const cost = debugFlags.freeBuild ? { gold: 0, crystal: 0 } : { gold: goldCost, crystal: crystalCost };
    this.wizardTowerSpawnQueue.push({ type, cost, owner: lp });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : goldCost + 'g + ' + crystalCost + ' crystal'})`, '#7c3aed');
  }

  /** Process all spawn queues — called each frame from updateRTS.
   *  Each owner gets independent timers so both players spawn in parallel. */
  update(delta: number): void {
    const ops = this.ops;
    const map = ops.getCurrentMap();
    if (!map) return;

    const debugFlags = ops.getDebugFlags();
    const queueConfigs = this.getQueueConfigs();

    // ─── Process spawn timers per-owner ───
    for (const cfg of queueConfigs) {
      if (cfg.queue.length === 0) continue;
      const spawnTime = debugFlags.instantSpawn ? 0 : cfg.spawnTime;

      // Process each owner independently — both can spawn in parallel
      for (const owner of [0, 1]) {
        const idx = cfg.queue.findIndex((item: any) => (item.owner ?? 0) === owner);
        if (idx === -1) continue;
        const next = cfg.queue[idx] as any;

        const building = ops.getNextSpawnBuilding(cfg.kind as any, owner);
        if (!building) continue;

        const timer = this.getOwnerTimer(cfg.kind, owner) + delta;
        if (timer >= spawnTime) {
          this.setOwnerTimer(cfg.kind, owner, 0);
          // Owner-aware affordability check
          const canAfford = this._canAffordItem(cfg.kind, next, owner);
          if (canAfford) {
            this._deductItemCost(cfg.kind, next, owner);
            cfg.queue.splice(idx, 1);
            const pos = ops.findSpawnTile(map, building.position.q, building.position.r, true);
            ops.advanceSpawnIndex(cfg.kind as any);
            Pathfinder.occupiedTiles.add(`${pos.q},${pos.r}`);
            const unit = UnitFactory.create(next.type, owner, pos);
            const wp = ops.hexToWorld(pos);
            unit.worldPosition = { ...wp };
            ops.addUnitToGame(unit);
            ops.addUnitToRenderer(unit, ops.getElevation(pos));
            ops.playSound('unit_spawn', 0.45);
            if (isCombatType(unit.type)) {
              const currentFood = ops.getFoodStockpile(owner);
              ops.setFoodStockpile(owner, Math.max(0, currentFood - FOOD_PER_COMBAT_UNIT));
            }
            ops.updateResources();
            const rallySlot = ops.getRallyFormationSlot(cfg.kind as any, unit);
            if (rallySlot) UnitAI.commandMove(unit, rallySlot, map);
            if (isCombatType(unit.type)) unit.stance = UnitStance.AGGRESSIVE;
            if (isCombatType(unit.type)) {
              const bKey = `${building.position.q},${building.position.r}`;
              const squadSlot = ops.getBuildingSquadAssignment?.(bKey);
              if (squadSlot != null) {
                ops.assignUnitToSquad?.(unit, squadSlot);
              }
            }
          }
        } else {
          this.setOwnerTimer(cfg.kind, owner, timer);
        }
      }
    }
  }

  /** Get current queue entries for HUD (called by main.ts to combine with AI queues).
   *  Filters by owner so each player only sees their own queue. */
  getQueueHUDEntries(debugFlags: { instantSpawn: boolean }, owner?: number): { kind: string; color: string; items: { type: UnitType }[]; timerProgress: number }[] {
    const configs = [
      { kind: 'barracks', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.barracks.spawnTime, queue: this.spawnQueue },
      { kind: 'forestry', color: '#6b8e23', spawnTime: GAME_CONFIG.buildings.forestry.spawnTime, queue: this.forestrySpawnQueue },
      { kind: 'masonry', color: '#808080', spawnTime: GAME_CONFIG.buildings.masonry.spawnTime, queue: this.masonrySpawnQueue },
      { kind: 'farmhouse', color: '#d4a030', spawnTime: GAME_CONFIG.buildings.farmhouse.spawnTime, queue: this.farmhouseSpawnQueue },
      { kind: 'workshop', color: '#c9a96e', spawnTime: GAME_CONFIG.buildings.workshop.spawnTime, queue: this.workshopSpawnQueue as any[] },
      { kind: 'armory', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.armory.spawnTime, queue: this.armorySpawnQueue as any[] },
      { kind: 'wizard_tower', color: '#7c3aed', spawnTime: GAME_CONFIG.buildings.wizard_tower.spawnTime, queue: this.wizardTowerSpawnQueue as any[] },
    ];

    return configs.map(cfg => {
      const filtered = owner != null
        ? cfg.queue.filter((q: any) => (q.owner ?? 0) === owner)
        : cfg.queue;
      const timerOwner = owner ?? 0;
      return {
        kind: cfg.kind,
        color: cfg.color,
        items: filtered.map((q: any) => ({ type: q.type })),
        timerProgress: filtered.length > 0
          ? this.getOwnerTimer(cfg.kind, timerOwner) / (debugFlags.instantSpawn ? 0.001 : cfg.spawnTime)
          : 0,
      };
    });
  }

  /** Owner-aware affordability check for a queue item */
  private _canAffordItem(buildingKind: string, item: any, owner: number): boolean {
    const ops = this.ops;
    const debugFlags = ops.getDebugFlags();
    if (debugFlags.freeBuild) return true;
    if (buildingKind === 'workshop') {
      return ops.getResourceForOwner('rope', owner) >= item.cost.rope &&
             ops.getResourceForOwner('stone', owner) >= item.cost.stone &&
             ops.getResourceForOwner('wood', owner) >= item.cost.wood;
    } else if (buildingKind === 'armory') {
      return ops.getResourceForOwner('gold', owner) >= item.cost.gold &&
             ops.getResourceForOwner('steel', owner) >= item.cost.steel;
    } else if (buildingKind === 'wizard_tower') {
      return ops.getResourceForOwner('gold', owner) >= item.cost.gold &&
             ops.getResourceForOwner('crystal', owner) >= item.cost.crystal;
    } else {
      // Simple buildings: barracks (gold), forestry/masonry/farmhouse (wood)
      const resource = buildingKind === 'barracks' ? 'gold' : 'wood';
      return ops.getResourceForOwner(resource as any, owner) >= item.cost;
    }
  }

  /** Owner-aware cost deduction for a queue item */
  private _deductItemCost(buildingKind: string, item: any, owner: number): void {
    const ops = this.ops;
    if (buildingKind === 'workshop') {
      ops.setResourceForOwner('rope', owner, ops.getResourceForOwner('rope', owner) - item.cost.rope);
      ops.setResourceForOwner('stone', owner, ops.getResourceForOwner('stone', owner) - item.cost.stone);
      ops.setResourceForOwner('wood', owner, ops.getResourceForOwner('wood', owner) - item.cost.wood);
    } else if (buildingKind === 'armory') {
      ops.setResourceForOwner('gold', owner, ops.getResourceForOwner('gold', owner) - item.cost.gold);
      ops.setResourceForOwner('steel', owner, ops.getResourceForOwner('steel', owner) - item.cost.steel);
    } else if (buildingKind === 'wizard_tower') {
      ops.setResourceForOwner('gold', owner, ops.getResourceForOwner('gold', owner) - item.cost.gold);
      ops.setResourceForOwner('crystal', owner, ops.getResourceForOwner('crystal', owner) - item.cost.crystal);
    } else {
      const resource = buildingKind === 'barracks' ? 'gold' : 'wood';
      ops.setResourceForOwner(resource as any, owner, ops.getResourceForOwner(resource as any, owner) - item.cost);
    }
  }

  /** Route spawn queue command based on building type and unit */
  doSpawnQueue(buildingKey: string, unitType: UnitType, unitName: string, costParts: string[]): void {
    if (buildingKey === 'armory') {
      const goldCost = parseInt(costParts[0]);
      const steelCost = parseInt(costParts[1]);
      this.doSpawnQueueArmory(unitType, unitName.charAt(0).toUpperCase() + unitName.slice(1).toLowerCase(), goldCost, steelCost);
    } else if (buildingKey === 'wizard_tower') {
      const goldCost = parseInt(costParts[0]);
      const crystalCost = parseInt(costParts[1]);
      this.doSpawnQueueWizardTower(unitType, unitName.charAt(0).toUpperCase() + unitName.slice(1).toLowerCase(), goldCost, crystalCost);
    } else if (buildingKey === 'workshop') {
      this.doSpawnQueueWorkshop(unitType, unitName.charAt(0).toUpperCase() + unitName.slice(1).toLowerCase());
    } else {
      const cost = parseInt(costParts[0]);
      this.doSpawnQueueGeneric(buildingKey, unitType, cost, unitName.charAt(0).toUpperCase() + unitName.slice(1).toLowerCase());
    }
  }

  /** Queue a unit from the building tooltip */
  queueUnitFromTooltip(unitType: string, buildingKind: BuildingKind): void {
    switch (buildingKind) {
      case 'barracks': {
        const type = unitType === 'archer' ? UnitType.ARCHER :
                     unitType === 'rider' ? UnitType.RIDER : UnitType.WARRIOR;
        const cost = GAME_CONFIG.units[type].costs.tooltipQueue.gold;
        this.doSpawnQueueGeneric('barracks', type, cost, unitType.charAt(0).toUpperCase() + unitType.slice(1).toLowerCase());
        break;
      }
      case 'forestry': {
        const type = unitType === 'scout' ? UnitType.SCOUT : UnitType.LUMBERJACK;
        const cost = GAME_CONFIG.units[type].costs.tooltipQueue.wood;
        this.doSpawnQueueGeneric('forestry', type, cost, unitType.charAt(0).toUpperCase() + unitType.slice(1).toLowerCase());
        break;
      }
      case 'masonry': {
        const type = UnitType.BUILDER;
        this.doSpawnQueueGeneric('masonry', type, GAME_CONFIG.units[type].costs.tooltipQueue.wood, 'Builder');
        break;
      }
      case 'farmhouse': {
        const type = UnitType.VILLAGER;
        this.doSpawnQueueGeneric('farmhouse', type, GAME_CONFIG.units[type].costs.tooltipQueue.wood, 'Villager');
        break;
      }
      case 'workshop': {
        const type = UnitType.TREBUCHET;
        this.doSpawnQueueWorkshop(type, unitType.charAt(0).toUpperCase() + unitType.slice(1).toLowerCase());
        break;
      }
      case 'armory': {
        const typeMap: Record<string, UnitType> = {
          greatsword: UnitType.GREATSWORD, assassin: UnitType.ASSASSIN,
          berserker: UnitType.BERSERKER, shieldbearer: UnitType.SHIELDBEARER,
        };
        const type = typeMap[unitType] || UnitType.GREATSWORD;
        const cfg = (GAME_CONFIG.units[type].costs as any).menu as { gold: number; steel: number };
        this.doSpawnQueueArmory(type, unitType.charAt(0).toUpperCase() + unitType.slice(1).toLowerCase(), cfg.gold, cfg.steel);
        break;
      }
      case 'wizard_tower': {
        const typeMap: Record<string, UnitType> = {
          mage: UnitType.MAGE, battlemage: UnitType.BATTLEMAGE,
          healer: UnitType.HEALER, paladin: UnitType.PALADIN,
        };
        const type = typeMap[unitType] || UnitType.MAGE;
        const cfg = (GAME_CONFIG.units[type].costs as any).menu as { gold: number; crystal: number };
        this.doSpawnQueueWizardTower(type, unitType.charAt(0).toUpperCase() + unitType.slice(1).toLowerCase(), cfg.gold, cfg.crystal);
        break;
      }
    }
  }

  /** Enqueue a unit for a specific owner — called from CommandBridge for QUEUE_UNIT commands.
   *  Bypasses UI cost validation (cost is checked at spawn time by update()).
   *  Both clients in lockstep call this with identical params for determinism. */
  enqueueForOwner(buildingKind: string, unitType: UnitType, owner: number): void {
    const unitCfg = GAME_CONFIG.units[unitType];
    if (!unitCfg) return;
    const costs = (unitCfg.costs as any)?.tooltipQueue ?? (unitCfg.costs as any)?.menu ?? (unitCfg.costs as any)?.playerQueue;
    if (!costs) return;
    const debugFlags = this.ops.getDebugFlags();
    const free = debugFlags.freeBuild;

    switch (buildingKind) {
      case 'barracks':
        this.spawnQueue.push({ type: unitType, cost: free ? 0 : (costs.gold ?? 0), owner });
        break;
      case 'forestry':
        this.forestrySpawnQueue.push({ type: unitType, cost: free ? 0 : (costs.wood ?? 0), owner });
        break;
      case 'masonry':
        this.masonrySpawnQueue.push({ type: unitType, cost: free ? 0 : (costs.wood ?? 0), owner });
        break;
      case 'farmhouse':
        this.farmhouseSpawnQueue.push({ type: unitType, cost: free ? 0 : (costs.wood ?? 0), owner });
        break;
      case 'workshop':
        this.workshopSpawnQueue.push({ type: unitType, cost: free ? 0 : { wood: costs.wood ?? 0, stone: costs.stone ?? 0, rope: costs.rope ?? 0 }, owner } as any);
        break;
      case 'armory':
        this.armorySpawnQueue.push({ type: unitType, cost: free ? 0 : { gold: costs.gold ?? 0, steel: costs.steel ?? 0 }, owner } as any);
        break;
      case 'wizard_tower':
        this.wizardTowerSpawnQueue.push({ type: unitType, cost: free ? 0 : { gold: costs.gold ?? 0, crystal: costs.crystal ?? 0 }, owner } as any);
        break;
    }
    this.ops.playSound('queue_confirm', 0.5);
  }

  /** Reset all queues — called on map regeneration */
  cleanup(): void {
    this.spawnQueue = [];
    this.forestrySpawnQueue = [];
    this.masonrySpawnQueue = [];
    this.farmhouseSpawnQueue = [];
    this.workshopSpawnQueue = [];
    this.armorySpawnQueue = [];
    this.wizardTowerSpawnQueue = [];
    this.ownerTimers = {};
  }
}
