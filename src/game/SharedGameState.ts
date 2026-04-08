/**
 * SharedGameState — Injectable container for all mutable game state
 * that was previously scattered as static fields on UnitAI.
 *
 * Benefits:
 *   1. Multiplayer: serialize/deserialize a single object instead of 30+ statics
 *   2. Testing: inject a fresh instance per test, no global pollution
 *   3. New game: one `reset()` call instead of clearing 22 collections individually
 *
 * UnitAI retains static getters/setters that forward to the active instance,
 * so all 300+ existing `UnitAI.xxx` references keep working.
 */

import { HexCoord, Player, Base, PlacedBuilding } from '../types';
import { TacticalGroupManager } from './systems/TacticalGroup';

/** Mine blueprint: defines a Y range to excavate. Miners remove blocks top-down
 *  from startY to (startY - depth + 1). Works for both surface and tunnel mining. */
export interface MineTarget {
  startY: number;
  depth: number;
}

export interface UnitAIDebugFlags {
  disableChop?: boolean;
  disableMine?: boolean;
  disableHarvest?: boolean;
  disableBuild?: boolean;
  disableDeposit?: boolean;
  disableAutoReturn?: boolean;
  disableCombat?: boolean;
}

export class SharedGameState {
  // ── Economy: resource gathering ──────────────────────────────
  /** Tree tile → lumberjack unit ID (prevents multiple units targeting same tree) */
  claimedTrees: Map<string, string> = new Map();
  /** Farm patch positions designated by player */
  farmPatches: Set<string> = new Set();
  /** Crop growth stage per farm patch: 0=seedling → 3=mature */
  cropStages: Map<string, number> = new Map();
  /** Crop growth timers (seconds remaining to next stage advance) */
  cropTimers: Map<string, number> = new Map();
  /** Grass tiles marked by player for villager hay harvesting */
  playerGrassBlueprint: Set<string> = new Set();
  /** Auto-harvestable grass tiles (populated by main.ts) */
  grassTiles: Set<string> = new Set();
  /** Silo position per player */
  siloPositions: Map<number, HexCoord> = new Map();
  /** Farmhouse position per player */
  farmhousePositions: Map<number, HexCoord> = new Map();
  /** Forestry building positions per player (drop-off for lumberjacks) */
  forestryPositions: Map<number, HexCoord[]> = new Map();
  /** Farm patch → villager unit ID (prevents stacking) */
  claimedFarms: Map<string, string> = new Map();

  // ── Economy: stockpile references ────────────────────────────
  /** Synced from main.ts each frame — used for builder cost checks */
  stoneStockpile: number[] = [0, 0];
  ironStockpile: number[] = [0, 0];
  clayStockpile: number[] = [0, 0];
  crystalStockpile: number[] = [0, 0];
  charcoalStockpile: number[] = [0, 0];
  steelStockpile: number[] = [0, 0];
  goldStockpile: number[] = [0, 0];

  // ── Buildings & walls ────────────────────────────────────────
  /** Built walls, gates, and buildings — "q,r" keys */
  wallsBuilt: Set<string> = new Set();
  /** Non-wall building positions — all units can attack these */
  buildingPositions: Set<string> = new Set();
  /** "q,r" → owner player ID for buildings */
  buildingOwners: Map<string, number> = new Map();
  /** "q,r" → owner player ID for walls */
  wallOwners: Map<string, number> = new Map();
  /** Reference to placed building list (synced from main.ts) */
  placedBuildings: PlacedBuilding[] = [];

  // ── Player blueprints ────────────────────────────────────────
  /** Wall tiles queued for builder construction */
  playerWallBlueprint: Set<string> = new Set();
  /** Gate tiles queued for builder construction */
  playerGateBlueprint: Set<string> = new Set();
  /** Tree tiles queued for lumberjack harvesting */
  playerHarvestBlueprint: Set<string> = new Set();
  /** Mine blueprints: tile key → { startY, depth } */
  playerMineBlueprint: Map<string, MineTarget> = new Map();
  /** Mine tile → miner unit ID (prevents stacking) */
  claimedMines: Map<string, string> = new Map();

  // ── Player & map state ───────────────────────────────────────
  /** All bases — set by main.ts at game init */
  bases: Base[] = [];
  /** Base position per player */
  basePositions: Map<number, HexCoord> = new Map();
  /** Barracks position per player */
  barracksPositions: Map<number, HexCoord> = new Map();
  /** Player references by ID — updated each frame */
  players: Map<number, Player> = new Map();
  /** Number of players in current game */
  playerCount: number = 2;
  /** Map dimensions for direction calculations */
  mapWidth: number = 40;
  mapHeight: number = 40;
  /** Per-player morale modifier (attack/move speed multiplier from food ratio) */
  moraleModifiers: number[] = [1.0, 1.0];
  /** Arena mode: all units seek and destroy */
  arenaMode: boolean = false;
  /** Index of the local (human) player — 0 for host, 1 for guest */
  localPlayerIndex: number = 0;

  // ── System references ────────────────────────────────────────
  /** Squad coordination manager */
  tacticalGroupManager: TacticalGroupManager | null = null;
  /** Debug flags controlling worker/combat behaviors */
  debugFlags: UnitAIDebugFlags = {};
  /** Deterministic frame counter (~60fps). Use instead of Date.now() in game logic. */
  gameFrame: number = 0;

  // ── Reset for new game ───────────────────────────────────────
  /** Clear all mutable state. Call at the start of each new game. */
  reset(playerCount: number = 2): void {
    this.claimedTrees.clear();
    this.farmPatches.clear();
    this.cropStages.clear();
    this.cropTimers.clear();
    this.playerGrassBlueprint.clear();
    this.grassTiles.clear();
    this.siloPositions.clear();
    this.farmhousePositions.clear();
    this.forestryPositions.clear();
    this.claimedFarms.clear();

    this.stoneStockpile = new Array(playerCount).fill(0);
    this.ironStockpile = new Array(playerCount).fill(0);
    this.clayStockpile = new Array(playerCount).fill(0);
    this.crystalStockpile = new Array(playerCount).fill(0);
    this.charcoalStockpile = new Array(playerCount).fill(0);
    this.steelStockpile = new Array(playerCount).fill(0);
    this.goldStockpile = new Array(playerCount).fill(0);

    this.wallsBuilt.clear();
    this.buildingPositions.clear();
    this.buildingOwners.clear();
    this.wallOwners.clear();
    this.placedBuildings = [];

    this.playerWallBlueprint.clear();
    this.playerGateBlueprint.clear();
    this.playerHarvestBlueprint.clear();
    this.playerMineBlueprint.clear();
    this.claimedMines.clear();

    this.bases = [];
    this.basePositions.clear();
    this.barracksPositions.clear();
    this.players.clear();
    this.playerCount = playerCount;
    this.moraleModifiers = new Array(playerCount).fill(1.0);
    this.arenaMode = false;

    this.tacticalGroupManager = null;
    this.debugFlags = {};
    this.gameFrame = 0;
  }
}
