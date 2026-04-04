// ============================================
// CUBITOPIA - Core Type Definitions
// ============================================

import * as THREE from 'three';

// --- Feature Flags ---
/** Set to true to re-enable underground tunnels, lava tubes, and the Desert Tunnels map. */
export const ENABLE_UNDERGROUND = false;

// --- Grid & World Types ---

export interface GridPosition {
  x: number;
  y: number;
  z: number;
}

export interface HexCoord {
  q: number;  // column
  r: number;  // row
}

export interface Tile {
  position: HexCoord;
  terrain: TerrainType;
  elevation: number;
  /** Lowest walkable Y for this tile. Equals elevation for normal tiles.
   *  For tunnel tiles, this is the tunnel floor Y — units walk here instead. */
  walkableFloor: number;
  resource: ResourceType | null;
  improvement: ImprovementType | null;
  unit: Unit | null;
  owner: number | null;  // player ID
  voxelData: VoxelData;
  visible: boolean;
  explored: boolean;
  /** True if this tile has a lava tube tunnel carved through it */
  hasTunnel?: boolean;
  /** Y level of the tunnel floor (only set if hasTunnel) */
  tunnelFloorY?: number;
  /** Y level of the tunnel ceiling (only set if hasTunnel) */
  tunnelCeilingY?: number;
  /** True if this tile is a rainbow bridge (Skyland map) */
  isBridge?: boolean;
}

export interface VoxelData {
  blocks: VoxelBlock[];
  destructible: boolean;
  heightMap: number[][];
}

export interface VoxelBlock {
  localPosition: GridPosition;
  type: BlockType;
  health: number;
  maxHealth: number;
}

// --- Enums ---

export enum TerrainType {
  PLAINS = 'plains',
  FOREST = 'forest',
  MOUNTAIN = 'mountain',
  WATER = 'water',
  DESERT = 'desert',
  SNOW = 'snow',
  JUNGLE = 'jungle',
  RIVER = 'river',
  LAKE = 'lake',
  WATERFALL = 'waterfall',
}

export enum ResourceType {
  FOOD = 'food',
  WOOD = 'wood',
  STONE = 'stone',
  IRON = 'iron',
  GOLD = 'gold',
  CRYSTAL = 'crystal',
  GRASS_FIBER = 'grass_fiber',
  CLAY = 'clay',
  ROPE = 'rope',
  CHARCOAL = 'charcoal',
  STEEL = 'steel',
}

export enum BlockType {
  GRASS = 'grass',
  DIRT = 'dirt',
  STONE = 'stone',
  WATER = 'water',
  SAND = 'sand',
  SNOW = 'snow',
  WOOD = 'wood',
  IRON = 'iron',
  GOLD = 'gold',
  WALL = 'wall',
  JUNGLE = 'jungle',
  CLAY = 'clay',
  CRYSTAL = 'crystal',
  // Gem-infused stone — found only in lava tube tunnel walls
  GEM_RUBY = 'gem_ruby',
  GEM_EMERALD = 'gem_emerald',
  GEM_SAPPHIRE = 'gem_sapphire',
  GEM_AMETHYST = 'gem_amethyst',
  // Skyland-specific blocks
  CLOUD = 'cloud',              // Soft white cloud block (island base filler)
  PASTEL_GRASS = 'pastel_grass', // Soft pastel green surface
  RAINBOW_BRIDGE = 'rainbow_bridge', // Prismatic bridge block
  CREAM_STONE = 'cream_stone',  // Warm cream sub-surface
  // Volcanic-specific blocks
  BASALT = 'basalt',            // Dark volcanic rock (primary surface)
  OBSIDIAN = 'obsidian',        // Glossy black volcanic glass
  ASH = 'ash',                  // Grey volcanic ash surface
  LAVA = 'lava',                // Molten lava (rivers/pools)
  MAGMA = 'magma',              // Dark rock with glowing cracks
  SCORCHED_EARTH = 'scorched_earth', // Burnt reddish-brown terrain
  // Archipelago-specific blocks
  CORAL = 'coral',              // Colourful reef block (shallow water)
  TROPICAL_GRASS = 'tropical_grass', // Vibrant bright green island surface
  PALM_WOOD = 'palm_wood',      // Warm tan palm tree wood
  // Tundra-specific blocks
  ICE = 'ice',                  // Frozen lake/river surface — translucent blue-white
  FROZEN_DIRT = 'frozen_dirt',  // Permafrost ground — grey-brown
  PACKED_SNOW = 'packed_snow',  // Compacted windswept snow surface
  PINE_WOOD = 'pine_wood',      // Dark evergreen pine wood
  // Sunken Ruins blocks
  MOSSY_STONE = 'mossy_stone',       // Green-grey overgrown stone
  ANCIENT_BRICK = 'ancient_brick',   // Weathered tan-brown bricks
  VINE = 'vine',                     // Dark green hanging vines
  RUIN_PILLAR = 'ruin_pillar',       // Pale grey carved stone column
  // Badlands blocks
  RED_CLAY = 'red_clay',             // Deep red-orange clay terrain
  CRACKED_EARTH = 'cracked_earth',   // Dry tan cracked ground
  MESA_STONE = 'mesa_stone',         // Layered orange-red sedimentary rock
  DEAD_WOOD = 'dead_wood',           // Bleached grey-white dead tree wood
}

