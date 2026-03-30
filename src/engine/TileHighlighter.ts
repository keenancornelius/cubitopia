// ============================================
// CUBITOPIA - Tile Highlighter
// Shows selection highlights and movement range
// ============================================

import * as THREE from 'three';
import { HexCoord } from '../types';

export class TileHighlighter {
  private scene: THREE.Scene;
  private selectionMesh: THREE.Mesh | null = null;
  private movementMeshes: THREE.Mesh[] = [];
  private attackMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Convert hex coordinate to world position
   */
  private hexToWorld(coord: HexCoord, y: number): THREE.Vector3 {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    return new THREE.Vector3(x, y, z);
  }

  /**
   * Show selection highlight on a tile
   */
  showSelection(coord: HexCoord, elevation: number): void {
    this.clearSelection();

    const geo = new THREE.PlaneGeometry(1.2, 1.2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.selectionMesh = new THREE.Mesh(geo, mat);
    this.selectionMesh.rotation.x = -Math.PI / 2;
    const pos = this.hexToWorld(coord, elevation + 0.05);
    this.selectionMesh.position.copy(pos);
    this.scene.add(this.selectionMesh);
  }

  /**
   * Show movement range tiles (blue overlay)
   */
  showMovementRange(coords: HexCoord[], getElevation: (coord: HexCoord) => number): void {
    this.clearMovementRange();

    const geo = new THREE.PlaneGeometry(1.0, 1.0);

    for (const coord of coords) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x3498db,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.rotation.x = -Math.PI / 2;
      const elevation = getElevation(coord);
      const pos = this.hexToWorld(coord, elevation + 0.06);
      mesh.position.copy(pos);

      // Store the hex coordinate in userData for raycasting
      mesh.userData = { hexCoord: coord, type: 'movement' };

      this.movementMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  /**
   * Show attack range tiles (red overlay)
   */
  showAttackRange(coords: HexCoord[], getElevation: (coord: HexCoord) => number): void {
    this.clearAttackRange();

    const geo = new THREE.PlaneGeometry(1.0, 1.0);

    for (const coord of coords) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe74c3c,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.rotation.x = -Math.PI / 2;
      const elevation = getElevation(coord);
      const pos = this.hexToWorld(coord, elevation + 0.06);
      mesh.position.copy(pos);

      mesh.userData = { hexCoord: coord, type: 'attack' };

      this.attackMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Flash a red attack indicator on a single tile (auto-clears after 600ms) */
  showAttackIndicator(coord: HexCoord, elevation: number): void {
    const geo = new THREE.PlaneGeometry(1.4, 1.4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const pos = this.hexToWorld(coord, elevation + 0.08);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    // Fade out and remove
    let opacity = 0.55;
    const fade = () => {
      opacity -= 0.02;
      if (opacity <= 0) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
        return;
      }
      mat.opacity = opacity;
      requestAnimationFrame(fade);
    };
    setTimeout(fade, 300);
  }

  clearSelection(): void {
    if (this.selectionMesh) {
      this.scene.remove(this.selectionMesh);
      this.selectionMesh.geometry.dispose();
      (this.selectionMesh.material as THREE.Material).dispose();
      this.selectionMesh = null;
    }
  }

  clearMovementRange(): void {
    for (const mesh of this.movementMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.movementMeshes = [];
  }

  clearAttackRange(): void {
    for (const mesh of this.attackMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.attackMeshes = [];
  }

  clearAll(): void {
    this.clearSelection();
    this.clearMovementRange();
    this.clearAttackRange();
  }

  /**
   * Get all movement/attack overlay meshes for raycasting
   */
  getInteractableMeshes(): THREE.Mesh[] {
    return [...this.movementMeshes, ...this.attackMeshes];
  }

  dispose(): void {
    this.clearAll();
  }
}
