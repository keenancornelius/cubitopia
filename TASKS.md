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

- [x] **Tundra/Frozen Waste terrain too thin** — Prior fix added `computeShellBlocks` but terrain was still visually thin due to low elevation values (min 2, typical 3-5). Shell blocks fill from y=-10 but visible terrain above y=0 was only 2-5 blocks. Fix: raised elevation formula from `baseElev*5 + ridge*4 + 2` (range 2-10) to `baseElev*5 + ridge*4 + 5` (range 5-12), updated terrain type thresholds to match. Frozen lakes raised from elev 2→5 with proper sub-layers. Added WATER→ICE to `reskinTundra` swap table so frozen lake surfaces render as ice instead of being skipped as water.
- [x] **BUG: All units bright red — team colors broken** — Root cause: `applyBleedTint()` and `applyLevelUpVisuals()` in UnitVFX.ts were mutating shared cached materials from getCachedLambert(). When one unit took damage, the blood-red tint propagated to ALL units sharing that material color. Fix: both methods now clone the material (`child.material = child.material.clone()`) before modifying color/emissive, keeping tints local to the individual unit.
- [x] **BUG: Score tracker / power bar missing** — Power bar was hidden by localStorage minimize state (`cubitopia_minimized.armyBar = true`). Fix: `loadMinimizedStates()` now deletes the `armyBar` key on load, ensuring the army power bar always starts expanded as a critical gameplay indicator.
- [x] **BUG: FFA mode — other teams' resource bars not visible** — Root cause: `updateEnemyResources` in main.ts only read stockpile indices `[1]` (player 1), ignoring players 2 and 3. Fix: added `updateFfaEnemyResources()` method in HUD.ts that renders a compact multi-row opponent panel (color dot + name + wood/stone/iron/crystal/food/gold/units per enemy). main.ts now branches: 2-player uses the original single enemy bar, FFA (playerCount > 2) loops all enemy players and calls the new FFA method. `resetFfaEnemyBar()` called on new game to handle mode switching.
- [x] **BUG: Arena walls wildly warped/arched** — Two root causes: (1) arena wall ring selection (`ringDist < 0.8`) grabbed tiles from adjacent elevation zones, fixed by tightening to 0.6 and forcing uniform elevation 1; (2) `DefenseMeshFactory.addWallSegments()` and `addGateBridgeSegments()` used `centerT = 0.25`, positioning segment groups at 25% of the neighbor distance instead of the true midpoint, causing cumulative angular warping in circular wall arrangements. Fix: changed `centerT` from 0.25 to 0.5 in both functions so segments center at the geometric midpoint between adjacent hexes.
- [x] **BUG: Farm and Plant Crops do the same thing — no crop growth/VFX/resource** — Implemented full crop growth lifecycle. Crops progress through 4 stages (seedling→sprout→growing→mature) with 8-second intervals. Visual feedback: (1) flat markers change color (brown→olive→green→golden) via BlueprintSystem, (2) 3D voxel crop models (seedling nub → sprout with leaf → stalk with leaves → golden wheat sheaf) via 4 instanced archetypes in TerrainDecorator with 3-5 clustered stalks per farm tile. Wired `updateCropVisual` callback in NatureOps → TerrainDecorator + BlueprintSystem. Villagers only harvest mature (stage 3) crops, then crops reset to seedling and regrow. Plant Crops (E from farmhouse) shows planting notification and starts growth immediately.
- [x] **BUG: Army power bar only shows red and blue in 4-player FFA** — Root cause: `updateArmyStrength` in main.ts only passed `players[0]` and `players[1]`, never `allPlayers` for FFA. Fix: now builds `allPlayersForBar` array with all players and their CSS colors (via `getPlayerCSS()`), passes as third arg when `players.length > 2`. Also fixed `HUD.TEAM_COLORS`/`TEAM_NAMES` order mismatch (was Gold/Green at indices 2/3, now Green/Gold to match `PLAYER_COLORS`).
- [x] **BUG: Not enough iron and crystal on Frozen Tundra + new maps** — Root cause: Tundra crystal clusters only spawned on MOUNTAIN tiles (very rare in tundra), and cluster counts were too low (2-4 crystal, 3-5 iron). Fix in `generateTundraMap`: crystal now also spawns on SNOW terrain, cluster counts increased to 5-8 crystal / 6-9 iron, cluster radius widened from 3x3 to 5x5, placement chances increased. Iron also spawns on SNOW tiles. Skyland was already adequate (dedicated resource islands).
- [x] **BUG: Debug viewer Block animation leaks to battlefield** — Root cause: `animateBlock()` and `animateHit()` in UnitAnimations.ts modify `child.material.color` directly on cached materials from `getCachedLambert()`, which are shared globally across all units of the same type. When the debug preview triggers these animations, the color mutation affects every live unit's material. Fix: in `animatePreviewGroup()`, clone all `MeshLambertMaterial` instances on the preview group before any animation runs, isolating the preview from the shared material cache.
- [x] **UI: Swap slicer and spawn queue positions** — Swapped in HUD.ts: elevation slicer moved from `right:180px; bottom:80px` to `right:12px; bottom:90px` (flush right edge). Spawn queue moved from `right:12px; bottom:90px` to `right:180px; bottom:80px` (left of slicer). No overlap.
- [x] **BUILD: BuildingKind type errors (mine/market stubs)** — Another session added 'mine' and 'market' to the `BuildingKind` union type but didn't update `BuildingSystem.ts` or `main.ts`. Added stub entries in `buildingSpawnIndex` (both locations) and `BUILDING_PLACEMENT_CONFIG` with placeholder costs. Also fixed `updateResources` call that passed `PlayerResources` instead of `Player`.
- [x] **UI: Kanban completed tasks — expandable descriptions** — Added `description` field to TaskItem, updated `cleanTaskText()` to return `{title, description}` split at ` — ` dash. Completed task cards with descriptions now show a chevron indicator and expand on click to reveal the description text with a slide animation and left border accent. Cards without descriptions remain static. Collapsed by default for compact columns. Increased expand maxHeight from 80px to 200px with overflow-y scroll for long descriptions.
- [x] **BUG: Per-map fog/atmosphere too dense — terrain barely visible** — Multiple root causes fixed across sessions: (1) All `scene.fog = new THREE.FogExp2(...)` removed from 6 per-map atmosphere functions + base Renderer + TitleScene. (2) SkyCloudSystem import removed entirely (dead code). (3) Atmosphere reset block added before per-map overrides to clear stale backgrounds. (4) White ambient particles in Renderer.ts changed from `AdditiveBlending` (which accumulated to white wash) to `NormalBlending` with reduced opacity 0.15 and muted color `0xccccdd`.
- [x] **BUG: Gray flashing during combat actions** — `flashUnit()` in UnitVFX.ts replaced all unit materials with flat `MeshLambertMaterial({color: 0xff4444})` during damage, destroying lighting response and causing gray-shift via ACES tonemapping when many units flashed simultaneously. Fix: switched to emissive-based flash (`material.emissive.set(0xff2222)` with `emissiveIntensity: 0.6`) that preserves original material colors and lighting, then resets emissive to black on restore. Also changed white impact sphere from `AdditiveBlending` to `NormalBlending` with warm color `0xffe8c0`.
- [ ] **BUG: Ambient wind sound persists across games** — Wind/bird ambient sounds from `SoundManager.ts` persist after game end and into new games, layering on top of each other. Root cause: `stopAmbient()` (line 1497) stops `ambientWindNode` and clears intervals, but the wind LFO oscillator created in `startAmbient()` (line 1405-1411, `windLfo.start()`) is a local variable that never gets stopped or stored — it leaks and keeps running. Fix: store `windLfo` as a class member (e.g. `private ambientWindLfo: OscillatorNode | null = null`) and call `this.ambientWindLfo.stop()` in `stopAmbient()`. Also check if `startAmbient()` is being called on new game without `stopAmbient()` first — the guard `if (this.ambientActive) return` should prevent double-starts but verify `ambientActive` is properly reset.
- [ ] **BUG: Phantom capture zone light columns at wrong positions** — Tall translucent colored cylinders (capture zone ownership indicators from `CaptureZoneSystem.ts` line 245-259) are appearing at locations where there are no bases. Multiple red/yellow pillars clustered together with no corresponding bases underneath. `createZoneVisuals()` adds a 12-unit-tall CylinderGeometry per zone. Likely cause: `addZone()` is being called with incorrect base positions, duplicate zone registrations, or zones created for bases that were removed/relocated during map generation. Check where `addZone` is called — `base.worldPosition` may be stale or from a prior generation pass. Also verify `removeZone` properly cleans up on map reset.

