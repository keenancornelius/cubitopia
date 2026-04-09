// ============================================
// CUBITOPIA - Main Entry Point (RTS Mode)
// A real-time strategy game with voxel worlds
// ============================================

import * as THREE from 'three';
import { Renderer } from './engine/Renderer';
import { StrategyCamera } from './engine/Camera';
import { Logger } from './engine/Logger';
import { VoxelBuilder } from './engine/VoxelBuilder';
import { UnitRenderer } from './engine/UnitRenderer';
import { TileHighlighter } from './engine/TileHighlighter';
import { TerrainDecorator } from './engine/TerrainDecorator';
import { MapGenerator } from './game/MapGenerator';
import MapInitializer, { MapInitOps } from './game/MapInitializer';
import { UnitFactory, resetUnitIdCounter } from './game/entities/UnitFactory';
import { SelectionManager } from './game/systems/SelectionManager';
import { UnitAI } from './game/systems/UnitAI';
import { Pathfinder, tileKey } from './game/systems/Pathfinder';
import { HUD } from './ui/HUD';
import { injectUIThemeCSS, loadSavedSkin, setSkin } from './ui/UITheme';
import { BaseRenderer } from './engine/BaseRenderer';
import { CaptureZoneSystem } from './game/systems/CaptureZoneSystem';
import type { CaptureEvent } from './game/systems/CaptureZoneSystem';
import ResourceManager, { ResourceManagerOps } from './game/systems/ResourceManager';
import { ResourcePool } from './game/ResourcePool';
import BuildingSystem from './game/systems/BuildingSystem';
import WallSystem from './game/systems/WallSystem';
import type { WallSystemOps } from './game/systems/WallSystem';
import AIController from './game/systems/AIController';
import type { AIBuildingOps } from './game/systems/AIController';
import BuildingTooltipController from './game/systems/BuildingTooltipController';
import type { TooltipOps } from './game/systems/BuildingTooltipController';
import BlueprintSystem from './game/systems/BlueprintSystem';
import type { BlueprintOps } from './game/systems/BlueprintSystem';
import { generateFormation, getUnitFormationPriority } from './game/systems/FormationSystem';
import NatureSystem from './game/systems/NatureSystem';
import type { NatureOps } from './game/systems/NatureSystem';
import CombatEventHandler, { CombatEventOps } from './game/systems/CombatEventHandler';
import { CombatSystem } from './game/systems/CombatSystem';
import SpawnQueueSystem, { SpawnQueueOps } from './game/systems/SpawnQueueSystem';
import { BaseUpgradeSystem } from './game/systems/BaseUpgradeSystem';
import { PopulationSystem, FOOD_PER_COMBAT_UNIT, STARTING_FOOD } from './game/systems/PopulationSystem';
import GarrisonSystem, { GarrisonOps } from './game/systems/GarrisonSystem';
import RallyPointSystem, { RallyPointOps } from './game/systems/RallyPointSystem';
import MenuController, { type GameOverStats } from './ui/MenuController';
import DebugController from './game/systems/DebugController';
import SoundManager from './engine/SoundManager';
import { ProceduralMusic, MusicMood } from './engine/ProceduralMusic';
import { TitleScene } from './engine/TitleScene';
import DebugOverlayRenderer from './ui/DebugOverlayRenderer';
import SquadIndicatorSystem from './game/systems/SquadIndicatorSystem';
import LifecycleUpdater from './game/systems/LifecycleUpdater';
import type { DebugOps } from './game/systems/DebugController';
import { TacticalGroupManager } from './game/systems/TacticalGroup';
import { InputManager } from './game/InputManager';
import { InteractionStateMachine, InteractionState, InteractionCallbacks } from './game/InteractionStateMachine';
import { GAME_CONFIG } from './game/GameConfig';
import { hexDist } from './game/HexMath';
import { GameRNG } from './game/SeededRandom';
import { getPlayerColor, getPlayerHex, getPlayerCSS, PLAYER_COLORS, NEUTRAL_OWNER } from './game/PlayerConfig';
import { type TribeId, getTribe } from './game/TribeConfig';
import { MultiplayerController } from './network';
import { MultiplayerUI } from './ui/MultiplayerUI';
import { processCommand, type CommandBridgeGame } from './network/CommandBridge';
import { NetCommandType, type NetworkCommand } from './network/Protocol';
import {
  EngineConfig,
  CameraConfig,
  Player,
  PlayerResources,
  Unit,
  UnitType,
  UnitState,
  HexCoord,
  TerrainType,
  BlockType,
  GameMap,
  Base,
  ResourceType,
  VoxelBlock,
  UnitStance,
  FormationType,
  GameContext,
  PlacedBuilding,
  BuildingKind,
  MapType,
  ElementType,
  BaseTier,
  ENABLE_UNDERGROUND,
} from './types';
import { CombatLog } from './ui/ArenaDebugConsole';
import { DebugPanel } from './ui/DebugPanel';

// --- Configuration ---

const ENGINE_CONFIG: EngineConfig = {
  canvasId: 'game-canvas',
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  antialias: true,
  shadows: true,
};

const CAMERA_CONFIG: CameraConfig = {
  fov: 50,
  near: 0.1,
  far: 1000,
  minZoom: 10,
  maxZoom: 120,
  panSpeed: 1.0,
  rotateSpeed: 1.0,
  zoomSpeed: 1.0,
};

// --- AI Build State is managed by AIController (this.aiController.aiState) ---
// --- Building Registry is managed by BuildingSystem (this.buildingSystem) ---

// --- Game Class ---

class Cubitopia {
  private static readonly UNDERGROUND_DEPTH = ENABLE_UNDERGROUND ? -40 : -10;
  private static readonly MAX_MINE_DEPTH = Cubitopia.UNDERGROUND_DEPTH + 1;

  private renderer: Renderer;
  private camera: StrategyCamera;
  private voxelBuilder: VoxelBuilder;
  private unitRenderer: UnitRenderer;
  private tileHighlighter: TileHighlighter;
  private terrainDecorator: TerrainDecorator;
  // SkyCloudSystem removed — was causing terrain visibility issues
  // Torches removed for performance
  private selectionManager: SelectionManager;
  private hud: HUD;
  private clock: THREE.Clock;

  private currentMap: GameMap | null = null;
  private players: Player[] = [];
  private allUnits: Unit[] = [];
  private bases: Base[] = [];
  private baseRenderer: BaseRenderer;
  private captureZoneSystem!: CaptureZoneSystem;
  private gameOver = false;
  /** Monotonic frame counter — incremented once per updateRTS call (~60/s).
   *  Used by all game systems instead of Date.now()/performance.now() for deterministic timing. */
  private _gameFrame = 0;
  // gameOverOverlay and mainMenuOverlay moved to MenuController
  private gameSpeed = 1;
  private gameMode: 'pvai' | 'aivai' | 'ffa' | '2v2' | 'pvp' = 'pvai';
  /** In multiplayer PvP, which player index (0 or 1) the local client controls */
  _localPlayerIndex: number = 0;
  /** Map seed override for deterministic multiplayer maps (null = random) */
  private _mapSeedOverride: number | null = null;

  /** Convenience: get the local player's index for HUD/resource display */
  private get _lp(): number { return this._localPlayerIndex; }
  private mapType: MapType = MapType.STANDARD;
  private playerTribe: TribeId = 'fantasy';
  private playerCount: number = 2;
  // debugOverlayContainer + debugOverlayLabels moved to DebugOverlayRenderer
  private resourceManager!: ResourceManager;
  private buildingSystem!: BuildingSystem;
  private wallSystem!: WallSystem;
  private aiController!: AIController;
  private tooltipController!: BuildingTooltipController;
  private blueprintSystem!: BlueprintSystem;
  private natureSystem!: NatureSystem;
  private combatEventHandler!: CombatEventHandler;
  private spawnQueueSystem!: SpawnQueueSystem;
  private baseUpgradeSystem!: BaseUpgradeSystem;
  private populationSystem!: PopulationSystem;
  private tacticalGroupManager = new TacticalGroupManager();
  // _tierCheckTimer moved to LifecycleUpdater
  private _popInfoCache: { current: number; cap: number } | undefined;
  private _popInfoTimer = 0;
  private _unitById: Map<string, Unit> | null = null;
  private _enemyResCache: any = null;
  private _ffaEnemyCache: any[] = [];
  private _aggroList: Array<{ attackerId: string; targetId: string }> | null = null;
  /** Accumulated kills from dead units — so team totals don't drop when a unit with kills dies */
  private _deadUnitKills: number[] = [0, 0];
  private _unitStatsPanelTimer = 0;
  private _selInfoTimer = 0;
  private _lastSelectBarkId = '';
  private _spawnQueueHudTimer = 0;
  // Performance stats overlay
  private _perfOverlay: HTMLElement | null = null;
  private _perfVisible = false;
  private _fpsFrames = 0;
  private _fpsTime = 0;
  private _fpsDisplay = 0;
  // _deadCleanupTimer moved to LifecycleUpdater
  private garrisonSystem!: GarrisonSystem;
  /** Per-building squad assignment: building hex key → squad slot (0-4) */
  private buildingSquadAssignment: Map<string, number> = new Map();
  private rallyPointSystem!: RallyPointSystem;
  private menuController!: MenuController;
  private debugController!: DebugController;
  interaction!: InteractionStateMachine;
  private sound: SoundManager;
  private music: ProceduralMusic;
  private titleScene: TitleScene | null = null;
  /** Phase 5B: Multiplayer controller (Firebase + WebRTC + matchmaking) */
  readonly multiplayer = new MultiplayerController();
  private multiplayerUI: MultiplayerUI | null = null;
  /** Opponent display name for multiplayer matches (set by onStartMultiplayerGame) */
  private _multiplayerOpponentName: string = '';
  /** Accumulated delta for multiplayer tick advancement (fixed tick rate) */
  private _mpTickAccumulator = 0;
  // _musicInitialized + _musicIntensityTimer moved into ProceduralMusic.updateFromGameState()
  private _buildingMeshScratch: THREE.Object3D[] | null = null;
  private _baseMeshScratch: THREE.Object3D[] | null = null;
  private debugPanel: DebugPanel;
  private debugOverlay!: DebugOverlayRenderer;
  private squadIndicatorSystem!: SquadIndicatorSystem;
  private lifecycleUpdater!: LifecycleUpdater;
  private mapInitializer!: MapInitializer;

  constructor() {
    injectUIThemeCSS();
    // Apply saved UI skin preference
    const savedSkin = loadSavedSkin();
    if (savedSkin !== 'modern') setSkin(savedSkin);
    this.renderer = new Renderer(ENGINE_CONFIG);
    this.camera = new StrategyCamera(
      CAMERA_CONFIG,
      document.getElementById(ENGINE_CONFIG.canvasId)!
    );
    this.voxelBuilder = new VoxelBuilder(this.renderer.scene);
    this.unitRenderer = new UnitRenderer(this.renderer.scene);
    this.baseRenderer = new BaseRenderer(this.renderer.scene);
    this.captureZoneSystem = new CaptureZoneSystem(this.renderer.scene, this.playerCount);
    this.tileHighlighter = new TileHighlighter(this.renderer.scene);
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);

    const canvas = document.getElementById(ENGINE_CONFIG.canvasId)! as HTMLCanvasElement;
    this.selectionManager = new SelectionManager(canvas, this.camera.camera);
    this.selectionManager.setScene(this.renderer.scene);
    this.hud = new HUD();
    this.clock = new THREE.Clock();
    this.sound = new SoundManager();
    this.captureZoneSystem.setOps({
      playSound: (name, vol) => this.sound.play(name as any, vol),
    });
    this.music = new ProceduralMusic();
    this.debugPanel = new DebugPanel();
    this.debugOverlay = new DebugOverlayRenderer({
      showUnitOverlay: () => this.hud.debugFlags.showUnitOverlay,
      getAllUnits: () => this.allUnits,
      getCamera: () => this.camera.camera,
      getCanvasId: () => ENGINE_CONFIG.canvasId,
    });
    this.squadIndicatorSystem = new SquadIndicatorSystem({
      getAllUnits: () => this.allUnits,
      renderSquadIndicators: (squads, gameTime) => this.unitRenderer.updateSquadIndicators(squads, gameTime),
    });
    this.menuController = new MenuController({
      onStartGame: (mode: 'pvai' | 'aivai' | 'ffa' | '2v2', mapType: MapType, tribeId: TribeId) => {
        this.music.stopTitleMusic();
        this.music.resumeGameplay();
        this._stopTitleScene();
        this.hud.setVisible(true);
        this.gameMode = mode;
        this.mapType = mapType;
        this.playerTribe = tribeId;
        this.startNewGame();
      },
      onPlayAgain: () => this.regenerateMap(),
      onGenreChanged: (genreId) => this.music.setGenre(genreId),
      onMenuShown: () => { this.hud.setVisible(false); this.music.playTitleMusic(); this._startTitleScene(); },
      onMultiplayer: () => {
        this.music.stopTitleMusic();
        this._stopTitleScene();
        this.initMultiplayerUI();
        this.multiplayerUI!.showRegistration();
      },
      onSkinChanged: () => this.hud.refreshTheme(),
    });

    // Tutorial music — plays Tutorial.mp3 while help overlay is open
    this.hud.onHelpOpen(() => this.music.playTutorial());
    this.hud.onHelpClose(() => this.music.stopTutorial());

    this.initSystems();
    this.initDebugController();
    this.lifecycleUpdater = new LifecycleUpdater({
      getPlayers: () => this.players,
      getBases: () => this.bases,
      checkAllUpgrades: (pid) => this.baseUpgradeSystem.checkAllUpgrades(pid),
      rebuildBaseForTier: (base, elev) => this.baseRenderer.rebuildForTier(base, elev),
      getElevation: (pos) => this.getElevation(pos),
      findSpawnTile: (q, r) => this.findSpawnTile(this.currentMap!, q, r),
      hexToWorld: (pos) => this.hexToWorld(pos),
      addUnitToWorld: (unit, elev) => this.unitRenderer.addUnit(unit, elev),
      setPlayerUnits: (units, pid) => this.selectionManager.setPlayerUnits(units, pid),
      playSound: (name, vol) => this.sound.play(name as any, vol),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      getRallyFormationSlot: (key, unit) => this.rallyPointSystem.getRallyFormationSlot(key, unit),
      findExcessUnits: (pid) => this.populationSystem ? this.populationSystem.findExcessUnits(pid) : [],
      getUnitById: (id) => this._unitById?.get(id),
      removeUnitFromGame: (unit) => this.removeUnitFromGame(unit),
      getAllUnits: () => this.allUnits,
      getGameFrame: () => this._gameFrame,
      getLocalPlayerIndex: () => this._localPlayerIndex,
    });

    // Interaction state machine — replaces 26+ boolean mode flags
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    this.interaction = new InteractionStateMachine({
      setHUDMode: (state: InteractionState) => this.syncHUDMode(state),
      resetSlicer: () => {
        this.hud.onSliceChange = (y) => {
          this.voxelBuilder.setSliceY(y);
          this.terrainDecorator.setDecorationClipPlane(y !== null ? this.voxelBuilder.getClipPlane() : null);
        };
        this.commandYLevel = null;
        this.voxelBuilder.setSliceY(null);
        this.terrainDecorator.setDecorationClipPlane(null);
      },
      clearHoverGhost: () => this.blueprintSystem.clearHoverGhost(),
      hideTooltip: () => this.tooltipController.hideTooltip(),
      getCanvas: () => canvasEl,
    });

    // Set up input handling via InputManager
    const inputManager = new InputManager(this, this.hud, this.debugPanel, canvasEl, ENGINE_CONFIG);
    inputManager.setupHandlers();

