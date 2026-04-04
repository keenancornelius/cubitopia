# Cubitopia — Task Board

**⚠️ SESSION INSTRUCTIONS — DO THIS NOW, NO EXCEPTIONS:**
1. **Read `CLAUDE.md` first** — it has architecture, coding standards, and project context you NEED
2. **DO NOT use AskUserQuestion** — it is broken and will crash your session
3. **DO NOT ask for clarification** — just do the work
4. **DO NOT run git add/commit/push** — commits are batched by the project manager
5. **🐛 CHECK BUGS FIRST — if there are ANY unchecked `[ ]` items in the BUG TRACKER section below, fix those BEFORE touching any work stream. Bugs ALWAYS take priority. No exceptions.**
6. **"Next task" = check bugs first, then find the next `[ ]` checkbox in work streams**
7. Scan the streams below. Find the first OPEN or ACTIVE stream with `[ ]` tasks remaining
8. If it's OPEN, mark it `[ACTIVE]` with your session name
9. Do the next unchecked `[ ]` task. When done, mark it `[x]` and move on
10. When all tasks in a stream are done, mark it `[DONE]` and claim the next OPEN stream
11. **Never stop. Never ask. Just read CLAUDE.md, then this file, then execute.**

**Shared files (touch carefully, small edits only):**
- `src/types/index.ts` — add new types/enums, don't restructure
- `src/game/GameConfig.ts` — add new config sections, don't reorder existing
- `src/game/entities/UnitFactory.ts` — add new unit entries only
- `CLAUDE.md` — update your section's status only

---

## 🐛 BUG TRACKER — FIX THESE FIRST
**All sessions MUST check this section before starting any work stream. If there are unchecked bugs, fix them before doing anything else. Bugs never build up.**

**Sessions: if you encounter a bug while working (build failure, runtime error, broken feature, visual glitch), add it here as a new `[ ]` item with a description. Then fix it immediately before continuing your task.**

- [x] **Tundra/Frozen Waste terrain too thin** — Root cause: `generateTundraMap` was missing the `computeShellBlocks` call that all other custom generators (Arena, Desert, Skyland) use to give terrain proper underground depth (from y=-10 up to surface). Tundra voxels only filled from y=0, creating paper-thin terrain. Fix: added `shellGen.computeShellBlocks(tundraMap, size, size)` before return. The existing `reskinTundra` in MapInitializer correctly swaps the standard GRASS/DIRT blocks back to PACKED_SNOW/FROZEN_DIRT.

---

## Work Stream A: Combat & Unit AI
**Status:** [ACTIVE] — Session: multiplayer-determinism
**Primary files:** `UnitAI.ts`, `CombatSystem.ts`, `CombatEventHandler.ts`, `TacticalGroup.ts`, `AIController.ts`
**Supporting files:** `Pathfinder.ts`, `UnitAnimations.ts`, `UnitVFX.ts`, `UnitModels.ts`, `UnitFactory.ts`

### Completed
- [x] Ogre ground pound — synced VFX + knockback + whomp to animation via resetAttackAnim
- [x] AI builds on captured bases — onBaseCapture() builds barracks + farmhouse + forestry at outposts
- [x] Seeded PRNG — replaced all game-logic Math.random() with deterministic GameRNG (commit 89f9e84)
- [x] Stance-based movement, QWERT spell queue, squad objectives (commit 1cf4600)
- [x] AI squad urgency — relaxed leash thresholds, faster march speed, quicker stall detection
- [x] CommandQueue pattern — CommandBridge.ts processes NetworkCommands, all player inputs routed through commandQueue.enqueue()

