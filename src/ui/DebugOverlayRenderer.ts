/**
 * DebugOverlayRenderer — Draws per-unit debug labels projected to screen space.
 * Extracted from main.ts to reduce its line count.
 */

import * as THREE from 'three';
import type { Unit, UnitState } from '../types';

export interface DebugOverlayOps {
  showUnitOverlay(): boolean;
  getAllUnits(): Unit[];
  getCamera(): THREE.PerspectiveCamera;
  getCanvasId(): string;
}

export default class DebugOverlayRenderer {
  private ops: DebugOverlayOps;
  private container: HTMLElement | null = null;
  private labels = new Map<string, HTMLElement>();
  private timer = 0;
  private cachedRect: DOMRect | null = null;
  private static projV3 = new THREE.Vector3();

  constructor(ops: DebugOverlayOps) {
    this.ops = ops;
  }

  update(): void {
    if (!this.ops.showUnitOverlay()) {
      if (this.container) this.container.style.display = 'none';
      return;
    }

    // Throttle to ~10fps
    this.timer += 0.016;
    if (this.timer < 0.1) return;
    this.timer = 0;

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
      document.body.appendChild(this.container);
    }
    this.container.style.display = 'block';

    const cam = this.ops.getCamera();
    this.cachedRect = document.getElementById(this.ops.getCanvasId())!.getBoundingClientRect();
    const rect = this.cachedRect;
    const activeIds = new Set<string>();
    const projV = DebugOverlayRenderer.projV3;

    for (const unit of this.ops.getAllUnits()) {
      if ((unit.state as string) === 'dead') continue;
      activeIds.add(unit.id);
      projV.set(unit.worldPosition.x, unit.worldPosition.y + 1.6, unit.worldPosition.z);
      projV.project(cam);
      if (projV.z > 1) continue;

      const sx = (projV.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-projV.y * 0.5 + 0.5) * rect.height + rect.top;

      let lbl = this.labels.get(unit.id);
      if (!lbl) {
        lbl = document.createElement('div');
        lbl.style.cssText = 'position:fixed;font-size:9px;font-family:monospace;color:#fff;background:rgba(0,0,0,.75);padding:1px 4px;border-radius:3px;white-space:nowrap;pointer-events:none;transform:translate(-50%,-100%);border:1px solid rgba(255,255,255,.15);';
        this.container.appendChild(lbl);
        this.labels.set(unit.id, lbl);
      }

      const hp = unit.currentHealth;
      const maxHp = unit.stats.maxHealth;
      const atk = unit.stats.attack;
      const def = unit.stats.defense;
      const cacheKey = `${(unit.type as string)[0]}${(unit.state as string)[0]}${hp}${maxHp}${atk}${def}`;
      if ((lbl as any)._cache !== cacheKey) {
        (lbl as any)._cache = cacheKey;
        const ownerColors = ['#4fc3f7', '#ef5350', '#66bb6a', '#ffa726'];
        const oc = ownerColors[unit.owner] ?? '#aaaaaa';
        lbl.innerHTML = `<span style="color:${oc}">${(unit.type as string).substring(0, 4).toUpperCase()}</span> <span style="color:#aaa">${(unit.state as string).substring(0, 4).toUpperCase()}</span> <span style="color:#81c784">${hp}/${maxHp}</span> <span style="color:#ffb74d">A${atk} D${def}</span>`;
      }
      lbl.style.left = sx + 'px';
      lbl.style.top = sy + 'px';
      lbl.style.display = '';
    }

    for (const [id, lbl] of this.labels) {
      if (!activeIds.has(id)) { lbl.remove(); this.labels.delete(id); }
    }
  }
}
