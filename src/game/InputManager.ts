// ============================================
// InputManager - Event Handler Setup for Cubitopia
// ============================================
// This class encapsulates all mouse, keyboard, and scroll wheel event handling.
// It is tightly coupled to the Cubitopia game class by design — passing the full
// game instance is simpler and cleaner than extracting 50+ methods into an Ops interface.

import * as THREE from 'three';
import { HUD } from '../ui/HUD';
import { DebugPanel } from '../ui/DebugPanel';
import { SelectionManager } from './systems/SelectionManager';
import { UnitAI } from './systems/UnitAI';
import { Pathfinder } from './systems/Pathfinder';
import { StrategyCamera } from '../engine/Camera';
import { EngineConfig, HexCoord, TerrainType, UnitStance, FormationType, MapType, PlacedBuilding, Base, ElementType, UnitType, Unit } from '../types';
import WallSystem from './systems/WallSystem';

// The Cubitopia main game class — tightly coupled by design (80+ property accesses).
// Using `any` because InputManager needs access to private members and extracting an
// Ops interface for 80+ methods is impractical until main.ts is further decomposed.
type Cubitopia = any;

export class InputManager {

  constructor(
    private game: Cubitopia,
    private hud: HUD,
    private debugPanel: DebugPanel,
    private container: HTMLCanvasElement,
    private engineConfig: EngineConfig,
  ) {}

  /**
   * Set up all event handlers (keyboard, mouse, scroll wheel).
   * Called once during game initialization.
   */
  setupHandlers(): void {
    this.setupHUDCallbacks();
    this.setupDebugPanelCallbacks();
    this.setupSelectionCallbacks();
    this.setupAttackMoveHandlers();
    this.setupKeyboardShortcuts();
    this.setupMouseMovement();
    this.setupBuildingPlacementClick();
    this.setupBuildingMousedown();
    this.setupTerrainInfoClick();
    this.setupDragPainting();
    this.setupScrollWheelHandling();
  }

  // ========== HUD CALLBACKS ==========

  private setupHUDCallbacks(): void {
    this.hud.onNewMap(() => this.game.regenerateMap());

    // Wire up control panel buttons — global actions + nested menu system
    this.hud.onBuildWalls(() => this.game.toggleBuildMode());
    this.hud.onHarvest(() => this.game.toggleHarvestMode());
    this.hud.onMine(() => this.game.toggleMineMode());
    this.hud.onSellWood(() => this.game.resourceManager.doSellWood());
    this.hud.onFarmPatch(() => this.game.toggleFarmPatchMode());
    this.hud.onHelp(() =>
      this.hud.isHelpVisible() ? this.hud.hideHelp() : this.hud.showHelp()
    );

    // Nested menu callbacks
    this.hud.onMenuCategory((catOrEncoded: number) => {
      if (catOrEncoded >= 10) {
        // Encoded category + index from tab click: cat=floor(n/10), idx=n%10
        const cat = Math.floor(catOrEncoded / 10) as 1 | 2 | 3;
        const idx = catOrEncoded % 10;
        this.game.menuCategory = cat;
        this.game.menuBuildingIndex = idx;
        const building = (this.game.constructor as any).MENU_CATEGORIES[cat - 1].buildings[idx];
        this.game.toggleBuildingPlaceMode(building.kind);
        this.hud.updateNestedMenu(
          this.game.menuCategory,
          this.game.menuBuildingIndex,
          (this.game.constructor as any).MENU_CATEGORIES
        );
      } else {
        this.game.openMenuCategory(catOrEncoded as 1 | 2 | 3);
      }
    });
    this.hud.onMenuAction((action: string) => this.game.executeMenuAction(action));
    this.hud.onSetStance((stance: UnitStance) => this.game.setSelectedUnitsStance(stance));
    this.hud.onSetFormation((formation: FormationType) =>
      this.game.setSelectedUnitsFormation(formation)
    );
    this.hud.onRespawnUnits(() => this.game.debugController.killSelected());
    this.hud.onCaptureNearestZone(() => this.game.captureNearestZoneWithSelected());
    this.hud.onSetSquadObjective((objective) => this.game.setSelectedSquadObjective(objective));

    // Squad type toggle: when user clicks a unit type badge in the tooltip, filter the selection
    this.hud.onSelectionFiltered((filtered) => {
      this.game.selectionManager.setSelection(filtered);
    });
  }

  // ========== DEBUG PANEL CALLBACKS ==========

