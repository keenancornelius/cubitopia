// ============================================
// CUBITOPIA - Main Entry Point (RTS Mode)
// A real-time strategy game with voxel worlds
// ============================================

import * as THREE from 'three';
import { Renderer } from './engine/Renderer';
import { StrategyCamera } from './engine/Camera';
import { VoxelBuilder } from './engine/VoxelBuilder';
import { UnitRenderer } from './engine/UnitRenderer';
import { TileHighlighter } from './engine/TileHighlighter';
import { TerrainDecorator } from './engine/TerrainDecorator';
import { MapGenerator } from './game/MapGenerator';
import { UnitFactory } from './game/entities/UnitFactory';
import { SelectionManager } from './game/systems/SelectionManager';
import { UnitAI } from './game/systems/UnitAI';
import { Pathfinder } from './game/systems/Pathfinder';
import { HUD } from './ui/HUD';
import { BaseRenderer } from './engine/BaseRenderer';
import ResourceManager from './game/systems/ResourceManager';
import BuildingSystem from './game/systems/BuildingSystem';
import WallSystem from './game/systems/WallSystem';
import type { WallSystemOps } from './game/systems/WallSystem';
import AIController from './game/systems/AIController';
import type { AIBuildingOps } from './game/systems/AIController';
import BuildingTooltipController from './game/systems/BuildingTooltipController';
import type { TooltipOps } from './game/systems/BuildingTooltipController';
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
} from './types';

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
  private static readonly MAX_MINE_DEPTH = -39; // One above bedrock floor at -40
  private static readonly UNDERGROUND_DEPTH = -40;

  private renderer: Renderer;
  private camera: StrategyCamera;
  private voxelBuilder: VoxelBuilder;
  private unitRenderer: UnitRenderer;
  private tileHighlighter: TileHighlighter;
  private terrainDecorator: TerrainDecorator;
  private selectionManager: SelectionManager;
  private hud: HUD;
  private clock: THREE.Clock;

  private currentMap: GameMap | null = null;
  private players: Player[] = [];
  private allUnits: Unit[] = [];
  private bases: Base[] = [];
  private baseRenderer: BaseRenderer;
  private gameOver = false;
  private gameOverOverlay: HTMLElement | null = null;
  private gameSpeed = 1;
  private gameMode: 'pvai' | 'aivai' = 'pvai';
  private mainMenuOverlay: HTMLElement | null = null;
  private debugOverlayContainer: HTMLElement | null = null;
  private debugOverlayLabels: Map<string, HTMLElement> = new Map();
  private resourceManager!: ResourceManager;
  private buildingSystem!: BuildingSystem;
  private wallSystem!: WallSystem;
  private aiController!: AIController;
  private tooltipController!: BuildingTooltipController;

  constructor() {
    this.renderer = new Renderer(ENGINE_CONFIG);
    this.camera = new StrategyCamera(
      CAMERA_CONFIG,
      document.getElementById(ENGINE_CONFIG.canvasId)!
    );
    this.voxelBuilder = new VoxelBuilder(this.renderer.scene);
    this.unitRenderer = new UnitRenderer(this.renderer.scene);
    this.baseRenderer = new BaseRenderer(this.renderer.scene);
    this.tileHighlighter = new TileHighlighter(this.renderer.scene);
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);

    const canvas = document.getElementById(ENGINE_CONFIG.canvasId)! as HTMLCanvasElement;
    this.selectionManager = new SelectionManager(canvas, this.camera.camera);
    this.selectionManager.setScene(this.renderer.scene);
    this.hud = new HUD();
    this.clock = new THREE.Clock();

    this.initSystems();
    this.setupEventHandlers();
    this.setupResizeHandler();
  }

  private setupEventHandlers(): void {
    this.hud.onNewMap(() => this.regenerateMap());

    // Wire up control panel buttons to same logic as keyboard
    this.hud.onBuildWalls(() => this.toggleBuildMode());
    this.hud.onHarvest(() => this.toggleHarvestMode());
    this.hud.onMine(() => this.toggleMineMode());
    this.hud.onBarracks(() => this.toggleBuildingPlaceMode('barracks'));
    this.hud.onForestry(() => this.toggleBuildingPlaceMode('forestry'));
    this.hud.onMasonry(() => this.toggleBuildingPlaceMode('masonry'));
    this.hud.onSellWood(() => this.resourceManager.doSellWood());
    this.hud.onSpawnWarrior(() => this.doSpawnQueueGeneric('barracks', UnitType.WARRIOR, 5, 'Warrior'));
    this.hud.onSpawnArcher(() => this.doSpawnQueueGeneric('barracks', UnitType.ARCHER, 8, 'Archer'));
    this.hud.onSpawnRider(() => this.doSpawnQueueGeneric('barracks', UnitType.RIDER, 10, 'Rider'));
    this.hud.onSpawnLumberjack(() => this.doSpawnQueueGeneric('forestry', UnitType.LUMBERJACK, 3, 'Lumberjack'));
    this.hud.onSpawnBuilder(() => this.doSpawnQueueGeneric('masonry', UnitType.BUILDER, 3, 'Builder'));
    this.hud.onFarmhouse(() => this.toggleBuildingPlaceMode('farmhouse'));
    this.hud.onSilo(() => this.toggleBuildingPlaceMode('silo'));
    this.hud.onFarmPatch(() => this.toggleFarmPatchMode());
    this.hud.onPlantTree(() => this.togglePlantTreeMode());
    this.hud.onSpawnVillager(() => this.doSpawnQueueGeneric('farmhouse', UnitType.VILLAGER, 3, 'Villager'));
    this.hud.onHelp(() => this.hud.isHelpVisible() ? this.hud.hideHelp() : this.hud.showHelp());
    this.hud.onPlantCrops(() => this.togglePlantCropsMode());
    this.hud.onWorkshop(() => this.toggleBuildingPlaceMode('workshop'));
    this.hud.onSpawnTrebuchet(() => this.doSpawnQueueWorkshop(UnitType.TREBUCHET, 'Trebuchet'));
    this.hud.onCraftRope(() => this.resourceManager.craftRope());
    this.hud.onSetStance((stance: UnitStance) => this.setSelectedUnitsStance(stance));
    this.hud.onSetFormation((formation: FormationType) => this.setSelectedUnitsFormation(formation));
    this.hud.onRespawnUnits(() => this.respawnSelectedUnits());

    // Debug panel callbacks
    this.hud.buildDebugPanel();
    this.hud.onDebugSpawn((type) => this.debugSpawnUnit(type));
    this.hud.onDebugGiveResources(() => this.debugGiveResources());
    this.hud.onDebugKillAllEnemy(() => this.debugKillAllEnemy());
    this.hud.onDebugDamageBase((owner, amount) => this.debugDamageBase(owner, amount));
    this.hud.onDebugGameSpeed((speed) => { this.gameSpeed = speed; this.hud.showNotification(`⏩ Speed: ${speed}x`, '#00bcd4'); });
    this.hud.onDebugTeleportMode(() => { this.hud.debugFlags.teleportMode = !this.hud.debugFlags.teleportMode; });
    this.hud.onDebugHealSelected(() => this.debugHealSelected());
    this.hud.onDebugSpawnEnemy((type) => this.debugSpawnEnemyUnit(type));
    this.hud.onDebugBuffSelected((stat) => this.debugBuffSelected(stat));
    this.hud.onDebugInstantWin(() => this.debugInstantWin());
    this.hud.onDebugInstantLose(() => this.debugInstantLose());
    this.hud.onDebugClearTrees(() => this.debugClearTrees());
    this.hud.onDebugClearStones(() => this.debugClearStones());
    this.hud.onDebugKillSelected(() => this.respawnSelectedUnits());

    // Selection changed
    this.selectionManager.onSelect((units) => {
      // In wall build mode, left-click places blueprints instead of selecting
      if (this.wallBuildMode) return;

      this.hud.updateSelection(units);
      this.tileHighlighter.clearAll();

      for (const u of this.allUnits) {
        this.unitRenderer.setSelected(u.id, units.includes(u));
      }

      for (const u of units) {
        const elev = this.getElevation(u.position);
        this.tileHighlighter.showSelection(u.position, elev);
      }

      // When units are selected, right-click should issue commands, not rotate camera
      StrategyCamera.suppressRightClick = units.length > 0;
    });

    // Right-click command
    this.selectionManager.onCommand((worldPos) => {
      this.issueCommand(worldPos);
    });

    // Keyboard shortcuts — delegate to shared methods
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    window.addEventListener('keydown', (e) => {
      if (this.hud.isHelpVisible()) return;

      if (e.key === 'b' || e.key === 'B') this.toggleBuildMode();
      if (e.key === 'h' || e.key === 'H') this.toggleHarvestMode();
      if (e.key === 'k' || e.key === 'K') this.toggleBuildingPlaceMode('barracks');
      if (e.key === 'f' || e.key === 'F') this.toggleBuildingPlaceMode('forestry');
      if (e.key === 'm' || e.key === 'M') this.toggleBuildingPlaceMode('masonry');
      if (e.key === 'r' || e.key === 'R') {
        // R rotates in any placement mode (walls auto-orient, no rotation needed)
        if (this.wallBuildMode) {
          // Walls connect automatically — no manual rotation
        } else if (this.barracksPlaceMode) {
          this.barracksRotation = this.barracksRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.barracksRotation;
        } else if (this.forestryPlaceMode) {
          this.forestryRotation = this.forestryRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.forestryRotation;
        } else if (this.masonryPlaceMode) {
          this.masonryRotation = this.masonryRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.masonryRotation;
        } else if (this.farmhousePlaceMode) {
          this.farmhouseRotation = this.farmhouseRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.farmhouseRotation;
        } else if (this.siloPlaceMode) {
          this.siloRotation = this.siloRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.siloRotation;
        } else if (this.workshopPlaceMode) {
          this.workshopRotation = this.workshopRotation === 0 ? Math.PI / 2 : 0;
          if (this.hoverGhost) this.hoverGhost.rotation.y = this.workshopRotation;
        }
      }
      if (e.key === 'g' || e.key === 'G') this.resourceManager.doSellWood();
      if (e.key === 'p' || e.key === 'P') this.toggleBuildingPlaceMode('farmhouse');
      if (e.key === 'i' || e.key === 'I') this.toggleBuildingPlaceMode('silo');
      if (e.key === 'w' || e.key === 'W') this.toggleBuildingPlaceMode('workshop');
      if (e.key === 'j' || e.key === 'J') this.toggleFarmPatchMode();
      if (e.key === 't' || e.key === 'T') this.togglePlantTreeMode();
      if (e.key === 'n' || e.key === 'N') this.toggleMineMode();
      if (e.key === 'c' || e.key === 'C') this.togglePlantCropsMode();
      if (e.key === '1') this.doSpawnQueueGeneric('barracks', UnitType.WARRIOR, 5, 'Warrior');
      if (e.key === '2') this.doSpawnQueueGeneric('barracks', UnitType.ARCHER, 8, 'Archer');
      if (e.key === '3') this.doSpawnQueueGeneric('barracks', UnitType.RIDER, 10, 'Rider');
      if (e.key === '4') this.doSpawnQueueGeneric('forestry', UnitType.LUMBERJACK, 3, 'Lumberjack');
      if (e.key === '5') this.doSpawnQueueGeneric('masonry', UnitType.BUILDER, 3, 'Builder');
      if (e.key === '6') this.doSpawnQueueGeneric('farmhouse', UnitType.VILLAGER, 3, 'Villager');
      if (e.key === '7') this.doSpawnQueueWorkshop(UnitType.TREBUCHET, 'Trebuchet');
      if (e.key === 'l' || e.key === 'L') this.resourceManager.craftRope();
      if (e.key === '`') this.hud.toggleDebugPanel();
    });

    // Ghost preview on mousemove (for all placement modes)
    canvasEl.addEventListener('mousemove', (e) => {
      const inPlacementMode = this.wallBuildMode || this.barracksPlaceMode ||
                             this.forestryPlaceMode || this.masonryPlaceMode ||
                             this.farmhousePlaceMode || this.siloPlaceMode || this.workshopPlaceMode;
      if (!inPlacementMode || !this.currentMap) {
        this.clearHoverGhost();
        return;
      }

      const rect = canvasEl.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera.camera);

      // Try multiple elevation planes to handle elevated terrain (forests, mountains)
      const hexCoord = this.raycastToHex(raycaster);
      if (!hexCoord) {
        this.clearHoverGhost();
        return;
      }

      const key = `${hexCoord.q},${hexCoord.r}`;
      const tile = this.currentMap.tiles.get(key);

      // Only show ghost on valid buildable terrain
      const isWallMode = this.wallBuildMode;
      const terrainOk = isWallMode
        ? (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.FOREST && tile.terrain !== TerrainType.MOUNTAIN)
        : (tile && (tile.terrain === TerrainType.PLAINS || tile.terrain === TerrainType.DESERT));
      if (!tile || !terrainOk || Pathfinder.blockedTiles.has(key)) {
        this.clearHoverGhost();
        return;
      }

      // Skip redundant updates
      if (this.lastHoverKey === key) return;
      this.lastHoverKey = key;

      // Create or move the hover ghost
      const worldX = hexCoord.q * 1.5;
      const worldZ = hexCoord.r * 1.5 + (hexCoord.q % 2 === 1 ? 0.75 : 0);
      const baseY = this.getElevation(hexCoord);

      // Remove old ghost and rebuild (geometry may differ per mode)
      if (this.hoverGhost) {
        this.clearHoverGhost();
      }

      this.hoverGhost = new THREE.Group();
      const ghostMat = new THREE.MeshBasicMaterial({
        color: 0x3498db, transparent: true, opacity: 0.25, depthWrite: false,
      });

      if (isWallMode) {
        // Pillar ghost + connector previews toward existing walls/blueprints
        const pillarGeo = new THREE.BoxGeometry(0.55, 2.0, 0.55);
        const pillar = new THREE.Mesh(pillarGeo, ghostMat);
        pillar.position.y = 1.0;
        this.hoverGhost.add(pillar);

        // Show connector previews to adjacent walls/blueprints
        const neighbors = Pathfinder.getHexNeighbors(hexCoord);
        for (const n of neighbors) {
          const nKey = `${n.q},${n.r}`;
          if (!this.wallSystem.wallsBuilt.has(nKey) && !this.blueprintGhosts.has(nKey)) continue;
          const nWorldX = n.q * 1.5;
          const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
          const dx = nWorldX - worldX;
          const dz = nWorldZ - worldZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const angle = Math.atan2(dx, dz);
          const segGeo = new THREE.BoxGeometry(0.4, 1.4, dist / 2);
          const seg = new THREE.Mesh(segGeo, ghostMat);
          seg.position.set(dx / 4, 0.7, dz / 4);
          seg.rotation.y = -angle;
          this.hoverGhost.add(seg);
        }
      } else {
        // Standard box ghost for other placement modes
        const ghostGeo = new THREE.BoxGeometry(1.45, 1.6, 0.5);
        const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
        ghostMesh.position.y = 0.8;
        this.hoverGhost.add(ghostMesh);
      }

      this.renderer.scene.add(this.hoverGhost);
      this.hoverGhost.position.set(worldX, baseY, worldZ);

      // Get the current rotation based on placement mode (walls don't rotate)
      let rotation = 0;
      if (this.barracksPlaceMode) rotation = this.barracksRotation;
      else if (this.forestryPlaceMode) rotation = this.forestryRotation;
      else if (this.masonryPlaceMode) rotation = this.masonryRotation;
      else if (this.farmhousePlaceMode) rotation = this.farmhouseRotation;
      else if (this.siloPlaceMode) rotation = this.siloRotation;
      else if (this.workshopPlaceMode) rotation = this.workshopRotation;

      this.hoverGhost.rotation.y = rotation;
    });

    // Build/Harvest/Barracks/Forestry/Masonry/Farm mode: click on tiles to place
    canvasEl.addEventListener('click', (e) => {
      // --- Debug teleport mode ---
      if (this.hud.debugFlags.teleportMode && this.currentMap) {
        const rect2 = canvasEl.getBoundingClientRect();
        const mouse2 = new THREE.Vector2(
          ((e.clientX - rect2.left) / rect2.width) * 2 - 1,
          -((e.clientY - rect2.top) / rect2.height) * 2 + 1,
        );
        const rc2 = new THREE.Raycaster();
        rc2.setFromCamera(mouse2, this.camera.camera);
        const hexTarget = this.raycastToHex(rc2);
        if (hexTarget) {
          this.debugTeleportSelected(hexTarget);
          return;
        }
      }

      const inMode = this.wallBuildMode || this.barracksPlaceMode ||
                     this.forestryPlaceMode || this.masonryPlaceMode ||
                     this.farmhousePlaceMode || this.siloPlaceMode || this.workshopPlaceMode ||
                     this.rallyPointSetMode || this.plantCropsMode;
      if (!inMode || !this.currentMap) return;

      const rect = canvasEl.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera.camera);

      const hexCoord = this.raycastToHex(raycaster);
      if (hexCoord) {
        if (this.wallBuildMode) {
          this.toggleWallBlueprint(hexCoord);
        } else if (this.barracksPlaceMode) {
          this.placeGenericBuilding('barracks', hexCoord);
        } else if (this.forestryPlaceMode) {
          this.placeGenericBuilding('forestry', hexCoord);
        } else if (this.masonryPlaceMode) {
          this.placeGenericBuilding('masonry', hexCoord);
        } else if (this.farmhousePlaceMode) {
          this.placeGenericBuilding('farmhouse', hexCoord);
        } else if (this.siloPlaceMode) {
          this.placeGenericBuilding('silo', hexCoord);
        } else if (this.workshopPlaceMode) {
          this.placeGenericBuilding('workshop', hexCoord);
        } else if (this.rallyPointSetMode && this.rallyPointBuilding) {
          this.setRallyPoint(this.rallyPointBuilding, hexCoord);
          this.hud.showNotification(`🚩 Rally point set for ${this.rallyPointBuilding}`, '#2ecc71');
          this.rallyPointSetMode = false;
          this.rallyPointBuilding = null;
          this.hud.setRallyPointMode(false);
          const canvasEl2 = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
          canvasEl2.style.cursor = 'default';
        } else if (this.plantCropsMode) {
          this.paintPlantCrop(hexCoord);
        }
      }
    });

    // --- Terrain info: click on any tile when not in a special mode to see info ---
    canvasEl.addEventListener('click', (e) => {
      const inAnyMode = this.wallBuildMode || this.barracksPlaceMode ||
                        this.forestryPlaceMode || this.masonryPlaceMode ||
                        this.farmhousePlaceMode || this.siloPlaceMode || this.workshopPlaceMode ||
                        this.harvestMode || this.farmPatchMode ||
                        this.plantTreeMode || this.mineMode ||
                        this.plantCropsMode || this.rallyPointSetMode;
      if (inAnyMode || !this.currentMap) return;

      // Raycast against building meshes to detect building clicks
      const rect = canvasEl.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera.camera);

      // Check all placed building meshes
      const buildingMeshes: THREE.Object3D[] = this.buildingSystem.placedBuildings.map(pb => pb.mesh);

      if (buildingMeshes.length > 0) {
        const hits = raycaster.intersectObjects(buildingMeshes, true);
        if (hits.length > 0) {
          // Find which PlacedBuilding was clicked by traversing up to a registered mesh
          let clickedPB: PlacedBuilding | null = null;
          let obj: THREE.Object3D | null = hits[0].object;
          while (obj) {
            const found = this.buildingSystem.placedBuildings.find(pb => pb.mesh === obj);
            if (found) { clickedPB = found; break; }
            obj = obj.parent;
          }
          if (clickedPB) {
            this.tooltipController.showTooltip(clickedPB, e.clientX, e.clientY);
            return;
          }
        }
      }

      const hex = this.mouseToHex(e, canvasEl);
      if (!hex) return;
      const key = `${hex.q},${hex.r}`;
      const tile = this.currentMap.tiles.get(key);
      if (tile) {
        this.hud.showTerrainInfo(tile);
      }
    });

    // --- Paint drag-select: mousedown starts painting, mousemove continues, mouseup stops ---
    let paintDragging = false;
    let mineEraseMode = false; // true = dragging to REMOVE mine markers
    let lastDragHex: HexCoord | null = null; // Track last hex for path-based drag (gates/walls)

    // Trace a hex-neighbor path from 'from' to the hex nearest 'to', returning all steps.
    // This ensures every placed tile is adjacent to the previous one — critical for hex grids.
    const traceHexPath = (from: HexCoord, to: HexCoord): HexCoord[] => {
      const path: HexCoord[] = [];
      let cur = { q: from.q, r: from.r };
      const toKey = `${to.q},${to.r}`;
      for (let steps = 0; steps < 30; steps++) {
        const curKey = `${cur.q},${cur.r}`;
        if (curKey === toKey) break;
        // Find the hex neighbor of 'cur' that's closest to 'to' in world space
        const neighbors = Pathfinder.getHexNeighbors(cur);
        const toWX = to.q * 1.5;
        const toWZ = to.r * 1.5 + (to.q % 2 === 1 ? 0.75 : 0);
        let bestN = neighbors[0];
        let bestDist = Infinity;
        for (const n of neighbors) {
          const nWX = n.q * 1.5;
          const nWZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
          const d = (nWX - toWX) ** 2 + (nWZ - toWZ) ** 2;
          if (d < bestDist) { bestDist = d; bestN = n; }
        }
        path.push(bestN);
        cur = bestN;
      }
      return path;
    };

    canvasEl.addEventListener('mousedown', (e) => {
      if (!this.harvestMode && !this.farmPatchMode && !this.plantTreeMode && !this.mineMode && !this.wallBuildMode) return;
      if (e.button !== 0) return; // Left click only
      paintDragging = true;
      lastDragHex = null;

      // Use mine-specific raycast for side-face detection in mine mode
      const hex = this.mineMode ? this.mouseToMineHex(e, canvasEl) : this.mouseToHex(e, canvasEl);
      if (hex) {
        if (this.harvestMode) this.paintHarvestTile(hex);
        else if (this.farmPatchMode) this.paintFarmPatch(hex);
        else if (this.plantTreeMode) this.paintPlantTree(hex);
        else if (this.wallBuildMode) {
          // First click determines drag mode: if tile already has blueprint, drag = erase
          const key = `${hex.q},${hex.r}`;
          mineEraseMode = UnitAI.playerWallBlueprint.has(key) || this.wallSystem.wallsBuilt.has(key);
          if (e.shiftKey) {
            // Shift+click: place gate instead
            if (mineEraseMode) {
              this.removeWallBlueprint(hex);
            } else {
              this.paintGateBlueprint(hex);
              lastDragHex = hex;
            }
          } else {
            // Normal click: place wall
            if (mineEraseMode) {
              this.removeWallBlueprint(hex);
            } else {
              this.paintWallBlueprint(hex);
              lastDragHex = hex;
            }
          }
        }
        else if (this.mineMode) {
          // First click determines drag mode: if tile already marked, drag = erase
          const key = `${hex.q},${hex.r}`;
          mineEraseMode = UnitAI.playerMineBlueprint.has(key);
          if (mineEraseMode) {
            this.unpaintMineTile(hex);
          } else {
            this.paintMineTile(hex);
          }
        }
      }
    });
    canvasEl.addEventListener('mousemove', (e) => {
      if (!paintDragging) return;
      const hex = this.mineMode ? this.mouseToMineHex(e, canvasEl) : this.mouseToHex(e, canvasEl);
      if (hex) {
        if (this.harvestMode) this.paintHarvestTile(hex);
        else if (this.farmPatchMode) this.paintFarmPatch(hex);
        else if (this.plantTreeMode) this.paintPlantTree(hex);
        else if (this.wallBuildMode) {
          if (mineEraseMode) {
            this.removeWallBlueprint(hex);
          } else if (e.shiftKey) {
            // Gate drag: trace hex-neighbor path from last gate to target
            if (lastDragHex) {
              const path = traceHexPath(lastDragHex, hex);
              for (const step of path) {
                this.paintGateBlueprint(step);
              }
              if (path.length > 0) lastDragHex = path[path.length - 1];
            } else {
              this.paintGateBlueprint(hex);
              lastDragHex = hex;
            }
          } else {
            // Wall drag: trace hex-neighbor path from last wall to target
            if (lastDragHex) {
              const path = traceHexPath(lastDragHex, hex);
              for (const step of path) {
                this.paintWallBlueprint(step);
              }
              if (path.length > 0) lastDragHex = path[path.length - 1];
            } else {
              this.paintWallBlueprint(hex);
              lastDragHex = hex;
            }
          }
        }
        else if (this.mineMode) {
          if (mineEraseMode) {
            this.unpaintMineTile(hex);
          } else {
            this.paintMineTile(hex);
          }
        }
      }
    });
    canvasEl.addEventListener('mouseup', () => {
      paintDragging = false;
      mineEraseMode = false;
      lastDragHex = null;
    });

    // Scroll wheel adjusts mine depth when in mine mode
    canvasEl.addEventListener('wheel', (e) => {
      if (this.mineMode) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -1 : 1; // scroll down = shallower, scroll up = deeper
        this.adjustMineDepth(delta);
      }
    }, { capture: true }); // capture phase so it fires before camera zoom
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

  /**
   * Raycast for mine mode — detects side-face hits for horizontal mining.
   * Returns the hex tile to mine: for top-face hits, the tile under the cursor;
   * for side-face hits, the tile BEHIND the clicked wall face.
   */
  /**
   * Mine-mode raycast with Shift+click for horizontal mining.
   * - Normal click: select the tile for downward mining (standard raycast).
   * - Shift+click: horizontal mining — resolve which tile you clicked, then pick the
   *   nearest HIGHER-elevation neighbor in the direction you clicked (offset from tile center).
   *   This works even though the camera can't physically raycast to side faces.
   */
  private mouseToMineHex(e: MouseEvent, canvasEl: HTMLCanvasElement): HexCoord | null {
    const rect = canvasEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera.camera);

    if (!this.currentMap) return this.raycastToHex(raycaster);

    // Raycast with face-normal detection for top vs side faces
    const intersects = raycaster.intersectObjects(this.renderer.scene.children, true);
    let clickedCoord: HexCoord | null = null;
    let hitPoint: THREE.Vector3 | null = null;
    let isTopFace = true; // Default to top face

    for (const hit of intersects) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      const name = hit.object.name || hit.object.parent?.name || '';
      if (name.startsWith('harvest_') || name.startsWith('ghost_') || name.startsWith('mine_')) continue;

      hitPoint = hit.point.clone();

      // Check face normal to determine if it's a top or side face
      if (hit.face && hit.face.normal) {
        let worldNormal = hit.face.normal.clone();
        const mesh = hit.object as THREE.Mesh;
        if (mesh.matrixWorld) {
          const normalMatrix = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld);
          worldNormal.applyMatrix3(normalMatrix).normalize();
        }

        // Top face has normal.y > 0.5
        isTopFace = worldNormal.y > 0.5;

        // If it's a side face, nudge the hit point outward along the normal
        if (!isTopFace) {
          hitPoint = hit.point.clone().add(worldNormal.clone().multiplyScalar(0.8));
        }
      }

      const coord = this.worldToHex(hitPoint);
      if (coord) {
        clickedCoord = coord;
        break;
      }
    }

    if (!clickedCoord) {
      clickedCoord = this.raycastToHex(raycaster);
    }
    if (!clickedCoord) return null;

    // --- SIDE FACE MINING (horizontal) ---
    // If the hit was a side face, this is treated as horizontal mining
    if (!isTopFace && this.currentMap) {
      // Side face click = mine the block on the tall column from the adjacent lower tile
      // The adjusted hit point already resolved to the neighbor, so just return it
      return clickedCoord;
    }

    // --- TOP FACE MINING (vertical) or Shift+click HORIZONTAL ---
    // For top face, normal vertical mining (dig downward)
    // For shift+click with top face, allow selecting a neighbor for horizontal mine
    if (e.shiftKey && this.currentMap) {
      // Use the click's world XZ offset from tile center to pick a direction
      const tileWorldX = clickedCoord.q * 1.5;
      const tileWorldZ = clickedCoord.r * 1.5 + (clickedCoord.q % 2 === 1 ? 0.75 : 0);

      // Direction from tile center to click point (XZ plane)
      let dx = 0, dz = 0;
      if (hitPoint) {
        dx = hitPoint.x - tileWorldX;
        dz = hitPoint.z - tileWorldZ;
      }
      // If click was dead center, use camera forward projected onto XZ
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) {
        const camDir = new THREE.Vector3();
        this.camera.camera.getWorldDirection(camDir);
        dx = camDir.x;
        dz = camDir.z;
      }

      // Score each neighbor by: (a) direction alignment, (b) higher elevation
      const neighbors = Pathfinder.getHexNeighbors(clickedCoord);
      const clickedTile = this.currentMap.tiles.get(`${clickedCoord.q},${clickedCoord.r}`);
      let bestNeighbor: HexCoord | null = null;
      let bestScore = -Infinity;

      for (const n of neighbors) {
        const nTile = this.currentMap.tiles.get(`${n.q},${n.r}`);
        if (!nTile) continue;
        // Only consider neighbors at higher elevation (they have a wall to mine)
        if (nTile.elevation <= (clickedTile?.elevation ?? 999)) continue;

        // Direction from clicked tile to this neighbor
        const nWorldX = n.q * 1.5;
        const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
        const ndx = nWorldX - tileWorldX;
        const ndz = nWorldZ - tileWorldZ;

        // Dot product for direction alignment (higher = better match)
        const len = Math.sqrt(dx * dx + dz * dz) * Math.sqrt(ndx * ndx + ndz * ndz);
        const dot = len > 0.001 ? (dx * ndx + dz * ndz) / len : 0;

        if (dot > bestScore) {
          bestScore = dot;
          bestNeighbor = n;
        }
      }

      // If we found a higher neighbor in the click direction, mine it (horizontal)
      if (bestNeighbor && bestScore > -0.5) return bestNeighbor;

      // No higher neighbors — fall through to normal downward mine
    }

    return clickedCoord;
  }

  /** Paint a single harvest tile (additive only during drag — no toggle) */
  private paintHarvestTile(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile || tile.terrain !== TerrainType.FOREST) return;
    if (UnitAI.playerHarvestBlueprint.has(key)) return; // Already marked
    UnitAI.playerHarvestBlueprint.add(key);
    this.addHarvestMarker(coord);
  }

  /** Paint a farm patch on cleared plains */
  private paintFarmPatch(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile || tile.terrain !== TerrainType.PLAINS) return;
    if (Pathfinder.blockedTiles.has(key)) return;

    // If tall grass (stage >= 2), mark for villager grass harvesting
    const grassStage = this.grassAge.get(key);
    if (grassStage !== undefined && grassStage >= 2) {
      if (UnitAI.playerGrassBlueprint.has(key)) return; // Already marked
      UnitAI.playerGrassBlueprint.add(key);
      this.addFarmPatchMarker(coord); // Reuse farm markers visually
      return;
    }

    // Otherwise mark as farm patch
    if (UnitAI.farmPatches.has(key)) return; // Already a farm
    if (this.farmPatchMarkers.has(key)) return;
    UnitAI.farmPatches.add(key);
    this.addFarmPatchMarker(coord);
  }

  private toggleWallBlueprint(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Validate: place on any non-water, non-forest, non-mountain, unoccupied terrain
    if (this.isWaterTerrain(tile.terrain) || tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.isTileOccupied(key)) return;

    const added = UnitAI.addBlueprint(coord);

    if (added) {
      // Show a ghost indicator on this tile
      this.addBlueprintGhost(coord);
    } else {
      // Remove ghost indicator
      this.removeBlueprintGhost(coord);
    }
  }

  /** Paint a wall blueprint (additive only during drag — no toggle) */
  private paintWallBlueprint(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;
    // Allow water (damming) — only block forest and mountain
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.isTileOccupied(key)) return;
    if (UnitAI.playerWallBlueprint.has(key)) return; // Already blueprinted
    if (UnitAI.playerGateBlueprint.has(key)) return; // Don't overlap with gate blueprints
    if (this.wallSystem.wallsBuilt.has(key)) return; // Already built

    UnitAI.addBlueprint(coord);
    this.addBlueprintGhost(coord);
  }

  /** Remove a wall blueprint during erase drag */
  private removeWallBlueprint(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (UnitAI.playerWallBlueprint.has(key)) {
      UnitAI.playerWallBlueprint.delete(key);
      this.removeBlueprintGhost(coord);
    }
    if (UnitAI.playerGateBlueprint.has(key)) {
      UnitAI.playerGateBlueprint.delete(key);
      this.removeBlueprintGhost(coord);
    }
  }

  private paintGateBlueprint(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;
    if (tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.MOUNTAIN) return;
    if (this.isTileOccupied(key)) return;
    if (UnitAI.playerGateBlueprint.has(key)) return; // Already blueprinted
    if (UnitAI.playerWallBlueprint.has(key)) return; // Don't overlap with walls
    if (this.wallSystem.gatesBuilt.has(key)) return; // Already built
    if (this.wallSystem.wallsBuilt.has(key)) return; // Don't overlap with walls

    UnitAI.addGateBlueprint(coord);
    this.addBlueprintGhost(coord);
  }

  private clearHoverGhost(): void {
    if (this.hoverGhost) {
      this.renderer.scene.remove(this.hoverGhost);
      this.hoverGhost.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      this.hoverGhost = null;
    }
    this.lastHoverKey = '';
  }

  private addBlueprintGhost(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.blueprintGhosts.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.getElevation(coord);

    // Transparent blue-tinted ghost wall pillar
    const ghostGeo = new THREE.BoxGeometry(0.55, 2.0, 0.55);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x3498db,
      transparent: true,
      opacity: 0.3,
      wireframe: false,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(ghostGeo, ghostMat);
    ghost.position.set(worldX, baseY + 1.0, worldZ);
    ghost.name = `ghost_${key}`;
    this.renderer.scene.add(ghost);
    this.blueprintGhosts.set(key, ghost);
  }

  private removeBlueprintGhost(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const ghost = this.blueprintGhosts.get(key);
    if (ghost) {
      this.renderer.scene.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      this.blueprintGhosts.delete(key);
    }
  }

  private clearAllBlueprintGhosts(): void {
    for (const [, ghost] of this.blueprintGhosts) {
      this.renderer.scene.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
    }
    this.blueprintGhosts.clear();
  }

  // --- Harvest Blueprint ---

  private toggleHarvestBlueprint(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Only mark forest tiles for harvesting
    if (tile.terrain !== TerrainType.FOREST) return;

    const added = UnitAI.addHarvestBlueprint(coord);

    if (added) {
      this.addHarvestMarker(coord);
    } else {
      this.removeHarvestMarker(coord);
    }
  }

  private addHarvestMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.harvestMarkers.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.getElevation(coord);

    // Green-tinted ring around the tree to show it's marked
    const ringGeo = new THREE.RingGeometry(0.5, 0.7, 6);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4caf50,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, baseY + 0.05, worldZ);
    ring.name = `harvest_${key}`;
    this.renderer.scene.add(ring);
    this.harvestMarkers.set(key, ring);
  }

  private removeHarvestMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const marker = this.harvestMarkers.get(key);
    if (marker) {
      this.renderer.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.harvestMarkers.delete(key);
    }
  }

  private clearAllHarvestMarkers(): void {
    for (const [, marker] of this.harvestMarkers) {
      this.renderer.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.harvestMarkers.clear();
  }

  // --- Mine Mode (paint-select like harvest) ---

  private paintMineTile(coord: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${coord.q},${coord.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;
    // Builders can mine ANY terrain except water bodies (ocean, river, lake)
    if (this.isWaterTerrain(tile.terrain)) return;
    if (tile.elevation <= Cubitopia.MAX_MINE_DEPTH) return; // Can't mine at max depth
    if (UnitAI.playerMineBlueprint.has(key)) return;
    // Calculate target elevation: current elevation minus depth layers
    const targetElev = Math.max(Cubitopia.MAX_MINE_DEPTH, tile.elevation - this.mineDepthLayers);
    UnitAI.playerMineBlueprint.set(key, targetElev);
    this.addMineMarker(coord, this.mineDepthLayers);
  }

  /** Remove mine marker — deselect a tile from mining queue */
  private unpaintMineTile(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (!UnitAI.playerMineBlueprint.has(key)) return;
    UnitAI.playerMineBlueprint.delete(key);
    UnitAI.claimedMines.delete(key);
    this.removeMineMarker(coord);
  }

  /** Adjust mine depth with scroll wheel while in mine mode */
  adjustMineDepth(delta: number): void {
    this.mineDepthLayers = Math.max(1, Math.min(20, this.mineDepthLayers + delta));
    this.hud.setMineMode(true, this.mineDepthLayers);
  }

  private addMineMarker(coord: HexCoord, depthLayers: number = 1): void {
    const key = `${coord.q},${coord.r}`;
    // Remove existing marker if re-marking
    if (this.mineMarkers.has(key)) {
      this.removeMineMarker(coord);
    }

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.getElevation(coord);

    // Orange-tinted ring to show tile is marked for mining
    // Ring gets thicker/brighter for deeper mining targets
    const innerRadius = 0.5 - Math.min(0.15, depthLayers * 0.015);
    const ringGeo = new THREE.RingGeometry(innerRadius, 0.7, 6);
    const brightness = Math.min(1.0, 0.5 + depthLayers * 0.05);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, brightness * 0.55, 0),
      transparent: true,
      opacity: Math.min(0.85, 0.5 + depthLayers * 0.03),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, baseY + 0.05, worldZ);
    ring.name = `mine_${key}`;
    this.renderer.scene.add(ring);
    this.mineMarkers.set(key, ring);
  }

  private removeMineMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const marker = this.mineMarkers.get(key);
    if (marker) {
      this.renderer.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.mineMarkers.delete(key);
    }
  }

  private clearAllMineMarkers(): void {
    for (const [, marker] of this.mineMarkers) {
      this.renderer.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.mineMarkers.clear();
  }

  private toggleMineMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.mineMode;
    this.clearAllModes();
    this.mineMode = !wasActive;
    this.hud.setMineMode(this.mineMode, this.mineDepthLayers);
    canvasEl.style.cursor = this.mineMode ? 'crosshair' : 'default';
    StrategyCamera.suppressLeftDrag = this.mineMode;
    SelectionManager.suppressBoxSelect = this.mineMode;
  }

  /** Handle mining terrain — peel off one layer of voxels, yield resources by terrain type */
  private handleMineTerrain(unit: Unit, minePos: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${minePos.q},${minePos.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Resource yield depends on terrain type and what layer we're mining
    let resourceYield = 0;
    let resourceType = ResourceType.STONE;
    const currentElev = tile.elevation;

    switch (tile.terrain) {
      case TerrainType.MOUNTAIN:
      case TerrainType.SNOW:
        resourceYield = 3; // Hard rock — good stone
        resourceType = ResourceType.STONE;
        break;
      case TerrainType.DESERT:
        resourceYield = 2; // Sand — yields clay
        resourceType = ResourceType.CLAY;
        break;
      case TerrainType.RIVER:
      case TerrainType.LAKE:
        resourceYield = 2; // Sandy riverbeds — yields clay
        resourceType = ResourceType.CLAY;
        break;
      case TerrainType.JUNGLE:
        resourceYield = 1; // Dense vegetation
        resourceType = ResourceType.STONE;
        break;
      case TerrainType.FOREST:
        resourceYield = 1; // Forest floor dirt
        resourceType = ResourceType.STONE;
        break;
      default:
        // Plains and other terrain: deeper layers yield more stone
        if (currentElev > 4) {
          resourceYield = 2; // Upper layers: dirt/stone mix
        } else if (currentElev > 2) {
          resourceYield = 2; // Mid layers: harder stone
        } else {
          resourceYield = 3; // Deep layers: solid rock
        }
        resourceType = ResourceType.STONE;
    }

    // Remove ONE layer of elevation (progressive mining)
    const newElevation = Math.max(Cubitopia.MAX_MINE_DEPTH, currentElev - 1);
    tile.elevation = newElevation;
    tile.voxelData.heightMap = [[newElevation]];

    // Remove decorations when terrain gets low
    if (newElevation <= 3 && tile.terrain !== TerrainType.PLAINS) {
      tile.terrain = TerrainType.PLAINS;
    }
    // Always clean up decorations when mining
    this.terrainDecorator.removeDecoration(minePos);
    this.terrainDecorator.removeGrassClump(key);
    this.grassAge.delete(key);
    this.grassGrowthTimers.delete(key);

    // Rebuild shell blocks for the mined tile AND its neighbors (newly exposed walls)
    this.rebuildTileShell(minePos);
    const neighbors = Pathfinder.getHexNeighbors(minePos);
    for (const n of neighbors) {
      this.rebuildTileShell(n);
    }

    // Check if mine blueprint target depth has been reached
    if (UnitAI.isMineComplete(key, tile.elevation)) {
      UnitAI.playerMineBlueprint.delete(key);
      UnitAI.claimedMines.delete(key);
      this.removeMineMarker(minePos);
    } else {
      // Release claim so the worker re-acquires it next idle tick (keeps mining)
      UnitAI.claimedMines.delete(key);
    }

    // Rebuild the voxel mesh for this area
    this.voxelBuilder.rebuildFromMap(this.currentMap);

    // Load resource onto the worker
    unit.carryAmount = Math.min(resourceYield, unit.carryCapacity);
    unit.carryType = resourceType;
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

    // Helper: get block type for a given y level
    const blockTypeAt = (y: number): BlockType => {
      if (y >= 0 && y === height - 1) return topBlock;
      if (y >= 0 && y >= height - 2) {
        return terrain === TerrainType.DESERT ? BlockType.SAND :
          terrain === TerrainType.SNOW ? BlockType.SNOW :
          terrain === TerrainType.MOUNTAIN ? BlockType.STONE : BlockType.DIRT;
      }
      if (y < -10) return BlockType.IRON;
      if (y < -5) return BlockType.GOLD;
      if (y < 0) return BlockType.STONE;
      return y < 2 ? BlockType.STONE : BlockType.DIRT;
    };

    // SURFACE BLOCKS (top 3 layers)
    for (const lx of offsets) {
      for (const lz of offsets) {
        for (let y = Math.max(DEPTH, height - 3); y < height; y++) {
          blocks.push({ localPosition: { x: lx, y, z: lz }, type: blockTypeAt(y), health: 100, maxHealth: 100 });
        }
      }
    }

    // BOTTOM FACE (bedrock floor at y=DEPTH)
    for (const lx of offsets) {
      for (const lz of offsets) {
        blocks.push({ localPosition: { x: lx, y: DEPTH, z: lz }, type: BlockType.GRASS, health: 100, maxHealth: 100 });
      }
    }

    // EDGE BLOCKS (side faces of the cube)
    if (isEdge) {
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = DEPTH + 1; y < Math.max(DEPTH + 1, height - 3); y++) {
            blocks.push({ localPosition: { x: lx, y, z: lz }, type: blockTypeAt(y), health: 100, maxHealth: 100 });
          }
        }
      }
    }

    // PIT WALL BLOCKS (where neighbors are lower — exposed underground)
    if (minNeighborElev < height - 3) {
      const wallTop = Math.max(DEPTH + 1, height - 3);
      const wallBottom = Math.max(DEPTH + 1, minNeighborElev);
      for (const lx of offsets) {
        for (const lz of offsets) {
          for (let y = wallBottom; y < wallTop; y++) {
            blocks.push({ localPosition: { x: lx, y, z: lz }, type: blockTypeAt(y), health: 100, maxHealth: 100 });
          }
        }
      }
    }

    // RIDGE / SNOW DECORATION BLOCKS — minable layer by layer
    const SNOW_CAP_HEIGHT = 13;
    const RIDGE_HEIGHT = 10;
    const isSnowZone = height >= SNOW_CAP_HEIGHT;
    const isRidgeTerrain = height >= RIDGE_HEIGHT;

    if (isRidgeTerrain && !isSnowZone && tile.terrain !== TerrainType.WATERFALL) {
      // Stone ridges below snow line — sparse peaked blocks
      for (let y = 0; y < 3; y++) {
        blocks.push({ localPosition: { x: 0, y: height + y, z: 0 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
      }
      for (let y = 0; y < 2; y++) {
        blocks.push({ localPosition: { x: -0.5, y: height + y, z: 0.5 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
      }
      blocks.push({ localPosition: { x: 0.5, y: height, z: -0.5 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
    }
    if (isSnowZone && tile.terrain !== TerrainType.WATERFALL) {
      // Snow zone ridges — fuller stone core covered in snow
      const ridgeOffsets: [number, number][] = [
        [0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5],
        [-0.5, 0.5], [0.5, -0.5],
      ];
      for (const [rx, rz] of ridgeOffsets) {
        const maxY = rx === 0 && rz === 0 ? 4 : (Math.abs(rx) + Math.abs(rz) < 0.8 ? 3 : 2);
        for (let y = 0; y < maxY; y++) {
          blocks.push({ localPosition: { x: rx, y: height + y, z: rz }, type: BlockType.STONE, health: 100, maxHealth: 100 });
        }
      }
      // Snow blanket
      blocks.push({ localPosition: { x: 0, y: height + 4, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: -0.5, y: height + 3, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0.5, y: height + 3, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0, y: height + 3, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0, y: height + 3, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: -0.5, y: height + 2, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0.5, y: height + 2, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0.5, y: height, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: -0.5, y: height, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
    }

    tile.voxelData.blocks = blocks;
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

    const enemyAtTarget = this.findEnemyAt(hexCoord, selected[0].owner);

    if (enemyAtTarget) {
      // Attack command: all units converge on the enemy
      for (const unit of selected) {
        (unit as any)._playerCommanded = true;
        UnitAI.commandAttack(unit, hexCoord, enemyAtTarget.id, this.currentMap!);
      }
    } else if (selected.length === 1) {
      // Single unit: move directly to the target hex
      (selected[0] as any)._playerCommanded = true;
      UnitAI.commandMove(selected[0], hexCoord, this.currentMap!);
    } else {
      // Group move: sort by unit type priority, then spread into formation
      // Outermost slots go to tanky units (low priority value)
      // Innermost slots go to ranged/protected units (high priority value)
      const sortedSelected = [...selected].sort((a, b) =>
        this.getUnitFormationPriority(a) - this.getUnitFormationPriority(b)
      );

      const formationSlots = this.generateFormationTyped(hexCoord, sortedSelected.length, this.selectedFormation);
      for (let i = 0; i < sortedSelected.length; i++) {
        const unit = sortedSelected[i];
        (unit as any)._playerCommanded = true;
        const slot = formationSlots[i] || hexCoord;
        UnitAI.commandMove(unit, slot, this.currentMap!);
      }
    }

    // Flash move indicator
    const elev = this.getElevation(hexCoord);
    this.tileHighlighter.showMovementRange([hexCoord], () => elev);
    setTimeout(() => this.tileHighlighter.clearMovementRange(), 500);
  }

  /**
   * Generate military formation positions around a center hex.
   * Places the first unit at center, then fills outward in concentric rings.
   * Prefers a tight rectangular block formation (like real infantry).
   */
  private generateFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [center]; // First unit goes to the exact target
    if (count <= 1) return slots;

    // Build rings of hex neighbors outward from center
    for (let radius = 1; slots.length < count && radius <= 5; radius++) {
      const ring = this.getHexRing(center, radius);
      // Sort ring tiles by distance to center (tightest packing first)
      ring.sort((a, b) => {
        const da = Math.abs(a.q - center.q) + Math.abs(a.r - center.r);
        const db = Math.abs(b.q - center.q) + Math.abs(b.r - center.r);
        return da - db;
      });
      for (const hex of ring) {
        if (slots.length >= count) break;
        const key = `${hex.q},${hex.r}`;
        const tile = this.currentMap?.tiles.get(key);
        if (!tile) continue;
        if (this.isWaterTerrain(tile.terrain) || tile.terrain === TerrainType.FOREST ||
            tile.elevation >= 10) continue;
        if (Pathfinder.blockedTiles.has(key)) continue;
        slots.push(hex);
      }
    }
    return slots;
  }

  /** Get all hex coordinates on a ring at the given radius from center */
  private getHexRing(center: HexCoord, radius: number): HexCoord[] {
    const ring: HexCoord[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        // Only include tiles on the ring perimeter
        if (Math.abs(dq) === radius || Math.abs(dr) === radius) {
          ring.push({ q: center.q + dq, r: center.r + dr });
        }
      }
    }
    return ring;
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

  /** Raycast against multiple elevation planes and return the best matching hex tile */
  private raycastToHex(raycaster: THREE.Raycaster): HexCoord | null {
    if (!this.currentMap) return null;

    // Try scene object intersection first (most accurate)
    const intersects = raycaster.intersectObjects(this.renderer.scene.children, true);
    for (const hit of intersects) {
      // Skip sprites, lines, particles, etc — only care about mesh hits
      if (!(hit.object instanceof THREE.Mesh)) continue;
      // Skip ocean plane, UI elements, harvest markers, blueprint ghosts
      const name = hit.object.name || hit.object.parent?.name || '';
      if (name.startsWith('harvest_') || name.startsWith('ghost_') || name.startsWith('mine_')) continue;

      const coord = this.worldToHex(hit.point);
      if (coord) return coord;
    }

    // Fallback: try multiple elevation planes (0, 0.5, 1.0, 1.5, 2.0)
    let bestCoord: HexCoord | null = null;
    const elevations = [0, 0.5, 1.0, 1.5, 2.0];
    for (const elev of elevations) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);
      if (intersection) {
        const coord = this.worldToHex(intersection);
        if (coord) {
          const tileElev = this.getElevation(coord);
          // Pick the coord whose tile elevation best matches this plane
          if (Math.abs(tileElev - elev) < 0.5) {
            bestCoord = coord;
            break;
          }
          // Keep the first valid coord as fallback
          if (!bestCoord) bestCoord = coord;
        }
      }
    }
    return bestCoord;
  }

  private getElevation(coord: HexCoord): number {
    if (!this.currentMap) return 1;
    const tile = this.currentMap.tiles.get(`${coord.q},${coord.r}`);
    return tile ? tile.elevation * 0.5 : 0.5;
  }

  private hexToWorld(coord: HexCoord): { x: number; y: number; z: number } {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const y = this.getElevation(coord) + 0.25;
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
      hexToWorld: (pos: HexCoord) => this.hexToWorld(pos),
      getElevation: (pos: HexCoord) => this.getElevation(pos),
      isTileOccupied: (key: string) => this.isTileOccupied(key),
      findSpawnTile: (map: GameMap, q: number, r: number, allowOccupied?: boolean) => this.findSpawnTile(map, q, r, allowOccupied),
      isWaterTerrain: (terrain: TerrainType) => this.isWaterTerrain(terrain),
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
      removeBlueprintGhost: (coord) => this.removeBlueprintGhost(coord),
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
      registerBuilding: (kind, owner, pos, mesh, maxHealth?) => this.buildingSystem.registerBuilding(kind, owner, pos, mesh, maxHealth),
    };
    this.aiController = new AIController(ctx, buildOps);

    // Tooltip controller handles building click UI, demolish, and unit queuing
    const tooltipOps: TooltipOps = {
      enterRallyPointMode: (key) => this.enterRallyPointModeForBuilding(key),
      demolishBuilding: (pb) => this.demolishBuilding(pb),
      queueUnit: (unitType, buildingKind) => this.queueUnitFromTooltip(unitType, buildingKind),
      getBuildingQueueOptions: (kind) => this.buildingSystem.getBuildingQueueOptions(kind),
    };
    this.tooltipController = new BuildingTooltipController(ctx, tooltipOps);
  }

  /** Flatten terrain around a base position — modifies tile data BEFORE voxel rendering */
  private flattenBaseArea(map: GameMap, baseQ: number, midR: number, radius: number): void {
    // Use a consistent flat elevation (3) for the entire base area
    const FLAT_ELEV = 3;

    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const q = baseQ + dq;
        const r = midR + dr;
        const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
        if (hexDist > radius) continue;

        const key = `${q},${r}`;
        const tile = map.tiles.get(key);
        if (!tile) continue;

        // Convert ALL non-walkable terrain to PLAINS (including water at edges)
        let changed = false;
        if (tile.terrain !== TerrainType.PLAINS && tile.terrain !== TerrainType.FOREST) {
          tile.terrain = TerrainType.PLAINS;
          changed = true;
        }

        // Force flat elevation across the whole base area
        if (tile.elevation !== FLAT_ELEV) {
          tile.elevation = FLAT_ELEV;
          changed = true;
        }

        // Rebuild voxel data if anything changed
        if (changed) {
          this.rebuildTileShell({ q, r });
        }
      }
    }

    // Smooth transition: clamp neighbors at the border so there's no sheer cliff
    const rebuilt = new Set<string>();
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const q = baseQ + dq;
        const r = midR + dr;
        const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
        if (hexDist > radius) continue;
        for (const n of Pathfinder.getHexNeighbors({ q, r })) {
          const nk = `${n.q},${n.r}`;
          if (rebuilt.has(nk)) continue;
          rebuilt.add(nk);

          const nTile = map.tiles.get(nk);
          if (nTile) {
            // Clamp border neighbors to at most 2 above flat level so no cliff walls
            if (nTile.elevation > FLAT_ELEV + 2) {
              nTile.elevation = FLAT_ELEV + 2;
            }
            // Convert impassable border terrain
            if (nTile.terrain === TerrainType.MOUNTAIN || nTile.terrain === TerrainType.SNOW) {
              nTile.terrain = TerrainType.PLAINS;
            }
          }
          this.rebuildTileShell(n);
        }
      }
    }
  }

  // Ocean plane removed — terrain is a solid voxel mass floating in space
  private addOceanPlane(_mapSize: number): void {
    // No-op: ocean removed for cube planet preparation
  }

  // --- Shared action methods (called by both keys and control panel buttons) ---

  private toggleBuildMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.wallBuildMode;
    this.clearAllModes();
    this.wallBuildMode = !wasActive;
    this.hud.setBuildMode(this.wallBuildMode);
    if (!this.wallBuildMode) this.clearHoverGhost();
    canvasEl.style.cursor = this.wallBuildMode ? 'crosshair' : 'default';
    // Suppress camera pan and box-select during wall paint mode
    StrategyCamera.suppressLeftDrag = this.wallBuildMode;
    SelectionManager.suppressBoxSelect = this.wallBuildMode;
  }

  private toggleHarvestMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.harvestMode;
    this.clearAllModes();
    this.harvestMode = !wasActive;
    this.hud.setHarvestMode(this.harvestMode);
    canvasEl.style.cursor = this.harvestMode ? 'crosshair' : 'default';
    // Suppress camera pan and box-select during harvest paint mode
    StrategyCamera.suppressLeftDrag = this.harvestMode;
    SelectionManager.suppressBoxSelect = this.harvestMode;
  }

  /** Generic building placement mode toggle — replaces per-building toggleX methods */
  private toggleBuildingPlaceMode(kind: BuildingKind): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const modeKey = `${kind}PlaceMode` as keyof this;
    const wasActive = this[modeKey] as boolean;
    this.clearAllModes();
    (this as any)[modeKey] = !wasActive;
    const hudSetter = `set${kind.charAt(0).toUpperCase() + kind.slice(1)}Mode` as keyof HUD;
    (this.hud[hudSetter] as (v: boolean) => void)(!wasActive);
    canvasEl.style.cursor = !wasActive ? 'crosshair' : 'default';
  }

  /** Spawn queue config for simple (single-resource) buildings */
  private readonly SPAWN_QUEUE_CONFIG: Record<string, {
    buildingKind: BuildingKind;
    getBuilding: () => any;
    resourceType: 'gold' | 'wood';
    getResource: () => number;
    getQueue: () => { type: UnitType; cost: number }[];
    updateHUD?: (q: { type: UnitType; cost: number }[]) => void;
  }> = {
    barracks:  { buildingKind: 'barracks',  getBuilding: () => this.barracks,  resourceType: 'gold', getResource: () => this.players[0].resources.gold, getQueue: () => this.spawnQueue,          updateHUD: (q) => this.hud.updateSpawnQueue(q) },
    forestry:  { buildingKind: 'forestry',  getBuilding: () => this.forestry,  resourceType: 'wood', getResource: () => this.woodStockpile[0],          getQueue: () => this.forestrySpawnQueue,  updateHUD: (q) => this.hud.updateForestrySpawnQueue(q) },
    masonry:   { buildingKind: 'masonry',   getBuilding: () => this.masonry,   resourceType: 'wood', getResource: () => this.woodStockpile[0],          getQueue: () => this.masonrySpawnQueue,   updateHUD: (q) => this.hud.updateMasonrySpawnQueue(q) },
    farmhouse: { buildingKind: 'farmhouse', getBuilding: () => this.farmhouse, resourceType: 'wood', getResource: () => this.woodStockpile[0],          getQueue: () => this.farmhouseSpawnQueue },
  };

  /** Generic spawn queue for simple (single-resource) buildings */
  private doSpawnQueueGeneric(buildingKey: string, type: UnitType, cost: number, name: string): void {
    const cfg = this.SPAWN_QUEUE_CONFIG[buildingKey];
    if (!cfg) return;
    if (!cfg.getBuilding()) {
      this.hud.showNotification(`Place a ${cfg.buildingKind.charAt(0).toUpperCase() + cfg.buildingKind.slice(1)} first, then press ${name} again`, '#e67e22');
      this.toggleBuildingPlaceMode(cfg.buildingKind);
      return;
    }
    if (!this.hud.debugFlags.freeBuild && cfg.getResource() < cost) {
      this.hud.showNotification(`Need ${cost} ${cfg.resourceType} for ${name}! (have ${cfg.getResource()})`, '#e67e22');
      return;
    }
    cfg.getQueue().push({ type, cost: this.hud.debugFlags.freeBuild ? 0 : cost });
    if (cfg.updateHUD) cfg.updateHUD(cfg.getQueue());
    this.hud.showNotification(`${name} queued (${this.hud.debugFlags.freeBuild ? 'FREE' : cost + ' ' + cfg.resourceType})`, '#2ecc71');
  }

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
    this.wallSystem.cleanup();
    UnitAI.wallsBuilt.clear();
    UnitAI.wallOwners.clear();
    // Clear rally point flags
    for (const [, flagGroup] of this.rallyFlagMeshes) {
      this.renderer.scene.remove(flagGroup);
      flagGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    this.rallyFlagMeshes.clear();
    // Clear rally point lines
    for (const [, line] of this.rallyLineMeshes) {
      this.renderer.scene.remove(line);
      line.geometry.dispose();
      if (line.material instanceof THREE.Material) line.material.dispose();
    }
    this.rallyLineMeshes.clear();
    this.rallyPoints.clear();
    this.rallyPointSetMode = false;
    this.rallyPointBuilding = null;

    this.clearAllBlueprintGhosts();
    this.clearHoverGhost();
    UnitAI.clearBlueprints();
    UnitAI.clearHarvestBlueprints();
    UnitAI.barracksPositions.clear();
    this.clearAllHarvestMarkers();
    this.clearAllMineMarkers();
    this.wallBuildMode = false;
    this.harvestMode = false;
    this.barracksPlaceMode = false;
    this.forestryPlaceMode = false;
    this.masonryPlaceMode = false;
    this.hud.setBuildMode(false);
    this.hud.setHarvestMode(false);
    this.hud.setBarracksMode(false);
    this.hud.setForestryMode(false);
    this.hud.setMasonryMode(false);
    this.wallRotation = 0;
    this.barracksRotation = 0;
    this.forestryRotation = 0;
    this.masonryRotation = 0;
    // Remove all placed building meshes from scene
    this.buildingSystem.cleanup();
    this.tooltipController.cleanup();
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.forestrySpawnQueue = [];
    this.forestrySpawnTimer = 0;
    this.masonrySpawnQueue = [];
    this.masonrySpawnTimer = 0;
    this.farmhouseSpawnQueue = [];
    this.farmhouseSpawnTimer = 0;
    this.farmhousePlaceMode = false;
    this.siloPlaceMode = false;
    this.farmPatchMode = false;
    this.plantTreeMode = false;
    this.foodStockpile = [10, 10];
    this.stoneStockpile = [0, 0];
    this.grassFiberStockpile = [0, 0];
    this.clayStockpile = [0, 0];
    this.ropeStockpile = [0, 0];
    this.workshopSpawnQueue = [];
    this.workshopSpawnTimer = 0;
    this.workshopPlaceMode = false;
    this.clearAllFarmPatchMarkers();
    UnitAI.farmPatches.clear();
    UnitAI.playerGrassBlueprint.clear();
    UnitAI.claimedFarms.clear();
    UnitAI.claimedTrees.clear();
    UnitAI.clearUnreachableCache();
    UnitAI.siloPositions.clear();
    UnitAI.farmhousePositions.clear();
    UnitAI.grassTiles.clear();
    // Building meshes are cleaned up by buildingSystem.cleanup() above
    this.treeRegrowthTimers.clear();
    this.treeAge.clear();
    this.treeGrowthTimers.clear();
    this.treeSproutTimer = 0;
    this.grassAge.clear();
    this.grassGrowthTimers.clear();
    this.grassSpreadTimer = 0;
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
    if (this.gameOverOverlay) {
      this.gameOverOverlay.remove();
      this.gameOverOverlay = null;
    }
    this.terrainDecorator = new TerrainDecorator(this.renderer.scene);
    this.showMainMenu();
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

  private showMainMenu(): void {
    if (this.mainMenuOverlay) {
      this.mainMenuOverlay.remove();
      this.mainMenuOverlay = null;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #0a0a1a 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      z-index:20000; font-family:'Courier New',monospace;
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `
      font-size:64px; font-weight:bold; color:#fff; text-shadow: 0 0 40px rgba(52,152,219,0.6), 0 0 80px rgba(52,152,219,0.3);
      letter-spacing:8px; margin-bottom:8px;
    `;
    title.textContent = 'CUBITOPIA';
    overlay.appendChild(title);

    // Subtitle
    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:14px; color:#888; letter-spacing:4px; margin-bottom:60px; text-transform:uppercase;';
    subtitle.textContent = 'Voxel Strategy';
    overlay.appendChild(subtitle);

    // Mode buttons
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex; flex-direction:column; gap:16px; align-items:center;';

    const mkMenuBtn = (label: string, sublabel: string, color: string, mode: 'pvai' | 'aivai') => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${color}; border:2px solid ${color}; padding:16px 48px;
        font-size:18px; font-family:'Courier New',monospace; font-weight:bold;
        border-radius:4px; cursor:pointer; letter-spacing:3px; min-width:320px;
        transition: all 0.2s;
      `;
      btn.innerHTML = `${label}<br><span style="font-size:11px;color:#888;font-weight:normal;letter-spacing:1px;">${sublabel}</span>`;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = color;
        btn.style.color = '#000';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = color;
      });
      btn.addEventListener('click', () => {
        this.gameMode = mode;
        overlay.remove();
        this.mainMenuOverlay = null;
        this.startNewGame();
      });
      return btn;
    };

    btnContainer.appendChild(mkMenuBtn('PLAYER vs AI', 'Command your army against the AI opponent', '#3498db', 'pvai'));
    btnContainer.appendChild(mkMenuBtn('AI vs AI', 'Watch two AI commanders battle it out', '#e74c3c', 'aivai'));
    overlay.appendChild(btnContainer);

    // Version
    const ver = document.createElement('div');
    ver.style.cssText = 'position:absolute; bottom:20px; color:#444; font-size:10px; letter-spacing:2px;';
    ver.textContent = 'v0.1 — PLAYTEST BUILD';
    overlay.appendChild(ver);

    document.body.appendChild(overlay);
    this.mainMenuOverlay = overlay;
  }

  startNewGame(): void {
    const mapGen = new MapGenerator();
    const MAP_SIZE = 50;
    const map = mapGen.generate(MAP_SIZE, MAP_SIZE);
    this.currentMap = map;

    // Flatten terrain around base spawn areas BEFORE building voxels
    const midR = Math.floor(MAP_SIZE / 2);
    const BASE_INSET = 5; // Tiles inward from corner edges
    // Bases spawn at opposite corners (bottom-left vs top-right)
    const P1_Q = BASE_INSET;
    const P1_R = MAP_SIZE - 1 - BASE_INSET;
    const P2_Q = MAP_SIZE - 1 - BASE_INSET;
    const P2_R = BASE_INSET;
    const FLATTEN_RADIUS = 4;
    this.flattenBaseArea(map, P1_Q, P1_R, FLATTEN_RADIUS);
    this.flattenBaseArea(map, P2_Q, P2_R, FLATTEN_RADIUS);

    // Build terrain
    map.tiles.forEach((tile, key) => {
      const [q, r] = key.split(',').map(Number);
      const worldX = q * 1.5;
      const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);

      if (!this.isWaterTerrain(tile.terrain)) {
        for (const block of tile.voxelData.blocks) {
          this.voxelBuilder.addBlock(
            {
              x: worldX + block.localPosition.x,
              y: block.localPosition.y,
              z: worldZ + block.localPosition.z,
            },
            block.type
          );
        }
      }

      const scaledElevation = tile.elevation * 0.5;

      // Find max neighbor elevation to prevent tree clipping through taller neighbors
      let maxNeighborElev = scaledElevation;
      const neighbors = q % 2 === 0
        ? [[q-1,r-1],[q,r-1],[q+1,r-1],[q-1,r],[q+1,r],[q,r+1]]
        : [[q,r-1],[q-1,r],[q+1,r],[q-1,r+1],[q,r+1],[q+1,r+1]];
      for (const [nq, nr] of neighbors) {
        const nTile = map.tiles.get(`${nq},${nr}`);
        if (nTile) {
          maxNeighborElev = Math.max(maxNeighborElev, nTile.elevation * 0.5);
        }
      }

      this.terrainDecorator.decorateTile({ q, r }, tile.terrain, scaledElevation, maxNeighborElev);

    });

    // Add water curtains on river/lake tiles where they drop to a lower water neighbor
    map.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.RIVER && tile.terrain !== TerrainType.LAKE) return;
      const [q, r] = key.split(',').map(Number);
      const myElev = tile.elevation;
      const worldX = q * 1.5;
      const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);
      const scaledElev = myElev * 0.5;

      // Check each neighbor for elevation drop
      const nCoords = q % 2 === 0
        ? [[q-1,r-1],[q,r-1],[q+1,r-1],[q-1,r],[q+1,r],[q,r+1]]
        : [[q,r-1],[q-1,r],[q+1,r],[q-1,r+1],[q,r+1],[q+1,r+1]];
      // Map neighbor index to approximate face direction
      const nDirs = q % 2 === 0
        ? [{ dx:-1, dz:-1 }, { dx:0, dz:-1 }, { dx:1, dz:-1 }, { dx:-1, dz:0 }, { dx:1, dz:0 }, { dx:0, dz:1 }]
        : [{ dx:0, dz:-1 }, { dx:-1, dz:0 }, { dx:1, dz:0 }, { dx:-1, dz:1 }, { dx:0, dz:1 }, { dx:1, dz:1 }];

      for (let i = 0; i < nCoords.length; i++) {
        const [nq, nr] = nCoords[i];
        const nTile = map.tiles.get(`${nq},${nr}`);
        if (!nTile) continue;
        const nElev = nTile.elevation;
        const elevDrop = myElev - nElev;
        // Only add curtain if there's a meaningful drop (2+ block difference)
        if (elevDrop >= 2) {
          const dropHeight = elevDrop * 0.5; // scale to world units
          // Simplify direction to cardinal (nearest axis)
          const dir = nDirs[i];
          const absDx = Math.abs(dir.dx);
          const absDz = Math.abs(dir.dz);
          let faceDx = 0, faceDz = 0;
          if (absDx >= absDz) {
            faceDx = dir.dx > 0 ? 1 : -1;
          } else {
            faceDz = dir.dz > 0 ? 1 : -1;
          }
          this.terrainDecorator.addWaterEdgeCurtain(worldX, scaledElev, worldZ, faceDx, faceDz, dropHeight);
        }
      }
    });

    this.addOceanPlane(MAP_SIZE);

    // Initialize grass tracking for map-generated grass
    this.initializeGrassTracking();

    // Create players
    const makeResources = (): PlayerResources => ({
      food: 50, wood: 50, stone: 20, iron: 10, gold: 25, crystal: 0,
      grass_fiber: 0, clay: 0, rope: 0,
    });

    const p1IsAI = this.gameMode === 'aivai';
    this.players = [
      { id: 0, name: p1IsAI ? 'AI Blue' : 'Player 1', color: new THREE.Color(0x3498db), cities: [], units: [],
        resources: makeResources(), technology: [], isAI: p1IsAI, defeated: false },
      { id: 1, name: 'AI Opponent', color: new THREE.Color(0xe74c3c), cities: [], units: [],
        resources: makeResources(), technology: [], isAI: true, defeated: false },
    ];

    // --- Auto-Battler Spawn: armies on opposite corners ---

    // Player 1 (Blue) — near base: Builders, lumberjacks, villagers (no free combat units)
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

    // Player 2 (Red AI) — near base, workers only (same as player — must build up)
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

    this.allUnits = [...this.players[0].units, ...this.players[1].units];
    this.selectionManager.setPlayerUnits(this.allUnits, 0);
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // --- Spawn Home Bases ---
    const BASE_MAX_HEALTH = 500;

    // Player 1 base: bottom-left corner
    const p1BaseCoord = this.findSpawnTile(map, P1_Q, P1_R);
    const p1BaseWP = this.hexToWorld(p1BaseCoord);
    const p1Base: Base = {
      id: 'base_0', owner: 0, position: p1BaseCoord,
      worldPosition: p1BaseWP,
      health: BASE_MAX_HEALTH, maxHealth: BASE_MAX_HEALTH, destroyed: false,
    };

    // Player 2 base: top-right corner
    const p2BaseCoord = this.findSpawnTile(map, P2_Q, P2_R);
    const p2BaseWP = this.hexToWorld(p2BaseCoord);
    const p2Base: Base = {
      id: 'base_1', owner: 1, position: p2BaseCoord,
      worldPosition: p2BaseWP,
      health: BASE_MAX_HEALTH, maxHealth: BASE_MAX_HEALTH, destroyed: false,
    };

    this.bases = [p1Base, p2Base];
    this.baseRenderer.addBase(p1Base, this.getElevation(p1BaseCoord));
    this.baseRenderer.addBase(p2Base, this.getElevation(p2BaseCoord));

    // Register bases as wall-connectable structures
    this.buildingSystem.wallConnectable.add(`${p1BaseCoord.q},${p1BaseCoord.r}`);
    this.buildingSystem.wallConnectable.add(`${p2BaseCoord.q},${p2BaseCoord.r}`);

    // Tell UnitAI where the bases are (for lumberjack return trips)
    UnitAI.basePositions.set(0, p1BaseCoord);
    UnitAI.basePositions.set(1, p2BaseCoord);

    // Base acts as default food storage — villagers deposit here until a silo is built
    UnitAI.siloPositions.set(0, p1BaseCoord);
    UnitAI.siloPositions.set(1, p2BaseCoord);

    // Block base tiles so pathfinder routes units around them
    Pathfinder.blockedTiles = this.getBaseTiles();
    Pathfinder.gateTiles.clear();

    // Generate coordinated keep wall plans for both players' builders
    UnitAI.generateKeepWallPlan(0, p1BaseCoord, map);
    UnitAI.generateKeepWallPlan(1, p2BaseCoord, map);

    // Set camera bounds to prevent panning off the map
    this.camera.setMapBounds(-3, -3, MAP_SIZE * 1.5 + 3, MAP_SIZE * 1.5 + 3);

    // Camera focuses on map center for auto-battler view
    const centerQ = Math.floor(MAP_SIZE / 2);
    this.camera.focusOn(new THREE.Vector3(centerQ * 1.5, 2, midR * 1.5));

    // Display initial stockpiles
    this.resourceManager.updateStockpileVisual(0);
    this.resourceManager.updateStockpileVisual(1);

    // Update HUD mode indicator
    this.hud.setGameMode(this.gameMode);
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
    }

    // --- Generic spawn queue processing ---
    // Each entry: [kind, queue, timer field, spawn time, canAfford fn, deductCost fn]
    type SimpleQueueItem = { type: UnitType; cost: number };
    type WorkshopQueueItem = { type: UnitType; cost: { wood: number; stone: number; rope: number } };

    const spawnConfigs: {
      kind: string; color: string; spawnTime: number;
      queue: { type: UnitType }[];
      getTimer: () => number; setTimer: (v: number) => void;
      canAfford: (item: any) => boolean; deductCost: (item: any) => void;
    }[] = [
      {
        kind: 'barracks', color: '#e67e22', spawnTime: 5,
        queue: this.spawnQueue,
        getTimer: () => this.spawnTimer, setTimer: (v) => { this.spawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => this.players[0].resources.gold >= item.cost,
        deductCost: (item: SimpleQueueItem) => { this.players[0].resources.gold -= item.cost; },
      },
      {
        kind: 'forestry', color: '#6b8e23', spawnTime: 5,
        queue: this.forestrySpawnQueue,
        getTimer: () => this.forestrySpawnTimer, setTimer: (v) => { this.forestrySpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => this.woodStockpile[0] >= item.cost,
        deductCost: (item: SimpleQueueItem) => { this.woodStockpile[0] -= item.cost; this.players[0].resources.wood -= item.cost; },
      },
      {
        kind: 'masonry', color: '#808080', spawnTime: 5,
        queue: this.masonrySpawnQueue,
        getTimer: () => this.masonrySpawnTimer, setTimer: (v) => { this.masonrySpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => this.woodStockpile[0] >= item.cost,
        deductCost: (item: SimpleQueueItem) => { this.woodStockpile[0] -= item.cost; this.players[0].resources.wood -= item.cost; },
      },
      {
        kind: 'farmhouse', color: '#d4a030', spawnTime: 5,
        queue: this.farmhouseSpawnQueue,
        getTimer: () => this.farmhouseSpawnTimer, setTimer: (v) => { this.farmhouseSpawnTimer = v; },
        canAfford: (item: SimpleQueueItem) => this.woodStockpile[0] >= item.cost,
        deductCost: (item: SimpleQueueItem) => { this.woodStockpile[0] -= item.cost; this.players[0].resources.wood -= item.cost; },
      },
      {
        kind: 'workshop', color: '#c9a96e', spawnTime: 8,
        queue: this.workshopSpawnQueue,
        getTimer: () => this.workshopSpawnTimer, setTimer: (v) => { this.workshopSpawnTimer = v; },
        canAfford: (item: WorkshopQueueItem) =>
          this.ropeStockpile[0] >= item.cost.rope &&
          this.stoneStockpile[0] >= item.cost.stone &&
          this.woodStockpile[0] >= item.cost.wood,
        deductCost: (item: WorkshopQueueItem) => {
          this.ropeStockpile[0] -= item.cost.rope; this.players[0].resources.rope -= item.cost.rope;
          this.stoneStockpile[0] -= item.cost.stone; this.players[0].resources.stone -= item.cost.stone;
          this.woodStockpile[0] -= item.cost.wood; this.players[0].resources.wood -= item.cost.wood;
        },
      },
    ];

    const isCombatType = (t: UnitType) =>
      t === UnitType.WARRIOR || t === UnitType.ARCHER || t === UnitType.RIDER ||
      t === UnitType.PALADIN || t === UnitType.CATAPULT || t === UnitType.TREBUCHET;

    for (const cfg of spawnConfigs) {
      const building = this.buildingSystem.getNextSpawnBuilding(cfg.kind as any, 0);
      if (!building || cfg.queue.length === 0) continue;

      const timer = cfg.getTimer() + delta;
      const spawnTime = this.hud.debugFlags.instantSpawn ? 0 : cfg.spawnTime;

      if (timer >= spawnTime) {
        cfg.setTimer(0);
        const next = cfg.queue[0];
        if (cfg.canAfford(next)) {
          cfg.deductCost(next);
          cfg.queue.shift();
          // Spawn unit at building position (round-robin)
          const spawnBuilding = this.buildingSystem.getNextSpawnBuilding(cfg.kind as any, 0)!;
          const pos = this.findSpawnTile(this.currentMap!, spawnBuilding.position.q, spawnBuilding.position.r, true);
          const unit = UnitFactory.create(next.type, 0, pos);
          const wp = this.hexToWorld(pos);
          unit.worldPosition = { ...wp };
          this.players[0].units.push(unit);
          this.allUnits.push(unit);
          this.unitRenderer.addUnit(unit, this.getElevation(pos));
          this.selectionManager.setPlayerUnits(this.allUnits, 0);
          this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
          // Rally point
          const rallySlot = this.getRallyFormationSlot(cfg.kind as any, unit);
          if (rallySlot) UnitAI.commandMove(unit, rallySlot, this.currentMap!);
          // Combat units default to aggressive at rally points
          if (isCombatType(unit.type)) unit.stance = UnitStance.AGGRESSIVE;
        }
      } else {
        cfg.setTimer(timer);
      }
    }

    // Update unified spawn queue HUD with progress bars
    // Include player 0's queues AND all AI players' queues
    const allQueueEntries = spawnConfigs.map(cfg => ({
      kind: cfg.kind,
      color: cfg.color,
      items: cfg.queue.map(q => ({ type: q.type })),
      timerProgress: cfg.queue.length > 0
        ? cfg.getTimer() / (this.hud.debugFlags.instantSpawn ? 0.001 : cfg.spawnTime)
        : 0,
    }));

    // Add AI queues for all players
    for (let pid = 0; pid < this.aiController.aiState.length; pid++) {
      const st = this.aiController.aiState[pid];
      const label = this.players.length > 1 ? `P${pid + 1} ` : '';
      // AI combat queue (barracks)
      if (st.spawnQueue.length > 0) {
        allQueueEntries.push({
          kind: `${label}barracks`,
          color: pid === 0 ? '#3498db' : '#e74c3c',
          items: st.spawnQueue.map(q => ({ type: q.type })),
          timerProgress: st.spawnTimer / 5,
        });
      }
      // AI worker queue (forestry/masonry/farmhouse)
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

    // Update occupied tiles for pathfinder (units prefer unoccupied paths)
    Pathfinder.occupiedTiles.clear();
    for (const unit of this.allUnits) {
      if (unit.state !== UnitState.DEAD) {
        Pathfinder.occupiedTiles.add(`${unit.position.q},${unit.position.r}`);
      }
    }

    // Pass debug flags to UnitAI before running update
    UnitAI.debugFlags = {
      disableChop: this.hud.debugFlags.disableChop,
      disableMine: this.hud.debugFlags.disableMine,
      disableHarvest: this.hud.debugFlags.disableHarvest,
      disableBuild: this.hud.debugFlags.disableBuild,
      disableDeposit: this.hud.debugFlags.disableDeposit,
      disableAutoReturn: this.hud.debugFlags.disableAutoReturn,
      disableCombat: this.hud.debugFlags.disableCombat,
    };

    // Sync stone stockpile to UnitAI so builders know if they have resources
    UnitAI.stoneStockpile = this.stoneStockpile;

    // Run unit AI (movement, combat, auto-attack)
    const events = UnitAI.update(this.players, this.currentMap, delta);

    for (const event of events) {
      // godMode: prevent player units (owner 0) from dying or taking damage
      if (this.hud.debugFlags.godMode) {
        if (event.type === 'unit:killed' && event.unit && event.unit.owner === 0) {
          // Revive the unit instead of removing it
          event.unit.currentHealth = event.unit.stats.maxHealth;
          continue;
        }
        if (event.type === 'combat' && event.defender && event.defender.owner === 0) {
          // Restore player unit health after combat
          event.defender.currentHealth = event.defender.stats.maxHealth;
        }
        if (event.type === 'combat' && event.attacker && event.attacker.owner === 0) {
          event.attacker.currentHealth = event.attacker.stats.maxHealth;
        }
      }

      if (event.type === 'unit:killed' && event.unit) {
        this.removeUnitFromGame(event.unit, event.killer);
      }
      if (event.type === 'combat' && event.attacker && event.defender && !this.hud.debugFlags.disableCombat) {
        this.unitRenderer.updateHealthBar(event.attacker);
        this.unitRenderer.updateHealthBar(event.defender);

        // Show damage effect at defender position
        this.unitRenderer.showDamageEffect(event.defender.worldPosition);
        this.unitRenderer.flashUnit(event.defender.id, 0.15);

        // If attacker is an archer, fire a projectile
        if (event.attacker.type === UnitType.ARCHER) {
          this.unitRenderer.fireProjectile(
            event.attacker.worldPosition,
            event.defender.worldPosition,
            0xFF8800 // orange arrow
          );
        }
        // If attacker is a trebuchet or catapult, fire a boulder
        if (event.attacker.type === UnitType.TREBUCHET || event.attacker.type === UnitType.CATAPULT) {
          this.unitRenderer.fireBoulder(
            event.attacker.worldPosition,
            event.defender.worldPosition
          );
        }
      }
      if (event.type === 'builder:place_wall' && event.result && !this.hud.debugFlags.disableBuild) {
        // Check if this is a gate or wall blueprint
        const key = `${event.result.position.q},${event.result.position.r}`;
        if (UnitAI.playerGateBlueprint.has(key)) {
          this.wallSystem.handleBuildGate(event.unit!, event.result.position);
        } else {
          this.wallSystem.handleBuildWall(event.unit!, event.result.position);
        }
      }
      if (event.type === 'builder:place_gate' && event.result && !this.hud.debugFlags.disableBuild) {
        this.wallSystem.handleBuildGate(event.unit!, event.result.position);
      }
      if (event.type === 'lumberjack:chop' && event.result && !this.hud.debugFlags.disableChop) {
        this.handleChopWood(event.unit!, event.result.position);
      }
      if (event.type === 'lumberjack:deposit' && event.unit && !this.hud.debugFlags.disableDeposit) {
        this.resourceManager.handleWoodDeposit(event.unit!);
      }
      if (event.type === 'builder:mine' && event.result && !this.hud.debugFlags.disableMine) {
        this.handleMineTerrain(event.unit!, event.result.position);
      }
      if (event.type === 'builder:deposit_stone' && event.unit && !this.hud.debugFlags.disableDeposit) {
        // Route by carryType — builders can now carry stone, clay, or grass fiber
        if (event.unit!.carryType === ResourceType.CLAY) {
          this.resourceManager.handleClayDeposit(event.unit!);
        } else if (event.unit!.carryType === ResourceType.GRASS_FIBER) {
          this.resourceManager.handleGrassFiberDeposit(event.unit!);
        } else {
          this.resourceManager.handleStoneDeposit(event.unit!);
        }
      }
      if (event.type === 'villager:harvest' && event.result && !this.hud.debugFlags.disableHarvest) {
        this.resourceManager.handleCropHarvest(event.unit!, event.result.position);
      }
      if (event.type === 'villager:harvest_grass' && event.result && !this.hud.debugFlags.disableHarvest) {
        this.handleHarvestGrass(event.unit!, event.result.position);
      }
      if (event.type === 'villager:deposit' && event.unit && !this.hud.debugFlags.disableDeposit) {
        this.resourceManager.handleFoodDeposit(event.unit!);
      }
      if (event.type === 'unit:attack_wall' && event.unit && event.result) {
        const key = `${event.result.position.q},${event.result.position.r}`;
        const isSiege = event.unit.isSiege === true; // Trebuchets/siege engines
        // ALL structures (walls, gates, buildings) require siege weapons to destroy
        if (!isSiege) continue; // Non-siege units cannot damage structures
        if (this.buildingSystem.barracksHealth.has(key)) {
          this.wallSystem.damageBarracks(event.result.position, event.unit.stats.attack);
        } else if (this.wallSystem.gatesBuilt.has(key)) {
          this.wallSystem.damageGate(event.result.position, event.unit.stats.attack);
        } else {
          this.wallSystem.damageWall(event.result.position, event.unit.stats.attack);
        }
      }
    }

    // Update unit visual positions and animations
    const gameTime = this.clock.elapsedTime;
    for (const unit of this.allUnits) {
      if (unit.state !== UnitState.DEAD) {
        this.unitRenderer.setWorldPosition(
          unit.id,
          unit.worldPosition.x,
          unit.worldPosition.y,
          unit.worldPosition.z
        );
        this.unitRenderer.animateUnit(unit.id, unit.state, gameTime, unit.type);
      }
    }

    // Build aggro list and update visual indicators
    const aggroList: Array<{ attackerId: string; targetId: string }> = [];
    for (const unit of this.allUnits) {
      if (unit.state === UnitState.DEAD) continue;
      if ((unit.state === UnitState.ATTACKING || unit.state === UnitState.MOVING)
          && unit.command?.targetUnitId) {
        aggroList.push({ attackerId: unit.id, targetId: unit.command.targetUnitId });
      }
    }
    this.unitRenderer.updateAggroIndicators(aggroList, gameTime);

    // Update projectiles (arrows in flight)
    this.unitRenderer.updateProjectiles(delta);

    // --- Base damage: units near enemy base deal damage ---
    this.updateBaseDamage(delta);

    // --- Win condition check ---
    this.checkWinCondition();

    // AI commander: periodically issue orders (skip if disableAI)
    if (!this.hud.debugFlags.disableAI) {
      // Player 2 (always AI)
      this.aiController.updateSmartAICommander(1, delta);
      this.aiController.updateSmartAIEconomy(1, delta);
      this.aiController.updateSmartAISpawnQueue(1, delta);
      this.aiController.updateSmartAITactics(1, delta);

      // Player 1 AI (only in AI vs AI mode)
      if (this.gameMode === 'aivai') {
        this.aiController.updateSmartAICommander(0, delta);
        this.aiController.updateSmartAIEconomy(0, delta);
        this.aiController.updateSmartAISpawnQueue(0, delta);
        this.aiController.updateSmartAITactics(0, delta);
      }
    }

    // Update enemy resource bar
    this.hud.updateEnemyResources(this.players[1], this.woodStockpile[1], this.foodStockpile[1], this.stoneStockpile[1]);

    // Tree regrowth (stumps re-grow, but no auto-spreading sprouts) — skip if disableTreeGrowth
    if (!this.hud.debugFlags.disableTreeGrowth) {
      this.updateTreeRegrowth(delta);
    }
    // updateTreeSprouts disabled — players plant trees manually via Forestry menu

    // Grass growth & spreading — skip if disableGrassGrowth
    if (!this.hud.debugFlags.disableGrassGrowth) {
      this.updateGrassGrowth(delta);
      this.updateGrassSpread(delta);
    }

    // Update base health bar billboards
    this.baseRenderer.updateBillboards(this.camera.camera);

    // Update HUD resource display with wood stockpile
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Update selection info (lightweight — no panel rebuild, just health/state text)
    const sel = this.selectionManager.getSelectedUnits();
    if (sel.length > 0) {
      this.hud.updateSelectionInfo(sel);
    }
  }

  private baseDmgTimer = 0;
  private updateBaseDamage(delta: number): void {
    this.baseDmgTimer += delta;
    if (this.baseDmgTimer < 1.0) return; // Check every 1 second
    this.baseDmgTimer = 0;

    for (const base of this.bases) {
      if (base.destroyed) continue;

      // Count enemy units within 2 tiles of the base
      let damageThisTick = 0;
      for (const unit of this.allUnits) {
        if (unit.owner === base.owner || unit.state === UnitState.DEAD) continue;

        const dq = Math.abs(unit.position.q - base.position.q);
        const dr = Math.abs(unit.position.r - base.position.r);
        if (dq + dr <= 2) {
          // Each nearby enemy deals damage based on their attack stat
          damageThisTick += unit.stats.attack;
        }
      }

      if (damageThisTick > 0) {
        base.health = Math.max(0, base.health - damageThisTick);
        this.baseRenderer.updateHealthBar(base);

        if (base.health <= 0) {
          base.destroyed = true;
          this.baseRenderer.showDestruction(base);
          // Remove base from wall-connectable registry and rebuild adjacent walls
          const baseKey = `${base.position.q},${base.position.r}`;
          this.buildingSystem.wallConnectable.delete(baseKey);
          const baseNeighbors = Pathfinder.getHexNeighbors(base.position);
          for (const n of baseNeighbors) {
            const nKey = `${n.q},${n.r}`;
            if (this.wallSystem.wallsBuilt.has(nKey)) {
              const nOwner = this.wallSystem.wallOwners.get(nKey) ?? 0;
              this.wallSystem.buildAdaptiveWallMesh(n, nOwner);
            }
          }
        }
      }
    }
  }

  private checkWinCondition(): void {
    for (const base of this.bases) {
      if (base.destroyed) {
        this.gameOver = true;
        let winner: string;
        let isVictory: boolean;
        if (this.gameMode === 'aivai') {
          winner = base.owner === 0 ? 'AI RED' : 'AI BLUE';
          isVictory = base.owner !== 0; // Blue "wins" if red base destroyed
        } else {
          winner = base.owner === 0 ? 'AI OPPONENT' : 'PLAYER';
          isVictory = base.owner !== 0;
        }
        this.showGameOverScreen(winner, isVictory);
        return;
      }
    }
  }

  private showGameOverScreen(winner: string, isVictory: boolean): void {
    if (this.gameOverOverlay) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 200;
      font-family: 'Courier New', monospace; color: white;
      pointer-events: auto; animation: fadeIn 0.5s ease;
    `;

    const color = isVictory ? '#2ecc71' : '#e74c3c';
    let title: string;
    let subtitle: string;
    if (this.gameMode === 'aivai') {
      title = winner + ' WINS!';
      subtitle = winner + ' destroyed the opposing base!';
    } else {
      title = isVictory ? 'VICTORY!' : 'DEFEAT!';
      subtitle = isVictory ? 'You destroyed the enemy base!' : 'Your base has been destroyed!';
    }

    overlay.innerHTML = `
      <div style="font-size: 64px; font-weight: bold; color: ${color};
        text-shadow: 0 0 30px ${color}, 0 0 60px ${color}; margin-bottom: 16px;
        letter-spacing: 8px;">
        ${title}
      </div>
      <div style="font-size: 20px; color: #bbb; margin-bottom: 40px;">
        ${subtitle}
      </div>
      <button id="play-again-btn" style="
        background: linear-gradient(135deg, ${color}, ${isVictory ? '#27ae60' : '#c0392b'});
        color: white; border: 2px solid rgba(255,255,255,0.3);
        padding: 14px 40px; font-size: 18px; font-family: 'Courier New', monospace;
        font-weight: bold; border-radius: 8px; cursor: pointer;
        text-transform: uppercase; letter-spacing: 3px;
      ">NEW BATTLE</button>
    `;

    document.body.appendChild(overlay);
    this.gameOverOverlay = overlay;

    const btn = document.getElementById('play-again-btn');
    if (btn) {
      btn.addEventListener('click', () => this.regenerateMap());
    }
  }

  // --- Wood stockpile per player: each tree = 4 wall blocks ---
  private woodStockpile: number[] = [0, 0]; // [player0, player1]
  // Wall/gate state is managed by WallSystem (this.wallSystem)

  // --- Wall Build Mode ---
  private wallBuildMode = false;
  private blueprintGhosts: Map<string, THREE.Mesh> = new Map();
  private wallRotation = 0; // 0 or Math.PI/2
  private hoverGhost: THREE.Group | null = null;
  private lastHoverKey = '';

  // --- Harvest Mode ---
  private harvestMode = false;
  private harvestMarkers: Map<string, THREE.Mesh> = new Map();

  // --- Mine Mode ---
  private mineMode = false;
  private mineDepthLayers = 3; // How many layers to dig (1-20), adjustable with scroll wheel
  private mineMarkers: Map<string, THREE.Mesh> = new Map();
  private stoneStockpile: number[] = [0, 0]; // [player0, player1]

  // --- Tree Regrowth & Growth System ---
  private treeRegrowthTimers: Map<string, number> = new Map(); // "q,r" → seconds until sapling appears
  private treeAge: Map<string, number> = new Map(); // "q,r" → growth stage (0=sapling, 1=young, 2=mature)
  private treeGrowthTimers: Map<string, number> = new Map(); // "q,r" → seconds until next growth stage
  private treeSproutTimer = 0;
  private readonly TREE_REGROW_TIME = 12; // seconds for a chopped stump to sprout a sapling
  private readonly TREE_GROWTH_TIME = 10; // seconds per growth stage (sapling→young→mature)
  private readonly TREE_SPROUT_INTERVAL = 5; // seconds between new sprout checks
  private readonly TREE_SPROUT_CHANCE = 0.2; // chance per eligible tile per check

  // --- Grass Growth & Spreading System ---
  private grassAge: Map<string, number> = new Map(); // "q,r" → growth stage (0=short, 1=medium, 2=tall/harvestable)
  private grassGrowthTimers: Map<string, number> = new Map(); // "q,r" → seconds until next growth stage
  private grassSpreadTimer = 0;
  private readonly GRASS_GROWTH_TIME = 8; // seconds per growth stage
  private readonly GRASS_SPREAD_INTERVAL = 6; // seconds between spread checks
  private readonly GRASS_SPREAD_CHANCE = 0.15; // chance per eligible adjacent tile

  // --- Building Registry is managed by BuildingSystem (this.buildingSystem) ---
  // Backwards-compatible single-building shortcuts delegate to buildingSystem
  private get barracks() { return this.buildingSystem.getFirstBuilding('barracks'); }
  private get forestry() { return this.buildingSystem.getFirstBuilding('forestry'); }
  private get masonry() { return this.buildingSystem.getFirstBuilding('masonry'); }
  private get farmhouse() { return this.buildingSystem.getFirstBuilding('farmhouse'); }
  private get silo() { return this.buildingSystem.getFirstBuilding('silo'); }
  private get workshop() { return this.buildingSystem.getFirstBuilding('workshop'); }

  // Query/registry methods are in BuildingSystem — accessed via this.buildingSystem.*

  // showBuildingTooltip → moved to BuildingTooltipController

  /** Queue a unit from the building tooltip */
  private queueUnitFromTooltip(unitType: string, buildingKind: BuildingKind): void {
    switch (buildingKind) {
      case 'barracks': {
        const costs: Record<string, number> = { warrior: 5, archer: 8, rider: 10, paladin: 6 };
        const cost = costs[unitType] ?? 5;
        const type = unitType === 'archer' ? UnitType.ARCHER :
                     unitType === 'rider' ? UnitType.RIDER :
                     unitType === 'paladin' ? UnitType.PALADIN : UnitType.WARRIOR;
        this.spawnQueue.push({ type, cost });
        this.hud.updateSpawnQueue(this.spawnQueue);
        break;
      }
      case 'forestry': {
        const costs: Record<string, number> = { lumberjack: 3, scout: 4 };
        const cost = costs[unitType] ?? 3;
        const type = unitType === 'scout' ? UnitType.SCOUT : UnitType.LUMBERJACK;
        this.forestrySpawnQueue.push({ type, cost });
        this.hud.updateForestrySpawnQueue(this.forestrySpawnQueue);
        break;
      }
      case 'masonry': {
        const type = UnitType.BUILDER;
        this.masonrySpawnQueue.push({ type, cost: 4 });
        this.hud.updateMasonrySpawnQueue(this.masonrySpawnQueue);
        break;
      }
      case 'farmhouse': {
        const type = UnitType.VILLAGER;
        this.farmhouseSpawnQueue.push({ type, cost: 3 });
        break;
      }
      case 'workshop': {
        const type = unitType === 'catapult' ? UnitType.CATAPULT : UnitType.TREBUCHET;
        const costMap: Record<string, { rope: number; stone: number; wood: number }> = {
          trebuchet: { rope: 6, stone: 4, wood: 4 },
          catapult: { rope: 3, stone: 3, wood: 3 },
        };
        const cost = costMap[unitType] ?? costMap.trebuchet;
        this.workshopSpawnQueue.push({ type, cost });
        this.hud.updateWorkshopSpawnQueue(this.workshopSpawnQueue);
        break;
      }
    }
  }

  /** Demolish a player building, removing it from the world and refunding some resources */
  private demolishBuilding(pb: PlacedBuilding): void {
    if (pb.owner !== 0) return; // Only player can demolish their own
    // Refund half the build cost in wood
    const refunds: Record<BuildingKind, number> = {
      barracks: 5, forestry: 4, masonry: 5, farmhouse: 4, workshop: 8, silo: 3,
    };
    const refund = refunds[pb.kind] ?? 3;
    this.woodStockpile[0] += refund;
    this.players[0].resources.wood += refund;
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
    this.buildingSystem.unregisterBuilding(pb);
    this.hud.showNotification(`${pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1)} demolished. Refunded ${refund} wood.`);
  }

  // --- Placement mode flags & rotation ---
  private barracksPlaceMode = false;
  private barracksRotation = 0;
  private spawnQueue: { type: UnitType; cost: number }[] = [];
  private spawnTimer = 0;

  private forestryPlaceMode = false;
  private forestryRotation = 0;
  private forestrySpawnQueue: { type: UnitType; cost: number }[] = [];
  private forestrySpawnTimer = 0;

  private masonryPlaceMode = false;
  private masonryRotation = 0;
  private masonrySpawnQueue: { type: UnitType; cost: number }[] = [];
  private masonrySpawnTimer = 0;

  private farmhousePlaceMode = false;
  private farmhouseRotation = 0;
  private farmhouseSpawnQueue: { type: UnitType; cost: number }[] = [];
  private farmhouseSpawnTimer = 0;
  private siloPlaceMode = false;
  private siloRotation = 0;
  private farmPatchMode = false;
  private farmPatchMarkers: Map<string, THREE.Mesh> = new Map();
  private foodStockpile: number[] = [0, 0]; // [player0, player1]
  private plantTreeMode = false;
  private plantCropsMode = false;
  private clearedPlains: Set<string> = new Set(); // Tiles where grass was harvested → eligible for crops

  // --- Workshop & Trebuchet Spawning ---
  private workshopPlaceMode = false;
  private workshopRotation = 0;
  private workshopSpawnQueue: { type: UnitType; cost: { wood: number; stone: number; rope: number } }[] = [];
  private workshopSpawnTimer = 0;

  // --- Grass Fiber, Clay, Rope Stockpiles ---
  private grassFiberStockpile: number[] = [0, 0];
  private clayStockpile: number[] = [0, 0];
  private ropeStockpile: number[] = [0, 0];

  // --- Rally Point System ---
  private rallyPoints: Map<string, HexCoord> = new Map(); // buildingKey → rally target
  private rallyFlagMeshes: Map<string, THREE.Group> = new Map(); // buildingKey → flag mesh
  private rallyLineMeshes: Map<string, THREE.Line> = new Map(); // buildingKey → line mesh
  private rallyPointSetMode = false;
  private rallyPointBuilding: string | null = null; // Which building we're setting rally for

  // --- Formation state ---
  private selectedFormation: FormationType = FormationType.BOX;

  // AI state is managed by AIController (this.aiController.aiState)
  // AI meshes are tracked in aiController.aiState[pid].meshes

  // Building mesh creation + aiFindBuildTile are in BuildingSystem

  private handleChopWood(unit: Unit, treePos: HexCoord): void {
    if (!this.currentMap) return;
    const key = `${treePos.q},${treePos.r}`;
    const tile = this.currentMap.tiles.get(key);
    if (!tile || tile.terrain !== TerrainType.FOREST) return;

    // Convert forest to plains (tree chopped)
    tile.terrain = TerrainType.PLAINS;

    // Remove tree decorations visually
    this.terrainDecorator.removeDecoration(treePos);

    // Remove harvest marker if it exists
    this.removeHarvestMarker(treePos);

    // Start regrowth timer for this tile
    this.treeRegrowthTimers.set(key, this.TREE_REGROW_TIME);

    // Wood yield scales with tree age: sapling=2, young=4, mature=6
    const age = this.treeAge.get(key) ?? 2; // default 2 (mature) for map-generated trees
    const woodYield = age === 0 ? 2 : age === 1 ? 4 : 6;

    // Clean up growth tracking
    this.treeAge.delete(key);
    this.treeGrowthTimers.delete(key);

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
    this.removeHarvestMarker(pos);

    // Hay yield: 2-3 food per tall grass tile
    const hayYield = 2 + Math.floor(Math.random() * 2);

    // Reset grass to short (stage 0) — it will regrow
    this.terrainDecorator.addGrassAtStage(pos, tile.elevation * 0.5, 0);
    this.grassAge.set(key, 0);
    this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);

    // Mark as cleared plains — eligible for crop planting
    this.clearedPlains.add(key);

    // Grass fiber bonus — harvesting grass also yields fiber (plant material for rope)
    const fiberYield = 1 + Math.floor(Math.random() * 2); // 1-2 fiber
    this.grassFiberStockpile[unit.owner] += fiberYield;
    this.players[unit.owner].resources.grass_fiber += fiberYield;
    if (unit.owner === 0) {
      this.hud.showNotification(`🌿 +${fiberYield} grass fiber`, '#8bc34a');
    }

    // Load food (hay) onto the unit
    unit.carryAmount = Math.min(hayYield, unit.carryCapacity);
    unit.carryType = ResourceType.FOOD;
  }

  /** Tick down regrowth timers — spawn saplings when ready, then grow them */
  private updateTreeRegrowth(delta: number): void {
    if (!this.currentMap) return;

    // 1. Regrowth timers: chopped stumps → saplings
    for (const [key, remaining] of this.treeRegrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        this.treeRegrowthTimers.delete(key);
        const tile = this.currentMap.tiles.get(key);
        if (!tile) continue;
        if (tile.terrain !== TerrainType.PLAINS) continue;
        if (Pathfinder.blockedTiles.has(key)) continue;

        // Spawn as sapling (stage 0)
        tile.terrain = TerrainType.FOREST;
        const [q, r] = key.split(',').map(Number);
        this.terrainDecorator.addTreeAtStage({ q, r }, tile.elevation * 0.5, 0);
        this.treeAge.set(key, 0);
        this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
      } else {
        this.treeRegrowthTimers.set(key, newTime);
      }
    }

    // 2. Growth timers: saplings → young → mature
    for (const [key, remaining] of this.treeGrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        const currentStage = this.treeAge.get(key) ?? 0;
        const newStage = currentStage + 1;

        if (newStage > 2) {
          // Fully mature — stop growing
          this.treeGrowthTimers.delete(key);
          this.treeAge.set(key, 2);
          continue;
        }

        const tile = this.currentMap.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.FOREST) {
          this.treeGrowthTimers.delete(key);
          this.treeAge.delete(key);
          continue;
        }

        // Remove old decoration, add new stage
        const [q, r] = key.split(',').map(Number);
        this.terrainDecorator.removeDecoration({ q, r });
        this.terrainDecorator.addTreeAtStage({ q, r }, tile.elevation * 0.5, newStage);
        this.treeAge.set(key, newStage);

        if (newStage < 2) {
          this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
        } else {
          this.treeGrowthTimers.delete(key); // mature, done growing
        }
      } else {
        this.treeGrowthTimers.set(key, newTime);
      }
    }
  }

  /** Periodically sprout new saplings — both near forests and spontaneously on plains */
  private updateTreeSprouts(delta: number): void {
    if (!this.currentMap) return;
    this.treeSproutTimer += delta;
    if (this.treeSproutTimer < this.TREE_SPROUT_INTERVAL) return;
    this.treeSproutTimer = 0;

    const adjacentCandidates: string[] = [];
    const wildCandidates: string[] = [];

    this.currentMap.tiles.forEach((tile, key) => {
      if (tile.terrain !== TerrainType.PLAINS) return;
      if (Pathfinder.blockedTiles.has(key)) return;
      if (this.treeRegrowthTimers.has(key)) return;
      if (UnitAI.farmPatches.has(key)) return; // Never sprout on farm patches

      const [q, r] = key.split(',').map(Number);
      const neighbors = this.getHexNeighbors(q, r);
      const hasForestNeighbor = neighbors.some(([nq, nr]) => {
        const nt = this.currentMap!.tiles.get(`${nq},${nr}`);
        return nt && nt.terrain === TerrainType.FOREST;
      });

      if (hasForestNeighbor) {
        adjacentCandidates.push(key);
      } else {
        wildCandidates.push(key);
      }
    });

    // Forest-adjacent sprouts: higher chance (spreading)
    for (const key of adjacentCandidates) {
      if (Math.random() < this.TREE_SPROUT_CHANCE) {
        this.sproutSapling(key);
      }
    }

    // Wild/spontaneous sprouts: lower chance, max 2 per cycle to keep it natural
    let wildCount = 0;
    for (const key of wildCandidates) {
      if (wildCount >= 2) break;
      if (Math.random() < 0.005) { // ~0.5% per plains tile per cycle
        this.sproutSapling(key);
        wildCount++;
      }
    }

    // Cull overcrowded saplings/young trees (>4 adjacent forest tiles)
    this.cullOvercrowdedSaplings();
  }

  /** Count how many adjacent tiles are forest (trees or sprouts) */
  private countAdjacentForest(q: number, r: number): number {
    const neighbors = this.getHexNeighbors(q, r);
    let count = 0;
    for (const [nq, nr] of neighbors) {
      const nt = this.currentMap?.tiles.get(`${nq},${nr}`);
      if (nt && nt.terrain === TerrainType.FOREST) count++;
    }
    return count;
  }

  /** Helper to sprout a sapling on a tile — blocked if too many adjacent trees or farm patches */
  private sproutSapling(key: string): void {
    if (!this.currentMap) return;
    const tile = this.currentMap.tiles.get(key);
    if (!tile) return;

    // Never sprout on farm patches
    if (UnitAI.farmPatches.has(key)) return;

    // Density check: don't sprout if 4+ neighbors are already forest
    const [q, r] = key.split(',').map(Number);
    if (this.countAdjacentForest(q, r) >= 4) return;

    tile.terrain = TerrainType.FOREST;
    this.terrainDecorator.addTreeAtStage({ q, r }, tile.elevation * 0.5, 0);
    this.treeAge.set(key, 0);
    this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
  }

  /** Remove saplings/young trees that are overcrowded (>4 adjacent forest tiles) */
  private cullOvercrowdedSaplings(): void {
    if (!this.currentMap) return;
    const toCull: string[] = [];
    for (const [key, age] of this.treeAge) {
      if (age > 1) continue; // only cull saplings (0) and young trees (1)
      const [q, r] = key.split(',').map(Number);
      if (this.countAdjacentForest(q, r) >= 4) {
        toCull.push(key);
      }
    }
    for (const key of toCull) {
      const tile = this.currentMap.tiles.get(key);
      if (!tile) continue;
      tile.terrain = TerrainType.PLAINS;
      const [q, r] = key.split(',').map(Number);
      this.terrainDecorator.removeDecoration({ q, r });
      this.treeAge.delete(key);
      this.treeGrowthTimers.delete(key);
    }
  }

  /** Get hex neighbors for offset coordinates */
  private getHexNeighbors(q: number, r: number): [number, number][] {
    const even = q % 2 === 0;
    if (even) {
      return [
        [q + 1, r - 1], [q + 1, r],
        [q - 1, r - 1], [q - 1, r],
        [q, r - 1], [q, r + 1],
      ];
    } else {
      return [
        [q + 1, r], [q + 1, r + 1],
        [q - 1, r], [q - 1, r + 1],
        [q, r - 1], [q, r + 1],
      ];
    }
  }

  // ===================== GRASS GROWTH & SPREADING =====================

  /** Tick grass growth timers — short → medium → tall */
  private updateGrassGrowth(delta: number): void {
    if (!this.currentMap) return;

    for (const [key, remaining] of this.grassGrowthTimers) {
      const newTime = remaining - delta;
      if (newTime <= 0) {
        const currentStage = this.grassAge.get(key) ?? 0;
        const newStage = currentStage + 1;

        if (newStage > 2) {
          this.grassGrowthTimers.delete(key);
          this.grassAge.set(key, 2);
          continue;
        }

        const tile = this.currentMap.tiles.get(key);
        if (!tile || tile.terrain !== TerrainType.PLAINS) {
          this.grassGrowthTimers.delete(key);
          this.grassAge.delete(key);
          continue;
        }

        const [q, r] = key.split(',').map(Number);
        this.terrainDecorator.addGrassAtStage({ q, r }, tile.elevation * 0.5, newStage);
        this.grassAge.set(key, newStage);

        if (newStage < 2) {
          this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
        } else {
          this.grassGrowthTimers.delete(key); // fully grown
        }
      } else {
        this.grassGrowthTimers.set(key, newTime);
      }
    }

    // Sync UnitAI.grassTiles with current grass state
    UnitAI.grassTiles.clear();
    for (const [key, stage] of this.grassAge) {
      if (stage >= 2) {
        UnitAI.grassTiles.add(key);
      }
    }
  }

  /** Periodically spread grass to adjacent plains tiles */
  private updateGrassSpread(delta: number): void {
    if (!this.currentMap) return;
    this.grassSpreadTimer += delta;
    if (this.grassSpreadTimer < this.GRASS_SPREAD_INTERVAL) return;
    this.grassSpreadTimer = 0;

    // Collect grass tiles that are at least medium stage to spread from
    const spreadCandidates: string[] = [];
    for (const [key, stage] of this.grassAge) {
      if (stage >= 1) spreadCandidates.push(key);
    }

    // Try to spread to adjacent empty plains tiles
    let spreadCount = 0;
    for (const key of spreadCandidates) {
      if (spreadCount >= 3) break; // cap spread per cycle for performance
      const [q, r] = key.split(',').map(Number);
      const neighbors = this.getHexNeighbors(q, r);

      for (const [nq, nr] of neighbors) {
        if (spreadCount >= 3) break;
        const nKey = `${nq},${nr}`;
        const nTile = this.currentMap.tiles.get(nKey);
        if (!nTile) continue;
        if (nTile.terrain !== TerrainType.PLAINS) continue;
        if (this.grassAge.has(nKey)) continue; // already has grass
        if (Pathfinder.blockedTiles.has(nKey)) continue;
        if (UnitAI.farmPatches.has(nKey)) continue;
        // High-elevation stone surfaces don't get grass
        if (nTile.elevation * 0.5 >= 3.0) continue;

        if (Math.random() < this.GRASS_SPREAD_CHANCE) {
          this.terrainDecorator.addGrassAtStage({ q: nq, r: nr }, nTile.elevation * 0.5, 0);
          this.grassAge.set(nKey, 0);
          this.grassGrowthTimers.set(nKey, this.GRASS_GROWTH_TIME);
          spreadCount++;
        }
      }
    }
  }

  /** Initialize grass tracking for map-generated grass (called after map creation) */
  private initializeGrassTracking(): void {
    if (!this.currentMap) return;
    for (const [key, tile] of this.currentMap.tiles) {
      if (tile.terrain === TerrainType.PLAINS && this.terrainDecorator.hasGrass(key)) {
        // Map-generated grass starts at stage 1 or 2 (medium/tall)
        const stage = Math.random() > 0.5 ? 2 : 1;
        this.grassAge.set(key, stage);
        if (stage < 2) {
          this.grassGrowthTimers.set(key, this.GRASS_GROWTH_TIME);
        }
      }
    }

    // Sync UnitAI.grassTiles with initial grass state
    UnitAI.grassTiles.clear();
    for (const [key, stage] of this.grassAge) {
      if (stage >= 2) {
        UnitAI.grassTiles.add(key);
      }
    }
  }

  // ===================== END GRASS SYSTEM =====================


  // --- Data-driven building placement config ---
  private readonly BUILDING_PLACEMENT_CONFIG: Record<BuildingKind, {
    woodCost: number; stoneCost: number;
    allowedTerrain: TerrainType[];
    maxHealth?: number;
    notification?: string;
    unitAIHook?: (coord: HexCoord) => void;
  }> = {
    barracks:  { woodCost: 10, stoneCost: 0, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], maxHealth: WallSystem.BARRACKS_MAX_HP, unitAIHook: (c) => UnitAI.barracksPositions.set(0, c) },
    forestry:  { woodCost: 8,  stoneCost: 0, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT] },
    masonry:   { woodCost: 8,  stoneCost: 0, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT] },
    farmhouse: { woodCost: 6,  stoneCost: 0, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Farmhouse built! Now build a Silo [I] and farm patches [J]', unitAIHook: (c) => UnitAI.farmhousePositions.set(0, c) },
    workshop:  { woodCost: 12, stoneCost: 4, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT, TerrainType.FOREST], notification: 'Workshop built!' },
    silo:      { woodCost: 5,  stoneCost: 0, allowedTerrain: [TerrainType.PLAINS, TerrainType.DESERT], notification: 'Silo built! Villagers will carry crops here. Place farm patches [J]', unitAIHook: (c) => UnitAI.siloPositions.set(0, c) },
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
      if (this.woodStockpile[0] < cfg.woodCost || this.stoneStockpile[0] < cfg.stoneCost) {
        const needs = cfg.stoneCost > 0 ? `${cfg.woodCost} wood + ${cfg.stoneCost} stone` : `${cfg.woodCost} wood`;
        this.hud.showNotification(`Need ${needs} to build ${kind}! (have ${this.woodStockpile[0]} wood, ${this.stoneStockpile[0]} stone)`, '#e67e22');
        return;
      }
      this.woodStockpile[0] -= cfg.woodCost;
      this.players[0].resources.wood = Math.max(0, this.players[0].resources.wood - cfg.woodCost);
      if (cfg.stoneCost > 0) {
        this.stoneStockpile[0] -= cfg.stoneCost;
        this.players[0].resources.stone = Math.max(0, this.players[0].resources.stone - cfg.stoneCost);
      }
    }
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Build mesh via BuildingSystem
    const meshBuilder = this.buildingSystem[`build${kind.charAt(0).toUpperCase() + kind.slice(1)}Mesh` as keyof BuildingSystem] as (pos: HexCoord, owner: number) => THREE.Group;
    const mesh = meshBuilder.call(this.buildingSystem, coord, 0);
    this.buildingSystem.registerBuilding(kind, 0, coord, mesh, cfg.maxHealth);

    // Post-placement hooks
    if (cfg.unitAIHook) cfg.unitAIHook(coord);

    // Exit placement mode
    this.exitPlacementMode(kind);
    this.resourceManager.updateStockpileVisual(0);
    if (cfg.notification) this.hud.showNotification(cfg.notification, '#2ecc71');
  }

  /** Exit placement mode for a specific building kind */
  private exitPlacementMode(kind: BuildingKind): void {
    switch (kind) {
      case 'barracks': this.barracksPlaceMode = false; this.hud.setBarracksMode(false); break;
      case 'forestry': this.forestryPlaceMode = false; this.hud.setForestryMode(false); break;
      case 'masonry': this.masonryPlaceMode = false; this.hud.setMasonryMode(false); break;
      case 'farmhouse': this.farmhousePlaceMode = false; this.hud.setFarmhouseMode(false); break;
      case 'workshop': this.workshopPlaceMode = false; this.hud.setWorkshopMode(false); break;
      case 'silo': this.siloPlaceMode = false; this.hud.setSiloMode(false); break;
    }
  }

  // --- Workshop ---

  // toggleWorkshopMode → now handled by toggleBuildingPlaceMode('workshop')

  // placeWorkshop → now handled by placeGenericBuilding('workshop', coord)

  private doSpawnQueueWorkshop(type: UnitType, name: string): void {
    if (!this.workshop) {
      this.hud.showNotification(`📍 Place a Workshop first [W], then press 7 again`, '#e67e22');
      this.toggleBuildingPlaceMode('workshop');
      return;
    }
    // Trebuchet costs: 3 rope + 5 stone + 5 wood
    const cost = { wood: 5, stone: 5, rope: 3 };
    if (!this.hud.debugFlags.freeBuild) {
      if (this.ropeStockpile[0] < cost.rope) {
        this.hud.showNotification(`⚠️ Need ${cost.rope} rope! (have ${this.ropeStockpile[0]}). Craft rope at Workshop.`, '#e67e22');
        return;
      }
      if (this.stoneStockpile[0] < cost.stone) {
        this.hud.showNotification(`⚠️ Need ${cost.stone} stone! (have ${this.stoneStockpile[0]})`, '#e67e22');
        return;
      }
      if (this.woodStockpile[0] < cost.wood) {
        this.hud.showNotification(`⚠️ Need ${cost.wood} wood! (have ${this.woodStockpile[0]})`, '#e67e22');
        return;
      }
    }
    const actualCost = this.hud.debugFlags.freeBuild ? { wood: 0, stone: 0, rope: 0 } : cost;
    this.workshopSpawnQueue.push({ type, cost: actualCost });
    this.hud.updateWorkshopSpawnQueue(this.workshopSpawnQueue);
    this.hud.showNotification(`✅ ${name} queued (${this.hud.debugFlags.freeBuild ? 'FREE' : cost.rope + ' rope + ' + cost.stone + ' stone + ' + cost.wood + ' wood'})`, '#2ecc71');
  }

  // --- Toggle modes for farmhouse, silo, farm patches ---

  // toggleFarmhouseMode, toggleSiloMode → now handled by toggleBuildingPlaceMode

  private toggleFarmPatchMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.farmPatchMode;
    this.clearAllModes();
    this.farmPatchMode = !wasActive;
    this.hud.setFarmPatchMode(this.farmPatchMode);
    canvasEl.style.cursor = this.farmPatchMode ? 'crosshair' : 'default';
    // Suppress camera pan and box-select during farm paint mode
    StrategyCamera.suppressLeftDrag = this.farmPatchMode;
    SelectionManager.suppressBoxSelect = this.farmPatchMode;
  }

  private togglePlantTreeMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.plantTreeMode;
    this.clearAllModes();
    this.plantTreeMode = !wasActive;
    this.hud.setPlantTreeMode(this.plantTreeMode);
    canvasEl.style.cursor = this.plantTreeMode ? 'crosshair' : 'default';
    StrategyCamera.suppressLeftDrag = this.plantTreeMode;
    SelectionManager.suppressBoxSelect = this.plantTreeMode;
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
    if (this.treeAge.has(key)) return; // Already has a tree/sapling

    // Cost 1 wood
    if (this.woodStockpile[0] < 1) return;
    this.woodStockpile[0] -= 1;
    this.players[0].resources.wood = Math.max(0, this.players[0].resources.wood - 1);
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);

    // Sprout a sapling
    tile.terrain = TerrainType.FOREST;
    this.terrainDecorator.addTreeAtStage(coord, tile.elevation * 0.5, 0);
    this.treeAge.set(key, 0);
    this.treeGrowthTimers.set(key, this.TREE_GROWTH_TIME);
  }

  /** Clear all build/placement modes */
  private clearAllModes(): void {
    this.wallBuildMode = false;
    this.hud.setBuildMode(false);
    this.harvestMode = false;
    this.hud.setHarvestMode(false);
    this.barracksPlaceMode = false;
    this.hud.setBarracksMode(false);
    this.forestryPlaceMode = false;
    this.hud.setForestryMode(false);
    this.masonryPlaceMode = false;
    this.hud.setMasonryMode(false);
    this.farmhousePlaceMode = false;
    this.hud.setFarmhouseMode(false);
    this.siloPlaceMode = false;
    this.hud.setSiloMode(false);
    this.farmPatchMode = false;
    this.hud.setFarmPatchMode(false);
    this.plantTreeMode = false;
    this.hud.setPlantTreeMode(false);
    this.mineMode = false;
    this.hud.setMineMode(false);
    this.plantCropsMode = false;
    this.hud.setPlantCropsMode(false);
    this.workshopPlaceMode = false;
    this.hud.setWorkshopMode(false);
    this.rallyPointSetMode = false;
    this.rallyPointBuilding = null;
    this.hud.setRallyPointMode(false);
    this.clearHoverGhost();
    this.tooltipController.hideTooltip();
    // Reset drag suppression flags
    StrategyCamera.suppressLeftDrag = false;
    SelectionManager.suppressBoxSelect = false;
  }

  // placeFarmhouse, placeSilo → now handled by placeGenericBuilding

  private addFarmPatchMarker(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    if (this.farmPatchMarkers.has(key)) return;

    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.getElevation(coord);

    // Brown plowed earth square
    const patchGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const patchMat = new THREE.MeshLambertMaterial({
      color: 0x8b6914,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const patch = new THREE.Mesh(patchGeo, patchMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(worldX, baseY + 0.03, worldZ);
    patch.name = `farm_${key}`;
    this.renderer.scene.add(patch);
    this.farmPatchMarkers.set(key, patch);
  }

  private clearAllFarmPatchMarkers(): void {
    for (const [, marker] of this.farmPatchMarkers) {
      this.renderer.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.farmPatchMarkers.clear();
  }

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
    console.log(`[DEATH] ${unit.type}(${unit.id}, owner=${unit.owner}) killed` +
      (killer ? ` by ${killer.type}(${killer.id}, owner=${killer.owner})` : '') +
      ` | hp was ${unit.currentHealth}/${unit.stats.maxHealth}`);
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

  /** Generate formation positions based on selected formation type */
  private generateFormationTyped(center: HexCoord, count: number, formation: FormationType): HexCoord[] {
    if (count <= 1) return [center];

    switch (formation) {
      case FormationType.LINE:
        return this.generateLineFormation(center, count);
      case FormationType.BOX:
        return this.generateFormation(center, count); // existing box/ring formation
      case FormationType.WEDGE:
        return this.generateWedgeFormation(center, count);
      case FormationType.CIRCLE:
        return this.generateCircleFormation(center, count);
      default:
        return this.generateFormation(center, count);
    }
  }

  private generateLineFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [];
    const half = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      const offset = i - half;
      const q = center.q;
      const r = center.r + offset;
      const key = `${q},${r}`;
      const tile = this.currentMap?.tiles.get(key);
      if (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
          && !Pathfinder.blockedTiles.has(key)) {
        slots.push({ q, r });
      } else {
        slots.push(center); // fallback
      }
    }
    return slots;
  }

  private generateWedgeFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [center];
    let row = 1;
    while (slots.length < count) {
      // Each row has (row+1) units, spread diagonally
      for (let col = -row; col <= row && slots.length < count; col++) {
        const q = center.q - row;
        const r = center.r + col;
        const key = `${q},${r}`;
        const tile = this.currentMap?.tiles.get(key);
        if (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
            && !Pathfinder.blockedTiles.has(key)) {
          slots.push({ q, r });
        }
      }
      row++;
      if (row > 6) break;
    }
    return slots;
  }

  private generateCircleFormation(center: HexCoord, count: number): HexCoord[] {
    const slots: HexCoord[] = [];
    // Place all units on concentric rings (no center unit)
    for (let radius = 1; slots.length < count && radius <= 5; radius++) {
      const ring = this.getHexRing(center, radius);
      // Distribute evenly around the ring
      const step = Math.max(1, Math.floor(ring.length / Math.min(count - slots.length, ring.length)));
      for (let i = 0; i < ring.length && slots.length < count; i += step) {
        const hex = ring[i];
        const key = `${hex.q},${hex.r}`;
        const tile = this.currentMap?.tiles.get(key);
        if (tile && !this.isWaterTerrain(tile.terrain) && tile.terrain !== TerrainType.MOUNTAIN
            && !Pathfinder.blockedTiles.has(key)) {
          slots.push(hex);
        }
      }
    }
    return slots.length > 0 ? slots : [center];
  }

  // ===================== UNIT TYPE PRIORITY FOR FORMATIONS =====================

  /**
   * Get the priority order for a unit type in formations.
   * Lower values = outer positions (tanky units like paladins).
   * Higher values = inner positions (ranged/protected units like archers).
   * This is used to sort units before assigning formation slots.
   */
  private getUnitFormationPriority(unit: Unit): number {
    switch (unit.type) {
      case UnitType.PALADIN:       return 0; // Outermost, front line
      case UnitType.WARRIOR:        return 1; // Melee fighters
      case UnitType.RIDER:          return 2; // Flankers
      case UnitType.LUMBERJACK:
      case UnitType.BUILDER:
      case UnitType.VILLAGER:       return 3; // Workers, middle
      case UnitType.ARCHER:
      case UnitType.MAGE:           return 4; // Ranged, more protected
      case UnitType.CATAPULT:
      case UnitType.TREBUCHET:
      case UnitType.SCOUT:          return 5; // Innermost, center
      default:                      return 3; // Default to middle
    }
  }

  // ===================== RESPAWN UNITS =====================

  private respawnSelectedUnits(): void {
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) return;

    // Copy array since removeUnitFromGame modifies allUnits
    const toKill = [...selected];
    this.selectionManager.clearSelection();

    let killCount = 0;
    for (const unit of toKill) {
      unit.state = UnitState.DEAD;
      unit.currentHealth = 0;
      this.removeUnitFromGame(unit);
      killCount++;
    }

    if (killCount > 0) {
      this.hud.showNotification(`💀 ${killCount} unit(s) killed`, '#e74c3c');
    }
  }

  // ===================== RALLY POINT SYSTEM =====================

  private enterRallyPointModeForBuilding(buildingKey: string): void {
    this.clearAllModes();
    this.rallyPointSetMode = true;
    this.rallyPointBuilding = buildingKey;
    this.hud.setRallyPointMode(true, buildingKey);
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    canvasEl.style.cursor = 'crosshair';
    this.hud.showNotification(`Set ${buildingKey} rally point — click a tile · [ESC] cancel`, '#f0c040');
  }

  private setRallyPoint(buildingKey: string, target: HexCoord): void {
    this.rallyPoints.set(buildingKey, target);

    // Get building position for the flag line
    const bld = this.buildingSystem.getFirstBuilding(buildingKey as BuildingKind, 0);
    if (!bld) return;
    const buildingPos = bld.position;

    // Remove old flag + line
    const oldFlag = this.rallyFlagMeshes.get(buildingKey);
    if (oldFlag) { this.renderer.scene.remove(oldFlag); }
    const oldLine = this.rallyLineMeshes.get(buildingKey);
    if (oldLine) { this.renderer.scene.remove(oldLine); }

    // Create flag mesh at rally point
    const flagGroup = new THREE.Group();
    const wp = this.hexToWorld(target);
    const elev = this.getElevation(target);
    flagGroup.position.set(wp.x, elev, wp.z);

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.75;
    flagGroup.add(pole);

    // Flag banner
    const flagGeo = new THREE.PlaneGeometry(0.5, 0.3);
    const flagColor = buildingKey === 'barracks' ? 0xe74c3c : buildingKey === 'forestry' ? 0x27ae60 : buildingKey === 'masonry' ? 0x808080 : 0xdaa520;
    const flagMat = new THREE.MeshLambertMaterial({ color: flagColor, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.25, 1.35, 0);
    flagGroup.add(flag);

    this.renderer.scene.add(flagGroup);
    this.rallyFlagMeshes.set(buildingKey, flagGroup);

    // Create dotted line from building to rally point
    const buildWP = this.hexToWorld(buildingPos);
    const buildElev = this.getElevation(buildingPos);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(buildWP.x, buildElev + 0.5, buildWP.z),
      new THREE.Vector3(wp.x, elev + 0.5, wp.z),
    ]);
    const lineMat = new THREE.LineDashedMaterial({ color: flagColor, dashSize: 0.3, gapSize: 0.2 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    this.renderer.scene.add(line);
    this.rallyLineMeshes.set(buildingKey, line);
  }

  /** Get rally point for a building, or null */
  private getRallyPoint(buildingKey: string): HexCoord | null {
    return this.rallyPoints.get(buildingKey) ?? null;
  }

  /**
   * Get a formation slot for a newly spawned unit at a rally point.
   * Gathers all nearby player units, sorts by type priority, generates formation slots,
   * and returns the slot designated for the new unit (which should be assigned to the last position).
   */
  private getRallyFormationSlot(buildingKey: string, newUnit: Unit): HexCoord | null {
    if (!this.currentMap) return null;

    const rally = this.getRallyPoint(buildingKey);
    if (!rally) return null;

    // Gather all player 0 units within hex distance 5 of the rally point
    const nearbyUnits: Unit[] = [];
    for (const unit of this.players[0].units) {
      if (unit.state === UnitState.DEAD) continue;
      const dist = Pathfinder.heuristic(unit.position, rally);
      if (dist <= 5) {
        nearbyUnits.push(unit);
      }
    }

    // Add the new unit to the list
    const allUnits = [...nearbyUnits, newUnit];

    // Sort by type priority (paladins outer, archers inner)
    allUnits.sort((a, b) => this.getUnitFormationPriority(a) - this.getUnitFormationPriority(b));

    // Generate formation slots for all units around the rally point
    const formationSlots = this.generateFormationTyped(rally, allUnits.length, FormationType.BOX);

    // Return the slot for the new unit (it's at the end of the sorted list)
    const newUnitIndex = allUnits.length - 1;
    return formationSlots[newUnitIndex] || rally;
  }

  // ===================== PLANT CROPS SYSTEM =====================

  private togglePlantCropsMode(): void {
    const canvasEl = document.getElementById(ENGINE_CONFIG.canvasId) as HTMLCanvasElement;
    const wasActive = this.plantCropsMode;
    this.clearAllModes();
    this.plantCropsMode = !wasActive;
    this.hud.setPlantCropsMode(this.plantCropsMode);
    canvasEl.style.cursor = this.plantCropsMode ? 'crosshair' : 'default';
    StrategyCamera.suppressLeftDrag = this.plantCropsMode;
    SelectionManager.suppressBoxSelect = this.plantCropsMode;
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
    const grassStage = this.grassAge.get(key);
    if (grassStage !== undefined && grassStage >= 1) {
      this.hud.showNotification('⚠️ Harvest the grass first before planting crops!', '#e67e22');
      return;
    }

    // Can't already be a farm
    if (UnitAI.farmPatches.has(key)) return;
    if (Pathfinder.blockedTiles.has(key)) return;

    // Place farm patch
    UnitAI.farmPatches.add(key);
    this.clearedPlains.add(key);

    // Add visual marker (brown tilled soil look)
    if (!this.farmPatchMarkers.has(key)) {
      const markerGeo = new THREE.PlaneGeometry(1.2, 1.2);
      const markerMat = new THREE.MeshLambertMaterial({ color: 0x5d4037, transparent: true, opacity: 0.6 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.rotation.x = -Math.PI / 2;
      const wp = this.hexToWorld(coord);
      const elev = this.getElevation(coord);
      marker.position.set(wp.x, elev + 0.02, wp.z);
      this.renderer.scene.add(marker);
      this.farmPatchMarkers.set(key, marker);
    }
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
      this.camera.update(); // Edge-of-screen panning

      this.renderer.updateParticles(rawDelta);
      this.terrainDecorator.updateWater(rawDelta);
      this.terrainDecorator.updateGrass(rawDelta);
      this.unitRenderer.updateBillboards(this.camera.camera);
      this.hud.update();
      if (this.bases.length > 0) {
        this.hud.updateBaseHealth(this.bases);
      }
      this.updateDebugOverlay();
      this.renderer.render(this.camera.camera);
    };

    animate();
    this.showMainMenu();

    console.log(`
    ╔══════════════════════════════════════╗
    ║          CUBITOPIA (RTS)             ║
    ║   Real-Time Voxel Strategy Game     ║
    ║                                      ║
    ║  Controls:                           ║
    ║  Left-click: Select unit             ║
    ║  Left-drag: Box select units         ║
    ║  Right-click: Move / Attack          ║
    ║  Shift+click: Add to selection       ║
    ║  Right-drag: Rotate camera           ║
    ║  Scroll: Zoom in/out                 ║
    ║  WASD/Arrows: Pan camera             ║
    ║  Q/E: Rotate camera                  ║
    ╚══════════════════════════════════════╝
    `);
  }

  // ===================== DEBUG OVERLAY =====================

  private updateDebugOverlay(): void {
    if (!this.hud.debugFlags.showUnitOverlay) {
      // Hide overlay if it exists
      if (this.debugOverlayContainer) {
        this.debugOverlayContainer.style.display = 'none';
      }
      return;
    }

    // Create container if needed
    if (!this.debugOverlayContainer) {
      this.debugOverlayContainer = document.createElement('div');
      this.debugOverlayContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
      document.body.appendChild(this.debugOverlayContainer);
    }
    this.debugOverlayContainer.style.display = 'block';

    const cam = this.camera.camera;
    const canvas = document.getElementById(ENGINE_CONFIG.canvasId)!;
    const rect = canvas.getBoundingClientRect();
    const activeIds = new Set<string>();

    for (const unit of this.allUnits) {
      if (unit.state === UnitState.DEAD) continue;
      activeIds.add(unit.id);

      // Project world position to screen
      const pos = new THREE.Vector3(unit.worldPosition.x, unit.worldPosition.y + 1.6, unit.worldPosition.z);
      pos.project(cam);
      const screenX = (pos.x * 0.5 + 0.5) * rect.width + rect.left;
      const screenY = (-pos.y * 0.5 + 0.5) * rect.height + rect.top;

      // Skip if behind camera
      if (pos.z > 1) continue;

      let label = this.debugOverlayLabels.get(unit.id);
      if (!label) {
        label = document.createElement('div');
        label.style.cssText = `
          position:fixed; font-size:9px; font-family:'Courier New',monospace;
          color:#fff; background:rgba(0,0,0,0.75); padding:1px 4px; border-radius:3px;
          white-space:nowrap; pointer-events:none; transform:translate(-50%,-100%);
          border:1px solid rgba(255,255,255,0.15);
        `;
        this.debugOverlayContainer.appendChild(label);
        this.debugOverlayLabels.set(unit.id, label);
      }

      const ownerColor = unit.owner === 0 ? '#4fc3f7' : '#ef5350';
      const stateShort = unit.state.substring(0, 4).toUpperCase();
      label.innerHTML = `<span style="color:${ownerColor}">${unit.type.substring(0,4).toUpperCase()}</span> ` +
        `<span style="color:#aaa">${stateShort}</span> ` +
        `<span style="color:#81c784">${unit.currentHealth}/${unit.stats.maxHealth}</span> ` +
        `<span style="color:#ffb74d">A${unit.stats.attack} D${unit.stats.defense}</span>`;
      label.style.left = screenX + 'px';
      label.style.top = screenY + 'px';
      label.style.display = '';
    }

    // Clean up labels for dead/removed units
    for (const [id, label] of this.debugOverlayLabels) {
      if (!activeIds.has(id)) {
        label.remove();
        this.debugOverlayLabels.delete(id);
      }
    }
  }

  // ===================== DEBUG / PLAYTESTER METHODS =====================

  private debugSpawnUnit(type: UnitType): void {
    if (!this.currentMap || this.players.length === 0) return;
    // Spawn near player base
    const base = this.bases.find(b => b.owner === 0);
    if (!base) return;
    const pos = this.findSpawnTile(this.currentMap, base.position.q, base.position.r, true);
    const unit = UnitFactory.create(type, 0, pos);
    const wp = this.hexToWorld(pos);
    unit.worldPosition = { ...wp };
    this.players[0].units.push(unit);
    this.allUnits.push(unit);
    this.unitRenderer.addUnit(unit, this.getElevation(pos));
    this.selectionManager.setPlayerUnits(this.allUnits, 0);
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
    this.hud.showNotification(`🐛 Spawned ${type}`, '#9c27b0');
  }

  private debugGiveResources(): void {
    if (this.players.length === 0) return;
    this.woodStockpile[0] += 999;
    this.players[0].resources.wood += 999;
    this.stoneStockpile[0] += 999;
    this.players[0].resources.stone += 999;
    this.foodStockpile[0] += 999;
    this.players[0].resources.food += 999;
    this.players[0].resources.gold += 999;
    this.grassFiberStockpile[0] += 999;
    this.players[0].resources.grass_fiber += 999;
    this.clayStockpile[0] += 999;
    this.players[0].resources.clay += 999;
    this.ropeStockpile[0] += 999;
    this.players[0].resources.rope += 999;
    this.hud.updateResources(this.players[0], this.woodStockpile[0], this.foodStockpile[0], this.stoneStockpile[0]);
    this.resourceManager.updateStockpileVisual(0);
    this.hud.showNotification('🐛 +999 all resources', '#4caf50');
  }

  private debugKillAllEnemy(): void {
    for (const unit of this.allUnits) {
      if (unit.owner === 1 && unit.state !== UnitState.DEAD) {
        unit.currentHealth = 0;
        unit.state = UnitState.DEAD;
        this.removeUnitFromGame(unit);
      }
    }
    this.hud.showNotification('🐛 All enemies killed', '#e74c3c');
  }

  private debugDamageBase(owner: number, amount: number): void {
    const base = this.bases.find(b => b.owner === owner);
    if (!base) return;
    base.health = Math.max(0, base.health - amount);
    this.hud.updateBaseHealth(this.bases);
    this.hud.showNotification(`🐛 Base ${owner} -${amount} hp (${base.health}/${base.maxHealth})`, '#ff5722');
  }

  private debugSpawnEnemyUnit(type: UnitType): void {
    if (!this.currentMap || this.players.length < 2) return;
    const base = this.bases.find(b => b.owner === 1);
    if (!base) return;
    const pos = this.findSpawnTile(this.currentMap, base.position.q, base.position.r, true);
    const unit = UnitFactory.create(type, 1, pos);
    const wp = this.hexToWorld(pos);
    unit.worldPosition = { ...wp };
    this.players[1].units.push(unit);
    this.allUnits.push(unit);
    this.unitRenderer.addUnit(unit, this.getElevation(pos));
    this.selectionManager.setPlayerUnits(this.allUnits, 0);
    this.hud.showNotification(`🐛 Spawned enemy ${type}`, '#b71c1c');
  }

  private debugHealSelected(): void {
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) {
      this.hud.showNotification('No units selected', '#999');
      return;
    }
    let healed = 0;
    for (const unit of selected) {
      if (unit.currentHealth < unit.stats.maxHealth) {
        unit.currentHealth = unit.stats.maxHealth;
        this.unitRenderer.updateHealthBar(unit);
        healed++;
      }
    }
    this.hud.showNotification(`💚 Healed ${healed} unit(s) to full`, '#27ae60');
  }

  private debugBuffSelected(stat: string): void {
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) {
      this.hud.showNotification('No units selected', '#999');
      return;
    }
    for (const unit of selected) {
      switch (stat) {
        case 'attack':
          unit.stats.attack += 3;
          break;
        case 'defense':
          unit.stats.defense += 3;
          break;
        case 'maxHealth':
          unit.stats.maxHealth += 5;
          unit.currentHealth += 5;
          this.unitRenderer.updateHealthBar(unit);
          break;
        case 'moveSpeed':
          unit.moveSpeed = Math.min(unit.moveSpeed + 0.2, 3.0);
          break;
        case 'range':
          unit.stats.range += 1;
          break;
      }
    }
    const labels: Record<string, string> = {
      attack: '+3 ATK', defense: '+3 DEF', maxHealth: '+5 HP',
      moveSpeed: '+0.2 SPD', range: '+1 RNG',
    };
    this.hud.showNotification(`⚡ ${selected.length} unit(s) ${labels[stat] || stat}`, '#e91e63');
  }

  private debugTeleportSelected(target: HexCoord): void {
    const selected = this.selectionManager.getSelectedUnits();
    if (selected.length === 0) return;
    for (const unit of selected) {
      unit.position = { ...target };
      const wp = this.hexToWorld(target);
      unit.worldPosition = { ...wp };
      unit.targetPosition = null;
      unit.command = null;
      this.unitRenderer.setWorldPosition(unit.id, wp.x, wp.y + this.getElevation(target), wp.z);
    }
    this.hud.showNotification(`🌀 Teleported ${selected.length} unit(s)`, '#e91e63');
  }

  private debugInstantWin(): void {
    const enemyBase = this.bases.find(b => b.owner === 1);
    if (!enemyBase) return;
    enemyBase.health = 0;
    enemyBase.destroyed = true;
    this.baseRenderer.showDestruction(enemyBase);
    this.hud.updateBaseHealth(this.bases);
    this.checkWinCondition();
  }

  private debugInstantLose(): void {
    const playerBase = this.bases.find(b => b.owner === 0);
    if (!playerBase) return;
    playerBase.health = 0;
    playerBase.destroyed = true;
    this.baseRenderer.showDestruction(playerBase);
    this.hud.updateBaseHealth(this.bases);
    this.checkWinCondition();
  }

  private debugClearTrees(): void {
    if (!this.currentMap) return;
    let count = 0;
    for (const [key, tile] of this.currentMap.tiles) {
      if (tile.terrain === TerrainType.FOREST) {
        tile.terrain = TerrainType.PLAINS;
        const [q, r] = key.split(',').map(Number);
        this.terrainDecorator.removeDecoration({ q, r });
        this.treeAge.delete(key);
        this.treeRegrowthTimers.delete(key);
        count++;
      }
    }
    this.hud.showNotification(`🌲 Cleared ${count} trees`, '#6d4c41');
  }

  private debugClearStones(): void {
    if (!this.currentMap) return;
    let count = 0;
    for (const [key, tile] of this.currentMap.tiles) {
      if (tile.terrain === TerrainType.MOUNTAIN) {
        // Lower elevation and convert to plains
        tile.terrain = TerrainType.PLAINS;
        if (tile.elevation > 4) tile.elevation = 4;
        const [q, r] = key.split(',').map(Number);
        this.terrainDecorator.removeDecoration({ q, r });
        count++;
      }
    }
    // Rebuild terrain visuals
    if (count > 0 && this.currentMap) {
      this.voxelBuilder.rebuildFromMap(this.currentMap);
    }
    this.hud.showNotification(`🪨 Cleared ${count} stone tiles`, '#78909c');
  }
}

// --- Boot ---
const game = new Cubitopia();
game.start();

// Debug access
(window as any).game = game;
