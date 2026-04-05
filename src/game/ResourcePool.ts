/**
 * ResourcePool — Centralized resource storage for all players.
 *
 * Replaces the 11 per-player number arrays (woodStockpile[], stoneStockpile[], etc.)
 * scattered across main.ts with a single typed data structure.
 *
 * Usage:
 *   pool.get('wood', owner)           // Read
 *   pool.add('wood', owner, 5)        // Increment
 *   pool.set('wood', owner, 0)        // Reset
 *   pool.getAll(owner)                // { wood: 10, stone: 5, ... }
 *   pool.resetAll(playerCount)        // Clear for new game
 */

import { PlayerResources } from '../types';

/** The 11 resource types tracked in stockpiles */
export type StockpileResource =
  | 'wood' | 'stone' | 'food'
  | 'grass_fiber' | 'clay' | 'rope'
  | 'iron' | 'charcoal' | 'steel'
  | 'crystal' | 'gold';

/** All stockpile resource keys (for iteration) */
export const STOCKPILE_RESOURCES: readonly StockpileResource[] = [
  'wood', 'stone', 'food',
  'grass_fiber', 'clay', 'rope',
  'iron', 'charcoal', 'steel',
  'crystal', 'gold',
] as const;

/** Display metadata for resource deposit notifications */
export const RESOURCE_DISPLAY: Record<StockpileResource, { emoji: string; label: string; color: string; soundName?: string }> = {
  wood:       { emoji: '🪵', label: 'wood',        color: '#8b6914', soundName: 'resource_wood' },
  stone:      { emoji: '🪨', label: 'stone',       color: '#888888', soundName: 'resource_stone' },
  food:       { emoji: '🌾', label: 'food',        color: '#daa520', soundName: 'resource_food' },
  grass_fiber:{ emoji: '🌿', label: 'grass fiber', color: '#8bc34a' },
  clay:       { emoji: '🧱', label: 'clay',        color: '#c2703e' },
  rope:       { emoji: '🪢', label: 'rope',        color: '#c2b280' },
  iron:       { emoji: '⛏',  label: 'iron',        color: '#b87333' },
  charcoal:   { emoji: '🔥', label: 'charcoal',    color: '#555555' },
  steel:      { emoji: '⚔',  label: 'steel',       color: '#7b8d9e' },
  crystal:    { emoji: '💎', label: 'crystal',      color: '#9b59b6' },
  gold:       { emoji: '💰', label: 'gold',         color: '#ffd700' },
};

/**
 * Maps legacy stockpile array property names (e.g. "woodStockpile")
 * to their StockpileResource key.
 */
export const LEGACY_STOCKPILE_MAP: Record<string, StockpileResource> = {
  woodStockpile: 'wood',
  stoneStockpile: 'stone',
  foodStockpile: 'food',
  grassFiberStockpile: 'grass_fiber',
  clayStockpile: 'clay',
  ropeStockpile: 'rope',
  ironStockpile: 'iron',
  charcoalStockpile: 'charcoal',
  steelStockpile: 'steel',
  crystalStockpile: 'crystal',
  goldStockpile: 'gold',
};

export class ResourcePool {
  /** Internal storage: resource → per-player amounts */
  private data: Map<StockpileResource, number[]> = new Map();
  private playerCount: number;

  constructor(playerCount: number) {
    this.playerCount = playerCount;
    this.reset(playerCount);
  }

  /** Get amount of a resource for a player */
  get(resource: StockpileResource, owner: number): number {
    return this.data.get(resource)?.[owner] ?? 0;
  }

  /** Set amount of a resource for a player */
  set(resource: StockpileResource, owner: number, value: number): void {
    const arr = this.data.get(resource);
    if (arr && owner < arr.length) arr[owner] = value;
  }

  /** Add amount to a resource for a player (can be negative) */
  add(resource: StockpileResource, owner: number, amount: number): void {
    const arr = this.data.get(resource);
    if (arr && owner < arr.length) arr[owner] += amount;
  }

  /** Get a snapshot of all resources for a player */
  getAll(owner: number): PlayerResources {
    return {
      wood: this.get('wood', owner),
      stone: this.get('stone', owner),
      food: this.get('food', owner),
      iron: this.get('iron', owner),
      gold: this.get('gold', owner),
      crystal: this.get('crystal', owner),
      grass_fiber: this.get('grass_fiber', owner),
      clay: this.get('clay', owner),
      rope: this.get('rope', owner),
      charcoal: this.get('charcoal', owner),
      steel: this.get('steel', owner),
    };
  }

  /**
   * Get the backing array for a resource type.
   * Returns a reference to the internal array — mutations are reflected immediately.
   * Used for legacy compatibility (e.g. `this.woodStockpile = pool.array('wood')`).
   */
  array(resource: StockpileResource): number[] {
    return this.data.get(resource)!;
  }

  /** Reset all resources to zero for a given player count */
  reset(playerCount: number): void {
    this.playerCount = playerCount;
    for (const resource of STOCKPILE_RESOURCES) {
      this.data.set(resource, new Array(playerCount).fill(0));
    }
  }

  /** Number of players this pool tracks */
  getPlayerCount(): number {
    return this.playerCount;
  }
}