---

## Work Stream A: Combat & Unit AI
**Status:** [DONE]
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
- [x] Red bleed effect — persistent red tint on wounded units via `_bleedActive` flag + `applyBleedTint()` in UnitVFX. Lerps mesh colors toward dark blood red proportional to damage taken (intensity 0→0.4 as health drops). Spawns red drip particles. Applied in CombatEventHandler after each hit, persists for rest of fight
- [x] Secondary melee attack animations — (1) Greatsword spin: green glow charge-up sphere → expanding green slash ring + AoE damage at spinRadius, 8s cooldown, 140% damage. (2) Warrior jump attack: parabolic leap arc + dust shockwave on impact, 6s cooldown, 150% damage. (3) Paladin charge: blue force field sphere during approach + white/gold impact burst + rally buff (30% speed boost to nearby allies for 5s), 10s cooldown, 180% damage. All via `checkSecondaryAttack()` in CombatSystem + VFX in UnitVFX + wired through CombatEventHandler
- [x] Unit level-up visuals — `applyLevelUpVisuals()` in UnitVFX: 3% scale increase per level, emissive armor shimmer (subtle gray at L2, brighter at L3, gold at L5+), silver shoulder badges at L3 / gold dual badges at L5+, captain helmet glow at L5+. Called from CombatEventHandler on level-up event
- [x] Archer level-up bonus — at level 2+, fires a second arrow 150ms after the first with slight offset. Second arrow deals 50% of base attack damage. Added in CombatEventHandler archer branch with deferred fireArrow callback
- [x] Greatsword level-up bonus — at level 2+, when cleave hits 4+ enemies, triggers sweep crit: doubles cleave damage on all secondary targets + green "SWEEP x{N}" crit text VFX. Added crit check in `applyGreatswordCleave()` + `combat:sweepCrit` event
- [x] Champion unit (Tier 3 base reward) — Built full Champion unit: white/gold plate armor model in UnitModels.ts (exaggerated proportions, massive pauldrons, feathered crew helm with team-color plume, giant war hammer with gold inlay + back spike, 1.25x scale). 3 animation sets in UnitAnimations.ts (idle: commanding breathing + weight shift, walk: heavy authoritative stride, attack: dramatic overhead hammer slam with 4 phases — wind-up, slam, ground tremor, recovery). MELEE_STRIKE_DELAY 560ms. Hammer slam secondary attack: AoE ground pound (50% ATK) within 1-hex radius, 480-frame cooldown, wired through CombatSystem + UnitAI + CombatEventHandler with ground shockwave VFX. Wired as Citadel tier-up reward in LifecycleUpdater (replaces Ogre at tier 3). Stats: 35 HP, 9 ATK, 5 DEF, 1 move, 1 range. Added HUD tooltips + passives
- [x] **STREAM COMPLETE** — All Stream A combat & progression tasks done

