/**
 * BuildingTooltipController — Manages the building tooltip UI, unit queuing,
 * and demolition. Extracted from main.ts to keep UI logic separate.
 */

import { PlacedBuilding, BuildingKind, UnitType, GameContext } from '../../types';

/** Slim interface for callbacks that require main.ts state */
export interface TooltipOps {
  /** Enter rally-point-set mode for a building */
  enterRallyPointMode(buildingKey: string): void;
  /** Demolish a building (refund resources, unregister, notify) */
  demolishBuilding(pb: PlacedBuilding): void;
  /** Push to the appropriate spawn queue and update HUD */
  queueUnit(unitType: string, buildingKind: BuildingKind): void;
  /** Get queue button options for a building kind */
  getBuildingQueueOptions(kind: BuildingKind): { type: string; label: string; costLabel: string }[];
}

export default class BuildingTooltipController {
  private ctx: GameContext;
  private ops: TooltipOps;

  /** Currently displayed tooltip element */
  tooltipEl: HTMLDivElement | null = null;
  /** Currently selected building (for external reference) */
  selectedBuilding: PlacedBuilding | null = null;

  constructor(ctx: GameContext, ops: TooltipOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  /** Hide and remove the tooltip from the DOM */
  hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    this.selectedBuilding = null;
  }

  /** Show the building tooltip at the given screen position */
  showTooltip(pb: PlacedBuilding, screenX: number, screenY: number): void {
    this.hideTooltip();
    this.selectedBuilding = pb;

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      background: rgba(20,20,30,0.95); border: 2px solid #f1c40f; border-radius: 8px;
      padding: 10px 14px; color: #eee; font-family: 'Segoe UI',sans-serif; font-size: 13px;
      z-index: 9999; min-width: 180px; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;

    const kindLabel = pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1);
    const ownerLabel = pb.owner === 0 ? 'Player' : `AI ${pb.owner}`;
    const hpPct = Math.round((pb.health / pb.maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:#f1c40f">${kindLabel}</div>
      <div style="margin-bottom:4px">Owner: <span style="color:#3498db">${ownerLabel}</span></div>
      <div style="margin-bottom:4px">HP: <span style="color:${hpColor}">${pb.health}/${pb.maxHealth}</span> (${hpPct}%)</div>
      <div style="margin-bottom:4px">Position: (${pb.position.q}, ${pb.position.r})</div>
      <div style="margin-bottom:8px;border-bottom:1px solid #555;padding-bottom:6px"></div>
    `;

    const btnStyle = `
      display:inline-block; padding:4px 10px; margin:2px 4px 2px 0; border-radius:4px;
      cursor:pointer; font-size:12px; border:1px solid #555; color:#eee;
    `;

    // Rally point button (all buildings)
    html += `<div style="margin-bottom:6px">
      <span id="btt-rally" style="${btnStyle} background:#2980b9;">Set Rally</span>`;

    // Demolish button (only player buildings)
    if (pb.owner === 0) {
      html += `<span id="btt-demolish" style="${btnStyle} background:#c0392b;">Demolish</span>`;
    }
    html += `</div>`;

    // Unit queue buttons based on building kind
    const queueBtns = this.ops.getBuildingQueueOptions(pb.kind);
    if (queueBtns.length > 0 && pb.owner === 0) {
      html += `<div style="margin-top:4px;font-size:11px;color:#aaa;margin-bottom:4px">Queue Units:</div>`;
      html += `<div>`;
      for (const btn of queueBtns) {
        html += `<span class="btt-queue" data-unit="${btn.type}" data-building="${pb.kind}" style="${btnStyle} background:#27ae60;">${btn.label} (${btn.costLabel})</span>`;
      }
      html += `</div>`;
    }

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position so tooltip doesn't overflow screen
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${window.innerHeight - r.height - 8}px`;

    // Wire up button events
    const rallyBtn = el.querySelector('#btt-rally');
    if (rallyBtn) {
      rallyBtn.addEventListener('click', () => {
        this.hideTooltip();
        this.ops.enterRallyPointMode(pb.kind);
      });
    }

    const demolishBtn = el.querySelector('#btt-demolish');
    if (demolishBtn) {
      demolishBtn.addEventListener('click', () => {
        this.ops.demolishBuilding(pb);
        this.hideTooltip();
      });
    }

    const queueButtons = el.querySelectorAll('.btt-queue');
    queueButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const unitType = (btn as HTMLElement).dataset.unit as string;
        const buildingKind = (btn as HTMLElement).dataset.building as string;
        this.ops.queueUnit(unitType, buildingKind as BuildingKind);
      });
    });

    // Close tooltip when clicking elsewhere
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Clean up on game reset */
  cleanup(): void {
    this.hideTooltip();
  }
}
