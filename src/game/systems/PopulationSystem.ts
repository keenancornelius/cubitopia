// ============================================
// CUBITOPIA — Population System
// Food-based population cap. Workers are free;
// combat units cost food toward the cap.
// Base tier provides bonus food capacity.
// ============================================

import { Unit, UnitType, UnitState } from '../../types';
import { GAME_CONFIG } from '../GameConfig';

// --- Balance constants ---
export const FOOD_PER_COMBAT_UNIT = GAME_CONFIG.population.foodPerCombatUnit;
export const STARTING_FOOD = GAME_CONFIG.population.startingFood;
export const BASE_FOOD_BONUS = GAME_CONFIG.population.baseFoodBonus;
export const FARMHOUSE_FOOD_BONUS = GAME_CONFIG.population.farmhouseFoodBonus;

// --- Morale constants ---
const MORALE = GAME_CONFIG.population.morale;

/** Unit types that DON'T count toward population cap (workers) */
const FREE_UNIT_TYPES: Set<UnitType> = new Set([
  UnitType.BUILDER,
  UnitType.LUMBERJACK,
  UnitType.VILLAGER,
]);

/** Warning thresholds for HUD display */
const WARNING_THRESHOLD = 0.7;
const CRITICAL_THRESHOLD = 0.9;

/** Morale state for HUD display and gameplay effects */
export type MoraleState = 'starving' | 'hungry' | 'normal' | 'well_fed';

/** Slim ops interface — getAllUnits returns the master array (no allocation) */
export interface PopulationOps {
  getFoodStockpile(owner: number): number;
  getAllUnits(): Unit[];
  /** Optional: get base tier for bonus food capacity (0=Camp, 1=Fort, 2=Castle) */
  getBaseTier?(owner: number): number;
  /** Optional: count farmhouses for bonus food storage */
  getFarmhouseCount?(owner: number): number;
}

/** Detailed population info for HUD display */
export interface PopulationInfo {
  current: number;    // Combat units alive
  cap: number;        // Max combat units from food
  total: number;      // All units (including workers)
  food: number;       // Current food stockpile
  foodPerUnit: number; // Food cost per combat unit
  warning: 'ok' | 'warning' | 'critical';
  headroom: number;   // How many more combat units can spawn
  baseTierBonus: number; // Bonus food from base tier
  farmhouseBonus: number; // Bonus food from farmhouses
  morale: MoraleState;   // Current morale state
  moraleModifier: number; // Attack/move speed multiplier from morale
}

export class PopulationSystem {
  private ops: PopulationOps;

  constructor(ops: PopulationOps) {
    this.ops = ops;
  }

  /** Is this unit type free (worker)? */
  static isFreeUnit(type: UnitType): boolean {
    return FREE_UNIT_TYPES.has(type);
  }

  /** Count combat (non-free) units that are alive for an owner — zero allocation */
  getCombatUnitCount(owner: number): number {
    let count = 0;
    const units = this.ops.getAllUnits();
    for (let i = 0, len = units.length; i < len; i++) {
      const u = units[i];
      if (u.owner !== owner) continue;
      if (u.currentHealth <= 0 || u.state === UnitState.DEAD) continue;
      if (FREE_UNIT_TYPES.has(u.type)) continue;
      count++;
    }
    return count;
  }

  /** Get total unit count (all alive, including workers) for display */
  getTotalUnitCount(owner: number): number {
    let count = 0;
    const units = this.ops.getAllUnits();
    for (let i = 0, len = units.length; i < len; i++) {
      const u = units[i];
      if (u.owner !== owner) continue;
      if (u.currentHealth <= 0 || u.state === UnitState.DEAD) continue;
      count++;
    }
    return count;
  }

  /** Get bonus food capacity from base tier */
  getBaseTierBonus(owner: number): number {
    if (!this.ops.getBaseTier) return 0;
    const tier = this.ops.getBaseTier(owner);
    return tier * BASE_FOOD_BONUS;
  }

  /** Get bonus food from farmhouses */
  getFarmhouseBonus(owner: number): number {
    if (!this.ops.getFarmhouseCount) return 0;
    return this.ops.getFarmhouseCount(owner) * FARMHOUSE_FOOD_BONUS;
  }

  /** Effective food for cap calculation = stockpile + base tier bonus + farmhouse bonus */
  getEffectiveFood(owner: number): number {
    return this.ops.getFoodStockpile(owner) + this.getBaseTierBonus(owner) + this.getFarmhouseBonus(owner);
  }

  /** Max combat units allowed based on food stockpile + base tier bonus */
  getPopulationCap(owner: number): number {
    const effectiveFood = this.getEffectiveFood(owner);
    return Math.floor(effectiveFood / FOOD_PER_COMBAT_UNIT);
  }

  /** Can we spawn another combat unit? */
  canSpawnCombatUnit(owner: number): boolean {
    return this.getCombatUnitCount(owner) < this.getPopulationCap(owner);
  }

  /** How many units over the cap are we? (0 if under/at cap) */
  getOverCapCount(owner: number): number {
    const used = this.getCombatUnitCount(owner);
    const cap = this.getPopulationCap(owner);
    return Math.max(0, used - cap);
  }

