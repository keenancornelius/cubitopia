// ============================================
// CUBITOPIA - Combat System
// Handles unit-vs-unit combat resolution + ability modifiers
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
   * Greatsword Cleave — hits all enemies within 1 hex of the primary target.
   * Deals 60% of base attack as cleave damage and knocks victims back 1 hex away from attacker.
   * Returns array of { unitId, knockbackQ, knockbackR } for knocked-back units.
   */
  static applyGreatswordCleave(
    attacker: Unit, target: Unit, allUnits: Unit[],
    isTileBlocked: (q: number, r: number) => boolean
  ): { unitId: string; knockQ: number; knockR: number }[] {
    if (attacker.type !== UnitType.GREATSWORD) return [];
    const results: { unitId: string; knockQ: number; knockR: number }[] = [];
    const cleaveDamage = Math.max(1, Math.round(attacker.stats.attack * 0.6));

    // Collect all enemies within 1 hex of attacker (cleave radius)
    const victims: Unit[] = [];
    for (const unit of allUnits) {
      if (unit.owner === attacker.owner || unit.currentHealth <= 0) continue;
      const dist = Math.abs(unit.position.q - attacker.position.q) +
                   Math.abs(unit.position.r - attacker.position.r);
      if (dist <= 1 && unit !== target) {
        victims.push(unit);
      }
    }

    // Apply cleave damage to secondary targets
    for (const victim of victims) {
      victim.currentHealth = Math.max(0, victim.currentHealth - cleaveDamage);
    }

    // Apply knockback to ALL hit enemies (primary target + cleave victims)
    const allHit = [target, ...victims];
    for (const victim of allHit) {
      if (victim.currentHealth <= 0) continue;
      // Calculate knockback direction: away from attacker
      const dq = victim.position.q - attacker.position.q;
      const dr = victim.position.r - attacker.position.r;
      // Normalize to 1 hex step in the dominant direction
      let kq = 0, kr = 0;
      if (Math.abs(dq) >= Math.abs(dr)) {
        kq = dq > 0 ? 1 : (dq < 0 ? -1 : 0);
      } else {
        kr = dr > 0 ? 1 : (dr < 0 ? -1 : 0);
      }
      // If dq == 0 and dr == 0, push in a default direction
      if (kq === 0 && kr === 0) kq = 1;

      const newQ = victim.position.q + kq;
      const newR = victim.position.r + kr;

      // Only knockback if destination is not blocked
      if (!isTileBlocked(newQ, newR)) {
        results.push({ unitId: victim.id, knockQ: newQ, knockR: newR });
      }
    }
    return results;
  }

  /**
   * Shieldbearer Shield Bash — knocks the primary target 1 hex away from attacker.
   * No extra damage, pure displacement. Returns knockback info or null.
   */
  static applyShieldBash(
    attacker: Unit, target: Unit,
    isTileBlocked: (q: number, r: number) => boolean
  ): { unitId: string; knockQ: number; knockR: number } | null {
    if (attacker.type !== UnitType.SHIELDBEARER) return null;
    if (target.currentHealth <= 0) return null;
    const dq = target.position.q - attacker.position.q;
    const dr = target.position.r - attacker.position.r;
    let kq = 0, kr = 0;
    if (Math.abs(dq) >= Math.abs(dr)) {
      kq = dq > 0 ? 1 : (dq < 0 ? -1 : 0);
    } else {
      kr = dr > 0 ? 1 : (dr < 0 ? -1 : 0);
    }
    if (kq === 0 && kr === 0) kq = 1;
    const newQ = target.position.q + kq;
    const newR = target.position.r + kr;
    if (!isTileBlocked(newQ, newR)) {
      return { unitId: target.id, knockQ: newQ, knockR: newR };
    }
    return null;
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
