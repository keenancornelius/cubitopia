/**
 * RallyPointSystem — Manages rally points for military buildings.
 *
 * Features:
 * - Set rally points for combat buildings (barracks, armory, wizard_tower)
 * - Display flag + pole + dashed line visuals at rally points
 * - Generate formation slots around rally points for newly spawned units
 *
 * Integration:
 * - RallyPointSystem.enterRallyPointModeForBuilding() to start setting
 * - RallyPointSystem.setRallyPoint() to place/update
 * - RallyPointSystem.getRallyFormationSlot() to get spawn position for new units
 * - RallyPointSystem.clearAllRallyPoints() on game reset
 */

import * as THREE from 'three';
import { Unit, HexCoord, FormationType, GameMap, BuildingKind, UnitState } from '../../types';
import { Pathfinder } from './Pathfinder';
import { generateFormation, getUnitFormationPriority } from './FormationSystem';

// --- Types ---

/** Slim interface — only what RallyPointSystem needs from the outside */
export interface RallyPointOps {
  // Scene management
  addToScene(mesh: THREE.Object3D): void;
  removeFromScene(mesh: THREE.Object3D): void;

  // Building queries
  getFirstBuilding(kind: BuildingKind, owner: number): { position: HexCoord } | null;
  getPlacedBuildings(): Array<{ kind: BuildingKind; owner: number }>;
  getBasePosition(owner: number): HexCoord | null;

  // World helpers
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getElevation(pos: HexCoord): number;
  getCurrentMap(): GameMap | null;

  // Local player
  getLocalPlayerIndex(): number;

  // Unit queries
  getPlayerUnits(owner: number): Unit[];
}

// --- Constants ---

/** Color mapping for rally flags by building type */
const FLAG_COLORS: Record<string, number> = {
  barracks: 0xe74c3c,
  armory: 0xe74c3c,
  forestry: 0x27ae60,
  masonry: 0x808080,
  wizard_tower: 0xdaa520,
  base: 0x3498db,
};

const DEFAULT_FLAG_COLOR = 0xdaa520;

export default class RallyPointSystem {
  private ops: RallyPointOps;

  /** buildingKey → rally target hex coord */
  private rallyPoints: Map<string, HexCoord> = new Map();

  /** buildingKey → flag mesh (pole + flag banner) */
  private rallyFlagMeshes: Map<string, THREE.Group> = new Map();

  /** buildingKey → dashed line from building to rally point */
  private rallyLineMeshes: Map<string, THREE.Line> = new Map();

  constructor(ops: RallyPointOps) {
    this.ops = ops;
  }

  /**
   * Enter rally point setting mode for a building.
   * Caller should handle UI state (cursor, notification, etc.)
   */
  public enterRallyPointModeForBuilding(buildingKey: string): boolean {
    // Just validate the key exists
    return buildingKey.length > 0;
  }