---

## Work Stream B: Rendering & VFX
**Status:** [DONE]
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
- [x] New unit models for any upcoming unit types — Champion model built in Stream A (white/gold plate, war hammer, 1.25x scale, feathered crew helm)
- [x] Performance profiling — assessed: mesh merge already reduces 60→12-18 meshes/unit, particle pool exists, terrain instanced. Main bottleneck is many independent rAF loops for VFX (acceptable for current scale)
- [x] Cubitopia title screen text — PixelTitle.ts: canvas-based pixel art title with 5x7 bitmap font rendered as 3D voxel blocks (isometric faces, specular highlights, wave animation), decorated with procedural swords, shields, crystals, and animated sparkles. Wired into MenuController replacing plain text
- [x] Garrison turret visuals — Added `fireArrowVolley()` (staggered N arrows with random spread, variable arc), `fireCannonball()` (heavy projectile + muzzle flash + smoke trail + ground impact explosion with debris/shockwave), cannon turret mesh system (`addCannonTurret/removeCannonTurret/setCannonTarget`) with smooth barrel tracking, all wired through UnitRenderer facade. Cross-stream request filed for GarrisonSystem wiring
- [x] Title screen art polish — Completely rebuilt sword and shield decorations in PixelTitle.ts. Swords: thick double-edged greatsword blades (2x→4x wide, 12s→25s tall) with central fuller groove, edge highlight/shadow, pointed tip triangle, ornate crossguards with gold curled ball terminals + center gem, leather-wrapped grip with gold rings, large ornate pommel with gem + glow. Shield: full heraldic coat of arms — classic heater shield shape with quadratic curves, quartered field (alternating blue tones), central rampant lion motif with crown (3 gold crown points with ruby gems), ornate gold border with 11 rivets + highlight dots, inner rim highlight, bottom scroll banner. Increased canvas margin (8→12 bs) and height (10→14 bs) for larger decorations. Repositioned all elements (swords wider angle 0.22rad, shield 1.1x scale, crystals moved outward).
- [x] **STREAM COMPLETE** — All Stream B rendering & VFX tasks done

---

## Work Stream C: UI & Player Experience
**Status:** [DONE]
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
- [x] Kanban layout rework — horizontal scrollable columns (wheel deltaY→scrollLeft), completed tasks auto-collapsed behind expandable "N completed" toggle, upvote buttons on open tasks (Firebase `/feature-votes/{taskHash}`, localStorage double-vote prevention, gold triangle on voted), suggestion box with Firebase `/feature-suggestions/{pushId}` + "Thanks!" flash. All consistent with UITheme.ts
- [x] Rally to existing squad — "Rally to Squad X position" button in building tooltip (appears when building has squad assignment and squad has units). Computes squad centroid, converts to hex, sets rally point. Added getSquadCentroid/rallyBuildingToSquad ops
- [x] Normalize building tooltips — replaced all hardcoded font-size/color styles with FONT.xs/FONT.sm/FONT.lg/FONT.family + COLORS.textMuted/textSecondary/yellow/blue from UITheme.ts. Section headers use uppercase letter-spacing. Already used UI.panel/UI.button/UI.keyBadge/UI.divider
- [x] Building tooltip hotkeys — already fully implemented: QWERTY keybadges on spawn buttons, F=Rally, X=Demolish, G=Garrison, U=Ungarrison with visible keybadge labels + keyboard handlers. Esc to close
- [x] Enemy tooltips — already implemented: showEnemyBuildingTooltip (type, owner, HP, building desc, garrison count, Attack/Rally buttons) + showUnitTooltip (PIP preview, stats, HP bar, status effects, Focus Fire/Attack Move for enemies). Added garrison count display to enemy building tooltip. Normalized fonts to UITheme
- [x] **STREAM COMPLETE** — All Stream C UI & player experience tasks done

---

## Work Stream D: Economy & Buildings
**Status:** [DONE]
**Primary files:** `ResourceManager.ts`, `BuildingSystem.ts`, `BuildingMeshFactory.ts`, `DefenseMeshFactory.ts`, `SpawnQueueSystem.ts`, `BaseUpgradeSystem.ts`, `PopulationSystem.ts`
**Supporting files:** `BlueprintSystem.ts`, `GarrisonSystem.ts`, `WallSystem.ts`

