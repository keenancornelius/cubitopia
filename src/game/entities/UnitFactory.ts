// ============================================
// CUBITOPIA - Unit Factory (Data-Driven)
// Single config table per unit type — adding a new unit = adding one entry
// ============================================

import { Unit, UnitType, UnitStats, UnitState, UnitStance, HexCoord } from '../../types';

// --- Unified Unit Config Table ---
// Every per-type value lives here. No switch/ternary chains elsewhere.
export interface UnitConfig {
  stats: UnitStats;
  moveSpeed: number;      // world units per second
  attackSpeed: number;     // attacks per second
  color: number;           // hex color for rendering
  carryCapacity: number;   // resource carry limit
  isSiege: boolean;        // can damage walls/buildings
}

export const UNIT_CONFIG: Record<UnitType, UnitConfig> = {
  [UnitType.WARRIOR]: {
    stats: { maxHealth: 10, attack: 3, defense: 3, movement: 2, range: 1 },
    moveSpeed: 1.5, attackSpeed: 1.0, color: 0xc0392b,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.ARCHER]: {
    stats: { maxHealth: 8, attack: 3, defense: 1, movement: 2, range: 4 },
    moveSpeed: 1.3, attackSpeed: 1.5, color: 0x27ae60,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.RIDER]: {
    stats: { maxHealth: 10, attack: 3, defense: 2, movement: 4, range: 1 },
    moveSpeed: 3.0, attackSpeed: 1.2, color: 0xf39c12,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.PALADIN]: {
    stats: { maxHealth: 15, attack: 1, defense: 5, movement: 1, range: 1 },
    moveSpeed: 0.8, attackSpeed: 0.6, color: 0x7f8c8d,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.CATAPULT]: {
    stats: { maxHealth: 6, attack: 6, defense: 0, movement: 1, range: 4 },
    moveSpeed: 0.6, attackSpeed: 0.3, color: 0x8e44ad,
    carryCapacity: 4, isSiege: true,
  },
  [UnitType.TREBUCHET]: {
    stats: { maxHealth: 8, attack: 9, defense: 0, movement: 1, range: 6 },
    moveSpeed: 0.4, attackSpeed: 0.2, color: 0x5d4037,
    carryCapacity: 4, isSiege: true,
  },
  [UnitType.SCOUT]: {
    stats: { maxHealth: 6, attack: 1, defense: 1, movement: 5, range: 1 },
    moveSpeed: 3.5, attackSpeed: 1.5, color: 0x2ecc71,
    carryCapacity: 5, isSiege: false,
  },
  [UnitType.MAGE]: {
    stats: { maxHealth: 8, attack: 5, defense: 1, movement: 2, range: 2 },
    moveSpeed: 1.2, attackSpeed: 0.8, color: 0x2980b9,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.BUILDER]: {
    stats: { maxHealth: 8, attack: 1, defense: 2, movement: 2, range: 1 },
    moveSpeed: 1.0, attackSpeed: 0.5, color: 0xd4a574,
    carryCapacity: 4, isSiege: false,
  },
  [UnitType.LUMBERJACK]: {
    stats: { maxHealth: 8, attack: 2, defense: 1, movement: 2, range: 1 },
    moveSpeed: 1.2, attackSpeed: 0.8, color: 0x6d4c41,
    carryCapacity: 6, isSiege: false,
  },
  [UnitType.VILLAGER]: {
    stats: { maxHealth: 7, attack: 1, defense: 1, movement: 2, range: 1 },
    moveSpeed: 1.0, attackSpeed: 0.6, color: 0xdaa520,
    carryCapacity: 5, isSiege: false,
  },
};

// Backward-compat export — UnitRenderer imports this
export const UNIT_COLORS: Record<UnitType, number> = Object.fromEntries(
  Object.entries(UNIT_CONFIG).map(([k, v]) => [k, v.color])
) as Record<UnitType, number>;

let nextUnitId = 0;

export class UnitFactory {
  static create(type: UnitType, owner: number, position: HexCoord): Unit {
    const cfg = UNIT_CONFIG[type];
    const stats = { ...cfg.stats };
    return {
      id: `unit_${nextUnitId++}`,
      type,
      owner,
      position: { ...position },
      worldPosition: { x: 0, y: 0, z: 0 },
      targetPosition: null,
      command: null,
      state: UnitState.IDLE,
      stats,
      currentHealth: stats.maxHealth,
      movementLeft: stats.movement,
      hasActed: false,
      level: 1,
      experience: 0,
      attackCooldown: 0,
      gatherCooldown: 0,
      moveSpeed: cfg.moveSpeed,
      attackSpeed: cfg.attackSpeed,
      carryAmount: 0,
      carryCapacity: cfg.carryCapacity,
      carryType: null,
      stance: UnitStance.DEFENSIVE,
      isSiege: cfg.isSiege,
    };
  }

  static getStats(type: UnitType): UnitStats {
    return { ...UNIT_CONFIG[type].stats };
  }

  static getConfig(type: UnitType): UnitConfig {
    return UNIT_CONFIG[type];
  }
}
