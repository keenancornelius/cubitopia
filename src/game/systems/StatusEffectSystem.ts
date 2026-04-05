// ============================================
// CUBITOPIA — Status Effect System
// Manages elemental status effects applied by Mage, Battlemage, and Healer.
//
// MAGE ELEMENT INTERACTIONS (single-target):
//   Water → applies Wet (5s)
//   Fire  → applies Ablaze (6s, 1.5 DPS burn tick)
//   Wet + Lightning → Electrocute Crit (consumes Wet, chain spreads 1.5× damage)
//   Ablaze + Wind → Inferno (consumes Ablaze, burst damage + spreads Ablaze to nearby)
//   Water + Ablaze → Soothe (anti-synergy: consumes Ablaze, heals target)
//
// BATTLEMAGE AoE STATUS EFFECTS (low damage, big setup):
//   Water AoE → Wet (same as Mage but AoE, very low damage — sets up Electrocute)
//   Wind AoE  → Knockup CC (brief airborne stun — enemies can't move/attack)
//   Lightning AoE → High Voltage (yellow sparks — when Electrocute chain hits, triggers arc cascade + stun)
//   Fire AoE  → Ablaze (same as Mage, benefits from same interactions)
//   Earth AoE → Arcane (purple orbs, consumed by Mage Lightning for Kamehameha laser)
//
// ARCANE + LIGHTNING → KAMEHAMEHA:
//   When a Mage hits an Arcane-marked target with Lightning, the Mage fires a
//   piercing laser beam through the target and enemies behind it in a line.
//
// HEALER:
//   Cleanse — removes all debuffs from an ally, gives speed boost + golden trail
//   Cleanse Linger — target is immune to status effects for a short duration
// ============================================

import { Unit, UnitType, ElementType } from '../../types';
import { GAME_CONFIG } from '../GameConfig';
import { GameRNG } from '../SeededRandom';
import { UnitAI } from './UnitAI';
import { hexDistQR } from '../HexMath';

/** Convert seconds to deterministic game frames (~60fps). */
const secToFrames = (s: number) => Math.round(s * 60);

export interface StatusEvent {
  type: 'status:applied' | 'status:consumed' | 'status:tick' | 'status:interaction';
  unitId: string;
  effect: string;       // 'wet', 'ablaze', 'electrocute', 'inferno', 'soothe', 'arcane', 'knockup', 'kamehameha', 'cleanse', etc.
  damage?: number;
  heal?: number;
  spreadTo?: string[];  // unit IDs that received a spread effect
  /** For kamehameha: the direction vector and list of pierced unit IDs */
  laserFrom?: { q: number; r: number };
  laserTo?: { q: number; r: number };
  piercedIds?: string[];
  casterId?: string;    // the mage who triggered the interaction (for VFX origin)
}

export class StatusEffectSystem {

