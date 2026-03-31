/**
 * BuildingTooltipController — Manages the building tooltip UI, unit queuing,
 * and demolition. Extracted from main.ts to keep UI logic separate.
 */

import { PlacedBuilding, BuildingKind, UnitType, GameContext, Base, HexCoord, Unit } from '../../types';

/** Garrison info for tooltip display */
export interface GarrisonInfo {
  units: Unit[];
  current: number;
  max: number;
  reachableExits: HexCoord[];
}

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
  /** Order selected/all units to capture a zone (move + defensive stance) */
  captureZone(position: HexCoord): void;
  /** Order selected/all units to attack-move to a position */
  attackTarget(position: HexCoord): void;
  /** Set rally point for all combat buildings to a position */
  setRallyToPosition(position: HexCoord): void;
  /** Get garrison info for a structure */
  getGarrisonInfo(structureKey: string): GarrisonInfo | null;
  /** Ungarrison all units from a structure (optionally at an exit point) */
  ungarrisonStructure(structureKey: string, exitKey?: string): void;
  /** Garrison selected units into a structure */
  garrisonSelected(structureKey: string): void;
  /** Enter exit-point-pick mode for ungarrisoning at a connected structure */
  enterExitPickMode(structureKey: string): void;
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

    // Garrison section
    const structKey = `${pb.position.q},${pb.position.r}`;
    const garrisonInfo = this.ops.getGarrisonInfo(structKey);
    if (pb.owner === 0) {
      html += `<div style="margin:6px 0 4px;border-top:1px solid #555;padding-top:6px"></div>`;
      const gCount = garrisonInfo?.current ?? 0;
      const gMax = garrisonInfo?.max ?? 10;
      const garrisonColor = gCount > 0 ? '#e67e22' : '#666';
      html += `<div style="font-size:11px;color:#aaa;margin-bottom:4px">Garrison: <span style="color:${garrisonColor}">${gCount}/${gMax}</span></div>`;
      if (gCount > 0 && garrisonInfo) {
        // Show garrisoned unit types
        const typeCounts = new Map<string, number>();
        for (const u of garrisonInfo.units) {
          typeCounts.set(u.type, (typeCounts.get(u.type) ?? 0) + 1);
        }
        let typeList = '';
        for (const [type, count] of typeCounts) {
          typeList += `${count}x ${type} `;
        }
        html += `<div style="font-size:10px;color:#ccc;margin-bottom:4px">${typeList.trim()}</div>`;

        // Ungarrison buttons
        html += `<div>`;
        html += `<span id="btt-ungarrison" style="${btnStyle} background:#e67e22;">Ungarrison</span>`;
        if (garrisonInfo.reachableExits.length > 0) {
          html += `<span id="btt-exit-pick" style="${btnStyle} background:#8e44ad;">Exit At...</span>`;
        }
        html += `</div>`;
      }
      html += `<div><span id="btt-garrison" style="${btnStyle} background:#d35400;">Garrison Selected</span></div>`;
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

    // Garrison buttons
    const garrisonBtn = el.querySelector('#btt-garrison');
    if (garrisonBtn) {
      garrisonBtn.addEventListener('click', () => {
        this.ops.garrisonSelected(structKey);
        this.hideTooltip();
      });
    }
    const ungarrisonBtn = el.querySelector('#btt-ungarrison');
    if (ungarrisonBtn) {
      ungarrisonBtn.addEventListener('click', () => {
        this.ops.ungarrisonStructure(structKey);
        this.hideTooltip();
      });
    }
    const exitPickBtn = el.querySelector('#btt-exit-pick');
    if (exitPickBtn) {
      exitPickBtn.addEventListener('click', () => {
        this.ops.enterExitPickMode(structKey);
        this.hideTooltip();
      });
    }

    // Close tooltip when clicking elsewhere
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Show tooltip for an enemy/neutral building — stats + attack/rally actions */
  showEnemyBuildingTooltip(pb: PlacedBuilding, screenX: number, screenY: number): void {
    this.hideTooltip();

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      background: rgba(30,15,15,0.95); border: 2px solid #e74c3c; border-radius: 8px;
      padding: 10px 14px; color: #eee; font-family: 'Segoe UI',sans-serif; font-size: 13px;
      z-index: 9999; min-width: 200px; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;

    const kindLabel = pb.kind.replace('_', ' ');
    const displayKind = kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);
    const ownerLabel = pb.owner === 2 ? 'Neutral' : `Enemy (AI ${pb.owner})`;
    const ownerColor = pb.owner === 2 ? '#d4af37' : '#e74c3c';
    const hpPct = Math.round((pb.health / pb.maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    // Building-specific modifiers
    let modifiers = '';
    if (pb.kind === 'barracks') modifiers = '<div style="color:#aaa;font-size:11px;margin-top:2px">Spawns combat units</div>';
    else if (pb.kind === 'wizard_tower') modifiers = '<div style="color:#9b59b6;font-size:11px;margin-top:2px">Spawns mages &amp; healers</div>';
    else if (pb.kind === 'armory') modifiers = '<div style="color:#71797e;font-size:11px;margin-top:2px">Spawns armored units</div>';
    else if (pb.kind === 'workshop') modifiers = '<div style="color:#8b4513;font-size:11px;margin-top:2px">Crafts siege weapons</div>';
    else if (pb.kind === 'smelter') modifiers = '<div style="color:#b87333;font-size:11px;margin-top:2px">Smelts steel from iron</div>';

    const btnStyle = `
      display:inline-block; padding:5px 12px; margin:2px 4px 2px 0; border-radius:4px;
      cursor:pointer; font-size:12px; border:1px solid #555; color:#eee;
    `;

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:${ownerColor}">⚔ ${displayKind}</div>
      <div style="margin-bottom:4px">Owner: <span style="color:${ownerColor}">${ownerLabel}</span></div>
      <div style="margin-bottom:4px">HP: <span style="color:${hpColor}">${pb.health}/${pb.maxHealth}</span> (${hpPct}%)</div>
      <div style="margin-bottom:2px">Position: (${pb.position.q}, ${pb.position.r})</div>
      ${modifiers}
      <div style="margin:8px 0 6px;border-bottom:1px solid #555;"></div>
      <div style="font-size:11px;color:#aaa;margin-bottom:4px">⚠ Very tanky — siege weapons deal full damage</div>
      <div>
        <span id="btt-attack" style="${btnStyle} background:#c0392b;">⚔ Attack</span>
        <span id="btt-rally-to" style="${btnStyle} background:#2980b9;">🚩 Rally Here</span>
      </div>
    `;

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${window.innerHeight - r.height - 8}px`;

    // Wire up buttons
    el.querySelector('#btt-attack')?.addEventListener('click', () => {
      this.ops.attackTarget(pb.position);
      this.hideTooltip();
    });
    el.querySelector('#btt-rally-to')?.addEventListener('click', () => {
      this.ops.setRallyToPosition(pb.position);
      this.hideTooltip();
    });

    // Close on outside click
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Show tooltip for a base (friendly, enemy, or neutral) */
  showBaseTooltip(base: Base, isOwn: boolean, screenX: number, screenY: number): void {
    this.hideTooltip();

    const borderColor = isOwn ? '#3498db' : (base.owner === 2 ? '#d4af37' : '#e74c3c');
    const bgColor = isOwn ? 'rgba(15,20,30,0.95)' : (base.owner === 2 ? 'rgba(30,25,10,0.95)' : 'rgba(30,15,15,0.95)');

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 8px;
      padding: 10px 14px; color: #eee; font-family: 'Segoe UI',sans-serif; font-size: 13px;
      z-index: 9999; min-width: 200px; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;

    let nameLabel: string;
    let ownerLabel: string;
    if (base.owner === 2) {
      nameLabel = '🏰 Neutral Citadel';
      ownerLabel = '<span style="color:#d4af37">Neutral (Capturable)</span>';
    } else if (isOwn) {
      nameLabel = '🏰 Your Base';
      ownerLabel = '<span style="color:#3498db">Player</span>';
    } else {
      nameLabel = '🏰 Enemy Base';
      ownerLabel = `<span style="color:#e74c3c">Enemy (AI ${base.owner})</span>`;
    }

    const btnStyle = `
      display:inline-block; padding:5px 12px; margin:2px 4px 2px 0; border-radius:4px;
      cursor:pointer; font-size:12px; border:1px solid #555; color:#eee;
    `;

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:${borderColor}">${nameLabel}</div>
      <div style="margin-bottom:4px">Owner: ${ownerLabel}</div>
      <div style="margin-bottom:2px">Capture Zone: <span style="color:#aaa">5-hex radius</span></div>
      <div style="margin-bottom:2px">Position: (${base.position.q}, ${base.position.r})</div>
    `;

    // Zone control info based on base type
    if (base.owner === 2) {
      html += '<div style="color:#d4af37;font-size:11px;margin-top:4px">Hold unit majority in the zone to capture this outpost</div>';
    } else if (!isOwn) {
      html += '<div style="color:#e74c3c;font-size:11px;margin-top:4px">Occupy the zone with more units to capture — instant defeat for the enemy</div>';
    } else {
      html += '<div style="color:#3498db;font-size:11px;margin-top:4px">Keep units in the zone to defend — losing this base means defeat</div>';
    }

    html += '<div style="margin:8px 0 6px;border-bottom:1px solid #555;"></div>';

    // Action buttons
    if (!isOwn) {
      html += `<div>
        <span id="btt-capture" style="${btnStyle} background:#27ae60;">🏴 Capture Zone</span>
        <span id="btt-rally-to" style="${btnStyle} background:#2980b9;">🚩 Rally Here</span>
      </div>`;
    } else {
      html += `<div>
        <span id="btt-rally-to" style="${btnStyle} background:#2980b9;">🚩 Rally Here</span>
      </div>`;
    }

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${window.innerHeight - r.height - 8}px`;

    // Wire up buttons
    el.querySelector('#btt-capture')?.addEventListener('click', () => {
      this.ops.captureZone(base.position);
      this.hideTooltip();
    });
    el.querySelector('#btt-rally-to')?.addEventListener('click', () => {
      this.ops.setRallyToPosition(base.position);
      this.hideTooltip();
    });

    // Close on outside click
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Show tooltip for a friendly wall or gate (garrison controls) */
  showWallGateTooltip(
    structureKey: string,
    structureType: 'wall' | 'gate',
    owner: number,
    health: number,
    maxHealth: number,
    screenX: number,
    screenY: number,
  ): void {
    this.hideTooltip();

    const isOwn = owner === 0;
    const borderColor = isOwn ? '#e67e22' : '#e74c3c';
    const bgColor = isOwn ? 'rgba(20,20,30,0.95)' : 'rgba(30,15,15,0.95)';
    const typeLabel = structureType === 'gate' ? 'Gate' : 'Wall';

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 8px;
      padding: 10px 14px; color: #eee; font-family: 'Segoe UI',sans-serif; font-size: 13px;
      z-index: 9999; min-width: 180px; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;

    const ownerLabel = owner === 0 ? 'Player' : `AI ${owner}`;
    const hpPct = Math.round((health / maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    const btnStyle = `
      display:inline-block; padding:4px 10px; margin:2px 4px 2px 0; border-radius:4px;
      cursor:pointer; font-size:12px; border:1px solid #555; color:#eee;
    `;

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:${borderColor}">${typeLabel}</div>
      <div style="margin-bottom:4px">Owner: <span style="color:#3498db">${ownerLabel}</span></div>
      <div style="margin-bottom:4px">HP: <span style="color:${hpColor}">${health}/${maxHealth}</span> (${hpPct}%)</div>
    `;

    // Garrison section (friendly only)
    if (isOwn) {
      const garrisonInfo = this.ops.getGarrisonInfo(structureKey);
      const gCount = garrisonInfo?.current ?? 0;
      const gMax = garrisonInfo?.max ?? (structureType === 'gate' ? 5 : 2);
      const garrisonColor = gCount > 0 ? '#e67e22' : '#666';

      html += `<div style="margin:6px 0 4px;border-top:1px solid #555;padding-top:6px"></div>`;
      html += `<div style="font-size:11px;color:#aaa;margin-bottom:4px">Garrison: <span style="color:${garrisonColor}">${gCount}/${gMax}</span></div>`;

      if (gCount > 0 && garrisonInfo) {
        const typeCounts = new Map<string, number>();
        for (const u of garrisonInfo.units) {
          typeCounts.set(u.type, (typeCounts.get(u.type) ?? 0) + 1);
        }
        let typeList = '';
        for (const [type, count] of typeCounts) {
          typeList += `${count}x ${type} `;
        }
        html += `<div style="font-size:10px;color:#ccc;margin-bottom:4px">${typeList.trim()}</div>`;
        html += `<div>`;
        html += `<span id="btt-ungarrison" style="${btnStyle} background:#e67e22;">Ungarrison</span>`;
        if (garrisonInfo.reachableExits.length > 0) {
          html += `<span id="btt-exit-pick" style="${btnStyle} background:#8e44ad;">Exit At...</span>`;
        }
        html += `</div>`;
      }
      html += `<div><span id="btt-garrison" style="${btnStyle} background:#d35400;">Garrison Selected</span></div>`;
    }

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${window.innerHeight - r.height - 8}px`;

    // Wire up garrison buttons
    el.querySelector('#btt-garrison')?.addEventListener('click', () => {
      this.ops.garrisonSelected(structureKey);
      this.hideTooltip();
    });
    el.querySelector('#btt-ungarrison')?.addEventListener('click', () => {
      this.ops.ungarrisonStructure(structureKey);
      this.hideTooltip();
    });
    el.querySelector('#btt-exit-pick')?.addEventListener('click', () => {
      this.ops.enterExitPickMode(structureKey);
      this.hideTooltip();
    });

    // Close on outside click
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
