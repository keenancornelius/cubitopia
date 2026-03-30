# Cubitopia — Claude Development Guide

## Project Overview
Turn-based voxel strategy game (Polytopia-inspired but 3D). Built with **Three.js + TypeScript + Vite**. No Unity or paid platforms.

**Stack:** Three.js v0.183.2, TypeScript 5.x, Vite 5.x
**Dev server:** `npx vite dev` → localhost:5173
**Type check:** `npx tsc --noEmit`
**Build:** `npx vite build`

---

## Git Commit Policy

**MANDATORY: Create a git commit BEFORE every major code overhaul.** This gives us a clean rollback point if changes break the game.

### Commit checklist (do this every time):
1. Run `npx tsc --noEmit` — must be zero errors
2. Run `npx vite build` — must succeed
3. Update the **help menu** in `src/ui/HUD.ts` (`createHelpOverlay`) with any new/changed gameplay features
4. `git add` relevant files (not node_modules/dist)
5. `git commit` with a descriptive message
6. **Run the Introspective Review** (see below)

### When to commit:
- Before starting a new feature that touches 3+ files
- After completing a working feature (checkpoint)
- Before any rename/refactor that touches many files
- Before experimental changes the user wants to try
- After updating project architecture in CLAUDE.md or Instructions
- After updating the CLAUDE.md and instruction files on quirks and discoveries about the code base
- After updating the help menu with new or missing info

### Introspective Review Protocol (run on every commit)
After each commit, pause and run through these checks before moving on. This is how the project stays coherent as it grows.

**1. Architecture Accuracy Check**
- Does the Key Files section still reflect reality? (line counts, descriptions, ownership)
- Are any new files missing from the Key Files list?
- Do any integration notes reference methods/fields that have been moved or deleted?
- Are backward-compat shims still needed, or can they be removed?

**2. Shrink-Wrap Audit**
- Run `wc -l src/main.ts` — is it the same or smaller than before this commit?
- Did we introduce any new code in main.ts that should have been a standalone module?
- Are there any new functions over 40 lines that should be extracted?
- Any new repetitive patterns that could be data-driven?

**3. Roadmap Alignment Check**
- Does this commit advance any roadmap phase? If so, update the roadmap status.
- Did this commit create or remove architecture prep needed for a future phase?
- Are any roadmap items now unblocked by this change?
- Does the current extraction target list need reordering based on what we learned?

**4. Vision Coherence Check**
- Does the current code structure support the tribe system (Phase 2)? Would adding a `TribeConfig` today require touching main.ts?
- Is UnitFactory closer to being data-driven, or did we add more hardcoded switch cases?
- Are new subsystems using the slim ops interface pattern, or did we create tight coupling?
- Would a new developer reading CLAUDE.md understand the project's direction and how to contribute?

**5. Multiplayer-Readiness Check**
- Did this commit introduce any `Math.random()` calls in game logic? If so, replace with seeded PRNG. (`Math.random()` is OK in rendering/particles/visual-only code.)
- Does any new player input directly mutate game state? If so, refactor to produce a Command object that the simulation consumes. (Direct mutation = impossible to serialize for netcode.)
- Is the new code's game state fully serializable? No closures, DOM refs, or Three.js objects stored in simulation state.
- Could this code run identically on two separate clients given the same inputs? If not, identify the non-determinism source and fix it.

**6. Cleanup Sweep**
- Remove stale TODO comments that were resolved by this commit
- Delete dead code paths, unused imports, orphaned type declarations
- Update line counts in CLAUDE.md if they've drifted by more than 50 lines
- Check if any Mistakes Log entries are now irrelevant (problem fully resolved, code deleted)

If any check fails, fix it before starting the next task. The 5 minutes spent here saves hours of drift.
---

## Project Architecture