  /**
   * Set or update a rally point for a building.
   * Creates/updates the flag mesh and line visual.
   */
  public setRallyPoint(buildingKey: string, target: HexCoord): void {
    this.rallyPoints.set(buildingKey, target);

    // Get building position for the line
    const PLAYER_ID = this.ops.getLocalPlayerIndex();
    let buildingPos: HexCoord | null = null;
    if (buildingKey === 'base') {
      buildingPos = this.ops.getBasePosition(PLAYER_ID);
    } else {
      const bld = this.ops.getFirstBuilding(buildingKey as BuildingKind, PLAYER_ID);
      if (bld) buildingPos = bld.position;
    }
    if (!buildingPos) return;

    // Remove old visuals
    this._removeRallyVisuals(buildingKey);

    // Create flag mesh at rally point
    const flagGroup = new THREE.Group();
    const wp = this.ops.hexToWorld(target);
    const elev = this.ops.getElevation(target);
    flagGroup.position.set(wp.x, elev, wp.z);

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.75;
    flagGroup.add(pole);

    // Flag banner
    const flagGeo = new THREE.PlaneGeometry(0.5, 0.3);
    const flagColor = FLAG_COLORS[buildingKey] ?? DEFAULT_FLAG_COLOR;
    const flagMat = new THREE.MeshLambertMaterial({ color: flagColor, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.25, 1.35, 0);
    flagGroup.add(flag);

    this.ops.addToScene(flagGroup);
    this.rallyFlagMeshes.set(buildingKey, flagGroup);

    // Create dashed line from building to rally point
    const buildWP = this.ops.hexToWorld(buildingPos);
    const buildElev = this.ops.getElevation(buildingPos);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(buildWP.x, buildElev + 0.5, buildWP.z),
      new THREE.Vector3(wp.x, elev + 0.5, wp.z),
    ]);
    const lineMat = new THREE.LineDashedMaterial({ color: flagColor, dashSize: 0.3, gapSize: 0.2 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    this.ops.addToScene(line);
    this.rallyLineMeshes.set(buildingKey, line);
  }

  /**
   * Get the rally point for a building.
   * Returns null if not set.
   */
  public getRallyPoint(buildingKey: string): HexCoord | null {
    return this.rallyPoints.get(buildingKey) ?? null;
  }

  /**
   * Get a formation slot for a newly spawned unit at a rally point.
   * Gathers nearby player units, sorts by type priority, generates formation slots,
   * and returns the slot designated for the new unit.
   *
   * @param buildingKey Key of the building spawning the unit
   * @param newUnit The newly created unit to place
   * @returns The hex coordinate where the unit should be spawned, or null if no rally point
   */
  public getRallyFormationSlot(buildingKey: string, newUnit: Unit): HexCoord | null {
    const map = this.ops.getCurrentMap();
    if (!map) return null;

    const rally = this.getRallyPoint(buildingKey);
    if (!rally) return null;

    // Gather all units of the same owner within hex distance 5 of the rally point
    // TODO: Replace hardcoded owner with actual player context
    const playerUnits = this.ops.getPlayerUnits(newUnit.owner);
    const nearbyUnits: Unit[] = [];
    for (const unit of playerUnits) {
      if (unit.state === UnitState.DEAD) continue;
      const dist = Pathfinder.heuristic(unit.position, rally);
      if (dist <= 5) {
        nearbyUnits.push(unit);
      }
    }

    // Add the new unit to the list
    const allUnits = [...nearbyUnits, newUnit];

    // Sort by type priority (paladins outer, archers inner)
    allUnits.sort((a, b) => getUnitFormationPriority(a) - getUnitFormationPriority(b));

    // Generate formation slots for all units around the rally point
    const formationSlots = generateFormation(rally, allUnits.length, FormationType.BOX, map.tiles);

    // Return the slot for the new unit (it's at the end of the sorted list)
    const newUnitIndex = allUnits.length - 1;
    return formationSlots[newUnitIndex] || rally;
  }

  /**
   * Clear all rally points and visuals.
   * Called on game reset.
   */
  public clearAllRallyPoints(): void {
    // Remove all flag meshes
    for (const [, flagGroup] of this.rallyFlagMeshes) {
      this.ops.removeFromScene(flagGroup);
    }
    this.rallyFlagMeshes.clear();

    // Remove all line meshes
    for (const [, line] of this.rallyLineMeshes) {
      this.ops.removeFromScene(line);
    }
    this.rallyLineMeshes.clear();

    // Clear rally points
    this.rallyPoints.clear();
  }

  /**
   * Check if rally point setting mode is currently active.
   * (Caller manages the actual mode flag; this just validates.)
   */
  public isValidRallyTarget(buildingKey: string): boolean {
    return buildingKey.length > 0;
  }

  /**
   * Remove visuals for a specific rally point.
   * Used internally when updating a rally point.
   */
  private _removeRallyVisuals(buildingKey: string): void {
    const oldFlag = this.rallyFlagMeshes.get(buildingKey);
    if (oldFlag) {
      this.ops.removeFromScene(oldFlag);
    }

    const oldLine = this.rallyLineMeshes.get(buildingKey);
    if (oldLine) {
      this.ops.removeFromScene(oldLine);
    }

    this.rallyFlagMeshes.delete(buildingKey);
    this.rallyLineMeshes.delete(buildingKey);
  }
}
