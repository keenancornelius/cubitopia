// ============================================
// CUBITOPIA - Claude Control
// Programmatic play API for an AI assistant opponent
// ============================================
//
// Exposed as `window.ClaudeControl` so an AI assistant (or any script)
// can play the game against the human player by calling methods from
// the browser console / devtools / extension JS.
//
// Usage (local Player-vs-AI game already running):
//   ClaudeControl.takeover(1)   // Claude takes player 1 from the AI
//   ClaudeControl.state()       // compact JSON of the whole battlefield
//   ClaudeControl.myUnits()     // Claude's units
//   ClaudeControl.move(['u12','u13'], 4, -2)
//   ClaudeControl.queueUnit('warrior', 'barracks')
//   ClaudeControl.help()        // full cheat-sheet
//
// All commands route through the SAME CommandBridge path as human input
// (playerId 'claude' → owner mapping in main.ts), so ownership checks,
// costs, and spawn rules all apply — no cheating possible through this API.
// Disabled in real multiplayer matches: the lockstep protocol only carries
// the local player's commands.
// ============================================

import { NetCommandType } from '../network/Protocol';
import type { Unit, Player, Base, HexCoord, PlacedBuilding, BuildingKind, UnitStance } from '../types';
import { UnitState } from '../types';

/** Slim interface to the game — wired up in main.ts */
export interface ClaudeControlOps {
  getPlayers(): Player[];
  getUnits(): Unit[];
  getBuildings(): PlacedBuilding[];
  getBases(): Base[];
  getStockpiles(owner: number): Record<string, number>;
  getGameFrame(): number;
  isMultiplayer(): boolean;
  /** Enqueue a command attributed to playerId 'claude' */
  enqueue(type: NetCommandType, payload: Record<string, unknown>): void;
  /** Set/unset AI control for a player (true = AIController drives it) */
  setPlayerAI(owner: number, isAI: boolean): void;
  notify(msg: string): void;
}

interface UnitView {
  id: string;
  type: string;
  owner: number;
  q: number;
  r: number;
  hp: number;
  maxHp: number;
  state: string;
  stance: string;
  carry?: string;
}

export class ClaudeControl {
  private ops: ClaudeControlOps;
  private _owner = -1; // -1 = not in control

  constructor(ops: ClaudeControlOps) {
    this.ops = ops;
  }

  /** Which player index Claude controls (-1 = none) */
  get owner(): number { return this._owner; }
  get active(): boolean { return this._owner >= 0; }

  // ============================================
  // Takeover / release
  // ============================================

  /** Take control of a player slot (default 1). Disables its AI commander. */
  takeover(owner = 1): string {
    if (this.ops.isMultiplayer()) {
      return 'ERROR: ClaudeControl is disabled in online multiplayer matches.';
    }
    const players = this.ops.getPlayers();
    if (!players[owner]) return `ERROR: no player ${owner} (players: 0..${players.length - 1})`;
    this._owner = owner;
    this.ops.setPlayerAI(owner, false); // stop AIController; units behave like human-commanded
    this.ops.notify(`Claude has taken control of Player ${owner + 1}!`);
    return `OK: controlling player ${owner}. Units behave like human-commanded units now (stances, no AI commander). Call state() to scout.`;
  }

  /** Hand the slot back to the built-in AI commander. */
  release(): string {
    if (this._owner < 0) return 'Not controlling anyone.';
    const o = this._owner;
    this.ops.setPlayerAI(o, true);
    this._owner = -1;
    this.ops.notify(`Claude released Player ${o + 1} back to the AI.`);
    return `OK: player ${o} returned to AI control.`;
  }

  // ============================================
  // State queries (all return plain JSON-safe data)
  // ============================================