export enum ImprovementType {
  FARM = 'farm',
  MINE = 'mine',
  LUMBER_MILL = 'lumber_mill',
  ROAD = 'road',
  WALL = 'wall',
  TOWER = 'tower',
}

// --- Units & RTS ---

export interface UnitStats {
  maxHealth: number;
  attack: number;
  defense: number;
  movement: number;
  range: number;
}

export enum UnitState {
  IDLE = 'idle',
  MOVING = 'moving',
  ATTACKING = 'attacking',
  GATHERING = 'gathering',
  BUILDING = 'building',
  CONSTRUCTING = 'constructing',
  RETURNING = 'returning',
  DEAD = 'dead',
}

export enum CommandType {
  MOVE = 'move',
  ATTACK = 'attack',
  GATHER = 'gather',
  BUILD = 'build',
  CONSTRUCT = 'construct',
  PATROL = 'patrol',
  STOP = 'stop',
}

export enum UnitStance {
  PASSIVE = 'passive',       // Never attack — just stand still
  DEFENSIVE = 'defensive',   // Attack if enemy enters weapon range
  AGGRESSIVE = 'aggressive', // Patrol route + auto-attack enemies found
}

export enum FormationType {
  LINE = 'line',
  BOX = 'box',
  WEDGE = 'wedge',
  CIRCLE = 'circle',
}

export interface UnitCommand {
  type: CommandType;
  targetPosition: HexCoord;
  targetUnitId: string | null;
}

export interface Unit {
  id: string;
  type: UnitType;
  owner: number;
  position: HexCoord;
  worldPosition: { x: number; y: number; z: number };
  targetPosition: HexCoord | null;
  command: UnitCommand | null;
  state: UnitState;
  stats: UnitStats;
  currentHealth: number;
  movementLeft: number;
  hasActed: boolean;
  level: number;
  experience: number;
  attackCooldown: number;
  gatherCooldown: number;
  moveSpeed: number;
  attackSpeed: number;
  carryAmount: number;
  carryCapacity: number;
  carryType: ResourceType | null;
  stance: UnitStance;
  isSiege: boolean;

