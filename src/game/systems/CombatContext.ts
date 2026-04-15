// ============================================
// CUBITOPIA - Combat Context Module
// ============================================
// This module contains shared types and interfaces for combat systems.
// It breaks the circular dependency: StatusEffectSystem, UnitAI, and CombatSystem
// all need to communicate about damage, status effects, and combat queries without
// importing each other directly.

import { ElementType, UnitType } from '../../types';

/** Represents a combat action (damage, status application, etc.) */
export interface CombatEvent {
  /** Damage amount (can be 0 for status-only effects) */
  damage: number;
  /** Damage type/element */
  element: ElementType;
  /** Source unit ID */
  sourceUnitId: string;
  /** Target unit ID */
  targetUnitId: string;
  /** Whether this is a critical hit */
  isCrit: boolean;
  /** Optional status effect to apply */
  statusEffect?: StatusEffectApplication;
  /** Timestamp (game frame) when the damage occurs */
  gameFrame: number;
}

/** Represents a status effect application */
export interface StatusEffectApplication {
  type: string; // 'wet', 'ablaze', 'electrocute', etc.
  duration: number; // In game frames
  sourceUnitId: string;
  /** For synergy effects, which effect this consumed */
  consumedEffect?: string;
}

/** Query object for combat-related state checks */
export interface CombatQuery {
  /** Can this unit take damage right now? */
  canTakeDamage(unitId: string): boolean;
  /** Get status effect of a unit */
  getStatus(unitId: string, statusType: string): StatusEffectApplication | null;
  /** Check if unit has any status effect */
  hasAnyStatus(unitId: string): boolean;
  /** Get unit's remaining health */
  getHealth(unitId: string): number;
  /** Get unit's max health */
  getMaxHealth(unitId: string): number;
  /** Check if unit is alive */
  isAlive(unitId: string): boolean;
}

/** Callback for combat events */
export type CombatEventListener = (event: CombatEvent) => void;

/** Damage cap constraint (used by UI, AI, and combat system) */
export interface DamageCap {
  /** Maximum damage per hit */
  maxDamagePerHit: number;
  /** Damage reduction multiplier (0.0 to 1.0) */
  reduction: number;
  /** Reason for the cap (for logging) */
  reason: string;
}

/** Synergy effect definition */
export interface SynergyEffect {
  /** Primary element type */
  primary: ElementType;
  /** Secondary element type */
  secondary: ElementType;
  /** Resulting effect name */
  result: string;
  /** Damage multiplier for synergy hit */
  damageMultiplier: number;
  /** Additional effects (e.g., chain, aoe, heal) */
  effects: string[];
}
