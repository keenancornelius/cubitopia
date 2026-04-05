import * as THREE from 'three';
import { HexCoord, PlacedBuilding, BuildingKind, GameContext, TerrainType, UnitType } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import {
  buildForestryMesh, buildBarracksMesh, buildMasonryMesh,
  buildFarmhouseMesh, buildWorkshopMesh, buildSiloMesh,
  buildSmelterMesh, buildArmoryMesh, buildWizardTowerMesh,
  buildMineMesh, buildMarketMesh
} from './BuildingMeshFactory';
import { GAME_CONFIG } from '../GameConfig';
import { mergeAllMeshes } from '../../engine/MeshMergeUtils';

let nextBuildingId = 0;

/**
 * Callback for wall-rebuild when a building is unregistered.
 * main.ts provides this so BuildingSystem doesn't need wall logic.
 */
export type WallRebuildCallback = (pos: HexCoord, owner: number) => void;

class BuildingSystem {
  private ctx: GameContext;

  placedBuildings: PlacedBuilding[] = [];
  buildingSpawnIndex: Record<BuildingKind, number> = {
    barracks: 0, forestry: 0, masonry: 0, farmhouse: 0, workshop: 0, silo: 0, smelter: 0, armory: 0, wizard_tower: 0, mine: 0, market: 0
  };
  wallConnectable: Set<string> = new Set();

  /** Optional callback invoked on neighboring wall tiles when a building is unregistered */
  private wallRebuildCb: WallRebuildCallback | null = null;
  /** Set reference for checking which tiles have walls (provided by main.ts) */
  private wallsBuiltRef: Set<string> | null = null;
  /** Map reference for wall ownership (provided by main.ts) */
  private wallOwnersRef: Map<string, number> | null = null;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /** Set wall references so unregisterBuilding can trigger wall rebuilds */
  setWallRefs(
    wallsBuilt: Set<string>,
    wallOwners: Map<string, number>,
    rebuildCb: WallRebuildCallback
  ): void {
    this.wallsBuiltRef = wallsBuilt;
    this.wallOwnersRef = wallOwners;
    this.wallRebuildCb = rebuildCb;
  }

  // --- Query Methods ---

