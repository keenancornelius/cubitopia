# Cubitopia — Task Board

**How this works:** Multiple Claude sessions can run in parallel. Each session reads this file, claims a work stream, and marks tasks in-progress. Before editing a file, check that no other stream owns it.

**Rules:**
1. Before starting work, read this file and pick an OPEN stream
2. Mark your stream `[ACTIVE]` and note which session you are (e.g., "Session: combat-polish")
3. Only edit files listed under YOUR stream. If you need a file owned by another stream, coordinate via this file — add a note under "Cross-Stream Requests"
4. When done with a task, mark it `[DONE]` and move to the next
5. When your stream is complete, mark it `[DONE]` and release the files
6. **Every stream ends with a "claim next stream" task.** When you finish all tasks in your stream, mark it [DONE], then claim the next OPEN stream and continue working. Never stop — always loop back into the task board.

**Shared files (touch carefully, small edits only):**
- `src/types/index.ts` — add new types/enums, don't restructure
- `src/game/GameConfig.ts` — add new config sections, don't reorder existing
- `src/game/entities/UnitFactory.ts` — add new unit entries only
- `CLAUDE.md` — update your section's status only

---

## Work Stream A: Combat & Unit AI
**Status:** [ACTIVE] — Session: combat-ai
**Primary files:** `UnitAI.ts`, `CombatSystem.ts`, `CombatEventHandler.ts`, `TacticalGroup.ts`
**Supporting files:** `Pathfinder.ts`

### Tasks
- [x] Ogre ground pound — synced VFX + knockback + whomp to animation via resetAttackAnim
- [x] AI builds on captured bases — onBaseCapture() builds barracks + farmhouse + forestry at outposts
- [x] Seeded PRNG — replaced all game-logic Math.random() with deterministic GameRNG (commit 89f9e84)
- [x] Stance-based movement, QWERT spell queue, squad objectives (commit 1cf4600)
- [ ] AI squad urgency — squads stall and lack pressure, need more aggressive march + engage behavior
- [ ] CommandQueue pattern — decouple input → simulation for multiplayer readiness
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream B: Rendering & VFX
**Status:** [ACTIVE] — Session: rendering-vfx
**Primary files:** `UnitRenderer.ts`, `UnitModels.ts`, `UnitAnimations.ts`, `ProjectileSystem.ts`, `UnitVFX.ts`
**Supporting files:** `InstancedObjectManager.ts`, `Renderer.ts`

### Tasks
- [x] InstancedMesh for trees/grass/decorations — implemented via TerrainDecorator + InstancedObjectManager
- [x] Mesh merge system — draw calls cut from ~7200 to ~1069 (commit 2355724)
- [x] 6 unit model redesigns — layered detail, back detail, ornamentation (commit 0f825d0)
- [x] Ogre/trebuchet model overhaul + terrain tooltips (commit e67ed48)
- [x] Elemental status effect system with combos + crit VFX (commit 98feea6)
- [x] 3D unit portrait thumbnails in help menu (commit 70e1256)
- [x] Kamehameha laser beam VFX — 3-phase effect: charge-up energy convergence → piercing purple beam with triple-layer glow + swirl particles → staggered impact explosions per target
- [x] Chain lightning polish — triple-layer bolt glow, 2-3 forked branches, bright impact flash, animated electric sparks with gravity
- [x] Damage particle enhancement — 6-9 varied-shade particles with drag/gravity, size variation, additive white impact flash burst
- [ ] New unit models for any upcoming unit types
- [x] Performance profiling — assessed: mesh merge already reduces 60→12-18 meshes/unit, particle pool exists, terrain instanced. Main bottleneck is many independent rAF loops for VFX (acceptable for current scale)
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream C: UI & Player Experience
**Status:** OPEN — new tasks added
**Primary files:** `HUD.ts`, `DebugPanel.ts`, `BuildingTooltipController.ts`, `MenuController.ts`, `SelectionManager.ts`, `InputManager.ts`
**Supporting files:** `InteractionStateMachine.ts`, `UITheme.ts`

