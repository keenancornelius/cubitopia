// ============================================
// CUBITOPIA - A* Pathfinder on Hex Grid
// Returns a list of hex coords from start to goal
// ============================================

import { HexCoord, GameMap, TerrainType } from '../../types';
import { Logger } from '../../engine/Logger';

interface PathNode {
  coord: HexCoord;
  g: number;  // cost from start
  h: number;  // heuristic to goal
  f: number;  // g + h
  parent: PathNode | null;
}

/** Cached tile key strings to avoid per-frame template literal allocations.
 *  Key: (q * 10007 + r) — a simple hash for the interning map. */
const _tileKeyCache: Map<number, string> = new Map();

/** Get a cached "q,r" tile key string. Avoids new string allocation on repeated calls. */
export function tileKey(q: number, r: number): string {
  const hash = q * 10007 + r;
  let k = _tileKeyCache.get(hash);
  if (k === undefined) {
    k = `${q},${r}`;
    _tileKeyCache.set(hash, k);
  }
  return k;
}

export class Pathfinder {
  /**
   * Find path from start to goal on hex grid using A*
   */
  /** Set of tile keys that are blocked (e.g. base tiles). Set externally. */
  static blockedTiles: Set<string> = new Set();

  /** Map of gate tiles: "q,r" → owner. Friendly units can pass through own gates. */
  static gateTiles: Map<string, number> = new Map();

  /** Set of tile keys occupied by units. Updated each tick from main game loop. */
  static occupiedTiles: Set<string> = new Set();

