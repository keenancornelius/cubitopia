// ============================================
// CUBITOPIA - Unified Debug Panel
// Tabbed panel merging Debug Tools, Army Composer,
// and Combat Monitor into a single overlay
// ============================================

import * as THREE from 'three';
import { Unit, UnitType, UnitState, ElementType } from '../types';
import { CombatLog, DebugEventType, DebugEvent } from './ArenaDebugConsole';
import { UNIT_CONFIG } from '../game/entities/UnitFactory';
import { UnitRenderer } from '../engine/UnitRenderer';

// ---- Army Composition Types ----
export interface ArmyComposition {
  blue: { type: UnitType; count: number }[];
  red: { type: UnitType; count: number }[];
}

// Combat unit definitions for the army composer
const COMBAT_UNIT_DEFS: { type: UnitType; label: string; color: string; emoji: string }[] = [
  { type: UnitType.WARRIOR, label: 'Warrior', color: '#c0392b', emoji: '⚔️' },
  { type: UnitType.ARCHER, label: 'Archer', color: '#8e44ad', emoji: '🏹' },
  { type: UnitType.RIDER, label: 'Rider', color: '#d35400', emoji: '🐎' },
  { type: UnitType.PALADIN, label: 'Paladin', color: '#3498db', emoji: '🛡️' },
  { type: UnitType.MAGE, label: 'Mage', color: '#2980b9', emoji: '🔮' },
  { type: UnitType.TREBUCHET, label: 'Trebuchet', color: '#5d4037', emoji: '🪨' },
  { type: UnitType.SCOUT, label: 'Scout', color: '#1abc9c', emoji: '👁️' },
  { type: UnitType.HEALER, label: 'Healer', color: '#27ae60', emoji: '💚' },
  { type: UnitType.ASSASSIN, label: 'Assassin', color: '#2c3e50', emoji: '🗡️' },
  { type: UnitType.SHIELDBEARER, label: 'Shield', color: '#7f8c8d', emoji: '🛡️' },
  { type: UnitType.BERSERKER, label: 'Berserker', color: '#e74c3c', emoji: '🪓' },
  { type: UnitType.BATTLEMAGE, label: 'B.Mage', color: '#8e44ad', emoji: '⚡' },
  { type: UnitType.GREATSWORD, label: 'G.Sword', color: '#546e7a', emoji: '🗡️' },
  { type: UnitType.OGRE, label: 'Ogre', color: '#4e342e', emoji: '👹' },
];

// Default composition: one of each
function defaultComposition(): { type: UnitType; count: number }[] {
  return COMBAT_UNIT_DEFS.map(d => ({ type: d.type, count: 1 }));
}

// ---- Preset Army Compositions ----
const ARMY_PRESETS: { name: string; label: string; comp: () => { type: UnitType; count: number }[] }[] = [
  { name: 'default', label: '1 Each', comp: defaultComposition },
  { name: 'ranged', label: 'Ranged Heavy', comp: () => [
    { type: UnitType.ARCHER, count: 4 },
    { type: UnitType.MAGE, count: 3 },
    { type: UnitType.BATTLEMAGE, count: 2 },
    { type: UnitType.SHIELDBEARER, count: 2 },
    { type: UnitType.HEALER, count: 2 },
  ]},
  { name: 'melee', label: 'Melee Rush', comp: () => [
    { type: UnitType.WARRIOR, count: 3 },
    { type: UnitType.BERSERKER, count: 3 },
    { type: UnitType.GREATSWORD, count: 2 },
    { type: UnitType.ASSASSIN, count: 2 },
    { type: UnitType.RIDER, count: 2 },
    { type: UnitType.HEALER, count: 1 },
  ]},
  { name: 'tank', label: 'Tank Wall', comp: () => [
    { type: UnitType.SHIELDBEARER, count: 4 },
    { type: UnitType.PALADIN, count: 3 },
    { type: UnitType.HEALER, count: 3 },
    { type: UnitType.ARCHER, count: 2 },
    { type: UnitType.MAGE, count: 1 },
  ]},
  { name: 'assassin', label: 'Assassin Squad', comp: () => [
    { type: UnitType.ASSASSIN, count: 5 },
    { type: UnitType.SCOUT, count: 3 },
    { type: UnitType.RIDER, count: 3 },
    { type: UnitType.HEALER, count: 2 },
  ]},
  { name: 'siege', label: 'Siege Line', comp: () => [
    { type: UnitType.TREBUCHET, count: 4 },
    { type: UnitType.SHIELDBEARER, count: 3 },
    { type: UnitType.PALADIN, count: 2 },
    { type: UnitType.ARCHER, count: 2 },
    { type: UnitType.HEALER, count: 2 },
  ]},
  { name: 'clear', label: 'Clear All', comp: () => [] },
];

// ---- Main Unified Debug Panel ----
export class DebugPanel {
  private panel: HTMLElement | null = null;
  private visible = false;
  private activeTab: 'tools' | 'army' | 'combat' | 'units' = 'tools';

  // Units tab state
  private selectedUnitType: UnitType = UnitType.WARRIOR;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewGroup: THREE.Group | null = null;
  private previewAnimFrame: number = 0;
  private previewAnimMode: 'idle' | 'moving' | 'attacking' | 'hit' | 'block' = 'idle';
  private previewElement: ElementType = ElementType.FIRE;

  // Weapon/arm debug state (persists across rebuilds within session)
  private weaponDebugEnabled = false;
  private weaponDebugFrozen = false; // freeze animation so sliders are visible
  private weaponDebugValues: Record<string, number> = {};
  private weaponDebugTargets: Set<string> = new Set(); // multi-select targets

  // Army composition state
  private armyComp: ArmyComposition = {
    blue: defaultComposition(),
    red: defaultComposition(),
  };
  private mirrorMode = true; // When true, red mirrors blue

  // Combat log state
  private logContainer: HTMLElement | null = null;
  private statsContainer: HTMLElement | null = null;
  private autoScroll = true;
  private lastEventCount = 0;
  private updateInterval: number | null = null;
  private allUnitsRef: Unit[] = [];

  // Filter toggles for combat tab
  private filters: Record<DebugEventType, boolean> = {
    [DebugEventType.TARGET]: true,
    [DebugEventType.KITE]: true,
    [DebugEventType.DAMAGE]: true,
    [DebugEventType.KILL]: true,
    [DebugEventType.KNOCKBACK]: true,
    [DebugEventType.PEEL]: true,
    [DebugEventType.HEAL]: true,
    [DebugEventType.SPLASH]: true,
    [DebugEventType.MOVE]: false,
  };

  // Callbacks (wired by main.ts)
  private _callbacks: DebugPanelCallbacks | null = null;