### Completed
- [x] Unit tooltip PIP — adaptive camera per unit type (large/medium/small), ground plane scaling
- [x] Help menu audit — restored single-page scrollable overlay; replaced emojis with voxel-style CSS blocks
- [x] Win condition UI — game-over battle report with duration, kills, K/D, zones, base tier
- [x] Combat readability — army strength power bar (top-center, color-shifting, 2Hz throttle)
- [x] Map selector polish — terrain icons, size labels, hover glow effects, "coming soon" tags
- [x] UI Theme normalization — new `UITheme.ts` with shared panel/button/overlay builders; all HUD panels, tooltips, menus, mode indicators use unified style (Segoe UI, blue-gray panels, consistent shadows/borders); Modern/Classic skin toggle in main menu

### New Tasks
- [ ] "Working on..." kanban menu — add a "Working on..." button to the main menu (title screen) that opens an overlay showing a visual kanban board of current development progress. Read TASKS.md at build time or bundle it as a static asset. Display work streams as columns (or grouped rows), each task as a card with status (done/in-progress/open), color-coded by stream. Use the existing UITheme.ts panel/button/overlay builders for consistent styling. Should feel like a dev transparency feature — players see what's being built and what's coming next. Keep it read-only, no interactivity beyond scroll and close.
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream D: Economy & Buildings
**Status:** [ACTIVE] — Session: food-wall-polish
**Primary files:** `ResourceManager.ts`, `BuildingSystem.ts`, `BuildingMeshFactory.ts`, `DefenseMeshFactory.ts`, `SpawnQueueSystem.ts`, `BaseUpgradeSystem.ts`, `PopulationSystem.ts`
**Supporting files:** `BlueprintSystem.ts`, `GarrisonSystem.ts`, `WallSystem.ts`

### Tasks
- [x] Food system polish — rebalanced to 2 food/unit (was 3), fixed startingFood config mismatch, base tier bonus food, richer HUD pop display with food→cap context, better "at cap" spawn messages
- [x] Wall rework — damage visuals (darkening/cracks/red glow), health bars, debris VFX, drag cost preview, garrison rework (walls=connectors, gates=entry/exit), exit picker with pill type filters, wall/gate demolish button
- [ ] Lumberjack rework — improve gathering behavior and forestry building value
- [ ] City tiers (Phase 3) — Village → Town → City progression
- [ ] Gold economy — income, expenses, trade routes
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream E: Map Generation & Game Modes
**Status:** [ACTIVE] — Session: map-gen-variety
**Primary files:** `MapPresets.ts`, `MapInitializer.ts`, `NatureSystem.ts`, `CaptureZoneSystem.ts`
**Supporting files:** `VoxelBuilder` (in Renderer)

### Tasks
- [x] Arena spawn symmetry — angular distribution formula for any player count
- [x] New map types — VOLCANIC PASS (chokepoints) + FROZEN WASTE (resource-scarce)
- [x] Neutral city placement — strategic scoring (balance, centrality, chokepoints, resources)
- [x] Map variety — wired MAP_GEN_PARAMS into MapGenerator so each type uses distinct terrain params
- [x] SKYLAND map — floating cloud islands + rainbow bridges + custom cloud void shader
- [x] Fixed arena instant-win bug (army spawn used hardcoded positions)
- [x] Enabled all map types in title screen menu
- [ ] Skyland playtest iteration — island sizes, bridge lengths, resource balance tuning
- [ ] Volcanic/Tundra custom generators (currently use param-tweaked standard gen)
- [ ] Per-map lighting/fog presets (Skyland brighter, Tundra grey, Volcanic warm)
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream F: Audio & Music
**Status:** OPEN
**Primary files:** `SoundManager.ts`, `ProceduralMusic.ts`
**Supporting files:** none

