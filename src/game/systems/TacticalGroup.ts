/**
 * TacticalGroup — Army grouping with phase state machine, role classification,
 * shared blackboard for combat coordination, and centroid computation.
 *
 * Design doc: docs/COMBAT_AI_DESIGN.md §5
 */

import { Unit, UnitType, UnitState, HexCoord } from '../../types';
import { Pathfinder } from './Pathfinder';
import { GAME_CONFIG } from '../GameConfig';
import { hexDist } from '../HexMath';

// ── Tactical Roles ──────────────────────────────────────────────

export enum TacticalRole {
  TANK = 'tank',
  MELEE_DPS = 'melee_dps',
  RANGED = 'ranged',
  DIVER = 'diver',
  SUPPORT = 'support',
  SIEGE = 'siege',
  WORKER = 'worker',
}

const ROLE_MAP: Record<string, TacticalRole> = {
  [UnitType.PALADIN]: TacticalRole.TANK,
  [UnitType.SHIELDBEARER]: TacticalRole.TANK,
  [UnitType.OGRE]: TacticalRole.TANK,
  [UnitType.WARRIOR]: TacticalRole.MELEE_DPS,
  [UnitType.GREATSWORD]: TacticalRole.MELEE_DPS,
  [UnitType.ARCHER]: TacticalRole.RANGED,
  [UnitType.MAGE]: TacticalRole.RANGED,
  [UnitType.BATTLEMAGE]: TacticalRole.RANGED,
  [UnitType.BERSERKER]: TacticalRole.DIVER,
  [UnitType.ASSASSIN]: TacticalRole.DIVER,
  [UnitType.RIDER]: TacticalRole.DIVER,
  [UnitType.SCOUT]: TacticalRole.DIVER,
  [UnitType.HEALER]: TacticalRole.SUPPORT,
  [UnitType.TREBUCHET]: TacticalRole.SIEGE,
  [UnitType.BUILDER]: TacticalRole.WORKER,
  [UnitType.LUMBERJACK]: TacticalRole.WORKER,
  [UnitType.VILLAGER]: TacticalRole.WORKER,
};

export function getTacticalRole(unitType: UnitType): TacticalRole {
  return ROLE_MAP[unitType] ?? TacticalRole.MELEE_DPS;
}

export function isAlive(u: Unit): boolean {
  return u.state !== UnitState.DEAD && u.currentHealth > 0;
}

// ── Tactical Group Phases ───────────────────────────────────────

export enum GroupPhase {
  MUSTERING = 'mustering',
  MARCHING = 'marching',
  ENGAGING = 'engaging',
  REFORMING = 'reforming',
  RETREATING = 'retreating',
}

// ── Blackboard: shared tactical state ───────────────────────────

export interface TacticalBlackboard {
  // Threat tracking — enemyId → cumulative damage dealt to our group recently
  threatMap: Map<string, number>;
  // Enemies diving our backline (within 3 hex of ranged/support)
  incomingDivers: string[];
  // Coordination: one peeler per enemy threat (enemyId → our tankId)
  claimedPeelTargets: Map<string, string>;
  // Coordination: one diver per high-value target (enemyId → our diverId)
  claimedDiveTargets: Map<string, string>;
  // Commander focus target — everyone deprioritizes everything else
  focusTarget: string | null;
  // Computed positions for role lines
  tankLineCenter: HexCoord | null;
  rangedLineCenter: HexCoord | null;
  supportLineCenter: HexCoord | null;
  // Flank waypoints for divers (positions 90° off the engagement axis)
  flankWaypoints: HexCoord[];
}

function createBlackboard(): TacticalBlackboard {
  return {
    threatMap: new Map(),
    incomingDivers: [],
    claimedPeelTargets: new Map(),
    claimedDiveTargets: new Map(),
    focusTarget: null,
    tankLineCenter: null,
    rangedLineCenter: null,
    supportLineCenter: null,
    flankWaypoints: [],
  };
}

// ── Vec2 helpers (hex-space, q/r) ───────────────────────────────

function centroidOf(units: Unit[]): HexCoord {
  if (units.length === 0) return { q: 0, r: 0 };
  // Exclude joining units from centroid — they're catching up and would drag the center back
  let sq = 0, sr = 0, count = 0;
  for (const u of units) {
    if (u._squadJoining) continue;
    sq += u.position.q;
    sr += u.position.r;
    count++;
  }
  // Fallback: if ALL units are joining, use everyone
  if (count === 0) {
    for (const u of units) { sq += u.position.q; sr += u.position.r; }
    count = units.length;
  }
  return { q: Math.round(sq / count), r: Math.round(sr / count) };
}

function lerpHex(a: HexCoord, b: HexCoord, t: number): HexCoord {
  return {
    q: Math.round(a.q + (b.q - a.q) * t),
    r: Math.round(a.r + (b.r - a.r) * t),
  };
}

