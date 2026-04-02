/**
 * BoidsSteering — Role-weighted flocking forces for fluid army movement.
 *
 * Each unit computes separation/alignment/cohesion + role-specific forces,
 * which are blended into a single steering vector applied during movement.
 *
 * Design doc: docs/COMBAT_AI_DESIGN.md §6
 */

import { Unit, UnitType, UnitState, HexCoord } from '../../types';
import { TacticalGroup, TacticalRole, getTacticalRole, GroupPhase, isAlive } from './TacticalGroup';
import { Pathfinder } from './Pathfinder';
import { GAME_CONFIG } from '../GameConfig';

// ── Vec2 helpers (world-space: x/z) ─────────────────────────────

export interface Vec2 { x: number; z: number; }

function v2zero(): Vec2 { return { x: 0, z: 0 }; }

function v2add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, z: a.z + b.z }; }

function v2scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, z: v.z * s }; }

function v2sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, z: a.z - b.z }; }

function v2len(v: Vec2): number { return Math.sqrt(v.x * v.x + v.z * v.z); }

function v2normalize(v: Vec2): Vec2 {
  const len = v2len(v);
  return len > 0.001 ? { x: v.x / len, z: v.z / len } : v2zero();
}

function v2dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function unitWorldPos(u: Unit): Vec2 {
  return { x: u.worldPosition.x, z: u.worldPosition.z };
}

function hexToWorld2D(pos: HexCoord): Vec2 {
  return {
    x: pos.q * 1.5,
    z: pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0),
  };
}

function centroidWorld(units: Unit[]): Vec2 {
  if (units.length === 0) return v2zero();
  let sx = 0, sz = 0;
  for (const u of units) { sx += u.worldPosition.x; sz += u.worldPosition.z; }
  return { x: sx / units.length, z: sz / units.length };
}

// ── Force weight profiles per role and phase ────────────────────

interface ForceWeights {
  separation: number;
  alignment: number;
  cohesion: number;
  objective: number;
  // Role-specific (only some are non-zero per role)
  interpose: number;      // Tanks: pull between enemy and own ranged
  enemyAttract: number;   // Tanks: mild pull toward enemy
  allyProtect: number;    // Tanks: pull toward attacked squishy
  enemyRepel: number;     // Ranged/Support: push away from close enemies
  rangeMaintain: number;  // Ranged: pull to weapon-range distance
  tankAttract: number;    // Ranged: kite toward nearest tank
  cluster: number;        // Ranged/Support: cluster with same role
  injuredAttract: number; // Support: pull toward most-injured ally
  flank: number;          // Divers: pull toward flank waypoint
  targetAttract: number;  // Divers: pull toward dive target
  tankRepel: number;      // Divers: push away from enemy tanks
  maxRear: number;        // Siege: stay behind army
}

const ZERO_WEIGHTS: ForceWeights = {
  separation: 0, alignment: 0, cohesion: 0, objective: 0,
  interpose: 0, enemyAttract: 0, allyProtect: 0,
  enemyRepel: 0, rangeMaintain: 0, tankAttract: 0, cluster: 0,
  injuredAttract: 0,
  flank: 0, targetAttract: 0, tankRepel: 0,
  maxRear: 0,
};

// March weights: very tight formation — units stay glued to the group centroid
const MARCH_WEIGHTS: Record<TacticalRole, Partial<ForceWeights>> = {
  [TacticalRole.TANK]:      { separation: 2.0, alignment: 0.8, cohesion: 2.5, objective: 0.3, enemyAttract: 0.3 },
  [TacticalRole.MELEE_DPS]: { separation: 2.0, alignment: 0.8, cohesion: 2.2, objective: 0.3 },
  [TacticalRole.RANGED]:    { separation: 2.0, alignment: 0.6, cohesion: 2.5, objective: 0.2, tankAttract: 0.5, cluster: 0.8 },
  [TacticalRole.DIVER]:     { separation: 1.8, alignment: 0.5, cohesion: 1.8, objective: 0.3 },
  [TacticalRole.SUPPORT]:   { separation: 2.0, alignment: 0.6, cohesion: 2.5, objective: 0.15, cluster: 1.0 },
  [TacticalRole.SIEGE]:     { separation: 2.0, alignment: 0.5, cohesion: 2.0, objective: 0.15, maxRear: 0.8 },
  [TacticalRole.WORKER]:    { separation: 1.0, alignment: 0.1, cohesion: 0.3, objective: 0.1 },
};