  private setupDebugPanelCallbacks(): void {
    this.debugPanel.setCallbacks({
      getFlag: (key) => (this.hud.debugFlags as any)[key] ?? false,
      toggleFlag: (key) => {
        (this.hud.debugFlags as any)[key] = !(this.hud.debugFlags as any)[key];
      },
      getGameSpeed: () => this.hud.gameSpeed,
      setGameSpeed: (s) => {
        this.hud.gameSpeed = s;
        this.game.gameSpeed = s;
        this.hud.showNotification(`Speed: ${s}x`, '#00bcd4');
      },
      getSpawnCount: () => this.hud.debugSpawnCount,
      setSpawnCount: (n) => {
        this.hud.debugSpawnCount = n;
      },
      giveResources: () => this.game.debugController.giveResources(),
      killAllEnemy: () => this.game.debugController.killAllEnemy(),
      damageBase: (owner, amount) => this.game.debugController.damageBase(owner, amount),
      healSelected: () => this.game.debugController.healSelected(),
      killSelected: () => this.game.debugController.killSelected(),
      buffSelected: (stat) => this.game.debugController.buffSelected(stat),
      clearTrees: () => this.game.debugController.clearTrees(),
      clearStones: () => this.game.debugController.clearStones(),
      instantWin: () => this.game.debugController.instantWin(),
      instantLose: () => this.game.debugController.instantLose(),
      spawnUnit: (type, count) => this.game.debugController.spawnUnit(type, count),
      spawnEnemy: (type, count) => this.game.debugController.spawnEnemyUnit(type, count),
      spawnTestArmies: (scale) => this.game.debugController.spawnTestArmies(scale),
      restartArena: () => {
        this.game.gameMode = 'aivai';
        this.game.mapType = MapType.ARENA;
        this.game.restartGame();
      },
      getMapType: () => this.game.mapType,
      animatePreview: (group, unitType, state, time) => {
        this.game.unitRenderer.animatePreviewGroup(group, unitType, state, time);
      },
      clearPreviewAnimation: () => {
        this.game.unitRenderer.clearPreviewAnimation();
      },
      applyUnitStatChange: (type, field: string, value: number) => {
        // Apply to all live units of this type
        for (const unit of this.game.allUnits) {
          if (unit.type !== type) continue;
          if (field.startsWith('stats.')) {
            const statKey = field.slice(6);
            (unit.stats as any)[statKey] = value;
            // If maxHealth changed, scale currentHealth proportionally
            if (statKey === 'maxHealth') {
              unit.currentHealth = Math.min(unit.currentHealth, value);
              this.game.unitRenderer.updateHealthBar(unit);
            }
          } else if (field === 'moveSpeed') {
            unit.moveSpeed = value;
          } else if (field === 'attackSpeed') {
            unit.attackSpeed = value;
          }
        }
      },
    });
  }

  // ========== SELECTION CALLBACKS ==========

  private setupSelectionCallbacks(): void {
    // Selection changed
    this.game.selectionManager.onSelect((units: any[]) => {
      // In wall build mode, left-click places blueprints instead of selecting
      if (this.game.interaction.state.kind === 'wall_build') return;

      this.hud.updateSelection(units);
      this.game.tileHighlighter.clearAll();

      for (const u of this.game.allUnits) {
        this.game.unitRenderer.setSelected(
          u.id,
          units.includes(u),
          u.stats.range
        );
      }

      // Squad selection: if any selected unit has a squad, highlight it
      let selectedSquadId: number | null = null;
      for (const u of units) {
        if (u._squadId != null) {
          selectedSquadId = u._squadId;
          break;
        }
      }
      this.game.unitRenderer.selectSquad(selectedSquadId);

      for (const u of units) {
        const elev = this.game.getElevation(u.position);
        this.game.tileHighlighter.showSelection(u.position, elev);
      }

      // When units are selected, right-click should issue commands, not rotate camera
      StrategyCamera.suppressRightClick = units.length > 0;

      // When units are selected, slicer also sets commandYLevel for underground troop commands
      if (units.length > 0 && this.game.interaction.state.kind !== 'mine') {
        this.hud.onSliceChange = (y) => {
          this.game.commandYLevel = y;
          this.game.voxelBuilder.setSliceY(y);
          this.game.terrainDecorator.setDecorationClipPlane(
            y !== null ? this.game.voxelBuilder.getClipPlane() : null
          );
        };
      } else if (units.length === 0 && this.game.interaction.state.kind !== 'mine') {
        // No units selected — slicer still visible but only controls visual slicing
        this.hud.onSliceChange = (y) => {
          this.game.voxelBuilder.setSliceY(y);
          this.game.terrainDecorator.setDecorationClipPlane(
            y !== null ? this.game.voxelBuilder.getClipPlane() : null
          );
        };
        this.game.commandYLevel = null;
      }
    });

    // Right-click command
    this.game.selectionManager.onCommand((worldPos: any) => {
      this.game.issueCommand(worldPos);
    });

    // Right-click ping (even without selection)
    this.game.selectionManager.onPing((worldPos: any) => {
      this.game.spawnClickIndicator(worldPos, 0xaaaaaa, 0.5); // Grey for ping
    });
  }

  // ========== ATTACK-MOVE HANDLERS ==========