  /** How many more combat units can we spawn? */
  getHeadroom(owner: number): number {
    return Math.max(0, this.getPopulationCap(owner) - this.getCombatUnitCount(owner));
  }

  /**
   * Find excess combat units to disband when food drops below the cap.
   * Returns unit IDs to remove, prioritizing lowest-health units first.
   * Does NOT mutate any state — caller is responsible for removal.
   */
  findExcessUnits(owner: number): string[] {
    const overCap = this.getOverCapCount(owner);
    if (overCap <= 0) return [];

    // Gather combat units sorted by current health (lowest first = disband weakest)
    const combatUnits: Unit[] = [];
    const units = this.ops.getAllUnits();
    for (let i = 0, len = units.length; i < len; i++) {
      const u = units[i];
      if (u.owner !== owner) continue;
      if (u.currentHealth <= 0 || u.state === UnitState.DEAD) continue;
      if (FREE_UNIT_TYPES.has(u.type)) continue;
      combatUnits.push(u);
    }
    combatUnits.sort((a, b) => a.currentHealth - b.currentHealth);

    return combatUnits.slice(0, overCap).map(u => u.id);
  }

  /** Warning level for HUD display */
  getWarningLevel(owner: number): 'ok' | 'warning' | 'critical' {
    const cap = this.getPopulationCap(owner);
    if (cap <= 0) return 'critical';
    const used = this.getCombatUnitCount(owner);
    const ratio = used / cap;
    if (ratio >= CRITICAL_THRESHOLD) return 'critical';
    if (ratio >= WARNING_THRESHOLD) return 'warning';
    return 'ok';
  }

  /** Get detailed population info for HUD (zero allocation when called frequently) */
  getPopulationInfo(owner: number): PopulationInfo {
    const current = this.getCombatUnitCount(owner);
    const cap = this.getPopulationCap(owner);
    const baseTierBonus = this.getBaseTierBonus(owner);
    return {
      current,
      cap,
      total: this.getTotalUnitCount(owner),
      food: this.ops.getFoodStockpile(owner),
      foodPerUnit: FOOD_PER_COMBAT_UNIT,
      warning: this.getWarningLevel(owner),
      headroom: Math.max(0, cap - current),
      baseTierBonus,
      farmhouseBonus: this.getFarmhouseBonus(owner),
      morale: this.getMoraleState(owner),
      moraleModifier: this.getMoraleModifier(owner),
    };
  }

  /** How much food is needed to support one more combat unit from current state */
  getFoodNeededForNext(owner: number): number {
    const current = this.getCombatUnitCount(owner);
    const effectiveFood = this.getEffectiveFood(owner);
    const neededForNext = (current + 1) * FOOD_PER_COMBAT_UNIT;
    return Math.max(0, neededForNext - effectiveFood);
  }

  // ============================================
  // MORALE SYSTEM — food ratio drives combat effectiveness
  // ============================================

  /** Get food ratio: effectiveFood / foodNeeded. >1 = surplus, <1 = deficit */
  getFoodRatio(owner: number): number {
    const combatUnits = this.getCombatUnitCount(owner);
    if (combatUnits <= 0) return 2.0; // No combat units = well-fed by default
    const foodNeeded = combatUnits * FOOD_PER_COMBAT_UNIT;
    const effectiveFood = this.getEffectiveFood(owner);
    return effectiveFood / foodNeeded;
  }

  /** Get morale state based on food ratio */
  getMoraleState(owner: number): MoraleState {
    const ratio = this.getFoodRatio(owner);
    if (ratio < MORALE.starvingThreshold) return 'starving';
    if (ratio < MORALE.hungryThreshold) return 'hungry';
    if (ratio >= MORALE.wellFedThreshold) return 'well_fed';
    return 'normal';
  }

  /** Get morale modifier — multiplier for attack speed and move speed */
  getMoraleModifier(owner: number): number {
    const state = this.getMoraleState(owner);
    switch (state) {
      case 'starving': return MORALE.starvingModifier;
      case 'hungry': return MORALE.hungryModifier;
      case 'well_fed': return MORALE.wellFedModifier;
      default: return MORALE.normalModifier;
    }
  }

  /**
   * Apply starvation damage to combat units when starving.
   * Called once per game tick. Returns total damage dealt for HUD feedback.
   */
  applyStarvationDrain(owner: number, delta: number): number {
    if (this.getMoraleState(owner) !== 'starving') return 0;
    const drainPerSec = MORALE.starvingHealthDrain;
    const drain = drainPerSec * delta;
    let totalDamage = 0;

    const units = this.ops.getAllUnits();
    for (let i = 0, len = units.length; i < len; i++) {
      const u = units[i];
      if (u.owner !== owner) continue;
      if (u.currentHealth <= 0 || u.state === UnitState.DEAD) continue;
      if (FREE_UNIT_TYPES.has(u.type)) continue; // Workers don't starve
      u.currentHealth = Math.max(1, u.currentHealth - drain); // Don't kill, leave at 1 HP
      totalDamage += drain;
    }
    return totalDamage;
  }

  cleanup(): void {
    // Stateless — nothing to clean up
  }
}
