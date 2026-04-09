// ============================================
// CUBITOPIA - RTS HUD / UI Overlay
// ============================================

import { Unit, Player, Base, Tile, TerrainType, ResourceType, BlockType, UnitStance, UnitType, FormationType, ElementType, ENABLE_UNDERGROUND } from '../types';
import { StatusEffectSystem } from '../game/systems/StatusEffectSystem';
import { StrategyCamera } from '../engine/Camera';
import { GAME_CONFIG } from '../game/GameConfig';
import { getUnitPortrait } from '../engine/UnitPortraits';
import { UI, COLORS, FONT, BORDER, SHADOW, SPACE } from './UITheme';

export class HUD {
  private container: HTMLElement;
  private unitInfoPanel: HTMLElement | null = null;
  private elements: {
    titleBar: HTMLElement;
    resourceBar: HTMLElement;
    enemyResourceBar: HTMLElement;
    selectionInfo: HTMLElement;
    newMapButton: HTMLElement;
  };

  private _onNewMap: (() => void) | null = null;
  private buildModeIndicator: HTMLElement | null = null;
  private helpOverlay: HTMLElement | null = null;
  private helpVisible = false;
  private helpPortraitsLoaded = false;
  private controlPanel: HTMLElement | null = null;

  // Callbacks for control panel buttons (global actions + nested menu)
  private _onBuildWalls: (() => void) | null = null;
  private _onHarvest: (() => void) | null = null;
  private _onSellWood: (() => void) | null = null;
  private _onFarmPatch: (() => void) | null = null;
  private _onMine: (() => void) | null = null;
  private _onHelp: (() => void) | null = null;
  private _onSetStance: ((stance: UnitStance) => void) | null = null;
  private _onSetFormation: ((formation: FormationType) => void) | null = null;
  private _onRespawnUnits: (() => void) | null = null;
  private _onLockElement: ((unitIds: string[], element: ElementType | null) => void) | null = null;
  private selectionCommandPanel: HTMLElement | null = null;

  // Squad type toggle state — tracks the full box-selected group and which types are active
  private _fullSelection: Unit[] = [];           // All units from the original selection
  private _excludedTypes: Set<string> = new Set(); // Unit types toggled OFF
  private _onSelectionFiltered: ((units: Unit[]) => void) | null = null;
  private _isFilterUpdate = false;               // Prevents reset loop when filter triggers onSelect

  /** Register callback for when the user toggles unit types in the selection tooltip */
  onSelectionFiltered(cb: (units: Unit[]) => void): void { this._onSelectionFiltered = cb; }

  onBuildWalls(cb: () => void) { this._onBuildWalls = cb; }
  onHarvest(cb: () => void) { this._onHarvest = cb; }
  onSellWood(cb: () => void) { this._onSellWood = cb; }
  onFarmPatch(cb: () => void) { this._onFarmPatch = cb; }
  onMine(cb: () => void) { this._onMine = cb; }
  onHelp(cb: () => void) { this._onHelp = cb; }

  // Tutorial music callbacks — fired when help overlay opens/closes
  private _onHelpOpen: (() => void) | null = null;
  private _onHelpClose: (() => void) | null = null;
  onHelpOpen(cb: () => void) { this._onHelpOpen = cb; }
  onHelpClose(cb: () => void) { this._onHelpClose = cb; }

  // ── Minimize / Collapse State ─────────────────────────────────
  private _minimized: Record<string, boolean> = {};

  /** Load minimized states from localStorage */
  private loadMinimizedStates(): void {
    try {
      const saved = localStorage.getItem('cubitopia_minimized');
      if (saved) this._minimized = JSON.parse(saved);
      // Army power bar should always start expanded — it's a critical gameplay indicator
      delete this._minimized['armyBar'];
    } catch {}
  }

  /** Persist minimized states to localStorage */
  private saveMinimizedStates(): void {
    try { localStorage.setItem('cubitopia_minimized', JSON.stringify(this._minimized)); } catch {}
  }

  /** Toggle a panel's minimized state and update its DOM */
  private toggleMinimize(key: string, panel: HTMLElement, contentEls: HTMLElement[], btn: HTMLElement): void {
    this._minimized[key] = !this._minimized[key];
    this.saveMinimizedStates();
    const collapsed = this._minimized[key];
    btn.textContent = collapsed ? '+' : '−';
    btn.title = collapsed ? 'Expand' : 'Minimize';
    for (const el of contentEls) {
      el.style.display = collapsed ? 'none' : '';
    }
  }