  getFirstBuilding(kind: BuildingKind, owner = 0): { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null {
    const b = this.placedBuildings.find(pb => pb.kind === kind && pb.owner === owner);
    return b ? { position: b.position, worldPosition: b.worldPosition } : null;
  }

  getBuildingsOfKind(kind: BuildingKind, owner = 0): PlacedBuilding[] {
    return this.placedBuildings.filter(pb => pb.kind === kind && pb.owner === owner && !pb.isBlueprint);
  }

  /** Peek at the next spawn building without advancing the round-robin index */
  getNextSpawnBuilding(kind: BuildingKind, owner = 0): PlacedBuilding | null {
    const buildings = this.getBuildingsOfKind(kind, owner);
    if (buildings.length === 0) return null;
    const idx = this.buildingSpawnIndex[kind] % buildings.length;
    return buildings[idx];
  }

  /** Advance the round-robin spawn index for a building kind. Call after actually spawning. */
  advanceSpawnIndex(kind: BuildingKind): void {
    this.buildingSpawnIndex[kind] = (this.buildingSpawnIndex[kind] ?? 0) + 1;
  }

  getBuildingAt(pos: HexCoord, owner?: number): PlacedBuilding | null {
    const key = `${pos.q},${pos.r}`;
    return this.placedBuildings.find(
      pb => `${pb.position.q},${pb.position.r}` === key && (owner === undefined || pb.owner === owner)
    ) ?? null;
  }

  // --- Registry Methods ---

  registerBuilding(kind: BuildingKind, owner: number, pos: HexCoord, mesh: THREE.Group, maxHealth = 200, startAsBlueprint = true): PlacedBuilding {
    const pb: PlacedBuilding = {
      id: `bld_${nextBuildingId++}`,
      kind, owner, position: pos,
      worldPosition: this.ctx.hexToWorld(pos),
      mesh, health: maxHealth, maxHealth,
      constructionProgress: startAsBlueprint ? 0 : 1,
      isBlueprint: startAsBlueprint,
      assignedBuilderId: null,
    };
    this.placedBuildings.push(pb);
    const key = `${pos.q},${pos.r}`;
    this.wallConnectable.add(key);
    // Track in UnitAI so all units can auto-attack enemy buildings
    UnitAI.buildingPositions.add(key);
    UnitAI.buildingOwners.set(key, owner);

    // Only block pathfinding for completed buildings — blueprints must remain
    // pathable so builders can reach them. blockedTiles is added in
    // advanceConstruction() when construction completes.
    if (!startAsBlueprint) {
      Pathfinder.blockedTiles.add(key);
      // Merge all meshes in completed buildings to reduce draw calls
      mergeAllMeshes(mesh);
    }

    // Blueprint visual: make mesh semi-transparent + add wireframe overlay
    if (startAsBlueprint) {
      this.applyBlueprintVisual(mesh, 0);
    }
    return pb;
  }

  /** Make building mesh semi-transparent and add blue wireframe to indicate blueprint state */
  applyBlueprintVisual(mesh: THREE.Group, progress: number): void {
    const baseOpacity = 0.2 + progress * 0.8; // 0.2 at start, 1.0 when done
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshLambertMaterial;
        if (!mat.userData) mat.userData = {};
        // Store original opacity on first call
        if (mat.userData._origOpacity === undefined) {
          mat.userData._origOpacity = mat.opacity;
          mat.userData._origTransparent = mat.transparent;
        }
        mat.transparent = true;
        mat.opacity = baseOpacity;
        mat.needsUpdate = true;
      }
    });
  }

  /** Restore building mesh to full opacity when construction completes */
  clearBlueprintVisual(mesh: THREE.Group): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshLambertMaterial;
        if (mat.userData?._origOpacity !== undefined) {
          mat.opacity = mat.userData._origOpacity;
          mat.transparent = mat.userData._origTransparent;
          delete mat.userData._origOpacity;
          delete mat.userData._origTransparent;
          mat.needsUpdate = true;
        }
      }
    });
  }

  /** Update construction progress — returns true when building completes */
  advanceConstruction(pb: PlacedBuilding, amount: number): boolean {
    if (!pb.isBlueprint) return false;
    pb.constructionProgress = Math.min(1, pb.constructionProgress + amount);
    this.applyBlueprintVisual(pb.mesh, pb.constructionProgress);
    if (pb.constructionProgress >= 1) {
      pb.isBlueprint = false;
      pb.assignedBuilderId = null;
      this.clearBlueprintVisual(pb.mesh);
      // Merge all meshes now that construction is complete (safe to use cached materials)
      mergeAllMeshes(pb.mesh);
      // Now that construction is complete, block the tile for pathfinding
      const key = `${pb.position.q},${pb.position.r}`;
      Pathfinder.blockedTiles.add(key);
      return true; // construction complete
    }
    return false;
  }

  /** Find the nearest blueprint building for a given owner */
  findNearestBlueprint(pos: HexCoord, owner: number): PlacedBuilding | null {
    let best: PlacedBuilding | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.placedBuildings.length; i++) {
      const pb = this.placedBuildings[i];
      if (pb.owner !== owner || !pb.isBlueprint) continue;
      // Skip if already assigned to another builder
      if (pb.assignedBuilderId) continue;
      const dist = Math.abs(pb.position.q - pos.q) + Math.abs(pb.position.r - pos.r);
      if (dist < bestDist) {
        bestDist = dist;
        best = pb;
      }
    }
    return best;
  }

  unregisterBuilding(pb: PlacedBuilding): void {
    const idx = this.placedBuildings.indexOf(pb);
    if (idx >= 0) this.placedBuildings.splice(idx, 1);
    const key = `${pb.position.q},${pb.position.r}`;
    this.wallConnectable.delete(key);
    Pathfinder.blockedTiles.delete(key);
    UnitAI.buildingPositions.delete(key);
    UnitAI.buildingOwners.delete(key);
    this.ctx.scene.remove(pb.mesh);
    // Rebuild adjacent walls if wall system is connected
    if (this.wallRebuildCb && this.wallsBuiltRef && this.wallOwnersRef) {
      const neighbors = Pathfinder.getHexNeighbors(pb.position);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuiltRef.has(nKey)) {
          this.wallRebuildCb(n, this.wallOwnersRef.get(nKey) ?? 0);
        }
      }
    }
  }

  // --- Mesh Builders (delegate to BuildingMeshFactory pure functions) ---

  buildForestryMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildForestryMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildBarracksMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildBarracksMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildMasonryMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildMasonryMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildFarmhouseMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildFarmhouseMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildWorkshopMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildWorkshopMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildSiloMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildSiloMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildSmelterMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildSmelterMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildArmoryMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildArmoryMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildWizardTowerMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildWizardTowerMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildMineMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildMineMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }
  buildMarketMesh(pos: HexCoord, owner: number): THREE.Group {
    return buildMarketMesh(pos, owner, this.ctx.scene, (p) => this.ctx.getElevation(p));
  }

  /** Rebuild a building's mesh with its current owner (e.g. after zone capture) */
  refreshBuildingMesh(pb: PlacedBuilding): void {
    // Remove old mesh
    this.ctx.scene.remove(pb.mesh);
    pb.mesh.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Don't dispose materials — they may be shared via the global material cache
      }
    });

    // Rebuild mesh with the building's current owner
    const meshBuilders: Record<string, (pos: HexCoord, owner: number) => THREE.Group> = {
      forestry: (p, o) => this.buildForestryMesh(p, o),
      barracks: (p, o) => this.buildBarracksMesh(p, o),
      masonry: (p, o) => this.buildMasonryMesh(p, o),
      farmhouse: (p, o) => this.buildFarmhouseMesh(p, o),
      workshop: (p, o) => this.buildWorkshopMesh(p, o),
      silo: (p, o) => this.buildSiloMesh(p, o),
      smelter: (p, o) => this.buildSmelterMesh(p, o),
      armory: (p, o) => this.buildArmoryMesh(p, o),
      wizard_tower: (p, o) => this.buildWizardTowerMesh(p, o),
      mine: (p, o) => this.buildMineMesh(p, o),
      market: (p, o) => this.buildMarketMesh(p, o),
    };
    const builder = meshBuilders[pb.kind];
    if (builder) {
      pb.mesh = builder(pb.position, pb.owner);
      // Merge meshes for completed buildings
      if (!pb.isBlueprint) {
        mergeAllMeshes(pb.mesh);
      }
    }
  }

  // --- Static Helpers ---

  static bm(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }

  // --- AI Helpers ---

  aiFindBuildTile(baseQ: number, baseR: number, offsetQ: number, offsetR: number): HexCoord | null {
    if (!this.ctx.currentMap) return null;
    const preferQ = baseQ + offsetQ;
    const preferR = baseR + offsetR;
    for (let radius = 0; radius < 5; radius++) {
      for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = -radius; dr <= radius; dr++) {
          const q = preferQ + dq;
          const r = preferR + dr;
          const key = `${q},${r}`;
          const tile = this.ctx.currentMap.tiles.get(key);
          if (tile && tile.terrain === TerrainType.PLAINS && !Pathfinder.blockedTiles.has(key) && !this.ctx.isTileOccupied(key)) {
            return { q, r };
          }
        }
      }
    }
    return null;
  }

  // --- Queue Options (static data) ---

  getBuildingQueueOptions(kind: BuildingKind): { type: string; label: string; costLabel: string }[] {
    switch (kind) {
      case 'barracks': return [
        { type: 'warrior', label: 'Warrior', costLabel: `${GAME_CONFIG.units[UnitType.WARRIOR].costs.tooltipQueue.gold}g` },
        { type: 'archer', label: 'Archer', costLabel: `${GAME_CONFIG.units[UnitType.ARCHER].costs.tooltipQueue.gold}g` },
        { type: 'rider', label: 'Rider', costLabel: `${GAME_CONFIG.units[UnitType.RIDER].costs.tooltipQueue.gold}g` },
      ];
      case 'forestry': return [
        { type: 'lumberjack', label: 'Lumberjack', costLabel: `${GAME_CONFIG.units[UnitType.LUMBERJACK].costs.tooltipQueue.wood}w` },
        { type: 'scout', label: 'Scout', costLabel: `${GAME_CONFIG.units[UnitType.SCOUT].costs.tooltipQueue.wood}w` },
      ];
      case 'masonry': return [
        { type: 'builder', label: 'Builder', costLabel: `${GAME_CONFIG.units[UnitType.BUILDER].costs.tooltipQueue.wood}w` },
      ];
      case 'farmhouse': return [
        { type: 'villager', label: 'Villager', costLabel: `${GAME_CONFIG.units[UnitType.VILLAGER].costs.tooltipQueue.wood}w` },
      ];
      case 'workshop': return [
        {
          type: 'trebuchet',
          label: 'Trebuchet',
          costLabel: `${GAME_CONFIG.units[UnitType.TREBUCHET].costs.tooltipQueue.rope}r+${GAME_CONFIG.units[UnitType.TREBUCHET].costs.tooltipQueue.stone}s+${GAME_CONFIG.units[UnitType.TREBUCHET].costs.tooltipQueue.wood}w`,
        },
      ];
      case 'armory': return [
        { type: 'greatsword', label: 'Greatsword', costLabel: `${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.steel}s` },
        { type: 'assassin', label: 'Assassin', costLabel: `${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.steel}s` },
        { type: 'berserker', label: 'Berserker', costLabel: `${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.steel}s` },
        { type: 'shieldbearer', label: 'Shieldbearer', costLabel: `${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.steel}s` },
      ];
      case 'wizard_tower': return [
        { type: 'mage', label: 'Mage', costLabel: `${GAME_CONFIG.units[UnitType.MAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.MAGE].costs.menu.crystal}c` },
        { type: 'battlemage', label: 'Battlemage', costLabel: `${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.crystal}c` },
        { type: 'healer', label: 'Healer', costLabel: `${GAME_CONFIG.units[UnitType.HEALER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.HEALER].costs.menu.crystal}c` },
        { type: 'paladin', label: 'Paladin', costLabel: `${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.crystal}c` },
      ];
      case 'silo': return [];
      default: return [];
    }
  }

  // --- Cleanup ---

  cleanup(): void {
    for (const pb of this.placedBuildings) {
      if (pb.mesh.parent) {
        pb.mesh.parent.remove(pb.mesh);
      }
      this.ctx.scene.remove(pb.mesh);
      // Dispose GPU resources to prevent WebGL memory leaks on restart
      pb.mesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            (child.material as THREE.Material).dispose();
          }
        }
      });
    }
    this.placedBuildings = [];
    this.wallConnectable.clear();
    this.buildingSpawnIndex = {
      barracks: 0, forestry: 0, masonry: 0, farmhouse: 0, workshop: 0, silo: 0, smelter: 0, armory: 0, wizard_tower: 0, mine: 0, market: 0
    };
    nextBuildingId = 0;
    // Clear UnitAI static collections to prevent phantom buildings in new matches
    UnitAI.buildingPositions.clear();
    UnitAI.buildingOwners.clear();
  }
}

export default BuildingSystem;