  // Pathfinding state (set at runtime by UnitAI)
  _path?: HexCoord[] | null;
  _pathIndex?: number;
  _postPosition?: HexCoord | null;  // Defensive stance return point
  _patrolRoute?: HexCoord[];
  _patrolIdx?: number;
  _planIsGate?: boolean;            // Builder: planned build is a gate
  _playerCommanded?: boolean;       // Player issued a direct command
  _assignedBlueprintId?: string;    // Builder: player-assigned building blueprint ID (overrides auto-assign)
  _forceMove?: boolean;             // Unit is executing a direct move command — suppress re-aggro until arrival
  _healTarget?: string;             // Healer: manually assigned heal target unit ID
  _focusTarget?: string;            // Combat: manually assigned attack focus target unit ID
  _underground?: boolean;           // Unit is currently underground (on a tunnel tile)
  _undergroundCommand?: boolean;    // Unit was given an underground move command
  _garrisoned?: boolean;            // Unit is inside a structure (hidden)
  _garrisonKey?: string;            // Hex key "q,r" of the structure they're garrisoned in
  _squadId?: number | null;         // Squad assignment — units in same squad march together
  _squadSpeed?: number;             // Effective march speed (slowest unit in squad)
  _squadObjective?: string;         // Squad objective label for HUD display (e.g. "CAPTURE", "ASSAULT")
  _squadJoining?: boolean;          // True while unit is catching up to squad — uses own speed, excluded from centroid
  _tacticalGroupId?: string;        // TacticalGroup assignment — coordinated combat
  _isKiting?: boolean;              // Ranged unit is fleeing from melee threat — don't re-aggro
  _lastRepathTime?: number;         // Game frame of last wall-repath to throttle pathfinding
  _pendingRangedDeath?: boolean;    // Unit killed by ranged attack — defer DEAD state until projectile lands
  _pendingDeathTimestamp?: number;  // Timestamp when _pendingRangedDeath was first detected (for safety cleanup)
  kills: number;                    // Total kills this unit has scored
  element?: ElementType;            // Elemental affinity (mages only — determines projectile/impact visuals)
  _elementCycleIndex?: number;      // Current index in element cycle (0-4, advances after each attack)

  // --- Debuff system ---
  _slowUntil?: number;              // Game frame until which unit is slowed
  _slowFactor?: number;             // Movement speed multiplier while slowed (e.g., 0.4 = 40% speed)

  // --- Elemental status effects (mage combat interactions) ---
  _statusWet?: number;              // Game frame until which unit has Wet status (from Water/Battlemage Water AoE)
  _statusAblaze?: number;           // Game frame until which unit has Ablaze status (from Fire spell, burn tick)
  _ablazeDPS?: number;              // Burn damage per second while Ablaze
  _ablazeSource?: string;           // Unit ID of the mage that applied Ablaze (for kill credit)
  _statusArcane?: number;           // Game frame until which unit has Arcane status (Battlemage Earth AoE — purple orbs)
  _statusHighVoltage?: number;      // Game frame until which unit has High Voltage (Battlemage Lightning AoE — chain cascade on Electrocute hit)
  _knockupUntil?: number;           // Game frame until which unit is knocked up / airborne (Battlemage Wind AoE CC)
  _cleanseLinger?: number;          // Game frame until which unit is immune to status effects (after Healer cleanse)
  _cleanseCooldown?: number;        // Game frame of healer cleanse ability cooldown
  _speedBoostUntil?: number;        // Game frame until which unit has cleanse speed boost
  _speedBoostFactor?: number;       // Speed multiplier during boost (e.g. 1.5 = 50% faster)
  _cycloneCooldown?: number;        // Game frame of battlemage cyclone pull cooldown
  _synergyCooldown?: number;        // Game frame of mage group synergy cooldown

  // --- Movement destination (for stance-based resume after combat) ---
  _moveDestination?: HexCoord;      // Original right-click/A-click destination — used to resume march after combat

  // --- Player squad objective (autonomous behavior like AI commander) ---
  _playerObjective?: 'CAPTURE' | 'ASSAULT'; // If set, unit acts autonomously toward this objective type
  _playerObjectiveTarget?: HexCoord;        // Current target position for the objective

  // --- Attack-move click-point targeting ---
  _attackMoveClickPoint?: HexCoord; // Where the A-click was aimed — findBestTarget biases toward this point

  // --- Spell queue (locked element) ---
  _lockedElement?: ElementType;     // If set, mage/battlemage uses this element instead of cycling

  // --- Berserker axe throw ---
  _axeThrowReady?: boolean;        // true = berserker has ranged axe throw available (range 7, resets to melee after use)
  _axeThrowTargets?: Set<string>;  // Set of target unit IDs already thrown at (once per unique target)
  _chaseBoostUntil?: number;       // Game frame until which berserker has chase speed boost

  // --- Elevation transition state (set by UnitAI, read by renderer for organic movement) ---
  _elevActive?: boolean;           // True while unit is in an elevation transition (Y is changing)
  _elevGoingUp?: boolean;          // True = climbing, False = descending
  _elevProgress?: number;          // 0→1 progress through the elevation transition window
}

