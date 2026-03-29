// ============================================
// CUBITOPIA - Arena Debug Console
// Live combat monitoring overlay for debugging
// unit behavior, targeting, kiting, and damage
// ============================================

import { Unit, UnitType, UnitState } from '../types';

// --- Combat Event Log Types ---
export enum DebugEventType {
  TARGET = 'TARGET',
  KITE = 'KITE',
  DAMAGE = 'DAMAGE',
  KILL = 'KILL',
  KNOCKBACK = 'KNOCKBACK',
  PEEL = 'PEEL',
  HEAL = 'HEAL',
  SPLASH = 'SPLASH',
  MOVE = 'MOVE',
}

export interface DebugEvent {
  time: number;
  type: DebugEventType;
  owner: number; // 0 = blue, 1 = red
  message: string;
  unitType?: UnitType;
  unitId?: string;
}

// --- Static Event Buffer (global access for UnitAI / CombatSystem) ---
export class CombatLog {
  private static events: DebugEvent[] = [];
  private static maxEvents = 500;
  private static enabled = false;
  private static startTime = 0;

  static enable(): void {
    CombatLog.enabled = true;
    CombatLog.startTime = performance.now();
    CombatLog.events = [];
  }

  static disable(): void {
    CombatLog.enabled = false;
  }

  static isEnabled(): boolean { return CombatLog.enabled; }

  static clear(): void { CombatLog.events = []; }

  static getEvents(): readonly DebugEvent[] { return CombatLog.events; }

  static getTime(): number {
    return Math.floor((performance.now() - CombatLog.startTime) / 1000);
  }

  static log(type: DebugEventType, owner: number, message: string, unitType?: UnitType, unitId?: string): void {
    if (!CombatLog.enabled) return;
    const time = CombatLog.getTime();
    CombatLog.events.push({ time, type, owner, message, unitType, unitId });
    if (CombatLog.events.length > CombatLog.maxEvents) {
      CombatLog.events.splice(0, CombatLog.events.length - CombatLog.maxEvents);
    }
  }

  // Convenience methods
  static logTarget(unit: Unit, target: Unit, score: number, dist: number): void {
    const role = CombatLog.getRole(unit.type);
    CombatLog.log(
      DebugEventType.TARGET, unit.owner,
      `${role}${CombatLog.shortId(unit)} → ${CombatLog.typeName(target.type)}${CombatLog.shortId(target)} (score:${score.toFixed(1)} dist:${dist})`,
      unit.type, unit.id
    );
  }

  static logKite(unit: Unit, threat: Unit, success: boolean, fromQ?: number, fromR?: number, toQ?: number, toR?: number): void {
    if (success && toQ !== undefined && toR !== undefined) {
      CombatLog.log(
        DebugEventType.KITE, unit.owner,
        `${CombatLog.typeName(unit.type)}${CombatLog.shortId(unit)} KITES from (${fromQ},${fromR})→(${toQ},${toR}) away from ${CombatLog.typeName(threat.type)}`,
        unit.type, unit.id
      );
    } else {
      CombatLog.log(
        DebugEventType.KITE, unit.owner,
        `${CombatLog.typeName(unit.type)}${CombatLog.shortId(unit)} KITE FAILED — no escape from ${CombatLog.typeName(threat.type)}`,
        unit.type, unit.id
      );
    }
  }

  static logDamage(attacker: Unit, defender: Unit, dmgDealt: number, dmgTaken: number): void {
    let msg = `${CombatLog.typeName(attacker.type)}${CombatLog.shortId(attacker)} hits ${CombatLog.typeName(defender.type)}${CombatLog.shortId(defender)} for ${dmgDealt}`;
    if (dmgTaken > 0) msg += ` (took ${dmgTaken} counter)`;
    CombatLog.log(DebugEventType.DAMAGE, attacker.owner, msg, attacker.type, attacker.id);
  }

  static logKill(killer: Unit, victim: Unit): void {
    CombatLog.log(
      DebugEventType.KILL, killer.owner,
      `${CombatLog.typeName(killer.type)}${CombatLog.shortId(killer)} KILLED ${CombatLog.typeName(victim.type)}${CombatLog.shortId(victim)} (${victim.owner === 0 ? 'BLUE' : 'RED'})`,
      killer.type, killer.id
    );
  }

  static logKnockback(source: Unit, victim: Unit, toQ: number, toR: number): void {
    CombatLog.log(
      DebugEventType.KNOCKBACK, source.owner,
      `${CombatLog.typeName(source.type)} KNOCKBACK ${CombatLog.typeName(victim.type)}${CombatLog.shortId(victim)} → (${toQ},${toR})`,
      source.type, source.id
    );
  }