  setCallbacks(cb: DebugPanelCallbacks): void { this._callbacks = cb; }
  setUnits(units: Unit[]): void { this.allUnitsRef = units; }
  getArmyComposition(): ArmyComposition { return this.armyComp; }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.build();
      this.startAutoUpdate();
    } else {
      this.destroy();
    }
  }

  switchTab(tab: 'tools' | 'army' | 'combat' | 'units'): void {
    this.activeTab = tab;
    this.lastEventCount = 0; // Reset so combat tab rebuilds fully
    this.logContainer = null;
    this.statsContainer = null;
    if (this.panel) {
      this.rebuildContent();
    }
  }

  isVisible(): boolean { return this.visible; }

  // ---- BUILD PANEL ----
  private build(): void {
    if (this.panel) { this.rebuildContent(); return; }

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed; top: 56px; left: 16px;
      background: rgba(5, 8, 18, 0.94); padding: 0; border-radius: 8px;
      font-size: 11px; border: 2px solid rgba(255, 50, 50, 0.4);
      pointer-events: auto; z-index: 10001;
      font-family: 'Courier New', monospace; color: #ccc;
      max-height: calc(100vh - 80px); display: flex; flex-direction: column;
      backdrop-filter: blur(8px); width: 360px;
    `;
    panel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('wheel', (e) => { e.stopPropagation(); });

    document.body.appendChild(panel);
    this.panel = panel;

    // Add scrollbar CSS
    const style = document.createElement('style');
    style.id = 'debug-panel-style';
    style.textContent = `
      #debug-panel-content::-webkit-scrollbar { width: 6px; }
      #debug-panel-content::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
      #debug-panel-content::-webkit-scrollbar-thumb { background: rgba(255,50,50,0.3); border-radius: 3px; }
    `;
    if (!document.getElementById('debug-panel-style')) document.head.appendChild(style);

    this.rebuildContent();
  }

  private rebuildContent(): void {
    if (!this.panel) return;
    this.panel.innerHTML = '';

    // ---- Tab bar ----
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display: flex; border-bottom: 2px solid rgba(255,50,50,0.3);
    `;
    const tabs: { id: 'tools' | 'army' | 'combat' | 'units'; label: string; icon: string; color: string }[] = [
      { id: 'tools', label: 'TOOLS', icon: '🐛', color: '#ff4444' },
      { id: 'army', label: 'ARMY', icon: '⚔', color: '#00d4ff' },
      { id: 'combat', label: 'COMBAT', icon: '📊', color: '#ff9800' },
      { id: 'units', label: 'UNITS', icon: '🎮', color: '#76ff03' },
    ];
    for (const t of tabs) {
      const tab = document.createElement('div');
      const active = this.activeTab === t.id;
      tab.style.cssText = `
        flex: 1; padding: 8px 0; text-align: center; cursor: pointer;
        font-size: 11px; font-weight: bold; letter-spacing: 1px;
        color: ${active ? t.color : '#666'};
        background: ${active ? 'rgba(255,255,255,0.05)' : 'transparent'};
        border-bottom: ${active ? `2px solid ${t.color}` : '2px solid transparent'};
        transition: all 0.15s;
      `;
      tab.textContent = `${t.icon} ${t.label}`;
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchTab(t.id);
      });
      tab.addEventListener('mouseenter', () => { if (!active) tab.style.color = t.color; });
      tab.addEventListener('mouseleave', () => { if (!active) tab.style.color = '#666'; });
      tabBar.appendChild(tab);
    }
    this.panel.appendChild(tabBar);

    // ---- Content area ----
    const content = document.createElement('div');
    content.id = 'debug-panel-content';
    content.style.cssText = `
      flex: 1; overflow-y: auto; padding: 8px 10px;
      max-height: calc(100vh - 130px);
    `;
    this.panel.appendChild(content);

    switch (this.activeTab) {
      case 'tools': this.buildToolsTab(content); break;
      case 'army': this.buildArmyTab(content); break;
      case 'combat': this.buildCombatTab(content); break;
      case 'units': this.buildUnitsTab(content); break;
    }
  }

  // ==== TOOLS TAB (existing debug panel content) ====
  private buildToolsTab(container: HTMLElement): void {
    const cb = this._callbacks;
    if (!cb) return;

    const mkSection = (title: string, color: string) => {
      const s = document.createElement('div');
      s.style.cssText = `font-size:10px;color:${color};text-transform:uppercase;letter-spacing:1px;margin-top:8px;margin-bottom:4px;`;
      s.textContent = title;
      container.appendChild(s);
    };

    const mkToggle = (label: string, getter: () => boolean, setter: () => void, color?: string) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;';
      const box = document.createElement('span');
      const active = getter();
      box.style.cssText = `
        display:inline-block; width:14px; height:14px; border-radius:3px;
        border:1px solid ${active ? (color || '#4caf50') : '#555'};
        background:${active ? (color || '#4caf50') : 'transparent'};
        font-size:10px; text-align:center; line-height:14px; color:white; flex-shrink:0;
      `;
      box.textContent = active ? '✓' : '';
      const lbl = document.createElement('span');
      lbl.style.cssText = `color:${active ? '#fff' : '#999'};font-size:11px;`;
      lbl.textContent = label;
      row.appendChild(box);
      row.appendChild(lbl);
      row.addEventListener('click', () => { setter(); this.rebuildContent(); });
      container.appendChild(row);
    };

    const mkBtn = (label: string, color: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background:${color}; color:white; border:none; padding:3px 8px; font-size:10px;
        font-family:'Courier New',monospace; border-radius:4px; cursor:pointer;
        margin:2px 2px; font-weight:bold;
      `;
      btn.textContent = label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
      btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
      return btn;
    };

    // Arena Quick Restart
    mkSection('Arena', '#00e676');
    const arenaRow = document.createElement('div');
    arenaRow.style.cssText = 'display:flex;flex-wrap:wrap;margin-bottom:4px;';
    const restartBtn = mkBtn('⚔ Restart Arena', '#00c853', () => { cb.restartArena(); this.rebuildContent(); });
    restartBtn.style.cssText += 'padding:5px 12px;font-size:11px;';
    arenaRow.appendChild(restartBtn);
    container.appendChild(arenaRow);

    // Economy Cheats
    mkSection('Economy Cheats', '#f0c040');
    mkToggle('Free Spawn (no cost)', () => cb.getFlag('freeBuild'), () => cb.toggleFlag('freeBuild'), '#f0c040');
    mkToggle('Free Build (no building cost)', () => cb.getFlag('freePlace'), () => cb.toggleFlag('freePlace'), '#f0c040');
    mkToggle('Infinite Resources', () => cb.getFlag('infiniteResources'), () => cb.toggleFlag('infiniteResources'), '#f0c040');
    mkToggle('Instant Spawn (no timer)', () => cb.getFlag('instantSpawn'), () => cb.toggleFlag('instantSpawn'), '#f0c040');

    // Worker Actions
    mkSection('Worker Actions', '#8bc34a');
    mkToggle('Disable Auto-Chop', () => cb.getFlag('disableChop'), () => cb.toggleFlag('disableChop'), '#e67e22');
    mkToggle('Disable Auto-Mine', () => cb.getFlag('disableMine'), () => cb.toggleFlag('disableMine'), '#e67e22');
    mkToggle('Disable Auto-Harvest', () => cb.getFlag('disableHarvest'), () => cb.toggleFlag('disableHarvest'), '#e67e22');
    mkToggle('Disable Auto-Build Walls', () => cb.getFlag('disableBuild'), () => cb.toggleFlag('disableBuild'), '#e67e22');
    mkToggle('Disable Resource Deposit', () => cb.getFlag('disableDeposit'), () => cb.toggleFlag('disableDeposit'), '#e67e22');
    mkToggle('Disable Auto-Return', () => cb.getFlag('disableAutoReturn'), () => cb.toggleFlag('disableAutoReturn'), '#e67e22');

    // Combat & AI
    mkSection('Combat & AI', '#e74c3c');
    mkToggle('Disable All Combat', () => cb.getFlag('disableCombat'), () => cb.toggleFlag('disableCombat'), '#e74c3c');
    mkToggle('Disable AI Commander', () => cb.getFlag('disableAI'), () => cb.toggleFlag('disableAI'), '#e74c3c');
    mkToggle('God Mode (no damage)', () => cb.getFlag('godMode'), () => cb.toggleFlag('godMode'), '#9b59b6');

    // World
    mkSection('World', '#3498db');
    mkToggle('Disable Grass Growth', () => cb.getFlag('disableGrassGrowth'), () => cb.toggleFlag('disableGrassGrowth'), '#3498db');
    mkToggle('Disable Tree Regrowth', () => cb.getFlag('disableTreeGrowth'), () => cb.toggleFlag('disableTreeGrowth'), '#3498db');

    // Visuals & Tools
    mkSection('Visuals & Tools', '#9b59b6');
    mkToggle('Show Unit Overlay (HP/State)', () => cb.getFlag('showUnitOverlay'), () => cb.toggleFlag('showUnitOverlay'), '#9b59b6');
    mkToggle('Teleport Mode (click to warp)', () => cb.getFlag('teleportMode'), () => cb.toggleFlag('teleportMode'), '#e91e63');

    // Game Speed
    mkSection('Game Speed', '#00bcd4');
    const speedRow = document.createElement('div');
    speedRow.style.cssText = 'display:flex;gap:3px;margin-bottom:6px;';
    for (const s of [0.25, 0.5, 1, 2, 4, 8]) {
      const isActive = Math.abs(cb.getGameSpeed() - s) < 0.01;
      const btn = document.createElement('button');
      btn.style.cssText = `
        background:${isActive ? '#00bcd4' : '#333'}; color:${isActive ? '#000' : '#aaa'};
        border:1px solid ${isActive ? '#00bcd4' : '#555'}; padding:2px 6px; font-size:10px;
        font-family:'Courier New',monospace; border-radius:3px; cursor:pointer; font-weight:bold;
      `;
      btn.textContent = s + 'x';
      btn.addEventListener('click', (e) => { e.stopPropagation(); cb.setGameSpeed(s); this.rebuildContent(); });
      speedRow.appendChild(btn);
    }
    container.appendChild(speedRow);

    // Quick Actions
    mkSection('Quick Actions', '#ff9800');
    const qRow = document.createElement('div');
    qRow.style.cssText = 'display:flex;flex-wrap:wrap;margin-bottom:4px;';
    qRow.appendChild(mkBtn('+999 All Res', '#4caf50', () => cb.giveResources()));
    qRow.appendChild(mkBtn('Kill All Enemies', '#e74c3c', () => cb.killAllEnemy()));
    qRow.appendChild(mkBtn('Dmg Enemy Base', '#ff5722', () => cb.damageBase(1, 50)));
    qRow.appendChild(mkBtn('Dmg My Base', '#795548', () => cb.damageBase(0, 50)));
    container.appendChild(qRow);

    // Selected Unit Actions
    mkSection('Selected Unit', '#e91e63');
    const selRow = document.createElement('div');
    selRow.style.cssText = 'display:flex;flex-wrap:wrap;margin-bottom:4px;';
    selRow.appendChild(mkBtn('Heal', '#27ae60', () => cb.healSelected()));
    selRow.appendChild(mkBtn('Kill', '#e74c3c', () => cb.killSelected()));
    selRow.appendChild(mkBtn('+ATK', '#ff5722', () => cb.buffSelected('attack')));
    selRow.appendChild(mkBtn('+DEF', '#3498db', () => cb.buffSelected('defense')));
    selRow.appendChild(mkBtn('+HP', '#27ae60', () => cb.buffSelected('maxHealth')));
    selRow.appendChild(mkBtn('+SPD', '#00bcd4', () => cb.buffSelected('moveSpeed')));
    selRow.appendChild(mkBtn('+RNG', '#9b59b6', () => cb.buffSelected('range')));
    container.appendChild(selRow);

    // World Actions
    mkSection('World Actions', '#795548');
    const wRow = document.createElement('div');
    wRow.style.cssText = 'display:flex;flex-wrap:wrap;margin-bottom:4px;';
    wRow.appendChild(mkBtn('Clear Trees', '#6d4c41', () => cb.clearTrees()));
    wRow.appendChild(mkBtn('Clear Stones', '#78909c', () => cb.clearStones()));
    wRow.appendChild(mkBtn('Instant Win', '#ffd700', () => cb.instantWin()));
    wRow.appendChild(mkBtn('Instant Lose', '#b71c1c', () => cb.instantLose()));
    container.appendChild(wRow);

    // Spawn Count
    mkSection('Spawn Count', '#ff9800');
    const countRow = document.createElement('div');
    countRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;margin-bottom:4px;';
    for (const n of [1, 3, 5, 10, 20]) {
      const isActive = cb.getSpawnCount() === n;
      const btn = document.createElement('button');
      btn.textContent = `${n}`;
      btn.style.cssText = `padding:2px 8px;margin:1px;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:bold;color:#fff;background:${isActive ? '#ff9800' : '#555'};`;
      btn.onclick = (e) => { e.stopPropagation(); cb.setSpawnCount(n); this.rebuildContent(); };
      countRow.appendChild(btn);
    }
    container.appendChild(countRow);

    // Spawn Player Units
    mkSection('Spawn Player Units', '#9c27b0');
    const spawnRow = document.createElement('div');
    spawnRow.style.cssText = 'display:flex;flex-wrap:wrap;';
    const allDefs = [...COMBAT_UNIT_DEFS,
      { type: UnitType.LUMBERJACK, label: 'Lumber', color: '#6d4c41', emoji: '🪓' },
      { type: UnitType.BUILDER, label: 'Builder', color: '#b8860b', emoji: '🔨' },
      { type: UnitType.VILLAGER, label: 'Villager', color: '#daa520', emoji: '🌾' },
    ];
    for (const ud of allDefs) {
      spawnRow.appendChild(mkBtn(ud.label, ud.color, () => cb.spawnUnit(ud.type, cb.getSpawnCount())));
    }
    container.appendChild(spawnRow);

    // Spawn Enemy Units
    mkSection('Spawn Enemy Units', '#b71c1c');
    const enemyRow = document.createElement('div');
    enemyRow.style.cssText = 'display:flex;flex-wrap:wrap;';
    for (const ud of allDefs) {
      enemyRow.appendChild(mkBtn(ud.label, ud.color, () => cb.spawnEnemy(ud.type, cb.getSpawnCount())));
    }
    container.appendChild(enemyRow);

    // Spawn Test Armies — large balanced armies for testing tactical AI
    mkSection('Test Armies', '#00e676');
    const testNote = document.createElement('div');
    testNote.style.cssText = 'color:#888;font-size:9px;margin-bottom:4px;';
    testNote.textContent = 'Spawn balanced armies near each base (uses Army tab composition)';
    container.appendChild(testNote);
    const testRow = document.createElement('div');
    testRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px;';
    const testArmyPresets: { label: string; scale: number }[] = [
      { label: 'Small (x2)', scale: 2 },
      { label: 'Medium (x5)', scale: 5 },
      { label: 'Large (x10)', scale: 10 },
      { label: 'Massive (x20)', scale: 20 },
    ];
    for (const preset of testArmyPresets) {
      const btn = document.createElement('button');
      btn.style.cssText = 'background:#1b5e20;color:#fff;border:1px solid #00e67644;padding:4px 10px;font-size:10px;font-family:"Courier New",monospace;border-radius:3px;cursor:pointer;';
      btn.textContent = preset.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.spawnTestArmies(preset.scale);
      });
      btn.addEventListener('mouseenter', () => { btn.style.background = '#2e7d32'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#1b5e20'; });
      testRow.appendChild(btn);
    }
    container.appendChild(testRow);
  }

  // ==== ARMY TAB ====
  private buildArmyTab(container: HTMLElement): void {
    // Mirror toggle
    const mirrorRow = document.createElement('div');
    mirrorRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const mirrorBox = document.createElement('span');
    mirrorBox.style.cssText = `
      display:inline-block; width:14px; height:14px; border-radius:3px;
      border:1px solid ${this.mirrorMode ? '#00bcd4' : '#555'};
      background:${this.mirrorMode ? '#00bcd4' : 'transparent'};
      font-size:10px; text-align:center; line-height:14px; color:white; flex-shrink:0; cursor:pointer;
    `;
    mirrorBox.textContent = this.mirrorMode ? '✓' : '';
    mirrorBox.addEventListener('click', () => {
      this.mirrorMode = !this.mirrorMode;
      if (this.mirrorMode) this.armyComp.red = this.armyComp.blue.map(d => ({ ...d }));
      this.rebuildContent();
    });
    const mirrorLabel = document.createElement('span');
    mirrorLabel.style.cssText = 'color:#00bcd4;font-size:11px;';
    mirrorLabel.textContent = 'Mirror Mode (Red = Blue)';
    mirrorRow.appendChild(mirrorBox);
    mirrorRow.appendChild(mirrorLabel);
    container.appendChild(mirrorRow);

    // Helper to build a preset row for a given team
    const buildPresetRow = (team: 'blue' | 'red' | 'both', color: string): HTMLElement => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px;';
      for (const preset of ARMY_PRESETS) {
        const btn = document.createElement('button');
        btn.style.cssText = `
          background:#333; color:#ccc; border:1px solid ${color}44; padding:2px 6px;
          font-size:9px; font-family:'Courier New',monospace; border-radius:3px; cursor:pointer;
        `;
        btn.textContent = preset.label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (team === 'both' || team === 'blue') this.armyComp.blue = preset.comp();
          if (team === 'both' || team === 'red') this.armyComp.red = preset.comp();
          this.rebuildContent();
        });
        btn.addEventListener('mouseenter', () => { btn.style.background = '#555'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
        row.appendChild(btn);
      }
      // Clear All button
      const clearBtn = document.createElement('button');
      clearBtn.style.cssText = `
        background:#333; color:#888; border:1px solid #55555544; padding:2px 6px;
        font-size:9px; font-family:'Courier New',monospace; border-radius:3px; cursor:pointer;
      `;
      clearBtn.textContent = 'Clear All';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const empty = COMBAT_UNIT_DEFS.map(d => ({ type: d.type, count: 0 }));
        if (team === 'both' || team === 'blue') this.armyComp.blue = empty;
        if (team === 'both' || team === 'red') this.armyComp.red = empty.map(d => ({ ...d }));
        this.rebuildContent();
      });
      clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = '#555'; });
      clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = '#333'; });
      row.appendChild(clearBtn);
      return row;
    };

    if (this.mirrorMode) {
      // Single preset row that applies to both teams
      const presetSection = document.createElement('div');
      presetSection.style.cssText = 'font-size:10px;color:#ff9800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;';
      presetSection.textContent = 'Presets';
      container.appendChild(presetSection);
      container.appendChild(buildPresetRow('both', '#ff9800'));
    }

    // Build team editors (with inline presets when not mirrored)
    if (!this.mirrorMode) {
      // Blue presets + editor
      this.buildTeamEditor(container, 'blue', '#3498db', 'BLUE TEAM', buildPresetRow('blue', '#3498db'));
      // Red presets + editor
      this.buildTeamEditor(container, 'red', '#e74c3c', 'RED TEAM', buildPresetRow('red', '#e74c3c'));
    } else {
      this.buildTeamEditor(container, 'blue', '#3498db', 'BLUE TEAM');
      const note = document.createElement('div');
      note.style.cssText = 'color:#555;font-size:10px;font-style:italic;margin-top:8px;padding:4px;';
      note.textContent = 'Red team mirrors blue (disable Mirror Mode to edit separately)';
      container.appendChild(note);
    }

    // Total count display
    const blueTotal = this.armyComp.blue.reduce((s, d) => s + d.count, 0);
    const redTotal = this.mirrorMode ? blueTotal : this.armyComp.red.reduce((s, d) => s + d.count, 0);
    const totalRow = document.createElement('div');
    totalRow.style.cssText = 'margin-top:8px;padding:6px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;';
    totalRow.innerHTML = `
      <span style="color:#3498db;font-weight:bold">Blue: ${blueTotal} units</span>
      <span style="color:#e74c3c;font-weight:bold">Red: ${redTotal} units</span>
    `;
    container.appendChild(totalRow);

    // Apply note
    const applyNote = document.createElement('div');
    applyNote.style.cssText = 'color:#888;font-size:9px;text-align:center;margin-top:4px;';
    applyNote.textContent = 'Compositions apply on next Arena game start';
    container.appendChild(applyNote);
  }

  private buildTeamEditor(container: HTMLElement, team: 'blue' | 'red', color: string, title: string, presetRow?: HTMLElement): void {
    const teamComp = team === 'blue' ? this.armyComp.blue : this.armyComp.red;

    const header = document.createElement('div');
    header.style.cssText = `font-size:10px;color:${color};text-transform:uppercase;letter-spacing:1px;margin-top:6px;margin-bottom:4px;font-weight:bold;`;
    header.textContent = title;
    container.appendChild(header);

    // Inline preset row for this team (when not mirrored)
    if (presetRow) container.appendChild(presetRow);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:2px;';

    for (const unitDef of COMBAT_UNIT_DEFS) {
      const existing = teamComp.find(d => d.type === unitDef.type);
      const count = existing ? existing.count : 0;

      const row = document.createElement('div');
      row.style.cssText = `
        display:flex; align-items:center; gap:3px; padding:2px 4px;
        background:${count > 0 ? 'rgba(255,255,255,0.04)' : 'transparent'};
        border-radius:3px;
      `;

      const label = document.createElement('span');
      label.style.cssText = `color:${count > 0 ? '#ddd' : '#666'};font-size:10px;flex:1;white-space:nowrap;overflow:hidden;`;
      label.textContent = `${unitDef.emoji} ${unitDef.label}`;

      const minus = document.createElement('button');
      minus.style.cssText = `background:${count > 0 ? '#555' : '#333'};color:#fff;border:none;width:16px;height:16px;font-size:10px;border-radius:2px;cursor:pointer;padding:0;line-height:16px;`;
      minus.textContent = '-';
      minus.addEventListener('click', (e) => {
        e.stopPropagation();
        this.adjustUnit(team, unitDef.type, -1);
        this.rebuildContent();
      });

      const countEl = document.createElement('span');
      countEl.style.cssText = `color:${count > 0 ? color : '#555'};font-size:11px;font-weight:bold;min-width:14px;text-align:center;`;
      countEl.textContent = `${count}`;

      const plus = document.createElement('button');
      plus.style.cssText = 'background:#555;color:#fff;border:none;width:16px;height:16px;font-size:10px;border-radius:2px;cursor:pointer;padding:0;line-height:16px;';
      plus.textContent = '+';
      plus.addEventListener('click', (e) => {
        e.stopPropagation();
        this.adjustUnit(team, unitDef.type, 1);
        this.rebuildContent();
      });

      row.appendChild(label);
      row.appendChild(minus);
      row.appendChild(countEl);
      row.appendChild(plus);
      grid.appendChild(row);
    }
    container.appendChild(grid);
  }

  private adjustUnit(team: 'blue' | 'red', type: UnitType, delta: number): void {
    const comp = team === 'blue' ? this.armyComp.blue : this.armyComp.red;
    const existing = comp.find(d => d.type === type);
    if (existing) {
      existing.count = Math.max(0, existing.count + delta);
      if (existing.count === 0) {
        const idx = comp.indexOf(existing);
        comp.splice(idx, 1);
      }
    } else if (delta > 0) {
      comp.push({ type, count: delta });
    }
    // Mirror if in mirror mode and editing blue
    if (this.mirrorMode && team === 'blue') {
      this.armyComp.red = this.armyComp.blue.map(d => ({ ...d }));
    }
  }

  // ==== COMBAT TAB ====
  private buildCombatTab(container: HTMLElement): void {
    // Stats bar
    const stats = document.createElement('div');
    stats.style.cssText = `
      padding: 6px 0; border-bottom: 1px solid rgba(0,200,255,0.15);
      font-size: 10px; color: #888; display: flex; gap: 12px; flex-wrap: wrap;
    `;
    container.appendChild(stats);
    this.statsContainer = stats;

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.style.cssText = `
      padding: 4px 0; border-bottom: 1px solid rgba(0,200,255,0.15);
      display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 4px;
    `;
    const filterColors: Record<DebugEventType, string> = {
      [DebugEventType.TARGET]: '#888',
      [DebugEventType.KITE]: '#00bcd4',
      [DebugEventType.DAMAGE]: '#ff9800',
      [DebugEventType.KILL]: '#e74c3c',
      [DebugEventType.KNOCKBACK]: '#9c27b0',
      [DebugEventType.PEEL]: '#4caf50',
      [DebugEventType.HEAL]: '#66bb6a',
      [DebugEventType.SPLASH]: '#ff5722',
      [DebugEventType.MOVE]: '#607d8b',
    };
    for (const evType of Object.values(DebugEventType)) {
      const btn = document.createElement('button');
      const active = this.filters[evType];
      btn.style.cssText = `
        background: ${active ? filterColors[evType] : '#222'}; color: ${active ? '#fff' : '#555'};
        border: 1px solid ${active ? filterColors[evType] : '#333'}; padding: 1px 5px;
        font-size: 9px; font-family: 'Courier New', monospace; border-radius: 3px;
        cursor: pointer; text-transform: uppercase;
      `;
      btn.textContent = evType;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filters[evType] = !this.filters[evType];
        const now = this.filters[evType];
        btn.style.background = now ? filterColors[evType] : '#222';
        btn.style.color = now ? '#fff' : '#555';
        btn.style.borderColor = now ? filterColors[evType] : '#333';
        this.rebuildLog();
      });
      filterBar.appendChild(btn);
    }

    // CLR button
    const clrBtn = document.createElement('button');
    clrBtn.style.cssText = 'background:#555;color:#fff;border:none;padding:1px 5px;font-size:9px;font-family:\'Courier New\',monospace;border-radius:3px;cursor:pointer;margin-left:auto;';
    clrBtn.textContent = 'CLR';
    clrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      CombatLog.clear();
      this.lastEventCount = 0;
      if (this.logContainer) this.logContainer.innerHTML = '';
    });
    filterBar.appendChild(clrBtn);

    container.appendChild(filterBar);

    // Log container
    const log = document.createElement('div');
    log.style.cssText = `
      flex: 1; overflow-y: auto; padding: 0;
      min-height: 200px; max-height: calc(100vh - 280px);
    `;
    container.appendChild(log);
    this.logContainer = log;

    // Initial update
    this.updateCombatStats();
    this.rebuildLog();
  }

  private rebuildLog(): void {
    if (!this.logContainer) return;
    this.logContainer.innerHTML = '';
    const events = CombatLog.getEvents();
    const fragment = document.createDocumentFragment();
    for (const ev of events) {
      if (!this.filters[ev.type]) continue;
      fragment.appendChild(this.renderEvent(ev));
    }
    this.logContainer.appendChild(fragment);
    this.lastEventCount = events.length;
    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private renderEvent(ev: DebugEvent): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `
      padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.03);
      font-size: 10px; line-height: 1.4; word-break: break-word;
    `;
    const timeStr = String(ev.time).padStart(4, ' ');
    const teamColor = ev.owner === 0 ? '#3498db' : '#e74c3c';
    const teamLabel = ev.owner === 0 ? 'BLU' : 'RED';
    const typeColors: Record<DebugEventType, string> = {
      [DebugEventType.TARGET]: '#777',
      [DebugEventType.KITE]: '#00bcd4',
      [DebugEventType.DAMAGE]: '#ff9800',
      [DebugEventType.KILL]: '#ff1744',
      [DebugEventType.KNOCKBACK]: '#ce93d8',
      [DebugEventType.PEEL]: '#66bb6a',
      [DebugEventType.HEAL]: '#81c784',
      [DebugEventType.SPLASH]: '#ff7043',
      [DebugEventType.MOVE]: '#607d8b',
    };
    row.innerHTML = `<span style="color:#555">${timeStr}s</span> `
      + `<span style="color:${teamColor};font-weight:bold">[${teamLabel}]</span> `
      + `<span style="color:${typeColors[ev.type]}">${ev.type.padEnd(8)}</span> `
      + `<span style="color:#ddd">${ev.message}</span>`;
    return row;
  }

  private updateCombatStats(): void {
    if (!this.statsContainer || this.allUnitsRef.length === 0) return;
    const alive = [0, 0];
    const totalHp = [0, 0];
    const maxHp = [0, 0];
    for (const u of this.allUnitsRef) {
      if (u.state === UnitState.DEAD) continue;
      alive[u.owner]++;
      totalHp[u.owner] += u.currentHealth;
      maxHp[u.owner] += u.stats.maxHealth;
    }
    const pct0 = maxHp[0] > 0 ? Math.round(totalHp[0] / maxHp[0] * 100) : 0;
    const pct1 = maxHp[1] > 0 ? Math.round(totalHp[1] / maxHp[1] * 100) : 0;
    const evCount = CombatLog.getEvents().length;
    this.statsContainer.innerHTML = `
      <span style="color:#3498db;font-weight:bold">BLUE: ${alive[0]} alive (${pct0}%HP)</span>
      <span style="color:#e74c3c;font-weight:bold">RED: ${alive[1]} alive (${pct1}%HP)</span>
      <span style="color:#555">Events: ${evCount} T+${CombatLog.getTime()}s</span>
    `;
  }

  // ---- Auto-update loop (for combat tab live updates) ----
  private startAutoUpdate(): void {
    if (this.updateInterval) return;
    this.updateInterval = window.setInterval(() => this.onTick(), 250);
  }

  private onTick(): void {
    if (!this.visible) return;
    if (this.activeTab === 'combat') {
      this.updateCombatStats();
      // Append new events incrementally
      const events = CombatLog.getEvents();
      if (events.length !== this.lastEventCount && this.logContainer) {
        const fragment = document.createDocumentFragment();
        for (let i = this.lastEventCount; i < events.length; i++) {
          const ev = events[i];
          if (!this.filters[ev.type]) continue;
          fragment.appendChild(this.renderEvent(ev));
        }
        this.lastEventCount = events.length;
        this.logContainer.appendChild(fragment);
        while (this.logContainer.children.length > 300) {
          this.logContainer.removeChild(this.logContainer.firstChild!);
        }
        if (this.autoScroll) {
          this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }
      }
    }
  }

  // ==== UNITS TAB — Live stat sliders + 3D model preview ====
  private buildUnitsTab(container: HTMLElement): void {
    this.cleanupPreview();

    // ── Unit type selector (pill buttons) ──
    const selectorRow = document.createElement('div');
    selectorRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px;';
    for (const def of COMBAT_UNIT_DEFS) {
      const pill = document.createElement('div');
      const active = def.type === this.selectedUnitType;
      pill.style.cssText = `
        padding:3px 6px; border-radius:4px; cursor:pointer; font-size:10px;
        background:${active ? def.color : 'rgba(255,255,255,0.06)'};
        color:${active ? '#fff' : '#999'}; border:1px solid ${active ? def.color : '#333'};
        transition:all 0.12s; white-space:nowrap;
      `;
      pill.textContent = `${def.emoji} ${def.label}`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedUnitType = def.type;
        this.rebuildContent();
      });
      selectorRow.appendChild(pill);
    }
    container.appendChild(selectorRow);

    // ── 3D Model Preview ──
    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
      width:100%; height:160px; border-radius:6px; overflow:hidden;
      background:radial-gradient(ellipse at center, #1a2332 0%, #0a0e18 100%);
      border:1px solid rgba(255,255,255,0.08); margin-bottom:10px; position:relative;
    `;
    container.appendChild(previewContainer);

    // Unit name overlay
    const activeDef = COMBAT_UNIT_DEFS.find(d => d.type === this.selectedUnitType);
    const nameOverlay = document.createElement('div');
    nameOverlay.style.cssText = `
      position:absolute; bottom:6px; left:0; right:0; text-align:center;
      font-size:12px; font-weight:bold; color:${activeDef?.color ?? '#fff'};
      text-shadow:0 1px 4px rgba(0,0,0,0.8); pointer-events:none;
      letter-spacing:1px; text-transform:uppercase;
    `;
    nameOverlay.textContent = activeDef?.label ?? '';
    previewContainer.appendChild(nameOverlay);

    // Three.js mini renderer
    this.initPreview(previewContainer);

    // ── Animation Mode Buttons ──
    const animRow = document.createElement('div');
    animRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
    const animModes: { label: string; icon: string; mode: 'idle' | 'moving' | 'attacking' | 'hit' | 'block' }[] = [
      { label: 'Idle', icon: '🧍', mode: 'idle' },
      { label: 'Walk', icon: '🚶', mode: 'moving' },
      { label: 'Attack', icon: '⚔', mode: 'attacking' },
      { label: 'Hit', icon: '💥', mode: 'hit' },
      { label: 'Block', icon: '🛡', mode: 'block' },
    ];
    for (const am of animModes) {
      const btn = document.createElement('div');
      const active = am.mode === this.previewAnimMode;
      btn.style.cssText = `
        flex:1; padding:4px 0; text-align:center; cursor:pointer; font-size:10px;
        border-radius:4px; transition:all 0.15s;
        background:${active ? 'rgba(118,255,3,0.15)' : 'rgba(255,255,255,0.04)'};
        color:${active ? '#76ff03' : '#888'};
        border:1px solid ${active ? 'rgba(118,255,3,0.4)' : 'rgba(255,255,255,0.08)'};
      `;
      btn.textContent = `${am.icon} ${am.label}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.previewAnimMode = am.mode;
        this.rebuildContent();
      });
      animRow.appendChild(btn);
    }
    container.appendChild(animRow);

    // ── Element Selector (mages only) ──
    const isMageType = this.selectedUnitType === UnitType.MAGE || this.selectedUnitType === UnitType.BATTLEMAGE;
    if (isMageType) {
      const elemRow = document.createElement('div');
      elemRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
      const elemLabel = document.createElement('div');
      elemLabel.style.cssText = 'font-size:9px;color:#76ff03;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;line-height:26px;margin-right:4px;';
      elemLabel.textContent = 'ELEMENT';
      elemRow.appendChild(elemLabel);
      const elements: { label: string; icon: string; element: ElementType; color: string }[] = [
        { label: 'Fire', icon: '🔥', element: ElementType.FIRE, color: '#ff5500' },
        { label: 'Water', icon: '💧', element: ElementType.WATER, color: '#2288ff' },
        { label: 'Zap', icon: '⚡', element: ElementType.LIGHTNING, color: '#ccddff' },
        { label: 'Wind', icon: '🌪', element: ElementType.WIND, color: '#88dd88' },
        { label: 'Earth', icon: '🪨', element: ElementType.EARTH, color: '#aa8866' },
      ];
      for (const el of elements) {
        const btn = document.createElement('div');
        const active = this.previewElement === el.element;
        btn.style.cssText = `
          flex:1; padding:3px 0; text-align:center; cursor:pointer; font-size:9px;
          border-radius:4px; transition:all 0.15s;
          background:${active ? el.color + '33' : 'rgba(255,255,255,0.04)'};
          color:${active ? el.color : '#666'};
          border:1px solid ${active ? el.color + '88' : 'rgba(255,255,255,0.08)'};
        `;
        btn.textContent = `${el.icon}`;
        btn.title = el.label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.previewElement = el.element;
          this.rebuildContent();
        });
        elemRow.appendChild(btn);
      }
      container.appendChild(elemRow);
    }

    // ── Weapon / Arm Debug Tool ──
    this.buildWeaponDebugSection(container);

    // ── Stat Sliders ──
    const cfg = UNIT_CONFIG[this.selectedUnitType];
    const slidersDiv = document.createElement('div');
    slidersDiv.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    // Section: Combat Stats
    const combatHeader = document.createElement('div');
    combatHeader.style.cssText = 'font-size:9px;color:#76ff03;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;';
    combatHeader.textContent = '⚔ COMBAT STATS';
    slidersDiv.appendChild(combatHeader);

    const statSliders: { label: string; field: string; value: number; min: number; max: number; step: number; color: string; isStat: boolean }[] = [
      { label: 'HP', field: 'maxHealth', value: cfg.stats.maxHealth, min: 1, max: 50, step: 1, color: '#e74c3c', isStat: true },
      { label: 'ATK', field: 'attack', value: cfg.stats.attack, min: 0, max: 20, step: 1, color: '#ff9800', isStat: true },
      { label: 'DEF', field: 'defense', value: cfg.stats.defense, min: 0, max: 15, step: 1, color: '#2196f3', isStat: true },
      { label: 'RNG', field: 'range', value: cfg.stats.range, min: 1, max: 8, step: 1, color: '#9c27b0', isStat: true },
      { label: 'MOV', field: 'movement', value: cfg.stats.movement, min: 1, max: 6, step: 1, color: '#4caf50', isStat: true },
    ];

    for (const s of statSliders) {
      slidersDiv.appendChild(this.buildSliderRow(s.label, s.field, s.value, s.min, s.max, s.step, s.color, s.isStat));
    }

    // Section: Speed
    const speedHeader = document.createElement('div');
    speedHeader.style.cssText = 'font-size:9px;color:#76ff03;text-transform:uppercase;letter-spacing:1px;margin-top:6px;margin-bottom:2px;';
    speedHeader.textContent = '⚡ SPEED';
    slidersDiv.appendChild(speedHeader);

    const speedSliders: { label: string; field: string; value: number; min: number; max: number; step: number; color: string; isStat: boolean }[] = [
      { label: 'Move Spd', field: 'moveSpeed', value: cfg.moveSpeed, min: 0.2, max: 5.0, step: 0.1, color: '#00bcd4', isStat: false },
      { label: 'Atk Spd', field: 'attackSpeed', value: cfg.attackSpeed, min: 0.1, max: 3.0, step: 0.1, color: '#ff5722', isStat: false },
    ];

    for (const s of speedSliders) {
      slidersDiv.appendChild(this.buildSliderRow(s.label, s.field, s.value, s.min, s.max, s.step, s.color, s.isStat));
    }

    container.appendChild(slidersDiv);

    // ── Reset button ──
    const resetBtn = document.createElement('div');
    resetBtn.style.cssText = `
      margin-top:10px; padding:5px 0; text-align:center; cursor:pointer;
      font-size:10px; color:#ff4444; border:1px solid rgba(255,50,50,0.3);
      border-radius:4px; background:rgba(255,50,50,0.08);
      transition:all 0.15s;
    `;
    resetBtn.textContent = '↺ RESET TO DEFAULTS';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Reset is handled by reloading from initial config — for now just rebuild
      this.rebuildContent();
    });
    resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(255,50,50,0.2)'; });
    resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(255,50,50,0.08)'; });
    container.appendChild(resetBtn);
  }

  // ── Weapon / Arm Debug Tool ──
  private buildWeaponDebugSection(container: HTMLElement): void {
    // Toggle button
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const toggleBtn = document.createElement('div');
    const isOn = this.weaponDebugEnabled;
    toggleBtn.style.cssText = `
      flex:1; padding:4px 0; text-align:center; cursor:pointer; font-size:10px;
      border-radius:4px; transition:all 0.15s;
      background:${isOn ? 'rgba(255,152,0,0.18)' : 'rgba(255,255,255,0.04)'};
      color:${isOn ? '#ff9800' : '#666'};
      border:1px solid ${isOn ? 'rgba(255,152,0,0.5)' : 'rgba(255,255,255,0.08)'};
    `;
    toggleBtn.textContent = `🔧 ${isOn ? 'HIDE' : 'SHOW'} WEAPON DEBUG`;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.weaponDebugEnabled = !this.weaponDebugEnabled;
      this.rebuildContent();
    });
    toggleRow.appendChild(toggleBtn);
    container.appendChild(toggleRow);

    if (!isOn || !this.previewGroup) return;

    const debugDiv = document.createElement('div');
    debugDiv.style.cssText = `
      border:1px solid rgba(255,152,0,0.3); border-radius:6px; padding:8px;
      background:rgba(255,152,0,0.05); margin-bottom:10px;
    `;

    // Freeze animation toggle
    const freezeRow = document.createElement('div');
    freezeRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
    const freezeBtn = document.createElement('div');
    freezeBtn.style.cssText = `
      flex:1; padding:3px 0; text-align:center; cursor:pointer; font-size:10px;
      border-radius:4px;
      background:${this.weaponDebugFrozen ? 'rgba(33,150,243,0.2)' : 'rgba(255,255,255,0.04)'};
      color:${this.weaponDebugFrozen ? '#2196f3' : '#888'};
      border:1px solid ${this.weaponDebugFrozen ? 'rgba(33,150,243,0.5)' : 'rgba(255,255,255,0.08)'};
    `;
    freezeBtn.textContent = this.weaponDebugFrozen ? '❄ FROZEN (click to unfreeze)' : '▶ ANIMATING (click to freeze)';
    freezeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.weaponDebugFrozen = !this.weaponDebugFrozen;
      this.rebuildContent();
    });
    freezeRow.appendChild(freezeBtn);
    debugDiv.appendChild(freezeRow);

    // Discover named meshes in the model for target selector
    const namedMeshes: { name: string; depth: number }[] = [];
    const scanGroup = (obj: THREE.Object3D, depth: number) => {
      if (obj.name && obj.name !== '' && depth > 0) {
        namedMeshes.push({ name: obj.name, depth });
      }
      for (const child of obj.children) scanGroup(child, depth + 1);
    };
    scanGroup(this.previewGroup, 0);

    // Target selector — multi-select pill row of available parts
    const targetHeader = document.createElement('div');
    targetHeader.style.cssText = 'font-size:9px;color:#ff9800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;';
    targetHeader.textContent = '🎯 TARGET MESHES (multi-select)';
    debugDiv.appendChild(targetHeader);

    const targetRow = document.createElement('div');
    targetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin-bottom:8px;max-height:60px;overflow-y:auto;';

    // Categorize meshes
    const weaponNames = namedMeshes.filter(m =>
      /bow|weapon|shield|sword|staff|orb|axe|lance|club|mace|hammer|throw-arm|trebuchet/i.test(m.name)
    );
    const armNames = namedMeshes.filter(m => /^arm-/i.test(m.name));
    const legNames = namedMeshes.filter(m => /^leg-/i.test(m.name));
    const otherNames = namedMeshes.filter(m =>
      !weaponNames.some(w => w.name === m.name) &&
      !armNames.some(a => a.name === m.name) &&
      !legNames.some(l => l.name === m.name) &&
      !/selection|attack-target/i.test(m.name)
    );

    // For weapon grouping: identify group parents and their children
    const groupParents = new Set<string>(); // e.g., 'sword-group'
    const groupChildren = new Map<string, Set<string>>(); // 'sword-group' -> { 'sword-blade', 'sword-crossguard' }
    for (const m of weaponNames) {
      const groupMatch = m.name.match(/^(.+-group)$/);
      if (groupMatch) {
        groupParents.add(m.name);
        groupChildren.set(m.name, new Set());
      }
    }
    // Find children of groups (any mesh whose prefix matches a group)
    for (const m of weaponNames) {
      if (!groupParents.has(m.name)) {
        for (const groupName of groupParents) {
          const prefix = groupName.slice(0, -'-group'.length); // 'sword-group' -> 'sword'
          if (m.name.startsWith(prefix + '-') && m.name !== prefix) {
            if (!groupChildren.has(groupName)) groupChildren.set(groupName, new Set());
            groupChildren.get(groupName)!.add(m.name);
          }
        }
      }
    }

    // Filter weapon pills: show groups and standalone weapons (hide grouped children)
    const groupedChildren = new Set<string>();
    for (const children of groupChildren.values()) {
      for (const child of children) groupedChildren.add(child);
    }
    const weaponPillNames = weaponNames.filter(m => !groupedChildren.has(m.name));

    // Auto-select: if empty, add first weapon pill
    if (this.weaponDebugTargets.size === 0 && weaponPillNames.length > 0) {
      this.weaponDebugTargets.add(weaponPillNames[0].name);
    }

    const addTargetPill = (name: string, color: string) => {
      const pill = document.createElement('div');
      const active = this.weaponDebugTargets.has(name);
      pill.style.cssText = `
        padding:2px 5px; border-radius:3px; cursor:pointer; font-size:8px;
        background:${active ? color + '33' : 'rgba(255,255,255,0.04)'};
        color:${active ? color : '#777'}; border:1px solid ${active ? color + '88' : '#333'};
        white-space:nowrap;
      `;
      pill.textContent = name;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.weaponDebugTargets.has(name)) {
          this.weaponDebugTargets.delete(name);
        } else {
          this.weaponDebugTargets.add(name);
        }
        this.rebuildContent();
      });
      targetRow.appendChild(pill);
    };

    // Weapons first (groups and standalone), then arms, then legs, then other
    for (const m of weaponPillNames) addTargetPill(m.name, '#ff9800');
    for (const m of armNames) addTargetPill(m.name, '#4caf50');
    for (const m of legNames) addTargetPill(m.name, '#2196f3');
    for (const m of otherNames) addTargetPill(m.name, '#9e9e9e');

    debugDiv.appendChild(targetRow);

    // Find the first selected mesh (or any valid mesh to show properties)
    let targetMesh: THREE.Object3D | undefined;
    for (const name of this.weaponDebugTargets) {
      const mesh = this.previewGroup.getObjectByName(name);
      if (mesh) {
        targetMesh = mesh;
        break;
      }
    }
    if (!targetMesh && this.weaponDebugTargets.size === 0) {
      const noTarget = document.createElement('div');
      noTarget.style.cssText = 'font-size:10px;color:#666;text-align:center;padding:8px 0;';
      noTarget.textContent = 'No target meshes selected';
      debugDiv.appendChild(noTarget);
      container.appendChild(debugDiv);
      return;
    }

    // Current values readout (show first selected mesh and which targets are selected)
    const selectedLabel = Array.from(this.weaponDebugTargets).join(', ');
    const readout = document.createElement('div');
    readout.style.cssText = 'font-size:8px;color:#aaa;font-family:monospace;margin-bottom:6px;background:rgba(0,0,0,0.3);padding:4px;border-radius:3px;line-height:1.4;';
    if (targetMesh) {
      readout.textContent = `[${selectedLabel}]\npos(${targetMesh.position.x.toFixed(3)}, ${targetMesh.position.y.toFixed(3)}, ${targetMesh.position.z.toFixed(3)}) rot(${targetMesh.rotation.x.toFixed(3)}, ${targetMesh.rotation.y.toFixed(3)}, ${targetMesh.rotation.z.toFixed(3)})`;
    }
    debugDiv.appendChild(readout);

    // Position sliders
    const posHeader = document.createElement('div');
    posHeader.style.cssText = 'font-size:9px;color:#ff9800;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;';
    posHeader.textContent = '📐 POSITION';
    debugDiv.appendChild(posHeader);

    const posAxes: { label: string; axis: 'x' | 'y' | 'z'; color: string }[] = [
      { label: 'X', axis: 'x', color: '#f44336' },
      { label: 'Y', axis: 'y', color: '#4caf50' },
      { label: 'Z', axis: 'z', color: '#2196f3' },
    ];

    for (const ax of posAxes) {
      const key = `pos_${ax.axis}`;
      const baseVal = this.weaponDebugValues[key] ?? targetMesh?.position[ax.axis] ?? 0;
      debugDiv.appendChild(this.buildDebugSlider(
        ax.label, key, baseVal, -1.5, 1.5, 0.005, ax.color,
        (val) => {
          for (const targetName of this.weaponDebugTargets) {
            const mesh = this.previewGroup?.getObjectByName(targetName);
            if (mesh) mesh.position[ax.axis] = val;
          }
          const firstMesh = targetMesh || Array.from(this.weaponDebugTargets).map(n => this.previewGroup?.getObjectByName(n)).find(m => m);
          if (firstMesh) {
            const selectedLabel = Array.from(this.weaponDebugTargets).join(', ');
            readout.textContent = `[${selectedLabel}]\npos(${firstMesh.position.x.toFixed(3)}, ${firstMesh.position.y.toFixed(3)}, ${firstMesh.position.z.toFixed(3)}) rot(${firstMesh.rotation.x.toFixed(3)}, ${firstMesh.rotation.y.toFixed(3)}, ${firstMesh.rotation.z.toFixed(3)})`;
          }
        }
      ));
    }

    // Rotation sliders
    const rotHeader = document.createElement('div');
    rotHeader.style.cssText = 'font-size:9px;color:#ff9800;text-transform:uppercase;letter-spacing:1px;margin-top:4px;margin-bottom:2px;';
    rotHeader.textContent = '🔄 ROTATION';
    debugDiv.appendChild(rotHeader);

    const rotAxes: { label: string; axis: 'x' | 'y' | 'z'; color: string }[] = [
      { label: 'RX', axis: 'x', color: '#e91e63' },
      { label: 'RY', axis: 'y', color: '#8bc34a' },
      { label: 'RZ', axis: 'z', color: '#03a9f4' },
    ];

    for (const ax of rotAxes) {
      const key = `rot_${ax.axis}`;
      const baseVal = this.weaponDebugValues[key] ?? targetMesh?.rotation[ax.axis] ?? 0;
      debugDiv.appendChild(this.buildDebugSlider(
        ax.label, key, baseVal, -Math.PI, Math.PI, 0.01, ax.color,
        (val) => {
          for (const targetName of this.weaponDebugTargets) {
            const mesh = this.previewGroup?.getObjectByName(targetName);
            if (mesh) mesh.rotation[ax.axis] = val;
          }
          const firstMesh = targetMesh || Array.from(this.weaponDebugTargets).map(n => this.previewGroup?.getObjectByName(n)).find(m => m);
          if (firstMesh) {
            const selectedLabel = Array.from(this.weaponDebugTargets).join(', ');
            readout.textContent = `[${selectedLabel}]\npos(${firstMesh.position.x.toFixed(3)}, ${firstMesh.position.y.toFixed(3)}, ${firstMesh.position.z.toFixed(3)}) rot(${firstMesh.rotation.x.toFixed(3)}, ${firstMesh.rotation.y.toFixed(3)}, ${firstMesh.rotation.z.toFixed(3)})`;
          }
        }
      ));
    }

    // Scale slider (uniform)
    const scaleHeader = document.createElement('div');
    scaleHeader.style.cssText = 'font-size:9px;color:#ff9800;text-transform:uppercase;letter-spacing:1px;margin-top:4px;margin-bottom:2px;';
    scaleHeader.textContent = '📏 SCALE';
    debugDiv.appendChild(scaleHeader);

    const scaleKey = 'scale';
    const scaleBase = this.weaponDebugValues[scaleKey] ?? targetMesh?.scale.x ?? 1;
    debugDiv.appendChild(this.buildDebugSlider(
      'S', scaleKey, scaleBase, 0.1, 3.0, 0.01, '#ff9800',
      (val) => {
        for (const targetName of this.weaponDebugTargets) {
          const mesh = this.previewGroup?.getObjectByName(targetName);
          if (mesh) mesh.scale.set(val, val, val);
        }
      }
    ));

    // Copy code button — outputs the current values as code to console
    const copyRow = document.createElement('div');
    copyRow.style.cssText = 'display:flex;gap:4px;margin-top:8px;';
    const copyBtn = document.createElement('div');
    copyBtn.style.cssText = `
      flex:1; padding:4px 0; text-align:center; cursor:pointer; font-size:10px;
      border-radius:4px; background:rgba(76,175,80,0.15); color:#4caf50;
      border:1px solid rgba(76,175,80,0.4); transition:all 0.15s;
    `;
    copyBtn.textContent = '📋 COPY VALUES TO CONSOLE';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.weaponDebugTargets.size === 0) return;
      let output = '';
      for (const targetName of this.weaponDebugTargets) {
        const mesh = this.previewGroup?.getObjectByName(targetName);
        if (!mesh) continue;
        const code = `// ${targetName} — debug values\n` +
          `.position.set(${mesh.position.x.toFixed(4)}, ${mesh.position.y.toFixed(4)}, ${mesh.position.z.toFixed(4)});\n` +
          `.rotation.set(${mesh.rotation.x.toFixed(4)}, ${mesh.rotation.y.toFixed(4)}, ${mesh.rotation.z.toFixed(4)});\n` +
          `.scale.set(${mesh.scale.x.toFixed(4)}, ${mesh.scale.y.toFixed(4)}, ${mesh.scale.z.toFixed(4)});\n`;
        output += code;
      }
      console.log('%c[WeaponDebug] Selected targets: ' + Array.from(this.weaponDebugTargets).join(', '), 'color:#ff9800;font-weight:bold;');
      console.log(output);
      copyBtn.textContent = '✅ COPIED TO CONSOLE';
      setTimeout(() => { copyBtn.textContent = '📋 COPY VALUES TO CONSOLE'; }, 1500);
    });
    copyRow.appendChild(copyBtn);

    // Reset button
    const resetDebugBtn = document.createElement('div');
    resetDebugBtn.style.cssText = `
      flex:1; padding:4px 0; text-align:center; cursor:pointer; font-size:10px;
      border-radius:4px; background:rgba(255,50,50,0.1); color:#ff4444;
      border:1px solid rgba(255,50,50,0.3); transition:all 0.15s;
    `;
    resetDebugBtn.textContent = '↺ RESET';
    resetDebugBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.weaponDebugValues = {};
      this.rebuildContent();
    });
    copyRow.appendChild(resetDebugBtn);
    debugDiv.appendChild(copyRow);

    container.appendChild(debugDiv);
  }

  private buildDebugSlider(
    label: string, key: string, value: number,
    min: number, max: number, step: number, color: string,
    onChange: (val: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;height:20px;';

    const lbl = document.createElement('div');
    lbl.style.cssText = `width:22px;font-size:9px;color:${color};font-weight:bold;text-align:right;flex-shrink:0;`;
    lbl.textContent = label;
    row.appendChild(lbl);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    const sliderId = `dbg-${key}-${Date.now()}`;
    slider.id = sliderId;
    slider.style.cssText = `
      flex:1; height:4px; -webkit-appearance:none; appearance:none;
      background:linear-gradient(to right, ${color}44, ${color});
      border-radius:2px; outline:none; cursor:pointer;
    `;
    const thumbStyle = document.createElement('style');
    thumbStyle.textContent = `
      #${sliderId}::-webkit-slider-thumb {
        -webkit-appearance:none; appearance:none; width:10px; height:10px;
        border-radius:50%; background:${color}; cursor:pointer;
        box-shadow:0 0 3px ${color}88;
      }
    `;
    document.head.appendChild(thumbStyle);
    row.appendChild(slider);

    const valDisplay = document.createElement('div');
    valDisplay.style.cssText = 'width:42px;font-size:9px;color:#ccc;text-align:center;font-family:monospace;flex-shrink:0;';
    valDisplay.textContent = value.toFixed(3);
    row.appendChild(valDisplay);

    slider.addEventListener('input', (e) => {
      e.stopPropagation();
      const newVal = parseFloat(slider.value);
      valDisplay.textContent = newVal.toFixed(3);
      this.weaponDebugValues[key] = newVal;
      onChange(newVal);
    });

    // Store initial value
    if (!(key in this.weaponDebugValues)) {
      this.weaponDebugValues[key] = value;
    }

    return row;
  }

  private buildSliderRow(label: string, field: string, value: number, min: number, max: number, step: number, color: string, isStat: boolean): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;height:22px;';

    // Label
    const lbl = document.createElement('div');
    lbl.style.cssText = `width:58px;font-size:10px;color:${color};font-weight:bold;text-align:right;flex-shrink:0;`;
    lbl.textContent = label;
    row.appendChild(lbl);

    // Slider track container
    const trackWrap = document.createElement('div');
    trackWrap.style.cssText = 'flex:1;position:relative;height:14px;display:flex;align-items:center;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = `
      width:100%; height:6px; -webkit-appearance:none; appearance:none;
      background:linear-gradient(to right, ${color}44, ${color});
      border-radius:3px; outline:none; cursor:pointer;
    `;
    // Webkit thumb styling
    const thumbStyle = document.createElement('style');
    const sliderId = `unit-slider-${field}-${Date.now()}`;
    slider.id = sliderId;
    thumbStyle.textContent = `
      #${sliderId}::-webkit-slider-thumb {
        -webkit-appearance:none; appearance:none; width:12px; height:12px;
        border-radius:50%; background:${color}; cursor:pointer;
        box-shadow:0 0 4px ${color}88;
      }
    `;
    document.head.appendChild(thumbStyle);
    trackWrap.appendChild(slider);
    row.appendChild(trackWrap);

    // Value display
    const valDisplay = document.createElement('div');
    const isFloat = step < 1;
    valDisplay.style.cssText = `width:32px;font-size:11px;color:#fff;text-align:center;font-weight:bold;flex-shrink:0;`;
    valDisplay.textContent = isFloat ? Number(value).toFixed(1) : String(value);
    row.appendChild(valDisplay);

    // On change — apply to UNIT_CONFIG and live units
    slider.addEventListener('input', (e) => {
      e.stopPropagation();
      const newVal = parseFloat(slider.value);
      valDisplay.textContent = isFloat ? newVal.toFixed(1) : String(Math.round(newVal));

      // Update UNIT_CONFIG directly
      if (isStat) {
        (UNIT_CONFIG[this.selectedUnitType].stats as any)[field] = newVal;
      } else {
        (UNIT_CONFIG[this.selectedUnitType] as any)[field] = newVal;
      }

      // Apply to all live units of this type via callback
      if (this._callbacks) {
        this._callbacks.applyUnitStatChange(this.selectedUnitType, isStat ? `stats.${field}` : field, newVal);
      }
    });

    return row;
  }

  private initPreview(container: HTMLElement): void {
    const width = 340;
    const height = 160;

    // Scene
    const scene = new THREE.Scene();
    this.previewScene = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(1.5, 1.8, 2.5);
    camera.lookAt(0, 0.3, 0);
    this.previewCamera = camera;

    // Lights
    const ambient = new THREE.AmbientLight(0x667788, 0.7);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(3, 5, 4);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0x4488ff, 0.4);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    // Ground plane (subtle grid)
    const groundGeo = new THREE.PlaneGeometry(3, 3);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x1a2332, transparent: true, opacity: 0.6 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.15;
    scene.add(ground);

    // Unit model
    const group = new THREE.Group();
    UnitRenderer.buildUnitModel(group, this.selectedUnitType, 0x3498db);
    scene.add(group);
    this.previewGroup = group;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.insertBefore(renderer.domElement, container.firstChild);
    renderer.domElement.style.cssText = 'border-radius:6px;display:block;';
    this.previewRenderer = renderer;

    // Animate — turntable rotation + unit animation
    const animate = () => {
      if (!this.previewRenderer || !this.previewScene || !this.previewCamera || !this.previewGroup) return;
      const time = performance.now() / 1000;
      // Slow turntable only in idle mode; pause rotation during walk/attack/hit so the anim is readable
      if (this.previewAnimMode === 'idle' && !this.weaponDebugFrozen) {
        this.previewGroup.rotation.y += 0.008;
      }
      // Run unit animation via callback (skip if frozen for debug)
      if (this._callbacks && !this.weaponDebugFrozen) {
        this._callbacks.animatePreview(this.previewGroup, this.selectedUnitType, this.previewAnimMode, time);
      }
      // Apply debug overrides (re-apply each frame so animation doesn't clobber them)
      if (this.weaponDebugEnabled && this.weaponDebugTargets.size > 0) {
        const v = this.weaponDebugValues;
        for (const targetName of this.weaponDebugTargets) {
          const dbgMesh = this.previewGroup.getObjectByName(targetName);
          if (dbgMesh) {
            if ('pos_x' in v) dbgMesh.position.x = v['pos_x'];
            if ('pos_y' in v) dbgMesh.position.y = v['pos_y'];
            if ('pos_z' in v) dbgMesh.position.z = v['pos_z'];
            if ('rot_x' in v) dbgMesh.rotation.x = v['rot_x'];
            if ('rot_y' in v) dbgMesh.rotation.y = v['rot_y'];
            if ('rot_z' in v) dbgMesh.rotation.z = v['rot_z'];
            if ('scale' in v) dbgMesh.scale.set(v['scale'], v['scale'], v['scale']);
          }
        }
      }
      this.previewRenderer.render(this.previewScene, this.previewCamera);
      this.previewAnimFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  // ---- Destroy/cleanup ----
  private destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.logContainer = null;
    this.statsContainer = null;
    this.lastEventCount = 0;
    this.cleanupPreview();
  }

  private cleanupPreview(): void {
    if (this.previewAnimFrame) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = 0;
    }
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }
    this.previewScene = null;
    this.previewCamera = null;
    this.previewGroup = null;
  }

  dispose(): void {
    this.destroy();
  }
}

// ---- Callback interface for main.ts to provide ----
export interface DebugPanelCallbacks {
  getFlag(key: string): boolean;
  toggleFlag(key: string): void;
  getGameSpeed(): number;
  setGameSpeed(speed: number): void;
  getSpawnCount(): number;
  setSpawnCount(count: number): void;
  giveResources(): void;
  killAllEnemy(): void;
  damageBase(owner: number, amount: number): void;
  healSelected(): void;
  killSelected(): void;
  buffSelected(stat: string): void;
  clearTrees(): void;
  clearStones(): void;
  instantWin(): void;
  instantLose(): void;
  spawnUnit(type: UnitType, count: number): void;
  spawnEnemy(type: UnitType, count: number): void;
  spawnTestArmies(scale: number): void;
  restartArena(): void;
  getMapType(): string;
  applyUnitStatChange(type: UnitType, field: string, value: number): void;
  animatePreview(group: THREE.Group, unitType: UnitType, state: 'idle' | 'moving' | 'attacking' | 'hit' | 'block', time: number): void;
}