export enum UnitType {
  WARRIOR = 'warrior',
  ARCHER = 'archer',
  RIDER = 'rider',
  PALADIN = 'paladin',
  TREBUCHET = 'trebuchet',
  SCOUT = 'scout',
  MAGE = 'mage',
  BUILDER = 'builder',
  LUMBERJACK = 'lumberjack',
  VILLAGER = 'villager',
  // Advanced combat units
  HEALER = 'healer',
  ASSASSIN = 'assassin',
  SHIELDBEARER = 'shieldbearer',
  BERSERKER = 'berserker',
  BATTLEMAGE = 'battlemage',
  GREATSWORD = 'greatsword',
  OGRE = 'ogre',
}

/** Elemental damage types — mage-only for now */
export enum ElementType {
  FIRE = 'fire',
  WATER = 'water',
  LIGHTNING = 'lightning',
  WIND = 'wind',
  EARTH = 'earth',
}

export interface ResourceNode {
  position: HexCoord;
  type: ResourceType;
  amount: number;
  maxAmount: number;
}

// --- Base (Win Condition) ---

export enum BaseTier {
  CAMP = 0,
  FORT = 1,
  CASTLE = 2,
  CITADEL = 3,
}

export interface Base {
  id: string;
  owner: number;
  position: HexCoord;
  worldPosition: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
  destroyed: boolean;
  // --- Base upgrade system ---
  tier: BaseTier;
  ogresSpawned: number;  // How many Ogres this base has granted (max = tier)
}

// --- Players & Cities ---

export interface Player {
  id: number;
  name: string;
  color: THREE.Color;
  cities: City[];
  units: Unit[];
  resources: PlayerResources;
  technology: TechNode[];
  isAI: boolean;
  defeated: boolean;
}

export interface PlayerResources {
  food: number;
  wood: number;
  stone: number;
  iron: number;
  gold: number;
  crystal: number;
  grass_fiber: number;
  clay: number;
  rope: number;
  charcoal: number;
  steel: number;
}

export interface City {
  id: string;
  name: string;
  owner: number;
  position: HexCoord;
  population: number;
  level: number;
  territory: HexCoord[];
  production: number;
  buildings: BuildingType[];
}

export enum BuildingType {
  WORKSHOP = 'workshop',
  BARRACKS = 'barracks',
  TEMPLE = 'temple',
  MARKET = 'market',
  WALLS = 'walls',
  MONUMENT = 'monument',
}

// --- Tech Tree ---

export interface TechNode {
  id: string;
  name: string;
  cost: number;
  unlocks: string[];
  researched: boolean;
  prerequisites: string[];
}

// --- Game State ---

export enum GamePhase {
  MENU = 'menu',
  LOADING = 'loading',
  PLAYING = 'playing',
  GAME_OVER = 'game_over',
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  map: GameMap;
  selectedUnits: Unit[];
  resourceNodes: ResourceNode[];
  gameTime: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Map<string, Tile>;  // key = "q,r"
  seed: number;
  mapType?: MapType;
  /** Underground cavern locations for neutral base placement (any map type) */
  undergroundBases?: Array<{ center: { q: number; r: number }; floorY: number }>;
  /** Surface locations for neutral base placement (desert outposts, mountain forts, etc.) */
  surfaceBases?: Array<{ center: { q: number; r: number }; terrain: string }>;
}

// --- Map Types ---
export enum MapType {
  STANDARD = 'standard',
  ARENA = 'arena',
  SUNKEN_RUINS = 'sunken_ruins',
  ARCHIPELAGO = 'archipelago',
  BADLANDS = 'badlands',
  DESERT_TUNNELS = 'desert_tunnels',
  VOLCANIC = 'volcanic',
  TUNDRA = 'tundra',
  SKYLAND = 'skyland',
}

export interface MapPreset {
  type: MapType;
  label: string;
  description: string;
  size: number;          // hex grid dimension
  color: string;         // menu button accent color
}

// --- Engine Types ---

export interface EngineConfig {
  canvasId: string;
  width: number;
  height: number;
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
}

export interface CameraConfig {
  fov: number;
  near: number;
  far: number;
  minZoom: number;
  maxZoom: number;
  panSpeed: number;
  rotateSpeed: number;
  zoomSpeed: number;
}

// --- Events ---

export interface GameEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export type EventCallback = (event: GameEvent) => void;

// --- Building System Types ---

