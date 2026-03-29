// ============================================
// CUBITOPIA - Combat System
// Handles unit-vs-unit combat resolution + Phase 1 ability modifiers
// ============================================

import { Unit, UnitType } from '../../types';

export interface CombatResult {
  attackerDamage: number;
  defenderDamage: number;
  attackerSurvived: boolean;
  defenderSurvived: boolean;
  experienceGained: number;
}

export class CombatSystem {
  /**
   * Resolve combat between an attacker and defender.
   * Accounts for berserker rage, shieldbearer aura, assassin burst.
   */
  static resolve(attacker: Unit, defender: Unit, allUnits?: Unit[]): CombatResult {
    let atkStat = attacker.stats.attack;
    let defStat = defender.stats.defense;

    // --- Berserker Rage: bonus attack scaling with missing HP ---
    if (attacker.type === UnitType.BERSERKER) {
      const missingHpRatio = 1 - (attacker.currentHealth / attacker.stats.maxHealth);
      atkStat += Math.round(missingHpRatio * 4); // Up to +4 attack at 1 HP
    }

    // --- Assassin Burst: first strike bonus when attacking from full HP ---
    if (attacker.type === UnitType.ASSASSIN && attacker.currentHealth === attacker.stats.maxHealth) {
      atkStat += 3; // Ambush bonus
    }

    // --- Shieldbearer Aura: adjacent allies get +2 defense ---
    if (allUnits && defender.type !== UnitType.SHIELDBEARER) {
      for (const ally of allUnits) {
        if (ally.type === UnitType.SHIELDBEARER && ally.owner === defender.owner &&
            ally.currentHealth > 0 && ally !== defender) {
          const dist = Math.abs(ally.position.q - defender.position.q) +
                       Math.abs(ally.position.r - defender.position.r);
          if (dist <= 2) {
            defStat += 2;
            break; // Only one aura stacks
          }
        }
      }
    }

    const attackForce = atkStat * (attacker.currentHealth / attacker.stats.maxHealth);
    const defenseForce = defStat * (defender.currentHealth / defender.stats.maxHealth);

    const totalForce = attackForce + defenseForce;
    const attackerRatio = attackForce / totalForce;
    const defenderRatio = defenseForce / totalForce;

    const defenderDamage = Math.round(attackerRatio * atkStat * 4.5);

    // Counter-attack: defender can only retaliate if attacker is within defender's range.
    // Ranged units attacking from outside melee range take zero counter-damage.
    const dist = Math.abs(attacker.position.q - defender.position.q) +
                 Math.abs(attacker.position.r - defender.position.r);
    const canCounter = dist <= defender.stats.range;
    const attackerDamage = canCounter ? Math.round(defenderRatio * defStat * 3.5) : 0;

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
   * Healer tick — heal adjacent allies each frame.
   * Returns array of healed unit IDs (for VFX).
   */
  static processHealerTick(healer: Unit, allUnits: Unit[], delta: number): string[] {
    if (healer.type !== UnitType.HEALER || healer.currentHealth <= 0) return [];
    // Heal cooldown reuse: healers "attack" to heal
    healer.attackCooldown -= delta;
    if (healer.attackCooldown > 0) return [];
    healer.attackCooldown = 1.5; // Heal every 1.5 seconds

    const healed: string[] = [];
    const healRange = healer.stats.range; // 2 hex range
    const healAmount = 2;

    for (const ally of allUnits) {
      if (ally.owner !== healer.owner || ally === healer || ally.currentHealth <= 0) continue;
      if (ally.currentHealth >= ally.stats.maxHealth) continue;
      const dist = Math.abs(ally.position.q - healer.position.q) +
                   Math.abs(ally.position.r - healer.position.r);
      if (dist <= healRange) {
        ally.currentHealth = Math.min(ally.stats.maxHealth, ally.currentHealth + healAmount);
        healed.push(ally.id);
      }
    }
    return healed;
  }

  /**
   * Battlemage AoE — damages all enemies within 1 hex of target.
   * Called after normal combat resolve to apply splash.
   */
  static applyBattlemageAoE(attacker: Unit, target: Unit, allUnits: Unit[]): string[] {
    if (attacker.type !== UnitType.BATTLEMAGE) return [];
    const splashed: string[] = [];
    const splashDamage = Math.max(1, Math.round(attacker.stats.attack * 0.4));

    for (const unit of allUnits) {
      if (unit.owner === attacker.owner || unit === target || unit.currentHealth <= 0) continue;
      const dist = Math.abs(unit.position.q - target.position.q) +
                   Math.abs(unit.position.r - target.position.r);
      if (dist <= 1) {
        unit.currentHealth = Math.max(0, unit.currentHealth - splashDamage);
        splashed.push(unit.id);
      }
    }
    return splashed;
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