### Key Files
- `src/main.ts` — **Central orchestrator (~3755 lines, down from ~6275)**. Contains the `Cubitopia` class with game loop, data-driven building placement, unit spawning, and input handling. Delegates subsystems via adapter interfaces. **NOTE:** Grew significantly during new buildings/resources/units overhaul (Smelter, Armory, Wizard Tower + iron/charcoal/steel/crystal). Next extraction should target CombatEventHandler, InputManager, or SpawnQueueSystem to bring it back under 3000.
- `src/game/systems/AIController.ts` — **AI brain (~945 lines)**. Economy build phases 0-8 (includes Smelter, Armory, Wizard Tower), auto-crafting (charcoal, steel), spawn queues for all 17 unit types, wave mustering, formation attacks, guard tactics. Uses `AIBuildingOps` slim interface for building operations.
- `src/game/systems/BuildingSystem.ts` — **Building registry (~225 lines)**. Owns `placedBuildings[]`, `wallConnectable`, `barracksHealth`, spawn index. Delegates mesh creation to BuildingMeshFactory.
- `src/game/systems/WallSystem.ts` — **Wall & gate system (~410 lines)**. Owns all wall/gate state, construction, damage, mesh management. Uses `WallSystemOps` callback interface for main.ts operations.
- `src/game/systems/ResourceManager.ts` — **Resource deposits & crafting (~314 lines)**. Deposit handlers (wood, stone, food, iron, clay, grass fiber) with collection notifications, crafting (rope, charcoal, steel smelting), stockpile visuals for all 10 resource types.
- `src/game/systems/BuildingMeshFactory.ts` — **Pure mesh factories (~196 lines)**. Standalone functions for all 6 building types.
- `src/game/systems/DefenseMeshFactory.ts` — **Pure mesh factories (~341 lines)**. Adaptive wall mesh and gate mesh with hex neighbor connectivity.
- `src/game/systems/BuildingTooltipController.ts` — **Tooltip UI (~144 lines)**. Building click tooltip, queue buttons, demolish. Uses `TooltipOps` slim interface.
- `src/game/systems/BlueprintSystem.ts` — **Visual markers (~353 lines)**. Wall blueprint ghosts, harvest markers, mine markers, farm patch markers, hover ghost lifecycle. Uses `BlueprintOps` slim interface.
- `src/game/systems/FormationSystem.ts` — **Pure formation functions (~155 lines)**. Box, line, wedge, circle formations + hex ring helper + unit priority sorting. No class state.
- `src/game/systems/NatureSystem.ts` — **Vegetation simulation (~290 lines)**. Tree regrowth/sprouting, grass growth/spreading, grass tracking. Owns all vegetation lifecycle state. Uses `NatureOps` slim interface.
- `src/ui/MenuController.ts` — **Main menu with map selector (~220 lines)**. Game mode + map type selection, game-over screen. Uses `MenuCallbacks` interface (onStartGame(mode, mapType), onPlayAgain).
- `src/game/systems/DebugController.ts` — **Debug/playtester commands (~246 lines)**. All debug commands (spawn, resources, kill, heal, buff, teleport, instant win/lose, clear terrain). Uses `DebugOps` slim interface.
- `src/game/systems/UnitAI.ts` — Unit behavior, stances, combat targeting, movement, worker AI, pathfinding commands
- `src/game/systems/CombatSystem.ts` — **Combat resolution + abilities (~210 lines)**. Polytopia-like damage formula + berserker rage, assassin burst, shieldbearer aura, battlemage AoE, greatsword cleave + knockback, healer tick.
- `src/game/entities/UnitFactory.ts` — **Data-driven unit config (~153 lines)**. Single `UNIT_CONFIG` table per UnitType (17 types). Adding a unit = adding one config entry.
- `src/game/MapPresets.ts` — **Map type configs + arena generator (~175 lines)**. MAP_PRESETS data, generateArenaMap(), MapGenParams for generator overrides.
- `src/engine/SoundManager.ts` — **Procedural audio (~672 lines)**. Web Audio API synthesized SFX (21 sounds). Zero asset files. Melee/ranged/siege/pierce/cleave/blunt hits, death, heal, level_up (triumphant brass fanfare), AoE splash, UI sounds.
- `src/ui/HUD.ts` — **All UI (~2175 lines)**. Resource panel with dropdown groups, build buttons (10 building types), unit spawn buttons (Armory/Wizard Tower sections), crafting buttons, help overlay, spawn queues, stance panel. Debug flags/gameSpeed/spawnCount properties remain here (read by main.ts). `HUD.isCombatType()` static method for combat unit detection.
- `src/ui/DebugPanel.ts` — **Unified tabbed debug panel (~777 lines)**. Three tabs: TOOLS (debug toggles, game speed, spawn buttons), ARMY (composition editor with presets + per-unit counters + mirror mode), COMBAT (live combat log with filters). Toggle with backtick, F9 opens directly to COMBAT tab. Uses `DebugPanelCallbacks` interface to decouple from main.ts.
- `src/ui/ArenaDebugConsole.ts` — **Combat log engine (~191 lines)**. Static `CombatLog` class provides global event logging from UnitAI/CombatSystem with dedup maps for TARGET/PEEL/KITE events. `reset()` for clean game starts. Old UI class removed.
- `src/engine/UnitRenderer.ts` — **3D unit rendering (~3447 lines)**. Unit mesh generation (17 elaborate models with oversized weapons), attack animations (weapon-specific), swing streak VFX, projectile systems (arrows, magic orbs), AoE explosions, combat strafing, trail particles, health bars, labels.
- `src/types/index.ts` — All TypeScript interfaces and enums (Unit, UnitType, UnitStance, MapType, MapPreset, etc.)
- `src/game/systems/Pathfinder.ts` — Hex grid A* pathfinding with blocked tiles, wall awareness
- `src/engine/Renderer.ts` — Three.js scene setup, lighting
- `src/engine/Camera.ts` — Camera controls (pan, zoom, rotate)

### Hex Grid System
- Offset hex coordinates: `worldX = q * 1.5`, `worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0)`
- Tile keys are `"q,r"` strings everywhere
- `Pathfinder.getHexNeighbors(pos)` returns 6 neighbors accounting for odd/even column offset

### Multi-Building System
- **Owned by `BuildingSystem`** — `placedBuildings: PlacedBuilding[]` tracks ALL buildings (player + AI)
- Old single-building references (`this.barracks`, `this.forestry`, etc.) are **getter properties in main.ts** that delegate to `buildingSystem.getFirstBuilding()` for backward compatibility
- `buildingSystem.registerBuilding()` / `unregisterBuilding()` manage the array + scene + pathfinder blocked tiles
- `buildingSystem.getNextSpawnBuilding(kind, owner)` does round-robin spawn distribution
- Building kinds: barracks, forestry, masonry, farmhouse, workshop, silo, smelter, armory, wizard_tower
- No limit on how many of each type can be built (constrained only by resources)
- Smelter required for steel smelting, Armory spawns advanced melee (steel cost), Wizard Tower spawns magic units (crystal cost)

### AI System
- **Owned by `AIController`** — all AI logic extracted from main.ts
- `AIBuildState` interface — tracks each AI player's buildings, spawn queues, wave state
- `updateSmartAIEconomy()` — build phases 0-8 (Smelter phase 6, Armory phase 7, Wizard Tower phase 8), auto-crafts charcoal/steel, queues workers and combat units
- `updateSmartAISpawnQueue()` — timer-based unit spawning from buildings
- `updateSmartAICommander()` — wave mustering, formation attacks, rally behavior
- `updateSmartAITactics()` — guard assignments at choke points, worker escorts, building defense
- AI uses `guardAssignments: Map<string, HexCoord>` to track which units are posted where
- Uses `AIBuildingOps` slim interface to access BuildingSystem (mesh builders, registerBuilding, aiFindBuildTile) without direct dependency

