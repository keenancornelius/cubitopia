/**
 * DebugController — All playtester/debug commands.
 * Uses DebugOps slim interface to access game state.
 */

import { HexCoord, TerrainType, UnitType, UnitState, Unit, UnitStance, GameMap } from '../../types';
import { UnitFactory } from '../entities/UnitFactory';
import { Pathfinder } from './Pathfinder';
import { FOOD_PER_COMBAT_UNIT } from './PopulationSystem';

export interface DebugOps {
  // State access
  getAllUnits(): Unit[];
  getBases(): { owner: number; health: number; maxHealth: number; destroyed: boolean; position: HexCoord }[];
  getPlayers(): { units: Unit[]; resources: any }[];

  // Spawn helpers
  findSpawnTile(preferQ: number, preferR: number, skipCenter?: boolean): HexCoord;
  addUnitToWorld(unit: Unit): void;
  removeUnitFromGame(unit: Unit): void;

  // Renderer access
  updateHealthBar(unit: Unit): void;
  setUnitWorldPosition(id: string, x: number, y: number, z: number): void;
  showBaseDestruction(base: any): void;
  /** @deprecated No-op — zone capture replaced base health bars */
  updateBaseHealthBars(): void;

  // World helpers
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getElevation(pos: HexCoord): number;
  getSelectedUnits(): Unit[];

  // Resource access
  getWoodStockpile(): number;
  setWoodStockpile(val: number): void;
  getStoneStockpile(): number;
  setStoneStockpile(val: number): void;
  getFoodStockpile(): number;
  setFoodStockpile(val: number): void;
  getGrassFiberStockpile(): number;
  setGrassFiberStockpile(val: number): void;
  getClayStockpile(): number;
  setClayStockpile(val: number): void;
  getRopeStockpile(): number;
  setRopeStockpile(val: number): void;
  getIronStockpile(): number;
  setIronStockpile(val: number): void;
  getCharcoalStockpile(): number;
  setCharcoalStockpile(val: number): void;
  getSteelStockpile(): number;
  setSteelStockpile(val: number): void;
  getGoldStockpile(): number;
  setGoldStockpile(val: number): void;
  getCrystalStockpile(): number;
  setCrystalStockpile(val: number): void;

  // HUD
  updateResourceDisplay(): void;
  updateStockpileVisual(owner: number): void;
  showNotification(msg: string, color: string): void;

  // Terrain
  getCurrentMapTiles(): Map<string, { terrain: TerrainType; elevation: number }> | null;
  removeDecoration(pos: HexCoord): void;
  rebuildVoxels(): void;

  // Nature
  deleteTreeAge(key: string): void;
  deleteTreeRegrowthTimer(key: string): void;

  // Win condition
  checkWinCondition(): void;

  // Test army spawning
  getCurrentMap(): GameMap | null;
  addUnitToRenderer(unit: Unit, elevation: number): void;
  getFoodForPlayer(pid: number): number;
  setFoodForPlayer(pid: number, value: number): void;
  setPlayerFoodResource(pid: number, value: number): void;
  rebuildAllUnits(): void;
  getArmyComposition(): { blue: { type: UnitType; count: number }[]; red: { type: UnitType; count: number }[] };
}

export default class DebugController {
  private ops: DebugOps;

  constructor(ops: DebugOps) {
    this.ops = ops;
  }

  spawnUnit(type: UnitType, count = 1): void {
    const bases = this.ops.getBases();
    const base = bases.find(b => b.owner === 0);
    if (!base) return;
    for (let i = 0; i < count; i++) {
      const pos = this.ops.findSpawnTile(base.position.q, base.position.r, true);
      // Mark tile occupied immediately so next spawn in this batch picks a different tile
      Pathfinder.occupiedTiles.add(`${pos.q},${pos.r}`);
      const unit = UnitFactory.create(type, 0, pos);
      const wp = this.ops.hexToWorld(pos);
      unit.worldPosition = { ...wp };
      this.ops.addUnitToWorld(unit);
    }
    this.ops.updateResourceDisplay();
    this.ops.showNotification(`🐛 Spawned ${count}x ${type}`, '#9c27b0');
  }

