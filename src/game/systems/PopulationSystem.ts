// ============================================
// CUBITOPIA — Population System
// Food-based population cap. Workers are free;
// combat units cost 3 food each toward the cap.
// ============================================

import { Unit, UnitType, UnitState } from '../../types';
import { GAME_CONFIG } from '../GameConfig';

// --- Balance constants ---
export const FOOD_PER_COMBAT_UNIT = GAME_CONFIG.population.foodPerCombatUnit;
export const STARTING_FOOD = GAME_CONFIG.population.startingFood;

/** Unit types that DON'T count toward population cap (workers) */
const FREE_UNIT_TYPES: Set<UnitType> = new Set([
  UnitType.BUILDER,
  UnitType.LUMBERJACK,
  UnitType.VILLAGER,
]);

/** Slim ops interface — getAllUnits returns the master array (no allocation) */
export interface PopulationOps {
  getFoodStockpile(owner: number): number;
  getAllUnits(): Unit[];
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

  /** Max combat units allowed based on food stockpile */
  getPopulationCap(owner: number): number {
    const food = this.ops.getFoodStockpile(owner);
    return Math.floor(food / FOOD_PER_COMBAT_UNIT);
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
    if (ratio >= 0.9) return 'critical';
    if (ratio >= 0.7) return 'warning';
    return 'ok';
  }

  cleanup(): void {
    // Stateless — nothing to clean up
  }
}
