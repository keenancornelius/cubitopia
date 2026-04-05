/**
 * GarrisonSystem — Manages unit garrisoning in buildings and gates.
 *
 * Design:
 * - Units can garrison inside friendly buildings (cap 10) and gates (cap 5)
 * - Walls are NOT garrisonable — they serve as fast-travel connectors
 * - Garrisoned units are hidden and gain ranged fire from the structure
 * - Wall network: all gates/buildings connected by walls form a single pool.
 *   Clicking any gate in the network shows ALL garrisoned units across
 *   the entire connected set, and you can send any of them to any exit.
 * - Ungarrison supports type filtering via pill toggles
 *
 * Integration:
 * - GarrisonSystem.update() called each frame for ranged fire cooldowns
 * - GarrisonSystem.garrison(units, structureKey) to enter
 * - GarrisonSystem.getNetworkInfo(structureKey) for UI — returns ALL units in connected network
 * - GarrisonSystem.ungarrisonNetwork(structureKey, exitKey?) to release all from network
 * - GarrisonSystem.ungarrisonNetworkFiltered(structureKey, types, exitKey) for selective release
 */

import { Unit, HexCoord, UnitType, UnitState, CommandType, PlacedBuilding } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { getPlayerHex } from '../PlayerConfig';

// --- Types ---

export type StructureType = 'building' | 'gate' | 'wall';

export interface GarrisonSlot {
  /** Structure hex key "q,r" */
  structureKey: string;
  structureType: StructureType;
  owner: number;
  position: HexCoord;
  /** Units currently inside */
  units: Unit[];
  /** Max capacity */
  capacity: number;
  /** Ranged fire cooldown (seconds remaining) */
  fireCooldown: number;
}

/** Network-wide garrison info for UI display */
export interface NetworkGarrisonInfo {
  /** All units garrisoned across the entire connected network */
  units: Unit[];
  /** Total units in network */
  current: number;
  /** Total capacity across all garrisonable structures in network */
  totalCapacity: number;
  /** All reachable exit points (gates + buildings) in the network */
  reachableExits: HexCoord[];
  /** Number of garrisonable structures (gates/buildings) in the network */
  structureCount: number;
}

/** Slim interface — only what GarrisonSystem needs from the outside */
export interface GarrisonOps {
  // Structure queries
  getBuildingAt(pos: HexCoord): PlacedBuilding | null;
  getWallsBuilt(): Set<string>;
  getGatesBuilt(): Set<string>;
  getWallOwner(key: string): number;
  getGateOwner(key: string): number;

  // Unit visibility
  hideUnit(unit: Unit): void;
  showUnit(unit: Unit): void;

  // Ranged fire visuals
  fireArrow(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
    targetId: string, onImpact: () => void): void;
  fireArrowVolley(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
    count: number, onImpact?: () => void): void;
  fireCannonball(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
    onImpact?: () => void): void;

  // Damage
  applyDamage(target: Unit, damage: number, attacker: Unit | null): void;
  updateHealthBar(unit: Unit): void;

  // World helpers
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getAllUnits(): Unit[];
  getElevation(pos: HexCoord): number;

  // Cannon turret lifecycle
  addCannonTurret(key: string, pos: { x: number; y: number; z: number }, color: number): void;
  removeCannonTurret(key: string): void;
  setCannonTarget(key: string, pos: { x: number; y: number; z: number } | null): void;

  // Notifications
  playSound(name: string, volume?: number): void;
}

// --- Constants ---

const BUILDING_CAPACITY = 10;
const GATE_CAPACITY = 5;

/** Base seconds between garrison attacks (reduced by unit count) */
const GARRISON_FIRE_INTERVAL_BASE = 2.5;
/** Cooldown reduction per garrisoned unit (seconds) */
const GARRISON_FIRE_INTERVAL_PER_UNIT = 0.15;
/** Minimum fire interval (hard floor) */
const GARRISON_FIRE_INTERVAL_MIN = 1.0;
/** Damage multiplier for ranged units (applied to unit's ATK stat) */
const RANGED_GARRISON_MULTIPLIER = 0.75;
/** Damage multiplier for melee units (applied to unit's ATK stat) */
const MELEE_GARRISON_MULTIPLIER = 0.35;
/** Base range in hexes for garrison fire */
const GARRISON_FIRE_RANGE = 4;
/** Extended range when 5+ units garrisoned */
const GARRISON_FIRE_RANGE_EXTENDED = 5;
/** Height offset above structure for arrow origin */
const ARROW_Y_OFFSET = 3.0;
/** Minimum arrow volley count to use volley VFX */
const VOLLEY_THRESHOLD = 3;

