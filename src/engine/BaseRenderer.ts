// ============================================
// CUBITOPIA - Base Renderer
// Renders home bases as voxel castle structures
// ============================================

import * as THREE from 'three';
import { Base, HexCoord } from '../types';

const PLAYER_BASE_COLORS = [
  { wall: 0xf0ece0, tower: 0xe8e0d0, flag: 0x3498db, accent: 0xd4cfc0, ring: 0x3498db }, // Off-white + Blue flag
  { wall: 0xf0ece0, tower: 0xe8e0d0, flag: 0xe74c3c, accent: 0xd4cfc0, ring: 0xe74c3c }, // Off-white + Red flag
  { wall: 0x8a8a8a, tower: 0x6a6a6a, flag: 0xd4af37, accent: 0x555555, ring: 0xd4af37 }, // Dark stone + Gold flag (neutral)
];

interface BaseMeshGroup {
  group: THREE.Group;
  baseId: string;
  healthBar: THREE.Mesh;
  healthBarBg: THREE.Mesh;
  flagMesh: THREE.Mesh;
}

export class BaseRenderer {
  private scene: THREE.Scene;
  private baseMeshes: Map<string, BaseMeshGroup> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  hexToWorld(coord: HexCoord, elevation: number): THREE.Vector3 {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    return new THREE.Vector3(x, elevation, z);
  }

