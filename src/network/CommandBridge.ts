// ============================================
// CUBITOPIA - Command Bridge
// Translates NetworkCommand → game state mutations
// ============================================
//
// This module bridges the CommandQueue (which handles ordering
// and network sync) with the actual game systems. Each command
// type maps to a method that performs the same action that was
// previously done inline in main.ts / InputManager.ts.
//
// Single-player: commands execute immediately via enqueue()
// Multiplayer:   commands buffer, sync, then execute via processTick()
//
// The bridge never reads from InputManager — it only reads from
// the serialized command payload, making it safe for replay and
// deterministic lockstep.
// ============================================

import {
  NetworkCommand,
  NetCommandType,
  MovePayload,
  AttackPayload,
  AttackMovePayload,
  StopPayload,
  PlaceBuildingPayload,
  PlaceWallPayload,
  QueueUnitPayload,
  SetStancePayload,
  LockElementPayload,
  SetTargetPayload,
  SetRallyPointPayload,
  GarrisonPayload,
  SquadPayload,
} from './Protocol';
import type { Unit, HexCoord } from '../types';
import { UnitState, UnitStance, UnitType, ElementType } from '../types';

// ── Game interface ──────────────────────────────────────────
// The bridge receives a thin interface to the game, not the
// full Cubitopia class. This keeps the dependency clean and
// makes testing possible.

export interface CommandBridgeGame {
  // Unit lookup
  findUnitById(id: string): Unit | undefined;
  getPlayerUnits(owner: number): Unit[];

  // Map access
  getCurrentMap(): any; // HexMap

  // UnitAI commands (static methods wrapped for bridge access)
  commandMove(unit: Unit, target: HexCoord, preferUnderground?: boolean): void;
  commandAttack(unit: Unit, target: HexCoord, targetUnitId: string | null, preferUnderground?: boolean): void;
  commandStop(unit: Unit): void;

  // Building placement
  placeBuilding(kind: string, position: HexCoord, owner: number): void;
  cancelBuilding(blueprintId: string): void;

  // Wall/gate placement
  placeWall(positions: HexCoord[], isGate: boolean, owner: number): void;

  // Spawn queue
  queueUnit(unitType: string, buildingKind: string, owner: number): void;

  // Stance
  setUnitStance(unit: Unit, stance: UnitStance): void;

  // Element lock (mage QWERT)
  lockElement(unit: Unit, element: ElementType | null): void;

  // Heal target
  setHealTarget(unit: Unit, targetUnitId: string | null): void;

  // Focus target
  setFocusTarget(unit: Unit, targetUnitId: string | null): void;

  // Rally point
  setRallyPoint(buildingId: string, position: HexCoord): void;

  // Garrison
  garrisonUnit(unitIds: string[], buildingPosition?: HexCoord): void;
  ungarrison(unitIds: string[], buildingPosition?: HexCoord): void;

  // Squad
  setSquadObjective(squadId: number, objective: string, target?: HexCoord): void;

  // Player ID mapping
  getOwnerForPlayerId(playerId: string): number;
}

// ── Bridge ───────────────────────────────────────────────────

