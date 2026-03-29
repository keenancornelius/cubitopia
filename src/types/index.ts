// ============================================
// CUBITOPIA - Core Type Definitions
// ============================================

import * as THREE from 'three';

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
  resource: ResourceType | null;
  improvement: ImprovementType | null;
  unit: Unit | null;
  owner: number | null;  // player ID
  voxelData: VoxelData;
  visible: boolean;
  explored: boolean;
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
  RETURNING = 'returning',
  DEAD = 'dead',
}

export enum CommandType {
  MOVE = 'move',
  ATTACK = 'attack',
  GATHER = 'gather',
  BUILD = 'build',
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
}

export enum UnitType {
  WARRIOR = 'warrior',
  ARCHER = 'archer',
  RIDER = 'rider',
  PALADIN = 'paladin',
  CATAPULT = 'catapult',
  TREBUCHET = 'trebuchet',
  SCOUT = 'scout',
  MAGE = 'mage',
  BUILDER = 'builder',
  LUMBERJACK = 'lumberjack',
  VILLAGER = 'villager',
}

export interface ResourceNode {
  position: HexCoord;
  type: ResourceType;
  amount: number;
  maxAmount: number;
}

// --- Base (Win Condition) ---

export interface Base {
  id: string;
  owner: number;
  position: HexCoord;
  worldPosition: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
  destroyed: boolean;
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
