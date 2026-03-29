// ============================================
// CUBITOPIA - Wall & Gate Building System
// Handles wall/gate construction, damage, and mesh management
// ============================================

import * as THREE from 'three';
import { HexCoord, GameContext, TerrainType, Unit, PlacedBuilding } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import {
  buildAdaptiveWallMesh as createWallMesh,
  buildGateMesh as createGateMesh,
} from './DefenseMeshFactory';

/**
 * Callbacks provided by main.ts for operations WallSystem can't do alone.
 */
export interface WallSystemOps {
  /** Check if a hex tile key is occupied by a building or unit */
  isTileOccupied(key: string): boolean;
  /** Check if a position is a stockpile location (can't build walls there) */
  isStockpileLocation(pos: HexCoord): boolean;
  /** Remove blueprint ghost at a position after building */
  removeBlueprintGhost(coord: HexCoord): void;
  /** Rebuild the voxel shell for a tile (needed when converting water to plains) */
  rebuildTileShell(coord: HexCoord): void;
  /** Rebuild voxel terrain from map data */
  rebuildVoxels(): void;
  /** Update HUD resource display after spending stone */
  updateResourceDisplay(owner: number): void;
  /** Update stockpile visual (resource piles at base) */
  updateStockpileVisual(owner: number): void;
  /** Get the wallConnectable set from BuildingSystem */
  getWallConnectable(): Set<string>;
  /** Get a building at a position */
  getBuildingAt(pos: HexCoord): PlacedBuilding | null;
  /** Unregister a destroyed building */
  unregisterBuilding(pb: PlacedBuilding): void;
}

export default class WallSystem {
  private ctx: GameContext;
  private ops: WallSystemOps;

  // Wall state
  wallsBuilt: Set<string> = new Set();
  wallOwners: Map<string, number> = new Map();
  wallMeshMap: Map<string, THREE.Group> = new Map();
  wallMeshes: THREE.Group[] = [];
  wallHealth: Map<string, number> = new Map();

  // Gate state
  gatesBuilt: Set<string> = new Set();
  gateOwners: Map<string, number> = new Map();
  gateHealth: Map<string, number> = new Map();
  gateMeshMap: Map<string, THREE.Group> = new Map();
  gateMeshes: THREE.Group[] = [];

  // Constants
  static readonly WALL_MAX_HP = 20;
  static readonly GATE_MAX_HP = 20;
  static readonly BARRACKS_MAX_HP = 40;

  constructor(ctx: GameContext, ops: WallSystemOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  // --- Wall/Gate Construction ---

  handleBuildWall(unit: Unit, wallPos: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${wallPos.q},${wallPos.r}`;
    if (this.wallsBuilt.has(key)) return;

    if (this.ctx.stoneStockpile[unit.owner] < 1) return;

    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (this.ops.isStockpileLocation(wallPos)) return;

    // Consume stone
    this.ctx.stoneStockpile[unit.owner] -= 1;
    this.ops.updateResourceDisplay(unit.owner);

    this.wallsBuilt.add(key);
    this.wallOwners.set(key, unit.owner);
    this.wallHealth.set(key, WallSystem.WALL_MAX_HP);
    this.ops.getWallConnectable().add(key);

    // Convert water to plains if building on water
    if (this.ctx.isWaterTerrain(tile.terrain)) {
      tile.terrain = TerrainType.PLAINS;
      this.ctx.terrainDecorator.removeWater(key);
      this.ops.rebuildTileShell(wallPos);
      this.ops.rebuildVoxels();
    }

    // Sync with UnitAI
    UnitAI.wallsBuilt.add(key);
    UnitAI.wallOwners.set(key, unit.owner);

    // Remove blueprint ghost
    this.ops.removeBlueprintGhost(wallPos);

    // Block pathfinding
    Pathfinder.blockedTiles.add(key);

    // Build mesh and rebuild neighbor connections
    this.buildAdaptiveWallMesh(wallPos, unit.owner);
    const neighbors = Pathfinder.getHexNeighbors(wallPos);
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      if (this.wallsBuilt.has(nKey)) {
        this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
      }
    }

    this.ops.updateStockpileVisual(unit.owner);
  }

  handleBuildGate(unit: Unit, gatePos: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${gatePos.q},${gatePos.r}`;
    if (this.gatesBuilt.has(key)) return;

    if (this.ctx.stoneStockpile[unit.owner] < 2) return;

    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (this.ops.isStockpileLocation(gatePos)) return;

    // Consume 2 stone
    this.ctx.stoneStockpile[unit.owner] -= 2;
    this.ops.updateResourceDisplay(unit.owner);

    this.gatesBuilt.add(key);
    this.gateOwners.set(key, unit.owner);
    this.gateHealth.set(key, WallSystem.GATE_MAX_HP);
    this.ops.getWallConnectable().add(key);

    // Convert water to plains
    if (this.ctx.isWaterTerrain(tile.terrain)) {
      tile.terrain = TerrainType.PLAINS;
      this.ctx.terrainDecorator.removeWater(key);
      this.ops.rebuildTileShell(gatePos);
      this.ops.rebuildVoxels();
    }

    // Remove blueprint ghost
    this.ops.removeBlueprintGhost(gatePos);

    // Block pathfinding + mark as gate
    Pathfinder.blockedTiles.add(key);
    Pathfinder.gateTiles.set(key, unit.owner);

    // Build mesh and rebuild neighbor connections
    this.buildGateMesh(gatePos, unit.owner);
    const neighbors = Pathfinder.getHexNeighbors(gatePos);
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      if (this.wallsBuilt.has(nKey)) {
        this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
      }
      if (this.gatesBuilt.has(nKey)) {
        this.buildGateMesh(n, this.gateOwners.get(nKey) ?? 0);
      }
    }

    this.ops.updateStockpileVisual(unit.owner);
  }