  /**
   * Apply a Mage's elemental status effect to the target based on the element used.
   * Also checks for element interactions and returns any triggered events.
   */
  static applyMageElement(
    attacker: Unit, target: Unit, element: ElementType, allUnits: Unit[]
  ): StatusEvent[] {
    const gf = UnitAI.gameFrame;
    const events: StatusEvent[] = [];
    const cfg = GAME_CONFIG.combat.statusEffects;

    // If target has Cleanse Linger (immunity), skip all status applications
    if (target._cleanseLinger && gf < target._cleanseLinger) {
      return events; // immune — no status applied
    }

    switch (element) {
      case ElementType.WATER: {
        // Check anti-synergy first: Water + Ablaze → Soothe
        if (target._statusAblaze && gf < target._statusAblaze) {
          // Consume Ablaze, heal the target
          target._statusAblaze = 0;
          target._ablazeDPS = 0;
          target._ablazeSource = undefined;
          const heal = cfg.soothe.healAmount;
          target.currentHealth = Math.min(target.stats.maxHealth, target.currentHealth + heal);
          events.push({ type: 'status:interaction', unitId: target.id, effect: 'soothe', heal });
        } else {
          // Apply Wet
          target._statusWet = gf + secToFrames(cfg.wet.duration);
          events.push({ type: 'status:applied', unitId: target.id, effect: 'wet' });
        }
        break;
      }

      case ElementType.FIRE: {
        // Apply Ablaze (burn tick)
        target._statusAblaze = gf + secToFrames(cfg.ablaze.duration);
        target._ablazeDPS = cfg.ablaze.dps;
        target._ablazeSource = attacker.id;
        events.push({ type: 'status:applied', unitId: target.id, effect: 'ablaze' });
        break;
      }

      case ElementType.LIGHTNING: {
        // Check interaction: Arcane + Lightning → Kamehameha laser beam
        if (target._statusArcane && gf < target._statusArcane) {
          target._statusArcane = 0;
          events.push({ type: 'status:consumed', unitId: target.id, effect: 'arcane' });

          // Fire a piercing laser from attacker through target and beyond
          const kamCfg = cfg.kamehameha;
          const laserDmg = Math.max(1, Math.round(attacker.stats.attack * kamCfg.damageMultiplier));

          // Direction: attacker → target, extended through enemies in a line
          const dq = target.position.q - attacker.position.q;
          const dr = target.position.r - attacker.position.r;
          // Normalize to a step direction
          const len = Math.max(Math.abs(dq), Math.abs(dr), 1);
          const stepQ = Math.round(dq / len);
          const stepR = Math.round(dr / len);

          const piercedIds: string[] = [];
          // Walk the beam from target outward
          for (let i = 0; i <= kamCfg.beamRange; i++) {
            const bq = target.position.q + stepQ * i;
            const br = target.position.r + stepR * i;
            // Find enemies at this hex
            for (const u of allUnits) {
              if (u.owner === attacker.owner || u.currentHealth <= 0) continue;
              if (u.position.q === bq && u.position.r === br && u.id !== target.id) {
                u.currentHealth = Math.max(0, u.currentHealth - laserDmg);
                piercedIds.push(u.id);
                if (piercedIds.length >= kamCfg.pierceCount) break;
              }
            }
            if (piercedIds.length >= kamCfg.pierceCount) break;
          }

          // Also deal laser damage to the primary target
          target.currentHealth = Math.max(0, target.currentHealth - laserDmg);

          events.push({
            type: 'status:interaction', unitId: target.id, effect: 'kamehameha',
            damage: laserDmg, piercedIds, casterId: attacker.id,
            laserFrom: { q: attacker.position.q, r: attacker.position.r },
            laserTo: { q: target.position.q + stepQ * kamCfg.beamRange, r: target.position.r + stepR * kamCfg.beamRange },
          });
        }
        // Check interaction: Wet + Lightning → Electrocute Crit
        else if (target._statusWet && gf < target._statusWet) {
          // Consume Wet status
          target._statusWet = 0;
          events.push({ type: 'status:consumed', unitId: target.id, effect: 'wet' });

          // Enhanced chain lightning — spreads to more targets with higher damage
          const ecCfg = cfg.electrocuteCrit;
          const spreadTo: string[] = [];
          const candidates = allUnits
            .filter(u => u.owner !== attacker.owner && u.currentHealth > 0 && u.id !== target.id);

          // Sort by distance from target
          const withDist = candidates.map(u => ({
            unit: u,
            dist: hexDistQR(u.position.q, u.position.r, target.position.q, target.position.r),
          }));
          withDist.sort((a, b) => a.dist - b.dist);

          const chainDmg = Math.max(1, Math.round(attacker.stats.attack * ecCfg.damageMultiplier));
          for (const { unit, dist } of withDist) {
            if (dist > ecCfg.chainRadius) break;
            if (spreadTo.length >= ecCfg.chainCount) break;
            unit.currentHealth = Math.max(0, unit.currentHealth - chainDmg);
            spreadTo.push(unit.id);
          }

          events.push({
            type: 'status:interaction', unitId: target.id, effect: 'electrocute',
            damage: chainDmg, spreadTo,
          });
        }
        break;
      }

      case ElementType.WIND: {
        // Check interaction: Ablaze + Wind → Inferno
        if (target._statusAblaze && gf < target._statusAblaze) {
          // Consume Ablaze
          target._statusAblaze = 0;
          target._ablazeDPS = 0;
          target._ablazeSource = undefined;
          events.push({ type: 'status:consumed', unitId: target.id, effect: 'ablaze' });

          // Inferno burst + spread Ablaze to nearby enemies
          const infCfg = cfg.inferno;
          target.currentHealth = Math.max(0, target.currentHealth - infCfg.burstDamage);
          const spreadTo: string[] = [];
          const candidates = allUnits
            .filter(u => u.owner !== attacker.owner && u.currentHealth > 0 && u.id !== target.id);
          const withDist = candidates.map(u => ({
            unit: u,
            dist: hexDistQR(u.position.q, u.position.r, target.position.q, target.position.r),
          }));
          withDist.sort((a, b) => a.dist - b.dist);

          for (const { unit, dist } of withDist) {
            if (dist > infCfg.spreadRadius) break;
            if (spreadTo.length >= infCfg.spreadCount) break;
            // Spread Ablaze to nearby enemies
            unit._statusAblaze = gf + secToFrames(cfg.ablaze.duration);
            unit._ablazeDPS = cfg.ablaze.dps;
            unit._ablazeSource = attacker.id;
            spreadTo.push(unit.id);
          }

          events.push({
            type: 'status:interaction', unitId: target.id, effect: 'inferno',
            damage: infCfg.burstDamage, spreadTo,
          });
        }
        break;
      }

      case ElementType.EARTH: {
        // Earth has no Mage interaction currently — just raw damage
        break;
      }
    }

    return events;
  }

