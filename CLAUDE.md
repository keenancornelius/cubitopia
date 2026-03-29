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

### When to commit:
- Before starting a new feature that touches 3+ files
- After completing a working feature (checkpoint)
- Before any rename/refactor that touches many files
- Before experimental changes the user wants to try

---

## Project Architecture

### Key Files
- `src/main.ts` — **Massive central file (~6000+ lines)**. Contains the `Cubitopia` class with game loop, building system, AI commander, all placement functions. This is where most gameplay logic lives.
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
- `PlacedBuilding` registry in `placedBuildings: PlacedBuilding[]` — tracks ALL buildings (player + AI)
- Old single-building references (`this.barracks`, `this.forestry`, etc.) are **getter properties** that return the first matching `PlacedBuilding` for backward compatibility
- `registerBuilding()` / `unregisterBuilding()` manage the array + scene + pathfinder blocked tiles
- `getNextSpawnBuilding(kind, owner)` does round-robin spawn distribution
- Building kinds: barracks, forestry, masonry, farmhouse, workshop, silo
- No limit on how many of each type can be built (constrained only by resources)

### AI System
- `AIBuildState` interface — tracks each AI player's buildings, spawn queues, wave state
- `updateSmartAIEconomy()` — build phases 0-6, queue workers and combat units
- `updateSmartAISpawnQueue()` — timer-based unit spawning from buildings
- `updateSmartAICommander()` — wave mustering, formation attacks, rally behavior
- `updateSmartAITactics()` — guard assignments at choke points, worker escorts, building defense
- AI uses `guardAssignments: Map<string, HexCoord>` to track which units are posted where

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
- Barracks: `spawnQueue` — costs gold
- Forestry: `forestrySpawnQueue` — costs wood
- Masonry: `masonrySpawnQueue` — costs wood
- Farmhouse: `farmhouseSpawnQueue` — costs wood
- Workshop: `workshopSpawnQueue` — costs rope + stone + wood (compound cost object, not single number)

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