### Combat & Stances
- **Stances:** PASSIVE (never attack), DEFENSIVE (zone-defend + return to post), AGGRESSIVE (chase + patrol)
- **DEFENSIVE stance** applies to ALL combat units: they chase enemies within detection range, then return to their command position when threats leave. Ranged kiters in defensive still kite but don't chase.
- **Target spread:** `findBestTarget()` scores enemies by distance + focus penalty (2.5 per ally already targeting) to prevent overkill dogpiling
- **Combat Roles (data-driven, in UnitAI.ts):**
  - `RANGED_KITERS` (Archer, Mage, Battlemage) — flee from melee enemies within 2 tiles, fire-then-reposition. Works in both idle and attacking states.
  - `TANK_PEELERS` (Shieldbearer, Paladin) — `findBestTarget()` gives -6 score bonus to enemies attacking nearby squishies within 4 hex, causing tanks to peel for ranged/support allies.
  - All others: standard chase-and-attack melee behavior.
- **Knockback:** Greatsword cleave + Shieldbearer shield bash push targets 1 hex away. Uses `combat:cleave` event in main.ts to update hex positions + world positions.
- **Re-aggro:** Combat units check for threats while moving (attack-move or aggressive stance units redirect to new targets entering detection range)

### Unit Types (17 total)
| Type | Enum | Role | Special |
|------|------|------|---------|
| Warrior | WARRIOR | Melee DPS | Oversized broadsword + buckler shield |
| Archer | ARCHER | Ranged (range 4) | Kites melee enemies |
| Rider | RIDER | Fast cavalry | Jousting lance + kite shield |
| Paladin | PALADIN | Tanky melee | Tower shield + flanged mace |
| Catapult | CATAPULT | Siege, medium range | Damages walls |
| Trebuchet | TREBUCHET | Siege, long range | Damages walls |
| Scout | SCOUT | Fast recon | Curved scimitar |
| Mage | MAGE | Ranged magic | Blue projectiles |
| Builder | BUILDER | Worker | Mines stone/clay, builds walls |
| Lumberjack | LUMBERJACK | Worker | Chops trees, carries wood |
| Villager | VILLAGER | Worker | Farms, harvests grass |
| Healer | HEALER | Support | Auto-heals allies in range 2 (2 HP/1.5s) |
| Assassin | ASSASSIN | Burst DPS | +3 attack from full HP, oversized poison daggers |
| Shieldbearer | SHIELDBEARER | Tank/Peeler | Heater shield bash + knockback, +2 defense aura, peels for squishies |
| Berserker | BERSERKER | Melee DPS | Oversized war axes, up to +4 attack at low HP |
| Battlemage | BATTLEMAGE | AoE Ranged | Splash damage to enemies within 1 hex of target |
| Greatsword | GREATSWORD | Cleave melee | Massive claymore, 360° spin hits all adjacent, knockback |

---

## Known Quirks & Gotchas

### Three.js v0.183+ Read-Only Position
**CRITICAL:** `Object3D.position` is read-only in Three.js v0.183+. You CANNOT do:
```ts
Object.assign(mesh, { position: new THREE.Vector3(x, y, z) }); // BREAKS SILENTLY
```
Instead use:
```ts
mesh.position.set(x, y, z);
```
We have a static helper `Cubitopia.bm(geo, mat, x, y, z)` that creates a mesh with position properly set.

### Building Mesh Names
Building meshes are Three.js Groups with names like `"barracks_0"`, `"forestry_1"` where the number is the owner ID. The building click raycaster traverses up parent chain to find the matching `PlacedBuilding` in the registry.

### AI State vs Class State
The AI stores its own building references in `AIBuildState` (e.g., `st.barracks`) separate from the class getters (`this.barracks`). Both should point to the same data, but AI builds go through `registerBuilding()` which adds to the global `placedBuildings` array while also setting `st.barracks` for the AI's own tracking.

### `(unit as any)._path` Pattern
Unit pathfinding stores the full path as `_path` and current index as `_pathIndex` via `(unit as any)` casts. This is a legacy pattern — the `Unit` interface doesn't include these fields. Same for `_postPosition` (defensive stance return point), `_patrolRoute`, `_patrolIdx`.

### `isTileOccupied` Now Uses `placedBuildings`
The old version checked individual building refs. Now it loops the `placedBuildings` array. This means ALL buildings (player + AI) are checked.

### Barracks Health System
`barracksHealth` Map still exists alongside `PlacedBuilding.health`. The `damageBarracks` method now uses `PlacedBuilding` but still updates the legacy health map for backward compat. Eventually the legacy map should be removed.

### HUD Help Overlay
The help menu is a single giant HTML string in `createHelpOverlay()` in `src/ui/HUD.ts` starting around line 1287. It must be updated manually when gameplay changes. The defensive stance description, Paladin unit, building click tooltip, and archer kiting are features that need to be kept in sync.

### Detection Ranges (in UnitAI.ts)
```
Archer: 6, Paladin: 5, Trebuchet: 7, Catapult: 5, Scout: 7, Rider: 4, default (Warrior): 4
```
These are separate from weapon range — detection range is how far units "see" threats.

### Spawn Queue Types
- Barracks, Forestry, Masonry, Farmhouse: handled by `SPAWN_QUEUE_CONFIG` + `doSpawnQueueGeneric()` (single-resource cost)
- Workshop: `doSpawnQueueWorkshop()` — compound cost (rope + stone + wood), kept separate due to multi-resource validation
- Spawn processing loop in `updateRTS()` is already data-driven via `spawnConfigs[]` array