  /** Compact full-battlefield snapshot. */
  state(): Record<string, unknown> {
    const players = this.ops.getPlayers();
    const units = this.ops.getUnits().filter(u => u.state !== UnitState.DEAD);
    const perOwner: Record<number, number> = {};
    for (const u of units) perOwner[u.owner] = (perOwner[u.owner] ?? 0) + 1;

    return {
      frame: this.ops.getGameFrame(),
      controlling: this._owner,
      players: players.map((p, i) => ({
        owner: i,
        isAI: p.isAI,
        defeated: p.defeated,
        unitCount: perOwner[i] ?? 0,
        resources: this._owner === -1 || i === this._owner ? this.ops.getStockpiles(i) : undefined,
      })),
      bases: this.ops.getBases().map(b => ({
        owner: b.owner, q: b.position.q, r: b.position.r,
        hp: b.health, maxHp: b.maxHealth, tier: b.tier, destroyed: b.destroyed,
      })),
      buildings: this.ops.getBuildings().map(b => ({
        id: b.id, kind: b.kind, owner: b.owner, q: b.position.q, r: b.position.r,
        hp: b.health, blueprint: b.constructionProgress < 1 ? +b.constructionProgress.toFixed(2) : undefined,
      })),
      unitTotals: perOwner,
    };
  }

  /** Units, optionally filtered by owner. Compact view. */
  units(owner?: number): UnitView[] {
    return this.ops.getUnits()
      .filter(u => u.state !== UnitState.DEAD && (owner === undefined || u.owner === owner))
      .map(u => ({
        id: u.id,
        type: String(u.type),
        owner: u.owner,
        q: u.position.q,
        r: u.position.r,
        hp: u.currentHealth,
        maxHp: u.stats.maxHealth,
        state: String(u.state),
        stance: String(u.stance),
        carry: u.carryAmount > 0 ? `${u.carryAmount} ${u.carryType}` : undefined,
      }));
  }

  /** Claude's own units. */
  myUnits(): UnitView[] {
    return this._owner >= 0 ? this.units(this._owner) : [];
  }

  /** Enemy units (everyone who isn't Claude). */
  enemyUnits(): UnitView[] {
    if (this._owner < 0) return [];
    return this.units().filter(u => u.owner !== this._owner);
  }

  /** Claude's resources. */
  resources(): Record<string, number> {
    return this._owner >= 0 ? this.ops.getStockpiles(this._owner) : {};
  }

  // ============================================
  // Commands (all route through CommandBridge — same as human input)
  // ============================================

  private cmd(type: NetCommandType, payload: Record<string, unknown>): string {
    if (this._owner < 0) return 'ERROR: call takeover() first.';
    this.ops.enqueue(type, payload);
    return 'OK';
  }

  /** Move units to a hex. */
  move(unitIds: string[], q: number, r: number): string {
    return this.cmd(NetCommandType.MOVE, { unitIds, target: { q, r } });
  }

  /** Attack-move: advance to hex, engaging anything on the way. */
  attackMove(unitIds: string[], q: number, r: number): string {
    return this.cmd(NetCommandType.ATTACK_MOVE, { unitIds, target: { q, r } });
  }

  /** Focus-attack a specific enemy unit. */
  attack(unitIds: string[], targetUnitId: string): string {
    return this.cmd(NetCommandType.ATTACK, { unitIds, targetUnitId });
  }

  /** Stop units. */
  stop(unitIds: string[]): string {
    return this.cmd(NetCommandType.STOP, { unitIds });
  }

  /** Set stance: 'passive' | 'defensive' | 'aggressive'. */
  setStance(unitIds: string[], stance: UnitStance | string): string {
    return this.cmd(NetCommandType.SET_STANCE, { unitIds, stance });
  }

  /** Queue a unit at a building kind (e.g. queueUnit('warrior','barracks')). Costs apply. */
  queueUnit(unitType: string, buildingKind: BuildingKind | string): string {
    return this.cmd(NetCommandType.QUEUE_UNIT, { unitType, buildingKind });
  }

  /** Place a building blueprint (a builder must construct it). Costs apply. */
  placeBuilding(kind: BuildingKind | string, q: number, r: number): string {
    return this.cmd(NetCommandType.PLACE_BUILDING, { kind, position: { q, r } });
  }