### New Tasks — AI Behavior
- [x] AI squad spread fix — tightened formation cohesion: march speed now uses 20th percentile (was 40th) with 0.35 catchup factor (was 0.5), individual assignment uses 15th percentile (was 25th). Leash tightened to 3.0 units (was 6.0) with 45% floor (was 65%) in march phase, 2.0 units (was 3.5) with 35% floor (was 55%) in approach. Leash now active during deployment too (was disabled)
- [x] AI building delay — changed cascading `if (st.buildPhase === N)` to `else if` chain so only ONE building blueprint is placed per economyTick (3 seconds). Previously all 9 phases could cascade in a single tick when resources were available
- [x] Fix arena spawning — rewrote spawnArmy to use vector math: computes normalized forward (base→center) and lateral (perpendicular) vectors, places depth rows as parallel lines along lateral axis. All players' formations are now mirror-symmetric around the arena center. Works for any player count via angular base placement

### New Tasks — Combat & Unit Progression
- [ ] Red bleed effect — lingering red particle/tint effect on damaged units that persists for the rest of the fight. Visual indicator of wounded units
- [ ] Secondary melee attack animations — (1) Power sword: green glow charge-up, unleash spin attack while lunging forward. (2) Jump attack strikes. (3) Paladin charge: fast straight-line sprint with blue force field effect (spell shield), white light burst on arrival, rally status effect gives nearby friendlies speed boost + spell shield
- [ ] Unit level-up visuals — on level up: slight size increase, armor badge upgrades, fancier helmets, captain-tier color schemes and armor unique to each unit type
- [ ] Archer level-up bonus — fires a second arrow on first level-up
- [ ] Greatsword level-up bonus — gains horizontal sweep attack animation with chance for big crit if it hits 4+ enemies at once
- [ ] Champion unit (Tier 3 base reward) — replace current tier 3 reward. Over-the-top white armor with gold feather-brimmed crew helm, detailed form-fitting fighting armor, giant war hammer. Comically exaggerated muscular proportions (wide shoulders, thin waist, strong arms). Design second attack pattern for war hammer. Build model in UnitModels.ts, all 4 animation sets, add to UnitFactory
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream B: Rendering & VFX
**Status:** [ACTIVE] — Session: rendering-vfx-2
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
- [ ] Cubitopia title screen text — replace plain text with pixel art high-detail lettering decorated with game-asset-inspired art (voxel blocks, swords, shields, crystals woven into the letterforms)
- [ ] Garrison turret visuals — (1) Arrow hail: garrisoned ranged units produce a visible hail of arrows from building ramps that scales with number of garrisoned units. (2) Cannon turret: add a visible cannon mesh on gates/towers that swivels to track targets and fires with projectile + smoke VFX. Both should make garrisons feel powerful and visually exciting
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream C: UI & Player Experience
**Status:** [ACTIVE] — Session: rendering-vfx-2
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
- [x] "Working on..." kanban menu — DevKanban.ts parses TASKS.md via Vite ?raw import, renders visual kanban board overlay with stream columns, progress bars, color-coded task cards, Escape to close. Button added to MenuController title screen.
- [ ] Kanban layout rework — rework DevKanban.ts layout: (1) **Horizontal scroll:** streams should be displayed as horizontal columns side-by-side (not stacked vertically), with the entire kanban scrollable left/right via mouse wheel or drag. Each stream is a column card. (2) **Auto-minimize completed tasks:** completed `[x]` tasks in each stream column should be collapsed/minimized by default — show just a count like "6 completed" with a small expand toggle. Only open `[ ]` tasks show as full cards. This keeps the focus on what's in progress and upcoming. (3) **Feature voting:** each open/in-progress task card gets a clickable upvote button. Vote counts stored in Firebase under `/feature-votes/{taskHash}` using anonymous auth. Display vote count on each card, sorted by votes within each stream. One vote per user per feature (localStorage to prevent double-voting). (4) **Suggestion box:** text input field at the bottom of the kanban overlay labeled "Suggest a feature" with submit button. Submissions saved to Firebase `/feature-suggestions/{pushId}` with timestamp + anonymous uid. "Thanks!" confirmation flash on submit. Keep consistent with UITheme.ts.
- [ ] Rally to existing squad — from building tooltip, add a "Rally to Squad" button that sends newly spawned units to reinforce an existing squad instead of just a rally point. Squad picker dropdown or click-to-select on map
- [ ] Normalize building tooltips — make building tooltips visually consistent with unit/terrain tooltips (same panel style, layout, fonts via UITheme.ts). Standardize info display across all building types
- [ ] Building tooltip hotkeys — QWERTY hotkeys should work from inside building tooltip for unit spawning. Add visible keybinds for rally (R?), demolish (X), garrison (G). Match the same hotkey patterns used elsewhere in the game
- [ ] Enemy tooltips — show tooltips for enemy units and enemy buildings on hover/click. Display relevant info (unit type, health, level, building type, garrison count) without revealing hidden info. Use same tooltip style as friendly tooltips
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream D: Economy & Buildings
**Status:** [ACTIVE] — Session: food-wall-polish
**Primary files:** `ResourceManager.ts`, `BuildingSystem.ts`, `BuildingMeshFactory.ts`, `DefenseMeshFactory.ts`, `SpawnQueueSystem.ts`, `BaseUpgradeSystem.ts`, `PopulationSystem.ts`
**Supporting files:** `BlueprintSystem.ts`, `GarrisonSystem.ts`, `WallSystem.ts`

