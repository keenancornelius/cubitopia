// ============================================
// CUBITOPIA - RTS HUD / UI Overlay
// ============================================

import { Unit, Player, Base, Tile, TerrainType, ResourceType, UnitStance, UnitType, FormationType } from '../types';
import { StrategyCamera } from '../engine/Camera';

export class HUD {
  private container: HTMLElement;
  private unitInfoPanel: HTMLElement | null = null;
  private elements: {
    titleBar: HTMLElement;
    resourceBar: HTMLElement;
    enemyResourceBar: HTMLElement;
    selectionInfo: HTMLElement;
    newMapButton: HTMLElement;
    baseHealthBar: HTMLElement;
  };

  private _onNewMap: (() => void) | null = null;
  private buildModeIndicator: HTMLElement | null = null;
  private helpOverlay: HTMLElement | null = null;
  private helpVisible = false;
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
  private selectionCommandPanel: HTMLElement | null = null;

  onBuildWalls(cb: () => void) { this._onBuildWalls = cb; }
  onHarvest(cb: () => void) { this._onHarvest = cb; }
  onSellWood(cb: () => void) { this._onSellWood = cb; }
  onFarmPatch(cb: () => void) { this._onFarmPatch = cb; }
  onMine(cb: () => void) { this._onMine = cb; }
  onHelp(cb: () => void) { this._onHelp = cb; }

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

  constructor() {
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

  // Nested menu dynamic content area
  private menuContentArea: HTMLElement | null = null;
  private _onMenuAction: ((action: string) => void) | null = null;
  onMenuAction(cb: (action: string) => void) { this._onMenuAction = cb; }

  private createControlPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: absolute; bottom: 16px; left: 16px;
      background: rgba(0, 0, 0, 0.85); padding: 8px 10px; border-radius: 10px;
      border: 2px solid rgba(255,255,255,0.2);
      display: flex; flex-direction: column; gap: 2px;
      pointer-events: auto; z-index: 101; min-width: 220px;
    `;

    const makeBtn = (label: string, key: string, color: string, cb: () => void): HTMLElement => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: linear-gradient(135deg, ${color}, ${this.darken(color)});
        color: white; border: 1px solid rgba(255,255,255,0.2);
        padding: 5px 8px; font-size: 10px; font-family: 'Courier New', monospace;
        font-weight: bold; border-radius: 6px; cursor: pointer;
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
        color: #aaa; font-size: 10px; font-weight: bold; text-transform: uppercase;
        margin-top: 4px; margin-bottom: 2px; letter-spacing: 1px; padding-left: 4px;
      `;
      header.innerHTML = label;
      return header;
    };

    // MENU CATEGORIES — top-level buttons
    panel.appendChild(makeHeaderBtn('🏗️ MENUS'));
    const menuRow = document.createElement('div');
    menuRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    menuRow.appendChild(makeBtn('Combat', '1', '#c0392b', () => this._onMenuCategory?.(1)));
    menuRow.appendChild(makeBtn('Economy', '2', '#27ae60', () => this._onMenuCategory?.(2)));
    menuRow.appendChild(makeBtn('Crafting', '3', '#f39c12', () => this._onMenuCategory?.(3)));
    panel.appendChild(menuRow);

    // Dynamic menu content area (populated by updateNestedMenu)
    this.menuContentArea = document.createElement('div');
    this.menuContentArea.id = 'nested-menu-content';
    panel.appendChild(this.menuContentArea);

    // GLOBAL ACTIONS — always visible
    panel.appendChild(makeHeaderBtn('🎯 ACTIONS'));
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    actionsRow.appendChild(makeBtn('Walls', 'B', '#2980b9', () => this._onBuildWalls?.()));
    actionsRow.appendChild(makeBtn('Chop', 'H', '#27ae60', () => this._onHarvest?.()));
    actionsRow.appendChild(makeBtn('Mine', 'N', '#ff8c00', () => this._onMine?.()));
    actionsRow.appendChild(makeBtn('Farm', 'J', '#8bc34a', () => this._onFarmPatch?.()));
    actionsRow.appendChild(makeBtn('Sell', 'G', '#f39c12', () => this._onSellWood?.()));
    panel.appendChild(actionsRow);

    // HELP section
    panel.appendChild(makeHeaderBtn('❓ HELP'));
    const helpRow = document.createElement('div');
    helpRow.style.cssText = 'display: flex; gap: 3px;';
    helpRow.appendChild(makeBtn('Help', '?', '#7f8c8d', () => this._onHelp?.()));
    panel.appendChild(helpRow);

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
      background: rgba(255,255,255,0.08); border-radius: 6px;
      display: flex; justify-content: space-between; align-items: center;
    `;
    header.innerHTML = `
      <span>${cat.name}</span>
      <span style="font-size:9px;color:#888;">Tab to exit · Scroll/Shift to cycle</span>
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
        color: ${isActive ? '#fff' : '#888'}; border: 1px solid ${isActive ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'};
        padding: 4px 8px; font-size: 10px; font-family: 'Courier New', monospace;
        font-weight: bold; border-radius: 6px; cursor: pointer;
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
          color: white; border: 1px solid rgba(255,255,255,0.2);
          padding: 4px 7px; font-size: 10px; font-family: 'Courier New', monospace;
          font-weight: bold; border-radius: 5px; cursor: pointer;
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
      pointer-events: none; font-family: 'Courier New', monospace; color: white; z-index: 100;
    `;
    return div;
  }

  private createElements() {
    // Title bar (top center)
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7); padding: 8px 24px; border-radius: 8px;
      font-size: 18px; text-align: center; border: 2px solid rgba(255,255,255,0.2);
    `;
    titleBar.innerHTML = '<strong>CUBITOPIA</strong><br><span style="font-size:12px">RTS Mode</span>';
    this.container.appendChild(titleBar);

    // Resource bar (top left) — appended to document.body to avoid pointer-events:none on HUD container
    const resourceBar = document.createElement('div');
    resourceBar.style.cssText = `
      position: fixed; top: 16px; left: 16px;
      background: rgba(0, 0, 0, 0.7); padding: 12px 16px; border-radius: 8px;
      font-size: 14px; border: 2px solid rgba(255,255,255,0.2);
      pointer-events: auto; z-index: 10000;
      font-family: 'Courier New', monospace; color: white;
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
      position: fixed; top: 16px; right: 120px;
      background: rgba(80, 0, 0, 0.7); padding: 10px 14px; border-radius: 8px;
      font-size: 12px; border: 2px solid rgba(255,80,80,0.3);
      pointer-events: auto; z-index: 10000;
      font-family: 'Courier New', monospace; color: white;
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
      background: rgba(0, 0, 0, 0.7); padding: 12px 24px; border-radius: 8px;
      font-size: 14px; border: 2px solid rgba(255,255,255,0.2); display: none;
    `;
    this.container.appendChild(selectionInfo);

    // New Map button (top right)
    const newMapButton = document.createElement('button');
    newMapButton.textContent = '☰ MENU';
    newMapButton.style.cssText = `
      position: absolute; top: 16px; right: 16px;
      background: linear-gradient(135deg, #2980b9, #1a5276); color: white;
      border: 2px solid rgba(255,255,255,0.3); padding: 8px 20px; font-size: 14px;
      font-family: 'Courier New', monospace; font-weight: bold; border-radius: 8px;
      cursor: pointer; pointer-events: auto; text-transform: uppercase; letter-spacing: 2px;
    `;
    newMapButton.addEventListener('mouseenter', () => {
      newMapButton.style.background = 'linear-gradient(135deg, #1a5276, #154360)';
    });
    newMapButton.addEventListener('mouseleave', () => {
      newMapButton.style.background = 'linear-gradient(135deg, #2980b9, #1a5276)';
    });
    this.container.appendChild(newMapButton);

    // Base health bar (top center-left area, below title)
    const baseHealthBar = document.createElement('div');
    baseHealthBar.style.cssText = `
      position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7); padding: 10px 20px; border-radius: 8px;
      font-size: 12px; border: 2px solid rgba(255,255,255,0.2);
      display: flex; gap: 24px; align-items: center;
    `;
    this.container.appendChild(baseHealthBar);

    return { titleBar, resourceBar, enemyResourceBar, selectionInfo, newMapButton, baseHealthBar };
  }