  static findPath(start: HexCoord, goal: HexCoord, map: GameMap, canTraverseForest = false, unitOwner?: number, canTraverseRidge = false, tunnelMode = false, ignoreOccupied = false): HexCoord[] {
    const startKey = `${start.q},${start.r}`;
    const goalKey = `${goal.q},${goal.r}`;

    if (startKey === goalKey) return [start];

    // Check goal is valid — water and ridge-height tiles are impassable
    const goalTile = map.tiles.get(goalKey);
    if (!goalTile) return [];
    // In tunnel mode, tunnel tiles are always valid goals regardless of surface terrain
    if (!tunnelMode || !goalTile.hasTunnel) {
      if (goalTile.terrain === TerrainType.WATER) {
        return [];
      }
      // Ridge tiles (elevation >= 10) have steep climbing cost but are passable
      // (walkable paths are carved to mountain forts for accessibility)
    }
    // If goal is forest, path to an adjacent clear tile instead
    const goalIsForest = goalTile.terrain === TerrainType.FOREST;
    let effectiveGoal = goal;
    let effectiveGoalKey = goalKey;
    if (goalIsForest) {
      // Find the nearest clear neighbor of the forest tile
      const neighbors = Pathfinder.getHexNeighbors(goal);
      let bestDist = Infinity;
      for (const n of neighbors) {
        const nKey = `${n.q},${n.r}`;
        const nTile = map.tiles.get(nKey);
        const nw = nTile ? (nTile.walkableFloor ?? nTile.elevation) : 999;
        if (nTile && nTile.terrain !== TerrainType.WATER
            && nTile.terrain !== TerrainType.FOREST && !Pathfinder.blockedTiles.has(nKey)) {
          const dist = Pathfinder.heuristic(start, n);
          if (dist < bestDist) {
            bestDist = dist;
            effectiveGoal = n;
            effectiveGoalKey = nKey;
          }
        }
      }
      if (bestDist === Infinity) return []; // No reachable neighbor
    }

    // If goal is blocked (e.g. base/building tile), path to nearest unblocked neighbor instead
    // Search up to 2 rings out — bases can be surrounded by walls/buildings
    if (Pathfinder.blockedTiles.has(effectiveGoalKey)) {
      let bestDist = Infinity;
      let bestNeighbor: HexCoord | null = null;
      const ring1 = Pathfinder.getHexNeighbors(effectiveGoal);
      const candidates: HexCoord[] = [...ring1];
      // Add ring 2 — neighbors of ring 1
      for (const r1 of ring1) {
        for (const r2 of Pathfinder.getHexNeighbors(r1)) {
          const r2Key = `${r2.q},${r2.r}`;
          // Avoid duplicates from ring 1
          if (!candidates.some(c => c.q === r2.q && c.r === r2.r)) {
            candidates.push(r2);
          }
        }
      }
      for (const n of candidates) {
        const nKey = `${n.q},${n.r}`;
        const nTile = map.tiles.get(nKey);
        if (nTile && nTile.terrain !== TerrainType.WATER
            && (canTraverseForest || nTile.terrain !== TerrainType.FOREST)
            && !Pathfinder.blockedTiles.has(nKey)) {
          const dist = Pathfinder.heuristic(start, n);
          if (dist < bestDist) {
            bestDist = dist;
            bestNeighbor = n;
          }
        }
      }
      if (bestNeighbor) {
        const bTile = map.tiles.get(`${bestNeighbor.q},${bestNeighbor.r}`);
        Logger.debug('Pathfinder', `Blocked goal (${goal.q},${goal.r}) → redirect to (${bestNeighbor.q},${bestNeighbor.r}) terrain=${bTile?.terrain} elev=${bTile ? (bTile.walkableFloor ?? bTile.elevation) : '?'} | start=(${start.q},${start.r})`);
        effectiveGoal = bestNeighbor;
        effectiveGoalKey = `${bestNeighbor.q},${bestNeighbor.r}`;
      } else {
        // Log what candidates were rejected
        const ring1 = Pathfinder.getHexNeighbors(goal);
        const reasons: string[] = [];
        for (const n of ring1) {
          const nk = `${n.q},${n.r}`;
          const nt = map.tiles.get(nk);
          reasons.push(`(${n.q},${n.r}):${!nt?'noTile':nt.terrain}${Pathfinder.blockedTiles.has(nk)?'/blocked':''}${nt?.terrain===TerrainType.FOREST?'/forest':''}`);
        }
        Logger.debug('Pathfinder', `Blocked goal (${goal.q},${goal.r}) — NO redirect found! Neighbors: ${reasons.join(', ')}`);
        return []; // Completely walled off — no path possible
      }
    }

    const open: PathNode[] = [];
    const closed = new Set<string>();

    const startNode: PathNode = {
      coord: start,
      g: 0,
      h: Pathfinder.heuristic(start, effectiveGoal),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;
    open.push(startNode);

    while (open.length > 0) {
      // Find node with lowest f
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0];
      const currentKey = `${current.coord.q},${current.coord.r}`;

      if (currentKey === effectiveGoalKey) {
        return Pathfinder.reconstructPath(current);
      }

      closed.add(currentKey);

      // Expand neighbors
      const neighbors = Pathfinder.getHexNeighbors(current.coord);
      for (const neighbor of neighbors) {
        const nKey = `${neighbor.q},${neighbor.r}`;
        if (closed.has(nKey)) continue;

        const tile = map.tiles.get(nKey);
        if (!tile) continue;
        const nWalkable = tile.walkableFloor ?? tile.elevation;
        // In tunnel mode, tunnel tiles bypass all surface terrain checks
        const isTunnelTile = tunnelMode && tile.hasTunnel;
        if (!isTunnelTile) {
          // Block water and ridge-height tiles; forest blocks everyone except lumberjacks; ridges block everyone except builders
          if (tile.terrain === TerrainType.WATER) {
            continue;
          }
          // Ridge tiles (elevation >= 10) are passable but costly (steep climb)
          if (tile.terrain === TerrainType.FOREST && !canTraverseForest) {
            continue;
          }
        }
        // Skip base-blocked and wall-blocked tiles, but allow friendly units through friendly gates
        // In tunnel mode, tunnel tiles bypass blocked tile checks too (tunnels go under buildings)
        if (Pathfinder.blockedTiles.has(nKey) && nKey !== effectiveGoalKey && !isTunnelTile) {
          // Check if this is a friendly gate (owned by the pathfinding unit)
          const gateOwner = Pathfinder.gateTiles.get(nKey);
          if (gateOwner === undefined || (unitOwner !== undefined && gateOwner !== unitOwner)) {
            // Either not a gate, or it's an enemy gate — block passage
            continue;
          }
          // It's a friendly gate — allow passage
        }

        let moveCost = isTunnelTile ? 0.5 : Pathfinder.getMoveCost(tile.terrain);
        // Ridge tiles are slow to traverse — steep climbing cost (not in tunnel mode)
        if (!isTunnelTile && nWalkable >= 10) moveCost += 3;
        // Tunnel shortcut: reduce cost to encourage pathfinder to use tunnels (ONLY in tunnel mode)
        // In surface mode, tunnel tiles use normal terrain cost — no bonus for cutting through ground
        if (tunnelMode && tile.hasTunnel) moveCost = Math.max(0.1, moveCost - 0.5);
        // Add penalty for tiles occupied by other units (anti-collision)
        // Squad units skip this — the penalty creates impassable chokepoints
        // near congested bases.
        if (!ignoreOccupied && Pathfinder.occupiedTiles.has(nKey) && nKey !== effectiveGoalKey) {
          moveCost += 3; // Reduced from 8 — still discourages but doesn't block
        }
        const g = current.g + moveCost;
        const h = Pathfinder.heuristic(neighbor, effectiveGoal);
        const f = g + h;

        // Check if this neighbor is already in open with a better path
        const existing = open.find(n => n.coord.q === neighbor.q && n.coord.r === neighbor.r);
        if (existing && existing.g <= g) continue;

        if (existing) {
          existing.g = g;
          existing.h = h;
          existing.f = f;
          existing.parent = current;
        } else {
          open.push({ coord: neighbor, g, h, f, parent: current });
        }
      }
    }

    Logger.debug('Pathfinder', `A* exhausted: (${start.q},${start.r}) → effective (${effectiveGoal.q},${effectiveGoal.r}) | explored ${closed.size} nodes, open=${open.length}`);
    return []; // No path found
  }