### Tasks
- [x] Food system polish — rebalanced to 2 food/unit (was 3), fixed startingFood config mismatch, base tier bonus food, richer HUD pop display with food→cap context, better "at cap" spawn messages
- [x] Wall rework — damage visuals (darkening/cracks/red glow), health bars, debris VFX, drag cost preview, garrison rework (walls=connectors, gates=entry/exit), exit picker with pill type filters, wall/gate demolish button
- [x] Lumberjack rework — Phase 1: forestry aura, passive trickle, worker spread scoring. Phase 2: multi-chop (chop until carry full), forestry drop-off (nearest forestry > base), stat buffs (HP 10, speed 1.6, carry 8, cooldown 2s), auto-replant (all chopped tiles regrow)
- [ ] Farmhouse/food audit — understand what farmhouses, farms, and crops actually do in current code. Food doesn't feel impactful. Rework so food has clear strategic weight — either make running out punishing (units desert? morale debuff? can't heal?) or make surplus rewarding (faster spawns? bigger pop cap jumps?). Document findings and changes
- [ ] Garrison damage balance — audit how garrison combat works for melee vs ranged. Do all garrisoned units do the same damage? Do more garrisoned units increase damage per shot? Rebalance so garrison count meaningfully scales damage output. Coordinate with Stream B for turret visuals (arrow hail + cannon)
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
- [ ] Remove Volcanic Pass → add RIVER CROSSING map — delete Volcanic Pass from MapPresets.ts, MapGenerator, and title screen menu. Replace with RIVER CROSSING: a map bisected by a wide river with limited bridge crossings. Players start on opposite banks. Bridges are natural chokepoints — control the crossings to control the map. River should be impassable terrain (water hexes), bridges are narrow land corridors (2-3 hexes wide). Neutral bases on both banks and on bridge islands. Resource distribution encourages crossing (e.g., iron-heavy on one side, wood-heavy on the other). Custom generator should place river procedurally with 2-4 bridge crossings depending on map size
- [ ] Skyland playtest iteration — island sizes, bridge lengths, resource balance tuning
- [ ] Tundra custom generator (currently uses param-tweaked standard gen)
- [ ] Per-map lighting/fog presets (Skyland brighter, Tundra grey)
- [ ] FFA neutral base balance — more neutral bases in FFA mode, evenly distributed for 4-player balance. Each player should have roughly equal access to capturable territory. Tighten placement scoring for symmetry
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream F: Audio & Music
**Status:** [ACTIVE] — Session: rendering-vfx
**Primary files:** `SoundManager.ts`, `ProceduralMusic.ts`
**Supporting files:** none

