// ============================================
// CUBITOPIA - Arena Debug Console
// Live combat monitoring overlay for debugging
// unit behavior, targeting, kiting, and damage
// ============================================

import { Unit, UnitType, UnitState } from '../types';

// --- Combat Event Log Types ---
export enum DebugEventType {
  TARGET = 'TARGET',
  KITE = 'KITE',
  DAMAGE = 'DAMAGE',
  KILL = 'KILL',
  KNOCKBACK = 'KNOCKBACK',
  PEEL = 'PEEL',
  HEAL = 'HEAL',
  SPLASH = 'SPLASH',
  MOVE = 'MOVE',
}

export interface DebugEvent {
  time: number;
  type: DebugEventType;
  owner: number; // 0 = blue, 1 = red
  message: string;
  unitType?: UnitType;
  unitId?: string;
}

// --- Static Event Buffer (global access for UnitAI / CombatSystem) ---
export class CombatLog {
  private static events: DebugEvent[] = [];
  private static maxEvents = 500;
  private static enabled = false;
  private static startTime = 0;
  // Track last target per unit to avoid repeat TARGET logs
  private static lastTargets: Map<string, string> = new Map();
  // Track last peel per tank to avoid repeat PEEL logs (key: tankId, value: "targetId:allyId")
  private static lastPeels: Map<string, string> = new Map();
  // Track last kite per unit to avoid repeat KITE logs (key: unitId, value: threatId)
  private static lastKites: Map<string, string> = new Map();

  static enable(): void {
    if (CombatLog.enabled) return; // Already enabled — don't reset events
    CombatLog.enabled = true;
    CombatLog.startTime = performance.now();
    CombatLog.events = [];
  }

  /** Force-reset all events + dedup maps and (re-)enable logging. Use at new game start. */
  static reset(): void {
    CombatLog.clear();
    CombatLog.enabled = true;
    CombatLog.startTime = performance.now();
  }

  static disable(): void {
    CombatLog.enabled = false;
  }

  static isEnabled(): boolean { return CombatLog.enabled; }

  static clear(): void { CombatLog.events = []; CombatLog.lastTargets.clear(); CombatLog.lastPeels.clear(); CombatLog.lastKites.clear(); }

  static getEvents(): readonly DebugEvent[] { return CombatLog.events; }

  static getTime(): number {
    return Math.floor((performance.now() - CombatLog.startTime) / 1000);
  }

  static log(type: DebugEventType, owner: number, message: string, unitType?: UnitType, unitId?: string): void {
    if (!CombatLog.enabled) return;
    const time = CombatLog.getTime();
    CombatLog.events.push({ time, type, owner, message, unitType, unitId });
    if (CombatLog.events.length > CombatLog.maxEvents) {
      CombatLog.events.splice(0, CombatLog.events.length - CombatLog.maxEvents);
    }
  }

  // Convenience methods
  static logTarget(unit: Unit, target: Unit, score: number, dist: number): void {
    // Only log when the unit's target actually changes (avoid flooding)
    const lastTarget = CombatLog.lastTargets.get(unit.id);
    if (lastTarget === target.id) return;
    CombatLog.lastTargets.set(unit.id, target.id);
    const role = CombatLog.getRole(unit.type);
    CombatLog.log(
      DebugEventType.TARGET, unit.owner,
      `${role}${CombatLog.shortId(unit)} → ${CombatLog.typeName(target.type)}${CombatLog.shortId(target)} (score:${score.toFixed(1)} dist:${dist})`,
      unit.type, unit.id
    );
  }

  static logKite(unit: Unit, threat: Unit, success: boolean, fromQ?: number, fromR?: number, toQ?: number, toR?: number): void {
    // Dedup: only log when kite situation changes (threat + result), avoid per-tick spam
    const kiteKey = `${threat.id}:${success ? 'ok' : 'fail'}`;
    const lastKite = CombatLog.lastKites.get(unit.id);
    if (lastKite === kiteKey) return;
    CombatLog.lastKites.set(unit.id, kiteKey);
    if (success && toQ !== undefined && toR !== undefined) {
      CombatLog.log(
        DebugEventType.KITE, unit.owner,
        `${CombatLog.typeName(unit.type)}${CombatLog.shortId(unit)} KITES from (${fromQ},${fromR})→(${toQ},${toR}) away from ${CombatLog.typeName(threat.type)}${CombatLog.shortId(threat)}`,
        unit.type, unit.id
      );
    } else {
      CombatLog.log(
        DebugEventType.KITE, unit.owner,
        `${CombatLog.typeName(unit.type)}${CombatLog.shortId(unit)} KITE FAILED — no escape from ${CombatLog.typeName(threat.type)}${CombatLog.shortId(threat)}`,
        unit.type, unit.id
      );
    }
  }