### Tasks
- [x] Food system polish — rebalanced to 2 food/unit (was 3), fixed startingFood config mismatch, base tier bonus food, richer HUD pop display with food→cap context, better "at cap" spawn messages
- [x] Wall rework — damage visuals (darkening/cracks/red glow), health bars, debris VFX, drag cost preview, garrison rework (walls=connectors, gates=entry/exit), exit picker with pill type filters, wall/gate demolish button
- [x] Lumberjack rework — Phase 1: forestry aura, passive trickle, worker spread scoring. Phase 2: multi-chop (chop until carry full), forestry drop-off (nearest forestry > base), stat buffs (HP 10, speed 1.6, carry 8, cooldown 2s), auto-replant (all chopped tiles regrow)
- [x] Farmhouse/food rework — Full morale system: food ratio drives combat effectiveness (starving=0.7x, hungry=0.85x, well-fed=1.1x attack/move speed). Starvation HP drain on combat units. Farmhouse bonus: +3 food storage, +1 yield to nearby farm patches (6 hex radius). Villager multi-harvest (accumulate food like lumberjack multi-chop, farmhouse/silo drop-off). Villager stat buffs (HP 10, speed 1.4, carry 8). Worker face details (eyes, eyebrows, nose, mouth) on all 3 workers. Unique idle/walk/gather animations per worker type
- [x] Garrison damage balance — Complete rebalance of garrison combat. Before: flat 3 dmg/ranged, 1.5/melee, fixed 2s cooldown. After: stat-based damage (ranged 75% ATK, melee 35%, siege 100%), fire rate scales with count (2.5s base - 0.15s/unit, min 1.0s), range extends to 5 hexes for 5+ units, VFX composition (siege→cannonball, 3+ ranged→arrow volley, mixed=both). Added fireArrowVolley + fireCannonball to GarrisonOps + wired in main.ts
- [x] City tiers (Phase 3) — Added Citadel as 4th tier (Camp→Fort→Castle→Citadel). Data-driven BASE_TIER_CONFIG (90 pop + 9 unique buildings). Full Citadel mesh in BaseRenderer (palace-fortress, cathedral spire, arcane beacon). Updated HUD/MenuController/LifecycleUpdater with tier 4 names, icons (🔮), purple notification color
- [ ] Gold economy — income, expenses, trade routes (REVERTED — auto-ticking economy adds no player-facing decisions; needs redesign around player interaction)
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream E: Map Generation & Game Modes
**Status:** [DONE]
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
- [x] Remove Volcanic Pass → add RIVER CROSSING map — Replaced MapType.VOLCANIC with MapType.RIVER_CROSSING. New generateRiverCrossingMap(): noise-based meandering river (3-5 hex width) bisects map, 2-4 stone bridges as chokepoints, north bank iron-heavy / south bank wood-heavy resource asymmetry, sandy riverbanks with clay, bridge reinforcement pass, player bases on opposite banks. Updated MapInitializer, MenuController (bridge emoji), main.ts atmosphere (river mist + golden light), TerrainDecorator (removed volcanic decoration branches, river crossing uses standard green decorations). Cleaned MapGenerator volcanic block types
- [x] Skyland playtest iteration — Tuned: outpost radius 3-5→4-6, outpost count +1 each mode (5-7/6-9), maxSpread 0.38→0.42 (wider island spacing), min island distance +1 (radius+5), extra bridges 1-2→2-3 for more strategic routes, meadow resource rates +2% across the board (food 12%, stone 10%, iron 12%, crystal 10%, gold 6%)
- [x] Tundra custom generator — Already implemented: generateTundraMap() with TundraRng/TundraNoise, frozen lakes (3-6 randomly placed), icy ridges, sparse pine groves, snow/packed_snow/frozen_dirt blocks, custom ice/crystal resource distribution, scarce resources by design
- [x] Per-map lighting/fog presets — All 7 custom maps have atmosphere methods (sky gradient, fog, ambient+directional light). Tuned: Skyland ambient 0.7→0.85 + directional 1.8→2.0 (above-clouds radiance), Tundra ambient 0.7→0.55 + directional 1.8→1.4 + color shifted grey-blue (overcast winter). River Crossing added with blue-green sky, river mist fog, golden sunlight
- [x] FFA neutral base balance — Added playerCount to MapGenerator.generate() and findSurfaceBaseLocations(). Strategic scoring now uses ALL player home positions (not just 2) with min/max distance variance for balance. FFA gets 3+3=6 neutral bases (up from 2+2=4), tighter MIN_DIST_BETWEEN (8 vs 10) to fit more. addSurfaceBases() checks distance from all player capitals. Symmetry enforced by balance score weighting (0.4) across all player positions
- [x] **STREAM COMPLETE** — All Stream E map generation & game mode tasks done

---

## Work Stream F: Audio & Music
**Status:** [DONE]
**Primary files:** `SoundManager.ts`, `ProceduralMusic.ts`
**Supporting files:** none