### Tasks
- [x] Sound coverage audit — identified 17+ missing sounds, 5 unused defined sounds, 1 type bug
- [x] Added 14 new synthesized sounds: victory, defeat, zone_captured, tier_upgrade, wall_build, wall_destroy, resource_wood, resource_stone, resource_food, garrison_enter, garrison_exit, combo_electrocute, combo_inferno, combo_kamehameha
- [x] Music transitions — already implemented (crossfadeTo with 2s CROSSFADE_TIME, combat intensity trigger)
- [x] Ambient sound layer — wind (LFO-modulated filtered noise), bird chirps (intermittent synthesized calls), distant combat rumble (intensity-driven). API: startAmbient()/stopAmbient()/setAmbientCombatIntensity()
- [ ] Tribe music composition — **HIGH PRIORITY** — write music prompts and lyrics for each tribe's 11 songs: 1 title theme, 1 tutorial theme, 3 peaceful, 3 exploration, 3 combat. Each tribe (Stoneguard, Wildborne, Arcanists, Tidecallers + 5 TBA) should have a distinct musical identity. Output as a structured document (markdown or similar) with prompt text, mood descriptions, instrument palette, tempo, and lyrics for each song. James needs these prompts to plug into AI music generation tools. Save to `docs/TRIBE_MUSIC_PROMPTS.md`
- [ ] Wire new sounds into game systems (requires cross-stream coordination — see requests below)
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream G: Multiplayer Launch (Reddit Playtest)
**Status:** [ACTIVE] — Session: command-queue-wiring
**Primary files:** `src/network/` (all files), `src/ui/MultiplayerUI.ts`, `src/game/PlayerConfig.ts`
**Supporting files:** `main.ts`, `MenuController.ts`, `CommandQueue.ts`, `GameConfig.ts`

_Goal: Get multiplayer working well enough for a Reddit r/indiegaming + r/playmygame launch where strangers can 1v1 each other._

### Phase 1: Infrastructure (must-do first)
- [ ] Create Firebase project (cubitopia-alpha) — Realtime Database + Anonymous Auth + security rules
- [ ] Replace PLACEHOLDER_API_KEY in FirebaseConfig.ts with real credentials
- [x] Wire MultiplayerController into main.ts game loop — connect command queue to simulation tick (processTick() at 10Hz in updateRTS, initMultiplayer on match start, event listeners for disconnect/desync, match result reporting on game-over)
- [x] Wire MultiplayerUI into MenuController — "Multiplayer" button on title screen → lobby flow (already wired: MenuController.onMultiplayer → initMultiplayerUI → showRegistration, onStartMultiplayerGame reinits command queue for MP mode)
- [ ] End-to-end smoke test — two browser tabs, find match → connect → play → result screen

### Phase 2: Game Integration
- [x] Hook all player inputs through CommandQueue when in multiplayer mode (move, attack, build, spell) — completed in Stream A (16 enqueueCommand call sites across main.ts + InputManager.ts)
- [x] Deterministic simulation audit — replaced all Date.now()/performance.now() in game logic with deterministic gameFrame counter (~60fps). Fixed: UnitAI (pathfind cache, repath throttle, slow/chase debuffs), StatusEffectSystem (all elemental durations), CombatEventHandler (HV cascade stun, berserker slow), LifecycleUpdater (dead cleanup). Added UnitAI.gameFrame + GameContext.gameFrame
- [x] Desync detection + recovery — wired setStateHashProvider in main.ts (hashes unit positions/HP/state + player resources via CRC32, compared every HASH_CHECK_INTERVAL ticks). Desync triggers HUD warning notification. CommandQueue already handles hash comparison + _desynced flag
- [x] Turn timer / disconnect handling — wired onOpponentDisconnect event in initMultiplayerUI: shows "Opponent disconnected" notification, awards win via reportMatchResult(true), triggers game-over screen. NetworkManager fires onDisconnect on WebRTC peer close → MultiplayerController → game handler
- [x] Spectator-safe game over — both clients agree deterministically (capture events via CommandQueue lockstep). Fixed isVictory to use localOwner (host=0, guest=1) instead of hardcoded 0. Winner name shows opponent name in MP

