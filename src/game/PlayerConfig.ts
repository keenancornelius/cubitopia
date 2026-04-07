// ============================================
// CUBITOPIA - Player Configuration
// Centralized player colors, spawn layout, and N-player support
// ============================================
//
// All player-specific constants live here so the rest of
// the codebase can loop over `playerCount` instead of
// hardcoding [0] and [1].
// ============================================

import { HexCoord, MapType } from '../types';

/** Maximum supported players */
export const MAX_PLAYERS = 4;

/** Neutral owner ID (capture zones, unclaimed bases) */
export const NEUTRAL_OWNER = MAX_PLAYERS; // Always 1 above max player index

// ============================================
// Player Colors (hex int for Three.js, hex string for CSS)
// ============================================

export interface PlayerColorSet {
  primary: number;    // Three.js hex (e.g. 0x3498db)
  css: string;        // CSS hex (e.g. '#3498db')
  name: string;       // Display name
  light: string;      // Lighter variant for UI highlights
  dark: string;       // Darker variant for gradients
}

export const PLAYER_COLORS: PlayerColorSet[] = [
  { primary: 0x3498db, css: '#3498db', name: 'Blue',   light: '#5dade2', dark: '#2471a3' },
  { primary: 0xe74c3c, css: '#e74c3c', name: 'Red',    light: '#ec7063', dark: '#c0392b' },
  { primary: 0x2ecc71, css: '#2ecc71', name: 'Green',  light: '#58d68d', dark: '#27ae60' },
  { primary: 0xf39c12, css: '#f39c12', name: 'Gold',   light: '#f5b041', dark: '#d68910' },
];

/** Get color set for a player (wraps around if somehow > MAX_PLAYERS) */
export function getPlayerColor(playerId: number): PlayerColorSet {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length];
}

/** Get Three.js hex color for a player */
export function getPlayerHex(playerId: number): number {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length].primary;
}

/** Get CSS color string for a player */
export function getPlayerCSS(playerId: number): string {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length].css;
}

// ============================================
// Spawn Positions — where each player's base goes
// ============================================

export interface SpawnLayout {
  /** Base position for each player */
  positions: HexCoord[];
  /** Direction each player faces (toward center): +1 = right, -1 = left, etc. */
  facingDir: { dq: number; dr: number }[];
}

/**
 * Get spawn positions for N players on a given map.
 * For 2 players: classic left vs right.
 * For 4 players: four corners / cardinal directions.
 */
export function getSpawnLayout(playerCount: number, mapSize: number, mapType: MapType): SpawnLayout {
  const mid = Math.floor(mapSize / 2);
  const offset = Math.floor(mapSize * 0.35); // 35% from center to edge

  if (playerCount <= 2) {
    // Classic 2-player: left vs right
    return {
      positions: [
        { q: mid - offset, r: mid },     // Player 0: left
        { q: mid + offset, r: mid },     // Player 1: right
      ],
      facingDir: [
        { dq: 1, dr: 0 },  // Face right
        { dq: -1, dr: 0 }, // Face left
      ],
    };
  }

  // 4-player: four quadrants
  const cornerOffset = Math.floor(mapSize * 0.28);
  return {
    positions: [
      { q: mid - cornerOffset, r: mid - cornerOffset }, // P0: top-left (Blue)
      { q: mid + cornerOffset, r: mid - cornerOffset }, // P1: top-right (Red)
      { q: mid - cornerOffset, r: mid + cornerOffset }, // P2: bottom-left (Green)
      { q: mid + cornerOffset, r: mid + cornerOffset }, // P3: bottom-right (Gold)
    ],
    facingDir: [
      { dq: 1, dr: 1 },   // Face toward center
      { dq: -1, dr: 1 },  // Face toward center
      { dq: 1, dr: -1 },  // Face toward center
      { dq: -1, dr: -1 }, // Face toward center
    ],
  };
}

// ============================================
// Game Mode Definitions
// ============================================

export type GameModeType = '1v1' | 'ffa4' | '2v2';

export interface GameModeConfig {
  type: GameModeType;
  label: string;
  description: string;
  playerCount: number;
  humanPlayers: number[];  // Which player IDs are human
  /** Team assignments: players with same team number are allies. null = FFA */
  teams: number[] | null;
}

export const GAME_MODES: Record<string, GameModeConfig> = {
  // Single-player modes
  'pvai': {
    type: '1v1',
    label: 'Player vs AI',
    description: '1v1 against the AI commander',
    playerCount: 2,
    humanPlayers: [0],
    teams: null,
  },
  'aivai': {
    type: '1v1',
    label: 'AI vs AI',
    description: 'Watch two AI commanders battle',
    playerCount: 2,
    humanPlayers: [],
    teams: null,
  },
  'ffa': {
    type: 'ffa4',
    label: 'Free-For-All',
    description: 'You vs 3 AI commanders — last base standing wins',
    playerCount: 4,
    humanPlayers: [0],
    teams: null,
  },
  '2v2': {
    type: '2v2',
    label: '2v2 Teams',
    description: 'You + AI ally vs 2 AI enemies',
    playerCount: 4,
    humanPlayers: [0],
    teams: [0, 1, 0, 1], // P0+P2 vs P1+P3
  },
  'pvp': {
    type: '1v1',
    label: 'Player vs Player',
    description: '1v1 ranked multiplayer',
    playerCount: 2,
    humanPlayers: [0, 1], // Both players are human
    teams: null,
  },
};

/** Check if two players are enemies */
export function areEnemies(p1: number, p2: number, teams: number[] | null): boolean {
  if (p1 === p2) return false;
  if (!teams) return true; // FFA — everyone is enemies
  return teams[p1] !== teams[p2];
}

/** Check if two players are allies (same team) */
export function areAllies(p1: number, p2: number, teams: number[] | null): boolean {
  if (p1 === p2) return true;
  if (!teams) return false; // FFA — no allies
  return teams[p1] === teams[p2];
}

/** Get all enemy player IDs for a given player */
export function getEnemyIds(playerId: number, playerCount: number, teams: number[] | null): number[] {
  const enemies: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    if (areEnemies(playerId, i, teams)) enemies.push(i);
  }
  return enemies;
}

/** Get all ally player IDs for a given player (including self) */
export function getAllyIds(playerId: number, playerCount: number, teams: number[] | null): number[] {
  const allies: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    if (areAllies(playerId, i, teams)) allies.push(i);
  }
  return allies;
}

// ============================================
// Utility: create N-length arrays for per-player data
// ============================================

/** Create a per-player number array initialized to a value */
export function perPlayer<T>(playerCount: number, init: T): T[] {
  return Array.from({ length: playerCount }, () =>
    typeof init === 'object' && init !== null ? JSON.parse(JSON.stringify(init)) : init
  );
}