  /**
   * Get hex neighbors (6 directions, offset coordinates)
   */
  static getHexNeighbors(coord: HexCoord): HexCoord[] {
    const { q, r } = coord;
    const isOddCol = q % 2 === 1;

    if (isOddCol) {
      return [
        { q: q + 1, r: r + 1 }, { q: q + 1, r },
        { q: q - 1, r: r + 1 }, { q: q - 1, r },
        { q, r: r - 1 },        { q, r: r + 1 },
      ];
    } else {
      return [
        { q: q + 1, r },     { q: q + 1, r: r - 1 },
        { q: q - 1, r },     { q: q - 1, r: r - 1 },
        { q, r: r - 1 },     { q, r: r + 1 },
      ];
    }
  }

  /**
   * Hex distance heuristic
   */
  static heuristic(a: HexCoord, b: HexCoord): number {
    // Cube distance for offset hex coordinates
    const ac = Pathfinder.offsetToCube(a);
    const bc = Pathfinder.offsetToCube(b);
    return Math.max(
      Math.abs(ac.x - bc.x),
      Math.abs(ac.y - bc.y),
      Math.abs(ac.z - bc.z)
    );
  }

  private static offsetToCube(hex: HexCoord): { x: number; y: number; z: number } {
    const x = hex.q;
    const z = hex.r - (hex.q - (hex.q & 1)) / 2;
    const y = -x - z;
    return { x, y, z };
  }

  private static getMoveCost(terrain: TerrainType): number {
    switch (terrain) {
      case TerrainType.PLAINS: return 1;
      case TerrainType.FOREST: return 3;
      case TerrainType.MOUNTAIN: return 2;
      case TerrainType.DESERT: return 1.5;
      case TerrainType.JUNGLE: return 2.5;  // Dense vegetation slows movement
      case TerrainType.SNOW: return 2;
      case TerrainType.RIVER: return 20;     // Units strongly avoid water
      case TerrainType.LAKE: return 25;     // Deep water — nearly impassable
      case TerrainType.WATERFALL: return 30; // Extremely dangerous to cross
      default: return 1;
    }
  }

  private static reconstructPath(node: PathNode): HexCoord[] {
    const path: HexCoord[] = [];
    let current: PathNode | null = node;
    while (current) {
      path.unshift(current.coord);
      current = current.parent;
    }
    return path;
  }
}