/** Direction vector from a toward b (not normalized, integer hex coords) */
function hexDir(from: HexCoord, to: HexCoord): { dq: number; dr: number } {
  return { dq: Math.sign(to.q - from.q), dr: Math.sign(to.r - from.r) };
}

/** Perpendicular direction (rotate 90° in hex-space approximation) */
function perpHex(d: { dq: number; dr: number }): { dq: number; dr: number } {
  // Hex grid 90° rotation approximation: swap and negate one component
  return { dq: -d.dr, dr: d.dq };
}

// ── Tactical Group class ────────────────────────────────────────

let nextGroupId = 1;

export class TacticalGroup {
  readonly id: string;
  readonly owner: number;
  units: Unit[] = [];
  phase: GroupPhase = GroupPhase.MUSTERING;
  objective: HexCoord;

  // Computed each tick
  centroid: HexCoord = { q: 0, r: 0 };
  marchDirection: { dq: number; dr: number } = { dq: 0, dr: 0 };
  enemyCentroid: HexCoord | null = null;
  engagementAxis: { dq: number; dr: number } = { dq: 0, dr: 0 };

  // Sub-groups by role (rebuilt each tick)
  tanks: Unit[] = [];
  meleeDps: Unit[] = [];
  ranged: Unit[] = [];
  divers: Unit[] = [];
  support: Unit[] = [];
  siege: Unit[] = [];

  blackboard: TacticalBlackboard = createBlackboard();

  // Phase timers
  private _engageTimer = 0;       // time spent in ENGAGING (for reform check)
  private _noContactTimer = 0;    // seconds since last enemy contact
  private _musterTimer = 0;       // seconds spent mustering

  /** Minimum army size to start marching */
  static MIN_MUSTER_SIZE = GAME_CONFIG.tacticalGroup.minMusterSize;
  /** Max seconds to wait during muster before marching with whatever we have */
  static MAX_MUSTER_WAIT = GAME_CONFIG.tacticalGroup.maxMusterWait;
  /** Seconds without enemy contact before reforming */
  static REFORM_DELAY = GAME_CONFIG.tacticalGroup.reformDelay;
  /** Health-weighted strength ratio below which we retreat */
  static RETREAT_THRESHOLD = GAME_CONFIG.tacticalGroup.retreatThreshold;
  /** Hex range to detect enemies during march */
  static CONTACT_RANGE = (GAME_CONFIG.tacticalGroup as any).contactRange ?? 10;

  constructor(owner: number, objective: HexCoord) {
    this.id = `tg_${nextGroupId++}`;
    this.owner = owner;
    this.objective = objective;
  }

  addUnit(unit: Unit): void {
    if (this.units.indexOf(unit) === -1) {
      this.units.push(unit);
      unit._tacticalGroupId = this.id;
    }
  }

  removeUnit(unit: Unit): void {
    const idx = this.units.indexOf(unit);
    if (idx !== -1) {
      this.units.splice(idx, 1);
      unit._tacticalGroupId = undefined;
    }
  }

  get livingUnits(): Unit[] {
    return this.units.filter(isAlive);
  }

  get isEmpty(): boolean {
    return this.livingUnits.length === 0;
  }

  /** Current health-weighted strength (0–1). 0 = all dead, 1 = all full HP. */
  get strength(): number {
    const living = this.livingUnits;
    if (living.length === 0) return 0;
    let hp = 0, maxHp = 0;
    for (const u of living) {
      hp += u.currentHealth;
      maxHp += u.stats.maxHealth;
    }
    return maxHp > 0 ? hp / maxHp : 0;
  }

  // ── Main tick — called from TacticalGroupManager ──────────────

  update(delta: number, allUnits: Unit[]): void {
    // Remove dead units
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (!isAlive(this.units[i])) {
        (this.units[i] as any)._tacticalGroupId = undefined;
        this.units.splice(i, 1);
      }
    }
    if (this.isEmpty) return;

    // Rebuild role sub-groups
    this.tanks = [];
    this.meleeDps = [];
    this.ranged = [];
    this.divers = [];
    this.support = [];
    this.siege = [];
    for (const u of this.livingUnits) {
      const role = getTacticalRole(u.type);
      switch (role) {
        case TacticalRole.TANK: this.tanks.push(u); break;
        case TacticalRole.MELEE_DPS: this.meleeDps.push(u); break;
        case TacticalRole.RANGED: this.ranged.push(u); break;
        case TacticalRole.DIVER: this.divers.push(u); break;
        case TacticalRole.SUPPORT: this.support.push(u); break;
        case TacticalRole.SIEGE: this.siege.push(u); break;
      }
    }

    // Compute centroid and march direction
    this.centroid = centroidOf(this.livingUnits);
    this.marchDirection = hexDir(this.centroid, this.objective);