  /** Place wall blueprints along the given hexes. */
  placeWall(positions: Array<{ q: number; r: number }>, isGate = false): string {
    return this.cmd(isGate ? NetCommandType.PLACE_GATE : NetCommandType.PLACE_WALL, { positions, isGate });
  }

  /** Garrison units into a structure at a hex. */
  garrison(unitIds: string[], q: number, r: number): string {
    return this.cmd(NetCommandType.GARRISON_UNIT, { unitIds, buildingPosition: { q, r } });
  }

  /** Ungarrison units. */
  ungarrison(unitIds: string[]): string {
    return this.cmd(NetCommandType.UNGARRISON, { unitIds });
  }

  /** Crafting: 'rope' | 'charcoal' | 'steel'. */
  craft(recipe: 'rope' | 'charcoal' | 'steel'): string {
    const map = {
      rope: NetCommandType.CRAFT_ROPE,
      charcoal: NetCommandType.CRAFT_CHARCOAL,
      steel: NetCommandType.CRAFT_STEEL,
    } as const;
    return this.cmd(map[recipe], {});
  }

  /** Sell wood for gold. */
  sellWood(): string {
    return this.cmd(NetCommandType.SELL_WOOD, {});
  }

  /** Paint a mine blueprint (builders excavate). */
  paintMine(q: number, r: number, startY: number, depth: number): string {
    return this.cmd(NetCommandType.PAINT_MINE, { position: { q, r }, startY, depth });
  }

  /** Paint a harvest marker (villagers harvest here). */
  paintHarvest(q: number, r: number): string {
    return this.cmd(NetCommandType.PAINT_HARVEST, { position: { q, r } });
  }

  /** Plant a tree / crop. */
  plantTree(q: number, r: number): string {
    return this.cmd(NetCommandType.PLANT_TREE, { position: { q, r } });
  }
  plantCrop(q: number, r: number): string {
    return this.cmd(NetCommandType.PLANT_CROP, { position: { q, r } });
  }

  /** Set a building's rally point. */
  setRally(buildingId: string, q: number, r: number): string {
    return this.cmd(NetCommandType.SET_RALLY_POINT, { buildingId, position: { q, r } });
  }

  /** Lock a mage's element ('fire'|'water'|'lightning'|'wind'|'earth') or null to unlock. */
  lockElement(unitIds: string[], element: string | null): string {
    return this.cmd(NetCommandType.LOCK_ELEMENT, { unitIds, element });
  }

  /** Direct a healer at a specific ally. */
  setHealTarget(unitId: string, targetUnitId: string | null): string {
    return this.cmd(NetCommandType.SET_HEAL_TARGET, { unitId, targetUnitId });
  }

  // ============================================
  // Help
  // ============================================

  help(): string {
    return [
      'ClaudeControl — programmatic play API',
      '',
      'CONTROL:  takeover(owner=1) · release()',
      'SCOUT:    state() · units(owner?) · myUnits() · enemyUnits() · resources()',
      'ORDERS:   move(ids,q,r) · attackMove(ids,q,r) · attack(ids,targetId) · stop(ids)',
      '          setStance(ids,"passive|defensive|aggressive")',
      'ECONOMY:  queueUnit(type,building) · placeBuilding(kind,q,r) · craft("rope|charcoal|steel")',
      '          sellWood() · paintMine(q,r,startY,depth) · paintHarvest(q,r) · plantTree/plantCrop(q,r)',
      'DEFENSE:  placeWall([{q,r},...],isGate?) · garrison(ids,q,r) · ungarrison(ids)',
      'MISC:     setRally(buildingId,q,r) · lockElement(ids,element) · setHealTarget(id,targetId)',
      '',
      'Buildings: barracks forestry masonry farmhouse workshop silo smelter armory wizard_tower',
      'Units: warrior archer rider paladin catapult trebuchet scout mage builder lumberjack',
      '       villager healer assassin shieldbearer berserker battlemage greatsword',
      '',
      'All commands obey normal game rules (costs, pop cap, ownership). Disabled in online MP.',
    ].join('\n');
  }
}