  static logPeel(tank: Unit, target: Unit, protectedAlly: Unit): void {
    CombatLog.log(
      DebugEventType.PEEL, tank.owner,
      `${CombatLog.typeName(tank.type)}${CombatLog.shortId(tank)} PEELS for ${CombatLog.typeName(protectedAlly.type)} → targets ${CombatLog.typeName(target.type)}`,
      tank.type, tank.id
    );
  }

  static logHeal(healer: Unit, target: Unit, amount: number): void {
    CombatLog.log(
      DebugEventType.HEAL, healer.owner,
      `${CombatLog.typeName(healer.type)} heals ${CombatLog.typeName(target.type)}${CombatLog.shortId(target)} +${amount}HP (${target.currentHealth}/${target.stats.maxHealth})`,
      healer.type, healer.id
    );
  }

  static logSplash(source: Unit, victimId: string, victimType: UnitType): void {
    CombatLog.log(
      DebugEventType.SPLASH, source.owner,
      `${CombatLog.typeName(source.type)} SPLASH hits ${CombatLog.typeName(victimType)}`,
      source.type, source.id
    );
  }

  // Helpers
  private static shortId(u: Unit): string {
    return `#${u.id.slice(-3)}`;
  }

  private static typeName(t: UnitType): string {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  private static getRole(t: UnitType): string {
    switch (t) {
      case UnitType.ARCHER: case UnitType.MAGE: case UnitType.BATTLEMAGE: return '🏹';
      case UnitType.SHIELDBEARER: case UnitType.PALADIN: return '🛡️';
      case UnitType.HEALER: return '💚';
      case UnitType.GREATSWORD: return '⚔️';
      case UnitType.BERSERKER: return '🪓';
      case UnitType.ASSASSIN: return '🗡️';
      default: return '⚔️';
    }
  }
}

// --- Arena Debug Console UI ---
export class ArenaDebugConsole {
  private panel: HTMLElement | null = null;
  private logContainer: HTMLElement | null = null;
  private statsContainer: HTMLElement | null = null;
  private visible = false;
  private autoScroll = true;
  private lastEventCount = 0;
  private updateInterval: number | null = null;

  // Filter toggles
  private filters: Record<DebugEventType, boolean> = {
    [DebugEventType.TARGET]: true,
    [DebugEventType.KITE]: true,
    [DebugEventType.DAMAGE]: true,
    [DebugEventType.KILL]: true,
    [DebugEventType.KNOCKBACK]: true,
    [DebugEventType.PEEL]: true,
    [DebugEventType.HEAL]: true,
    [DebugEventType.SPLASH]: true,
    [DebugEventType.MOVE]: false, // off by default (noisy)
  };

  // Refs for live stats
  private allUnitsRef: Unit[] = [];

  setUnits(units: Unit[]): void {
    this.allUnitsRef = units;
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.build();
      CombatLog.enable();
      this.startAutoUpdate();
    } else {
      this.destroy();
      CombatLog.disable();
    }
  }

  isVisible(): boolean { return this.visible; }