### Resource & Crafting System (implemented)
- **Gold** — earned from selling wood (G) and killing enemies (3g/kill, 5g for siege). Spent on combat units.
- **Iron** — mined from iron ore veins on mountain tiles (orange rusty rocks). ~50% of mountain tiles have iron resource.
- **Charcoal** — crafted (X) from 3 wood + 2 clay → 2 charcoal. Carbon needed for steel smelting.
- **Steel** — smelted (Z) from 2 iron + 1 charcoal (requires Smelter building). Used for Armory unit costs.
- **Crystal** — found on snow terrain tiles. Used for Wizard Tower unit costs.
- Stockpile arrays: `woodStockpile`, `stoneStockpile`, `foodStockpile`, `ironStockpile`, `charcoalStockpile`, `steelStockpile`, `crystalStockpile`, `grassFiberStockpile`, `clayStockpile`, `ropeStockpile` — all `number[2]` indexed by owner.

### Technical Debt — Cleanup Queue
Resolved items are struck through. Remaining items should be addressed during the next cleanup pass:

1. ~~**Dead debug panel code in HUD.ts**~~ — RESOLVED: Removed ~280 lines of old debug UI (buildDebugPanel, toggleDebugPanel, rebuildDebugContent, 15 callback fields/setters). debugFlags, gameSpeed, debugSpawnCount remain in HUD.ts as they're referenced throughout main.ts game logic.

2. ~~**`_onDebugGameSpeed` is private**~~ — RESOLVED: Removed along with all old callback fields.

3. ~~**`(unit as any)._path` pattern**~~ — RESOLVED: Added `_path`, `_pathIndex`, `_postPosition`, `_patrolRoute`, `_patrolIdx`, `_planIsGate`, `_playerCommanded` as optional fields on `Unit` interface. Removed all `as any` casts in UnitAI.ts, main.ts, AIController.ts.

4. ~~**`barracksHealth` legacy Map**~~ — RESOLVED: Removed from BuildingSystem. Building-at-tile checks now use `getBuildingAt()` method.

5. ~~**ArenaDebugConsole.ts UI class**~~ — RESOLVED: Removed the old `ArenaDebugConsole` class (~310 lines). File now only contains the `CombatLog` static class + global exposure.

6. ~~**Menu selections don't persist**~~ — RESOLVED: Added "Restart Arena" button to debug panel TOOLS tab that bypasses the menu entirely, using `restartGame()` method for proper scene cleanup + arena restart.

7. **`regenerateMap()` and `restartGame()` share ~90% code**: The cleanup logic is duplicated between these two methods. Should extract a shared `cleanupGameState()` method and have both call it.

8. **HUD.ts still ~1900 lines**: With old debug UI removed, HUD is smaller but still large. The help overlay (~200 lines), stance panel, spawn queue display, and selection panel could be extracted into separate files.

---

## Mistakes Log

### 2024-03-29: DEFENDER → PALADIN Rename
Renamed the `DEFENDER` unit type to `PALADIN` across all 7 files (69 occurrences). Had to catch string literals too (`'defender'` in tooltip queue options, cost maps, AI spawn queues). The combat system's `defender` parameter (attacker vs defender in a fight) is NOT the unit type — don't rename those.

### 2024-03-29: Invisible Buildings Bug
All 6 building types were invisible because Three.js v0.183 made `position` read-only. The `Object.assign(mesh, { position: new Vector3() })` pattern threw silently inside AI update loops. Fix: created `Cubitopia.bm()` helper using `mesh.position.set()`.

### 2024-03-29: Multi-Building Refactor
Converting from single-building references to `placedBuildings[]` array caused ~15 TypeScript errors from trying to assign to getter-only properties. Fixed by rewriting placement functions, game reset, and AI build code to use `registerBuilding()`/`unregisterBuilding()`. The backward-compat getters return the first matching building.

### 2024-03-29: isSiege Never Set
`UnitFactory.create()` didn't include `isSiege` in the unit object, so trebuchets/catapults couldn't damage walls. Fixed by adding `isSiege: type === UnitType.TREBUCHET || type === UnitType.CATAPULT` to the factory.

### 2024-03-29: Workshop Duplicate Fields
`workshop` and `workshopMesh` were declared as both explicit fields AND getter properties, causing TypeScript duplicate declaration errors. Fixed by removing the old explicit fields.

---

## Current Mission: Reduce main.ts Complexity

### Goal
Shrink `src/main.ts` (currently **~2998 lines**, down from ~6275) to a manageable size by extracting self-contained subsystems into dedicated modules. ~3277 lines extracted/consolidated so far across 14 modules + data-driven refactors.

### Extraction Strategy
We use two patterns depending on the code being extracted:

1. **Pure mesh factories** (standalone functions, no class state):
   - Pattern: `export function buildXMesh(pos, owner, scene, getElevation): THREE.Group`
   - Example: `BuildingMeshFactory.ts` — 6 building mesh functions extracted as pure functions
   - Best for: code that only creates Three.js geometry and doesn't read/write game state

2. **Stateful subsystems** (classes with GameContext bridge):
   - Pattern: class receives `GameContext` with live getters, manages own internal state
   - Example: `ResourceManager.ts` — deposit handlers, crafting, stockpile visuals
   - **CRITICAL:** GameContext must use JavaScript `get` properties (not snapshot values) because `startNewGame()` and `regenerateMap()` reassign arrays/objects
   - Best for: code that reads/writes game state and has its own internal data structures