  /**
   * Apply a Battlemage's AoE elemental status to a target.
   * Battlemage AoE does LOW damage but applies powerful setup statuses.
   */
  static applyBattlemageElement(
    attacker: Unit, target: Unit, element: ElementType
  ): StatusEvent[] {
    const now = UnitAI.gameFrame;
    const events: StatusEvent[] = [];
    const cfg = GAME_CONFIG.combat.statusEffects;

    // Cleanse Linger blocks all status applications
    if (target._cleanseLinger && now < target._cleanseLinger) {
      return events;
    }

    switch (element) {
      case ElementType.WATER:
        // Battlemage Water AoE → Wet (same status as Mage, sets up Electrocute)
        target._statusWet = now + secToFrames(cfg.wet.duration);
        events.push({ type: 'status:applied', unitId: target.id, effect: 'wet' });
        break;

      case ElementType.WIND:
        // Battlemage Wind AoE → Knockup CC (brief airborne, can't act)
        target._knockupUntil = now + secToFrames(cfg.knockup.duration);
        events.push({ type: 'status:applied', unitId: target.id, effect: 'knockup' });
        break;

      case ElementType.LIGHTNING:
        // Battlemage Lightning AoE → High Voltage (consumed by Electrocute chains for arc cascade + stun)
        target._statusHighVoltage = now + secToFrames(cfg.highVoltage.duration);
        events.push({ type: 'status:applied', unitId: target.id, effect: 'high_voltage' });
        break;

      case ElementType.EARTH:
        // Battlemage Earth AoE → Arcane (more chances to set up Kamehameha)
        target._statusArcane = now + secToFrames(cfg.arcane.duration);
        events.push({ type: 'status:applied', unitId: target.id, effect: 'arcane' });
        break;

      case ElementType.FIRE:
        // Battlemage Fire AoE → Ablaze (same burn as Mage, benefits from same interactions)
        target._statusAblaze = now + secToFrames(cfg.ablaze.duration);
        target._ablazeDPS = cfg.ablaze.dps;
        target._ablazeSource = attacker.id;
        events.push({ type: 'status:applied', unitId: target.id, effect: 'ablaze' });
        break;
    }

    return events;
  }

  /**
   * Healer Cleanse — remove all negative status effects from a friendly unit.
   * Gives the target a speed boost and Cleanse Linger (status immunity).
   * Returns cleanse events for VFX, or empty if no valid target / on cooldown.
   */
  static processHealerCleanse(
    healer: Unit, allUnits: Unit[], delta: number
  ): StatusEvent[] {
    if (healer.type !== UnitType.HEALER || healer.currentHealth <= 0) return [];
    const now = UnitAI.gameFrame;
    const cfg = GAME_CONFIG.combat.statusEffects.cleanse;

    // Cooldown
    const cd = healer._cleanseCooldown ?? 0;
    if (now < cd) return [];

    // Find the most-debuffed friendly unit in range
    const healRange = healer.stats.range;
    let bestTarget: Unit | null = null;
    let bestDebuffCount = 0;

    for (const ally of allUnits) {
      if (ally.owner !== healer.owner || ally === healer || ally.currentHealth <= 0) continue;
      const dist = hexDistQR(
        ally.position.q, ally.position.r, healer.position.q, healer.position.r
      );
      if (dist > healRange) continue;

      // Count active debuffs
      let debuffs = 0;
      if (ally._statusWet && now < ally._statusWet) debuffs++;
      if (ally._statusAblaze && now < ally._statusAblaze) debuffs++;
      if (ally._statusArcane && now < ally._statusArcane) debuffs++;
      if (ally._knockupUntil && now < ally._knockupUntil) debuffs++;
      if (ally._slowUntil && now < ally._slowUntil) debuffs++;

      if (debuffs > bestDebuffCount) {
        bestDebuffCount = debuffs;
        bestTarget = ally;
      }
    }

    if (!bestTarget || bestDebuffCount === 0) return [];

    // Set cooldown
    healer._cleanseCooldown = now + secToFrames(cfg.cooldown);

    // Clear all debuffs
    bestTarget._statusWet = 0;
    bestTarget._statusAblaze = 0;
    bestTarget._ablazeDPS = 0;
    bestTarget._ablazeSource = undefined;
    bestTarget._statusArcane = 0;
    bestTarget._statusHighVoltage = 0;
    bestTarget._knockupUntil = 0;
    bestTarget._slowUntil = 0;
    bestTarget._slowFactor = undefined;

    // Apply speed boost
    bestTarget._speedBoostUntil = now + secToFrames(cfg.speedBoostDuration);
    bestTarget._speedBoostFactor = cfg.speedBoostFactor;

    // Apply Cleanse Linger — immunity to status effects
    bestTarget._cleanseLinger = now + secToFrames(cfg.lingerDuration);

    return [{
      type: 'status:interaction', unitId: bestTarget.id, effect: 'cleanse',
      casterId: healer.id,
    }];
  }

