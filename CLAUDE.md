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

**5. Cleanup Sweep**
- Remove stale TODO comments that were resolved by this commit
- Delete dead code paths, unused imports, orphaned type declarations
- Update line counts in CLAUDE.md if they've drifted by more than 50 lines
- Check if any Mistakes Log entries are now irrelevant (problem fully resolved, code deleted)

If any check fails, fix it before starting the next task. The 5 minutes spent here saves hours of drift.
---

## Project Architecture

### Key Files
- `src/main.ts` — **Central orchestrator (~3781 lines, down from ~6275)**. Contains the `Cubitopia` class with game loop, data-driven building placement, unit spawning, formation helpers, and input handling. Delegates subsystems via adapter interfaces.
- `src/game/systems/AIController.ts` — **AI brain (~725 lines)**. Economy build phases 0-6, spawn queues, wave mustering, formation attacks, guard tactics. Uses `AIBuildingOps` slim interface for building operations.
- `src/game/systems/BuildingSystem.ts` — **Building registry (~225 lines)**. Owns `placedBuildings[]`, `wallConnectable`, `barracksHealth`, spawn index. Delegates mesh creation to BuildingMeshFactory.
- `src/game/systems/WallSystem.ts` — **Wall & gate system (~410 lines)**. Owns all wall/gate state, construction, damage, mesh management. Uses `WallSystemOps` callback interface for main.ts operations.
- `src/game/systems/ResourceManager.ts` — **Resource deposits & crafting (~226 lines)**. Deposit handlers, crafting recipes, stockpile visuals.
- `src/game/systems/BuildingMeshFactory.ts` — **Pure mesh factories (~196 lines)**. Standalone functions for all 6 building types.
- `src/game/systems/DefenseMeshFactory.ts` — **Pure mesh factories (~341 lines)**. Adaptive wall mesh and gate mesh with hex neighbor connectivity.
- `src/game/systems/BuildingTooltipController.ts` — **Tooltip UI (~144 lines)**. Building click tooltip, queue buttons, demolish. Uses `TooltipOps` slim interface.
- `src/game/systems/BlueprintSystem.ts` — **Visual markers (~353 lines)**. Wall blueprint ghosts, harvest markers, mine markers, farm patch markers, hover ghost lifecycle. Uses `BlueprintOps` slim interface.
- `src/game/systems/UnitAI.ts` — Unit behavior, stances, combat targeting, movement, worker AI, pathfinding commands
- `src/game/systems/CombatSystem.ts` — Damage formula (Polytopia-like attacker vs defender force ratio)
- `src/game/entities/UnitFactory.ts` — Unit stats, speeds, attack speeds, colors
- `src/ui/HUD.ts` — All UI: resource panel, build buttons, help overlay, debug panel, spawn queues
- `src/engine/UnitRenderer.ts` — 3D unit mesh generation, animations, health bars, labels
- `src/types/index.ts` — All TypeScript interfaces and enums (Unit, UnitType, UnitStance, etc.)
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
- Building kinds: barracks, forestry, masonry, farmhouse, workshop, silo
- No limit on how many of each type can be built (constrained only by resources)

### AI System
- **Owned by `AIController`** — all AI logic extracted from main.ts
- `AIBuildState` interface — tracks each AI player's buildings, spawn queues, wave state
- `updateSmartAIEconomy()` — build phases 0-6, queue workers and combat units
- `updateSmartAISpawnQueue()` — timer-based unit spawning from buildings
- `updateSmartAICommander()` — wave mustering, formation attacks, rally behavior
- `updateSmartAITactics()` — guard assignments at choke points, worker escorts, building defense
- AI uses `guardAssignments: Map<string, HexCoord>` to track which units are posted where
- Uses `AIBuildingOps` slim interface to access BuildingSystem (mesh builders, registerBuilding, aiFindBuildTile) without direct dependency

### Combat & Stances
- **Stances:** PASSIVE (never attack), DEFENSIVE (zone-defend + return to post), AGGRESSIVE (chase + patrol)
- **DEFENSIVE stance** applies to ALL combat units: they chase enemies within detection range, then return to their command position when threats leave. Archers in defensive still kite but don't chase.
- **Target spread:** `findBestTarget()` scores enemies by distance + focus penalty (2.5 per ally already targeting) to prevent overkill dogpiling
- **Archer kiting:** Archers flee from melee enemies within 2 tiles, fire-then-reposition. Works in both idle and attacking states.
- **Re-aggro:** Combat units check for threats while moving (attack-move or aggressive stance units redirect to new targets entering detection range)

### Unit Types (current)
| Type | Enum | Role |
|------|------|------|
| Warrior | WARRIOR | Melee DPS |
| Archer | ARCHER | Ranged (range 4, kites melee) |
| Rider | RIDER | Fast cavalry |
| Paladin | PALADIN | Tanky melee (was "Defender", renamed) |
| Catapult | CATAPULT | Siege, medium range |
| Trebuchet | TREBUCHET | Siege, long range, slow |
| Scout | SCOUT | Fast, low damage, recon |
| Mage | MAGE | Ranged magic |
| Builder | BUILDER | Mines stone/clay, builds walls |
| Lumberjack | LUMBERJACK | Chops trees, carries wood |
| Villager | VILLAGER | Farms, harvests grass |

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
Shrink `src/main.ts` (currently **~3781 lines**, down from ~6275) to a manageable size by extracting self-contained subsystems into dedicated modules. ~2494 lines extracted/consolidated so far across 9 modules + data-driven refactors.

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