### Completed Extractions
| Module | Lines Saved | Pattern |
|--------|-------------|---------|
| `ResourceManager.ts` | ~120 | Stateful subsystem |
| `BuildingMeshFactory.ts` | ~200 | Pure mesh factory |
| `DefenseMeshFactory.ts` | ~268 | Pure mesh factory (config object) |
| Spawn queue dedup | ~67 | Data-driven config array |
| `AIController.ts` wiring | ~649 | Stateful subsystem (AIBuildingOps interface) |
| `BuildingSystem.ts` wiring | ~231 | Stateful subsystem (wall rebuild callback) |
| `WallSystem.ts` wiring | ~376 | Stateful subsystem (WallSystemOps interface) |
| `BuildingTooltipController.ts` | ~82 | Stateful subsystem (TooltipOps interface) |
| Placement method consolidation | ~144 | Data-driven config (BUILDING_PLACEMENT_CONFIG) |
| Toggle method consolidation | ~36 | Generic toggleBuildingPlaceMode |
| Spawn queue consolidation | ~24 | Data-driven config (SPAWN_QUEUE_CONFIG) |
| `BlueprintSystem.ts` | ~337 | Stateful subsystem (BlueprintOps interface) |
| `FormationSystem.ts` | ~148 | Pure functions (no class state) |
| `NatureSystem.ts` | ~326 | Stateful subsystem (NatureOps interface) |
| `MenuController.ts` | ~113 | Stateful subsystem (MenuCallbacks interface) |
| `DebugController.ts` | ~173 | Stateful subsystem (DebugOps interface) |
| Final compaction | ~23 | ASCII banner + stale comments |

### All Pre-Extracted Modules Now Wired
No remaining files to wire. Future extractions will target new code regions.

### Next Extraction Targets (priority order)
1. **CombatEventHandler** — event dispatch loop, damage application, unit death (~100+ lines)
2. **InputManager** — keyboard/mouse handler breakout from `setupEventHandlers` (~200+ lines)
3. **SpawnQueueSystem** — spawn processing loop, timer management, queue state (~100-150 lines)

### Shrink-Wrap Discipline (ENFORCED)
**Every feature addition or refactor MUST leave main.ts the same size or smaller.**
- Before adding new code to main.ts, identify what can be extracted to offset it
- New features should be built as standalone modules from the start — never inline first
- If a function in main.ts exceeds ~40 lines, it's a candidate for extraction
- If a group of related fields + methods exceeds ~100 lines, extract as a subsystem
- Review and eliminate dead code, unused imports, and stale backward-compat shims on every pass
- **Phase 0 line-count gate achieved: 2998 lines** (target was <3000). Currently ~3755 after buildings/resources/units overhaul + nested menu system — CombatEventHandler + InputManager + SpawnQueueSystem extractions would recover ~500+ lines.

### WallSystem Integration Notes
- Owns all wall/gate state (wallsBuilt, wallOwners, wallHealth, gatesBuilt, etc.)
- Uses `WallSystemOps` interface for callbacks to main.ts (stockpile checks, blueprint removal, voxel rebuild, resource display)
- Delegates mesh creation to DefenseMeshFactory pure functions
- Gets `wallConnectable` from BuildingSystem via `ops.getWallConnectable()`
- `wallSystem.cleanup()` handles full state + mesh reset
- Constants: `WallSystem.WALL_MAX_HP`, `WallSystem.GATE_MAX_HP`, `WallSystem.BARRACKS_MAX_HP`

### BuildingSystem Integration Notes
- Owns building registry (`placedBuildings`), `wallConnectable`, `barracksHealth`, `buildingSpawnIndex`
- Delegates mesh creation to BuildingMeshFactory pure functions
- Uses `setWallRefs()` callback for wall rebuild on building demolition
- Tooltip UI extracted to `BuildingTooltipController` — no tooltip state left in BuildingSystem
- Backward-compat getters (`this.barracks`, `this.forestry`, etc.) still in main.ts, delegate to buildingSystem
- Building placement uses data-driven `BUILDING_PLACEMENT_CONFIG` in main.ts (one generic method for all 6 types)
- Spawn queuing uses data-driven `SPAWN_QUEUE_CONFIG` in main.ts (one generic method for barracks/forestry/masonry/farmhouse)

### NatureSystem Integration Notes
- Owns ALL vegetation lifecycle: tree regrowth/sprouting, grass growth/spreading, clearedPlains set
- Uses `NatureOps` slim interface for TerrainDecorator calls (addTreeAtStage, addGrassAtStage, etc.)
- `update(delta)` runs tree regrowth + tree sprouts + grass growth + grass spread each frame
- `onTreeChopped(key)` — call after lumberjack chops a tree (starts regrowth timer)
- `onGrassHarvested(key, pos, elevation)` — call after villager harvests grass (resets to short stage)
- Public fields `treeAge`, `grassAge`, `treeRegrowthTimers`, `grassGrowthTimers`, `clearedPlains` accessible for external reads
- Syncs `UnitAI.grassTiles` automatically during grass growth updates

### FormationSystem Integration Notes
- Pure standalone functions, no class instance — imported directly
- `generateFormation(center, count, formationType, tiles)` — main dispatcher
- `getUnitFormationPriority(unit)` — sort units by role (tanks outer, ranged inner)
- `getHexRing(center, radius)` — hex ring utility

### BlueprintSystem Integration Notes
- Owns ALL visual markers: wall blueprint ghosts, harvest markers, mine markers, farm patch markers, hover ghost
- Uses `BlueprintOps` slim interface: `isTileOccupied`, `isWaterTerrain`, `getGrassAge`
- `paintWallBlueprint`/`paintGateBlueprint` do NOT check `wallsBuilt`/`gatesBuilt` counts — callers in main.ts drag handlers must do those checks
- `paintMineTile` requires `maxMineDepth` parameter (passed from `Cubitopia.MAX_MINE_DEPTH`)
- `cleanup()` disposes all marker meshes and resets `mineDepthLayers` to 3

