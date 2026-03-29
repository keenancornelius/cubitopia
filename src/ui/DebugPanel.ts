// ============================================
// CUBITOPIA - Unified Debug Panel
// Tabbed panel merging Debug Tools, Army Composer,
// and Combat Monitor into a single overlay
// ============================================

import { Unit, UnitType, UnitState } from '../types';
import { CombatLog, DebugEventType, DebugEvent } from './ArenaDebugConsole';

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
  private activeTab: 'tools' | 'army' | 'combat' = 'tools';

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

  switchTab(tab: 'tools' | 'army' | 'combat'): void {
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
    const tabs: { id: 'tools' | 'army' | 'combat'; label: string; icon: string; color: string }[] = [
      { id: 'tools', label: 'TOOLS', icon: '🐛', color: '#ff4444' },
      { id: 'army', label: 'ARMY', icon: '⚔', color: '#00d4ff' },
      { id: 'combat', label: 'COMBAT', icon: '📊', color: '#ff9800' },
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
  restartArena(): void;
  getMapType(): string;
}
