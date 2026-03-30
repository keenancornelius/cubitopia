import * as THREE from 'three';
import { HexCoord, PlacedBuilding, BuildingKind, GameContext, TerrainType } from '../../types';
import { Pathfinder } from './Pathfinder';
import {
  buildForestryMesh, buildBarracksMesh, buildMasonryMesh,
  buildFarmhouseMesh, buildWorkshopMesh, buildSiloMesh,
  buildSmelterMesh, buildArmoryMesh, buildWizardTowerMesh
} from './BuildingMeshFactory';

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
    barracks: 0, forestry: 0, masonry: 0, farmhouse: 0, workshop: 0, silo: 0, smelter: 0, armory: 0, wizard_tower: 0
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
    return this.placedBuildings.filter(pb => pb.kind === kind && pb.owner === owner);
  }

  getNextSpawnBuilding(kind: BuildingKind, owner = 0): PlacedBuilding | null {
    const buildings = this.getBuildingsOfKind(kind, owner);
    if (buildings.length === 0) return null;
    const idx = this.buildingSpawnIndex[kind] % buildings.length;
    this.buildingSpawnIndex[kind] = idx + 1;
    return buildings[idx];
  }

  getBuildingAt(pos: HexCoord, owner?: number): PlacedBuilding | null {
    const key = `${pos.q},${pos.r}`;
    return this.placedBuildings.find(
      pb => `${pb.position.q},${pb.position.r}` === key && (owner === undefined || pb.owner === owner)
    ) ?? null;
  }

  // --- Registry Methods ---

  registerBuilding(kind: BuildingKind, owner: number, pos: HexCoord, mesh: THREE.Group, maxHealth = 40): PlacedBuilding {
    const pb: PlacedBuilding = {
      id: `bld_${nextBuildingId++}`,
      kind, owner, position: pos,
      worldPosition: this.ctx.hexToWorld(pos),
      mesh, health: maxHealth, maxHealth,
    };
    this.placedBuildings.push(pb);
    const key = `${pos.q},${pos.r}`;
    this.wallConnectable.add(key);
    return pb;
  }

  unregisterBuilding(pb: PlacedBuilding): void {
    const idx = this.placedBuildings.indexOf(pb);
    if (idx >= 0) this.placedBuildings.splice(idx, 1);
    const key = `${pb.position.q},${pb.position.r}`;
    this.wallConnectable.delete(key);
    Pathfinder.blockedTiles.delete(key);
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
        { type: 'warrior', label: 'Warrior', costLabel: '5g' },
        { type: 'archer', label: 'Archer', costLabel: '8g' },
        { type: 'rider', label: 'Rider', costLabel: '10g' },
        { type: 'paladin', label: 'Paladin', costLabel: '6g' },
      ];
      case 'forestry': return [
        { type: 'lumberjack', label: 'Lumberjack', costLabel: '3w' },
        { type: 'scout', label: 'Scout', costLabel: '4w' },
      ];
      case 'masonry': return [
        { type: 'builder', label: 'Builder', costLabel: '4w' },
      ];
      case 'farmhouse': return [
        { type: 'villager', label: 'Villager', costLabel: '3w' },
      ];
      case 'workshop': return [
        { type: 'trebuchet', label: 'Trebuchet', costLabel: '6r+4s+4w' },
        { type: 'catapult', label: 'Catapult', costLabel: '3r+3s+3w' },
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
    }
    this.placedBuildings = [];
    this.wallConnectable.clear();
    this.buildingSpawnIndex = {
      barracks: 0, forestry: 0, masonry: 0, farmhouse: 0, workshop: 0, silo: 0, smelter: 0, armory: 0, wizard_tower: 0
    };
    nextBuildingId = 0;
  }
}

export default BuildingSystem;