  addBase(base: Base, elevation: number): void {
    this.removeBase(base.id);

    const group = new THREE.Group();
    const pos = this.hexToWorld(base.position, elevation);
    group.position.copy(pos);
    // Rotate bases 180° so flags/doors face the battlefield
    group.rotation.y = Math.PI;

    const colors = PLAYER_BASE_COLORS[base.owner % PLAYER_BASE_COLORS.length];

    // === Castle Platform (3x3 stone base) ===
    const platformGeo = new THREE.BoxGeometry(2.2, 0.4, 2.2);
    const platformMat = new THREE.MeshLambertMaterial({ color: 0x7f8c8d });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = 0.2;
    group.add(platform);

    // === Four corner towers ===
    const towerPositions = [
      [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]
    ];
    for (const [tx, tz] of towerPositions) {
      const towerGeo = new THREE.BoxGeometry(0.5, 1.8, 0.5);
      const towerMat = new THREE.MeshLambertMaterial({ color: colors.tower });
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.set(tx, 1.3, tz);
      group.add(tower);

      // Crenellation on top
      const crenGeo = new THREE.BoxGeometry(0.6, 0.25, 0.6);
      const crenMat = new THREE.MeshLambertMaterial({ color: colors.wall });
      const cren = new THREE.Mesh(crenGeo, crenMat);
      cren.position.set(tx, 2.35, tz);
      group.add(cren);
    }

    // === Walls connecting towers ===
    const wallDefs = [
      { pos: [0, 1.0, -0.8], size: [1.1, 1.2, 0.3] },
      { pos: [0, 1.0, 0.8], size: [1.1, 1.2, 0.3] },
      { pos: [-0.8, 1.0, 0], size: [0.3, 1.2, 1.1] },
      { pos: [0.8, 1.0, 0], size: [0.3, 1.2, 1.1] },
    ];
    for (const w of wallDefs) {
      const wallGeo = new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]);
      const wallMat = new THREE.MeshLambertMaterial({ color: colors.wall });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(w.pos[0], w.pos[1], w.pos[2]);
      group.add(wall);
    }

    // === Central keep (main tower) ===
    const keepGeo = new THREE.BoxGeometry(0.7, 2.4, 0.7);
    const keepMat = new THREE.MeshLambertMaterial({ color: colors.tower });
    const keep = new THREE.Mesh(keepGeo, keepMat);
    keep.position.set(0, 1.6, 0);
    group.add(keep);

    // Keep roof
    const roofGeo = new THREE.ConeGeometry(0.55, 0.6, 4);
    const roofMat = new THREE.MeshLambertMaterial({ color: colors.accent });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 3.1, 0);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    // === Flag on top of keep ===
    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, 3.9, 0);
    group.add(pole);

    // Flag banner (prominent team color!)
    const flagGeo = new THREE.PlaneGeometry(0.8, 0.5);
    const flagMat = new THREE.MeshLambertMaterial({
      color: colors.flag, side: THREE.DoubleSide
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.42, 4.15, 0);
    group.add(flag);

    // Second flag on opposite tower for visibility
    const pole2Geo = new THREE.CylinderGeometry(0.03, 0.03, 0.7);
    const pole2 = new THREE.Mesh(pole2Geo, poleMat.clone());
    pole2.position.set(0.8, 2.85, 0.8);
    group.add(pole2);
    const flag2 = new THREE.Mesh(flagGeo.clone(), flagMat.clone());
    flag2.position.set(1.1, 3.0, 0.8);
    group.add(flag2);

    // === Health bar (floating above base) ===
    const barWidth = 2.0;
    const barHeight = 0.15;

    const hpBgGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const hpBgMat = new THREE.MeshBasicMaterial({
      color: 0x333333, side: THREE.DoubleSide, depthTest: false
    });
    const hpBg = new THREE.Mesh(hpBgGeo, hpBgMat);
    hpBg.position.set(0, 4.8, 0);
    hpBg.renderOrder = 999;
    group.add(hpBg);

    const hpGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const hpColor = base.owner === 0 ? 0x3498db : 0xe74c3c;
    const hpMat = new THREE.MeshBasicMaterial({
      color: hpColor, side: THREE.DoubleSide, depthTest: false
    });
    const hpBar = new THREE.Mesh(hpGeo, hpMat);
    hpBar.position.set(0, 4.8, 0);
    hpBar.renderOrder = 1000;
    group.add(hpBar);

    // === Glow ring around base ===
    const ringGeo = new THREE.RingGeometry(1.3, 1.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colors.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.4,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    this.scene.add(group);
    this.baseMeshes.set(base.id, {
      group,
      baseId: base.id,
      healthBar: hpBar,
      healthBarBg: hpBg,
      flagMesh: flag,
    });
  }

  updateHealthBar(base: Base): void {
    const meshGroup = this.baseMeshes.get(base.id);
    if (!meshGroup) return;

    const pct = Math.max(0, base.health / base.maxHealth);
    meshGroup.healthBar.scale.x = pct;
    meshGroup.healthBar.position.x = -(1 - pct) * 1.0; // shift left as health decreases

    // Color changes with damage
    const hpMat = meshGroup.healthBar.material as THREE.MeshBasicMaterial;
    if (pct > 0.5) {
      hpMat.color.setHex(base.owner === 0 ? 0x3498db : 0xe74c3c);
    } else if (pct > 0.25) {
      hpMat.color.setHex(0xf39c12);
    } else {
      hpMat.color.setHex(0xff0000);
    }
  }

  updateBillboards(camera: THREE.Camera): void {
    for (const [, meshGroup] of this.baseMeshes) {
      meshGroup.healthBar.lookAt(camera.position);
      meshGroup.healthBarBg.lookAt(camera.position);
    }
  }

  showDestruction(base: Base): void {
    const meshGroup = this.baseMeshes.get(base.id);
    if (!meshGroup) return;

    // Make the base look destroyed — darken and tilt pieces
    meshGroup.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        child.material.color.multiplyScalar(0.3);
      }
    });

    // Tilt the group slightly
    meshGroup.group.rotation.z = 0.15;
    meshGroup.group.rotation.x = -0.1;
  }

  removeBase(baseId: string): void {
    const meshGroup = this.baseMeshes.get(baseId);
    if (meshGroup) {
      this.scene.remove(meshGroup.group);
      meshGroup.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.baseMeshes.delete(baseId);
    }
  }

  /** Get all base mesh groups for raycasting — returns [baseId, THREE.Group][] */
  getAllBaseMeshGroups(): { baseId: string; group: THREE.Group }[] {
    const result: { baseId: string; group: THREE.Group }[] = [];
    for (const [id, mg] of this.baseMeshes) {
      result.push({ baseId: id, group: mg.group });
    }
    return result;
  }

  dispose(): void {
    for (const [id] of this.baseMeshes) {
      this.removeBase(id);
    }
  }
}