  // --- Direct Placement (arena/scenario — skips resource checks) ---

  placeWallDirect(pos: HexCoord, owner: number): void {
    const key = `${pos.q},${pos.r}`;
    this.wallsBuilt.add(key);
    this.wallOwners.set(key, owner);
    this.wallHealth.set(key, WallSystem.WALL_MAX_HP);
    this.ops.getWallConnectable().add(key);
    UnitAI.wallsBuilt.add(key);
    UnitAI.wallOwners.set(key, owner);
    Pathfinder.blockedTiles.add(key);
    this.buildAdaptiveWallMesh(pos, owner);
  }

  placeGateDirect(pos: HexCoord, owner: number): void {
    const key = `${pos.q},${pos.r}`;
    this.gatesBuilt.add(key);
    this.gateOwners.set(key, owner);
    this.gateHealth.set(key, WallSystem.GATE_MAX_HP);
    this.ops.getWallConnectable().add(key);
    Pathfinder.blockedTiles.add(key);
    Pathfinder.gateTiles.set(key, owner);
    this.buildGateMesh(pos, owner);
  }

  /** Rebuild all wall/gate neighbor connections (call after batch placement) */
  rebuildAllConnections(): void {
    for (const key of this.wallsBuilt) {
      const [q, r] = key.split(',').map(Number);
      this.buildAdaptiveWallMesh({ q, r }, this.wallOwners.get(key) ?? 0);
    }
    for (const key of this.gatesBuilt) {
      const [q, r] = key.split(',').map(Number);
      this.buildGateMesh({ q, r }, this.gateOwners.get(key) ?? 0);
    }
  }

  // --- Damage ---

