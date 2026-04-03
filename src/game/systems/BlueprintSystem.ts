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
    if (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE) return;

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
    if (!tile || (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE)) return;
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

  /** Place a 3D mine shaft ghost model at the mine blueprint position */
  addMineMarker(coord: HexCoord, startY: number, depth: number): void {
    const key = `${coord.q},${coord.r}`;
    if (this.mineMarkers.has(key)) this.removeMineMarker(coord);

    const VOXEL_SIZE = 0.52;
    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const markerY = (startY + 1) * VOXEL_SIZE;

    const group = new THREE.Group();
    group.position.set(worldX, markerY, worldZ);
    group.name = `mine_${key}`;

    // Ghost material — semi-transparent blue like building blueprints
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xd4a44a, transparent: true, opacity: 0.35, depthWrite: false,
    });
    const frameMat = new THREE.MeshBasicMaterial({
      color: 0x8B5A2B, transparent: true, opacity: 0.45, depthWrite: false,
    });

    // --- Mine shaft hole (dark opening in the ground) ---
    const holeGeo = new THREE.BoxGeometry(0.5, 0.12, 0.5);
    const holeMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.set(0, -0.04, 0);
    group.add(hole);

    // --- Timber frame entrance (two vertical posts + crossbeam) ---
    const postGeo = new THREE.BoxGeometry(0.08, 0.6, 0.08);

    // Left post
    const postL = new THREE.Mesh(postGeo, frameMat);
    postL.position.set(-0.25, 0.3, 0.25);
    group.add(postL);

    // Right post
    const postR = new THREE.Mesh(postGeo, frameMat);
    postR.position.set(0.25, 0.3, 0.25);
    group.add(postR);

    // Crossbeam on top
    const beamGeo = new THREE.BoxGeometry(0.6, 0.08, 0.08);
    const beam = new THREE.Mesh(beamGeo, frameMat);
    beam.position.set(0, 0.62, 0.25);
    group.add(beam);

    // --- Triangular roof peak (small box angled to look like a tent peak) ---
    const roofGeo = new THREE.BoxGeometry(0.5, 0.06, 0.35);
    const roof = new THREE.Mesh(roofGeo, ghostMat);
    roof.position.set(0, 0.68, 0.12);
    roof.rotation.x = 0.3;
    group.add(roof);

    // --- Depth indicator: shaft going down (semi-transparent column) ---
    const shaftHeight = Math.min(depth * VOXEL_SIZE, 8);
    const shaftGeo = new THREE.BoxGeometry(0.4, shaftHeight, 0.4);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x2a1a0a, transparent: true, opacity: 0.15, depthWrite: false,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(0, -shaftHeight / 2, 0);
    group.add(shaft);

    // --- Ladder detail (two rails + rungs) ---
    const railGeo = new THREE.BoxGeometry(0.03, 0.55, 0.03);
    const railL = new THREE.Mesh(railGeo, frameMat);
    railL.position.set(-0.08, 0.28, -0.18);
    group.add(railL);
    const railR = new THREE.Mesh(railGeo, frameMat);
    railR.position.set(0.08, 0.28, -0.18);
    group.add(railR);
    // Rungs
    const rungGeo = new THREE.BoxGeometry(0.19, 0.025, 0.03);
    for (let i = 0; i < 4; i++) {
      const rung = new THREE.Mesh(rungGeo, frameMat);
      rung.position.set(0, 0.1 + i * 0.14, -0.18);
      group.add(rung);
    }

    // --- Pickaxe leaning against frame ---
    const handleGeo = new THREE.BoxGeometry(0.03, 0.4, 0.03);
    const handle = new THREE.Mesh(handleGeo, frameMat);
    handle.position.set(0.35, 0.22, 0.18);
    handle.rotation.z = 0.25;
    group.add(handle);
    const headGeo = new THREE.BoxGeometry(0.18, 0.05, 0.05);
    const headMat = new THREE.MeshBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.4, depthWrite: false,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0.38, 0.44, 0.18);
    head.rotation.z = 0.25;
    group.add(head);

    this.ctx.scene.add(group);
    this.mineMarkers.set(key, group);
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
