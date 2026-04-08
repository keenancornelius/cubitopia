/**
 * BuildingTooltipController — Manages the building tooltip UI, unit queuing,
 * and demolition. Extracted from main.ts to keep UI logic separate.
 */

import * as THREE from 'three';
import { PlacedBuilding, BuildingKind, UnitType, UnitStance, GameContext, Base, HexCoord, Unit } from '../../types';
import { getPlayerCSS, getPlayerHex } from '../PlayerConfig';
import { StatusEffectSystem } from './StatusEffectSystem';
import { UnitModels } from '../../engine/UnitModels';
import { UI, COLORS, FONT, BORDER, SHADOW } from '../../ui/UITheme';

/** Garrison info for tooltip display (network-wide for gates) */
export interface GarrisonInfo {
  units: Unit[];
  current: number;
  max: number;
  reachableExits: HexCoord[];
  /** Number of garrisonable structures (gates/buildings) in the connected network */
  structureCount?: number;
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
  /** Order selected units to focus-attack a specific enemy unit (chase it) */
  focusAttackUnit(unitId: string, position: HexCoord): void;
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
  /** Ungarrison only units matching specific types to an exit */
  ungarrisonFiltered(structureKey: string, unitTypes: Set<UnitType>, exitKey?: string): void;
  /** Demolish a wall (refund stone, remove from game) */
  demolishWall(coord: HexCoord): void;
  /** Demolish a gate (refund stone, remove from game) */
  demolishGate(coord: HexCoord): void;
  /** Get the main game scene for cinematic PIP camera mode */
  getScene(): THREE.Scene | null;
  /** Set stance for a single unit (from friendly unit tooltip) */
  setUnitStance(unitId: string, stance: UnitStance): void;
  /** Kill a friendly unit (sacrifice / dismiss) */
  killUnit(unitId: string): void;
  /** Get squad info for all player squads: slot → { label, unitCount } */
  getSquadSlots(): Map<number, { label: string; unitCount: number }>;
  /** Get the squad slot assigned to a specific building (by hex key), or null */
  getBuildingSquadAssignment(buildingHexKey: string): number | null;
  /** Assign a building (by hex key) to feed a squad slot. Pass null to clear. */
  assignBuildingToSquad(buildingHexKey: string, squadSlot: number | null): void;
  /** Create a new squad from scratch (no units yet), returns the slot number */
  createSquadForBuilding(buildingHexKey: string): number | null;
  /** Get centroid world position of a squad by slot, or null if squad has no units */
  getSquadCentroid(squadSlot: number): { x: number; y: number; z: number } | null;
  /** Set the building's rally point to a squad's current centroid (dynamic rally) */
  rallyBuildingToSquad(buildingHexKey: string, buildingKind: string, squadSlot: number): void;
}

export default class BuildingTooltipController {
  private ctx: GameContext;
  private ops: TooltipOps;

  /** Currently displayed tooltip element */
  tooltipEl: HTMLDivElement | null = null;
  /** Currently selected building (for external reference) */
  selectedBuilding: PlacedBuilding | null = null;
  /** Active keyboard handler for tooltip hotkeys */
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** PIP mini-camera state */
  private _pipRenderer: THREE.WebGLRenderer | null = null;
  private _pipScene: THREE.Scene | null = null;       // isolated scene for model view
  private _pipCamera: THREE.PerspectiveCamera | null = null;
  private _pipGroup: THREE.Group | null = null;        // model group (model mode only)
  private _pipAnimFrame: number = 0;
  private _pipMode: 'model' | 'cinematic' = 'cinematic';
  private _pipUnit: Unit | null = null;                // tracked unit (cinematic mode)

