/**
 * GoldEconomySystem — Manages gold income, unit upkeep expenses, and trade routes.
 *
 * Gold sources:
 * 1. Base tier income — each base generates gold based on its tier (Camp=1, Fort=2, Castle=3, Citadel=5)
 * 2. Mine buildings — each mine generates flat gold per tick
 * 3. Market trade routes — markets generate gold per owned base (scales with empire size)
 * 4. Kill bounties (handled externally in CombatSystem)
 * 5. Wood→gold selling (handled externally in ResourceManager)
 *
 * Gold sinks:
 * 1. Unit upkeep — advanced units cost gold each tick (warriors/archers free, elites cost 1-3g)
 * 2. Unit spawning costs (handled externally in SpawnQueueSystem)
 *
 * Penalty: When gold hits 0, combat units suffer ATK/speed debuffs.
 *
 * Integration:
 * - Call GoldEconomySystem.update(delta) each frame from main game loop
 * - Gold ticks every 10 seconds (configurable via GAME_CONFIG.goldEconomy.tickInterval)
 */

import { Unit, UnitState, Base, BuildingKind, PlayerResources } from '../../types';
import { GAME_CONFIG } from '../GameConfig';
import { Logger } from '../../engine/Logger';

export interface GoldEconomyOps {
  getPlayers(): { units: Unit[]; resources: PlayerResources }[];
  getBases(): Base[];
  getPlayerBuildingCount(owner: number, kind: BuildingKind): number;
  getGoldStockpile(owner: number): number;
  setGoldStockpile(owner: number, amount: number): void;
  showNotification(msg: string, color: string): void;
}

export default class GoldEconomySystem {
  private ops: GoldEconomyOps;
  private goldTickTimer = 0;
  /** Track gold-broke state per player to avoid spamming notifications */
  private wasBroke: boolean[] = [false, false, false, false];

  constructor(ops: GoldEconomyOps) {
    this.ops = ops;
  }

  /** Call every frame from the game loop. */
  update(delta: number): void {
    this.goldTickTimer += delta;
    const interval = GAME_CONFIG.goldEconomy.tickInterval;
    if (this.goldTickTimer < interval) return;
    this.goldTickTimer = 0;

    const players = this.ops.getPlayers();
    const bases = this.ops.getBases();

    for (let pid = 0; pid < players.length; pid++) {
      const player = players[pid];
      if (!player) continue;

      let income = 0;
      let expenses = 0;

      // ─── INCOME: Base tier passive gold ───
      const playerBases = bases.filter(b => b.owner === pid && !b.destroyed);
      for (const base of playerBases) {
        const tierIncome = GAME_CONFIG.goldEconomy.baseIncomePerTier[base.tier] ?? 0;
        income += tierIncome;
      }

      // ─── INCOME: Mine buildings ───
      const mineCount = this.ops.getPlayerBuildingCount(pid, 'mine');
      income += mineCount * (GAME_CONFIG.buildings.mine as any).goldPerTick;

      // ─── INCOME: Market trade routes ───
      const marketCount = this.ops.getPlayerBuildingCount(pid, 'market');
      if (marketCount > 0 && playerBases.length >= 2) {
        // Each market generates gold per owned base (trade network scales with empire)
        const tradeIncome = marketCount * playerBases.length *
          (GAME_CONFIG.buildings.market as any).tradeIncomePerBase;
        income += tradeIncome;
      }

      // ─── EXPENSES: Unit upkeep ───
      const upkeepTable = GAME_CONFIG.goldEconomy.unitUpkeep;
      for (const unit of player.units) {
        if (unit.state === UnitState.DEAD) continue;
        const cost = upkeepTable[unit.type] ?? upkeepTable['default'] ?? 0;
        expenses += cost;
      }

      // ─── Apply net gold change ───
      const net = income - expenses;
      const currentGold = this.ops.getGoldStockpile(pid);
      const newGold = Math.max(0, currentGold + net);
      this.ops.setGoldStockpile(pid, newGold);
      player.resources.gold = newGold;

      // Log for debugging
      if (income > 0 || expenses > 0) {
        Logger.info('GoldEconomy', `P${pid}: +${income}g income, -${expenses}g upkeep = net ${net}g (total: ${newGold}g)`);
      }

      // ─── Notifications for player 0 ───
      if (pid === 0) {
        if (newGold === 0 && !this.wasBroke[pid]) {
          this.ops.showNotification('💰 Gold depleted! Units suffer combat penalties.', '#ff6600');
          this.wasBroke[pid] = true;
        } else if (newGold > 0 && this.wasBroke[pid]) {
          this.wasBroke[pid] = false;
        }

        // Show income summary periodically
        if (net !== 0) {
          const sign = net > 0 ? '+' : '';
          this.ops.showNotification(`💰 ${sign}${net}g (${income}↑ ${expenses}↓)`, net >= 0 ? '#ffd700' : '#ff8800');
        }
      }
    }
  }

  /**
   * Check if a player is gold-broke (for applying combat penalties).
   * Called by CombatSystem or UnitAI to apply debuffs.
   */
  static isGoldBroke(resources: PlayerResources): boolean {
    return resources.gold <= 0;
  }

  /**
   * Get gold economy summary for a player (for HUD display).
   */
  getEconomySummary(pid: number): { income: number; expenses: number; net: number } {
    const players = this.ops.getPlayers();
    const player = players[pid];
    if (!player) return { income: 0, expenses: 0, net: 0 };

    const bases = this.ops.getBases().filter(b => b.owner === pid && !b.destroyed);
    let income = 0;
    let expenses = 0;

    // Base income
    for (const base of bases) {
      income += GAME_CONFIG.goldEconomy.baseIncomePerTier[base.tier] ?? 0;
    }

    // Mine income
    const mineCount = this.ops.getPlayerBuildingCount(pid, 'mine');
    income += mineCount * (GAME_CONFIG.buildings.mine as any).goldPerTick;

    // Market trade routes
    const marketCount = this.ops.getPlayerBuildingCount(pid, 'market');
    if (marketCount > 0 && bases.length >= 2) {
      income += marketCount * bases.length * (GAME_CONFIG.buildings.market as any).tradeIncomePerBase;
    }

    // Upkeep
    const upkeepTable = GAME_CONFIG.goldEconomy.unitUpkeep;
    for (const unit of player.units) {
      if (unit.state === UnitState.DEAD) continue;
      expenses += upkeepTable[unit.type] ?? upkeepTable['default'] ?? 0;
    }

    return { income, expenses, net: income - expenses };
  }
}
