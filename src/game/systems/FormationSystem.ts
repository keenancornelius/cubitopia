/**
 * FormationSystem — Pure functions for generating hex-grid military formations.
 * No game state — all methods are static and receive map data via parameters.
 */

import { HexCoord, TerrainType, Tile, UnitType, Unit, FormationType } from '../../types';
import { Pathfinder } from './Pathfinder';

/** Minimal map interface for tile validation */
interface TileMap {
  get(key: string): Tile | undefined;
}

/** Check if a terrain type is water */
function isWaterTerrain(terrain: TerrainType): boolean {
  return terrain === TerrainType.WATER || terrain === TerrainType.RIVER ||
         terrain === TerrainType.LAKE || terrain === TerrainType.WATERFALL;
}

/** Check if a tile is passable for formation placement */
function isTilePassable(key: string, tiles: TileMap): boolean {
  const tile = tiles.get(key);
  if (!tile) return false;
  if (isWaterTerrain(tile.terrain) || tile.terrain === TerrainType.MOUNTAIN) return false;
  if (Pathfinder.blockedTiles.has(key)) return false;
  return true;
}

/** Get all hex coordinates on a ring at the given radius from center */
export function getHexRing(center: HexCoord, radius: number): HexCoord[] {
  const ring: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = -radius; dr <= radius; dr++) {
      if (Math.abs(dq) === radius || Math.abs(dr) === radius) {
        ring.push({ q: center.q + dq, r: center.r + dr });
      }
    }
  }
  return ring;
}

/**
 * Generate box/ring formation: center first, then concentric rings.
 * Also rejects FOREST and high-elevation tiles.
 */
export function generateBoxFormation(center: HexCoord, count: number, tiles: TileMap): HexCoord[] {
  const slots: HexCoord[] = [center];
  if (count <= 1) return slots;

  for (let radius = 1; slots.length < count && radius <= 5; radius++) {
    const ring = getHexRing(center, radius);
    ring.sort((a, b) => {
      const da = Math.abs(a.q - center.q) + Math.abs(a.r - center.r);
      const db = Math.abs(b.q - center.q) + Math.abs(b.r - center.r);
      return da - db;
    });
    for (const hex of ring) {
      if (slots.length >= count) break;
      const key = `${hex.q},${hex.r}`;
      const tile = tiles.get(key);
      if (!tile) continue;
      if (isWaterTerrain(tile.terrain) || tile.terrain === TerrainType.FOREST ||
          tile.elevation >= 10) continue;
      if (Pathfinder.blockedTiles.has(key)) continue;
      slots.push(hex);
    }
  }
  return slots;
}

/** Line formation: horizontal spread along the r-axis */
export function generateLineFormation(center: HexCoord, count: number, tiles: TileMap): HexCoord[] {
  const slots: HexCoord[] = [];
  const half = Math.floor(count / 2);
  for (let i = 0; i < count; i++) {
    const offset = i - half;
    const q = center.q;
    const r = center.r + offset;
    const key = `${q},${r}`;
    if (isTilePassable(key, tiles)) {
      slots.push({ q, r });
    } else {
      slots.push(center);
    }
  }
  return slots;
}

/** Wedge formation: expands diagonally backward from center */
export function generateWedgeFormation(center: HexCoord, count: number, tiles: TileMap): HexCoord[] {
  const slots: HexCoord[] = [center];
  let row = 1;
  while (slots.length < count) {
    for (let col = -row; col <= row && slots.length < count; col++) {
      const q = center.q - row;
      const r = center.r + col;
      const key = `${q},${r}`;
      if (isTilePassable(key, tiles)) {
        slots.push({ q, r });
      }
    }
    row++;
    if (row > 6) break;
  }
  return slots;
}

/** Circle formation: concentric rings (no center unit) */
export function generateCircleFormation(center: HexCoord, count: number, tiles: TileMap): HexCoord[] {
  const slots: HexCoord[] = [];
  for (let radius = 1; slots.length < count && radius <= 5; radius++) {
    const ring = getHexRing(center, radius);
    const step = Math.max(1, Math.floor(ring.length / Math.min(count - slots.length, ring.length)));
    for (let i = 0; i < ring.length && slots.length < count; i += step) {
      const hex = ring[i];
      const key = `${hex.q},${hex.r}`;
      if (isTilePassable(key, tiles)) {
        slots.push(hex);
      }
    }
  }
  return slots.length > 0 ? slots : [center];
}

/** Dispatch formation type to the correct generator */
export function generateFormation(
  center: HexCoord, count: number, formation: FormationType, tiles: TileMap
): HexCoord[] {
  if (count <= 1) return [center];
  switch (formation) {
    case FormationType.LINE:   return generateLineFormation(center, count, tiles);
    case FormationType.BOX:    return generateBoxFormation(center, count, tiles);
    case FormationType.WEDGE:  return generateWedgeFormation(center, count, tiles);
    case FormationType.CIRCLE: return generateCircleFormation(center, count, tiles);
    default:                   return generateBoxFormation(center, count, tiles);
  }
}

/**
 * Get the priority order for a unit type in formations.
 * Lower values = outer positions (tanky units like paladins).
 * Higher values = inner positions (ranged/protected units like archers).
 */
export function getUnitFormationPriority(unit: Unit): number {
  switch (unit.type) {
    case UnitType.PALADIN:       return 0;
    case UnitType.WARRIOR:        return 1;
    case UnitType.RIDER:          return 2;
    case UnitType.LUMBERJACK:
    case UnitType.BUILDER:
    case UnitType.VILLAGER:       return 3;
    case UnitType.ARCHER:
    case UnitType.MAGE:           return 4;
    case UnitType.CATAPULT:
    case UnitType.TREBUCHET:
    case UnitType.SCOUT:          return 5;
    default:                      return 3;
  }
}
