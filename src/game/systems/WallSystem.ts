// ============================================
// CUBITOPIA - Wall & Gate Building System
// Handles wall/gate construction, damage, and mesh generation
// ============================================

import * as THREE from 'three';
import { HexCoord, GameContext, TerrainType, Unit, PlacedBuilding } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';

export default class WallSystem {
  private ctx: GameContext;
  private wallConnectable: Set<string>;

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

  // Barracks health tracking (for other buildings)
  barracksHealth: Map<string, number> = new Map();

  // Constants
  static readonly WALL_MAX_HP = 20;
  static readonly GATE_MAX_HP = 20;
  static readonly BARRACKS_MAX_HP = 40;

  // Callbacks for external updates
  rebuildTileShellCallback?: (pos: HexCoord) => void;
  updateStockpileCallback?: (owner: number) => void;

  constructor(ctx: GameContext, wallConnectable: Set<string>) {
    this.ctx = ctx;
    this.wallConnectable = wallConnectable;
  }

  /**
   * Build a wall at the given position
   * Costs 1 stone. Validates terrain and resources.
   */
  handleBuildWall(unit: Unit, wallPos: HexCoord): boolean {
    const key = `${wallPos.q},${wallPos.r}`;

    // Check if already built
    if (this.wallsBuilt.has(key) || this.gatesBuilt.has(key)) {
      return false;
    }

    // Check resources
    if (this.ctx.stoneStockpile[unit.owner] < 1) {
      return false;
    }

    // Get tile
    if (!this.ctx.currentMap) return false;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return false;

    // Validate terrain: no forest or mountain
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) {
      return false;
    }

    // Check not occupied by other units
    if (tile.unit) {
      return false;
    }

    // Check not on stockpile locations (base positions)
    for (const base of this.ctx.bases) {
      const baseKey = `${base.position.q},${base.position.r}`;
      if (baseKey === key) return false;
    }

    // Convert water to plains if built on water
    if (tile.terrain === TerrainType.WATER) {
      tile.terrain = TerrainType.PLAINS;
      this.ctx.terrainDecorator.removeWater(key);
      if (this.rebuildTileShellCallback) {
        this.rebuildTileShellCallback(wallPos);
      }
    }

    // Deduct stone
    this.ctx.stoneStockpile[unit.owner] -= 1;

    // Register wall
    this.wallsBuilt.add(key);
    this.wallOwners.set(key, unit.owner);
    this.wallHealth.set(key, WallSystem.WALL_MAX_HP);

    // Block pathfinding
    Pathfinder.blockedTiles.add(key);

    // Add to wall connectable
    this.wallConnectable.add(key);

    // Sync with UnitAI
    UnitAI.wallsBuilt.add(key);
    UnitAI.wallOwners.set(key, unit.owner);

    // Build mesh
    this.buildAdaptiveWallMesh(wallPos, unit.owner);