  constructor(ctx: GameContext, ops: TooltipOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  // ── Shared style helpers ──

  /** Key badge HTML — small monospace label like [Q] */
  private static keyBadge(key: string): string {
    return `<span style="${UI.keyBadge()};margin-right:4px;line-height:14px;vertical-align:middle">${key}</span>`;
  }

  /** Standard button style */
  private static btnStyle(bg: string): string {
    return UI.button(bg);
  }

  /** Section divider */
  private static divider(): string {
    return `<div style="${UI.divider()}"></div>`;
  }

  /** Hide and remove the tooltip from the DOM */
  hideTooltip(): void {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this.stopPIP();
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    this.selectedBuilding = null;
  }

  // ── PIP mini-camera for unit tooltip ──
  // Two modes:
  //   "model"     — isolated scene with turntable unit model (like debug panel)
  //   "cinematic" — live game scene close-up orbiting the actual unit on the map

  private static readonly PIP_W = 150;
  private static readonly PIP_H = 100;

  /** Start a PIP preview on the given canvas for a unit */
  private startPIP(unit: Unit, canvasEl: HTMLCanvasElement, mode: 'model' | 'cinematic' = 'cinematic'): void {
    this.stopPIP();
    // Use the CSS-specified size as the display size; render at 2x for sharpness
    const cssW = canvasEl.clientWidth || BuildingTooltipController.PIP_W;
    const cssH = canvasEl.clientHeight || BuildingTooltipController.PIP_H;
    const PIP_W = cssW;
    const PIP_H = cssH;

    this._pipMode = mode;
    this._pipUnit = unit;

    // Renderer — pass updateStyle=false so THREE doesn't override CSS dimensions
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
    renderer.setSize(PIP_W * 2, PIP_H * 2, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x111822, 1);
    this._pipRenderer = renderer;

    if (mode === 'model') {
      this._initModelMode(unit, PIP_W, PIP_H);
    } else {
      this._initCinematicMode(unit, PIP_W, PIP_H);
    }
  }

  /** Get camera parameters adapted to unit type — large units need more distance */
  private static _unitCameraParams(unitType: string): { camDist: number; camHeight: number; lookAtY: number; modelCamPos: [number, number, number] } {
    // Large units: Ogre (1.4x), Trebuchet, Catapult — pull camera back
    const LARGE_UNITS = new Set([UnitType.OGRE, UnitType.TREBUCHET]);
    if (LARGE_UNITS.has(unitType as UnitType)) {
      return { camDist: 5.0, camHeight: 2.6, lookAtY: 1.2, modelCamPos: [2.2, 2.6, 3.5] };
    }
    // Medium units: Paladin, Shieldbearer, Greatsword, Berserker — slightly wider
    const MEDIUM_UNITS = new Set([UnitType.PALADIN, UnitType.SHIELDBEARER, UnitType.GREATSWORD, UnitType.BERSERKER]);
    if (MEDIUM_UNITS.has(unitType as UnitType)) {
      return { camDist: 3.8, camHeight: 2.0, lookAtY: 1.0, modelCamPos: [1.7, 2.0, 2.8] };
    }
    // Default: standard-sized units
    return { camDist: 3.5, camHeight: 1.8, lookAtY: 1.0, modelCamPos: [1.5, 1.8, 2.5] };
  }

  /** Model mode — isolated scene with turntable (like DebugPanel.initPreview) */
  private _initModelMode(unit: Unit, w: number, h: number): void {
    const scene = new THREE.Scene();
    this._pipScene = scene;

    // Lights — ambient + directional + rim
    scene.add(new THREE.AmbientLight(0x667788, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(3, 5, 4);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0x4488ff, 0.4);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    // Ground plane — scaled for large units
    const params = BuildingTooltipController._unitCameraParams(unit.type);
    const groundSize = params.camDist > 4 ? 5 : 3;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x1a2332, transparent: true, opacity: 0.6 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.15;
    scene.add(ground);

    // Build unit model with owner's color
    const group = new THREE.Group();
    UnitModels.buildUnitModel(group, unit.type as UnitType, getPlayerHex(unit.owner));
    scene.add(group);
    this._pipGroup = group;

    // Camera — adapted to unit scale
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(...params.modelCamPos);
    camera.lookAt(0, 0.3, 0);
    this._pipCamera = camera;

    // Animate — slow turntable
    const animate = () => {
      if (!this._pipRenderer || !this._pipScene || !this._pipCamera || !this._pipGroup) return;
      this._pipGroup.rotation.y += 0.008;
      this._pipRenderer.render(this._pipScene, this._pipCamera);
      this._pipAnimFrame = requestAnimationFrame(animate);
    };
    this._pipAnimFrame = requestAnimationFrame(animate);
  }

  /** Cinematic mode — orbiting close-up of the actual unit on the game map */
  private _initCinematicMode(unit: Unit, w: number, h: number): void {
    // Wider FOV so the unit + surroundings fit in the compact canvas
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    this._pipCamera = camera;

    // Adaptive orbit params based on unit type
    const params = BuildingTooltipController._unitCameraParams(unit.type);

    const animate = () => {
      if (!this._pipRenderer || !this._pipCamera || !this._pipUnit) return;
      const scene = this.ops.getScene();
      if (!scene) return;

      // Orbit around the unit's world position — close-up portrait
      const wp = this._pipUnit.worldPosition;
      const t = performance.now() / 4000; // slow orbit
      this._pipCamera.position.set(
        wp.x + Math.cos(t) * params.camDist,
        wp.y + params.camHeight,
        wp.z + Math.sin(t) * params.camDist
      );
      this._pipCamera.lookAt(wp.x, wp.y + params.lookAtY, wp.z);

      this._pipRenderer.render(scene, this._pipCamera);
      this._pipAnimFrame = requestAnimationFrame(animate);
    };
    this._pipAnimFrame = requestAnimationFrame(animate);
  }

  /** Toggle PIP mode between model and cinematic */
  private togglePIPMode(unit: Unit, canvasEl: HTMLCanvasElement): void {
    const newMode = this._pipMode === 'model' ? 'cinematic' : 'model';
    this.startPIP(unit, canvasEl, newMode);
  }

  /** Stop the PIP preview and clean up GPU resources */
  private stopPIP(): void {
    if (this._pipAnimFrame) {
      cancelAnimationFrame(this._pipAnimFrame);
      this._pipAnimFrame = 0;
    }
    // Dispose unit model geometry/materials (model mode only)
    if (this._pipGroup) {
      this._pipGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            (obj.material as THREE.Material)?.dispose();
          }
        }
      });
      this._pipGroup = null;
    }
    if (this._pipRenderer) {
      // Force-release WebGL context to prevent context exhaustion
      // (browsers limit active contexts to ~8-16; without this, clicking
      // multiple units leaks contexts and kills the main game renderer)
      const gl = this._pipRenderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this._pipRenderer.dispose();
      this._pipRenderer = null;
    }
    this._pipScene = null;
    this._pipCamera = null;
    this._pipUnit = null;
  }

  /** Show the building tooltip at the given screen position */
  showTooltip(pb: PlacedBuilding, screenX: number, screenY: number): void {
    this.hideTooltip();
    this.selectedBuilding = pb;

    const K = BuildingTooltipController.keyBadge;
    const B = BuildingTooltipController.btnStyle;
    const DIV = BuildingTooltipController.divider;

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      ${UI.panel(COLORS.yellow)}; z-index: 9999; min-width: 200px;
    `;

    const kindLabel = pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1);
    const ownerLabel = pb.owner === this.ctx.localPlayerIndex ? 'Player' : (this.ctx.players[pb.owner]?.isAI ? `AI ${pb.owner}` : 'Enemy');
    const hpPct = Math.round((pb.health / pb.maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    let html = `
      <div style="font-size:${FONT.lg};font-weight:bold;margin-bottom:6px;color:${COLORS.yellow};font-family:${FONT.family}">${kindLabel}</div>
      <div style="font-size:${FONT.sm};color:${COLORS.textSecondary};margin-bottom:4px;font-family:${FONT.family}">Owner: <span style="color:${COLORS.blue}">${ownerLabel}</span></div>
      <div style="font-size:${FONT.sm};color:${COLORS.textSecondary};margin-bottom:4px;font-family:${FONT.family}">HP: <span style="color:${hpColor}">${pb.health}/${pb.maxHealth}</span> (${hpPct}%)</div>
    `;

    // ── Unit queue section (QWERTY keys) ──
    const queueBtns = this.ops.getBuildingQueueOptions(pb.kind);
    if (queueBtns.length > 0 && pb.owner === this.ctx.localPlayerIndex) {
      html += DIV();
      html += `<div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family};letter-spacing:0.5px;text-transform:uppercase">Queue Units</div>`;
      const qwertyKeys = ['Q', 'W', 'E', 'R', 'T', 'Y'];
      for (let i = 0; i < queueBtns.length; i++) {
        const btn = queueBtns[i];
        const key = qwertyKeys[i] || '';
        html += `<div class="btt-queue" data-unit="${btn.type}" data-building="${pb.kind}"
          style="${B('#27ae60')} width:calc(100% - 28px);margin-bottom:2px">
          ${K(key)} ${btn.label} <span style="color:#aaa;margin-left:auto;font-size:11px">${btn.costLabel}</span>
        </div>`;
      }
    }

    // ── Actions section (F = Rally, X = Demolish) ──
    if (pb.owner === this.ctx.localPlayerIndex) {
      html += DIV();
      html += `<div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family};letter-spacing:0.5px;text-transform:uppercase">Actions</div>`;
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap">`;
      html += `<span id="btt-rally" style="${B('#2980b9')}">${K('F')} Rally</span>`;
      html += `<span id="btt-demolish" style="${B('#c0392b')}">${K('X')} Demolish</span>`;
      html += `</div>`;
    } else {
      // Non-player buildings just get rally
      html += DIV();
      html += `<span id="btt-rally" style="${B('#2980b9')}">${K('F')} Rally</span>`;
    }

    // ── Squad Assignment section (per-building → squad slot) ──
    // Only show for combat-producing buildings (not farmhouse/forestry/masonry)
    const COMBAT_BUILDINGS: Set<string> = new Set(['barracks', 'armory', 'wizard_tower', 'workshop']);
    const buildingHexKey = `${pb.position.q},${pb.position.r}`;
    if (pb.owner === this.ctx.localPlayerIndex && COMBAT_BUILDINGS.has(pb.kind)) {
      const SQ_LABELS = ['A', 'S', 'D', 'F', 'G'];
      const squads = this.ops.getSquadSlots();
      const curSquad = this.ops.getBuildingSquadAssignment(buildingHexKey);

      html += DIV();
      html += `<div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family};letter-spacing:0.5px;text-transform:uppercase">Reinforcements \u2192 Squad</div>`;
      html += `<div id="btt-squad-btns" style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">`;

      for (const [slot, info] of squads) {
        const lbl = SQ_LABELS[slot] ?? `${slot}`;
        const isActive = curSquad === slot;
        const bg = isActive ? 'rgba(79,195,247,0.35)' : 'rgba(79,195,247,0.1)';
        const bdr = isActive ? '#4fc3f7' : '#555';
        const clr = isActive ? '#4fc3f7' : '#aaa';
        const ck = isActive ? ' \u2713' : '';
        html += `<span class="btt-squad-assign" data-slot="${slot}" style="
          display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;
          cursor:pointer;font-size:11px;border:1px solid ${bdr};color:${clr};
          background:${bg};transition:all 0.1s;user-select:none;
        ">${lbl} (${info.unitCount})${ck}</span>`;
      }

      if (curSquad != null) {
        html += `<span id="btt-squad-clear" style="
          display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;
          cursor:pointer;font-size:11px;border:1px solid #c0392b;color:#e74c3c;
          background:rgba(192,57,43,0.15);transition:all 0.1s;user-select:none;
        ">Clear</span>`;
      }
      if (squads.size < 5) {
        html += `<span id="btt-squad-create" style="
          display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;
          cursor:pointer;font-size:11px;border:1px dashed #4fc3f7;color:#4fc3f7;
          background:rgba(79,195,247,0.05);transition:all 0.1s;user-select:none;
        ">+ New Squad</span>`;
      }
      html += `</div>`;

      if (curSquad != null) {
        const lbl = SQ_LABELS[curSquad] ?? `${curSquad}`;
        const centroid = this.ops.getSquadCentroid(curSquad);
        html += `<div style="font-size:9px;color:#4fc3f7;margin-bottom:2px">Spawned units auto-join Squad ${lbl}</div>`;
        if (centroid) {
          html += `<span id="btt-rally-squad" data-squad="${curSquad}" data-bkey="${buildingHexKey}" data-bkind="${pb.kind}" style="
            display:inline-flex;align-items:center;padding:3px 10px;border-radius:4px;
            cursor:pointer;font-size:10px;border:1px solid #2ecc71;color:#2ecc71;
            background:rgba(46,204,113,0.12);transition:all 0.1s;user-select:none;
            margin-bottom:3px;
          ">Rally to Squad ${lbl} position</span>`;
        }
      }
    }

    // ── Garrison section (G = Garrison, U = Ungarrison) ──
    const structKey = buildingHexKey;
    const garrisonInfo = this.ops.getGarrisonInfo(structKey);
    if (pb.owner === this.ctx.localPlayerIndex) {
      html += DIV();
      const gCount = garrisonInfo?.current ?? 0;
      const gMax = garrisonInfo?.max ?? 10;
      const garrisonColor = gCount > 0 ? '#e67e22' : '#666';
      html += `<div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family}">Garrison: <span style="color:${garrisonColor}">${gCount}/${gMax}</span></div>`;
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
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px">`;
        html += `<span id="btt-ungarrison" style="${B('#e67e22')}">${K('U')} Ungarrison</span>`;
        if (garrisonInfo.reachableExits.length > 0) {
          html += `<span id="btt-exit-pick" style="${B('#8e44ad')}">Exit At...</span>`;
        }
        html += `</div>`;
      }
      html += `<div><span id="btt-garrison" style="${B('#d35400')}">${K('G')} Garrison Sel.</span></div>`;
    }

    // ── Hint footer ──
    html += `<div style="margin-top:6px;font-size:10px;color:#666;text-align:center">Esc to close</div>`;

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position so tooltip doesn't overflow screen
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;

    // ── Wire up click handlers ──
    el.querySelector('#btt-rally')?.addEventListener('click', () => {
      this.hideTooltip();
      this.ops.enterRallyPointMode(pb.kind);
    });
    el.querySelector('#btt-demolish')?.addEventListener('click', () => {
      this.ops.demolishBuilding(pb);
      this.hideTooltip();
    });
    el.querySelectorAll('.btt-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitType = (btn as HTMLElement).dataset.unit as string;
        const buildingKind = (btn as HTMLElement).dataset.building as string;
        this.ops.queueUnit(unitType, buildingKind as BuildingKind);
      });
    });
    el.querySelector('#btt-garrison')?.addEventListener('click', () => {
      this.ops.garrisonSelected(structKey);
      this.hideTooltip();
    });
    el.querySelector('#btt-ungarrison')?.addEventListener('click', () => {
      this.ops.ungarrisonStructure(structKey);
      this.hideTooltip();
    });
    el.querySelector('#btt-exit-pick')?.addEventListener('click', () => {
      this.ops.enterExitPickMode(structKey);
      this.hideTooltip();
    });

    // ── Squad assignment click handlers ──
    el.querySelectorAll('.btt-squad-assign').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt((btn as HTMLElement).dataset.slot!, 10);
        const curAssign = this.ops.getBuildingSquadAssignment(buildingHexKey);
        if (curAssign === slot) {
          // Toggle off — clicking the active squad clears it
          this.ops.assignBuildingToSquad(buildingHexKey, null);
        } else {
          this.ops.assignBuildingToSquad(buildingHexKey, slot);
        }
        this.hideTooltip();
      });
    });
    el.querySelector('#btt-squad-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ops.assignBuildingToSquad(buildingHexKey, null);
      this.hideTooltip();
    });
    el.querySelector('#btt-squad-create')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ops.createSquadForBuilding(buildingHexKey);
      this.hideTooltip();
    });
    el.querySelector('#btt-rally-squad')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLElement;
      const squadSlot = parseInt(btn.dataset.squad!, 10);
      const bKey = btn.dataset.bkey!;
      const bKind = btn.dataset.bkind!;
      this.ops.rallyBuildingToSquad(bKey, bKind, squadSlot);
      this.hideTooltip();
    });

    // ── Keyboard handler: QWERTY for units, F/X/G/U for actions, Esc to close ──
    const qwertyKeys = ['Q', 'W', 'E', 'R', 'T', 'Y'];
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.tooltipEl) return;
      const key = e.key.toUpperCase();

      // QWERTY → queue unit
      const qIdx = qwertyKeys.indexOf(key);
      if (qIdx >= 0 && qIdx < queueBtns.length && pb.owner === this.ctx.localPlayerIndex) {
        e.preventDefault();
        e.stopPropagation();
        this.ops.queueUnit(queueBtns[qIdx].type, pb.kind);
        return;
      }

      // F → Rally
      if (key === 'F') {
        e.preventDefault();
        e.stopPropagation();
        this.hideTooltip();
        this.ops.enterRallyPointMode(pb.kind);
        return;
      }

      // X → Demolish (player only)
      if (key === 'X' && pb.owner === this.ctx.localPlayerIndex) {
        e.preventDefault();
        e.stopPropagation();
        this.ops.demolishBuilding(pb);
        this.hideTooltip();
        return;
      }

      // G → Garrison selected (player only)
      if (key === 'G' && pb.owner === this.ctx.localPlayerIndex) {
        e.preventDefault();
        e.stopPropagation();
        this.ops.garrisonSelected(structKey);
        this.hideTooltip();
        return;
      }

      // U → Ungarrison (player only, if units inside)
      if (key === 'U' && pb.owner === this.ctx.localPlayerIndex && garrisonInfo && garrisonInfo.current > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.ops.ungarrisonStructure(structKey);
        this.hideTooltip();
        return;
      }

      // Esc → close
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hideTooltip();
        return;
      }
    };
    document.addEventListener('keydown', this._keyHandler, true);

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

    const K = BuildingTooltipController.keyBadge;
    const B = BuildingTooltipController.btnStyle;
    const DIV = BuildingTooltipController.divider;

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      ${UI.panel(COLORS.danger, COLORS.panelBgEnemy)}; z-index: 9999; min-width: 200px;
    `;

    const kindLabel = pb.kind.replace('_', ' ');
    const displayKind = kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);
    const isNeutral = pb.owner >= this.ctx.players.length;
    const ownerLabel = isNeutral ? 'Neutral' : `Enemy (AI ${pb.owner})`;
    const ownerColor = isNeutral ? '#d4af37' : '#e74c3c';
    const hpPct = Math.round((pb.health / pb.maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    // Building-specific modifiers
    let modifiers = '';
    if (pb.kind === 'barracks') modifiers = '<div style="color:#aaa;font-size:11px;margin-top:2px">Spawns combat units</div>';
    else if (pb.kind === 'wizard_tower') modifiers = '<div style="color:#9b59b6;font-size:11px;margin-top:2px">Spawns mages &amp; healers</div>';
    else if (pb.kind === 'armory') modifiers = '<div style="color:#71797e;font-size:11px;margin-top:2px">Spawns armored units</div>';
    else if (pb.kind === 'workshop') modifiers = '<div style="color:#8b4513;font-size:11px;margin-top:2px">Crafts siege weapons</div>';
    else if (pb.kind === 'smelter') modifiers = '<div style="color:#b87333;font-size:11px;margin-top:2px">Smelts steel from iron</div>';

    // Garrison count for enemy buildings (show count, not detailed unit types)
    const enemyStructKey = `${pb.position.q},${pb.position.r}`;
    const enemyGarrison = this.ops.getGarrisonInfo(enemyStructKey);
    const garrisonLine = enemyGarrison && enemyGarrison.current > 0
      ? `<div style="font-size:${FONT.sm};color:#e67e22;margin-bottom:4px;font-family:${FONT.family}">Garrisoned: ${enemyGarrison.current} units</div>`
      : '';

    let html = `
      <div style="font-size:${FONT.lg};font-weight:bold;margin-bottom:6px;color:${ownerColor};font-family:${FONT.family}">${displayKind}</div>
      <div style="font-size:${FONT.sm};color:${COLORS.textSecondary};margin-bottom:4px;font-family:${FONT.family}">Owner: <span style="color:${ownerColor}">${ownerLabel}</span></div>
      <div style="font-size:${FONT.sm};color:${COLORS.textSecondary};margin-bottom:4px;font-family:${FONT.family}">HP: <span style="color:${hpColor}">${pb.health}/${pb.maxHealth}</span> (${hpPct}%)</div>
      ${garrisonLine}
      ${modifiers}
      ${DIV()}
      <div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family}">Siege weapons deal full damage to buildings</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <span id="btt-attack" style="${B('#c0392b')}">${K('A')} Attack</span>
        <span id="btt-rally-to" style="${B('#2980b9')}">${K('F')} Rally Here</span>
      </div>
      <div style="margin-top:6px;font-size:10px;color:#666;text-align:center">Esc to close</div>
    `;

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;

    // Wire up buttons
    el.querySelector('#btt-attack')?.addEventListener('click', () => {
      this.ops.attackTarget(pb.position);
      this.hideTooltip();
    });
    el.querySelector('#btt-rally-to')?.addEventListener('click', () => {
      this.ops.setRallyToPosition(pb.position);
      this.hideTooltip();
    });

    // Keyboard shortcuts
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.tooltipEl) return;
      const key = e.key.toUpperCase();
      if (key === 'A') { e.preventDefault(); e.stopPropagation(); this.ops.attackTarget(pb.position); this.hideTooltip(); return; }
      if (key === 'F') { e.preventDefault(); e.stopPropagation(); this.ops.setRallyToPosition(pb.position); this.hideTooltip(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideTooltip(); return; }
    };
    document.addEventListener('keydown', this._keyHandler, true);

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

    const isNeutralBase = base.owner >= this.ctx.players.length;
    const borderColor = isOwn ? getPlayerCSS(this.ctx.localPlayerIndex) : (isNeutralBase ? '#d4af37' : getPlayerCSS(base.owner));
    const bgColor = isOwn ? 'rgba(15,20,30,0.95)' : (isNeutralBase ? 'rgba(30,25,10,0.95)' : 'rgba(30,15,15,0.95)');

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      ${UI.panel(borderColor, bgColor)}; z-index: 9999; min-width: 200px;
    `;

    let nameLabel: string;
    let ownerLabel: string;
    if (isNeutralBase) {
      nameLabel = '🏰 Neutral Citadel';
      ownerLabel = '<span style="color:#d4af37">Neutral (Capturable)</span>';
    } else if (isOwn) {
      nameLabel = '🏰 Your Base';
      ownerLabel = `<span style="color:${getPlayerCSS(this.ctx.localPlayerIndex)}">Player</span>`;
    } else {
      const isEnemyAI = this.ctx.players[base.owner]?.isAI;
      const enemyLabel = isEnemyAI ? `AI ${base.owner}` : 'Enemy';
      nameLabel = `🏰 ${enemyLabel} Base`;
      ownerLabel = `<span style="color:${getPlayerCSS(base.owner)}">${enemyLabel}</span>`;
    }

    const K = BuildingTooltipController.keyBadge;
    const B = BuildingTooltipController.btnStyle;
    const DIV = BuildingTooltipController.divider;

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:${borderColor}">${nameLabel}</div>
      <div style="margin-bottom:4px">Owner: ${ownerLabel}</div>
      <div style="margin-bottom:2px">Capture Zone: <span style="color:#aaa">5-hex radius</span></div>
    `;

    // Zone control info based on base type
    if (isNeutralBase) {
      html += '<div style="color:#d4af37;font-size:11px;margin-top:4px">Hold unit majority to capture this outpost</div>';
    } else if (!isOwn) {
      html += `<div style="color:${getPlayerCSS(base.owner)};font-size:11px;margin-top:4px">Capture to defeat this enemy</div>`;
    } else {
      html += `<div style="color:${getPlayerCSS(this.ctx.localPlayerIndex)};font-size:11px;margin-top:4px">Defend — losing this base means defeat</div>`;
    }

    html += DIV();

    // Action buttons with hotkeys
    if (!isOwn) {
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap">
        <span id="btt-capture" style="${B('#27ae60')}">${K('C')} Capture</span>
        <span id="btt-rally-to" style="${B('#2980b9')}">${K('F')} Rally Here</span>
      </div>`;
    } else {
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap">
        <span id="btt-base-rally" style="${B('#2980b9')}">${K('F')} Set Rally</span>
        <span id="btt-rally-to" style="${B('#2980b9')}">${K('R')} Rally All Here</span>
      </div>`;
    }

    html += `<div style="margin-top:6px;font-size:10px;color:#666;text-align:center">Esc to close</div>`;

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;

    // Wire up buttons
    el.querySelector('#btt-capture')?.addEventListener('click', () => {
      this.ops.captureZone(base.position);
      this.hideTooltip();
    });
    el.querySelector('#btt-base-rally')?.addEventListener('click', () => {
      this.hideTooltip();
      this.ops.enterRallyPointMode('base');
    });
    el.querySelector('#btt-rally-to')?.addEventListener('click', () => {
      this.ops.setRallyToPosition(base.position);
      this.hideTooltip();
    });

    // Keyboard shortcuts
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.tooltipEl) return;
      const key = e.key.toUpperCase();
      if (key === 'C' && !isOwn) { e.preventDefault(); e.stopPropagation(); this.ops.captureZone(base.position); this.hideTooltip(); return; }
      if (key === 'F' && isOwn) { e.preventDefault(); e.stopPropagation(); this.hideTooltip(); this.ops.enterRallyPointMode('base'); return; }
      if (key === 'F' && !isOwn) { e.preventDefault(); e.stopPropagation(); this.ops.setRallyToPosition(base.position); this.hideTooltip(); return; }
      if (key === 'R' && isOwn) { e.preventDefault(); e.stopPropagation(); this.ops.setRallyToPosition(base.position); this.hideTooltip(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideTooltip(); return; }
    };
    document.addEventListener('keydown', this._keyHandler, true);

    // Close on outside click
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Show tooltip for a friendly wall or gate — garrison, exit picker, demolish */
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

    const isOwn = owner === this.ctx.localPlayerIndex;
    const borderColor = isOwn ? '#e67e22' : '#e74c3c';
    const bgColor = isOwn ? 'rgba(20,20,30,0.95)' : 'rgba(30,15,15,0.95)';
    const typeLabel = structureType === 'gate' ? 'Gate' : 'Wall';
    const isGate = structureType === 'gate';

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; left: ${screenX + 12}px; top: ${screenY - 8}px;
      ${UI.panel(borderColor, bgColor)}; z-index: 9999; min-width: 200px; max-width: 320px;
    `;

    const K = BuildingTooltipController.keyBadge;
    const B = BuildingTooltipController.btnStyle;
    const DIV = BuildingTooltipController.divider;

    const ownerLabel = owner === this.ctx.localPlayerIndex ? 'Player' : (this.ctx.players[owner]?.isAI ? `AI ${owner}` : 'Enemy');
    const hpPct = Math.round((health / maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    let html = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px;color:${borderColor}">${typeLabel}</div>
      <div style="margin-bottom:4px">Owner: <span style="color:#3498db">${ownerLabel}</span></div>
      <div style="margin-bottom:4px">HP: <span style="color:${hpColor}">${health}/${maxHealth}</span> (${hpPct}%)</div>
    `;

    // Garrison section — only for gates (walls are connectors, not garrisonable)
    let garrisonInfo: GarrisonInfo | null = null;
    if (isOwn && isGate) {
      garrisonInfo = this.ops.getGarrisonInfo(structureKey);
      const gCount = garrisonInfo?.current ?? 0;
      const gMax = garrisonInfo?.max ?? 5;
      const garrisonColor = gCount > 0 ? '#e67e22' : '#666';
      const netCount = garrisonInfo?.structureCount ?? 1;
      const networkLabel = netCount > 1 ? ` <span style="font-size:10px;color:#8e44ad">(${netCount} structures)</span>` : '';

      html += DIV();
      html += `<div style="font-size:${FONT.xs};color:${COLORS.textMuted};margin-bottom:4px;font-family:${FONT.family}">Garrison: <span style="color:${garrisonColor}">${gCount}/${gMax}</span>${networkLabel}</div>`;

      if (gCount > 0 && garrisonInfo) {
        // --- Unit type pills (toggleable for selective ungarrison) ---
        const typeCounts = new Map<string, number>();
        for (const u of garrisonInfo.units) {
          typeCounts.set(u.type, (typeCounts.get(u.type) ?? 0) + 1);
        }

        html += `<div id="btt-type-pills" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">`;
        for (const [type, count] of typeCounts) {
          html += `<span class="btt-pill" data-type="${type}" style="
            padding:2px 8px;border-radius:12px;font-size:11px;cursor:pointer;
            border:1px solid #4a9eff;background:rgba(74,158,255,0.2);color:#fff;
            user-select:none;transition:all 0.1s ease;
          ">${count}x ${type}</span>`;
        }
        html += `</div>`;
        html += `<div style="font-size:9px;color:#666;margin-bottom:4px">Click types to toggle selection</div>`;

        // --- Ungarrison actions ---
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">`;
        html += `<span id="btt-ungarrison" style="${B('#e67e22')}">${K('U')} Ungarrison Here</span>`;
        html += `</div>`;

        // --- Exit picker: show reachable exits as clickable destinations ---
        if (garrisonInfo.reachableExits.length > 0) {
          html += `<div style="font-size:11px;color:#aaa;margin-bottom:3px">Send to exit:</div>`;
          html += `<div id="btt-exit-list" style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">`;
          for (let i = 0; i < garrisonInfo.reachableExits.length; i++) {
            const exit = garrisonInfo.reachableExits[i];
            html += `<span class="btt-exit-btn" data-exit="${exit.q},${exit.r}" style="
              display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;
              cursor:pointer;font-size:11px;border:1px solid #8e44ad;color:#d5a6f0;
              background:rgba(142,68,173,0.15);transition:all 0.1s;
            ">(${exit.q},${exit.r})</span>`;
          }
          html += `</div>`;
        }
      }

      // Garrison selected button
      html += `<div><span id="btt-garrison" style="${B('#d35400')}">${K('G')} Garrison Sel.</span></div>`;
    } else if (isOwn && !isGate) {
      // Wall — show wall network info instead of garrison
      const garrisonInfoForNetwork = this.ops.getGarrisonInfo(structureKey);
      const exits = garrisonInfoForNetwork?.reachableExits ?? [];
      const wallNetUnits = garrisonInfoForNetwork?.current ?? 0;
      if (exits.length > 0 || wallNetUnits > 0) {
        html += DIV();
        html += `<div style="font-size:10px;color:#888;margin-bottom:2px">Connected to ${exits.length} exit${exits.length > 1 ? 's' : ''} (gates/buildings)</div>`;
        if (wallNetUnits > 0) {
          html += `<div style="font-size:10px;color:#e67e22;margin-bottom:2px">${wallNetUnits} unit${wallNetUnits > 1 ? 's' : ''} garrisoned in network</div>`;
        }
        html += `<div style="font-size:9px;color:#666">Walls are fast-travel connectors — garrison at gates</div>`;
      }
    }

    // --- Actions: Demolish ---
    if (isOwn) {
      html += DIV();
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap">`;
      html += `<span id="btt-demolish-wall" style="${B('#c0392b')}">${K('X')} Demolish</span>`;
      html += `</div>`;
    }

    html += `<div style="margin-top:6px;font-size:10px;color:#666;text-align:center">Esc to close</div>`;

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Clamp position
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;

    // --- Wire up pill toggles ---
    const excludedTypes = new Set<string>();
    const pillContainer = el.querySelector('#btt-type-pills');
    if (pillContainer) {
      pillContainer.querySelectorAll('.btt-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const type = (pill as HTMLElement).dataset.type!;
          const allTypes = Array.from(pillContainer.querySelectorAll('.btt-pill')).map(p => (p as HTMLElement).dataset.type!);
          const activeCount = allTypes.filter(t => !excludedTypes.has(t)).length;

          if (excludedTypes.has(type)) {
            excludedTypes.delete(type);
            (pill as HTMLElement).style.border = '1px solid #4a9eff';
            (pill as HTMLElement).style.background = 'rgba(74,158,255,0.2)';
            (pill as HTMLElement).style.color = '#fff';
            (pill as HTMLElement).style.textDecoration = 'none';
          } else {
            // Don't allow excluding ALL types
            if (activeCount <= 1) return;
            excludedTypes.add(type);
            (pill as HTMLElement).style.border = '1px solid #555';
            (pill as HTMLElement).style.background = 'rgba(80,80,80,0.3)';
            (pill as HTMLElement).style.color = '#666';
            (pill as HTMLElement).style.textDecoration = 'line-through';
          }
        });
      });
    }

    // Helper: get active unit types based on pill state
    const getActiveTypes = (): Set<UnitType> => {
      if (!garrisonInfo) return new Set();
      const allTypes = new Set<UnitType>();
      for (const u of garrisonInfo.units) {
        if (!excludedTypes.has(u.type)) allTypes.add(u.type);
      }
      return allTypes;
    };

    // --- Wire up garrison buttons ---
    if (isGate) {
      el.querySelector('#btt-garrison')?.addEventListener('click', () => {
        this.ops.garrisonSelected(structureKey);
        this.hideTooltip();
      });
      el.querySelector('#btt-ungarrison')?.addEventListener('click', () => {
        if (excludedTypes.size > 0) {
          // Filtered ungarrison — only send active pill types
          this.ops.ungarrisonFiltered(structureKey, getActiveTypes());
        } else {
          this.ops.ungarrisonStructure(structureKey);
        }
        this.hideTooltip();
      });
    }

    // --- Wire up exit destination buttons ---
    el.querySelectorAll('.btt-exit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const exitKey = (btn as HTMLElement).dataset.exit!;
        if (excludedTypes.size > 0) {
          this.ops.ungarrisonFiltered(structureKey, getActiveTypes(), exitKey);
        } else {
          this.ops.ungarrisonStructure(structureKey, exitKey);
        }
        this.hideTooltip();
      });
      // Hover highlight
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.background = 'rgba(142,68,173,0.4)';
        (btn as HTMLElement).style.color = '#fff';
      });
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.background = 'rgba(142,68,173,0.15)';
        (btn as HTMLElement).style.color = '#d5a6f0';
      });
    });

    // --- Wire up demolish button ---
    el.querySelector('#btt-demolish-wall')?.addEventListener('click', () => {
      const [q, r] = structureKey.split(',').map(Number);
      if (isGate) {
        this.ops.demolishGate({ q, r });
      } else {
        this.ops.demolishWall({ q, r });
      }
      this.hideTooltip();
    });

    // Keyboard shortcuts
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.tooltipEl) return;
      const key = e.key.toUpperCase();
      if (key === 'G' && isOwn && isGate) { e.preventDefault(); e.stopPropagation(); this.ops.garrisonSelected(structureKey); this.hideTooltip(); return; }
      if (key === 'U' && isOwn && isGate && garrisonInfo && garrisonInfo.current > 0) {
        e.preventDefault(); e.stopPropagation();
        if (excludedTypes.size > 0) {
          this.ops.ungarrisonFiltered(structureKey, getActiveTypes());
        } else {
          this.ops.ungarrisonStructure(structureKey);
        }
        this.hideTooltip();
        return;
      }
      if (key === 'X' && isOwn) {
        e.preventDefault(); e.stopPropagation();
        const [q, r] = structureKey.split(',').map(Number);
        if (isGate) { this.ops.demolishGate({ q, r }); } else { this.ops.demolishWall({ q, r }); }
        this.hideTooltip();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideTooltip(); return; }
    };
    document.addEventListener('keydown', this._keyHandler, true);

    // Close on outside click
    const closeHandler = (ev: MouseEvent) => {
      if (el.contains(ev.target as Node)) return;
      this.hideTooltip();
      document.removeEventListener('mousedown', closeHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
  }

  /** Show tooltip for any unit (friendly or enemy) — stats, HP, level, kills */
  showUnitTooltip(unit: Unit, screenX: number, screenY: number): void {
    this.hideTooltip();

    const K = BuildingTooltipController.keyBadge;
    const B = BuildingTooltipController.btnStyle;
    const DIV = BuildingTooltipController.divider;

    const isOwn = unit.owner === this.ctx.localPlayerIndex;
    const isEnemy = !isOwn;
    const borderColor = isOwn ? getPlayerCSS(this.ctx.localPlayerIndex) : getPlayerCSS(unit.owner);
    const bgColor = isOwn ? 'rgba(15,20,30,0.95)' : 'rgba(30,15,15,0.95)';

    // Position: bottom-left, snapped to the right edge of the building menu panel
    // Dynamically measure the menu panel so we never overlap it
    const menuPanel = document.querySelector('[style*="bottom"][style*="left: 16px"]') as HTMLElement | null;
    const menuRight = menuPanel ? menuPanel.getBoundingClientRect().right + 4 : 260;
    const menuBottom = menuPanel ? (window.innerHeight - menuPanel.getBoundingClientRect().bottom) : 16;

    const el = document.createElement('div');
    el.id = 'building-tooltip';
    el.style.cssText = `
      position: fixed; bottom: ${menuBottom}px; left: ${menuRight}px;
      ${UI.panel(borderColor, bgColor)}; z-index: 9999; width: 310px; padding: 8px 12px;
    `;
    // Content width inside the tooltip (width minus horizontal padding)
    const pipContentW = 310 - 24; // 12px padding each side

    const typeLabel = unit.type.charAt(0).toUpperCase() + unit.type.slice(1);
    const ownerLabel = isOwn ? 'Player' : (this.ctx.players[unit.owner]?.isAI ? `AI ${unit.owner}` : 'Enemy');
    const hpPct = Math.round((unit.currentHealth / unit.stats.maxHealth) * 100);
    const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    // HP bar
    const hpBarBg = 'rgba(255,255,255,0.1)';
    const hpBarFill = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';

    let html = `
      <div style="position:relative;margin-bottom:4px">
        <canvas id="pip-canvas" style="width:${pipContentW - 2}px;height:140px;border-radius:5px;display:block;
          border:1px solid ${borderColor};background:#111822"></canvas>
        <span id="pip-toggle" style="position:absolute;top:4px;right:4px;padding:2px 6px;border-radius:4px;
          font-size:10px;cursor:pointer;background:rgba(0,0,0,0.7);border:1px solid #555;color:#aaa;
          user-select:none" title="Toggle model / cinematic view">🔬</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:2px">
        <span style="font-size:15px;font-weight:bold;color:${borderColor}">${typeLabel}</span>
        <span style="font-size:11px;color:#888">${ownerLabel}</span>
      </div>
    `;

    // Level + XP (compact)
    if (unit.level > 1) {
      html += `<div style="margin-bottom:3px;font-size:12px">Lv <span style="color:#f1c40f;font-weight:bold">${unit.level}</span> <span style="color:#666">(${unit.experience} XP)</span></div>`;
    }

    // HP bar
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <div style="flex:1;height:7px;background:${hpBarBg};border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${hpPct}%;background:${hpBarFill};border-radius:4px"></div>
      </div>
      <span style="font-size:11px;color:${hpColor}">${unit.currentHealth}/${unit.stats.maxHealth}</span>
    </div>`;

    // Stats + stance
    const stanceLabel = unit.stance.charAt(0).toUpperCase() + unit.stance.slice(1);
    html += `<div style="font-size:12px;color:#ccc;line-height:1.5">
      <span style="color:#e74c3c">${unit.stats.attack}</span> Attack ·
      <span style="color:#3498db">${unit.stats.defense}</span> Defense ·
      <span style="color:#f39c12">${unit.moveSpeed.toFixed(1)}</span> Speed ·
      <span style="color:#9b59b6">${unit.stats.range}</span> Range${unit.kills > 0 ? ` · <span style="color:#e74c3c;font-weight:bold">${unit.kills}</span> Kills` : ''}
      · <span style="color:#888">${stanceLabel}</span>
    </div>`;

    // Carrier info (workers)
    if (unit.carryAmount > 0 && unit.carryType) {
      html += `<div style="font-size:11px;color:#e67e22;margin-top:2px">Carrying: ${unit.carryAmount} ${unit.carryType}</div>`;
    }

    // Status effects
    const STATUS_DISPLAY: Record<string, { icon: string; label: string; color: string }> = {
      wet:            { icon: '💧', label: 'Wet',          color: '#4488ff' },
      ablaze:         { icon: '🔥', label: 'Ablaze',       color: '#ff4422' },
      arcane:         { icon: '🔮', label: 'Arcane',       color: '#aa44ff' },
      high_voltage:   { icon: '⚡', label: 'Shocked',      color: '#44eeff' },
      knockup:        { icon: '🌪️', label: 'Airborne',     color: '#88ffcc' },
      cleanse_linger: { icon: '✨', label: 'Immune',       color: '#ffd700' },
      speed_boost:    { icon: '💨', label: 'Haste',        color: '#ffd700' },
    };
    const activeStatuses = StatusEffectSystem.getActiveStatuses(unit);
    const now = performance.now();
    if (unit._slowUntil && now < unit._slowUntil) activeStatuses.push('slow');
    (STATUS_DISPLAY as any)['slow'] = { icon: '🐌', label: 'Slow', color: '#7f8c8d' };

    if (activeStatuses.length > 0) {
      html += DIV();
      const badges = activeStatuses.map(s => {
        const d = STATUS_DISPLAY[s] || { icon: '●', label: s, color: '#ccc' };
        return `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:3px;
          font-size:11px;font-weight:bold;border:1px solid ${d.color};color:${d.color};
          background:rgba(0,0,0,0.4)">${d.icon} ${d.label}</span>`;
      }).join('');
      html += `<div style="display:flex;flex-wrap:wrap;gap:3px">${badges}</div>`;
    }

    // Action buttons — different for enemy vs friendly units
    if (isEnemy) {
      html += `<div style="margin-top:5px;display:flex;gap:4px">
        <span id="btt-focus-unit" style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:4px;
          cursor:pointer;font-size:11px;color:#eee;background:#c0392b;border:1px solid #555" title="Focus-fire this unit">Focus Fire</span>
        <span id="btt-attackmove-unit" style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:4px;
          cursor:pointer;font-size:11px;color:#eee;background:#e67e22;border:1px solid #555" title="Attack-move to this unit's position">Attack Move</span>
      </div>`;
    } else {
      // Friendly unit controls — stance + kill in one row
      html += `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">`;
      const stanceBtns = [
        { id: 'btt-stance-passive', label: 'Passive', color: '#7f8c8d', stance: 'passive' },
        { id: 'btt-stance-defensive', label: 'Defensive', color: '#3498db', stance: 'defensive' },
        { id: 'btt-stance-aggressive', label: 'Aggressive', color: '#e74c3c', stance: 'aggressive' },
      ];
      for (const sb of stanceBtns) {
        const isActive = unit.stance === sb.stance;
        const bg = isActive ? sb.color : 'rgba(255,255,255,0.05)';
        const border = isActive ? `2px solid ${sb.color}` : '1px solid #555';
        html += `<span id="${sb.id}" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:4px;
          cursor:pointer;font-size:11px;color:#eee;background:${bg};border:${border};${isActive ? 'font-weight:bold;' : ''}">${sb.label}</span>`;
      }
      html += `<span id="btt-kill-unit" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:4px;
        cursor:pointer;font-size:11px;color:#eee;background:#8e44ad;border:1px solid #555;margin-left:auto" title="Kill this unit">Kill</span>`;
      html += `</div>`;
    }

    el.innerHTML = html;
    document.body.appendChild(el);
    this.tooltipEl = el;

    // Start live PIP camera on the canvas element
    const pipCanvas = el.querySelector('#pip-canvas') as HTMLCanvasElement;
    if (pipCanvas) this.startPIP(unit, pipCanvas);

    // Wire PIP mode toggle (model ↔ cinematic)
    el.querySelector('#pip-toggle')?.addEventListener('click', () => {
      if (pipCanvas) this.togglePIPMode(unit, pipCanvas);
      const toggleEl = el.querySelector('#pip-toggle');
      if (toggleEl) toggleEl.textContent = this._pipMode === 'cinematic' ? '🔬' : '🎥';
    });

    // Wire up buttons — enemy actions
    el.querySelector('#btt-focus-unit')?.addEventListener('click', () => {
      this.ops.focusAttackUnit(unit.id, unit.position);
      this.hideTooltip();
    });
    el.querySelector('#btt-attackmove-unit')?.addEventListener('click', () => {
      this.ops.attackTarget(unit.position);
      this.hideTooltip();
    });

    // Wire up buttons — friendly actions
    const setStanceAndClose = (stance: UnitStance) => {
      this.ops.setUnitStance(unit.id, stance);
      this.hideTooltip();
    };
    el.querySelector('#btt-stance-passive')?.addEventListener('click', () => setStanceAndClose(UnitStance.PASSIVE));
    el.querySelector('#btt-stance-defensive')?.addEventListener('click', () => setStanceAndClose(UnitStance.DEFENSIVE));
    el.querySelector('#btt-stance-aggressive')?.addEventListener('click', () => setStanceAndClose(UnitStance.AGGRESSIVE));
    el.querySelector('#btt-kill-unit')?.addEventListener('click', () => {
      this.ops.killUnit(unit.id);
      this.hideTooltip();
    });

    // Keyboard shortcuts
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.tooltipEl) return;
      const key = e.key.toUpperCase();
      // Enemy shortcuts
      if (key === 'A' && isEnemy) { e.preventDefault(); e.stopPropagation(); this.ops.focusAttackUnit(unit.id, unit.position); this.hideTooltip(); return; }
      if (key === 'M' && isEnemy) { e.preventDefault(); e.stopPropagation(); this.ops.attackTarget(unit.position); this.hideTooltip(); return; }
      // Friendly shortcuts
      if (key === 'P' && isOwn) { e.preventDefault(); e.stopPropagation(); setStanceAndClose(UnitStance.PASSIVE); return; }
      if (key === 'D' && isOwn) { e.preventDefault(); e.stopPropagation(); setStanceAndClose(UnitStance.DEFENSIVE); return; }
      if (key === 'G' && isOwn) { e.preventDefault(); e.stopPropagation(); setStanceAndClose(UnitStance.AGGRESSIVE); return; }
      if (key === 'X' && isOwn) { e.preventDefault(); e.stopPropagation(); this.ops.killUnit(unit.id); this.hideTooltip(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideTooltip(); return; }
    };
    document.addEventListener('keydown', this._keyHandler, true);

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
