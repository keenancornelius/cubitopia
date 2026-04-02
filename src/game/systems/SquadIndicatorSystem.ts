/**
 * SquadIndicatorSystem — Collects squad data from units and feeds it to the renderer.
 * Extracted from main.ts to reduce god-object bloat.
 */

import type { Unit, UnitState } from '../../types';

export interface SquadData {
  squadId: number;
  label: string;
  unitIds: string[];
  centroidWorld: { x: number; y: number; z: number };
  teamId: number;
  unitPositions: Array<{ x: number; y: number; z: number }>;
}

export interface SquadIndicatorOps {
  getAllUnits(): Unit[];
  renderSquadIndicators(squads: SquadData[], gameTime: number): void;
}

export default class SquadIndicatorSystem {
  private ops: SquadIndicatorOps;
  private timer = 0;
  private cachedData: SquadData[] = [];

  constructor(ops: SquadIndicatorOps) {
    this.ops = ops;
  }

  update(gameTime: number): void {
    // Throttle to every 0.3s — squad composition doesn't change every frame
    this.timer += 0.016; // approximate delta
    if (this.timer < 0.3) {
      this.ops.renderSquadIndicators(this.cachedData, gameTime);
      return;
    }
    this.timer = 0;

    const allUnits = this.ops.getAllUnits();

    // Collect all units grouped by team + squadId (composite key avoids cross-team collisions)
    const squadMap = new Map<number, { units: Unit[]; objective: string; squadId: number }>();
    for (let i = 0, len = allUnits.length; i < len; i++) {
      const u = allUnits[i];
      if (u._squadId == null || (u.state as string) === 'dead') continue;
      const compositeKey = u.owner * 1000 + u._squadId;
      let entry = squadMap.get(compositeKey);
      if (!entry) {
        entry = { units: [], objective: u._squadObjective || 'MARCH', squadId: u._squadId };
        squadMap.set(compositeKey, entry);
      }
      entry.units.push(u);
    }

    // Build squad data array
    const squads: SquadData[] = [];
    for (const [compositeKey, { units, objective, squadId }] of squadMap) {
      if (units.length === 0) continue;

      // Compute world centroid from unit positions
      let cx = 0, cy = 0, cz = 0;
      for (const u of units) {
        cx += u.worldPosition.x;
        cy += u.worldPosition.y;
        cz += u.worldPosition.z;
      }
      cx /= units.length;
      cy /= units.length;
      cz /= units.length;

      const shortId = squadId % 100;
      const label = `SQD ${shortId}  ${objective}`;

      squads.push({
        squadId: compositeKey,
        label,
        unitIds: units.map(u => u.id),
        centroidWorld: { x: cx, y: cy, z: cz },
        teamId: units[0].owner,
        unitPositions: units.map(u => ({ x: u.worldPosition.x, y: u.worldPosition.y, z: u.worldPosition.z })),
      });
    }

    this.cachedData = squads;
    this.ops.renderSquadIndicators(squads, gameTime);
  }
}
