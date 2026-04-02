// ============================================
// CUBITOPIA - Combat System
// Handles unit-vs-unit combat resolution + ability modifiers
// ============================================

import { Unit, UnitType, GameMap } from '../../types';
import { CombatLog } from '../../ui/ArenaDebugConsole';
import { GAME_CONFIG } from '../GameConfig';

export interface CombatResult {
  attackerDamage: number;
  defenderDamage: number;
  attackerSurvived: boolean;
  defenderSurvived: boolean;
  experienceGained: number;
  deflected?: boolean;  // True when a shield unit deflects a ranged attack
  blocked?: boolean;    // True when defender parries a melee attack (reduced damage + block anim)
}

export class CombatSystem {
  /** Correct hex distance for offset coordinates (odd-q) */
  static hexDist(q1: number, r1: number, q2: number, r2: number): number {
    // Convert offset (odd-q) to cube coordinates, same as Pathfinder
    const x1 = q1, z1 = r1 - (q1 - (q1 & 1)) / 2, y1 = -x1 - z1;
    const x2 = q2, z2 = r2 - (q2 - (q2 & 1)) / 2, y2 = -x2 - z2;
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
  }

  /**
   * Resolve combat between an attacker and defender.
   * Accounts for berserker rage, shieldbearer aura, assassin burst.
   */
  static resolve(attacker: Unit, defender: Unit, allUnits?: Unit[], map?: GameMap): CombatResult {
    let atkStat = attacker.stats.attack;
    let defStat = defender.stats.defense;

    // --- High Ground Bonus: elevation advantage gives +2 attack or +2 defense ---
    if (map) {
      const atkTile = map.tiles.get(`${attacker.position.q},${attacker.position.r}`);
      const defTile = map.tiles.get(`${defender.position.q},${defender.position.r}`);
      if (atkTile && defTile) {
        const atkElev = atkTile.walkableFloor ?? atkTile.elevation;
        const defElev = defTile.walkableFloor ?? defTile.elevation;
        const elevDiff = atkElev - defElev;
        if (elevDiff >= GAME_CONFIG.combat.highGround.threshold) {
          atkStat += GAME_CONFIG.combat.highGround.attackBonus; // Attacker has high ground — bonus attack
        } else if (elevDiff <= -GAME_CONFIG.combat.highGround.threshold) {
          defStat += GAME_CONFIG.combat.highGround.defenseBonus; // Defender has high ground — bonus defense
        }
      }
    }

    // --- Berserker Rage: bonus attack scaling with missing HP ---
    if (attacker.type === UnitType.BERSERKER) {
      // Axe throw (ranged opener) deals reduced damage — 40% of base attack
      if (attacker._axeThrowReady) {
        atkStat = Math.ceil(atkStat * GAME_CONFIG.combat.berserker.axeThrowDamageMultiplier);
      }
      const missingHpRatio = 1 - (attacker.currentHealth / attacker.stats.maxHealth);
      atkStat += Math.round(missingHpRatio * GAME_CONFIG.combat.berserker.rageAttackBonusMax); // Up to +4 attack at 1 HP
    }

    // --- Assassin Burst: first strike bonus when attacking from full HP ---
    if (attacker.type === UnitType.ASSASSIN && attacker.currentHealth === attacker.stats.maxHealth) {
      atkStat += GAME_CONFIG.combat.assassin.fullHealthAttackBonus; // Ambush bonus
    }

    // --- Paladin Holy Aura: adjacent allies get +2 defense ---
    if (allUnits && defender.type !== UnitType.PALADIN) {
      for (const ally of allUnits) {
        if (ally.type === UnitType.PALADIN && ally.owner === defender.owner &&
            ally.currentHealth > 0 && ally !== defender) {
          const dist = CombatSystem.hexDist(ally.position.q, ally.position.r, defender.position.q, defender.position.r);
          if (dist <= GAME_CONFIG.combat.paladin.auraRange) {
            defStat += GAME_CONFIG.combat.paladin.auraDefenseBonus;
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

    let defenderDamage = Math.round(attackerRatio * atkStat * GAME_CONFIG.combat.damage.attackerMultiplier);

    // --- Shared flags ---
    const isRangedAttacker = attacker.stats.range > 1;
    const isShieldDefender = defender.type === UnitType.SHIELDBEARER || defender.type === UnitType.PALADIN;

    // --- Melee Block/Parry: melee defenders can block melee attacks ---
    // Block chance scales with defender's defense stat: ~15% at def=1, ~40% at def=6, ~55% at def=10
    // Shieldbearers/paladins get a flat +15% bonus. Assassins can't be blocked (too fast).
    const isMeleeAttacker = attacker.stats.range <= 1;
    const isMeleeDefender = defender.stats.range <= 1 || isShieldDefender;
    const isUnblockable = attacker.type === UnitType.ASSASSIN;
    let blocked = false;
    if (isMeleeAttacker && isMeleeDefender && !isUnblockable) {
      const baseBlockChance = Math.min(
        GAME_CONFIG.combat.block.baseCap,
        GAME_CONFIG.combat.block.baseChance + defStat * GAME_CONFIG.combat.block.defenseScaling
      );
      const shieldBonus = isShieldDefender ? GAME_CONFIG.combat.block.shieldBonus : 0;
      const blockChance = Math.min(GAME_CONFIG.combat.block.finalCap, baseBlockChance + shieldBonus);
      if (Math.random() < blockChance) {
        blocked = true;
        defenderDamage = Math.max(1, Math.round(defenderDamage * GAME_CONFIG.combat.block.damageMultiplier)); // 65% damage reduction on block
      }
    }

    // --- Shield Deflect: shieldbearers and paladins take 80% reduced damage from ranged attacks ---
    const deflected = isRangedAttacker && isShieldDefender;
    if (deflected) {
      defenderDamage = Math.max(1, Math.round(defenderDamage * GAME_CONFIG.combat.deflect.damageMultiplier)); // 80% reduction, min 1
    }

    // Counter-attack: defender can only retaliate if attacker is within defender's range.
    // Ranged units attacking from outside melee range take zero counter-damage.
    const dist = CombatSystem.hexDist(attacker.position.q, attacker.position.r, defender.position.q, defender.position.r);
    const canCounter = dist <= defender.stats.range;
    const attackerDamage = canCounter ? Math.round(defenderRatio * defStat * GAME_CONFIG.combat.damage.counterMultiplier) : 0;

    const attackerHealth = attacker.currentHealth - attackerDamage;
    const defenderHealth = defender.currentHealth - defenderDamage;

    return {
      attackerDamage,
      defenderDamage,
      attackerSurvived: attackerHealth > 0,
      defenderSurvived: defenderHealth > 0,
      experienceGained: defenderHealth <= 0 ? GAME_CONFIG.combat.experience.kill : GAME_CONFIG.combat.experience.hit,
      deflected,
      blocked,
    };
  }

  /**
   * Apply combat results to units
   */
  static apply(attacker: Unit, defender: Unit, result: CombatResult): { xpGained: number; leveledUp: boolean; newLevel: number } {
    attacker.currentHealth -= result.attackerDamage;
    defender.currentHealth -= result.defenderDamage;
    // Note: hasActed is NOT set here — real-time combat uses attackCooldown instead

    let xpGained = 0;
    let leveledUp = false;
    let newLevel = attacker.level;

    if (result.attackerSurvived) {
      xpGained = result.experienceGained;
      attacker.experience += xpGained;
      if (attacker.experience >= attacker.level * GAME_CONFIG.combat.experience.levelThresholdMultiplier) {
        attacker.level++;
        newLevel = attacker.level;
        leveledUp = true;
        // Partial heal on level-up: restore 30% of max HP (not full heal)
        const healAmt = Math.round(attacker.stats.maxHealth * GAME_CONFIG.combat.experience.levelUpHealRatio);
        attacker.currentHealth = Math.min(attacker.stats.maxHealth, attacker.currentHealth + healAmt);
      }
    }
    return { xpGained, leveledUp, newLevel };
  }

  /**
   * Healer tick — caster heal: picks the most-injured ally in range,
   * fires a heal projectile at them. Returns single-element array with
   * the target ID (for VFX projectile) or empty if no valid target.
   * Actual HP is applied on projectile impact (deferred via event).
   */
  static processHealerTick(healer: Unit, allUnits: Unit[], delta: number): string[] {
    if (healer.type !== UnitType.HEALER || healer.currentHealth <= 0) return [];
    healer.attackCooldown -= delta;
    if (healer.attackCooldown > 0) return [];

    const healRange = healer.stats.range; // 2 hex range
    let bestTarget: Unit | null = null;
    let bestScore = -Infinity;

    for (const ally of allUnits) {
      if (ally.owner !== healer.owner || ally === healer || ally.currentHealth <= 0) continue;
      if (ally.currentHealth >= ally.stats.maxHealth) continue;
      const dist = CombatSystem.hexDist(ally.position.q, ally.position.r, healer.position.q, healer.position.r);
      if (dist > healRange) continue;
      // Score: prioritize lowest HP ratio, break ties by proximity
      const hpMissing = 1 - (ally.currentHealth / ally.stats.maxHealth);
      const score = hpMissing * 10 - dist;
      if (score > bestScore) { bestScore = score; bestTarget = ally; }
    }

    if (!bestTarget) return [];
    healer.attackCooldown = GAME_CONFIG.combat.healer.projectileCooldown; // Slightly longer cooldown for projectile heal
    return [bestTarget.id]; // Single target — projectile handles HP on impact
  }

  /**
   * Apply heal HP on projectile impact (called when heal orb arrives).
   */
  static applyHeal(healer: Unit, target: Unit): number {
    if (target.currentHealth <= 0 || target.currentHealth >= target.stats.maxHealth) return 0;
    const healAmount = GAME_CONFIG.combat.healer.healAmount; // Slightly stronger per-cast since it's single-target
    const actual = Math.min(healAmount, target.stats.maxHealth - target.currentHealth);
    target.currentHealth += actual;
    CombatLog.logHeal(healer, target, actual);
    return actual;
  }

  /**
   * Battlemage AoE — damages all enemies within 1 hex of target.
   * Called after normal combat resolve to apply splash.
   */
  static applyBattlemageAoE(attacker: Unit, target: Unit, allUnits: Unit[]): string[] {
    if (attacker.type !== UnitType.BATTLEMAGE) return [];
    const splashed: string[] = [];
    const splashDamage = Math.max(1, Math.round(attacker.stats.attack * GAME_CONFIG.combat.battlemage.splashDamageMultiplier));

    for (const unit of allUnits) {
      if (unit.owner === attacker.owner || unit === target || unit.currentHealth <= 0) continue;
      const dist = CombatSystem.hexDist(unit.position.q, unit.position.r, target.position.q, target.position.r);
      if (dist <= GAME_CONFIG.combat.battlemage.splashRadius) {
        unit.currentHealth = Math.max(0, unit.currentHealth - splashDamage);
        splashed.push(unit.id);
        CombatLog.logSplash(attacker, unit.id, unit.type);
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
    const cleaveDamage = Math.max(1, Math.round(attacker.stats.attack * GAME_CONFIG.combat.greatsword.cleaveDamageMultiplier));

    // Collect all enemies within 1 hex of attacker (cleave radius)
    const victims: Unit[] = [];
    for (const unit of allUnits) {
      if (unit.owner === attacker.owner || unit.currentHealth <= 0) continue;
      const dist = CombatSystem.hexDist(unit.position.q, unit.position.r, attacker.position.q, attacker.position.r);
      if (dist <= GAME_CONFIG.combat.greatsword.cleaveRadius && unit !== target) {
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
        CombatLog.logKnockback(attacker, victim, newQ, newR);
      }
    }
    return results;
  }

  /**
   * Ogre Club Swipe — massive AOE attack hitting all enemies within 2 hex of attacker.
   * Deals 70% of base attack as club damage and knocks ALL victims back 1 hex away.
   * Radius is larger than Greatsword cleave (2 vs 1) to sell the Ogre's massive size.
   */
  static applyOgreClubSwipe(
    attacker: Unit, target: Unit, allUnits: Unit[],
    isTileBlocked: (q: number, r: number) => boolean
  ): { unitId: string; knockQ: number; knockR: number }[] {
    if (attacker.type !== UnitType.OGRE) return [];
    const results: { unitId: string; knockQ: number; knockR: number }[] = [];
    const clubDamage = Math.max(1, Math.round(attacker.stats.attack * GAME_CONFIG.combat.ogre.swipeDamageMultiplier));

    // Collect all enemies within 2 hex of attacker (larger AOE than Greatsword)
    const victims: Unit[] = [];
    for (const unit of allUnits) {
      if (unit.owner === attacker.owner || unit.currentHealth <= 0) continue;
      const dist = CombatSystem.hexDist(unit.position.q, unit.position.r, attacker.position.q, attacker.position.r);
      if (dist <= GAME_CONFIG.combat.ogre.swipeRadius && unit !== target) {
        victims.push(unit);
      }
    }

    // Apply club damage to secondary targets
    for (const victim of victims) {
      victim.currentHealth = Math.max(0, victim.currentHealth - clubDamage);
    }

    // Apply knockback to ALL hit enemies (primary target + secondary victims)
    const allHit = [target, ...victims];
    for (const victim of allHit) {
      if (victim.currentHealth <= 0) continue;
      const dq = victim.position.q - attacker.position.q;
      const dr = victim.position.r - attacker.position.r;
      let kq = 0, kr = 0;
      if (Math.abs(dq) >= Math.abs(dr)) {
        kq = dq > 0 ? 1 : (dq < 0 ? -1 : 0);
      } else {
        kr = dr > 0 ? 1 : (dr < 0 ? -1 : 0);
      }
      if (kq === 0 && kr === 0) kq = 1;
      const newQ = victim.position.q + kq;
      const newR = victim.position.r + kr;
      if (!isTileBlocked(newQ, newR)) {
        results.push({ unitId: victim.id, knockQ: newQ, knockR: newR });
        CombatLog.logKnockback(attacker, victim, newQ, newR);
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
      CombatLog.logKnockback(attacker, target, newQ, newR);
      return { unitId: target.id, knockQ: newQ, knockR: newR };
    }
    return null;
  }

  /**
   * Calculate if a unit can attack another (range check)
   */
  static canAttack(attacker: Unit, defender: Unit): boolean {
    const dist = CombatSystem.hexDist(attacker.position.q, attacker.position.r, defender.position.q, defender.position.r);
    return dist <= attacker.stats.range;
  }
}
