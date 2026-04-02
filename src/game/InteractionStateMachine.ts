// ============================================
// InteractionStateMachine — Typed FSM for player interaction modes
// ============================================
// Replaces 26+ boolean mode flags and 10 rotation fields with a single
// discriminated union. All mode transitions go through enter()/exit()
// which handle HUD updates, cursor changes, and suppression flags.

import { BuildingKind } from '../types';
import { StrategyCamera } from '../engine/Camera';
import { SelectionManager } from './systems/SelectionManager';

// ─── Interaction State Union ─────────────────────────────────────────────────

/** The player is in default mode — selecting, commanding, inspecting */
export interface IdleState {
  readonly kind: 'idle';
}

/** Placing a building (any of the 9 building types) */
export interface PlaceBuildingState {
  readonly kind: 'place_building';
  readonly building: BuildingKind;
  rotation: number; // 0 or Math.PI/2 — mutable for R-key toggle
}

/** Painting wall blueprints */
export interface WallBuildState {
  readonly kind: 'wall_build';
  rotation: number;
}

/** Harvest mode — click trees to mark for chopping */
export interface HarvestState {
  readonly kind: 'harvest';
}

/** Mine mode — click terrain to designate mining */
export interface MineState {
  readonly kind: 'mine';
}

/** Painting farm patches on plains tiles */
export interface FarmPatchState {
  readonly kind: 'farm_patch';
}

/** Plant tree saplings */
export interface PlantTreeState {
  readonly kind: 'plant_tree';
}

/** Plant crops on farm patches */
export interface PlantCropsState {
  readonly kind: 'plant_crops';
}

/** Setting rally point for a building */
export interface RallyPointState {
  readonly kind: 'rally_point';
  readonly buildingKey: string;
}

/** Picking garrison exit location */
export interface ExitPickState {
  readonly kind: 'exit_pick';
  readonly sourceKey: string;
}

/** Attack-move mode — next click issues attack-move command */
export interface AttackMoveState {
  readonly kind: 'attack_move';
}

export type InteractionState =
  | IdleState
  | PlaceBuildingState
  | WallBuildState
  | HarvestState
  | MineState
  | FarmPatchState
  | PlantTreeState
  | PlantCropsState
  | RallyPointState
  | ExitPickState
  | AttackMoveState;

// ─── Callbacks the FSM needs from the outside ────────────────────────────────

export interface InteractionCallbacks {
  /** Update HUD mode indicator. `null` means all modes off. */
  setHUDMode(state: InteractionState): void;
  /** Reset slicer to default visual-only callback */
  resetSlicer(): void;
  /** Clear the blueprint hover ghost */
  clearHoverGhost(): void;
  /** Hide building tooltip */
  hideTooltip(): void;
  /** Get the canvas element for cursor changes */
  getCanvas(): HTMLCanvasElement;
}

// ─── State Machine ───────────────────────────────────────────────────────────

export class InteractionStateMachine {
  private _state: InteractionState = { kind: 'idle' };
  private callbacks: InteractionCallbacks;

  constructor(callbacks: InteractionCallbacks) {
    this.callbacks = callbacks;
  }

  /** Current interaction state (read-only reference) */
  get state(): InteractionState { return this._state; }

  /** Shorthand: is the player in the default idle state? */
  get isIdle(): boolean { return this._state.kind === 'idle'; }

  /** Is the player in any placement/paint mode that should suppress normal clicks? */
  get inModal(): boolean { return this._state.kind !== 'idle' && this._state.kind !== 'attack_move'; }

  /** Is the player in a building placement mode? */
  get isPlacingBuilding(): boolean { return this._state.kind === 'place_building'; }

  /** Get the active building kind, or null */
  get activeBuilding(): BuildingKind | null {
    return this._state.kind === 'place_building' ? this._state.building : null;
  }

  /** Get the current rotation for any mode that has one */
  get rotation(): number {
    const s = this._state;
    if (s.kind === 'place_building' || s.kind === 'wall_build') return s.rotation;
    return 0;
  }

  /** Toggle rotation (R key) — only affects states that have rotation */
  cycleRotation(): void {
    const s = this._state;
    if (s.kind === 'place_building' || s.kind === 'wall_build') {
      s.rotation = s.rotation === 0 ? Math.PI / 2 : 0;
    }
  }

  // ─── Transitions ────────────────────────────────────────────────────────

  /** Enter a new interaction state. Exits the current one first. */
  enter(next: InteractionState): void {
    if (this._state.kind !== 'idle') {
      this.exitCurrent();
    }
    this._state = next;

    // Apply enter effects
    const canvas = this.callbacks.getCanvas();
    if (next.kind === 'idle') {
      canvas.style.cursor = 'default';
    } else {
      canvas.style.cursor = 'crosshair';
    }

    // Suppress camera/selection during modal modes
    if (this.inModal) {
      StrategyCamera.suppressLeftDrag = true;
      SelectionManager.suppressBoxSelect = true;
    }

    // Mine mode also suppresses right-click (right-click = camera rotate only)
    if (next.kind === 'mine') {
      SelectionManager.suppressRightClick = true;
    }

    this.callbacks.setHUDMode(next);
  }

  /** Toggle: if already in this state, go idle; otherwise enter it */
  toggle(next: InteractionState): void {
    if (this.matches(next)) {
      this.enter({ kind: 'idle' });
    } else {
      this.enter(next);
    }
  }

  /** Toggle a building placement mode */
  toggleBuilding(building: BuildingKind): void {
    if (this._state.kind === 'place_building' && this._state.building === building) {
      this.enter({ kind: 'idle' });
    } else {
      this.enter({ kind: 'place_building', building, rotation: 0 });
    }
  }

  /** Return to idle, cleaning up the current state */
  clear(): void {
    if (this._state.kind !== 'idle') {
      this.exitCurrent();
      this._state = { kind: 'idle' };
      this.callbacks.setHUDMode(this._state);
      this.callbacks.getCanvas().style.cursor = 'default';
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /** Check if the current state matches a given state (by kind + key fields) */
  private matches(other: InteractionState): boolean {
    if (this._state.kind !== other.kind) return false;
    if (this._state.kind === 'place_building' && other.kind === 'place_building') {
      return this._state.building === other.building;
    }
    if (this._state.kind === 'rally_point' && other.kind === 'rally_point') {
      return this._state.buildingKey === other.buildingKey;
    }
    if (this._state.kind === 'exit_pick' && other.kind === 'exit_pick') {
      return this._state.sourceKey === other.sourceKey;
    }
    return true;
  }

  /** Type-narrowing helper: get state if it matches a specific kind */
  as<K extends InteractionState['kind']>(kind: K): Extract<InteractionState, { kind: K }> | null {
    return this._state.kind === kind ? this._state as Extract<InteractionState, { kind: K }> : null;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private exitCurrent(): void {
    // Undo suppression flags
    StrategyCamera.suppressLeftDrag = false;
    SelectionManager.suppressBoxSelect = false;
    SelectionManager.suppressRightClick = false;

    // Clean up mode-specific artifacts
    if (this._state.kind === 'mine') {
      this.callbacks.resetSlicer();
    }

    this.callbacks.clearHoverGhost();
    this.callbacks.hideTooltip();
  }
}
