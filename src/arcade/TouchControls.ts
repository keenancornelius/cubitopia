// ============================================
// CUBITOPIA - Touch gestures for the game canvas
// ============================================
// One finger:  tap own unit = select it · double-tap own unit = select all of
//              that type · tap enemy = attack it with the selection · tap ground
//              = move the selection there (or attack-move when armed) · drag = pan
//              · long-press then drag = box-select
// Two fingers: pinch = zoom · twist = rotate camera · drag = pan
//
// Every canvas touch is preventDefault()ed so the browser never scrolls,
// bounces, double-tap-zooms or synthesizes mouse clicks; desktop mouse and
// keyboard input is untouched (it never produces TouchEvents).
// ============================================

import * as THREE from 'three';
import type { Unit } from '../types';
import type { StrategyCamera } from '../engine/Camera';
import type { SelectionManager } from '../game/systems/SelectionManager';

export interface TouchOps {
  canvas: HTMLCanvasElement;
  camera: StrategyCamera;
  selection: SelectionManager;
  /** All units (any owner) */
  getUnits(): Unit[];
  localPlayer(): number;
  /** False while menus/overlays own the screen or no match is running */
  canCommand(): boolean;
  /** Tap on ground / friendly with a selection: move (existing right-click path) */
  issueCommand(world: THREE.Vector3): void;
  /** Tap on an enemy with a selection: focus-attack it */
  attackUnit(enemy: Unit): void;
  /** Attack-move to a point (when the A-MOVE button is armed) */
  attackMove(world: THREE.Vector3): void;
  /** Is the one-shot attack-move armed? */
  isAttackMoveArmed(): boolean;
  disarmAttackMove(): void;
  /** Feedback hooks (toasts, haptics) */
  hint(msg: string): void;
}

const TAP_SLOP_PX = 12;          // movement allowed for a tap
const LONG_PRESS_MS = 380;       // hold this long (without moving) to start box-select
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 36;
/** Twist direction: +1 makes the map follow the fingers (verified in tests). */
const ROTATE_SIGN = -1;

type Mode = 'idle' | 'pending' | 'pan' | 'box' | 'multi';

export class TouchControls {
  private ops: TouchOps;
  private mode: Mode = 'idle';
  private startX = 0; private startY = 0; private startT = 0;
  private lastX = 0; private lastY = 0;
  private longPressTimer: number | null = null;
  private lastTap = { t: 0, x: 0, y: 0, unitId: '' };
  // Two-finger state
  private pDist = 0; private pAngle = 0; private pMidX = 0; private pMidY = 0;
  private readonly proj = new THREE.Vector3();