export default class GarrisonSystem {
  private ops: GarrisonOps;

  /** Map from structure hex key → garrison slot */
  private slots: Map<string, GarrisonSlot> = new Map();

  /** Reverse lookup: unit ID → structure key they're garrisoned in */
  private unitToStructure: Map<string, string> = new Map();

  /** Wall network adjacency graph: key → Set of connected keys (walls+gates+buildings) */
  private wallNetwork: Map<string, Set<string>> = new Map();

  /** Cached set of exit-point keys (buildings + gates, NOT walls) */
  private exitPoints: Set<string> = new Set();

  /** Dirty flag — set true when walls/gates change to trigger network rebuild */
  private _networkDirty = true;

  constructor(ops: GarrisonOps) {
    this.ops = ops;
  }

  /** Mark the wall network as needing rebuild (call when walls/gates are built or destroyed) */
  markNetworkDirty(): void {
    this._networkDirty = true;
  }

  // ===== Public API =====

  /**
   * Garrison units into a structure. Only buildings and gates are garrisonable.
   * Returns the units that were actually garrisoned.
   */
  garrison(units: Unit[], structureKey: string): Unit[] {
    const type = this.getStructureType(structureKey);
    if (!type || type === 'wall') return [];

    const slot = this.getOrCreateSlot(structureKey);
    if (!slot) return [];

    // Only garrison friendly units
    const friendly = units.filter(u => u.owner === slot.owner);
    const available = slot.capacity - slot.units.length;
    const toGarrison = friendly.slice(0, available);

    for (const unit of toGarrison) {
      // Remove from any existing garrison first
      if (this.unitToStructure.has(unit.id)) {
        this.removeUnitFromSlot(unit);
      }

      slot.units.push(unit);
      this.unitToStructure.set(unit.id, structureKey);

      // Mark unit as garrisoned
      unit._garrisoned = true;
      unit._garrisonKey = structureKey;
      unit.state = UnitState.IDLE;
      unit.command = null;
      unit.targetPosition = null;
      unit._path = null;

      // Hide unit visually
      this.ops.hideUnit(unit);
    }

    if (toGarrison.length > 0) {
      this.ops.playSound('garrison_enter', 0.5);

      // Add cannon turret visual when first unit enters a gate
      if (type === 'gate' && slot.units.length === toGarrison.length) {
        const world = this.ops.hexToWorld(slot.position);
        const elev = this.ops.getElevation(slot.position);
        this.ops.addCannonTurret(structureKey, { x: world.x, y: elev + ARROW_Y_OFFSET, z: world.z }, getPlayerHex(slot.owner));
      }
    }

    return toGarrison;
  }

  /**
   * Get network-wide garrison info for UI display.
   * Returns ALL garrisoned units across every gate/building connected
   * to the given structure via walls.
   */
  getNetworkInfo(structureKey: string): NetworkGarrisonInfo {
    this.ensureNetwork();

    const networkKeys = this.getConnectedStructures(structureKey);
    const allUnits: Unit[] = [];
    let totalCapacity = 0;
    let structureCount = 0;

    for (const key of networkKeys) {
      const slot = this.slots.get(key);
      if (slot) {
        allUnits.push(...slot.units);
      }
      // Count capacity even if no slot exists yet
      const type = this.getStructureType(key);
      if (type === 'building') { totalCapacity += BUILDING_CAPACITY; structureCount++; }
      else if (type === 'gate') { totalCapacity += GATE_CAPACITY; structureCount++; }
      // walls don't count
    }

    const exits = this.getReachableExits(structureKey);

    return {
      units: allUnits,
      current: allUnits.length,
      totalCapacity,
      reachableExits: exits,
      structureCount,
    };
  }