### MenuController Integration Notes
- Pure DOM manipulation — no game state dependencies
- Uses `MenuCallbacks` interface: `onStartGame(mode)`, `onPlayAgain()`
- main.ts provides callbacks in constructor: `onStartGame` triggers `startNewGame`, `onPlayAgain` triggers `regenerateMap`
- `showMainMenu()`, `showGameOverScreen(winner, isVictory, gameMode)`, `removeGameOverOverlay()`, `removeMainMenuOverlay()`

### DebugController Integration Notes
- All debug/playtester commands extracted from main.ts HUD callbacks
- Uses `DebugOps` slim interface (~40 callbacks): state access, spawn helpers, renderer access, world helpers, resource getters/setters (including iron/charcoal/steel/crystal stockpiles), HUD, terrain, nature, win condition
- main.ts creates adapter in `initDebugController()` — all HUD debug button callbacks redirect to `this.debugController.*`
- Methods: spawnUnit, spawnEnemyUnit, giveResources, killAllEnemy, damageBase, healSelected, buffSelected, teleportSelected, instantWin, instantLose, clearTrees, clearStones

### AIController Integration Notes
- Uses `AIBuildingOps` slim interface instead of full BuildingSystem dependency
- main.ts provides adapter object delegating mesh builders + `registerBuilding` + `aiFindBuildTile`
- All AI state lives in `aiController.aiState[pid]` — no AI state left in main.ts
- `aiController.cleanup()` handles full reset on new game

### Live Getter Pattern (MUST USE)
```typescript
private buildGameContext(): GameContext {
  const self = this;
  return {
    get currentMap() { return self.currentMap; },
    get players() { return self.players; },
    // ... NOT: currentMap: this.currentMap (stale snapshot!)
  };
}
```

---

## Feature Roadmap

### Roadmap Review Rules
- **On every commit:** check if the commit advances or blocks any phase. Update status markers below.
- **Before starting any Phase N feature:** verify all Phase N-1 architecture prep items are complete.
- **When adding a new system:** ask "does this make the tribe system easier or harder to build?" If harder, redesign.
- **When touching UnitFactory, BuildingMeshFactory, or AIController:** ask "is this still data-driven? Could a new tribe slot in without code changes?"
- **When touching game logic:** ask "is this deterministic? Does it use Math.random()?" If so, swap to seeded PRNG. Multiplayer depends on this.
- **When handling player input:** ask "does this mutate game state directly?" If so, route through a command/action pattern instead. Multiplayer needs command serialization.
- **Status markers:** `[DONE]` = shipped, `[WIP]` = in progress, `[BLOCKED]` = dependency unmet, `[READY]` = can start, unmarked = future

### Phase 0: Architecture Foundation [DONE]
Get main.ts under 3000 lines. All systems modular. Data-driven configs for buildings, units, spawning.
- `[DONE]` Extract AIController, BuildingSystem, WallSystem, ResourceManager
- `[DONE]` Extract BuildingTooltipController
- `[DONE]` Extract BlueprintSystem (wall/harvest/mine/farm markers, hover ghost)
- `[DONE]` Data-driven building placement (BUILDING_PLACEMENT_CONFIG)
- `[DONE]` Data-driven spawn queuing (SPAWN_QUEUE_CONFIG)
- `[DONE]` Pure mesh factories (BuildingMeshFactory, DefenseMeshFactory)
- `[DONE]` Extract FormationSystem (pure functions, no class state)
- `[DONE]` Extract NatureSystem (tree/grass vegetation lifecycle)
- `[DONE]` Extract MenuController (main menu + game-over UI)
- `[DONE]` Extract DebugController (all playtester/debug commands)
- `[DONE]` **main.ts < 3000 lines (2998 achieved)**
- `[READY]` Extract CombatEventHandler, InputManager, SpawnQueueSystem
- `[DONE]` Convert UnitFactory to data-driven config tables (single UNIT_CONFIG record per type)
- `[READY]` Remove backward-compat getters once all callers migrated
- `[READY]` Replace `Math.random()` in game logic with seeded PRNG (multiplayer prep)
- `[READY]` Introduce CommandQueue pattern for input → simulation decoupling (multiplayer prep)
- **Phase gate:** main.ts < 3000 lines, UnitFactory is config-driven, no hardcoded switch cases for building/unit types

### Phase 1: Expanded Unit Types + Data-Driven UnitFactory [WIP]
UnitFactory is fully data-driven. All combat units normalized — no "Phase 1" separation. 6 of 7 new units implemented with unique abilities:
- `[DONE]` **Healer** — auto-heals allies in range 2, seeks injured, follows combat units
- `[DONE]` **Assassin** — ambush bonus (+3 attack from full HP), fast, dual daggers
- `[DONE]` **Shieldbearer** — armor aura (+2 defense to allies within 2 hex), massive shield
- `[DONE]` **Berserker** — rage mechanic (up to +4 attack at low HP), war paint
- `[DONE]` **Battlemage** — AoE splash damage to enemies within 1 hex of target
- `[READY]` **Sea Raider** — amphibious fighter, land + water (Tidecallers unique, needs Phase 4 water tiles)
- `[READY]` **Siege Tower** — slow, lets melee units attack over walls

