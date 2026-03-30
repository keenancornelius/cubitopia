/**
 * BlueprintSystem — Manages all blueprint ghosts, harvest markers, mine markers,
 * and farm patch markers. Extracted from main.ts to isolate visual marker lifecycle.
 */

import * as THREE from 'three';
import { HexCoord, GameContext, TerrainType } from '../../types';
import { UnitAI } from './UnitAI';
import { Pathfinder } from './Pathfinder';

/** Slim interface for callbacks requiring main.ts state */
export interface BlueprintOps {
  isTileOccupied(key: string): boolean;
  isWaterTerrain(terrain: TerrainType): boolean;
  getGrassAge(key: string): number | undefined;
}

export default class BlueprintSystem {
  private ctx: GameContext;
  private ops: BlueprintOps;

  /** Wall blueprint ghost meshes */
  blueprintGhosts: Map<string, THREE.Mesh> = new Map();
  /** Harvest area markers */
  harvestMarkers: Map<string, THREE.Mesh> = new Map();
  /** Mine area markers */
  mineMarkers: Map<string, THREE.Mesh | THREE.Group> = new Map();
  /** Farm patch markers */
  farmPatchMarkers: Map<string, THREE.Mesh> = new Map();
  /** Build preview hover ghost */
  hoverGhost: THREE.Group | null = null;
  lastHoverKey = '';
  /** Mine depth layers (1-20), adjustable with scroll wheel */
  mineDepthLayers = 3;