// Combat weights: tight role-specific tactical behavior — shoulder to shoulder
const COMBAT_WEIGHTS: Record<TacticalRole, Partial<ForceWeights>> = {
  [TacticalRole.TANK]:      { separation: 2.2, alignment: 0.2, cohesion: 0.6, interpose: 1.8, enemyAttract: 1.0, allyProtect: 1.2 },
  [TacticalRole.MELEE_DPS]: { separation: 2.0, alignment: 0.2, cohesion: 0.6, enemyAttract: 0.8, objective: 0.1 },
  [TacticalRole.RANGED]:    { separation: 2.0, alignment: 0.2, cohesion: 0.5, enemyRepel: 1.4, rangeMaintain: 1.0, tankAttract: 0.8, cluster: 0.7 },
  [TacticalRole.DIVER]:     { separation: 1.8, alignment: 0.0, cohesion: 0.2, flank: 1.4, targetAttract: 1.2, tankRepel: 1.0 },
  [TacticalRole.SUPPORT]:   { separation: 2.0, alignment: 0.2, cohesion: 0.6, enemyRepel: 1.8, injuredAttract: 1.2, cluster: 1.0 },
  [TacticalRole.SIEGE]:     { separation: 2.0, alignment: 0.1, cohesion: 0.8, enemyRepel: 2.5, maxRear: 2.0 },
  [TacticalRole.WORKER]:    { separation: 1.0, alignment: 0.0, cohesion: 0.1, enemyRepel: 2.0 },
};

function getWeights(role: TacticalRole, inCombat: boolean): ForceWeights {
  const base = inCombat ? COMBAT_WEIGHTS[role] : MARCH_WEIGHTS[role];
  return { ...ZERO_WEIGHTS, ...base };
}

// ── Perception distances ────────────────────────────────────────

const SEPARATION_RADIUS = GAME_CONFIG.boids.separationRadius;
const ALIGNMENT_RADIUS = GAME_CONFIG.boids.alignmentRadius;
const COHESION_RADIUS = GAME_CONFIG.boids.cohesionRadius;
const ENEMY_REPEL_RADIUS = GAME_CONFIG.boids.enemyRepelRadius;
const TANK_ATTRACT_RADIUS = GAME_CONFIG.boids.tankAttractRadius;

// ── Main force computation ──────────────────────────────────────

/**
 * Compute a steering force vector (world-space x/z) for a unit.
 * The force should be applied as a bias to the unit's movement direction.
 * Returns a vector whose magnitude is the desired influence strength.
 */