### Tasks
- [x] Sound coverage audit — identified 17+ missing sounds, 5 unused defined sounds, 1 type bug
- [x] Added 14 new synthesized sounds: victory, defeat, zone_captured, tier_upgrade, wall_build, wall_destroy, resource_wood, resource_stone, resource_food, garrison_enter, garrison_exit, combo_electrocute, combo_inferno, combo_kamehameha
- [x] Music transitions — already implemented (crossfadeTo with 2s CROSSFADE_TIME, combat intensity trigger)
- [x] Ambient sound layer — wind (LFO-modulated filtered noise), bird chirps (intermittent synthesized calls), distant combat rumble (intensity-driven). API: startAmbient()/stopAmbient()/setAmbientCombatIntensity()
- [x] Tribe music composition — **HIGH PRIORITY** — wrote 99 music prompts (11 songs × 9 tribes) with AI-generation-ready prompts, mood descriptions, instrument palettes, tempo, key, and lyrics. Named 5 TBA tribes: Synthforged (electronic), Ashwalkers (hip-hop), Dreamweavers (lo-fi), Dustborn (oldies), Voidtouched (alternative). Saved to `docs/TRIBE_MUSIC_PROMPTS.md` with quick-reference table
- [x] Wire new sounds into game systems — All 14 Stream F sounds now connected: `wall_build` in UnitAI ops handleBuildWall/handleBuildGate, `wall_destroy` in combat damageWall ops (checks destroyed boolean) + manual demolish, `garrison_enter`/`garrison_exit` in GarrisonSystem garrison()/ungarrison()/ungarrisonFiltered(), `combo_electrocute` in CombatEventHandler electrocute branch, `combo_inferno`/`combo_kamehameha` replaced `splash_aoe` calls. `victory`/`defeat`/`zone_captured`/`tier_upgrade`/`resource_wood`/`resource_stone`/`resource_food` were already wired by previous sessions. Speech bubble `triggerSpeechBubble` already wired in CombatEventHandler ops → UnitRenderer facade
- [x] Unit speech bubbles + voice barks — Created SpeechBubbleSystem.ts (cartoon canvas-rendered bubbles with rounded rect + tail, pop-in bounce animation, fade-out, auto-follow via THREE.Sprite on unit group) + UnitDialogue.ts (dialogue bank with 8 contexts × 18 unit types, personality-specific lines — warriors gruff, archers sarcastic, mages pretentious, healers passive-aggressive, berserkers ALL CAPS, ogres simple). TTS via Web Speech API with per-personality pitch/rate/volume. Throttled: 1-in-5 commands, 4s combat cooldown, 1.5s global cooldown, max 4 bubbles. Wired into UnitRenderer facade (triggerSpeechBubble, updateSpeechBubbles, setSpeechTTSEnabled, setSpeechVolume). Cross-stream wiring complete: main.ts calls triggerSpeechBubble at command/attack/select sites + updateSpeechBubbles per frame. CombatEventHandler calls triggerSpeechBubble for attack/attacked/kill/death.
- [x] **STREAM COMPLETE** — All sounds wired, speech bubbles wired (main.ts + CombatEventHandler), ambient soundscape wired (startAmbient on game start, stopAmbient on game over/restart, setAmbientCombatIntensity per-frame). All cross-stream requests fulfilled.

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
- [x] Write Reddit post draft — completed in Stream J: 4 subreddit-specific versions (r/indiegaming, r/playmygame, r/webgames, r/indiegames) with posting strategy in `docs/REDDIT_LAUNCH_POST.md`
- [ ] Set up feedback channel — Discord server or Google Form linked from in-game
- [x] Rate limiting / abuse prevention — Created `database.rules.json` + `firebase.json`. Rules enforce: auth-required on all paths, users can only write own profile, ELO changes capped at ±50 per write (K=32 max is ~32), wins/losses increment by 1 only, display name regex validated (2-24 chars alphanumeric), queue entries self-owned with server timestamp, match players immutable after creation, winner can only be set once, signaling channels scoped to sender UID. Also added Firebase Hosting config with SPA rewrites + cache headers.
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Work Stream H: Codebase Efficiency Refactors
**Status:** [DONE] — 2 deferred items remain (InputManager type safety, SpawnQueueSystem consolidation) pending main.ts decomposition
**Primary files:** `UnitModels.ts`, `UnitAnimations.ts`, `main.ts`, `UnitAI.ts`, `SpawnQueueSystem.ts`, `CombatEventHandler.ts`, `BuildingMeshFactory.ts`, `InputManager.ts`
**Supporting files:** `BaseRenderer.ts`, `MeshMergeUtils.ts`, `ResourceManager.ts`
_Note: Some files overlap with Streams B and D. Run after those complete, or coordinate via Cross-Stream Requests._

### Priority: CRITICAL
- [x] Material cache consolidation — 333 MeshLambertMaterial + 9 MeshBasicMaterial now use getCachedLambert/getCachedBasic from MeshMergeUtils. Only 7 emissive materials remain as new instances. Major GPU memory savings.

### Priority: HIGH
- [x] Resource stockpile refactor — created `ResourcePool` class with typed `get/set/add/array/reset` API + `RESOURCE_DISPLAY` metadata. All 11 stockpile arrays in main.ts now use `resourcePool.array()` backing references. `resetStockpiles()` calls `resourcePool.reset()` + rebinds. Collapsed 8 `handleXxxDeposit` methods in ResourceManager into unified `handleDeposit(unit, resource)` with legacy one-liner wrappers.
- [x] UnitAI static state extraction — created `SharedGameState` class (`src/game/SharedGameState.ts`) with 30+ fields extracted from UnitAI statics (claimedTrees, farmPatches, wallsBuilt, basePositions, etc.). UnitAI.state holds injectable instance, forwarding getters/setters keep all 300+ `UnitAI.xxx` references working. `reset(playerCount)` clears all state in one call. Unblocks multiplayer serialization + unit testing.
- [x] UnitModels composable builder — created `UnitModelHelpers.ts` with 11 composable builders (addHead, addEyes, addSimpleEyes, addEyebrows, addMouth, addNose, addBelt, addTabard, addPauldrons, addTorso, addMirroredPair) + color constants. Refactored 12 of 17 unit types to use helpers (Warrior, Archer, Rider, Paladin, Builder, Lumberjack, Villager, Trebuchet, Healer, Shieldbearer, Assassin, Berserker). 5 units preserved as-is due to bespoke decorations. 4806→4797 lines (modest — units are highly unique; 68% reduction estimate was unrealistic). Major win: new unit creation now 3-4x faster with composable parts.