### All Pre-Extracted Modules Now Wired
No remaining files to wire. Future extractions will target new code regions.

### Next Extraction Targets (priority order)
1. **CombatResolver** — damage application, unit death, territory capture (~200+ lines)
3. **GameInitializer** — `startNewGame`, map gen orchestration, `initSystems` wiring (~200+ lines)
4. **FormationSystem** — formation math, rally points, unit grouping (~150+ lines)
5. **SpawnQueueSystem** — spawn processing loop, timer management, queue state (~100-150 lines)

### Shrink-Wrap Discipline (ENFORCED)
**Every feature addition or refactor MUST leave main.ts the same size or smaller.**
- Before adding new code to main.ts, identify what can be extracted to offset it
- New features should be built as standalone modules from the start — never inline first
- If a function in main.ts exceeds ~40 lines, it's a candidate for extraction
- If a group of related fields + methods exceeds ~100 lines, extract as a subsystem
- Review and eliminate dead code, unused imports, and stale backward-compat shims on every pass
- Target: get main.ts under 3000 lines within the next 3-4 extraction rounds

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

### BlueprintSystem Integration Notes
- Owns ALL visual markers: wall blueprint ghosts, harvest markers, mine markers, farm patch markers, hover ghost
- Uses `BlueprintOps` slim interface: `isTileOccupied`, `isWaterTerrain`, `getGrassAge`
- `paintWallBlueprint`/`paintGateBlueprint` do NOT check `wallsBuilt`/`gatesBuilt` counts — callers in main.ts drag handlers must do those checks
- `paintMineTile` requires `maxMineDepth` parameter (passed from `Cubitopia.MAX_MINE_DEPTH`)
- `cleanup()` disposes all marker meshes and resets `mineDepthLayers` to 3

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
- **Status markers:** `[DONE]` = shipped, `[WIP]` = in progress, `[BLOCKED]` = dependency unmet, `[READY]` = can start, unmarked = future

### Phase 0: Architecture Foundation (Current) [WIP]
Get main.ts under 3000 lines. All systems modular. Data-driven configs for buildings, units, spawning.
- `[DONE]` Extract AIController, BuildingSystem, WallSystem, ResourceManager
- `[DONE]` Extract BuildingTooltipController
- `[DONE]` Extract BlueprintSystem (wall/harvest/mine/farm markers, hover ghost)
- `[DONE]` Data-driven building placement (BUILDING_PLACEMENT_CONFIG)
- `[DONE]` Data-driven spawn queuing (SPAWN_QUEUE_CONFIG)
- `[DONE]` Pure mesh factories (BuildingMeshFactory, DefenseMeshFactory)
- `[READY]` Extract CombatResolver, GameInitializer, FormationSystem, SpawnQueueSystem
- `[READY]` Convert UnitFactory to data-driven config tables (prerequisite for Phase 1)
- `[READY]` Remove backward-compat getters once all callers migrated
- **Phase gate:** main.ts < 3000 lines, UnitFactory is config-driven, no hardcoded switch cases for building/unit types

### Phase 1: Expanded Unit Types + Data-Driven UnitFactory [BLOCKED on Phase 0 gate]
Make UnitFactory fully data-driven (stat tables, not switch cases) so adding a unit type = adding one config entry. New units:
- **Healer** — support, restores HP to adjacent allies per turn
- **Assassin/Rogue** — stealth, high burst damage, fragile, can bypass walls
- **Shieldbearer** — frontline tank, grants armor aura to adjacent allies (Stoneguard unique)
- **Berserker** — melee DPS that gets stronger at low HP (Wildborne unique)
- **Battlemage** — AoE ranged magic (Arcanists unique)
- **Sea Raider** — amphibious fighter, land + water (Tidecallers unique)
- **Siege Tower** — slow, lets melee units attack over walls

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

### Phase 3: Naval Combat & Water Tiles [BLOCKED on Phase 2]
- **Water hex tiles** — new terrain type, impassable for land units
- **Port building** — coastal building that spawns naval units
- **Naval unit types:** Galley (transport), Warship (ranged combat), Fishing Boat (gathering)
- **Coastal mechanics** — amphibious assault via ports, naval trade routes
- **Bridges/docks** — buildable structures connecting land masses
- Pathfinder needs terrain-type awareness (land/water/coastal)
- UnitAI needs embark/disembark state machine
- Map generator needs island/continent modes with water bodies
- NavalSystem.ts as its own subsystem

### Phase 4: Polish & Revenue Features [BLOCKED on Phase 2]
- **Tech tree** — per-tribe research unlocks (buildings, units, upgrades)
- **Fog of war** — tile visibility based on unit sight radius
- **Multiplayer** — start with hot-seat, then networked (WebSocket)
- **Map editor** — let players create and share maps
- **Campaign mode** — scripted scenarios with objectives
- **Steam Workshop** — custom tribes, maps, mods
- **DLC tribes** — additional paid tribes beyond the 4 base tribes
