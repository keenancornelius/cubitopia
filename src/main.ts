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
import { UnitFactory } from './game/entities/UnitFactory';
import { SelectionManager } from './game/systems/SelectionManager';
import { UnitAI } from './game/systems/UnitAI';
import { Pathfinder, tileKey } from './game/systems/Pathfinder';
import { HUD } from './ui/HUD';
import { BaseRenderer } from './engine/BaseRenderer';
import { CaptureZoneSystem } from './game/systems/CaptureZoneSystem';
import type { CaptureEvent } from './game/systems/CaptureZoneSystem';
import ResourceManager from './game/systems/ResourceManager';
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
import MenuController from './ui/MenuController';
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
  // gameOverOverlay and mainMenuOverlay moved to MenuController
  private gameSpeed = 1;
  private gameMode: 'pvai' | 'aivai' = 'pvai';
  private mapType: MapType = MapType.STANDARD;
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
  private _aggroList: Array<{ attackerId: string; targetId: string }> | null = null;
  /** Accumulated kills from dead units — so team totals don't drop when a unit with kills dies */
  private _deadUnitKills: [number, number] = [0, 0];
  private _unitStatsPanelTimer = 0;
  private _selInfoTimer = 0;
  private _spawnQueueHudTimer = 0;
  // Performance stats overlay
  private _perfOverlay: HTMLElement | null = null;
  private _perfVisible = false;
  private _fpsFrames = 0;
  private _fpsTime = 0;
  private _fpsDisplay = 0;
  // _deadCleanupTimer moved to LifecycleUpdater
  private garrisonSystem!: GarrisonSystem;
  private rallyPointSystem!: RallyPointSystem;
  private menuController!: MenuController;
  private debugController!: DebugController;
  interaction!: InteractionStateMachine;
  private sound: SoundManager;
  private music: ProceduralMusic;
  private titleScene: TitleScene | null = null;
  // _musicInitialized + _musicIntensityTimer moved into ProceduralMusic.updateFromGameState()
  private _buildingMeshScratch: THREE.Object3D[] | null = null;
  private _baseMeshScratch: THREE.Object3D[] | null = null;
  private debugPanel: DebugPanel;
  private debugOverlay!: DebugOverlayRenderer;
  private squadIndicatorSystem!: SquadIndicatorSystem;
  private lifecycleUpdater!: LifecycleUpdater;
  private mapInitializer!: MapInitializer;

  constructor() {
    this.renderer = new Renderer(ENGINE_CONFIG);
    this.camera = new StrategyCamera(
      CAMERA_CONFIG,
      document.getElementById(ENGINE_CONFIG.canvasId)!
    );
    this.voxelBuilder = new VoxelBuilder(this.renderer.scene);
    this.unitRenderer = new UnitRenderer(this.renderer.scene);
    this.baseRenderer = new BaseRenderer(this.renderer.scene);
    this.captureZoneSystem = new CaptureZoneSystem(this.renderer.scene);
    this.tileHighlighter = new TileHighlighter(this.renderer.scene);
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);

    const canvas = document.getElementById(ENGINE_CONFIG.canvasId)! as HTMLCanvasElement;
    this.selectionManager = new SelectionManager(canvas, this.camera.camera);
    this.selectionManager.setScene(this.renderer.scene);
    this.hud = new HUD();
    this.clock = new THREE.Clock();
    this.sound = new SoundManager();
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
      onStartGame: (mode, mapType) => {
        this.music.stopTitleMusic();
        this.music.resumeGameplay();
        this._stopTitleScene();
        this.hud.setVisible(true);
        this.gameMode = mode;
        this.mapType = mapType;
        this.startNewGame();
      },
      onPlayAgain: () => this.regenerateMap(),
      onGenreChanged: (genreId) => this.music.setGenre(genreId),
      onMenuShown: () => { this.hud.setVisible(false); this.music.playTitleMusic(); this._startTitleScene(); },
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
        this.selectionManager.setPlayerUnits(this.allUnits, 0);
      },
      removeUnitFromGame: (unit) => this.removeUnitFromGame(unit),
      updateHealthBar: (unit) => this.unitRenderer.updateHealthBar(unit),
      setUnitWorldPosition: (id, x, y, z) => this.unitRenderer.setWorldPosition(id, x, y, z),
      showBaseDestruction: (base) => this.baseRenderer.showDestruction(base),
      updateBaseHealthBars: () => { /* removed — zone capture replaced health bars */ },
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      getSelectedUnits: () => this.selectionManager.getSelectedUnits(),
      getWoodStockpile: () => this.woodStockpile[0],
      setWoodStockpile: (v) => { this.woodStockpile[0] = v; },
      getStoneStockpile: () => this.stoneStockpile[0],
      setStoneStockpile: (v) => { this.stoneStockpile[0] = v; },
      getFoodStockpile: () => this.foodStockpile[0],
      setFoodStockpile: (v) => { this.foodStockpile[0] = v; },
      getGrassFiberStockpile: () => this.grassFiberStockpile[0],
      setGrassFiberStockpile: (v) => { this.grassFiberStockpile[0] = v; },
      getClayStockpile: () => this.clayStockpile[0],
      setClayStockpile: (v) => { this.clayStockpile[0] = v; },
      getRopeStockpile: () => this.ropeStockpile[0],
      setRopeStockpile: (v) => { this.ropeStockpile[0] = v; },
      getIronStockpile: () => this.ironStockpile[0],
      setIronStockpile: (v) => { this.ironStockpile[0] = v; },
      getCharcoalStockpile: () => this.charcoalStockpile[0],
      setCharcoalStockpile: (v) => { this.charcoalStockpile[0] = v; },
      getGoldStockpile: () => this.goldStockpile[0],
      setGoldStockpile: (v) => { this.goldStockpile[0] = v; },
      getSteelStockpile: () => this.steelStockpile[0],
      setSteelStockpile: (v) => { this.steelStockpile[0] = v; },
      getCrystalStockpile: () => this.crystalStockpile[0],
      setCrystalStockpile: (v) => { this.crystalStockpile[0] = v; },
      updateResourceDisplay: () => this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]),
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
        this.allUnits = [...this.players[0].units, ...this.players[1].units];
        this.selectionManager.setPlayerUnits(this.allUnits, 0);
      },
      getArmyComposition: () => this.debugPanel.getArmyComposition(),
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
      for (const unit of selected) {
        unit._playerCommanded = true;
        unit._forceMove = false;
        unit._focusTarget = enemyAtTarget.id;
        UnitAI.commandAttack(unit, hexCoord, enemyAtTarget.id, this.currentMap!);
      }
      this.spawnClickIndicator(worldPos, 0xff2222, 1.0); // Red for attack
      return;
    }

    // --- Right-click on FRIENDLY unit: healer → heal, others → ignore friendly ---
    if (friendlyAtTarget && !selected.includes(friendlyAtTarget)) {
      const healers = selected.filter(u => u.type === UnitType.HEALER);
      if (healers.length > 0) {
        for (const healer of healers) {
          healer._playerCommanded = true;
          healer._healTarget = friendlyAtTarget.id;
          healer._forceMove = false;
          UnitAI.commandMove(healer, friendlyAtTarget.position, this.currentMap!, preferUnderground);
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
      for (const unit of selected) {
        unit._playerCommanded = true;
        unit._forceMove = true;
        unit._focusTarget = undefined;
        unit.stance = UnitStance.DEFENSIVE;
        UnitAI.commandMove(unit, baseAtTarget.position, this.currentMap!, preferUnderground);
      }
      this.hud.showNotification(`Capturing zone — hold position!`, '#3498db');
      const baseElev = this.getElevation(baseAtTarget.position, baseAtTarget.id === 'base_neutral');
      this.tileHighlighter.showAttackIndicator(baseAtTarget.position, baseElev);
      return;
    }

    // Check for enemy structure at click target
    const enemyStructure = this.findEnemyStructureAt(hexCoord, selected[0].owner);
    if (enemyStructure) {
      for (const unit of selected) {
        unit._playerCommanded = true;
        unit._forceMove = false;
        unit._focusTarget = undefined;
        UnitAI.commandAttack(unit, enemyStructure, null, this.currentMap!, preferUnderground);
      }
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
            UnitAI.commandMove(builder, blueprint.position, this.currentMap!, preferUnderground);
          }
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
            UnitAI.commandMove(builder, hexCoord, this.currentMap!, preferUnderground);
          }
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
            UnitAI.commandMove(builder, hexCoord, this.currentMap!, preferUnderground);
          }
          this.hud.showNotification(`Builder assigned to wall!`, '#f39c12');
          this.spawnClickIndicator(worldPos, 0xf39c12, 0.8);
          return;
        }
      }
    }

    // --- Right-click on ground: PURE MOVE (no re-aggro) ---
    if (selected.length === 1) {
      selected[0]._playerCommanded = true;
      selected[0]._forceMove = true;
      selected[0]._focusTarget = undefined;
      selected[0]._healTarget = undefined;
      selected[0]._assignedBlueprintId = undefined;
      UnitAI.commandMove(selected[0], hexCoord, this.currentMap!, preferUnderground);
    } else {
      const sortedSelected = [...selected].sort((a, b) =>
        getUnitFormationPriority(a) - getUnitFormationPriority(b)
      );
      const formationSlots = generateFormation(hexCoord, sortedSelected.length, this.selectedFormation, this.currentMap!.tiles);
      for (let i = 0; i < sortedSelected.length; i++) {
        const unit = sortedSelected[i];
        unit._playerCommanded = true;
        unit._forceMove = true;
        unit._focusTarget = undefined;
        unit._healTarget = undefined;
        unit._assignedBlueprintId = undefined;
        const slot = formationSlots[i] || hexCoord;
        UnitAI.commandMove(unit, slot, this.currentMap!, preferUnderground);
      }
    }

    // Visual click indicator
    this.spawnClickIndicator(worldPos, 0x4488ff, 0.8); // Blue for move
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
    };
  }

  /** Rebuild systems after state reset (e.g. regenerateMap) */
  private initSystems(): void {
    const ctx = this.buildGameContext();
    this.resourceManager = new ResourceManager(ctx);

    // BuildingSystem owns registry, mesh builders, and queries
    this.buildingSystem = new BuildingSystem(ctx);
    // WallSystem owns wall/gate state, mesh management, and damage
    const wallOps: WallSystemOps = {
      isTileOccupied: (key) => this.isTileOccupied(key),
      isStockpileLocation: (pos) => {
        for (const [sKey] of this.resourceManager.stockpileMeshes) {
          const base = this.bases.find(b => b.owner === (sKey.includes('0') ? 0 : 1));
          if (base) {
            const stockQ = base.position.q + (base.owner === 0 ? -2 : 2);
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
        if (owner === 0) {
          this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
        }
      },
      updateStockpileVisual: (owner) => this.resourceManager.updateStockpileVisual(owner),
      getWallConnectable: () => this.buildingSystem.wallConnectable,
      getBuildingAt: (pos) => this.buildingSystem.getBuildingAt(pos),
      unregisterBuilding: (pb) => this.buildingSystem.unregisterBuilding(pb),
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
      queueUnit: (unitType, buildingKind) => this.spawnQueueSystem.queueUnitFromTooltip(unitType, buildingKind),
      getBuildingQueueOptions: (kind) => this.buildingSystem.getBuildingQueueOptions(kind),
      captureZone: (position) => this.captureZoneFromTooltip(position),
      attackTarget: (position) => this.attackTargetFromTooltip(position),
      setRallyToPosition: (position) => this.setRallyToPositionFromTooltip(position),
      getGarrisonInfo: (structureKey) => {
        const slot = this.garrisonSystem.getSlot(structureKey);
        const cap = this.garrisonSystem.getCapacity(structureKey);
        if (!cap) return null;
        return {
          units: slot?.units ?? [],
          current: cap.current,
          max: cap.max,
          reachableExits: this.garrisonSystem.getReachableExits(structureKey),
        };
      },
      ungarrisonStructure: (structureKey, exitKey?) => {
        const released = this.garrisonSystem.ungarrison(structureKey, exitKey);
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

    // Combat event handler
    this.combatEventHandler = new CombatEventHandler({
      getPlayers: () => this.players,
      getAllUnits: () => this.allUnits,
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
      fireArrow: (from, to, id, cb) => this.unitRenderer.fireArrow(from, to, id, cb),
      fireDeflectedArrow: (from, to, id, cb) => this.unitRenderer.fireDeflectedArrow(from, to, id, cb),
      fireMagicOrb: (from, to, color, id, splash, cb) => this.unitRenderer.fireMagicOrb(from, to, color, id, splash, cb),
      fireLightningBolt: (from, to, id, cb) => this.unitRenderer.fireLightningBolt(from, to, id, cb),
      fireLightningChain: (from, to, id) => this.unitRenderer.fireLightningChain(from, to, id),
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
      showLevelUpEffect: (id, wp, lvl) => this.unitRenderer.showLevelUpEffect(id, wp, lvl),
      playSound: (name, vol) => this.sound.play(name as any, vol),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      updateResources: (player, w, f, s) => this.hud.updateResources(player, w, f, s),
      hexToWorld: (pos, underground) => this.hexToWorld(pos, underground),
      getBuildingAt: (pos) => this.buildingSystem.getBuildingAt(pos),
      damageBarracks: (pos, dmg) => this.wallSystem.damageBarracks(pos, dmg),
      damageGate: (pos, dmg) => this.wallSystem.damageGate(pos, dmg),
      damageWall: (pos, dmg) => this.wallSystem.damageWall(pos, dmg),
      isGateAt: (key) => this.wallSystem.gatesBuilt.has(key),
      onStructureDestroyed: (key) => this.garrisonSystem.onStructureDestroyed(key),
      handleBuildWall: (unit, pos) => this.wallSystem.handleBuildWall(unit, pos),
      handleBuildGate: (unit, pos) => this.wallSystem.handleBuildGate(unit, pos),
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
    });

    // Spawn queue system
    this.spawnQueueSystem = new SpawnQueueSystem({
      getPlayers: () => this.players,
      getAllUnits: () => this.allUnits,
      getCurrentMap: () => this.currentMap,
      getGold: () => this.players[0].resources.gold,
      setGold: (v) => { this.goldStockpile[0] = v; this.players[0].resources.gold = v; },
      getWood: () => this.woodStockpile[0],
      setWood: (v) => { this.woodStockpile[0] = v; this.players[0].resources.wood = v; },
      getStone: () => this.stoneStockpile[0],
      setStone: (v) => { this.stoneStockpile[0] = v; this.players[0].resources.stone = v; },
      getRope: () => this.ropeStockpile[0],
      setRope: (v) => { this.ropeStockpile[0] = v; this.players[0].resources.rope = v; },
      getSteel: () => this.steelStockpile[0],
      setSteel: (v) => { this.steelStockpile[0] = v; this.players[0].resources.steel = v; },
      getCrystal: () => this.players[0].resources.crystal,
      setCrystal: (v) => { this.players[0].resources.crystal = v; },
      getNextSpawnBuilding: (kind, owner) => this.buildingSystem.getNextSpawnBuilding(kind, owner),
      advanceSpawnIndex: (kind) => this.buildingSystem.advanceSpawnIndex(kind),
      getFirstBuilding: (kind, owner) => this.buildingSystem.getFirstBuilding(kind, owner),
      findSpawnTile: (map, q, r, allow) => this.findSpawnTile(map, q, r, allow),
      hexToWorld: (pos) => this.hexToWorld(pos),
      getElevation: (pos) => this.getElevation(pos),
      addUnitToRenderer: (unit, elev) => this.unitRenderer.addUnit(unit, elev),
      addUnitToGame: (unit) => {
        this.players[0].units.push(unit);
        this.allUnits.push(unit);
        this.selectionManager.setPlayerUnits(this.allUnits, 0);
      },
      getRallyFormationSlot: (kind, unit) => this.rallyPointSystem.getRallyFormationSlot(kind, unit),
      showNotification: (msg, color) => this.hud.showNotification(msg, color),
      updateResources: () => this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]),
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
      hexDistance: (a, b) => {
        const dq = a.q - b.q;
        const dr = a.r - b.r;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
      },
    });

    // Population System — food-based population cap
    this.populationSystem = new PopulationSystem({
      getFoodStockpile: (owner) => this.foodStockpile[owner] ?? 0,
      getAllUnits: () => this.allUnits,
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
      initializeGrassTracking: () => this.natureSystem.initializeGrassTracking(),
      initializeForestTracking: () => this.natureSystem.initializeForestTracking(),
      setMapBounds: (x0, y0, x1, y1) => this.camera.setMapBounds(x0, y0, x1, y1),
      focusCameraOnCenter: (cq, cz) => this.camera.focusOn(new THREE.Vector3(cq, 2, cz)),
      getBaseTiles: () => this.getBaseTiles(),
      updateStockpileVisual: (owner) => this.resourceManager.updateStockpileVisual(owner),
      getDebugPanel: () => this.debugPanel,
    };
    this.mapInitializer = new MapInitializer(mapInitOps);
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
    this.woodStockpile = [30, 30]; // Start with some wood so players can build immediately
    this.stoneStockpile = [0, 0];
    this.goldStockpile = [0, 0];
    this.foodStockpile = [0, 0];
    this.grassFiberStockpile = [0, 0];
    this.clayStockpile = [0, 0];
    this.ropeStockpile = [0, 0];
    this.ironStockpile = [0, 0];
    this.charcoalStockpile = [0, 0];
    this.steelStockpile = [0, 0];
    this.crystalStockpile = [0, 0];
    this.wallSystem.cleanup();
    UnitAI.wallsBuilt.clear();
    UnitAI.wallOwners.clear();
    // Clear rally point system
    this.rallyPointSystem.clearAllRallyPoints();
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
    this.foodStockpile = [10, 10];
    this.stoneStockpile = [0, 0];
    this.grassFiberStockpile = [0, 0];
    this.clayStockpile = [0, 0];
    this.ropeStockpile = [0, 0];
    this.ironStockpile = [0, 0];
    this.charcoalStockpile = [0, 0];
    this.steelStockpile = [0, 0];
    // Farm patch markers cleared by blueprintSystem.cleanup()
    UnitAI.farmPatches.clear();
    UnitAI.playerGrassBlueprint.clear();
    UnitAI.claimedFarms.clear();
    UnitAI.claimedTrees.clear();
    UnitAI.clearUnreachableCache();
    UnitAI.siloPositions.clear();
    UnitAI.farmhousePositions.clear();
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
    const isArena = this.mapType === MapType.ARENA;

    // Step 1: Initialize map (terrain, bases, decorations)
    const mapSetupResult = this.mapInitializer.setupMap(this.mapType, this.gameMode, isArena);
    const map = mapSetupResult.map;
    const MAP_SIZE = mapSetupResult.mapSize;
    const bases = mapSetupResult.bases;
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
    this._deadUnitKills = [0, 0];

    // Apply arena decoration mode if needed
    if (isArena) {
      this.terrainDecorator.desertMode = false;
    } else if (this.mapType === MapType.DESERT_TUNNELS) {
      this.terrainDecorator.desertMode = true;
    }

    // --- Spawn Units ---

    // Create players — arena gets abundant resources for testing
    const makeResources = (): PlayerResources => isArena
      ? { food: 999, wood: 999, stone: 999, iron: 999, gold: 999, crystal: 999, grass_fiber: 0, clay: 0, rope: 0, charcoal: 999, steel: 999 }
      : { food: 50, wood: 50, stone: 20, iron: 0, gold: 25, crystal: 0, grass_fiber: 0, clay: 0, rope: 0, charcoal: 0, steel: 0 };

    const p1IsAI = this.gameMode === 'aivai';
    this.players = [
      { id: 0, name: p1IsAI ? 'AI Blue' : 'Player 1', color: new THREE.Color(0x3498db), cities: [], units: [],
        resources: makeResources(), technology: [], isAI: p1IsAI, defeated: false },
      { id: 1, name: 'AI Opponent', color: new THREE.Color(0xe74c3c), cities: [], units: [],
        resources: makeResources(), technology: [], isAI: true, defeated: false },
    ];

    if (isArena) {
      // Arena mode: large combat armies on opposite sides, aggressive stance
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

      const spawnArmy = (owner: number, baseQ: number, baseR: number) => {
        const defs = owner === 0 ? blueArmyDefs : redArmyDefs;
        const dir = owner === 0 ? 1 : -1; // toward center

        // Flatten defs into individual units and sort by role depth (front first)
        const units: { type: UnitType; depth: number }[] = [];
        for (const def of defs) {
          const depth = DebugController.ROLE_DEPTH[def.type] ?? 1;
          for (let i = 0; i < def.count; i++) {
            units.push({ type: def.type, depth });
          }
        }
        units.sort((a, b) => a.depth - b.depth);

        // Place units in formation lines: each depth gets its own row(s)
        // Front line is closest to center (baseQ + dir*offset)
        const lineCounters: Record<number, number> = {};
        for (const u of units) {
          const lineIdx = lineCounters[u.depth] ?? 0;
          lineCounters[u.depth] = lineIdx + 1;

          // Q offset: front line (depth 0) is closest to enemy, back lines further from enemy
          // Depth 0 = +2 toward center, depth 1 = +0 (at base), depth 2 = -2, depth 3 = -4
          const qOffset = (2 - u.depth * 2) * dir;
          // R offset: spread units in a line, centered on baseR
          const lineWidth = 5; // max units per sub-row
          const subRow = Math.floor(lineIdx / lineWidth);
          const posInRow = lineIdx % lineWidth;
          const rOffset = posInRow - Math.floor(Math.min(lineWidth, units.filter(x => x.depth === u.depth).length) / 2);
          const qExtra = subRow * dir; // extra rows push slightly forward/back

          const oq = baseQ + qOffset + qExtra;
          const or2 = baseR + rOffset;
          const pos = this.findSpawnTile(map, oq, or2);
          const unit = UnitFactory.create(u.type, owner, pos);
          const wp = this.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          unit.stance = UnitStance.AGGRESSIVE;
          this.players[owner].units.push(unit);
          this.unitRenderer.addUnit(unit, this.getElevation(pos));
        }
      };
      // Spawn armies AT their bases — maximum separation across arena
      // Base offset 8 (near wall, 3 hexes from wall ring at radius 11)
      // Units spread inward from base toward center
      const arenaBaseOffset = 8;
      spawnArmy(0, arenaCenter - arenaBaseOffset, arenaCenter);
      spawnArmy(1, arenaCenter + arenaBaseOffset, arenaCenter);
    } else {
      // Standard mode: workers near base
      const p1Defs = [
        { type: UnitType.BUILDER, pq: P1_Q + 2, pr: P1_R },
        { type: UnitType.LUMBERJACK, pq: P1_Q + 2, pr: P1_R - 2 },
        { type: UnitType.LUMBERJACK, pq: P1_Q + 2, pr: P1_R + 2 },
        { type: UnitType.VILLAGER, pq: P1_Q + 2, pr: P1_R - 4 },
        { type: UnitType.VILLAGER, pq: P1_Q + 2, pr: P1_R + 4 },
      ];
      for (const def of p1Defs) {
        const pos = this.findSpawnTile(map, def.pq, def.pr);
        const unit = UnitFactory.create(def.type, 0, pos);
        const wp = this.hexToWorld(pos);
        unit.worldPosition = { ...wp };
        this.players[0].units.push(unit);
        this.unitRenderer.addUnit(unit, this.getElevation(pos));
      }
      const p2Defs = [
        { type: UnitType.BUILDER, pq: P2_Q - 2, pr: P2_R },
        { type: UnitType.LUMBERJACK, pq: P2_Q - 2, pr: P2_R - 2 },
        { type: UnitType.LUMBERJACK, pq: P2_Q - 2, pr: P2_R + 2 },
        { type: UnitType.VILLAGER, pq: P2_Q - 2, pr: P2_R - 4 },
        { type: UnitType.VILLAGER, pq: P2_Q - 2, pr: P2_R + 4 },
      ];
      for (const def of p2Defs) {
        const pos = this.findSpawnTile(map, def.pq, def.pr);
        const unit = UnitFactory.create(def.type, 1, pos);
        const wp = this.hexToWorld(pos);
        unit.worldPosition = { ...wp };
        this.players[1].units.push(unit);
        this.unitRenderer.addUnit(unit, this.getElevation(pos));
      }
    }

    this.allUnits = [...this.players[0].units, ...this.players[1].units];
    this.selectionManager.setPlayerUnits(this.allUnits, 0);

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

    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Base setup already done by mapInitializer.setupMap()
    // Here we just finalize the remaining game state

    // Add wallConnectable tags for player bases
    const p1Base = this.bases[0];
    const p2Base = this.bases[1];
    this.buildingSystem.wallConnectable.add(`${p1BaseCoord.q},${p1BaseCoord.r}`);
    this.buildingSystem.wallConnectable.add(`${p2BaseCoord.q},${p2BaseCoord.r}`);

    // Setup UnitAI static references
    UnitAI.basePositions.set(0, p1BaseCoord);
    UnitAI.basePositions.set(1, p2BaseCoord);
    UnitAI.bases = this.bases;
    UnitAI.arenaMode = isArena;
    UnitAI.siloPositions.set(0, p1BaseCoord);
    UnitAI.siloPositions.set(1, p2BaseCoord);

    // Auto-enable combat logging in Arena mode
    if (isArena) {
      CombatLog.reset();
      this.debugPanel.setUnits(this.allUnits);
    }

    // Standard mode only: generate builder wall plans
    if (!isArena) {
      UnitAI.generateKeepWallPlan(0, p1BaseCoord, map);
      UnitAI.generateKeepWallPlan(1, p2BaseCoord, map);
    }

    // Set camera bounds to prevent panning off the map
    this.camera.setMapBounds(-3, -3, MAP_SIZE * 1.5 + 3, MAP_SIZE * 1.5 + 3);

    // Camera focuses on map center
    const centerQ = Math.floor(MAP_SIZE / 2);
    this.camera.focusOn(new THREE.Vector3(centerQ * 1.5, 2, midR * 1.5));

    // Display initial stockpiles
    this.resourceManager.updateStockpileVisual(0);
    this.resourceManager.updateStockpileVisual(1);

    // Update HUD mode indicator
    this.hud.setGameMode(this.gameMode);

    // Always show Y-slicer — works globally, no mode prerequisite
    this.hud.showElevationSlicer(true, 25, Cubitopia.UNDERGROUND_DEPTH);
    this.hud.onSliceChange = (y) => {
      this.voxelBuilder.setSliceY(y);
      this.terrainDecorator.setDecorationClipPlane(y !== null ? this.voxelBuilder.getClipPlane() : null);
    };
  }

  // --- RTS Game Loop ---

  private updateRTS(delta: number): void {
    if (!this.currentMap || this.players.length === 0 || this.gameOver) return;

    // Debug: infinite resources — top up all resources to 999 each tick
    if (this.hud.debugFlags.infiniteResources) {
      this.woodStockpile[0] = 999;
      this.stoneStockpile[0] = 999;
      this.foodStockpile[0] = 999;
      this.grassFiberStockpile[0] = 999;
      this.clayStockpile[0] = 999;
      this.ropeStockpile[0] = 999;
      this.players[0].resources.wood = 999;
      this.players[0].resources.stone = 999;
      this.players[0].resources.food = 999;
      this.players[0].resources.gold = 999;
      this.players[0].resources.grass_fiber = 999;
      this.players[0].resources.clay = 999;
      this.players[0].resources.rope = 999;
      this.ironStockpile[0] = 999;
      this.charcoalStockpile[0] = 999;
      this.steelStockpile[0] = 999;
      this.crystalStockpile[0] = 999;
      this.goldStockpile[0] = 999;
      this.players[0].resources.iron = 999;
      this.players[0].resources.charcoal = 999;
      this.players[0].resources.steel = 999;
      this.players[0].resources.crystal = 999;
    }

    // --- Spawn queue processing (delegated to SpawnQueueSystem) ---
    this.spawnQueueSystem.update(delta);

    // Update unified spawn queue HUD with progress bars — throttled to every 0.25s
    if (!this._spawnQueueHudTimer) this._spawnQueueHudTimer = 0;
    this._spawnQueueHudTimer += delta;
    if (this._spawnQueueHudTimer >= 0.25) {
      this._spawnQueueHudTimer = 0;
      const allQueueEntries = this.spawnQueueSystem.getQueueHUDEntries(this.hud.debugFlags);
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

    // ── Build unit-ID lookup map (avoids O(n) .find() in combat loop) ──
    // Reuse the same map object to avoid GC pressure
    if (!this._unitById) this._unitById = new Map<string, Unit>();
    const unitById = this._unitById;
    unitById.clear();

    // Update occupied tiles for pathfinder (units prefer unoccupied paths)
    Pathfinder.occupiedTiles.clear();
    for (let i = 0, len = this.allUnits.length; i < len; i++) {
      const unit = this.allUnits[i];
      if (unit.state !== UnitState.DEAD) {
        unitById.set(unit.id, unit);
        Pathfinder.occupiedTiles.add(tileKey(unit.position.q, unit.position.r));
      }
    }

    // Pass debug flags to UnitAI before running update
    // Sync debug flags without allocating a new object each frame
    const df = UnitAI.debugFlags;
    df.disableChop = this.hud.debugFlags.disableChop;
    df.disableMine = this.hud.debugFlags.disableMine;
    df.disableHarvest = this.hud.debugFlags.disableHarvest;
    df.disableBuild = this.hud.debugFlags.disableBuild;
    df.disableDeposit = this.hud.debugFlags.disableDeposit;
    df.disableAutoReturn = this.hud.debugFlags.disableAutoReturn;
    df.disableCombat = this.hud.debugFlags.disableCombat;

    // Sync stockpiles to UnitAI so builders know what resources are available
    UnitAI.stoneStockpile = this.stoneStockpile;
    UnitAI.ironStockpile = this.ironStockpile;
    UnitAI.clayStockpile = this.clayStockpile;
    UnitAI.crystalStockpile = this.crystalStockpile;
    UnitAI.goldStockpile = this.goldStockpile;
    UnitAI.charcoalStockpile = this.charcoalStockpile;
    UnitAI.steelStockpile = this.steelStockpile;
    UnitAI.placedBuildings = this.buildingSystem.placedBuildings;
    UnitAI.tacticalGroupManager = this.tacticalGroupManager;

    // Update tactical groups (phase transitions, blackboard, centroids)
    this.tacticalGroupManager.update(delta, this.allUnits);

    // Run unit AI (movement, combat, auto-attack)
    const events = UnitAI.update(this.players, this.currentMap, delta);

    // Process combat events (delegated to CombatEventHandler)
    this.combatEventHandler.processEvents(events);

    // Update garrison system (ranged fire from garrisoned units)
    this.garrisonSystem.update(delta);

    // ── SINGLE CONSOLIDATED LOOP: Y-fix + position + animate + strafe + aggro ──
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

      // Set visual position
      this.unitRenderer.setWorldPosition(
        unit.id,
        unit.worldPosition.x,
        unit.worldPosition.y,
        unit.worldPosition.z
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

    // --- Zone control capture system ---
    const captureEvents = this.captureZoneSystem.update(this.allUnits, delta);
    for (const evt of captureEvents) {
      this.handleCaptureEvent(evt);
    }
    this.captureZoneSystem.updateBillboards(this.camera.camera);
    this.hud.updateCaptureZones(this.captureZoneSystem.getZones());

    // AI commander: periodically issue orders (skip if disableAI)
    if (!this.hud.debugFlags.disableAI) {
      // Player 2 (always AI)
      this.aiController.updateSmartAICommander(1, delta);
      this.aiController.updateSmartAIEconomy(1, delta);
      this.aiController.updateSmartAISpawnQueue(1, delta);
      this.aiController.updateSmartAITactics(1, delta);
      this.aiController.updateSmartAIStrategy(1, delta);

      // Player 1 AI (only in AI vs AI mode)
      if (this.gameMode === 'aivai') {
        this.aiController.updateSmartAICommander(0, delta);
        this.aiController.updateSmartAIEconomy(0, delta);
        this.aiController.updateSmartAISpawnQueue(0, delta);
        this.aiController.updateSmartAITactics(0, delta);
        this.aiController.updateSmartAIStrategy(0, delta);
      }
    }

    // Update enemy resource bar (reuse cached object to avoid per-frame allocation)
    if (!this._enemyResCache) this._enemyResCache = { wood: 0, food: 0, stone: 0, iron: 0, crystal: 0, grassFiber: 0, clay: 0, charcoal: 0, rope: 0, steel: 0, gold: 0 };
    const erc = this._enemyResCache;
    erc.wood = this.woodStockpile[1]; erc.food = this.foodStockpile[1]; erc.stone = this.stoneStockpile[1];
    erc.iron = this.ironStockpile[1]; erc.crystal = this.crystalStockpile[1]; erc.grassFiber = this.grassFiberStockpile[1];
    erc.clay = this.clayStockpile[1]; erc.charcoal = this.charcoalStockpile[1]; erc.rope = this.ropeStockpile[1];
    erc.steel = this.steelStockpile[1]; erc.gold = this.goldStockpile[1];
    this.hud.updateEnemyResources(this.players[1], erc);

    // Nature simulation (tree regrowth, grass growth/spread)
    if (!this.hud.debugFlags.disableTreeGrowth || !this.hud.debugFlags.disableGrassGrowth) {
      this.natureSystem.update(delta);
    }

    // Update base health bar billboards
    this.baseRenderer.updateBillboards(this.camera.camera);

    // Update HUD resource display with wood stockpile + population cap info
    // Throttle popInfo to every 0.5s to avoid per-frame .filter() allocations
    this._popInfoTimer += delta;
    if (this._popInfoTimer >= 0.5 || !this._popInfoCache) {
      this._popInfoTimer = 0;
      if (this.populationSystem) {
        this._popInfoCache = {
          current: this.populationSystem.getCombatUnitCount(0),
          cap: this.populationSystem.getPopulationCap(0),
        };
      }
    }
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0], this._popInfoCache);

    // Base upgrades, population disband, and dead cleanup — delegated to LifecycleUpdater
    this.lifecycleUpdater.update(delta);

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

    // Notification
    const capturerName = evt.newOwner === 0
      ? (this.gameMode === 'aivai' ? 'Blue' : 'You')
      : (this.gameMode === 'aivai' ? 'Red' : 'Enemy');
    const baseLabel = evt.isMainBase ? 'main base' : 'outpost';

    if (evt.isMainBase) {
      // Main base captured = instant defeat for the previous owner
      this.hud.showNotification(`${capturerName} captured the enemy ${baseLabel}!`, evt.newOwner === 0 ? '#3498db' : '#e74c3c');
      this.gameOver = true;
      let winner: string;
      let isVictory: boolean;
      if (this.gameMode === 'aivai') {
        winner = evt.newOwner === 0 ? 'AI BLUE' : 'AI RED';
        isVictory = evt.newOwner === 0;
      } else {
        winner = evt.newOwner === 0 ? 'PLAYER' : 'AI OPPONENT';
        isVictory = evt.newOwner === 0;
      }
      this.showGameOverScreen(winner, isVictory);
    } else {
      this.hud.showNotification(`${capturerName} captured an ${baseLabel}!`, evt.newOwner === 0 ? '#3498db' : '#e74c3c');
    }
  }

  /** Debug: check for destroyed bases (from instant win/lose debug commands) */
  private debugCheckWinCondition(): void {
    for (const base of this.bases) {
      if (base.id === 'base_neutral') continue;
      if (base.destroyed) {
        // Determine the new owner (the other player)
        const newOwner = base.owner === 0 ? 1 : 0;
        this.handleCaptureEvent({
          baseId: base.id,
          newOwner,
          previousOwner: base.owner,
          isMainBase: true,
        });
        return;
      }
    }
  }

  private showGameOverScreen(winner: string, isVictory: boolean): void {
    this.menuController.showGameOverScreen(winner, isVictory, this.gameMode);
  }

  // --- Wood stockpile per player: each tree = 4 wall blocks ---
  private woodStockpile: number[] = [0, 0]; // [player0, player1]
  // Wall/gate state is managed by WallSystem (this.wallSystem)

  /** Y-level from slicer for troop commands — null means surface, number means underground */
  commandYLevel: number | null = null;
  // Interaction mode state fully managed by InteractionStateMachine (legacy getters removed 2026-04-01)
  private stoneStockpile: number[] = [0, 0]; // [player0, player1]

  // Query/registry methods are in BuildingSystem — accessed via this.buildingSystem.*

  // showBuildingTooltip → moved to BuildingTooltipController

  /** Queue a unit from the building tooltip */
  /** Demolish a player building, removing it from the world and refunding some resources */
  private demolishBuilding(pb: PlacedBuilding): void {
    if (pb.owner !== 0) return; // Only player can demolish their own
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
    };
    const refund = refunds[pb.kind] ?? 3;
    this.woodStockpile[0] += refund;
    this.players[0].resources.wood += refund;
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
    this.buildingSystem.unregisterBuilding(pb);
    this.hud.showNotification(`${pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1)} demolished. Refunded ${refund} wood.`);
  }

  /** Send selected units to the nearest non-owned zone (from selection panel button) */
  private captureNearestZoneWithSelected(): void {
    if (!this.currentMap) return;
    const selected = this.selectionManager.getSelectedUnits().filter(
      u => u.owner === 0 && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u)
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
      .filter(b => b.owner !== 0 && !b.destroyed)
      .sort((a, b) => {
        // Neutral first, then by distance
        const aN = a.owner === 2 ? 0 : 1;
        const bN = b.owner === 2 ? 0 : 1;
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

    const label = target.owner === 2 ? 'neutral outpost' : 'enemy zone';
    this.hud.showNotification(`${selected.length} units capturing ${label}!`, '#27ae60');
    const elev = this.getElevation(target.position);
    this.tileHighlighter.showAttackIndicator(target.position, elev);
  }

  /** Order selected/all combat units to attack-move to a structure (from tooltip) */
  private attackTargetFromTooltip(position: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits().filter(u => u.owner === 0 && u.state !== UnitState.DEAD);
    const units = selected.length > 0
      ? selected
      : this.allUnits.filter(u => u.owner === 0 && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u));

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

  /** Order selected/all combat units to capture a zone (move + defensive stance) */
  private captureZoneFromTooltip(position: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits().filter(u => u.owner === 0 && u.state !== UnitState.DEAD);
    const units = selected.length > 0
      ? selected
      : this.allUnits.filter(u => u.owner === 0 && u.state !== UnitState.DEAD && UnitAI.isCombatUnit(u));

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

  /** Set rally point for all combat buildings + base to a target position (from tooltip) */
  private setRallyToPositionFromTooltip(position: HexCoord): void {
    // Set rally for all player combat buildings (barracks, armory, wizard_tower)
    const combatKinds: BuildingKind[] = ['barracks', 'armory', 'wizard_tower'];
    let count = 0;
    for (const pb of this.buildingSystem.placedBuildings) {
      if (pb.owner === 0 && combatKinds.includes(pb.kind)) {
        this.rallyPointSystem.setRallyPoint(pb.kind, position);
        count++;
      }
    }
    // Also set rally for the player's base (ogre spawns)
    this.rallyPointSystem.setRallyPoint('base', position);
    count++;
    if (count > 0) {
      this.hud.showNotification(`Rally point set for ${count} buildings`, '#2980b9');
    } else {
      this.hud.showNotification('No combat buildings to rally!', '#e67e22');
    }
  }

  // Placement mode flags & rotation → replaced by InteractionStateMachine
  private foodStockpile: number[] = [0, 0]; // [player0, player1]
  // clearedPlains moved to NatureSystem

  // Workshop, Smelter, Armory, Wizard Tower → placement managed by InteractionStateMachine

  // --- Attack-Move Mode (League-style) ---
  private _attackMoveIndicator: THREE.Mesh | null = null;

  // --- Grass Fiber, Clay, Rope Stockpiles ---
  private grassFiberStockpile: number[] = [0, 0];
  private clayStockpile: number[] = [0, 0];
  private ropeStockpile: number[] = [0, 0];
  private ironStockpile: number[] = [0, 0];
  private charcoalStockpile: number[] = [0, 0];
  private steelStockpile: number[] = [0, 0];
  private crystalStockpile: number[] = [0, 0];
  private goldStockpile: number[] = [0, 0];

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
            { key: 'T', label: `Paladin (${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}g)`, action: `spawn:barracks:PALADIN:${GAME_CONFIG.units[UnitType.PALADIN].costs.menu.gold}` },
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
      if (unitType === undefined) return;

      this.spawnQueueSystem.doSpawnQueue(buildingKey, unitType, unitName, parts.slice(3));
    } else if (parts[0] === 'craft') {
      if (parts[1] === 'rope') { this.resourceManager.craftRope(); this.sound.play('craft_confirm', 0.5); }
      else if (parts[1] === 'steel') { this.resourceManager.smeltSteel(); this.sound.play('craft_confirm', 0.5); }
      else if (parts[1] === 'charcoal') { this.resourceManager.craftCharcoal(); this.sound.play('craft_confirm', 0.5); }
    } else if (parts[0] === 'action') {
      if (parts[1] === 'harvest') this.toggleHarvestMode();
      else if (parts[1] === 'mine') this.toggleMineMode();
      else if (parts[1] === 'walls') this.toggleBuildMode();
      else if (parts[1] === 'farmPatch') this.toggleFarmPatchMode();
      else if (parts[1] === 'plantTree') this.togglePlantTreeMode();
      else if (parts[1] === 'plantCrops') this.togglePlantCropsMode();
      else if (parts[1] === 'sellWood') this.resourceManager.doSellWood();
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

    // Start regrowth timer, clean up growth tracking
    this.natureSystem.onTreeChopped(key);

    // Load wood onto the lumberjack — they must carry it back to the stockpile
    unit.carryAmount = Math.min(woodYield, unit.carryCapacity);
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
      + Math.floor(Math.random() * GAME_CONFIG.economy.harvest.grass.hayVariance);

    // Reset grass to short (stage 0) — it will regrow; mark as cleared plains
    this.natureSystem.onGrassHarvested(key, pos, tile.elevation * 0.5);

    // Grass fiber bonus — harvesting grass also yields fiber (plant material for rope)
    const fiberYield = GAME_CONFIG.economy.harvest.grass.fiberBase
      + Math.floor(Math.random() * GAME_CONFIG.economy.harvest.grass.fiberVariance); // 1-2 fiber
    this.grassFiberStockpile[unit.owner] += fiberYield;
    this.players[unit.owner].resources.grass_fiber += fiberYield;
    if (unit.owner === 0) {
      this.hud.showNotification(`🌿 +${fiberYield} grass fiber`, '#8bc34a');
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
    forestry:      { woodCost: GAME_CONFIG.buildings.forestry.cost.player.wood, stoneCost: GAME_CONFIG.buildings.forestry.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT] },
    masonry:       { woodCost: GAME_CONFIG.buildings.masonry.cost.player.wood, stoneCost: GAME_CONFIG.buildings.masonry.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT] },
    farmhouse:     { woodCost: GAME_CONFIG.buildings.farmhouse.cost.player.wood, stoneCost: GAME_CONFIG.buildings.farmhouse.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Farmhouse built! Now build a Silo [I] and farm patches [J]', unitAIHook: (c) => UnitAI.farmhousePositions.set(0, c) },
    workshop:      { woodCost: GAME_CONFIG.buildings.workshop.cost.player.wood, stoneCost: GAME_CONFIG.buildings.workshop.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT, TerrainType.FOREST], notification: 'Workshop built!' },
    silo:          { woodCost: GAME_CONFIG.buildings.silo.cost.player.wood, stoneCost: GAME_CONFIG.buildings.silo.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Silo built! Villagers will carry crops here. Place farm patches [J]', unitAIHook: (c) => UnitAI.siloPositions.set(0, c) },
    smelter:       { woodCost: GAME_CONFIG.buildings.smelter.cost.player.wood, stoneCost: GAME_CONFIG.buildings.smelter.cost.player.stone, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: `Smelter built! Smelt steel with [Z] (${GAME_CONFIG.economy.recipes.steel.input.iron} iron + ${GAME_CONFIG.economy.recipes.steel.input.charcoal} charcoal)` },
    armory:        { woodCost: GAME_CONFIG.buildings.armory.cost.player.wood, stoneCost: GAME_CONFIG.buildings.armory.cost.player.stone, steelCost: GAME_CONFIG.buildings.armory.cost.player.steel, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Armory built! Train advanced melee units [6-9]' },
    wizard_tower:  { woodCost: GAME_CONFIG.buildings.wizard_tower.cost.player.wood, stoneCost: GAME_CONFIG.buildings.wizard_tower.cost.player.stone, crystalCost: GAME_CONFIG.buildings.wizard_tower.cost.player.crystal, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Wizard Tower built! Train magic units [0, Shift+1-2]' },
  };

  /** Generic building placement — replaces 6 individual placeX methods */
  private placeGenericBuilding(kind: BuildingKind, coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    const cfg = this.BUILDING_PLACEMENT_CONFIG[kind];
    if (!cfg.allowedTerrain.includes(tile.terrain)) return;
    if (this.isTileOccupied(key)) {
      this.hud.showNotification('Tile already occupied!', '#e67e22');
      return;
    }

    // Resource check (skip if debug freePlace for most buildings; silo always charges)
    const skipCost = this.hud.debugFlags.freePlace && kind !== 'silo';
    if (!skipCost) {
      const steelNeeded = cfg.steelCost ?? 0;
      const crystalNeeded = cfg.crystalCost ?? 0;
      if (this.woodStockpile[0] < cfg.woodCost || this.stoneStockpile[0] < cfg.stoneCost
          || this.steelStockpile[0] < steelNeeded || this.players[0].resources.crystal < crystalNeeded) {
        const parts = [`${cfg.woodCost} wood`];
        if (cfg.stoneCost > 0) parts.push(`${cfg.stoneCost} stone`);
        if (steelNeeded > 0) parts.push(`${steelNeeded} steel`);
        if (crystalNeeded > 0) parts.push(`${crystalNeeded} crystal`);
        this.hud.showNotification(`Need ${parts.join(' + ')} to build ${kind}!`, '#e67e22');
        return;
      }
      this.woodStockpile[0] -= cfg.woodCost;
      this.players[0].resources.wood = Math.max(0, this.players[0].resources.wood - cfg.woodCost);
      if (cfg.stoneCost > 0) {
        this.stoneStockpile[0] -= cfg.stoneCost;
        this.players[0].resources.stone = Math.max(0, this.players[0].resources.stone - cfg.stoneCost);
      }
      if (steelNeeded > 0) {
        this.steelStockpile[0] -= steelNeeded;
        this.players[0].resources.steel = Math.max(0, this.players[0].resources.steel - steelNeeded);
      }
      if (crystalNeeded > 0) {
        this.players[0].resources.crystal = Math.max(0, this.players[0].resources.crystal - crystalNeeded);
      }
    }
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Build mesh via BuildingSystem
    const meshMethodName = kind === 'wizard_tower' ? 'buildWizardTowerMesh'
      : `build${kind.charAt(0).toUpperCase() + kind.slice(1)}Mesh`;
    const meshBuilder = this.buildingSystem[meshMethodName as keyof BuildingSystem] as (pos: HexCoord, owner: number) => THREE.Group;
    const mesh = meshBuilder.call(this.buildingSystem, coord, 0);
    this.buildingSystem.registerBuilding(kind, 0, coord, mesh, cfg.maxHealth, true);

    // Post-placement hooks are DEFERRED until construction completes
    // (handled in handleConstructTick when progress reaches 1.0)

    // Exit placement mode
    this.exitPlacementMode(kind);
    this.resourceManager.updateStockpileVisual(0);
    this.hud.showNotification(`${kind} blueprint placed — builder needed!`, '#3498db');
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

  /** Plant a tree sapling on a plains tile (costs 1 wood) */
  private paintPlantTree(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Can plant on plains or mountain tiles (not water, snow, desert, swamp)
    if (tile.terrain !== TerrainType.PLAINS && tile.terrain !== TerrainType.MOUNTAIN) return;
    if (Pathfinder.blockedTiles.has(key)) return;
    if (UnitAI.farmPatches.has(key)) return;
    if (this.natureSystem.treeAge.has(key)) return; // Already has a tree/sapling

    // Cost 1 wood
    if (this.woodStockpile[0] < GAME_CONFIG.economy.harvest.tree.plantCost.wood) return;
    this.woodStockpile[0] -= GAME_CONFIG.economy.harvest.tree.plantCost.wood;
    this.players[0].resources.wood = Math.max(0, this.players[0].resources.wood - GAME_CONFIG.economy.harvest.tree.plantCost.wood);
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Sprout a sapling
    tile.terrain = TerrainType.FOREST;
    this.terrainDecorator.addTreeAtStage(coord, tile.elevation * 0.5, 0);
    this.natureSystem.treeAge.set(key, 0);
    this.natureSystem.treeGrowthTimers.set(key, this.natureSystem.TREE_GROWTH_TIME);
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
    this.selectionManager.setPlayerUnits(this.allUnits, 0);
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
    for (const unit of selected) {
      unit.stance = stance;
    }
    // Update the stance highlight without rebuilding the whole panel
    this.hud.updateStanceHighlight(stance);
    const label = stance === UnitStance.PASSIVE ? 'Passive' :
                  stance === UnitStance.DEFENSIVE ? 'Defensive' : 'Aggressive';
    this.hud.showNotification(`Stance: ${label}`, '#3498db');
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

  /** Set rally point for a building (called from InputManager after tile click in rally mode) */
  public setRallyPoint(buildingKey: string, target: HexCoord): void {
    this.rallyPointSystem.setRallyPoint(buildingKey, target);
  }

  // ===================== PLANT CROPS SYSTEM =====================

  private togglePlantCropsMode(): void {
    this.interaction.toggle({ kind: 'plant_crops' });
  }

  /** Plant a crop on a cleared plains tile */
  private paintPlantCrop(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Must be plains
    if (tile.terrain !== TerrainType.PLAINS) {
      this.hud.showNotification('⚠️ Crops can only be planted on plains!', '#e67e22');
      return;
    }

    // Must be cleared of grass (grass stage 0 or in clearedPlains set)
    const grassStage = this.natureSystem.getGrassAge(key);
    if (grassStage !== undefined && grassStage >= 1) {
      this.hud.showNotification('⚠️ Harvest the grass first before planting crops!', '#e67e22');
      return;
    }

    // Can't already be a farm
    if (UnitAI.farmPatches.has(key)) return;
    if (Pathfinder.blockedTiles.has(key)) return;

    // Place farm patch
    UnitAI.farmPatches.add(key);
    this.natureSystem.clearedPlains.add(key);

    // Add visual marker
    this.blueprintSystem.addFarmPatchMarker(coord);
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
      const camPos = this.camera.camera.position;
      this.terrainDecorator.cameraWorldPos.x = camPos.x;
      this.terrainDecorator.cameraWorldPos.z = camPos.z;
      this.terrainDecorator.updateGrass(rawDelta);
      this.terrainDecorator.flushBounds();
      this.unitRenderer.updateBillboards(this.camera.camera);
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
    this.titleScene.dispose();
    this.titleScene = null;
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