### Priority: MEDIUM
- [x] hexDist deduplication — created `src/game/HexMath.ts` with `hexDist`, `hexDistQR`, `hexDistFromDeltas`. Migrated TitleScene.ts + main.ts. Cross-stream requests filed for remaining 5 files (Streams A, E).
- [x] UnitAnimations phase helper — created `AnimationUtils.ts` with 6 named easings (`easeIn`, `easeOut`, `cubicOut`, `smoothstep`, `easeInOut`, `cubicIn`), `lerp()`, `phaseOf()`, `cyclePhase()`. Refactored 66+ inline math expressions across all 15 unit types to use named utilities. Readability win; line reduction minimal (animations too bespoke for data-driven approach).
- [ ] InputManager type safety — requires decomposing main.ts further first (80+ private member accesses). Deferred until main.ts shrinks more.
- [ ] SpawnQueueSystem consolidation — merge 4 duplicate `doSpawnQueue*` validation chains into single `validateAndQueue(config)`. (~80 lines saved). Deferred — validation differences are real, savings modest.
- [x] SpawnQueueSystem per-frame allocation — cached `spawnConfigs[]` via `getSpawnConfigs()` lazy builder. 7+ closure allocations eliminated per frame. Invalidated on `cleanup()`.
- [x] CombatEventHandler callback flattening — extracted `handleLightningImpact()` (155→3 inline lines), `applyHighVoltageCascade()` (deduplicated ~50 lines of HV chain+stun+cascade), `checkDeath()` (common kill-check). Lightning max nesting 6+→2 levels. Net -29 lines.

### Priority: LOW
- [x] BuildingMeshFactory composable builder — created `BuildingMeshHelpers.ts` (368 lines) with 12 composable builders: `addFoundation`, `addPitchedRoof`, `addConicalRoof`, `addStoneCourses`, `addCylinderBands`, `addMerlons`, `addCornerTowers`, `addPlankCourses`, `addDoor`, `addCornerTrim`, `addBanner`, plus shared `bm`/`bmr`/`mat`/`glow`. Refactored all 9 full buildings to use `addFoundation` (9 foundations → 1 line each), Forestry A-frame → `addPitchedRoof`, Barracks stone courses → `addStoneCourses`, Barracks merlons → `addMerlons`. Factory 2115→2080 lines; helpers enable 1-liner composition for future buildings.
- [x] Unreachable cache memory leak — added `pruneUnreachableCache(liveUnitIds)` to UnitAI. Runs every 300 frames (~5s) during `update()`, removes entries for dead/gone units + expired tile blacklists + empty maps. Prevents unbounded Map growth in long games.
- [x] **STREAM COMPLETE** — All critical/high tasks done. 2 medium items deferred. Moving to next stream.

---

## Work Stream I: Tribe Skins & Faction System
**Status:** [DONE] — Session: ui-kanban
**Primary files:** `UnitModels.ts`, `UnitAnimations.ts`, `MenuController.ts`, `GameConfig.ts`, `UnitFactory.ts`
**Supporting files:** `ProceduralMusic.ts`, `UITheme.ts`, `TitleScene.ts`

_Goal: Activate the tribe selector buttons already in the menu. Each tribe gets a unique visual identity — different unit color palettes, model variations, and building styles. This is the foundation for Stripe cosmetic monetization._