**Combat Visual Overhaul** — Making battles readable and satisfying:
- `[DONE]` Range-based counter-attack enforcement (CombatSystem.ts) — out-of-range defenders can't counter
- `[DONE]` Projectile live target tracking — arrows/boulders follow moving targets
- `[DONE]` Unit facing toward combat targets — smooth lerp rotation during attack/chase
- `[DONE]` Attack target hover highlight — red pulsing ring + crosshair cursor on enemy hover
- `[DONE]` Combat strafing for melee units — circle-strafe + lunge around targets
- `[DONE]` Weapon-specific attack animations — assassin jump-stab, berserker overhead cleave, shieldbearer bash+stab, battlemage staff slam, healer channel sway
- `[DONE]` Swing streak VFX — slash/stab/smash trail arcs spawn on weapon strikes, fade + scale over 350ms
- `[DONE]` Weapon-specific impact sounds — hit_pierce (sharp stab), hit_cleave (whoosh+chop), hit_blunt (bass thud) in SoundManager
- `[DONE]` Normalized all combat units — eliminated "Phase 1" separation in isCombatType, HUD hasCombat, stance UI, COMBAT_TYPES array. All non-worker units are combat units.
- `[DONE]` Arena spawns one of each combat unit type (13 per side)
- `[DONE]` **Oversized weapons** — all melee units have visually impressive, enlarged weapons: Warrior (broadsword + buckler), Rider (jousting lance + kite shield), Paladin (tower shield + flanged mace), Assassin (poison daggers), Berserker (war axes), Shieldbearer (massive tower shield + gladius), Scout (scimitar)
- `[DONE]` **Greatsword** — new heavy melee unit with massive two-handed claymore. 360° spin slash animation, cleave hits all adjacent enemies, knockback pushes victims 1 hex away. Stats: 14HP, 6ATK, 2DEF, 1MOV, slow but devastating.
- `[DONE]` **Shieldbearer heater shield** — redesigned model: 3-point top + pointed bottom heater shape, no torso clipping. Shield bash attack animation (draw back + explosive forward slam) with knockback. No gladius — shield IS the weapon.
- `[DONE]` **Combat role system** — data-driven RANGED_KITERS (Archer/Mage/Battlemage kite melee threats) and TANK_PEELERS (Shieldbearer/Paladin prioritize enemies attacking nearby squishies). Replaced all hardcoded `UnitType.ARCHER` kiting checks with role-based `isRangedKiter()`. Future roles can be added by extending the sets.
- `[DONE]` **isCombatUnit exclusion pattern** — converted from inclusion list (which missed GREATSWORD) to exclusion-based (not worker = combat). Matches the pattern used in main.ts and HUD.ts.
- `[DONE]` **Arena base spawning fix** — fixed asymmetric base placement caused by findSpawnTile search-order bias. Direct coordinates for arena bases, separated army/base offsets.
- `[DONE]` **Arena team-colored walls** — wall ring split by hemisphere: blue (player 0) on left, red (player 1) on right. Uses existing wall owner team stripe rendering.
- `[DONE]` **Arena spawn separation** — armies now spawn at their respective bases (offset ±8 from center), maximizing starting distance. Units spread inward toward center from base position.
- `[DONE]` **Arena Debug Console** — live combat monitor overlay (F9 or debug panel button). Logs targeting decisions (with scores), kiting events (success/fail + positions), damage dealt/taken, kills, knockbacks, peel decisions, heals. Filterable by event type. Shows live unit counts and HP pools per team. Static `CombatLog` class enables zero-config logging from UnitAI and CombatSystem.

### Phase 2: 4 Base Tribes (Free in Base Game) [BLOCKED on Phase 1]
Each tribe gets: unique unit, unique building, 2-3 stat modifiers, starting bonus, passive ability, visual skin (voxel palette + building style), AI personality.
- **Phase gate:** TribeConfig interface exists, UnitFactory/BuildingMeshFactory/AIController all read from it, one "default" tribe works end-to-end

**Stoneguard** (defensive/builder)
- Unique unit: Shieldbearer (armor aura to adjacent allies)
- Unique building: Watchtower (extends detection range over wide area)
- Modifiers: +30% wall HP, +15% stone gather, -10% unit movement speed
- Starting bonus: free walls around starting hex
- Passive: "Fortify" — units that don't move for a turn gain +20% defense
- AI: turtle, walls up fast, counterattacks on overextension

**Wildborne** (aggressive/nature)
- Unique unit: Berserker (gains attack as HP drops, rage mechanic)
- Unique building: Beast Den (spawns wolf companions that auto-patrol)
- Modifiers: +20% wood gather, +15% melee damage, -15% wall build speed
- Starting bonus: 2 free warriors + extra wood
- Passive: "Ferocity" — first strike in any combat does 25% bonus damage
- AI: rush, early aggression, overwhelm before enemy builds up

**Arcanists** (ranged/magic)
- Unique unit: Battlemage (AoE damage to hex cluster, expensive)
- Unique building: Mana Well (generates mana resource for special abilities)
- Modifiers: +20% ranged damage, +1 range for archers, -15% melee HP
- Starting bonus: free mage + mana well
- Passive: "Arcane Shield" — ranged units take 30% less damage from first hit each turn
- AI: turtles early behind ranged wall, pushes with battlemage deathball

**Tidecallers** (naval/trade — fully realized in Phase 3)
- Unique unit: Sea Raider (amphibious, fights on land and water)
- Unique building: Lighthouse (coastal hex, vision + resource bonus from water tiles)
- Modifiers: +25% movement on coastal tiles, +15% gold from trade, -10% inland gather
- Starting bonus: starts near coast + extra gold (pre-naval), free fishing boat (post-naval)
- Passive: "Tidal Knowledge" — reveals all coastal tiles at game start
- AI: coastal expansion, controls water, flanks from unexpected angles

Architecture prep (check these on every commit touching these systems):
- `[READY]` `TribeConfig` interface: stat modifiers, color palette, unique unit/building defs, AI personality params, passive ability, starting bonus
- `[READY]` UnitFactory reads stats from config table — adding a unit = adding a data entry
- `[READY]` UnitRenderer skin-aware (color palette lookup from tribe config, not hardcoded)
- `[READY]` BuildingMeshFactory accepts tribe style parameter for visual variants
- `[READY]` AIController personality params (aggression, expansion rate, preferred unit mix) driven by tribe config
- Future DLC tribes slot in by adding more TribeConfig entries

