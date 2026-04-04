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
  /** When true, skip clearing selection on the next single-click (building/wall click) */
  static suppressNextClear = false;
  /** Suppress one left-click selection (used by attack-move) */
  static suppressNextClick = false;
  /** True briefly after a box-select drag finishes — suppresses the click event that follows mouseup */
  static wasBoxSelecting = false;

  // ── Control group / squad system ──
  // 5 squad slots mapped to A/S/D/F/G keys (indices 0-4)
  private controlGroups: Map<number, string[]> = new Map(); // slot → array of unit IDs
  /** Whether shift was held during the current box-select drag */
  private shiftHeldDuringDrag = false;

  // Box selection state
  private isBoxSelecting = false;
  private boxStart = { x: 0, y: 0 };
  private boxEnd = { x: 0, y: 0 };
  private boxElement: HTMLDivElement;

  // Callbacks
  private onSelectionChange: ((units: Unit[]) => void) | null = null;
  private onRightClick: ((worldPos: THREE.Vector3, screenX: number, screenY: number) => void) | null = null;
  private onRightClickPing: ((worldPos: THREE.Vector3) => void) | null = null;

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

  onPing(callback: (worldPos: THREE.Vector3) => void): void {
    this.onRightClickPing = callback;
  }

  getSelectedUnits(): Unit[] {
    return this.selectedUnits;
  }

  clearSelection(): void {
    this.selectedUnits = [];
    this.onSelectionChange?.(this.selectedUnits);
  }

  /** Replace the current selection with a filtered subset (e.g. type toggle) */
  setSelection(units: Unit[]): void {
    this.selectedUnits = units;
    this.onSelectionChange?.(this.selectedUnits);
  }

  // ── Control Group (Squad) API ──

  /** Assign units to a control group slot (0-4 → A/S/D/F/G).
   *  If filterCombat is true, only combat units are stored (workers are deselected). */
  assignControlGroup(slot: number, units: Unit[], filterCombat: boolean): Unit[] {
    const WORKER_TYPES = new Set(['builder', 'lumberjack', 'villager']);
    const combatUnits = filterCombat
      ? units.filter(u => !WORKER_TYPES.has(u.type))
      : units;
    this.controlGroups.set(slot, combatUnits.map(u => u.id));
    // Update selection to only the combat units
    this.selectedUnits = combatUnits;
    this.onSelectionChange?.(this.selectedUnits);
    return combatUnits;
  }

  /** Select (recall) a previously assigned control group.
   *  Returns the units that were selected, or empty if the group doesn't exist. */
  selectControlGroup(slot: number): Unit[] {
    const ids = this.controlGroups.get(slot);
    if (!ids || ids.length === 0) return [];
    const idSet = new Set(ids);
    // Find living units that are still in the game
    const units = this.allUnits.filter(u =>
      u.owner === this.playerId && idSet.has(u.id) && u.currentHealth > 0
    );
    if (units.length === 0) {
      this.controlGroups.delete(slot); // Clean up dead groups
      return [];
    }
    // Update stored IDs to remove dead units
    this.controlGroups.set(slot, units.map(u => u.id));
    this.selectedUnits = units;
    this.onSelectionChange?.(this.selectedUnits);
    return units;
  }

  /** Check if a control group slot has units assigned */
  hasControlGroup(slot: number): boolean {
    const ids = this.controlGroups.get(slot);
    return !!ids && ids.length > 0;
  }

  /** Append a unit to an existing control group without changing the current selection.
   *  Creates the group if it doesn't exist. */
  appendToControlGroup(slot: number, unit: Unit): void {
    const ids = this.controlGroups.get(slot) ?? [];
    if (!ids.includes(unit.id)) {
      ids.push(unit.id);
      this.controlGroups.set(slot, ids);
    }
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
        this.shiftHeldDuringDrag = e.shiftKey; // Track shift for append-select
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

        // Always consume suppressNextClear on mouseup to prevent stale flag
        // from eating a future click (e.g. mousedown on building → drag → box select
        // would leave the flag set if only cleared inside handleClick)
        const wasSupprClear = SelectionManager.suppressNextClear;
        SelectionManager.suppressNextClear = false;

        if (SelectionManager.suppressNextClick) {
          SelectionManager.suppressNextClick = false;
          // Skip selection — attack-move consumed this click
        } else if (this.isBoxSelecting) {
          this.finishBoxSelect();
          // Flag so the click event (which fires after mouseup) knows to skip tooltips
          SelectionManager.wasBoxSelecting = true;
          requestAnimationFrame(() => { SelectionManager.wasBoxSelecting = false; });
        } else {
          // Single click selection — pass the suppress-clear flag through
          if (!wasSupprClear) {
            this.handleClick(e);
          }
          // If wasSupprClear, skip selection change (building/base/wall was clicked)
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
      const worldPos = this.screenToWorld(e.clientX, e.clientY);
      if (worldPos) {
        if (this.selectedUnits.length > 0) {
          this.onRightClick?.(worldPos, e.clientX, e.clientY);
        }
        // Always fire ping callback (even without selection)
        this.onRightClickPing?.(worldPos);
      }
    });
  }

  /** Find the player unit closest to the mouse cursor */
  private unitUnderCursor(e: MouseEvent): Unit | null {
    return this.findUnitUnderCursor(e, true);
  }

  /** Find any unit under cursor. If friendlyOnly=true, only player units. */
  findUnitUnderCursor(e: MouseEvent, friendlyOnly = false): Unit | null {
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
      if (friendlyOnly && unit.owner !== this.playerId) continue;
      if (unit.state === 'dead') continue;
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
    // suppressNextClear is now handled in the mouseup listener above
    // to prevent stale flags from eating future clicks

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
    const newlySelected: Unit[] = [];

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
        newlySelected.push(unit);
      }
    }

    if (this.shiftHeldDuringDrag) {
      // Shift+drag: APPEND to existing selection (no duplicates)
      const existingIds = new Set(this.selectedUnits.map(u => u.id));
      for (const unit of newlySelected) {
        if (!existingIds.has(unit.id)) {
          this.selectedUnits.push(unit);
        }
      }
    } else {
      // Normal drag: replace selection
      this.selectedUnits = newlySelected;
    }
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

    // Ground-plane intersection: try mid-elevation, then refine with tile's actual elevation
    const intersection = new THREE.Vector3();
    const midPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    raycaster.ray.intersectPlane(midPlane, intersection);
    if (intersection) return intersection;

    // Fallback: multiple elevation planes
    const elevations = [0, 0.5, 1.5, 2.0, 3.0];
    for (const elev of elevations) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev);
      const result = raycaster.ray.intersectPlane(plane, intersection);
      if (result) return intersection;
    }
    return null;
  }

  dispose(): void {
    this.boxElement.remove();
  }
}
