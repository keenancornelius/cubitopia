# Cubitopia — Claude Development Guide

## Project Overview
Turn-based voxel strategy game (Polytopia-inspired but 3D). Built with **Three.js + TypeScript + Vite**. No Unity or paid platforms.

**Stack:** Three.js v0.183.2, TypeScript 5.x, Vite 5.x
**Dev server:** `npx vite dev` → localhost:5173
**Type check:** `npx tsc --noEmit`
**Build:** `npx vite build`
**Codebase size:** ~45,469 lines across ~55 TypeScript files (as of 2026-04-02)

---

## Project Goals & Priorities

### Revenue Target
Ship on **Steam** (desktop) and/or **App Store** (mobile via web wrapper or native port). The game must reach a quality bar where players would pay for it. Every decision should be evaluated against: "does this make the game more fun, more polished, or more shippable?"

### Architecture Goals (Priority 1 — Unblocks Everything Else)
These must be addressed BEFORE adding major new features. Technical debt is actively slowing iteration.

1. ~~**Shrink main.ts to <3000 lines**~~ **DONE (2026-04-01).** Currently **3063 lines** (down from 5043, 39% cut). Extracted modules: InputManager (1267), MapInitializer (560), RallyPointSystem (229), InteractionStateMachine (241), SquadIndicatorSystem (87), LifecycleUpdater (137), DebugOverlayRenderer (93). Moved: _updateMusic → ProceduralMusic.updateFromGameState(), spawnClickIndicator → Renderer, spawnTestArmies + spawnFormationArmy → DebugController, killSelected → DebugController. Removed: 37 dead legacy ISM getters.
2. ~~**Split UnitRenderer.ts (8981 lines)**~~ **DONE (2026-04-01).** UnitRenderer.ts is now a 938-line facade. Heavy logic split into: UnitModels.ts (3526 lines — mesh factories), UnitAnimations.ts (2175 — idle/attack/move/hit), ProjectileSystem.ts (1505 — all projectile/spell methods), UnitVFX.ts (1053 — health bars, selection rings, particles, effects). Public API preserved — no external import changes needed.
3. ~~**Consolidate placement mode flags**~~ **DONE (2026-04-01).** Replaced 26 boolean flags + 10 rotation fields with `InteractionStateMachine.ts` — typed discriminated union FSM with proper enter/exit transitions. See `src/game/InteractionStateMachine.ts`.
4. ~~**Centralize magic numbers**~~ **DONE (2026-04-01).** `src/game/GameConfig.ts` (490 lines) centralizes all balance constants: unit costs, building costs, AI weights, combat values (damage/block/deflect/XP), timers, formation params, economy recipes, mining priorities, capture zone params, tactical group thresholds, and gather cooldowns. Used by 10+ consumer files via `GAME_CONFIG.*` references.

### Performance Goals (Priority 2 — Required for Shipping)
These directly affect whether the game feels good to play.

1. ~~**Chunked voxel meshing.**~~ **DONE (2026-04-01).** VoxelBuilder refactored to 8×8 hex chunks with per-chunk InstancedMesh + dirty flagging. Mining now rebuilds only the affected chunk (~64 tiles) instead of the entire map. `markTileDirty()` auto-marks edge-adjacent neighbor chunks for seamless pit walls. `flushDirtyChunks()` called once per frame from game loop. Full rebuild preserved as fallback for map init and debug.
2. **InstancedMesh for repeated objects.** Trees, grass tufts, decorations, and potentially units of the same type. Cuts draw calls from thousands to dozens.
3. ~~**Reduce raycasting.**~~ **DONE (2026-04-01).** Eliminated 3 expensive `intersectObjects(scene.children, true)` calls: main.ts `raycastToHex` (per-frame hover), SelectionManager `screenToWorld` (right-click), InputManager attack-move click. Replaced with O(1) ground-plane intersection + `worldToHex` math. Building/base click detection kept as targeted raycasts against small mesh arrays.
4. ~~**Profile and optimize the game loop.**~~ **DONE (2026-04-01).** Added `Renderer.getPerfInfo()` exposing WebGL draw calls, triangles, textures, geometries. Performance overlay (F3 key) shows live FPS, draw calls, triangle count, unit count, game speed. Updates at 2Hz to avoid overhead.

### Gameplay Goals (Priority 3 — Makes the Game Fun)
Build on the strong foundation of hex combat, capture zones, and economy.

1. **Make AI feel alive.** Squads should march visibly, capture bases in sequence, and put real pressure on the player. Currently squads stall and lack urgency.
2. **Polish combat readability.** Players should instantly understand what's happening in a battle — who's winning, which units to focus, when to retreat.
3. **Economy depth.** The resource chain (iron → steel, wood → charcoal) is good. Add trade-offs and strategic choices (which buildings to prioritize, tech paths).
4. **Map variety.** Different map types should create genuinely different games. Island maps, chokepoint maps, resource-scarce maps.
5. **Win condition clarity.** Capture the enemy capital is clear, but the path to get there should feel like a strategic journey with decision points.

### Future Goals (Not Yet — Requires Architecture First)
- **Tribe/faction system** — different unit rosters, tech trees, visual themes per faction
- **Multiplayer** — deterministic simulation, command serialization, netcode. Requires eliminating Math.random() in game logic and separating view from simulation.
- **Mobile support** — touch controls, performance scaling, responsive UI
- **Mod support** — data-driven configs for units, buildings, maps