  constructor(ctx: GameContext, ops: BlueprintOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  // ===================== WALL BLUEPRINTS =====================

  toggleWallBlueprint(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;
    if (this.ops.isWaterTerrain(tile.terrain) || tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;

    const added = UnitAI.addBlueprint(coord);
    if (added) {
      this.addBlueprintGhost(coord);
    } else {
      this.removeBlueprintGhost(coord);
    }
  }

  paintWallBlueprint(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (UnitAI.playerWallBlueprint.has(key)) return;
    if (UnitAI.playerGateBlueprint.has(key)) return;
    // wallsBuilt check must be done by caller (wallSystem ref)
    UnitAI.addBlueprint(coord);
    this.addBlueprintGhost(coord);
  }

  removeWallBlueprint(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerWallBlueprint.has(key)) {
      UnitAI.playerWallBlueprint.delete(key);
      this.removeBlueprintGhost(coord);
    }
    if (UnitAI.playerGateBlueprint.has(key)) {
      UnitAI.playerGateBlueprint.delete(key);
      this.removeBlueprintGhost(coord);
    }
  }

  paintGateBlueprint(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (UnitAI.playerGateBlueprint.has(key)) return;
    if (UnitAI.playerWallBlueprint.has(key)) return;
    // gatesBuilt/wallsBuilt check must be done by caller
    UnitAI.addGateBlueprint(coord);
    this.addBlueprintGhost(coord);
  }

  addBlueprintGhost(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.blueprintGhosts.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.ctx.getElevation(coord);

    const ghostGeo = new THREE.BoxGeometry(0.55, 2.0, 0.55);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x3498db, transparent: true, opacity: 0.3, wireframe: false, depthWrite: false,
    });
    const ghost = new THREE.Mesh(ghostGeo, ghostMat);
    ghost.position.set(worldX, baseY + 1.0, worldZ);
    ghost.name = `ghost_${key}`;
    this.ctx.scene.add(ghost);
    this.blueprintGhosts.set(key, ghost);
  }

  removeBlueprintGhost(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const ghost = this.blueprintGhosts.get(key);
    if (ghost) {
      this.ctx.scene.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      this.blueprintGhosts.delete(key);
    }
  }

  clearAllBlueprintGhosts(): void {
    for (const [, ghost] of this.blueprintGhosts) {
      this.ctx.scene.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
    }
    this.blueprintGhosts.clear();
  }

  // ===================== HARVEST MARKERS =====================

  toggleHarvestBlueprint(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;
    if (tile.terrain !== TerrainType.FOREST) return;

    const added = UnitAI.addHarvestBlueprint(coord);
    if (added) {
      this.addHarvestMarker(coord);
    } else {
      this.removeHarvestMarker(coord);
    }
  }

  paintHarvestTile(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile || tile.terrain !== TerrainType.FOREST) return;
    if (UnitAI.playerHarvestBlueprint.has(key)) return;
    UnitAI.playerHarvestBlueprint.add(key);
    this.addHarvestMarker(coord);
  }

  addHarvestMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.harvestMarkers.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.ctx.getElevation(coord);

    const ringGeo = new THREE.RingGeometry(0.5, 0.7, 6);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4caf50, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, baseY + 0.05, worldZ);
    ring.name = `harvest_${key}`;
    this.ctx.scene.add(ring);
    this.harvestMarkers.set(key, ring);
  }

  removeHarvestMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const marker = this.harvestMarkers.get(key);
    if (marker) {
      this.ctx.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.harvestMarkers.delete(key);
    }
  }

  clearAllHarvestMarkers(): void {
    for (const [, marker] of this.harvestMarkers) {
      this.ctx.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.harvestMarkers.clear();
  }

  // ===================== MINE SYSTEM (v2 — unified) =====================
  //
  // ONE blueprint type for all mining. Each blueprint stores:
  //   startY  — the highest Y level to mine (surface-1 for surface mines, or sliceY for tunnels)
  //   depth   — how many layers to remove downward from startY
  //
  // Miners always work TOP-DOWN within the startY→(startY-depth+1) range.
  // No separate "horizontal" vs "vertical" mode — it's all the same: remove
  // blocks in a Y range. The slicer just controls WHERE startY is.

  /** Paint a mine blueprint on a tile.
   *  @param coord   hex coordinate
   *  @param startY  highest Y level to mine (null = surface-1, i.e. top of tile)
   */
  paintMine(coord: HexCoord, startY: number | null = null): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;
    if (this.ops.isWaterTerrain(tile.terrain)) return;

    // Determine the Y range to mine
    const depth = this.mineDepthLayers;
    const topY = startY ?? (tile.elevation - 1);  // surface = elevation-1
    const bottomY = topY - depth + 1;

    // Check tile actually has blocks in this range
    const hasBlocks = tile.voxelData.blocks.some(
      b => b.localPosition.y >= bottomY && b.localPosition.y <= topY
    );
    if (!hasBlocks) return;

    // If already blueprinted, toggle off (erase)
    if (UnitAI.playerMineBlueprint.has(key)) return;

    UnitAI.playerMineBlueprint.set(key, {
      startY: topY,
      depth,
    });

    this.addMineMarker(coord, topY, depth);
  }

  /** Remove a mine blueprint from a tile */
  unpaintMine(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (!UnitAI.playerMineBlueprint.has(key)) return;
    UnitAI.playerMineBlueprint.delete(key);
    UnitAI.claimedMines.delete(key);
    this.removeMineMarker(coord);
  }

  /** Adjust mine depth with scroll wheel (1-20) */
  adjustMineDepth(delta: number): void {
    this.mineDepthLayers = Math.max(1, Math.min(20, this.mineDepthLayers + delta));
  }

  /** Place a yellow ring marker at the mine's startY position */
  addMineMarker(coord: HexCoord, startY: number, depth: number): void {
    const key = `${coord.q},${coord.r}`;
    if (this.mineMarkers.has(key)) this.removeMineMarker(coord);

    const VOXEL_SIZE = 0.52;
    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    // Position ring at the TOP of the mine range (startY)
    const markerY = (startY + 1) * VOXEL_SIZE + 0.02;

    const innerRadius = 0.5 - Math.min(0.15, depth * 0.015);
    const ringGeo = new THREE.RingGeometry(innerRadius, 0.7, 6);
    const brightness = Math.min(1.0, 0.5 + depth * 0.05);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, brightness * 0.55, 0),
      transparent: true,
      opacity: Math.min(0.85, 0.5 + depth * 0.03),
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, markerY, worldZ);
    ring.name = `mine_${key}`;
    this.ctx.scene.add(ring);
    this.mineMarkers.set(key, ring);
  }

  /** Remove mine marker for a tile */
  removeMineMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const marker = this.mineMarkers.get(key);
    if (!marker) return;
    this.ctx.scene.remove(marker);
    if (marker instanceof THREE.Group) {
      for (const child of marker.children) {
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
      }
    } else {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.mineMarkers.delete(key);
  }

  /** Remove all mine markers */
  clearAllMineMarkers(): void {
    for (const [key] of this.mineMarkers) {
      const [q, r] = key.split(',').map(Number);
      this.removeMineMarker({ q, r });
    }
  }

  // ===================== FARM PATCH MARKERS =====================

  paintFarmPatch(coord: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile || tile.terrain !== TerrainType.PLAINS) return;
    if (Pathfinder.blockedTiles.has(key)) return;

    // If tall grass (stage >= 2), mark for villager grass harvesting
    const grassStage = this.ops.getGrassAge(key);
    if (grassStage !== undefined && grassStage >= 2) {
      if (UnitAI.playerGrassBlueprint.has(key)) return;
      UnitAI.playerGrassBlueprint.add(key);
      this.addFarmPatchMarker(coord);
      return;
    }

    // Otherwise mark as farm patch
    if (UnitAI.farmPatches.has(key)) return;
    if (this.farmPatchMarkers.has(key)) return;
    UnitAI.farmPatches.add(key);
    this.addFarmPatchMarker(coord);
  }

  addFarmPatchMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.farmPatchMarkers.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.ctx.getElevation(coord);

    const patchGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const patchMat = new THREE.MeshLambertMaterial({
      color: 0x8b6914, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
    });
    const marker = new THREE.Mesh(patchGeo, patchMat);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(worldX, baseY + 0.03, worldZ);
    marker.name = `farm_${key}`;
    this.ctx.scene.add(marker);
    this.farmPatchMarkers.set(key, marker);
  }

  // ===================== HOVER GHOST =====================

  clearHoverGhost(): void {
    if (this.hoverGhost) {
      this.ctx.scene.remove(this.hoverGhost);
      this.hoverGhost.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      this.hoverGhost = null;
    }
    this.lastHoverKey = '';
  }

  // ===================== CLEANUP =====================

  cleanup(): void {
    this.clearAllBlueprintGhosts();
    this.clearAllHarvestMarkers();
    this.clearAllMineMarkers();
    for (const [, marker] of this.farmPatchMarkers) {
      this.ctx.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.farmPatchMarkers.clear();
    this.clearHoverGhost();
    this.mineDepthLayers = 3;
  }
}
