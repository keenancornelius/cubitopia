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

export type SimpleQueueItem = { type: UnitType; cost: number };
export type WorkshopQueueItem = { type: UnitType; cost: { wood: number; stone: number; rope: number } };
export type ArmoryQueueItem = { type: UnitType; cost: { gold: number; steel: number } };
export type WizardTowerQueueItem = { type: UnitType; cost: { gold: number; crystal: number } };

/** Slim interface — only what SpawnQueueSystem needs from the outside */
export interface SpawnQueueOps {
  // Player/game state
  getPlayers(): Player[];
  getAllUnits(): Unit[];
  getCurrentMap(): any;

  // Resource access (player 0)
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
}

const isCombatType = (t: UnitType) =>
  t !== UnitType.BUILDER && t !== UnitType.LUMBERJACK && t !== UnitType.VILLAGER;

export default class SpawnQueueSystem {
  private ops: SpawnQueueOps;

  // ── Queue state ──
  spawnQueue: SimpleQueueItem[] = [];
  spawnTimer = 0;
  forestrySpawnQueue: SimpleQueueItem[] = [];
  forestrySpawnTimer = 0;
  masonrySpawnQueue: SimpleQueueItem[] = [];
  masonrySpawnTimer = 0;
  farmhouseSpawnQueue: SimpleQueueItem[] = [];
  farmhouseSpawnTimer = 0;
  workshopSpawnQueue: WorkshopQueueItem[] = [];
  workshopSpawnTimer = 0;
  armorySpawnQueue: ArmoryQueueItem[] = [];
  armorySpawnTimer = 0;
  wizardTowerSpawnQueue: WizardTowerQueueItem[] = [];
  wizardTowerSpawnTimer = 0;

  constructor(ops: SpawnQueueOps) {
    this.ops = ops;
  }

  // ── Config for simple (single-resource) buildings ──
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