  spawnEnemyUnit(type: UnitType, count = 1): void {
    const bases = this.ops.getBases();
    const base = bases.find(b => b.owner === 1);
    if (!base) return;
    for (let i = 0; i < count; i++) {
      const pos = this.ops.findSpawnTile(base.position.q, base.position.r, true);
      // Mark tile occupied immediately so next spawn in this batch picks a different tile
      Pathfinder.occupiedTiles.add(`${pos.q},${pos.r}`);
      const unit = UnitFactory.create(type, 1, pos);
      const wp = this.ops.hexToWorld(pos);
      unit.worldPosition = { ...wp };
      this.ops.addUnitToWorld(unit);
    }
    this.ops.showNotification(`🐛 Spawned ${count}x enemy ${type}`, '#b71c1c');
  }

  giveResources(): void {
    const players = this.ops.getPlayers();
    if (players.length === 0) return;
    this.ops.setWoodStockpile(this.ops.getWoodStockpile() + 999);
    players[0].resources.wood += 999;
    this.ops.setStoneStockpile(this.ops.getStoneStockpile() + 999);
    players[0].resources.stone += 999;
    this.ops.setFoodStockpile(this.ops.getFoodStockpile() + 999);
    players[0].resources.food += 999;
    this.ops.setGoldStockpile(this.ops.getGoldStockpile() + 999);
    players[0].resources.gold += 999;
    this.ops.setGrassFiberStockpile(this.ops.getGrassFiberStockpile() + 999);
    players[0].resources.grass_fiber += 999;
    this.ops.setClayStockpile(this.ops.getClayStockpile() + 999);
    players[0].resources.clay += 999;
    this.ops.setRopeStockpile(this.ops.getRopeStockpile() + 999);
    players[0].resources.rope += 999;
    this.ops.setIronStockpile(this.ops.getIronStockpile() + 999);
    players[0].resources.iron += 999;
    this.ops.setCharcoalStockpile(this.ops.getCharcoalStockpile() + 999);
    players[0].resources.charcoal += 999;
    this.ops.setSteelStockpile(this.ops.getSteelStockpile() + 999);
    players[0].resources.steel += 999;
    this.ops.setCrystalStockpile(this.ops.getCrystalStockpile() + 999);
    players[0].resources.crystal += 999;
    this.ops.updateResourceDisplay();
    this.ops.updateStockpileVisual(0);
    this.ops.showNotification('🐛 +999 all resources', '#4caf50');
  }

  killAllEnemy(): void {
    for (const unit of this.ops.getAllUnits()) {
      if (unit.owner === 1 && unit.state !== UnitState.DEAD) {
        unit.currentHealth = 0;
        unit.state = UnitState.DEAD;
        this.ops.removeUnitFromGame(unit);
      }
    }
    this.ops.showNotification('🐛 All enemies killed', '#e74c3c');
  }

  damageBase(owner: number, amount: number): void {
    const base = this.ops.getBases().find(b => b.owner === owner);
    if (!base) return;
    base.health = Math.max(0, base.health - amount);
    this.ops.updateBaseHealthBars();
    this.ops.showNotification(`🐛 Base ${owner} -${amount} hp (${base.health}/${base.maxHealth})`, '#ff5722');
  }

  healSelected(): void {
    const selected = this.ops.getSelectedUnits();
    if (selected.length === 0) {
      this.ops.showNotification('No units selected', '#999');
      return;
    }
    let healed = 0;
    for (const unit of selected) {
      if (unit.currentHealth < unit.stats.maxHealth) {
        unit.currentHealth = unit.stats.maxHealth;
        this.ops.updateHealthBar(unit);
        healed++;
      }
    }
    this.ops.showNotification(`💚 Healed ${healed} unit(s) to full`, '#27ae60');
  }

  killSelected(): void {
    const selected = this.ops.getSelectedUnits();
    if (selected.length === 0) {
      this.ops.showNotification('No units selected', '#999');
      return;
    }
    // Copy array since removeUnitFromGame modifies allUnits
    const toKill = [...selected];
    let killCount = 0;
    for (const unit of toKill) {
      unit.state = UnitState.DEAD;
      unit.currentHealth = 0;
      this.ops.removeUnitFromGame(unit);
      killCount++;
    }
    if (killCount > 0) {
      this.ops.showNotification(`💀 ${killCount} unit(s) killed`, '#e74c3c');
    }
  }

