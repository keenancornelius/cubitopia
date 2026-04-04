// ============================================
// CUBITOPIA - Network Protocol
// Phase 5B: Message types, command serialization, state hashing
// ============================================
//
// All game commands are serialized as NetworkCommand and sent
// over the WebRTC DataChannel. Both clients process commands
// in identical order (host first, guest second) to maintain
// deterministic lockstep.
// ============================================

import { HexCoord, CommandType, UnitStance, BuildingKind, UnitType, ElementType } from '../types';

// ============================================
// Message envelope — wraps all P2P communication
// ============================================

export enum MessageType {
  COMMAND = 'command',
  STATE_HASH = 'state_hash',
  PING = 'ping',
  PONG = 'pong',
  SURRENDER = 'surrender',
  CHAT = 'chat',
  READY = 'ready',
  LOAD_COMPLETE = 'load_complete',
}

export interface NetworkMessage {
  type: MessageType;
  payload: unknown;
}

// ============================================
// Network Commands — every player action
// ============================================

export enum NetCommandType {
  // Unit commands (map to existing CommandType)
  MOVE = 'move',
  ATTACK = 'attack',
  ATTACK_MOVE = 'attack_move',
  GATHER = 'gather',
  BUILD = 'build',
  STOP = 'stop',

  // Building commands
  PLACE_BUILDING = 'place_building',
  CANCEL_BUILDING = 'cancel_building',

  // Defense commands
  PLACE_WALL = 'place_wall',
  PLACE_GATE = 'place_gate',

  // Spawn commands
  QUEUE_UNIT = 'queue_unit',
  CANCEL_UNIT = 'cancel_unit',

  // Terrain interaction
  MINE_BLOCK = 'mine_block',
  CHOP_WOOD = 'chop_wood',
  HARVEST_GRASS = 'harvest_grass',

  // Stance / formation
  SET_STANCE = 'set_stance',
  SET_FORMATION = 'set_formation',

  // Squad commands
  CREATE_SQUAD = 'create_squad',
  ASSIGN_SQUAD = 'assign_squad',
  SET_SQUAD_OBJECTIVE = 'set_squad_objective',

  // Rally point
  SET_RALLY_POINT = 'set_rally_point',

  // Mage element lock
  LOCK_ELEMENT = 'lock_element',
  UNLOCK_ELEMENT = 'unlock_element',

  // Healer / focus targeting
  SET_HEAL_TARGET = 'set_heal_target',
  SET_FOCUS_TARGET = 'set_focus_target',

  // Garrison
  GARRISON_UNIT = 'garrison_unit',
  UNGARRISON = 'ungarrison',

  // Resource trading (economy)
  TRADE_RESOURCE = 'trade_resource',
  CRAFT_ITEM = 'craft_item',

  // Game flow
  SURRENDER = 'surrender',

  // No-op (keeps tick alive when player has no action)
  NOP = 'nop',
}

export interface NetworkCommand {
  /** Simulation tick this command should execute on */
  tick: number;
  /** UID of the player who issued this command */
  playerId: string;
  /** Command type */
  type: NetCommandType | string;
  /** Command-specific payload */
  payload: CommandPayload;
}

// ============================================
// Command Payloads — type-safe per command
// ============================================

export type CommandPayload =
  | MovePayload
  | AttackPayload
  | AttackMovePayload
  | GatherPayload
  | BuildPayload
  | StopPayload
  | PlaceBuildingPayload
  | PlaceWallPayload
  | QueueUnitPayload
  | MineBlockPayload
  | SetStancePayload
  | SetFormationPayload
  | SquadPayload
  | SetRallyPointPayload
  | LockElementPayload
  | SetTargetPayload
  | GarrisonPayload
  | TradePayload
  | CraftPayload
  | SurrenderPayload
  | NopPayload
  | Record<string, unknown>;

export interface MovePayload {
  unitIds: string[];
  target: HexCoord;
}

export interface AttackPayload {
  unitIds: string[];
  targetUnitId: string;
}

export interface AttackMovePayload {
  unitIds: string[];
  target: HexCoord;
}

export interface GatherPayload {
  unitIds: string[];
  target: HexCoord;
}

export interface BuildPayload {
  unitIds: string[];
  blueprintId: string;
}

export interface StopPayload {
  unitIds: string[];
}

export interface PlaceBuildingPayload {
  kind: BuildingKind;
  position: HexCoord;
}

export interface PlaceWallPayload {
  positions: HexCoord[];
  isGate?: boolean;
}

export interface QueueUnitPayload {
  unitType: UnitType;
  buildingKind: BuildingKind;
}

export interface MineBlockPayload {
  position: HexCoord;
  blockIndex: number;
}

export interface SetStancePayload {
  unitIds: string[];
  stance: UnitStance;
}

export interface SetFormationPayload {
  unitIds: string[];
  formation: string;
}

export interface SquadPayload {
  unitIds?: string[];
  squadId?: number;
  objective?: string;
  target?: HexCoord;
}

export interface SetRallyPointPayload {
  buildingId: string;
  position: HexCoord;
}

export interface LockElementPayload {
  unitIds: string[];
  element: ElementType | null;
}

export interface SetTargetPayload {
  unitId: string;
  targetUnitId: string | null;
}

export interface GarrisonPayload {
  unitIds: string[];
  buildingPosition?: HexCoord;
}

export interface TradePayload {
  give: string;
  receive: string;
  amount: number;
}

export interface CraftPayload {
  recipe: string;
  amount: number;
}

export interface SurrenderPayload {}

export interface NopPayload {}

// ============================================
// State Hash — desync detection
// ============================================

export interface GameStateHash {
  tick: number;
  hash: number;       // CRC32 of critical game state
  unitCount: number;   // Quick sanity check
  p1Resources: number; // Sum of player 1 resources
  p2Resources: number; // Sum of player 2 resources
}

// ============================================
// State hash computation (CRC32)
// ============================================

// Pre-computed CRC32 lookup table
const CRC32_TABLE: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

export function crc32(str: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Compute a deterministic hash of critical game state.
 * Both clients compute this independently — if hashes differ, desync detected.
 */
export function computeStateHash(
  tick: number,
  units: Array<{ id: string; position: { q: number; r: number }; currentHealth: number; state: string }>,
  p1Resources: Record<string, number>,
  p2Resources: Record<string, number>,
): GameStateHash {
  // Sort units by ID for deterministic ordering
  const sorted = [...units].sort((a, b) => a.id.localeCompare(b.id));

  // Build hash string from critical state
  let stateStr = `t${tick}|`;
  for (const u of sorted) {
    stateStr += `${u.id}:${u.position.q},${u.position.r}:${u.currentHealth}:${u.state}|`;
  }

  const p1Sum = Object.values(p1Resources).reduce((a, b) => a + b, 0);
  const p2Sum = Object.values(p2Resources).reduce((a, b) => a + b, 0);
  stateStr += `r1:${p1Sum}|r2:${p2Sum}`;

  return {
    tick,
    hash: crc32(stateStr),
    unitCount: sorted.length,
    p1Resources: p1Sum,
    p2Resources: p2Sum,
  };
}