  /** Queue a unit for a simple (single-resource) building */
  doSpawnQueueGeneric(buildingKey: string, type: UnitType, cost: number, name: string): void {
    const cfg = this.SPAWN_QUEUE_CONFIG[buildingKey];
    if (!cfg) return;
    const ops = this.ops;
    if (!ops.getFirstBuilding(cfg.buildingKind, 0)) {
      ops.showNotification(`Place a ${cfg.buildingKind.charAt(0).toUpperCase() + cfg.buildingKind.slice(1)} first, then press ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode(cfg.buildingKind);
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(0)) {
      const info = ops.getCombatPopInfo(0);
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Population cap reached! (${info.current}/${info.cap}) — build more farms`, '#e67e22');
      return;
    }
    if (!debugFlags.freeBuild && cfg.getResource() < cost) {
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Need ${cost} ${cfg.resourceType} for ${name}! (have ${cfg.getResource()})`, '#e67e22');
      return;
    }
    cfg.getQueue().push({ type, cost: debugFlags.freeBuild ? 0 : cost });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`${name} queued (${debugFlags.freeBuild ? 'FREE' : cost + ' ' + cfg.resourceType})`, '#2ecc71');
  }

  /** Queue a unit for Workshop (multi-resource: rope + stone + wood) */
  doSpawnQueueWorkshop(type: UnitType, name: string): void {
    const ops = this.ops;
    if (!ops.getFirstBuilding('workshop', 0)) {
      ops.showNotification(`📍 Place a Workshop first [W], then press 7 again`, '#e67e22');
      ops.toggleBuildingPlaceMode('workshop');
      return;
    }
    const cost = { ...GAME_CONFIG.units[UnitType.TREBUCHET].costs.playerQueue };
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(0)) {
      const info = ops.getCombatPopInfo(0);
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Population cap reached! (${info.current}/${info.cap}) — build more farms`, '#e67e22');
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
    this.workshopSpawnQueue.push({ type, cost: actualCost });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : cost.rope + ' rope + ' + cost.stone + ' stone + ' + cost.wood + ' wood'})`, '#2ecc71');
  }

  /** Queue a unit for Armory (gold + steel) */
  doSpawnQueueArmory(type: UnitType, name: string, goldCost: number, steelCost: number): void {
    const ops = this.ops;
    if (!ops.getFirstBuilding('armory', 0)) {
      ops.showNotification(`📍 Place an Armory first [A], then queue ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode('armory');
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(0)) {
      const info = ops.getCombatPopInfo(0);
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Population cap reached! (${info.current}/${info.cap}) — build more farms`, '#e67e22');
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
    this.armorySpawnQueue.push({ type, cost });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : goldCost + 'g + ' + steelCost + ' steel'})`, '#2ecc71');
  }

  /** Queue a unit for Wizard Tower (gold + crystal) */
  doSpawnQueueWizardTower(type: UnitType, name: string, goldCost: number, crystalCost: number): void {
    const ops = this.ops;
    if (!ops.getFirstBuilding('wizard_tower', 0)) {
      ops.showNotification(`📍 Place a Wizard Tower first [Y], then queue ${name} again`, '#e67e22');
      ops.toggleBuildingPlaceMode('wizard_tower');
      return;
    }
    const debugFlags = ops.getDebugFlags();
    // Pop cap check for combat units
    if (isCombatType(type) && !debugFlags.freeBuild && !ops.canSpawnCombatUnit(0)) {
      const info = ops.getCombatPopInfo(0);
      ops.playSound('queue_error', 0.4);
      ops.showNotification(`Population cap reached! (${info.current}/${info.cap}) — build more farms`, '#e67e22');
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
    this.wizardTowerSpawnQueue.push({ type, cost });
    ops.playSound('queue_confirm', 0.5);
    ops.showNotification(`✅ ${name} queued (${debugFlags.freeBuild ? 'FREE' : goldCost + 'g + ' + crystalCost + ' crystal'})`, '#7c3aed');
  }

  /** Process all spawn queues — called each frame from updateRTS */
  update(delta: number): void {
    const ops = this.ops;
    const map = ops.getCurrentMap();
    if (!map) return;

    const debugFlags = ops.getDebugFlags();

    const spawnConfigs: {
      kind: string; color: string; spawnTime: number;
      queue: { type: UnitType }[];
      getTimer: () => number; setTimer: (v: number) => void;
      canAfford: (item: any) => boolean; deductCost: (item: any) => void;
    }[] = [
      {
        kind: 'barracks', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.barracks.spawnTime,
        queue: this.spawnQueue,
        getTimer: () => this.spawnTimer, setTimer: (v) => { this.spawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => ops.getGold() >= item.cost,
        deductCost: (item: SimpleQueueItem) => { ops.setGold(ops.getGold() - item.cost); },
      },
      {
        kind: 'forestry', color: '#6b8e23', spawnTime: GAME_CONFIG.buildings.forestry.spawnTime,
        queue: this.forestrySpawnQueue,
        getTimer: () => this.forestrySpawnTimer, setTimer: (v) => { this.forestrySpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => ops.getWood() >= item.cost,
        deductCost: (item: SimpleQueueItem) => { ops.setWood(ops.getWood() - item.cost); },
      },
      {
        kind: 'masonry', color: '#808080', spawnTime: GAME_CONFIG.buildings.masonry.spawnTime,
        queue: this.masonrySpawnQueue,
        getTimer: () => this.masonrySpawnTimer, setTimer: (v) => { this.masonrySpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => ops.getWood() >= item.cost,
        deductCost: (item: SimpleQueueItem) => { ops.setWood(ops.getWood() - item.cost); },
      },
      {
        kind: 'farmhouse', color: '#d4a030', spawnTime: GAME_CONFIG.buildings.farmhouse.spawnTime,
        queue: this.farmhouseSpawnQueue,
        getTimer: () => this.farmhouseSpawnTimer, setTimer: (v) => { this.farmhouseSpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => ops.getWood() >= item.cost,
        deductCost: (item: SimpleQueueItem) => { ops.setWood(ops.getWood() - item.cost); },
      },
      {
        kind: 'workshop', color: '#c9a96e', spawnTime: GAME_CONFIG.buildings.workshop.spawnTime,
        queue: this.workshopSpawnQueue,
        getTimer: () => this.workshopSpawnTimer, setTimer: (v) => { this.workshopSpawnTimer = v; },
        canAfford: (item: WorkshopQueueItem) =>
          ops.getRope() >= item.cost.rope &&
          ops.getStone() >= item.cost.stone &&
          ops.getWood() >= item.cost.wood,
        deductCost: (item: WorkshopQueueItem) => {
          ops.setRope(ops.getRope() - item.cost.rope);
          ops.setStone(ops.getStone() - item.cost.stone);
          ops.setWood(ops.getWood() - item.cost.wood);
        },
      },
      {
        kind: 'armory', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.armory.spawnTime,
        queue: this.armorySpawnQueue,
        getTimer: () => this.armorySpawnTimer, setTimer: (v) => { this.armorySpawnTimer = v; },
        canAfford: (item: ArmoryQueueItem) =>
          ops.getGold() >= item.cost.gold &&
          ops.getSteel() >= item.cost.steel,
        deductCost: (item: ArmoryQueueItem) => {
          ops.setGold(ops.getGold() - item.cost.gold);
          ops.setSteel(ops.getSteel() - item.cost.steel);
        },
      },
      {
        kind: 'wizard_tower', color: '#7c3aed', spawnTime: GAME_CONFIG.buildings.wizard_tower.spawnTime,
        queue: this.wizardTowerSpawnQueue,
        getTimer: () => this.wizardTowerSpawnTimer, setTimer: (v) => { this.wizardTowerSpawnTimer = v; },
        canAfford: (item: WizardTowerQueueItem) =>
          ops.getGold() >= item.cost.gold &&
          ops.getCrystal() >= item.cost.crystal,
        deductCost: (item: WizardTowerQueueItem) => {
          ops.setGold(ops.getGold() - item.cost.gold);
          ops.setCrystal(ops.getCrystal() - item.cost.crystal);
        },
      },
    ];

    // ─── Process spawn timers ───
    for (const cfg of spawnConfigs) {
      const building = ops.getNextSpawnBuilding(cfg.kind as any, 0);
      if (!building || cfg.queue.length === 0) continue;

      const timer = cfg.getTimer() + delta;
      const spawnTime = debugFlags.instantSpawn ? 0 : cfg.spawnTime;

      if (timer >= spawnTime) {
        cfg.setTimer(0);
        const next = cfg.queue[0];
        if (cfg.canAfford(next)) {
          cfg.deductCost(next);
          cfg.queue.shift();
          // Use the already-peeked building (no double-advance)
          const pos = ops.findSpawnTile(map, building.position.q, building.position.r, true);
          ops.advanceSpawnIndex(cfg.kind as any);
          // Mark tile occupied immediately to prevent same-frame stacking
          Pathfinder.occupiedTiles.add(`${pos.q},${pos.r}`);
          const unit = UnitFactory.create(next.type, 0, pos);
          const wp = ops.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          ops.addUnitToGame(unit);
          ops.addUnitToRenderer(unit, ops.getElevation(pos));
          ops.playSound('unit_spawn', 0.45);
          // Deduct food for combat units (3 food per combat unit)
          if (isCombatType(unit.type)) {
            const currentFood = ops.getFoodStockpile(0);
            ops.setFoodStockpile(0, Math.max(0, currentFood - FOOD_PER_COMBAT_UNIT));
          }
          ops.updateResources();
          // Rally point
          const rallySlot = ops.getRallyFormationSlot(cfg.kind as any, unit);
          if (rallySlot) UnitAI.commandMove(unit, rallySlot, map);
          if (isCombatType(unit.type)) unit.stance = UnitStance.AGGRESSIVE;
        }
      } else {
        cfg.setTimer(timer);
      }
    }

    // ─── Build HUD entries for all queues (player + AI) ───
    return this.buildQueueHUDEntries(spawnConfigs, debugFlags);
  }

  /** Build and return HUD queue entries for display */
  private buildQueueHUDEntries(spawnConfigs: any[], debugFlags: { instantSpawn: boolean }): void {
    // This is separated so it can be extended with AI queues in main.ts
    // The actual HUD update call will be handled by main.ts which has access to aiController
  }

  /** Get current queue entries for HUD (called by main.ts to combine with AI queues) */
  getQueueHUDEntries(debugFlags: { instantSpawn: boolean }): { kind: string; color: string; items: { type: UnitType }[]; timerProgress: number }[] {
    const configs = [
      { kind: 'barracks', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.barracks.spawnTime, queue: this.spawnQueue, timer: this.spawnTimer },
      { kind: 'forestry', color: '#6b8e23', spawnTime: GAME_CONFIG.buildings.forestry.spawnTime, queue: this.forestrySpawnQueue, timer: this.forestrySpawnTimer },
      { kind: 'masonry', color: '#808080', spawnTime: GAME_CONFIG.buildings.masonry.spawnTime, queue: this.masonrySpawnQueue, timer: this.masonrySpawnTimer },
      { kind: 'farmhouse', color: '#d4a030', spawnTime: GAME_CONFIG.buildings.farmhouse.spawnTime, queue: this.farmhouseSpawnQueue, timer: this.farmhouseSpawnTimer },
      { kind: 'workshop', color: '#c9a96e', spawnTime: GAME_CONFIG.buildings.workshop.spawnTime, queue: this.workshopSpawnQueue, timer: this.workshopSpawnTimer },
      { kind: 'armory', color: '#e67e22', spawnTime: GAME_CONFIG.buildings.armory.spawnTime, queue: this.armorySpawnQueue, timer: this.armorySpawnTimer },
      { kind: 'wizard_tower', color: '#7c3aed', spawnTime: GAME_CONFIG.buildings.wizard_tower.spawnTime, queue: this.wizardTowerSpawnQueue, timer: this.wizardTowerSpawnTimer },
    ];

    return configs.map(cfg => ({
      kind: cfg.kind,
      color: cfg.color,
      items: cfg.queue.map(q => ({ type: q.type })),
      timerProgress: cfg.queue.length > 0
        ? cfg.timer / (debugFlags.instantSpawn ? 0.001 : cfg.spawnTime)
        : 0,
    }));
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
                     unitType === 'rider' ? UnitType.RIDER :
                     unitType === 'paladin' ? UnitType.PALADIN : UnitType.WARRIOR;
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
    }
  }

  /** Reset all queues — called on map regeneration */
  cleanup(): void {
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.forestrySpawnQueue = [];
    this.forestrySpawnTimer = 0;
    this.masonrySpawnQueue = [];
    this.masonrySpawnTimer = 0;
    this.farmhouseSpawnQueue = [];
    this.farmhouseSpawnTimer = 0;
    this.workshopSpawnQueue = [];
    this.workshopSpawnTimer = 0;
    this.armorySpawnQueue = [];
    this.armorySpawnTimer = 0;
    this.wizardTowerSpawnQueue = [];
    this.wizardTowerSpawnTimer = 0;
  }
}