### Tasks
- [ ] Sound coverage audit — ensure every interaction has audio feedback
- [ ] Music transitions — smooth crossfades between combat/exploration/menu
- [ ] Ambient sound layer — wind, birds, distant combat sounds
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream G: Multiplayer Launch (Reddit Playtest)
**Status:** OPEN
**Primary files:** `src/network/` (all files), `src/ui/MultiplayerUI.ts`, `src/game/PlayerConfig.ts`
**Supporting files:** `main.ts`, `MenuController.ts`, `CommandQueue.ts`, `GameConfig.ts`

_Goal: Get multiplayer working well enough for a Reddit r/indiegaming + r/playmygame launch where strangers can 1v1 each other._

### Phase 1: Infrastructure (must-do first)
- [ ] Create Firebase project (cubitopia-alpha) — Realtime Database + Anonymous Auth + security rules
- [ ] Replace PLACEHOLDER_API_KEY in FirebaseConfig.ts with real credentials
- [ ] Wire MultiplayerController into main.ts game loop — connect command queue to simulation tick
- [ ] Wire MultiplayerUI into MenuController — "Multiplayer" button on title screen → lobby flow
- [ ] End-to-end smoke test — two browser tabs, find match → connect → play → result screen

### Phase 2: Game Integration
- [ ] Hook all player inputs through CommandQueue when in multiplayer mode (move, attack, build, spell)
- [ ] Deterministic simulation audit — find and fix any remaining non-deterministic code paths (animation-driven state, frame-dependent logic)
- [ ] Desync detection + recovery — state hash mismatch handling (pause + resync or graceful disconnect)
- [ ] Turn timer / disconnect handling — if opponent drops, award win after timeout
- [ ] Spectator-safe game over — both clients agree on win condition simultaneously

### Phase 3: Polish for Public Launch
- [ ] Reddit username registration flow — clean onboarding, no friction
- [ ] Leaderboard display — top 25 by ELO, player's own rank visible
- [ ] Match result screen — ELO change animation, rematch button, back to lobby
- [ ] Loading/connecting UX — progress indicators, "opponent found" flash, connection quality indicator
- [ ] Deploy to production URL (GitHub Pages or similar) — playable link for Reddit post

### Phase 4: Launch Prep
- [ ] Playtest solo — run 5+ full matches against ghost AI opponents to verify stability
- [ ] Write Reddit post draft — title, screenshots/gif, description, link, feedback request
- [ ] Set up feedback channel — Discord server or Google Form linked from in-game
- [ ] Rate limiting / abuse prevention — Firebase rules cap writes, basic anti-cheat on ELO
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream H: Codebase Efficiency Refactors
**Status:** OPEN
**Primary files:** `UnitModels.ts`, `UnitAnimations.ts`, `main.ts`, `UnitAI.ts`, `SpawnQueueSystem.ts`, `CombatEventHandler.ts`, `BuildingMeshFactory.ts`, `InputManager.ts`
**Supporting files:** `BaseRenderer.ts`, `MeshMergeUtils.ts`, `ResourceManager.ts`
_Note: Some files overlap with Streams B and D. Run after those complete, or coordinate via Cross-Stream Requests._

### Priority: CRITICAL
- [ ] Material cache consolidation — route all 340 `new MeshLambertMaterial()` in UnitModels.ts through existing `_matCache` in BaseRenderer/MeshMergeUtils. Eliminates hundreds of GPU material objects. (~30% line reduction, major GPU memory savings)

### Priority: HIGH
- [ ] Resource stockpile refactor — replace 11 per-player arrays + 22 getter/setter closures in main.ts with `ResourcePool` class. Collapse ResourceManager's 7 identical `handleXxxDeposit` methods into one. (~200 lines from main.ts, ~60 from ResourceManager)
- [ ] UnitAI static state extraction — move 20+ static Maps/Sets (`claimedTrees`, `farmPatches`, `wallsBuilt`, etc.) into a `SharedGameState` context object with dependency injection. Unblocks multiplayer serialization + unit testing.
- [ ] UnitModels composable builder — replace 4,700-line switch statement with data-driven part declarations + shared builder helpers. (~68% reduction, 4700→~1500 lines, dramatically faster new unit iteration)

