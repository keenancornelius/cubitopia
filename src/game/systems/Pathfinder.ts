// ============================================
// CUBITOPIA - A* Pathfinder on Hex Grid
// Returns a list of hex coords from start to goal
// ============================================

import { HexCoord, GameMap, TerrainType } from '../../types';

interface PathNode {
  coord: HexCoord;
  g: number;  // cost from start
  h: number;  // heuristic to goal
  f: number;  // g + h
  parent: PathNode | null;
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

  static findPath(start: HexCoord, goal: HexCoord, map: GameMap, canTraverseForest = false, unitOwner?: number): HexCoord[] {
    const startKey = `${start.q},${start.r}`;
    const goalKey = `${goal.q},${goal.r}`;

    if (startKey === goalKey) return [start];

    // Check goal is valid — water and ridge-height tiles are impassable
    const goalTile = map.tiles.get(goalKey);
    if (!goalTile || goalTile.terrain === TerrainType.WATER) {
      return [];
    }
    // Ridge tiles (elevation >= 10) are impassable rocky crags — mountains below are walkable
    if (goalTile.elevation >= 10) {
      return [];
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
        if (nTile && nTile.terrain !== TerrainType.WATER && nTile.elevation < 10
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
        // Block water and ridge-height tiles; forest blocks everyone except lumberjacks
        if (!tile || tile.terrain === TerrainType.WATER || tile.elevation >= 10) {
          continue;
        }
        if (tile.terrain === TerrainType.FOREST && !canTraverseForest) {
          continue;
        }
        // Skip base-blocked and wall-blocked tiles, but allow friendly units through friendly gates
        if (Pathfinder.blockedTiles.has(nKey) && nKey !== effectiveGoalKey) {
          // Check if this is a friendly gate (owned by the pathfinding unit)
          const gateOwner = Pathfinder.gateTiles.get(nKey);
          if (gateOwner === undefined || (unitOwner !== undefined && gateOwner !== unitOwner)) {
            // Either not a gate, or it's an enemy gate — block passage
            continue;
          }
          // It's a friendly gate — allow passage
        }

        let moveCost = Pathfinder.getMoveCost(tile.terrain);
        // Add heavy penalty for tiles occupied by other units (strong anti-collision)
        if (Pathfinder.occupiedTiles.has(nKey) && nKey !== effectiveGoalKey) {
          moveCost += 8;
        }
        const g = current.g + moveCost;
        const h = Pathfinder.heuristic(neighbor, goal);
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