### Non-Goals (Avoid Scope Creep)
- Realistic graphics (we're voxel — lean into it)
- Complex diplomacy/trade (keep it combat + economy focused)
- Procedural story/campaign (focus on skirmish replayability first)

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
- After updating the help menu with new or missing info, always make sure to update the help menu and check that it all makes sense with the game  code flow.

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
- For each change, examine the existing system and redesign it into the most elegant solution that would have emerged if the change had been a foundational assumption from the start.

If any check fails, fix it before starting the next task. The 5 minutes spent here saves hours of drift.

---

## Unit Model Design Philosophy — HIGHEST PRIORITY

Unit models are the depth of this game. Model design is the single most important iterative step. Every unit must look distinctive, ornate, and visually rich at game zoom. Spare no expense — this is where we flex.

### Geometry Rules
- **Mixed geometry is allowed and encouraged.** Use BoxGeometry for structural armor/plates (keeps the voxel identity), CylinderGeometry/SphereGeometry/TorusGeometry for decorative and magical elements (halos, staff crystals, aura rings, orbs, shield bosses, mace heads, weapon handles).
- **No lazy boxes.** A unit model should never be "a box with arms." Every unit needs layered detail: multiple armor plates at slight offsets, trim lines, emblems, weapon ornamentation, back-side detail.
- **Back matters.** Players see the back of units as often as the front. Every model needs back detail: backplate, spine ridge, cloak drape, embroidered symbols, hood back, etc.

### Model Construction Process (follow this order)
1. **Silhouette pass** — Lay out big shapes (torso, head, arms, legs). Get proportions right for the unit's role: heavy units are wider/taller, light units are slim.
2. **Layering pass** — Stack slightly offset boxes on structural surfaces for visual depth. Breastplate over torso, faceplate over helm, cuffs over sleeves.
3. **Ornamentation pass** — Add gold trim, emblems (rotated box crosses/stars), studs, buckles, belt pouches. Use team color (`playerColor`) on tabards, belts, hoods.
4. **Weapon pass** — Weapons need handles, grips, pommels, heads, and decorative elements. A mace needs flanges. A staff needs a crystal in a cradle. An axe needs a shaped head.
5. **Back detail pass** — Backplate, spine/ridge, embroidered symbol, cloak/hood drape, matching trim.
6. **Magical/aura pass** — If the unit has abilities, add visible aura elements: orbiting motes, floating halos (TorusGeometry or sphere and curve geometries), ground discs, crystal glows. Name these meshes for animation lookup.

### Animation Quality Standards
- **Every unit type needs unique idle, attack, move, and hit animations.** No falling through to `default` for important units.
- **Idle must have character:** breathing sway, subtle weapon drift, weight shifting. Shield units hold shield high. Casters have palm glow pulse. Staff-wielders have crystal shimmer.
- **Attack animations need phases:** wind-up (coil) → strike/release → impact hold (with tremor if melee) → smooth recovery. Use easing functions (ease-out for snappy strikes, smoothstep for recovery).
- **Per-unit-type strike delay** (`CombatEventHandler.MELEE_STRIKE_DELAY`): damage visuals must sync to the animation frame where the weapon connects. Never use a flat delay.
- **Per-unit-type cooldown floor** (`UnitAI.MIN_ATTACK_COOLDOWN`): prevent re-attack before the animation cycle completes.
- **Ambient effects run in ALL states** (not just idle): paladin motes orbit during combat, healer crystal pulses while moving.

### VFX & Sound Standards
- **Every combat interaction needs visual + audio feedback.** Projectile launch sound + impact sound. Melee hit flash + sound. Heal cast whoosh + impact splash.
- **Projectiles need personality:** heal orbs are green with 6 shimmer sparkles and gentle arc. Attack orbs match element color. Arrows have fletching.
- **Impact effects use particle systems:** water splash droplets with gravity, rising sparkle columns, expanding ring waves, damage flashes. Use `requestAnimationFrame` loops with lifetime management and cleanup.
- **Synthesized sounds** (Web Audio API): layer oscillators + filtered noise for rich effects. Cast sounds = ascending shimmer sweep + bell chime. Impact sounds = choir chord + breath texture.

### Naming Conventions for Animated Parts
- Arms: `arm-left`, `arm-right` (via `makeArmGroup`)
- Legs: `leg-left`, `leg-right` (via `makeLegGroup`)
- Aura motes: `{unit}-mote-{index}` (e.g., `paladin-mote-0`, `healer-mote-2`)
- Aura rings/halos: `{unit}-aura-ring`, `{unit}-halo`
- Weapon glows: `heal-crystal`, `heal-palm-orb`, `heal-crystal-glow`

### Optimization Notes
- Reuse materials across similar geometry (one gold `MeshLambertMaterial` for all trim on a unit).
- Use `MeshBasicMaterial` only for emissive/glow elements; `MeshLambertMaterial` for everything else (cheaper than Standard).
- Keep SphereGeometry/CylinderGeometry segment counts low (6-8 segments) — these are voxel-scale objects.
- Particle systems must self-cleanup via `requestAnimationFrame` loops with bounded lifetimes. Always dispose geometry + material on removal.

### Practical Guide: How to Update a Unit's Visuals & Animations

When modifying or creating a unit model, you touch up to 5 locations across 3 files. Follow this checklist:

**1. Model mesh — `UnitRenderer.ts` → `createUnitModel(type, playerColor)`**
This is the geometry factory. Each unit type has a `case UnitType.XXX:` block that builds a `THREE.Group` from boxes, cylinders, etc. Find the unit's case, modify geometry/materials/positions. The returned group is the root mesh.
- Arms are created via `makeArmGroup(...)` — returns a group named `arm-left` / `arm-right`.
- Legs via `makeLegGroup(...)` — named `leg-left` / `leg-right`.
- Aura elements (motes, halos) must be named for animation lookup (see Naming Conventions above).
- Use `Cubitopia.bm(geo, mat, x, y, z)` helper from main.ts for positioned meshes, or create with `new THREE.Mesh()` + `mesh.position.set()`.

**2. Idle animation — `UnitRenderer.ts` → `animateIdle(mesh, type, time)`**
Each unit type gets a `case UnitType.XXX:` with per-frame transforms driven by `Math.sin(time * speed)`. Find child meshes by name via `mesh.getObjectByName('arm-right')`. Idle should convey personality: breathing sway, weapon drift, weight shifting. Ambient effects (mote orbits, crystal pulses) run here AND in attack/move animations.

**3. Attack animation — `UnitRenderer.ts` → `animateAttack(mesh, type, progress)`**
`progress` goes 0→1 over the attack cooldown duration. Phases: wind-up (0–0.3), strike (0.3–0.5), hold (0.5–0.7), recovery (0.7–1.0). Use easing: `Math.pow(p, 2)` for wind-up acceleration, `1 - Math.pow(1-p, 3)` for snappy strikes. Each unit type has its own case block.

**4. Move animation — `UnitRenderer.ts` → `animateMove(mesh, type, time)`**
Leg swing + arm counter-swing + body bob. Usually simpler than idle/attack. Same `case` structure.

**5. Combat tuning — multiple files:**
- `UnitFactory.ts` → `UNIT_CONFIG` — stats (health, attack, defense, range, movement), speed, color
- `CombatSystem.ts` → `resolve()` — special combat mechanics (berserker rage, assassin burst, shield deflect)
- `CombatEventHandler.ts` → `MELEE_STRIKE_DELAY` — per-unit delay (seconds) before damage triggers, must sync with attack animation's strike frame
- `UnitAI.ts` → `MIN_ATTACK_COOLDOWN` — minimum attack cycle time per unit type (prevents attacks firing faster than the animation)
- `SoundManager.ts` — add/modify synthesized sounds for new abilities

**Testing workflow:**
1. Start dev server: `npx vite dev`
2. Use Arena mode to spawn specific units quickly (debug panel → ARMY tab)
3. Use the UNITS debug tab (backtick → click UNITS) for live stat sliders and 3D model preview — lets you inspect models from all angles without gameplay
4. Check idle animation at game zoom — unit should be recognizable and lively
5. Trigger attacks via debug commands or enemy proximity
6. Verify attack animation timing matches `MELEE_STRIKE_DELAY` (damage flash should land when weapon visually connects)

**Common pitfalls:**
- Forgetting to add a `case` in ALL four animation methods (idle/attack/move/hit) — unit falls through to `default` and looks generic
- Not naming arm/leg groups — `getObjectByName('arm-right')` returns null and animation silently breaks
- Using `MeshStandardMaterial` instead of `MeshLambertMaterial` — heavy on GPU for tiny voxel parts
- Animation time not clamped — attack progress can exceed 1.0 if cooldown drifts; always clamp `Math.min(1, progress)`
- Ambient effects (motes, halos) only in idle — they should run in ALL states

---

## Project Architecture

### Key Files
- `src/main.ts` — **Central orchestrator (~3063 lines, TARGET: <3000)**. Down from 5043 after extracting InputManager, MapInitializer, RallyPointSystem, and dead code cleanup. Still a god-class but manageable. **RULE: Must shrink, not grow. Every new feature MUST extract code to offset additions.** Next extraction targets: split initSystems() into helper methods, extract debug spawn methods to DebugController, split updateRTS() into phase methods.
- `src/game/systems/AIController.ts` — **AI brain (~1318 lines)**. Economy build phases 0-8 (includes Smelter, Armory, Wizard Tower), auto-crafting (charcoal, steel), unified weighted roster spawning from all available buildings, squad dispatch system (formation + shared march speed), territory-first 3-phase commander (Phase 1.7 early capture → territory capture → capital assault), guard tactics, structure garrison (auto-garrisons archers/mages in gates). Uses `AIBuildingOps` + `AIGarrisonOps` slim interfaces.
- `src/game/systems/BuildingSystem.ts` — **Building registry (~255 lines)**. Owns `placedBuildings[]`, `wallConnectable`, spawn index. Delegates mesh creation to BuildingMeshFactory. Syncs UnitAI.buildingPositions/buildingOwners on register/unregister.
- `src/game/systems/WallSystem.ts` — **Wall & gate system (~447 lines)**. Owns all wall/gate state, construction, damage, mesh management. Uses `WallSystemOps` callback interface for main.ts operations.
- `src/game/systems/ResourceManager.ts` — **Resource deposits & crafting (~346 lines)**. Deposit handlers (wood, stone, food, iron, clay, grass fiber) with collection notifications, crafting (rope, charcoal, steel smelting), stockpile visuals for all 10 resource types.
- `src/game/systems/BuildingMeshFactory.ts` — **Pure mesh factories (~316 lines)**. Standalone functions for all building types (barracks, forestry, masonry, farmhouse, workshop, silo, smelter, armory, wizard_tower).
- `src/game/systems/DefenseMeshFactory.ts` — **Pure mesh factories (~341 lines)**. Adaptive wall mesh and gate mesh with hex neighbor connectivity.
- `src/game/systems/BuildingTooltipController.ts` — **Tooltip UI (~491 lines)**. Friendly building tooltip (queue/demolish/garrison), enemy building tooltip (attack), base tooltip (capture zone/rally), wall/gate tooltip (garrison). Uses `TooltipOps` slim interface.
- `src/game/systems/GarrisonSystem.ts` — **Garrison mechanics (~539 lines)**. Units enter buildings (cap 10), gates (cap 5), walls (cap 2). Garrisoned units are hidden, fire ranged attacks at enemies, and can ungarrison at any connected exit point via wall network graph. Structure destruction ejects units with 20% HP damage. Uses `GarrisonOps` slim interface.
- `src/game/systems/BlueprintSystem.ts` — **Visual markers (~392 lines)**. Wall blueprint ghosts, harvest markers, mine markers, farm patch markers, hover ghost lifecycle. Uses `BlueprintOps` slim interface.
- `src/game/systems/FormationSystem.ts` — **Pure formation functions (~163 lines)**. Box, line, wedge, circle formations + hex ring helper + unit priority sorting. No class state.
- `src/game/systems/NatureSystem.ts` — **Vegetation simulation (~321 lines)**. Tree regrowth/sprouting, grass growth/spreading, grass tracking. Owns all vegetation lifecycle state. Uses `NatureOps` slim interface.
- `src/ui/MenuController.ts` — **Main menu with map selector (~256 lines)**. Game mode + map type selection, game-over screen. Uses `MenuCallbacks` interface (onStartGame(mode, mapType), onPlayAgain).
- `src/game/systems/DebugController.ts` — **Debug/playtester commands (~267 lines)**. All debug commands (spawn, resources, kill, heal, buff, teleport, instant win/lose, clear terrain). Uses `DebugOps` slim interface.
- `src/game/systems/UnitAI.ts` — **Unit behavior (~3485 lines)**. Stances, combat targeting, movement, worker AI, pathfinding commands. Static helpers: isUndergroundBase(), findAdjacentEnemyBuilding(). Tracks buildingPositions/buildingOwners for auto-attack.
- `src/game/systems/CombatEventHandler.ts` — **Combat event processing (~493 lines)**. Processes all UnitAI events: damage visuals, projectiles, unit deaths, AoE splash, cleave knockback, XP/level-up, worker tasks (build/chop/mine/harvest), building damage. Uses `CombatEventOps` slim interface.
- `src/game/systems/SpawnQueueSystem.ts` — **Spawn queue management (~430 lines)**. All 7 player spawn queues (barracks, forestry, masonry, farmhouse, workshop, armory, wizard_tower). Queue processing, cost deduction, unit creation, HUD updates. Uses `SpawnQueueOps` slim interface.
- `src/game/systems/CombatSystem.ts` — **Combat resolution + abilities (~370 lines)**. Polytopia-like damage formula + berserker rage, assassin burst, shieldbearer aura, shield deflect (80% ranged damage reduction for shieldbearers/paladins), battlemage AoE, greatsword cleave + knockback, ogre club swipe (2-hex AOE + knockback), healer tick.
- `src/game/systems/BaseUpgradeSystem.ts` — **Base tier progression (~175 lines)**. Checks tier requirements (population + unique buildings in 5-hex zone). Emits BaseUpgradeEvent. Uses `BaseUpgradeOps` slim interface.
- `src/game/systems/PopulationSystem.ts` — **Food population cap (~110 lines)**. Tracks combat units vs food-based cap (2 food per unit). Workers free. Uses `PopulationOps` slim interface.
- `src/game/systems/CaptureZoneSystem.ts` — **Zone control capture (~400 lines)**. 5-hex radius capture zones around all bases. Unit majority = capture progress. Visual ring, light column, progress bar. Y-distance layer check for underground bases. Emits CaptureEvent on flip.
- **Underground elevation safety**: `main.ts hexToWorld(coord, underground?)` now accepts underground parameter. Per-frame Y correction in game loop snaps underground units to tunnel floor if their Y drifts (e.g., from knockback). CombatEventHandler knockback uses underground-aware hexToWorld.
- `src/game/entities/UnitFactory.ts` — **Data-driven unit config (~153 lines)**. Single `UNIT_CONFIG` table per UnitType (18 types including Ogre). Adding a unit = adding one config entry.
- `src/game/MapPresets.ts` — **Map type configs + arena generators (~660 lines)**. MAP_PRESETS data, generateArenaMap(), generateDesertTunnelsMap(), MapGenParams for generator overrides. Desert Tunnels: central cavern + 2 side caverns with neutral outposts, 3-4 surface entrances, deep tunnel network.
- `src/engine/SoundManager.ts` — **Procedural audio (~987 lines)**. Web Audio API synthesized SFX (26 sounds). Zero asset files. Melee/ranged/siege/pierce/cleave/blunt hits, shield_deflect (metallic ping + clatter), death, heal, level_up (triumphant brass fanfare), AoE splash, UI sounds, queue_confirm/queue_error/craft_confirm feedback, unit_spawn pop.
- `src/engine/ProceduralMusic.ts` — **Dynamic music system (~750 lines)**. Genre-based procedural music (title, gameplay, tutorial). Title music on main menu with fade transitions, gameplay music with pause/resume for menu transitions. Uses Web Audio API with own gain nodes.
- `src/engine/TitleScene.ts` — **Cinematic title screen (~1192 lines)**. Self-contained battle arena on dedicated canvas (z-index 19999). Spawns tactical formations (tanks front, ranged back, flankers on wings) using real UnitFactory/CombatSystem/UnitRenderer. Full VFX: projectiles, hit effects, knockback, elemental cycling, chain lightning. Healer AI, ranged kiting, balanced respawn (both teams reinforced to max 13). Cinematic camera with 6 keyframes.
- `src/ui/HUD.ts` — **All UI (~3121 lines)**. Resource panel with dropdown groups, build buttons (10 building types), unit spawn buttons (Armory/Wizard Tower sections), crafting buttons, help overlay, spawn queues, stance panel, capture zone HUD cards, unit stats panel (I key toggle), elevation slicer with Web Audio thwip sounds, selection type-toggle badges for squad filtering. Debug flags/gameSpeed/spawnCount properties remain here (read by main.ts). `HUD.isCombatType()` static method for combat unit detection. `onSelectionFiltered()` callback for type-toggle → SelectionManager integration.
- `src/ui/DebugPanel.ts` — **Unified tabbed debug panel (~1566 lines)**. Three tabs: TOOLS (debug toggles, game speed, spawn buttons), ARMY (composition editor with presets + per-unit counters + mirror mode), COMBAT (live combat log with filters), UNITS (live unit model preview + weapon debug). Toggle with backtick, F9 opens directly to COMBAT tab. Uses `DebugPanelCallbacks` interface to decouple from main.ts.
- `src/ui/ArenaDebugConsole.ts` — **Combat log engine (~191 lines)**. Static `CombatLog` class provides global event logging from UnitAI/CombatSystem with dedup maps for TARGET/PEEL/KITE events. `reset()` for clean game starts. Old UI class removed.
- `src/engine/UnitRenderer.ts` — **3D unit rendering facade (~867 lines)**. Delegates to UnitModels (3526), UnitAnimations (2175), ProjectileSystem (1505), UnitVFX (1053). Public API preserved.
- `src/engine/UnitModels.ts` — **Unit mesh factories (~3526 lines)**. 18 elaborate voxel unit models with oversized weapons, team colors, animated parts naming.
- `src/engine/UnitAnimations.ts` — **Unit animation system (~2175 lines)**. Idle/attack/move/hit/constructing animations per unit type with phase-based easing. Fixed animation position override bug — saves base position at start, resets to 0 for pure offsets, restores at end.
- `src/engine/ProjectileSystem.ts` — **Projectile & spell VFX (~1505 lines)**. Arrows, magic orbs, elemental projectiles, axe throws, heal orbs, boulders, deflection effects.
- `src/engine/UnitVFX.ts` — **Unit visual effects (~1053 lines)**. Health bars, selection rings, damage particles, block sparks, knockback, XP text, level-up effects.
- `src/game/systems/TacticalGroup.ts` — **Tactical grouping (~520 lines)**. Groups nearby units into tactical formations for coordinated combat behavior.
- `src/game/MapInitializer.ts` — **Map generation orchestrator (~858 lines)**. Coordinates map creation, resource placement, base setup. Uses `MapInitOps` slim interface.
- `src/engine/InstancedObjectManager.ts` — **Instanced rendering (~292 lines)**. Manages InstancedMesh for repeated objects (trees, grass).
- `src/engine/Logger.ts` — **Logging utility**. Helper for consistent console logging across engine.
- `src/types/index.ts` — All TypeScript interfaces and enums (~544 lines) (Unit, UnitType, UnitStance, MapType, MapPreset, etc.)
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

### AI Architecture — Two-Layer System (IMPORTANT)

The AI is split into two layers. Understanding which layer handles what is critical for avoiding bugs where one player gets behavior the other doesn't.

**Layer 1: UnitAI.ts — Per-Unit Auto-Behavior (ALL players)**
Runs every frame for every unit, both human and AI. Handles the individual unit's "instincts":
- **Workers:** Builder auto-mine fallback, lumberjack auto-chop, villager auto-farm/harvest — all work identically for human and AI players. Human builders additionally check player-placed mine/wall/harvest blueprints before falling back to auto-behavior.
- **Combat:** Human units use stance system (passive/defensive/aggressive). AI units use rally-and-wave behavior. Both share detection, targeting, kiting, and re-aggro logic.
- **Gating pattern:** Use `player.isAI` / `!player.isAI` to distinguish human vs AI behavior. Never use `unit.owner === 0` for this — that breaks AI vs AI mode where both owners are AI.
- **Static `players` map:** Set each frame in `update()`, available to static methods (like `generateKeepWallPlan`) that only receive an owner ID.

**Layer 2: AIController.ts — AI Commander Brain (AI players only)**
Called from main.ts only for AI players. Makes strategic decisions:
- `updateSmartAIEconomy()` — build phases 0-8 (Smelter phase 6, Armory phase 7, Wizard Tower phase 8), auto-crafts charcoal/steel, queues workers and combat units. Uses unified weighted roster that draws from ALL available buildings simultaneously.
- `updateSmartAISpawnQueue()` — timer-based unit spawning from buildings
- `updateSmartAICommander()` — territory-first multi-phase strategy: Phase 1.7 early capture squads → territory capture → capital assault. Uses `dispatchSquad()` for formation marching.
- `updateSmartAITactics()` — guard assignments at choke points, worker escorts, building defense
- `dispatchSquad()` — groups units by formation priority, assigns squad ID + shared march speed (slowest + 30% blend), generates formation slots around target.
- Uses `AIBuildingOps` slim interface to access BuildingSystem without direct dependency.

**The golden rule:** If a behavior should work for human player units too (workers gathering, combat targeting, movement), it belongs in UnitAI.ts with no `player.isAI` gate (or gated to allow both). If it's a strategic decision only the AI commander makes (building placement, spawn priorities, squad dispatch), it belongs in AIController.ts.

### Combat & Stances
- **Stances:** PASSIVE (never attack), DEFENSIVE (zone-defend + return to post), AGGRESSIVE (chase + patrol)
- **DEFENSIVE stance** applies to ALL combat units: they chase enemies within detection range, then return to their command position when threats leave. Ranged kiters in defensive still kite but don't chase.
- **Target spread:** `findBestTarget()` scores enemies by distance + focus penalty (2.5 per ally already targeting) to prevent overkill dogpiling
- **Combat Roles (data-driven, in UnitAI.ts):**
  - `RANGED_KITERS` (Archer, Mage, Battlemage) — flee from melee enemies within 2 tiles, fire-then-reposition. Works in both idle and attacking states.
  - `TANK_PEELERS` (Shieldbearer, Paladin) — `findBestTarget()` gives -6 score bonus to enemies attacking nearby squishies within 4 hex, causing tanks to peel for ranged/support allies.
  - All others: standard chase-and-attack melee behavior.
- **Knockback:** Greatsword cleave + Shieldbearer shield bash push targets 1 hex away. Uses `combat:cleave` event in main.ts to update hex positions + world positions.
- **High Ground:** CombatSystem.resolve() checks elevation difference. Attacker 3+ elevation above defender → +2 attack bonus. Defender 3+ above attacker → +2 defense bonus. Mountain forts and ridges are key strategic positions.
- **Re-aggro:** Combat units check for threats while moving (attack-move or aggressive stance units redirect to new targets entering detection range)
- **Squad March:** Units assigned to a squad (`_squadId`, `_squadSpeed` on Unit interface) use shared march speed instead of individual moveSpeed. Squad dissolves when units arrive or break off to fight.

### Unit Types (18 total)
| Type | Enum | Role | Special |
|------|------|------|---------|
| Warrior | WARRIOR | Melee DPS | Oversized broadsword + buckler shield |
| Archer | ARCHER | Ranged (range 4) | Kites melee enemies |
| Rider | RIDER | Fast cavalry | Jousting lance + kite shield |
| Paladin | PALADIN | Tanky melee | Tower shield + flanged mace |
| Catapult | CATAPULT | Siege, medium range | Damages walls |
| Trebuchet | TREBUCHET | Siege, long range | Damages walls |
| Scout | SCOUT | Fast recon | Curved scimitar |
| Mage | MAGE | Ranged combo caster | Cycles 5 elements. Water→Wet, Fire→Ablaze. Combos: Wet+Lightning→Electrocute Crit (chain), Ablaze+Wind→Inferno (spread), Arcane+Lightning→Kamehameha (laser). Water+Ablaze→Soothe (anti-synergy heal) |
| Builder | BUILDER | Worker | Mines stone/clay, builds walls |
| Lumberjack | LUMBERJACK | Worker | Chops trees, carries wood |
| Villager | VILLAGER | Worker | Farms, harvests grass |
| Healer | HEALER | Support mage | Auto-heals allies in range 2 (2 HP/1.5s). Cleanse: removes all debuffs + speed boost + status immunity. Counts as mage for Arcane Convergence |
| Assassin | ASSASSIN | Burst DPS | +3 attack from full HP, oversized poison daggers |
| Shieldbearer | SHIELDBEARER | Tank/Peeler | Heater shield bash + knockback, +2 defense aura, peels for squishies |
| Berserker | BERSERKER | Melee DPS | Oversized war axes, up to +4 attack at low HP, ranged axe throw (range 7) once per unique target (slows + chase boost), deflected by shields |
| Battlemage | BATTLEMAGE | AoE setup caster | Low-damage splash within 1 hex. Cyclone pull (2-hex, 8s CD). Water AoE→Wet, Wind AoE→Knockup CC, Lightning AoE→Arcane (purple orbs), Fire AoE→Ablaze. Best paired with Mage for devastating combos |
| Greatsword | GREATSWORD | Cleave melee | Massive claymore, 360° spin hits all adjacent, knockback |
| Ogre | OGRE | Reward tank | FREE on base tier-up. 50 HP, 8 ATK, 2-hex AOE club smash + knockback. Cannot be trained. 1.4x scale, isSiege |

### Magic System — Elemental Status Effects & Combos

**Balance philosophy:** Base spells are weak — only combos chunk. A full combo should ~90% a squishy (8 HP) and ~50% a tank (18 HP). Ablaze burn is negligible alone (1.2 total). Battlemage splash damage is intentionally low (40% multiplier) since he's a setup caster, not DPS.

All magic units (Mage, Battlemage, Healer) cycle through 5 elements: `[FIRE, WATER, LIGHTNING, WIND, EARTH]`. `_elementCycleIndex` on Unit tracks position. Some elements leave status effects that interact with follow-up spells for combo attacks.

**Mage — Single-Target Combo Caster:**
- **Water → Wet** (5s) — drenches target. Sets up Lightning combo.
- **Fire → Ablaze** (4s, 0.3 DPS burn) — weak burn (~1.2 total HP). Just a marker for Wind combo. Base spells are weak!
- **Earth** — raw damage, no status. Safe hit.
- **Wet + Lightning → Electrocute Crit** — consumes Wet, chain lightning arcs to 3 enemies within 3 hex dealing 0.8× attack per chain. THE combo payoff.
- **Ablaze + Wind → Inferno** — consumes Ablaze, 4 burst damage + spreads Ablaze to 3 nearby enemies. combat(~4) + burst(4) = ~8 total = near-kill on squishy.
- **Water + Ablaze → Soothe** (anti-synergy!) — consumes Ablaze, HEALS enemy 3 HP. Accident if you Water a burning target.

**Battlemage — AoE Setup (low damage, big combos):**
- **Water AoE → Wet** — splashes whole group with Wet. Low damage (15% multiplier). Sets up Mage Electrocute on all of them.
- **Wind AoE → Knockup** (1.2s CC) — launches enemies airborne. They can't move or attack. Pure crowd control.
- **Lightning AoE → Arcane** (6s) — purple orbs mark enemies. No damage. But when a Mage's Lightning hits an Arcane target...
- **Arcane + Mage Lightning → Kamehameha** — Mage fires a piercing laser beam through target and up to 4 enemies in a line, dealing 1× attack per pierce. combat(~4) + laser(5) = ~9 total = kills squishy, halves tank. The big cross-class payoff.
- **Fire AoE → Ablaze** — same burn as Mage Fire. Wind follow-up triggers Inferno.
- **Earth AoE** — raw damage, no status.

**Healer — Support Mage:**
- **Heal** — auto-targets most injured ally in range 2, fires healing orb (2 HP per cast).
- **Cleanse** (8s CD) — when no healing needed, removes ALL debuffs from most-debuffed ally. Gives speed boost (1.5×, 2.5s) with golden trail + status immunity (3s "Cleanse Linger"). Whoosh sound + golden VFX.
- Counts as a mage for Arcane Convergence group synergy.

**Cleanse Linger:** After being cleansed, a unit is immune to all status effect applications for the linger duration. Prevents re-application of Wet/Ablaze/Arcane/Knockup.

**Implementation files:**
- `src/game/systems/StatusEffectSystem.ts` — core framework: applyMageElement, applyBattlemageElement, processHealerCleanse, tickStatusEffects, isKnockedUp, getSpeedMultiplier
- Status fields on Unit type: `_statusWet`, `_statusAblaze`, `_ablazeDPS`, `_ablazeSource`, `_statusArcane`, `_knockupUntil`, `_cleanseLinger`, `_cleanseCooldown`, `_speedBoostUntil`, `_speedBoostFactor`
- Config: `GAME_CONFIG.combat.statusEffects.*` — wet, ablaze, electrocuteCrit, inferno, soothe, knockup, arcane, kamehameha, cleanse
- Wired into: CombatEventHandler (projectile impact VFX), CombatSystem.resolve (reserved modifiers), UnitAI.update (burn ticks, knockup skip, cleanse, speed boost)

### Base Tier System
Bases upgrade through 3 tiers based on population count + unique building diversity in the capture zone (5-hex radius):

| Tier | Name | Pop Required | Unique Buildings | Reward |
|------|------|-------------|-----------------|--------|
| 0 | Camp | 0 | 0 | Starting tier |
| 1 | Fort | 30 | 3 | Free Ogre |
| 2 | Castle | 60 | 6 | Free Ogre |

All bases (player + neutral + captured) start as Camp. Neutral bases captured at Camp tier.

### Food Population Cap
Food controls max combat unit count. Workers (Builder, Lumberjack, Villager) are FREE.

- FOOD_PER_COMBAT_UNIT = 2 (every 2 food supports 1 combat unit)
- STARTING_FOOD = 30 (15 combat unit starting cap)
- Pop cap enforced at queue time (SpawnQueueSystem + AIController)
- HUD shows current/cap in resource bar, color-coded (green/orange/red)

Key files: `PopulationSystem.ts`, `BaseUpgradeSystem.ts`, `SpawnQueueSystem.ts` (pop cap checks), `AIController.ts` (AI pop cap)

### Builder Construction System
Player buildings are placed as **blueprints** (transparent, non-functional). A builder unit must walk to the blueprint and construct it (~8 seconds). AI buildings are placed instantly.

- `PlacedBuilding.isBlueprint` / `.constructionProgress` (0..1) / `.assignedBuilderId` — tracks construction state
- `BuildingSystem.advanceConstruction()` — ticks progress, applies visual opacity, fires completion
- `BuildingSystem.applyBlueprintVisual()` / `clearBlueprintVisual()` — transparency transitions
- `UnitAI.handleConstructing()` — builder ticks construction, emits `builder:construct_tick` events
- `UnitAI.findNearestBlueprint()` — idle builders auto-seek unassigned blueprints
- `UnitState.CONSTRUCTING` / `CommandType.CONSTRUCT` — new state/command for builders
- `UnitRenderer.animateConstructing()` — overhead hammer swing animation
- Post-placement hooks (UnitAI positions) fire on completion, not placement
- `getBuildingsOfKind()` filters out blueprints — spawn queues only work from completed buildings

Key files: `BuildingSystem.ts`, `UnitAI.ts` (handleConstructing, findNearestBlueprint), `CombatEventHandler.ts` (construct_tick), `UnitRenderer.ts` (animateConstructing)

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
Unit pathfinding stores the full path as `_path` and current index as `_pathIndex` via `(unit as any)` casts. This is a legacy pattern — the `Unit` interface doesn't include these fields. Same for `_postPosition` (defensive stance return point), `_patrolRoute`, `_patrolIdx`. **Note:** `_squadId` and `_squadSpeed` are properly typed optional fields on the Unit interface (added for squad march system).

### `isTileOccupied` Now Uses `placedBuildings`
The old version checked individual building refs. Now it loops the `placedBuildings` array. This means ALL buildings (player + AI) are checked.

### Barracks Health System
`barracksHealth` Map still exists alongside `PlacedBuilding.health`. The `damageBarracks` method now uses `PlacedBuilding` but still updates the legacy health map for backward compat. Eventually the legacy map should be removed.

### HUD Help Overlay
The help menu is a single giant HTML string in `createHelpOverlay()` in `src/ui/HUD.ts` starting around line 1287. It must be updated manually when gameplay changes. The defensive stance description, Paladin unit, building click tooltip, and archer kiting are features that need to be kept in sync.

### HUD Layout Map — Avoid Overlaps When Adding New UI

The HUD uses absolute/fixed positioning. Before adding any new element, check this map to avoid collisions. All positions reference the game viewport (not the browser window).

```
┌──────────────────────────────────────────────────────────────┐
│  TOP-LEFT              TOP-CENTER            TOP-RIGHT       │
│  Resource bar (P1)     "CUBITOPIA" logo      Enemy resources │
│  top:16 left:16        top:16 center         top:16 right:140│
│  ~540×50  z:10000      ~149×60  z:auto       ~623×50  z:10000│
│                                              ☰ MENU button   │
│                                              top:16 right:16 │
│──────────────────────────────────────────────────────────────│
│  LEFT-BELOW-RESOURCES                 RIGHT-BELOW-RESOURCES  │
│  Terrain info tooltip                 Capture zone cards     │
│  top:80 left:16                       top:64 right:10        │
│  ~180×var  z:10001                    flex-col  z:500        │
│                                                              │
│  Debug panel (backtick)               Selection panel        │
│  top:56 left:16                       (cursor-following)     │
│  ~400×var  z:auto                     z:9999                 │
│                                                              │
│                    MID-CENTER                                │
│                    Notification toast                        │
│                    top:120 center                            │
│                    z:auto                                    │
│                                                              │
│                                                              │
│                                                              │
│                                       RIGHT-MID              │
│                                       Elevation slicer      │
│                                       right:180 bottom:80   │
│                                       ~30×336  z:100        │
│──────────────────────────────────────────────────────────────│
│  BOT-LEFT              BOT-CENTER            BOT-RIGHT       │
│  Action menu           Spawn queue bars      Unit stats panel│
│  bottom:16 left:16     bottom:60 center      bottom:16 right│
│  ~337×167  z:101       ~var  z:auto          ~170×var z:10000│
│                        Wall mode banner                      │
│                        bottom:60 center                      │
│                        z:auto (hidden)                       │
│  Help overlay (? key): full-screen z:300                     │
│  Menu overlay: full-screen z:20000                           │
│  Building tooltips: cursor-following z:9999                  │
└──────────────────────────────────────────────────────────────┘
```

**Z-index layers (from back to front):**
- 50: Stance indicator badges
- 100: Game container, elevation slicer
- 101: Action menu (bottom-left)
- 300: Help overlay (full screen)
- 500: Capture zone cards (top-right)
- 1000: Resource dropdown menus (expand from resource bar)
- 9999: Building/wall/base tooltips (cursor-following)
- 10000: Resource bars (top), unit stats panel (bottom-right), ☰ menu
- 10001: Terrain info tooltip (top-left, below resource bar)
- 20000: Main menu overlay (full screen, above everything)

**Rules for adding new HUD elements:**
1. Check this map for collisions at the intended position
2. Use z-index from the layer list above — pick the right layer for the element type
3. Tooltips that appear on hover should use z:9999+ so they render above persistent panels
4. Persistent panels (always visible) should use z:100-500
5. Resource bars and critical controls use z:10000
6. Test with ALL game modes (Player vs AI has fewer panels than AI vs AI)
7. Test with capture zone cards visible — they stack vertically and can get tall

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

8. **HUD.ts now ~3106 lines**: Continues to grow. The help overlay (~300 lines), stance panel, spawn queue display, capture zone HUD, and selection panel could be extracted into separate files.

9. ~~**main.ts at ~5043 lines**~~ — RESOLVED: Reduced to 3063 lines via InputManager, MapInitializer, RallyPointSystem, InteractionStateMachine extractions + dead code cleanup. Still 63 lines over 3000 target.

10. ~~**UnitRenderer.ts at ~8981 lines**~~ — RESOLVED: Split into 867-line facade + UnitModels.ts (3526), UnitAnimations.ts (2175), ProjectileSystem.ts (1505), UnitVFX.ts (1053).

11. ~~**No chunked voxel meshing**~~ — RESOLVED: VoxelBuilder refactored to 8×8 hex chunks with per-chunk InstancedMesh + dirty flagging.

12. **InstancedMesh for decorations**: Trees, grass tufts, decorations still individual meshes. InstancedObjectManager.ts (292 lines) exists but not yet integrated for all decoration types.

13. ~~**Magic numbers everywhere**~~ — RESOLVED: GameConfig.ts (490 lines) centralizes all balance constants.

14. **DebugPanel.ts at ~1566 lines**: Nearly doubled from 777. The UNITS tab (weapon debug, 3D preview) added significant code. Consider splitting into DebugPanelTools.ts, DebugPanelArmy.ts, DebugPanelUnits.ts.

15. ~~**BoidsSteering.ts has TS errors**~~ — RESOLVED: Deleted BoidsSteering.ts entirely — boids system was never wired in and caused movement problems. Removed boids config from GameConfig.ts.

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

### 2026-04-01: Spawn Building Rotation Bug
`BuildingSystem.getNextSpawnBuilding()` advanced the round-robin index every call. `SpawnQueueSystem` called it once to check existence (line 333) and again to get the spawn position (line 345), causing every spawn to skip a building. Fix: `getNextSpawnBuilding()` now peeks without advancing; new `advanceSpawnIndex()` method called only after a successful spawn.

### 2026-04-01: Debug Kill Button Wiring
The debug panel "Kill" button callback was wired through `main.respawnSelectedUnits()` — a confusingly-named method that actually killed units. Moved the kill logic to `DebugController.killSelected()` where it belongs, and removed the dead method from main.ts (-22 lines).

---

## Current Mission: Architecture Cleanup & Performance

### Status (2026-04-02)
main.ts at **3063 lines** (target <3000, 63 lines over). UnitRenderer.ts split into 867-line facade + 4 subsystem modules. **All 4 architecture goals DONE.** GameConfig.ts (482 lines) centralizes all balance constants. **Performance Goal #1 DONE**: chunked voxel meshing. Title scene cinematic fully operational with real combat VFX, tactical formations, balanced respawn, and healer AI. ProceduralMusic system handles title/gameplay/tutorial music transitions. **Total codebase: ~45,775 lines.**

### Bug Fixes (2026-04-01)
- **Spawn building rotation**: `getNextSpawnBuilding()` was advancing the round-robin index on every call. `SpawnQueueSystem` called it twice per spawn (once to check, once to use), causing frame-rate-dependent building skipping. Fix: `getNextSpawnBuilding()` now peeks without advancing; separate `advanceSpawnIndex()` called after actual spawn.
- **Debug Kill button**: The debug panel "Kill" button was wired to `main.respawnSelectedUnits()` (misnamed). Moved kill logic to `DebugController.killSelected()` and removed the dead method from main.ts.
- **Legacy getter cleanup**: Removed 37 dead ISM backward-compat getters from main.ts (26 mode booleans + 10 rotation getters + 1 comment). InputManager already uses ISM directly.

### Active Goal
Push `src/main.ts` below **3000 lines** (~329 remaining) and split `UnitRenderer.ts` into sub-modules. No new features should be added to main.ts without extracting equivalent or greater code out of it.

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
| `CombatEventHandler.ts` | ~225 | Stateful subsystem (CombatEventOps interface) |
| `SpawnQueueSystem.ts` | ~240 | Stateful subsystem (SpawnQueueOps interface) |

### 2026-04-01 Extractions
| Module | Lines Saved | Pattern |
|--------|-------------|---------|
| `InputManager.ts` | ~1335 | Stateful subsystem (full game ref) |
| `MapInitializer.ts` | ~560 | Stateful subsystem (MapInitOps interface) |
| `RallyPointSystem.ts` | ~229 | Stateful subsystem (RallyPointOps interface) |
| Dead code cleanup | ~200+ | Removed unused getters, wrappers, duplicate constants, stale imports |

### Next Extraction Targets (priority order)
1. **initSystems() helpers** — split into smaller setup methods (~200 lines potential)
2. **DebugController expansion** — move spawnFormationArmy, spawnTestArmies, respawnSelectedUnits (~150 lines)
3. **CameraController** — camera state + updateCamera logic (~200 lines)
4. **Squad indicator rendering** — extract from updateRTS (~200 lines)

### Shrink-Wrap Discipline (RE-ENFORCED 2026-04-01)
**Every feature addition or refactor MUST leave main.ts the same size or smaller.**
- Before adding new code to main.ts, identify what can be extracted to offset it
- New features should be built as standalone modules from the start — never inline first
- If a function in main.ts exceeds ~40 lines, it's a candidate for extraction
- If a group of related fields + methods exceeds ~100 lines, extract as a subsystem
- Review and eliminate dead code, unused imports, and stale backward-compat shims on every pass
- **STATUS: main.ts is 3063 lines (target <3000).** Reduced from 5043 on 2026-04-01 via InputManager (1267), MapInitializer (560), RallyPointSystem (229) extractions + dead code cleanup. ~63 lines remain to reach target.
- **Total codebase: ~45,775 lines across all .ts files.** The 4 largest files (UnitRenderer 938, main 3063, UnitAI 3485, HUD 3121) account for significant portion of code. UnitRenderer split into UnitModels (3526), UnitAnimations (2175), ProjectileSystem (1505), UnitVFX (1053).

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

### CombatEventHandler Integration Notes
- Processes all events from `UnitAI.update()` return value via `processEvents(events)`
- Uses `CombatEventOps` slim interface: unit lifecycle, UnitRenderer facade, audio, HUD, building/wall damage, worker task handlers
- Handles godMode (revives player units), disableCombat flag, all debug flags for worker tasks
- Deferred death: ranged kills set `_pendingKillVisual` flag, resolved on projectile impact callback
- Building damage: non-siege deals 15% (min 1), siege full; walls/gates siege-only
- `cleanup()` not needed — stateless, all state is per-event

### SpawnQueueSystem Integration Notes
- Owns ALL 7 player spawn queues + timers (barracks, forestry, masonry, farmhouse, workshop, armory, wizard_tower)
- `update(delta)` processes timers, checks affordability, deducts resources, spawns units, assigns rally points
- `doSpawnQueueGeneric()` / `doSpawnQueueWorkshop()` / `doSpawnQueueArmory()` / `doSpawnQueueWizardTower()` — queue a unit with validation
- `doSpawnQueue(buildingKey, unitType, unitName, costParts)` — routes to correct queue method
- `queueUnitFromTooltip(unitType, buildingKind)` — handles tooltip-initiated unit queuing
- `getQueueHUDEntries(debugFlags)` — returns formatted entries for HUD display (main.ts combines with AI queues)
- `cleanup()` resets all queues and timers on map regeneration
- Uses `SpawnQueueOps` slim interface: resource get/set, building queries, spawn tile finding, unit creation

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

### GarrisonSystem Integration Notes
- `garrison(units, structureKey)` hides units + adds to slot; `ungarrison(key, exitKey?)` releases at position
- Wall network: BFS over hex-adjacent walls/gates/buildings. `getReachableExits()` returns all connected buildings/gates for exit-pick UI
- `update(delta)` fires ranged attacks from garrisoned units every 2s. Archers/mages do full damage (3), others do 50%
- `onStructureDestroyed(key)` ejects all garrisoned units with 20% HP collapse damage — called from CombatEventHandler when damage returns true
- `cleanup()` on map regeneration — shows all hidden units before clearing
- Garrisoned units have `_garrisoned = true` + `_garrisonKey` on the Unit interface. Skipped in UnitAI.update(), CaptureZoneSystem, and visual position updates
- UnitRenderer.setVisible(id, bool) toggles mesh visibility for garrison hide/show
- Wall/gate click detection added to main.ts terrain-info click handler (raycast against wallMeshes + gateMeshes)
- Exit pick mode: `exitPickMode` flag + `exitPickSourceKey` — entered from tooltip "Exit At..." button, resolved on next hex click
- AI Phase 1.5: AIController auto-garrisons idle archers/mages within 3 hex of friendly gates via `AIGarrisonOps.garrison()`
- Capacity: buildings 10, gates 5, walls 2

### AIController Integration Notes
- Uses `AIBuildingOps` slim interface instead of full BuildingSystem dependency
- `setGarrisonOps()` wired after GarrisonSystem construction (avoids circular init)
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

### Phase 3: Neutral Cities & Gold Economy [PARTIALLY DONE — zone capture implemented]
Capturable map objectives that create contested territory and drive strategic decisions. Introduces the gold resource.

**Zone Control Capture System [DONE]:**
- `CaptureZoneSystem.ts` — standalone system managing zone state, progress, and visuals
- All bases (main + neutral) have a 5-hex radius capture zone
- Capture works via unit majority: the team with more units in the zone makes progress
- Uncontested capture takes ~20 seconds; contested zones see tug-of-war progress bar
- Visual feedback: zone boundary ring in team color, glowing light column, floating progress bar
- Underground layer check: underground bases only count underground units
- Desert Tunnels map has 3 underground neutral outposts: 1 central (large cavern, 300 HP) + 2 side caverns (smaller, 200 HP each)
- **Main base capture = instant defeat** (replaces old damage-to-zero system)
- **Neutral/outpost capture = flip ownership + inherit all buildings/walls in zone**
- Bases are never destroyed — they change flags/teams when captured
- Units with `_playerCommanded` hold position inside enemy zones (5-hex radius check in UnitAI idle)
- `BaseRenderer` still renders castles; health bars are cosmetic (bases no longer take damage)
- Capture events flow through `handleCaptureEvent()` in main.ts

**Neutral City Mechanics (remaining work):**
- Cities spawn at map generation on strategic hexes (crossroads, hilltops, resource-rich areas)
- Start neutral. Must hold zone majority to capture (zone capture system already supports this)
- Can be recaptured by any player — zone control handles this natively
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
- `CaptureZoneSystem.ts` — [DONE] zone state, progress tracking, visuals, capture events
- `CitySystem.ts` — [TODO] city tiers, garrison, income calculation, influence radius
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
