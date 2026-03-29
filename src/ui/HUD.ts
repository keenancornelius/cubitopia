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

  // Callbacks for control panel buttons
  private _onBuildWalls: (() => void) | null = null;
  private _onHarvest: (() => void) | null = null;
  private _onBarracks: (() => void) | null = null;
  private _onForestry: (() => void) | null = null;
  private _onMasonry: (() => void) | null = null;
  private _onSellWood: (() => void) | null = null;
  private _onSpawnWarrior: (() => void) | null = null;
  private _onSpawnArcher: (() => void) | null = null;
  private _onSpawnRider: (() => void) | null = null;
  private _onSpawnLumberjack: (() => void) | null = null;
  private _onSpawnBuilder: (() => void) | null = null;
  private _onFarmhouse: (() => void) | null = null;
  private _onSilo: (() => void) | null = null;
  private _onFarmPatch: (() => void) | null = null;
  private _onPlantTree: (() => void) | null = null;
  private _onSpawnVillager: (() => void) | null = null;
  private _onMine: (() => void) | null = null;
  private _onHelp: (() => void) | null = null;
  private _onPlantCrops: (() => void) | null = null;
  private _onWorkshop: (() => void) | null = null;
  private _onSpawnTrebuchet: (() => void) | null = null;
  private _onCraftRope: (() => void) | null = null;
  private _onSetStance: ((stance: UnitStance) => void) | null = null;
  private _onSetFormation: ((formation: FormationType) => void) | null = null;
  private _onRespawnUnits: (() => void) | null = null;
  private selectionCommandPanel: HTMLElement | null = null;

  onBuildWalls(cb: () => void) { this._onBuildWalls = cb; }
  onHarvest(cb: () => void) { this._onHarvest = cb; }
  onBarracks(cb: () => void) { this._onBarracks = cb; }
  onForestry(cb: () => void) { this._onForestry = cb; }
  onMasonry(cb: () => void) { this._onMasonry = cb; }
  onSellWood(cb: () => void) { this._onSellWood = cb; }
  onMine(cb: () => void) { this._onMine = cb; }
  onSpawnWarrior(cb: () => void) { this._onSpawnWarrior = cb; }
  onSpawnArcher(cb: () => void) { this._onSpawnArcher = cb; }
  onSpawnRider(cb: () => void) { this._onSpawnRider = cb; }
  onSpawnLumberjack(cb: () => void) { this._onSpawnLumberjack = cb; }
  onSpawnBuilder(cb: () => void) { this._onSpawnBuilder = cb; }
  onFarmhouse(cb: () => void) { this._onFarmhouse = cb; }
  onSilo(cb: () => void) { this._onSilo = cb; }
  onFarmPatch(cb: () => void) { this._onFarmPatch = cb; }
  onPlantTree(cb: () => void) { this._onPlantTree = cb; }
  onSpawnVillager(cb: () => void) { this._onSpawnVillager = cb; }
  onHelp(cb: () => void) { this._onHelp = cb; }
  onPlantCrops(cb: () => void) { this._onPlantCrops = cb; }
  onWorkshop(cb: () => void) { this._onWorkshop = cb; }
  onSpawnTrebuchet(cb: () => void) { this._onSpawnTrebuchet = cb; }
  onCraftRope(cb: () => void) { this._onCraftRope = cb; }

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

  private createControlPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: absolute; bottom: 16px; left: 16px;
      background: rgba(0, 0, 0, 0.85); padding: 8px 10px; border-radius: 10px;
      border: 2px solid rgba(255,255,255,0.2);
      display: flex; flex-direction: column; gap: 2px;
      pointer-events: auto; z-index: 101;
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

    // BUILDINGS section
    panel.appendChild(makeHeaderBtn('📦 BUILDINGS'));
    const buildingsRow1 = document.createElement('div');
    buildingsRow1.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    buildingsRow1.appendChild(makeBtn('Walls', 'B', '#2980b9', () => this._onBuildWalls?.()));
    buildingsRow1.appendChild(makeBtn('Barracks', 'K', '#e67e22', () => this._onBarracks?.()));
    buildingsRow1.appendChild(makeBtn('Forestry', 'F', '#6b8e23', () => this._onForestry?.()));
    panel.appendChild(buildingsRow1);
    const buildingsRow2 = document.createElement('div');
    buildingsRow2.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap; margin-top: 3px;';
    buildingsRow2.appendChild(makeBtn('Masonry', 'M', '#808080', () => this._onMasonry?.()));
    buildingsRow2.appendChild(makeBtn('Farmhouse', 'P', '#daa520', () => this._onFarmhouse?.()));
    buildingsRow2.appendChild(makeBtn('Silo', 'I', '#c0c0c0', () => this._onSilo?.()));
    buildingsRow2.appendChild(makeBtn('Workshop', 'W', '#5d4037', () => this._onWorkshop?.()));
    panel.appendChild(buildingsRow2);

    // UNITS section - Barracks units
    panel.appendChild(makeHeaderBtn('⚔️ BARRACKS'));
    const unitsRow1 = document.createElement('div');
    unitsRow1.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    unitsRow1.appendChild(makeBtn('Warrior', '1', '#c0392b', () => this._onSpawnWarrior?.()));
    unitsRow1.appendChild(makeBtn('Archer', '2', '#8e44ad', () => this._onSpawnArcher?.()));
    unitsRow1.appendChild(makeBtn('Rider', '3', '#d35400', () => this._onSpawnRider?.()));
    panel.appendChild(unitsRow1);

    // FORESTRY section
    panel.appendChild(makeHeaderBtn('🌲 FORESTRY'));
    const forestryRow = document.createElement('div');
    forestryRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    forestryRow.appendChild(makeBtn('Lumberjack', '4', '#8B4513', () => this._onSpawnLumberjack?.()));
    forestryRow.appendChild(makeBtn('Chop Trees', 'H', '#27ae60', () => this._onHarvest?.()));
    forestryRow.appendChild(makeBtn('Plant Trees', 'T', '#228B22', () => this._onPlantTree?.()));
    panel.appendChild(forestryRow);

    // MASONRY section
    panel.appendChild(makeHeaderBtn('🛠️ MASONRY'));
    const masonryRow = document.createElement('div');
    masonryRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    masonryRow.appendChild(makeBtn('Builder', '5', '#b8860b', () => this._onSpawnBuilder?.()));
    masonryRow.appendChild(makeBtn('Mine', 'N', '#ff8c00', () => this._onMine?.()));
    panel.appendChild(masonryRow);

    // FARMING section
    panel.appendChild(makeHeaderBtn('🌾 FARMING'));
    const farmRow = document.createElement('div');
    farmRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    farmRow.appendChild(makeBtn('Villager', '6', '#daa520', () => this._onSpawnVillager?.()));
    farmRow.appendChild(makeBtn('Farm/Hay', 'J', '#8bc34a', () => this._onFarmPatch?.()));
    farmRow.appendChild(makeBtn('Plant Crops', 'C', '#228B22', () => this._onPlantCrops?.()));
    panel.appendChild(farmRow);

    // WORKSHOP section
    panel.appendChild(makeHeaderBtn('🔧 WORKSHOP'));
    const workshopRow = document.createElement('div');
    workshopRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    workshopRow.appendChild(makeBtn('Trebuchet', '7', '#5d4037', () => this._onSpawnTrebuchet?.()));
    workshopRow.appendChild(makeBtn('Craft Rope', 'L', '#c9a96e', () => this._onCraftRope?.()));
    panel.appendChild(workshopRow);

    // ECONOMY section
    panel.appendChild(makeHeaderBtn('💰 ECONOMY'));
    const econRow = document.createElement('div');
    econRow.style.cssText = 'display: flex; gap: 3px; flex-wrap: wrap;';
    econRow.appendChild(makeBtn('Sell Wood', 'G', '#f39c12', () => this._onSellWood?.()));
    panel.appendChild(econRow);

    // HELP section
    panel.appendChild(makeHeaderBtn('❓ HELP'));
    const helpRow = document.createElement('div');
    helpRow.style.cssText = 'display: flex; gap: 3px;';
    helpRow.appendChild(makeBtn('Help', '?', '#7f8c8d', () => this._onHelp?.()));
    panel.appendChild(helpRow);

    this.container.appendChild(panel);
    return panel;
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
  private resWoodVal: HTMLElement | null = null;
  private resStoneVal: HTMLElement | null = null;
  private resFoodVal: HTMLElement | null = null;
  private resGoldVal: HTMLElement | null = null;
  private resGrassFiberVal: HTMLElement | null = null;
  private resClayVal: HTMLElement | null = null;
  private resRopeVal: HTMLElement | null = null;
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

    const wood = mkRes('🪵', '#f0c040');
    this.resWoodVal = wood.val;
    row.appendChild(wood.wrapper);
    row.appendChild(this.makeDot());

    const stone = mkRes('🪨', '#aaa');
    this.resStoneVal = stone.val;
    row.appendChild(stone.wrapper);
    row.appendChild(this.makeDot());

    const food = mkRes('🌾', '#8bc34a');
    this.resFoodVal = food.val;
    row.appendChild(food.wrapper);
    row.appendChild(this.makeDot());

    const grassFiber = mkRes('🌿', '#66bb6a');
    this.resGrassFiberVal = grassFiber.val;
    row.appendChild(grassFiber.wrapper);
    row.appendChild(this.makeDot());

    const clay = mkRes('🧱', '#bf8040');
    this.resClayVal = clay.val;
    row.appendChild(clay.wrapper);
    row.appendChild(this.makeDot());

    const rope = mkRes('🪢', '#c9a96e');
    this.resRopeVal = rope.val;
    row.appendChild(rope.wrapper);
    row.appendChild(this.makeDot());

    // Units button (interactive, with dropdown)
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
    row.appendChild(this.makeDot());

    // Gold
    const gold = mkRes('💰', '#f0c040');
    this.resGoldVal = gold.val;
    row.appendChild(gold.wrapper);

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

    // Event listeners (attached ONCE, never destroyed)
    unitBtn.addEventListener('mouseenter', () => {
      unitBtn.style.background = 'rgba(255,255,255,0.1)';
    });
    unitBtn.addEventListener('mouseleave', () => {
      if (!this.unitDropdownVisible) unitBtn.style.background = 'none';
    });

    const toggleDropdown = (e: Event) => {
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

    unitBtn.addEventListener('click', toggleDropdown);
    unitBtn.addEventListener('contextmenu', toggleDropdown);

    // Close dropdown when clicking anywhere else
    document.addEventListener('click', () => {
      if (this.unitDropdownVisible) {
        this.hideUnitDropdown();
        unitBtn.style.background = 'none';
      }
    });

    // Prevent clicks inside dropdown from closing it
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
    if (this.resWoodVal) this.resWoodVal.textContent = `${wood} wood`;
    if (this.resStoneVal) this.resStoneVal.textContent = `${stone} stone`;
    if (this.resFoodVal) this.resFoodVal.textContent = `${food} food`;
    if (this.resGoldVal) this.resGoldVal.textContent = `${player.resources.gold} gold`;
    if (this.resGrassFiberVal) this.resGrassFiberVal.textContent = `${player.resources.grass_fiber} fiber`;
    if (this.resClayVal) this.resClayVal.textContent = `${player.resources.clay} clay`;
    if (this.resRopeVal) this.resRopeVal.textContent = `${player.resources.rope} rope`;
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
      this.barracksModeIndicator.innerHTML = '🏗️ BARRACKS PLACEMENT — Click to place barracks (costs 10 wood) · [R] Rotate · [K] to exit';
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
      this.forestryModeIndicator.innerHTML = '🌳 FORESTRY PLACEMENT — Click to place forestry (costs 8 wood) · [R] Rotate · [F] to exit';
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
      this.masonryModeIndicator.innerHTML = '⬜ MASONRY PLACEMENT — Click to place masonry (costs 8 wood) · [R] Rotate · [M] to exit';
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
      this.farmhouseModeIndicator.innerHTML = '🏠 FARMHOUSE PLACEMENT — Click to place (costs 6 wood) · [R] Rotate · [P] to exit';
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
      this.siloModeIndicator.innerHTML = '🏗️ SILO PLACEMENT — Click to place (costs 5 wood) · [R] Rotate · [I] to exit';
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
      this.farmPatchModeIndicator.innerHTML = '🌾 HARVEST — Click plains for farms, tall grass for hay (villagers) · [J] to exit';
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
      this.plantTreeModeIndicator.innerHTML = '🌱 PLANT TREES — Click & drag on plains to plant saplings (1 wood each) · [T] to exit';
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
    this.mineModeIndicator.innerHTML = `MINE MODE — Depth: <span style="color:#fff;font-size:20px">${depth}</span> layers · Scroll to adjust · Click to mark · [N] to exit`;
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
      this.plantCropsModeIndicator.innerHTML = '🌱 PLANT CROPS — Click cleared plains to plant farm crops · [C] to exit';
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
      this.workshopModeIndicator.innerHTML = '🔧 WORKSHOP PLACEMENT — Click to place (costs 12 wood + 4 stone) · [R] Rotate · [W] to exit';
      this.container.appendChild(this.workshopModeIndicator);
    }
    this.workshopModeIndicator.style.display = active ? 'block' : 'none';
    if (active) this.hideAllModeIndicators('workshop');
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
    indicator.innerHTML = '🏰 WALL BUILD MODE — Click tiles for walls (1 stone) · Shift+click for gates (2 stone) · Walls auto-connect · [B] to exit';
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
      this.harvestModeIndicator.innerHTML = '🪓 HARVEST MODE — Click & drag to mark trees for chopping · [H] to exit';
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
                <div class="unit-name" style="color:#3498db;">Paladin</div>
                <div class="unit-desc">Heavy tank. 6 gold. High HP & defense. Ideal for holding choke points.</div>
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
              <div class="unit-icon" style="background:#1abc9c;">🗡️</div>
              <div>
                <div class="unit-name" style="color:#1abc9c;">Scout</div>
                <div class="unit-desc">Fast recon. 4 gold. High speed, great vision range. Light dagger attacks.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#2980b9;">🔮</div>
              <div>
                <div class="unit-name" style="color:#2980b9;">Mage</div>
                <div class="unit-desc">Ranged caster. 8 gold. Range 3. Fires magic orbs with sparkle trails.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#27ae60;">💚</div>
              <div>
                <div class="unit-name" style="color:#27ae60;">Healer</div>
                <div class="unit-desc">Support. Auto-heals allies within 2 hexes (2 HP/1.5s). Follows combat units.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#2c3e50;">🗡️</div>
              <div>
                <div class="unit-name" style="color:#9b59b6;">Assassin</div>
                <div class="unit-desc">Burst DPS. +3 attack from full HP (ambush). Fast jump-stab. Dual daggers.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#7f8c8d;">🛡️</div>
              <div>
                <div class="unit-name" style="color:#7f8c8d;">Shieldbearer</div>
                <div class="unit-desc">Tank. +2 defense aura to allies within 2 hex. Heater shield bash knocks enemies back 1 hex. Peels for nearby squishies.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#e74c3c;">🪓</div>
              <div>
                <div class="unit-name" style="color:#e74c3c;">Berserker</div>
                <div class="unit-desc">Melee DPS. Up to +4 attack at low HP (rage). Dual axes. Heavy overhead cleave.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#8e44ad;">⚡</div>
              <div>
                <div class="unit-name" style="color:#8e44ad;">Battlemage</div>
                <div class="unit-desc">AoE caster. Range 3. Splash damage to enemies within 1 hex of target. Firework explosions on impact.</div>
              </div>
            </div>
            <div class="unit-row">
              <div class="unit-icon" style="background:#546e7a;">⚔</div>
              <div>
                <div class="unit-name" style="color:#546e7a;">Greatsword</div>
                <div class="unit-desc">Heavy two-handed claymore. Slow but devastating 360° spin slash hits all adjacent enemies. Knockback pushes victims 1 hex away.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ACTIONS -->
        <div class="section">
          <div class="section-title" style="color: #f0c040;">🎮 Actions</div>
          <div class="tip"><span class="tip-bullet" style="color:#27ae60;">●</span> <span><span class="key">H</span> <strong>Chop Trees</strong> — Click & drag to mark forest tiles. Lumberjacks will chop them and carry wood to stockpile.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#8bc34a;">●</span> <span><span class="key">J</span> <strong>Farm/Harvest</strong> — Click plains tiles to create farm plots, or mark tall grass for hay. Villagers will harvest food.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#ff8c00;">●</span> <span><span class="key">N</span> <strong>Mine Terrain</strong> — Click & drag to mark terrain for mining. Builders will extract stone from mountains, ridges, sand, swamp.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#2980b9;">●</span> <span><span class="key">B</span> <strong>Build Walls</strong> — Click to place wall blueprints. Builders construct walls (1 stone each). Shift+click for gates (2 stone). <span class="key">R</span> to rotate.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#228B22;">●</span> <span><span class="key">T</span> <strong>Plant Trees</strong> — Click plains to plant saplings (1 wood). Grow into harvestable forests.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#f39c12;">●</span> <span><span class="key">G</span> <strong>Sell Wood</strong> — Trade 4 wood for 5 gold.</span></div>
        </div>

        <!-- BUILDINGS -->
        <div class="section">
          <div class="section-title" style="color: #e67e22;">🏗️ Buildings</div>
          <div class="tip"><span class="tip-bullet" style="color:#e67e22;">●</span> <span><span class="key">K</span> <strong>Barracks</strong> — 10 wood. Spawns combat units (Warriors, Archers, Riders) for gold.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#6b8e23;">●</span> <span><span class="key">F</span> <strong>Forestry</strong> — 8 wood. Spawns Lumberjacks for wood.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#808080;">●</span> <span><span class="key">M</span> <strong>Masonry</strong> — 8 wood. Spawns Builders for wood.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#daa520;">●</span> <span><span class="key">P</span> <strong>Farmhouse</strong> — 6 wood. Spawns Villagers for wood.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#c0c0c0;">●</span> <span><span class="key">I</span> <strong>Silo</strong> — 5 wood. Extra food storage capacity.</span></div>
          <div class="tip"><span class="tip-bullet" style="color:#5d4037;">●</span> <span><span class="key">W</span> <strong>Workshop</strong> — 12 wood + 4 stone. Crafts rope and spawns Trebuchets.</span></div>
        </div>

        <!-- RESOURCES -->
        <div class="section">
          <div class="section-title" style="color: #27ae60;">💎 Resources</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px;">
            <div class="tip"><span class="tip-bullet" style="color:#f0c040;">🪵</span> <span><strong style="color:#f0c040;">Wood</strong> — Harvested from forests by Lumberjacks. Used to build structures and train workers.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#aaa;">🪨</span> <span><strong style="color:#aaa;">Stone</strong> — Mined from mountains/terrain by Builders. Used for advanced buildings.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#8bc34a;">🌾</span> <span><strong style="color:#8bc34a;">Food</strong> — Harvested from farms/grass by Villagers. Feeds your population.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#f39c12;">💰</span> <span><strong style="color:#f39c12;">Gold</strong> — Earned by selling wood [G]. Used to train combat units.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#66bb6a;">🌿</span> <span><strong style="color:#66bb6a;">Grass Fiber</strong> — Gathered by Villagers when harvesting grass. Used to craft Rope.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#bf8040;">🧱</span> <span><strong style="color:#bf8040;">Clay</strong> — Mined from sand/desert terrain by Builders. Used to craft Rope.</span></div>
            <div class="tip"><span class="tip-bullet" style="color:#c9a96e;">🪢</span> <span><strong style="color:#c9a96e;">Rope</strong> — Crafted [L] from 3 fiber + 2 clay. Required for Trebuchets.</span></div>
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
          <div class="tip"><span class="tip-bullet">★</span> <span>All 3 stockpiles (wood, food, stone) appear next to your base.</span></div>
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
    if (tile.terrain === TerrainType.MOUNTAIN) modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone)</div>`;
    if (tile.terrain === TerrainType.DESERT) modifiers += `<div style="color:#f0c040;">⛏ Mineable (sand → stone)</div>`;
    if (tile.terrain === TerrainType.JUNGLE) modifiers += `<div style="color:#2d6b30;">🌿 Dense jungle (wood)</div>`;
    if (tile.terrain === TerrainType.RIVER) modifiers += `<div style="color:#1e88e5;">🏊 Swimmable river</div>`;
    if (tile.terrain === TerrainType.LAKE) modifiers += `<div style="color:#1565c0;">🏊 Swimmable lake</div>`;
    if (tile.terrain === TerrainType.WATERFALL) modifiers += `<div style="color:#42a5f5;">💧 Waterfall</div>`;
    if (tile.elevation >= 4 && tile.terrain !== TerrainType.MOUNTAIN && tile.terrain !== TerrainType.DESERT && tile.terrain !== TerrainType.JUNGLE) modifiers += `<div style="color:#95a5a6;">⛏ Mineable (stone)</div>`;

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