    // Detect nearby enemies
    const nearbyEnemies = this.findNearbyEnemies(allUnits, TacticalGroup.CONTACT_RANGE);
    const hasContact = nearbyEnemies.length > 0;

    if (hasContact) {
      this.enemyCentroid = centroidOf(nearbyEnemies);
      this.engagementAxis = hexDir(this.centroid, this.enemyCentroid);
      this._noContactTimer = 0;
    } else {
      this._noContactTimer += delta;
      // Fade enemy centroid after losing contact
      if (this._noContactTimer > 2) this.enemyCentroid = null;
    }

    // Phase state machine
    switch (this.phase) {
      case GroupPhase.MUSTERING:
        this._musterTimer += delta;
        if (this.livingUnits.length >= TacticalGroup.MIN_MUSTER_SIZE
            || this._musterTimer >= TacticalGroup.MAX_MUSTER_WAIT) {
          this.phase = GroupPhase.MARCHING;
          this._musterTimer = 0;
        }
        break;

      case GroupPhase.MARCHING:
        if (hasContact) {
          this.phase = GroupPhase.ENGAGING;
          this._engageTimer = 0;
        }
        // Check if we've reached objective
        if (hexDist(this.centroid, this.objective) <= 2) {
          this.phase = GroupPhase.REFORMING;
        }
        break;

      case GroupPhase.ENGAGING:
        this._engageTimer += delta;
        this.updateBlackboard(allUnits, nearbyEnemies);
        // Check retreat
        if (this.strength < TacticalGroup.RETREAT_THRESHOLD) {
          this.phase = GroupPhase.RETREATING;
          break;
        }
        // Check reform (no enemies for a while)
        if (!hasContact && this._noContactTimer >= TacticalGroup.REFORM_DELAY) {
          this.phase = GroupPhase.REFORMING;
        }
        break;

      case GroupPhase.REFORMING:
        if (hasContact) {
          this.phase = GroupPhase.ENGAGING;
          this._engageTimer = 0;
        }
        // After reforming, resume march if objective not reached
        if (!hasContact && this._noContactTimer >= TacticalGroup.REFORM_DELAY + 1) {
          if (hexDist(this.centroid, this.objective) > 2) {
            this.phase = GroupPhase.MARCHING;
          }
        }
        break;

      case GroupPhase.RETREATING:
        // If we somehow recover (reinforcements), go back to engaging
        if (this.strength > TacticalGroup.RETREAT_THRESHOLD + 0.15 && hasContact) {
          this.phase = GroupPhase.ENGAGING;
          this._engageTimer = 0;
        }
        break;
    }
  }

  // ── Blackboard updates (only during ENGAGING) ─────────────────

  private updateBlackboard(allUnits: Unit[], nearbyEnemies: Unit[]): void {
    const bb = this.blackboard;

    // Reset per-tick data
    bb.incomingDivers = [];
    bb.flankWaypoints = [];

    // Threat map: which enemies are targeting our units
    bb.threatMap.clear();
    for (const enemy of nearbyEnemies) {
      if (enemy.command?.targetUnitId) {
        const targetedAlly = this.units.find(u => u.id === enemy.command!.targetUnitId);
        if (targetedAlly) {
          bb.threatMap.set(enemy.id, (bb.threatMap.get(enemy.id) ?? 0) + enemy.stats.attack);
        }
      }
    }

    // Identify incoming divers: enemies within 3 hex of our ranged/support
    const backline = [...this.ranged, ...this.support, ...this.siege];
    for (const enemy of nearbyEnemies) {
      if (enemy.stats.range > 1) continue; // only melee enemies are "divers"
      for (const ally of backline) {
        if (hexDist(enemy.position, ally.position) <= 3) {
          if (bb.incomingDivers.indexOf(enemy.id) === -1) {
            bb.incomingDivers.push(enemy.id);
          }
          break;
        }
      }
    }

    // Clean up stale peel claims (peeler dead or enemy dead)
    for (const [enemyId, tankId] of bb.claimedPeelTargets) {
      const tank = this.units.find(u => u.id === tankId);
      const enemy = nearbyEnemies.find(u => u.id === enemyId);
      if (!tank || !isAlive(tank) || !enemy || !isAlive(enemy)) {
        bb.claimedPeelTargets.delete(enemyId);
      }
    }

    // Clean up stale dive claims
    for (const [enemyId, diverId] of bb.claimedDiveTargets) {
      const diver = this.units.find(u => u.id === diverId);
      const enemy = nearbyEnemies.find(u => u.id === enemyId);
      if (!diver || !isAlive(diver) || !enemy || !isAlive(enemy)) {
        bb.claimedDiveTargets.delete(enemyId);
      }
    }

    // Compute role line positions
    if (this.enemyCentroid) {
      // Tank line: 2/3 of the way from our centroid to the enemy centroid
      bb.tankLineCenter = lerpHex(this.centroid, this.enemyCentroid, 0.6);
      // Ranged line: behind centroid, away from enemies
      const awayDir = hexDir(this.enemyCentroid, this.centroid);
      bb.rangedLineCenter = {
        q: this.centroid.q + awayDir.dq * 2,
        r: this.centroid.r + awayDir.dr * 2,
      };
      // Support line: behind ranged
      bb.supportLineCenter = {
        q: this.centroid.q + awayDir.dq * 3,
        r: this.centroid.r + awayDir.dr * 3,
      };

      // Flank waypoints: 90° off the engagement axis, at enemy centroid distance
      const perp = perpHex(this.engagementAxis);
      const dist = hexDist(this.centroid, this.enemyCentroid);
      const flankDist = Math.max(3, Math.round(dist * 0.7));
      bb.flankWaypoints = [
        {
          q: this.enemyCentroid.q + perp.dq * flankDist,
          r: this.enemyCentroid.r + perp.dr * flankDist,
        },
        {
          q: this.enemyCentroid.q - perp.dq * flankDist,
          r: this.enemyCentroid.r - perp.dr * flankDist,
        },
      ];
    } else {
      bb.tankLineCenter = null;
      bb.rangedLineCenter = null;
      bb.supportLineCenter = null;
    }
  }

  // ── Peel coordination ─────────────────────────────────────────

  /** Try to claim a peel assignment. Returns true if this tank is now the peeler. */
  claimPeel(tankId: string, enemyId: string): boolean {
    const bb = this.blackboard;
    const existing = bb.claimedPeelTargets.get(enemyId);
    if (existing && existing !== tankId) {
      // Already claimed by another tank — check if that tank is still alive
      const otherTank = this.units.find(u => u.id === existing);
      if (otherTank && isAlive(otherTank)) return false;
    }
    bb.claimedPeelTargets.set(enemyId, tankId);
    return true;
  }

  /** Try to claim a dive target. Returns true if this diver is assigned. */
  claimDiveTarget(diverId: string, enemyId: string): boolean {
    const bb = this.blackboard;
    const existing = bb.claimedDiveTargets.get(enemyId);
    if (existing && existing !== diverId) {
      const otherDiver = this.units.find(u => u.id === existing);
      if (otherDiver && isAlive(otherDiver)) return false;
    }
    bb.claimedDiveTargets.set(enemyId, diverId);
    return true;
  }

  /** Get a flank waypoint for a diver (alternates between left/right flank) */
  getFlankWaypoint(diverIndex: number): HexCoord | null {
    const wps = this.blackboard.flankWaypoints;
    if (wps.length === 0) return null;
    return wps[diverIndex % wps.length];
  }

  // ── Helpers ───────────────────────────────────────────────────

  private findNearbyEnemies(allUnits: Unit[], range: number): Unit[] {
    const result: Unit[] = [];
    for (const u of allUnits) {
      if (u.owner === this.owner || !isAlive(u)) continue;
      if (hexDist(u.position, this.centroid) <= range) {
        result.push(u);
      }
    }
    return result;
  }
}