  private setupAttackMoveHandlers(): void {
    // Attack-move left-click handler
    this.container.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (this.game.interaction.state.kind !== 'attack_move') return;
        this.game.interaction.clear();
        (document.getElementById(
          this.engineConfig.canvasId
        ) as HTMLCanvasElement).style.cursor = '';

        const selected = this.game.selectionManager.getSelectedUnits();
        if (selected.length === 0 || !this.game.currentMap) return;

        // Convert mouse to hex via ground-plane intersection (no scene raycast needed)
        const rect = this.container.getBoundingClientRect();
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, this.game.camera.camera);
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
        const worldPos = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, worldPos);
        if (!worldPos) return;
        const hexCoord = this.game.worldToHex(worldPos);
        if (!hexCoord) return;

        const preferUnderground =
          this.game.commandYLevel !== null && this.game.commandYLevel < 0;

        // Issue attack-move command via CommandQueue for multiplayer determinism
        // All unit state mutations now happen in CommandBridge.processCommand()
        this.game.enqueueCommand('attack_move', {
          unitIds: selected.map((u: Unit) => u.id),
          target: hexCoord,
        });

        // Show attack-move indicator (orange flag)
        this.hud.showNotification('Attack-moving!', '#ff9800');
        const elev = this.game.getElevation(hexCoord);
        this.game.tileHighlighter.showAttackIndicator(hexCoord, elev);

        // Visual click indicator
        this.game.spawnClickIndicator(worldPos, 0xff9900, 1.0); // Orange for attack-move

        // Prevent this click from being handled as selection
        e.stopPropagation();
      },
      true
    ); // Use capture phase to intercept before selection

    // Mousedown handler to set suppressNextClick flag for attack-move
    this.container.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        if (e.button === 0 && this.game.interaction.state.kind === 'attack_move') {
          SelectionManager.suppressNextClick = true;
        }
      },
      true
    );
  }

  // ========== KEYBOARD SHORTCUTS ==========

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (this.hud.isHelpVisible()) return;

      // --- Nested Menu System ---
      // 1/2/3 open menu categories
      if (e.key === '1' && !e.shiftKey) {
        this.game.openMenuCategory(1);
        return;
      }
      if (e.key === '2' && !e.shiftKey) {
        this.game.openMenuCategory(2);
        return;
      }
      if (e.key === '3' && !e.shiftKey) {
        this.game.openMenuCategory(3);
        return;
      }

      // Tab exits menu and/or any active action mode (mine, harvest, wall, placement, attack_move)
      if (e.key === 'Tab') {
        const hadMode =
          this.game.interaction.inModal ||
          this.game.interaction.state.kind === 'attack_move' ||
          this.game.menuCategory !== 0;
        if (hadMode) {
          e.preventDefault();
          this.game.closeMenu(); // Clears menu + calls clearAllModes
          return;
        }
      }

      // ── Squad / Control Group hotkeys: Ctrl/Cmd+A/S/D/F/G to assign, plain to recall ──
      {
        const SQUAD_KEYS: Record<string, number> = { a: 0, s: 1, d: 2, f: 3, g: 4 };
        const keyLower = e.key.toLowerCase();
        const squadSlot = SQUAD_KEYS[keyLower];
        const isModifier = e.ctrlKey || e.metaKey; // Support both Ctrl (Win/Linux) and Cmd (Mac)
        if (squadSlot !== undefined && this.game.menuCategory === 0 && !e.altKey) {
          // Always prevent browser defaults for modifier+squad keys (Cmd+A=SelectAll, Cmd+S=Save, etc.)
          if (isModifier) {
            e.preventDefault();
          }

          const sm = this.game.selectionManager;
          const selected = sm.getSelectedUnits();

          if (isModifier) {
            // Ctrl/Cmd+key: ASSIGN selected combat units to this squad slot
            if (selected.length > 0) {
              const assigned = sm.assignControlGroup(squadSlot, selected, true);
              const slotLabel = ['A', 'S', 'D', 'F', 'G'][squadSlot];
              this.hud.showNotification(
                `Squad ${slotLabel}: ${assigned.length} unit${assigned.length !== 1 ? 's' : ''} assigned`,
                '#4fc3f7'
              );
              return;
            }
          } else if (keyLower !== 'a') {
            // Plain S/D/F/G: recall squad (S/D/F/G are purely squad keys)
            if (sm.hasControlGroup(squadSlot)) {
              e.preventDefault();
              const recalled = sm.selectControlGroup(squadSlot);
              if (recalled.length > 0) {
                const slotLabel = ['A', 'S', 'D', 'F', 'G'][squadSlot];
                this.hud.showNotification(
                  `Squad ${slotLabel} selected (${recalled.length})`,
                  '#4fc3f7'
                );
                return;
              }
            }
          } else {
            // Plain A key: recall squad only if NO units are currently selected
            // (if units ARE selected, fall through to attack-move below)
            if (selected.length === 0 && sm.hasControlGroup(0)) {
              e.preventDefault();
              const recalled = sm.selectControlGroup(0);
              if (recalled.length > 0) {
                this.hud.showNotification(
                  `Squad A selected (${recalled.length})`,
                  '#4fc3f7'
                );
                return;
              }
            }
          }
        }
      }

      // A-key: one-shot attack-move mode entry (auto-exits on click)
      // Only activates when units are selected and Ctrl is NOT held
      if (
        (e.key === 'a' || e.key === 'A') &&
        !e.ctrlKey &&
        !e.altKey &&
        this.game.menuCategory === 0
      ) {
        const selected = this.game.selectionManager.getSelectedUnits();
        if (selected.length > 0) {
          this.game.interaction.enter({ kind: 'attack_move' });
          this.hud.showNotification(
            'ATTACK MOVE — Left-click target',
            '#ff9800'
          );
          return;
        }
      }

      // ── QWERT Spell Queue: lock mages to a specific element ──
      // Only active when menu is closed and selection contains mages/battlemages
      if (this.game.menuCategory === 0 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const SPELL_KEYS: Record<string, ElementType | null> = {
          'Q': ElementType.FIRE,
          'W': ElementType.WATER,
          'E': ElementType.LIGHTNING,
          'R': ElementType.WIND,
          'T': ElementType.EARTH,
        };
        const keyUp = e.key.toUpperCase();
        if (keyUp in SPELL_KEYS) {
          const selected = this.game.selectionManager.getSelectedUnits();
          const mages = selected.filter((u: Unit) => u.type === UnitType.MAGE || u.type === UnitType.BATTLEMAGE);
          if (mages.length > 0) {
            const targetElement = SPELL_KEYS[keyUp]!;
            // Toggle: if all mages are already locked to this element, unlock them
            const allLocked = mages.every((m: Unit) => m._lockedElement === targetElement);
            const mageIds = mages.map((m: Unit) => m.id);
            if (allLocked) {
              // Unlock — route through CommandQueue
              this.game.enqueueCommand('unlock_element', {
                unitIds: mageIds,
                element: null,
              });
              const ELEMENT_NAMES: Record<string, string> = {
                fire: 'FIRE', water: 'WATER', lightning: 'LIGHTNING', wind: 'WIND', earth: 'EARTH'
              };
              this.hud.showNotification(
                `${ELEMENT_NAMES[targetElement]} unlocked — cycling`,
                '#aaaaaa'
              );
            } else {
              // Lock — route through CommandQueue
              this.game.enqueueCommand('lock_element', {
                unitIds: mageIds,
                element: targetElement,
              });
              const ELEMENT_COLORS: Record<string, string> = {
                fire: '#ff4400', water: '#4488ff', lightning: '#00e5ff', wind: '#88ff88', earth: '#9944ff'
              };
              const ELEMENT_NAMES: Record<string, string> = {
                fire: 'FIRE', water: 'WATER', lightning: 'LIGHTNING', wind: 'WIND', earth: 'EARTH'
              };
              this.hud.showNotification(
                `${mages.length} mage${mages.length !== 1 ? 's' : ''} locked to ${ELEMENT_NAMES[targetElement]}`,
                ELEMENT_COLORS[targetElement] || '#ffffff'
              );
            }
            // Refresh HUD selection display
            this.hud.updateSelectionInfo(selected);
            e.preventDefault();
            return;
          }
        }
      }

      // Shift cycles buildings within active menu
      if (e.key === 'Shift' && this.game.menuCategory !== 0) {
        this.game.cycleBuildingInMenu(1);
        return;
      }

      // QWERTY actions when menu is open
      if (this.game.menuCategory !== 0) {
        const keyUpper = e.key.toUpperCase();
        const qwertyKeys = ['Q', 'W', 'E', 'R', 'T', 'Y'];
        const qIdx = qwertyKeys.indexOf(keyUpper);
        if (qIdx >= 0) {
          const cat = (
            this.game.constructor as any
          ).MENU_CATEGORIES[this.game.menuCategory - 1];
          const building = cat.buildings[this.game.menuBuildingIndex];
          if (qIdx < building.actions.length) {
            this.game.executeMenuAction(building.actions[qIdx].action);
          }
          return;
        }
        // R rotates building in placement mode (doesn't consume if not in QWERTY range)
        // Fall through to rotation handler below
      }

      // R rotates in any placement mode
      if (e.key === 'r' || e.key === 'R') {
        this.game.interaction.cycleRotation();
        if (this.game.blueprintSystem.hoverGhost) {
          this.game.blueprintSystem.hoverGhost.rotation.y = this.game.interaction.rotation;
        }
        // If we're in menu and R is also a QWERTY action, it was already handled above
        if (this.game.menuCategory !== 0) return;
      }

      // --- Global actions (always available, close menu if open) ---
      const globalAction = (action: () => void) => {
        if (this.game.menuCategory !== 0) {
          this.game.menuCategory = 0;
          this.game.menuBuildingIndex = 0;
          this.hud.updateNestedMenu(
            0,
            0,
            (this.game.constructor as any).MENU_CATEGORIES
          );
        }
        action();
      };
      if (e.key === 'b' || e.key === 'B')
        globalAction(() => this.game.toggleBuildMode());
      if (e.key === 'h' || e.key === 'H')
        globalAction(() => this.game.toggleHarvestMode());
      if (e.key === 'n' || e.key === 'N')
        globalAction(() => this.game.toggleMineMode());
      if (e.key === 'j' || e.key === 'J')
        globalAction(() => this.game.toggleFarmPatchMode());
      if (e.key === 'g' || e.key === 'G')
        globalAction(() => this.game.resourceManager.doSellWood());

      if (e.key === '`') {
        this.debugPanel.setUnits(this.game.allUnits);
        this.debugPanel.toggle();
      }
      if (e.key === 'F9') {
        this.debugPanel.setUnits(this.game.allUnits);
        if (!this.debugPanel.isVisible()) this.debugPanel.toggle();
        this.debugPanel.switchTab('combat');
      }
      if (e.key === 'i' || e.key === 'I') {
        this.hud.toggleUnitStatsPanel();
        this.hud.updateUnitStatsPanel(this.game.allUnits);
      }
      if (e.key === 'F3') {
        e.preventDefault();
        this.game.togglePerfOverlay();
      }

      // Escape cancels attack-move mode
      if (e.key === 'Escape' && this.game.interaction.state.kind === 'attack_move') {
        this.game.interaction.clear();
        return;
      }
    });
  }

  // ========== MOUSE MOVEMENT (GHOST PREVIEW + HOVER DETECTION) ==========

  private setupMouseMovement(): void {
    // Ghost preview on mousemove (for all placement modes)
    this.container.addEventListener('mousemove', (e) => {
      const inPlacementMode =
        this.game.interaction.isPlacingBuilding || this.game.interaction.state.kind === 'wall_build';
      if (!inPlacementMode || !this.game.currentMap) {
        this.game.blueprintSystem.clearHoverGhost();
        return;
      }

      const rect = this.container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.game.camera.camera);

      // Try multiple elevation planes to handle elevated terrain (forests, mountains)
      const hexCoord = this.game.raycastToHex(raycaster);
      if (!hexCoord) {
        this.game.blueprintSystem.clearHoverGhost();
        return;
      }

      const key = `${hexCoord.q},${hexCoord.r}`;
      const tile = this.game.currentMap.tiles.get(key);

      // Only show ghost on valid buildable terrain
      const isWallMode = this.game.interaction.state.kind === 'wall_build';
      const terrainOk = isWallMode
        ? tile &&
          !this.game.isWaterTerrain(tile.terrain) &&
          tile.terrain !== TerrainType.FOREST &&
          tile.terrain !== TerrainType.MOUNTAIN
        : tile &&
          (tile.terrain === TerrainType.PLAINS ||
            tile.terrain === TerrainType.DESERT);
      if (!tile || !terrainOk || Pathfinder.blockedTiles.has(key)) {
        this.game.blueprintSystem.clearHoverGhost();
        return;
      }

      // Skip redundant updates
      if (this.game.blueprintSystem.lastHoverKey === key) return;
      this.game.blueprintSystem.lastHoverKey = key;

      // Create or move the hover ghost
      const worldX = hexCoord.q * 1.5;
      const worldZ = hexCoord.r * 1.5 + (hexCoord.q % 2 === 1 ? 0.75 : 0);
      const baseY = this.game.getElevation(hexCoord);

      // Remove old ghost and rebuild (geometry may differ per mode)
      if (this.game.blueprintSystem.hoverGhost) {
        this.game.blueprintSystem.clearHoverGhost();
      }

      this.game.blueprintSystem.hoverGhost = new THREE.Group();
      const ghostMat = new THREE.MeshBasicMaterial({
        color: 0x3498db,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      });

      if (isWallMode) {
        // Pillar ghost + connector previews toward existing walls/blueprints
        const pillarGeo = new THREE.BoxGeometry(0.55, 2.0, 0.55);
        const pillar = new THREE.Mesh(pillarGeo, ghostMat);
        pillar.position.y = 1.0;
        this.game.blueprintSystem.hoverGhost.add(pillar);

        // Show connector previews to adjacent walls/blueprints
        const neighbors = Pathfinder.getHexNeighbors(hexCoord);
        for (const n of neighbors) {
          const nKey = `${n.q},${n.r}`;
          if (
            !this.game.wallSystem.wallsBuilt.has(nKey) &&
            !this.game.blueprintSystem.blueprintGhosts.has(nKey)
          )
            continue;
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
          this.game.blueprintSystem.hoverGhost.add(seg);
        }
      } else {
        // Standard box ghost for other placement modes
        const ghostGeo = new THREE.BoxGeometry(1.45, 1.6, 0.5);
        const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
        ghostMesh.position.y = 0.8;
        this.game.blueprintSystem.hoverGhost.add(ghostMesh);
      }

      this.game.renderer.scene.add(this.game.blueprintSystem.hoverGhost);
      this.game.blueprintSystem.hoverGhost.position.set(worldX, baseY, worldZ);

      // Get the current rotation from the interaction state machine
      this.game.blueprintSystem.hoverGhost.rotation.y = this.game.interaction.rotation;
    });

    // --- Hover detection: attack targets + building inspection ---
    // When player has units selected and hovers over an enemy, show attack cursor + red ring
    // When hovering over ANY building/base (even with no selection), show pointer cursor for inspection
    let hoveredEnemyId: string | null = null;
    this.container.addEventListener('mousemove', (e) => {
      if (!this.game.currentMap) return;

      const rect = this.container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.game.camera.camera);

      const selected = this.game.selectionManager.getSelectedUnits();

      // Check if hovering over any building mesh — show pointer for inspection
      // Reuse scratch array to avoid per-mousemove allocation
      const placedBuildings = this.game.buildingSystem.placedBuildings;
      const allBuildingMeshes: THREE.Object3D[] =
        this.game._buildingMeshScratch ??
        (this.game._buildingMeshScratch = []);
      allBuildingMeshes.length = 0;
      for (let bi = 0; bi < placedBuildings.length; bi++)
        allBuildingMeshes.push(placedBuildings[bi].mesh);
      if (allBuildingMeshes.length > 0) {
        const buildHits = raycaster.intersectObjects(allBuildingMeshes, true);
        if (buildHits.length > 0) {
          let foundPB: PlacedBuilding | null = null;
          let obj: THREE.Object3D | null = buildHits[0].object;
          while (obj) {
            const pb = placedBuildings.find((p: any) => p.mesh === obj);
            if (pb) {
              foundPB = pb;
              break;
            }
            obj = obj.parent;
          }
          if (foundPB) {
            // Enemy building with units selected = crosshair, otherwise pointer for info
            this.container.style.cursor =
              selected.length > 0 && foundPB.owner !== 0
                ? 'crosshair'
                : 'pointer';
            if (hoveredEnemyId) {
              this.game.unitRenderer.highlightAttackTarget(null);
              hoveredEnemyId = null;
            }
            return;
          }
        }
      }

      // Check if hovering over base mesh — pointer for info, crosshair if selected + enemy
      const baseMeshGroups = this.game.baseRenderer.getAllBaseMeshGroups();
      const baseMeshObjects: THREE.Object3D[] =
        this.game._baseMeshScratch ?? (this.game._baseMeshScratch = []);
      baseMeshObjects.length = 0;
      for (let bi = 0; bi < baseMeshGroups.length; bi++)
        baseMeshObjects.push(baseMeshGroups[bi].group);
      if (baseMeshObjects.length > 0) {
        const baseHits = raycaster.intersectObjects(baseMeshObjects, true);
        if (baseHits.length > 0) {
          let foundBase: Base | null = null;
          let hitObj: THREE.Object3D | null = baseHits[0].object;
          while (hitObj) {
            const found = baseMeshGroups.find((bg: any) => bg.group === hitObj);
            if (found) {
              foundBase =
                this.game.bases.find((b: any) => b.id === found.baseId) ?? null;
              break;
            }
            hitObj = hitObj.parent;
          }
          if (foundBase && !foundBase.destroyed) {
            this.container.style.cursor =
              selected.length > 0 && foundBase.owner !== 0
                ? 'crosshair'
                : 'pointer';
            if (hoveredEnemyId) {
              this.game.unitRenderer.highlightAttackTarget(null);
              hoveredEnemyId = null;
            }
            return;
          }
        }
      }

      // Combat hover detection (enemy units) — requires units to be selected
      if (selected.length > 0) {
        const hexCoord = this.game.raycastToHex(raycaster);
        if (hexCoord) {
          const enemy = this.game.findEnemyAt(hexCoord, selected[0].owner);
          if (enemy) {
            if (hoveredEnemyId !== enemy.id) {
              hoveredEnemyId = enemy.id;
              this.game.unitRenderer.highlightAttackTarget(enemy.id);
              this.container.style.cursor = 'crosshair';
            }
            return;
          }

          // Check for enemy/neutral base hover via hex proximity
          const base = this.game.findBaseAt(hexCoord, selected[0].owner);
          if (base) {
            this.container.style.cursor = 'crosshair';
            if (hoveredEnemyId) {
              this.game.unitRenderer.highlightAttackTarget(null);
              hoveredEnemyId = null;
            }
            return;
          }
        }
      }

      // No target under cursor — clear highlight
      if (hoveredEnemyId) {
        this.game.unitRenderer.highlightAttackTarget(null);
        this.container.style.cursor = '';
        hoveredEnemyId = null;
      } else {
        this.container.style.cursor = '';
      }
    });
  }

  // ========== BUILDING PLACEMENT CLICK ==========

  private setupBuildingPlacementClick(): void {
    // Build/Harvest/Barracks/Forestry/Masonry/Farm mode: click on tiles to place
    this.container.addEventListener('click', (e) => {
      // --- Debug teleport mode ---
      if (this.hud.debugFlags.teleportMode && this.game.currentMap) {
        const rect2 = this.container.getBoundingClientRect();
        const mouse2 = new THREE.Vector2(
          ((e.clientX - rect2.left) / rect2.width) * 2 - 1,
          -((e.clientY - rect2.top) / rect2.height) * 2 + 1
        );
        const rc2 = new THREE.Raycaster();
        rc2.setFromCamera(mouse2, this.game.camera.camera);
        const hexTarget = this.game.raycastToHex(rc2);
        if (hexTarget) {
          this.game.debugController.teleportSelected(hexTarget);
          return;
        }
      }

      const st = this.game.interaction.state;
      const inMode =
        st.kind === 'wall_build' ||
        st.kind === 'place_building' ||
        st.kind === 'rally_point' ||
        st.kind === 'plant_crops' ||
        st.kind === 'exit_pick';
      if (!inMode || !this.game.currentMap) return;

      const rect = this.container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.game.camera.camera);

      const hexCoord = this.game.raycastToHex(raycaster);
      if (hexCoord) {
        if (st.kind === 'wall_build') {
          this.game.blueprintSystem.toggleWallBlueprint(hexCoord);
        } else if (st.kind === 'place_building') {
          this.game.placeGenericBuilding(st.building, hexCoord);
        } else if (st.kind === 'rally_point') {
          this.game.setRallyPoint(st.buildingKey, hexCoord);
          this.hud.showNotification(
            `🚩 Rally point set for ${st.buildingKey}`,
            '#2ecc71'
          );
          this.game.interaction.clear();
        } else if (st.kind === 'plant_crops') {
          this.game.paintPlantCrop(hexCoord);
        } else if (st.kind === 'exit_pick') {
          // Exit-pick mode: click a building/gate to ungarrison there
          const exitKey = `${hexCoord.q},${hexCoord.r}`;
          const released = this.game.garrisonSystem.ungarrison(
            st.sourceKey,
            exitKey
          );
          if (released.length > 0) {
            this.hud.showNotification(
              `🏰 ${released.length} unit(s) exited at (${hexCoord.q},${hexCoord.r})`,
              '#e67e22'
            );
          } else {
            this.hud.showNotification(
              'No units to ungarrison or location not connected',
              '#e74c3c'
            );
          }
          this.game.interaction.clear();
        }
      }
    });
  }

  // ========== BUILDING MOUSEDOWN (PRE-DETECTION) ==========

  private setupBuildingMousedown(): void {
    // --- Pre-detect building/wall/gate clicks on mousedown to suppress selection clearing ---
    // This fires BEFORE SelectionManager.mouseup, preserving unit selection for garrison
    this.container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      if (this.game.interaction.inModal || !this.game.currentMap) return;

      const rect = this.container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.game.camera.camera);

      // Check building meshes
      const buildingMeshes: THREE.Object3D[] = this.game.buildingSystem.placedBuildings.map(
        (pb: any) => pb.mesh
      );
      if (buildingMeshes.length > 0) {
        const hits = raycaster.intersectObjects(buildingMeshes, true);
        if (hits.length > 0) {
          SelectionManager.suppressNextClear = true;
          return;
        }
      }
      // Check base meshes
      const baseMeshGroups = this.game.baseRenderer.getAllBaseMeshGroups();
      const baseMeshObjects: THREE.Object3D[] = baseMeshGroups.map(
        (bg: any) => bg.group
      );
      if (baseMeshObjects.length > 0) {
        const baseHits = raycaster.intersectObjects(baseMeshObjects, true);
        if (baseHits.length > 0) {
          SelectionManager.suppressNextClear = true;
          return;
        }
      }
      // Check wall/gate meshes
      const allWgMeshes: THREE.Object3D[] = [
        ...this.game.wallSystem.wallMeshes,
        ...this.game.wallSystem.gateMeshes,
      ];
      if (allWgMeshes.length > 0) {
        const wgHits = raycaster.intersectObjects(allWgMeshes, true);
        if (wgHits.length > 0) {
          SelectionManager.suppressNextClear = true;
          return;
        }
      }
    });
  }

  // ========== TERRAIN INFO CLICK ==========

  private setupTerrainInfoClick(): void {
    // --- Terrain info: click on any tile when not in a special mode to see info ---
    this.container.addEventListener('click', (e) => {
      if (this.game.interaction.inModal || !this.game.currentMap) return;
      // Skip if a box-select drag just finished — the click event fires after mouseup
      if (SelectionManager.wasBoxSelecting) return;

      // Raycast against building meshes to detect building clicks
      const rect = this.container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.game.camera.camera);

      // Check all placed building meshes (friendly AND enemy)
      const buildingMeshes: THREE.Object3D[] = this.game.buildingSystem.placedBuildings.map(
        (pb: any) => pb.mesh
      );

      if (buildingMeshes.length > 0) {
        const hits = raycaster.intersectObjects(buildingMeshes, true);
        if (hits.length > 0) {
          let clickedPB: PlacedBuilding | null = null;
          let obj: THREE.Object3D | null = hits[0].object;
          while (obj) {
            const found = this.game.buildingSystem.placedBuildings.find(
              (pb: any) => pb.mesh === obj
            );
            if (found) {
              clickedPB = found;
              break;
            }
            obj = obj.parent;
          }
          if (clickedPB) {
            if (clickedPB.owner === 0) {
              // Friendly building — show full tooltip with queue/demolish
              this.game.tooltipController.showTooltip(
                clickedPB,
                e.clientX,
                e.clientY
              );
            } else {
              // Enemy/neutral building — show enemy tooltip with attack/rally
              this.game.tooltipController.showEnemyBuildingTooltip(
                clickedPB,
                e.clientX,
                e.clientY
              );
            }
            return;
          }
        }
      }

      // Check base meshes (friendly, enemy, neutral)
      const baseMeshGroups = this.game.baseRenderer.getAllBaseMeshGroups();
      const baseMeshObjects: THREE.Object3D[] = baseMeshGroups.map(
        (bg: any) => bg.group
      );
      if (baseMeshObjects.length > 0) {
        const baseHits = raycaster.intersectObjects(baseMeshObjects, true);
        if (baseHits.length > 0) {
          let clickedBase: Base | null = null;
          let hitObj: THREE.Object3D | null = baseHits[0].object;
          while (hitObj) {
            const found = baseMeshGroups.find((bg: any) => bg.group === hitObj);
            if (found) {
              clickedBase =
                this.game.bases.find((b: any) => b.id === found.baseId) ?? null;
              break;
            }
            hitObj = hitObj.parent;
          }
          if (clickedBase && !clickedBase.destroyed) {
            const isOwn = clickedBase.owner === 0;
            this.game.tooltipController.showBaseTooltip(
              clickedBase,
              isOwn,
              e.clientX,
              e.clientY
            );
            return;
          }
        }
      }

      // Check wall/gate meshes for garrison tooltip
      const allWallGateMeshes: THREE.Object3D[] = [
        ...this.game.wallSystem.wallMeshes,
        ...this.game.wallSystem.gateMeshes,
      ];
      if (allWallGateMeshes.length > 0) {
        const wgHits = raycaster.intersectObjects(allWallGateMeshes, true);
        if (wgHits.length > 0) {
          // Find which wall/gate was clicked
          let hitMesh: THREE.Object3D | null = wgHits[0].object;
          let foundKey: string | null = null;
          let foundType: 'wall' | 'gate' | null = null;

          while (hitMesh) {
            // Check wall meshes
            for (const [wKey, wMesh] of this.game.wallSystem.wallMeshMap) {
              if (wMesh === hitMesh) {
                foundKey = wKey;
                foundType = 'wall';
                break;
              }
            }
            if (foundKey) break;
            // Check gate meshes
            for (const [gKey, gMesh] of this.game.wallSystem.gateMeshMap) {
              if (gMesh === hitMesh) {
                foundKey = gKey;
                foundType = 'gate';
                break;
              }
            }
            if (foundKey) break;
            hitMesh = hitMesh.parent;
          }

          if (foundKey && foundType) {
            const owner =
              foundType === 'wall'
                ? this.game.wallSystem.wallOwners.get(foundKey) ?? -1
                : this.game.wallSystem.gateOwners.get(foundKey) ?? -1;
            const health =
              foundType === 'wall'
                ? this.game.wallSystem.wallHealth.get(foundKey) ??
                  WallSystem.WALL_MAX_HP
                : this.game.wallSystem.gateHealth.get(foundKey) ??
                  WallSystem.GATE_MAX_HP;
            const maxHealth =
              foundType === 'wall'
                ? WallSystem.WALL_MAX_HP
                : WallSystem.GATE_MAX_HP;

            if (owner === 0) {
              this.game.tooltipController.showWallGateTooltip(
                foundKey,
                foundType,
                owner,
                health,
                maxHealth,
                e.clientX,
                e.clientY
              );
              return;
            }
          }
        }
      }

      // Check for any unit under cursor — show PIP unit tooltip (friendly + enemy)
      const clickedUnit = this.game.selectionManager.findUnitUnderCursor(e, false);
      if (clickedUnit) {
        this.game.tooltipController.showUnitTooltip(clickedUnit, e.clientX, e.clientY);
        // Hide the simpler HUD selection panel for single-unit clicks — the PIP tooltip is richer
        if (clickedUnit.owner === 0) {
          this.hud.hideSelectionInfo();
        }
        return;
      }

      const hex = this.mouseToHex(e);
      if (!hex) return;
      const key = `${hex.q},${hex.r}`;
      const tile = this.game.currentMap.tiles.get(key);
      if (tile) {
        this.hud.showTerrainInfo(tile);
      }
    });
  }

  // ========== DRAG PAINTING (WALLS, HARVEST, MINES, TREES, CROPS) ==========

  private setupDragPainting(): void {
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
          if (d < bestDist) {
            bestDist = d;
            bestN = n;
          }
        }
        path.push(bestN);
        cur = bestN;
      }
      return path;
    };

    this.container.addEventListener('mousedown', (e) => {
      const mode = this.game.interaction.state.kind;
      if (mode !== 'harvest' && mode !== 'farm_patch' && mode !== 'plant_tree' && mode !== 'mine' && mode !== 'wall_build')
        return;
      if (e.button !== 0) return; // Left click only
      paintDragging = true;
      lastDragHex = null;

      // Use mine-specific raycast for side-face detection in mine mode
      const hex = mode === 'mine'
        ? this.mouseToMineHex(e)
        : this.mouseToHex(e);
      if (hex) {
        if (mode === 'harvest')
          this.game.blueprintSystem.paintHarvestTile(hex);
        else if (mode === 'farm_patch')
          this.game.blueprintSystem.paintFarmPatch(hex);
        else if (mode === 'plant_tree') this.game.paintPlantTree(hex);
        else if (mode === 'wall_build') {
          // First click determines drag mode: if tile already has blueprint, drag = erase
          const key = `${hex.q},${hex.r}`;
          mineEraseMode =
            UnitAI.playerWallBlueprint.has(key) ||
            this.game.wallSystem.wallsBuilt.has(key);
          if (e.shiftKey) {
            // Shift+click: place gate instead
            if (mineEraseMode) {
              this.game.blueprintSystem.removeWallBlueprint(hex);
            } else {
              this.game.blueprintSystem.paintGateBlueprint(hex);
              lastDragHex = hex;
            }
          } else {
            // Normal click: place wall
            if (mineEraseMode) {
              this.game.blueprintSystem.removeWallBlueprint(hex);
            } else {
              this.game.blueprintSystem.paintWallBlueprint(hex);
              lastDragHex = hex;
            }
          }
        } else if (mode === 'mine') {
          const key = `${hex.q},${hex.r}`;
          mineEraseMode = UnitAI.playerMineBlueprint.has(key);
          if (mineEraseMode) {
            this.game.blueprintSystem.unpaintMine(hex);
          } else {
            // startY = sliceY if slicer active, null = surface
            const sliceY = this.game.voxelBuilder.getSliceY();
            this.game.blueprintSystem.paintMine(hex, sliceY);
          }
        }
      }
    });

    this.container.addEventListener('mousemove', (e) => {
      if (!paintDragging) return;
      const mode = this.game.interaction.state.kind;
      const hex = mode === 'mine'
        ? this.mouseToMineHex(e)
        : this.mouseToHex(e);
      if (hex) {
        if (mode === 'harvest')
          this.game.blueprintSystem.paintHarvestTile(hex);
        else if (mode === 'farm_patch')
          this.game.blueprintSystem.paintFarmPatch(hex);
        else if (mode === 'plant_tree') this.game.paintPlantTree(hex);
        else if (mode === 'wall_build') {
          if (mineEraseMode) {
            this.game.blueprintSystem.removeWallBlueprint(hex);
          } else if (e.shiftKey) {
            // Gate drag: trace hex-neighbor path from last gate to target
            if (lastDragHex) {
              const path = traceHexPath(lastDragHex, hex);
              for (const step of path) {
                this.game.blueprintSystem.paintGateBlueprint(step);
              }
              if (path.length > 0) lastDragHex = path[path.length - 1];
            } else {
              this.game.blueprintSystem.paintGateBlueprint(hex);
              lastDragHex = hex;
            }
          } else {
            // Wall drag: trace hex-neighbor path from last wall to target
            if (lastDragHex) {
              const path = traceHexPath(lastDragHex, hex);
              for (const step of path) {
                this.game.blueprintSystem.paintWallBlueprint(step);
              }
              if (path.length > 0) lastDragHex = path[path.length - 1];
            } else {
              this.game.blueprintSystem.paintWallBlueprint(hex);
              lastDragHex = hex;
            }
          }
        } else if (mode === 'mine') {
          if (mineEraseMode) {
            this.game.blueprintSystem.unpaintMine(hex);
          } else {
            const sliceY = this.game.voxelBuilder.getSliceY();
            this.game.blueprintSystem.paintMine(hex, sliceY);
          }
        }
      }
    });

    this.container.addEventListener('mouseup', () => {
      paintDragging = false;
      mineEraseMode = false;
      lastDragHex = null;
    });
  }

  // ========== SCROLL WHEEL HANDLING ==========

  private setupScrollWheelHandling(): void {
    // Scroll wheel adjusts mine depth (or horizontal Y level with Shift) in mine mode
    this.container.addEventListener(
      'wheel',
      (e) => {
        if (this.game.interaction.state.kind === 'mine') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            // Shift+scroll = adjust elevation slicer Y level
            // macOS converts Shift+scroll into horizontal scroll (deltaX), so check both axes
            const rawDelta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
            const sign = Math.sign(rawDelta);
            if (sign === 0) return;
            const delta = -sign;
            const currentSlice = this.game.voxelBuilder.getSliceY();
            const newY =
              currentSlice !== null
                ? Math.max(
                    (this.game.constructor .MENU_CATEGORIES as any).UNDERGROUND_DEPTH,
                    Math.min(25, currentSlice + delta)
                  )
                : 25; // first Shift+scroll activates slicer at max
            this.game.voxelBuilder.setSliceY(newY);
            this.game.terrainDecorator.setDecorationClipPlane(
              this.game.voxelBuilder.getClipPlane()
            );
            this.hud.setSlicerValue(newY);
            this.hud.setMineMode(
              true,
              this.game.blueprintSystem.mineDepthLayers,
              newY
            );
          } else {
            const delta = e.deltaY > 0 ? -1 : 1; // scroll down = shallower, scroll up = deeper
            this.game.adjustMineDepth(delta);
          }
        }
      },
      { capture: true }
    ); // capture phase so it fires before camera zoom
  }

  // ========== UTILITY METHODS ==========

  /** Convert mouse event to hex coordinate */
  private mouseToHex(e: MouseEvent): HexCoord | null {
    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.game.camera.camera);
    return this.game.raycastToHex(raycaster);
  }

  /** Mine mode raycast — hits voxel blocks (respects slicer), falls back to ground plane */
  private mouseToMineHex(e: MouseEvent): HexCoord | null {
    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.game.camera.camera);

    if (!this.game.currentMap) return this.game.raycastToHex(raycaster);

    // Raycast against voxel blocks (slicer filtering handled inside raycastBlock)
    const voxelHit = this.game.voxelBuilder.raycastBlock(raycaster);
    if (voxelHit) {
      const [q, r] = voxelHit.tileKey.split(',').map(Number);
      return { q, r };
    }

    // Fallback to ground-plane raycast
    return this.game.raycastToHex(raycaster);
  }
}