  constructor(ops: TouchOps) {
    this.ops = ops;
    const c = ops.canvas;
    const opt: AddEventListenerOptions = { passive: false };
    c.addEventListener('touchstart', (e) => this.onStart(e), opt);
    c.addEventListener('touchmove', (e) => this.onMove(e), opt);
    c.addEventListener('touchend', (e) => this.onEnd(e), opt);
    c.addEventListener('touchcancel', (e) => this.onCancel(e), opt);
    // iOS Safari pinch-zoom of the page (gesture* events) — never wanted here
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, (e) => e.preventDefault(), opt);
    }
  }

  // ── Event handlers ────────────────────────────────────────

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches;
    if (t.length === 1) {
      this.mode = 'pending';
      this.startX = this.lastX = t[0].clientX;
      this.startY = this.lastY = t[0].clientY;
      this.startT = performance.now();
      this.clearLongPress();
      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null;
        if (this.mode !== 'pending' || !this.ops.canCommand()) return;
        this.mode = 'box';
        this.ops.selection.showSelectBox(this.startX, this.startY, this.lastX, this.lastY);
        try { navigator.vibrate?.(12); } catch { /* unsupported */ }
      }, LONG_PRESS_MS);
    } else if (t.length >= 2) {
      this.clearLongPress();
      if (this.mode === 'box') this.ops.selection.hideSelectBox();
      this.mode = 'multi';
      this.captureTwoFinger(t);
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches;
    if (this.mode === 'multi' && t.length >= 2) {
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      const dist = Math.hypot(dx, dy) || 1;
      const angle = Math.atan2(dy, dx);
      const midX = (t[0].clientX + t[1].clientX) / 2;
      const midY = (t[0].clientY + t[1].clientY) / 2;
      // Pinch: fingers apart → zoom in
      this.ops.camera.zoomBy(this.pDist / dist);
      // Twist (ignore the wrap-around jump at ±π)
      let dA = angle - this.pAngle;
      if (dA > Math.PI) dA -= Math.PI * 2;
      if (dA < -Math.PI) dA += Math.PI * 2;
      if (Math.abs(dA) < 0.5) this.ops.camera.rotateBy(dA * ROTATE_SIGN);
      // Two-finger drag pans
      this.pan(midX - this.pMidX, midY - this.pMidY);
      this.pDist = dist; this.pAngle = angle; this.pMidX = midX; this.pMidY = midY;
      return;
    }
    if (t.length !== 1) return;
    const x = t[0].clientX, y = t[0].clientY;
    if (this.mode === 'pending') {
      if (Math.hypot(x - this.startX, y - this.startY) > TAP_SLOP_PX) {
        this.clearLongPress();
        this.mode = 'pan';
      }
    }
    if (this.mode === 'pan') {
      this.pan(x - this.lastX, y - this.lastY);
    } else if (this.mode === 'box') {
      this.ops.selection.showSelectBox(this.startX, this.startY, x, y);
    }
    this.lastX = x; this.lastY = y;
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    const remaining = e.touches;
    if (this.mode === 'multi') {
      if (remaining.length >= 2) { this.captureTwoFinger(remaining); return; }
      if (remaining.length === 1) {
        // Lifting one finger of a pinch continues as a pan, never a tap
        this.mode = 'pan';
        this.lastX = remaining[0].clientX; this.lastY = remaining[0].clientY;
        return;
      }
      this.mode = 'idle';
      return;
    }
    if (remaining.length > 0) return;
    this.clearLongPress();
    if (this.mode === 'pending') {
      const touch = e.changedTouches[0];
      const x = touch ? touch.clientX : this.lastX;
      const y = touch ? touch.clientY : this.lastY;
      this.handleTap(x, y);
    } else if (this.mode === 'box') {
      const w = Math.abs(this.lastX - this.startX), h = Math.abs(this.lastY - this.startY);
      if (w < 6 && h < 6) {
        // Long-press without dragging: treat as a tap (select / command)
        this.ops.selection.hideSelectBox();
        this.handleTap(this.startX, this.startY);
      } else {
        this.ops.selection.finishSelectBox(false);
        const n = this.ops.selection.getSelectedUnits().length;
        this.ops.hint(n > 0 ? `${n} unit${n === 1 ? '' : 's'} selected` : 'No units in that box');
      }
    }
    this.mode = 'idle';
  }

  private onCancel(e: TouchEvent): void {
    e.preventDefault();
    this.clearLongPress();
    if (this.mode === 'box') this.ops.selection.hideSelectBox();
    this.mode = 'idle';
  }

  // ── Helpers ───────────────────────────────────────────────

  private captureTwoFinger(t: TouchList): void {
    const dx = t[1].clientX - t[0].clientX;
    const dy = t[1].clientY - t[0].clientY;
    this.pDist = Math.hypot(dx, dy) || 1;
    this.pAngle = Math.atan2(dy, dx);
    this.pMidX = (t[0].clientX + t[1].clientX) / 2;
    this.pMidY = (t[0].clientY + t[1].clientY) / 2;
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
  }

  /** Pan so the ground roughly tracks the finger 1:1 at any zoom. */
  private pan(dx: number, dy: number): void {
    const cam = this.ops.camera.camera;
    const h = this.ops.canvas.clientHeight || window.innerHeight;
    // Camera.pan moves distance*0.002 world units per px; ground visible per px is
    // 2*distance*tan(fov/2)/height — scale so one finger-px ≈ one ground-px.
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / h) / 0.002;
    this.ops.camera.panBy(dx * k, dy * k);
  }

  /**
   * Nearest living unit to a screen point, measured in screen pixels against the
   * unit's projected body. Generous radius (≥ 26 px) so fingers can hit small units.
   */
  pickUnit(x: number, y: number): Unit | null {
    const cam = this.ops.camera.camera;
    const rect = this.ops.canvas.getBoundingClientRect();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.ops.getUnits()) {
      if (u.state === 'dead') continue;
      const wp = u.worldPosition;
      this.proj.set(wp.x, wp.y + 0.45, wp.z).project(cam);
      if (this.proj.z > 1) continue; // behind camera
      const sx = rect.left + (this.proj.x + 1) / 2 * rect.width;
      const sy = rect.top + (1 - this.proj.y) / 2 * rect.height;
      // Unit height on screen → hit radius
      this.proj.set(wp.x, wp.y + 1.2, wp.z).project(cam);
      const topY = rect.top + (1 - this.proj.y) / 2 * rect.height;
      const radius = THREE.MathUtils.clamp(Math.abs(sy - topY) * 0.9, 26, 56);
      const d = Math.hypot(sx - x, sy - y);
      if (d < radius && d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  private handleTap(x: number, y: number): void {
    if (!this.ops.canCommand()) return;
    const sel = this.ops.selection;
    const me = this.ops.localPlayer();
    const now = performance.now();

    if (this.ops.isAttackMoveArmed()) {
      const world = sel.worldAtScreen(x, y);
      this.ops.disarmAttackMove();
      if (world && sel.getSelectedUnits().length > 0) this.ops.attackMove(world);
      return;
    }

    const unit = this.pickUnit(x, y);
    if (unit && unit.owner === me) {
      const isDouble = now - this.lastTap.t < DOUBLE_TAP_MS
        && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < DOUBLE_TAP_PX
        && this.lastTap.unitId === unit.id;
      if (isDouble) {
        sel.selectAllOfType(unit.type);
        const n = sel.getSelectedUnits().length;
        this.ops.hint(`All ${unit.type}s selected (${n})`);
        this.lastTap.t = 0;
      } else {
        sel.selectUnits([unit]);
        this.lastTap = { t: now, x, y, unitId: unit.id };
      }
      return;
    }
    this.lastTap.t = 0;

    const selected = sel.getSelectedUnits().filter(u => u.state !== 'dead');
    if (selected.length === 0) {
      this.ops.hint(unit ? 'Select your units first (tap a blue unit)' : 'Tap a blue unit to select it');
      return;
    }
    if (unit && unit.owner !== me) {
      this.ops.attackUnit(unit);
      return;
    }
    const world = sel.worldAtScreen(x, y);
    if (world) this.ops.issueCommand(world);
  }
}