### Phase 3: Polish for Public Launch
- [x] Reddit username registration flow — already built in MultiplayerUI.showRegistration(): text input, validation (2-24 chars, alphanumeric), localStorage persistence, "ENTER ARENA" button → mp.initialize(), Back button
- [x] Leaderboard display — already built in MultiplayerUI.showLeaderboard(): top 25 by ELO, player's own rank highlighted, fetches from Firebase via getLeaderboard()
- [x] Match result screen — already built in MultiplayerUI.showMatchResult(): VICTORY/DEFEAT title, ELO change display, rematch + lobby buttons
- [x] Loading/connecting UX — already built in MultiplayerUI.showSearching(): animated search timer, "opponent found" flash, cancel button. Connection handled by MultiplayerController state machine
- [ ] Deploy to production URL (GitHub Pages or similar) — playable link for Reddit post

### Phase 4: Launch Prep
- [ ] Playtest solo — run 5+ full matches against ghost AI opponents to verify stability
- [ ] Write Reddit post draft — title, screenshots/gif, description, link, feedback request
- [ ] Set up feedback channel — Discord server or Google Form linked from in-game
- [ ] Rate limiting / abuse prevention — Firebase rules cap writes, basic anti-cheat on ELO
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream H: Codebase Efficiency Refactors
**Status:** [ACTIVE] — Session: ui-kanban
**Primary files:** `UnitModels.ts`, `UnitAnimations.ts`, `main.ts`, `UnitAI.ts`, `SpawnQueueSystem.ts`, `CombatEventHandler.ts`, `BuildingMeshFactory.ts`, `InputManager.ts`
**Supporting files:** `BaseRenderer.ts`, `MeshMergeUtils.ts`, `ResourceManager.ts`
_Note: Some files overlap with Streams B and D. Run after those complete, or coordinate via Cross-Stream Requests._

### Priority: CRITICAL
- [x] Material cache consolidation — 333 MeshLambertMaterial + 9 MeshBasicMaterial now use getCachedLambert/getCachedBasic from MeshMergeUtils. Only 7 emissive materials remain as new instances. Major GPU memory savings.

### Priority: HIGH
- [ ] Resource stockpile refactor — replace 11 per-player arrays + 22 getter/setter closures in main.ts with `ResourcePool` class. Collapse ResourceManager's 7 identical `handleXxxDeposit` methods into one. (~200 lines from main.ts, ~60 from ResourceManager)
- [ ] UnitAI static state extraction — move 20+ static Maps/Sets (`claimedTrees`, `farmPatches`, `wallsBuilt`, etc.) into a `SharedGameState` context object with dependency injection. Unblocks multiplayer serialization + unit testing.
- [ ] UnitModels composable builder — replace 4,700-line switch statement with data-driven part declarations + shared builder helpers. (~68% reduction, 4700→~1500 lines, dramatically faster new unit iteration)

### Priority: MEDIUM
- [x] hexDist deduplication — created `src/game/HexMath.ts` with `hexDist`, `hexDistQR`, `hexDistFromDeltas`. Migrated TitleScene.ts + main.ts. Cross-stream requests filed for remaining 5 files (Streams A, E).
- [ ] UnitAnimations phase helper — extract `phaseAnimation(progress, phases)` + named easing utilities to eliminate duplicated threshold/easing logic across 15 unit types. (~45% reduction)
- [ ] InputManager type safety — requires decomposing main.ts further first (80+ private member accesses). Deferred until main.ts shrinks more.
- [ ] SpawnQueueSystem consolidation — merge 4 duplicate `doSpawnQueue*` validation chains into single `validateAndQueue(config)`. (~80 lines saved). Deferred — validation differences are real, savings modest.
- [x] SpawnQueueSystem per-frame allocation — cached `spawnConfigs[]` via `getSpawnConfigs()` lazy builder. 7+ closure allocations eliminated per frame. Invalidated on `cleanup()`.
- [ ] CombatEventHandler callback flattening — extract `ElementalImpactHandler` to replace 3-4 layers of nested mage impact callbacks

