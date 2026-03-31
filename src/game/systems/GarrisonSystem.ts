/**
 * GarrisonSystem — Manages unit garrisoning in buildings, gates, and walls.
 *
 * Features:
 * - Units can garrison inside friendly buildings (cap 10), gates (cap 5), walls (cap 2)
 * - Garrisoned units are hidden and gain ranged fire from the structure
 * - Walls form connected networks: units can ungarrison at any building/gate
 *   connected by a chain of walls to the structure they entered
 * - Buildings/gates are "exit points" — walls are connectors only
 *
 * Integration:
 * - GarrisonSystem.update() called each frame for ranged fire cooldowns
 * - GarrisonSystem.garrison(units, structureKey) to enter
 * - GarrisonSystem.ungarrison(structureKey, exitKey?) to release
 */

import { Unit, HexCoord, UnitType, UnitState, CommandType, PlacedBuilding } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';

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

  // Damage
  applyDamage(target: Unit, damage: number, attacker: Unit | null): void;
  updateHealthBar(unit: Unit): void;

  // World helpers
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getAllUnits(): Unit[];
  getElevation(pos: HexCoord): number;

  // Notifications
  playSound(name: string, volume?: number): void;
}

// --- Constants ---

const BUILDING_CAPACITY = 10;
const GATE_CAPACITY = 5;
const WALL_CAPACITY = 2;