export function processCommand(game: CommandBridgeGame, cmd: NetworkCommand): void {
  const owner = game.getOwnerForPlayerId(cmd.playerId);
  console.log(`[Bridge] processCommand: type=${cmd.type} playerId=${cmd.playerId?.slice(0,8)} → owner=${owner}`);

  switch (cmd.type) {
    case NetCommandType.MOVE: {
      const p = cmd.payload as MovePayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          unit._playerCommanded = true;
          unit._focusTarget = undefined;
          unit._healTarget = undefined;
          unit._assignedBlueprintId = undefined;
          unit._moveDestination = p.target;
          // Stance-based force-move: passive = ignore everything, else react
          if (unit.stance === UnitStance.PASSIVE) {
            unit._forceMove = true;
          } else {
            unit._forceMove = false;
            if (unit.stance === UnitStance.DEFENSIVE) {
              unit._postPosition = p.target;
            }
          }
          game.commandMove(unit, p.target);
        }
      }
      break;
    }

    case NetCommandType.ATTACK: {
      const p = cmd.payload as AttackPayload;
      const targetUnit = game.findUnitById(p.targetUnitId);
      const targetPos = targetUnit?.position ?? { q: 0, r: 0 };
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          unit._playerCommanded = true;
          unit._forceMove = false;
          unit._focusTarget = p.targetUnitId;
          game.commandAttack(unit, targetPos, p.targetUnitId);
        }
      }
      break;
    }

    case NetCommandType.ATTACK_MOVE: {
      const p = cmd.payload as AttackMovePayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          unit._playerCommanded = true;
          unit._forceMove = false;
          unit._focusTarget = undefined;
          unit.stance = UnitStance.AGGRESSIVE;
          unit._attackMoveClickPoint = p.target;
          unit._moveDestination = p.target;
          game.commandAttack(unit, p.target, null);
        }
      }
      break;
    }

    case NetCommandType.STOP: {
      const p = cmd.payload as StopPayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          game.commandStop(unit);
        }
      }
      break;
    }

    case NetCommandType.PLACE_BUILDING: {
      const p = cmd.payload as PlaceBuildingPayload;
      game.placeBuilding(p.kind, p.position, owner);
      break;
    }

    case NetCommandType.CANCEL_BUILDING: {
      const p = cmd.payload as { blueprintId: string };
      game.cancelBuilding(p.blueprintId);
      break;
    }

    case NetCommandType.PLACE_WALL: {
      const p = cmd.payload as PlaceWallPayload;
      game.placeWall(p.positions, p.isGate ?? false, owner);
      break;
    }

    case NetCommandType.PLACE_GATE: {
      const p = cmd.payload as PlaceWallPayload;
      game.placeWall(p.positions, true, owner);
      break;
    }

    case NetCommandType.QUEUE_UNIT: {
      const p = cmd.payload as QueueUnitPayload;
      game.queueUnit(p.unitType, p.buildingKind, owner);
      break;
    }

    case NetCommandType.SET_STANCE: {
      const p = cmd.payload as SetStancePayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          game.setUnitStance(unit, p.stance);
        }
      }
      break;
    }

    case NetCommandType.LOCK_ELEMENT: {
      const p = cmd.payload as LockElementPayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          game.lockElement(unit, p.element);
        }
      }
      break;
    }

    case NetCommandType.UNLOCK_ELEMENT: {
      const p = cmd.payload as LockElementPayload;
      for (const id of p.unitIds) {
        const unit = game.findUnitById(id);
        if (unit && unit.owner === owner) {
          game.lockElement(unit, null);
        }
      }
      break;
    }

    case NetCommandType.SET_HEAL_TARGET: {
      const p = cmd.payload as SetTargetPayload;
      const unit = game.findUnitById(p.unitId);
      if (unit && unit.owner === owner) {
        game.setHealTarget(unit, p.targetUnitId);
      }
      break;
    }

    case NetCommandType.SET_FOCUS_TARGET: {
      const p = cmd.payload as SetTargetPayload;
      const unit = game.findUnitById(p.unitId);
      if (unit && unit.owner === owner) {
        game.setFocusTarget(unit, p.targetUnitId);
      }
      break;
    }

    case NetCommandType.SET_RALLY_POINT: {
      const p = cmd.payload as SetRallyPointPayload;
      game.setRallyPoint(p.buildingId, p.position);
      break;
    }

    case NetCommandType.GARRISON_UNIT: {
      const p = cmd.payload as GarrisonPayload;
      game.garrisonUnit(p.unitIds, p.buildingPosition);
      break;
    }

    case NetCommandType.UNGARRISON: {
      const p = cmd.payload as GarrisonPayload;
      game.ungarrison(p.unitIds, p.buildingPosition);
      break;
    }

    case NetCommandType.SET_SQUAD_OBJECTIVE: {
      const p = cmd.payload as SquadPayload;
      // Handle per-unit objective assignment (new path from setSelectedSquadObjective)
      if (p.unitIds && p.unitIds.length > 0) {
        const objective = p.objective === 'CLEAR' ? null : (p.objective as 'CAPTURE' | 'ASSAULT' | null);
        for (const id of p.unitIds) {
          const unit = game.findUnitById(id);
          if (!unit || unit.owner !== owner) continue;

          if (objective === null) {
            unit._playerObjective = undefined;
            unit._playerObjectiveTarget = undefined;
            unit._squadObjective = undefined;
          } else {
            const marchSpeeds = p.unitIds
              .map((uid: string) => game.findUnitById(uid))
              .filter((u: Unit | undefined): u is Unit => !!u)
              .map((u: Unit) => u.moveSpeed)
              .sort((a: number, b: number) => a - b);
            const p25Idx = Math.max(0, Math.floor(marchSpeeds.length * 0.25));
            const marchSpeed = marchSpeeds[p25Idx] + (marchSpeeds[marchSpeeds.length - 1] - marchSpeeds[p25Idx]) * 0.3;
            const stance = objective === 'CAPTURE' ? UnitStance.DEFENSIVE : UnitStance.AGGRESSIVE;

            unit._playerObjective = objective;
            unit._playerObjectiveTarget = undefined;
            unit._squadObjective = objective;
            unit._squadId = p.squadId ?? 100;
            unit._squadSpeed = marchSpeed;
            unit.stance = stance;
            unit._playerCommanded = true;
          }
        }
      } else if (p.squadId != null && p.objective) {
        // Legacy path: apply to control group by squad ID
        game.setSquadObjective(p.squadId, p.objective, p.target);
      }
      break;
    }

    case NetCommandType.NOP:
      // No-op: keeps tick alive
      break;

    default:
      console.warn(`[CommandBridge] Unknown command type: ${cmd.type}`);
  }
}