### Priority: LOW
- [ ] BuildingMeshFactory composable builder — same approach as UnitModels, extract common foundation+walls+roof+trim patterns (~1,987 lines)
- [ ] Unreachable cache memory leak — add periodic `pruneUnreachableCache()` + remove dead unit entries in `UnitAI.unreachableCache`
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream I: Tribe Skins & Faction System
**Status:** OPEN
**Primary files:** `UnitModels.ts`, `UnitAnimations.ts`, `MenuController.ts`, `GameConfig.ts`, `UnitFactory.ts`
**Supporting files:** `ProceduralMusic.ts`, `UITheme.ts`, `TitleScene.ts`

_Goal: Activate the tribe selector buttons already in the menu. Each tribe gets a unique visual identity — different unit color palettes, model variations, and building styles. This is the foundation for Stripe cosmetic monetization._

### Tasks
- [ ] Tribe data architecture — create `TribeConfig.ts` with a data-driven tribe definition: id, name, color palette (primary, secondary, accent, trim), unit model overrides (helm style, armor style, weapon variants), building style tag, music genre key. All 9 tribes: Stoneguard, Wildborne, Arcanists, Tidecallers + 5 TBA
- [ ] Activate tribe selector — wire the existing tribe buttons in MenuController to actually set the player's tribe. Pass tribe config through to UnitFactory and UnitModels so units spawn with tribe-specific colors and model variants
- [ ] Stoneguard skin — first tribe implementation. Grey/blue stone-themed palette, heavy angular armor, hammer/axe weapon variants, fortress-style buildings. Validate the full pipeline from selector → config → models → in-game
- [ ] Wildborne skin — green/brown nature-themed palette, organic curved armor with leaf/vine motifs, bow/staff weapon variants, treehouse-style buildings
- [ ] Arcanists skin — purple/gold magic-themed palette, robed units with crystal/rune ornamentation, staff/orb weapon variants, tower-style buildings with floating elements
- [ ] Tidecallers skin — teal/white ocean-themed palette, fluid armor with coral/shell details, trident/wave weapon variants, dome-style buildings
- [ ] Design remaining 5 tribes — concept and name the 5 TBA tribes, define their palettes, themes, and distinguishing features
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Cross-Stream Requests
_Add requests here when you need a change in another stream's files._

| Requesting Stream | Target Stream | File | What's Needed | Status |
|---|---|---|---|---|
| (example) | B | UnitModels.ts | Add ogre ground-pound mesh name | OPEN |
| H | A | CombatSystem.ts, TacticalGroup.ts, CombatEventHandler.ts, StatusEffectSystem.ts | Replace local `hexDist` with `import { hexDist, hexDistQR } from '../HexMath'` — utility created in `src/game/HexMath.ts` | OPEN |
| H | E | MapInitializer.ts | Replace inline hexDist lambda with `import { hexDistFromDeltas } from '../HexMath'` | OPEN |
| F | D | WallSystem.ts | Add `ops.playSound('wall_build')` on wall construction, `ops.playSound('wall_destroy')` on wall destruction | OPEN |
| F | D | GarrisonSystem.ts | Add `ops.playSound('garrison_enter')` on unit garrison, `ops.playSound('garrison_exit')` on ungarrison | OPEN |
| F | D | ResourceManager.ts | Add `ops.playSound('resource_wood'/'resource_stone'/'resource_food')` on deposit | OPEN |
| F | D | BaseUpgradeSystem.ts | Replace `queue_confirm` with `ops.playSound('tier_upgrade')` on base tier-up | OPEN |
| F | E | CaptureZoneSystem.ts | Add `ops.playSound('zone_captured')` on capture flip event | OPEN |
| F | A | CombatEventHandler.ts | Add `ops.playSound('combo_electrocute'/'combo_inferno'/'combo_kamehameha')` on elemental combo triggers | OPEN |
| F | H | main.ts | Call `soundManager.startAmbient()` on game start, `soundManager.stopAmbient()` on game end, `soundManager.setAmbientCombatIntensity(n)` per-frame based on active combats. Add `playSound('victory')` / `playSound('defeat')` on game over. | OPEN |

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