  /**
   * Ungarrison ALL units from the connected network, releasing them at exitKey
   * (or at the clicked structure if no exitKey).
   */
  ungarrisonNetwork(structureKey: string, exitKey?: string): Unit[] {
    this.ensureNetwork();
    const networkKeys = this.getConnectedStructures(structureKey);

    // Determine exit position
    let exitPos = this.keyToCoord(exitKey ?? structureKey);
    if (exitKey && exitKey !== structureKey && !this.isConnected(structureKey, exitKey)) {
      exitPos = this.keyToCoord(structureKey);
    }

    const released: Unit[] = [];
    for (const key of networkKeys) {
      const slot = this.slots.get(key);
      if (!slot || slot.units.length === 0) continue;
      const units = [...slot.units];
      for (const unit of units) {
        this.releaseUnit(unit, exitPos);
        released.push(unit);
      }
      slot.units = [];
      // Remove cannon turret when gate empties
      if (slot.structureType === 'gate') {
        this.ops.removeCannonTurret(key);
      }
    }

    return released;
  }

  /**
   * Ungarrison only units matching specific types from the entire connected network,
   * sending them to an exit point. This powers the pill-filter workflow.
   */
  ungarrisonNetworkFiltered(structureKey: string, unitTypes: Set<UnitType>, exitKey?: string): Unit[] {
    this.ensureNetwork();
    const networkKeys = this.getConnectedStructures(structureKey);

    let exitPos = this.keyToCoord(exitKey ?? structureKey);
    if (exitKey && exitKey !== structureKey && !this.isConnected(structureKey, exitKey)) {
      exitPos = this.keyToCoord(structureKey);
    }

    const released: Unit[] = [];
    for (const key of networkKeys) {
      const slot = this.slots.get(key);
      if (!slot || slot.units.length === 0) continue;

      const toKeep: Unit[] = [];
      for (const unit of slot.units) {
        if (unitTypes.has(unit.type)) {
          this.releaseUnit(unit, exitPos);
          released.push(unit);
        } else {
          toKeep.push(unit);
        }
      }
      slot.units = toKeep;
      // Remove cannon turret when gate empties
      if (slot.structureType === 'gate' && toKeep.length === 0) {
        this.ops.removeCannonTurret(key);
      }
    }

    return released;
  }

  // --- Legacy single-slot methods (still used for building tooltips) ---

  /** Ungarrison all units from a single structure slot */
  ungarrison(structureKey: string, exitKey?: string): Unit[] {
    const slot = this.slots.get(structureKey);
    if (!slot || slot.units.length === 0) return [];

    let exitPos = slot.position;
    if (exitKey && exitKey !== structureKey && this.isConnected(structureKey, exitKey)) {
      exitPos = this.keyToCoord(exitKey);
    }

    const units = [...slot.units];
    for (const unit of units) {
      this.releaseUnit(unit, exitPos);
    }
    slot.units = [];
    if (units.length > 0) {
      this.ops.playSound('garrison_exit', 0.5);
      // Remove cannon turret when gate empties
      if (slot.structureType === 'gate') {
        this.ops.removeCannonTurret(structureKey);
      }
    }
    return units;
  }

  /** Ungarrison only matching types from a single slot */
  ungarrisonFiltered(structureKey: string, unitTypes: Set<UnitType>, exitKey?: string): Unit[] {
    const slot = this.slots.get(structureKey);
    if (!slot || slot.units.length === 0) return [];

    let exitPos = slot.position;
    if (exitKey && exitKey !== structureKey && this.isConnected(structureKey, exitKey)) {
      exitPos = this.keyToCoord(exitKey);
    }

    const toRelease: Unit[] = [];
    const toKeep: Unit[] = [];
    for (const unit of slot.units) {
      if (unitTypes.has(unit.type)) {
        toRelease.push(unit);
      } else {
        toKeep.push(unit);
      }
    }
    slot.units = toKeep;
    for (const unit of toRelease) {
      this.releaseUnit(unit, exitPos);
    }
    if (toRelease.length > 0) {
      this.ops.playSound('garrison_exit', 0.5);
      // Remove cannon turret when gate empties
      if (slot.structureType === 'gate' && toKeep.length === 0) {
        this.ops.removeCannonTurret(structureKey);
      }
    }
    return toRelease;
  }