  updateBaseHealth(bases: Base[]): void {
    const playerBase = bases.find(b => b.owner === 0);
    const enemyBase = bases.find(b => b.owner === 1);
    if (!playerBase || !enemyBase) return;

    const pPct = Math.max(0, Math.round((playerBase.health / playerBase.maxHealth) * 100));
    const ePct = Math.max(0, Math.round((enemyBase.health / enemyBase.maxHealth) * 100));

    const pColor = pPct > 50 ? '#3498db' : pPct > 25 ? '#f39c12' : '#e74c3c';
    const eColor = ePct > 50 ? '#e74c3c' : ePct > 25 ? '#f39c12' : '#2ecc71';

    this.elements.baseHealthBar.innerHTML = `
      <div style="text-align: center;">
        <div style="margin-bottom: 4px; color: #3498db; font-weight: bold;">YOUR BASE</div>
        <div style="background: #333; border-radius: 4px; width: 120px; height: 10px;">
          <div style="background: ${pColor}; height: 100%; width: ${pPct}%; border-radius: 4px; transition: width 0.3s;"></div>
        </div>
        <div style="font-size: 11px; margin-top: 2px;">${playerBase.health}/${playerBase.maxHealth}</div>
      </div>
      <div style="font-size: 16px; font-weight: bold; color: #888;">VS</div>
      <div style="text-align: center;">
        <div style="margin-bottom: 4px; color: #e74c3c; font-weight: bold;">ENEMY BASE</div>
        <div style="background: #333; border-radius: 4px; width: 120px; height: 10px;">
          <div style="background: ${eColor}; height: 100%; width: ${ePct}%; border-radius: 4px; transition: width 0.3s;"></div>
        </div>
        <div style="font-size: 11px; margin-top: 2px;">${enemyBase.health}/${enemyBase.maxHealth}</div>
      </div>
    `;
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
  private unitDropdown: HTMLElement | null = null;
  private unitDropdownVisible = false;
  private unitDropdownContent: HTMLElement | null = null;
  private _lastPlayerUnits: Unit[] = [];

  private static readonly UNIT_EMOJI: Record<string, string> = {
    [UnitType.WARRIOR]: '🗡️',
    [UnitType.ARCHER]: '🏹',
    [UnitType.RIDER]: '🐎',
    [UnitType.PALADIN]: '🛡️',
    [UnitType.CATAPULT]: '💣',
    [UnitType.SCOUT]: '👁️',
    [UnitType.MAGE]: '🔮',
    [UnitType.BUILDER]: '🔨',
    [UnitType.LUMBERJACK]: '🪓',
    [UnitType.VILLAGER]: '👤',
    [UnitType.TREBUCHET]: '🏗️',
  };
  private static readonly UNIT_COLOR: Record<string, string> = {
    [UnitType.WARRIOR]: '#e74c3c',
    [UnitType.ARCHER]: '#e67e22',
    [UnitType.RIDER]: '#f1c40f',
    [UnitType.PALADIN]: '#3498db',
    [UnitType.CATAPULT]: '#9b59b6',
    [UnitType.TREBUCHET]: '#795548',
    [UnitType.SCOUT]: '#1abc9c',
    [UnitType.MAGE]: '#8e44ad',
    [UnitType.BUILDER]: '#95a5a6',
    [UnitType.LUMBERJACK]: '#27ae60',
    [UnitType.VILLAGER]: '#bdc3c7',
  };
  private static readonly COMBAT_TYPES = [
    UnitType.WARRIOR, UnitType.ARCHER, UnitType.RIDER, UnitType.PALADIN,
    UnitType.CATAPULT, UnitType.TREBUCHET, UnitType.SCOUT, UnitType.MAGE,
    UnitType.HEALER, UnitType.ASSASSIN, UnitType.SHIELDBEARER,
    UnitType.BERSERKER, UnitType.BATTLEMAGE, UnitType.GREATSWORD,
  ];
  private static readonly WORKER_TYPES = [UnitType.BUILDER, UnitType.LUMBERJACK, UnitType.VILLAGER];

  /** Check if a unit type is a combat unit (not a worker) */
  private static isCombatType(t: UnitType): boolean {
    return t !== UnitType.BUILDER && t !== UnitType.LUMBERJACK && t !== UnitType.VILLAGER;
  }

  /** Build the resource bar DOM once so event listeners survive updates */
  private buildResourceBarDOM(bar: HTMLElement): void {
    bar.innerHTML = '';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

    const mkRes = (emoji: string, color: string): { wrapper: HTMLElement; val: HTMLElement } => {
      const w = document.createElement('span');
      w.style.cssText = 'white-space:nowrap;';
      const v = document.createElement('span');
      v.style.cssText = `color:${color};font-weight:bold;`;
      w.textContent = emoji + ' ';
      w.appendChild(v);
      return { wrapper: w, val: v };
    };

    // ===== EARTH GROUP (dropdown) =====
    this.earthGroupBtn = document.createElement('span');
    this.earthGroupBtn.style.cssText = `
      cursor:pointer; position:relative; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.earthGroupBtn.textContent = '⛏️ Earth ▾';
    row.appendChild(this.earthGroupBtn);
    row.appendChild(this.makeDot());

    const earthDropdown = document.createElement('div');
    earthDropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      background:rgba(10,10,18,0.94); padding:10px 14px; border-radius:8px;
      font-size:13px; border:2px solid rgba(255,255,255,0.25);
      min-width:200px; z-index:1000; pointer-events:auto;
      backdrop-filter:blur(10px); box-shadow:0 8px 28px rgba(0,0,0,0.6);
      display:none;
    `;
    this.earthGroupDropdown = earthDropdown;

    // Earth resources inside dropdown
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
    bar.appendChild(earthDropdown);

    // ===== CRAFTED GROUP (dropdown) =====
    this.craftedGroupBtn = document.createElement('span');
    this.craftedGroupBtn.style.cssText = `
      cursor:pointer; position:relative; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    this.craftedGroupBtn.textContent = '⚒️ Crafted ▾';
    row.appendChild(this.craftedGroupBtn);
    row.appendChild(this.makeDot());

    const craftedDropdown = document.createElement('div');
    craftedDropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      background:rgba(10,10,18,0.94); padding:10px 14px; border-radius:8px;
      font-size:13px; border:2px solid rgba(255,255,255,0.25);
      min-width:200px; z-index:1000; pointer-events:auto;
      backdrop-filter:blur(10px); box-shadow:0 8px 28px rgba(0,0,0,0.6);
      display:none;
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
    bar.appendChild(craftedDropdown);

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
    const unitBtn = document.createElement('span');
    unitBtn.style.cssText = `
      cursor:pointer; position:relative; padding:3px 8px; border-radius:4px;
      transition:background 0.15s; white-space:nowrap; user-select:none;
    `;
    const unitValSpan = document.createElement('span');
    unitValSpan.style.fontWeight = 'bold';
    unitBtn.textContent = '⚔️ ';
    unitBtn.appendChild(unitValSpan);
    const arrow = document.createTextNode(' units ▾');
    unitBtn.appendChild(arrow);
    this.resUnitVal = unitValSpan;
    row.appendChild(unitBtn);

    bar.appendChild(row);

    // --- Unit dropdown panel (hidden by default) ---
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute; top:100%; left:0; margin-top:6px;
      background:rgba(10,10,18,0.94); padding:10px 14px; border-radius:8px;
      font-size:13px; border:2px solid rgba(255,255,255,0.25);
      min-width:180px; z-index:1000; pointer-events:auto;
      backdrop-filter:blur(10px); box-shadow:0 8px 28px rgba(0,0,0,0.6);
      display:none;
    `;
    this.unitDropdownContent = document.createElement('div');
    dropdown.appendChild(this.unitDropdownContent);
    bar.appendChild(dropdown);
    this.unitDropdown = dropdown;

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

    // Close dropdowns when clicking anywhere else
    document.addEventListener('click', () => {
      if (this.earthGroupVisible) {
        this.earthGroupDropdown!.style.display = 'none';
        this.earthGroupVisible = false;
        this.earthGroupBtn!.style.background = 'none';
      }
      if (this.craftedGroupVisible) {
        this.craftedGroupDropdown!.style.display = 'none';
        this.craftedGroupVisible = false;
        this.craftedGroupBtn!.style.background = 'none';
      }
      if (this.unitDropdownVisible) {
        this.hideUnitDropdown();
        unitBtn.style.background = 'none';
      }
    });

    // Prevent clicks inside dropdowns from closing them
    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  private makeDot(): HTMLElement {
    const dot = document.createElement('span');
    dot.style.cssText = 'color:#555;';
    dot.textContent = '·';
    return dot;
  }

  /** Build the enemy resource bar DOM (compact, read-only) */
  private buildEnemyResourceBarDOM(bar: HTMLElement): void {
    bar.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'font-size:10px;color:#ff6b6b;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;text-align:center;';
    header.textContent = '🔴 ENEMY';
    bar.appendChild(header);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

    const mkRes = (emoji: string, color: string): { wrapper: HTMLElement; val: HTMLElement } => {
      const w = document.createElement('span');
      w.style.cssText = 'white-space:nowrap;';
      const v = document.createElement('span');
      v.style.cssText = `color:${color};font-weight:bold;`;
      w.textContent = emoji + ' ';
      w.appendChild(v);
      return { wrapper: w, val: v };
    };

    const dot = () => {
      const d = document.createElement('span');
      d.style.cssText = 'color:#553;';
      d.textContent = '·';
      return d;
    };

    const wood = mkRes('🪵', '#f0c040');
    this.enemyResWoodVal = wood.val;
    row.appendChild(wood.wrapper);
    row.appendChild(dot());

    const stone = mkRes('🪨', '#aaa');
    this.enemyResStoneVal = stone.val;
    row.appendChild(stone.wrapper);
    row.appendChild(dot());

    const food = mkRes('🌾', '#8bc34a');
    this.enemyResFoodVal = food.val;
    row.appendChild(food.wrapper);
    row.appendChild(dot());

    const gold = mkRes('💰', '#f0c040');
    this.enemyResGoldVal = gold.val;
    row.appendChild(gold.wrapper);
    row.appendChild(dot());

    const units = document.createElement('span');
    units.style.cssText = 'white-space:nowrap;';
    const unitVal = document.createElement('span');
    unitVal.style.cssText = 'color:#ff8a80;font-weight:bold;';
    units.textContent = '⚔️ ';
    units.appendChild(unitVal);
    const unitLabel = document.createTextNode(' units');
    units.appendChild(unitLabel);
    this.enemyResUnitVal = unitVal;
    row.appendChild(units);

    bar.appendChild(row);
  }

  updateEnemyResources(player: Player, woodStockpile?: number, foodStockpile?: number, stoneStockpile?: number): void {
    const wood = woodStockpile ?? player.resources.wood;
    const food = foodStockpile ?? player.resources.food;
    const stone = stoneStockpile ?? 0;

    if (this.enemyResWoodVal) this.enemyResWoodVal.textContent = `${wood}`;
    if (this.enemyResStoneVal) this.enemyResStoneVal.textContent = `${stone}`;
    if (this.enemyResFoodVal) this.enemyResFoodVal.textContent = `${food}`;
    if (this.enemyResGoldVal) this.enemyResGoldVal.textContent = `${player.resources.gold}`;
    if (this.enemyResUnitVal) this.enemyResUnitVal.textContent = `${player.units.length}`;
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

  updateResources(player: Player, woodStockpile?: number, foodStockpile?: number, stoneStockpile?: number): void {
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

    // Standalone resources
    if (this.resFoodVal) this.resFoodVal.textContent = `${food} food`;
    if (this.resGoldVal) this.resGoldVal.textContent = `${player.resources.gold} gold`;
    if (this.resUnitVal) this.resUnitVal.textContent = `${player.units.length}`;

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

  setBarracksMode(active: boolean): void {
    if (!this.barracksModeIndicator) {
      this.barracksModeIndicator = document.createElement('div');
      this.barracksModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #e67e22; color: #e67e22;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.barracksModeIndicator.innerHTML = '🏗️ BARRACKS PLACEMENT — Click to place barracks (costs 10 wood) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.barracksModeIndicator);
    }
    this.barracksModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('barracks');
  }

  setForestryMode(active: boolean): void {
    if (!this.forestryModeIndicator) {
      this.forestryModeIndicator = document.createElement('div');
      this.forestryModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #6b8e23; color: #6b8e23;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.forestryModeIndicator.innerHTML = '🌳 FORESTRY PLACEMENT — Click to place forestry (costs 8 wood) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.forestryModeIndicator);
    }
    this.forestryModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('forestry');
  }

  setMasonryMode(active: boolean): void {
    if (!this.masonryModeIndicator) {
      this.masonryModeIndicator = document.createElement('div');
      this.masonryModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #808080; color: #808080;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.masonryModeIndicator.innerHTML = '⬜ MASONRY PLACEMENT — Click to place masonry (costs 8 wood) · [R] Rotate · [Tab] to close';
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
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #daa520; color: #daa520;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.farmhouseModeIndicator.innerHTML = '🏠 FARMHOUSE PLACEMENT — Click to place (costs 6 wood) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.farmhouseModeIndicator);
    }
    this.farmhouseModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('farmhouse');
  }

  setSiloMode(active: boolean): void {
    if (!this.siloModeIndicator) {
      this.siloModeIndicator = document.createElement('div');
      this.siloModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #c0c0c0; color: #c0c0c0;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.siloModeIndicator.innerHTML = '🏗️ SILO PLACEMENT — Click to place (costs 5 wood) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.siloModeIndicator);
    }
    this.siloModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('silo');
  }

  setFarmPatchMode(active: boolean): void {
    if (!this.farmPatchModeIndicator) {
      this.farmPatchModeIndicator = document.createElement('div');
      this.farmPatchModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #8b6914; color: #8b6914;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
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
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #228B22; color: #228B22;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.plantTreeModeIndicator.innerHTML = '🌱 PLANT TREES — Click & drag on plains to plant saplings (1 wood each) · [Tab] to close';
      this.container.appendChild(this.plantTreeModeIndicator);
    }
    this.plantTreeModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('plantTree');
  }

  private mineModeIndicator: HTMLElement | null = null;

  setMineMode(active: boolean, depthLayers?: number): void {
    if (!this.mineModeIndicator) {
      this.mineModeIndicator = document.createElement('div');
      this.mineModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #ff8c00; color: #ff8c00;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.container.appendChild(this.mineModeIndicator);
    }
    const depth = depthLayers ?? 3;
    this.mineModeIndicator.innerHTML = `MINE MODE — Depth: <span style="color:#fff;font-size:20px">${depth}</span> layers · Scroll to adjust · Click to mark · [Tab] to close`;
    this.mineModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('mine');
  }

  private plantCropsModeIndicator: HTMLElement | null = null;
  private rallyPointModeIndicator: HTMLElement | null = null;

  setPlantCropsMode(active: boolean): void {
    if (!this.plantCropsModeIndicator) {
      this.plantCropsModeIndicator = document.createElement('div');
      this.plantCropsModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #228B22; color: #228B22;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
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
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #5d4037; color: #c9a96e;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.workshopModeIndicator.innerHTML = '🔧 WORKSHOP PLACEMENT — Click to place (costs 12 wood + 4 stone) · [R] Rotate · [Tab] to close';
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
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #8b4513; color: #d4956a;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.smelterModeIndicator.innerHTML = '🔥 SMELTER PLACEMENT — Click to place (costs 8 wood + 6 stone) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.smelterModeIndicator);
    }
    this.smelterModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('smelter');
  }

  setArmoryMode(active: boolean): void {
    if (!this.armoryModeIndicator) {
      this.armoryModeIndicator = document.createElement('div');
      this.armoryModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #708090; color: #a0b0c0;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.armoryModeIndicator.innerHTML = '⚔️ ARMORY PLACEMENT — Click to place (costs 10 wood + 5 stone + 3 steel) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.armoryModeIndicator);
    }
    this.armoryModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('armory');
  }

  setWizard_towerMode(active: boolean): void {
    if (!this.wizardTowerModeIndicator) {
      this.wizardTowerModeIndicator = document.createElement('div');
      this.wizardTowerModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #6a0dad; color: #b388ff;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
      `;
      this.wizardTowerModeIndicator.innerHTML = '🔮 WIZARD TOWER PLACEMENT — Click to place (costs 10 wood + 5 stone + 3 crystal) · [R] Rotate · [Tab] to close';
      this.container.appendChild(this.wizardTowerModeIndicator);
    }
    this.wizardTowerModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('wizard_tower');
  }

  /** @deprecated Use updateAllSpawnQueues instead */
  updateWorkshopSpawnQueue(_queue: { type: string; cost: { wood: number; stone: number; rope: number } }[]): void {}

  // ---- Unified stacking queue display ----

  /** Queue entry for unified display */
  updateAllSpawnQueues(queues: {
    kind: string;
    color: string;
    items: { type: string }[];
    timerProgress: number; // 0..1 (fraction of spawn time elapsed for current unit)
  }[]): void {
    if (!this.unifiedQueuePanel) {
      this.unifiedQueuePanel = document.createElement('div');
      this.unifiedQueuePanel.style.cssText = `
        position: absolute; bottom: 90px; right: 12px;
        display: flex; flex-direction: column; gap: 6px;
        pointer-events: none; z-index: 50;
      `;
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

    // Build HTML for stacking modules
    let html = '';
    for (const q of active) {
      const borderColor = q.color;
      const bgColor = q.color + '18'; // low-alpha version
      html += `<div style="
        background: rgba(0,0,0,0.88); border: 1px solid ${borderColor}; border-radius: 6px;
        padding: 6px 10px; min-width: 140px;
      ">`;
      // Header
      html += `<div style="font-size:10px; color:${borderColor}; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; font-weight:bold;">${q.kind}</div>`;

      // Stacked unit modules
      for (let i = 0; i < q.items.length; i++) {
        const item = q.items[i];
        const isFirst = i === 0;
        const progress = isFirst ? q.timerProgress : 0;
        const barWidth = Math.round(progress * 100);

        html += `<div style="
          display:flex; align-items:center; gap:6px; margin-bottom:${i < q.items.length - 1 ? '3' : '0'}px;
          background: ${bgColor}; border-radius: 4px; padding: 3px 6px; position: relative; overflow: hidden;
        ">`;

        // Progress fill (behind text)
        if (isFirst) {
          html += `<div style="
            position:absolute; left:0; top:0; bottom:0; width:${barWidth}%;
            background: ${borderColor}30; border-radius: 4px; transition: width 0.15s linear;
          "></div>`;
        }

        // Unit type label
        html += `<span style="
          font-size:11px; color:#ddd; position:relative; z-index:1; flex:1;
        ">${item.type}</span>`;

        // Side progress bar (thin vertical bar on the right)
        if (isFirst) {
          html += `<div style="
            width:4px; height:16px; background:rgba(255,255,255,0.1); border-radius:2px;
            position:relative; z-index:1; overflow:hidden;
          "><div style="
            position:absolute; bottom:0; left:0; right:0; height:${barWidth}%;
            background:${borderColor}; border-radius:2px; transition: height 0.15s linear;
          "></div></div>`;
        }

        html += `</div>`;
      }

      html += `</div>`;
    }

    this.unifiedQueuePanel.innerHTML = html;
  }

  setRallyPointMode(active: boolean, buildingKey?: string): void {
    if (!this.rallyPointModeIndicator) {
      this.rallyPointModeIndicator = document.createElement('div');
      this.rallyPointModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #f0c040; color: #f0c040;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
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

  private notificationEl: HTMLElement | null = null;
  private notificationTimeout: number | null = null;

  showNotification(message: string, color: string = '#e74c3c'): void {
    if (!this.notificationEl) {
      this.notificationEl = document.createElement('div');
      this.notificationEl.style.cssText = `
        position: absolute; top: 120px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9); padding: 12px 28px; border-radius: 8px;
        font-size: 16px; font-weight: bold; letter-spacing: 1px;
        text-align: center; display: none; pointer-events: auto;
        animation: fadeIn 0.2s ease;
      `;
      this.container.appendChild(this.notificationEl);
    }
    this.notificationEl.style.borderColor = color;
    this.notificationEl.style.border = `2px solid ${color}`;
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
      this.hideUnitInfo();
      if (this.selectionCommandPanel) {
        this.selectionCommandPanel.style.display = 'none';
      }
      return;
    }

    this.elements.selectionInfo.style.display = 'block';

    if (units.length === 1) {
      const unit = units[0];
      const healthPct = Math.round((unit.currentHealth / unit.stats.maxHealth) * 100);
      const healthColor = healthPct > 50 ? '#2ecc71' : healthPct > 25 ? '#f39c12' : '#e74c3c';
      const stanceLabel = unit.stance === UnitStance.PASSIVE ? '🛡 Passive' :
                          unit.stance === UnitStance.DEFENSIVE ? '⚔ Defensive' : '🔥 Aggressive';

      this.elements.selectionInfo.innerHTML = `
        <div style="font-size:16px; font-weight:bold; text-transform:uppercase; margin-bottom:6px;">
          ${unit.type} <span style="font-size:12px; color:#aaa">(${unit.state})</span>
        </div>
        <div style="margin-bottom:4px;">
          HP: <span style="color:${healthColor}">${unit.currentHealth}/${unit.stats.maxHealth}</span>
        </div>
        <div style="background:#333; border-radius:4px; height:6px; margin-bottom:6px;">
          <div style="background:${healthColor}; height:100%; width:${healthPct}%; border-radius:4px;"></div>
        </div>
        <div>ATK: ${unit.stats.attack} · DEF: ${unit.stats.defense} · SPD: ${unit.moveSpeed.toFixed(1)}</div>
        <div style="margin-top:4px; color:#ccc; font-size:11px;">Stance: ${stanceLabel}</div>
      `;
    } else {
      // Multiple units selected
      const typeCounts: Record<string, number> = {};
      for (const u of units) {
        typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
      }
      const summary = Object.entries(typeCounts)
        .map(([type, count]) => `${count}x ${type}`)
        .join(' · ');

      this.elements.selectionInfo.innerHTML = `
        <div style="font-size:16px; font-weight:bold; margin-bottom:4px;">
          ${units.length} UNITS SELECTED
        </div>
        <div>${summary}</div>
      `;
    }
  }

  /** Full selection update: refreshes info AND rebuilds command panel. Call only when selection actually changes. */
  updateSelection(units: Unit[]): void {
    this.updateSelectionInfo(units);

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
        background: rgba(0, 0, 0, 0.9); padding: 8px 10px; border-radius: 10px;
        border: 2px solid rgba(255,255,255,0.25);
        display: flex; flex-direction: column; gap: 4px;
        pointer-events: auto; z-index: 10000; min-width: 170px;
        font-family: 'Courier New', monospace; color: white;
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

    const makeSmallBtn = (label: string, color: string, active: boolean, cb: () => void): HTMLElement => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: ${active ? color : 'rgba(60,60,60,0.8)'};
        color: white; border: 1px solid ${active ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'};
        padding: 4px 8px; font-size: 10px; font-family: 'Courier New', monospace;
        font-weight: bold; border-radius: 5px; cursor: pointer;
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
      h.style.cssText = 'color: #aaa; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding-left: 2px;';
      h.textContent = text;
      return h;
    };

    if (hasCombat) {
      // Current stance (use first combat unit's stance as reference)
      const combatUnit = units.find(u => HUD.isCombatType(u.type));
      const currentStance = combatUnit?.stance ?? UnitStance.DEFENSIVE;

      // STANCE section
      this.selectionCommandPanel.appendChild(makeHeader('🎯 Stance'));
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
      this.selectionCommandPanel.appendChild(stanceRow);

      // FORMATION section
      this.selectionCommandPanel.appendChild(makeHeader('📐 Formation'));
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
      this.selectionCommandPanel.appendChild(formRow);
    }

    // ACTIONS section (always show for selected units)
    this.selectionCommandPanel.appendChild(makeHeader('⚡ Actions'));
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: flex; gap: 3px;';
    const killBtn = makeSmallBtn('Kill', '#e74c3c', false,
      () => this._onRespawnUnits?.());
    killBtn.title = 'Kill the selected units (permanently removes them).';
    actionRow.appendChild(killBtn);
    this.selectionCommandPanel.appendChild(actionRow);
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

  private createBuildModeIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.id = 'build-mode-indicator';
    indicator.style.cssText = `
      position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
      font-size: 16px; border: 2px solid #f0c040; color: #f0c040;
      font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
      display: none; text-align: center;
    `;
    indicator.innerHTML = '🏰 WALL BUILD MODE — Click tiles for walls (1 stone) · Shift+click for gates (2 stone) · Walls auto-connect · [Tab] to close';
    this.container.appendChild(indicator);
    return indicator;
  }

  setBuildMode(active: boolean): void {
    if (this.buildModeIndicator) {
      this.buildModeIndicator.style.display = active ? 'block' : 'none';
    }
    if (active) this.hideAllModeIndicators('build');
  }

  setHarvestMode(active: boolean): void {
    if (!this.harvestModeIndicator) {
      this.harvestModeIndicator = document.createElement('div');
      this.harvestModeIndicator.style.cssText = `
        position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85); padding: 10px 24px; border-radius: 8px;
        font-size: 16px; border: 2px solid #4caf50; color: #4caf50;
        font-weight: bold; text-transform: uppercase; letter-spacing: 2px;
        display: none; text-align: center;
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
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.88); display: none; z-index: 300;
      font-family: 'Courier New', monospace; color: #e0e0e0;
      pointer-events: auto; overflow-y: auto;
      animation: helpFadeIn 0.25s ease;
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
        border: 1px solid #777;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 13px;
        font-weight: bold;
        min-width: 20px;
        text-align: center;
        box-shadow: 0 2px 0 #222;
        margin: 0 2px;
      }
      #help-overlay .section {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 16px 20px;
        margin-bottom: 12px;
      }
      #help-overlay .section-title {
        font-size: 14px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 3px;
        margin-bottom: 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255,255,255,0.15);
      }
      #help-overlay .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 0;
      }
      #help-overlay .row-label {
        color: #aaa;
        font-size: 13px;
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
        width: 28px; height: 28px;
        border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      #help-overlay .unit-name {
        font-weight: bold; font-size: 13px; min-width: 90px;
      }
      #help-overlay .unit-desc {
        font-size: 12px; color: #999;
      }
      #help-overlay .tip {
        display: flex; gap: 8px; padding: 4px 0; font-size: 12px;
      }
      #help-overlay .tip-bullet {
        color: #f0c040; flex-shrink: 0;
      }
      #help-overlay .close-hint {
        position: absolute; top: 16px; right: 24px;
        font-size: 13px; color: #888;
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
          <div class="section-title" style="color: #9b59b6;">⚔️ Unit Types</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px;">
            <div class="unit-row">
              <div class="unit-icon" style="background:#c0392b; font-weight:bold; color:white;">1</div>
              <div>
                <div class="unit-name" style="color:#c0392b;">Warrior</div>
                <div class="unit-desc">Melee combat unit. 5 gold. Solid all-round fighter.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#8e44ad; font-weight:bold; color:white;">2</div>
              <div>
                <div class="unit-name" style="color:#8e44ad;">Archer</div>
                <div class="unit-desc">Ranged unit. 8 gold. Range 4, kites melee threats. Flees & fires when enemies close in.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#d35400; font-weight:bold; color:white;">3</div>
              <div>
                <div class="unit-name" style="color:#d35400;">Rider</div>
                <div class="unit-desc">Fast cavalry. 10 gold. High speed, great for flanking and pursuit.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#3498db; font-weight:bold; color:white;">4</div>
              <div>
                <div class="unit-name" style="color:#3498db;">Scout</div>
                <div class="unit-desc">Fast recon. 6 gold. Barracks <span class="key" style="font-size:9px;">4</span>. High speed, great vision range.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#8B4513; font-weight:bold; color:white;">L</div>
              <div>
                <div class="unit-name" style="color:#8B4513;">Lumberjack</div>
                <div class="unit-desc">Wood harvester. 3 wood. Auto-chops marked trees <span class="key" style="font-size:9px;">H</span> and carries wood to stockpile.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#b8860b; font-weight:bold; color:white;">B</div>
              <div>
                <div class="unit-name" style="color:#b8860b;">Builder</div>
                <div class="unit-desc">Miner & mason. 4 wood. Mines stone/clay <span class="key" style="font-size:9px;">N</span>, builds walls <span class="key" style="font-size:9px;">B</span>.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#daa520; font-weight:bold; color:white;">V</div>
              <div>
                <div class="unit-name" style="color:#daa520;">Villager</div>
                <div class="unit-desc">Farmer. 3 wood. Harvests farms & tall grass <span class="key" style="font-size:9px;">J</span> for food + grass fiber.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#8e44ad; font-weight:bold; color:white;">C</div>
              <div>
                <div class="unit-name" style="color:#8e44ad;">Catapult</div>
                <div class="unit-desc">Siege weapon. 3 rope + 3 stone + 3 wood. Range 4, damages walls. Built at Workshop.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#5d4037; font-weight:bold; color:white;">T</div>
              <div>
                <div class="unit-name" style="color:#795548;">Trebuchet</div>
                <div class="unit-desc">Heavy siege. 6 rope + 4 stone + 4 wood. Range 6, massive damage. Built at Workshop.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#3498db; font-weight:bold; color:white;">5</div>
              <div>
                <div class="unit-name" style="color:#3498db;">Paladin</div>
                <div class="unit-desc">Heavy tank. 12 gold. Barracks <span class="key" style="font-size:9px;">5</span>. High HP & defense. Holds choke points.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#2980b9;">🔮</div>
              <div>
                <div class="unit-name" style="color:#2980b9;">Mage</div>
                <div class="unit-desc">Ranged caster. 8g + 2 crystal. Wizard Tower <span class="key" style="font-size:9px;">0</span>. Range 3. Magic orbs.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#27ae60;">💚</div>
              <div>
                <div class="unit-name" style="color:#27ae60;">Healer</div>
                <div class="unit-desc">Support. 6g + 1 crystal. Wizard Tower <span class="key" style="font-size:9px;">⇧1</span>. Heals allies within 2 hex.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#2c3e50;">🗡️</div>
              <div>
                <div class="unit-name" style="color:#9b59b6;">Assassin</div>
                <div class="unit-desc">Burst DPS. 7g + 1 steel. Armory <span class="key" style="font-size:9px;">7</span>. +3 attack from full HP. Dual daggers.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#7f8c8d;">🛡️</div>
              <div>
                <div class="unit-name" style="color:#7f8c8d;">Shieldbearer</div>
                <div class="unit-desc">Tank. 8g + 3 steel. Armory <span class="key" style="font-size:9px;">9</span>. +2 defense aura, shield bash knockback. Peels for squishies.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#e74c3c;">🪓</div>
              <div>
                <div class="unit-name" style="color:#e74c3c;">Berserker</div>
                <div class="unit-desc">Melee DPS. 7g + 2 steel. Armory <span class="key" style="font-size:9px;">8</span>. Up to +4 attack at low HP (rage). Dual axes.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#8e44ad;">⚡</div>
              <div>
                <div class="unit-name" style="color:#8e44ad;">Battlemage</div>
                <div class="unit-desc">AoE caster. 12g + 3 crystal. Wizard Tower <span class="key" style="font-size:9px;">⇧2</span>. Splash damage to all adjacent enemies.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#546e7a;">⚔</div>
              <div>
                <div class="unit-name" style="color:#546e7a;">Greatsword</div>
                <div class="unit-desc">Heavy cleave. 8g + 2 steel. Armory <span class="key" style="font-size:9px;">6</span>. 360° spin hits all adjacent, knockback.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- NESTED MENU SYSTEM -->
        <div class="section">
          <div class="section-title" style="color: #f0c040;">🎮 Menu System</div>
          <div style="margin-bottom: 8px; font-size: 12px; color: #ccc;">
            Press a number key to open a building category. <strong>Scroll wheel</strong> or <strong>Shift</strong> cycles buildings.
            <strong>Click</strong> to place. <strong>QWERTY</strong> keys queue units/actions. <strong>Tab</strong> to exit.
          </div>

          <div style="font-weight: bold; font-size: 12px; color: #c0392b; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">1</span> COMBAT BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#e67e22;">●</span> <span><strong style="color:#e67e22;">Barracks</strong> (10w) — Q: Warrior 5g · W: Archer 8g · E: Rider 10g · R: Scout 6g · T: Paladin 12g</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#708090;">●</span> <span><strong style="color:#708090;">Armory</strong> (10w+5s+3 steel) — Q: Greatsword 8g+2s · W: Assassin 7g+1s · E: Berserker 7g+2s · R: Shieldbearer 8g+3s</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#6a0dad;">●</span> <span><strong style="color:#6a0dad;">Wizard Tower</strong> (10w+5s+3 crystal) — Q: Mage 8g+2c · W: Battlemage 12g+3c · E: Healer 6g+1c</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #27ae60; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">2</span> ECONOMY BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#6b8e23;">●</span> <span><strong style="color:#6b8e23;">Forestry</strong> (8w) — Q: Lumberjack 3w · W: Chop Trees · E: Plant Trees</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#808080;">●</span> <span><strong style="color:#808080;">Masonry</strong> (8w) — Q: Builder 3w · W: Mine Terrain · E: Build Walls</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#daa520;">●</span> <span><strong style="color:#daa520;">Farmhouse</strong> (6w) — Q: Villager 3w · W: Farm/Hay · E: Plant Crops</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#5d4037;">●</span> <span><strong style="color:#5d4037;">Workshop</strong> (12w+4s) — Q: Catapult · W: Trebuchet · E: Craft Rope · R: Sell Wood</span></div>

          <div style="font-weight: bold; font-size: 12px; color: #f39c12; margin-bottom: 4px; margin-top: 8px;">
            <span class="key">3</span> CRAFTING BUILDINGS
          </div>
          <div class="tip"><span class="tip-bullet" style="color:#8b4513;">●</span> <span><strong style="color:#8b4513;">Smelter</strong> (8w+6s) — Q: Smelt Steel (2 iron + 1 charcoal) · W: Craft Charcoal (3 wood + 2 clay)</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#c0c0c0;">●</span> <span><strong style="color:#c0c0c0;">Silo</strong> (5w) — Extra food storage capacity.</span></div>
        </div>

        <!-- GLOBAL ACTIONS -->
        <div class="section">
          <div class="section-title" style="color: #2980b9;">🎯 Global Actions (always available)</div>
          <div class="tip"><span class="tip-bullet" style="color:#2980b9;">●</span> <span><span class="key">B</span> <strong>Build Walls</strong> — Click to place wall blueprints. Shift+click for gates. <span class="key">R</span> to rotate.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#27ae60;">●</span> <span><span class="key">H</span> <strong>Chop Trees</strong> — Mark forest tiles for lumberjacks.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#ff8c00;">●</span> <span><span class="key">N</span> <strong>Mine Terrain</strong> — Mark terrain for mining (stone, iron, clay).</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#8bc34a;">●</span> <span><span class="key">J</span> <strong>Farm/Harvest</strong> — Create farm plots or mark grass for hay.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#f39c12;">●</span> <span><span class="key">G</span> <strong>Sell Wood</strong> — Trade 4 wood for 5 gold.</span></div>
        </div>

        <!-- RESOURCES -->
        <div class="section">
          <div class="section-title" style="color: #27ae60;">💎 Resources</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px;">
            <div class="tip"><span class="tip-bullet" style="color:#f0c040;">🪵</span> <span><strong style="color:#f0c040;">Wood</strong> — Harvested from forests by Lumberjacks. Used to build structures and train workers.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#aaa;">🪨</span> <span><strong style="color:#aaa;">Stone</strong> — Mined from mountains/terrain by Builders. Used for advanced buildings.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#8bc34a;">🌾</span> <span><strong style="color:#8bc34a;">Food</strong> — Harvested from farms/grass by Villagers. Feeds your population.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#f39c12;">💰</span> <span><strong style="color:#f39c12;">Gold</strong> — Earned by selling wood <span class="key" style="font-size:9px;">G</span> or killing enemies (3g/kill, 5g for siege). Used to train combat units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#66bb6a;">🌿</span> <span><strong style="color:#66bb6a;">Grass Fiber</strong> — Gathered by Villagers when harvesting grass. Used to craft Rope.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#bf8040;">🧱</span> <span><strong style="color:#bf8040;">Clay</strong> — Mined from sand/desert terrain by Builders. Used to craft Rope & Charcoal.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#c9a96e;">🪢</span> <span><strong style="color:#c9a96e;">Rope</strong> — Crafted <span class="key" style="font-size:9px;">L</span> from 3 fiber + 2 clay. Required for Trebuchets.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#c0652a;">⛏</span> <span><strong style="color:#c0652a;">Iron</strong> — Mined from iron ore veins on mountains (orange rocks). Foundation of the steel chain.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#444;">⚫</span> <span><strong style="color:#999;">Charcoal</strong> — Crafted <span class="key" style="font-size:9px;">X</span> from 3 wood + 2 clay. Carbon needed for smelting steel.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#71797e;">🔨</span> <span><strong style="color:#71797e;">Steel</strong> — Smelted <span class="key" style="font-size:9px;">Z</span> from 2 iron + 1 charcoal (requires Smelter). Used for Armory units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#9b59b6;">💎</span> <span><strong style="color:#9b59b6;">Crystal</strong> — Found on snow terrain. Used for Wizard Tower units.</span></div>
          </div>
        </div>

        <!-- COMBAT: STANCES & FORMATIONS -->
        <div class="section">
          <div class="section-title" style="color: #e74c3c;">🎯 Combat Stances & Formations</div>
          <div style="margin-bottom: 8px; font-size: 12px; color: #aaa;">Select combat units to access stances and formations in the bottom-right command panel.</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px;">
            <div>
              <div style="font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Stances</div>
              <div class="tip"><span class="tip-bullet" style="color:#7f8c8d;">●</span> <span><strong style="color:#7f8c8d;">Passive</strong> — Units hold position and never attack, even when hit. Use for scouting or retreat.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#2980b9;">●</span> <span><strong style="color:#2980b9;">Defensive</strong> — Units guard their command position. They chase enemies that enter detection range, then return to post when threats leave. Archers kite melee threats instead of chasing. Default stance.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#c0392b;">●</span> <span><strong style="color:#c0392b;">Aggressive</strong> — Units actively chase and attack enemies within detection range. Auto-patrols area.</span></div>
            </div>
            <div>
              <div style="font-weight: bold; font-size: 12px; color: #f0c040; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Formations</div>
              <div class="tip"><span class="tip-bullet" style="color:#27ae60;">●</span> <span><strong style="color:#27ae60;">Line</strong> — Horizontal spread. Maximizes frontline width for ranged units.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#8e44ad;">●</span> <span><strong style="color:#8e44ad;">Box</strong> — Compact square. Good all-purpose formation for mixed armies.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#d35400;">●</span> <span><strong style="color:#d35400;">Wedge</strong> — V-shape. Pierces through enemy lines, strong warriors in front.</span></div>
              <div class="tip"><span class="tip-bullet" style="color:#2980b9;">●</span> <span><strong style="color:#2980b9;">Circle</strong> — Defensive ring. Protects against attacks from all sides.</span></div>
            </div>
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #888;">
            <strong>Rally Points <span class="key" style="font-size:9px;">Y</span>:</strong> Set where new units from a building go after spawning. Press Y to cycle buildings, click a tile to place the flag.
            <strong>Kill:</strong> Permanently remove selected units from the game.
          </div>
        </div>

        <!-- TIPS -->
        <div class="section">
          <div class="section-title" style="color: #3498db;">💡 Tips</div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Workers auto-harvest nearby resources when idle — no micro needed!</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Crafting chain: mine iron → craft charcoal (3→Smelter→W) → smelt steel (3→Smelter→Q) → build Armory units (1→Armory)!</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Set stances before sending troops — Defensive units hold chokepoints, Aggressive units push forward.</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Use Wedge formation to punch through, Line for ranged volleys, Box for balanced fights.</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Use walls to funnel enemies into kill zones.</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Click on buildings to open a tooltip — queue units, view status, or demolish.</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Your units spread their attacks across multiple enemies instead of all targeting one — fewer wasted hits!</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Archers automatically flee from melee threats and reposition to maintain range advantage.</span></div>
          <div class="tip"><span class="tip-bullet">★</span> <span>Destroy the enemy base to win!</span></div>
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
      this.helpOverlay.style.display = 'block';
      this.helpVisible = true;
      StrategyCamera.suppressInput = true;
      localStorage.setItem('cubitopia_seen_help', '1');
    }
  }

  hideHelp(): void {
    if (this.helpOverlay) {
      this.helpOverlay.style.display = 'none';
      this.helpVisible = false;
      StrategyCamera.suppressInput = false;
    }
  }

  isHelpVisible(): boolean {
    return this.helpVisible;
  }

  update(): void {
    // Called each frame — can be used for animations or time display
  }

  setGameMode(mode: 'pvai' | 'aivai'): void {
    const label = mode === 'pvai' ? 'Player vs AI' : 'AI vs AI';
    const color = mode === 'pvai' ? '#3498db' : '#e74c3c';
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
        position: absolute; top: 80px; right: 16px;
        background: rgba(0, 0, 0, 0.9); padding: 12px 16px; border-radius: 8px;
        font-size: 13px; border: 1px solid rgba(255,255,255,0.2); color: #ddd;
        min-width: 180px; pointer-events: none; z-index: 100;
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
    const resourceStr = tile.resource ? this.getResourceName(tile.resource) : 'None';
    const elevStr = tile.elevation;

    let modifiers = '';
    if (moveCost > 1) modifiers += `<div style="color:#e74c3c;">⚠ Movement cost: ${moveCost}x</div>`;
    if (moveCost === 1) modifiers += `<div style="color:#2ecc71;">✓ Normal movement</div>`;
    if (defBonus > 0) modifiers += `<div style="color:#3498db;">🛡 Defense bonus: +${defBonus}</div>`;
    if (atkBonus !== 0) modifiers += `<div style="color:#e67e22;">⚔ Attack modifier: ${atkBonus > 0 ? '+' : ''}${atkBonus}</div>`;
    if (tile.terrain === TerrainType.WATER) modifiers += `<div style="color:#e74c3c;">✗ Impassable</div>`;
    if (tile.terrain === TerrainType.FOREST) modifiers += `<div style="color:#27ae60;">🌲 Harvestable (wood)</div>`;
    if ((tile.terrain === TerrainType.MOUNTAIN || tile.terrain === TerrainType.SNOW) && tile.elevation >= 13) {
      modifiers += `<div style="color:#9b59b6;">💎 Snow blocks yield crystal</div>`;
      modifiers += `<div style="color:#95a5a6;">⛏ Stone blocks yield stone</div>`;
    } else if (tile.terrain === TerrainType.SNOW) {
      modifiers += `<div style="color:#9b59b6;">💎 Snow blocks yield crystal</div>`;
    } else if (tile.terrain === TerrainType.MOUNTAIN && tile.resource === ResourceType.IRON) {
      modifiers += `<div style="color:#c0652a;">⛏ Contains iron ore blocks</div>`;
    } else if (tile.terrain === TerrainType.MOUNTAIN) {
      modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone)</div>`;
    }
    if (tile.terrain === TerrainType.DESERT) modifiers += `<div style="color:#f0c040;">⛏ Mineable (sand → stone)</div>`;
    if (tile.terrain === TerrainType.JUNGLE) modifiers += `<div style="color:#2d6b30;">🌿 Dense jungle (wood)</div>`;
    if (tile.terrain === TerrainType.RIVER) modifiers += `<div style="color:#1e88e5;">🏊 Swimmable river</div>`;
    if (tile.terrain === TerrainType.LAKE) modifiers += `<div style="color:#1565c0;">🏊 Swimmable lake</div>`;
    if (tile.terrain === TerrainType.WATERFALL) modifiers += `<div style="color:#42a5f5;">💧 Waterfall</div>`;
    if (tile.elevation >= 4 && tile.terrain !== TerrainType.MOUNTAIN && tile.terrain !== TerrainType.SNOW && tile.terrain !== TerrainType.DESERT && tile.terrain !== TerrainType.JUNGLE) modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone)</div>`;

    this.terrainInfoPanel.innerHTML = `
      <div style="font-weight:bold; font-size:15px; color:${terrainColor}; margin-bottom:6px;">${terrainName}</div>
      <div style="margin-bottom:4px;">📍 Tile (${tile.position.q}, ${tile.position.r})</div>
      <div style="margin-bottom:4px;">📐 Elevation: ${elevStr}</div>
      <div style="margin-bottom:6px;">💎 Resource: ${resourceStr}</div>
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
      case TerrainType.JUNGLE: return -1;
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
