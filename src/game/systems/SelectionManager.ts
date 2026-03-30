// ============================================
// CUBITOPIA - RTS Selection Manager
// Click to select, drag to box-select units
// ============================================

import * as THREE from 'three';
import { Unit } from '../../types';

export class SelectionManager {
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene | null = null;
  private selectedUnits: Unit[] = [];
  private allUnits: Unit[] = [];
  private playerId: number = 0;

  /** When true, suppress box-selection (harvest/farm paint mode active) */
  static suppressBoxSelect = false;
  /** When true, suppress right-click commands (mine mode — right-click rotates camera) */
  static suppressRightClick = false;

  // Box selection state
  private isBoxSelecting = false;
  private boxStart = { x: 0, y: 0 };
  private boxEnd = { x: 0, y: 0 };
  private boxElement: HTMLDivElement;

  // Callbacks
  private onSelectionChange: ((units: Unit[]) => void) | null = null;
  private onRightClick: ((worldPos: THREE.Vector3, screenX: number, screenY: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.canvas = canvas;
    this.camera = camera;

    // Create box selection overlay element
    this.boxElement = document.createElement('div');
    this.boxElement.style.cssText = `
      position: fixed; border: 1px solid #00ff00; background: rgba(0, 255, 0, 0.1);
      pointer-events: none; display: none; z-index: 1000;
    `;
    document.body.appendChild(this.boxElement);

    this.setupListeners();
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setPlayerUnits(units: Unit[], playerId: number): void {
    this.allUnits = units;
    this.playerId = playerId;
  }

  onSelect(callback: (units: Unit[]) => void): void {
    this.onSelectionChange = callback;
  }

  onCommand(callback: (worldPos: THREE.Vector3, screenX: number, screenY: number) => void): void {
    this.onRightClick = callback;
  }

  getSelectedUnits(): Unit[] {
    return this.selectedUnits;
  }

  clearSelection(): void {
    this.selectedUnits = [];
    this.onSelectionChange?.(this.selectedUnits);
  }

  private setupListeners(): void {
    let mouseDownTime = 0;
    let mouseDownPos = { x: 0, y: 0 };
    let mouseIsDown = false;
    let boxTimeout: ReturnType<typeof setTimeout> | null = null;

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0 && !SelectionManager.suppressBoxSelect) { // Left click
        mouseDownTime = Date.now();
        mouseIsDown = true;
        mouseDownPos = { x: e.clientX, y: e.clientY };
        this.boxStart = { x: e.clientX, y: e.clientY };
        this.boxEnd = { x: e.clientX, y: e.clientY };
      }
    });

    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (!mouseIsDown) return;