export function computeBoidsForce(
  unit: Unit,
  group: TacticalGroup,
  allUnits: Unit[],
  nearbyEnemies: Unit[],
): Vec2 {
  // Joining units path independently — no boids forces
  if (unit._squadJoining) return v2zero();

  const role = getTacticalRole(unit.type);
  const inCombat = group.phase === GroupPhase.ENGAGING;
  const w = getWeights(role, inCombat);
  const pos = unitWorldPos(unit);
  let force = v2zero();

  // Cache group centroid (avoids recomputing from livingUnits 4+ times)
  const groupCenter = hexToWorld2D(group.centroid);

  // ── Universal forces ──

  // Separation: push away from units closer than SEPARATION_RADIUS
  if (w.separation > 0) {
    const SEP_R2 = SEPARATION_RADIUS * SEPARATION_RADIUS;
    let sepX = 0, sepZ = 0;
    let count = 0;
    const living = group.livingUnits;
    for (let i = 0, len = living.length; i < len; i++) {
      const other = living[i];
      if (other === unit) continue;
      const dx = pos.x - other.worldPosition.x;
      const dz = pos.z - other.worldPosition.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < SEP_R2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const str = (SEPARATION_RADIUS - d) / SEPARATION_RADIUS;
        sepX += (dx / d) * str;
        sepZ += (dz / d) * str;
        count++;
      }
    }
    if (count > 0) {
      force = v2add(force, { x: sepX * w.separation, z: sepZ * w.separation });
    }
  }

  // Alignment: match average velocity of nearby groupmates
  if (w.alignment > 0) {
    let avgVel = v2zero();
    let count = 0;
    for (const other of group.livingUnits) {
      if (other === unit) continue;
      const d = v2dist(pos, unitWorldPos(other));
      if (d < ALIGNMENT_RADIUS) {
        // Approximate velocity from targetPosition
        if (other.targetPosition) {
          const target = hexToWorld2D(other.targetPosition);
          const vel = v2normalize(v2sub(target, unitWorldPos(other)));
          avgVel = v2add(avgVel, vel);
          count++;
        }
      }
    }
    if (count > 0) {
      avgVel = v2scale(avgVel, 1 / count);
      force = v2add(force, v2scale(avgVel, w.alignment));
    }
  }

  // Cohesion: pull toward group centroid
  // When the group is far from its objective (just deployed / leaving base), cohesion
  // is dampened so units can actually start marching instead of pinning each other down.
  // Cohesion ramps up once the group is en route (centroid within ~6 world units of target).
  if (w.cohesion > 0) {
    const d = v2dist(pos, groupCenter);
    if (d > 0.4) {
      const pull = v2normalize(v2sub(groupCenter, pos));
      let strength: number;
      if (d < 3.0) {
        strength = (d - 0.4) / COHESION_RADIUS;
      } else {
        const base = (3.0 - 0.4) / COHESION_RADIUS;
        const excess = (d - 3.0) / 3.0;
        strength = base + excess * excess * 2.0;
      }
      strength = Math.min(3.0, strength);
      // Dampen cohesion when group centroid is far from objective
      // At >10 world units from objective: 30% cohesion (lets group start moving)
      // At <4 world units: full cohesion (tight formation near target)
      if (group.objective) {
        const objPos = hexToWorld2D(group.objective);
        const centroidToObj = v2dist(groupCenter, objPos);
        if (centroidToObj > 10) strength *= 0.3;
        else if (centroidToObj > 6) strength *= 0.5;
      }
      force = v2add(force, v2scale(pull, w.cohesion * strength));
    }
  }

  // Objective: pull toward march target
  // When the group centroid is far from the objective (squad hasn't left base yet),
  // boost objective pull dramatically so cohesion can't freeze the whole group in place
  if (w.objective > 0) {
    const target = hexToWorld2D(group.objective);
    const pull = v2normalize(v2sub(target, pos));
    const centroidToObj = v2dist(groupCenter, target);
    // Boost: when centroid is >8 world units from objective, objective force is 5x stronger
    // This decays to 1x as the group approaches. Prevents cohesion deadlock at base.
    const distBoost = centroidToObj > 8 ? 5.0 : (centroidToObj > 4 ? 2.5 : 1.0);
    force = v2add(force, v2scale(pull, w.objective * distBoost));
  }

  // ── Role-specific forces ──

  // TANK: Interpose between enemy centroid and ranged line
  if (w.interpose > 0 && group.blackboard.tankLineCenter) {
    const tankLine = hexToWorld2D(group.blackboard.tankLineCenter);
    const pull = v2normalize(v2sub(tankLine, pos));
    const d = v2dist(pos, tankLine);
    const strength = Math.min(1.0, d / 4.0);
    force = v2add(force, v2scale(pull, w.interpose * strength));
  }

  // TANK: Mild pull toward nearest enemy
  if (w.enemyAttract > 0 && nearbyEnemies.length > 0) {
    let nearest: Unit | null = null;
    let nearDist = Infinity;
    for (const e of nearbyEnemies) {
      const d = v2dist(pos, unitWorldPos(e));
      if (d < nearDist) { nearDist = d; nearest = e; }
    }
    if (nearest) {
      const pull = v2normalize(v2sub(unitWorldPos(nearest), pos));
      force = v2add(force, v2scale(pull, w.enemyAttract));
    }
  }

  // TANK: Pull toward attacked squishy allies (peel)
  if (w.allyProtect > 0) {
    const diverIds = group.blackboard.incomingDivers;
    if (diverIds.length > 0) {
      // Find the nearest incoming diver we've claimed (or can claim)
      for (const diverId of diverIds) {
        if (group.claimPeel(unit.id, diverId)) {
          const diver = allUnits.find(u => u.id === diverId);
          if (diver && isAlive(diver)) {
            const pull = v2normalize(v2sub(unitWorldPos(diver), pos));
            force = v2add(force, v2scale(pull, w.allyProtect));
          }
          break; // Only peel one target
        }
      }
    }
  }

  // RANGED/SUPPORT: Push away from close enemies
  if (w.enemyRepel > 0) {
    let repel = v2zero();
    let count = 0;
    for (const e of nearbyEnemies) {
      const d = v2dist(pos, unitWorldPos(e));
      if (d < ENEMY_REPEL_RADIUS && d > 0.01) {
        const push = v2normalize(v2sub(pos, unitWorldPos(e)));
        repel = v2add(repel, v2scale(push, (ENEMY_REPEL_RADIUS - d) / ENEMY_REPEL_RADIUS));
        count++;
      }
    }
    if (count > 0) {
      force = v2add(force, v2scale(repel, w.enemyRepel));
    }
  }

  // RANGED: Maintain weapon range from current target
  if (w.rangeMaintain > 0 && unit.command?.targetUnitId) {
    const target = allUnits.find(u => u.id === unit.command!.targetUnitId);
    if (target && isAlive(target)) {
      const tPos = unitWorldPos(target);
      const d = v2dist(pos, tPos);
      const idealDist = unit.stats.range * 1.5; // World units (range in hexes * 1.5)
      if (d < idealDist) {
        // Too close — push away
        const push = v2normalize(v2sub(pos, tPos));
        force = v2add(force, v2scale(push, w.rangeMaintain * (idealDist - d) / idealDist));
      } else if (d > idealDist + 2) {
        // Too far — pull closer
        const pull = v2normalize(v2sub(tPos, pos));
        force = v2add(force, v2scale(pull, w.rangeMaintain * 0.3));
      }
    }
  }

  // RANGED: Attract toward nearest friendly tank (kite toward protection)
  if (w.tankAttract > 0 && group.tanks.length > 0) {
    let nearestTank: Unit | null = null;
    let nearTankDist = Infinity;
    for (const t of group.tanks) {
      const d = v2dist(pos, unitWorldPos(t));
      if (d < nearTankDist && d < TANK_ATTRACT_RADIUS) {
        nearTankDist = d;
        nearestTank = t;
      }
    }
    if (nearestTank) {
      const pull = v2normalize(v2sub(unitWorldPos(nearestTank), pos));
      const strength = Math.min(1.0, nearTankDist / TANK_ATTRACT_RADIUS);
      force = v2add(force, v2scale(pull, w.tankAttract * strength));
    }
  }

  // RANGED/SUPPORT: Cluster with same role
  if (w.cluster > 0) {
    const sameRole = role === TacticalRole.SUPPORT ? group.support : group.ranged;
    if (sameRole.length > 1) {
      const center = centroidWorld(sameRole);
      const d = v2dist(pos, center);
      if (d > 0.6) {
        const pull = v2normalize(v2sub(center, pos));
        force = v2add(force, v2scale(pull, w.cluster * Math.min(1.0, d / 4.0)));
      }
    }
  }

  // SUPPORT: Pull toward most-injured ally
  if (w.injuredAttract > 0) {
    let worstUnit: Unit | null = null;
    let worstRatio = 1.0;
    for (const ally of group.livingUnits) {
      if (ally === unit) continue;
      const ratio = ally.currentHealth / ally.stats.maxHealth;
      if (ratio < worstRatio) {
        const d = v2dist(pos, unitWorldPos(ally));
        if (d < 8.0) { // Only care about nearby injured
          worstRatio = ratio;
          worstUnit = ally;
        }
      }
    }
    if (worstUnit && worstRatio < 0.9) {
      const pull = v2normalize(v2sub(unitWorldPos(worstUnit), pos));
      const urgency = 1 - worstRatio; // 0 = full hp, 1 = nearly dead
      force = v2add(force, v2scale(pull, w.injuredAttract * urgency));
    }
  }

  // DIVER: Pull toward flank waypoint
  if (w.flank > 0) {
    const diverIndex = group.divers.indexOf(unit);
    const wp = group.getFlankWaypoint(diverIndex >= 0 ? diverIndex : 0);
    if (wp) {
      const target = hexToWorld2D(wp);
      const d = v2dist(pos, target);
      if (d > 1.5) {
        const pull = v2normalize(v2sub(target, pos));
        force = v2add(force, v2scale(pull, w.flank));
      }
    }
  }

  // DIVER: Pull toward dive target
  if (w.targetAttract > 0 && unit.command?.targetUnitId) {
    const target = allUnits.find(u => u.id === unit.command!.targetUnitId);
    if (target && isAlive(target)) {
      const pull = v2normalize(v2sub(unitWorldPos(target), pos));
      force = v2add(force, v2scale(pull, w.targetAttract));
    }
  }

  // DIVER: Push away from enemy tanks (go around, not through)
  if (w.tankRepel > 0) {
    let repel = v2zero();
    for (const e of nearbyEnemies) {
      const eRole = getTacticalRole(e.type);
      if (eRole !== TacticalRole.TANK) continue;
      const d = v2dist(pos, unitWorldPos(e));
      if (d < 4.0 && d > 0.01) {
        const push = v2normalize(v2sub(pos, unitWorldPos(e)));
        repel = v2add(repel, v2scale(push, (4.0 - d) / 4.0));
      }
    }
    force = v2add(force, v2scale(repel, w.tankRepel));
  }

  // SIEGE: Stay at max rear
  if (w.maxRear > 0 && group.enemyCentroid) {
    const enemyCenter = hexToWorld2D(group.enemyCentroid);

    // Direction away from enemy
    const awayDir = v2normalize(v2sub(groupCenter, enemyCenter));
    // Target position: far behind group center
    const rearTarget = v2add(groupCenter, v2scale(awayDir, 6));
    const pull = v2normalize(v2sub(rearTarget, pos));
    force = v2add(force, v2scale(pull, w.maxRear));
  }

  // ── March-phase role biasing ──
  // During march: tanks drift to leading edge, ranged drift to rear — strong role arrays
  if (!inCombat && (group.phase === GroupPhase.MARCHING || group.phase === GroupPhase.MUSTERING)) {
    const dir = hexToWorld2D(group.objective);

    const marchDir = v2normalize(v2sub(dir, groupCenter));
    // Perpendicular for lateral line-spreading
    const perpDir: Vec2 = { x: -marchDir.z, z: marchDir.x };

    if (role === TacticalRole.TANK) {
      // Tanks: strong push to front line
      force = v2add(force, v2scale(marchDir, 1.2));
      // Spread laterally to form a wall
      const tankIdx = group.tanks.indexOf(unit);
      const tankCount = group.tanks.length;
      const spread = tankCount > 1 ? ((tankIdx / (tankCount - 1)) - 0.5) * 2 : 0;
      force = v2add(force, v2scale(perpDir, spread * 0.5));
    } else if (role === TacticalRole.MELEE_DPS) {
      // Melee: just behind tanks
      force = v2add(force, v2scale(marchDir, 0.6));
      // Spread laterally — use pre-computed sublist (no allocation)
      const meleeIdx = group.meleeDps.indexOf(unit);
      const meleeCount = group.meleeDps.length;
      const spread = meleeCount > 1 ? ((meleeIdx / (meleeCount - 1)) - 0.5) * 2 : 0;
      force = v2add(force, v2scale(perpDir, spread * 0.4));
    } else if (role === TacticalRole.RANGED) {
      // Ranged: solid rear line
      force = v2add(force, v2scale(marchDir, -0.8));
      // Cluster into a tight line
      const rangedIdx = group.ranged.indexOf(unit);
      const rangedCount = group.ranged.length;
      const spread = rangedCount > 1 ? ((rangedIdx / (rangedCount - 1)) - 0.5) * 2 : 0;
      force = v2add(force, v2scale(perpDir, spread * 0.5));
    } else if (role === TacticalRole.SUPPORT) {
      // Support: behind ranged, center mass
      force = v2add(force, v2scale(marchDir, -1.0));
    } else if (role === TacticalRole.SIEGE) {
      // Siege: far rear
      force = v2add(force, v2scale(marchDir, -1.4));
    }
    // Divers drift to the flanks
    if (role === TacticalRole.DIVER) {
      const diverIdx = group.divers.indexOf(unit);
      const side = (diverIdx % 2 === 0) ? 1 : -1;
      force = v2add(force, v2scale(perpDir, 0.8 * side));
      force = v2add(force, v2scale(marchDir, 0.3)); // Slightly forward
    }
  }

  // ── Combat-phase role arrays ──
  // Even during combat, roles should maintain relative positioning
  if (inCombat && group.enemyCentroid) {
    const enemyCenter = hexToWorld2D(group.enemyCentroid);

    const toEnemy = v2normalize(v2sub(enemyCenter, groupCenter));
    const perpDir: Vec2 = { x: -toEnemy.z, z: toEnemy.x };

    if (role === TacticalRole.TANK) {
      // Tanks: strong push toward enemy to form front wall
      force = v2add(force, v2scale(toEnemy, 0.8));
      // Spread to form a shield wall
      const tankIdx = group.tanks.indexOf(unit);
      const tankCount = group.tanks.length;
      const spread = tankCount > 1 ? ((tankIdx / (tankCount - 1)) - 0.5) * 2 : 0;
      force = v2add(force, v2scale(perpDir, spread * 0.6));
    } else if (role === TacticalRole.RANGED) {
      // Ranged: spread into a line behind tanks
      const rangedIdx = group.ranged.indexOf(unit);
      const rangedCount = group.ranged.length;
      const spread = rangedCount > 1 ? ((rangedIdx / (rangedCount - 1)) - 0.5) * 2 : 0;
      force = v2add(force, v2scale(perpDir, spread * 0.5));
    }
  }

  // Clamp total force magnitude to prevent wild overshooting
  const maxForce = 4.0;
  const mag = v2len(force);
  if (mag > maxForce) {
    force = v2scale(v2normalize(force), maxForce);
  }

  return force;
}

/**
 * Convert a boids steering force to a world-space position offset.
 * This is applied as a nudge to the unit's world position each frame.
 * The strength parameter scales how much the boids force affects movement
 * (0 = no effect, 1 = full effect).
 */
export function applyBoidsToMovement(
  unit: Unit,
  force: Vec2,
  delta: number,
  strength: number = 0.5,
): { dx: number; dz: number } {
  const speed = unit.moveSpeed * strength;
  return {
    dx: force.x * speed * delta,
    dz: force.z * speed * delta,
  };
}