### Tasks
- [x] Tribe data architecture — created `src/game/TribeConfig.ts` with `TribeId` type, `TribeConfig` interface (palette, unitOverrides, buildingStyle, musicFolder), all 9 tribes defined: Ironveil, Wildborne, Arcanists, Tidecallers, Forgeborn, Sandstriders, Mistwalkers, Embercrown, Voidtouched. Includes `TRIBE_BY_ID` map, `getTribe()`, `getDefaultTribe()`, `getPlayableTribes()`, `getTribeColor()` utilities. Only Ironveil is playable initially.
- [x] Activate tribe selector — refactored MenuController to use `TRIBES` from TribeConfig instead of MUSIC_GENRES. Tribe buttons set `selectedTribe: TribeId`, passed to `onStartGame(mode, map, tribeId)`. Added `tribeId?: string` to Player interface. main.ts stores `playerTribe`, sets on Player objects, calls `unitRenderer.setPlayerTribes()`. UnitRenderer resolves tribe palette primary as `playerColor` for unit model building. Full pipeline: menu → game state → renderer → UnitModels
- [x] Stoneguard skin — Pipeline validated end-to-end. Created `TribeSkin` interface + `DEFAULT_SKIN` + `lightenColor()`/`darkenColor()` helpers in UnitModelHelpers.ts. `buildUnitModel()` now accepts optional `TribeSkin` param. UnitRenderer.setPlayerTribes() stores full TribeConfig per player, builds TribeSkin from palette, passes to model builder. Warrior, Paladin, and Shieldbearer fully skinned: all plate/highlight/shadow materials, pauldrons, belt buckles, tabard borders, shield trim, helm, arms, and legs derive from tribe skin (secondary/accent/trim). Wildborne enabled as second playable tribe. Remaining unit types use DEFAULT_SKIN fallback.
- [x] Wildborne skin — Wired Archer, Rider, Assassin, Berserker to TribeSkin system. Archer: leather armor uses `s.secondary` (dark/light variants), fittings use `s.accent`. Rider: steel plates use `s.secondary`, brass trim uses `s.accent`, polished highlights use `s.trim`. Assassin: body/strap colors derived from `darkenColor(s.secondary)`. Berserker: chainmail/iron use `s.secondary`, bronze fittings use `s.accent`, polished edge uses `lightenColor(s.secondary)`. All 4 now respond to tribe palette. Wildborne-specific model variants (horned helms, leaf motifs) deferred to art polish pass.
- [x] Arcanists skin — Wired ALL remaining 11 unit types to TribeSkin: Builder (leather→`s.secondary`, metal→`s.accent`), Lumberjack (plaid/fur→`s.secondary` variants, metal→`s.accent`), Villager (tunic/vest/woven→`s.secondary` variants, metal→`s.accent`), Trebuchet (iron→`s.secondary`, gold→`s.accent`, leather→`s.secondary`, bone→`s.trim`), Healer (buckles/staff gold→`s.accent`, boots→`s.secondary`), Battlemage (plate→`darkenColor(s.secondary)`, gold→`s.accent`, runes→`s.trim`), Greatsword (plate/leather→`s.secondary`, gold→`s.accent`, blade→`s.trim`), Scout (leather→`s.secondary`, studs→`s.accent`, steel→`s.trim`), Mage (robe/collar/hat→`s.secondary` variants, buckles/cuffs→`s.accent`), Ogre (armor→`s.secondary`, bone→`s.trim`, metal→`s.accent`), Champion (plate/pauldrons→`lightenColor(s.secondary)`, trim→`s.accent`, waist→`darkenColor(s.secondary)`). Arcanists enabled as third playable tribe (purple/gold/violet palette). All 18 unit types now respond to tribe palettes.
- [x] Tidecallers skin — Enabled as fourth playable tribe (teal/white/coral-gold palette: secondary 0x1abc9c, accent 0xe0e0e0, trim 0xf0c040). All 18 unit types already wired to TribeSkin in Arcanists task — palette flows through automatically. Tribe-specific model variants (coral armor, trident weapons) deferred to art polish pass.
- [x] Design remaining 5 tribes — all 9 tribes named and defined in TribeConfig.ts: Forgeborn (mechanist engineers, industrial), Sandstriders (desert nomads, cavalry), Mistwalkers (scholars, stealth/illusion), Embercrown (imperial legionnaires, fire magic), Voidtouched (eldritch corrupted, void summons). Each has full palette, unit overrides, building style tag
- [x] **STREAM COMPLETE** — All 18 unit types wired to TribeSkin, ALL 9 tribes now playable (Ironveil, Wildborne, Arcanists, Tidecallers, Forgeborn, Sandstriders, Mistwalkers, Embercrown, Voidtouched). Each tribe's unique palette flows through all unit materials automatically. Art-specific model variants (robes, coral armor, horned helms) deferred to future polish pass.

---

## Work Stream J: Launch & Marketing
**Status:** [ACTIVE] — Session: launch-marketing
**Primary files:** `index.html`, `src/ui/MenuController.ts`, `package.json`, `vite.config.ts`
**Supporting files:** `src/network/FirebaseConfig.ts`, `docs/`

_Goal: Get Cubitopia's web presence, brand, and marketing pipeline ready for the Reddit playtest launch and beyond._

### Phase 1: Brand & Domain (DO FIRST — may force a rename)
- [x] Domain availability report — cubitopia.com/.io/.gg/.net all likely available. Recommend registering .com immediately ($8-15/yr). Full analysis in `docs/DOMAIN_REPORT.md`
- [x] Social handle availability report — @cubitopia available on Instagram/TikTok/YouTube. Twitter has @TheCubetopia (unrelated). Recommend @playcubitopia for consistency. Full analysis in `docs/SOCIAL_HANDLES_REPORT.md`
- [x] USPTO trademark search — No active registration for "Cubitopia". "Cubetopia" exists for play tents (different class) + blockchain game (no trademark). Medium risk, safe to proceed. Full analysis in `docs/TRADEMARK_REPORT.md`

### Phase 2: Web Presence
- [x] Deploy pipeline — GitHub Actions workflow already existed. Added `build:prod` and `deploy` scripts to package.json. Documented in `docs/DEPLOY.md`
- [x] Landing page — created `landing/index.html` with hero, play button, video embed slot, tribe showcase, email signup, social links, footer. Dark voxel theme, responsive, pure CSS
- [x] Stripe integration — created `src/payments/StripeService.ts` with lazy Stripe.js loading, tribe unlock management, checkout redirect. Wired lock overlays + unlock buttons into MenuController tribe selector. Created `.env.example`
- [x] Privacy policy + Terms of Service — created `docs/privacy.md` and `docs/terms.md` covering Firebase anonymous auth, Stripe payments, COPPA, data retention. Placeholder sections marked for legal review

### Phase 3: Content Pipeline
- [x] Cinematic recorder tool — `tools/cinematic-recorder.ts` with CinematicPath, CinematicRecorder, 4 presets (battleFlyby, baseTierUp, overviewSweep, tribeShowcase), MediaRecorder-based WebM capture. README + example file included
- [x] AI ad prompts — 27 prompts across 6 themes (trash talk, trailer parody, memes, mobile ad parody, tribe cards, banners) in `docs/AD_PROMPTS.md`
- [x] Instagram content calendar — 14-day plan with tribe reveals, gameplay clips, polls, countdown, launch day in `docs/INSTAGRAM_CALENDAR.md`
- [x] Reddit post drafts — 4 subreddit-specific versions (r/indiegaming, r/playmygame, r/webgames, r/indiegames) with posting strategy in `docs/REDDIT_LAUNCH_POST.md`
- [x] Discord server plan — Full channel structure, roles, welcome message, bot recommendations, engagement events in `docs/DISCORD_SETUP.md`