    this.setupResizeHandler();
  }

  private initDebugController(): void {
    const debugOps: DebugOps = {
      getAllUnits: () => this.allUnits,
      getBases: () => this.bases,
      getPlayers: () => this.players,
      findSpawnTile: (pq, pr, skip) => this.findSpawnTile(this.currentMap!, pq, pr, skip),
      addUnitToWorld: (unit) => {
        this.players[unit.owner].units.push(unit);
        this.allUnits.push(unit);
        this.unitRenderer.addUnit(unit, this.getElevation(unit.position));
        this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);
      },
      removeUnitFromGame: (unit) => this.removeUnitFromGame(unit),
      updateHealthBar: (unit) => this.unitRenderer.updateHealthBar(unit),
      setUnitWorldPosition: (id, x, y, z) => this.unitRenderer.setWorldPosition(id, x, y, z),
      showBaseDestruction: (base) => this.baseRenderer.showDestruction(base),
      updateBaseHealthBars: () => { /* removed — zone capture replaced health bars */ },
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      getSelectedUnits: () => this.selectionManager.getSelectedUnits(),
      getWoodStockpile: () => this.woodStockpile[this._localPlayerIndex],
      setWoodStockpile: (v) => { this.woodStockpile[this._localPlayerIndex] = v; },
      getStoneStockpile: () => this.stoneStockpile[this._localPlayerIndex],
      setStoneStockpile: (v) => { this.stoneStockpile[this._localPlayerIndex] = v; },
      getFoodStockpile: () => this.foodStockpile[this._localPlayerIndex],
      setFoodStockpile: (v) => { this.foodStockpile[this._localPlayerIndex] = v; },
      getGrassFiberStockpile: () => this.grassFiberStockpile[this._localPlayerIndex],
      setGrassFiberStockpile: (v) => { this.grassFiberStockpile[this._localPlayerIndex] = v; },
      getClayStockpile: () => this.clayStockpile[this._localPlayerIndex],
      setClayStockpile: (v) => { this.clayStockpile[this._localPlayerIndex] = v; },
      getRopeStockpile: () => this.ropeStockpile[this._localPlayerIndex],
      setRopeStockpile: (v) => { this.ropeStockpile[this._localPlayerIndex] = v; },
      getIronStockpile: () => this.ironStockpile[this._localPlayerIndex],
      setIronStockpile: (v) => { this.ironStockpile[this._localPlayerIndex] = v; },
      getCharcoalStockpile: () => this.charcoalStockpile[this._localPlayerIndex],
      setCharcoalStockpile: (v) => { this.charcoalStockpile[this._localPlayerIndex] = v; },
      getGoldStockpile: () => this.goldStockpile[this._localPlayerIndex],
      setGoldStockpile: (v) => { this.goldStockpile[this._localPlayerIndex] = v; },
      getSteelStockpile: () => this.steelStockpile[this._localPlayerIndex],
      setSteelStockpile: (v) => { this.steelStockpile[this._localPlayerIndex] = v; },
      getCrystalStockpile: () => this.crystalStockpile[this._localPlayerIndex],
      setCrystalStockpile: (v) => { this.crystalStockpile[this._localPlayerIndex] = v; },
      updateResourceDisplay: () => { const lp = this._localPlayerIndex; this.hud.updateResources(this.players[lp], this.woodStockpile[lp], this.foodStockpile[lp], this.stoneStockpile[lp]); },
      updateStockpileVisual: (owner) => this.resourceManager.updateStockpileVisual(owner),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      getCurrentMapTiles: () => this.currentMap?.tiles ?? null,
      removeDecoration: (pos) => this.terrainDecorator.removeDecoration(pos),
      rebuildVoxels: () => { if (this.currentMap) this.voxelBuilder.rebuildFromMap(this.currentMap); },
      deleteTreeAge: (key) => this.natureSystem.treeAge.delete(key),
      deleteTreeRegrowthTimer: (key) => this.natureSystem.treeRegrowthTimers.delete(key),
      checkWinCondition: () => this.debugCheckWinCondition(),
      getCurrentMap: () => this.currentMap,
      addUnitToRenderer: (unit, elev) => this.unitRenderer.addUnit(unit, elev),
      getFoodForPlayer: (pid) => this.foodStockpile[pid],
      setFoodForPlayer: (pid, v) => { this.foodStockpile[pid] = v; },
      setPlayerFoodResource: (pid, v) => { this.players[pid].resources.food = v; },
      rebuildAllUnits: () => {
        this.allUnits = this.players.flatMap(p => p.units);
        this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);
      },
      getArmyComposition: () => this.debugPanel.getArmyComposition(),
      getPlayerCount: () => this.playerCount,
    };
    this.debugController = new DebugController(debugOps);
  }


  /** Convert mouse event to hex coordinate */
  private mouseToHex(e: MouseEvent, canvasEl: HTMLCanvasElement): HexCoord | null {
    const rect = canvasEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera.camera);
    return this.raycastToHex(raycaster);
  }

  /** Mine mode raycast — hits voxel blocks (respects slicer), falls back to ground plane */
  private mouseToMineHex(e: MouseEvent, canvasEl: HTMLCanvasElement): HexCoord | null {
    const rect = canvasEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera.camera);

    if (!this.currentMap) return this.raycastToHex(raycaster);

    // Raycast against voxel blocks (slicer filtering handled inside raycastBlock)
    const voxelHit = this.voxelBuilder.raycastBlock(raycaster);
    if (voxelHit) {
      const [q, r] = voxelHit.tileKey.split(',').map(Number);
      return { q, r };
    }

    // Fallback to ground-plane raycast
    return this.raycastToHex(raycaster);
  }

  // paintHarvestTile → moved to BlueprintSystem

  // paintFarmPatch → moved to BlueprintSystem

  // Wall/harvest/mine blueprint methods → moved to BlueprintSystem

  /** Adjust mine depth with scroll wheel while in mine mode */
  adjustMineDepth(delta: number): void {
    this.blueprintSystem.adjustMineDepth(delta);
    this.hud.setMineMode(true, this.blueprintSystem.mineDepthLayers);
  }

  // Old horizontal Y indicator removed — replaced by clipping plane slicer

  private toggleMineMode(): void {
    this.interaction.toggle({ kind: 'mine' });
    // Mine mode has extra slicer callback wiring
    if (this.interaction.state.kind === 'mine') {
      this.hud.onSliceChange = (y) => {
        this.voxelBuilder.setSliceY(y);
        this.terrainDecorator.setDecorationClipPlane(y !== null ? this.voxelBuilder.getClipPlane() : null);
        if (y !== null) {
          this.hud.setMineMode(true, this.blueprintSystem.mineDepthLayers, y);
        }
      };
    }
  }

  /** Handle mining terrain — peel off one layer of voxels, yield resources by terrain type */
  /** Map block type → resource type for per-block mining */
  private blockToResource(blockType: BlockType): { type: ResourceType; yield: number } {
    switch (blockType) {
      case BlockType.SNOW:          return { type: ResourceType.STONE,   yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.STONE:         return { type: ResourceType.STONE,   yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.IRON:          return { type: ResourceType.IRON,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.GOLD:          return { type: ResourceType.GOLD,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.SAND:          return { type: ResourceType.CLAY,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.DIRT:          return { type: ResourceType.STONE,   yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.GRASS:         return { type: ResourceType.FOOD,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.WOOD:          return { type: ResourceType.WOOD,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.JUNGLE:        return { type: ResourceType.WOOD,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.CLAY:          return { type: ResourceType.CLAY,    yield: GAME_CONFIG.economy.mining.defaultBlockYield };
      case BlockType.GEM_RUBY:      return { type: ResourceType.CRYSTAL, yield: GAME_CONFIG.economy.mining.crystalYield };
      case BlockType.GEM_EMERALD:   return { type: ResourceType.CRYSTAL, yield: GAME_CONFIG.economy.mining.crystalYield };
      case BlockType.GEM_SAPPHIRE:  return { type: ResourceType.CRYSTAL, yield: GAME_CONFIG.economy.mining.crystalYield };
      case BlockType.GEM_AMETHYST:  return { type: ResourceType.CRYSTAL, yield: GAME_CONFIG.economy.mining.crystalYield };
      default:                      return { type: ResourceType.STONE,   yield: GAME_CONFIG.economy.mining.defaultBlockYield };
    }
  }

  /** Handle a construction tick from a builder working on a blueprint building */
  private handleConstructTick(_unit: Unit, buildingId: string, amount: number): void {
    const pb = this.buildingSystem.placedBuildings.find(b => b.id === buildingId);
    if (!pb || !pb.isBlueprint) return;

    const completed = this.buildingSystem.advanceConstruction(pb, amount);
    if (completed) {
      // Fire the post-placement hooks that were deferred when the blueprint was placed
      const cfg = this.BUILDING_PLACEMENT_CONFIG[pb.kind];
      if (cfg?.unitAIHook) cfg.unitAIHook(pb.position);
      this.hud.showNotification(`${pb.kind} construction complete!`, '#2ecc71');
      Logger.info('Construction', `${pb.kind} at (${pb.position.q},${pb.position.r}) completed for player ${pb.owner}`);
    }
  }

  /** Per-block mining: remove blocks from a tile based on mine mode, yield resources */
  private handleMineTerrain(unit: Unit, minePos: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${minePos.q},${minePos.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile || tile.voxelData.blocks.length === 0) return;

    const BLOCKS_PER_TICK = 9;
    const blocks = tile.voxelData.blocks;

    // Get the mine blueprint — determines the Y range to excavate
    // If no blueprint exists (AI auto-mine), create a temporary one with sensible defaults
    let target = UnitAI.getMineTarget(key);
    if (!target) {
      // AI auto-mine: mine top 3 layers of surface blocks (or tunnel floor blocks if underground)
      const autoDepth = 3;
      let autoStartY: number;
      if (unit._underground && tile.hasTunnel) {
        // Underground: mine from tunnel floor area
        const floorY = tile.tunnelFloorY ?? (tile.walkableFloor ?? tile.elevation);
        autoStartY = floorY + 1; // Just above the walkable floor
      } else {
        autoStartY = tile.elevation - 1; // Surface mining
      }
      target = { startY: autoStartY, depth: autoDepth };
    }

    const bottomY = target.startY - target.depth + 1;

    // Find blocks WITHIN the blueprint's Y range, sorted top-down
    // Miners always work from the highest Y in the range downward
    const inRange = blocks
      .map((b, i) => ({ block: b, index: i }))
      .filter(({ block }) => block.localPosition.y >= bottomY && block.localPosition.y <= target.startY)
      .sort((a, b) => b.block.localPosition.y - a.block.localPosition.y);

    const toRemove = inRange.slice(0, Math.min(BLOCKS_PER_TICK, inRange.length));
    if (toRemove.length === 0) return;

    // Determine resource from the primary block being mined.
    // If block is generic stone but the tile has a specific resource (iron, gold, crystal),
    // use the tile's resource metadata as a fallback — ensures terrain-marked resources yield correctly.
    const primaryBlock = toRemove[0].block;
    let resource = this.blockToResource(primaryBlock.type);
    if (resource.type === ResourceType.STONE && tile.resource && tile.resource !== ResourceType.STONE) {
      // Tile metadata says this is an iron/gold/crystal/clay deposit — honor it
      const tileYield = tile.resource === ResourceType.CRYSTAL
        ? GAME_CONFIG.economy.mining.crystalYield
        : GAME_CONFIG.economy.mining.defaultBlockYield;
      resource = { type: tile.resource, yield: tileYield };
    }

    // Remove blocks from the array
    const indicesToRemove = new Set(toRemove.map(t => t.index));
    tile.voxelData.blocks = blocks.filter((_, i) => !indicesToRemove.has(i));

    // --- Recalculate tile elevation from remaining blocks ---
    if (tile.voxelData.blocks.length === 0) {
      tile.elevation = Cubitopia.MAX_MINE_DEPTH;
    } else {
      let maxY = Cubitopia.MAX_MINE_DEPTH;
      for (const b of tile.voxelData.blocks) {
        if (b.localPosition.y > maxY) maxY = b.localPosition.y;
      }
      tile.elevation = maxY + 1;
    }
    tile.voxelData.heightMap = [[tile.elevation]];
    // Update walkableFloor to match (unless tile has a tunnel with lower floor)
    if (!tile.hasTunnel) {
      tile.walkableFloor = tile.elevation;
    }

    // Terrain transitions as we mine down
    if (tile.elevation <= 3 && tile.terrain !== TerrainType.PLAINS) {
      tile.terrain = TerrainType.PLAINS;
    }
    if (tile.elevation < 13 && tile.terrain === TerrainType.SNOW) {
      tile.terrain = TerrainType.MOUNTAIN;
    }

    // Clean up decorations
    this.terrainDecorator.removeDecoration(minePos);
    this.terrainDecorator.removeGrassClump(key);
    this.natureSystem.grassAge.delete(key);
    this.natureSystem.grassGrowthTimers.delete(key);

    // Add pit wall blocks to neighbors where needed
    this.addNeighborPitWalls(minePos);

    // Check if mine blueprint is complete (no blocks left in range)
    const complete = UnitAI.isMineComplete(key, tile);
    if (complete) {
      UnitAI.playerMineBlueprint.delete(key);
      UnitAI.claimedMines.delete(key);
      this.blueprintSystem.removeMineMarker(minePos);
    } else {
      UnitAI.claimedMines.delete(key);
    }

    // Mark affected chunk dirty (rebuilt lazily in game loop)
    this.voxelBuilder.markTileDirty(key);

    // Load resource onto the worker
    const totalYield = toRemove.length * resource.yield;
    unit.carryAmount = Math.min(totalYield, unit.carryCapacity);
    unit.carryType = resource.type;
  }

  /** Rebuild shell blocks for a single tile using neighbor info */
  private rebuildTileShell(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    const DEPTH = Cubitopia.UNDERGROUND_DEPTH;
    const height = tile.elevation;
    const terrain = height <= 2 ? TerrainType.PLAINS : tile.terrain;
    const topBlock = this.terrainToBlock(terrain);
    const offsets = [-0.5, 0, 0.5];
    const blocks: VoxelBlock[] = [];

    // Find minimum neighbor elevation and check if edge tile
    const neighbors = Pathfinder.getHexNeighbors(coord);
    let minNeighborElev = height;
    let isEdge = false;
    for (const n of neighbors) {
      const nTile = this.currentMap.tiles.get(`${n.q},${n.r}`);
      if (nTile) {
        minNeighborElev = Math.min(minNeighborElev, nTile.elevation);
      } else {
        isEdge = true;
      }
    }

    // Helper: get block type for a given y level (matches generateShellColumn)
    const subBlock = terrain === TerrainType.DESERT ? BlockType.SAND :
      terrain === TerrainType.SNOW ? BlockType.SNOW :
      terrain === TerrainType.MOUNTAIN ? BlockType.STONE : BlockType.DIRT;
    const blockTypeAt = (y: number): BlockType => {
      if (y === height - 1) return topBlock;
      if (y >= height - 2) return subBlock;
      return BlockType.STONE; // all underground = stone
    };

    // SOLID FILL: every Y level from DEPTH to surface (matches generateShellColumn)
    for (const lx of offsets) {
      for (const lz of offsets) {
        for (let y = DEPTH; y < height; y++) {
          blocks.push({ localPosition: { x: lx, y, z: lz }, type: blockTypeAt(y), health: 100, maxHealth: 100 });
        }
      }
    }

    // Ridge/snow blocks are NO LONGER generated here — they are real terrain
    // created during MapGenerator.computeShellBlocks. rebuildTileShell is only
    // called for base-flattening and structural repairs, where ridges should
    // NOT be regenerated (mined ridges stay mined).

    tile.voxelData.blocks = blocks;
  }

  /**
   * Lightweight pit-wall filler for neighbors of a mined tile.
   * Only APPENDS missing wall blocks — never removes or regenerates existing blocks,
   * so ridges, snow caps, and already-mined surfaces stay untouched.
   */
  private addNeighborPitWalls(minedCoord: HexCoord): void {
    if (!this.currentMap) return;
    const minedKey = `${minedCoord.q},${minedCoord.r}`;
    const minedTile = this.currentMap.tiles.get(minedKey);
    if (!minedTile) return;
    const minedElev = minedTile.elevation;
    const DEPTH = Cubitopia.UNDERGROUND_DEPTH;
    const offsets = [-0.5, 0, 0.5];

    const neighbors = Pathfinder.getHexNeighbors(minedCoord);
    for (const n of neighbors) {
      const nKey = `${n.q},${n.r}`;
      const nTile = this.currentMap.tiles.get(nKey);
      if (!nTile) continue;

      const nElev = nTile.elevation;
      // Only care about neighbors taller than the mined tile — they might need pit walls
      if (nElev <= minedElev) continue;

      // With solid terrain, fill any gaps between mined elevation and neighbor surface
      const wallTop = nElev;
      const wallBottom = Math.max(DEPTH, minedElev);
      if (wallBottom >= wallTop) continue;

      // Build a set of existing block positions so we don't duplicate
      const existingPositions = new Set<string>();
      for (const b of nTile.voxelData.blocks) {
        existingPositions.add(`${b.localPosition.x},${b.localPosition.y},${b.localPosition.z}`);
      }

      // Block type helper (simplified — matches rebuildTileShell logic)
      const terrain = nElev <= 2 ? TerrainType.PLAINS : nTile.terrain;
      const nSubBlock = terrain === TerrainType.DESERT ? BlockType.SAND :
        terrain === TerrainType.SNOW ? BlockType.SNOW :
        terrain === TerrainType.MOUNTAIN ? BlockType.STONE : BlockType.DIRT;
      const blockTypeAt = (y: number): BlockType => {
        if (y === nElev - 1) return this.terrainToBlock(terrain);
        if (y >= nElev - 2) return nSubBlock;
        return BlockType.STONE;
      };

      // Append only the missing wall blocks
      let added = false;
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = wallBottom; y < wallTop; y++) {
            const posKey = `${lx},${y},${lz}`;
            if (!existingPositions.has(posKey)) {
              nTile.voxelData.blocks.push({
                localPosition: { x: lx, y, z: lz },
                type: blockTypeAt(y),
                health: 100,
                maxHealth: 100,
              });
              added = true;
            }
          }
        }
      }
      // Mark neighbor chunk dirty if we added pit wall blocks
      if (added) this.voxelBuilder.markTileDirty(nKey);
    }
  }

  private terrainToBlock(terrain: TerrainType): BlockType {
    switch (terrain) {
      case TerrainType.PLAINS: return BlockType.GRASS;
      case TerrainType.FOREST: return BlockType.GRASS;
      case TerrainType.MOUNTAIN: return BlockType.STONE;
      case TerrainType.WATER: return BlockType.WATER;
      case TerrainType.RIVER: return BlockType.SAND;
      case TerrainType.LAKE: return BlockType.SAND;
      case TerrainType.DESERT: return BlockType.SAND;
      case TerrainType.SNOW: return BlockType.SNOW;
      case TerrainType.JUNGLE: return BlockType.JUNGLE;
      default: return BlockType.GRASS;
    }
  }

  private issueCommand(worldPos: THREE.Vector3): void {
    if (!this.currentMap) return;
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) return;

    const hexCoord = this.worldToHex(worldPos);
    if (!hexCoord) return;

    const preferUnderground = this.commandYLevel !== null && this.commandYLevel < 0;
    const enemyAtTarget = this.findEnemyAt(hexCoord, selected[0].owner);
    const friendlyAtTarget = this.findFriendlyAt(hexCoord, selected[0].owner);

    // --- Right-click on ENEMY: focus-target that enemy ---
    if (enemyAtTarget) {
      this.enqueueCommand(NetCommandType.ATTACK, {
        unitIds: selected.map(u => u.id),
        targetUnitId: enemyAtTarget.id,
      });
      this.spawnClickIndicator(worldPos, 0xff2222, 1.0); // Red for attack
      // Speech bubble: first selected unit barks an attack command
      if (selected.length > 0) {
        this.unitRenderer.triggerSpeechBubble(selected[0].id, selected[0].type, 'attack');
      }
      return;
    }

    // --- Right-click on FRIENDLY unit: healer → heal, others → ignore friendly ---
    if (friendlyAtTarget && !selected.includes(friendlyAtTarget)) {
      const healers = selected.filter(u => u.type === UnitType.HEALER);
      if (healers.length > 0) {
        for (const healer of healers) {
          this.enqueueCommand(NetCommandType.SET_HEAL_TARGET, {
            unitId: healer.id,
            targetUnitId: friendlyAtTarget.id,
          });
        }
        this.hud.showNotification(`Healing ${friendlyAtTarget.type}!`, '#2ecc71');
        this.spawnClickIndicator(worldPos, 0x44ff44, 0.8); // Green for heal
        return;
      }
      // Non-healers: fall through to move command (move to that position)
    }

    // Check for enemy/neutral base at click target
    const baseAtTarget = this.findBaseAt(hexCoord, selected[0].owner);
    if (baseAtTarget) {
      this.enqueueCommand(NetCommandType.MOVE, {
        unitIds: selected.map(u => u.id),
        target: baseAtTarget.position,
      });
      // Also set stance to defensive for capture (applied locally for responsiveness,
      // will be re-applied via CommandBridge on both clients)
      this.enqueueCommand(NetCommandType.SET_STANCE, {
        unitIds: selected.map(u => u.id),
        stance: UnitStance.DEFENSIVE,
      });
      this.hud.showNotification(`Capturing zone — hold position!`, '#3498db');
      const baseElev = this.getElevation(baseAtTarget.position, baseAtTarget.id === 'base_neutral');
      this.tileHighlighter.showAttackIndicator(baseAtTarget.position, baseElev);
      return;
    }

    // Check for enemy structure at click target
    const enemyStructure = this.findEnemyStructureAt(hexCoord, selected[0].owner);
    if (enemyStructure) {
      this.enqueueCommand(NetCommandType.ATTACK_MOVE, {
        unitIds: selected.map(u => u.id),
        target: enemyStructure,
      });
      this.hud.showNotification(`Attacking structure!`, '#e74c3c');
      const structElev = this.getElevation(enemyStructure);
      this.tileHighlighter.showAttackIndicator(enemyStructure, structElev);
      return;
    }

    // --- Right-click on BLUEPRINT: assign builders to construct/mine/wall ---
    {
      const builders = selected.filter(u => u.type === UnitType.BUILDER);
      if (builders.length > 0) {
        const hexKey = `${hexCoord.q},${hexCoord.r}`;

        // 1) Building blueprint at target hex (or adjacent hex — click may land on neighbor due to camera angle)
        let blueprint = this.buildingSystem.placedBuildings.find(
          pb => pb.isBlueprint && pb.owner === builders[0].owner
            && pb.position.q === hexCoord.q && pb.position.r === hexCoord.r
        );
        if (!blueprint) {
          // Check adjacent hexes for blueprint (camera perspective can offset click target)
          const neighbors = Pathfinder.getHexNeighbors(hexCoord);
          for (const n of neighbors) {
            blueprint = this.buildingSystem.placedBuildings.find(
              pb => pb.isBlueprint && pb.owner === builders[0].owner
                && pb.position.q === n.q && pb.position.r === n.r
            );
            if (blueprint) break;
          }
        }
        if (blueprint) {
          for (const builder of builders) {
            // Clear any previous assignment on other blueprints
            for (const pb of this.buildingSystem.placedBuildings) {
              if (pb.assignedBuilderId === builder.id) pb.assignedBuilderId = null;
            }
            // Release any mine claims
            UnitAI.releaseMineClaim(builder.id);
            blueprint.assignedBuilderId = builder.id;
            builder._playerCommanded = true;
            builder._assignedBlueprintId = blueprint.id;
            builder._forceMove = false;
            builder.state = UnitState.IDLE; // interrupt current task
            builder.command = null;
          }
          this.enqueueCommand(NetCommandType.MOVE, {
            unitIds: builders.map(b => b.id),
            target: blueprint.position,
          });
          this.hud.showNotification(`Builder assigned to ${blueprint.kind}!`, '#f39c12');
          this.spawnClickIndicator(worldPos, 0xf39c12, 0.8); // Orange for build
          return;
        }

        // 2) Mine blueprint at target hex
        if (UnitAI.playerMineBlueprint.has(hexKey)) {
          for (const builder of builders) {
            UnitAI.releaseMineClaim(builder.id);
            UnitAI.claimedMines.set(hexKey, builder.id);
            builder._playerCommanded = true;
            builder._assignedBlueprintId = undefined; // clear building assignment
            builder._forceMove = false;
            builder.state = UnitState.IDLE;
            builder.command = null;
          }
          this.enqueueCommand(NetCommandType.MOVE, {
            unitIds: builders.map(b => b.id),
            target: hexCoord,
          });
          this.hud.showNotification(`Builder assigned to mine!`, '#f39c12');
          this.spawnClickIndicator(worldPos, 0xf39c12, 0.8);
          return;
        }

        // 3) Wall blueprint at target hex
        if (UnitAI.playerWallBlueprint.has(hexKey) || UnitAI.playerGateBlueprint.has(hexKey)) {
          for (const builder of builders) {
            builder._playerCommanded = true;
            builder._assignedBlueprintId = undefined; // clear building assignment
            builder._forceMove = false;
            builder.state = UnitState.IDLE;
            builder.command = null;
          }
          this.enqueueCommand(NetCommandType.MOVE, {
            unitIds: builders.map(b => b.id),
            target: hexCoord,
          });
          this.hud.showNotification(`Builder assigned to wall!`, '#f39c12');
          this.spawnClickIndicator(worldPos, 0xf39c12, 0.8);
          return;
        }
      }
    }

    // --- Right-click on ground: stance-based movement ---
    // Unit flag setup (_playerCommanded, _forceMove, etc.) is handled by
    // CommandBridge.processCommand() so both clients set identical state.

    if (selected.length === 1) {
      this.enqueueCommand(NetCommandType.MOVE, {
        unitIds: [selected[0].id],
        target: hexCoord,
      });
    } else {
      // Formation layout is computed locally (same map state on both clients)
      // and each unit gets its own MOVE command to the assigned slot.
      const sortedSelected = [...selected].sort((a, b) =>
        getUnitFormationPriority(a) - getUnitFormationPriority(b)
      );
      const formationSlots = generateFormation(hexCoord, sortedSelected.length, this.selectedFormation, this.currentMap!.tiles);
      for (let i = 0; i < sortedSelected.length; i++) {
        const unit = sortedSelected[i];
        const slot = formationSlots[i] || hexCoord;
        this.enqueueCommand(NetCommandType.MOVE, {
          unitIds: [unit.id],
          target: slot,
        });
      }
    }

    // Visual click indicator
    this.spawnClickIndicator(worldPos, 0x4488ff, 0.8); // Blue for move
    // Speech bubble: first selected unit barks a command acknowledgment
    if (selected.length > 0) {
      this.unitRenderer.triggerSpeechBubble(selected[0].id, selected[0].type, 'command');
    }
    // Keep existing movement range flash
    const elev = this.getElevation(hexCoord);
    this.tileHighlighter.showMovementRange([hexCoord], () => elev);
    setTimeout(() => this.tileHighlighter.clearMovementRange(), 500);
  }

  /** Find an enemy or neutral base near the target hex (within 2 tiles for easier clicking) */
  private findBaseAt(coord: HexCoord, playerId: number): Base | null {
    let closest: Base | null = null;
    let closestDist = 3; // within 2 tiles
    for (const base of this.bases) {
      if (base.owner === playerId || base.destroyed) continue;
      const dq = Math.abs(base.position.q - coord.q);
      const dr = Math.abs(base.position.r - coord.r);
      const dist = dq + dr;
      if (dist < closestDist) {
        closestDist = dist;
        closest = base;
      }
    }
    return closest;
  }

  /** Find enemy at or very near the target hex (within 1 tile for easier clicking) */
  private findEnemyAt(coord: HexCoord, playerId: number): Unit | null {
    let closest: Unit | null = null;
    let closestDist = 2; // within 1.5 tiles
    for (const u of this.allUnits) {
      if (u.owner !== playerId && u.state !== UnitState.DEAD) {
        const dq = Math.abs(u.position.q - coord.q);
        const dr = Math.abs(u.position.r - coord.r);
        const dist = dq + dr;
        if (dist < closestDist) {
          closestDist = dist;
          closest = u;
        }
      }
    }
    return closest;
  }

  /** Find a friendly unit at or near the target hex */
  private findFriendlyAt(coord: HexCoord, playerId: number): Unit | null {
    let closest: Unit | null = null;
    let closestDist = 2;
    for (const u of this.allUnits) {
      if (u.owner === playerId && u.state !== UnitState.DEAD) {
        const dq = Math.abs(u.position.q - coord.q);
        const dr = Math.abs(u.position.r - coord.r);
        const dist = dq + dr;
        if (dist < closestDist) {
          closestDist = dist;
          closest = u;
        }
      }
    }
    return closest;
  }

  /** Find an enemy building or wall at/near a hex coordinate */
  private findEnemyStructureAt(coord: HexCoord, playerId: number): HexCoord | null {
    const key = `${coord.q},${coord.r}`;
    // Check exact tile first
    if (UnitAI.wallsBuilt.has(key)) {
      const owner = UnitAI.wallOwners.get(key);
      if (owner !== undefined && owner !== playerId) return coord;
    }
    // Check neighbors (within 1 hex for easier clicking)
    const neighbors = Pathfinder.getHexNeighbors(coord);
    for (const n of neighbors) {
      const nk = `${n.q},${n.r}`;
      if (UnitAI.wallsBuilt.has(nk)) {
        const owner = UnitAI.wallOwners.get(nk);
        if (owner !== undefined && owner !== playerId) return n;
      }
      // Also check buildings
      const pb = this.buildingSystem.getBuildingAt(n);
      if (pb && pb.owner !== playerId) return n;
    }
    // Check building on exact tile
    const pb = this.buildingSystem.getBuildingAt(coord);
    if (pb && pb.owner !== playerId) return coord;
    return null;
  }

  /** Check if a tile is occupied by any structure */
  private isTileOccupied(key: string): boolean {
    if (Pathfinder.blockedTiles.has(key)) return true;
    if (this.wallSystem.wallsBuilt.has(key)) return true;
    if (this.wallSystem.gatesBuilt.has(key)) return true;
    // Check all placed buildings (player + AI)
    for (const pb of this.buildingSystem.placedBuildings) {
      if (`${pb.position.q},${pb.position.r}` === key) return true;
    }
    return false;
  }

  private worldToHex(worldPos: THREE.Vector3): HexCoord | null {
    const q = Math.round(worldPos.x / 1.5);
    const offset = q % 2 === 1 ? 0.75 : 0;
    const r = Math.round((worldPos.z - offset) / 1.5);
    if (this.currentMap?.tiles.has(`${q},${r}`)) {
      return { q, r };
    }
    return null;
  }

  /**
   * Convert a raycaster into a hex coordinate using ground-plane intersection.
   * Uses a two-pass approach: first try a mid-elevation plane for quick lookup,
   * then refine using the tile's actual elevation. No scene raycast needed —
   * this is O(1) instead of O(n) scene children.
   */
  private raycastToHex(raycaster: THREE.Raycaster): HexCoord | null {
    if (!this.currentMap) return null;

    const intersection = new THREE.Vector3();

    // Pass 1: intersect a mid-elevation plane to get approximate hex
    const midPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    raycaster.ray.intersectPlane(midPlane, intersection);
    if (!intersection) return null;

    const approxCoord = this.worldToHex(intersection);
    if (approxCoord) {
      // Pass 2: refine with the tile's actual elevation
      const tileElev = this.getElevation(approxCoord);
      const refinedPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -tileElev);
      raycaster.ray.intersectPlane(refinedPlane, intersection);
      if (intersection) {
        const refinedCoord = this.worldToHex(intersection);
        if (refinedCoord) return refinedCoord;
      }
      // Approximate coord is still valid
      return approxCoord;
    }

    // Fallback: try a range of elevation planes for edge cases (steep terrain, camera angles)
    const elevations = [0, 0.5, 1.5, 2.0, 3.0];
    for (const elev of elevations) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev);
      raycaster.ray.intersectPlane(plane, intersection);
      if (intersection) {
        const coord = this.worldToHex(intersection);
        if (coord) return coord;
      }
    }
    return null;
  }

  private getElevation(coord: HexCoord, underground = false): number {
    if (!this.currentMap) return 1;
    const tile = this.currentMap.tiles.get(`${coord.q},${coord.r}`);
    if (!tile) return 0.5;
    if (underground && tile.hasTunnel) {
      return (tile.walkableFloor ?? tile.tunnelFloorY ?? tile.elevation) * 0.5;
    }
    return tile.elevation * 0.5;
  }

  private hexToWorld(coord: HexCoord, underground = false): { x: number; y: number; z: number } {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const y = this.getElevation(coord, underground) + 0.25;
    return { x, y, z };
  }

  /** Build a live GameContext that always reads current values from `this`.
   *  Uses getter properties so reassigned arrays/objects stay in sync. */
  private buildGameContext(): GameContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get currentMap() { return self.currentMap; },
      get players() { return self.players; },
      get allUnits() { return self.allUnits; },
      get bases() { return self.bases; },
      get scene() { return self.renderer.scene; },
      get hud() { return self.hud; },
      get unitRenderer() { return self.unitRenderer; },
      get selectionManager() { return self.selectionManager; },
      get terrainDecorator() { return self.terrainDecorator; },
      get voxelBuilder() { return self.voxelBuilder; },
      get gameFrame() { return self._gameFrame; },
      get woodStockpile() { return self.woodStockpile; },
      set woodStockpile(v) { self.woodStockpile = v; },
      get stoneStockpile() { return self.stoneStockpile; },
      set stoneStockpile(v) { self.stoneStockpile = v; },
      get foodStockpile() { return self.foodStockpile; },
      set foodStockpile(v) { self.foodStockpile = v; },
      get grassFiberStockpile() { return self.grassFiberStockpile; },
      set grassFiberStockpile(v) { self.grassFiberStockpile = v; },
      get clayStockpile() { return self.clayStockpile; },
      set clayStockpile(v) { self.clayStockpile = v; },
      get ropeStockpile() { return self.ropeStockpile; },
      set ropeStockpile(v) { self.ropeStockpile = v; },
      get ironStockpile() { return self.ironStockpile; },
      set ironStockpile(v) { self.ironStockpile = v; },
      get charcoalStockpile() { return self.charcoalStockpile; },
      set charcoalStockpile(v) { self.charcoalStockpile = v; },
      get steelStockpile() { return self.steelStockpile; },
      set steelStockpile(v) { self.steelStockpile = v; },
      get crystalStockpile() { return self.crystalStockpile; },
      set crystalStockpile(v) { self.crystalStockpile = v; },
      get goldStockpile() { return self.goldStockpile; },
      set goldStockpile(v) { self.goldStockpile = v; },
      hexToWorld: (pos: HexCoord) => this.hexToWorld(pos),
      getElevation: (pos: HexCoord) => this.getElevation(pos),
      isTileOccupied: (key: string) => this.isTileOccupied(key),
      findSpawnTile: (map: GameMap, q: number, r: number, allowOccupied?: boolean) => this.findSpawnTile(map, q, r, allowOccupied),
      isWaterTerrain: (terrain: TerrainType) => this.isWaterTerrain(terrain),
      hasBuilding: (kind: BuildingKind, owner: number) => {
        const building = self.buildingSystem.getFirstBuilding(kind, owner);
        return building !== null;
      },
      get localPlayerIndex() { return self._localPlayerIndex; },
    };
  }

  /** Initialize multiplayer UI (lazy — created on first use) */
  private initMultiplayerUI(): void {
    if (this.multiplayerUI) return;
    this.multiplayerUI = new MultiplayerUI(this.multiplayer, {
      onBackToMenu: () => {
        this.menuController.showMainMenu();
      },
      onStartMultiplayerGame: (mapSeed, mapType, isGhost, opponentName, ghostDifficulty) => {
        // ── Multiplayer game start ──
        // Re-init command queue for multiplayer mode (overrides single-player default).
        // Ghost matches use null network; real matches use the active WebRTC connection.
        const net = isGhost ? null : this.multiplayer.network;
        this.multiplayer.commandQueue.initMultiplayer(net, isGhost);
        this.multiplayer.commandQueue.setCommandProcessor((cmd: NetworkCommand) => {
          processCommand(this._commandBridgeAdapter, cmd);
        });

        this.hud.setVisible(true);
        this.mapType = mapType;
        this._mapSeedOverride = mapSeed; // Wire seed for deterministic maps
        // CRITICAL: Seed the global game RNG so both clients have identical PRNG state.
        // Without this, GameRNG uses Date.now() from module init — different on each client!
        GameRNG.initSeed(mapSeed);
        console.log(`[MP-INIT] GameRNG seeded with ${mapSeed}, RNG state after init: ${GameRNG.getState()}`);
        if (isGhost) {
          // Ghost matches: local player vs AI impersonation
          this.gameMode = 'pvai';
          this._localPlayerIndex = 0;
          UnitAI.state.localPlayerIndex = 0;
        } else {
          // Real PvP: each player controls their own team
          this.gameMode = 'pvp';
          this._localPlayerIndex = this.multiplayer.network.isHost ? 0 : 1;
          UnitAI.state.localPlayerIndex = this._localPlayerIndex;
        }
        this._multiplayerOpponentName = opponentName;
        this.startNewGame();
        console.log(`[MP-INIT] After startNewGame: GameRNG state=${GameRNG.getState()}, isHost=${!isGhost && this.multiplayer.network.isHost}`);
      },
      onReturnToLobby: () => {
        // Reset command queue back to single-player mode for lobby state
        this.multiplayer.commandQueue.initSinglePlayer();
        this.multiplayer.commandQueue.setCommandProcessor((cmd: NetworkCommand) => {
          processCommand(this._commandBridgeAdapter, cmd);
        });
        this._mpTickAccumulator = 0;
        this._multiplayerOpponentName = '';
        this._localPlayerIndex = 0;
        UnitAI.state.localPlayerIndex = 0;
        this.multiplayerUI!.showLobby();
      },
    });

    // ── Multiplayer event listeners ──
    // Handle opponent disconnect and desync events during a match.
    this.multiplayer.setEvents({
      onOpponentDisconnect: () => {
        if (!this.gameOver) {
          this.hud.showNotification('Opponent disconnected — you win!', 'color:#2ecc71;font-weight:bold;');
          this.gameOver = true;
          this.multiplayer.reportMatchResult(true).catch(() => {});
          this.showGameOverScreen('PLAYER', true);
        }
      },
      onOpponentSurrender: () => {
        if (!this.gameOver) {
          this.hud.showNotification('Opponent surrendered — you win!', 'color:#2ecc71;font-weight:bold;');
          this.gameOver = true;
          this.multiplayer.reportMatchResult(true).catch(() => {});
          this.showGameOverScreen('PLAYER', true);
        }
      },
      onDesync: (tick: number) => {
        console.warn(`[MP] Desync detected at tick ${tick}`);
        this.hud.showNotification(`Desync detected (tick ${tick}) — match may be unstable`, 'color:#e74c3c;');
      },
      onError: (msg: string) => {
        console.error('[MP] Error:', msg);
        this.hud.showNotification(`Multiplayer error: ${msg}`, 'color:#e74c3c;');
      },
    });
  }

  /** Rebuild systems after state reset (e.g. regenerateMap) */
  private initSystems(): void {
    const ctx = this.buildGameContext();
    const resourceManagerOps = {
      playSound: (name: string, vol?: number) => this.sound.play(name as any, vol),
    };
    this.resourceManager = new ResourceManager(ctx, resourceManagerOps);

    // BuildingSystem owns registry, mesh builders, and queries
    this.buildingSystem = new BuildingSystem(ctx);
    // WallSystem owns wall/gate state, mesh management, and damage
    const wallOps: WallSystemOps = {
      isTileOccupied: (key) => this.isTileOccupied(key),
      isStockpileLocation: (pos) => {
        for (const [sKey] of this.resourceManager.stockpileMeshes) {
          const base = this.bases.find(b => b.owner === (sKey.includes('0') ? 0 : 1));
          if (base) {
            const stockQ = base.position.q + (base.owner % 2 === 0 ? -2 : 2);
            const stockR = base.position.r;
            if (pos.q === stockQ && Math.abs(pos.r - stockR) <= 1) return true;
          }
        }
        return false;
      },
      removeBlueprintGhost: (coord) => this.blueprintSystem.removeBlueprintGhost(coord),
      rebuildTileShell: (coord) => this.rebuildTileShell(coord),
      rebuildVoxels: () => { if (this.currentMap) this.voxelBuilder.rebuildFromMap(this.currentMap); },
      updateResourceDisplay: (owner) => {
        if (owner === this._localPlayerIndex) {
          this.hud.updateResources(this.players[this._lp], this.woodStockpile[this._lp], this.foodStockpile[this._lp], this.stoneStockpile[this._lp]);
        }
      },
      updateStockpileVisual: (owner) => this.resourceManager.updateStockpileVisual(owner),
      getWallConnectable: () => this.buildingSystem.wallConnectable,
      getBuildingAt: (pos) => this.buildingSystem.getBuildingAt(pos),
      unregisterBuilding: (pb) => this.buildingSystem.unregisterBuilding(pb),
      playSound: (name, vol) => this.sound.play(name as any, vol),
    };
    this.wallSystem = new WallSystem(ctx, wallOps);

    // Wire BuildingSystem wall refs to WallSystem
    this.buildingSystem.setWallRefs(
      this.wallSystem.wallsBuilt, this.wallSystem.wallOwners,
      (pos, owner) => this.wallSystem.buildAdaptiveWallMesh(pos, owner),
    );

    // AI building operations delegate to BuildingSystem
    const buildOps: AIBuildingOps = {
      aiFindBuildTile: (bq, br, oq, or_) => this.buildingSystem.aiFindBuildTile(bq, br, oq, or_),
      buildForestryMesh: (pos, owner) => this.buildingSystem.buildForestryMesh(pos, owner),
      buildBarracksMesh: (pos, owner) => this.buildingSystem.buildBarracksMesh(pos, owner),
      buildMasonryMesh: (pos, owner) => this.buildingSystem.buildMasonryMesh(pos, owner),
      buildFarmhouseMesh: (pos, owner) => this.buildingSystem.buildFarmhouseMesh(pos, owner),
      buildWorkshopMesh: (pos, owner) => this.buildingSystem.buildWorkshopMesh(pos, owner),
      buildSiloMesh: (pos, owner) => this.buildingSystem.buildSiloMesh(pos, owner),
      buildSmelterMesh: (pos, owner) => this.buildingSystem.buildSmelterMesh(pos, owner),
      buildArmoryMesh: (pos, owner) => this.buildingSystem.buildArmoryMesh(pos, owner),
      buildWizardTowerMesh: (pos, owner) => this.buildingSystem.buildWizardTowerMesh(pos, owner),
      registerBuilding: (kind, owner, pos, mesh, maxHealth?) => this.buildingSystem.registerBuilding(kind, owner, pos, mesh, maxHealth, false),
    };
    this.aiController = new AIController(ctx, buildOps);

    // Tooltip controller handles building click UI, demolish, and unit queuing
    const tooltipOps: TooltipOps = {
      enterRallyPointMode: (key) => this.enterRallyPointModeForBuilding(key),
      demolishBuilding: (pb) => this.demolishBuilding(pb),
      queueUnit: (unitType, buildingKind) => {
        this.enqueueCommand(NetCommandType.QUEUE_UNIT, { unitType, buildingKind });
      },
      getBuildingQueueOptions: (kind) => this.buildingSystem.getBuildingQueueOptions(kind),
      captureZone: (position) => this.captureZoneFromTooltip(position),
      attackTarget: (position) => this.attackTargetFromTooltip(position),
      focusAttackUnit: (unitId, position) => this.focusAttackUnitFromTooltip(unitId, position),
      setRallyToPosition: (position) => this.setRallyToPositionFromTooltip(position),
      getGarrisonInfo: (structureKey) => {
        // Use network-wide pooling for gates (shows all garrisoned units
        // across every connected gate/building in the wall network)
        const netInfo = this.garrisonSystem.getNetworkInfo(structureKey);
        if (netInfo.totalCapacity === 0 && netInfo.current === 0) return null;
        return {
          units: netInfo.units,
          current: netInfo.current,
          max: netInfo.totalCapacity,
          reachableExits: netInfo.reachableExits,
          structureCount: netInfo.structureCount,
        };
      },
      ungarrisonStructure: (structureKey, exitKey?) => {
        const released = this.garrisonSystem.ungarrisonNetwork(structureKey, exitKey);
        if (released.length > 0) {
          this.hud.showNotification(`🏰 ${released.length} unit(s) ungarrisoned`, '#e67e22');
        }
      },
      garrisonSelected: (structureKey) => {
        const selected = this.selectionManager.getSelectedUnits();
        if (selected.length === 0) {
          this.hud.showNotification('Select units first', '#e74c3c');
          return;
        }
        const garrisoned = this.garrisonSystem.garrison(selected, structureKey);
        if (garrisoned.length > 0) {
          this.hud.showNotification(`🏰 ${garrisoned.length} unit(s) garrisoned`, '#e67e22');
          this.selectionManager.clearSelection();
        } else {
          this.hud.showNotification('Cannot garrison — full or wrong owner', '#e74c3c');
        }
      },
      enterExitPickMode: (structureKey) => {
        this.interaction.enter({ kind: 'exit_pick', sourceKey: structureKey });
        this.hud.showNotification('Click a connected building or gate to choose exit point', '#8e44ad');
      },
      ungarrisonFiltered: (structureKey, unitTypes, exitKey?) => {
        const released = this.garrisonSystem.ungarrisonNetworkFiltered(structureKey, unitTypes, exitKey);
        if (released.length > 0) {
          const typeStr = Array.from(new Set(released.map(u => u.type))).join(', ');
          this.hud.showNotification(`🏰 ${released.length} ${typeStr} ungarrisoned`, '#e67e22');
        }
      },
      demolishWall: (coord) => {
        const key = `${coord.q},${coord.r}`;
        if (!this.wallSystem.wallsBuilt.has(key)) return;
        const lp = this._localPlayerIndex;
        this.garrisonSystem.onStructureDestroyed(key);
        const refund = GAME_CONFIG.defenses.wall.cost.stone;
        this.stoneStockpile[lp] += refund;
        this.players[lp].resources.stone += refund;
        this.wallSystem.damageWall(coord, 9999);
        this.garrisonSystem.markNetworkDirty();
        this.sound.play('wall_destroy', 0.4);
        this.hud.showNotification(`Wall demolished (+${refund} stone)`, '#c0392b');
        this.hud.updateResources(this.players[lp], this.woodStockpile[lp], this.foodStockpile[lp], this.stoneStockpile[lp]);
      },
      demolishGate: (coord) => {
        const key = `${coord.q},${coord.r}`;
        if (!this.wallSystem.gatesBuilt.has(key)) return;
        const lp = this._localPlayerIndex;
        const ejected = this.garrisonSystem.onStructureDestroyed(key);
        if (ejected.length > 0) {
          this.hud.showNotification(`${ejected.length} unit(s) ejected from gate`, '#e67e22');
        }
        const refund = GAME_CONFIG.defenses.gate.cost.stone;
        this.stoneStockpile[lp] += refund;
        this.players[lp].resources.stone += refund;
        this.wallSystem.damageGate(coord, 9999);
        this.garrisonSystem.markNetworkDirty();
        this.hud.showNotification(`Gate demolished (+${refund} stone)`, '#c0392b');
        this.hud.updateResources(this.players[lp], this.woodStockpile[lp], this.foodStockpile[lp], this.stoneStockpile[lp]);
      },
      getScene: () => this.renderer.scene,
      setUnitStance: (unitId, stance) => {
        const unit = this.allUnits.find(u => u.id === unitId);
        if (unit) {
          unit.stance = stance;
          const label = stance === UnitStance.PASSIVE ? 'Passive' :
                        stance === UnitStance.DEFENSIVE ? 'Defensive' : 'Aggressive';
          this.hud.showNotification(`${unit.type} → ${label}`, '#3498db');
        }
      },
      killUnit: (unitId) => {
        const unit = this.allUnits.find(u => u.id === unitId);
        if (unit) {
          unit.state = UnitState.DEAD;
          unit.currentHealth = 0;
          this.removeUnitFromGame(unit);
          this.hud.showNotification(`Killed ${unit.type}`, '#8e44ad');
        }
      },
      // ── Squad assignment ops ──
      getSquadSlots: () => {
        const SQUAD_LABELS = ['A', 'S', 'D', 'F', 'G'];
        const result = new Map<number, { label: string; unitCount: number }>();
        for (let slot = 0; slot < 5; slot++) {
          if (this.selectionManager.hasControlGroup(slot)) {
            // Count living units in this squad
            const units = this.allUnits.filter(u =>
              u.owner === this._localPlayerIndex && u._squadId === slot && u.currentHealth > 0
            );
            result.set(slot, {
              label: SQUAD_LABELS[slot],
              unitCount: units.length,
            });
          }
        }
        return result;
      },
      getBuildingSquadAssignment: (buildingHexKey) => {
        return this.buildingSquadAssignment.get(buildingHexKey) ?? null;
      },
      assignBuildingToSquad: (buildingHexKey, squadSlot) => {
        if (squadSlot == null) {
          this.buildingSquadAssignment.delete(buildingHexKey);
          this.hud.showNotification('Squad assignment cleared', '#888');
        } else {
          this.buildingSquadAssignment.set(buildingHexKey, squadSlot);
          const label = ['A', 'S', 'D', 'F', 'G'][squadSlot] ?? `${squadSlot}`;
          this.hud.showNotification(`Building → Squad ${label}`, '#4fc3f7');
        }
      },
      createSquadForBuilding: (buildingHexKey) => {
        // Find the first unused squad slot (0-4)
        for (let slot = 0; slot < 5; slot++) {
          if (!this.selectionManager.hasControlGroup(slot)) {
            // Create an empty control group — it'll be populated as units spawn
            this.selectionManager.assignControlGroup(slot, [], false);
            this.buildingSquadAssignment.set(buildingHexKey, slot);
            const label = ['A', 'S', 'D', 'F', 'G'][slot];
            this.hud.showNotification(`Squad ${label} created — building assigned`, '#4fc3f7');
            return slot;
          }
        }
        this.hud.showNotification('All 5 squad slots are in use!', '#e74c3c');
        return null;
      },
      getSquadCentroid: (squadSlot: number) => {
        // Find all player-0 units in this squad and compute centroid
        const units = this.allUnits.filter((u: Unit) => u.owner === this._localPlayerIndex && u._squadId === squadSlot && (u.state as string) !== 'dead');
        if (units.length === 0) return null;
        let cx = 0, cy = 0, cz = 0;
        for (const u of units) { cx += u.worldPosition.x; cy += u.worldPosition.y; cz += u.worldPosition.z; }
        return { x: cx / units.length, y: cy / units.length, z: cz / units.length };
      },
      rallyBuildingToSquad: (buildingHexKey: string, buildingKind: string, squadSlot: number) => {
        const centroid = tooltipOps.getSquadCentroid(squadSlot);
        if (!centroid) {
          this.hud.showNotification('Squad has no units to rally to!', '#e74c3c');
          return;
        }
        // Convert world position to nearest hex for rally point
        const q = Math.round(centroid.x / 1.5);
        const zOffset = (q % 2 === 1) ? 0.75 : 0;
        const r = Math.round((centroid.z - zOffset) / 1.5);
        this.enqueueCommand(NetCommandType.SET_RALLY_POINT, { buildingId: buildingKind, position: { q, r } });
        const label = ['A', 'S', 'D', 'F', 'G'][squadSlot] ?? `${squadSlot}`;
        this.hud.showNotification(`Rally set to Squad ${label} position`, '#2ecc71');
      },
    };
    this.tooltipController = new BuildingTooltipController(ctx, tooltipOps);

    // Blueprint system manages all visual markers (wall ghosts, harvest, mine, farm patches)
    const blueprintOps: BlueprintOps = {
      isTileOccupied: (key) => this.isTileOccupied(key),
      isWaterTerrain: (terrain) => this.isWaterTerrain(terrain),
      getGrassAge: (key) => this.natureSystem.getGrassAge(key),
    };
    this.blueprintSystem = new BlueprintSystem(ctx, blueprintOps);

    // Nature system — tree regrowth/sprouting and grass growth/spreading
    const natureOps: NatureOps = {
      getMap: () => this.currentMap,
      removeDecoration: (pos) => this.terrainDecorator.removeDecoration(pos),
      addTreeAtStage: (pos, baseY, stage) => this.terrainDecorator.addTreeAtStage(pos, baseY, stage),
      removeGrassClump: (key) => this.terrainDecorator.removeGrassClump(key),
      addGrassAtStage: (pos, baseY, stage) => this.terrainDecorator.addGrassAtStage(pos, baseY, stage),
      hasGrass: (key) => this.terrainDecorator.hasGrass(key),
      getForestryBuildings: () => {
        return this.buildingSystem.placedBuildings
          .filter(pb => pb.kind === 'forestry' && !pb.isBlueprint)
          .map(pb => ({ q: pb.position.q, r: pb.position.r, owner: pb.owner }));
      },
      updateCropVisual: (key, stage) => {
        this.terrainDecorator.updateCropVisual(key, stage);
        this.blueprintSystem.updateCropVisual(key, stage);
      },
      addWoodToStockpile: (owner, amount) => {
        this.woodStockpile[owner] = (this.woodStockpile[owner] ?? 0) + amount;
        if (this.players[owner]) {
          this.players[owner].resources.wood += amount;
        }
        this.resourceManager.updateStockpileVisual(owner);
        if (owner === this._localPlayerIndex) {
          this.hud.updateResources(this.players[this._localPlayerIndex], this.woodStockpile[this._localPlayerIndex], this.foodStockpile[this._localPlayerIndex], this.stoneStockpile[this._localPlayerIndex]);
        }
      },
    };
    this.natureSystem = new NatureSystem(natureOps);

    // Garrison system — handles unit garrisoning in buildings, gates, walls
    const garrisonOps: GarrisonOps = {
      getBuildingAt: (pos) => this.buildingSystem.getBuildingAt(pos),
      getWallsBuilt: () => this.wallSystem.wallsBuilt,
      getGatesBuilt: () => this.wallSystem.gatesBuilt,
      getWallOwner: (key) => this.wallSystem.wallOwners.get(key) ?? -1,
      getGateOwner: (key) => this.wallSystem.gateOwners.get(key) ?? -1,
      hideUnit: (unit) => this.unitRenderer.setVisible(unit.id, false),
      showUnit: (unit) => {
        this.unitRenderer.setVisible(unit.id, true);
        this.unitRenderer.setWorldPosition(unit.id, unit.worldPosition.x, unit.worldPosition.y, unit.worldPosition.z);
      },
      fireArrow: (from, to, id, cb) => this.unitRenderer.fireArrow(from, to, id, cb),
      fireArrowVolley: (from, to, count, cb) => this.unitRenderer.fireArrowVolley(from, to, count, cb),
      fireCannonball: (from, to, cb) => this.unitRenderer.fireCannonball(from, to, cb),
      applyDamage: (target, damage) => {
        target.currentHealth = Math.max(0, target.currentHealth - damage);
        if (target.currentHealth <= 0) {
          target.state = UnitState.DEAD;
          this.removeUnitFromGame(target);
        }
      },
      updateHealthBar: (unit) => this.unitRenderer.updateHealthBar(unit),
      hexToWorld: (pos) => this.hexToWorld(pos),
      getAllUnits: () => this.allUnits,
      getElevation: (pos) => this.getElevation(pos),
      addCannonTurret: (key, pos, color) => this.unitRenderer.addCannonTurret(key, pos, color),
      removeCannonTurret: (key) => this.unitRenderer.removeCannonTurret(key),
      setCannonTarget: (key, pos) => this.unitRenderer.setCannonTarget(key, pos),
      playSound: (name, vol) => this.sound.play(name as any, vol),
    };
    this.garrisonSystem = new GarrisonSystem(garrisonOps);

    // Rally point system
    const rallyPointOps: RallyPointOps = {
      addToScene: (mesh) => this.renderer.scene.add(mesh),
      removeFromScene: (mesh) => this.renderer.scene.remove(mesh),
      getFirstBuilding: (kind, owner) => this.buildingSystem.getFirstBuilding(kind, owner),
      getPlacedBuildings: () => this.buildingSystem.placedBuildings,
      getBasePosition: (owner) => this.bases[owner]?.position ?? null,
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      getCurrentMap: () => this.currentMap,
      getPlayerUnits: (owner) => this.players[owner].units,
      getLocalPlayerIndex: () => this._localPlayerIndex,
    };
    this.rallyPointSystem = new RallyPointSystem(rallyPointOps);

    // Wire AI garrison ops (after both systems exist)
    this.aiController.setGarrisonOps({
      garrison: (units, key) => this.garrisonSystem.garrison(units, key),
      getCapacity: (key) => this.garrisonSystem.getCapacity(key),
      getGarrisonedUnits: (owner) => this.garrisonSystem.getGarrisonedUnits(owner),
      getGatesBuilt: () => this.wallSystem.gatesBuilt,
      getGateOwner: (key) => this.wallSystem.gateOwners.get(key) ?? -1,
    });

    // Wire tactical group manager to AI controller
    this.aiController.setTacticalGroupManager(this.tacticalGroupManager);

    // Ensure AI has state entries for all players
    this.aiController.ensurePlayerCount(this.playerCount);

    // Combat event handler
    this.combatEventHandler = new CombatEventHandler({
      getPlayers: () => this.players,
      getAllUnits: () => this.allUnits,
      getLocalPlayerIndex: () => this._localPlayerIndex,
      getDebugFlags: () => this.hud.debugFlags,
      getWoodStockpile: () => this.woodStockpile,
      getFoodStockpile: () => this.foodStockpile,
      getStoneStockpile: () => this.stoneStockpile,
      getGoldStockpile: () => this.goldStockpile,
      removeUnitFromGame: (unit, killer) => this.removeUnitFromGame(unit, killer),
      updateHealthBar: (unit) => this.unitRenderer.updateHealthBar(unit),
      showDamageEffect: (wp) => this.unitRenderer.showDamageEffect(wp),
      flashUnit: (id, dur) => this.unitRenderer.flashUnit(id, dur),
      queueDeferredEffect: (delay, cb) => this.unitRenderer.queueDeferredEffect(delay, cb),
      resetAttackAnim: (id) => this.unitRenderer.resetAttackAnim(id),
      fireArrow: (from, to, id, cb) => this.unitRenderer.fireArrow(from, to, id, cb),
      fireDeflectedArrow: (from, to, id, cb) => this.unitRenderer.fireDeflectedArrow(from, to, id, cb),
      fireMagicOrb: (from, to, color, id, splash, cb) => this.unitRenderer.fireMagicOrb(from, to, color, id, splash, cb),
      fireLightningBolt: (from, to, id, cb) => this.unitRenderer.fireLightningBolt(from, to, id, cb),
      fireLightningChain: (from, to, id) => this.unitRenderer.fireLightningChain(from, to, id),
      fireKamehamehaBeam: (from, to, piercedPositions) => this.unitRenderer.fireKamehamehaBeam(from, to, piercedPositions),
      spawnElectrocuteEffect: (id) => this.unitRenderer.spawnElectrocuteEffect(id),
      fireFlamethrower: (from, to, id, cb) => this.unitRenderer.fireFlamethrower(from, to, id, cb),
      fireStoneColumn: (from, to, id, cb) => this.unitRenderer.fireStoneColumn(from, to, id, cb),
      fireWaterWave: (from, to, id, cb) => this.unitRenderer.fireWaterWave(from, to, id, cb),
      fireWindTornado: (from, to, id, cb) => this.unitRenderer.fireWindTornado(from, to, id, cb),
      fireBoulder: (from, to, cb) => this.unitRenderer.fireBoulder(from, to, cb),
      fireProjectile: (from, to, color, id, cb) => this.unitRenderer.fireProjectile(from, to, color, id, cb),
      knockbackUnit: (id, wp) => this.unitRenderer.knockbackUnit(id, wp),
      spawnBlockSparks: (wp) => this.unitRenderer.spawnBlockSparks(wp),
      spawnElementalImpact: (wp, element) => this.unitRenderer.spawnElementalImpact(wp, element),
      getElementOrbColor: (element) => UnitRenderer.elementOrbColor(element),
      fireAxeThrow: (from, to, id, cb) => this.unitRenderer.fireAxeThrow(from, to, id, cb),
      spawnDeflectedAxe: (pos) => this.unitRenderer.spawnDeflectedAxe(pos),
      spawnOgreGroundPound: (pos) => this.unitRenderer.spawnOgreGroundPound(pos),
      fireHealOrb: (from, to, id, cb) => this.unitRenderer.fireHealOrb(from, to, id, cb),
      applyHeal: (healerId, targetId) => {
        const healer = this.players.flatMap(p => p.units).find(u => u.id === healerId);
        const target = this.players.flatMap(p => p.units).find(u => u.id === targetId);
        if (healer && target) {
          CombatSystem.applyHeal(healer, target);
          this.unitRenderer.updateHealthBar(target);
        }
      },
      showXPText: (wp, xp) => this.unitRenderer.showXPText(wp, xp),
      showCritText: (wp, combo, dmg, color) => this.unitRenderer.showCritText(wp, combo, dmg, color),
      showLevelUpEffect: (id, wp, lvl) => this.unitRenderer.showLevelUpEffect(id, wp, lvl),
      applyBleedTint: (id, hp) => this.unitRenderer.applyBleedTint(id, hp),
      spawnGreatswordSpin: (wp) => this.unitRenderer.spawnGreatswordSpin(wp),
      spawnJumpAttackImpact: (wp) => this.unitRenderer.spawnJumpAttackImpact(wp),
      animateJumpAttack: (id) => this.unitRenderer.animateJumpAttack(id),
      spawnPaladinChargeField: (id) => this.unitRenderer.spawnPaladinChargeField(id),
      spawnPaladinImpactBurst: (wp) => this.unitRenderer.spawnPaladinImpactBurst(wp),
      applyLevelUpVisuals: (id, lvl) => this.unitRenderer.applyLevelUpVisuals(id, lvl),
      playSound: (name, vol) => this.sound.play(name as any, vol),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      updateResources: (player, w, f, s) => this.hud.updateResources(player, w, f, s),
      hexToWorld: (pos, underground) => this.hexToWorld(pos, underground),
      getBuildingAt: (pos) => this.buildingSystem.getBuildingAt(pos),
      damageBarracks: (pos, dmg) => this.wallSystem.damageBarracks(pos, dmg),
      damageGate: (pos, dmg) => this.wallSystem.damageGate(pos, dmg),
      damageWall: (pos, dmg) => {
        const destroyed = this.wallSystem.damageWall(pos, dmg);
        if (destroyed) this.sound.play('wall_destroy', 0.5);
        return destroyed;
      },
      isGateAt: (key) => this.wallSystem.gatesBuilt.has(key),
      onStructureDestroyed: (key) => this.garrisonSystem.onStructureDestroyed(key),
      handleBuildWall: (unit, pos) => { this.wallSystem.handleBuildWall(unit, pos); this.garrisonSystem.markNetworkDirty(); if (unit.owner === this._localPlayerIndex) this.sound.play('wall_build', 0.4); },
      handleBuildGate: (unit, pos) => { this.wallSystem.handleBuildGate(unit, pos); this.garrisonSystem.markNetworkDirty(); if (unit.owner === this._localPlayerIndex) this.sound.play('wall_build', 0.3); },
      handleChopWood: (unit, pos) => this.handleChopWood(unit, pos),
      handleWoodDeposit: (unit) => this.resourceManager.handleWoodDeposit(unit),
      handleMineTerrain: (unit, pos) => this.handleMineTerrain(unit, pos),
      handleStoneDeposit: (unit) => this.resourceManager.handleStoneDeposit(unit),
      handleClayDeposit: (unit) => this.resourceManager.handleClayDeposit(unit),
      handleGrassFiberDeposit: (unit) => this.resourceManager.handleGrassFiberDeposit(unit),
      handleIronDeposit: (unit) => this.resourceManager.handleIronDeposit(unit),
      handleCrystalDeposit: (unit) => this.resourceManager.handleCrystalDeposit(unit),
      handleGoldDeposit: (unit) => this.resourceManager.handleGoldDeposit(unit),
      handleCropHarvest: (unit, pos) => this.resourceManager.handleCropHarvest(unit, pos),
      handleHarvestGrass: (unit, pos) => this.handleHarvestGrass(unit, pos),
      handleFoodDeposit: (unit) => this.resourceManager.handleFoodDeposit(unit),
      isPlayerGateBlueprint: (key) => UnitAI.playerGateBlueprint.has(key),
      handleConstructTick: (unit, buildingId, amount) => this.handleConstructTick(unit, buildingId, amount),
      // Trade routes
      getBases: () => this.bases,
      getPrimaryBasePosition: (owner) => UnitAI.basePositions.get(owner),
      addTradeGold: (owner, amount) => {
        this.goldStockpile[owner] += amount;
        this.players[owner].resources.gold += amount;
        if (owner === this._localPlayerIndex) {
          this.hud.updateResources(this.players[owner], this.woodStockpile[owner], this.foodStockpile[owner], this.stoneStockpile[owner]);
        }
      },
      triggerSpeechBubble: (unitId, unitType, context) => this.unitRenderer.triggerSpeechBubble(unitId, unitType, context),
    });

    // Spawn queue system
    this.spawnQueueSystem = new SpawnQueueSystem({
      getPlayers: () => this.players,
      getAllUnits: () => this.allUnits,
      getCurrentMap: () => this.currentMap,
      getLocalPlayerIndex: () => this._localPlayerIndex,
      // NOTE: SpawnQueueSystem resource ops use localPlayerIndex. In multiplayer lockstep,
      // unit spawning goes through spawnUnitForOwner() which is fully owner-aware.
      // SpawnQueueSystem queue processing only runs for local player's buildings.
      getGold: () => this.players[this._localPlayerIndex]?.resources.gold ?? 0,
      setGold: (v) => { const lp = this._localPlayerIndex; this.goldStockpile[lp] = v; if (this.players[lp]) this.players[lp].resources.gold = v; },
      getWood: () => this.woodStockpile[this._localPlayerIndex] ?? 0,
      setWood: (v) => { const lp = this._localPlayerIndex; this.woodStockpile[lp] = v; if (this.players[lp]) this.players[lp].resources.wood = v; },
      getStone: () => this.stoneStockpile[this._localPlayerIndex] ?? 0,
      setStone: (v) => { const lp = this._localPlayerIndex; this.stoneStockpile[lp] = v; if (this.players[lp]) this.players[lp].resources.stone = v; },
      getRope: () => this.ropeStockpile[this._localPlayerIndex] ?? 0,
      setRope: (v) => { const lp = this._localPlayerIndex; this.ropeStockpile[lp] = v; if (this.players[lp]) this.players[lp].resources.rope = v; },
      getSteel: () => this.steelStockpile[this._localPlayerIndex] ?? 0,
      setSteel: (v) => { const lp = this._localPlayerIndex; this.steelStockpile[lp] = v; if (this.players[lp]) this.players[lp].resources.steel = v; },
      getCrystal: () => this.players[this._localPlayerIndex]?.resources.crystal ?? 0,
      setCrystal: (v) => { if (this.players[this._localPlayerIndex]) this.players[this._localPlayerIndex].resources.crystal = v; },
      getNextSpawnBuilding: (kind, owner) => this.buildingSystem.getNextSpawnBuilding(kind, owner),
      advanceSpawnIndex: (kind) => this.buildingSystem.advanceSpawnIndex(kind),
      getFirstBuilding: (kind, owner) => this.buildingSystem.getFirstBuilding(kind, owner),
      findSpawnTile: (map, q, r, allow) => this.findSpawnTile(map, q, r, allow),
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      addUnitToRenderer: (unit, elev) => this.unitRenderer.addUnit(unit, elev),
      addUnitToGame: (unit) => {
        this.players[unit.owner].units.push(unit);
        this.allUnits.push(unit);
        this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);
      },
      getRallyFormationSlot: (kind, unit) => this.rallyPointSystem.getRallyFormationSlot(kind, unit),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      updateResources: () => { const lp = this._localPlayerIndex; this.hud.updateResources(this.players[lp], this.woodStockpile[lp], this.foodStockpile[lp], this.stoneStockpile[lp]); },
      playSound: (name, vol) => this.sound.play(name as any, vol),
      getDebugFlags: () => this.hud.debugFlags,
      toggleBuildingPlaceMode: (kind) => this.toggleBuildingPlaceMode(kind),
      canSpawnCombatUnit: (owner) => {
        if (this.populationSystem) return this.populationSystem.canSpawnCombatUnit(owner);
        return true;
      },
      getCombatPopInfo: (owner) => {
        if (this.populationSystem) {
          return {
            current: this.populationSystem.getCombatUnitCount(owner),
            cap: this.populationSystem.getPopulationCap(owner),
          };
        }
        return { current: 0, cap: 999 };
      },
      getFoodStockpile: (owner) => this.foodStockpile[owner] ?? 0,
      setFoodStockpile: (owner, v) => {
        this.foodStockpile[owner] = v;
        this.players[owner].resources.food = v;
      },
      getFoodNeededForNext: (owner) => {
        if (this.populationSystem) return this.populationSystem.getFoodNeededForNext(owner);
        return 0;
      },
      getBuildingSquadAssignment: (buildingHexKey) => {
        return this.buildingSquadAssignment.get(buildingHexKey) ?? null;
      },
      assignUnitToSquad: (unit, squadSlot) => {
        // Tag the unit with the squad ID so SquadIndicatorSystem picks it up
        unit._squadId = squadSlot;
        unit._squadJoining = true;
        // Append to the control group without disrupting current selection
        this.selectionManager.appendToControlGroup(squadSlot, unit);
      },
      getResourceForOwner: (resource, owner) => {
        switch (resource) {
          case 'gold': return this.players[owner]?.resources.gold ?? 0;
          case 'wood': return this.woodStockpile[owner] ?? 0;
          case 'stone': return this.stoneStockpile[owner] ?? 0;
          case 'rope': return this.ropeStockpile[owner] ?? 0;
          case 'steel': return this.steelStockpile[owner] ?? 0;
          case 'crystal': return this.players[owner]?.resources.crystal ?? 0;
          default: return 0;
        }
      },
      setResourceForOwner: (resource, owner, value) => {
        switch (resource) {
          case 'gold': this.goldStockpile[owner] = value; if (this.players[owner]) this.players[owner].resources.gold = value; break;
          case 'wood': this.woodStockpile[owner] = value; if (this.players[owner]) this.players[owner].resources.wood = value; break;
          case 'stone': this.stoneStockpile[owner] = value; if (this.players[owner]) this.players[owner].resources.stone = value; break;
          case 'rope': this.ropeStockpile[owner] = value; if (this.players[owner]) this.players[owner].resources.rope = value; break;
          case 'steel': this.steelStockpile[owner] = value; if (this.players[owner]) this.players[owner].resources.steel = value; break;
          case 'crystal': if (this.players[owner]) this.players[owner].resources.crystal = value; break;
        }
      },
    });

    // Base Upgrade System — checks tier requirements (population + unique buildings)
    this.baseUpgradeSystem = new BaseUpgradeSystem({
      getBases: () => this.bases,
      getPlacedBuildings: () => this.buildingSystem.placedBuildings,
      getTotalUnitCount: (owner) => {
        // Inline loop — zero allocation (no .filter())
        let count = 0;
        for (let i = 0, len = this.allUnits.length; i < len; i++) {
          const u = this.allUnits[i];
          if (u.owner === owner && u.currentHealth > 0) count++;
        }
        return count;
      },
      hexDistance: hexDist,
      playSound: (name, vol) => this.sound.play(name as any, vol),
    });

    // Population System — food-based population cap with morale
    this.populationSystem = new PopulationSystem({
      getFoodStockpile: (owner) => this.foodStockpile[owner] ?? 0,
      getAllUnits: () => this.allUnits,
      getBaseTier: (owner) => {
        let maxTier = 0;
        for (const base of this.bases) {
          if (base.owner === owner && !base.destroyed && base.tier > maxTier) {
            maxTier = base.tier;
          }
        }
        return maxTier;
      },
      getFarmhouseCount: (owner) => {
        let count = 0;
        for (const bld of this.buildingSystem.placedBuildings) {
          if (bld.kind === 'farmhouse' && bld.owner === owner && !bld.isBlueprint && bld.health > 0) count++;
        }
        return count;
      },
    });

    // Map Initializer — handles map generation and setup
    const mapInitOps: MapInitOps = {
      addToScene: (mesh) => this.renderer.scene.add(mesh),
      removeFromScene: (mesh) => this.renderer.scene.remove(mesh),
      addBlock: (pos, blockType) => this.voxelBuilder.addBlock(pos, blockType),
      setSliceY: (y) => this.voxelBuilder.setSliceY(y),
      decorateTile: (pos, terrain, scaledElev, maxNeighborElev, resource) =>
        this.terrainDecorator.decorateTile(pos, terrain, scaledElev, maxNeighborElev, resource),
      setDecorationClipPlane: (plane) => this.terrainDecorator.setDecorationClipPlane(plane),
      removeDecoration: (pos) => this.terrainDecorator.removeDecoration(pos),
      addWaterEdgeCurtain: (wx, elev, wz, dx, dz, h) =>
        this.terrainDecorator.addWaterEdgeCurtain(wx, elev, wz, dx, dz, h),
      addBase: (base, elevation) => this.baseRenderer.addBase(base, elevation),
      placeWallDirect: (pos, owner) => this.wallSystem.placeWallDirect(pos, owner),
      placeGateDirect: (pos, owner) => this.wallSystem.placeGateDirect(pos, owner),
      rebuildAllConnections: () => this.wallSystem.rebuildAllConnections(),
      disposeCaptureSystems: () => this.captureZoneSystem.dispose(),
      addCaptureZone: (base, isMain, isUndg) => this.captureZoneSystem.addZone(base, isMain, isUndg),
      findSpawnTile: (map, pq, pr, skip) => this.findSpawnTile(map, pq, pr, skip),
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      rebuildTileShell: (pos) => this.rebuildTileShell(pos),
      isWaterTerrain: (terrain) => this.isWaterTerrain(terrain as TerrainType),
      initializeGrassTracking: (mapSeed?: number) => this.natureSystem.initializeGrassTracking(mapSeed),
      initializeForestTracking: () => this.natureSystem.initializeForestTracking(),
      setMapBounds: (x0, y0, x1, y1) => this.camera.setMapBounds(x0, y0, x1, y1),
      focusCameraOnCenter: (cq, cz) => this.camera.focusOn(new THREE.Vector3(cq, 2, cz)),
      getBaseTiles: () => this.getBaseTiles(),
      updateStockpileVisual: (owner) => this.resourceManager.updateStockpileVisual(owner),
      getDebugPanel: () => this.debugPanel,
    };
    this.mapInitializer = new MapInitializer(mapInitOps);

    // ── Command Queue wiring (Phase 5B) ──
    // Initialize in single-player mode by default (multiplayer overrides later)
    this.multiplayer.commandQueue.initSinglePlayer();
    this.multiplayer.commandQueue.setCommandProcessor((cmd: NetworkCommand) => {
      processCommand(this._commandBridgeAdapter, cmd);
    });

    // ── Desync detection: provide state hash for periodic comparison ──
    this.multiplayer.commandQueue.setStateHashProvider(() => {
      const p0 = this.players[0];
      const p1 = this.players[1];
      // Build terrain fingerprint: count FOREST tiles + hash a few key tile elevations
      let forestCount = 0;
      let terrainSum = 0;
      if (this.currentMap) {
        for (const [key, tile] of this.currentMap.tiles) {
          if (tile.terrain === TerrainType.FOREST) forestCount++;
          terrainSum += tile.elevation;
        }
      }
      const terrainFingerprint = `f${forestCount}e${terrainSum}`;
      // Build detailed stockpile fingerprint for each player (catches crafting/trade desync)
      const stockFp = (idx: number) => `w${this.woodStockpile[idx]??0}s${this.stoneStockpile[idx]??0}i${this.ironStockpile[idx]??0}c${this.clayStockpile[idx]??0}g${this.goldStockpile[idx]??0}ch${this.charcoalStockpile[idx]??0}st${this.steelStockpile[idx]??0}`;
      const stockpileFingerprint = `p0[${stockFp(0)}]p1[${stockFp(1)}]`;
      return {
        units: this.allUnits
          .filter(u => u.currentHealth > 0)
          .map(u => ({ id: u.id, position: u.position, currentHealth: u.currentHealth, state: u.state, type: u.type, owner: u.owner, targetPosition: u.targetPosition ?? null, carryAmount: u.carryAmount ?? 0, gatherCooldown: u.gatherCooldown })),
        p1Resources: p0 ? p0.resources : {},
        p2Resources: p1 ? p1.resources : {},
        rngState: GameRNG.getState(),
        terrainFingerprint,
        stockpileFingerprint,
      };
    });
  }

  // ── CommandBridge adapter ─────────────────────────────────
  // Implements CommandBridgeGame interface to translate network
  // commands into actual game state mutations.
  private get _commandBridgeAdapter(): CommandBridgeGame {
    return {
      findUnitById: (id: string) => this.allUnits.find(u => u.id === id),
      getPlayerUnits: (owner: number) => this.players[owner]?.units ?? [],
      getCurrentMap: () => this.currentMap,

      commandMove: (unit: Unit, target: HexCoord, preferUnderground?: boolean) => {
        UnitAI.commandMove(unit, target, this.currentMap!, preferUnderground);
      },
      commandAttack: (unit: Unit, target: HexCoord, targetUnitId: string | null, preferUnderground?: boolean) => {
        UnitAI.commandAttack(unit, target, targetUnitId, this.currentMap!, preferUnderground);
      },
      commandStop: (unit: Unit) => {
        UnitAI.commandStop(unit);
      },

      placeBuilding: (kind: string, position: HexCoord, owner: number) => {
        this.placeBuildingForOwner(kind as BuildingKind, position, owner);
      },
      cancelBuilding: (_blueprintId: string) => {
        // Building cancellation handled via tooltip controller
        console.warn('[CommandBridge] cancelBuilding stub — use tooltip UI');
      },

      placeWall: (positions: HexCoord[], isGate: boolean, owner: number) => {
        for (const pos of positions) {
          if (isGate) {
            this.wallSystem.placeGateDirect(pos, owner);
          } else {
            this.wallSystem.placeWallDirect(pos, owner);
          }
        }
        if (positions.length > 0) this.sound.play('wall_build', 0.35);
      },

      queueUnit: (unitType: string, buildingKind: string, owner: number) => {
        // Route through SpawnQueueSystem timer instead of instant spawn
        this.spawnQueueSystem.enqueueForOwner(buildingKind, unitType as UnitType, owner);
      },

      setUnitStance: (unit: Unit, stance: UnitStance) => {
        unit.stance = stance;
      },

      lockElement: (unit: Unit, element: ElementType | null) => {
        if (element === null) {
          unit._lockedElement = undefined;
        } else {
          unit._lockedElement = element;
          unit.element = element;
          const ELEMENT_CYCLE = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
          unit._elementCycleIndex = ELEMENT_CYCLE.indexOf(element);
        }
      },

      setHealTarget: (unit: Unit, targetUnitId: string | null) => {
        unit._healTarget = targetUnitId ?? undefined;
      },

      setFocusTarget: (unit: Unit, targetUnitId: string | null) => {
        unit._focusTarget = targetUnitId ?? undefined;
      },

      setRallyPoint: (buildingId: string, position: HexCoord) => {
        this.rallyPointSystem.setRallyPoint(buildingId, position);
      },

      garrisonUnit: (unitIds: string[], buildingPosition?: HexCoord) => {
        const units = unitIds.map(id => this.allUnits.find(u => u.id === id)).filter(Boolean) as Unit[];
        if (buildingPosition) {
          const key = `${buildingPosition.q},${buildingPosition.r}`;
          this.garrisonSystem.garrison(units, key);
          this.sound.play('garrison_enter', 0.4);
        }
      },

      ungarrison: (_unitIds: string[], buildingPosition?: HexCoord) => {
        if (buildingPosition) {
          const key = `${buildingPosition.q},${buildingPosition.r}`;
          this.garrisonSystem.ungarrison(key);
          this.sound.play('garrison_exit', 0.4);
        }
      },

      setSquadObjective: (squadId: number, objective: string, target?: HexCoord) => {
        // Squad objectives applied to control groups via selection manager
        const group = this.selectionManager.selectControlGroup(squadId);
        if (group && group.length > 0) {
          for (const unit of group) {
            unit._squadObjective = objective as any;
          }
        }
      },

      // ── Crafting / economy (routed through command queue for MP sync) ──
      doCraftRope: (owner: number) => {
        this.resourceManager.craftRope(owner);
        if (owner === this._localPlayerIndex) this.sound.play('craft_confirm', 0.5);
      },
      doCraftSteel: (owner: number) => {
        this.resourceManager.smeltSteel(owner);
        if (owner === this._localPlayerIndex) this.sound.play('craft_confirm', 0.5);
      },
      doCraftCharcoal: (owner: number) => {
        this.resourceManager.craftCharcoal(owner);
        if (owner === this._localPlayerIndex) this.sound.play('craft_confirm', 0.5);
      },
      doSellWood: (owner: number) => {
        this.resourceManager.doSellWood(owner);
      },

      // ── Terrain modification (routed through command queue for MP sync) ──
      doPlantTree: (position: HexCoord, owner: number) => {
        if (!this.currentMap) return;
        const key = `${position.q},${position.r}`;
        const tile = this.currentMap.tiles.get(key);
        if (!tile) return;

        // Validation (same checks as paintPlantTree, minus UI-only concerns)
        if (tile.terrain !== TerrainType.PLAINS && tile.terrain !== TerrainType.MOUNTAIN) return;
        if (Pathfinder.blockedTiles.has(key)) return;
        if (UnitAI.farmPatches.has(key)) return;
        if (this.natureSystem.treeAge.has(key)) return;

        // Cost 1 wood
        if (this.woodStockpile[owner] < GAME_CONFIG.economy.harvest.tree.plantCost.wood) return;
        this.woodStockpile[owner] -= GAME_CONFIG.economy.harvest.tree.plantCost.wood;
        this.players[owner].resources.wood = Math.max(0, this.players[owner].resources.wood - GAME_CONFIG.economy.harvest.tree.plantCost.wood);
        if (owner === this._localPlayerIndex) {
          this.hud.updateResources(this.players[owner], this.woodStockpile[owner], this.foodStockpile[owner], this.stoneStockpile[owner]);
        }

        // Sprout a sapling
        tile.terrain = TerrainType.FOREST;
        this.terrainDecorator.addTreeAtStage(position, tile.elevation * 0.5, 0);
        this.natureSystem.treeAge.set(key, 0);
        this.natureSystem.treeGrowthTimers.set(key, this.natureSystem.TREE_GROWTH_TIME);
      },

      doPlantCrop: (position: HexCoord, owner: number) => {
        if (!this.currentMap) return;
        const key = `${position.q},${position.r}`;
        const tile = this.currentMap.tiles.get(key);
        if (!tile) return;

        if (tile.terrain !== TerrainType.PLAINS) return;
        const grassStage = this.natureSystem.getGrassAge(key);
        if (grassStage !== undefined && grassStage >= 1) return;
        if (UnitAI.farmPatches.has(key)) return;
        if (Pathfinder.blockedTiles.has(key)) return;

        // Place farm patch
        UnitAI.farmPatches.add(key);
        UnitAI.cropStages.set(key, 0);
        UnitAI.cropTimers.set(key, GAME_CONFIG.economy.harvest.crops.growTime ?? 8);
        this.natureSystem.clearedPlains.add(key);

        // Visuals
        this.blueprintSystem.addFarmPatchMarker(position);
        this.terrainDecorator.updateCropVisual(key, 0);
        if (owner === this._localPlayerIndex) {
          this.hud.showNotification('🌱 Crops planted! They will grow over time.', '#4a7023');
        }
      },

      // ── Blueprint sync (deterministic across clients) ──────
      doPaintMine: (position: HexCoord, startY: number, depth: number, _owner: number) => {
        const key = `${position.q},${position.r}`;
        if (UnitAI.playerMineBlueprint.has(key)) return;
        UnitAI.playerMineBlueprint.set(key, { startY, depth });
        // Visual marker only for the local player
        if (_owner === this._localPlayerIndex) {
          this.blueprintSystem.addMineMarker(position, startY, depth);
        }
      },
      doUnpaintMine: (position: HexCoord, _owner: number) => {
        const key = `${position.q},${position.r}`;
        if (!UnitAI.playerMineBlueprint.has(key)) return;
        UnitAI.playerMineBlueprint.delete(key);
        UnitAI.claimedMines.delete(key);
        if (_owner === this._localPlayerIndex) {
          this.blueprintSystem.removeMineMarker(position);
        }
      },
      doPaintHarvest: (position: HexCoord, _owner: number) => {
        const key = `${position.q},${position.r}`;
        if (UnitAI.playerHarvestBlueprint.has(key)) return;
        UnitAI.playerHarvestBlueprint.add(key);
        if (_owner === this._localPlayerIndex) {
          this.blueprintSystem.addHarvestMarker(position);
        }
      },
      doPaintWallBlueprint: (positions: HexCoord[], _owner: number) => {
        for (const pos of positions) {
          const key = `${pos.q},${pos.r}`;
          if (UnitAI.playerWallBlueprint.has(key)) continue;
          if (UnitAI.playerGateBlueprint.has(key)) continue;
          UnitAI.addBlueprint(pos);
          if (_owner === this._localPlayerIndex) {
            this.blueprintSystem.addBlueprintGhost(pos);
          }
        }
      },
      doRemoveWallBlueprint: (position: HexCoord, _owner: number) => {
        const key = `${position.q},${position.r}`;
        if (UnitAI.playerWallBlueprint.has(key)) {
          UnitAI.playerWallBlueprint.delete(key);
          if (_owner === this._localPlayerIndex) {
            this.blueprintSystem.removeBlueprintGhost(position);
          }
        }
        if (UnitAI.playerGateBlueprint.has(key)) {
          UnitAI.playerGateBlueprint.delete(key);
          if (_owner === this._localPlayerIndex) {
            this.blueprintSystem.removeBlueprintGhost(position);
          }
        }
      },

      getOwnerForPlayerId: (playerId: string) => {
        // In single-player, always player 0
        // In multiplayer, host = 0, guest = 1
        if (!this.multiplayer.commandQueue.isMultiplayer) return 0;
        if (this.multiplayer.network.isHost) {
          return playerId === this.multiplayer.network.localUid ? 0 : 1;
        }
        return playerId === this.multiplayer.network.localUid ? 1 : 0;
      },
    };
  }

  /**
   * Enqueue a player command through the command queue.
   * In single-player, this executes immediately.
   * In multiplayer, this buffers for deterministic lockstep.
   */
  enqueueCommand(type: NetCommandType, payload: Record<string, unknown>): void {
    this.multiplayer.commandQueue.enqueue(type, payload);
  }

  // --- Shared action methods (called by both keys and control panel buttons) ---

  private toggleBuildMode(): void {
    this.interaction.toggle({ kind: 'wall_build', rotation: 0 });
  }

  private toggleHarvestMode(): void {
    this.interaction.toggle({ kind: 'harvest' });
  }

  /** Generic building placement mode toggle */
  private toggleBuildingPlaceMode(kind: BuildingKind): void {
    this.interaction.toggleBuilding(kind);
  }

  /** Spawn queue config for simple (single-resource) buildings */

  regenerateMap(): void {
    // ── PvP forfeit/cleanup: if leaving a multiplayer match, clean up network ──
    if (this.gameMode === 'pvp') {
      if (!this.gameOver) {
        this.gameOver = true;
        this.multiplayer.surrender().catch(() => {});
        this.hud.showNotification('You left the match — defeat!', 'color:#e74c3c;font-weight:bold;');
      }
      // Reset multiplayer state so player can re-queue
      this.multiplayer.returnToLobby();
      this.multiplayer.commandQueue.initSinglePlayer();
      this._mpTickAccumulator = 0;
      this._localPlayerIndex = 0;
      UnitAI.state.localPlayerIndex = 0;
    }

    this.voxelBuilder.clearAll();
    this.terrainDecorator.dispose();
    this.unitRenderer.dispose();
    this.baseRenderer.dispose();
    this.tileHighlighter.clearAll();

    const oldOcean = this.renderer.scene.getObjectByName('ocean-plane');
    if (oldOcean) {
      this.renderer.scene.remove(oldOcean);
      if (oldOcean instanceof THREE.Mesh) {
        oldOcean.geometry.dispose();
        (oldOcean.material as THREE.Material).dispose();
      }
    }

    this.allUnits = [];
    this.players = [];
    this.bases = [];
    this.gameOver = false;
    this.resetStockpiles(this.playerCount);
    this.wallSystem.cleanup();
    UnitAI.wallsBuilt.clear();
    UnitAI.wallOwners.clear();
    // Clear rally point system
    this.rallyPointSystem.clearAllRallyPoints();
    this.buildingSquadAssignment.clear();
    // Clear all interaction modes via state machine
    this.interaction.clear();

    this.blueprintSystem.clearAllBlueprintGhosts();
    this.blueprintSystem.clearHoverGhost();
    UnitAI.clearBlueprints();
    UnitAI.clearHarvestBlueprints();
    UnitAI.barracksPositions.clear();
    this.blueprintSystem.clearAllHarvestMarkers();
    this.blueprintSystem.clearAllMineMarkers();
    // Remove all placed building meshes from scene
    this.buildingSystem.cleanup();
    this.tooltipController.cleanup();
    this.spawnQueueSystem.cleanup();
    this.garrisonSystem.cleanup();
    this.resetStockpiles(this.playerCount);
    // Farm patch markers cleared by blueprintSystem.cleanup()
    UnitAI.farmPatches.clear();
    UnitAI.playerGrassBlueprint.clear();
    UnitAI.claimedFarms.clear();
    UnitAI.claimedTrees.clear();
    UnitAI.clearUnreachableCache();
    UnitAI.siloPositions.clear();
    UnitAI.farmhousePositions.clear();
    UnitAI.forestryPositions.clear();
    UnitAI.grassTiles.clear();
    // Building meshes are cleaned up by buildingSystem.cleanup() above
    this.natureSystem.cleanup();
    // Clean up AI building meshes for both players
    for (const st of this.aiController.aiState) {
      for (const mesh of st.meshes) {
        this.renderer.scene.remove(mesh);
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
      }
    }
    this.aiController.cleanup();
    // Legacy per-type mesh cleanup removed — buildingSystem.cleanup() handles all
    if (this.resourceManager) {
      this.resourceManager.cleanup();
    }
    // Initialize extracted systems with fresh state references
    this.initSystems();
    this.menuController.removeGameOverOverlay();
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);
    this.music.pauseGameplay();
    this.menuController.showMainMenu();
  }

  /** Clean up old game state and start a new game without showing the main menu. */
  restartGame(): void {
    this.sound.stopAmbient();
    this.voxelBuilder.clearAll();
    this.terrainDecorator.dispose();
    this.unitRenderer.dispose();
    this.baseRenderer.dispose();
    this.tileHighlighter.clearAll();

    const oldOcean = this.renderer.scene.getObjectByName('ocean-plane');
    if (oldOcean) {
      this.renderer.scene.remove(oldOcean);
      if (oldOcean instanceof THREE.Mesh) {
        oldOcean.geometry.dispose();
        (oldOcean.material as THREE.Material).dispose();
      }
    }

    this.allUnits = [];
    this.players = [];
    this.bases = [];
    this.gameOver = false;
    this.wallSystem.cleanup();
    UnitAI.wallsBuilt.clear();
    UnitAI.wallOwners.clear();
    this.rallyPointSystem.clearAllRallyPoints();
    this.blueprintSystem.clearAllBlueprintGhosts();
    this.blueprintSystem.clearHoverGhost();
    UnitAI.clearBlueprints();
    UnitAI.clearHarvestBlueprints();
    UnitAI.barracksPositions.clear();
    this.blueprintSystem.clearAllHarvestMarkers();
    this.blueprintSystem.clearAllMineMarkers();
    this.buildingSystem.cleanup();
    this.tooltipController.cleanup();
    UnitAI.farmPatches.clear();
    UnitAI.playerGrassBlueprint.clear();
    UnitAI.claimedFarms.clear();
    UnitAI.claimedTrees.clear();
    UnitAI.clearUnreachableCache();
    UnitAI.siloPositions.clear();
    UnitAI.farmhousePositions.clear();
    UnitAI.forestryPositions.clear();
    UnitAI.grassTiles.clear();
    this.natureSystem.cleanup();
    for (const st of this.aiController.aiState) {
      for (const mesh of st.meshes) {
        this.renderer.scene.remove(mesh);
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
      }
    }
    this.aiController.cleanup();
    if (this.resourceManager) {
      this.resourceManager.cleanup();
    }
    this.initSystems();
    this.menuController.removeGameOverOverlay();
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);
    // Skip menu — go directly to new game
    this.startNewGame();
  }

  /** Override scene lighting/fog/sky for the dreamy Skyland aesthetic */
  private applySkylandAtmosphere(): void {
    const scene = this.renderer.scene;

    // Bright pastel sky gradient background
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#87ceeb');   // sky blue zenith
    gradient.addColorStop(0.3, '#b0e0e6'); // powder blue
    gradient.addColorStop(0.55, '#ffe4f0'); // soft pink
    gradient.addColorStop(0.75, '#fff8dc'); // cornsilk warm
    gradient.addColorStop(0.9, '#fffaf0');  // floral white horizon
    gradient.addColorStop(1, '#fff0f5');    // lavender blush
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;

    // Fog removed — was obscuring terrain

    // Brighten ambient light — sky islands should feel radiant
    scene.traverse((child) => {
      if (child instanceof THREE.AmbientLight) {
        child.color.set(0xfff8ff); // warm white-pink
        child.intensity = 0.85;    // bright ambient — above the clouds
      }
      if (child instanceof THREE.DirectionalLight && child.castShadow) {
        child.color.set(0xfffae8); // warm golden sun
        child.intensity = 2.0;     // bright unobstructed sunlight
      }
    });
  }

  private applyRiverCrossingAtmosphere(): void {
    const scene = this.renderer.scene;

    // Lush green-blue sky — river valley atmosphere
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1a3a5a');   // deep blue zenith
    gradient.addColorStop(0.3, '#3a6a8a'); // medium blue
    gradient.addColorStop(0.5, '#5a9ab0'); // light blue
    gradient.addColorStop(0.7, '#7abac8'); // pale sky blue
    gradient.addColorStop(0.9, '#a0d4dd'); // horizon haze
    gradient.addColorStop(1, '#c8e8ee');   // bright horizon
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;

    // Fog removed — was obscuring terrain

    // Soft natural lighting
    scene.traverse((child) => {
      if (child instanceof THREE.AmbientLight) {
        child.color.set(0x6a8a6a); // warm green-tinted ambient
        child.intensity = 0.7;
      }
      if (child instanceof THREE.DirectionalLight && child.castShadow) {
        child.color.set(0xffe8b0); // warm golden sun
        child.intensity = 1.8;
      }
    });
  }

  private applyArchipelagoAtmosphere(): void {
    const scene = this.renderer.scene;

    // Bright tropical sky — vivid blue to warm horizon
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1e90ff');   // dodger blue zenith
    gradient.addColorStop(0.3, '#40b4ff'); // bright sky blue
    gradient.addColorStop(0.55, '#87ceeb'); // light sky blue
    gradient.addColorStop(0.75, '#b0e8f0'); // pale cyan
    gradient.addColorStop(0.9, '#ffe4b0');  // warm golden horizon
    gradient.addColorStop(1, '#ffd080');    // sunset gold
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;

    // Fog removed — was obscuring terrain

    // Bright warm tropical lighting
    scene.traverse((child) => {
      if (child instanceof THREE.AmbientLight) {
        child.color.set(0xf0f8ff); // cool white ambient
        child.intensity = 0.75;
      }
      if (child instanceof THREE.DirectionalLight && child.castShadow) {
        child.color.set(0xfff5e0); // warm sunlight
        child.intensity = 2.0;
      }
    });

    // ── Ocean plane: visible turquoise water between islands ──
    const oldOcean = scene.getObjectByName('ocean-plane');
    if (oldOcean) {
      scene.remove(oldOcean);
      if (oldOcean instanceof THREE.Mesh) {
        oldOcean.geometry.dispose();
        (oldOcean.material as THREE.Material).dispose();
      }
    }
    const oceanSize = 120; // plenty to cover 50x50 map
    const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize);
    const oceanMat = new THREE.MeshLambertMaterial({
      color: 0x30b8d8,       // bright tropical turquoise
      transparent: true,
      opacity: 0.85,
    });
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.rotation.x = -Math.PI / 2;
    oceanMesh.position.set(25, 0.6, 25); // center of 50x50 map, just below surface
    oceanMesh.name = 'ocean-plane';
    oceanMesh.receiveShadow = true;
    scene.add(oceanMesh);
  }

  private applyTundraAtmosphere(): void {
    const scene = this.renderer.scene;

    // Cold pale sky — icy blue to soft white horizon
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#6090b8');   // steel blue zenith
    gradient.addColorStop(0.25, '#8ab0d0'); // pale blue
    gradient.addColorStop(0.5, '#b0c8dc');  // icy blue-grey
    gradient.addColorStop(0.75, '#d0dce8'); // near-white cold
    gradient.addColorStop(0.9, '#e0e8f0');  // snow-white horizon
    gradient.addColorStop(1, '#e8ecf2');    // bright white base
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;

    // Fog removed — was obscuring terrain

    // Cold desaturated lighting — overcast grey winter sky
    scene.traverse((child) => {
      if (child instanceof THREE.AmbientLight) {
        child.color.set(0xc0d0e0); // cold grey-blue ambient
        child.intensity = 0.55;    // dimmer — overcast
      }
      if (child instanceof THREE.DirectionalLight && child.castShadow) {
        child.color.set(0xe8ecf4); // pale grey-white sunlight (filtered through clouds)
        child.intensity = 1.4;     // weaker sun — heavy cloud cover
      }
    });
  }

  private applySunkenRuinsAtmosphere(): void {
    // Misty jungle-ruins: humid green-grey sky
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#7a9a7a');   // mossy green-grey top
    g.addColorStop(0.5, '#a0b890'); // pale sage middle
    g.addColorStop(1, '#d0d8c0');   // misty cream horizon
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.renderer.scene.background = tex;
    // Fog removed — was obscuring terrain
    // Dappled green-tinted lighting
    const amb = this.renderer.scene.children.find((c: any) => c.isAmbientLight) as THREE.AmbientLight | undefined;
    if (amb) { amb.color.set(0xb0c8a0); amb.intensity = 0.7; }
    const dir = this.renderer.scene.children.find((c: any) => c.isDirectionalLight) as THREE.DirectionalLight | undefined;
    if (dir) { dir.color.set(0xe0e8d0); dir.intensity = 1.0; }
  }

  private applyBadlandsAtmosphere(): void {
    // Scorching heat haze: orange-red dusty sky
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#c87040');   // burnt orange sky
    g.addColorStop(0.5, '#e0a060'); // hazy amber middle
    g.addColorStop(1, '#e8c8a0');   // dusty pale horizon
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.renderer.scene.background = tex;
    // Fog removed — was obscuring terrain
    // Hot harsh sunlight
    const amb = this.renderer.scene.children.find((c: any) => c.isAmbientLight) as THREE.AmbientLight | undefined;
    if (amb) { amb.color.set(0xd8b090); amb.intensity = 0.6; }
    const dir = this.renderer.scene.children.find((c: any) => c.isDirectionalLight) as THREE.DirectionalLight | undefined;
    if (dir) { dir.color.set(0xf0d0a0); dir.intensity = 1.3; }
  }

  private setupResizeHandler(): void {
    window.addEventListener('resize', () => {
      this.renderer.resize(window.innerWidth, window.innerHeight);
      this.camera.resize(window.innerWidth / window.innerHeight);
    });
  }

  /**
   * Find a valid spawn tile near a preferred position.
   * @param skipCenter - if true, start search at radius 1 (for building spawns, avoids the building hex)
   */
  private findSpawnTile(map: GameMap, preferQ: number, preferR: number, skipCenter = false): HexCoord {
    const startRadius = skipCenter ? 1 : 0;
    for (let radius = startRadius; radius < 10; radius++) {
      for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = -radius; dr <= radius; dr++) {
          const q = preferQ + dq;
          const r = preferR + dr;
          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
              && tile.terrain !== TerrainType.FOREST && !Pathfinder.blockedTiles.has(key)
              && !Pathfinder.occupiedTiles.has(key)) {
            return { q, r };
          }
        }
      }
    }
    // Fallback: relax occupied check
    for (let radius = startRadius; radius < 10; radius++) {
      for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = -radius; dr <= radius; dr++) {
          const q = preferQ + dq;
          const r = preferR + dr;
          const key = `${q},${r}`;
          const tile = map.tiles.get(key);
          if (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
              && tile.terrain !== TerrainType.FOREST && !Pathfinder.blockedTiles.has(key)) {
            return { q, r };
          }
        }
      }
    }
    return { q: preferQ, r: preferR };
  }

  startNewGame(): void {
    this._gameFrame = 0;
    this._mpTickAccumulator = 0;
    // Reset unit ID counter so both multiplayer clients generate identical IDs
    resetUnitIdCounter();
    const isArena = this.mapType === MapType.ARENA;

    // ── Defensive cleanup: remove any lingering overlay canvases ──
    // Title scene canvas can persist if dispose() fails (e.g. WebGL context lost)
    document.getElementById('title-scene-canvas')?.remove();

    // Remove orphaned ocean plane from previous Archipelago game
    const oldOcean = this.renderer.scene.getObjectByName('ocean-plane');
    if (oldOcean) {
      this.renderer.scene.remove(oldOcean);
      if (oldOcean instanceof THREE.Mesh) {
        oldOcean.geometry.dispose();
        (oldOcean.material as THREE.Material).dispose();
      }
    }

    // Sweep orphaned sprites/VFX AND large transparent meshes from previous game
    // These can stack up across restarts and cause the screen to wash out
    const orphans: THREE.Object3D[] = [];
    this.renderer.scene.traverse((obj) => {
      if (obj instanceof THREE.Sprite && obj.material instanceof THREE.SpriteMaterial) {
        if (obj.material.opacity < 0.01 && !obj.userData._permanent) {
          orphans.push(obj);
        }
      }
      // Catch orphaned transparent overlay meshes (capture zone rings, columns, etc.)
      if (obj instanceof THREE.Mesh && obj.material && !obj.userData._permanent) {
        const mat = obj.material as THREE.MeshBasicMaterial;
        const geoType = obj.geometry?.type || '';
        if (mat.transparent && mat.depthWrite === false &&
            (geoType === 'RingGeometry' || geoType === 'CylinderGeometry') &&
            obj.geometry?.boundingSphere) {
          if (obj.geometry.boundingSphere.radius > 3) {
            orphans.push(obj);
          }
        }
      }
    });
    for (const orphan of orphans) {
      this.renderer.scene.remove(orphan);
      if ((orphan as any).material) {
        const mat = (orphan as any).material;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
      if ((orphan as any).geometry) {
        (orphan as any).geometry.dispose();
      }
    }

    // Determine player count from game mode
    this.playerCount = (this.gameMode === 'ffa' || this.gameMode === '2v2') ? 4 : 2;
    // Reset local player index for non-PvP modes
    if (this.gameMode !== 'pvp') { this._localPlayerIndex = 0; UnitAI.state.localPlayerIndex = 0; }

    // Reset FFA enemy bar state so it rebuilds for new player count
    this.hud.resetFfaEnemyBar();

    // Ensure AI and capture systems are sized for the player count
    this.aiController.ensurePlayerCount(this.playerCount);
    // Dispose old capture zone visuals before creating new system — prevents ring/column stacking
    if (this.captureZoneSystem) this.captureZoneSystem.dispose();
    this.captureZoneSystem = new CaptureZoneSystem(this.renderer.scene, this.playerCount);
    this.captureZoneSystem.setOps({
      playSound: (name, vol) => this.sound.play(name as any, vol),
    });

    // Apply map-specific decoration modes BEFORE setupMap so decorateTile uses correct mode
    this.terrainDecorator.desertMode = false;
    this.terrainDecorator.skylandMode = false;
    this.terrainDecorator.riverCrossingMode = false;
    this.terrainDecorator.archipelagoMode = false;
    this.terrainDecorator.tundraMode = false;
    this.terrainDecorator.ruinsMode = false;
    this.terrainDecorator.badlandsMode = false;
    if (this.mapType === MapType.DESERT_TUNNELS) {
      this.terrainDecorator.desertMode = true;
    } else if (this.mapType === MapType.SKYLAND) {
      this.terrainDecorator.skylandMode = true;
    } else if (this.mapType === MapType.RIVER_CROSSING) {
      this.terrainDecorator.riverCrossingMode = true;
    } else if (this.mapType === MapType.ARCHIPELAGO) {
      this.terrainDecorator.archipelagoMode = true;
    } else if (this.mapType === MapType.TUNDRA) {
      this.terrainDecorator.tundraMode = true;
    } else if (this.mapType === MapType.SUNKEN_RUINS) {
      this.terrainDecorator.ruinsMode = true;
    } else if (this.mapType === MapType.BADLANDS) {
      this.terrainDecorator.badlandsMode = true;
    }

    // Step 1: Initialize map (terrain, bases, decorations)
    const mapSetupResult = this.mapInitializer.setupMap(this.mapType, this.gameMode, isArena, this.playerCount, this._mapSeedOverride ?? undefined);
    this._mapSeedOverride = null; // consume the seed
    const map = mapSetupResult.map;
    const MAP_SIZE = mapSetupResult.mapSize;
    const bases = mapSetupResult.bases;
    const baseCoords = mapSetupResult.baseCoords;
    const p1BaseCoord = mapSetupResult.p1BaseCoord;
    const p2BaseCoord = mapSetupResult.p2BaseCoord;
    const midR = Math.floor(MAP_SIZE / 2);
    const BASE_INSET = mapSetupResult.baseInset;
    const P1_Q = BASE_INSET;
    const P1_R = MAP_SIZE - 1 - BASE_INSET;
    const P2_Q = MAP_SIZE - 1 - BASE_INSET;
    const P2_R = BASE_INSET;
    const arenaCenter = Math.floor(MAP_SIZE / 2);

    this.currentMap = map;
    this.bases = bases;
    this._deadUnitKills = Array(this.playerCount).fill(0);

    // Debug: log scene children to diagnose visual artifacts
    {
      const counts: Record<string, number> = {};
      let totalChildren = 0;
      this.renderer.scene.traverse((obj) => {
        totalChildren++;
        const type = obj.constructor.name;
        counts[type] = (counts[type] || 0) + 1;
      });
      console.log(`[startNewGame] Scene has ${totalChildren} objects:`, counts);
      // Log any named objects and large meshes
      this.renderer.scene.traverse((obj) => {
        if (obj.name) console.log(`  named: "${obj.name}" (${obj.constructor.name})`);
        if (obj instanceof THREE.Sprite) {
          const s = obj.scale;
          if (s.x > 5 || s.y > 5) console.warn(`  LARGE SPRITE: scale=${s.x},${s.y} pos=${obj.position.x},${obj.position.y},${obj.position.z}`);
        }
      });
    }

    // Reset atmosphere to defaults before applying per-map overrides
    this.renderer.scene.background = this.renderer.createSkyGradient();
    this.renderer.scene.fog = null;
    // Reset lighting to defaults
    this.renderer.scene.traverse((child: any) => {
      if (child.isAmbientLight) { child.color.set(0x404060); child.intensity = 0.6; }
      if (child.isDirectionalLight) { child.color.set(0xffffff); child.intensity = 1.0; }
    });

    // Per-map atmosphere (lighting/sky only, no fog)
    if (this.mapType === MapType.SKYLAND) {
      this.applySkylandAtmosphere();
    } else if (this.mapType === MapType.RIVER_CROSSING) {
      this.applyRiverCrossingAtmosphere();
    } else if (this.mapType === MapType.ARCHIPELAGO) {
      this.applyArchipelagoAtmosphere();
    } else if (this.mapType === MapType.TUNDRA) {
      this.applyTundraAtmosphere();
    } else if (this.mapType === MapType.SUNKEN_RUINS) {
      this.applySunkenRuinsAtmosphere();
    } else if (this.mapType === MapType.BADLANDS) {
      this.applyBadlandsAtmosphere();
    }

    // --- Spawn Units ---

    // Create players — arena gets abundant resources for testing
    const makeResources = (): PlayerResources => isArena
      ? { food: 999, wood: 999, stone: 999, iron: 999, gold: 999, crystal: 999, grass_fiber: 0, clay: 0, rope: 0, charcoal: 999, steel: 999 }
      : { food: 50, wood: 50, stone: 20, iron: 0, gold: 25, crystal: 0, grass_fiber: 0, clay: 0, rope: 0, charcoal: 0, steel: 0 };

    const p1IsAI = this.gameMode === 'aivai';
    const isPvP = this.gameMode === 'pvp';
    const colorNames = ['Blue', 'Red', 'Green', 'Gold'];
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const pc = getPlayerColor(i);
      // In PvP both players are human; in aivai both are AI; otherwise only player 0 is human
      const isHuman = isPvP ? true : (i === 0 && !p1IsAI);
      const isLocal = (i === this._localPlayerIndex);
      this.players.push({
        id: i,
        name: isPvP
          ? (isLocal ? 'You' : (this._multiplayerOpponentName || `Player ${i + 1}`))
          : (isHuman ? 'Player 1' : `AI ${colorNames[i] ?? i}`),
        color: new THREE.Color(pc.primary),
        cities: [], units: [],
        resources: makeResources(),
        technology: [],
        isAI: !isHuman,
        defeated: false,
        tribeId: isLocal ? this.playerTribe : undefined,
      });
    }

    // Register tribe assignments with the renderer so unit models use tribe palette colors
    this.unitRenderer.setPlayerTribes(this.players);

    if (isArena && !isPvP) {
      // Arena mode: large combat armies on opposite sides, aggressive stance
      // Disabled in PvP multiplayer — non-deterministic unit spawning causes desync
      const arenaCenter = Math.floor(MAP_SIZE / 2);
      // Army compositions from debug panel (Army tab), defaults to 1 of each
      const armyComp = this.debugPanel.getArmyComposition();
      const blueArmyDefs = armyComp.blue.length > 0 ? armyComp.blue : [
        { type: UnitType.WARRIOR, count: 1 }, { type: UnitType.ARCHER, count: 1 },
        { type: UnitType.RIDER, count: 1 }, { type: UnitType.PALADIN, count: 1 },
        { type: UnitType.MAGE, count: 1 }, { type: UnitType.TREBUCHET, count: 1 },
        { type: UnitType.SCOUT, count: 1 }, { type: UnitType.HEALER, count: 1 },
        { type: UnitType.ASSASSIN, count: 1 }, { type: UnitType.SHIELDBEARER, count: 1 },
        { type: UnitType.BERSERKER, count: 1 }, { type: UnitType.BATTLEMAGE, count: 1 },
        { type: UnitType.GREATSWORD, count: 1 },
      ];
      const redArmyDefs = armyComp.red.length > 0 ? armyComp.red : blueArmyDefs;

      // Symmetrical spawning: compute forward/lateral vectors from base toward center,
      // then place formation rows as parallel lines equidistant from the midpoint.
      // Each player's formation is a mirror image of every other player's.
      const spawnArmy = (owner: number, baseQ: number, baseR: number) => {
        const defs = owner === 0 ? blueArmyDefs : redArmyDefs;

        // Forward vector: base → center (normalized)
        const fwdQ = arenaCenter - baseQ;
        const fwdR = arenaCenter - baseR;
        const fwdLen = Math.sqrt(fwdQ * fwdQ + fwdR * fwdR) || 1;
        const nfQ = fwdQ / fwdLen; // normalized forward Q
        const nfR = fwdR / fwdLen; // normalized forward R
        // Lateral vector: perpendicular to forward (rotate 90°)
        const nlQ = -nfR;
        const nlR = nfQ;

        // Flatten defs into individual units and sort by role depth (front first)
        const units: { type: UnitType; depth: number }[] = [];
        for (const def of defs) {
          const depth = DebugController.ROLE_DEPTH[def.type] ?? 1;
          for (let i = 0; i < def.count; i++) {
            units.push({ type: def.type, depth });
          }
        }
        units.sort((a, b) => a.depth - b.depth);

        // Count units per depth for centering rows
        const depthCounts: Record<number, number> = {};
        for (const u of units) depthCounts[u.depth] = (depthCounts[u.depth] ?? 0) + 1;

        // Place units in formation lines along the lateral axis
        // Depth 0 (frontline) is 2 tiles forward from base, each subsequent depth 2 tiles back
        const lineCounters: Record<number, number> = {};
        const LINE_WIDTH = 5;
        for (const u of units) {
          const lineIdx = lineCounters[u.depth] ?? 0;
          lineCounters[u.depth] = lineIdx + 1;

          // Forward offset: depth 0 = +2, depth 1 = 0 (at base), depth 2 = -2, depth 3 = -4
          const forwardDist = 2 - u.depth * 2;
          // Lateral offset: center the row on base position
          const totalInDepth = depthCounts[u.depth] ?? 1;
          const subRow = Math.floor(lineIdx / LINE_WIDTH);
          const posInRow = lineIdx % LINE_WIDTH;
          const rowSize = Math.min(LINE_WIDTH, totalInDepth - subRow * LINE_WIDTH);
          const lateralDist = posInRow - (rowSize - 1) / 2;
          // Extra forward offset for overflow sub-rows
          const extraForward = -subRow;

          const oq = Math.round(baseQ + nfQ * (forwardDist + extraForward) + nlQ * lateralDist);
          const or2 = Math.round(baseR + nfR * (forwardDist + extraForward) + nlR * lateralDist);
          const pos = this.findSpawnTile(map, oq, or2);
          const unit = UnitFactory.create(u.type, owner, pos);
          const wp = this.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          unit.stance = UnitStance.AGGRESSIVE;
          this.players[owner].units.push(unit);
          this.unitRenderer.addUnit(unit, this.getElevation(pos));
        }
      };
      // Spawn armies at their bases — formations face center, mirror-symmetric
      for (let pid = 0; pid < this.playerCount; pid++) {
        const bc = baseCoords[pid];
        spawnArmy(pid, bc.q, bc.r);
      }
    } else {
      // Standard mode: workers near base for each player
      for (let pid = 0; pid < this.playerCount; pid++) {
        const bc = baseCoords[pid];
        // Offset units toward the center of the map from their base
        const centerQ = Math.floor(MAP_SIZE / 2);
        const centerR = Math.floor(MAP_SIZE / 2);
        const dq = Math.sign(centerQ - bc.q) || 1;
        const dr = Math.sign(centerR - bc.r) || 1;
        const off = 2; // distance from base

        const defs = [
          { type: UnitType.BUILDER, pq: bc.q + dq * off, pr: bc.r },
          { type: UnitType.LUMBERJACK, pq: bc.q + dq * off, pr: bc.r - 2 },
          { type: UnitType.LUMBERJACK, pq: bc.q + dq * off, pr: bc.r + 2 },
          { type: UnitType.VILLAGER, pq: bc.q + dq * off, pr: bc.r - 4 },
          { type: UnitType.VILLAGER, pq: bc.q + dq * off, pr: bc.r + 4 },
        ];
        for (const def of defs) {
          const pos = this.findSpawnTile(map, def.pq, def.pr);
          const unit = UnitFactory.create(def.type, pid, pos);
          const wp = this.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          this.players[pid].units.push(unit);
          this.unitRenderer.addUnit(unit, this.getElevation(pos));
        }
      }
    }

    this.allUnits = this.players.flatMap(p => p.units);
    this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);

    // Sync internal stockpiles with player resources (critical for arena mode
    // where resources.food=999 but foodStockpile was reset to [10,10] in cleanup)
    for (let pid = 0; pid < this.players.length; pid++) {
      const r = this.players[pid].resources;
      this.foodStockpile[pid] = r.food;
      this.woodStockpile[pid] = r.wood;
      this.stoneStockpile[pid] = r.stone;
      this.goldStockpile[pid] = r.gold;
      this.ironStockpile[pid] = r.iron;
      this.crystalStockpile[pid] = r.crystal;
      this.grassFiberStockpile[pid] = r.grass_fiber;
      this.clayStockpile[pid] = r.clay;
      this.ropeStockpile[pid] = r.rope;
      this.charcoalStockpile[pid] = r.charcoal ?? 0;
      this.steelStockpile[pid] = r.steel ?? 0;
    }

    { const lp = this._localPlayerIndex; this.hud.updateResources(this.players[lp], this.woodStockpile[lp], this.foodStockpile[lp], this.stoneStockpile[lp]); }

    // Base setup already done by mapInitializer.setupMap()
    // Here we just finalize the remaining game state

    // Add wallConnectable tags for ALL player bases
    for (let i = 0; i < this.playerCount; i++) {
      const bc = baseCoords[i];
      this.buildingSystem.wallConnectable.add(`${bc.q},${bc.r}`);
    }

    // Setup UnitAI static references for all players
    for (let i = 0; i < this.playerCount; i++) {
      UnitAI.basePositions.set(i, baseCoords[i]);
      UnitAI.siloPositions.set(i, baseCoords[i]);
    }
    UnitAI.bases = this.bases;
    UnitAI.arenaMode = isArena;
    UnitAI.playerCount = this.playerCount;
    UnitAI.mapWidth = this.currentMap!.width;
    UnitAI.mapHeight = this.currentMap!.height;

    // Auto-enable combat logging in Arena mode
    if (isArena) {
      CombatLog.reset();
      this.debugPanel.setUnits(this.allUnits);
    }

    // Standard mode only: generate builder wall plans for all players
    if (!isArena) {
      for (let i = 0; i < this.playerCount; i++) {
        UnitAI.generateKeepWallPlan(i, baseCoords[i], map);
      }
    }

    // Set camera bounds to prevent panning off the map
    this.camera.setMapBounds(-3, -3, MAP_SIZE * 1.5 + 3, MAP_SIZE * 1.5 + 3);

    // Camera focuses on local player's base (or map center for spectator modes)
    if (baseCoords[this._localPlayerIndex]) {
      const bc = baseCoords[this._localPlayerIndex];
      this.camera.focusOn(new THREE.Vector3(bc.q * 1.5, 2, bc.r * 1.5));
    } else {
      const centerQ = Math.floor(MAP_SIZE / 2);
      this.camera.focusOn(new THREE.Vector3(centerQ * 1.5, 2, midR * 1.5));
    }

    // Display initial stockpiles for all players
    for (let i = 0; i < this.playerCount; i++) {
      this.resourceManager.updateStockpileVisual(i);
    }

    // Update HUD mode indicator
    this.hud.setGameMode(this.gameMode);

    // Always show Y-slicer — works globally, no mode prerequisite
    this.hud.showElevationSlicer(true, 25, Cubitopia.UNDERGROUND_DEPTH);
    this.hud.onSliceChange = (y) => {
      this.voxelBuilder.setSliceY(y);
      this.terrainDecorator.setDecorationClipPlane(y !== null ? this.voxelBuilder.getClipPlane() : null);
    };

    // Start ambient soundscape (wind, birds, distant combat rumble)
    this.sound.startAmbient();
  }

  // --- Simulation Step (deterministic — called at fixed rate in MP, variable in SP) ---

  private _simulationStep(delta: number): void {
    if (!this.currentMap) return;

    // Advance deterministic game frame counter
    this._gameFrame++;
    UnitAI.gameFrame = this._gameFrame;

    // Debug: infinite resources
    if (this.hud.debugFlags.infiniteResources) {
      const lp = this._localPlayerIndex;
      this.woodStockpile[lp] = 999;
      this.stoneStockpile[lp] = 999;
      this.foodStockpile[lp] = 999;
      this.grassFiberStockpile[lp] = 999;
      this.clayStockpile[lp] = 999;
      this.ropeStockpile[lp] = 999;
      this.players[lp].resources.wood = 999;
      this.players[lp].resources.stone = 999;
      this.players[lp].resources.food = 999;
      this.players[lp].resources.gold = 999;
      this.players[lp].resources.grass_fiber = 999;
      this.players[lp].resources.clay = 999;
      this.players[lp].resources.rope = 999;
      this.ironStockpile[lp] = 999;
      this.charcoalStockpile[lp] = 999;
      this.steelStockpile[lp] = 999;
      this.crystalStockpile[lp] = 999;
      this.goldStockpile[lp] = 999;
      this.players[lp].resources.iron = 999;
      this.players[lp].resources.charcoal = 999;
      this.players[lp].resources.steel = 999;
      this.players[lp].resources.crystal = 999;
    }

    // Spawn queue processing
    this.spawnQueueSystem.update(delta);

    // Build unit-ID lookup map
    if (!this._unitById) this._unitById = new Map<string, Unit>();
    const unitById = this._unitById;
    unitById.clear();

    // Update occupied tiles for pathfinder
    Pathfinder.occupiedTiles.clear();
    for (let i = 0, len = this.allUnits.length; i < len; i++) {
      const unit = this.allUnits[i];
      if (unit.state !== UnitState.DEAD) {
        unitById.set(unit.id, unit);
        Pathfinder.occupiedTiles.add(tileKey(unit.position.q, unit.position.r));
      }
    }

    // Sync debug flags to UnitAI
    const df = UnitAI.debugFlags;
    df.disableChop = this.hud.debugFlags.disableChop;
    df.disableMine = this.hud.debugFlags.disableMine;
    df.disableHarvest = this.hud.debugFlags.disableHarvest;
    df.disableBuild = this.hud.debugFlags.disableBuild;
    df.disableDeposit = this.hud.debugFlags.disableDeposit;
    df.disableAutoReturn = this.hud.debugFlags.disableAutoReturn;
    df.disableCombat = this.hud.debugFlags.disableCombat;

    // Sync stockpiles to UnitAI
    UnitAI.stoneStockpile = this.stoneStockpile;
    UnitAI.ironStockpile = this.ironStockpile;
    UnitAI.clayStockpile = this.clayStockpile;
    UnitAI.crystalStockpile = this.crystalStockpile;
    UnitAI.goldStockpile = this.goldStockpile;
    UnitAI.charcoalStockpile = this.charcoalStockpile;
    UnitAI.steelStockpile = this.steelStockpile;
    UnitAI.placedBuildings = this.buildingSystem.placedBuildings;
    UnitAI.tacticalGroupManager = this.tacticalGroupManager;

    // Tactical groups
    this.tacticalGroupManager.update(delta, this.allUnits);

    // Run unit AI (movement, combat, auto-attack)
    const events = UnitAI.update(this.players, this.currentMap, delta);

    // Player squad objectives — run for ALL human players for multiplayer determinism.
    // Advance timer once, then run for each player skipping the internal timer check.
    {
      UnitAI._playerObjTimer += delta;
      if (UnitAI._playerObjTimer >= UnitAI.PLAYER_OBJ_INTERVAL) {
        UnitAI._playerObjTimer = 0;
        for (let pid = 0; pid < this.playerCount; pid++) {
          if (this.players[pid]?.isAI) continue;
          UnitAI.updatePlayerObjectives(this.allUnits, this.bases, this.currentMap, delta, pid, true);
        }
      }
    }

    // Process combat events
    this.combatEventHandler.processEvents(events);

    // Garrison system
    this.garrisonSystem.update(delta);

    // Morale & starvation
    for (let pi = 0; pi < this.players.length; pi++) {
      this.populationSystem.applyStarvationDrain(pi, delta);
      UnitAI.moraleModifiers[pi] = this.populationSystem.getMoraleModifier(pi);
    }

    // Zone control capture system
    const captureEvents = this.captureZoneSystem.update(this.allUnits, delta);
    for (const evt of captureEvents) {
      this.handleCaptureEvent(evt);
    }

    // AI commander (for AI players)
    if (!this.hud.debugFlags.disableAI) {
      for (let pid = 0; pid < this.playerCount; pid++) {
        if (!this.players[pid]?.isAI) continue;
        if (this.players[pid].defeated) continue;
        this.aiController.updateSmartAICommander(pid, delta);
        this.aiController.updateSmartAIEconomy(pid, delta);
        this.aiController.updateSmartAISpawnQueue(pid, delta);
        this.aiController.updateSmartAITactics(pid, delta);
        this.aiController.updateSmartAIStrategy(pid, delta);
      }
    }

    // Nature simulation (tree regrowth, grass growth/spread)
    if (!this.hud.debugFlags.disableTreeGrowth || !this.hud.debugFlags.disableGrassGrowth) {
      this.natureSystem.update(delta);
    }

    // Base upgrades, population disband, and dead cleanup
    this.lifecycleUpdater.update(delta);
  }

  // --- RTS Game Loop ---

  private updateRTS(delta: number): void {
    if (!this.currentMap || this.players.length === 0 || this.gameOver) return;

    // ── Multiplayer: run ALL simulation at fixed tick rate for determinism ──
    // Both clients accumulate real time, then step simulation in identical
    // fixed-size increments so frame-rate differences don't cause desync.
    if (this.multiplayer.commandQueue.isMultiplayer) {
      const TICK_RATE = 1 / 20; // 20 ticks per second (50ms per tick)
      this._mpTickAccumulator += delta;
      while (this._mpTickAccumulator >= TICK_RATE) {
        this._mpTickAccumulator -= TICK_RATE;
        this.multiplayer.commandQueue.processTick();
        this._simulationStep(TICK_RATE);
      }
    } else {
      // Single-player: run simulation at variable frame rate (smooth feel)
      this._simulationStep(delta);
    }

    // --- Visual-only updates below (HUD, rendering, camera) — NOT simulation ---

    // --- Spawn queue HUD (visual only) ---

    // Update unified spawn queue HUD with progress bars — throttled to every 0.25s
    if (!this._spawnQueueHudTimer) this._spawnQueueHudTimer = 0;
    this._spawnQueueHudTimer += delta;
    if (this._spawnQueueHudTimer >= 0.25) {
      this._spawnQueueHudTimer = 0;
      const allQueueEntries = this.spawnQueueSystem.getQueueHUDEntries(this.hud.debugFlags, this._localPlayerIndex);
      // Add AI queues for all players
      for (let pid = 0; pid < this.aiController.aiState.length; pid++) {
        const st = this.aiController.aiState[pid];
        const label = this.players.length > 1 ? `P${pid + 1} ` : '';
        if (st.spawnQueue.length > 0) {
          allQueueEntries.push({
            kind: `${label}barracks`,
            color: pid === 0 ? '#3498db' : '#e74c3c',
            items: st.spawnQueue.map(q => ({ type: q.type })),
            timerProgress: st.spawnTimer / 5,
          });
        }
        if (st.workerSpawnQueue.length > 0) {
          allQueueEntries.push({
            kind: `${label}workers`,
            color: pid === 0 ? '#2ecc71' : '#e67e22',
            items: st.workerSpawnQueue.map(q => ({ type: q.type })),
            timerProgress: st.workerSpawnTimer / 4,
          });
        }
      }
      this.hud.updateAllSpawnQueues(allQueueEntries);
    }

    // ── VISUAL LOOP: Y-fix + position + animate + strafe + aggro (runs every frame) ──
    if (!this._unitById) this._unitById = new Map<string, Unit>();
    const unitById = this._unitById;
    // Note: unitById is populated inside _simulationStep; just reference it here
    const gameTime = this.clock.elapsedTime;
    const hasMap = !!this.currentMap;
    // Reuse aggro array — clear instead of reallocating
    if (!this._aggroList) this._aggroList = [] as Array<{ attackerId: string; targetId: string }>;
    const aggroList = this._aggroList;
    aggroList.length = 0;

    for (let i = 0, len = this.allUnits.length; i < len; i++) {
      const unit = this.allUnits[i];
      if (unit.state === UnitState.DEAD) continue;

      // ── Y-floor enforcement: prevent ANY unit from clipping below terrain ──
      if (hasMap) {
        const tile = this.currentMap!.tiles.get(tileKey(unit.position.q, unit.position.r));
        if (tile) {
          if (unit._underground && tile.hasTunnel) {
            const correctY = (tile.walkableFloor ?? tile.tunnelFloorY ?? tile.elevation) * 0.5 + 0.25;
            if (Math.abs(unit.worldPosition.y - correctY) > 0.5) {
              unit.worldPosition.y = correctY;
            }
          } else if (!unit._underground) {
            const floorY = tile.elevation * 0.5 + 0.25;
            if (unit.worldPosition.y < floorY - 0.02) {
              unit.worldPosition.y = floorY;
            }
          }
        }
      }

      // Set visual position (pass elevation state for organic hop/climb effects)
      this.unitRenderer.setWorldPosition(
        unit.id,
        unit.worldPosition.x,
        unit.worldPosition.y,
        unit.worldPosition.z,
        unit._elevActive,
        unit._elevGoingUp,
        unit._elevProgress
      );

      // Animate
      this.unitRenderer.animateUnit(unit.id, unit.state, gameTime, unit.type);

      // Face target + strafe (uses Map lookup instead of .find())
      if (unit.command?.targetUnitId) {
        const target = unitById.get(unit.command.targetUnitId);
        if (target && target.state !== UnitState.DEAD) {
          if (unit.state === UnitState.ATTACKING) {
            this.unitRenderer.applyCombatStrafe(unit.id, target.worldPosition, gameTime);
          }
          this.unitRenderer.faceTarget(unit.id, target.worldPosition);
        }
        // Build aggro list inline
        if (unit.state === UnitState.ATTACKING || unit.state === UnitState.MOVING) {
          aggroList.push({ attackerId: unit.id, targetId: unit.command.targetUnitId });
        }
      }
    }
    this.unitRenderer.updateAggroIndicators(aggroList, gameTime);

    // Update ambient combat intensity based on number of active combats
    const combatIntensity = Math.min(1, aggroList.length / 10);
    this.sound.setAmbientCombatIntensity(combatIntensity);

    // ── Squad indicators: collect active squads and render labels + rings ──
    this.squadIndicatorSystem.update(gameTime);

    // Update attack target hover ring (pulse + follow)
    this.unitRenderer.updateAttackTargetRing(gameTime);

    // Update swing streak trails (fade out + cleanup)
    this.unitRenderer.updateSwingTrails(gameTime);

    // Update projectiles (arrows in flight) + trail particles (sparks, smoke) + deferred effects
    this.unitRenderer.updateProjectiles(delta);
    this.unitRenderer.updateDeferredEffects();
    this.unitRenderer.updateTrailParticles();

    // Capture zone billboards (visual only — simulation done in _simulationStep)
    this.captureZoneSystem.updateBillboards(this.camera.camera);
    this.hud.updateCaptureZones(this.captureZoneSystem.getZones());

    // Update enemy resource bar (reuse cached object to avoid per-frame allocation)
    // In PvP, the "enemy" is whichever player is NOT the local player
    const enemyIdx = this._localPlayerIndex === 0 ? 1 : 0;
    if (this.playerCount > 2) {
      // FFA mode: show all enemy players' resources
      if (!this._ffaEnemyCache) this._ffaEnemyCache = [];
      const cache = this._ffaEnemyCache;
      cache.length = 0;
      for (let i = 0; i < this.playerCount; i++) {
        if (i === this._localPlayerIndex) continue; // skip self
        const p = this.players[i];
        if (!p) continue;
        cache.push({
          playerId: i,
          name: HUD.TEAM_NAMES[i] || `Player ${i + 1}`,
          color: getPlayerCSS(i),
          units: p.units,
          stockpiles: {
            wood: this.woodStockpile[i], food: this.foodStockpile[i],
            stone: this.stoneStockpile[i], iron: this.ironStockpile[i],
            crystal: this.crystalStockpile[i], gold: this.goldStockpile[i],
          },
          defeated: p.defeated,
        });
      }
      this.hud.updateFfaEnemyResources(cache);
    } else {
      if (!this._enemyResCache) this._enemyResCache = { wood: 0, food: 0, stone: 0, iron: 0, crystal: 0, grassFiber: 0, clay: 0, charcoal: 0, rope: 0, steel: 0, gold: 0 };
      const erc = this._enemyResCache;
      erc.wood = this.woodStockpile[enemyIdx]; erc.food = this.foodStockpile[enemyIdx]; erc.stone = this.stoneStockpile[enemyIdx];
      erc.iron = this.ironStockpile[enemyIdx]; erc.crystal = this.crystalStockpile[enemyIdx]; erc.grassFiber = this.grassFiberStockpile[enemyIdx];
      erc.clay = this.clayStockpile[enemyIdx]; erc.charcoal = this.charcoalStockpile[enemyIdx]; erc.rope = this.ropeStockpile[enemyIdx];
      erc.steel = this.steelStockpile[enemyIdx]; erc.gold = this.goldStockpile[enemyIdx];
      this.hud.updateEnemyResources(this.players[enemyIdx], erc);
    }

    // Update base health bar billboards
    this.baseRenderer.updateBillboards(this.camera.camera);

    // Update wall/gate health bar billboards + debris particles
    this.wallSystem.updateBillboards(this.camera.camera);

    // Update HUD resource display with wood stockpile + population cap info
    // Throttle popInfo to every 0.5s to avoid per-frame .filter() allocations
    this._popInfoTimer += delta;
    if (this._popInfoTimer >= 0.5 || !this._popInfoCache) {
      this._popInfoTimer = 0;
      if (this.populationSystem) {
        this._popInfoCache = {
          current: this.populationSystem.getCombatUnitCount(this._lp),
          cap: this.populationSystem.getPopulationCap(this._lp),
        };
      }
    }
    this.hud.updateResources(this.players[this._lp], this.woodStockpile[this._lp], this.foodStockpile[this._lp], this.stoneStockpile[this._lp], this._popInfoCache);

    // Army strength comparison bar (throttled to 2Hz internally)
    if (this.players.length >= 2) {
      const allPlayersForBar = this.players.map((p, i) => ({
        units: p.units,
        color: getPlayerCSS(i),
      }));
      this.hud.updateArmyStrength(
        this.players[0].units,
        this.players[1].units,
        this.players.length > 2 ? allPlayersForBar : undefined,
      );
    }

    // Update wall build mode cost preview when in wall mode
    if (this.interaction.state.kind === 'wall_build') {
      const bpInfo = this.blueprintSystem.getBlueprintCounts();
      this.hud.updateBuildModeInfo(bpInfo, this.stoneStockpile[this._localPlayerIndex]);
    }

    // Update unit stats panel (if visible — throttled to every 0.5s)
    if (!this._unitStatsPanelTimer) this._unitStatsPanelTimer = 0;
    this._unitStatsPanelTimer += delta;
    if (this._unitStatsPanelTimer >= 0.5) {
      this._unitStatsPanelTimer = 0;
      this.hud.updateUnitStatsPanel(this.allUnits, this._deadUnitKills);
    }

    // Update selection info — throttled to every 0.3s
    if (!this._selInfoTimer) this._selInfoTimer = 0;
    this._selInfoTimer += delta;
    if (this._selInfoTimer >= 0.3) {
      this._selInfoTimer = 0;
      const sel = this.selectionManager.getSelectedUnits();
      if (sel.length > 0) {
        this.hud.updateSelectionInfo(sel);
        // Speech bubble: bark 'select' when selection changes (detect via lead unit id)
        const leadId = sel[0].id;
        if (leadId !== this._lastSelectBarkId) {
          this._lastSelectBarkId = leadId;
          this.unitRenderer.triggerSpeechBubble(sel[0].id, sel[0].type, 'select');
        }
      } else {
        this._lastSelectBarkId = '';
      }
    }
  }

  /** Handle a zone capture event — flip base ownership, inherit buildings, or trigger defeat */
  private handleCaptureEvent(evt: CaptureEvent): void {
    const base = this.bases.find(b => b.id === evt.baseId);
    if (!base) return;

    Logger.info('CaptureZone', `Base ${evt.baseId} captured by player ${evt.newOwner} (was ${evt.previousOwner})`);

    // Re-render base with new team colors and flag — preserve original Y for underground bases
    const zone = this.captureZoneSystem.getZoneForBase(evt.baseId);
    const elev = zone?.isUnderground ? base.worldPosition.y - 0.25 : this.getElevation(base.position);
    this.baseRenderer.addBase(base, elev);
    this.captureZoneSystem.refreshZoneVisuals(evt.baseId);

    // Register as new base position for the capturer
    UnitAI.basePositions.set(evt.newOwner, base.position);

    // Transfer buildings in the zone to the new owner
    const ZONE_RADIUS = 5;
    for (const pb of this.buildingSystem.placedBuildings) {
      if (pb.owner === evt.previousOwner) {
        const dist = Pathfinder.heuristic(pb.position, base.position);
        if (dist <= ZONE_RADIUS) {
          pb.owner = evt.newOwner;
          // Re-render building with new team colors
          this.buildingSystem.refreshBuildingMesh(pb);
          Logger.debug('CaptureZone', `Transferred ${pb.kind} at (${pb.position.q},${pb.position.r}) to player ${evt.newOwner}`);
        }
      }
    }

    // Transfer walls in the zone
    for (const [wallKey, wallOwner] of this.wallSystem.wallOwners) {
      if (wallOwner === evt.previousOwner) {
        const [wq, wr] = wallKey.split(',').map(Number);
        const dist = Pathfinder.heuristic({ q: wq, r: wr }, base.position);
        if (dist <= ZONE_RADIUS) {
          this.wallSystem.wallOwners.set(wallKey, evt.newOwner);
          UnitAI.wallOwners.set(wallKey, evt.newOwner);
          this.wallSystem.buildAdaptiveWallMesh({ q: wq, r: wr }, evt.newOwner);
        }
      }
    }

    // AI outpost building — if an AI captures an outpost, build forward-operating buildings
    const capturerIsAI = this.players[evt.newOwner]?.isAI ?? false;
    if (capturerIsAI && !evt.isMainBase) {
      this.aiController.onBaseCapture(evt.newOwner, base.position);
    }

    // Notification — N-player aware
    const colorName = PLAYER_COLORS[evt.newOwner]?.name ?? `Player ${evt.newOwner}`;
    const isHumanCapture = !capturerIsAI;
    const capturerName = (evt.newOwner === this._localPlayerIndex) ? 'You' : colorName;
    const capturerCSS = getPlayerCSS(evt.newOwner);
    const baseLabel = evt.isMainBase ? 'main base' : 'outpost';

    if (evt.isMainBase) {
      // Main base captured = defeat for the previous owner
      this.hud.showNotification(`${capturerName} captured a ${baseLabel}!`, capturerCSS);

      // Mark the previous owner as defeated
      if (this.players[evt.previousOwner]) {
        this.players[evt.previousOwner].defeated = true;
      }

      // Check: how many players remain un-defeated?
      const alive = this.players.filter(p => !p.defeated);
      if (alive.length <= 1) {
        // Game over — last player standing wins
        this.gameOver = true;
        const winnerId = alive.length === 1 ? alive[0].id : evt.newOwner;

        // Determine if the LOCAL player won.
        // In multiplayer, the local player may be owner 0 (host) or 1 (guest).
        const localOwner = this._localPlayerIndex;
        const isVictory = winnerId === localOwner && this.gameMode !== 'aivai';

        let winner: string;
        if (this.gameMode === 'aivai') {
          winner = `AI ${PLAYER_COLORS[winnerId]?.name?.toUpperCase() ?? winnerId}`;
        } else if (winnerId === localOwner) {
          winner = this.multiplayer.commandQueue.isMultiplayer ? (this._multiplayerOpponentName ? 'YOU' : 'PLAYER') : 'PLAYER';
        } else {
          winner = this.multiplayer.commandQueue.isMultiplayer
            ? (this._multiplayerOpponentName || `Player ${winnerId + 1}`)
            : `AI ${PLAYER_COLORS[winnerId]?.name?.toUpperCase() ?? winnerId}`;
        }
        // Report match result to multiplayer controller (ELO update + Firebase)
        if (this.multiplayer.commandQueue.isMultiplayer && this.multiplayer.isInMatch) {
          this.multiplayer.reportMatchResult(isVictory).then((eloResult) => {
            if (eloResult && this.multiplayerUI) {
              // Show ELO change on the result screen
              console.log(`[MP] Match result reported: ${isVictory ? 'WIN' : 'LOSS'}, ELO: ${eloResult.newElo} (${eloResult.change >= 0 ? '+' : ''}${eloResult.change})`);
            }
          }).catch((err) => {
            console.warn('[MP] Failed to report match result:', err);
          });
        }

        this.sound.stopAmbient();
        this.sound.play(isVictory ? 'victory' : 'defeat', 0.8);
        this.showGameOverScreen(winner, isVictory);
      }
    } else {
      this.sound.play('zone_captured', 0.5);
      this.hud.showNotification(`${capturerName} captured an ${baseLabel}!`, capturerCSS);
    }
  }

  /** Debug: check for destroyed bases (from instant win/lose debug commands) */
  private debugCheckWinCondition(): void {
    for (const base of this.bases) {
      if (base.id.includes('neutral')) continue;
      if (base.destroyed) {
        // Determine the new owner — pick first alive enemy
        const prevOwner = base.owner;
        const newOwner = this.players.findIndex((p, i) => i !== prevOwner && !p.defeated);
        if (newOwner < 0) continue;
        this.handleCaptureEvent({
          baseId: base.id,
          newOwner,
          previousOwner: prevOwner,
          isMainBase: true,
        });
        return;
      }
    }
  }

  private showGameOverScreen(winner: string, isVictory: boolean): void {
    // Compute game stats for the battle report
    let stats: GameOverStats | undefined;
    try {
      const player = this.players[this._localPlayerIndex];
      const enemy = this.players[this._localPlayerIndex === 0 ? 1 : 0];
      if (player && enemy) {
        // Count alive and dead units per player
        const playerAlive = player.units.filter(u => u.state !== UnitState.DEAD);
        const playerDead = player.units.filter(u => u.state === UnitState.DEAD);
        const enemyDead = enemy.units.filter(u => u.state === UnitState.DEAD);

        // Sum kills from alive units + kills from dead units
        const playerKills = player.units.reduce((sum, u) => sum + (u.kills ?? 0), 0);
        const enemyKills = enemy.units.reduce((sum, u) => sum + (u.kills ?? 0), 0);

        // Zones held by player
        const playerBases = this.bases.filter(b => b.owner === this._localPlayerIndex && !b.destroyed).length;
        const totalBases = this.bases.filter(b => !b.id.includes('neutral') || b.owner >= 0).length;

        // Player main base tier — use capture zone system for isMainBase info,
        // fall back to first player-owned base
        const czZones = this.captureZoneSystem?.getZones() ?? [];
        const playerMainZone = czZones.find(z => z.isMainBase && z.base.owner === this._localPlayerIndex);
        const playerMainBase = playerMainZone?.base ?? this.bases.find(b => b.owner === this._localPlayerIndex);
        const playerBaseTier = playerMainBase?.tier ?? 0;

        stats = {
          gameDuration: this.clock.elapsedTime,
          playerUnitsKilled: playerKills,
          playerUnitsLost: playerDead.length,
          enemyUnitsKilled: enemyKills,
          enemyUnitsLost: enemyDead.length,
          basesOwned: playerBases,
          totalBases,
          playerBaseTier,
        };
      }
    } catch {
      // If stats computation fails, continue without stats
    }
    this.menuController.showGameOverScreen(winner, isVictory, this.gameMode, stats);
  }

  // --- Centralized resource pool (backing store for all stockpiles) ---
  private resourcePool = new ResourcePool(2);
  // Legacy array references — point to ResourcePool's backing arrays for backward compatibility
  private woodStockpile: number[] = this.resourcePool.array('wood');
  // Wall/gate state is managed by WallSystem (this.wallSystem)

  /** Y-level from slicer for troop commands — null means surface, number means underground */
  commandYLevel: number | null = null;
  // Interaction mode state fully managed by InteractionStateMachine (legacy getters removed 2026-04-01)
  private stoneStockpile: number[] = this.resourcePool.array('stone');

  // Query/registry methods are in BuildingSystem — accessed via this.buildingSystem.*

  // showBuildingTooltip → moved to BuildingTooltipController

  /** Queue a unit from the building tooltip */
  /** Demolish a player building, removing it from the world and refunding some resources */
  private demolishBuilding(pb: PlacedBuilding): void {
    if (pb.owner !== this._localPlayerIndex) return; // Only local player can demolish their own
    // Refund half the build cost in wood
    const refunds: Record<BuildingKind, number> = {
      barracks: GAME_CONFIG.buildings.barracks.refund.wood,
      forestry: GAME_CONFIG.buildings.forestry.refund.wood,
      masonry: GAME_CONFIG.buildings.masonry.refund.wood,
      farmhouse: GAME_CONFIG.buildings.farmhouse.refund.wood,
      workshop: GAME_CONFIG.buildings.workshop.refund.wood,
      silo: GAME_CONFIG.buildings.silo.refund.wood,
      smelter: GAME_CONFIG.buildings.smelter.refund.wood,
      armory: GAME_CONFIG.buildings.armory.refund.wood,
      wizard_tower: GAME_CONFIG.buildings.wizard_tower.refund.wood,
      mine: 3,
      market: 3,
    };
    const refund = refunds[pb.kind] ?? 3;
    const demolishOwner = pb.owner;
    this.woodStockpile[demolishOwner] += refund;
    this.players[demolishOwner].resources.wood += refund;
    if (demolishOwner === this._localPlayerIndex) {
      this.hud.updateResources(this.players[demolishOwner], this.woodStockpile[demolishOwner], this.foodStockpile[demolishOwner], this.stoneStockpile[demolishOwner]);
    }
    this.buildingSystem.unregisterBuilding(pb);
    this.hud.showNotification(`${pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1)} demolished. Refunded ${refund} wood.`);
  }

  /** Send selected units to the nearest non-owned zone (from selection panel button) */
  private captureNearestZoneWithSelected(): void {
    if (!this.currentMap) return;
    const selected = this.selectionManager.getSelectedUnits().filter(
      u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u)
    );
    if (selected.length === 0) {
      this.hud.showNotification('No combat units selected!', '#e74c3c');
      return;
    }

    // Find nearest non-owned base from the centroid of selected units
    const avgQ = Math.round(selected.reduce((s, u) => s + u.position.q, 0) / selected.length);
    const avgR = Math.round(selected.reduce((s, u) => s + u.position.r, 0) / selected.length);
    const from: HexCoord = { q: avgQ, r: avgR };

    const targets = this.bases
      .filter(b => b.owner !== this._localPlayerIndex && !b.destroyed)
      .sort((a, b) => {
        // Neutral first, then by distance
        const aN = a.owner >= this.playerCount ? 0 : 1;
        const bN = b.owner >= this.playerCount ? 0 : 1;
        if (aN !== bN) return aN - bN;
        return Pathfinder.heuristic(from, a.position) - Pathfinder.heuristic(from, b.position);
      });

    if (targets.length === 0) {
      this.hud.showNotification('No zones to capture!', '#e67e22');
      return;
    }

    const target = targets[0];
    for (const unit of selected) {
      unit._playerCommanded = true;
      unit.stance = UnitStance.DEFENSIVE;
      UnitAI.commandMove(unit, target.position, this.currentMap!);
    }

    const label = target.owner >= this.playerCount ? 'neutral outpost' : 'enemy zone';
    this.hud.showNotification(`${selected.length} units capturing ${label}!`, '#27ae60');
    const elev = this.getElevation(target.position);
    this.tileHighlighter.showAttackIndicator(target.position, elev);
  }

  /** Order selected/all combat units to attack-move to a structure (from tooltip) */
  private attackTargetFromTooltip(position: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits().filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD);
    const units = selected.length > 0
      ? selected
      : this.allUnits.filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u));

    if (units.length === 0) {
      this.hud.showNotification('No combat units available!', '#e74c3c');
      return;
    }

    for (const unit of units) {
      unit._playerCommanded = true;
      UnitAI.commandAttack(unit, position, null, this.currentMap!);
    }
    this.hud.showNotification(`${units.length} units attacking!`, '#e74c3c');

    const elev = this.getElevation(position);
    this.tileHighlighter.showAttackIndicator(position, elev);
  }

  /** Order selected units to focus-attack a specific enemy unit (chase & kill — from tooltip) */
  private focusAttackUnitFromTooltip(unitId: string, position: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits().filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD);
    const units = selected.length > 0
      ? selected
      : this.allUnits.filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u));

    if (units.length === 0) {
      this.hud.showNotification('No combat units available!', '#e74c3c');
      return;
    }

    for (const unit of units) {
      unit._playerCommanded = true;
      unit._forceMove = false;
      unit._focusTarget = unitId;
      UnitAI.commandAttack(unit, position, unitId, this.currentMap!);
    }
    this.hud.showNotification(`${units.length} units focus-targeting!`, '#e74c3c');

    const elev = this.getElevation(position);
    this.tileHighlighter.showAttackIndicator(position, elev);
  }

  /** Order selected/all combat units to capture a zone (move + defensive stance) */
  private captureZoneFromTooltip(position: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits().filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD);
    const units = selected.length > 0
      ? selected
      : this.allUnits.filter(u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u));

    if (units.length === 0) {
      this.hud.showNotification('No combat units available!', '#e74c3c');
      return;
    }

    // commandMove auto-detects underground bases via UnitAI.isUndergroundBase
    for (const unit of units) {
      unit._playerCommanded = true;
      unit.stance = UnitStance.DEFENSIVE;
      UnitAI.commandMove(unit, position, this.currentMap!);
    }
    this.hud.showNotification(`${units.length} units moving to capture zone!`, '#27ae60');

    const elev = this.getElevation(position);
    this.tileHighlighter.showAttackIndicator(position, elev);
  }

  /** Set rally point for all combat buildings + base to a target position (from tooltip).
   *  Each rally is routed through the command queue for multiplayer sync. */
  private setRallyToPositionFromTooltip(position: HexCoord): void {
    // Set rally for all player combat buildings (barracks, armory, wizard_tower)
    const combatKinds: BuildingKind[] = ['barracks', 'armory', 'wizard_tower'];
    let count = 0;
    for (const pb of this.buildingSystem.placedBuildings) {
      if (pb.owner === this._localPlayerIndex && combatKinds.includes(pb.kind)) {
        this.enqueueCommand(NetCommandType.SET_RALLY_POINT, { buildingId: pb.kind, position });
        count++;
      }
    }
    // Also set rally for the player's base (ogre spawns)
    this.enqueueCommand(NetCommandType.SET_RALLY_POINT, { buildingId: 'base', position });
    count++;
    if (count > 0) {
      this.hud.showNotification(`Rally point set for ${count} buildings`, '#2980b9');
    } else {
      this.hud.showNotification('No combat buildings to rally!', '#e67e22');
    }
  }

  // Placement mode flags & rotation → replaced by InteractionStateMachine
  private foodStockpile: number[] = this.resourcePool.array('food');
  // clearedPlains moved to NatureSystem

  // Workshop, Smelter, Armory, Wizard Tower → placement managed by InteractionStateMachine

  // --- Attack-Move Mode (League-style) ---
  private _attackMoveIndicator: THREE.Mesh | null = null;

  // --- Grass Fiber, Clay, Rope Stockpiles ---
  private grassFiberStockpile: number[] = this.resourcePool.array('grass_fiber');
  private clayStockpile: number[] = this.resourcePool.array('clay');
  private ropeStockpile: number[] = this.resourcePool.array('rope');
  private ironStockpile: number[] = this.resourcePool.array('iron');
  private charcoalStockpile: number[] = this.resourcePool.array('charcoal');
  private steelStockpile: number[] = this.resourcePool.array('steel');
  private crystalStockpile: number[] = this.resourcePool.array('crystal');
  private goldStockpile: number[] = this.resourcePool.array('gold');

  /** Reset all stockpiles via ResourcePool and rebind legacy array references */
  private resetStockpiles(playerCount: number): void {
    this.resourcePool.reset(playerCount);
    // Rebind all legacy array references to the new backing arrays
    this.woodStockpile = this.resourcePool.array('wood');
    this.stoneStockpile = this.resourcePool.array('stone');
    this.foodStockpile = this.resourcePool.array('food');
    this.grassFiberStockpile = this.resourcePool.array('grass_fiber');
    this.clayStockpile = this.resourcePool.array('clay');
    this.ropeStockpile = this.resourcePool.array('rope');
    this.ironStockpile = this.resourcePool.array('iron');
    this.charcoalStockpile = this.resourcePool.array('charcoal');
    this.steelStockpile = this.resourcePool.array('steel');
    this.crystalStockpile = this.resourcePool.array('crystal');
    this.goldStockpile = this.resourcePool.array('gold');
    // Set starting values
    for (let i = 0; i < playerCount; i++) {
      this.woodStockpile[i] = 30;
      this.foodStockpile[i] = GAME_CONFIG.population.startingFood;
    }
  }

  // --- Nested Menu System ---
  // Category 0 = none, 1 = combat, 2 = economy, 3 = crafting
  private menuCategory: 0 | 1 | 2 | 3 = 0;
  private menuBuildingIndex = 0; // which building within the category is selected

  // Data-driven menu config: category → array of buildings, each with QWERTY actions
  private static readonly MENU_CATEGORIES: {
    name: string;
    buildings: {
      kind: BuildingKind;
      label: string;
      color: string;
      actions: { key: string; label: string; action: string; }[];
    }[];
  }[] = [
    { // Category 1: Combat
      name: '⚔️ COMBAT',
      buildings: [
        {
          kind: 'barracks', label: 'Barracks', color: '#e67e22',
          actions: [
            { key: 'Q', label: `Warrior (${GAME_CONFIG.units[UnitType.WARRIOR].costs.menu.gold}g)`, action: `spawn:barracks:WARRIOR:${GAME_CONFIG.units[UnitType.WARRIOR].costs.menu.gold}` },
            { key: 'W', label: `Archer (${GAME_CONFIG.units[UnitType.ARCHER].costs.menu.gold}g)`, action: `spawn:barracks:ARCHER:${GAME_CONFIG.units[UnitType.ARCHER].costs.menu.gold}` },
            { key: 'E', label: `Rider (${GAME_CONFIG.units[UnitType.RIDER].costs.menu.gold}g)`, action: `spawn:barracks:RIDER:${GAME_CONFIG.units[UnitType.RIDER].costs.menu.gold}` },
            { key: 'R', label: `Scout (${GAME_CONFIG.units[UnitType.SCOUT].costs.menu.gold}g)`, action: `spawn:barracks:SCOUT:${GAME_CONFIG.units[UnitType.SCOUT].costs.menu.gold}` },
          ],
        },
        {
          kind: 'armory', label: 'Armory', color: '#708090',
          actions: [
            { key: 'Q', label: `Greatsword (${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.steel}s)`, action: `spawn:armory:GREATSWORD:${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.gold}:${GAME_CONFIG.units[UnitType.GREATSWORD].costs.menu.steel}` },
            { key: 'W', label: `Assassin (${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.steel}s)`, action: `spawn:armory:ASSASSIN:${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.gold}:${GAME_CONFIG.units[UnitType.ASSASSIN].costs.menu.steel}` },
            { key: 'E', label: `Berserker (${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.steel}s)`, action: `spawn:armory:BERSERKER:${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.gold}:${GAME_CONFIG.units[UnitType.BERSERKER].costs.menu.steel}` },
            { key: 'R', label: `Shieldbearer (${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.steel}s)`, action: `spawn:armory:SHIELDBEARER:${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.gold}:${GAME_CONFIG.units[UnitType.SHIELDBEARER].costs.menu.steel}` },
          ],
        },
        {
          kind: 'wizard_tower', label: 'Wizard Tower', color: '#6a0dad',
          actions: [
            { key: 'Q', label: `Mage (${GAME_CONFIG.units[UnitType.MAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.MAGE].costs.menu.crystal}c)`, action: `spawn:wizard_tower:MAGE:${GAME_CONFIG.units[UnitType.MAGE].costs.menu.gold}:${GAME_CONFIG.units[UnitType.MAGE].costs.menu.crystal}` },
            { key: 'W', label: `Battlemage (${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.crystal}c)`, action: `spawn:wizard_tower:BATTLEMAGE:${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.gold}:${GAME_CONFIG.units[UnitType.BATTLEMAGE].costs.menu.crystal}` },
            { key: 'E', label: `Healer (${GAME_CONFIG.units[UnitType.HEALER].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.HEALER].costs.menu.crystal}c)`, action: `spawn:wizard_tower:HEALER:${GAME_CONFIG.units[UnitType.HEALER].costs.menu.gold}:${GAME_CONFIG.units[UnitType.HEALER].costs.menu.crystal}` },
            { key: 'R', label: `Paladin (${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}g+${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.crystal}c)`, action: `spawn:wizard_tower:PALADIN:${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}:${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.crystal}` },
          ],
        },
      ],
    },
    { // Category 2: Economy
      name: '🏭 ECONOMY',
      buildings: [
        {
          kind: 'forestry', label: 'Forestry', color: '#6b8e23',
          actions: [
            { key: 'Q', label: `Lumberjack (${GAME_CONFIG.units[UnitType.LUMBERJACK].costs.menu.wood}w)`, action: `spawn:forestry:LUMBERJACK:${GAME_CONFIG.units[UnitType.LUMBERJACK].costs.menu.wood}` },
            { key: 'W', label: 'Chop Trees', action: 'action:harvest' },
            { key: 'E', label: 'Plant Trees', action: 'action:plantTree' },
          ],
        },
        {
          kind: 'masonry', label: 'Masonry', color: '#b08050',
          actions: [
            { key: 'Q', label: `Builder (${GAME_CONFIG.units[UnitType.BUILDER].costs.menu.wood}w)`, action: `spawn:masonry:BUILDER:${GAME_CONFIG.units[UnitType.BUILDER].costs.menu.wood}` },
            { key: 'W', label: 'Mine Terrain', action: 'action:mine' },
            { key: 'E', label: 'Build Walls', action: 'action:walls' },
          ],
        },
        {
          kind: 'farmhouse', label: 'Farmhouse', color: '#daa520',
          actions: [
            { key: 'Q', label: `Villager (${GAME_CONFIG.units[UnitType.VILLAGER].costs.menu.wood}w)`, action: `spawn:farmhouse:VILLAGER:${GAME_CONFIG.units[UnitType.VILLAGER].costs.menu.wood}` },
            { key: 'W', label: 'Farm/Hay', action: 'action:farmPatch' },
            { key: 'E', label: 'Plant Crops', action: 'action:plantCrops' },
          ],
        },
        {
          kind: 'workshop', label: 'Workshop', color: '#5d4037',
          actions: [
            { key: 'Q', label: 'Trebuchet', action: 'spawn:workshop:TREBUCHET' },
            { key: 'W', label: 'Craft Rope', action: 'craft:rope' },
            { key: 'E', label: 'Sell Wood', action: 'action:sellWood' },
          ],
        },
        {
          kind: 'mine', label: 'Mine', color: '#8b8682',
          actions: [
            { key: 'Q', label: `+2g/tick (${GAME_CONFIG.buildings.mine.cost.player.wood}w+${GAME_CONFIG.buildings.mine.cost.player.stone}s)`, action: 'info' },
          ],
        },
        {
          kind: 'market', label: 'Market', color: '#daa520',
          actions: [
            { key: 'Q', label: 'Sell Wood', action: 'action:sellWood' },
          ],
        },
      ],
    },
    { // Category 3: Crafting & Components
      name: '⚒️ CRAFTING',
      buildings: [
        {
          kind: 'smelter', label: 'Smelter', color: '#8b4513',
          actions: [
            { key: 'Q', label: `Smelt Steel (${GAME_CONFIG.economy.recipes.steel.input.iron}i+${GAME_CONFIG.economy.recipes.steel.input.charcoal}c)`, action: 'craft:steel' },
            { key: 'W', label: `Craft Charcoal (${GAME_CONFIG.economy.recipes.charcoal.input.wood}w+${GAME_CONFIG.economy.recipes.charcoal.input.clay}c)`, action: 'craft:charcoal' },
          ],
        },
        {
          kind: 'silo', label: 'Silo', color: '#c0c0c0',
          actions: [],
        },
      ],
    },
  ];

  /** Close all menus and clear any active placement/interaction mode */
  closeMenu(): void {
    this.menuCategory = 0;
    this.menuBuildingIndex = 0;
    this.clearAllModes();
    this.hud.updateNestedMenu(0, 0, Cubitopia.MENU_CATEGORIES);
  }

  private openMenuCategory(cat: 1 | 2 | 3): void {
    if (this.menuCategory === cat) {
      // Already in this category — close it
      this.menuCategory = 0;
      this.menuBuildingIndex = 0;
      this.clearAllModes();
      this.hud.updateNestedMenu(0, 0, Cubitopia.MENU_CATEGORIES);
      return;
    }
    this.menuCategory = cat;
    this.menuBuildingIndex = 0;
    // Activate placement mode for the first building in the category
    const building = Cubitopia.MENU_CATEGORIES[cat - 1].buildings[0];
    this.toggleBuildingPlaceMode(building.kind);
    this.sound.play('ui_click');
    this.hud.updateNestedMenu(this.menuCategory, this.menuBuildingIndex, Cubitopia.MENU_CATEGORIES);
  }

  private cycleBuildingInMenu(direction: number): void {
    if (this.menuCategory === 0) return;
    const cat = Cubitopia.MENU_CATEGORIES[this.menuCategory - 1];
    const savedCat = this.menuCategory;
    this.menuBuildingIndex = (this.menuBuildingIndex + direction + cat.buildings.length) % cat.buildings.length;
    const building = cat.buildings[this.menuBuildingIndex];
    this.toggleBuildingPlaceMode(building.kind);
    // Restore menu state (toggleBuildingPlaceMode calls clearAllModes internally — doesn't touch menu vars)
    this.menuCategory = savedCat;
    this.sound.play('ui_hover');
    this.hud.updateNestedMenu(this.menuCategory, this.menuBuildingIndex, Cubitopia.MENU_CATEGORIES);
  }

  private executeMenuAction(actionStr: string): void {
    const parts = actionStr.split(':');
    if (parts[0] === 'spawn') {
      const buildingKey = parts[1];
      const unitName = parts[2];
      const unitType = (UnitType as any)[unitName] as UnitType;
      if (unitType === undefined) {
        console.warn(`[MenuAction] Unknown unit type: ${unitName}`);
        return;
      }

      console.log(`[MenuAction] spawn: building=${buildingKey} unit=${unitType} localPlayer=${this._localPlayerIndex} isMP=${this.multiplayer.commandQueue.isMultiplayer}`);
      // Route through command queue so both peers execute the spawn
      this.enqueueCommand(NetCommandType.QUEUE_UNIT, { unitType, buildingKind: buildingKey });
    } else if (parts[0] === 'craft') {
      if (parts[1] === 'rope') { this.enqueueCommand(NetCommandType.CRAFT_ROPE, {}); }
      else if (parts[1] === 'steel') { this.enqueueCommand(NetCommandType.CRAFT_STEEL, {}); }
      else if (parts[1] === 'charcoal') { this.enqueueCommand(NetCommandType.CRAFT_CHARCOAL, {}); }
    } else if (parts[0] === 'action') {
      if (parts[1] === 'harvest') this.toggleHarvestMode();
      else if (parts[1] === 'mine') this.toggleMineMode();
      else if (parts[1] === 'walls') this.toggleBuildMode();
      else if (parts[1] === 'farmPatch') this.toggleFarmPatchMode();
      else if (parts[1] === 'plantTree') this.togglePlantTreeMode();
      else if (parts[1] === 'plantCrops') this.togglePlantCropsMode();
      else if (parts[1] === 'sellWood') this.enqueueCommand(NetCommandType.SELL_WOOD, {});
    }
  }

  // Rally point + garrison exit mode → managed by InteractionStateMachine

  // --- Formation state ---
  private selectedFormation: FormationType = FormationType.BOX;

  // AI state is managed by AIController (this.aiController.aiState)
  // AI meshes are tracked in aiController.aiState[pid].meshes

  // Building mesh creation + aiFindBuildTile are in BuildingSystem

  private handleChopWood(unit: Unit, treePos: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${treePos.q},${treePos.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile || (tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.JUNGLE)) return;

    // Convert forest/jungle to plains (tree chopped)
    tile.terrain = TerrainType.PLAINS;

    // Remove tree decorations visually
    this.terrainDecorator.removeDecoration(treePos);

    // Remove harvest marker if it exists
    this.blueprintSystem.removeHarvestMarker(treePos);

    // Wood yield scales with tree age: sapling=2, young=4, mature=6
    const age = this.natureSystem.getTreeAge(key) ?? 2; // default 2 (mature) for map-generated trees
    const woodYield = age === 0
      ? GAME_CONFIG.economy.harvest.tree.woodYieldByAge.sapling
      : age === 1
        ? GAME_CONFIG.economy.harvest.tree.woodYieldByAge.young
        : GAME_CONFIG.economy.harvest.tree.woodYieldByAge.mature;

    // Auto-replant: lumberjacks mark chopped tiles for guaranteed regrowth
    // (NatureSystem only regrows "original forest" tiles by default)
    this.natureSystem.markAsReGrowable(key);

    // Start regrowth timer, clean up growth tracking
    this.natureSystem.onTreeChopped(key);

    // Accumulate wood onto the lumberjack (multi-chop: add to existing carry)
    unit.carryAmount = Math.min((unit.carryAmount || 0) + woodYield, unit.carryCapacity);
    unit.carryType = ResourceType.WOOD;
  }

  /** Handle harvesting tall grass — yields food (hay) */
  private handleHarvestGrass(unit: Unit, pos: HexCoord): void {
    const key = `${pos.q},${pos.r}`;
    const tile = this.currentMap?.tiles.get(key);
    if (!tile) return;

    // Remove grass visual and reset to short stage
    this.terrainDecorator.removeGrassClump(key);
    this.blueprintSystem.removeHarvestMarker(pos);

    // Hay yield: 2-3 food per tall grass tile
    const hayYield = GAME_CONFIG.economy.harvest.grass.hayBase
      + GameRNG.rng.nextRange(0, GAME_CONFIG.economy.harvest.grass.hayVariance - 1);

    // Reset grass to short (stage 0) — it will regrow; mark as cleared plains
    this.natureSystem.onGrassHarvested(key, pos, tile.elevation * 0.5);

    // Grass fiber bonus — harvesting grass also yields fiber (plant material for rope)
    const fiberYield = GAME_CONFIG.economy.harvest.grass.fiberBase
      + GameRNG.rng.nextRange(0, GAME_CONFIG.economy.harvest.grass.fiberVariance - 1); // 1-2 fiber
    this.grassFiberStockpile[unit.owner] += fiberYield;
    this.players[unit.owner].resources.grass_fiber += fiberYield;
    if (unit.owner === this._localPlayerIndex) {
      this.hud.showNotification(`+${fiberYield} grass fiber`, '#8bc34a');
    }

    // Load food (hay) onto the unit
    unit.carryAmount = Math.min(hayYield, unit.carryCapacity);
    unit.carryType = ResourceType.FOOD;
  }

  // --- Data-driven building placement config ---
  private readonly BUILDING_PLACEMENT_CONFIG: Record<BuildingKind, {
    woodCost: number; stoneCost: number; steelCost?: number; crystalCost?: number;
    allowedTerrain: TerrainType[];
    maxHealth?: number;
    notification?: string;
    unitAIHook?: (coord: HexCoord) => void;
  }> = {
    barracks:      { woodCost: GAME_CONFIG.buildings.barracks.cost.player.wood, stoneCost: GAME_CONFIG.buildings.barracks.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], maxHealth: GAME_CONFIG.defenses.barracks.maxHealth, unitAIHook: (c) => UnitAI.barracksPositions.set(0, c) },
    forestry:      { woodCost: GAME_CONFIG.buildings.forestry.cost.player.wood, stoneCost: GAME_CONFIG.buildings.forestry.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Forestry built! Lumberjacks will drop off wood here.', unitAIHook: (c) => { const arr = UnitAI.forestryPositions.get(0) ?? []; arr.push(c); UnitAI.forestryPositions.set(0, arr); } },
    masonry:       { woodCost: GAME_CONFIG.buildings.masonry.cost.player.wood, stoneCost: GAME_CONFIG.buildings.masonry.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT] },
    farmhouse:     { woodCost: GAME_CONFIG.buildings.farmhouse.cost.player.wood, stoneCost: GAME_CONFIG.buildings.farmhouse.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Farmhouse built! Now build a Silo [I] and farm patches [J]', unitAIHook: (c) => UnitAI.farmhousePositions.set(0, c) },
    workshop:      { woodCost: GAME_CONFIG.buildings.workshop.cost.player.wood, stoneCost: GAME_CONFIG.buildings.workshop.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT, TerrainType.FOREST], notification: 'Workshop built!' },
    silo:          { woodCost: GAME_CONFIG.buildings.silo.cost.player.wood, stoneCost: GAME_CONFIG.buildings.silo.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Silo built! Villagers will carry crops here. Place farm patches [J]', unitAIHook: (c) => UnitAI.siloPositions.set(0, c) },
    smelter:       { woodCost: GAME_CONFIG.buildings.smelter.cost.player.wood, stoneCost: GAME_CONFIG.buildings.smelter.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: `Smelter built! Smelt steel with [Z] (${GAME_CONFIG.economy.recipes.steel.input.iron} iron + ${GAME_CONFIG.economy.recipes.steel.input.charcoal} charcoal)` },
    armory:        { woodCost: GAME_CONFIG.buildings.armory.cost.player.wood, stoneCost: GAME_CONFIG.buildings.armory.cost.player.stone, steelCost: GAME_CONFIG.buildings.armory.cost.player.steel, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Armory built! Train advanced melee units [6-9]' },
    wizard_tower:  { woodCost: GAME_CONFIG.buildings.wizard_tower.cost.player.wood, stoneCost: GAME_CONFIG.buildings.wizard_tower.cost.player.stone, crystalCost: GAME_CONFIG.buildings.wizard_tower.cost.player.crystal, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Wizard Tower built! Train magic units [0, Shift+1-2]' },
    mine:          { woodCost: GAME_CONFIG.buildings.mine.cost.player.wood, stoneCost: GAME_CONFIG.buildings.mine.cost.player.stone, allowedTerrain: [TerrainType.MOUNTAIN], notification: 'Mine built! Generates +2 gold per tick.' },
    market:        { woodCost: GAME_CONFIG.buildings.market.cost.player.wood, stoneCost: GAME_CONFIG.buildings.market.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Market built! Trade routes generate gold per owned base.' },
  };

  /** Generic building placement — called from CommandBridge for both local & remote players.
   *  Owner-aware: deducts from the correct player's resources and registers to the right team. */
  placeBuildingForOwner(kind: BuildingKind, coord: HexCoord, owner: number): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    const cfg = this.BUILDING_PLACEMENT_CONFIG[kind];
    if (!cfg) return;
    if (!cfg.allowedTerrain.includes(tile.terrain)) return;
    if (this.isTileOccupied(key)) return;

    // Resource check (skip if debug freePlace for most buildings; silo always charges)
    const skipCost = this.hud.debugFlags.freePlace && kind !== 'silo';
    if (!skipCost) {
      const steelNeeded = cfg.steelCost ?? 0;
      const crystalNeeded = cfg.crystalCost ?? 0;
      if (this.woodStockpile[owner] < cfg.woodCost || this.stoneStockpile[owner] < cfg.stoneCost
          || this.steelStockpile[owner] < steelNeeded || this.players[owner].resources.crystal < crystalNeeded) {
        return; // Can't afford — silently skip (pre-check caught it for local player)
      }
      this.woodStockpile[owner] -= cfg.woodCost;
      this.players[owner].resources.wood = Math.max(0, this.players[owner].resources.wood - cfg.woodCost);
      if (cfg.stoneCost > 0) {
        this.stoneStockpile[owner] -= cfg.stoneCost;
        this.players[owner].resources.stone = Math.max(0, this.players[owner].resources.stone - cfg.stoneCost);
      }
      if (steelNeeded > 0) {
        this.steelStockpile[owner] -= steelNeeded;
        this.players[owner].resources.steel = Math.max(0, this.players[owner].resources.steel - steelNeeded);
      }
      if (crystalNeeded > 0) {
        this.players[owner].resources.crystal = Math.max(0, this.players[owner].resources.crystal - crystalNeeded);
      }
    }
    if (owner === this._localPlayerIndex) {
      this.hud.updateResources(this.players[owner], this.woodStockpile[owner], this.foodStockpile[owner], this.stoneStockpile[owner]);
    }

    // Build mesh via BuildingSystem
    const meshMethodName = kind === 'wizard_tower' ? 'buildWizardTowerMesh'
      : `build${kind.charAt(0).toUpperCase() + kind.slice(1)}Mesh`;
    const meshBuilder = this.buildingSystem[meshMethodName as keyof BuildingSystem] as (pos: HexCoord, owner: number) => THREE.Group;
    const mesh = meshBuilder.call(this.buildingSystem, coord, owner);
    this.buildingSystem.registerBuilding(kind, owner, coord, mesh, cfg.maxHealth, true);

    // UnitAI hooks — set for the correct owner
    if (cfg.unitAIHook) {
      // Dynamically set the UnitAI position for the right owner
      if (kind === 'barracks') UnitAI.barracksPositions.set(owner, coord);
      else if (kind === 'farmhouse') UnitAI.farmhousePositions.set(owner, coord);
      else if (kind === 'silo') UnitAI.siloPositions.set(owner, coord);
      else if (kind === 'forestry') {
        const arr = UnitAI.forestryPositions.get(owner) ?? [];
        arr.push(coord);
        UnitAI.forestryPositions.set(owner, arr);
      }
    }

    this.resourceManager.updateStockpileVisual(owner);
    if (owner === this._localPlayerIndex) {
      this.hud.showNotification(`${kind} blueprint placed — builder needed!`, '#3498db');
    }
  }

  /** Spawn a unit for the given owner — called from CommandBridge for QUEUE_UNIT commands.
   *  Handles resource deduction, unit creation, and game registration for any player. */
  private spawnUnitForOwner(unitType: UnitType, buildingKind: BuildingKind, owner: number): void {
    console.log(`[Spawn] spawnUnitForOwner: type=${unitType} building=${buildingKind} owner=${owner} hasMap=${!!this.currentMap}`);
    if (!this.currentMap) { console.warn('[Spawn] ABORT: no map'); return; }
    const building = this.buildingSystem.getFirstBuilding(buildingKind, owner);
    if (!building) {
      console.warn(`[Spawn] ABORT: no ${buildingKind} for owner=${owner}. Buildings:`, this.buildingSystem.placedBuildings.map(b => `${b.kind}(owner=${b.owner})`).join(', '));
      return;
    }

    // Deduct cost based on unit type config
    const unitCfg = GAME_CONFIG.units[unitType];
    if (!unitCfg) { console.warn(`[Spawn] ABORT: no config for unitType=${unitType}`); return; }
    const costs = (unitCfg.costs as any)?.tooltipQueue ?? (unitCfg.costs as any)?.menu ?? (unitCfg.costs as any)?.playerQueue;
    if (!costs) { console.warn(`[Spawn] ABORT: no costs for ${unitType}`); return; }

    const skipCost = this.hud.debugFlags.freeBuild;
    console.log(`[Spawn] costs=`, JSON.stringify(costs), `owner=${owner} resources=`, JSON.stringify({
      gold: this.players[owner]?.resources.gold, wood: this.woodStockpile[owner],
      stone: this.stoneStockpile[owner], steel: this.steelStockpile[owner],
      crystal: this.players[owner]?.resources.crystal, rope: this.ropeStockpile[owner],
    }), `skipCost=${skipCost}`);
    if (!skipCost) {
      if (costs.gold && this.players[owner].resources.gold < costs.gold) { console.warn(`[Spawn] ABORT: not enough gold`); return; }
      if (costs.wood && this.woodStockpile[owner] < costs.wood) { console.warn(`[Spawn] ABORT: not enough wood`); return; }
      if (costs.stone && this.stoneStockpile[owner] < costs.stone) { console.warn(`[Spawn] ABORT: not enough stone`); return; }
      if (costs.steel && this.steelStockpile[owner] < costs.steel) { console.warn(`[Spawn] ABORT: not enough steel`); return; }
      if (costs.crystal && this.players[owner].resources.crystal < costs.crystal) { console.warn(`[Spawn] ABORT: not enough crystal`); return; }
      if (costs.rope && this.ropeStockpile[owner] < costs.rope) { console.warn(`[Spawn] ABORT: not enough rope`); return; }

      if (costs.gold) {
        this.players[owner].resources.gold -= costs.gold;
        this.goldStockpile[owner] = this.players[owner].resources.gold;
      }
      if (costs.wood) {
        this.woodStockpile[owner] -= costs.wood;
        this.players[owner].resources.wood = this.woodStockpile[owner];
      }
      if (costs.stone) {
        this.stoneStockpile[owner] -= costs.stone;
        this.players[owner].resources.stone = this.stoneStockpile[owner];
      }
      if (costs.steel) {
        this.steelStockpile[owner] -= costs.steel;
        this.players[owner].resources.steel = this.steelStockpile[owner];
      }
      if (costs.crystal) {
        this.players[owner].resources.crystal -= costs.crystal;
      }
      if (costs.rope) {
        this.ropeStockpile[owner] -= costs.rope;
        this.players[owner].resources.rope = this.ropeStockpile[owner];
      }
    }

    // Find spawn tile near the building
    const spawnPos = this.findSpawnTile(this.currentMap, building.position.q, building.position.r);
    if (!spawnPos) return;

    // Create the unit for the correct owner
    const unit = UnitFactory.create(unitType, owner, spawnPos);
    const wp = this.hexToWorld(spawnPos);
    unit.worldPosition = { ...wp };

    // Add to game
    this.players[owner].units.push(unit);
    this.allUnits.push(unit);
    this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);
    this.unitRenderer.addUnit(unit, this.getElevation(spawnPos));
    this.sound.play('unit_spawn' as any, 0.45);

    // Update HUD if it's the local player
    if (owner === this._localPlayerIndex) {
      this.hud.updateResources(this.players[owner], this.woodStockpile[owner], this.foodStockpile[owner], this.stoneStockpile[owner]);
    }
  }

  /** Public entry point: validates locally then enqueues a PLACE_BUILDING command.
   *  In single-player, executes immediately. In multiplayer, syncs to peer. */
  enqueueBuildingPlacement(kind: BuildingKind, coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;
    const cfg = this.BUILDING_PLACEMENT_CONFIG[kind];
    if (!cfg) return;
    if (!cfg.allowedTerrain.includes(tile.terrain)) return;
    if (this.isTileOccupied(key)) {
      this.hud.showNotification('Tile already occupied!', '#e67e22');
      return;
    }
    // Quick resource check for local player (gives instant feedback)
    const owner = this._localPlayerIndex;
    const skipCost = this.hud.debugFlags.freePlace && kind !== 'silo';
    if (!skipCost) {
      const steelNeeded = cfg.steelCost ?? 0;
      const crystalNeeded = cfg.crystalCost ?? 0;
      if (this.woodStockpile[owner] < cfg.woodCost || this.stoneStockpile[owner] < cfg.stoneCost
          || this.steelStockpile[owner] < steelNeeded || this.players[owner].resources.crystal < crystalNeeded) {
        const parts = [`${cfg.woodCost} wood`];
        if (cfg.stoneCost > 0) parts.push(`${cfg.stoneCost} stone`);
        if (steelNeeded > 0) parts.push(`${steelNeeded} steel`);
        if (crystalNeeded > 0) parts.push(`${crystalNeeded} crystal`);
        this.hud.showNotification(`Need ${parts.join(' + ')} to build ${kind}!`, '#e67e22');
        return;
      }
    }
    this.enqueueCommand(NetCommandType.PLACE_BUILDING, { kind, position: coord });
    this.exitPlacementMode(kind);
  }

  /** Exit placement mode after successful building placement */
  private exitPlacementMode(_kind: BuildingKind): void {
    this.interaction.clear();
  }

  // --- Workshop ---

  // toggleWorkshopMode → now handled by toggleBuildingPlaceMode('workshop')

  // placeWorkshop → now handled by placeGenericBuilding('workshop', coord)


  // --- Toggle modes for farmhouse, silo, farm patches ---

  // toggleFarmhouseMode, toggleSiloMode → now handled by toggleBuildingPlaceMode

  private toggleFarmPatchMode(): void {
    this.interaction.toggle({ kind: 'farm_patch' });
  }

  private togglePlantTreeMode(): void {
    this.interaction.toggle({ kind: 'plant_tree' });
  }

  /** Validate mine blueprint and enqueue through command queue for multiplayer sync */
  enqueuePaintMine(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;
    if (this.isWaterTerrain(tile.terrain as TerrainType)) return;

    const depth = this.blueprintSystem.mineDepthLayers;
    const sliceY = this.voxelBuilder.getSliceY();
    const topY = sliceY ?? (tile.elevation - 1);
    const bottomY = topY - depth + 1;

    const hasBlocks = tile.voxelData.blocks.some(
      (b: any) => b.localPosition.y >= bottomY && b.localPosition.y <= topY
    );
    if (!hasBlocks) return;
    if (UnitAI.playerMineBlueprint.has(key)) return;

    this.enqueueCommand(NetCommandType.PAINT_MINE, {
      position: coord,
      startY: topY,
      depth,
    });
  }

  /** Plant a tree sapling on a plains tile (costs 1 wood) — routed through command queue */
  private paintPlantTree(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Quick local validation (prevents queueing obviously invalid commands)
    if (tile.terrain !== TerrainType.PLAINS && tile.terrain !== TerrainType.MOUNTAIN) return;
    if (Pathfinder.blockedTiles.has(key)) return;
    if (UnitAI.farmPatches.has(key)) return;
    if (this.natureSystem.treeAge.has(key)) return;
    if (this.woodStockpile[this._localPlayerIndex] < GAME_CONFIG.economy.harvest.tree.plantCost.wood) return;

    // Route through command queue so both clients execute it
    this.enqueueCommand(NetCommandType.PLANT_TREE, { position: coord });
  }

  /** Clear all build/placement modes */
  private clearAllModes(): void {
    this.interaction.clear();
  }

  /** Sync HUD mode indicators to match the current InteractionState */
  private syncHUDMode(state: InteractionState): void {
    // Clear all HUD mode indicators first
    this.hud.setBuildMode(false);
    this.hud.setHarvestMode(false);
    this.hud.setMineMode(false);
    this.hud.setBarracksMode(false);
    this.hud.setForestryMode(false);
    this.hud.setMasonryMode(false);
    this.hud.setFarmhouseMode(false);
    this.hud.setSiloMode(false);
    this.hud.setFarmPatchMode(false);
    this.hud.setPlantTreeMode(false);
    this.hud.setPlantCropsMode(false);
    this.hud.setWorkshopMode(false);
    this.hud.setSmelterMode(false);
    this.hud.setArmoryMode(false);
    this.hud.setWizard_towerMode(false);
    this.hud.setRallyPointMode(false);

    // Activate the one that matches
    switch (state.kind) {
      case 'wall_build': this.hud.setBuildMode(true); break;
      case 'harvest': this.hud.setHarvestMode(true); break;
      case 'mine': this.hud.setMineMode(true, this.blueprintSystem.mineDepthLayers); break;
      case 'farm_patch': this.hud.setFarmPatchMode(true); break;
      case 'plant_tree': this.hud.setPlantTreeMode(true); break;
      case 'plant_crops': this.hud.setPlantCropsMode(true); break;
      case 'rally_point': this.hud.setRallyPointMode(true, state.buildingKey); break;
      case 'place_building': {
        const setters: Record<string, (v: boolean) => void> = {
          barracks: (v) => this.hud.setBarracksMode(v),
          forestry: (v) => this.hud.setForestryMode(v),
          masonry: (v) => this.hud.setMasonryMode(v),
          farmhouse: (v) => this.hud.setFarmhouseMode(v),
          silo: (v) => this.hud.setSiloMode(v),
          workshop: (v) => this.hud.setWorkshopMode(v),
          smelter: (v) => this.hud.setSmelterMode(v),
          armory: (v) => this.hud.setArmoryMode(v),
          wizard_tower: (v) => this.hud.setWizard_towerMode(v),
        };
        setters[state.building]?.(true);
        break;
      }
    }
  }

  // placeFarmhouse, placeSilo → now handled by placeGenericBuilding

  // addFarmPatchMarker, clearAllFarmPatchMarkers → moved to BlueprintSystem

  // doSpawnQueueFarmhouse → now handled by doSpawnQueueGeneric('farmhouse', ...)

  /** Get base tile positions that units should NOT walk onto */
  getBaseTiles(): Set<string> {
    const blocked = new Set<string>();
    for (const base of this.bases) {
      if (!base.destroyed) {
        // Block the base tile and its immediate neighbors
        blocked.add(`${base.position.q},${base.position.r}`);
        for (let dq = -1; dq <= 1; dq++) {
          for (let dr = -1; dr <= 1; dr++) {
            if (dq === 0 && dr === 0) continue;
            blocked.add(`${base.position.q + dq},${base.position.r + dr}`);
          }
        }
      }
    }
    return blocked;
  }

  private removeUnitFromGame(unit: Unit, killer?: Unit): void {
    Logger.debug('Combat', `${unit.type}(${unit.id}) owner=${unit.owner} hp=${unit.currentHealth}/${unit.stats.maxHealth}${killer ? ` killer=${killer.type}(${killer.id})` : ''}`);
    // Preserve this unit's kills in the team accumulator before removal
    if ((unit.kills ?? 0) > 0 && (unit.owner === 0 || unit.owner === 1)) {
      this._deadUnitKills[unit.owner] += unit.kills;
    }
    for (const player of this.players) {
      const idx = player.units.indexOf(unit);
      if (idx !== -1) {
        player.units.splice(idx, 1);
        break;
      }
    }
    this.allUnits = this.allUnits.filter(u => u !== unit);
    this.unitRenderer.removeUnit(unit.id);
    this.selectionManager.setPlayerUnits(this.allUnits, this._localPlayerIndex);
  }

  // Debug helpers
  get debugInfo() {
    return {
      units: this.allUnits.map(u => ({
        id: u.id, type: u.type, owner: u.owner, state: u.state,
        pos: u.position, wp: u.worldPosition, hp: u.currentHealth
      })),
      bases: this.bases.map(b => ({
        id: b.id, owner: b.owner, hp: b.health, max: b.maxHealth,
        pos: b.position, destroyed: b.destroyed,
      })),
      playerCount: this.players.length,
      gameOver: this.gameOver,
    };
  }

  // ===================== UNIT STANCES =====================

  private setSelectedUnitsStance(stance: UnitStance): void {
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) return;
    this.enqueueCommand(NetCommandType.SET_STANCE, {
      unitIds: selected.map(u => u.id),
      stance,
    });
    // Update the stance highlight without rebuilding the whole panel (local UI response)
    this.hud.updateStanceHighlight(stance);
    const label = stance === UnitStance.PASSIVE ? 'Passive' :
                  stance === UnitStance.DEFENSIVE ? 'Defensive' : 'Aggressive';
    this.hud.showNotification(`Stance: ${label}`, '#3498db');
  }

  // ===================== SQUAD OBJECTIVES =====================

  private setSelectedSquadObjective(objective: 'CAPTURE' | 'ASSAULT' | null): void {
    const selected = this.selectionManager.getSelectedUnits().filter(
      u => u.owner === this._localPlayerIndex && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u)
    );
    if (selected.length === 0) {
      this.hud.showNotification('No combat units selected!', '#e74c3c');
      return;
    }

    // Route through command queue for multiplayer sync
    // Squad ID assignment is deterministic (same allUnits state on both clients)
    let squadId: number | null = null;
    if (objective !== null) {
      squadId = selected.find(u => u._squadId != null)?._squadId ?? null;
      if (squadId == null) {
        const usedIds = new Set(this.allUnits.filter((u: Unit) => u.owner === this._localPlayerIndex && u._squadId != null).map((u: Unit) => u._squadId!));
        for (let id = 100; id < 110; id++) {
          if (!usedIds.has(id)) { squadId = id; break; }
        }
        if (squadId == null) squadId = 100;
      }
    }

    this.enqueueCommand(NetCommandType.SET_SQUAD_OBJECTIVE, {
      unitIds: selected.map(u => u.id),
      squadId: squadId ?? undefined,
      objective: objective ?? 'CLEAR',
    });

    // Local UI feedback (immediate, doesn't wait for queue processing)
    if (objective === null) {
      this.hud.showNotification(`${selected.length} units: Manual control`, '#7f8c8d');
    } else {
      const color = objective === 'CAPTURE' ? '#27ae60' : '#e74c3c';
      const icon = objective === 'CAPTURE' ? '🏴' : '⚔️';
      this.hud.showNotification(`${icon} ${selected.length} units: ${objective}`, color);
    }

    // Refresh the command panel to show the updated state
    this.hud.showSelectionCommandsPublic(selected);
  }

  // ===================== FORMATION SELECTOR =====================

  private setSelectedUnitsFormation(formation: FormationType): void {
    this.selectedFormation = formation;
    this.hud.updateFormationHighlight(formation);
    const label = formation === FormationType.LINE ? 'Line' :
                  formation === FormationType.BOX ? 'Box' :
                  formation === FormationType.WEDGE ? 'Wedge' : 'Circle';
    this.hud.showNotification(`Formation: ${label}`, '#8e44ad');
  }

  // Spawn test armies moved to DebugController.spawnTestArmies()

  // ===================== RALLY POINT SYSTEM =====================

  private enterRallyPointModeForBuilding(buildingKey: string): void {
    this.interaction.enter({ kind: 'rally_point', buildingKey });
    this.hud.showNotification(`Set ${buildingKey} rally point — click a tile · [ESC] cancel`, '#f0c040');
  }

  /** Set rally point for a building (called from InputManager after tile click in rally mode).
   *  Routes through command queue for multiplayer determinism. */
  public setRallyPoint(buildingKey: string, target: HexCoord): void {
    this.enqueueCommand(NetCommandType.SET_RALLY_POINT, {
      buildingId: buildingKey,
      position: target,
    });
  }

  // ===================== PLANT CROPS SYSTEM =====================

  private togglePlantCropsMode(): void {
    this.interaction.toggle({ kind: 'plant_crops' });
  }

  /** Plant a crop on a cleared plains tile — routed through command queue */
  private paintPlantCrop(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Quick local validation (prevents queueing obviously invalid commands)
    if (tile.terrain !== TerrainType.PLAINS) {
      this.hud.showNotification('⚠️ Crops can only be planted on plains!', '#e67e22');
      return;
    }
    const grassStage = this.natureSystem.getGrassAge(key);
    if (grassStage !== undefined && grassStage >= 1) {
      this.hud.showNotification('⚠️ Harvest the grass first before planting crops!', '#e67e22');
      return;
    }
    if (UnitAI.farmPatches.has(key)) return;
    if (Pathfinder.blockedTiles.has(key)) return;

    // Route through command queue so both clients execute it
    this.enqueueCommand(NetCommandType.PLANT_CROP, { position: coord });
  }

  /** Check if terrain is any water type (ocean, river, lake, or waterfall) */
  private isWaterTerrain(terrain: TerrainType): boolean {
    return terrain === TerrainType.WATER || terrain === TerrainType.RIVER || terrain === TerrainType.LAKE || terrain === TerrainType.WATERFALL;
  }

  start(): void {
    const animate = () => {
      requestAnimationFrame(animate);
      const rawDelta = this.clock.getDelta();
      const delta = rawDelta * this.gameSpeed;

      this.updateRTS(delta);
      this._updateMusic(delta);
      this.camera.update(); // Edge-of-screen panning

      // Flush any dirty voxel chunks (incremental rebuild after mining)
      if (this.currentMap && this.voxelBuilder.hasDirtyChunks()) {
        this.voxelBuilder.flushDirtyChunks(this.currentMap);
      }

      this.renderer.updateParticles(rawDelta);
      this.terrainDecorator.updateWater(rawDelta);
      // SkyCloudSystem removed
      const camPos = this.camera.camera.position;
      this.terrainDecorator.cameraWorldPos.x = camPos.x;
      this.terrainDecorator.cameraWorldPos.z = camPos.z;
      this.terrainDecorator.updateGrass(rawDelta);
      this.terrainDecorator.flushBounds();
      this.unitRenderer.updateBillboards(this.camera.camera);
      this.unitRenderer.updateSpeechBubbles(rawDelta);
      this.hud.update();
      this.debugOverlay.update();
      this.renderer.render(this.camera.camera);

      // Performance stats overlay (F3)
      this._fpsFrames++;
      this._fpsTime += rawDelta;
      if (this._fpsTime >= 0.5) {
        this._fpsDisplay = Math.round(this._fpsFrames / this._fpsTime);
        this._fpsFrames = 0;
        this._fpsTime = 0;
        if (this._perfVisible) this.updatePerfOverlay();
      }
    };

    animate();
    this.menuController.showMainMenu();
    console.log('CUBITOPIA v0.1 — Voxel Strategy');

    // === Global debug utilities — callable from browser console ===
    const game = this;
    (window as any)._scene = this.renderer.scene;
    (window as any)._renderer = this.renderer.renderer;
    (window as any)._game = this;
    (window as any)._cdb = {
      /** Dump scene stats and suspicious materials */
      dump: () => {
        const scene = game.renderer.scene;
        let meshes = 0, sprites = 0, additive = 0, orphanedVfx = 0;
        const matSeen = new Set<number>();
        const suspect: string[] = [];
        scene.traverse((obj: any) => {
          if (obj.isMesh) {
            meshes++;
            const m = obj.material;
            if (m?.blending === 2) additive++; // THREE.AdditiveBlending = 2
            // Check for orphaned VFX (meshes directly on scene, not in a named group)
            if (obj.parent === scene && !obj.name?.startsWith('instanced') && !obj.name?.startsWith('voxel')) {
              orphanedVfx++;
            }
            if (m && !matSeen.has(m.id)) {
              matSeen.add(m.id);
              const em = m.emissive;
              if (em && (em.r > 0.3 || em.g > 0.3 || em.b > 0.3)) {
                suspect.push(`mat#${m.id} em=${em.getHexString()} emI=${m.emissiveIntensity?.toFixed(2)} name="${obj.name}"`);
              }
            }
          }
          if (obj.isSprite) sprites++;
        });
        const vb = (game as any).voxelBuilder;
        const om = vb?.opaqueMat;
        console.log('%c[DEBUG DUMP]', 'color:#0f0;font-weight:bold',
          `meshes=${meshes} sprites=${sprites} additive=${additive} orphanedVFX=${orphanedVfx}`,
          `\nterrain: em=${om?.emissive?.getHexString()} emI=${om?.emissiveIntensity}`,
          `\nhigh-emissive:`, suspect.length ? suspect : 'none',
          `\ndrawCalls=${game.renderer.renderer.info.render.calls} tris=${game.renderer.renderer.info.render.triangles}`
        );
      },
      /** Toggle shadows on/off to test if they cause the fog */
      shadows: () => {
        const r = game.renderer.renderer;
        r.shadowMap.enabled = !r.shadowMap.enabled;
        console.log('Shadows:', r.shadowMap.enabled);
      },
      /** Set scene background to black (test if sky gradient bleeds through) */
      blackBg: () => {
        game.renderer.scene.background = new THREE.Color(0x000000);
        console.log('Background set to black');
      },
      /** Force remove ALL orphaned meshes directly on scene (not in groups) */
      purgeOrphans: () => {
        const scene = game.renderer.scene;
        const toRemove: THREE.Object3D[] = [];
        for (const child of scene.children) {
          if ((child as any).isMesh && !child.name?.startsWith('instanced') && !child.name?.startsWith('voxel') && child.name !== 'main-flag') {
            toRemove.push(child);
          }
        }
        toRemove.forEach(c => { scene.remove(c); });
        console.log(`Purged ${toRemove.length} orphaned meshes`);
      },
    };
    console.log('Debug: _cdb.dump() | _cdb.shadows() | _cdb.blackBg() | _cdb.purgeOrphans()');
  }

  /** Delegate music update to ProceduralMusic (init + intensity + mood switching) */
  private _updateMusic(delta: number): void {
    this.music.updateFromGameState(delta, this.sound.audioContext, this.sound.musicVolume, this.allUnits as any);
  }

  /** Start the cinematic title scene on its own canvas behind the menu. */
  private _startTitleScene(): void {
    if (this.titleScene?.isRunning) return;
    this.titleScene = new TitleScene();
    this.titleScene.start();
  }

  /** Stop and fully remove the title scene (canvas + all resources). */
  private _stopTitleScene(): void {
    if (!this.titleScene) return;
    try {
      this.titleScene.dispose();
    } catch (e) {
      console.warn('[_stopTitleScene] dispose error:', e);
    }
    this.titleScene = null;
    // Safety: ensure no lingering title canvas
    document.getElementById('title-scene-canvas')?.remove();
  }

  // Squad indicators moved to SquadIndicatorSystem; debug overlay moved to DebugOverlayRenderer

  /** Click indicator VFX — delegates to Renderer.
   *  Adjusts Y to the actual terrain elevation so the indicator sits on the ground. */
  spawnClickIndicator(worldPos: THREE.Vector3, color: number, size = 0.8): void {
    // Snap Y to terrain elevation so the indicator shows on top of the terrain
    const hex = this.worldToHex(worldPos);
    if (hex) {
      worldPos.y = this.getElevation(hex) + 0.25;
    }
    this.renderer.spawnClickIndicator(worldPos, color, size);
  }

  /** Toggle performance overlay (F3) */
  togglePerfOverlay(): void {
    this._perfVisible = !this._perfVisible;
    if (!this._perfOverlay) {
      this._perfOverlay = document.createElement('div');
      this._perfOverlay.style.cssText = `
        position:fixed; top:4px; right:4px; z-index:9999;
        background:rgba(0,0,0,0.75); color:#0f0; font:11px monospace;
        padding:6px 10px; border-radius:4px; pointer-events:none;
        line-height:1.5;
      `;
      document.body.appendChild(this._perfOverlay);
    }
    this._perfOverlay.style.display = this._perfVisible ? 'block' : 'none';
    if (this._perfVisible) this.updatePerfOverlay();
  }

  private updatePerfOverlay(): void {
    if (!this._perfOverlay) return;
    const perf = this.renderer.getPerfInfo();
    const unitCount = this.allUnits.filter(u => u.state !== 'dead').length;
    this._perfOverlay.innerHTML = [
      `FPS: ${this._fpsDisplay}`,
      `Draw calls: ${perf.drawCalls}`,
      `Triangles: ${(perf.triangles / 1000).toFixed(1)}k`,
      `Textures: ${perf.textures}  Geom: ${perf.geometries}`,
      `Units: ${unitCount}  Speed: ${this.gameSpeed}x`,
    ].join('<br>');
  }
}

const game = new Cubitopia();
game.start();
(window as any).game = game;