  buffSelected(stat: string): void {
    const selected = this.ops.getSelectedUnits();
    if (selected.length === 0) {
      this.ops.showNotification('No units selected', '#999');
      return;
    }
    for (const unit of selected) {
      switch (stat) {
        case 'attack':    unit.stats.attack += 3; break;
        case 'defense':   unit.stats.defense += 3; break;
        case 'maxHealth':
          unit.stats.maxHealth += 5;
          unit.currentHealth += 5;
          this.ops.updateHealthBar(unit);
          break;
        case 'moveSpeed':  unit.moveSpeed = Math.min(unit.moveSpeed + 0.2, 3.0); break;
        case 'range':      unit.stats.range += 1; break;
      }
    }
    const labels: Record<string, string> = {
      attack: '+3 ATK', defense: '+3 DEF', maxHealth: '+5 HP',
      moveSpeed: '+0.2 SPD', range: '+1 RNG',
    };
    this.ops.showNotification(`⚡ ${selected.length} unit(s) ${labels[stat] || stat}`, '#e91e63');
  }

  teleportSelected(target: HexCoord): void {
    const selected = this.ops.getSelectedUnits();
    if (selected.length === 0) return;
    for (const unit of selected) {
      unit.position = { ...target };
      const wp = this.ops.hexToWorld(target);
      unit.worldPosition = { ...wp };
      unit.targetPosition = null;
      unit.command = null;
      this.ops.setUnitWorldPosition(unit.id, wp.x, wp.y + this.ops.getElevation(target), wp.z);
    }
    this.ops.showNotification(`🌀 Teleported ${selected.length} unit(s)`, '#e91e63');
  }

  instantWin(): void {
    const base = this.ops.getBases().find(b => b.owner === 1);
    if (!base) return;
    base.health = 0;
    base.destroyed = true;
    this.ops.showBaseDestruction(base);
    this.ops.updateBaseHealthBars();
    this.ops.checkWinCondition();
  }

  instantLose(): void {
    const base = this.ops.getBases().find(b => b.owner === 0);
    if (!base) return;
    base.health = 0;
    base.destroyed = true;
    this.ops.showBaseDestruction(base);
    this.ops.updateBaseHealthBars();
    this.ops.checkWinCondition();
  }

  clearTrees(): void {
    const tiles = this.ops.getCurrentMapTiles();
    if (!tiles) return;
    let count = 0;
    for (const [key, tile] of tiles) {
      if (tile.terrain === TerrainType.FOREST) {
        tile.terrain = TerrainType.PLAINS;
        const [q, r] = key.split(',').map(Number);
        this.ops.removeDecoration({ q, r });
        this.ops.deleteTreeAge(key);
        this.ops.deleteTreeRegrowthTimer(key);
        count++;
      }
    }
    this.ops.showNotification(`🌲 Cleared ${count} trees`, '#6d4c41');
  }

  clearStones(): void {
    const tiles = this.ops.getCurrentMapTiles();
    if (!tiles) return;
    let count = 0;
    for (const [key, tile] of tiles) {
      if (tile.terrain === TerrainType.MOUNTAIN) {
        tile.terrain = TerrainType.PLAINS;
        if (tile.elevation > 4) tile.elevation = 4;
        const [q, r] = key.split(',').map(Number);
        this.ops.removeDecoration({ q, r });
        count++;
      }
    }
    if (count > 0) this.ops.rebuildVoxels();
    this.ops.showNotification(`🪨 Cleared ${count} stone tiles`, '#78909c');
  }

  // ===================== SPAWN TEST ARMIES =====================

  /** Role-based spawn depth — tanks front, melee mid, ranged back, siege far back */
  static readonly ROLE_DEPTH: Record<string, number> = {
    [UnitType.PALADIN]: 0, [UnitType.SHIELDBEARER]: 0, [UnitType.OGRE]: 0,
    [UnitType.WARRIOR]: 1, [UnitType.GREATSWORD]: 1,
    [UnitType.BERSERKER]: 1, [UnitType.ASSASSIN]: 1, [UnitType.RIDER]: 1, [UnitType.SCOUT]: 1,
    [UnitType.ARCHER]: 2, [UnitType.MAGE]: 2, [UnitType.BATTLEMAGE]: 2,
    [UnitType.HEALER]: 2,
    [UnitType.TREBUCHET]: 3,
  };