  private build(): void {
    if (this.panel) return;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed; top: 56px; right: 16px; width: 420px;
      background: rgba(5, 8, 18, 0.94); padding: 0; border-radius: 8px;
      font-size: 11px; border: 2px solid rgba(0, 200, 255, 0.4);
      pointer-events: auto; z-index: 10001;
      font-family: 'Courier New', monospace; color: #ccc;
      max-height: calc(100vh - 80px); display: flex; flex-direction: column;
      backdrop-filter: blur(8px);
    `;
    panel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    panel.addEventListener('wheel', (e) => { e.stopPropagation(); });

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 12px; border-bottom: 1px solid rgba(0,200,255,0.3);
      display: flex; justify-content: space-between; align-items: center;
    `;
    const title = document.createElement('span');
    title.style.cssText = 'font-size:13px;font-weight:bold;color:#00d4ff;';
    title.textContent = '⚔ ARENA COMBAT MONITOR';
    header.appendChild(title);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:4px;';

    const clearBtn = this.mkSmallBtn('CLR', '#555', () => {
      CombatLog.clear();
      this.lastEventCount = 0;
      if (this.logContainer) this.logContainer.innerHTML = '';
    });
    controls.appendChild(clearBtn);

    const scrollBtn = this.mkSmallBtn('⬇AUTO', this.autoScroll ? '#00bcd4' : '#555', () => {
      this.autoScroll = !this.autoScroll;
      scrollBtn.style.background = this.autoScroll ? '#00bcd4' : '#555';
    });
    controls.appendChild(scrollBtn);

    const closeBtn = this.mkSmallBtn('✕', '#e74c3c', () => this.toggle());
    controls.appendChild(closeBtn);

    header.appendChild(controls);
    panel.appendChild(header);

    // Stats bar
    const stats = document.createElement('div');
    stats.style.cssText = `
      padding: 6px 12px; border-bottom: 1px solid rgba(0,200,255,0.15);
      font-size: 10px; color: #888; display: flex; gap: 12px; flex-wrap: wrap;
    `;
    panel.appendChild(stats);
    this.statsContainer = stats;

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.style.cssText = `
      padding: 4px 8px; border-bottom: 1px solid rgba(0,200,255,0.15);
      display: flex; flex-wrap: wrap; gap: 2px;
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
        // Rebuild log with new filters
        this.rebuildLog();
      });
      filterBar.appendChild(btn);
    }
    panel.appendChild(filterBar);

    // Log container
    const log = document.createElement('div');
    log.style.cssText = `
      flex: 1; overflow-y: auto; padding: 4px 8px; min-height: 200px;
      max-height: calc(100vh - 250px);
    `;
    // Custom scrollbar styling
    log.id = 'arena-debug-log';
    panel.appendChild(log);
    this.logContainer = log;

    // Add scrollbar CSS
    const style = document.createElement('style');
    style.textContent = `
      #arena-debug-log::-webkit-scrollbar { width: 6px; }
      #arena-debug-log::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
      #arena-debug-log::-webkit-scrollbar-thumb { background: rgba(0,200,255,0.3); border-radius: 3px; }
    `;
    document.head.appendChild(style);

    document.body.appendChild(panel);
    this.panel = panel;
  }

  private mkSmallBtn(label: string, bg: string, cb: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: ${bg}; color: #fff; border: none; padding: 2px 6px;
      font-size: 9px; font-family: 'Courier New', monospace; border-radius: 3px;
      cursor: pointer; font-weight: bold;
    `;
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    return btn;
  }

  private startAutoUpdate(): void {
    if (this.updateInterval) return;
    this.updateInterval = window.setInterval(() => this.update(), 250);
  }

  private update(): void {
    if (!this.visible || !this.logContainer) return;

    // Update stats
    this.updateStats();

    // Append new events
    const events = CombatLog.getEvents();
    if (events.length === this.lastEventCount) return;

    const fragment = document.createDocumentFragment();
    for (let i = this.lastEventCount; i < events.length; i++) {
      const ev = events[i];
      if (!this.filters[ev.type]) continue;
      fragment.appendChild(this.renderEvent(ev));
    }
    this.lastEventCount = events.length;
    this.logContainer.appendChild(fragment);

    // Trim DOM if too many children
    while (this.logContainer.children.length > 300) {
      this.logContainer.removeChild(this.logContainer.firstChild!);
    }

    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
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

  private updateStats(): void {
    if (!this.statsContainer || this.allUnitsRef.length === 0) return;

    const alive = [0, 0];
    const totalHp = [0, 0];
    const maxHp = [0, 0];
    const typeCounts: [Map<UnitType, number>, Map<UnitType, number>] = [new Map(), new Map()];

    for (const u of this.allUnitsRef) {
      if (u.state === UnitState.DEAD) continue;
      alive[u.owner]++;
      totalHp[u.owner] += u.currentHealth;
      maxHp[u.owner] += u.stats.maxHealth;
      typeCounts[u.owner].set(u.type, (typeCounts[u.owner].get(u.type) ?? 0) + 1);
    }

    const pct0 = maxHp[0] > 0 ? Math.round(totalHp[0] / maxHp[0] * 100) : 0;
    const pct1 = maxHp[1] > 0 ? Math.round(totalHp[1] / maxHp[1] * 100) : 0;
    const evCount = CombatLog.getEvents().length;

    this.statsContainer.innerHTML = `
      <span style="color:#3498db;font-weight:bold">BLUE: ${alive[0]} alive (${pct0}% HP)</span>
      <span style="color:#e74c3c;font-weight:bold">RED: ${alive[1]} alive (${pct1}% HP)</span>
      <span style="color:#555">Events: ${evCount}</span>
      <span style="color:#555">T+${CombatLog.getTime()}s</span>
    `;
  }

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