      if (this.isBoxSelecting) {
        this.boxEnd = { x: e.clientX, y: e.clientY };
        this.updateBoxElement();
      } else {
        // Check if mouse moved enough to start box select
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) {
          this.isBoxSelecting = true;
          this.boxElement.style.display = 'block';
          this.boxEnd = { x: e.clientX, y: e.clientY };
          this.updateBoxElement();
        }
      }
    });

    this.canvas.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) { // Left click release
        mouseIsDown = false;
        if (boxTimeout) { clearTimeout(boxTimeout); boxTimeout = null; }

        if (this.isBoxSelecting) {
          this.finishBoxSelect();
        } else {
          // Single click selection
          this.handleClick(e);
        }
        this.isBoxSelecting = false;
        this.boxElement.style.display = 'none';
      }
    });

    // Double-click: select all units of the same type as the clicked unit
    this.canvas.addEventListener('dblclick', (e: MouseEvent) => {
      if (e.button !== 0 || SelectionManager.suppressBoxSelect) return;
      const clickedUnit = this.unitUnderCursor(e);
      if (clickedUnit) {
        const unitType = clickedUnit.type;
        this.selectedUnits = this.allUnits.filter(
          u => u.owner === this.playerId && u.type === unitType
        );
        this.onSelectionChange?.(this.selectedUnits);
      }
    });

    // Right-click for commands (suppressed during mine mode so camera rotation works)
    this.canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (SelectionManager.suppressRightClick) return;
      if (this.selectedUnits.length > 0) {
        const worldPos = this.screenToWorld(e.clientX, e.clientY);
        if (worldPos) {
          this.onRightClick?.(worldPos, e.clientX, e.clientY);
        }
      }
    });
  }

  /** Find the player unit closest to the mouse cursor */
  private unitUnderCursor(e: MouseEvent): Unit | null {
    const raycaster = new THREE.Raycaster();
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, this.camera);

    let closestUnit: Unit | null = null;
    let closestDist = 2.5;

    for (const unit of this.allUnits) {
      if (unit.owner !== this.playerId) continue;
      const unitWorldPos = new THREE.Vector3(
        unit.worldPosition.x,
        unit.worldPosition.y,
        unit.worldPosition.z
      );
      const dist = raycaster.ray.distanceToPoint(unitWorldPos);
      if (dist < closestDist) {
        closestDist = dist;
        closestUnit = unit;
      }
    }
    return closestUnit;
  }

  private handleClick(e: MouseEvent): void {
    const closestUnit = this.unitUnderCursor(e);

    if (closestUnit) {
      if (e.shiftKey) {
        // Shift-click: toggle unit in selection
        const idx = this.selectedUnits.indexOf(closestUnit);
        if (idx >= 0) {
          this.selectedUnits.splice(idx, 1);
        } else {
          this.selectedUnits.push(closestUnit);
        }
      } else {
        this.selectedUnits = [closestUnit];
      }
    } else if (!e.shiftKey) {
      this.selectedUnits = [];
    }

    this.onSelectionChange?.(this.selectedUnits);
  }

  private finishBoxSelect(): void {
    const minX = Math.min(this.boxStart.x, this.boxEnd.x);
    const maxX = Math.max(this.boxStart.x, this.boxEnd.x);
    const minY = Math.min(this.boxStart.y, this.boxEnd.y);
    const maxY = Math.max(this.boxStart.y, this.boxEnd.y);

    // Only box select if the box is reasonably sized
    if (maxX - minX < 5 && maxY - minY < 5) return;

    const rect = this.canvas.getBoundingClientRect();
    const selected: Unit[] = [];

    for (const unit of this.allUnits) {
      if (unit.owner !== this.playerId) continue;
      const screenPos = this.worldToScreen(
        new THREE.Vector3(unit.worldPosition.x, unit.worldPosition.y, unit.worldPosition.z)
      );
      if (
        screenPos.x >= minX - rect.left &&
        screenPos.x <= maxX - rect.left &&
        screenPos.y >= minY - rect.top &&
        screenPos.y <= maxY - rect.top
      ) {
        selected.push(unit);
      }
    }

    this.selectedUnits = selected;
    this.onSelectionChange?.(this.selectedUnits);
  }

  private updateBoxElement(): void {
    const minX = Math.min(this.boxStart.x, this.boxEnd.x);
    const minY = Math.min(this.boxStart.y, this.boxEnd.y);
    const width = Math.abs(this.boxEnd.x - this.boxStart.x);
    const height = Math.abs(this.boxEnd.y - this.boxStart.y);
    this.boxElement.style.left = `${minX}px`;
    this.boxElement.style.top = `${minY}px`;
    this.boxElement.style.width = `${width}px`;
    this.boxElement.style.height = `${height}px`;
  }

  private worldToScreen(pos: THREE.Vector3): { x: number; y: number } {
    const projected = pos.clone().project(this.camera);
    return {
      x: (projected.x + 1) / 2 * this.canvas.clientWidth,
      y: (-projected.y + 1) / 2 * this.canvas.clientHeight,
    };
  }

  private screenToWorld(screenX: number, screenY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Try scene intersection first (handles elevated terrain)
    if (this.scene) {
      const intersects = raycaster.intersectObjects(this.scene.children, true);
      for (const hit of intersects) {
        if (!(hit.object instanceof THREE.Mesh)) continue;
        const name = hit.object.name || hit.object.parent?.name || '';
        if (name.startsWith('harvest_') || name.startsWith('ghost_')) continue;

        // Check hit face normal to distinguish top vs side faces
        if (hit.face && hit.face.normal) {
          let worldNormal = hit.face.normal.clone();

          // If the mesh has a world matrix, transform the normal
          // For instanced meshes or meshes with no rotation, local normal ≈ world normal
          const mesh = hit.object as THREE.Mesh;
          if (mesh.matrixWorld) {
            // Use the normal matrix for proper normal transformation
            const normalMatrix = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld);
            worldNormal.applyMatrix3(normalMatrix).normalize();
          }

          // If it's a top face (normal.y > 0.5), use hit point as-is
          if (worldNormal.y > 0.5) {
            return hit.point;
          } else {
            // Side face: nudge outward along the normal by ~0.5 units
            // This resolves to the adjacent lower tile instead of the tall column
            const adjusted = hit.point.clone().add(worldNormal.clone().multiplyScalar(0.8));
            return adjusted;
          }
        }

        // Fallback if no face normal available
        return hit.point;
      }
    }

    // Fallback: multiple elevation planes
    const elevations = [0, 0.5, 1.0, 1.5, 2.0];
    for (const elev of elevations) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev);
      const intersection = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(plane, intersection);
      if (result) return intersection;
    }
    return null;
  }

  dispose(): void {
    this.boxElement.remove();
  }
}