/** Seconds between garrison ranged attacks */
const GARRISON_FIRE_INTERVAL = 2.0;
/** Base damage per garrisoned unit firing */
const GARRISON_FIRE_DAMAGE = 3;
/** Range in hexes for garrison fire */
const GARRISON_FIRE_RANGE = 4;
/** Height offset above structure for arrow origin */
const ARROW_Y_OFFSET = 3.0;

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

  constructor(ops: GarrisonOps) {
    this.ops = ops;
  }

  // ===== Public API =====

  /** Garrison units into a structure. Returns the units that were actually garrisoned. */
  garrison(units: Unit[], structureKey: string): Unit[] {
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

    return toGarrison;
  }

  /**
   * Ungarrison all units from a structure.
   * If exitKey is provided and reachable via wall network, units appear there.
   * Otherwise units appear at the structure itself.
   * Returns the ungarrisoned units.
   */
  ungarrison(structureKey: string, exitKey?: string): Unit[] {
    const slot = this.slots.get(structureKey);
    if (!slot || slot.units.length === 0) return [];

    // Determine exit position
    let exitPos = slot.position;
    if (exitKey && exitKey !== structureKey) {
      // Verify exitKey is reachable via wall network
      if (this.isConnected(structureKey, exitKey)) {
        const [eq, er] = exitKey.split(',').map(Number);
        exitPos = { q: eq, r: er };
      }
    }

    const units = [...slot.units];
    for (const unit of units) {
      this.releaseUnit(unit, exitPos);
    }
    slot.units = [];

    return units;
  }

  /** Ungarrison a specific number of units from a structure */
  ungarrisonCount(structureKey: string, count: number, exitKey?: string): Unit[] {
    const slot = this.slots.get(structureKey);
    if (!slot || slot.units.length === 0) return [];

    let exitPos = slot.position;
    if (exitKey && exitKey !== structureKey && this.isConnected(structureKey, exitKey)) {
      const [eq, er] = exitKey.split(',').map(Number);
      exitPos = { q: eq, r: er };
    }

    const toRelease = slot.units.splice(0, count);
    for (const unit of toRelease) {
      this.releaseUnit(unit, exitPos);
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

      // Find nearest enemy in range
      const target = this.findFireTarget(slot, allUnits);
      if (!target) continue;

      // Fire!
      slot.fireCooldown = GARRISON_FIRE_INTERVAL;
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

  /** Get capacity info for a structure */
  getCapacity(structureKey: string): { current: number; max: number } | null {
    const type = this.getStructureType(structureKey);
    if (!type) return null;
    const slot = this.slots.get(structureKey);
    const max = type === 'building' ? BUILDING_CAPACITY : type === 'gate' ? GATE_CAPACITY : WALL_CAPACITY;
    return { current: slot?.units.length ?? 0, max };
  }

  /** Get all exit points reachable from a structure via the wall network */
  getReachableExits(structureKey: string): HexCoord[] {
    this.rebuildWallNetwork();
    const visited = new Set<string>();
    const exits: HexCoord[] = [];
    const queue = [structureKey];
    visited.add(structureKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      // Check if this is an exit point (building or gate)
      if (current !== structureKey && this.exitPoints.has(current)) {
        const [q, r] = current.split(',').map(Number);
        exits.push({ q, r });
      }
      // Traverse connected structures
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
      // Ejected units take some damage from the collapse
      const collapseDmg = Math.floor(unit.stats.maxHealth * 0.2);
      unit.currentHealth = Math.max(1, unit.currentHealth - collapseDmg);
      this.ops.updateHealthBar(unit);
    }
    slot.units = [];
    this.slots.delete(structureKey);

    return ejected;
  }

  /** Clean up on game reset */
  cleanup(): void {
    // Show all hidden units before clearing
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
  }

  // ===== Wall Network Graph =====

  /** Rebuild the wall connectivity graph from current wall/gate/building state */
  rebuildWallNetwork(): void {
    this.wallNetwork.clear();
    this.exitPoints.clear();

    const walls = this.ops.getWallsBuilt();
    const gates = this.ops.getGatesBuilt();

    // Collect all "connectable" structure keys
    const allStructures = new Set<string>();
    for (const key of walls) allStructures.add(key);
    for (const key of gates) {
      allStructures.add(key);
      this.exitPoints.add(key); // Gates are exit points
    }

    // Add buildings that are in the wallConnectable set (barracks, etc.)
    // Buildings are identified by checking if there's a PlacedBuilding at a position
    // that's adjacent to any wall/gate
    for (const key of allStructures) {
      const [q, r] = key.split(',').map(Number);
      const neighbors = Pathfinder.getHexNeighbors({ q, r });
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        const building = this.ops.getBuildingAt(n);
        if (building) {
          allStructures.add(nKey);
          this.exitPoints.add(nKey); // Buildings are exit points
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
    this.rebuildWallNetwork();
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

  /** Get or create a garrison slot for a structure */
  private getOrCreateSlot(key: string): GarrisonSlot | null {
    if (this.slots.has(key)) return this.slots.get(key)!;

    const type = this.getStructureType(key);
    if (!type) return null;

    const owner = this.getStructureOwner(key, type);
    if (owner < 0) return null;

    const [q, r] = key.split(',').map(Number);
    const capacity = type === 'building' ? BUILDING_CAPACITY
      : type === 'gate' ? GATE_CAPACITY
      : WALL_CAPACITY;

    const slot: GarrisonSlot = {
      structureKey: key,
      structureType: type,
      owner,
      position: { q, r },
      units: [],
      capacity,
      fireCooldown: 0,
    };

    this.slots.set(key, slot);
    return slot;
  }

  /** Determine what kind of structure is at a hex key */
  private getStructureType(key: string): StructureType | null {
    const [q, r] = key.split(',').map(Number);
    const building = this.ops.getBuildingAt({ q, r });
    if (building) return 'building';
    if (this.ops.getGatesBuilt().has(key)) return 'gate';
    if (this.ops.getWallsBuilt().has(key)) return 'wall';
    return null;
  }

  /** Get the owner of a structure */
  private getStructureOwner(key: string, type: StructureType): number {
    const [q, r] = key.split(',').map(Number);
    if (type === 'building') {
      const building = this.ops.getBuildingAt({ q, r });
      return building ? building.owner : -1;
    }
    if (type === 'gate') return this.ops.getGateOwner(key);
    if (type === 'wall') return this.ops.getWallOwner(key);
    return -1;
  }

  /** Release a single unit from garrison */
  private releaseUnit(unit: Unit, exitPos: HexCoord): void {
    unit._garrisoned = false;
    unit._garrisonKey = undefined;
    this.unitToStructure.delete(unit.id);

    // Find an open tile near the exit position
    const spawnPos = this.findNearestOpenTile(exitPos);
    unit.position = spawnPos;
    const world = this.ops.hexToWorld(spawnPos);
    const elev = this.ops.getElevation(spawnPos);
    unit.worldPosition = { x: world.x, y: elev, z: world.z };

    // Show unit visually
    this.ops.showUnit(unit);
  }

  /** Find the nearest open (non-blocked, non-occupied) tile to a position */
  private findNearestOpenTile(pos: HexCoord): HexCoord {
    const key = `${pos.q},${pos.r}`;
    if (!Pathfinder.blockedTiles.has(key)) return pos;

    // BFS for nearest open tile
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

    return pos; // Fallback
  }

  /** Remove a unit from whatever slot it's in */
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

  /** Find the best enemy target within garrison fire range */
  private findFireTarget(slot: GarrisonSlot, allUnits: Unit[]): Unit | null {
    let bestTarget: Unit | null = null;
    let bestDist = Infinity;

    for (const unit of allUnits) {
      if (unit.owner === slot.owner) continue;
      if (unit.state === UnitState.DEAD || unit._pendingRangedDeath) continue;
      if (unit._garrisoned) continue;

      const dist = Pathfinder.heuristic(unit.position, slot.position);
      if (dist <= GARRISON_FIRE_RANGE && dist < bestDist) {
        bestDist = dist;
        bestTarget = unit;
      }
    }

    return bestTarget;
  }

  /** Execute a ranged attack from garrisoned units */
  private executeGarrisonFire(slot: GarrisonSlot, target: Unit): void {
    // Calculate total damage from all garrisoned units
    const numArchers = slot.units.filter(u =>
      u.type === UnitType.ARCHER || u.type === UnitType.MAGE ||
      u.type === UnitType.BATTLEMAGE).length;
    const numOther = slot.units.length - numArchers;

    // Archers/mages do full damage, others do reduced
    const totalDamage = Math.max(1,
      numArchers * GARRISON_FIRE_DAMAGE +
      Math.floor(numOther * GARRISON_FIRE_DAMAGE * 0.5)
    );

    // Calculate world positions for the arrow
    const structWorld = this.ops.hexToWorld(slot.position);
    const structElev = this.ops.getElevation(slot.position);
    const from = {
      x: structWorld.x,
      y: structElev + ARROW_Y_OFFSET,
      z: structWorld.z,
    };

    // Fire visual projectile
    this.ops.fireArrow(from, target.worldPosition, target.id, () => {
      // Apply damage on impact
      this.ops.applyDamage(target, totalDamage, slot.units[0] ?? null);
      this.ops.updateHealthBar(target);
    });

    this.ops.playSound('arrow', 0.3);
  }
}