export type BuildingKind = 'barracks' | 'forestry' | 'masonry' | 'farmhouse' | 'workshop' | 'silo' | 'smelter' | 'armory' | 'wizard_tower';

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  owner: number;
  position: HexCoord;
  worldPosition: { x: number; y: number; z: number };
  mesh: THREE.Group;
  health: number;
  maxHealth: number;
  /** 0..1 — building is a blueprint until constructionProgress reaches 1.0 */
  constructionProgress: number;
  /** true while building is still being constructed by a builder */
  isBlueprint: boolean;
  /** ID of builder currently constructing this building (null if none) */
  assignedBuilderId?: string | null;
}

// --- AI State Types ---

export interface AIBuildState {
  barracks: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  forestry: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  masonry: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  farmhouse: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  workshop: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  silo: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  smelter: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  armory: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  wizard_tower: { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null;
  meshes: THREE.Group[];
  spawnQueue: { type: UnitType; cost: number }[];
  workerSpawnQueue: { type: UnitType; building: string }[];
  spawnTimer: number;
  workerSpawnTimer: number;
  econTimer: number;
  cmdTimer: number;
  autoMarchTimer: number;
  battleStarted: boolean;
  armySize: number;
  waveNumber: number;
  mustering: boolean;
  rallyTimer: number;
  buildPhase: number;
  tacticsTimer: number;
  guardAssignments: Map<string, HexCoord>;
  /** Persistent squad slots (1-4). Each squad persists across objectives. */
  squads: PersistentSquad[];
}

/** A persistent squad slot — stays alive across objectives, absorbs stragglers */
export interface PersistentSquad {
  id: number;               // Squad display number (1–4)
  objective: string;        // CAPTURE, ASSAULT, CHOKE, RALLY, DEFEND
  target: HexCoord | null;  // Current objective position
  stance: UnitStance;
}

/** Max squads per team */
export const MAX_SQUADS_PER_TEAM = 4;

export function createAIBuildState(): AIBuildState {
  return {
    barracks: null, forestry: null, masonry: null, farmhouse: null, workshop: null, silo: null, smelter: null, armory: null, wizard_tower: null,
    meshes: [], spawnQueue: [], workerSpawnQueue: [], spawnTimer: 0, workerSpawnTimer: 0,
    econTimer: -10, cmdTimer: 0, autoMarchTimer: 0, battleStarted: false,
    armySize: 0, waveNumber: 0, mustering: true, rallyTimer: 0, buildPhase: 0,
    tacticsTimer: 0, guardAssignments: new Map(),
    squads: [],
  };
}

// --- Game Context (shared state for all systems) ---

export interface GameContext {
  currentMap: GameMap | null;
  players: Player[];
  allUnits: Unit[];
  bases: Base[];
  scene: THREE.Scene;
  hud: HUD;
  unitRenderer: UnitRenderer;
  selectionManager: SelectionManager;
  terrainDecorator: TerrainDecorator;
  voxelBuilder: VoxelBuilder;

  /** Monotonic game frame counter — use instead of Date.now()/performance.now() in game logic.
   *  Increments once per updateRTS call (~60/s). Convert ms to frames: ms * 60 / 1000 */
  gameFrame: number;

  woodStockpile: number[];
  stoneStockpile: number[];
  foodStockpile: number[];
  grassFiberStockpile: number[];
  clayStockpile: number[];
  ropeStockpile: number[];
  ironStockpile: number[];
  charcoalStockpile: number[];
  steelStockpile: number[];
  crystalStockpile: number[];
  goldStockpile: number[];

  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  getElevation(pos: HexCoord): number;
  isTileOccupied(key: string): boolean;
  findSpawnTile(map: GameMap, q: number, r: number, allowOccupied?: boolean): HexCoord;
  isWaterTerrain(terrain: TerrainType): boolean;
  hasBuilding(kind: BuildingKind, owner: number): boolean;
}

// Forward-declare imported types used in GameContext
import type { HUD } from '../ui/HUD';
import type { UnitRenderer } from '../engine/UnitRenderer';
import type { SelectionManager } from '../game/systems/SelectionManager';
import type { TerrainDecorator } from '../engine/TerrainDecorator';
import type { VoxelBuilder } from '../engine/VoxelBuilder';