    // Rebuild adjacent walls and gates
    const neighbors = Pathfinder.getHexNeighbors(wallPos);
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      if (this.wallsBuilt.has(nKey)) {
        const owner = this.wallOwners.get(nKey);
        if (owner !== undefined) {
          this.buildAdaptiveWallMesh(n, owner);
        }
      }
      if (this.gatesBuilt.has(nKey)) {
        const owner = this.gateOwners.get(nKey);
        if (owner !== undefined) {
          this.buildGateMesh(n, owner);
        }
      }
    }

    // Update stockpile display
    if (this.updateStockpileCallback) {
      this.updateStockpileCallback(unit.owner);
    }

    return true;
  }

  /**
   * Build a gate at the given position
   * Costs 2 stone. Gates allow friendly unit passthrough.
   */
  handleBuildGate(unit: Unit, gatePos: HexCoord): boolean {
    const key = `${gatePos.q},${gatePos.r}`;

    // Check if already built
    if (this.wallsBuilt.has(key) || this.gatesBuilt.has(key)) {
      return false;
    }

    // Check resources
    if (this.ctx.stoneStockpile[unit.owner] < 2) {
      return false;
    }

    // Get tile
    if (!this.ctx.currentMap) return false;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return false;

    // Validate terrain: no forest or mountain
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) {
      return false;
    }

    // Check not occupied by other units
    if (tile.unit) {
      return false;
    }

    // Check not on stockpile locations (base positions)
    for (const base of this.ctx.bases) {
      const baseKey = `${base.position.q},${base.position.r}`;
      if (baseKey === key) return false;
    }

    // Convert water to plains if built on water
    if (tile.terrain === TerrainType.WATER) {
      tile.terrain = TerrainType.PLAINS;
      this.ctx.terrainDecorator.removeWater(key);
      if (this.rebuildTileShellCallback) {
        this.rebuildTileShellCallback(gatePos);
      }
    }

    // Deduct stone
    this.ctx.stoneStockpile[unit.owner] -= 2;

    // Register gate
    this.gatesBuilt.add(key);
    this.gateOwners.set(key, unit.owner);
    this.gateHealth.set(key, WallSystem.GATE_MAX_HP);

    // Block pathfinding (gates allow friendly passage via gateTiles)
    Pathfinder.blockedTiles.add(key);
    Pathfinder.gateTiles.set(key, unit.owner);

    // Add to wall connectable
    this.wallConnectable.add(key);

    // Sync with UnitAI
    UnitAI.wallsBuilt.add(key);
    UnitAI.wallOwners.set(key, unit.owner);

    // Build mesh
    this.buildGateMesh(gatePos, unit.owner);

    // Rebuild adjacent walls and gates
    const neighbors = Pathfinder.getHexNeighbors(gatePos);
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      if (this.wallsBuilt.has(nKey)) {
        const owner = this.wallOwners.get(nKey);
        if (owner !== undefined) {
          this.buildAdaptiveWallMesh(n, owner);
        }
      }
      if (this.gatesBuilt.has(nKey)) {
        const owner = this.gateOwners.get(nKey);
        if (owner !== undefined) {
          this.buildGateMesh(n, owner);
        }
      }
    }

    // Update stockpile display
    if (this.updateStockpileCallback) {
      this.updateStockpileCallback(unit.owner);
    }

    return true;
  }

  /**
   * Damage a wall. Returns true if destroyed.
   */
  damageWall(coord: HexCoord, damage: number): boolean {
    const key = `${coord.q},${coord.r}`;
    if (!this.wallsBuilt.has(key)) return false;

    let health = this.wallHealth.get(key) || WallSystem.WALL_MAX_HP;
    health -= damage;
    this.wallHealth.set(key, health);

    if (health <= 0) {
      // Destroyed
      this.wallsBuilt.delete(key);
      this.wallOwners.delete(key);
      this.wallHealth.delete(key);
      this.wallConnectable.delete(key);
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

      // Unblock pathfinding
      Pathfinder.blockedTiles.delete(key);

      // Rebuild adjacent walls
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          const owner = this.wallOwners.get(nKey);
          if (owner !== undefined) {
            this.buildAdaptiveWallMesh(n, owner);
          }
        }
      }

      return true;
    }

    return false;
  }

  /**
   * Damage a gate. Returns true if destroyed.
   */
  damageGate(coord: HexCoord, damage: number): boolean {
    const key = `${coord.q},${coord.r}`;
    if (!this.gatesBuilt.has(key)) return false;

    let health = this.gateHealth.get(key) || WallSystem.GATE_MAX_HP;
    health -= damage;
    this.gateHealth.set(key, health);

    if (health <= 0) {
      // Destroyed
      this.gatesBuilt.delete(key);
      this.gateOwners.delete(key);
      this.gateHealth.delete(key);
      this.wallConnectable.delete(key);
      UnitAI.wallsBuilt.delete(key);
      UnitAI.wallOwners.delete(key);
      Pathfinder.gateTiles.delete(key);

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

      // Unblock pathfinding
      Pathfinder.blockedTiles.delete(key);

      // Rebuild adjacent walls and gates
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          const owner = this.wallOwners.get(nKey);
          if (owner !== undefined) {
            this.buildAdaptiveWallMesh(n, owner);
          }
        }
        if (this.gatesBuilt.has(nKey)) {
          const owner = this.gateOwners.get(nKey);
          if (owner !== undefined) {
            this.buildGateMesh(n, owner);
          }
        }
      }

      return true;
    }

    return false;
  }

  /**
   * Damage a barracks building. Returns true if destroyed.
   */
  damageBarracks(
    coord: HexCoord,
    damage: number,
    getBuildingAt: (pos: HexCoord) => PlacedBuilding | null,
    unregisterBuilding: (pb: PlacedBuilding) => void
  ): boolean {
    const building = getBuildingAt(coord);
    if (!building || building.kind !== 'barracks') return false;

    building.health -= damage;

    // Darken mesh if below 50% HP
    if (building.health < building.maxHealth * 0.5) {
      building.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
          const mat = child.material as THREE.MeshLambertMaterial;
          const darkened = new THREE.Color(mat.color).multiplyScalar(0.6);
          mat.color.copy(darkened);
        }
      });
    }

    if (building.health <= 0) {
      unregisterBuilding(building);
      return true;
    }

    return false;
  }

  /**
   * Build adaptive wall mesh connecting to neighbors
   */
  buildAdaptiveWallMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

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

    const worldX = pos.q * 1.5;
    const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
    const baseY = tile.elevation * 0.5;

    const wallGroup = new THREE.Group();
    wallGroup.position.set(worldX, baseY, worldZ);
    wallGroup.name = `wall_${key}`;

    const wallColor = 0xf0ece0;
    const darkColor = 0xe8e0d0;
    const accentColor = owner === 0 ? 0x3498db : 0xe74c3c;

    const neighbors = Pathfinder.getHexNeighbors(pos);
    const connectedNeighbors: { n: HexCoord; dx: number; dz: number; dy: number; dist: number }[] = [];

    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      if (!this.wallConnectable.has(nKey)) continue;
      const nTile = this.ctx.currentMap.tiles.get(nKey);
      if (!nTile) continue;
      const nWorldX = n.q * 1.5;
      const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
      const nBaseY = nTile.elevation * 0.5;
      const dx = nWorldX - worldX;
      const dz = nWorldZ - worldZ;
      const dy = nBaseY - baseY;
      const dist = Math.sqrt(dx * dx + dz * dz);
      connectedNeighbors.push({ n, dx, dz, dy, dist });
    }

    const wallH = 1.6;
    const wallThickness = 0.45;

    const isJunction = connectedNeighbors.length >= 2;
    const pillarSize = isJunction ? 0.6 : 0.5;
    const pillarH = wallH + 0.4;
    const pillarGeo = new THREE.BoxGeometry(pillarSize, pillarH, pillarSize);
    const pillarMat = new THREE.MeshLambertMaterial({ color: darkColor });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = pillarH / 2;
    pillar.castShadow = true;
    wallGroup.add(pillar);

    const capSize = pillarSize + 0.12;
    const capGeo = new THREE.BoxGeometry(capSize, 0.22, capSize);
    const capMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = pillarH + 0.11;
    wallGroup.add(cap);

    if (isJunction) {
      const mGeo = new THREE.BoxGeometry(0.15, 0.2, 0.15);
      const mMat = new THREE.MeshLambertMaterial({ color: wallColor });
      for (const [ox, oz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const m = new THREE.Mesh(mGeo, mMat);
        m.position.set(ox * (capSize / 2 - 0.07), pillarH + 0.32, oz * (capSize / 2 - 0.07));
        wallGroup.add(m);
      }
    }

    const baseStripeGeo = new THREE.BoxGeometry(pillarSize + 0.04, 0.14, pillarSize + 0.04);
    const baseStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
    const baseStripe = new THREE.Mesh(baseStripeGeo, baseStripeMat);
    baseStripe.position.y = 0.07;
    wallGroup.add(baseStripe);

    for (const cn of connectedNeighbors) {
      const halfDist = cn.dist / 2;
      const angle = Math.atan2(cn.dx, cn.dz);
      const halfDy = cn.dy / 2;
      const segLen = halfDist + 0.15;

      const segGeo = new THREE.BoxGeometry(wallThickness, wallH, segLen);
      const segMat = new THREE.MeshLambertMaterial({ color: wallColor });
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set(cn.dx / 4, wallH / 2 + halfDy / 2, cn.dz / 4);
      seg.rotation.y = -angle;
      seg.castShadow = true;
      wallGroup.add(seg);

      const crenGeo = new THREE.BoxGeometry(wallThickness + 0.12, 0.22, segLen);
      const crenMat = new THREE.MeshLambertMaterial({ color: wallColor });
      const cren = new THREE.Mesh(crenGeo, crenMat);
      cren.position.set(cn.dx / 4, wallH + 0.11 + halfDy / 2, cn.dz / 4);
      cren.rotation.y = -angle;
      wallGroup.add(cren);

      const walkGeo = new THREE.BoxGeometry(wallThickness - 0.05, 0.06, segLen);
      const walkMat = new THREE.MeshLambertMaterial({ color: darkColor });
      const walk = new THREE.Mesh(walkGeo, walkMat);
      walk.position.set(cn.dx / 4, wallH + 0.25 + halfDy / 2, cn.dz / 4);
      walk.rotation.y = -angle;
      wallGroup.add(walk);

      const sStripeGeo = new THREE.BoxGeometry(wallThickness + 0.06, 0.12, segLen);
      const sStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
      const sStripe = new THREE.Mesh(sStripeGeo, sStripeMat);
      sStripe.position.set(cn.dx / 4, 0.06 + halfDy / 2, cn.dz / 4);
      sStripe.rotation.y = -angle;
      wallGroup.add(sStripe);

      if (Math.abs(cn.dy) > 0.1) {
        const rampGeo = new THREE.BoxGeometry(wallThickness, Math.abs(halfDy), wallThickness);
        const rampMat = new THREE.MeshLambertMaterial({ color: darkColor });
        const ramp = new THREE.Mesh(rampGeo, rampMat);
        ramp.position.set(cn.dx / 2 * 0.48, halfDy > 0 ? halfDy / 2 : wallH + halfDy / 2, cn.dz / 2 * 0.48);
        wallGroup.add(ramp);
      }
    }

    this.ctx.scene.add(wallGroup);
    this.wallMeshes.push(wallGroup);
    this.wallMeshMap.set(key, wallGroup);
  }

  /**
   * Build gate mesh with optional wide gate mode for adjacent gates
   */
  buildGateMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;
    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

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

    const worldX = pos.q * 1.5;
    const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
    const baseY = tile.elevation * 0.5;

    const gateGroup = new THREE.Group();
    gateGroup.position.set(worldX, baseY, worldZ);
    gateGroup.name = `gate_${key}`;

    const wallColor = 0xf0ece0;
    const darkColor = 0xe8e0d0;
    const accentColor = owner === 0 ? 0x3498db : 0xe74c3c;

    const neighbors = Pathfinder.getHexNeighbors(pos);
    const connectedDirs: { dx: number; dz: number }[] = [];
    const adjacentGateDirs: { dx: number; dz: number }[] = [];
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      const nWorldX = n.q * 1.5;
      const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
      const dx = nWorldX - worldX;
      const dz = nWorldZ - worldZ;
      if (this.gatesBuilt.has(nKey)) {
        adjacentGateDirs.push({ dx, dz });
      }
      if (this.wallConnectable.has(nKey) && !this.gatesBuilt.has(nKey)) {
        connectedDirs.push({ dx, dz });
      }
    }

    let wallAngle = 0;
    const allDirs = [...connectedDirs, ...adjacentGateDirs];
    if (allDirs.length > 0) {
      const avgDx = allDirs.reduce((s, c) => s + c.dx, 0) / allDirs.length;
      const avgDz = allDirs.reduce((s, c) => s + c.dz, 0) / allDirs.length;
      wallAngle = Math.atan2(avgDx, avgDz);
    }

    const hasAdjacentGate = adjacentGateDirs.length > 0;
    const bodyW = 0.95;
    const bodyH = 2.5;
    const bodyD = 0.95;

    if (hasAdjacentGate) {
      for (const gd of adjacentGateDirs) {
        const gateAngle = Math.atan2(gd.dx, gd.dz);
        const archW = 0.7;
        const archH = 1.4;
        const archGeo = new THREE.BoxGeometry(archW, archH, bodyD + 0.15);
        const archMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const arch = new THREE.Mesh(archGeo, archMat);
        arch.position.set(gd.dx * 0.15, archH / 2, gd.dz * 0.15);
        arch.rotation.y = -gateAngle;
        gateGroup.add(arch);
      }
      const thinGeo = new THREE.BoxGeometry(bodyW * 0.85, bodyH, bodyD * 0.85);
      const thinMat = new THREE.MeshLambertMaterial({ color: darkColor });
      const thinBody = new THREE.Mesh(thinGeo, thinMat);
      thinBody.position.y = bodyH / 2;
      thinBody.castShadow = true;
      gateGroup.add(thinBody);
    } else {
      const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
      const bodyMat = new THREE.MeshLambertMaterial({ color: darkColor });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = bodyH / 2;
      body.castShadow = true;
      gateGroup.add(body);
      const passageW = 0.6;
      const passageH = 1.3;
      const passageGeo = new THREE.BoxGeometry(passageW, passageH, bodyD + 0.12);
      const passageMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const passage = new THREE.Mesh(passageGeo, passageMat);
      passage.position.y = passageH / 2;
      passage.rotation.y = wallAngle;
      gateGroup.add(passage);
    }

    const crenW = bodyW + 0.18;
    const crenD = bodyD + 0.18;
    const crenMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const crenGeo = new THREE.BoxGeometry(crenW, 0.22, crenD);
    const cren = new THREE.Mesh(crenGeo, crenMat);
    cren.position.y = bodyH + 0.11;
    gateGroup.add(cren);

    const merlonGeo = new THREE.BoxGeometry(0.18, 0.28, 0.18);
    const merlonMat = new THREE.MeshLambertMaterial({ color: wallColor });
    for (const [ox, oz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const merlon = new THREE.Mesh(merlonGeo, merlonMat);
      merlon.position.set(ox * (crenW / 2 - 0.09), bodyH + 0.36, oz * (crenD / 2 - 0.09));
      gateGroup.add(merlon);
    }

    const bandGeo = new THREE.BoxGeometry(bodyW + 0.06, 0.15, bodyD + 0.06);
    const bandMat = new THREE.MeshLambertMaterial({ color: accentColor });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.08;
    gateGroup.add(band);

    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = bodyH + 0.65;
    gateGroup.add(pole);

    const flagGeo = new THREE.PlaneGeometry(0.4, 0.25);
    const flagMat = new THREE.MeshLambertMaterial({ color: accentColor, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.22, bodyH + 0.9, 0);
    gateGroup.add(flag);

    const gWallH = 1.6;
    const gWallThickness = 0.45;
    for (const cn of connectedDirs) {
      const dist = Math.sqrt(cn.dx * cn.dx + cn.dz * cn.dz);
      const halfDist = dist / 2;
      const segLen = halfDist + 0.15;
      const angle = Math.atan2(cn.dx, cn.dz);

      const nQ = Math.round(pos.q + cn.dx / 1.5);
      const nR = Math.round(pos.r + (cn.dz - (pos.q % 2 === 1 ? 0.75 : 0)) / 1.5);
      const nTile = this.ctx.currentMap.tiles.get(`${nQ},${nR}`);
      const nBaseY = nTile ? nTile.elevation * 0.5 : baseY;
      const halfDy = (nBaseY - baseY) / 2;

      const segGeo = new THREE.BoxGeometry(gWallThickness, gWallH, segLen);
      const segMat = new THREE.MeshLambertMaterial({ color: wallColor });
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set(cn.dx / 4, gWallH / 2 + halfDy / 2, cn.dz / 4);
      seg.rotation.y = -angle;
      seg.castShadow = true;
      gateGroup.add(seg);

      const sCrenGeo = new THREE.BoxGeometry(gWallThickness + 0.12, 0.22, segLen);
      const sCren = new THREE.Mesh(sCrenGeo, crenMat);
      sCren.position.set(cn.dx / 4, gWallH + 0.11 + halfDy / 2, cn.dz / 4);
      sCren.rotation.y = -angle;
      gateGroup.add(sCren);

      const sStripeGeo = new THREE.BoxGeometry(gWallThickness + 0.06, 0.12, segLen);
      const sStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
      const sStripe = new THREE.Mesh(sStripeGeo, sStripeMat);
      sStripe.position.set(cn.dx / 4, 0.06 + halfDy / 2, cn.dz / 4);
      sStripe.rotation.y = -angle;
      gateGroup.add(sStripe);
    }

    this.ctx.scene.add(gateGroup);
    this.gateMeshes.push(gateGroup);
    this.gateMeshMap.set(key, gateGroup);
  }

  /**
   * Clean up all wall and gate meshes
   */
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
    this.barracksHealth.clear();
  }
}
