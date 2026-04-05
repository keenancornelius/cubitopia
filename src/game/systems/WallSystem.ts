// ============================================
// CUBITOPIA - Wall & Gate Building System
// Handles wall/gate construction, damage, and mesh management
// Includes damage visual feedback, health bars, and destruction VFX
// ============================================

import * as THREE from 'three';
import { HexCoord, GameContext, TerrainType, Unit, PlacedBuilding } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';
import { GAME_CONFIG } from '../GameConfig';
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
  /** Play a sound effect */
  playSound(name: string, volume?: number): void;
}

// --- Damage visual constants ---
const DAMAGE_DARKEN_FACTOR = 0.65;       // How dark walls get at 0 HP (darkest)
const CRACK_THRESHOLD = 0.6;             // Show cracks below 60% HP
const HEAVY_CRACK_THRESHOLD = 0.3;       // Heavy cracks below 30% HP
const HEALTH_BAR_WIDTH = 0.8;
const HEALTH_BAR_HEIGHT = 0.08;
const HEALTH_BAR_Y_OFFSET = 2.4;        // Height above wall base
const DEBRIS_PARTICLE_COUNT = 12;
const DEBRIS_SPREAD = 1.2;
const DEBRIS_LIFETIME = 1.5;             // Seconds

/** Debris particle for destruction VFX */
interface DebrisParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
  age: number;
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

  // Health bar billboards (wall key → health bar group)
  private healthBars: Map<string, THREE.Group> = new Map();
  private healthBarFills: Map<string, THREE.Mesh> = new Map();

  // Destruction debris particles
  private debrisParticles: DebrisParticle[] = [];
  private static debrisGeo: THREE.BoxGeometry | null = null;

  // Constants
  static readonly WALL_MAX_HP = GAME_CONFIG.defenses.wall.maxHealth;
  static readonly GATE_MAX_HP = GAME_CONFIG.defenses.gate.maxHealth;
  static readonly BARRACKS_MAX_HP = GAME_CONFIG.defenses.barracks.maxHealth;

  constructor(ctx: GameContext, ops: WallSystemOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  // --- Wall/Gate Construction ---

  handleBuildWall(unit: Unit, wallPos: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${wallPos.q},${wallPos.r}`;
    if (this.wallsBuilt.has(key)) return;

    if (this.ctx.stoneStockpile[unit.owner] < GAME_CONFIG.defenses.wall.cost.stone) return;

    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (this.ops.isStockpileLocation(wallPos)) return;

    // Consume stone
    this.ctx.stoneStockpile[unit.owner] -= GAME_CONFIG.defenses.wall.cost.stone;
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
      if (this.gatesBuilt.has(nKey)) {
        this.buildGateMesh(n, this.gateOwners.get(nKey) ?? 0);
      }
    }

    this.ops.updateStockpileVisual(unit.owner);
    this.ops.playSound('wall_build', 0.5);
  }

  handleBuildGate(unit: Unit, gatePos: HexCoord): void {
    if (!this.ctx.currentMap) return;
    const key = `${gatePos.q},${gatePos.r}`;
    if (this.gatesBuilt.has(key)) return;

    if (this.ctx.stoneStockpile[unit.owner] < GAME_CONFIG.defenses.gate.cost.stone) return;

    const tile = this.ctx.currentMap.tiles.get(key);
    if (!tile) return;

    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.ops.isTileOccupied(key)) return;
    if (this.ops.isStockpileLocation(gatePos)) return;

    // Consume 2 stone
    this.ctx.stoneStockpile[unit.owner] -= GAME_CONFIG.defenses.gate.cost.stone;
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
    this.ops.playSound('wall_build', 0.5);
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
      // Spawn destruction debris before removing mesh
      const mesh = this.wallMeshMap.get(key);
      if (mesh) {
        this.spawnDestructionDebris(mesh.position, this.wallOwners.get(key) ?? 0);
      }

      this.wallsBuilt.delete(key);
      this.wallOwners.delete(key);
      this.wallHealth.delete(key);

      UnitAI.wallsBuilt.delete(key);
      UnitAI.wallOwners.delete(key);

      // Remove mesh
      this.removeWallMesh(key);

      // Remove health bar
      this.removeHealthBar(key);

      Pathfinder.blockedTiles.delete(key);
      this.ops.getWallConnectable().delete(key);

      // Rebuild adjacent wall & gate connections
      const neighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
        if (this.gatesBuilt.has(nKey)) {
          this.buildGateMesh(n, this.gateOwners.get(nKey) ?? 0);
        }
      }

      this.ops.playSound('wall_destroy', 0.5);
      return true;
    } else {
      this.wallHealth.set(key, newHealth);
      // Apply damage visuals
      this.applyDamageVisuals(key, newHealth, WallSystem.WALL_MAX_HP);
      // Show/update health bar
      this.updateHealthBar(key, newHealth, WallSystem.WALL_MAX_HP);
      return false;
    }
  }

  damageGate(coord: HexCoord, damage: number): boolean {
    if (!this.ctx.currentMap) return false;
    const key = `${coord.q},${coord.r}`;

    const currentHealth = this.gateHealth.get(key) ?? WallSystem.GATE_MAX_HP;
    const newHealth = Math.max(0, currentHealth - damage);

    if (newHealth <= 0) {
      // Spawn destruction debris
      const mesh = this.gateMeshMap.get(key);
      if (mesh) {
        this.spawnDestructionDebris(mesh.position, this.gateOwners.get(key) ?? 0);
      }

      this.gatesBuilt.delete(key);
      this.gateOwners.delete(key);
      this.gateHealth.delete(key);

      // Remove mesh
      this.removeGateMesh(key);

      // Remove health bar
      this.removeHealthBar(key);

      Pathfinder.blockedTiles.delete(key);
      Pathfinder.gateTiles.delete(key);
      this.ops.getWallConnectable().delete(key);

      // Rebuild adjacent wall & gate connections (gate roles may change)
      const gateNeighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of gateNeighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
        if (this.gatesBuilt.has(nKey)) {
          this.buildGateMesh(n, this.gateOwners.get(nKey) ?? 0);
        }
      }

      this.ops.playSound('wall_destroy', 0.5);
      return true;
    } else {
      this.gateHealth.set(key, newHealth);
      // Apply damage visuals
      this.applyDamageVisuals(key, newHealth, WallSystem.GATE_MAX_HP, true);
      // Show/update health bar
      this.updateHealthBar(key, newHealth, WallSystem.GATE_MAX_HP);
      return false;
    }
  }

  damageBarracks(coord: HexCoord, damage: number): boolean {
    const key = `${coord.q},${coord.r}`;
    const pb = this.ops.getBuildingAt(coord);
    if (!pb || pb.kind !== 'barracks') return false;

    pb.health = Math.max(0, pb.health - damage);

    if (pb.health <= 0) {
      // Barracks destroyed — spawn debris
      if (pb.mesh) {
        this.spawnDestructionDebris(pb.mesh.position, pb.owner);
      }

      this.ops.getWallConnectable().delete(key);
      Pathfinder.blockedTiles.delete(key);
      UnitAI.barracksPositions.delete(pb.owner);

      this.ops.unregisterBuilding(pb);

      // Remove health bar
      this.removeHealthBar(key);

      // Rebuild adjacent walls & gates
      const bNeighbors = Pathfinder.getHexNeighbors(coord);
      for (const n of bNeighbors) {
        const nKey = `${n.q},${n.r}`;
        if (this.wallsBuilt.has(nKey)) {
          this.buildAdaptiveWallMesh(n, this.wallOwners.get(nKey) ?? 0);
        }
        if (this.gatesBuilt.has(nKey)) {
          this.buildGateMesh(n, this.gateOwners.get(nKey) ?? 0);
        }
      }
      return true;
    } else {
      // Visual damage feedback — darken the mesh
      const pct = pb.health / pb.maxHealth;
      if (pct < 0.5) {
        pb.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
            child.material.color.multiplyScalar(0.98);
          }
        });
      }
      // Show health bar for barracks too
      this.updateHealthBar(key, pb.health, pb.maxHealth, pb.mesh?.position);
      return false;
    }
  }

  // --- Damage Visual Effects ---

  /**
   * Darken wall/gate meshes based on remaining health percentage.
   * Also adds crack-like dark patches at low HP.
   */
  private applyDamageVisuals(key: string, currentHP: number, maxHP: number, isGate = false): void {
    const meshMap = isGate ? this.gateMeshMap : this.wallMeshMap;
    const group = meshMap.get(key);
    if (!group) return;

    const pct = currentHP / maxHP;
    // Interpolate darken factor: full health = 1.0, zero health = DAMAGE_DARKEN_FACTOR
    const darkenMul = DAMAGE_DARKEN_FACTOR + (1 - DAMAGE_DARKEN_FACTOR) * pct;

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        // Store original color if not already stored
        if (!(child.userData as any).originalColor) {
          (child.userData as any).originalColor = child.material.color.getHex();
        }
        const orig = new THREE.Color((child.userData as any).originalColor);
        child.material.color.copy(orig.multiplyScalar(darkenMul));

        // Add emissive red tint at very low HP for "about to break" feel
        if (pct < HEAVY_CRACK_THRESHOLD) {
          child.material.emissive = new THREE.Color(0x330000);
          child.material.emissiveIntensity = (1 - pct / HEAVY_CRACK_THRESHOLD) * 0.3;
        } else if (pct < CRACK_THRESHOLD) {
          child.material.emissive = new THREE.Color(0x110000);
          child.material.emissiveIntensity = 0.1;
        } else {
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
        }
      }
    });

    // Add crack overlay meshes at low HP
    if (pct < CRACK_THRESHOLD) {
      this.ensureCrackOverlay(group, pct);
    }
  }

  /**
   * Add dark crack lines to damaged walls. Reuses existing crack mesh if present.
   */
  private ensureCrackOverlay(group: THREE.Group, pct: number): void {
    let crackMesh = group.getObjectByName('wall_cracks') as THREE.Mesh | undefined;

    const crackIntensity = pct < HEAVY_CRACK_THRESHOLD ? 0.6 : 0.3;

    if (!crackMesh) {
      // Create a simple crack overlay — dark lines on the wall surface
      const crackGeo = new THREE.BoxGeometry(0.03, 1.2, 0.5);
      const crackMat = new THREE.MeshLambertMaterial({
        color: 0x2a2018,
        transparent: true,
        opacity: crackIntensity,
      });
      crackMesh = new THREE.Mesh(crackGeo, crackMat);
      crackMesh.name = 'wall_cracks';
      crackMesh.position.set(0.22, 0.8, 0.1);
      crackMesh.rotation.z = 0.3;
      group.add(crackMesh);

      // Second crack line at a different angle
      const crack2Geo = new THREE.BoxGeometry(0.025, 0.9, 0.45);
      const crack2Mat = new THREE.MeshLambertMaterial({
        color: 0x2a2018,
        transparent: true,
        opacity: crackIntensity * 0.8,
      });
      const crack2 = new THREE.Mesh(crack2Geo, crack2Mat);
      crack2.name = 'wall_cracks_2';
      crack2.position.set(-0.15, 1.1, -0.08);
      crack2.rotation.z = -0.4;
      group.add(crack2);
    } else {
      // Update existing crack opacity
      if (crackMesh.material instanceof THREE.MeshLambertMaterial) {
        crackMesh.material.opacity = crackIntensity;
      }
      const crack2 = group.getObjectByName('wall_cracks_2') as THREE.Mesh | undefined;
      if (crack2 && crack2.material instanceof THREE.MeshLambertMaterial) {
        crack2.material.opacity = crackIntensity * 0.8;
      }
    }
  }

  // --- Health Bar Billboards ---

  /**
   * Create or update a floating health bar above a wall/gate/barracks.
   * Only shown when the structure has taken damage.
   */
  private updateHealthBar(key: string, currentHP: number, maxHP: number, worldPos?: THREE.Vector3): void {
    const pct = currentHP / maxHP;
    // Don't show health bar at full health
    if (pct >= 1.0) {
      this.removeHealthBar(key);
      return;
    }

    let barGroup = this.healthBars.get(key);
    let fillMesh = this.healthBarFills.get(key);

    if (!barGroup) {
      // Create health bar
      barGroup = new THREE.Group();
      barGroup.name = `wall_hpbar_${key}`;

      // Background (dark)
      const bgGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide, depthTest: false });
      const bg = new THREE.Mesh(bgGeo, bgMat);
      bg.renderOrder = 999;
      barGroup.add(bg);

      // Fill (colored by HP)
      const fillGeo = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH * pct, HEALTH_BAR_HEIGHT * 0.8);
      const fillColor = pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xff9800 : 0xe74c3c;
      const fillMat = new THREE.MeshBasicMaterial({ color: fillColor, side: THREE.DoubleSide, depthTest: false });
      fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.renderOrder = 1000;
      fillMesh.position.x = -HEALTH_BAR_WIDTH * (1 - pct) / 2; // Anchor left
      barGroup.add(fillMesh);

      // Position the bar
      const pos = worldPos ?? this.getStructurePosition(key);
      if (pos) {
        barGroup.position.set(pos.x, pos.y + HEALTH_BAR_Y_OFFSET, pos.z);
      }

      this.ctx.scene.add(barGroup);
      this.healthBars.set(key, barGroup);
      this.healthBarFills.set(key, fillMesh);
    } else if (fillMesh) {
      // Update existing health bar fill width and color
      fillMesh.geometry.dispose();
      fillMesh.geometry = new THREE.PlaneGeometry(HEALTH_BAR_WIDTH * pct, HEALTH_BAR_HEIGHT * 0.8);
      fillMesh.position.x = -HEALTH_BAR_WIDTH * (1 - pct) / 2;

      const fillColor = pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xff9800 : 0xe74c3c;
      if (fillMesh.material instanceof THREE.MeshBasicMaterial) {
        fillMesh.material.color.setHex(fillColor);
      }
    }
  }

  /** Remove a health bar billboard */
  private removeHealthBar(key: string): void {
    const barGroup = this.healthBars.get(key);
    if (barGroup) {
      this.ctx.scene.remove(barGroup);
      barGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.healthBars.delete(key);
      this.healthBarFills.delete(key);
    }
  }

  /** Get the world position of a wall/gate structure for health bar placement */
  private getStructurePosition(key: string): THREE.Vector3 | null {
    const wallMesh = this.wallMeshMap.get(key);
    if (wallMesh) return wallMesh.position;
    const gateMesh = this.gateMeshMap.get(key);
    if (gateMesh) return gateMesh.position;
    return null;
  }

  /** Update health bar billboards to face camera (call once per frame) */
  updateBillboards(camera: THREE.Camera): void {
    for (const [, barGroup] of this.healthBars) {
      barGroup.lookAt(camera.position);
    }

    // Update debris particles
    this.updateDebris();
  }

  // --- Destruction VFX ---

  /**
   * Spawn debris particles when a wall/gate is destroyed.
   * Creates small cubes that fly outward and fade.
   */
  private spawnDestructionDebris(position: THREE.Vector3, owner: number): void {
    if (!WallSystem.debrisGeo) {
      WallSystem.debrisGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    }

    const colors = [0xf0ece0, 0xe8e0d0, 0xd4ccc0, 0x9e9688, 0x7a7060]; // Stone colors

    for (let i = 0; i < DEBRIS_PARTICLE_COUNT; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(WallSystem.debrisGeo, mat);

      mesh.position.copy(position);
      mesh.position.y += 0.5 + Math.random() * 1.5;
      mesh.position.x += (Math.random() - 0.5) * 0.3;
      mesh.position.z += (Math.random() - 0.5) * 0.3;

      // Random initial rotation
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      this.ctx.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = DEBRIS_SPREAD * (0.5 + Math.random() * 0.5);
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        2 + Math.random() * 3,     // Upward burst
        Math.sin(angle) * speed,
      );

      this.debrisParticles.push({
        mesh,
        velocity,
        lifetime: DEBRIS_LIFETIME * (0.7 + Math.random() * 0.6),
        age: 0,
      });
    }
  }

  /** Update debris particles (gravity + fade). Call from updateBillboards each frame. */
  private updateDebris(): void {
    const dt = 1 / 60; // Approximate delta for debris
    const gravity = -9.8;

    for (let i = this.debrisParticles.length - 1; i >= 0; i--) {
      const p = this.debrisParticles[i];
      p.age += dt;

      if (p.age >= p.lifetime) {
        // Remove expired particle
        this.ctx.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.debrisParticles.splice(i, 1);
        continue;
      }

      // Apply gravity
      p.velocity.y += gravity * dt;

      // Move
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;

      // Spin
      p.mesh.rotation.x += dt * 3;
      p.mesh.rotation.z += dt * 2;

      // Floor collision
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.velocity.y *= -0.3; // Bounce
        p.velocity.x *= 0.8;  // Friction
        p.velocity.z *= 0.8;
      }

      // Fade out
      const fadeStart = p.lifetime * 0.6;
      if (p.age > fadeStart) {
        const alpha = 1 - (p.age - fadeStart) / (p.lifetime - fadeStart);
        if (p.mesh.material instanceof THREE.MeshLambertMaterial) {
          p.mesh.material.transparent = true;
          p.mesh.material.opacity = alpha;
        }
      }

      // Scale down over time
      const scale = 1 - (p.age / p.lifetime) * 0.5;
      p.mesh.scale.setScalar(scale);
    }
  }

  // --- Helper: remove wall/gate mesh cleanly ---

  private removeWallMesh(key: string): void {
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
  }

  private removeGateMesh(key: string): void {
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
  }

  // --- Mesh Building (delegates to DefenseMeshFactory) ---

  buildAdaptiveWallMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;

    // Remove old mesh if rebuilding
    this.removeWallMesh(key);

    const wallGroup = createWallMesh({
      pos, owner,
      tiles: this.ctx.currentMap.tiles,
      wallConnectable: this.ops.getWallConnectable(),
    });
    if (!wallGroup) return;

    this.ctx.scene.add(wallGroup);
    this.wallMeshes.push(wallGroup);
    this.wallMeshMap.set(key, wallGroup);

    // Re-apply damage visuals if this wall is damaged
    const hp = this.wallHealth.get(key);
    if (hp !== undefined && hp < WallSystem.WALL_MAX_HP) {
      this.applyDamageVisuals(key, hp, WallSystem.WALL_MAX_HP);
    }
  }

  buildGateMesh(pos: HexCoord, owner: number): void {
    if (!this.ctx.currentMap) return;
    const key = `${pos.q},${pos.r}`;

    // Remove old mesh if rebuilding
    this.removeGateMesh(key);

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

    // Re-apply damage visuals if this gate is damaged
    const hp = this.gateHealth.get(key);
    if (hp !== undefined && hp < WallSystem.GATE_MAX_HP) {
      this.applyDamageVisuals(key, hp, WallSystem.GATE_MAX_HP, true);
    }
  }

  // --- Wall Cost Preview (for drag placement UX) ---

  /** Calculate total stone cost for a set of wall blueprints */
  getWallCostForBlueprints(wallCount: number, gateCount: number): { stone: number } {
    return {
      stone: wallCount * GAME_CONFIG.defenses.wall.cost.stone + gateCount * GAME_CONFIG.defenses.gate.cost.stone,
    };
  }

  /** Check if player can afford a given wall count */
  canAffordWalls(owner: number, wallCount: number, gateCount: number): boolean {
    const cost = this.getWallCostForBlueprints(wallCount, gateCount);
    return this.ctx.stoneStockpile[owner] >= cost.stone;
  }

  /** Get wall health percentage for a given key */
  getWallHealthPct(key: string): number {
    if (this.wallsBuilt.has(key)) {
      const hp = this.wallHealth.get(key) ?? WallSystem.WALL_MAX_HP;
      return hp / WallSystem.WALL_MAX_HP;
    }
    if (this.gatesBuilt.has(key)) {
      const hp = this.gateHealth.get(key) ?? WallSystem.GATE_MAX_HP;
      return hp / WallSystem.GATE_MAX_HP;
    }
    return 1;
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
    // Cleanup health bars
    for (const [, bar] of this.healthBars) {
      this.ctx.scene.remove(bar);
      bar.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    // Cleanup debris
    for (const p of this.debrisParticles) {
      this.ctx.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
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
    this.healthBars.clear();
    this.healthBarFills.clear();
    this.debrisParticles = [];
  }
}