  static logDamage(attacker: Unit, defender: Unit, dmgDealt: number, dmgTaken: number): void {
    let msg = `${CombatLog.typeName(attacker.type)}${CombatLog.shortId(attacker)} hits ${CombatLog.typeName(defender.type)}${CombatLog.shortId(defender)} for ${dmgDealt}`;
    if (dmgTaken > 0) msg += ` (took ${dmgTaken} counter)`;
    CombatLog.log(DebugEventType.DAMAGE, attacker.owner, msg, attacker.type, attacker.id);
  }

  static logKill(killer: Unit, victim: Unit): void {
    CombatLog.log(
      DebugEventType.KILL, killer.owner,
      `${CombatLog.typeName(killer.type)}${CombatLog.shortId(killer)} KILLED ${CombatLog.typeName(victim.type)}${CombatLog.shortId(victim)} (${victim.owner === 0 ? 'BLUE' : 'RED'})`,
      killer.type, killer.id
    );
  }

  static logKnockback(source: Unit, victim: Unit, toQ: number, toR: number): void {
    CombatLog.log(
      DebugEventType.KNOCKBACK, source.owner,
      `${CombatLog.typeName(source.type)} KNOCKBACK ${CombatLog.typeName(victim.type)}${CombatLog.shortId(victim)} → (${toQ},${toR})`,
      source.type, source.id
    );
  }

  static logPeel(tank: Unit, target: Unit, protectedAlly: Unit): void {
    // Only log when the peel situation changes (avoid flooding every tick)
    const peelKey = `${target.id}:${protectedAlly.id}`;
    const lastPeel = CombatLog.lastPeels.get(tank.id);
    if (lastPeel === peelKey) return;
    CombatLog.lastPeels.set(tank.id, peelKey);
    CombatLog.log(
      DebugEventType.PEEL, tank.owner,
      `${CombatLog.typeName(tank.type)}${CombatLog.shortId(tank)} PEELS for ${CombatLog.typeName(protectedAlly.type)}${CombatLog.shortId(protectedAlly)} → targets ${CombatLog.typeName(target.type)}${CombatLog.shortId(target)}`,
      tank.type, tank.id
    );
  }

  static logHeal(healer: Unit, target: Unit, amount: number): void {
    // No dedup for heals — they're gated by healRate cooldown so they don't fire every tick
    CombatLog.log(
      DebugEventType.HEAL, healer.owner,
      `${CombatLog.typeName(healer.type)}${CombatLog.shortId(healer)} heals ${CombatLog.typeName(target.type)}${CombatLog.shortId(target)} +${amount}HP (${target.currentHealth}/${target.stats.maxHealth})`,
      healer.type, healer.id
    );
  }

  static logSplash(source: Unit, victimId: string, victimType: UnitType): void {
    CombatLog.log(
      DebugEventType.SPLASH, source.owner,
      `${CombatLog.typeName(source.type)} SPLASH hits ${CombatLog.typeName(victimType)}`,
      source.type, source.id
    );
  }

  // Helpers
  private static shortId(u: Unit): string {
    return `#${u.id.slice(-3)}`;
  }

  private static typeName(t: UnitType): string {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  private static getRole(t: UnitType): string {
    switch (t) {
      case UnitType.ARCHER: case UnitType.MAGE: case UnitType.BATTLEMAGE: return '🏹';
      case UnitType.SHIELDBEARER: case UnitType.PALADIN: return '🛡️';
      case UnitType.HEALER: return '💚';
      case UnitType.GREATSWORD: return '⚔️';
      case UnitType.BERSERKER: return '🪓';
      case UnitType.ASSASSIN: return '🗡️';
      default: return '⚔️';
    }
  }
}

// Expose CombatLog globally for debugging
(window as any).__CombatLog = CombatLog;