// ── TacticalGroupManager ────────────────────────────────────────

export class TacticalGroupManager {
  private groups: TacticalGroup[] = [];

  /** Create a new tactical group and return it */
  createGroup(owner: number, objective: HexCoord): TacticalGroup {
    const group = new TacticalGroup(owner, objective);
    this.groups.push(group);
    return group;
  }

  /** Remove empty/dead groups */
  cleanup(): void {
    this.groups = this.groups.filter(g => !g.isEmpty);
  }

  /** Get the tactical group a unit belongs to (if any) */
  getGroupForUnit(unit: Unit): TacticalGroup | null {
    const gid = unit._tacticalGroupId;
    if (!gid) return null;
    return this.groups.find(g => g.id === gid) ?? null;
  }

  /** Get all active groups */
  getAllGroups(): TacticalGroup[] {
    return this.groups;
  }

  /** Get groups for a specific owner */
  getGroupsForOwner(owner: number): TacticalGroup[] {
    return this.groups.filter(g => g.owner === owner);
  }

  /** Update all groups */
  update(delta: number, allUnits: Unit[]): void {
    for (const group of this.groups) {
      group.update(delta, allUnits);
    }
    this.cleanup();
  }

  /** Disband a group — removes tactical group assignment from all units */
  disbandGroup(groupId: string): void {
    const idx = this.groups.findIndex(g => g.id === groupId);
    if (idx === -1) return;
    const group = this.groups[idx];
    for (const u of group.units) {
      (u as any)._tacticalGroupId = undefined;
    }
    this.groups.splice(idx, 1);
  }
}
