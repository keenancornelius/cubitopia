// ============================================
// CUBITOPIA - Unit Factory
// Creates units with proper stats for RTS gameplay
// ============================================

import { Unit, UnitType, UnitStats, UnitState, UnitStance, HexCoord, ResourceType } from '../../types';

// Base stats for each unit type
const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.WARRIOR]: {
    maxHealth: 10,
    attack: 3,
    defense: 3,
    movement: 2,
    range: 1,
  },
  [UnitType.ARCHER]: {
    maxHealth: 8,
    attack: 3,
    defense: 1,
    movement: 2,
    range: 4,
  },
  [UnitType.RIDER]: {
    maxHealth: 10,
    attack: 3,
    defense: 2,
    movement: 4,
    range: 1,
  },
  [UnitType.PALADIN]: {
    maxHealth: 15,
    attack: 1,
    defense: 5,
    movement: 1,
    range: 1,
  },
  [UnitType.CATAPULT]: {
    maxHealth: 6,
    attack: 6,
    defense: 0,
    movement: 1,
    range: 4,
  },
  [UnitType.TREBUCHET]: {
    maxHealth: 8,
    attack: 9,
    defense: 0,
    movement: 1,
    range: 6,
  },
  [UnitType.SCOUT]: {
    maxHealth: 6,
    attack: 1,
    defense: 1,
    movement: 5,
    range: 1,
  },
  [UnitType.MAGE]: {
    maxHealth: 8,
    attack: 5,
    defense: 1,
    movement: 2,
    range: 2,
  },
  [UnitType.BUILDER]: {
    maxHealth: 8,
    attack: 1,
    defense: 2,
    movement: 2,
    range: 1,
  },
  [UnitType.LUMBERJACK]: {
    maxHealth: 8,
    attack: 2,
    defense: 1,
    movement: 2,
    range: 1,
  },
  [UnitType.VILLAGER]: {
    maxHealth: 7,
    attack: 1,
    defense: 1,
    movement: 2,
    range: 1,
  },
};

// Move speed multipliers per unit type (world units per second)
const UNIT_MOVE_SPEEDS: Record<UnitType, number> = {
  [UnitType.WARRIOR]: 1.5,
  [UnitType.ARCHER]: 1.3,
  [UnitType.RIDER]: 3.0,
  [UnitType.PALADIN]: 0.8,
  [UnitType.CATAPULT]: 0.6,
  [UnitType.TREBUCHET]: 0.4,
  [UnitType.SCOUT]: 3.5,
  [UnitType.MAGE]: 1.2,
  [UnitType.BUILDER]: 1.0,
  [UnitType.LUMBERJACK]: 1.2,
  [UnitType.VILLAGER]: 1.0,
};

// Attack speed (attacks per second)
const UNIT_ATTACK_SPEEDS: Record<UnitType, number> = {
  [UnitType.WARRIOR]: 1.0,
  [UnitType.ARCHER]: 1.5,
  [UnitType.RIDER]: 1.2,
  [UnitType.PALADIN]: 0.6,
  [UnitType.CATAPULT]: 0.3,
  [UnitType.TREBUCHET]: 0.2,
  [UnitType.SCOUT]: 1.5,
  [UnitType.MAGE]: 0.8,
  [UnitType.BUILDER]: 0.5,
  [UnitType.LUMBERJACK]: 0.8,
  [UnitType.VILLAGER]: 0.6,
};

// Colors for rendering each unit type (used by UnitRenderer)
export const UNIT_COLORS: Record<UnitType, number> = {
  [UnitType.WARRIOR]: 0xc0392b,   // red
  [UnitType.ARCHER]: 0x27ae60,    // green
  [UnitType.RIDER]: 0xf39c12,     // orange
  [UnitType.PALADIN]: 0x7f8c8d,  // gray
  [UnitType.CATAPULT]: 0x8e44ad,  // purple
  [UnitType.TREBUCHET]: 0x5d4037, // dark wood brown
  [UnitType.SCOUT]: 0x2ecc71,     // light green
  [UnitType.MAGE]: 0x2980b9,      // blue
  [UnitType.BUILDER]: 0xd4a574,   // tan/brown (construction worker)
  [UnitType.LUMBERJACK]: 0x6d4c41, // dark brown (woodsman)
  [UnitType.VILLAGER]: 0xdaa520,   // goldenrod (farmer)
};

let nextUnitId = 0;

export class UnitFactory {
  static create(type: UnitType, owner: number, position: HexCoord): Unit {
    const stats = { ...UNIT_STATS[type] };
    return {
      id: `unit_${nextUnitId++}`,
      type,
      owner,
      position: { ...position },
      worldPosition: { x: 0, y: 0, z: 0 }, // Set by caller after hex→world conversion
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
      moveSpeed: UNIT_MOVE_SPEEDS[type],
      attackSpeed: UNIT_ATTACK_SPEEDS[type],
      carryAmount: 0,
      carryCapacity: type === UnitType.LUMBERJACK ? 6 : type === UnitType.VILLAGER ? 5 : type === UnitType.SCOUT ? 5 : 4,
      carryType: null,
      stance: UnitStance.DEFENSIVE, // Default: attack enemies that enter range
      isSiege: type === UnitType.TREBUCHET || type === UnitType.CATAPULT,
    };
  }

  static getStats(type: UnitType): UnitStats {
    return { ...UNIT_STATS[type] };
  }
}