  /** Called every frame — handles garrison ranged fire */
  update(delta: number): void {
    const allUnits = this.ops.getAllUnits();

    for (const [key, slot] of this.slots) {
      if (slot.units.length === 0) continue;

      // Cooldown
      slot.fireCooldown = Math.max(0, slot.fireCooldown - delta);
      if (slot.fireCooldown > 0) continue;

      // Find nearest enemy in range (extended range for large garrisons)
      const target = this.findFireTarget(slot, allUnits);
      if (!target) {
        // No target — clear cannon turret aim if this is a gate
        if (slot.structureType === 'gate') {
          this.ops.setCannonTarget(key, null);
        }
        continue;
      }

      // Update cannon turret aim toward target
      if (slot.structureType === 'gate') {
        this.ops.setCannonTarget(key, target.worldPosition);
      }

      // Fire interval scales with garrison count — more units = faster fire
      const interval = Math.max(
        GARRISON_FIRE_INTERVAL_MIN,
        GARRISON_FIRE_INTERVAL_BASE - slot.units.length * GARRISON_FIRE_INTERVAL_PER_UNIT,
      );
      slot.fireCooldown = interval;
      this.executeGarrisonFire(slot, target);
    }
  }

  /** Check if a unit is currently garrisoned */
  isGarrisoned(unitId: string): boolean {
    return this.unitToStructure.has(unitId);
  }

  /** Get the garrison slot for a structure */
  getSlot(structureKey: string): GarrisonSlot | undefined {
    return this.slots.get(structureKey);
  }

  /** Get the structure key a unit is garrisoned in */
  getUnitStructure(unitId: string): string | undefined {
    return this.unitToStructure.get(unitId);
  }

  /** Get all garrisoned units for a given owner */
  getGarrisonedUnits(owner: number): Unit[] {
    const result: Unit[] = [];
    for (const slot of this.slots.values()) {
      if (slot.owner === owner) {
        result.push(...slot.units);
      }
    }
    return result;
  }

  /** Can this structure be garrisoned? (buildings + gates only, not walls) */
  canGarrison(structureKey: string): boolean {
    const type = this.getStructureType(structureKey);
    return type === 'building' || type === 'gate';
  }

  /** Get capacity info for a single structure. Returns null for walls. */
  getCapacity(structureKey: string): { current: number; max: number } | null {
    const type = this.getStructureType(structureKey);
    if (!type || type === 'wall') return null;
    const slot = this.slots.get(structureKey);
    const max = type === 'building' ? BUILDING_CAPACITY : GATE_CAPACITY;
    return { current: slot?.units.length ?? 0, max };
  }

  /** Get all exit points reachable from a structure via the wall network */
  getReachableExits(structureKey: string): HexCoord[] {
    this.ensureNetwork();
    const visited = new Set<string>();
    const exits: HexCoord[] = [];
    const queue = [structureKey];
    visited.add(structureKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current !== structureKey && this.exitPoints.has(current)) {
        exits.push(this.keyToCoord(current));
      }
      const neighbors = this.wallNetwork.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }

    return exits;
  }

  /** When a structure is destroyed, eject all garrisoned units */
  onStructureDestroyed(structureKey: string): Unit[] {
    const slot = this.slots.get(structureKey);
    if (!slot || slot.units.length === 0) return [];

    const ejected = [...slot.units];
    for (const unit of ejected) {
      this.releaseUnit(unit, slot.position);
      const collapseDmg = Math.floor(unit.stats.maxHealth * 0.2);
      unit.currentHealth = Math.max(1, unit.currentHealth - collapseDmg);
      this.ops.updateHealthBar(unit);
    }
    slot.units = [];
    this.slots.delete(structureKey);

    this._networkDirty = true;
    return ejected;
  }

  /** Clean up on game reset */
  cleanup(): void {
    for (const slot of this.slots.values()) {
      for (const unit of slot.units) {
        unit._garrisoned = false;
        unit._garrisonKey = undefined;
        this.ops.showUnit(unit);
      }
    }
    this.slots.clear();
    this.unitToStructure.clear();
    this.wallNetwork.clear();
    this.exitPoints.clear();
    this._networkDirty = true;
  }

  // ===== Wall Network Graph =====

  private ensureNetwork(): void {
    if (this._networkDirty) {
      this.rebuildWallNetwork();
      this._networkDirty = false;
    }
  }

  /** Get all structure keys (gates+buildings, NOT walls) connected to a given key */
  private getConnectedStructures(structureKey: string): string[] {
    this.ensureNetwork();
    const visited = new Set<string>();
    const garrisonable: string[] = [];
    const queue = [structureKey];
    visited.add(structureKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      // Include this key if it's a garrisonable structure (gate or building)
      if (this.exitPoints.has(current)) {
        garrisonable.push(current);
      }
      const neighbors = this.wallNetwork.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }

    return garrisonable;
  }

  /** Rebuild the wall connectivity graph from current wall/gate/building state */
  rebuildWallNetwork(): void {
    this.wallNetwork.clear();
    this.exitPoints.clear();

    const walls = this.ops.getWallsBuilt();
    const gates = this.ops.getGatesBuilt();

    const allStructures = new Set<string>();
    for (const key of walls) allStructures.add(key);
    for (const key of gates) {
      allStructures.add(key);
      this.exitPoints.add(key);
    }

    // Add buildings adjacent to any wall/gate
    for (const key of allStructures) {
      const [q, r] = key.split(',').map(Number);
      const neighbors = Pathfinder.getHexNeighbors({ q, r });
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        const building = this.ops.getBuildingAt(n);
        if (building) {
          allStructures.add(nKey);
          this.exitPoints.add(nKey);
        }
      }
    }

    // Build adjacency
    for (const key of allStructures) {
      const [q, r] = key.split(',').map(Number);
      const neighbors = Pathfinder.getHexNeighbors({ q, r });
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (allStructures.has(nKey)) {
          if (!this.wallNetwork.has(key)) this.wallNetwork.set(key, new Set());
          this.wallNetwork.get(key)!.add(nKey);
        }
      }
    }
  }

  /** Check if two structures are connected via the wall network */
  isConnected(fromKey: string, toKey: string): boolean {
    this.ensureNetwork();
    if (fromKey === toKey) return true;

    const visited = new Set<string>();
    const queue = [fromKey];
    visited.add(fromKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toKey) return true;
      const neighbors = this.wallNetwork.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }
    return false;
  }

  // ===== Private Methods =====

  private getOrCreateSlot(key: string): GarrisonSlot | null {
    if (this.slots.has(key)) return this.slots.get(key)!;

    const type = this.getStructureType(key);
    if (!type || type === 'wall') return null;

    const owner = this.getStructureOwner(key, type);
    if (owner < 0) return null;

    const capacity = type === 'building' ? BUILDING_CAPACITY : GATE_CAPACITY;

    const slot: GarrisonSlot = {
      structureKey: key,
      structureType: type,
      owner,
      position: this.keyToCoord(key),
      units: [],
      capacity,
      fireCooldown: 0,
    };

    this.slots.set(key, slot);
    return slot;
  }

  private getStructureType(key: string): StructureType | null {
    const coord = this.keyToCoord(key);
    const building = this.ops.getBuildingAt(coord);
    if (building) return 'building';
    if (this.ops.getGatesBuilt().has(key)) return 'gate';
    if (this.ops.getWallsBuilt().has(key)) return 'wall';
    return null;
  }

  private getStructureOwner(key: string, type: StructureType): number {
    const coord = this.keyToCoord(key);
    if (type === 'building') {
      const building = this.ops.getBuildingAt(coord);
      return building ? building.owner : -1;
    }
    if (type === 'gate') return this.ops.getGateOwner(key);
    if (type === 'wall') return this.ops.getWallOwner(key);
    return -1;
  }

  private releaseUnit(unit: Unit, exitPos: HexCoord): void {
    unit._garrisoned = false;
    unit._garrisonKey = undefined;
    this.unitToStructure.delete(unit.id);

    const spawnPos = this.findNearestOpenTile(exitPos);
    unit.position = spawnPos;
    const world = this.ops.hexToWorld(spawnPos);
    const elev = this.ops.getElevation(spawnPos);
    unit.worldPosition = { x: world.x, y: elev, z: world.z };

    this.ops.showUnit(unit);
  }

  private findNearestOpenTile(pos: HexCoord): HexCoord {
    const key = `${pos.q},${pos.r}`;
    if (!Pathfinder.blockedTiles.has(key)) return pos;

    const visited = new Set<string>();
    const queue: HexCoord[] = [pos];
    visited.add(key);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = Pathfinder.getHexNeighbors(current);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (visited.has(nKey)) continue;
        visited.add(nKey);
        if (!Pathfinder.blockedTiles.has(nKey)) return n;
        queue.push(n);
      }
    }

    return pos;
  }

  private removeUnitFromSlot(unit: Unit): void {
    const key = this.unitToStructure.get(unit.id);
    if (!key) return;
    const slot = this.slots.get(key);
    if (slot) {
      const idx = slot.units.indexOf(unit);
      if (idx >= 0) slot.units.splice(idx, 1);
    }
    this.unitToStructure.delete(unit.id);
  }

  private findFireTarget(slot: GarrisonSlot, allUnits: Unit[]): Unit | null {
    let bestTarget: Unit | null = null;
    let bestDist = Infinity;
    // Extended range for large garrisons (5+ units)
    const range = slot.units.length >= 5 ? GARRISON_FIRE_RANGE_EXTENDED : GARRISON_FIRE_RANGE;

    for (const unit of allUnits) {
      if (unit.owner === slot.owner) continue;
      if (unit.state === UnitState.DEAD || unit._pendingRangedDeath) continue;
      if (unit._garrisoned) continue;

      const dist = Pathfinder.heuristic(unit.position, slot.position);
      if (dist <= range && dist < bestDist) {
        bestDist = dist;
        bestTarget = unit;
      }
    }

    return bestTarget;
  }

  /** Check if a unit type is ranged for garrison purposes */
  private static isRangedType(type: UnitType): boolean {
    return type === UnitType.ARCHER || type === UnitType.MAGE ||
      type === UnitType.BATTLEMAGE;
  }

  /** Check if a unit type is siege for garrison purposes */
  private static isSiegeType(type: UnitType): boolean {
    return type === UnitType.TREBUCHET || type === UnitType.OGRE ||
      type === UnitType.CHAMPION;
  }

  private executeGarrisonFire(slot: GarrisonSlot, target: Unit): void {
    // ─── Stat-based damage calculation ───
    // Each garrisoned unit contributes damage proportional to its ATK stat.
    // Ranged units: 75% of ATK. Melee units: 35% of ATK. Siege units: full ATK.
    let totalDamage = 0;
    let numRanged = 0;
    let hasSiege = false;

    for (const u of slot.units) {
      const atk = u.stats.attack;
      if (GarrisonSystem.isSiegeType(u.type)) {
        totalDamage += atk; // Siege units contribute full ATK
        hasSiege = true;
      } else if (GarrisonSystem.isRangedType(u.type)) {
        totalDamage += Math.ceil(atk * RANGED_GARRISON_MULTIPLIER);
        numRanged++;
      } else {
        totalDamage += Math.ceil(atk * MELEE_GARRISON_MULTIPLIER);
      }
    }
    totalDamage = Math.max(1, totalDamage);

    const structWorld = this.ops.hexToWorld(slot.position);
    const structElev = this.ops.getElevation(slot.position);
    const from = {
      x: structWorld.x,
      y: structElev + ARROW_Y_OFFSET,
      z: structWorld.z,
    };

    // ─── VFX dispatch based on garrison composition ───
    // Siege units → cannonball (heavy single projectile, carries all damage)
    // 3+ ranged → arrow volley (multiple arrows, looks impressive)
    // Default → single arrow
    if (hasSiege) {
      // Fire cannonball for siege damage (main damage payload)
      this.ops.fireCannonball(from, target.worldPosition, () => {
        this.ops.applyDamage(target, totalDamage, slot.units[0] ?? null);
        this.ops.updateHealthBar(target);
      });
      this.ops.playSound('hit_heavy', 0.5);
      // Also fire arrows if ranged units are present (no extra damage, just visual)
      if (numRanged > 0) {
        this.ops.fireArrowVolley(from, target.worldPosition, Math.min(numRanged, 6));
        this.ops.playSound('arrow', 0.2);
      }
    } else if (numRanged >= VOLLEY_THRESHOLD) {
      // Arrow volley — multiple arrows rain down
      this.ops.fireArrowVolley(from, target.worldPosition, Math.min(numRanged, 8), () => {
        this.ops.applyDamage(target, totalDamage, slot.units[0] ?? null);
        this.ops.updateHealthBar(target);
      });
      this.ops.playSound('arrow', 0.4);
    } else {
      // Standard single arrow
      this.ops.fireArrow(from, target.worldPosition, target.id, () => {
        this.ops.applyDamage(target, totalDamage, slot.units[0] ?? null);
        this.ops.updateHealthBar(target);
      });
      this.ops.playSound('arrow', 0.3);
    }
  }

  /** Convert a "q,r" key to HexCoord */
  private keyToCoord(key: string): HexCoord {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }
}