### Priority: MEDIUM
- [ ] hexDist deduplication — extract to `HexMath` utility module (currently duplicated across 9 files)
- [ ] UnitAnimations phase helper — extract `phaseAnimation(progress, phases)` + named easing utilities to eliminate duplicated threshold/easing logic across 15 unit types. (~45% reduction)
- [ ] InputManager type safety — replace `type Cubitopia = any` with proper `GameOps` slim interface (pattern already exists in codebase)
- [ ] SpawnQueueSystem consolidation — merge 4 duplicate `doSpawnQueue*` validation chains into single `validateAndQueue(config)`. (~80 lines saved)
- [ ] SpawnQueueSystem per-frame allocation — cache `spawnConfigs[]` array instead of rebuilding 7+ closures every frame
- [ ] CombatEventHandler callback flattening — extract `ElementalImpactHandler` to replace 3-4 layers of nested mage impact callbacks

### Priority: LOW
- [ ] BuildingMeshFactory composable builder — same approach as UnitModels, extract common foundation+walls+roof+trim patterns (~1,987 lines)
- [ ] Unreachable cache memory leak — add periodic `pruneUnreachableCache()` + remove dead unit entries in `UnitAI.unreachableCache`
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Cross-Stream Requests
_Add requests here when you need a change in another stream's files._

| Requesting Stream | Target Stream | File | What's Needed | Status |
|---|---|---|---|---|
| (example) | B | UnitModels.ts | Add ogre ground-pound mesh name | OPEN |

---

## Recently Completed
- [x] Seeded PRNG (GameRNG) — all game-logic Math.random() replaced (89f9e84)
- [x] Phase 5 multiplayer plan — WebRTC P2P, Firebase, ELO, ghost players (dd23846)
- [x] Music genres renamed to tribe names — Stoneguard, Wildborne, Arcanists, Tidecallers (3009e46)
- [x] Stance-based movement, QWERT spell queue, squad objectives (1cf4600)
- [x] Full elemental status effect system with combos + crit VFX (98feea6)
- [x] 3D unit portrait thumbnails in help menu (70e1256)
- [x] Fix team kill totals dropping when units with kills die (c7c07a6)
- [x] Waterfall particle count reduction for draw call savings (a1ac6f1)
- [x] Mesh merge system — draw calls ~7200→~1069 (2355724)
- [x] 6 unit model redesigns to match design philosophy (0f825d0)
- [x] Ogre/trebuchet model overhaul + jungle harvestable (e67ed48)
- [x] Rally point fix — missing setRallyPoint method + base rally support (789eb8c)
- [x] Remove dead BoidsSteering system (071b4ab)
- [x] Ogre melee attack path (was using ranged arrow) — fixed isRangedAttack check
- [x] Ogre ground pound VFX — 4-phase dust/debris effect in ProjectileSystem
- [x] Ogre _pendingRangedDeath fix — ogre no longer defers death like ranged units
- [x] Ogre whomp sound — dedicated 6-layer sub-bass shockwave synth
- [x] PIP camera tooltip system — unit preview in tooltip with cinematic camera
- [x] Box-select tooltip conflict fix — wasBoxSelecting flag
- [x] WebGL context exhaustion fix — WEBGL_lose_context cleanup
- [x] Base tier system — Camp/Fort/Castle at pop 30/60/90 + building count
- [x] Food population cap — 2 food per combat unit
- [x] Garrison rework — walls are fast-travel connectors, gates are entry/exit points, type-filtered ungarrison with pill UI
- [x] Wall/gate demolish — X key or button to demolish with stone refund
- [x] Wall damage visuals — darkening, crack overlays, health bars, destruction debris VFX
- [x] Food balance polish — config-driven startingFood, base tier bonus, food→cap HUD display