  /**
   * Tick burn damage for all units with Ablaze status, expire effects, handle knockup.
   * Called once per frame from UnitAI.update().
   */
  static tickStatusEffects(allUnits: Unit[], delta: number): StatusEvent[] {
    const now = UnitAI.gameFrame;
    const events: StatusEvent[] = [];

    for (const unit of allUnits) {
      if (unit.currentHealth <= 0) continue;

      // Tick Ablaze burn damage
      if (unit._statusAblaze && now < unit._statusAblaze && unit._ablazeDPS) {
        const dmg = unit._ablazeDPS * delta;
        unit.currentHealth = Math.max(0, unit.currentHealth - dmg);
        // Only emit events periodically (every 0.5s worth) to avoid spam
        if (GameRNG.rng.next() < delta * 2) {
          events.push({ type: 'status:tick', unitId: unit.id, effect: 'ablaze', damage: dmg });
        }
      }

      // Expire status effects
      if (unit._statusWet && now >= unit._statusWet) unit._statusWet = 0;
      if (unit._statusAblaze && now >= unit._statusAblaze) {
        unit._statusAblaze = 0;
        unit._ablazeDPS = 0;
        unit._ablazeSource = undefined;
      }
      if (unit._statusArcane && now >= unit._statusArcane) unit._statusArcane = 0;
      if (unit._statusHighVoltage && now >= unit._statusHighVoltage) unit._statusHighVoltage = 0;
      if (unit._knockupUntil && now >= unit._knockupUntil) unit._knockupUntil = 0;
      if (unit._cleanseLinger && now >= unit._cleanseLinger) unit._cleanseLinger = 0;
      if (unit._speedBoostUntil && now >= unit._speedBoostUntil) {
        unit._speedBoostUntil = 0;
        unit._speedBoostFactor = undefined;
      }
    }

    return events;
  }

  /**
   * Get effective defense modifier for a unit based on active status effects.
   * (Old Windswept/Molten removed — Battlemage no longer applies stat debuffs)
   */
  static getDefenseModifier(_unit: Unit): number {
    return 0;
  }

  /**
   * Get effective attack modifier for a unit based on active status effects.
   */
  static getAttackModifier(_unit: Unit): number {
    return 0;
  }

  /**
   * Get damage amplification multiplier for incoming damage.
   * No longer used (Charged status removed).
   */
  static getDamageAmplification(_unit: Unit): number {
    return 1.0;
  }

  /**
   * Check if a unit is currently knocked up (airborne CC) and should skip its turn.
   */
  static isKnockedUp(unit: Unit): boolean {
    const now = UnitAI.gameFrame;
    return !!(unit._knockupUntil && now < unit._knockupUntil);
  }

  /**
   * Get the effective speed multiplier for a unit (speed boost from cleanse).
   */
  static getSpeedMultiplier(unit: Unit): number {
    const now = UnitAI.gameFrame;
    if (unit._speedBoostUntil && now < unit._speedBoostUntil && unit._speedBoostFactor) {
      return unit._speedBoostFactor;
    }
    return 1.0;
  }

  /**
   * Check if a unit has any active status effect (for VFX rendering).
   */
  static getActiveStatuses(unit: Unit): string[] {
    const now = UnitAI.gameFrame;
    const active: string[] = [];
    if (unit._statusWet && now < unit._statusWet) active.push('wet');
    if (unit._statusAblaze && now < unit._statusAblaze) active.push('ablaze');
    if (unit._statusArcane && now < unit._statusArcane) active.push('arcane');
    if (unit._statusHighVoltage && now < unit._statusHighVoltage) active.push('high_voltage');
    if (unit._knockupUntil && now < unit._knockupUntil) active.push('knockup');
    if (unit._cleanseLinger && now < unit._cleanseLinger) active.push('cleanse_linger');
    if (unit._speedBoostUntil && now < unit._speedBoostUntil) active.push('speed_boost');
    return active;
  }
}