  /** Create a minimize button and wire it up to a panel.
   *  Returns { btn, header } — caller appends header to panel top. */
  private makeMinimizeHeader(key: string, title: string, panel: HTMLElement, contentEls: HTMLElement[]): { header: HTMLElement; btn: HTMLElement } {
    const header = document.createElement('div');
    header.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:6px; cursor:pointer; user-select:none; pointer-events:auto;`;

    const label = document.createElement('span');
    label.style.cssText = `${UI.sectionHeader()}; margin:0; flex:1;`;
    label.textContent = title;

    const btn = document.createElement('span');
    const collapsed = !!this._minimized[key];
    btn.style.cssText = UI.minimizeBtn();
    btn.textContent = collapsed ? '+' : '−';
    btn.title = collapsed ? 'Expand' : 'Minimize';

    // Apply initial state
    if (collapsed) {
      for (const el of contentEls) el.style.display = 'none';
    }

    const toggle = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggleMinimize(key, panel, contentEls, btn);
    };
    header.addEventListener('click', toggle);

    header.appendChild(label);
    header.appendChild(btn);
    return { header, btn };
  }

  /** Show/hide the entire HUD (used to hide during title screen). */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? '' : 'none';
    if (this.controlPanel) this.controlPanel.style.display = visible ? '' : 'none';
  }

  /** Update formation button highlights without rebuilding the entire panel */
  updateFormationHighlight(formation: FormationType): void {
    if (!this.selectionCommandPanel) return;
    const buttons = this.selectionCommandPanel.querySelectorAll('[data-formation]');
    const formColors: Record<string, string> = {
      [FormationType.LINE]: '#27ae60',
      [FormationType.BOX]: '#8e44ad',
      [FormationType.WEDGE]: '#d35400',
      [FormationType.CIRCLE]: '#2980b9',
    };
    buttons.forEach((btn) => {
      const el = btn as HTMLElement;
      const btnFormation = el.getAttribute('data-formation') as string;
      const isActive = btnFormation === formation;
      const color = formColors[btnFormation] || '#555';
      el.style.background = isActive ? color : 'rgba(60,60,60,0.8)';
      el.style.borderColor = isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
      el.style.boxShadow = isActive ? `0 0 6px ${color}` : 'none';
    });
  }

  /** Update stance button highlights without rebuilding the entire panel */
  updateStanceHighlight(stance: UnitStance): void {
    if (!this.selectionCommandPanel) return;
    const buttons = this.selectionCommandPanel.querySelectorAll('[data-stance]');
    buttons.forEach((btn) => {
      const el = btn as HTMLElement;
      const btnStance = el.getAttribute('data-stance');
      const isActive = btnStance === stance;
      const color = btnStance === UnitStance.PASSIVE ? '#7f8c8d' :
                    btnStance === UnitStance.DEFENSIVE ? '#2980b9' : '#c0392b';
      el.style.background = isActive ? color : 'rgba(60,60,60,0.8)';
      el.style.borderColor = isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
      el.style.boxShadow = isActive ? `0 0 6px ${color}` : 'none';
    });
  }
  onSetStance(cb: (stance: UnitStance) => void) { this._onSetStance = cb; }
  onSetFormation(cb: (formation: FormationType) => void) { this._onSetFormation = cb; }
  onRespawnUnits(cb: () => void) { this._onRespawnUnits = cb; }
  onLockElement(cb: (unitIds: string[], element: ElementType | null) => void) { this._onLockElement = cb; }

  private _onCaptureNearestZone: (() => void) | null = null;
  onCaptureNearestZone(cb: () => void) { this._onCaptureNearestZone = cb; }

  private _onSetSquadObjective: ((objective: 'CAPTURE' | 'ASSAULT' | null) => void) | null = null;
  onSetSquadObjective(cb: (objective: 'CAPTURE' | 'ASSAULT' | null) => void) { this._onSetSquadObjective = cb; }

  /** Public wrapper for showSelectionCommands — allows external refresh after objective change */
  showSelectionCommandsPublic(units: Unit[]): void {
    const hasCombat = units.some(u => HUD.isCombatType(u.type));
    this.showSelectionCommands(hasCombat, units);
  }

  constructor() {
    this.loadMinimizedStates();
    this.container = this.createHUDContainer();
    this.elements = this.createElements();
    this.buildModeIndicator = this.createBuildModeIndicator();
    this.helpOverlay = this.createHelpOverlay();
    this.controlPanel = this.createControlPanel();
    document.body.appendChild(this.container);
    this.setupHelpToggle();

    // Auto-show help on first visit
    if (!localStorage.getItem('cubitopia_seen_help')) {
      setTimeout(() => this.showHelp(), 800);
    }
  }

  /**
   * Refresh theme-dependent inline styles on ALL persistent panels.
   * Call after setSkin() to apply the new skin to every existing element.
   */
  refreshTheme(): void {
    // ── HUD container ──
    this.container.style.fontFamily = FONT.family;
    this.container.style.color = COLORS.textPrimary;

    // ── Resource bars (appended to document.body) ──
    const reBarStyle = `${UI.panel()}; padding: 12px 16px; font-size: ${FONT.lg};`;
    this.elements.resourceBar.style.cssText = `position: fixed; top: 16px; left: 16px; ${reBarStyle} z-index: 10000;`;
    this.elements.enemyResourceBar.style.cssText = `position: fixed; top: 16px; right: 140px; ${reBarStyle} z-index: 10000;`;

    // Resource bar text colors
    const reColorize = (el: HTMLElement | null) => { if (el) el.parentElement!.style.fontFamily = FONT.family; };
    [this.resWoodVal, this.resStoneVal, this.resIronVal, this.resCrystalVal,
     this.resGrassFiberVal, this.resClayVal, this.resCharcoalVal, this.resRopeVal,
     this.resSteelVal, this.resFoodVal, this.resGoldVal, this.resUnitVal].forEach(reColorize);

    // Resource dropdown group buttons
    const groupBtnStyle = `cursor:pointer; padding:3px 8px; border-radius:${BORDER.radius.sm}; transition:background 0.15s; white-space:nowrap; user-select:none; font-family:${FONT.family}; color:${COLORS.textPrimary};`;
    if (this.earthGroupBtn) this.earthGroupBtn.style.cssText = groupBtnStyle;
    if (this.craftedGroupBtn) this.craftedGroupBtn.style.cssText = groupBtnStyle;
    if (this.enemyEarthGroupBtn) this.enemyEarthGroupBtn.style.cssText = groupBtnStyle;
    if (this.enemyCraftedGroupBtn) this.enemyCraftedGroupBtn.style.cssText = groupBtnStyle;

    // Resource dropdown panels
    const ddStyle = `position:absolute; top:100%; left:0; margin-top:6px; ${UI.dropdown()}; min-width:200px; z-index:1000; display:none;`;
    if (this.earthGroupDropdown) this.earthGroupDropdown.style.cssText = ddStyle;
    if (this.craftedGroupDropdown) this.craftedGroupDropdown.style.cssText = ddStyle.replace('200px', '200px');
    if (this.enemyEarthGroupDropdown) this.enemyEarthGroupDropdown.style.cssText = ddStyle;
    if (this.enemyCraftedGroupDropdown) this.enemyCraftedGroupDropdown.style.cssText = ddStyle;
    const ddStyleNarrow = ddStyle.replace('200px', '180px');
    if (this.unitDropdown) this.unitDropdown.style.cssText = ddStyleNarrow;
    if (this.enemyUnitDropdown) this.enemyUnitDropdown.style.cssText = ddStyleNarrow;

    // ── Title bar ──
    this.elements.titleBar.style.cssText = `position: absolute; top: 16px; left: 50%; transform: translateX(-50%); ${UI.panel()}; padding: 8px 24px; font-size: 18px; text-align: center;`;

    // ── Selection info ──
    const selDisplay = this.elements.selectionInfo.style.display;
    this.elements.selectionInfo.style.cssText = `position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); ${UI.panel()}; padding: 12px 24px; font-size: ${FONT.lg}; display: ${selDisplay};`;

    // ── Menu button ──
    this.elements.newMapButton.style.cssText = `position: absolute; top: 16px; right: 16px; ${UI.ctaButton('linear-gradient(135deg, #2980b9, #1a5276)')}; padding: 8px 20px; font-size: ${FONT.lg}; letter-spacing: 2px;`;

    // ── Control panel + all child buttons ──
    if (this.controlPanel) {
      this.controlPanel.style.cssText = `position: absolute; bottom: 16px; left: 16px; ${UI.panel()}; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; z-index: 101; min-width: 220px;`;
      // Re-style all buttons inside the control panel
      this.controlPanel.querySelectorAll('button').forEach(btn => {
        btn.style.fontFamily = FONT.family;
        btn.style.borderRadius = BORDER.radius.md;
      });
      // Re-style all headers
      this.controlPanel.querySelectorAll('div').forEach(div => {
        if (div.style.textTransform === 'uppercase' && div.style.letterSpacing) {
          div.style.fontFamily = FONT.family;
          div.style.color = COLORS.textSecondary;
        }
      });
    }

    // ── Selection command panel ──
    if (this.selectionCommandPanel) {
      this.selectionCommandPanel.style.cssText = `position: fixed; bottom: 16px; right: 16px; ${UI.panel()}; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; z-index: 10000; min-width: 170px;`;
      this.selectionCommandPanel.querySelectorAll('button').forEach(btn => {
        btn.style.fontFamily = FONT.family;
        btn.style.borderRadius = BORDER.radius.sm;
      });
    }

    // ── Mode indicators (all of them) ──
    const modeEls = [
      this.buildModeIndicator, this.barracksModeIndicator, this.forestryModeIndicator,
      this.masonryModeIndicator, this.farmhouseModeIndicator, this.siloModeIndicator,
      this.farmPatchModeIndicator, this.harvestModeIndicator, this.plantTreeModeIndicator,
      this.mineModeIndicator, this.plantCropsModeIndicator, this.rallyPointModeIndicator,
      this.workshopModeIndicator, this.smelterModeIndicator, this.armoryModeIndicator,
      this.wizardTowerModeIndicator,
    ];
    for (const el of modeEls) {
      if (!el) continue;
      // Preserve the border-color (unique per mode) but update panel styling
      const borderColor = el.style.borderColor || el.style.color || COLORS.borderDefault;
      el.style.background = COLORS.panelBg;
      el.style.fontFamily = FONT.family;
      el.style.borderRadius = BORDER.radius.lg;
      el.style.boxShadow = SHADOW.panel;
      el.style.color = borderColor;
    }

    // ── Help overlay ──
    if (this.helpOverlay) {
      this.helpOverlay.style.cssText = `${UI.overlay('rgba(5, 5, 16, 0.94)')}; display: ${this.helpOverlay.style.display}; overflow-y: auto; animation: uiFadeIn 0.25s ease;`;
    }

    // ── Notification element ──
    if (this.notificationEl) {
      const color = this.notificationEl.style.borderColor || '#e74c3c';
      this.notificationEl.style.background = COLORS.panelBg;
      this.notificationEl.style.fontFamily = FONT.family;
      this.notificationEl.style.borderRadius = BORDER.radius.lg;
    }

    // ── Terrain info panel ──
    if (this.terrainInfoPanel) {
      this.terrainInfoPanel.style.cssText = `position: absolute; top: 80px; left: 16px; ${UI.panel()}; padding: 12px 16px; min-width: 180px; pointer-events: none; z-index: 10001; transition: opacity 0.2s;`;
    }

    // ── Unit stats panel ──
    if (this.unitStatsPanel) {
      this.unitStatsPanel.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); ${UI.panel(COLORS.borderHover)}; padding: 16px; min-width: 600px; max-height: 80vh; overflow-y: auto; pointer-events: auto; z-index: 500;`;
    }

    // ── Spawn queue panel ──
    // Dynamic (rebuilt each update) — will pick up new constants automatically

    // ── Capture zone CSS — rebuild the injected stylesheet ──
    if (this._czStyle) {
      document.head.removeChild(this._czStyle);
      this._czStyle = null;
      this.ensureCaptureZoneStyles();
    }

    // ── Army strength bar — destroy so it recreates with new theme ──
    if (this.armyStrengthBar) {
      this.armyStrengthBar.remove();
      this.armyStrengthBar = null;
      this.armyStrengthFill = null;
      this.armyStrengthLabel = null;
      this.armyStrengthContent = null;
    }
  }

  // Nested menu dynamic content area
  private menuContentArea: HTMLElement | null = null;
  private _onMenuAction: ((action: string) => void) | null = null;
  onMenuAction(cb: (action: string) => void) { this._onMenuAction = cb; }

  private createControlPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: absolute; bottom: 16px; left: 16px;
      ${UI.panel()}; padding: 8px 10px;
      display: flex; flex-direction: column; gap: 2px;
      z-index: 101; min-width: 220px;
    `;

    const makeBtn = (label: string, key: string, color: string, cb: () => void): HTMLElement => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: linear-gradient(135deg, ${color}, ${this.darken(color)});
        color: white; border: ${BORDER.thin} solid ${COLORS.borderDefault};
        padding: 5px 8px; font-size: ${FONT.sm}; font-family: ${FONT.family};
        font-weight: bold; border-radius: ${BORDER.radius.md}; cursor: pointer;
        text-transform: uppercase; letter-spacing: 0.5px;
        text-align: left; white-space: nowrap; flex-shrink: 0;
      `;
      btn.innerHTML = `<span style="background:rgba(0,0,0,0.3);padding:1px 3px;border-radius:3px;margin-right:3px;font-size:9px;">${key}</span>${label}`;
      btn.addEventListener('click', cb);
      btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
      btn.addEventListener('mouseleave', () => { btn.style.filter = 'brightness(1)'; });
      return btn;
    };

    const makeHeaderBtn = (label: string): HTMLElement => {
      const header = document.createElement('div');
      header.style.cssText = `
        ${UI.sectionHeader()}; margin-top: 4px; margin-bottom: 2px; padding-left: 4px;
      `;
      header.innerHTML = label;
      return header;
    };

    // Wrap all content in a collapsible container
    const ctrlContent = document.createElement('div');
    ctrlContent.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

    // MENU CATEGORIES — top-level buttons
    ctrlContent.appendChild(makeHeaderBtn('🏗️ MENUS'));
    const menuRow = document.createElement('div');
    menuRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    menuRow.appendChild(makeBtn('Combat', '1', '#c0392b', () => this._onMenuCategory?.(1)));
    menuRow.appendChild(makeBtn('Economy', '2', '#27ae60', () => this._onMenuCategory?.(2)));
    menuRow.appendChild(makeBtn('Crafting', '3', '#f39c12', () => this._onMenuCategory?.(3)));
    ctrlContent.appendChild(menuRow);

    // Dynamic menu content area (populated by updateNestedMenu)
    this.menuContentArea = document.createElement('div');
    this.menuContentArea.id = 'nested-menu-content';
    ctrlContent.appendChild(this.menuContentArea);

    // GLOBAL ACTIONS — always visible
    ctrlContent.appendChild(makeHeaderBtn('🎯 ACTIONS'));
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    actionsRow.appendChild(makeBtn('Walls', 'B', '#2980b9', () => this._onBuildWalls?.()));
    actionsRow.appendChild(makeBtn('Chop', 'H', '#27ae60', () => this._onHarvest?.()));
    actionsRow.appendChild(makeBtn('Mine', 'N', '#ff8c00', () => this._onMine?.()));
    actionsRow.appendChild(makeBtn('Farm', 'J', '#8bc34a', () => this._onFarmPatch?.()));
    actionsRow.appendChild(makeBtn('Sell', 'G', '#f39c12', () => this._onSellWood?.()));
    ctrlContent.appendChild(actionsRow);

    // HELP section
    ctrlContent.appendChild(makeHeaderBtn('❓ HELP'));
    const helpRow = document.createElement('div');
    helpRow.style.cssText = 'display: flex; gap: 3px;';
    helpRow.appendChild(makeBtn('Help', '?', '#7f8c8d', () => this._onHelp?.()));
    ctrlContent.appendChild(helpRow);

    // Minimize header for entire control panel
    const { header: ctrlHeader } = this.makeMinimizeHeader('ctrlPanel', '⚙️ CONTROLS', panel, [ctrlContent]);
    panel.appendChild(ctrlHeader);
    panel.appendChild(ctrlContent);

    this.container.appendChild(panel);
    return panel;
  }

  // Callback for menu category buttons
  private _onMenuCategory: ((cat: number) => void) | null = null;
  onMenuCategory(cb: (cat: number) => void) { this._onMenuCategory = cb; }

  /** Update the nested menu panel to show current category, building, and actions */
  updateNestedMenu(category: 0 | 1 | 2 | 3, buildingIndex: number, categories: {
    name: string;
    buildings: {
      kind: string;
      label: string;
      color: string;
      actions: { key: string; label: string; action: string; }[];
    }[];
  }[]): void {
    if (!this.menuContentArea) return;
    this.menuContentArea.innerHTML = '';

    if (category === 0) return; // No menu open

    const cat = categories[category - 1];
    const building = cat.buildings[buildingIndex];

    // Category header with building selector
    const header = document.createElement('div');
    header.style.cssText = `
      color: #fff; font-size: 11px; font-weight: bold; text-transform: uppercase;
      margin-top: 6px; margin-bottom: 4px; letter-spacing: 1px; padding: 4px 6px;
      background: rgba(255,255,255,0.08); border-radius: ${BORDER.radius.md};
      display: flex; justify-content: space-between; align-items: center;
      font-family: ${FONT.family};
    `;
    header.innerHTML = `
      <span>${cat.name}</span>
      <span style="font-size:9px;color:#888;">Tab to exit · Shift to cycle</span>
    `;
    this.menuContentArea.appendChild(header);

    // Building tabs (shows all buildings in category, highlights active one)
    const tabsRow = document.createElement('div');
    tabsRow.style.cssText = 'display: flex; gap: 3px; margin-bottom: 4px;';
    cat.buildings.forEach((b, i) => {
      const tab = document.createElement('button');
      const isActive = i === buildingIndex;
      tab.style.cssText = `
        background: ${isActive ? `linear-gradient(135deg, ${b.color}, ${this.darken(b.color)})` : 'rgba(40,40,40,0.8)'};
        color: ${isActive ? '#fff' : '#888'}; border: ${BORDER.thin} solid ${isActive ? COLORS.borderHover : COLORS.divider};
        padding: 4px 8px; font-size: ${FONT.sm}; font-family: ${FONT.family};
        font-weight: bold; border-radius: ${BORDER.radius.md}; cursor: pointer;
        text-transform: uppercase; letter-spacing: 0.5px;
        ${isActive ? `box-shadow: 0 0 8px ${b.color}40;` : ''}
      `;
      tab.textContent = b.label;
      tab.addEventListener('click', () => {
        // Clicking a tab switches to that building
        this._onMenuCategory?.(category * 10 + i); // Encode category + index
      });
      tabsRow.appendChild(tab);
    });
    this.menuContentArea.appendChild(tabsRow);

    // Placement hint
    const placeHint = document.createElement('div');
    placeHint.style.cssText = `
      font-size: 10px; color: ${building.color}; padding: 2px 4px; margin-bottom: 3px;
      border-left: 2px solid ${building.color};
    `;
    placeHint.textContent = `Click to place ${building.label} · R to rotate`;
    this.menuContentArea.appendChild(placeHint);

    // Action buttons (QWERTY)
    if (building.actions.length > 0) {
      const actionsLabel = document.createElement('div');
      actionsLabel.style.cssText = 'color: #aaa; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; padding-left: 4px;';
      actionsLabel.textContent = `${building.label} Actions`;
      this.menuContentArea.appendChild(actionsLabel);

      const actionsRow = document.createElement('div');
      actionsRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap; margin-top: 2px;';
      building.actions.forEach(a => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          background: linear-gradient(135deg, ${building.color}cc, ${this.darken(building.color)});
          color: white; border: ${BORDER.thin} solid ${COLORS.borderDefault};
          padding: 4px 7px; font-size: ${FONT.sm}; font-family: ${FONT.family};
          font-weight: bold; border-radius: ${BORDER.radius.sm}; cursor: pointer;
          text-align: left; white-space: nowrap;
        `;
        btn.innerHTML = `<span style="background:rgba(0,0,0,0.4);padding:1px 4px;border-radius:3px;margin-right:3px;font-size:9px;">${a.key}</span>${a.label}`;
        btn.addEventListener('click', () => this._onMenuAction?.(a.action));
        btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
        btn.addEventListener('mouseleave', () => { btn.style.filter = 'brightness(1)'; });
        actionsRow.appendChild(btn);
      });
      this.menuContentArea.appendChild(actionsRow);
    }
  }

  private darken(hex: string): string {
    // Simple darken by subtracting from each channel
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - 40);
    const g = Math.max(0, ((num >> 8) & 0xff) - 40);
    const b = Math.max(0, (num & 0xff) - 40);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }

  private createHUDContainer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'game-hud';
    div.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; font-family: ${FONT.family}; color: white; z-index: 100;
    `;
    return div;
  }

  private createElements() {
    // Title bar (top center)
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      ${UI.panel()}; padding: 8px 24px; font-size: 18px; text-align: center;
    `;
    titleBar.innerHTML = '<strong>CUBITOPIA</strong><br><span style="font-size:12px">RTS Mode</span>';
    this.container.appendChild(titleBar);

    // Resource bar (top left) — appended to document.body to avoid pointer-events:none on HUD container
    const resourceBar = document.createElement('div');
    resourceBar.style.cssText = `
      position: fixed; top: 16px; left: 16px;
      ${UI.panel()}; padding: 12px 16px; font-size: 14px;
      z-index: 10000;
    `;
    // Prevent clicks from propagating to the game canvas
    resourceBar.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    resourceBar.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    resourceBar.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    document.body.appendChild(resourceBar);
    this.buildResourceBarDOM(resourceBar);

    // Enemy resource bar (top right) — shows opponent's resources
    const enemyResourceBar = document.createElement('div');
    enemyResourceBar.style.cssText = `
      position: fixed; top: 16px; right: 140px;
      ${UI.panel()}; padding: 12px 16px; font-size: 14px;
      z-index: 10000;
    `;
    enemyResourceBar.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    enemyResourceBar.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    enemyResourceBar.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    document.body.appendChild(enemyResourceBar);
    this.buildEnemyResourceBarDOM(enemyResourceBar);

    // Selection info (bottom center)
    const selectionInfo = document.createElement('div');
    selectionInfo.style.cssText = `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      ${UI.panel()}; padding: 12px 24px; font-size: 14px; display: none;
    `;
    // Block clicks on selection info from propagating to the canvas (which would clear the selection)
    for (const evt of ['mousedown', 'click', 'dblclick'] as const) {
      selectionInfo.addEventListener(evt, (e) => { e.stopPropagation(); });
    }
    this.container.appendChild(selectionInfo);

    // New Map button (top right)
    const newMapButton = document.createElement('button');
    newMapButton.textContent = '☰ MENU';
    newMapButton.style.cssText = `
      position: absolute; top: 16px; right: 16px;
      ${UI.ctaButton('linear-gradient(135deg, #2980b9, #1a5276)')};
      padding: 8px 20px; font-size: 14px; letter-spacing: 2px;
    `;
    newMapButton.addEventListener('mouseenter', () => {
      newMapButton.style.background = 'linear-gradient(135deg, #1a5276, #154360)';
    });
    newMapButton.addEventListener('mouseleave', () => {
      newMapButton.style.background = 'linear-gradient(135deg, #2980b9, #1a5276)';
    });
    this.container.appendChild(newMapButton);

    return { titleBar, resourceBar, enemyResourceBar, selectionInfo, newMapButton };
  }


  // --- Persistent resource bar DOM refs ---
  // Earth group dropdown
  private earthGroupBtn: HTMLElement | null = null;
  private earthGroupDropdown: HTMLElement | null = null;
  private earthGroupVisible = false;
  private resWoodVal: HTMLElement | null = null;
  private resStoneVal: HTMLElement | null = null;
  private resIronVal: HTMLElement | null = null;
  private resCrystalVal: HTMLElement | null = null;
  private resGrassFiberVal: HTMLElement | null = null;
  private resClayVal: HTMLElement | null = null;

  // Crafted group dropdown
  private craftedGroupBtn: HTMLElement | null = null;
  private craftedGroupDropdown: HTMLElement | null = null;
  private craftedGroupVisible = false;
  private resCharcoalVal: HTMLElement | null = null;
  private resRopeVal: HTMLElement | null = null;
  private resSteelVal: HTMLElement | null = null;

  // Food, Gold, Units (standalone)
  private resFoodVal: HTMLElement | null = null;
  private resGoldVal: HTMLElement | null = null;
  private resUnitVal: HTMLElement | null = null;

  // --- Enemy resource bar DOM refs ---
  private enemyResWoodVal: HTMLElement | null = null;
  private enemyResStoneVal: HTMLElement | null = null;
  private enemyResFoodVal: HTMLElement | null = null;
  private enemyResGoldVal: HTMLElement | null = null;
  private enemyResUnitVal: HTMLElement | null = null;
  private enemyResIronVal: HTMLElement | null = null;
  private enemyResCrystalVal: HTMLElement | null = null;
  private enemyResGrassFiberVal: HTMLElement | null = null;
  private enemyResClayVal: HTMLElement | null = null;
  private enemyResCharcoalVal: HTMLElement | null = null;
  private enemyResRopeVal: HTMLElement | null = null;
  private enemyResSteelVal: HTMLElement | null = null;
  private enemyEarthGroupBtn: HTMLElement | null = null;
  private enemyEarthGroupDropdown: HTMLElement | null = null;
  private enemyEarthGroupVisible = false;
  private enemyCraftedGroupBtn: HTMLElement | null = null;
  private enemyCraftedGroupDropdown: HTMLElement | null = null;
  private enemyCraftedGroupVisible = false;
  private enemyUnitDropdown: HTMLElement | null = null;
  private enemyUnitDropdownVisible = false;
  private enemyUnitDropdownContent: HTMLElement | null = null;
  private _lastEnemyUnits: Unit[] = [];
  private unitDropdown: HTMLElement | null = null;
  private unitDropdownVisible = false;
  private unitDropdownContent: HTMLElement | null = null;
  private _lastPlayerUnits: Unit[] = [];

  private static readonly UNIT_EMOJI: Record<string, string> = {
    [UnitType.WARRIOR]: '🗡️',
    [UnitType.ARCHER]: '🏹',
    [UnitType.RIDER]: '🐎',
    [UnitType.PALADIN]: '🛡️',
    [UnitType.SCOUT]: '👁️',
    [UnitType.MAGE]: '🔮',
    [UnitType.HEALER]: '💚',
    [UnitType.ASSASSIN]: '🗡️',
    [UnitType.SHIELDBEARER]: '🛡️',
    [UnitType.BERSERKER]: '🪓',
    [UnitType.BATTLEMAGE]: '⚡',
    [UnitType.GREATSWORD]: '⚔️',
    [UnitType.BUILDER]: '🔨',
    [UnitType.LUMBERJACK]: '🪓',
    [UnitType.VILLAGER]: '👤',
    [UnitType.TREBUCHET]: '🏗️',
    [UnitType.OGRE]: '👹',
  };
  private static readonly UNIT_COLOR: Record<string, string> = {
    [UnitType.WARRIOR]: '#e74c3c',
    [UnitType.ARCHER]: '#e67e22',
    [UnitType.RIDER]: '#f1c40f',
    [UnitType.PALADIN]: '#3498db',
    [UnitType.TREBUCHET]: '#795548',
    [UnitType.OGRE]: '#4e342e',
    [UnitType.SCOUT]: '#1abc9c',
    [UnitType.MAGE]: '#8e44ad',
    [UnitType.BUILDER]: '#95a5a6',
    [UnitType.LUMBERJACK]: '#27ae60',
    [UnitType.VILLAGER]: '#bdc3c7',
  };
  private static readonly UNIT_NAMES: Record<string, string> = {
    [UnitType.WARRIOR]: 'Warrior', [UnitType.ARCHER]: 'Archer', [UnitType.RIDER]: 'Rider',
    [UnitType.PALADIN]: 'Paladin', [UnitType.TREBUCHET]: 'Trebuchet',
    [UnitType.SCOUT]: 'Scout', [UnitType.MAGE]: 'Mage', [UnitType.HEALER]: 'Healer',
    [UnitType.ASSASSIN]: 'Assassin', [UnitType.SHIELDBEARER]: 'Shieldbearer',
    [UnitType.BERSERKER]: 'Berserker', [UnitType.BATTLEMAGE]: 'Battlemage',
    [UnitType.GREATSWORD]: 'Greatsword', [UnitType.OGRE]: 'Ogre', [UnitType.BUILDER]: 'Builder',
    [UnitType.LUMBERJACK]: 'Lumberjack', [UnitType.VILLAGER]: 'Villager',
  };
  private static readonly COMBAT_TYPES = [
    UnitType.WARRIOR, UnitType.ARCHER, UnitType.RIDER, UnitType.PALADIN,
    UnitType.TREBUCHET, UnitType.SCOUT, UnitType.MAGE,
    UnitType.HEALER, UnitType.ASSASSIN, UnitType.SHIELDBEARER,
    UnitType.BERSERKER, UnitType.BATTLEMAGE, UnitType.GREATSWORD, UnitType.OGRE,
  ];
  private static readonly WORKER_TYPES = [UnitType.BUILDER, UnitType.LUMBERJACK, UnitType.VILLAGER];

  /** Check if a unit type is a combat unit (not a worker) */
  private static isCombatType(t: UnitType): boolean {
    return t !== UnitType.BUILDER && t !== UnitType.LUMBERJACK && t !== UnitType.VILLAGER;
  }

  // Minimize refs for resource bars
  private resBarContent: HTMLElement | null = null;
  private enemyResBarContent: HTMLElement | null = null;

  /** Build the resource bar DOM once so event listeners survive updates */
  private buildResourceBarDOM(bar: HTMLElement): void {
    bar.innerHTML = '';

    // Minimize header
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    this.resBarContent = row;
    const { header } = this.makeMinimizeHeader('resBar', '📦 RESOURCES', bar, [row]);
    bar.appendChild(header);

    const mkRes = (emoji: string, color: string): { wrapper: HTMLElement; val: HTMLElement } => {
      const w = document.createElement('span');
      w.style.cssText = 'white-space:nowrap;';
      const v = document.createElement('span');
      v.style.cssText = `color:${color};font-weight:bold;`;
      w.textContent = emoji + ' ';
      w.appendChild(v);
      return { wrapper: w, val: v };
    };

    // ===== MATERIALS GROUP (dropdown) =====
    const earthContainer = document.createElement('span');
    earthContainer.style.cssText = 'position:relative; display:inline-block;';
    this.earthGroupBtn = document.createElement('span');
    this.earthGroupBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.earthGroupBtn.textContent = '🪨 Materials ▾';
    earthContainer.appendChild(this.earthGroupBtn);

    const earthDropdown = document.createElement('div');
    earthDropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      ${UI.dropdown()}; min-width:200px; z-index:1000; display:none;
    `;
    this.earthGroupDropdown = earthDropdown;

    // Materials resources inside dropdown
    const earthContent = document.createElement('div');
    earthContent.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const wood = mkRes('🪵', '#f0c040');
    this.resWoodVal = wood.val;
    earthContent.appendChild(wood.wrapper);

    const stone = mkRes('🪨', '#aaa');
    this.resStoneVal = stone.val;
    earthContent.appendChild(stone.wrapper);

    const iron = mkRes('⛏️', '#b0a0a0');
    this.resIronVal = iron.val;
    earthContent.appendChild(iron.wrapper);

    const crystal = mkRes('💎', '#6ba3e0');
    this.resCrystalVal = crystal.val;
    earthContent.appendChild(crystal.wrapper);

    const grassFiber = mkRes('🌿', '#66bb6a');
    this.resGrassFiberVal = grassFiber.val;
    earthContent.appendChild(grassFiber.wrapper);

    const clay = mkRes('🧱', '#bf8040');
    this.resClayVal = clay.val;
    earthContent.appendChild(clay.wrapper);

    earthDropdown.appendChild(earthContent);
    earthContainer.appendChild(earthDropdown);
    row.appendChild(earthContainer);
    row.appendChild(this.makeDot());

    // ===== CRAFTED GROUP (dropdown) =====
    const craftedContainer = document.createElement('span');
    craftedContainer.style.cssText = 'position:relative; display:inline-block;';
    this.craftedGroupBtn = document.createElement('span');
    this.craftedGroupBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.craftedGroupBtn.textContent = '⚒️ Crafted ▾';
    craftedContainer.appendChild(this.craftedGroupBtn);

    const craftedDropdown = document.createElement('div');
    craftedDropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      ${UI.dropdown()}; min-width:200px; z-index:1000; display:none;
    `;
    this.craftedGroupDropdown = craftedDropdown;

    // Crafted resources inside dropdown
    const craftedContent = document.createElement('div');
    craftedContent.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const charcoal = mkRes('🔥', '#ff8c00');
    this.resCharcoalVal = charcoal.val;
    craftedContent.appendChild(charcoal.wrapper);

    const rope = mkRes('🪢', '#c9a96e');
    this.resRopeVal = rope.val;
    craftedContent.appendChild(rope.wrapper);

    const steel = mkRes('⚔️', '#c0c0c0');
    this.resSteelVal = steel.val;
    craftedContent.appendChild(steel.wrapper);

    craftedDropdown.appendChild(craftedContent);
    craftedContainer.appendChild(craftedDropdown);
    row.appendChild(craftedContainer);
    row.appendChild(this.makeDot());

    // ===== FOOD (standalone) =====
    const food = mkRes('🌾', '#8bc34a');
    this.resFoodVal = food.val;
    row.appendChild(food.wrapper);
    row.appendChild(this.makeDot());

    // ===== GOLD (standalone) =====
    const gold = mkRes('💰', '#f0c040');
    this.resGoldVal = gold.val;
    row.appendChild(gold.wrapper);
    row.appendChild(this.makeDot());

    // ===== UNITS (standalone with dropdown) =====
    const unitContainer = document.createElement('span');
    unitContainer.style.cssText = 'position:relative; display:inline-block;';
    const unitBtn = document.createElement('span');
    unitBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    const unitValSpan = document.createElement('span');
    unitValSpan.style.fontWeight = 'bold';
    unitBtn.textContent = '⚔️ ';
    unitBtn.appendChild(unitValSpan);
    const arrow = document.createTextNode(' units ▾');
    unitBtn.appendChild(arrow);
    this.resUnitVal = unitValSpan;
    unitContainer.appendChild(unitBtn);

    // --- Unit dropdown panel (hidden by default) ---
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      \${UI.dropdown()}; min-width:180px; z-index:1000; display:none;
    `;
    this.unitDropdownContent = document.createElement('div');
    dropdown.appendChild(this.unitDropdownContent);
    unitContainer.appendChild(dropdown);
    this.unitDropdown = dropdown;
    row.appendChild(unitContainer);

    bar.appendChild(row);

    // ===== EVENT LISTENERS =====
    // Earth group toggle
    this.earthGroupBtn.addEventListener('mouseenter', () => {
      this.earthGroupBtn!.style.background = 'rgba(255,255,255,0.1)';
    });
    this.earthGroupBtn.addEventListener('mouseleave', () => {
      if (!this.earthGroupVisible) this.earthGroupBtn!.style.background = 'none';
    });

    const toggleEarthGroup = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.earthGroupVisible) {
        this.earthGroupDropdown!.style.display = 'none';
        this.earthGroupVisible = false;
        this.earthGroupBtn!.style.background = 'none';
      } else {
        this.earthGroupDropdown!.style.display = 'block';
        this.earthGroupVisible = true;
        this.earthGroupBtn!.style.background = 'rgba(255,255,255,0.15)';
      }
    };

    this.earthGroupBtn.addEventListener('click', toggleEarthGroup);
    this.earthGroupBtn.addEventListener('contextmenu', toggleEarthGroup);
    earthDropdown.addEventListener('click', (e) => e.stopPropagation());

    // Crafted group toggle
    this.craftedGroupBtn.addEventListener('mouseenter', () => {
      this.craftedGroupBtn!.style.background = 'rgba(255,255,255,0.1)';
    });
    this.craftedGroupBtn.addEventListener('mouseleave', () => {
      if (!this.craftedGroupVisible) this.craftedGroupBtn!.style.background = 'none';
    });

    const toggleCraftedGroup = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.craftedGroupVisible) {
        this.craftedGroupDropdown!.style.display = 'none';
        this.craftedGroupVisible = false;
        this.craftedGroupBtn!.style.background = 'none';
      } else {
        this.craftedGroupDropdown!.style.display = 'block';
        this.craftedGroupVisible = true;
        this.craftedGroupBtn!.style.background = 'rgba(255,255,255,0.15)';
      }
    };

    this.craftedGroupBtn.addEventListener('click', toggleCraftedGroup);
    this.craftedGroupBtn.addEventListener('contextmenu', toggleCraftedGroup);
    craftedDropdown.addEventListener('click', (e) => e.stopPropagation());

    // Unit dropdown toggle
    unitBtn.addEventListener('mouseenter', () => {
      unitBtn.style.background = 'rgba(255,255,255,0.1)';
    });
    unitBtn.addEventListener('mouseleave', () => {
      if (!this.unitDropdownVisible) unitBtn.style.background = 'none';
    });

    const toggleUnitDropdown = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.unitDropdownVisible) {
        this.hideUnitDropdown();
        unitBtn.style.background = 'none';
      } else {
        this.refreshDropdownContent();
        dropdown.style.display = 'block';
        this.unitDropdownVisible = true;
        unitBtn.style.background = 'rgba(255,255,255,0.15)';
      }
    };

    unitBtn.addEventListener('click', toggleUnitDropdown);
    unitBtn.addEventListener('contextmenu', toggleUnitDropdown);

    // Prevent clicks inside dropdowns from bubbling
    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  private makeDot(): HTMLElement {
    const dot = document.createElement('span');
    dot.style.cssText = 'color:#555;';
    dot.textContent = '·';
    return dot;
  }

  /** Build the enemy resource bar DOM — mirrors player bar with all resource groups */
  private buildEnemyResourceBarDOM(bar: HTMLElement): void {
    bar.innerHTML = '';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    this.enemyResBarContent = row;
    const { header } = this.makeMinimizeHeader('enemyResBar', '🔴 ENEMY', bar, [row]);
    bar.appendChild(header);

    const mkRes = (emoji: string, color: string): { wrapper: HTMLElement; val: HTMLElement } => {
      const w = document.createElement('span');
      w.style.cssText = 'white-space:nowrap;';
      const v = document.createElement('span');
      v.style.cssText = `color:${color};font-weight:bold;`;
      w.textContent = emoji + ' ';
      w.appendChild(v);
      return { wrapper: w, val: v };
    };

    // Red enemy label
    const label = document.createElement('span');
    label.style.cssText = 'color:#ff6b6b;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;padding-right:2px;';
    label.textContent = '🔴 Enemy';
    row.appendChild(label);
    row.appendChild(this.makeDot());

    // ===== MATERIALS GROUP (dropdown) =====
    const earthContainer = document.createElement('span');
    earthContainer.style.cssText = 'position:relative; display:inline-block;';
    this.enemyEarthGroupBtn = document.createElement('span');
    this.enemyEarthGroupBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.enemyEarthGroupBtn.textContent = '🪨 Materials ▾';
    earthContainer.appendChild(this.enemyEarthGroupBtn);

    const earthDropdown = document.createElement('div');
    earthDropdown.style.cssText = `
      position:absolute; top:100%; right:0; margin-top:6px;
      ${UI.dropdown()}; min-width:200px; z-index:1000; display:none;
    `;
    this.enemyEarthGroupDropdown = earthDropdown;

    const earthContent = document.createElement('div');
    earthContent.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const wood = mkRes('🪵', '#f0c040');
    this.enemyResWoodVal = wood.val;
    earthContent.appendChild(wood.wrapper);

    const stone = mkRes('🪨', '#aaa');
    this.enemyResStoneVal = stone.val;
    earthContent.appendChild(stone.wrapper);

    const iron = mkRes('⛏️', '#b0a0a0');
    this.enemyResIronVal = iron.val;
    earthContent.appendChild(iron.wrapper);

    const crystal = mkRes('💎', '#6ba3e0');
    this.enemyResCrystalVal = crystal.val;
    earthContent.appendChild(crystal.wrapper);

    const grassFiber = mkRes('🌿', '#66bb6a');
    this.enemyResGrassFiberVal = grassFiber.val;
    earthContent.appendChild(grassFiber.wrapper);

    const clay = mkRes('🧱', '#bf8040');
    this.enemyResClayVal = clay.val;
    earthContent.appendChild(clay.wrapper);

    earthDropdown.appendChild(earthContent);
    earthContainer.appendChild(earthDropdown);
    row.appendChild(earthContainer);
    row.appendChild(this.makeDot());

    // ===== CRAFTED GROUP (dropdown) =====
    const craftedContainer = document.createElement('span');
    craftedContainer.style.cssText = 'position:relative; display:inline-block;';
    this.enemyCraftedGroupBtn = document.createElement('span');
    this.enemyCraftedGroupBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.enemyCraftedGroupBtn.textContent = '⚒️ Crafted ▾';
    craftedContainer.appendChild(this.enemyCraftedGroupBtn);

    const craftedDropdown = document.createElement('div');
    craftedDropdown.style.cssText = `
      position:absolute; top:100%; right:0; margin-top:6px;
      ${UI.dropdown()}; min-width:200px; z-index:1000; display:none;
    `;
    this.enemyCraftedGroupDropdown = craftedDropdown;

    const craftedContent = document.createElement('div');
    craftedContent.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const charcoal = mkRes('🔥', '#ff8c00');
    this.enemyResCharcoalVal = charcoal.val;
    craftedContent.appendChild(charcoal.wrapper);

    const rope = mkRes('🪢', '#c9a96e');
    this.enemyResRopeVal = rope.val;
    craftedContent.appendChild(rope.wrapper);

    const steel = mkRes('⚔️', '#c0c0c0');
    this.enemyResSteelVal = steel.val;
    craftedContent.appendChild(steel.wrapper);

    craftedDropdown.appendChild(craftedContent);
    craftedContainer.appendChild(craftedDropdown);
    row.appendChild(craftedContainer);
    row.appendChild(this.makeDot());

    // ===== FOOD (standalone) =====
    const food = mkRes('🌾', '#8bc34a');
    this.enemyResFoodVal = food.val;
    row.appendChild(food.wrapper);
    row.appendChild(this.makeDot());

    // ===== GOLD (standalone) =====
    const gold = mkRes('💰', '#f0c040');
    this.enemyResGoldVal = gold.val;
    row.appendChild(gold.wrapper);
    row.appendChild(this.makeDot());

    // ===== UNITS (standalone with dropdown) =====
    const unitContainer = document.createElement('span');
    unitContainer.style.cssText = 'position:relative; display:inline-block;';
    const unitBtn = document.createElement('span');
    unitBtn.style.cssText = `
      cursor:pointer; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    const unitValSpan = document.createElement('span');
    unitValSpan.style.fontWeight = 'bold';
    unitBtn.textContent = '⚔️ ';
    unitBtn.appendChild(unitValSpan);
    const arrow = document.createTextNode(' units ▾');
    unitBtn.appendChild(arrow);
    this.enemyResUnitVal = unitValSpan;
    unitContainer.appendChild(unitBtn);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute; top:100%; right:0; margin-top:6px;
      \${UI.dropdown()}; min-width:180px; z-index:1000; display:none;
    `;
    this.enemyUnitDropdownContent = document.createElement('div');
    dropdown.appendChild(this.enemyUnitDropdownContent);
    unitContainer.appendChild(dropdown);
    this.enemyUnitDropdown = dropdown;
    row.appendChild(unitContainer);

    bar.appendChild(row);

    // ===== EVENT LISTENERS (independent toggles) =====
    this.enemyEarthGroupBtn.addEventListener('mouseenter', () => { this.enemyEarthGroupBtn!.style.background = 'rgba(255,255,255,0.1)'; });
    this.enemyEarthGroupBtn.addEventListener('mouseleave', () => { if (!this.enemyEarthGroupVisible) this.enemyEarthGroupBtn!.style.background = 'none'; });
    const toggleEnemyEarth = (e: Event) => { e.stopPropagation(); e.preventDefault(); if (this.enemyEarthGroupVisible) { this.enemyEarthGroupDropdown!.style.display = 'none'; this.enemyEarthGroupVisible = false; this.enemyEarthGroupBtn!.style.background = 'none'; } else { this.enemyEarthGroupDropdown!.style.display = 'block'; this.enemyEarthGroupVisible = true; this.enemyEarthGroupBtn!.style.background = 'rgba(255,255,255,0.15)'; } };
    this.enemyEarthGroupBtn.addEventListener('click', toggleEnemyEarth);
    this.enemyEarthGroupBtn.addEventListener('contextmenu', toggleEnemyEarth);
    earthDropdown.addEventListener('click', (e) => e.stopPropagation());

    this.enemyCraftedGroupBtn.addEventListener('mouseenter', () => { this.enemyCraftedGroupBtn!.style.background = 'rgba(255,255,255,0.1)'; });
    this.enemyCraftedGroupBtn.addEventListener('mouseleave', () => { if (!this.enemyCraftedGroupVisible) this.enemyCraftedGroupBtn!.style.background = 'none'; });
    const toggleEnemyCrafted = (e: Event) => { e.stopPropagation(); e.preventDefault(); if (this.enemyCraftedGroupVisible) { this.enemyCraftedGroupDropdown!.style.display = 'none'; this.enemyCraftedGroupVisible = false; this.enemyCraftedGroupBtn!.style.background = 'none'; } else { this.enemyCraftedGroupDropdown!.style.display = 'block'; this.enemyCraftedGroupVisible = true; this.enemyCraftedGroupBtn!.style.background = 'rgba(255,255,255,0.15)'; } };
    this.enemyCraftedGroupBtn.addEventListener('click', toggleEnemyCrafted);
    this.enemyCraftedGroupBtn.addEventListener('contextmenu', toggleEnemyCrafted);
    craftedDropdown.addEventListener('click', (e) => e.stopPropagation());

    unitBtn.addEventListener('mouseenter', () => { unitBtn.style.background = 'rgba(255,255,255,0.1)'; });
    unitBtn.addEventListener('mouseleave', () => { if (!this.enemyUnitDropdownVisible) unitBtn.style.background = 'none'; });
    const toggleEnemyUnits = (e: Event) => { e.stopPropagation(); e.preventDefault(); if (this.enemyUnitDropdownVisible) { this.enemyUnitDropdown!.style.display = 'none'; this.enemyUnitDropdownVisible = false; unitBtn.style.background = 'none'; } else { this.refreshEnemyDropdownContent(); this.enemyUnitDropdown!.style.display = 'block'; this.enemyUnitDropdownVisible = true; unitBtn.style.background = 'rgba(255,255,255,0.15)'; } };
    unitBtn.addEventListener('click', toggleEnemyUnits);
    unitBtn.addEventListener('contextmenu', toggleEnemyUnits);
    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  private refreshEnemyDropdownContent(): void {
    if (!this.enemyUnitDropdownContent) return;
    const units = this._lastEnemyUnits;
    const unitCounts = new Map<UnitType, number>();
    for (const unit of units) {
      unitCounts.set(unit.type, (unitCounts.get(unit.type) || 0) + 1);
    }
    const sortByCount = (types: UnitType[]) =>
      types.filter(t => (unitCounts.get(t) || 0) > 0)
           .sort((a, b) => (unitCounts.get(b) || 0) - (unitCounts.get(a) || 0));

    const activeCombat = sortByCount(HUD.COMBAT_TYPES);
    const activeWorkers = sortByCount(HUD.WORKER_TYPES);
    let html = '';
    if (activeCombat.length > 0) {
      html += '<div style="color:#ff8a80;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Combat</div>';
      for (const t of activeCombat) {
        const emoji = HUD.UNIT_EMOJI[t] || '?';
        const color = HUD.UNIT_COLOR[t] || '#ccc';
        const name = HUD.UNIT_NAMES[t] || t;
        html += `<div style="display:flex;justify-content:space-between;gap:12px;padding:1px 0;"><span>${emoji} ${name}</span><span style="color:${color};font-weight:bold;">${unitCounts.get(t)}</span></div>`;
      }
    }
    if (activeWorkers.length > 0) {
      if (activeCombat.length > 0) html += '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:6px 0;"></div>';
      html += '<div style="color:#81c784;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Workers</div>';
      for (const t of activeWorkers) {
        const emoji = HUD.UNIT_EMOJI[t] || '?';
        const color = HUD.UNIT_COLOR[t] || '#ccc';
        const name = HUD.UNIT_NAMES[t] || t;
        html += `<div style="display:flex;justify-content:space-between;gap:12px;padding:1px 0;"><span>${emoji} ${name}</span><span style="color:${color};font-weight:bold;">${unitCounts.get(t)}</span></div>`;
      }
    }
    if (html === '') html = '<div style="color:#777;">No units</div>';
    this.enemyUnitDropdownContent.innerHTML = html;
  }

  updateEnemyResources(player: Player, stockpiles: {
    wood: number; food: number; stone: number; iron: number;
    crystal: number; grassFiber: number; clay: number;
    charcoal: number; rope: number; steel: number; gold: number;
  }): void {
    if (this.enemyResWoodVal) this.enemyResWoodVal.textContent = `${stockpiles.wood}`;
    if (this.enemyResStoneVal) this.enemyResStoneVal.textContent = `${stockpiles.stone}`;
    if (this.enemyResFoodVal) this.enemyResFoodVal.textContent = `${stockpiles.food}`;
    if (this.enemyResGoldVal) this.enemyResGoldVal.textContent = `${stockpiles.gold}`;
    if (this.enemyResIronVal) this.enemyResIronVal.textContent = `${stockpiles.iron}`;
    if (this.enemyResCrystalVal) this.enemyResCrystalVal.textContent = `${stockpiles.crystal}`;
    if (this.enemyResGrassFiberVal) this.enemyResGrassFiberVal.textContent = `${stockpiles.grassFiber}`;
    if (this.enemyResClayVal) this.enemyResClayVal.textContent = `${stockpiles.clay}`;
    if (this.enemyResCharcoalVal) this.enemyResCharcoalVal.textContent = `${stockpiles.charcoal}`;
    if (this.enemyResRopeVal) this.enemyResRopeVal.textContent = `${stockpiles.rope}`;
    if (this.enemyResSteelVal) this.enemyResSteelVal.textContent = `${stockpiles.steel}`;
    if (this.enemyResUnitVal) this.enemyResUnitVal.textContent = `${player.units.length}`;
    this._lastEnemyUnits = player.units;
  }

  /** FFA mode: compact multi-enemy resource display showing all opponents */
  private _ffaEnemyRows: Map<number, {
    woodVal: HTMLElement; foodVal: HTMLElement; goldVal: HTMLElement; unitVal: HTMLElement;
    stoneVal: HTMLElement; ironVal: HTMLElement; crystalVal: HTMLElement;
  }> = new Map();
  private _ffaBuilt = false;

  updateFfaEnemyResources(enemies: {
    playerId: number; name: string; color: string; units: Unit[];
    stockpiles: { wood: number; food: number; stone: number; iron: number; crystal: number; gold: number };
    defeated: boolean;
  }[]): void {
    const bar = this.elements.enemyResourceBar;
    if (!bar) return;

    // Build the FFA layout once, then just update values
    if (!this._ffaBuilt || this._ffaEnemyRows.size !== enemies.length) {
      bar.innerHTML = '';
      this._ffaEnemyRows.clear();

      const header = document.createElement('div');
      header.style.cssText = `font-size:${FONT.xs};color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-family:${FONT.family};`;
      header.textContent = '⚔️ OPPONENTS';
      bar.appendChild(header);

      for (const enemy of enemies) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 0;${enemy.defeated ? 'opacity:0.4;' : ''}`;

        // Color dot + name
        const dot = document.createElement('span');
        dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${enemy.color};flex-shrink:0;`;
        row.appendChild(dot);

        const name = document.createElement('span');
        name.style.cssText = `color:${enemy.color};font-weight:bold;font-size:${FONT.sm};min-width:42px;`;
        name.textContent = enemy.defeated ? `${enemy.name} ☠️` : enemy.name;
        row.appendChild(name);

        const mkVal = (emoji: string, color: string): HTMLElement => {
          const w = document.createElement('span');
          w.style.cssText = `white-space:nowrap;font-size:${FONT.sm};`;
          w.textContent = emoji + ' ';
          const v = document.createElement('span');
          v.style.cssText = `color:${color};font-weight:bold;`;
          w.appendChild(v);
          row.appendChild(w);
          return v;
        };

        const woodVal = mkVal('🪵', '#f0c040');
        const stoneVal = mkVal('🪨', '#aaa');
        const ironVal = mkVal('⛏️', '#b0a0a0');
        const crystalVal = mkVal('💎', '#6ba3e0');
        const foodVal = mkVal('🌾', '#8bc34a');
        const goldVal = mkVal('💰', '#f0c040');
        const unitVal = mkVal('⚔️', '#ff8a80');

        bar.appendChild(row);
        this._ffaEnemyRows.set(enemy.playerId, { woodVal, foodVal, goldVal, unitVal, stoneVal, ironVal, crystalVal });
      }
      this._ffaBuilt = true;
    }

    // Update values
    for (const enemy of enemies) {
      const refs = this._ffaEnemyRows.get(enemy.playerId);
      if (!refs) continue;
      refs.woodVal.textContent = `${enemy.stockpiles.wood}`;
      refs.stoneVal.textContent = `${enemy.stockpiles.stone}`;
      refs.ironVal.textContent = `${enemy.stockpiles.iron}`;
      refs.crystalVal.textContent = `${enemy.stockpiles.crystal}`;
      refs.foodVal.textContent = `${enemy.stockpiles.food}`;
      refs.goldVal.textContent = `${enemy.stockpiles.gold}`;
      refs.unitVal.textContent = `${enemy.units.length}`;
    }
  }

  /** Reset FFA enemy bar state (call on new game) — also rebuilds the normal 2-player enemy bar DOM */
  resetFfaEnemyBar(): void {
    this._ffaBuilt = false;
    this._ffaEnemyRows.clear();
    // Rebuild the standard enemy resource bar DOM so refs are valid for 2-player mode
    this.buildEnemyResourceBarDOM(this.elements.enemyResourceBar);
  }

  // === Army Strength Indicator ===
  private armyStrengthBar: HTMLElement | null = null;
  private armyStrengthFill: HTMLElement | null = null;
  private armyStrengthLabel: HTMLElement | null = null;
  private _lastStrengthUpdate = 0;

  // N-player team colors — expandable to any number of players
  static readonly TEAM_COLORS: string[] = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#e67e22'];
  static readonly TEAM_NAMES: string[] = ['Blue', 'Red', 'Green', 'Gold', 'Purple', 'Orange'];

  private armyStrengthContent: HTMLElement | null = null;

  /** Create the army strength comparison bar — shows relative military power for N players */
  private createArmyStrengthBar(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:absolute; top:86px; left:50%; transform:translateX(-50%);
      width:280px; z-index:100; pointer-events:auto;
      font-family:${FONT.family};
    `;

    this.armyStrengthLabel = document.createElement('div');
    this.armyStrengthLabel.style.cssText = `
      ${UI.sectionHeader(COLORS.textMuted)}; text-align:center; margin-bottom:3px;
      letter-spacing:1.5px;
    `;
    this.armyStrengthLabel.textContent = 'ARMY POWER';

    // Segmented bar container
    this.armyStrengthFill = document.createElement('div');
    this.armyStrengthFill.style.cssText = `
      ${UI.barWrap('8px')}; display:flex; overflow:hidden;
      border: ${BORDER.thin} solid rgba(255,255,255,0.08);
    `;

    // Content wrapper for minimize
    this.armyStrengthContent = document.createElement('div');
    this.armyStrengthContent.appendChild(this.armyStrengthFill);

    const { header } = this.makeMinimizeHeader('armyBar', 'ARMY POWER', wrap, [this.armyStrengthContent]);
    wrap.appendChild(header);
    wrap.appendChild(this.armyStrengthContent);

    this.armyStrengthBar = wrap;
    return wrap;
  }

  /** Update the army strength comparison — supports N players */
  updateArmyStrength(playerUnits: Unit[], enemyUnits: Unit[], allPlayers?: { units: Unit[]; color?: string }[]): void {
    const now = performance.now();
    if (now - this._lastStrengthUpdate < 500) return; // throttle to 2Hz
    this._lastStrengthUpdate = now;

    if (!this.armyStrengthBar) {
      this.container.appendChild(this.createArmyStrengthBar());
    }

    const power = (units: Unit[]) => {
      let total = 0;
      for (const u of units) {
        if (u.state === 'dead' || !HUD.isCombatType(u.type)) continue;
        total += u.currentHealth * (u.stats.attack + u.stats.defense);
      }
      return total;
    };

    // Build player power array — use allPlayers if provided, else fall back to 2-player
    const teams: { power: number; color: string }[] = [];
    if (allPlayers && allPlayers.length > 2) {
      for (let i = 0; i < allPlayers.length; i++) {
        teams.push({ power: power(allPlayers[i].units), color: allPlayers[i].color || HUD.TEAM_COLORS[i] || '#888' });
      }
    } else {
      teams.push({ power: power(playerUnits), color: HUD.TEAM_COLORS[0] });
      teams.push({ power: power(enemyUnits), color: HUD.TEAM_COLORS[1] });
    }

    const totalPower = teams.reduce((s, t) => s + t.power, 0);

    if (!this.armyStrengthFill) return;

    if (totalPower === 0) {
      // Equal empty — show even segments
      const evenPct = Math.round(100 / teams.length);
      this.armyStrengthFill.innerHTML = teams.map((t, i) =>
        `<div style="height:100%; width:${i === teams.length - 1 ? 100 - evenPct * i : evenPct}%; background:${t.color}40; transition:width 0.5s ease-out;"></div>`
      ).join('');
      if (this.armyStrengthLabel) {
        this.armyStrengthLabel.textContent = 'ARMY POWER';
        this.armyStrengthLabel.style.color = COLORS.textMuted;
      }
      return;
    }

    // Build segmented bar
    this.armyStrengthFill.innerHTML = teams.map(t => {
      const pct = Math.max(1, Math.round((t.power / totalPower) * 100));
      return `<div style="height:100%; width:${pct}%; background:${t.color}; transition:width 0.5s ease-out;"></div>`;
    }).join('');

    // Label: for 2-player show advantage/disadvantage, for N-player show leader
    if (this.armyStrengthLabel) {
      if (teams.length === 2) {
        const playerPct = Math.round((teams[0].power / totalPower) * 100);
        if (playerPct > 65) {
          this.armyStrengthLabel.textContent = 'ARMY ADVANTAGE';
          this.armyStrengthLabel.style.color = COLORS.success;
        } else if (playerPct < 35) {
          this.armyStrengthLabel.textContent = 'ARMY DISADVANTAGE';
          this.armyStrengthLabel.style.color = COLORS.danger;
        } else {
          this.armyStrengthLabel.textContent = 'ARMY POWER';
          this.armyStrengthLabel.style.color = COLORS.textMuted;
        }
      } else {
        // N-player: show which team leads
        const maxIdx = teams.reduce((best, t, i) => t.power > teams[best].power ? i : best, 0);
        const leaderPct = Math.round((teams[maxIdx].power / totalPower) * 100);
        this.armyStrengthLabel.textContent = `${HUD.TEAM_NAMES[maxIdx] || 'P' + maxIdx} LEADS (${leaderPct}%)`;
        this.armyStrengthLabel.style.color = teams[maxIdx].color;
      }
    }
  }

  private hideUnitDropdown(): void {
    if (this.unitDropdown) this.unitDropdown.style.display = 'none';
    this.unitDropdownVisible = false;
  }

  private refreshDropdownContent(): void {
    if (!this.unitDropdownContent) return;
    const units = this._lastPlayerUnits;

    const unitCounts = new Map<UnitType, number>();
    for (const unit of units) {
      unitCounts.set(unit.type, (unitCounts.get(unit.type) || 0) + 1);
    }

    const sortByCount = (types: UnitType[]) =>
      types.filter(t => (unitCounts.get(t) || 0) > 0)
           .sort((a, b) => (unitCounts.get(b) || 0) - (unitCounts.get(a) || 0));

    const activeCombat = sortByCount(HUD.COMBAT_TYPES);
    const activeWorkers = sortByCount(HUD.WORKER_TYPES);

    let html = '';

    const renderSection = (label: string, types: UnitType[]) => {
      html += `<div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid rgba(255,255,255,0.08);">${label}</div>`;
      for (const t of types) {
        const count = unitCounts.get(t) || 0;
        const name = t.charAt(0).toUpperCase() + t.slice(1);
        const color = HUD.UNIT_COLOR[t] || '#ccc';
        const emoji = HUD.UNIT_EMOJI[t] || '';
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px;color:${color};">
          <span>${emoji} ${name}</span>
          <span style="font-weight:bold;font-size:14px;margin-left:20px;">${count}</span>
        </div>`;
      }
    };

    if (activeCombat.length > 0) renderSection('Combat', activeCombat);
    if (activeCombat.length > 0 && activeWorkers.length > 0) html += `<div style="height:6px;"></div>`;
    if (activeWorkers.length > 0) renderSection('Workers', activeWorkers);

    if (activeCombat.length === 0 && activeWorkers.length === 0) {
      html = `<div style="color:#666;font-style:italic;padding:4px 0;">No units</div>`;
    }

    html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.15);display:flex;justify-content:space-between;font-weight:bold;font-size:14px;">
      <span>Total</span><span>${units.length}</span>
    </div>`;

    this.unitDropdownContent.innerHTML = html;
  }

  updateResources(player: Player, woodStockpile?: number, foodStockpile?: number, stoneStockpile?: number, popInfo?: { current: number; cap: number }): void {
    const wood = woodStockpile ?? player.resources.wood;
    const food = foodStockpile ?? player.resources.food;
    const stone = stoneStockpile ?? 0;

    // Update persistent DOM values (no innerHTML replacement, listeners survive)
    // Earth group
    if (this.resWoodVal) this.resWoodVal.textContent = `${wood} wood`;
    if (this.resStoneVal) this.resStoneVal.textContent = `${stone} stone`;
    if (this.resIronVal) this.resIronVal.textContent = `${player.resources.iron} iron`;
    if (this.resCrystalVal) this.resCrystalVal.textContent = `${player.resources.crystal} crystal`;
    if (this.resGrassFiberVal) this.resGrassFiberVal.textContent = `${player.resources.grass_fiber} fiber`;
    if (this.resClayVal) this.resClayVal.textContent = `${player.resources.clay} clay`;

    // Crafted group
    if (this.resCharcoalVal) this.resCharcoalVal.textContent = `${player.resources.charcoal} charcoal`;
    if (this.resRopeVal) this.resRopeVal.textContent = `${player.resources.rope} rope`;
    if (this.resSteelVal) this.resSteelVal.textContent = `${player.resources.steel} steel`;

    // Standalone resources — food with cap context
    if (this.resFoodVal) {
      if (popInfo) {
        this.resFoodVal.textContent = `${food} food`;
        // Add food→cap hint next to food value
        const foodParent = this.resFoodVal.parentElement;
        if (foodParent) {
          let foodCapHint = foodParent.querySelector('.food-cap-hint') as HTMLElement;
          if (!foodCapHint) {
            foodCapHint = document.createElement('span');
            foodCapHint.className = 'food-cap-hint';
            foodCapHint.style.cssText = 'font-size:10px;opacity:0.6;margin-left:2px;';
            foodParent.appendChild(foodCapHint);
          }
          foodCapHint.textContent = `(cap ${popInfo.cap})`;
          // Pulse color when near cap
          const capColor = popInfo.current >= popInfo.cap ? '#e74c3c'
            : popInfo.current >= popInfo.cap * 0.8 ? '#e67e22' : '#8bc34a';
          foodCapHint.style.color = capColor;
        }
      } else {
        this.resFoodVal.textContent = `${food} food`;
      }
    }
    if (this.resGoldVal) this.resGoldVal.textContent = `${player.resources.gold} gold`;
    // Unit count with pop cap indicator
    if (this.resUnitVal) {
      if (popInfo) {
        const color = popInfo.current >= popInfo.cap ? '#e74c3c' : popInfo.current >= popInfo.cap * 0.8 ? '#e67e22' : '';
        this.resUnitVal.textContent = `${player.units.length}`;
        this.resUnitVal.style.color = color;
        // Update the parent to show pop cap
        const parent = this.resUnitVal.parentElement;
        if (parent) {
          // Find or create the pop cap indicator
          let capSpan = parent.querySelector('.pop-cap-indicator') as HTMLElement;
          if (!capSpan) {
            capSpan = document.createElement('span');
            capSpan.className = 'pop-cap-indicator';
            capSpan.style.cssText = 'font-size:10px;opacity:0.7;margin-left:2px;';
            parent.insertBefore(capSpan, parent.querySelector('.unit-arrow'));
          }
          capSpan.textContent = ` (⚔${popInfo.current}/${popInfo.cap})`;
          capSpan.style.color = color;
        }
      } else {
        this.resUnitVal.textContent = `${player.units.length}`;
      }
    }

    // Cache units for dropdown refresh
    this._lastPlayerUnits = player.units;

    // Live-update dropdown content if it's open
    if (this.unitDropdownVisible) {
      this.refreshDropdownContent();
    }
  }

  private barracksModeIndicator: HTMLElement | null = null;
  private forestryModeIndicator: HTMLElement | null = null;
  private masonryModeIndicator: HTMLElement | null = null;
  private spawnQueueDisplay: HTMLElement | null = null;  // legacy — kept for cleanup
  private forestrySpawnQueueDisplay: HTMLElement | null = null;  // legacy
  private masonrySpawnQueueDisplay: HTMLElement | null = null;  // legacy
  private unifiedQueuePanel: HTMLElement | null = null;
  private _queueContent: HTMLElement | null = null;

  setBarracksMode(active: boolean): void {
    if (!this.barracksModeIndicator) {
      this.barracksModeIndicator = document.createElement('div');
      this.barracksModeIndicator.style.cssText = `
        ${UI.modeIndicator('#e67e22')};
      `;
      this.barracksModeIndicator.innerHTML = `🏗️ BARRACKS PLACEMENT — Click to place barracks (costs ${GAME_CONFIG.buildings.barracks.cost.player.wood} wood) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.barracksModeIndicator);
    }
    this.barracksModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('barracks');
  }

  setForestryMode(active: boolean): void {
    if (!this.forestryModeIndicator) {
      this.forestryModeIndicator = document.createElement('div');
      this.forestryModeIndicator.style.cssText = `
        ${UI.modeIndicator('#6b8e23')};
      `;
      this.forestryModeIndicator.innerHTML = `🌳 FORESTRY PLACEMENT — Click to place forestry (costs ${GAME_CONFIG.buildings.forestry.cost.player.wood} wood) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.forestryModeIndicator);
    }
    this.forestryModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('forestry');
  }

  setMasonryMode(active: boolean): void {
    if (!this.masonryModeIndicator) {
      this.masonryModeIndicator = document.createElement('div');
      this.masonryModeIndicator.style.cssText = `
        ${UI.modeIndicator('#808080')};
      `;
      this.masonryModeIndicator.innerHTML = `⬜ MASONRY PLACEMENT — Click to place masonry (costs ${GAME_CONFIG.buildings.masonry.cost.player.wood} wood) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.masonryModeIndicator);
    }
    this.masonryModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('masonry');
  }

  private farmhouseModeIndicator: HTMLElement | null = null;
  private siloModeIndicator: HTMLElement | null = null;
  private farmPatchModeIndicator: HTMLElement | null = null;
  private harvestModeIndicator: HTMLElement | null = null;

  setFarmhouseMode(active: boolean): void {
    if (!this.farmhouseModeIndicator) {
      this.farmhouseModeIndicator = document.createElement('div');
      this.farmhouseModeIndicator.style.cssText = `
        ${UI.modeIndicator('#daa520')};
      `;
      this.farmhouseModeIndicator.innerHTML = `🏠 FARMHOUSE PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.farmhouse.cost.player.wood} wood) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.farmhouseModeIndicator);
    }
    this.farmhouseModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('farmhouse');
  }

  setSiloMode(active: boolean): void {
    if (!this.siloModeIndicator) {
      this.siloModeIndicator = document.createElement('div');
      this.siloModeIndicator.style.cssText = `
        ${UI.modeIndicator('#c0c0c0')};
      `;
      this.siloModeIndicator.innerHTML = `🏗️ SILO PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.silo.cost.player.wood} wood) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.siloModeIndicator);
    }
    this.siloModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('silo');
  }

  setFarmPatchMode(active: boolean): void {
    if (!this.farmPatchModeIndicator) {
      this.farmPatchModeIndicator = document.createElement('div');
      this.farmPatchModeIndicator.style.cssText = `
        ${UI.modeIndicator('#8b6914')};
      `;
      this.farmPatchModeIndicator.innerHTML = '🌾 HARVEST — Click plains for farms, tall grass for hay (villagers) · [Tab] to close';
      this.container.appendChild(this.farmPatchModeIndicator);
    }
    this.farmPatchModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('farmPatch');
  }

  private plantTreeModeIndicator: HTMLElement | null = null;
  setPlantTreeMode(active: boolean): void {
    if (!this.plantTreeModeIndicator) {
      this.plantTreeModeIndicator = document.createElement('div');
      this.plantTreeModeIndicator.style.cssText = `
        ${UI.modeIndicator('#228B22')};
      `;
      this.plantTreeModeIndicator.innerHTML = `🌱 PLANT TREES — Click & drag on plains to plant saplings (${GAME_CONFIG.economy.harvest.tree.plantCost.wood} wood each) · [Tab] to close`;
      this.container.appendChild(this.plantTreeModeIndicator);
    }
    this.plantTreeModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('plantTree');
  }

  private mineModeIndicator: HTMLElement | null = null;

  setMineMode(active: boolean, depthLayers?: number, horizontalY?: number): void {
    if (!this.mineModeIndicator) {
      this.mineModeIndicator = document.createElement('div');
      this.mineModeIndicator.style.cssText = `
        ${UI.modeIndicator('#ff8c00')};
      `;
      this.container.appendChild(this.mineModeIndicator);
    }
    const depth = depthLayers ?? 3;
    const sliceInfo = horizontalY !== undefined
      ? ` · <span style="color:#00ccff">Slice Y: <span style="font-size:20px">${horizontalY}</span></span> · Paint = ${depth}-deep tunnel`
      : '';
    this.mineModeIndicator.innerHTML = `MINE MODE — Depth: <span style="color:#fff;font-size:20px">${depth}</span> · Scroll depth · Shift+scroll slicer${sliceInfo} · [Tab] close`;
    this.mineModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('mine');
  }

  private plantCropsModeIndicator: HTMLElement | null = null;
  private rallyPointModeIndicator: HTMLElement | null = null;

  setPlantCropsMode(active: boolean): void {
    if (!this.plantCropsModeIndicator) {
      this.plantCropsModeIndicator = document.createElement('div');
      this.plantCropsModeIndicator.style.cssText = `
        ${UI.modeIndicator('#228B22')};
      `;
      this.plantCropsModeIndicator.innerHTML = '🌱 PLANT CROPS — Click cleared plains to plant farm crops · [Tab] to close';
      this.container.appendChild(this.plantCropsModeIndicator);
    }
    this.plantCropsModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('plantCrops');
  }

  private workshopModeIndicator: HTMLElement | null = null;
  private workshopSpawnQueueDisplay: HTMLElement | null = null;

  setWorkshopMode(active: boolean): void {
    if (!this.workshopModeIndicator) {
      this.workshopModeIndicator = document.createElement('div');
      this.workshopModeIndicator.style.cssText = `
        ${UI.modeIndicator('#5d4037')}; color: #c9a96e;
      `;
      this.workshopModeIndicator.innerHTML = `🔧 WORKSHOP PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.workshop.cost.player.wood} wood + ${GAME_CONFIG.buildings.workshop.cost.player.stone} stone) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.workshopModeIndicator);
    }
    this.workshopModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('workshop');
  }

  private smelterModeIndicator: HTMLElement | null = null;
  private armoryModeIndicator: HTMLElement | null = null;
  private wizardTowerModeIndicator: HTMLElement | null = null;

  setSmelterMode(active: boolean): void {
    if (!this.smelterModeIndicator) {
      this.smelterModeIndicator = document.createElement('div');
      this.smelterModeIndicator.style.cssText = `
        ${UI.modeIndicator('#8b4513')}; color: #d4956a;
      `;
      this.smelterModeIndicator.innerHTML = `🔥 SMELTER PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.smelter.cost.player.wood} wood + ${GAME_CONFIG.buildings.smelter.cost.player.stone} stone) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.smelterModeIndicator);
    }
    this.smelterModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('smelter');
  }

  setArmoryMode(active: boolean): void {
    if (!this.armoryModeIndicator) {
      this.armoryModeIndicator = document.createElement('div');
      this.armoryModeIndicator.style.cssText = `
        ${UI.modeIndicator('#708090')}; color: #a0b0c0;
      `;
      this.armoryModeIndicator.innerHTML = `⚔️ ARMORY PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.armory.cost.player.wood} wood + ${GAME_CONFIG.buildings.armory.cost.player.stone} stone + ${GAME_CONFIG.buildings.armory.cost.player.steel} steel) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.armoryModeIndicator);
    }
    this.armoryModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('armory');
  }

  setWizard_towerMode(active: boolean): void {
    if (!this.wizardTowerModeIndicator) {
      this.wizardTowerModeIndicator = document.createElement('div');
      this.wizardTowerModeIndicator.style.cssText = `
        ${UI.modeIndicator('#6a0dad')}; color: #b388ff;
      `;
      this.wizardTowerModeIndicator.innerHTML = `🔮 WIZARD TOWER PLACEMENT — Click to place (costs ${GAME_CONFIG.buildings.wizard_tower.cost.player.wood} wood + ${GAME_CONFIG.buildings.wizard_tower.cost.player.stone} stone + ${GAME_CONFIG.buildings.wizard_tower.cost.player.crystal} crystal) · [R] Rotate · [Tab] to close`;
      this.container.appendChild(this.wizardTowerModeIndicator);
    }
    this.wizardTowerModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('wizard_tower');
  }

  /** @deprecated Use updateAllSpawnQueues instead */
  updateWorkshopSpawnQueue(_queue: { type: string; cost: { wood: number; stone: number; rope: number } }[]): void {}

  // ---- Unified stacking queue display ----

  /** Queue entry for unified display — supports player-categorized grouping */
  updateAllSpawnQueues(queues: {
    kind: string;
    color: string;
    owner?: number; // player index (0 = you, 1+ = opponents/AI)
    items: { type: string }[];
    timerProgress: number; // 0..1 (fraction of spawn time elapsed for current unit)
  }[]): void {
    if (!this.unifiedQueuePanel) {
      this.unifiedQueuePanel = document.createElement('div');
      this.unifiedQueuePanel.style.cssText = `
        position: absolute; bottom: 80px; right: 180px;
        display: flex; flex-direction: column; gap: 6px;
        pointer-events: auto; z-index: 50;
        max-height: 60vh; overflow-y: auto;
      `;
      // Collapsible content
      this._queueContent = document.createElement('div');
      this._queueContent.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
      const { header: qHeader } = this.makeMinimizeHeader('spawnQueue', '🏗️ SPAWN QUEUE', this.unifiedQueuePanel, [this._queueContent]);
      this.unifiedQueuePanel.appendChild(qHeader);
      this.unifiedQueuePanel.appendChild(this._queueContent);
      this.container.appendChild(this.unifiedQueuePanel);
    }

    // Hide legacy displays
    if (this.spawnQueueDisplay) this.spawnQueueDisplay.style.display = 'none';
    if (this.forestrySpawnQueueDisplay) this.forestrySpawnQueueDisplay.style.display = 'none';
    if (this.masonrySpawnQueueDisplay) this.masonrySpawnQueueDisplay.style.display = 'none';
    if (this.workshopSpawnQueueDisplay) this.workshopSpawnQueueDisplay.style.display = 'none';

    // Filter to only queues with items
    const active = queues.filter(q => q.items.length > 0);
    if (active.length === 0) {
      this.unifiedQueuePanel.style.display = 'none';
      return;
    }
    this.unifiedQueuePanel.style.display = 'flex';

    // Group queues by owner for player-categorized display
    const byOwner = new Map<number, typeof active>();
    for (const q of active) {
      const ownerId = q.owner ?? 0;
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId)!.push(q);
    }

    // Sort owners: player 0 first, then others
    const sortedOwners = [...byOwner.keys()].sort((a, b) => a - b);

    let html = '';
    for (const ownerId of sortedOwners) {
      const ownerQueues = byOwner.get(ownerId)!;
      const teamColor = HUD.TEAM_COLORS[ownerId] || '#888';
      const teamName = ownerId === 0 ? 'YOUR SPAWNS' : `${(HUD.TEAM_NAMES[ownerId] || 'P' + ownerId).toUpperCase()} SPAWNS`;

      // Player section header (only show if multiple owners)
      if (sortedOwners.length > 1) {
        html += `<div style="
          font-size:${FONT.xs}; color:${teamColor}; text-transform:uppercase;
          letter-spacing:2px; font-weight:bold; font-family:${FONT.family};
          padding:2px 4px; margin-top:${ownerId === sortedOwners[0] ? '0' : '4px'};
          border-left:3px solid ${teamColor};
        ">${teamName}</div>`;
      }

      for (const q of ownerQueues) {
        const borderColor = q.color;
        const bgColor = q.color + '18';
        html += `<div style="
          background:${COLORS.panelBg}; border:${BORDER.thin} solid ${borderColor};
          border-radius:${BORDER.radius.md}; padding:6px 10px; min-width:140px;
          font-family:${FONT.family}; box-shadow:${SHADOW.panel};
        ">`;
        html += `<div style="font-size:${FONT.sm}; color:${borderColor}; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; font-weight:bold;">${q.kind}</div>`;

        for (let i = 0; i < q.items.length; i++) {
          const item = q.items[i];
          const isFirst = i === 0;
          const progress = isFirst ? q.timerProgress : 0;
          const barWidth = Math.round(progress * 100);

          html += `<div style="
            display:flex; align-items:center; gap:6px; margin-bottom:${i < q.items.length - 1 ? '3' : '0'}px;
            background:${bgColor}; border-radius:${BORDER.radius.sm}; padding:3px 6px; position:relative; overflow:hidden;
          ">`;

          if (isFirst) {
            html += `<div style="
              position:absolute; left:0; top:0; bottom:0; width:${barWidth}%;
              background:${borderColor}30; border-radius:${BORDER.radius.sm}; transition:width 0.15s linear;
            "></div>`;
          }

          html += `<span style="font-size:11px; color:${COLORS.textPrimary}; position:relative; z-index:1; flex:1;">${item.type}</span>`;

          if (isFirst) {
            html += `<div style="
              width:4px; height:16px; background:rgba(255,255,255,0.1); border-radius:2px;
              position:relative; z-index:1; overflow:hidden;
            "><div style="
              position:absolute; bottom:0; left:0; right:0; height:${barWidth}%;
              background:${borderColor}; border-radius:2px; transition:height 0.15s linear;
            "></div></div>`;
          }

          html += `</div>`;
        }
        html += `</div>`;
      }
    }

    if (this._queueContent) {
      this._queueContent.innerHTML = html;
    } else {
      this.unifiedQueuePanel.innerHTML = html;
    }
  }

  setRallyPointMode(active: boolean, buildingKey?: string): void {
    if (!this.rallyPointModeIndicator) {
      this.rallyPointModeIndicator = document.createElement('div');
      this.rallyPointModeIndicator.style.cssText = `
        ${UI.modeIndicator('#f0c040')};
      `;
      this.container.appendChild(this.rallyPointModeIndicator);
    }
    if (buildingKey) {
      this.rallyPointModeIndicator.innerHTML = `🚩 SET ${buildingKey.toUpperCase()} RALLY POINT — Click a tile to set the rally destination · [ESC] cancel`;
    } else {
      this.rallyPointModeIndicator.innerHTML = '🚩 SET RALLY POINT — Click a tile to set the rally destination · [ESC] cancel';
    }
    this.rallyPointModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('rallyPoint');
  }

  private hideAllModeIndicators(except?: string): void {
    if (except !== 'build' && this.buildModeIndicator) this.buildModeIndicator.style.display = 'none';
    if (except !== 'harvest' && this.harvestModeIndicator) this.harvestModeIndicator.style.display = 'none';
    if (except !== 'barracks' && this.barracksModeIndicator) this.barracksModeIndicator.style.display = 'none';
    if (except !== 'forestry' && this.forestryModeIndicator) this.forestryModeIndicator.style.display = 'none';
    if (except !== 'masonry' && this.masonryModeIndicator) this.masonryModeIndicator.style.display = 'none';
    if (except !== 'farmhouse' && this.farmhouseModeIndicator) this.farmhouseModeIndicator.style.display = 'none';
    if (except !== 'silo' && this.siloModeIndicator) this.siloModeIndicator.style.display = 'none';
    if (except !== 'farmPatch' && this.farmPatchModeIndicator) this.farmPatchModeIndicator.style.display = 'none';
    if (except !== 'plantTree' && this.plantTreeModeIndicator) this.plantTreeModeIndicator.style.display = 'none';
    if (except !== 'mine' && this.mineModeIndicator) this.mineModeIndicator.style.display = 'none';
    if (except !== 'plantCrops' && this.plantCropsModeIndicator) this.plantCropsModeIndicator.style.display = 'none';
    if (except !== 'rallyPoint' && this.rallyPointModeIndicator) this.rallyPointModeIndicator.style.display = 'none';
    if (except !== 'workshop' && this.workshopModeIndicator) this.workshopModeIndicator.style.display = 'none';
    if (except !== 'smelter' && this.smelterModeIndicator) this.smelterModeIndicator.style.display = 'none';
    if (except !== 'armory' && this.armoryModeIndicator) this.armoryModeIndicator.style.display = 'none';
    if (except !== 'wizard_tower' && this.wizardTowerModeIndicator) this.wizardTowerModeIndicator.style.display = 'none';
  }

  /** @deprecated Use updateAllSpawnQueues instead */
  updateSpawnQueue(_queue: { type: string; cost: number }[]): void {}

  /** @deprecated Use updateAllSpawnQueues instead */
  updateForestrySpawnQueue(_queue: { type: string; cost: number }[]): void {}

  /** @deprecated Use updateAllSpawnQueues instead */
  updateMasonrySpawnQueue(_queue: { type: string; cost: number }[]): void {}

  // === Capture Zone HUD ===
  private captureZoneContainer: HTMLElement | null = null;
  private _czCardsWrap: HTMLElement | null = null;
  private _czStyle: HTMLStyleElement | null = null;

  /** Inject capture-zone CSS animations once */
  private ensureCaptureZoneStyles(): void {
    if (this._czStyle) return;
    this._czStyle = document.createElement('style');
    this._czStyle.textContent = `
      @keyframes cz-pulse { 0%,100%{box-shadow:0 0 6px var(--cz-glow)} 50%{box-shadow:0 0 14px var(--cz-glow)} }
      @keyframes cz-contested { 0%{background-position:0 0} 100%{background-position:16px 0} }
      @keyframes cz-fill-glow { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.35)} }
      .cz-card{
        position:relative;overflow:hidden;
        background:${COLORS.panelBg};
        padding:5px 10px;border-radius:${BORDER.radius.lg};
        border:${BORDER.thin} solid ${COLORS.borderDefault};
        font-family:${FONT.family};font-size:${FONT.md};color:${COLORS.textPrimary};
        min-width:200px;max-width:240px;
        backdrop-filter:blur(8px);
        box-shadow:${SHADOW.panel};
        transition:border-color 0.4s,box-shadow 0.4s;
      }
      .cz-card.cz-active{animation:cz-pulse 2s ease-in-out infinite;}
      .cz-card::before{
        content:'';position:absolute;top:0;left:0;right:0;height:2px;
        background:var(--cz-accent,#888);border-radius:8px 8px 0 0;
        transition:background 0.4s;
      }
      .cz-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;}
      .cz-label{font-weight:700;font-size:12px;letter-spacing:0.3px;text-transform:uppercase;}
      .cz-status{font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,0.08);}
      .cz-troops{display:flex;gap:12px;font-size:11px;margin-bottom:3px;}
      .cz-troop{display:flex;align-items:center;gap:3px;}
      .cz-dot{width:7px;height:7px;border-radius:50%;display:inline-block;}
      .cz-bar-wrap{height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;position:relative;}
      .cz-bar-fill{height:100%;border-radius:3px;transition:width 0.2s ease-out;position:relative;z-index:1;}
      .cz-bar-fill.cz-animating{animation:cz-fill-glow 1.5s ease-in-out infinite;}
      .cz-contested-stripe{
        position:absolute;top:0;left:0;right:0;bottom:0;z-index:2;border-radius:3px;
        background:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,170,0,0.35) 3px,rgba(255,170,0,0.35) 6px);
        background-size:16px 16px;
        animation:cz-contested 0.6s linear infinite;
      }
    `;
    document.head.appendChild(this._czStyle);
  }

  /** Update capture zone HUD indicators — call every frame */
  updateCaptureZones(zones: readonly { base: { id: string; owner: number; position: { q: number; r: number }; tier?: number }; controller: number; capturer: number; progress: number; unitCounts: number[]; contested: boolean; isMainBase: boolean }[]): void {
    this.ensureCaptureZoneStyles();

    // Show ALL zones (owned, neutral, enemy) so the player always has a strategic overview
    const allZones = [...zones].sort((a, b) => {
      // Player bases first, then neutral, then enemy teams
      const order = (c: number) => c === 0 ? 0 : c === 2 ? 1 : c + 1;
      return order(a.controller) - order(b.controller);
    });

    if (allZones.length === 0) {
      if (this.captureZoneContainer) this.captureZoneContainer.style.display = 'none';
      return;
    }

    if (!this.captureZoneContainer) {
      this.captureZoneContainer = document.createElement('div');
      this.captureZoneContainer.style.cssText = `
        position:absolute; top:64px; right:10px;
        display:flex; flex-direction:column; gap:4px; align-items:flex-end;
        pointer-events:auto; z-index:500;
      `;
      // Capture zone cards content wrapper
      this._czCardsWrap = document.createElement('div');
      this._czCardsWrap.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:flex-end;';
      const { header: czHeader } = this.makeMinimizeHeader('czCards', '🏴 ZONES', this.captureZoneContainer, [this._czCardsWrap]);
      this.captureZoneContainer.appendChild(czHeader);
      this.captureZoneContainer.appendChild(this._czCardsWrap);
      this.container.appendChild(this.captureZoneContainer);
    }

    this.captureZoneContainer.style.display = 'flex';
    const cardsWrap = this._czCardsWrap!;

    // Reuse existing cards where possible to avoid DOM thrashing
    const existing = cardsWrap.children;
    while (existing.length > allZones.length) {
      cardsWrap.removeChild(existing[existing.length - 1]);
    }
    while (existing.length < allZones.length) {
      const card = document.createElement('div');
      card.className = 'cz-card';
      cardsWrap.appendChild(card);
    }

    // Dynamic team colors — supports N players + neutral (owner 2)
    const teamColors: Record<number, string> = {};
    const teamNames: Record<number, string> = {};
    for (let p = 0; p < HUD.TEAM_COLORS.length; p++) {
      teamColors[p] = HUD.TEAM_COLORS[p];
      teamNames[p] = p === 0 ? 'Your' : HUD.TEAM_NAMES[p] || `P${p}`;
    }
    teamColors[2] = '#d4af37'; teamNames[2] = 'Neutral'; // Override neutral

    for (let i = 0; i < allZones.length; i++) {
      const zone = allZones[i];
      const card = existing[i] as HTMLElement;

      const controlColor = teamColors[zone.controller] ?? '#888';
      const capColor = zone.capturer >= 0 ? (teamColors[zone.capturer] ?? '#888') : controlColor;
      const isCapturing = zone.progress > 0;
      const hasUnits = zone.unitCounts[0] > 0 || zone.unitCounts[1] > 0;

      // Card glow
      card.style.setProperty('--cz-glow', isCapturing ? capColor + '66' : 'transparent');
      card.style.setProperty('--cz-accent', controlColor);
      card.style.borderColor = isCapturing ? capColor + 'aa' : 'rgba(255,255,255,0.12)';
      card.className = isCapturing ? 'cz-card cz-active' : 'cz-card';

      // Labels — include base tier if available
      const TIER_NAMES = ['Camp', 'Fort', 'Castle', 'Citadel'];
      const TIER_ICONS = ['🏕️', '🏰', '👑', '🔮'];
      const tier = zone.base.tier ?? 0;
      const tierStr = TIER_NAMES[tier] ?? 'Camp';
      const typeStr = zone.isMainBase ? 'Capital' : 'Outpost';
      const ownerStr = teamNames[zone.controller] ?? 'Neutral';
      const label = `${ownerStr} ${typeStr}`;
      const icon = TIER_ICONS[tier] ?? '🏕️';

      // Status badge
      let statusHTML = '';
      if (isCapturing && zone.contested) {
        statusHTML = `<span class="cz-status" style="color:#ffaa00;">CONTESTED</span>`;
      } else if (isCapturing) {
        statusHTML = `<span class="cz-status" style="color:${capColor};">${Math.round(zone.progress * 100)}%</span>`;
      } else if (hasUnits) {
        statusHTML = `<span class="cz-status" style="color:#8f8;">ACTIVE</span>`;
      } else {
        statusHTML = `<span class="cz-status" style="color:#666;">QUIET</span>`;
      }

      // Troop counts — dynamic for N players
      const troopDots = zone.unitCounts.map((count, idx) => {
        if (idx === 2) return ''; // skip neutral
        const tc = teamColors[idx] || '#888';
        return `<span class="cz-troop"><span class="cz-dot" style="background:${tc};${count > 0 ? `box-shadow:0 0 4px ${tc};` : ''}"></span>${count}</span>`;
      }).filter(Boolean).join('');

      // Progress bar (only when capturing or contested)
      let barHTML = '';
      if (isCapturing) {
        const pct = Math.max(1, Math.round(zone.progress * 100));
        barHTML = `
          <div class="cz-bar-wrap">
            <div class="cz-bar-fill ${zone.progress > 0 && zone.progress < 1 ? 'cz-animating' : ''}"
                 style="width:${pct}%;background:${capColor};"></div>
            ${zone.contested ? '<div class="cz-contested-stripe"></div>' : ''}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="cz-header">
          <span class="cz-label" style="color:${controlColor};">${icon} ${label} <span style="font-size:9px;opacity:0.7;">${tierStr}</span></span>
          ${statusHTML}
        </div>
        <div class="cz-troops">${troopDots}</div>
        ${barHTML}
      `;
    }
  }

  private notificationEl: HTMLElement | null = null;
  private notificationTimeout: number | null = null;

  showNotification(message: string, color: string = '#e74c3c'): void {
    if (!this.notificationEl) {
      this.notificationEl = document.createElement('div');
      this.notificationEl.style.cssText = `
        position: absolute; top: 120px; left: 16px;
        ${UI.panel(color)}; padding: 10px 20px;
        font-size: ${FONT.lg}; font-weight: bold; letter-spacing: 1px;
        text-align: left; display: none; pointer-events: auto;
        max-width: 320px;
        animation: uiSlideUp 0.2s ease;
        z-index: 10001;
      `;
      this.container.appendChild(this.notificationEl);
    }
    this.notificationEl.style.borderColor = color;
    this.notificationEl.style.border = `${BORDER.width} solid ${color}`;
    this.notificationEl.style.color = color;
    this.notificationEl.innerHTML = message;
    this.notificationEl.style.display = 'block';

    if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
    this.notificationTimeout = window.setTimeout(() => {
      if (this.notificationEl) this.notificationEl.style.display = 'none';
    }, 2500);
  }

  /** Lightweight per-frame update: refreshes health/state text only. Does NOT rebuild command panel buttons. */
  updateSelectionInfo(units: Unit[]): void {
    if (units.length === 0) {
      this.elements.selectionInfo.style.display = 'none';
      this._fullSelection = [];
      this._excludedTypes.clear();
      this.hideUnitInfo();
      if (this.selectionCommandPanel) {
        this.selectionCommandPanel.style.display = 'none';
      }
      return;
    }

    this.elements.selectionInfo.style.display = 'block';

    if (units.length === 1) {
      this._fullSelection = units;
      this._excludedTypes.clear();
      const unit = units[0];
      const healthPct = Math.round((unit.currentHealth / unit.stats.maxHealth) * 100);
      const healthColor = healthPct > 50 ? '#2ecc71' : healthPct > 25 ? '#f39c12' : '#e74c3c';
      const stanceLabel = unit.stance === UnitStance.PASSIVE ? '🛡 Passive' :
                          unit.stance === UnitStance.DEFENSIVE ? '⚔ Defensive' : '🔥 Aggressive';
      const desc = this.getUnitDescription(unit.type);
      const passives = this.getUnitPassives(unit.type);
      const lvlInfo = unit.level > 1 ? ` Lv.${unit.level}` : '';

      let passiveHtml = '';
      if (passives.length > 0) {
        passiveHtml = `<div style="margin-top:5px; border-top:1px solid rgba(255,255,255,0.12); padding-top:5px;">`;
        for (const p of passives) {
          passiveHtml += `<div style="font-size:11px; color:#a8d8ea; margin-bottom:2px;">⬥ ${p}</div>`;
        }
        passiveHtml += `</div>`;
      }

      // --- Element cycle display for Mage / Battlemage ---
      const ELEMENT_CYCLE: ElementType[] = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
      const ELEMENT_COLORS: Record<string, string> = {
        fire: '#ff4422', water: '#4488ff', lightning: '#ffee44', wind: '#88ffcc', earth: '#aa7744',
      };
      const ELEMENT_ICONS: Record<string, string> = {
        fire: '🔥', water: '💧', lightning: '⚡', wind: '🌪', earth: '🪨',
      };
      // Battlemage overrides: Earth → Arcane (purple), Lightning → High Voltage (cyan)
      const BM_COLORS: Record<string, string> = {
        fire: '#ff4422', water: '#4488ff', lightning: '#44eeff', wind: '#88ffcc', earth: '#aa44ff',
      };
      const BM_ICONS: Record<string, string> = {
        fire: '🔥', water: '💧', lightning: '⚡', wind: '🌪', earth: '🔮',
      };
      const BM_NAMES: Record<string, string> = {
        fire: 'ABLAZE', water: 'WET', lightning: 'HIGH VOLTAGE', wind: 'KNOCKUP', earth: 'ARCANE',
      };
      const isMageType = unit.type === UnitType.MAGE || unit.type === UnitType.BATTLEMAGE;
      const isBM = unit.type === UnitType.BATTLEMAGE;
      let elementHtml = '';
      if (isMageType && unit.element) {
        const curEl = unit.element;
        const curColor = (isBM ? BM_COLORS : ELEMENT_COLORS)[curEl] || '#fff';
        const curIcon = (isBM ? BM_ICONS : ELEMENT_ICONS)[curEl] || '?';
        const curName = isBM ? (BM_NAMES[curEl] || curEl.toUpperCase()) : curEl.toUpperCase();
        const lockIndicator = unit._lockedElement
          ? `<span style="color:${curColor}; font-size:10px;"> 🔒 LOCKED</span>`
          : `<span style="font-size:10px; color:#666;"> (cycling)</span>`;
        elementHtml = `<div style="margin-top:5px; border-top:1px solid rgba(255,255,255,0.12); padding-top:5px;">
          <div style="font-size:11px; color:#ccc; margin-bottom:3px;">Next Spell: <span style="color:${curColor}; font-weight:bold;">${curIcon} ${curName}</span>${lockIndicator}</div>
          <div id="hud-element-cycle" style="display:flex; gap:3px; flex-wrap:wrap;"></div>
          <div style="font-size:10px; color:#666; margin-top:3px;">Q/W/E/R/T to lock element</div>
        </div>`;
      }

      // --- Status effects display (any unit) ---
      const activeStatuses = StatusEffectSystem.getActiveStatuses(unit);
      const STATUS_DISPLAY: Record<string, { color: string; label: string; icon: string }> = {
        wet:            { color: '#4488ff', label: 'Wet',      icon: '💧' },
        ablaze:         { color: '#ff4422', label: 'Ablaze',   icon: '🔥' },
        arcane:         { color: '#aa44ff', label: 'Arcane',   icon: '🔮' },
        high_voltage:   { color: '#44eeff', label: 'High Voltage', icon: '⚡' },
        knockup:        { color: '#88ffcc', label: 'Airborne', icon: '🌪' },
        cleanse_linger: { color: '#ffd700', label: 'Immune',   icon: '✨' },
        speed_boost:    { color: '#ffd700', label: 'Haste',    icon: '💨' },
      };
      let statusHtml = '';
      if (activeStatuses.length > 0) {
        const badges = activeStatuses.map(s => {
          const d = STATUS_DISPLAY[s] || { color: '#ccc', label: s, icon: '●' };
          return `<span style="display:inline-block; padding:2px 6px; margin:1px 2px; border-radius:3px; font-size:10px; font-weight:bold; background:rgba(0,0,0,0.4); border:1px solid ${d.color}; color:${d.color};">${d.icon} ${d.label}</span>`;
        }).join('');
        statusHtml = `<div style="margin-top:5px; border-top:1px solid rgba(255,255,255,0.12); padding-top:5px;">
          <div style="font-size:10px; color:#888; margin-bottom:2px;">STATUS EFFECTS</div>
          <div style="display:flex; flex-wrap:wrap;">${badges}</div>
        </div>`;
      }

      this.elements.selectionInfo.innerHTML = `
        <div style="font-size:16px; font-weight:bold; text-transform:uppercase; margin-bottom:2px;">
          ${unit.type}${lvlInfo} <span style="font-size:12px; color:#aaa">(${unit.state})</span>
        </div>
        <div style="font-size:11px; color:#aaa; margin-bottom:6px; font-style:italic;">${desc}</div>
        <div style="margin-bottom:4px;">
          HP: <span style="color:${healthColor}">${unit.currentHealth}/${unit.stats.maxHealth}</span>
        </div>
        <div style="${UI.barWrap()}; margin-bottom:6px;">
          <div style="${UI.barFill(healthColor, healthPct)};"></div>
        </div>
        <div>ATK: ${unit.stats.attack} · DEF: ${unit.stats.defense} · RNG: ${unit.stats.range} · SPD: ${unit.moveSpeed.toFixed(1)}</div>
        <div style="margin-top:4px; color:#ccc; font-size:11px;">Stance: ${stanceLabel} · Move: ${unit.stats.movement}</div>
        ${passiveHtml}
        ${elementHtml}
        ${statusHtml}
      `;

      // --- Wire up clickable element cycle buttons (debug override) ---
      if (isMageType && unit.element) {
        const cycleContainer = this.elements.selectionInfo.querySelector('#hud-element-cycle');
        if (cycleContainer) {
          const cycleIdx = unit._elementCycleIndex ?? 0;
          ELEMENT_CYCLE.forEach((el, i) => {
            const btn = document.createElement('span');
            const isActive = i === cycleIdx;
            const elColor = (isBM ? BM_COLORS : ELEMENT_COLORS)[el] || '#fff';
            const elIcon = (isBM ? BM_ICONS : ELEMENT_ICONS)[el] || '?';
            const elName = isBM ? (BM_NAMES[el] || el.toUpperCase()) : (el.charAt(0).toUpperCase() + el.slice(1));
            btn.textContent = `${elIcon} ${elName}`;
            btn.style.cssText = `
              display:inline-block; padding:2px 6px; margin:1px; border-radius:3px; font-size:10px;
              cursor:pointer; user-select:none; transition: all 0.1s;
              border: 1px solid ${isActive ? elColor : '#555'};
              background: ${isActive ? `rgba(255,255,255,0.15)` : 'rgba(0,0,0,0.3)'};
              color: ${isActive ? elColor : '#888'};
              font-weight: ${isActive ? 'bold' : 'normal'};
            `;
            btn.title = `Set next spell to ${elName} (debug)`;
            btn.addEventListener('mouseenter', () => {
              if (!isActive) { btn.style.borderColor = elColor; btn.style.color = elColor; }
            });
            btn.addEventListener('mouseleave', () => {
              if (!isActive) { btn.style.borderColor = '#555'; btn.style.color = '#888'; }
            });
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              unit.element = el;
              unit._elementCycleIndex = i;
              // Refresh the tooltip immediately
              this.updateSelectionInfo(units);
            });
            cycleContainer.appendChild(btn);
          });
        }
      }
    } else {
      // Multiple units selected — show clickable type badges for squad filtering
      // _fullSelection and _excludedTypes are managed by updateSelection(), not here

      // Count types from the FULL selection (so excluded types still show)
      const typeCounts: Record<string, number> = {};
      for (const u of this._fullSelection) {
        typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
      }

      // Active count (included types only)
      const activeCount = this._fullSelection.filter(u => !this._excludedTypes.has(u.type)).length;

      // Build header
      const header = document.createElement('div');
      header.style.cssText = 'font-size:16px; font-weight:bold; margin-bottom:6px;';
      header.textContent = activeCount + ' UNITS SELECTED';

      // Build type badges container
      const badgeContainer = document.createElement('div');
      badgeContainer.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';

      for (const [type, count] of Object.entries(typeCounts)) {
        const isExcluded = this._excludedTypes.has(type);
        const badge = document.createElement('div');
        badge.style.cssText = `
          padding: 3px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;
          border: 1px solid ${isExcluded ? '#555' : '#4a9eff'}; user-select: none;
          background: ${isExcluded ? 'rgba(80,80,80,0.3)' : 'rgba(74,158,255,0.2)'};
          color: ${isExcluded ? '#666' : '#fff'};
          transition: all 0.1s ease;
          ${isExcluded ? 'text-decoration: line-through;' : ''}
        `;
        badge.textContent = count + 'x ' + type;
        badge.title = isExcluded ? 'Click to include ' + type : 'Click to exclude ' + type;

        badge.addEventListener('mouseenter', () => {
          badge.style.background = isExcluded ? 'rgba(74,158,255,0.15)' : 'rgba(255,100,100,0.2)';
          badge.style.borderColor = isExcluded ? '#4a9eff' : '#ff6666';
        });
        badge.addEventListener('mouseleave', () => {
          badge.style.background = isExcluded ? 'rgba(80,80,80,0.3)' : 'rgba(74,158,255,0.2)';
          badge.style.borderColor = isExcluded ? '#555' : '#4a9eff';
        });

        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          // Don't allow excluding ALL types
          const typesArray = Object.keys(typeCounts);
          if (!isExcluded && typesArray.filter(t => !this._excludedTypes.has(t)).length <= 1) return;

          if (isExcluded) {
            this._excludedTypes.delete(type);
          } else {
            this._excludedTypes.add(type);
          }
          // Filter the full selection and push the update
          const filtered = this._fullSelection.filter(u => !this._excludedTypes.has(u.type));
          this._isFilterUpdate = true;
          this._onSelectionFiltered?.(filtered);
        });

        badgeContainer.appendChild(badge);
      }

      // Hint text
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#888; font-size:10px; margin-top:4px;';
      hint.textContent = 'Click types to toggle selection';

      this.elements.selectionInfo.innerHTML = '';
      this.elements.selectionInfo.appendChild(header);

      // Show active objective badge if squad has one
      const objUnits = units.filter(u => u._playerObjective);
      if (objUnits.length > 0) {
        const obj = objUnits[0]._playerObjective;
        const objDiv = document.createElement('div');
        const objColor = obj === 'CAPTURE' ? '#27ae60' : '#e74c3c';
        const objIcon = obj === 'CAPTURE' ? '🏴' : '⚔️';
        objDiv.style.cssText = `font-size:12px; font-weight:bold; color:${objColor}; margin-bottom:4px; padding:3px 6px; background:rgba(0,0,0,0.4); border:1px solid ${objColor}; border-radius:4px; display:inline-block;`;
        objDiv.textContent = `${objIcon} ${obj} — Autonomous`;
        this.elements.selectionInfo.appendChild(objDiv);
      }

      this.elements.selectionInfo.appendChild(badgeContainer);
      this.elements.selectionInfo.appendChild(hint);

      // --- QWERT Spell Queue controls (shown when selection has mages) ---
      const magesInSelection = units.filter(u => u.type === UnitType.MAGE || u.type === UnitType.BATTLEMAGE);
      if (magesInSelection.length > 0) {
        const SPELL_QUEUE_ELEMENTS: { key: string; element: ElementType; icon: string; name: string; color: string }[] = [
          { key: 'Q', element: ElementType.FIRE, icon: '🔥', name: 'Fire', color: '#ff4400' },
          { key: 'W', element: ElementType.WATER, icon: '💧', name: 'Water', color: '#4488ff' },
          { key: 'E', element: ElementType.LIGHTNING, icon: '⚡', name: 'Lightning', color: '#00e5ff' },
          { key: 'R', element: ElementType.WIND, icon: '🌀', name: 'Wind', color: '#88ff88' },
          { key: 'T', element: ElementType.EARTH, icon: '🟣', name: 'Arcane', color: '#9944ff' },
        ];

        const spellQueueDiv = document.createElement('div');
        spellQueueDiv.style.cssText = 'margin-top:8px; padding-top:6px; border-top:1px solid #444;';

        const sqLabel = document.createElement('div');
        sqLabel.style.cssText = 'font-size:11px; color:#aaa; margin-bottom:4px; font-weight:bold;';
        sqLabel.textContent = `SPELL QUEUE (${magesInSelection.length} mage${magesInSelection.length !== 1 ? 's' : ''})`;
        spellQueueDiv.appendChild(sqLabel);

        const sqRow = document.createElement('div');
        sqRow.style.cssText = 'display:flex; gap:3px; flex-wrap:wrap;';

        // Determine if all mages share the same locked element
        const commonLocked = magesInSelection.every(m => m._lockedElement === magesInSelection[0]._lockedElement)
          ? magesInSelection[0]._lockedElement : undefined;

        for (const sq of SPELL_QUEUE_ELEMENTS) {
          const isActive = commonLocked === sq.element;
          const btn = document.createElement('span');
          btn.style.cssText = `
            display:inline-block; padding:2px 6px; border-radius:3px; font-size:11px;
            cursor:pointer; user-select:none; transition:all 0.1s;
            border: 1px solid ${isActive ? sq.color : '#555'};
            background: ${isActive ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.3)'};
            color: ${isActive ? sq.color : '#999'};
            font-weight: ${isActive ? 'bold' : 'normal'};
          `;
          btn.textContent = `[${sq.key}] ${sq.icon} ${sq.name}`;
          btn.title = isActive ? `Unlock ${sq.name} (click or press ${sq.key})` : `Lock mages to ${sq.name} (${sq.key})`;

          btn.addEventListener('mouseenter', () => {
            if (!isActive) { btn.style.borderColor = sq.color; btn.style.color = sq.color; }
          });
          btn.addEventListener('mouseleave', () => {
            if (!isActive) { btn.style.borderColor = '#555'; btn.style.color = '#999'; }
          });
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const mageIds = magesInSelection.map(m => m.id);
            if (isActive) {
              // Unlock — route through command queue for multiplayer determinism
              if (this._onLockElement) {
                this._onLockElement(mageIds, null);
              }
            } else {
              // Lock — route through command queue for multiplayer determinism
              if (this._onLockElement) {
                this._onLockElement(mageIds, sq.element);
              }
            }
            this.updateSelectionInfo(units);
          });

          sqRow.appendChild(btn);
        }

        spellQueueDiv.appendChild(sqRow);

        // Show current lock status
        if (commonLocked) {
          const lockStatus = document.createElement('div');
          const lockedInfo = SPELL_QUEUE_ELEMENTS.find(s => s.element === commonLocked);
          lockStatus.style.cssText = `font-size:10px; color:${lockedInfo?.color || '#fff'}; margin-top:3px;`;
          lockStatus.textContent = `🔒 Locked: ${lockedInfo?.icon} ${lockedInfo?.name} — press key again to unlock`;
          spellQueueDiv.appendChild(lockStatus);
        }

        this.elements.selectionInfo.appendChild(spellQueueDiv);
      }
    }
  }

  /** Full selection update: refreshes info AND rebuilds command panel. Call only when selection actually changes. */
  updateSelection(units: Unit[]): void {
    // If this was triggered by a type-filter toggle, don't reset _fullSelection
    if (this._isFilterUpdate) {
      this._isFilterUpdate = false;
      this.updateSelectionInfo(units);
    } else {
      // Fresh selection — reset filter state
      this._fullSelection = units;
      this._excludedTypes.clear();
      this.updateSelectionInfo(units);
    }

    if (units.length === 0) return;

    // Show command panel for combat units (all non-worker types)
    const hasCombat = units.some(u => HUD.isCombatType(u.type));
    this.showSelectionCommands(hasCombat, units);
  }

  private showSelectionCommands(hasCombat: boolean, units: Unit[]): void {
    if (!this.selectionCommandPanel) {
      this.selectionCommandPanel = document.createElement('div');
      this.selectionCommandPanel.style.cssText = `
        position: fixed; bottom: 16px; right: 16px;
        ${UI.panel()}; padding: 8px 10px;
        display: flex; flex-direction: column; gap: 4px;
        z-index: 10000; min-width: 170px;
      `;
      // Prevent clicks on this panel from propagating to the game canvas,
      // which would clear the unit selection
      this.selectionCommandPanel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
      this.selectionCommandPanel.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
      this.selectionCommandPanel.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
      // Append to document.body (NOT the HUD container) to avoid pointer-events:none inheritance issues
      document.body.appendChild(this.selectionCommandPanel);
    }

    this.selectionCommandPanel.style.display = 'flex';
    this.selectionCommandPanel.innerHTML = '';

    // Collapsible content wrapper
    const cmdContent = document.createElement('div');
    cmdContent.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const { header: cmdHeader } = this.makeMinimizeHeader('selCmd', '🎖️ COMMANDS', this.selectionCommandPanel, [cmdContent]);
    this.selectionCommandPanel.appendChild(cmdHeader);
    this.selectionCommandPanel.appendChild(cmdContent);

    const makeSmallBtn = (label: string, color: string, active: boolean, cb: () => void): HTMLElement => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: ${active ? color : 'rgba(60,60,60,0.8)'};
        color: white; border: ${BORDER.thin} solid ${active ? COLORS.borderActive : 'rgba(255,255,255,0.15)'};
        padding: 4px 8px; font-size: ${FONT.sm}; font-family: ${FONT.family};
        font-weight: bold; border-radius: ${BORDER.radius.sm}; cursor: pointer;
        text-transform: uppercase; letter-spacing: 0.5px;
        pointer-events: auto; position: relative;
        ${active ? 'box-shadow: 0 0 6px ' + color + ';' : ''}
      `;
      btn.textContent = label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); cb(); });
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
      btn.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
      btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
      btn.addEventListener('mouseleave', () => { btn.style.filter = 'brightness(1)'; });
      return btn;
    };

    const makeHeader = (text: string): HTMLElement => {
      const h = document.createElement('div');
      h.style.cssText = `${UI.sectionHeader()}; padding-left: 2px;`;
      h.textContent = text;
      return h;
    };

    if (hasCombat) {
      // Current stance (use first combat unit's stance as reference)
      const combatUnit = units.find(u => HUD.isCombatType(u.type));
      const currentStance = combatUnit?.stance ?? UnitStance.DEFENSIVE;

      // STANCE section
      cmdContent.appendChild(makeHeader('🎯 Stance'));
      const stanceRow = document.createElement('div');
      stanceRow.style.cssText = 'display: flex; gap: 3px;';
      const passiveBtn = makeSmallBtn('Passive', '#7f8c8d', currentStance === UnitStance.PASSIVE,
        () => this._onSetStance?.(UnitStance.PASSIVE));
      passiveBtn.setAttribute('data-stance', UnitStance.PASSIVE);
      passiveBtn.title = 'Passive — Hold position, never attack. Good for scouting or retreat.';
      stanceRow.appendChild(passiveBtn);
      const defensiveBtn = makeSmallBtn('Defensive', '#2980b9', currentStance === UnitStance.DEFENSIVE,
        () => this._onSetStance?.(UnitStance.DEFENSIVE));
      defensiveBtn.setAttribute('data-stance', UnitStance.DEFENSIVE);
      defensiveBtn.title = 'Defensive — Hold position, attack enemies in weapon range. Default stance.';
      stanceRow.appendChild(defensiveBtn);
      const aggressiveBtn = makeSmallBtn('Aggressive', '#c0392b', currentStance === UnitStance.AGGRESSIVE,
        () => this._onSetStance?.(UnitStance.AGGRESSIVE));
      aggressiveBtn.setAttribute('data-stance', UnitStance.AGGRESSIVE);
      aggressiveBtn.title = 'Aggressive — Chase and attack enemies in detection range. Auto-patrols area.';
      stanceRow.appendChild(aggressiveBtn);
      cmdContent.appendChild(stanceRow);

      // FORMATION section
      cmdContent.appendChild(makeHeader('📐 Formation'));
      const formRow = document.createElement('div');
      formRow.style.cssText = 'display: flex; gap: 3px;';
      const lineBtn = makeSmallBtn('Line', '#27ae60', false,
        () => this._onSetFormation?.(FormationType.LINE));
      lineBtn.setAttribute('data-formation', FormationType.LINE);
      lineBtn.title = 'Line — Horizontal spread. Maximizes frontline for ranged units.';
      formRow.appendChild(lineBtn);
      const boxBtn = makeSmallBtn('Box', '#8e44ad', false,
        () => this._onSetFormation?.(FormationType.BOX));
      boxBtn.setAttribute('data-formation', FormationType.BOX);
      boxBtn.title = 'Box — Compact square. Good all-purpose formation.';
      formRow.appendChild(boxBtn);
      const wedgeBtn = makeSmallBtn('Wedge', '#d35400', false,
        () => this._onSetFormation?.(FormationType.WEDGE));
      wedgeBtn.setAttribute('data-formation', FormationType.WEDGE);
      wedgeBtn.title = 'Wedge — V-shape. Pierces through enemy lines.';
      formRow.appendChild(wedgeBtn);
      const circleBtn = makeSmallBtn('Circle', '#2980b9', false,
        () => this._onSetFormation?.(FormationType.CIRCLE));
      circleBtn.setAttribute('data-formation', FormationType.CIRCLE);
      circleBtn.title = 'Circle — Defensive ring. Protects from all sides.';
      formRow.appendChild(circleBtn);
      cmdContent.appendChild(formRow);
    }

    // OBJECTIVE section (autonomous squad behavior — combat units only)
    if (hasCombat) {
      // Detect current objective from selected units
      const combatUnits = units.filter(u => HUD.isCombatType(u.type));
      const currentObj = combatUnits.length > 0 && combatUnits.every(u => u._playerObjective === combatUnits[0]._playerObjective)
        ? combatUnits[0]._playerObjective ?? null : null;

      cmdContent.appendChild(makeHeader('🏴 Objective'));
      const objRow = document.createElement('div');
      objRow.style.cssText = 'display: flex; gap: 3px;';

      const captureBtn = makeSmallBtn('Capture', '#27ae60', currentObj === 'CAPTURE', () => {
        this._onSetSquadObjective?.(currentObj === 'CAPTURE' ? null : 'CAPTURE');
      });
      captureBtn.title = 'CAPTURE — Squad autonomously seeks and captures enemy/neutral bases (defensive stance).';
      objRow.appendChild(captureBtn);

      const assaultBtn = makeSmallBtn('Assault', '#e74c3c', currentObj === 'ASSAULT', () => {
        this._onSetSquadObjective?.(currentObj === 'ASSAULT' ? null : 'ASSAULT');
      });
      assaultBtn.title = 'ASSAULT — Squad autonomously attacks enemy capital (aggressive stance).';
      objRow.appendChild(assaultBtn);

      const clearBtn = makeSmallBtn('Manual', '#7f8c8d', currentObj === null, () => {
        this._onSetSquadObjective?.(null);
      });
      clearBtn.title = 'Manual — Clear objective, return to manual control.';
      objRow.appendChild(clearBtn);

      cmdContent.appendChild(objRow);
    }

    // ACTIONS section (always show for selected units)
    cmdContent.appendChild(makeHeader('⚡ Actions'));
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    const killBtn = makeSmallBtn('Kill', '#e74c3c', false,
      () => this._onRespawnUnits?.());
    killBtn.title = 'Kill the selected units (permanently removes them).';
    actionRow.appendChild(killBtn);
    cmdContent.appendChild(actionRow);
  }

  showUnitInfo(unit: Unit): void {
    // For RTS, unit info is shown in selection bar
    this.updateSelection([unit]);
  }

  hideUnitInfo(): void {
    if (this.unitInfoPanel) {
      this.unitInfoPanel.remove();
      this.unitInfoPanel = null;
    }
  }

  /** Hide the bottom-center selection info panel (used when PIP tooltip is shown instead) */
  hideSelectionInfo(): void {
    this.elements.selectionInfo.style.display = 'none';
    if (this.selectionCommandPanel) {
      this.selectionCommandPanel.style.display = 'none';
    }
  }

  private createBuildModeIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'build-mode-indicator';
    indicator.style.cssText = `
      ${UI.modeIndicator('#f0c040')};
    `;
    indicator.innerHTML = `🏰 WALL BUILD MODE — Click tiles for walls (${GAME_CONFIG.defenses.wall.cost.stone} stone) · Shift+click for gates (${GAME_CONFIG.defenses.gate.cost.stone} stone) · Walls auto-connect · [Tab] to close`;
    this.container.appendChild(indicator);
    return indicator;
  }

  setBuildMode(active: boolean): void {
    if (this.buildModeIndicator) {
      this.buildModeIndicator.style.display = active ? 'block' : 'none';
    }
    if (active) this.hideAllModeIndicators('build');
  }

  /** Update build mode indicator with blueprint cost info */
  updateBuildModeInfo(blueprintInfo: { walls: number; gates: number; totalStone: number }, stoneAvailable: number): void {
    if (!this.buildModeIndicator || this.buildModeIndicator.style.display === 'none') return;
    const { walls, gates, totalStone } = blueprintInfo;
    const costColor = totalStone > stoneAvailable ? '#e74c3c' : '#4caf50';
    let costText = '';
    if (walls > 0 || gates > 0) {
      costText = ` · <span style="color:${costColor}">Queued: ${walls} wall${walls !== 1 ? 's' : ''}${gates > 0 ? `, ${gates} gate${gates !== 1 ? 's' : ''}` : ''} = ${totalStone} stone (have ${stoneAvailable})</span>`;
    }
    this.buildModeIndicator.innerHTML = `🏰 WALL BUILD — Click for walls (${GAME_CONFIG.defenses.wall.cost.stone}🪨) · Shift+click for gates (${GAME_CONFIG.defenses.gate.cost.stone}🪨) · Drag to draw${costText} · [Tab] close`;
  }

  setHarvestMode(active: boolean): void {
    if (!this.harvestModeIndicator) {
      this.harvestModeIndicator = document.createElement('div');
      this.harvestModeIndicator.style.cssText = `
        ${UI.modeIndicator('#4caf50')};
      `;
      this.harvestModeIndicator.innerHTML = '🪓 HARVEST MODE — Click & drag to mark trees for chopping · [Tab] to close';
      this.container.appendChild(this.harvestModeIndicator);
    }
    this.harvestModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('harvest');
  }

  // --- Help / Controls Overlay ---

  private createHelpOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'help-overlay';
    overlay.style.cssText = `
      ${UI.overlay('rgba(5, 5, 16, 0.94)')};
      display: none; overflow-y: auto;
      animation: uiFadeIn 0.25s ease;
    `;

    // Add keyframe animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes helpFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #help-overlay .key {
        display: inline-block;
        background: linear-gradient(180deg, #555, #333);
        color: #fff;
        border: ${BORDER.thin} solid #777;
        border-radius: ${BORDER.radius.sm};
        padding: 2px 8px;
        font-size: ${FONT.base};
        font-weight: bold;
        min-width: 20px;
        text-align: center;
        box-shadow: 0 2px 0 #222;
        margin: 0 2px;
      }
      #help-overlay .section {
        background: rgba(255,255,255,0.04);
        border: ${BORDER.thin} solid ${COLORS.divider};
        border-radius: ${BORDER.radius.lg};
        padding: 16px 20px;
        margin-bottom: 12px;
      }
      #help-overlay .section-title {
        font-size: ${FONT.lg};
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 3px;
        margin-bottom: 12px;
        padding-bottom: 6px;
        border-bottom: ${BORDER.thin} solid rgba(255,255,255,0.15);
      }
      #help-overlay .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 0;
      }
      #help-overlay .row-label {
        color: ${COLORS.textSecondary};
        font-size: ${FONT.base};
      }
      #help-overlay .row-keys {
        flex-shrink: 0;
      }
      #help-overlay .unit-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px 0;
      }
      #help-overlay .unit-icon {
        width: 32px; height: 32px;
        border-radius: ${BORDER.radius.sm};
        flex-shrink: 0;
        image-rendering: pixelated;
        background: rgba(255,255,255,0.06);
        border: ${BORDER.thin} solid rgba(255,255,255,0.12);
      }
      #help-overlay .unit-name {
        font-weight: bold; font-size: ${FONT.base}; min-width: 90px;
      }
      #help-overlay .unit-desc {
        font-size: ${FONT.md}; color: ${COLORS.textMuted};
      }
      #help-overlay .tip {
        display: flex; gap: 8px; padding: 4px 0; font-size: ${FONT.md};
      }
      #help-overlay .tip-bullet {
        color: ${COLORS.gold}; flex-shrink: 0;
      }
      #help-overlay .close-hint {
        position: absolute; top: 16px; right: 24px;
        font-size: ${FONT.base}; color: ${COLORS.textMuted};
      }
      #help-overlay .vx {
        display: inline-block;
        width: 10px; height: 10px;
        border-radius: 2px;
        vertical-align: middle;
        margin-right: 4px;
        box-shadow: inset -1px -1px 0 rgba(0,0,0,0.3), inset 1px 1px 0 rgba(255,255,255,0.15);
        image-rendering: pixelated;
      }
      #help-overlay .vx-lg {
        width: 14px; height: 14px; border-radius: 2px;
        margin-right: 6px;
      }
    `;
    document.head.appendChild(style);

    overlay.innerHTML = `
      <div style="max-width: 760px; margin: 0 auto; padding: 40px 24px 60px;">
        <div class="close-hint">Press <span class="key">?</span> or <span class="key">ESC</span> to close</div>

        <!-- Title -->
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 6px; color: #fff;
            text-shadow: 0 0 20px rgba(52,152,219,0.4);">CUBITOPIA</div>
          <div style="font-size: 13px; color: #888; letter-spacing: 4px; margin-top: 6px;">
            RTS AUTO-BATTLER GUIDE
          </div>
        </div>

        <!-- UNIT TYPES -->
        <div class="section">
          <div class="section-title" style="color: #9b59b6;"><span class="vx vx-lg" style="background:#9b59b6;"></span> Unit Types</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px;">
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.WARRIOR}" alt="Warrior">
              <div>
                <div class="unit-name" style="color:#c0392b;">Warrior</div>
                <div class="unit-desc">Melee fighter. ${GAME_CONFIG.units[UnitType.WARRIOR].costs.menu.gold} gold. Barracks <span class="key" style="font-size:9px;">Q</span>. Solid all-round frontline unit.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.ARCHER}" alt="Archer">
              <div>
                <div class="unit-name" style="color:#8e44ad;">Archer</div>
                <div class="unit-desc">Ranged unit. ${GAME_CONFIG.units[UnitType.ARCHER].costs.menu.gold} gold. Barracks <span class="key" style="font-size:9px;">W</span>. Range 4, auto-kites melee threats.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.RIDER}" alt="Rider">
              <div>
                <div class="unit-name" style="color:#d35400;">Rider</div>
                <div class="unit-desc">Fast cavalry. ${GAME_CONFIG.units[UnitType.RIDER].costs.menu.gold} gold. Barracks <span class="key" style="font-size:9px;">E</span>. High speed, great for flanking and pursuit.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.SCOUT}" alt="Scout">
              <div>
                <div class="unit-name" style="color:#3498db;">Scout</div>
                <div class="unit-desc">Fast recon. ${GAME_CONFIG.units[UnitType.SCOUT].costs.menu.gold} gold. Barracks <span class="key" style="font-size:9px;">R</span>. Highest vision range (${GAME_CONFIG.combat.unitAI.detectionRanges[UnitType.SCOUT]}).</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.LUMBERJACK}" alt="Lumberjack">
              <div>
                <div class="unit-name" style="color:#8B4513;">Lumberjack</div>
                <div class="unit-desc">Wood harvester. ${GAME_CONFIG.units[UnitType.LUMBERJACK].costs.menu.wood} wood. Forestry <span class="key" style="font-size:9px;">Q</span>. Auto-chops marked trees <span class="key" style="font-size:9px;">H</span> and carries wood to stockpile.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.BUILDER}" alt="Builder">
              <div>
                <div class="unit-name" style="color:#b8860b;">Builder</div>
                <div class="unit-desc">Miner &amp; mason. ${GAME_CONFIG.units[UnitType.BUILDER].costs.menu.wood} wood. Masonry <span class="key" style="font-size:9px;">Q</span>. Mines stone/clay/iron/gold/crystal <span class="key" style="font-size:9px;">N</span>, builds walls <span class="key" style="font-size:9px;">B</span>, constructs blueprints.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.VILLAGER}" alt="Villager">
              <div>
                <div class="unit-name" style="color:#daa520;">Villager</div>
                <div class="unit-desc">Farmer. ${GAME_CONFIG.units[UnitType.VILLAGER].costs.menu.wood} wood. Farmhouse <span class="key" style="font-size:9px;">Q</span>. Harvests farms &amp; tall grass <span class="key" style="font-size:9px;">J</span> for food + grass fiber.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.TREBUCHET}" alt="Trebuchet">
              <div>
                <div class="unit-name" style="color:#795548;">Trebuchet</div>
                <div class="unit-desc">Heavy siege. ${GAME_CONFIG.units[UnitType.TREBUCHET].costs.playerQueue.rope} rope + ${GAME_CONFIG.units[UnitType.TREBUCHET].costs.playerQueue.stone} stone + ${GAME_CONFIG.units[UnitType.TREBUCHET].costs.playerQueue.wood} wood. Workshop <span class="key" style="font-size:9px;">Q</span>. Range 6, massive damage vs buildings. Full damage to walls.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.PALADIN}" alt="Paladin">
              <div>
                <div class="unit-name" style="color:#3498db;">Paladin</div>
                <div class="unit-desc">Holy knight. ${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.crystal} crystal. Wizard Tower <span class="key" style="font-size:9px;">R</span>. High HP &amp; defense. +${GAME_CONFIG.combat.paladin.auraDefenseBonus} defense aura (${GAME_CONFIG.combat.paladin.auraRange} hex) to nearby allies.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.MAGE}" alt="Mage">
              <div>
                <div class="unit-name" style="color:#2980b9;">Mage</div>
                <div class="unit-desc">Combo caster. ${GAME_CONFIG.units[UnitType.MAGE].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.MAGE].costs.menu.crystal} crystal. Wizard Tower <span class="key" style="font-size:9px;">Q</span>. Range 3. Cycles 5 elements. Water makes targets Wet, Fire sets them Ablaze. Lightning on a Wet enemy = Electrocute chain. Wind on a Burning enemy = Inferno spread. See Magic section below.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.HEALER}" alt="Healer">
              <div>
                <div class="unit-name" style="color:#27ae60;">Healer</div>
                <div class="unit-desc">Support mage. ${GAME_CONFIG.units[UnitType.HEALER].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.HEALER].costs.menu.crystal} crystal. Wizard Tower <span class="key" style="font-size:9px;">E</span>. Heals ${GAME_CONFIG.combat.healer.healAmount} HP every ${GAME_CONFIG.combat.healer.projectileCooldown}s. Cleanse: removes all debuffs + speed boost + status immunity. Counts as a mage for Arcane Convergence.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.ASSASSIN}" alt="Assassin">
              <div>
                <div class="unit-name" style="color:#9b59b6;">Assassin</div>
                <div class="unit-desc">Burst DPS. ${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.steel} steel. Armory <span class="key" style="font-size:9px;">W</span>. +${GAME_CONFIG.combat.assassin.fullHealthAttackBonus} attack from full HP. Dual daggers.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.SHIELDBEARER}" alt="Shieldbearer">
              <div>
                <div class="unit-name" style="color:#7f8c8d;">Shieldbearer</div>
                <div class="unit-desc">Tank. ${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.steel} steel. Armory <span class="key" style="font-size:9px;">R</span>. Shield bash knockback. Deflects ${Math.round((1 - GAME_CONFIG.combat.deflect.damageMultiplier) * 100)}% ranged damage.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.BERSERKER}" alt="Berserker">
              <div>
                <div class="unit-name" style="color:#e74c3c;">Berserker</div>
                <div class="unit-desc">Melee DPS. ${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.steel} steel. Armory <span class="key" style="font-size:9px;">E</span>. Up to +${GAME_CONFIG.combat.berserker.rageAttackBonusMax} attack at low HP (rage). Ranged axe throw once per target — slows enemy. Deflected by shields.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.BATTLEMAGE}" alt="Battlemage">
              <div>
                <div class="unit-name" style="color:#8e44ad;">Battlemage</div>
                <div class="unit-desc">AoE setup caster. ${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.crystal} crystal. Wizard Tower <span class="key" style="font-size:9px;">W</span>. Low damage splash (${GAME_CONFIG.combat.battlemage.splashRadius}-hex). Cyclone pull every ${GAME_CONFIG.combat.battlemage.cycloneCooldown}s. Water AoE = Wet (sets up Electrocute). Wind AoE = Knockup CC. Lightning AoE = Arcane (sets up Kamehameha laser). Best paired with a Mage.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.GREATSWORD}" alt="Greatsword">
              <div>
                <div class="unit-name" style="color:#546e7a;">Greatsword</div>
                <div class="unit-desc">Heavy cleave. ${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.gold}g + ${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.steel} steel. Armory <span class="key" style="font-size:9px;">Q</span>. ${Math.round(GAME_CONFIG.combat.greatsword.cleaveDamageMultiplier * 100)}% cleave (${GAME_CONFIG.combat.greatsword.cleaveRadius}-hex), knockback ${GAME_CONFIG.combat.greatsword.knockbackDistance}.</div>
              </div>
            </div>
            <div class="unit-row">
              <img class="unit-icon" data-unit-portrait="${UnitType.OGRE}" alt="Ogre">
              <div>
                <div class="unit-name" style="color:#4e342e;">Ogre</div>
                <div class="unit-desc">Reward unit. FREE on base tier-up. Massive HP, ${GAME_CONFIG.combat.ogre.swipeRadius}-hex AOE club smash (${Math.round(GAME_CONFIG.combat.ogre.swipeDamageMultiplier * 100)}% dmg) with knockback. Cannot be trained — earned by upgrading bases.</div>
              </div>
            </div>
          </div>

          <div class="section-title" style="color: #f1c40f; margin-top: 12px;"><span class="vx vx-lg" style="background:#f1c40f;"></span> Base Tiers & Population</div>
          <div style="font-size: 12px; color: #ccc; margin-bottom: 6px;">
            Bases upgrade through 3 tiers. Each tier-up spawns a free Ogre. Workers (builders, lumberjacks, villagers) are FREE — they don't count toward the population cap.
          </div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#8B6914;"></span></span> <span><strong>Camp</strong> (starting tier) — No requirements.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#7f8c8d;"></span></span> <span><strong>Fort</strong> — 30 population + 3 unique building types in zone. Spawns 1 Ogre.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f1c40f;"></span></span> <span><strong>Castle</strong> — 60 population + 6 unique building types in zone. Spawns 1 more Ogre.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#8bc34a;"></span></span> <span><strong>Food Pop Cap</strong> — Every ${GAME_CONFIG.population.foodPerCombatUnit} food supports 1 combat unit. Start with ${GAME_CONFIG.population.startingFood} food (${Math.floor(GAME_CONFIG.population.startingFood / GAME_CONFIG.population.foodPerCombatUnit)} unit cap). Build farms to grow your army.</span></div>
        </div>

        <!-- NESTED MENU SYSTEM -->
        <div class="section">
          <div class="section-title" style="color: #f0c040;"><span class="vx vx-lg" style="background:#f0c040;"></span> Menu System</div>
          <div style="margin-bottom: 8px; font-size: 12px; color: #ccc;">
            Press a number key to open a building category. <strong>Shift</strong> cycles buildings.
            <strong>Click</strong> to place. <strong>QWERTY</strong> keys queue units/actions. <strong>Tab</strong> to exit.
          </div>
          <div class="tip" style="color:#f39c12; margin-top:4px;"><span class="tip-bullet" style="color:#f39c12;"><span class="vx" style="background:#f39c12;"></span></span> <span>Buildings start as <strong>blueprints</strong> — a Builder must walk over and construct them before they become functional (~8s).</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #c0392b; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">1</span> COMBAT BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#e67e22;"><span class="vx" style="background:#e67e22;"></span></span> <span><strong style="color:#e67e22;">Barracks</strong> (${GAME_CONFIG.buildings.barracks.cost.player.wood}w) — Q: Warrior ${GAME_CONFIG.units[UnitType.WARRIOR].costs.menu.gold}g · W: Archer ${GAME_CONFIG.units[UnitType.ARCHER].costs.menu.gold}g · E: Rider ${GAME_CONFIG.units[UnitType.RIDER].costs.menu.gold}g · R: Scout ${GAME_CONFIG.units[UnitType.SCOUT].costs.menu.gold}g</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#708090;"><span class="vx" style="background:#708090;"></span></span> <span><strong style="color:#708090;">Armory</strong> (${GAME_CONFIG.buildings.armory.cost.player.wood}w+${GAME_CONFIG.buildings.armory.cost.player.stone}s+${GAME_CONFIG.buildings.armory.cost.player.steel} steel) — Q: Greatsword ${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.steel}s · W: Assassin ${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.steel}s · E: Berserker ${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.steel}s · R: Shieldbearer ${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.steel}s</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#6a0dad;"><span class="vx" style="background:#6a0dad;"></span></span> <span><strong style="color:#6a0dad;">Wizard Tower</strong> (${GAME_CONFIG.buildings.wizard_tower.cost.player.wood}w+${GAME_CONFIG.buildings.wizard_tower.cost.player.stone}s+${GAME_CONFIG.buildings.wizard_tower.cost.player.crystal} crystal) — Q: Mage ${GAME_CONFIG.units[UnitType.MAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.MAGE].costs.menu.crystal}c · W: Battlemage ${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.crystal}c · E: Healer ${GAME_CONFIG.units[UnitType.HEALER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.HEALER].costs.menu.crystal}c · R: Paladin ${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.crystal}c</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #27ae60; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">2</span> ECONOMY BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#6b8e23;"><span class="vx" style="background:#6b8e23;"></span></span> <span><strong style="color:#6b8e23;">Forestry</strong> (${GAME_CONFIG.buildings.forestry.cost.player.wood}w) — Q: Lumberjack ${GAME_CONFIG.units[UnitType.LUMBERJACK].costs.menu.wood}w · W: Chop Trees · E: Plant Trees</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#b08050;"><span class="vx" style="background:#b08050;"></span></span> <span><strong style="color:#b08050;">Masonry</strong> (${GAME_CONFIG.buildings.masonry.cost.player.wood}w) — Q: Builder ${GAME_CONFIG.units[UnitType.BUILDER].costs.menu.wood}w · W: Mine Terrain · E: Build Walls</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#daa520;"><span class="vx" style="background:#daa520;"></span></span> <span><strong style="color:#daa520;">Farmhouse</strong> (${GAME_CONFIG.buildings.farmhouse.cost.player.wood}w) — Q: Villager ${GAME_CONFIG.units[UnitType.VILLAGER].costs.menu.wood}w · W: Farm/Hay · E: Plant Crops</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#5d4037;"><span class="vx" style="background:#5d4037;"></span></span> <span><strong style="color:#5d4037;">Workshop</strong> (${GAME_CONFIG.buildings.workshop.cost.player.wood}w+${GAME_CONFIG.buildings.workshop.cost.player.stone}s) — Q: Trebuchet · W: Craft Rope · E: Sell Wood</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #f39c12; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">3</span> CRAFTING BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#8b4513;"><span class="vx" style="background:#8b4513;"></span></span> <span><strong style="color:#8b4513;">Smelter</strong> (${GAME_CONFIG.buildings.smelter.cost.player.wood}w+${GAME_CONFIG.buildings.smelter.cost.player.stone}s) — Q: Smelt Steel (${GAME_CONFIG.economy.recipes.steel.input.iron} iron + ${GAME_CONFIG.economy.recipes.steel.input.charcoal} charcoal) · W: Craft Charcoal (${GAME_CONFIG.economy.recipes.charcoal.input.wood} wood + ${GAME_CONFIG.economy.recipes.charcoal.input.clay} clay)</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#c0c0c0;"><span class="vx" style="background:#c0c0c0;"></span></span> <span><strong style="color:#c0c0c0;">Silo</strong> (${GAME_CONFIG.buildings.silo.cost.player.wood}w) — Extra food storage capacity.</span></div>
        </div>

        <!-- GLOBAL ACTIONS -->
        <div class="section">
          <div class="section-title" style="color: #2980b9;"><span class="vx vx-lg" style="background:#2980b9;"></span> Global Actions (always available)</div>
          <div class="tip"><span class="tip-bullet" style="color:#2980b9;"><span class="vx" style="background:#2980b9;"></span></span> <span><span class="key">B</span> <strong>Build Walls</strong> — Click to place wall blueprints. Shift+click for gates. <span class="key">R</span> to rotate.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#27ae60;"><span class="vx" style="background:#27ae60;"></span></span> <span><span class="key">H</span> <strong>Chop Trees</strong> — Mark forest tiles for lumberjacks.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#ff8c00;"><span class="vx" style="background:#ff8c00;"></span></span> <span><span class="key">N</span> <strong>Mine Terrain</strong> — Mark terrain for mining. Scroll = depth (1-20 layers). Y-slicer (Shift+scroll) is always available to view underground layers and right-click resources.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#8bc34a;"><span class="vx" style="background:#8bc34a;"></span></span> <span><span class="key">J</span> <strong>Farm/Harvest</strong> — Create farm plots or mark grass for hay.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#f39c12;"><span class="vx" style="background:#f39c12;"></span></span> <span><span class="key">G</span> <strong>Sell Wood</strong> — Trade ${GAME_CONFIG.economy.trade.sellWood.input.wood} wood for ${GAME_CONFIG.economy.trade.sellWood.output.gold} gold.</span></div>
        </div>

        <!-- RESOURCES -->
        <div class="section">
          <div class="section-title" style="color: #27ae60;"><span class="vx vx-lg" style="background:#27ae60;"></span> Resources</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px;">
            <div class="tip"><span class="tip-bullet" style="color:#f0c040;"><span class="vx" style="background:#f0c040;"></span></span> <span><strong style="color:#f0c040;">Wood</strong> — Harvested from forests by Lumberjacks. Used to build structures and train workers.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#aaa;"><span class="vx" style="background:#aaa;"></span></span> <span><strong style="color:#aaa;">Stone</strong> — Mined from mountains/terrain by Builders. Used for advanced buildings.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#8bc34a;"><span class="vx" style="background:#8bc34a;"></span></span> <span><strong style="color:#8bc34a;">Food</strong> — Harvested from farms/grass by Villagers. Feeds your population.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#f39c12;"><span class="vx" style="background:#f39c12;"></span></span> <span><strong style="color:#f39c12;">Gold</strong> — Earned by selling wood <span class="key" style="font-size:9px;">G</span>, killing enemies (${GAME_CONFIG.economy.trade.combatRewards.unitKillGold}g/kill, ${GAME_CONFIG.economy.trade.combatRewards.siegeKillGold}g siege), or mining gold ore. Used to train combat units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#66bb6a;"><span class="vx" style="background:#66bb6a;"></span></span> <span><strong style="color:#66bb6a;">Grass Fiber</strong> — Gathered by Villagers when harvesting grass. Used to craft Rope.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#bf8040;"><span class="vx" style="background:#bf8040;"></span></span> <span><strong style="color:#bf8040;">Clay</strong> — Mined from sand/desert terrain by Builders. Used to craft Rope & Charcoal.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#c9a96e;"><span class="vx" style="background:#c9a96e;"></span></span> <span><strong style="color:#c9a96e;">Rope</strong> — Crafted <span class="key" style="font-size:9px;">L</span> from ${GAME_CONFIG.economy.recipes.rope.input.grass_fiber} fiber + ${GAME_CONFIG.economy.recipes.rope.input.clay} clay. Required for Trebuchets.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#c0652a;"><span class="vx" style="background:#ffd700;"></span></span> <span><strong style="color:#c0652a;">Iron</strong> — Mined from iron ore veins on mountains (orange rocks). Foundation of the steel chain.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#444;"><span class="vx" style="background:#444;"></span></span> <span><strong style="color:#999;">Charcoal</strong> — Crafted <span class="key" style="font-size:9px;">X</span> from ${GAME_CONFIG.economy.recipes.charcoal.input.wood} wood + ${GAME_CONFIG.economy.recipes.charcoal.input.clay} clay. Carbon needed for smelting steel.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#71797e;"><span class="vx" style="background:#71797e;"></span></span> <span><strong style="color:#71797e;">Steel</strong> — Smelted <span class="key" style="font-size:9px;">Z</span> from ${GAME_CONFIG.economy.recipes.steel.input.iron} iron + ${GAME_CONFIG.economy.recipes.steel.input.charcoal} charcoal (requires Smelter). Used for Armory units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#9b59b6;"><span class="vx" style="background:#9b59b6;"></span></span> <span><strong style="color:#9b59b6;">Crystal</strong> — Mined from gem ores (ruby, emerald, sapphire, amethyst) found in tunnel walls. Yields ${GAME_CONFIG.economy.mining.crystalYield} per block. Used for Wizard Tower units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#ffd700;"><span class="vx" style="background:#ffd700;"></span></span> <span><strong style="color:#ffd700;">Gold (mined)</strong> — Found in desert terrain and mountain gold veins. Builders mine gold blocks and deposit them at base.</span></div>
          </div>
        </div>

        <!-- COMBAT: STANCES & FORMATIONS -->
        <div class="section">
          <div class="section-title" style="color: #e74c3c;"><span class="vx vx-lg" style="background:#e74c3c;"></span> Combat Stances & Formations</div>
          <div style="margin-bottom: 8px; font-size: 12px; color: #aaa;">Select combat units to access stances and formations in the bottom-right command panel.</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px;">
            <div>
              <div style="font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Stances</div>
              <div class="tip"><span class="tip-bullet" style="color:#7f8c8d;"><span class="vx" style="background:#7f8c8d;"></span></span> <span><strong style="color:#7f8c8d;">Passive</strong> — Units hold position and never attack, even when hit. Use for scouting or retreat.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#2980b9;"><span class="vx" style="background:#2980b9;"></span></span> <span><strong style="color:#2980b9;">Defensive</strong> — Units guard their command position. They chase enemies that enter detection range, then return to post when threats leave. Archers kite melee threats instead of chasing. Default stance.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#c0392b;"><span class="vx" style="background:#c0392b;"></span></span> <span><strong style="color:#c0392b;">Aggressive</strong> — Units actively chase and attack enemies within detection range. Auto-patrols area.</span></div>
            </div>
            <div>
              <div style="font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Formations</div>
              <div class="tip"><span class="tip-bullet" style="color:#27ae60;"><span class="vx" style="background:#27ae60;"></span></span> <span><strong style="color:#27ae60;">Line</strong> — Horizontal spread. Maximizes frontline width for ranged units.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#8e44ad;"><span class="vx" style="background:#8e44ad;"></span></span> <span><strong style="color:#8e44ad;">Box</strong> — Compact square. Good all-purpose formation for mixed armies.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#d35400;"><span class="vx" style="background:#d35400;"></span></span> <span><strong style="color:#d35400;">Wedge</strong> — V-shape. Pierces through enemy lines, strong warriors in front.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#2980b9;"><span class="vx" style="background:#2980b9;"></span></span> <span><strong style="color:#2980b9;">Circle</strong> — Defensive ring. Protects against attacks from all sides.</span></div>
            </div>
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #888;">
            <strong>Rally Points <span class="key" style="font-size:9px;">Y</span>:</strong> Set where new units from a building go after spawning. Press Y to cycle buildings, click a tile to place the flag.
            <strong>Kill:</strong> Permanently remove selected units from the game.
          </div>
          <div style="margin-top: 10px; font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Squad Selection</div>
          <div class="tip"><span class="tip-bullet" style="color:#4a9eff;"><span class="vx" style="background:#4a9eff;"></span></span> <span><strong style="color:#4a9eff;">Type Toggle</strong> — When multiple units are selected, click unit type badges in the tooltip to include/exclude types from the selection. Quickly filter to just melee, just ranged, etc.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#4a9eff;"><span class="vx" style="background:#4a9eff;"></span></span> <span><strong style="color:#4a9eff;">Double-Click</strong> — Double-click a unit to select all units of that type on the map.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#4a9eff;"><span class="vx" style="background:#4a9eff;"></span></span> <span><strong style="color:#4a9eff;">Control Groups</strong> — <span class="key" style="font-size:9px;">Ctrl/⌘</span>+<span class="key" style="font-size:9px;">A/S/D/F/G</span> assigns selected units to squad slots. Press <span class="key" style="font-size:9px;">S/D/F/G</span> alone to recall a squad. <span class="key" style="font-size:9px;">A</span> alone recalls squad A only when no units are selected.</span></div>
          <div style="margin-top: 10px; font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">High Ground</div>
          <div class="tip"><span class="tip-bullet" style="color:#d35400;"><span class="vx" style="background:#d35400;"></span></span> <span><strong style="color:#d35400;">Elevation Bonus</strong> — Units with 3+ elevation advantage get +2 attack. Defenders on high ground get +2 defense. Mountain forts are key strategic positions!</span></div>
        </div>

        <!-- TIPS -->
        <div class="section">
          <div class="section-title" style="color: #9b59b6;"><span class="vx vx-lg" style="background:#9b59b6;"></span> How Magic Works</div>
          <div style="font-size: 12px; color: #ccc; margin-bottom: 8px;">
            Magic units (Mage, Battlemage, Healer) all cast elemental spells. Every attack cycles through 5 elements: Fire, Water, Lightning, Wind, Earth. Some elements leave a <strong>status effect</strong> on the enemy — and when the RIGHT follow-up element hits a unit that already has a status, it triggers a powerful <strong>combo</strong>.
          </div>

          <div style="font-weight: bold; font-size: 12px; color: #2980b9; margin-bottom: 4px;"><span class="vx" style="background:#2980b9;"></span> MAGE — Single-Target Spells</div>
          <div style="font-size: 12px; color: #bbb; margin-bottom: 4px;">
            The Mage is your combo starter. His spells hit one enemy at a time, but the status effects they leave behind are what make him dangerous. Here's how it works:
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#3498db;"><span class="vx" style="background:#3498db;"></span></span> <span><strong>Water spell</strong> — Drenches the target, making them <strong style="color:#3498db;">Wet</strong> for ${GAME_CONFIG.combat.statusEffects.wet.duration} seconds. By itself it does normal damage. But if the NEXT spell that hits a Wet enemy is Lightning...</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#f1c40f;"><span class="vx" style="background:#f1c40f;"></span></span> <span><strong>Lightning + Wet = ELECTROCUTE CRIT</strong> — The Wet status gets consumed and the target explodes with chain lightning that arcs to ${GAME_CONFIG.combat.statusEffects.electrocuteCrit.chainCount} nearby enemies, dealing ${GAME_CONFIG.combat.statusEffects.electrocuteCrit.damageMultiplier}× damage each. Emperor Palpatine style. This is the Mage's only way to do big AoE damage.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#e74c3c;"><span class="vx" style="background:#e74c3c;"></span></span> <span><strong>Fire spell</strong> — Sets the target <strong style="color:#e74c3c;">Ablaze</strong> for ${GAME_CONFIG.combat.statusEffects.ablaze.duration} seconds. They take ${GAME_CONFIG.combat.statusEffects.ablaze.dps} burn damage per second while on fire. But if a Wind spell hits them while they're burning...</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#e67e22;"><span class="vx" style="background:#e67e22;"></span></span> <span><strong>Wind + Ablaze = INFERNO</strong> — The fire gets consumed and erupts into a firestorm that deals ${GAME_CONFIG.combat.statusEffects.inferno.burstDamage} burst damage and spreads Ablaze to ${GAME_CONFIG.combat.statusEffects.inferno.spreadCount} nearby enemies. Now THEY'RE on fire too.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#1abc9c;"><span class="vx" style="background:#1abc9c;"></span></span> <span><strong>Water + Ablaze = SOOTHE (oops!)</strong> — If your Water spell hits an enemy that's already Ablaze, the fire goes out and they get HEALED for ${GAME_CONFIG.combat.statusEffects.soothe.healAmount} HP. This is the anti-synergy — you accidentally helped the enemy. Watch your element cycle!</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#8b6914;"><span class="vx" style="background:#aaa;"></span></span> <span><strong>Earth spell</strong> — Straight damage, no status effect. A safe hit that won't mess up any combos.</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #8e44ad; margin-top: 10px; margin-bottom: 4px;"><span class="vx" style="background:#8e44ad;"></span> BATTLEMAGE — AoE Setup Spells</div>
          <div style="font-size: 12px; color: #bbb; margin-bottom: 4px;">
            The Battlemage hits groups of enemies with low-damage AoE, but his real job is to <strong>set up combos for the Mage</strong>. Alone he's mediocre — paired with a Mage he's devastating.
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#3498db;"><span class="vx" style="background:#3498db;"></span></span> <span><strong>Water AoE</strong> — Splashes a whole group, making them all <strong style="color:#3498db;">Wet</strong>. Low damage on its own, but now a single Mage Lightning spell triggers Electrocute on any of them. That's the dream combo.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#78909c;"><span class="vx" style="background:#78909c;"></span></span> <span><strong>Wind AoE = KNOCKUP</strong> — Launches enemies into the air for ${GAME_CONFIG.combat.statusEffects.knockup.duration}s. They can't move or attack while airborne. Pure crowd control — use it to lock down a group, then follow up with Water or Fire.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#9b59b6;"><span class="vx" style="background:#9b59b6;"></span></span> <span><strong>Lightning AoE = ARCANE</strong> — Marks enemies with purple <strong style="color:#9b59b6;">Arcane</strong> orbs for ${GAME_CONFIG.combat.statusEffects.arcane.duration}s. On its own this does nothing. But when a Mage's Lightning hits an Arcane-marked target...</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#9b59b6;"><span class="vx" style="background:#9b59b6;"></span></span> <span><strong>Lightning + Arcane = KAMEHAMEHA</strong> — The Mage fires a massive piercing laser beam straight through the target and up to ${GAME_CONFIG.combat.statusEffects.kamehameha.pierceCount} enemies behind it in a line, dealing ${GAME_CONFIG.combat.statusEffects.kamehameha.damageMultiplier}× damage to everything it hits. The ultimate cross-class combo.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#e74c3c;"><span class="vx" style="background:#e74c3c;"></span></span> <span><strong>Fire AoE</strong> — Sets the whole group Ablaze, same burn as the Mage's Fire. A Mage's Wind spell on any of them triggers Inferno and spreads fire everywhere.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#8b6914;"><span class="vx" style="background:#aaa;"></span></span> <span><strong>Earth AoE</strong> — Straight AoE damage. No status, no combo — just hits.</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #27ae60; margin-top: 10px; margin-bottom: 4px;"><span class="vx" style="background:#27ae60;"></span> HEALER — Support Spells</div>
          <div style="font-size: 12px; color: #bbb; margin-bottom: 4px;">
            The Healer keeps your team alive and clean. She counts as a mage for group synergies.
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#27ae60;"><span class="vx" style="background:#27ae60;"></span></span> <span><strong>Heal</strong> — Auto-targets the most injured ally in range and fires a healing orb. ${GAME_CONFIG.combat.healer.healAmount} HP per cast.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#ffd700;"><span class="vx" style="background:#ffd700;"></span></span> <span><strong>Cleanse</strong> — When no one needs healing, the Healer cleanses the most debuffed nearby ally. Removes ALL status effects (Wet, Ablaze, Knockup, slows, everything). The cleansed unit gets a <strong style="color:#ffd700;">speed boost</strong> for ${GAME_CONFIG.combat.statusEffects.cleanse.speedBoostDuration}s with a golden trail, and is <strong>immune to status effects</strong> for ${GAME_CONFIG.combat.statusEffects.cleanse.lingerDuration}s after. Cooldown: ${GAME_CONFIG.combat.statusEffects.cleanse.cooldown}s.</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #e91e63; margin-top: 10px; margin-bottom: 4px;"><span class="vx" style="background:#e91e63;"></span> THE KEY COMBOS (cheat sheet)</div>
          <div class="tip"><span class="tip-bullet" style="color:#f1c40f;"><span class="vx" style="background:#f1c40f;"></span></span> <span>Battlemage Water AoE (wets the group) → Mage Lightning (Electrocute Crit chains through all of them)</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#e67e22;"><span class="vx" style="background:#f1c40f;"></span></span> <span>Battlemage Fire AoE (ablaze the group) → Mage Wind (Inferno burst + fire spreads further)</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#9b59b6;"><span class="vx" style="background:#f1c40f;"></span></span> <span>Battlemage Lightning AoE (Arcane marks) → Mage Lightning (Kamehameha laser beam pierces the line)</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#78909c;"><span class="vx" style="background:#f1c40f;"></span></span> <span>Battlemage Wind AoE (Knockup CC) → follow with any other spell while they're helpless in the air</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#e74c3c;"><span class="vx" style="background:#e74c3c;"></span></span> <span><strong>Watch out:</strong> Mage Water + enemy Ablaze = Soothe (heals them). Don't Water a burning enemy by accident!</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#9b59b6;"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Group your casters!</strong> ${GAME_CONFIG.combat.mageSynergy.minMages}+ mages within ${GAME_CONFIG.combat.mageSynergy.proximityRange} hex trigger <strong>Arcane Convergence</strong> — a free AoE burst every ${GAME_CONFIG.combat.mageSynergy.cooldown}s dealing ${GAME_CONFIG.combat.mageSynergy.damagePerMage} damage per mage in the cluster.</span></div>

          <div class="section-title" style="color: #3498db;"><span class="vx vx-lg" style="background:#3498db;"></span> Tips</div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Workers auto-harvest nearby resources when idle — no micro needed!</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Crafting chain: mine iron → craft charcoal (3→Smelter→W) → smelt steel (3→Smelter→Q) → build Armory units (1→Armory)!</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Set stances before sending troops — Defensive units hold chokepoints, Aggressive units push forward.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Use Wedge formation to punch through, Line for ranged volleys, Box for balanced fights.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Use walls to funnel enemies into kill zones.</span></div>
          ${ENABLE_UNDERGROUND ? `
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Lava tubes are natural underground tunnels connecting mountains. Mine gem veins (ruby, emerald, sapphire, amethyst) for crystal — found only in tunnel walls!</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Y-Slicer:</strong> Always available! Use Shift+scroll or the slider to cut through terrain layers. Right-click underground tiles to see block resources. Works without selecting a unit.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Underground Combat:</strong> Units auto-enter tunnels when walking through an entrance and auto-surface when exiting. AI commanders route armies through tunnels for long-distance flanks.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Desert Tunnels Map:</strong> Features 3-4 surface openings, a deep underground network, and a central battle cavern with a capturable neutral outpost.</span></div>
          ` : ''}
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Click on buildings to open a tooltip — queue units, view status, or demolish. Enemy buildings show an <strong style="color:#e74c3c;">Attack</strong> button; bases show a <strong style="color:#27ae60;">Capture Zone</strong> button.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Your units spread their attacks across multiple enemies instead of all targeting one — fewer wasted hits!</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span>Archers automatically flee from melee threats and reposition to maintain range advantage.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Zone Control:</strong> Every base has a 5-hex capture zone. Hold more units in the zone than the enemy to capture it. A progress bar shows capture advancement. Contested zones stall when both sides are present. The zone HUD on the right shows all zones at a glance.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Capture = Victory:</strong> Capturing the enemy's main base wins the game instantly. Neutral outposts flip to your team and you inherit all buildings in the zone. Use Defensive stance to hold zones without getting lured out!</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Building Destruction:</strong> Non-base buildings (Barracks, Armory, etc.) are destructible. Regular units deal 15% damage (min 1) — very tanky! Siege weapons (Trebuchet) deal full damage. Walls and gates are siege-only.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Right-Click Attack:</strong> Right-click an enemy building or wall to send selected units to attack it. Units auto-attack adjacent enemy structures when idle in aggressive/defensive stance.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Capture Zone Button:</strong> When combat units are selected, use the "Capture Zone" action in the command panel to send them to the nearest uncaptured zone in defensive stance.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Unit Stats <span class="key" style="font-size:9px;">I</span>:</strong> Press I to toggle a live unit stats panel showing both teams' alive units with kill counts, levels, HP, and current state.</span></div>
          <!-- Arcane Convergence covered in Magic System section above -->
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>AI Squads:</strong> AI commanders group units into formation squads that march together at a shared speed. Tanks lead, ranged units stay behind, siege follows. This creates cohesive army movements instead of scattered charges.</span></div>
          <div class="tip"><span class="tip-bullet"><span class="vx" style="background:#f0c040;"></span></span> <span><strong>Surface Bases:</strong> Standard maps feature neutral desert outposts and mountain forts. Mountain forts perch on peaks with walkable paths — capture them for high ground advantage!</span></div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 24px; font-size: 11px; color: #666; letter-spacing: 2px;">
          PRESS <span class="key" style="font-size: 11px;">?</span> ANYTIME TO TOGGLE THIS SCREEN
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Click overlay background to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hideHelp();
    });

    return overlay;
  }

  private setupHelpToggle(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        this.toggleHelp();
      }
      if (e.key === 'Escape' && this.helpVisible) {
        this.hideHelp();
      }
    });
  }

  toggleHelp(): void {
    if (this.helpVisible) {
      this.hideHelp();
    } else {
      this.showHelp();
    }
  }

  showHelp(): void {
    if (this.helpOverlay) {
      // Lazily render unit portraits on first open
      if (!this.helpPortraitsLoaded) {
        this.helpPortraitsLoaded = true;
        const imgs = this.helpOverlay.querySelectorAll<HTMLImageElement>('img[data-unit-portrait]');
        imgs.forEach((img) => {
          const unitType = img.dataset.unitPortrait as UnitType;
          if (unitType) {
            img.src = getUnitPortrait(unitType);
          }
        });
      }
      this.helpOverlay.style.display = 'block';
      this.helpVisible = true;
      StrategyCamera.suppressInput = true;
      localStorage.setItem('cubitopia_seen_help', '1');
      this._onHelpOpen?.();
    }
  }

  hideHelp(): void {
    if (this.helpOverlay) {
      this.helpOverlay.style.display = 'none';
      this.helpVisible = false;
      StrategyCamera.suppressInput = false;
      this._onHelpClose?.();
    }
  }

  isHelpVisible(): boolean {
    return this.helpVisible;
  }

  update(): void {
    // Called each frame — can be used for animations or time display
  }

  setGameMode(mode: 'pvai' | 'aivai' | 'ffa' | '2v2' | 'pvp'): void {
    const labels: Record<string, [string, string]> = {
      'pvai': ['Player vs AI', '#3498db'],
      'aivai': ['AI vs AI', '#e74c3c'],
      'ffa': ['Free-For-All', '#2ecc71'],
      '2v2': ['2v2 Teams', '#f39c12'],
      'pvp': ['Ranked PvP', '#e74c3c'],
    };
    const [label, color] = labels[mode] ?? ['Unknown', '#888'];
    this.elements.titleBar.innerHTML = `<strong>CUBITOPIA</strong><br><span style="font-size:12px;color:${color}">${label}</span>`;
  }

  onNewMap(callback: () => void): void {
    this._onNewMap = callback;
    this.elements.newMapButton.addEventListener('click', callback);
  }

  // --- Terrain Info Panel ---
  private terrainInfoPanel: HTMLElement | null = null;
  private terrainInfoTimeout: ReturnType<typeof setTimeout> | null = null;

  showTerrainInfo(tile: Tile): void {
    if (!this.terrainInfoPanel) {
      this.terrainInfoPanel = document.createElement('div');
      this.terrainInfoPanel.style.cssText = `
        position: absolute; top: 80px; left: 16px;
        ${UI.panel()}; padding: 12px 16px;
        min-width: 180px; pointer-events: none; z-index: 10001;
        transition: opacity 0.2s;
      `;
      this.container.appendChild(this.terrainInfoPanel);
    }

    // Clear any pending hide timeout
    if (this.terrainInfoTimeout) {
      clearTimeout(this.terrainInfoTimeout);
      this.terrainInfoTimeout = null;
    }

    const terrainName = this.getTerrainName(tile.terrain);
    const terrainColor = this.getTerrainColor(tile.terrain);
    const moveCost = this.getMoveCost(tile.terrain);
    const defBonus = this.getDefenseBonus(tile.terrain);
    const atkBonus = this.getAttackBonus(tile.terrain);
    const hasResource = !!tile.resource;
    const resourceStr = hasResource ? this.getResourceName(tile.resource!) : '';
    const elevStr = tile.elevation;

    let modifiers = '';

    // ── Movement info ──
    if (tile.terrain === TerrainType.WATER) {
      modifiers += `<div style="color:#e74c3c;">✗ Impassable (deep water)</div>`;
    } else if (tile.terrain === TerrainType.RIVER) {
      modifiers += `<div style="color:#e74c3c;">✗ Impassable (river current)</div>`;
    } else if (tile.terrain === TerrainType.LAKE) {
      modifiers += `<div style="color:#e74c3c;">✗ Impassable (deep lake)</div>`;
    } else if (tile.terrain === TerrainType.WATERFALL) {
      modifiers += `<div style="color:#e74c3c;">✗ Impassable (waterfall)</div>`;
    } else if (moveCost > 1) {
      modifiers += `<div style="color:#f39c12;">⚠ Slow movement (${moveCost}x cost)</div>`;
    } else {
      modifiers += `<div style="color:#2ecc71;">✓ Normal movement</div>`;
    }

    // ── Combat bonuses ──
    if (defBonus > 0) modifiers += `<div style="color:#3498db;">🛡 Defense bonus: +${defBonus}</div>`;
    if (defBonus < 0) modifiers += `<div style="color:#e74c3c;">🛡 Defense penalty: ${defBonus}</div>`;
    if (atkBonus > 0) modifiers += `<div style="color:#e67e22;">⚔ Attack bonus: +${atkBonus} (high ground)</div>`;
    if (atkBonus < 0) modifiers += `<div style="color:#e74c3c;">⚔ Attack penalty: ${atkBonus}</div>`;

    // ── Terrain-specific resource info (one line per terrain, no duplicates) ──
    if (tile.terrain === TerrainType.PLAINS) {
      modifiers += `<div style="color:#8bc34a;">🌾 Farmable (food from grass)</div>`;
    } else if (tile.terrain === TerrainType.FOREST) {
      modifiers += `<div style="color:#27ae60;">🌲 Harvestable (wood)</div>`;
    } else if (tile.terrain === TerrainType.MOUNTAIN) {
      if (tile.resource === ResourceType.IRON) {
        modifiers += `<div style="color:#c0652a;">⛏ Rich iron ore deposits</div>`;
      } else if (tile.resource === ResourceType.CRYSTAL) {
        modifiers += `<div style="color:#9b59b6;">💎 Crystal deposits</div>`;
      } else {
        modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone, iron veins)</div>`;
      }
    } else if (tile.terrain === TerrainType.SNOW) {
      modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone)</div>`;
    } else if (tile.terrain === TerrainType.DESERT) {
      if (tile.resource === ResourceType.GOLD) {
        modifiers += `<div style="color:#f0c040;">💰 Gold deposits</div>`;
      } else {
        modifiers += `<div style="color:#f0c040;">⛏ Mineable (clay, stone)</div>`;
      }
    } else if (tile.terrain === TerrainType.JUNGLE) {
      modifiers += `<div style="color:#2d6b30;">🌲 Harvestable (wood — lumberjacks)</div>`;
    } else if (tile.terrain === TerrainType.WATERFALL) {
      modifiers += `<div style="color:#42a5f5;">💧 Cascading water</div>`;
    }

    // Tunnel info with block breakdown
    if (tile.hasTunnel) {
      modifiers += `<div style="color:#ff6600; margin-top:4px;">🕳 Underground tunnel (floor Y: ${tile.tunnelFloorY})</div>`;
      // Scan blocks for resource summary
      const blockCounts: Record<string, number> = {};
      for (const b of tile.voxelData.blocks) {
        const label = this.getBlockLabel(b.type);
        blockCounts[label] = (blockCounts[label] || 0) + 1;
      }
      const gemKeys = Object.keys(blockCounts).filter(k => k.includes('Gem'));
      if (gemKeys.length > 0) {
        for (const gk of gemKeys) {
          modifiers += `<div style="color:#9b59b6;">💎 ${gk} x${blockCounts[gk]} (yields crystal)</div>`;
        }
      }
      const stoneCount = blockCounts['Stone'] || 0;
      const ironCount = blockCounts['Iron'] || 0;
      if (ironCount > 0) modifiers += `<div style="color:#c0652a;">⛏ Iron blocks x${ironCount}</div>`;
      if (stoneCount > 0) modifiers += `<div style="color:#95a5a6;">⛏ Stone blocks x${stoneCount}</div>`;
    }

    this.terrainInfoPanel.innerHTML = `
      <div style="font-weight:bold; font-size:15px; color:${terrainColor}; margin-bottom:6px;">${terrainName}</div>
      <div style="margin-bottom:4px;">📍 Tile (${tile.position.q}, ${tile.position.r})</div>
      <div style="margin-bottom:${hasResource ? '4' : '6'}px;">📐 Elevation: ${elevStr}</div>
      ${hasResource ? `<div style="margin-bottom:6px;">💎 Resource: ${resourceStr}</div>` : ''}
      <div style="border-top:1px solid rgba(255,255,255,0.15); padding-top:6px;">
        ${modifiers || '<div style="color:#888;">No special modifiers</div>'}
      </div>
    `;
    this.terrainInfoPanel.style.display = 'block';
    this.terrainInfoPanel.style.opacity = '1';

    // Auto-hide after 4 seconds
    this.terrainInfoTimeout = setTimeout(() => {
      if (this.terrainInfoPanel) {
        this.terrainInfoPanel.style.opacity = '0';
        setTimeout(() => {
          if (this.terrainInfoPanel) this.terrainInfoPanel.style.display = 'none';
        }, 200);
      }
    }, 4000);
  }

  hideTerrainInfo(): void {
    if (this.terrainInfoPanel) {
      this.terrainInfoPanel.style.display = 'none';
    }
    if (this.terrainInfoTimeout) {
      clearTimeout(this.terrainInfoTimeout);
      this.terrainInfoTimeout = null;
    }
  }

  private getBlockLabel(type: string): string {
    switch (type) {
      case BlockType.GRASS: return 'Grass';
      case BlockType.DIRT: return 'Dirt';
      case BlockType.STONE: return 'Stone';
      case BlockType.SAND: return 'Sand';
      case BlockType.SNOW: return 'Snow';
      case BlockType.WOOD: return 'Wood';
      case BlockType.JUNGLE: return 'Jungle Wood';
      case BlockType.IRON: return 'Iron';
      case BlockType.GOLD: return 'Gold';
      case BlockType.WATER: return 'Water';
      case BlockType.CLAY: return 'Clay';
      case BlockType.WALL: return 'Wall';
      case BlockType.GEM_RUBY: return 'Gem (Ruby)';
      case BlockType.GEM_EMERALD: return 'Gem (Emerald)';
      case BlockType.GEM_SAPPHIRE: return 'Gem (Sapphire)';
      case BlockType.GEM_AMETHYST: return 'Gem (Amethyst)';
      default: return type;
    }
  }

  private getTerrainName(t: TerrainType): string {
    switch (t) {
      case TerrainType.PLAINS: return '🌾 Plains';
      case TerrainType.FOREST: return '🌲 Forest';
      case TerrainType.MOUNTAIN: return '⛰️ Mountain';
      case TerrainType.WATER: return '🌊 Water';
      case TerrainType.DESERT: return '🏜️ Desert';
      case TerrainType.SNOW: return '❄️ Snow';
      case TerrainType.JUNGLE: return '🌴 Jungle';
      case TerrainType.RIVER: return '🏞️ River';
      case TerrainType.LAKE: return '🏊 Lake';
      case TerrainType.WATERFALL: return '💧 Waterfall';
      default: return 'Unknown';
    }
  }

  private getTerrainColor(t: TerrainType): string {
    switch (t) {
      case TerrainType.PLAINS: return '#8bc34a';
      case TerrainType.FOREST: return '#27ae60';
      case TerrainType.MOUNTAIN: return '#95a5a6';
      case TerrainType.WATER: return '#3498db';
      case TerrainType.DESERT: return '#f0c040';
      case TerrainType.SNOW: return '#ecf0f1';
      case TerrainType.JUNGLE: return '#2d6b30';
      case TerrainType.RIVER: return '#1e88e5';
      case TerrainType.LAKE: return '#1565c0';
      case TerrainType.WATERFALL: return '#42a5f5';
      default: return '#ddd';
    }
  }

  private getMoveCost(t: TerrainType): number {
    switch (t) {
      case TerrainType.PLAINS: return 1;
      case TerrainType.FOREST: return 3;
      case TerrainType.DESERT: return 1.5;
      case TerrainType.JUNGLE: return 2.5;
      case TerrainType.SNOW: return 2;
      case TerrainType.MOUNTAIN: return 1;
      case TerrainType.RIVER: return -2;
      case TerrainType.LAKE: return -2;
      case TerrainType.WATERFALL: return -3;
      default: return 1;
    }
  }

  private getDefenseBonus(t: TerrainType): number {
    switch (t) {
      case TerrainType.FOREST: return 2;
      case TerrainType.MOUNTAIN: return 3;
      case TerrainType.JUNGLE: return 2;
      case TerrainType.RIVER: return -1;
      case TerrainType.LAKE: return -1;
      case TerrainType.WATERFALL: return -2;
      default: return 0;
    }
  }

  private getAttackBonus(t: TerrainType): number {
    switch (t) {
      case TerrainType.MOUNTAIN: return 1; // High ground advantage
      case TerrainType.JUNGLE: return -1;
      case TerrainType.RIVER: return -2;
      case TerrainType.LAKE: return -2;
      case TerrainType.WATERFALL: return -3;
      default: return 0;
    }
  }

  private getResourceName(r: ResourceType): string {
    switch (r) {
      case ResourceType.FOOD: return '🌾 Food';
      case ResourceType.WOOD: return '🪵 Wood';
      case ResourceType.STONE: return '🪨 Stone';
      case ResourceType.IRON: return '⚙️ Iron';
      case ResourceType.GOLD: return '💰 Gold';
      case ResourceType.CRYSTAL: return '💎 Crystal';
      case ResourceType.GRASS_FIBER: return '🌿 Grass Fiber';
      case ResourceType.CLAY: return '🧱 Clay';
      case ResourceType.ROPE: return '🪢 Rope';
      default: return 'Unknown';
    }
  }

  private getUnitDescription(type: string): string {
    switch (type) {
      case UnitType.WARRIOR: return 'Frontline infantry. Balanced stats for general combat.';
      case UnitType.ARCHER: return 'Ranged attacker. Fragile but strikes from 4 hexes away.';
      case UnitType.RIDER: return 'Fast cavalry. High mobility for flanking and raiding.';
      case UnitType.PALADIN: return 'Holy knight. Aura buffs nearby allies with bonus defense.';
      case UnitType.TREBUCHET: return 'Siege engine. Devastating ranged damage, extremely slow.';
      case UnitType.SCOUT: return 'Recon specialist. Fastest unit, huge vision range.';
      case UnitType.MAGE: return 'Combo caster. Cycles elements to apply and consume statuses for big damage.';
      case UnitType.BUILDER: return 'Engineer. Constructs buildings and walls. High carry capacity.';
      case UnitType.LUMBERJACK: return 'Woodcutter. Harvests trees for wood resources.';
      case UnitType.VILLAGER: return 'Farmer. Harvests farms and wild grass for food.';
      case UnitType.HEALER: return 'Support mage. Heals allies and cleanses debuffs with speed boost.';
      case UnitType.ASSASSIN: return 'Stealth striker. Massive damage from full HP, unblockable.';
      case UnitType.SHIELDBEARER: return 'Heavy tank. Absorbs ranged fire and blocks melee hits.';
      case UnitType.BERSERKER: return 'Rage fighter. Grows stronger as health drops. Throws axes.';
      case UnitType.BATTLEMAGE: return 'AoE setup caster. Weak splash damage but applies status effects for Mage combos.';
      case UnitType.GREATSWORD: return 'Cleave warrior. Hits all adjacent enemies with knockback.';
      case UnitType.OGRE: return 'Reward brute. Massive HP, club swipe hits all in 2-hex radius.';
      case UnitType.CHAMPION: return 'Citadel reward. Elite war hammer knight with AoE ground slam.';
      default: return '';
    }
  }

  private getUnitPassives(type: string): string[] {
    switch (type) {
      case UnitType.WARRIOR: return [];
      case UnitType.ARCHER: return [];
      case UnitType.RIDER: return ['High mobility (4 move, 3.0 speed)'];
      case UnitType.PALADIN: return [
        'Holy Aura: +2 DEF to all allies within 2 hexes (stacks with other Paladins)',
        'Can block melee attacks (+15% bonus)',
      ];
      case UnitType.TREBUCHET: return [
        'Siege: Damages walls and buildings',
        'Range 6, but 0 DEF and very slow',
      ];
      case UnitType.SCOUT: return [
        'Detection range: 7 hexes (highest)',
        '5 movement, 3.5 speed (fastest unit)',
      ];
      case UnitType.MAGE: return [
        'Elemental Cycle: Fire → Water → Lightning → Wind → Earth',
        'Single-target ranged magic at 4 hexes',
        'Combos: Wet+⚡=Electrocute, Ablaze+🌪=Inferno, Arcane+⚡=Kamehameha',
      ];
      case UnitType.BUILDER: return [
        'Builds structures and walls',
        'Carry capacity: 8 (highest)',
      ];
      case UnitType.LUMBERJACK: return [
        'Chops trees for wood (3s cooldown)',
        'Carry capacity: 6',
      ];
      case UnitType.VILLAGER: return [
        'Farms food from farms (4s) and wild grass (2.5s)',
        'Carry capacity: 5',
      ];
      case UnitType.HEALER: return [
        'Auto-heals most injured ally within 3 hexes',
        'Heals 3 HP per cast (2s cooldown)',
        `Cleanse: Removes all debuffs, grants ${GAME_CONFIG.combat.statusEffects.cleanse.speedBoostDuration}s speed boost + ${GAME_CONFIG.combat.statusEffects.cleanse.lingerDuration}s status immunity`,
        'Cannot attack enemies',
      ];
      case UnitType.ASSASSIN: return [
        'Ambush: +3 ATK when striking from full HP',
        'Attacks cannot be blocked',
      ];
      case UnitType.SHIELDBEARER: return [
        'Deflect: 80% reduced ranged damage',
        'Shield Block: +15% melee block chance',
        'Shield Bash: Knocks target back 1 hex',
      ];
      case UnitType.BERSERKER: return [
        'Rage: Up to +4 ATK as health drops',
        'Axe Throw: 1 ranged opener per target (range 7, 40% ATK)',
      ];
      case UnitType.BATTLEMAGE: return [
        `AoE Splash: ${Math.round(GAME_CONFIG.combat.battlemage.splashDamageMultiplier * 100)}% ATK to enemies within 1 hex of target`,
        'Cycle: Ablaze → Wet → High Voltage → Knockup → Arcane',
        'High Voltage: Electrocute chains trigger arc cascade + stun (120% crit)',
        'Arcane: consumed by Mage Lightning for Kamehameha laser',
      ];
      case UnitType.GREATSWORD: return [
        'Cleave: Hits all enemies in 1-hex radius (60% ATK)',
        'Knockback: All hit enemies pushed back 1 hex',
      ];
      case UnitType.OGRE: return [
        'Club Swipe: AOE hits all in 2-hex radius (70% ATK)',
        'Knockback on all hit enemies',
        'Siege: Damages walls and buildings',
        'Cannot be trained — spawns at base tier-up',
      ];
      case UnitType.CHAMPION: return [
        `Hammer Slam: AoE ground pound (${Math.round(GAME_CONFIG.combat.champion.hammerSlamDamageMultiplier * 100)}% ATK) within ${GAME_CONFIG.combat.champion.hammerSlamRadius}-hex radius`,
        'Cannot be trained — spawns at Citadel tier-up',
      ];
      default: return [];
    }
  }

  // ===================== DEBUG FLAGS =====================
  // These flags are read by main.ts game logic. The debug UI that toggles
  // them now lives in DebugPanel.ts (unified tabbed panel).

  debugFlags: {
    freeBuild: boolean;       // Spawn units without resource costs
    freePlace: boolean;       // Place buildings without resource costs
    infiniteResources: boolean; // Set all resources to 999
    disableChop: boolean;     // Disable lumberjack auto-chop
    disableMine: boolean;     // Disable builder auto-mine
    disableHarvest: boolean;  // Disable villager auto-harvest
    disableBuild: boolean;    // Disable builder auto-build walls
    disableDeposit: boolean;  // Disable all resource deposits
    disableCombat: boolean;   // Disable all combat/attacks
    disableAI: boolean;       // Disable AI commander
    disableAutoReturn: boolean; // Disable auto-return to stockpile
    disableGrassGrowth: boolean; // Disable grass growth/spreading
    disableTreeGrowth: boolean;  // Disable tree regrowth
    instantSpawn: boolean;    // Spawn units instantly (no timer)
    godMode: boolean;         // Player units take no damage
    showUnitOverlay: boolean; // Show HP/state on all units
    teleportMode: boolean;    // Click to teleport selected units
  } = {
    freeBuild: false,
    freePlace: false,
    infiniteResources: false,
    disableChop: false,
    disableMine: false,
    disableHarvest: false,
    disableBuild: false,
    disableDeposit: false,
    disableCombat: false,
    disableAI: false,
    disableAutoReturn: false,
    disableGrassGrowth: false,
    disableTreeGrowth: false,
    instantSpawn: false,
    godMode: false,
    showUnitOverlay: false,
    teleportMode: false,
  };
  gameSpeed = 1;

  debugSpawnCount = 1;

  // NOTE: Old debug panel UI (buildDebugPanel, toggleDebugPanel, rebuildDebugContent)
  // has been removed. All debug UI is now handled by DebugPanel.ts (unified tabbed panel).
  // The debugFlags, gameSpeed, and debugSpawnCount properties remain here because
  // they are referenced throughout main.ts game logic.

  // === ELEVATION SLICER (custom click-and-drag track) ===
  private slicerContainer: HTMLElement | null = null;
  private slicerTrack: HTMLElement | null = null;
  private slicerThumb: HTMLElement | null = null;
  private slicerLabel: HTMLElement | null = null;
  private _onSliceChange: ((y: number | null) => void) | null = null;
  private _slicerMinY = -40;
  private _slicerMaxY = 25;
  private _slicerValue: number | null = null; // null = ALL
  private _slicerDragging = false;
  private _slicerAudioCtx: AudioContext | null = null;
  private _slicerRafPending = false;
  private _slicerPendingY: number | null | undefined = undefined; // undefined = no pending

  set onSliceChange(cb: ((y: number | null) => void) | null) { this._onSliceChange = cb; }

  /** Play a short satisfying "thwip" tick sound pitched to current elevation.
   *  High elevations → bright high pitch, deep underground → low rumble. */
  private playSlicerThwip(): void {
    try {
      if (!this._slicerAudioCtx) {
        this._slicerAudioCtx = new AudioContext();
      }
      const ctx = this._slicerAudioCtx;
      const now = ctx.currentTime;

      // Map current slicer Y to 0..1 range (0 = deepest, 1 = highest)
      const y = this._slicerValue ?? this._slicerMaxY;
      const t = Math.max(0, Math.min(1,
        (y - this._slicerMinY) / (this._slicerMaxY - this._slicerMinY)
      ));

      // Frequency spectrum: 800 Hz (deep lava) → 2800 Hz (bright sun)
      const baseFreq = 800 + t * 2000;
      const endFreq = Math.max(400, baseFreq * 0.35);

      // Quick pitched click — snappy thwip with elevation-mapped pitch
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.04);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);

      // Tiny noise burst for texture — heavier at low elevations
      const noiseDur = 0.01 + (1 - t) * 0.015;
      const bufSize = Math.floor(ctx.sampleRate * noiseDur);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      const noise = ctx.createBufferSource();
      const nGain = ctx.createGain();
      noise.buffer = buf;
      nGain.gain.setValueAtTime(0.02 + (1 - t) * 0.04, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur + 0.01);
      noise.connect(nGain).connect(ctx.destination);
      noise.start(now);
    } catch { /* Audio not available — silent fallback */ }
  }

  private slicerYFromMouseY(clientY: number): number | null {
    if (!this.slicerTrack) return null;
    const rect = this.slicerTrack.getBoundingClientRect();
    // top of track = maxY+1 (ALL), bottom = minY
    const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    // fraction 0 = top (ALL/maxY), fraction 1 = bottom (minY)
    const totalSteps = this._slicerMaxY + 1 - this._slicerMinY; // +1 for ALL slot
    const step = Math.round(fraction * totalSteps);
    const y = this._slicerMaxY + 1 - step; // invert: top=max, bottom=min
    if (y > this._slicerMaxY) return null; // ALL
    return Math.max(this._slicerMinY, Math.min(this._slicerMaxY, y));
  }

  private applySlicerValue(y: number | null): void {
    if (y === this._slicerValue) return;
    this.playSlicerThwip();
    this._slicerValue = y;
    this.updateSlicerVisuals();
    this._onSliceChange?.(y);
  }

  /** Drag-optimized: thumb + label update instantly, heavy slice callback is RAF-batched */
  private applySlicerValueSmooth(y: number | null): void {
    if (y === this._slicerValue) return;
    // Instant visual feedback — thumb follows mouse with zero delay
    this.playSlicerThwip();
    this._slicerValue = y;
    this.updateSlicerVisuals();
    // Batch the expensive world-slice callback to once per frame
    this._slicerPendingY = y;
    if (this._slicerRafPending) return;
    this._slicerRafPending = true;
    requestAnimationFrame(() => {
      this._slicerRafPending = false;
      if (this._slicerPendingY !== undefined) {
        this._onSliceChange?.(this._slicerPendingY as number | null);
        this._slicerPendingY = undefined;
      }
    });
  }

  private updateSlicerVisuals(): void {
    if (!this.slicerLabel || !this.slicerThumb || !this.slicerTrack) return;
    const y = this._slicerValue;
    if (y === null) {
      this.slicerLabel.textContent = 'ALL';
      this.slicerLabel.style.color = '#ff8c00';
      this.slicerThumb.style.top = '0%';
    } else {
      this.slicerLabel.textContent = `Y:${y}`;
      this.slicerLabel.style.color = '#00ccff';
      const totalSteps = this._slicerMaxY + 1 - this._slicerMinY;
      const pct = ((this._slicerMaxY + 1 - y) / totalSteps) * 100;
      this.slicerThumb.style.top = `${pct}%`;
    }
  }

  showElevationSlicer(show: boolean, maxY = 25, minY = -40): void {
    if (!show) {
      if (this.slicerContainer) this.slicerContainer.style.display = 'none';
      return;
    }

    this._slicerMinY = minY;
    this._slicerMaxY = maxY;

    if (!this.slicerContainer) {
      this.slicerContainer = document.createElement('div');
      this.slicerContainer.style.cssText = `
        position: absolute; right: 12px; bottom: 90px;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        background: rgba(0,0,0,0.8); padding: 10px 8px; border-radius: 8px;
        border: 2px solid #ff8c00; z-index: 100; user-select: none;
        pointer-events: auto;
      `;

      // Block mouse events from propagating through to the game canvas.
      for (const evt of ['mousedown', 'click', 'dblclick', 'contextmenu', 'wheel'] as const) {
        this.slicerContainer.addEventListener(evt, (e) => { e.stopPropagation(); });
      }

      // "SLICE" label
      const topLabel = document.createElement('div');
      topLabel.style.cssText = 'color: #ff8c00; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;';
      topLabel.textContent = 'SLICE';
      this.slicerContainer.appendChild(topLabel);

      // Current Y label
      this.slicerLabel = document.createElement('div');
      this.slicerLabel.style.cssText = 'color: #ff8c00; font-size: 16px; font-weight: bold; width: 52px; text-align: center;';
      this.slicerLabel.textContent = 'ALL';
      this.slicerContainer.appendChild(this.slicerLabel);

      // Custom vertical track — themed gradient representing world layers:
      // Top: sun/sky → clouds → treetops → grass → dirt → stone → deep rock → gems/lava
      this.slicerTrack = document.createElement('div');
      this.slicerTrack.style.cssText = `
        position: relative; width: 28px; height: 260px; cursor: pointer;
        border-radius: 14px; border: 1px solid #555;
        background: linear-gradient(to bottom,
          #FFD700 0%,
          #FFA500 3%,
          #87CEEB 8%,
          #6CB4EE 13%,
          #B0C4DE 17%,
          #9E9E9E 21%,
          #8D8D8D 25%,
          #A9A9A9 28%,
          #228B22 33%,
          #2E8B57 38%,
          #3CB371 42%,
          #8B7355 50%,
          #A0522D 56%,
          #6B4226 62%,
          #808080 70%,
          #696969 76%,
          #505050 82%,
          #383838 86%,
          #4B0082 91%,
          #9400D3 95%,
          #FF4500 98%,
          #FF2200 100%
        );
      `;

      // Layer icons along the track (positioned absolutely)
      const icons = [
        { emoji: '☀️', top: '2%' },
        { emoji: '☁️', top: '15%' },
        { emoji: '⛰️', top: '25%' },
        { emoji: '🌲', top: '36%' },
        { emoji: '🌿', top: '46%' },
        { emoji: '🪨', top: '58%' },
        { emoji: '⛏️', top: '73%' },
        { emoji: '💎', top: '88%' },
        { emoji: '🔥', top: '98%' },
      ];
      for (const icon of icons) {
        const el = document.createElement('div');
        el.style.cssText = `
          position: absolute; left: -18px; top: ${icon.top}; transform: translateY(-50%);
          font-size: 12px; pointer-events: none; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
        `;
        el.textContent = icon.emoji;
        this.slicerTrack.appendChild(el);
      }

      // Thumb indicator
      this.slicerThumb = document.createElement('div');
      this.slicerThumb.style.cssText = `
        position: absolute; left: -6px; width: 40px; height: 6px;
        background: #00ccff; border-radius: 3px; pointer-events: none;
        transform: translateY(-50%); top: 0%;
        box-shadow: 0 0 8px rgba(0, 204, 255, 0.7), 0 0 3px rgba(0, 204, 255, 0.4);
        transition: top 0.08s cubic-bezier(0.22, 1, 0.36, 1);
      `;
      this.slicerTrack.appendChild(this.slicerThumb);

      // Click-and-drag handlers on the track
      const onDrag = (e: MouseEvent) => {
        if (!this._slicerDragging) return;
        e.preventDefault();
        this.applySlicerValueSmooth(this.slicerYFromMouseY(e.clientY));
      };
      const onUp = () => {
        this._slicerDragging = false;
        // Re-enable smooth transition after drag ends
        if (this.slicerThumb) this.slicerThumb.style.transition = 'top 0.08s cubic-bezier(0.22, 1, 0.36, 1)';
        window.removeEventListener('mousemove', onDrag);
        window.removeEventListener('mouseup', onUp);
      };
      this.slicerTrack.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._slicerDragging = true;
        // Kill transition during drag — thumb tracks mouse instantly
        if (this.slicerThumb) this.slicerThumb.style.transition = 'none';
        this.applySlicerValueSmooth(this.slicerYFromMouseY(e.clientY));
        window.addEventListener('mousemove', onDrag);
        window.addEventListener('mouseup', onUp);
      });

      this.slicerContainer.appendChild(this.slicerTrack);

      // Depth labels along the side
      const labelBar = document.createElement('div');
      labelBar.style.cssText = 'display: flex; justify-content: space-between; width: 100%; padding: 0 2px;';
      const topNum = document.createElement('span');
      topNum.style.cssText = 'color: #888; font-size: 9px;';
      topNum.textContent = `${maxY}`;
      const botNum = document.createElement('span');
      botNum.style.cssText = 'color: #888; font-size: 9px;';
      botNum.textContent = `${minY}`;
      labelBar.appendChild(topNum);
      labelBar.appendChild(botNum);
      this.slicerContainer.appendChild(labelBar);

      this.container.appendChild(this.slicerContainer);
    }

    this.slicerContainer.style.display = 'flex';
    // Reset to "ALL"
    this._slicerValue = null;
    this.updateSlicerVisuals();
  }

  /** Programmatically set the slicer value (e.g. from Shift+scroll) */
  setSlicerValue(y: number | null, _maxY = 25): void {
    if (y !== this._slicerValue) {
      this.playSlicerThwip();
    }
    this._slicerValue = y;
    this.updateSlicerVisuals();
  }

  // --- Unit Stats Panel (toggleable with 'I' key) ---
  private unitStatsPanel: HTMLElement | null = null;
  private unitStatsPanelVisible = false;

  toggleUnitStatsPanel(): void {
    this.unitStatsPanelVisible = !this.unitStatsPanelVisible;
    if (this.unitStatsPanel) {
      this.unitStatsPanel.style.display = this.unitStatsPanelVisible ? 'block' : 'none';
    }
  }

  updateUnitStatsPanel(allUnits: Unit[], deadUnitKills?: number[]): void {
    if (!this.unitStatsPanelVisible) return;

    if (!this.unitStatsPanel) {
      this.unitStatsPanel = document.createElement('div');
      this.unitStatsPanel.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        ${UI.panel(COLORS.borderHover)}; padding: 16px;
        min-width: 600px; max-height: 80vh; overflow-y: auto; pointer-events: auto; z-index: 500;
      `;
      document.body.appendChild(this.unitStatsPanel);
    }
    this.unitStatsPanel.style.display = 'block';

    // Build team data — dynamic for N players
    const teams: { [owner: number]: { alive: Unit[]; dead: Unit[]; totalKills: number } } = {};
    for (const u of allUnits) {
      if (!teams[u.owner]) {
        teams[u.owner] = { alive: [], dead: [], totalKills: deadUnitKills?.[u.owner] ?? 0 };
      }
    }

    for (const u of allUnits) {
      const team = teams[u.owner];
      if (u.state === 'dead') {
        team.dead.push(u);
      } else {
        team.alive.push(u);
      }
      team.totalKills += (u.kills ?? 0);
    }

    // Sort alive units: combat first (by kills desc), then workers
    const workerTypes = new Set([UnitType.BUILDER, UnitType.LUMBERJACK, UnitType.VILLAGER]);
    const sortUnits = (units: Unit[]) => units.sort((a, b) => {
      const aWorker = workerTypes.has(a.type) ? 1 : 0;
      const bWorker = workerTypes.has(b.type) ? 1 : 0;
      if (aWorker !== bWorker) return aWorker - bWorker;
      return (b.kills ?? 0) - (a.kills ?? 0);
    });

    const typeColors: Record<string, string> = {
      warrior: '#c0392b', archer: '#8e44ad', rider: '#d35400', paladin: '#3498db',
      mage: '#2980b9', trebuchet: '#5d4037', scout: '#1abc9c',
      healer: '#27ae60', assassin: '#2c3e50', shieldbearer: '#7f8c8d', berserker: '#e74c3c',
      battlemage: '#9b59b6', greatsword: '#546e7a', builder: '#b8860b', lumberjack: '#6d4c41',
      villager: '#daa520',
    };

    const renderTeam = (owner: number, label: string, color: string) => {
      const team = teams[owner];
      sortUnits(team.alive);
      let html = `<div style="margin-bottom:12px;">`;
      html += `<div style="font-size:14px;font-weight:bold;color:${color};margin-bottom:6px;border-bottom:1px solid ${color}44;padding-bottom:4px;">`;
      html += `${label} — ${team.alive.length} alive, ${team.dead.length} dead — ${team.totalKills} total kills</div>`;

      if (team.alive.length === 0) {
        html += `<div style="color:#666;font-style:italic;">No units alive</div>`;
      } else {
        html += `<table style="width:100%;border-collapse:collapse;">`;
        html += `<tr style="color:#888;font-size:11px;text-align:left;">`;
        html += `<th style="padding:2px 6px;">Type</th><th style="padding:2px 4px;">Lv</th>`;
        html += `<th style="padding:2px 4px;">HP</th><th style="padding:2px 4px;">Kills</th>`;
        html += `<th style="padding:2px 4px;">State</th></tr>`;

        for (const u of team.alive) {
          const tc = typeColors[u.type] || '#aaa';
          const hpPct = Math.round((u.currentHealth / u.stats.maxHealth) * 100);
          const hpColor = hpPct > 60 ? '#2ecc71' : hpPct > 30 ? '#f39c12' : '#e74c3c';
          const killStr = (u.kills ?? 0) > 0 ? `<span style="color:#e74c3c;font-weight:bold;">${u.kills}</span>` : '0';
          const stateStr = u.state === 'idle' ? '<span style="color:#666;">idle</span>' :
                           u.state === 'attacking' ? '<span style="color:#e74c3c;">fighting</span>' :
                           u.state === 'moving' ? '<span style="color:#3498db;">moving</span>' :
                           `<span style="color:#888;">${u.state}</span>`;
          html += `<tr style="border-bottom:1px solid #222;">`;
          html += `<td style="padding:2px 6px;color:${tc};">${u.type}</td>`;
          html += `<td style="padding:2px 4px;text-align:center;">${u.level}</td>`;
          html += `<td style="padding:2px 4px;color:${hpColor};">${u.currentHealth}/${u.stats.maxHealth} (${hpPct}%)</td>`;
          html += `<td style="padding:2px 4px;text-align:center;">${killStr}</td>`;
          html += `<td style="padding:2px 4px;">${stateStr}</td></tr>`;
        }
        html += `</table>`;
      }
      html += `</div>`;
      return html;
    };

    let panelHtml = `<div style="text-align:center;font-size:16px;font-weight:bold;color:#fff;margin-bottom:8px;">
      UNIT STATS <span style="font-size:11px;color:#666;">(press I to close)</span></div>`;
    panelHtml += `<div style="display:flex;gap:16px;">`;
    panelHtml += `<div style="flex:1;">${renderTeam(0, 'BLUE TEAM (P1)', '#3498db')}</div>`;
    panelHtml += `<div style="flex:1;">${renderTeam(1, 'RED TEAM (P2)', '#e74c3c')}</div>`;
    panelHtml += `</div>`;

    this.unitStatsPanel.innerHTML = panelHtml;
  }

  dispose(): void {
    this.container.remove();
  }
} // END OF HUD CLASS — everything below this line was removed during cleanup

// Dead code removed:
// - buildDebugPanel(): void — old DOM builder for debug panel overlay
// - toggleDebugPanel(): void — show/hide the old debug panel
// - rebuildDebugContent(): void — ~210 lines of DOM generation for checkboxes, speed buttons,
//   spawn buttons, etc. All replaced by DebugPanel.ts TOOLS tab.
// - 15 private _onDebug* callback fields and their setter methods
// - Old dispose() that cleaned up debugPanel DOM