### Phase 4: Launch Day Prep
- [x] Launch checklist — comprehensive pre-launch verification across game, multiplayer, payments, performance, web, marketing in `docs/LAUNCH_CHECKLIST.md`
- [ ] Reddit post finalization — update drafts with real screenshots, gameplay gifs, live play link (BLOCKED: needs deployed game)
- [x] Instagram launch assets — announcement post spec, story frames, profile pic, bio template, highlight covers, reels strategy in `docs/INSTAGRAM_LAUNCH_ASSETS.md`
- [x] Monitoring plan — Firebase alerts, matchmaking health, Stripe webhooks, error tracking, key metrics, incident response, 48-hour schedule in `docs/MONITORING.md`
- [ ] **STREAM COMPLETE → re-read TASKS.md, claim the next OPEN stream, and continue**

---

## Cross-Stream Requests
_Add requests here when you need a change in another stream's files._

| Requesting Stream | Target Stream | File | What's Needed | Status |
|---|---|---|---|---|
| (example) | B | UnitModels.ts | Add ogre ground-pound mesh name | OPEN |
| H | A | CombatSystem.ts, TacticalGroup.ts, CombatEventHandler.ts, StatusEffectSystem.ts | Replace local `hexDist` with `import { hexDist, hexDistQR } from '../HexMath'` — utility created in `src/game/HexMath.ts` | DONE |
| H | E | MapInitializer.ts | Replace inline hexDist lambda with `import { hexDistFromDeltas } from '../HexMath'` | DONE |
| F | D | WallSystem.ts | Add `ops.playSound('wall_build')` on wall construction, `ops.playSound('wall_destroy')` on wall destruction | DONE |
| F | D | GarrisonSystem.ts | Add `ops.playSound('garrison_enter')` on unit garrison, `ops.playSound('garrison_exit')` on ungarrison | DONE |
| F | D | ResourceManager.ts | Add `ops.playSound('resource_wood'/'resource_stone'/'resource_food')` on deposit | DONE |
| F | D | BaseUpgradeSystem.ts | Replace `queue_confirm` with `ops.playSound('tier_upgrade')` on base tier-up | DONE |
| F | E | CaptureZoneSystem.ts | Add `ops.playSound('zone_captured')` on capture flip event | DONE |
| F | A | CombatEventHandler.ts | Add `ops.playSound('combo_electrocute'/'combo_inferno'/'combo_kamehameha')` on elemental combo triggers | DONE |
| F | H | main.ts | Call `soundManager.startAmbient()` on game start, `soundManager.stopAmbient()` on game end, `soundManager.setAmbientCombatIntensity(n)` per-frame based on active combats. Add `playSound('victory')` / `playSound('defeat')` on game over. | DONE |
| B | D | GarrisonSystem.ts | Wire garrison turret visuals: (1) Add `fireArrowVolley` and `fireCannonball` to GarrisonOps interface. (2) In `executeGarrisonFire()`, replace single `ops.fireArrow()` with `ops.fireArrowVolley(from, target.worldPosition, slot.units.length, callback)` for ranged units, and add `ops.fireCannonball(from, target.worldPosition, callback)` for gate structures. (3) Add `addCannonTurret/removeCannonTurret/setCannonTarget` to GarrisonOps for turret lifecycle — call `addCannonTurret` when first unit garrisons a gate, `setCannonTarget` when fire target is acquired, `removeCannonTurret` when gate empties. | DONE |
| B | H | main.ts | Wire new garrison ops in the GarrisonOps object: `fireArrowVolley: (from, to, count, cb) => this.unitRenderer.fireArrowVolley(from, to, count, cb)`, `fireCannonball: (from, to, cb) => this.unitRenderer.fireCannonball(from, to, cb)`, `addCannonTurret: (key, pos, color) => this.unitRenderer.addCannonTurret(key, pos, color)`, `removeCannonTurret: (key) => this.unitRenderer.removeCannonTurret(key)`, `setCannonTarget: (key, pos) => this.unitRenderer.setCannonTarget(key, pos)` | DONE |
| F | H | main.ts | Wire speech bubbles: (1) Call `unitRenderer.updateSpeechBubbles(time)` in the per-frame render loop. (2) Call `unitRenderer.triggerSpeechBubble(unitId, unitType, 'command')` when issuing move/rally commands. (3) Call `triggerSpeechBubble(unitId, unitType, 'select')` on unit selection. (4) Call with 'attack' context when units engage combat, 'death' on unit death, 'kill' on kill. API: `triggerSpeechBubble(unitId, unitType, context)` where context is 'command'/'attack'/'attacked'/'kill'/'death'/'idle'/'level_up'/'select'. | DONE |
| F | A | CombatEventHandler.ts | Wire speech bubble triggers: call `ops.triggerSpeechBubble(attackerId, attackerType, 'attack')` on melee/ranged strike, `ops.triggerSpeechBubble(targetId, targetType, 'attacked')` on hit, `ops.triggerSpeechBubble(attackerId, attackerType, 'kill')` on kill, `ops.triggerSpeechBubble(deadId, deadType, 'death')` on death. Throttling is handled internally by SpeechBubbleSystem. | DONE |

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
