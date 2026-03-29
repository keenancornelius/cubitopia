// ============================================
// CUBITOPIA - Combat System
// Handles unit-vs-unit combat resolution
// ============================================

import { Unit } from '../../types';

export interface CombatResult {
  attackerDamage: number;
  defenderDamage: number;
  attackerSurvived: boolean;
  defenderSurvived: boolean;
  experienceGained: number;
}

export class CombatSystem {
  /**
   * Resolve combat between an attacker and defender
   * Uses a Polytopia-like damage formula
   */
  static resolve(attacker: Unit, defender: Unit): CombatResult {
    const attackForce = attacker.stats.attack * (attacker.currentHealth / attacker.stats.maxHealth);
    const defenseForce = defender.stats.defense * (defender.currentHealth / defender.stats.maxHealth);

    // Damage calculation
    const totalForce = attackForce + defenseForce;
    const attackerRatio = attackForce / totalForce;
    const defenderRatio = defenseForce / totalForce;

    const defenderDamage = Math.round(attackerRatio * attacker.stats.attack * 4.5);
    const attackerDamage = Math.round(defenderRatio * defender.stats.defense * 3.5);

    const attackerHealth = attacker.currentHealth - attackerDamage;
    const defenderHealth = defender.currentHealth - defenderDamage;

    return {
      attackerDamage,
      defenderDamage,
      attackerSurvived: attackerHealth > 0,
      defenderSurvived: defenderHealth > 0,
      experienceGained: defenderHealth <= 0 ? 3 : 1,
    };
  }

  /**
   * Apply combat results to units
   */
  static apply(attacker: Unit, defender: Unit, result: CombatResult): void {
    attacker.currentHealth -= result.attackerDamage;
    defender.currentHealth -= result.defenderDamage;
    attacker.hasActed = true;

    if (result.attackerSurvived) {
      attacker.experience += result.experienceGained;
      if (attacker.experience >= attacker.level * 5) {
        attacker.level++;
        attacker.currentHealth = attacker.stats.maxHealth;
      }
    }
  }

  /**
   * Calculate if a unit can attack another (range check)
   */
  static canAttack(attacker: Unit, defender: Unit): boolean {
    const dist = Math.abs(attacker.position.q - defender.position.q) +
      Math.abs(attacker.position.r - defender.position.r);
    return dist <= attacker.stats.range && !attacker.hasActed;
  }
}