  damageWall(coord: HexCoord, damage: number): boolean {
    if (!this.ctx.currentMap) return false;
    const key = `${coord.q},${coord.r}`;

    const currentHealth = this.wallHealth.get(key) ?? WallSystem.WALL_MAX_HP;
    const newHealth = Math.max(0, currentHealth - damage);

    if (newHealth <= 0) {
      this.wallsBuilt.delete(key);
      this.wallOwners.delete(key);
      this.wallHealth.delete(key);

      UnitAI.wallsBuilt.delete(key);
      UnitAI.wallOwners.delete(key);

      // Remove mesh
      const mesh = this.wallMeshMap.get(key);
      if (mesh) {
        this.ctx.scene.remove(mesh);
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        const idx = this.wallMeshes.indexOf(mesh);
        if (idx >= 0) this.wallMeshes.splice(idx, 1);
        this.wallMeshMap.delete(key);
      }

      Pathfinder.blockedTiles.delete(key);
      this.ops.getWallConnectable().delete(key);

      // Rebuild adjacent wall connections
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
      }

      return true;
    } else {
      this.wallHealth.set(key, newHealth);
      return false;
    }
  }

  damageGate(coord: HexCoord, damage: number): boolean {
    if (!this.ctx.currentMap) return false;
    const key = `${coord.q},${coord.r}`;

    const currentHealth = this.gateHealth.get(key) ?? WallSystem.GATE_MAX_HP;
    const newHealth = Math.max(0, currentHealth - damage);

    if (newHealth <= 0) {
      this.gatesBuilt.delete(key);
      this.gateOwners.delete(key);
      this.gateHealth.delete(key);

      // Remove mesh
      const mesh = this.gateMeshMap.get(key);
      if (mesh) {
        this.ctx.scene.remove(mesh);
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        const idx = this.gateMeshes.indexOf(mesh);
        if (idx >= 0) this.gateMeshes.splice(idx, 1);
        this.gateMeshMap.delete(key);
      }

      Pathfinder.blockedTiles.delete(key);
      Pathfinder.gateTiles.delete(key);
      this.ops.getWallConnectable().delete(key);

      // Rebuild adjacent wall connections
      const gateNeighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of gateNeighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
      }

      return true;
    } else {
      this.gateHealth.set(key, newHealth);
      return false;
    }
  }

  damageBarracks(coord: HexCoord, damage: number): boolean {
    const key = `${coord.q},${coord.r}`;
    const pb = this.ops.getBuildingAt(coord);
    if (!pb || pb.kind !== 'barracks') return false;

    pb.health = Math.max(0, pb.health - damage);

    if (pb.health <= 0) {
      // Barracks destroyed
      this.ops.getWallConnectable().delete(key);
      Pathfinder.blockedTiles.delete(key);
      UnitAI.barracksPositions.delete(pb.owner);

      this.ops.unregisterBuilding(pb);

      // Rebuild adjacent walls
      const bNeighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of bNeighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
      }
      return true;
    } else {
      // Visual damage feedback — darken the mesh slightly
      const pct = pb.health / pb.maxHealth;
      if (pct < 0.5) {
        pb.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
            child.material.color.multiplyScalar(0.98);
          }
        });
      }
      return false;
    }
  }

  // --- Mesh Building (delegates to DefenseMeshFactory) ---

  buildAdaptiveWallMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;

    // Remove old mesh if rebuilding
    const oldMesh = this.wallMeshMap.get(key);
    if (oldMesh) {
      this.ctx.scene.remove(oldMesh);
      oldMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      const idx = this.wallMeshes.indexOf(oldMesh);
      if (idx >= 0) this.wallMeshes.splice(idx, 1);
    }

    const wallGroup = createWallMesh({
      pos, owner,
      tiles: this.ctx.currentMap.tiles,
      wallConnectable: this.ops.getWallConnectable(),
    });
    if (!wallGroup) return;

    this.ctx.scene.add(wallGroup);
    this.wallMeshes.push(wallGroup);
    this.wallMeshMap.set(key, wallGroup);
  }

  buildGateMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;

    // Remove old mesh if rebuilding
    const oldMesh = this.gateMeshMap.get(key);
    if (oldMesh) {
      this.ctx.scene.remove(oldMesh);
      oldMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      const idx = this.gateMeshes.indexOf(oldMesh);
      if (idx >= 0) this.gateMeshes.splice(idx, 1);
    }

    const gateGroup = createGateMesh({
      pos, owner,
      tiles: this.ctx.currentMap.tiles,
      wallConnectable: this.ops.getWallConnectable(),
      gatesBuilt: this.gatesBuilt,
    });
    if (!gateGroup) return;

    this.ctx.scene.add(gateGroup);
    this.gateMeshes.push(gateGroup);
    this.gateMeshMap.set(key, gateGroup);
  }

  // --- Cleanup ---

  cleanup(): void {
    for (const mesh of this.wallMeshes) {
      this.ctx.scene.remove(mesh);
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    for (const mesh of this.gateMeshes) {
      this.ctx.scene.remove(mesh);
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    this.wallMeshes = [];
    this.gateMeshes = [];
    this.wallMeshMap.clear();
    this.gateMeshMap.clear();
    this.wallsBuilt.clear();
    this.wallOwners.clear();
    this.wallHealth.clear();
    this.gatesBuilt.clear();
    this.gateOwners.clear();
    this.gateHealth.clear();
  }
}