  /** Spawn a formation-arranged army for one player. */
  private spawnFormationArmy(
    owner: number, baseQ: number, baseR: number,
    defs: { type: UnitType; count: number }[], map: GameMap,
  ): number {
    const dir = owner === 0 ? 1 : -1;
    const units: { type: UnitType; depth: number }[] = [];
    for (const def of defs) {
      const depth = DebugController.ROLE_DEPTH[def.type] ?? 1;
      for (let i = 0; i < def.count; i++) units.push({ type: def.type, depth });
    }
    units.sort((a, b) => a.depth - b.depth);

    const depthCounts: Record<number, number> = {};
    for (const u of units) depthCounts[u.depth] = (depthCounts[u.depth] ?? 0) + 1;

    const lineCounters: Record<number, number> = {};
    let spawned = 0;

    for (const u of units) {
      const lineIdx = lineCounters[u.depth] ?? 0;
      lineCounters[u.depth] = lineIdx + 1;
      const qOffset = (2 - u.depth * 2) * dir;
      const lineWidth = 5;
      const subRow = Math.floor(lineIdx / lineWidth);
      const posInRow = lineIdx % lineWidth;
      const totalInDepth = depthCounts[u.depth] ?? 1;
      const rowSize = Math.min(lineWidth, totalInDepth);
      const rOffset = posInRow - Math.floor(rowSize / 2);
      const qExtra = subRow * dir;

      const pos = this.ops.findSpawnTile(baseQ + qOffset + qExtra, baseR + rOffset);
      const unit = UnitFactory.create(u.type, owner, pos);
      unit.worldPosition = this.ops.hexToWorld(pos);
      unit.stance = UnitStance.AGGRESSIVE;
      this.ops.getPlayers()[owner].units.push(unit);
      this.ops.addUnitToRenderer(unit, this.ops.getElevation(pos));
      Pathfinder.occupiedTiles.add(`${pos.q},${pos.r}`);
      spawned++;
    }
    return spawned;
  }

  spawnTestArmies(scale: number): void {
    const map = this.ops.getCurrentMap();
    if (!map || this.ops.getPlayers().length < 2) return;

    const armyComp = this.ops.getArmyComposition();
    const defaultDefs = [
      { type: UnitType.WARRIOR, count: 1 }, { type: UnitType.ARCHER, count: 1 },
      { type: UnitType.PALADIN, count: 1 }, { type: UnitType.MAGE, count: 1 },
      { type: UnitType.HEALER, count: 1 }, { type: UnitType.BERSERKER, count: 1 },
      { type: UnitType.ASSASSIN, count: 1 }, { type: UnitType.SHIELDBEARER, count: 1 },
      { type: UnitType.GREATSWORD, count: 1 },
    ];
    const blueDefs = armyComp.blue.length > 0 ? armyComp.blue : defaultDefs;
    const redDefs = armyComp.red.length > 0 ? armyComp.red : blueDefs;

    const scaledBlue = blueDefs.map(d => ({ type: d.type, count: d.count * scale }));
    const scaledRed = redDefs.map(d => ({ type: d.type, count: d.count * scale }));

    const bases = this.ops.getBases();
    let totalSpawned = 0;
    for (let owner = 0; owner < 2; owner++) {
      const base = bases.find(b => b.owner === owner && !b.destroyed);
      if (!base) continue;
      const defs = owner === 0 ? scaledBlue : scaledRed;
      totalSpawned += this.spawnFormationArmy(owner, base.position.q, base.position.r, defs, map);
    }

    this.ops.rebuildAllUnits();
    const foodNeeded = totalSpawned * FOOD_PER_COMBAT_UNIT + 50;
    for (let pid = 0; pid < 2; pid++) {
      const current = this.ops.getFoodForPlayer(pid);
      this.ops.setFoodForPlayer(pid, Math.max(current, foodNeeded));
      this.ops.setPlayerFoodResource(pid, Math.max(current, foodNeeded));
    }
    this.ops.updateResourceDisplay();
    this.ops.showNotification(`⚔️ Spawned ${totalSpawned} test units (${scale}x)`, '#00e676');
  }
}