### Phase 3: Neutral Cities & Gold Economy [BLOCKED on Phase 2 gate]
Capturable map objectives that create contested territory and drive strategic decisions. Introduces the gold resource.

**Neutral City Mechanics:**
- Cities spawn at map generation on strategic hexes (crossroads, hilltops, resource-rich areas)
- Start neutral with NPC garrison (scaled to city tier). Must destroy garrison + hold for 2 turns to capture
- Can be recaptured by any player — ownership flips on hold timer
- **City tiers:** Village (1 hex) → Town (3 hex cluster) → City (7 hex cluster). Upgrade by spending gold + building infrastructure in the city's influence radius (3 hexes)
- Each tier upgrade increases gold income, unlocks new recruit options, and grants passive bonuses

**City Bonuses (scale with tier and surrounding infrastructure):**
- **Gold income** — base gold/turn + bonus per farm/building within influence radius
- **Healing aura** — friendly units in city radius slowly regenerate HP
- **Vision range** — reveals terrain around the city (synergizes with fog of war)
- **Unique recruits** — higher-tier cities can train mercenary units not available at home base
- **Trade routes** — connected cities (within N hexes of each other, both owned) generate bonus gold

**Gold Economy:**
- Gold is the universal advanced resource (alongside wood, stone, food, fiber)
- **Earned from:** city income, trade routes, certain terrain deposits, selling surplus resources
- **Spent on:** city tier upgrades, mercenary hiring, tech tree research (Phase 5), army upkeep (large armies cost gold/turn), diplomatic actions (future)
- **Strategic tension:** spread thin to hold more cities for income, or consolidate and push with fewer

**Architecture:**
- `CitySystem.ts` — city state, garrison, ownership, tier, income calculation, influence radius
- `CityConfig` data table — city types, tier thresholds, bonus tables, garrison compositions
- `GoldEconomy` module — income/expense tracking, upkeep calculation, trade route detection
- Map generator places cities using strategic value heuristic (distance from bases, terrain, resources)
- **Phase gate:** 3+ neutral cities on every generated map, capture/recapture works, gold income flows, at least 2 city tiers functional

### Phase 4: Naval Combat & Water Tiles [BLOCKED on Phase 3]
- **Water hex tiles** — new terrain type, impassable for land units
- **Port building** — coastal building that spawns naval units
- **Naval unit types:** Galley (transport), Warship (ranged combat), Fishing Boat (gathering)
- **Coastal mechanics** — amphibious assault via ports, naval trade routes (feed into gold economy)
- **Bridges/docks** — buildable structures connecting land masses
- Pathfinder needs terrain-type awareness (land/water/coastal)
- UnitAI needs embark/disembark state machine
- Map generator needs island/continent modes with water bodies
- NavalSystem.ts as its own subsystem
- Tidecallers tribe gets full naval advantage here

### Phase 5: Competitive Multiplayer (Primary Revenue Target) [BLOCKED on Phase 3]
Online competitive multiplayer is the core revenue driver. Architecture decisions made NOW must keep this feasible.

**Networking Model: Deterministic Lockstep**
- All clients run identical game simulation; only player commands are exchanged over network
- Requires: seeded RNG (no `Math.random()` in game logic), deterministic floating point, command queue
- Fallback: if lockstep proves too strict, switch to server-authoritative with client prediction
- Protocol: WebSocket for real-time, with reconnect support via state snapshots

**Multiplayer Modes:**
- **Ranked 1v1** — primary competitive mode, ELO matchmaking, seasonal ladders
- **2v2 / FFA** — team and free-for-all variants (2-4 players)
- **Custom lobbies** — private games with configurable rules (map size, starting resources, city count, timer)
- **Spectator mode** — watch live games with fog of war toggle

**Competitive Features:**
- **Turn timer** — configurable per-turn time limit (30s / 60s / 90s / unlimited)
- **Fog of war** — tile visibility based on unit sight radius + city vision (critical for competitive)
- **Ranked seasons** — seasonal resets, placement matches, reward tracks
- **Replay system** — full game replay from serialized command log (comes free with lockstep)
- **Anti-cheat** — server validates command legality, detects desync (lockstep hash comparison)

**Architecture Prep (start in Phase 0, enforce throughout):**
- `[READY]` Replace all `Math.random()` in game logic with seeded PRNG (keep Math.random for visuals only)
- `[READY]` All game state mutations go through `CommandQueue` — no direct state writes from input handlers
- `[READY]` Game state must be fully serializable (for snapshots, reconnect, replays)
- `[READY]` Separate "simulation tick" from "render frame" — simulation runs at fixed rate, renderer interpolates
- `[READY]` Player input → Command object → CommandQueue → simulation processes commands deterministically
- Network layer wraps CommandQueue: local mode processes immediately, online mode broadcasts then processes on confirmation

**Revenue Model:**
- Base game free (4 tribes, ranked play, all gameplay features)
- **DLC tribes** — additional paid tribes with unique units/buildings/passives
- **Cosmetic packs** — voxel skins, city themes, terrain themes, victory animations
- **Battle pass** — seasonal cosmetic reward track
- **Steam Workshop** — custom maps, mods (drives retention)

### Phase 6: Polish & Content [BLOCKED on Phase 5]
- **Tech tree** — per-tribe research unlocks (buildings, units, upgrades), costs gold
- **Campaign mode** — scripted scenarios with objectives and narrative
- **Map editor** — let players create and share maps via Steam Workshop
- **Achievements & stats** — tracked across ranked and campaign
- **Tutorial / onboarding** — guided first game with progressive feature unlocks
- **Sound & music** — procedural ambient + combat sfx + tribal music themes
- **AI difficulty tiers** — easy/medium/hard/brutal, each with distinct personality
