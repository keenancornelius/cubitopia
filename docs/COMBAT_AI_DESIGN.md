# Cubitopia — Combat, Status Effects & AI Commander Design

*Design document — v0.1, April 2026*

---

## 1. Design Philosophy

The goal is combat that looks like a living battlefield, not a pile of units mashing into each other. Armies march in formation, break into role-based behavior on engagement, and create emergent "moments" — a paladin escort shielding a battlemage as she dumps AoE into a cluster, a pair of assassins slipping around the flank to delete the enemy healer, archers kiting backward toward their tank line while mages set up a wet→lightning combo that stuns the entire push.

This has to work at two levels simultaneously: the AI needs to execute these patterns autonomously (so single-player and AI opponents feel smart), and players need enough control to micro their own armies for skill expression. The replayability comes from the tension between "the AI is doing smart things on its own" and "I can do it better if I micro."

---

## 2. The Unit Role Triangle

The core balance follows a **rock-paper-scissors triangle with support multipliers**:

```
         TANKS (Paladin, Shieldbearer, Ogre)
        /  body-block, peel, absorb       \
       /                                    \
  counters                              counters
  assassins                              tanks
     /                                      \
DIVERS ◄──── countered by ────► RANGED LINE
(Assassin, Berserker,            (Archer, Mage, Battlemage,
 Rider, Scout)                    Catapult, Trebuchet)

         SUPPORT (Healer, Paladin-aura)
         multiplies any role's effectiveness
         but dies instantly if exposed
```

### How Each Matchup Should Feel

**Tanks vs Divers** — Tanks win. A shieldbearer should be able to body-block a berserker and bash them back while taking minimal damage. The berserker's high attack (5) should bounce off the shieldbearer's defense (7). Paladins should be able to "escort peel" — intercept a diving assassin before it reaches the backline. The counterplay for divers is to *go around* the tanks, not through them.

**Divers vs Ranged** — Divers win if they reach the backline. A berserker opens with axe throw (range 7) to tag an archer, then closes distance with chase boost. An assassin's burst (ATK 7, ATKSPD 1.8) should delete an archer (8 HP) in 1-2 hits. Riders charge through the line to reach siege units. The counterplay for ranged is tank peeling and kiting.

**Ranged vs Tanks** — Ranged wins over time. Archers and mages chip away at a shieldbearer's 30 HP from safe distance. A battlemage's AoE splash shreds clumped tanks. Tanks can't close the gap because ranged units kite. The counterplay for tanks is sending divers to pressure the ranged line.

### Current Balance Issues to Address

**Berserker vs Tank problem:** Right now berserkers have ATK 5 and tanks have DEF 7 (shieldbearer). With a simple `damage = attack - defense` formula, berserkers would do almost nothing. But if the formula is `damage = max(1, attack * multiplier - defense)`, the berserker's attack speed (1.3) means they're chipping away fast. The fix should be:

- Berserkers deal **bonus damage to light armor** (ranged/support) — they're archer-killers
- Berserkers deal **reduced damage to heavy armor** (tanks) — they bounce off shields
- This can be a simple armor-type system: Light (archers, mages, healers, assassins), Medium (warriors, riders, berserkers), Heavy (paladins, shieldbearers, ogres)

**Proposed armor multipliers:**

| Attacker vs → | Light | Medium | Heavy |
|---|---|---|---|
| Light damage (archers, mages) | 1.0x | 1.0x | 0.7x |
| Medium damage (warriors, berserkers) | 1.3x | 1.0x | 0.7x |
| Heavy damage (ogres, greatswords) | 1.0x | 1.0x | 1.0x |
| Piercing damage (assassins) | 1.5x | 1.0x | 0.5x |
| Siege damage (catapult, trebuchet) | 0.5x | 0.7x | 1.5x |
| Magic damage (mages, battlemages) | 1.2x | 1.0x | 1.2x |

Magic ignoring armor partially is classic and creates a role for mages as "the answer to tanks that ranged can't crack." Piercing (assassins) being brutal against light but terrible against heavy means assassins need to pick their targets carefully.

---

## 3. Status Effect & Combo System

This is where the depth comes from. Status effects aren't just buffs/debuffs — they're **primers** that other abilities can **consume** for amplified effects. Players (and AI) that chain combos will dramatically outperform those who don't.

### 3.1 Status Effects

Each effect has a **duration** (seconds), **source** (who applied it), and **stack count** (some effects stack intensity).

#### Elemental Primers (Applied by Casters)

| Effect | Applied By | Duration | Visual | Mechanical Effect |
|---|---|---|---|---|
| **Wet** | Water Mage spell | 4s | Blue drip particles | −20% move speed. Extinguishes Burning. |
| **Burning** | Fire Mage spell | 5s | Orange flame particles | 1 damage/sec DoT. Evaporates Wet. |
| **Chilled** | Ice Mage spell | 4s | Frost crystals on model | −30% move speed, −20% attack speed. |
| **Charged** | Lightning Mage spell | 3s | Sparking aura | Next hit taken deals +50% bonus damage to attacker AND target (mutual shock). |

#### Combat Debuffs (Applied by Physical Units)

| Effect | Applied By | Duration | Visual | Mechanical Effect |
|---|---|---|---|---|
| **Slowed** | Berserker axe hit (exists) | 3s | Trail effect | −40% move speed. |
| **Sundered** | Greatsword cleave | 4s | Cracked armor visual | −3 defense (armor shred). Stacks up to 2x. |
| **Poisoned** | Assassin strikes | 5s | Green bubbles | 0.5 dmg/sec DoT + healing received reduced by 50%. |
| **Dazed** | Shieldbearer bash | 1.5s | Stars above head | Cannot attack. Can still move (stumbling). |
| **Knocked Back** | Ogre club swipe (exists) | instant | Displacement | Pushed 2 hexes away from source. |

#### Buffs (Applied by Support)

| Effect | Applied By | Duration | Visual | Mechanical Effect |
|---|---|---|---|---|
| **Blessed** | Paladin aura (passive) | Continuous while in range 2 | Golden glow on allies | +2 defense to all allies within 2 hexes. |
| **Inspired** | Healer overheal | 6s | White sparkle | +15% move speed, +10% attack speed. |
| **Shielded** | Shieldbearer stance | Continuous | Shield icon | Shieldbearer absorbs 40% of damage dealt to adjacent allies. |

### 3.2 Elemental Combos

When a second effect hits a unit that already has a primer, the primer is **consumed** and a combo triggers. This is the "wet → lightning = crit" idea expanded into a full system.

| Primer | Trigger | Combo Name | Effect |
|---|---|---|---|
| **Wet** + **Lightning** | → | **Electrocuted** | Consumes Wet. 2x damage on the lightning hit. Stun for 1.5s. Chains to 1 adjacent enemy (half damage). |
| **Wet** + **Ice** | → | **Frozen** | Consumes Wet + Chilled. Target rooted for 2.5s (can't move OR attack). Next physical hit **shatters**: 3x damage, breaks Frozen. |
| **Burning** + **Ice** | → | **Steam Cloud** | Consumes both. Creates a 2-hex AoE cloud for 3s. Units inside: −50% vision range (can't auto-target), +50% miss chance on ranged attacks. |
| **Chilled** + **Lightning** | → | **Superconductor** | Consumes Chilled. Lightning chains to ALL enemies within 3 hexes (normal damage to each). Devastating against clumped armies. |
| **Burning** + **Wind** (future) | → | **Firestorm** | Spreads Burning to all enemies within 2 hexes. Burning duration refreshed. |
| **Poisoned** + **Burning** | → | **Toxic Fumes** | Consumes both. Creates poison cloud (2-hex AoE, 4s). 1.5 dmg/sec to enemies inside. Healing reduced 75% inside cloud. |
| **Sundered** + any magic | → | **Shattered Armor** | Consumes Sunder stacks. Magic damage x1.5. Defense permanently reduced by 1 for rest of fight. |
| **Blessed** + **Heal** | → | **Overheal Shield** | Healing beyond max HP converts to a temporary shield (white HP bar segment). Decays at 1/sec. Max shield = 50% of max HP. |

### 3.3 Why This Creates Depth

**For players:** Micro rewards compound. A player who manually casts Water on a clump, then follows with Lightning for the Electrocuted combo, gets a 2x damage nuke + AoE stun + chain damage. That's a teamfight-winning play that the opponent can counter by spreading their units (don't clump when enemy has water+lightning mages).

**For AI:** The combo system gives the AI commander something to *plan around*. A smart AI doesn't just throw spells randomly — it sequences them. "Apply Wet to the tank cluster, wait 0.5s, follow up with Lightning for Electrocuted." This is a blackboard entry: `{ primer: 'wet', targets: [id1, id2, id3], followUp: 'lightning', readyIn: 0.5s }`.

**For army composition:** Players now have to think about mage loadout. Two water mages + one lightning mage = more Electrocuted combos but less sustained DPS. One of each element = more versatility but fewer combos. This is a meaningful draft decision.

### 3.4 Mage Spell Loadouts

Right now "Mage" is one unit type. To support elemental combos, mages should have **spell schools** assigned at spawn (or chosen by player for their mages, random for AI):

| School | Primary Spell | Secondary Spell | Playstyle |
|---|---|---|---|
| **Water** | Drench (applies Wet, range 4) | Torrent (line AoE, knockback + Wet) | Setup / primer mage |
| **Fire** | Fireball (damage + Burning, range 4) | Ignite (consume Burning for burst) | Pure damage |
| **Ice** | Frostbolt (damage + Chilled, range 4) | Glacial Spike (if Chilled → Frozen) | Control mage |
| **Lightning** | Bolt (damage + Charged, range 4) | Storm Strike (consumes primers for combo) | Combo finisher |

**Battlemages** keep their AoE identity but get a school too — their AoE splash applies the elemental primer to all targets hit. A Fire Battlemage's splash applies Burning to the whole clump. A Water Battlemage primes an entire formation for a Lightning follow-up.

---

## 4. Unit Behavior Profiles (AI & Player Micro)

### 4.1 Role Behaviors in Combat

Each unit type has an **ideal behavior** that the AI should execute and players can enhance with micro:

#### Tanks

**Shieldbearer — The Immovable Wall**
- Plants in front of the formation. Never chases.
- Uses Shield Bash (Dazed) on the highest-threat diver approaching the backline.
- Absorbs 40% of damage to adjacent allies (Shielded aura).
- AI priority: Stand between enemy army and own ranged line. Rotate to face biggest threat cluster.
- Player micro opportunity: Manually reposition to block a specific flank. Toggle between "shield wall" (stationary, max defense) and "advance" (push forward, body-block enemies into terrain).

**Paladin — The Escort**
- Stays within 2 hexes of a designated high-value target (battlemage, healer).
- Blessed aura gives +2 defense to all nearby allies passively.
- Attacks enemies that enter the aura zone (peeling for the escort target).
- AI priority: Attach to the most valuable ranged unit. Intercept divers.
- Player micro opportunity: Reassign escort target mid-fight. If the battlemage is safe, detach the paladin to peel for an archer who's being dove.

**Ogre — The Disruptor**
- Wades into enemy formation. Club Swipe knocks enemies 2 hexes apart.
- Goal is to *break enemy formation* — scatter their tanks so divers can reach their backline.
- AI priority: Target the densest enemy cluster. Use knockback to create gaps.
- Player micro opportunity: Aim the ogre at a specific choke point to disrupt an enemy push. Pair with assassins who exploit the chaos.

#### Divers

**Assassin — The Backline Delete**
- Avoids the front line entirely. Paths around the edges of the engagement.
- Target priority: Healers > Mages > Archers > Siege > everything else.
- If target dies, immediately seeks next highest-priority target.
- If caught by a tank, disengages (high speed 2.8) and re-flanks.
- AI priority: Wait until engagement starts (tanks are occupied), then dive the backline from a flank angle.
- Player micro opportunity: Manually path the assassin to a specific angle of attack. Hold behind terrain until the perfect moment, then strike.

**Berserker — The Archer Hunter**
- Opens every fight with Axe Throw (range 7, one shot per unique target) targeting the nearest archer/mage.
- Axe hit applies Slow, then charges the slowed target with chase boost.
- If all ranged targets dead or unreachable, switches to any target (becomes a melee bruiser).
- If engaging a heavy tank, should disengage and find a lighter target.
- AI priority: Identify ranged threats, axe throw the most dangerous one, close the gap.
- Player micro opportunity: Choose axe throw target (focus the battlemage, not the archer). Kite a tank by throwing axes and running — berserker becomes a pseudo-ranged unit vs tanks.

**Rider — The Charger**
- Charges through gaps in the front line to reach siege/support.
- Charge attack: bonus damage based on distance traveled before impact (momentum).
- After charge, fights in melee briefly, then retreats to charge again.
- AI priority: Find the widest gap in the enemy line. Charge through to siege units.
- Player micro opportunity: Time charges to coincide with Ogre knockbacks (ogre scatters their line, rider charges through the gap).

#### Ranged Line

**Archer — Sustained DPS**
- Stays at max range (4 hexes) behind tank line.
- Spreads damage across multiple targets (attrition pressure).
- Kites backward when melee threats approach, always toward the tank line.
- AI priority: Attack the nearest enemy. Kite toward allies, not away into isolation.
- Player micro opportunity: Focus fire a single target for burst. Manually position archers on high ground (elevation advantage if implemented).

**Mage — Combo Setup/Finisher**
- Casts elemental spells based on school (see Section 3.4).
- Water/Ice mages prioritize priming enemy clusters.
- Lightning/Fire mages prioritize consuming primers for combos.
- AI priority: If an enemy has a primer, consume it with combo. Otherwise, apply primer to densest cluster.
- Player micro opportunity: Sequence spell casts manually for devastating combos. Target primers onto specific high-value enemies for follow-up.

**Battlemage — AoE Pressure**
- Casts AoE splash attacks that hit multiple enemies.
- Splash applies elemental primer to all targets — the best setup unit for combos.
- Slow attack speed (0.5) but each cast is high impact.
- Very high value target — needs escort (paladin) to survive.
- AI priority: Position behind tanks, cast into the densest enemy cluster. Never advance past the tank line.
- Player micro opportunity: Time the AoE to hit right after an Ogre knockback clumps enemies together. Pair Water Battlemage + Lightning Mage for devastating AoE Electrocute combo.

#### Support

**Healer — Sustain Engine**
- Zero combat damage. Purely casts heals.
- Target priority: Most-injured allied combat unit within range 3.
- If all allies healthy, follows the nearest combat unit (stay with the group).
- If Blessed + Heal → Overheal Shield on full-HP allies (pre-shielding before engagement).
- AI priority: Stay behind the ranged line. Never advance past mages. Heal whoever is lowest.
- Player micro opportunity: Pre-shield tanks before a charge. Switch focus to a diving assassin that's low — keep your divers alive deep in enemy territory.

#### Siege

**Catapult/Trebuchet — Structure Breakers**
- Extremely slow, extremely fragile, extreme damage to buildings and walls.
- Must be protected by the entire army — if a scout reaches them, they die.
- AI priority: Position behind the entire army. Attack the nearest structure. If no structures, attack the nearest unit cluster.
- Player micro opportunity: Manual targeting to prioritize specific buildings (wizard tower > barracks).

---

## 5. AI Commander Architecture

### 5.1 Three Layers

```
┌─────────────────────────────────────────┐
│           STRATEGIC LAYER               │
│  (Commander — every 2-5 seconds)        │
│  • Army composition decisions           │
│  • Attack/defend/capture objectives     │
│  • Identifies win conditions            │
│  • Assigns army groups to objectives    │
└──────────────────┬──────────────────────┘
                   │ orders
┌──────────────────▼──────────────────────┐
│           TACTICAL LAYER                │
│  (Army Group — every 0.5-1 second)      │
│  • Formation management                 │
│  • March → Engage → Reform transitions  │
│  • Combo sequencing (blackboard)        │
│  • Role assignments (who peels whom)    │
│  • Threat assessment & focus targeting  │
└──────────────────┬──────────────────────┘
                   │ behaviors
┌──────────────────▼──────────────────────┐
│           UNIT LAYER                    │
│  (Per-unit — every frame)               │
│  • Boids movement forces               │
│  • Kiting / peeling / diving            │
│  • Spell casting & combo execution      │
│  • State machine (existing system)      │
└─────────────────────────────────────────┘
```

### 5.2 The Tactical Group (Army)

```typescript
interface TacticalGroup {
  id: string;
  owner: number;
  units: Unit[];
  phase: 'MUSTERING' | 'MARCHING' | 'ENGAGING' | 'REFORMING' | 'RETREATING';
  objective: HexCoord;           // where the army is going
  marchDirection: Vec2;          // current heading (for formation orientation)

  // Computed each tactical tick
  centroid: HexCoord;            // center of mass of all units
  enemyCentroid: HexCoord | null;
  frontLineAxis: Vec2;           // perpendicular to march direction (where tanks line up)

  // Blackboard — shared tactical state
  blackboard: {
    // Threat tracking
    threatMap: Map<string, number>;        // unitId → threat score (damage taken recently)
    incomingDivers: string[];              // enemy units flanking/diving our backline

    // Coordination — prevents double-peel, double-focus
    claimedPeelTargets: Map<string, string>;    // enemyId → our tankId
    claimedDiveTargets: Map<string, string>;    // enemyId → our diverId
    focusTarget: string | null;                  // commander-designated priority target

    // Combo sequencing
    primedEnemies: Map<string, { effect: StatusEffect; appliedAt: number; expiresAt: number }>;
    pendingCombos: Array<{ primerId: string; finisherId: string; targetId: string; readyAt: number }>;

    // Formation
    tankLinePosition: HexCoord[];          // where the front line should be
    rangedLinePosition: HexCoord[];        // where archers/mages should stand
    supportLinePosition: HexCoord[];       // where healers sit
    flankRoutes: HexCoord[][];             // paths for assassins/riders to flank
  };
}
```

### 5.3 Phase Transitions

```
MUSTERING ──(all units gathered)──► MARCHING ──(enemy detected)──► ENGAGING
    ▲                                   ▲                              │
    │                                   │                              │
    └──(army created)              (combat ends)◄─────── REFORMING ◄───┘
                                                              │
                                        (>60% losses)──► RETREATING ──► (regroup at base)
```

**MUSTERING:** Units gather at a rally point near the barracks. Formation slots assigned by role (tanks front, ranged back). Army waits until a minimum threshold of units arrives (e.g., 6+ units or 80% of assigned units).

**MARCHING:** Boids movement with high cohesion. Tanks have a "front bias" force pulling them toward the leading edge. Ranged have a "rear bias." Healers cluster with ranged. The formation is loose but structured — not a rigid grid, more like a blob with role-based density zones. March speed = slowest unit + 20%.

**ENGAGING:** Triggered when any unit in the group detects an enemy within detection range. Phase transition cascades:
1. Tanks receive "advance to contact" — move to intercept between enemies and own ranged
2. Ranged receive "hold position" — stop marching, begin attacking
3. Divers receive "hold for opening" — wait 2-3 seconds for tanks to engage, then flank
4. Healers receive "attach to ranged cluster" — position behind mages
5. Blackboard activates — begins tracking threats, coordinating combos

**REFORMING:** After no enemy contact for 5 seconds. Surviving units re-slot into formation positions. Badly wounded units placed in protected positions (center). Army resumes march if objective not reached.

**RETREATING:** If army drops below 40% strength (health-weighted, not just count). Surviving units disengage and path back toward nearest friendly base. Tanks rear-guard (move last, face enemies). Ranged kite as they retreat. This prevents wiped armies from throwing away their last units.

---

## 6. Boids Movement — Role-Weighted Forces

Each unit computes these forces every frame and blends them into its movement vector:

### 6.1 Universal Forces (All Units)

| Force | Description | Weight |
|---|---|---|
| **Separation** | Push away from units closer than 0.5 hexes | 2.0 (hard constraint) |
| **Alignment** | Match velocity of nearby same-group units | 0.3 during march, 0.1 in combat |
| **Cohesion** | Pull toward group centroid | 0.5 during march, 0.2 in combat |
| **Objective** | Pull toward march target | 0.4 during march, 0.0 in combat |
| **Terrain Avoidance** | Push away from water/mountains/walls | 3.0 (hard constraint) |

### 6.2 Role-Specific Forces (Combat Phase)

**Tanks:**
| Force | Weight | Description |
|---|---|---|
| Interpose | 1.5 | Pull toward the midpoint between enemy centroid and own ranged line |
| Enemy Attract | 0.8 | Mild pull toward nearest enemy (close the gap) |
| Ally Protect | 1.0 | Pull toward any allied squishy being attacked |

**Ranged/Casters:**
| Force | Weight | Description |
|---|---|---|
| Enemy Repel | 1.2 | Push away from enemies closer than weapon range |
| Range Maintain | 0.8 | Pull to maintain exactly weapon-range distance from target |
| Tank Attract | 0.6 | Pull toward nearest friendly tank (kite toward protection) |
| Cluster | 0.4 | Pull toward other ranged allies (clump for healer efficiency) |

**Healers:**
| Force | Weight | Description |
|---|---|---|
| Injured Attract | 1.0 | Pull toward most-injured ally within heal range |
| Ranged Cluster | 0.8 | Pull toward ranged ally centroid (stay in back row) |
| Enemy Repel | 1.5 | Strong push away from any enemy (survival priority) |

**Divers (Assassin/Berserker/Rider):**
| Force | Weight | Description |
|---|---|---|
| Flank | 1.2 | Pull toward assigned flank waypoint (90° off engagement axis) |
| Target Attract | 1.0 | Pull toward assigned dive target |
| Tank Repel | 0.8 | Push away from enemy tanks (go around, not through) |
| Group Repel | 0.3 | Mild push away from own army's center (drift to edges) |

**Siege:**
| Force | Weight | Description |
|---|---|---|
| Max Rear | 1.5 | Pull toward the rearmost position in the army |
| Ally Attract | 1.0 | Strong pull toward ally centroid (stay protected) |
| Enemy Repel | 2.0 | Very strong push away from any enemy (run if threatened) |

### 6.3 Why Boids + Roles = Fluid Armies

During **march**, all units have high Cohesion + Alignment + Objective forces. The army moves as a blob. But tanks have a small "front bias" (they drift toward the leading edge) and ranged have a "rear bias." The result is a naturally layered march formation without any rigid slot assignment.

During **combat**, Cohesion drops and role forces take over. Tanks get pulled between enemies and allies (forming a front line). Ranged get pushed back to weapon range (forming a back line). Divers get pulled to the flanks. Healers stick with the ranged cluster. The formation *emerges* from the forces rather than being dictated by a template.

When a **tank dies**, the other tanks' Interpose forces redistribute — they spread to cover the gap. When a **diver gets caught**, their Tank Repel force kicks in and they try to escape. When the **ranged line gets dove**, their Enemy Repel spikes and they scatter, while nearby tanks' Ally Protect force pulls them to intercept.

This is what makes it look fluid and alive rather than mechanical.

---

## 7. Tribe Personalities (Future)

Each tribe gets a different AI commander personality mapped to the three algorithmic approaches. This means fighting different tribes feels genuinely different, not just stat variations.

### 7.1 The Horde — Boids Swarm AI

**Theme:** Overwhelming numbers, fluid movement, constant pressure from all directions.

**Commander behavior:**
- Spawns cheap units in high volume (warriors, berserkers, scouts)
- Never forms tight formations — units swarm in a loose cloud
- Attacks from multiple directions simultaneously (no "front")
- Individual units are expendable — the swarm keeps coming
- Retreats by scattering (hard to chase), then reconverges

**Boids tuning:** High separation (units spread out), low cohesion (loose swarm), high enemy-attract on all units (everyone charges). No distinct front/back line — it's a cloud of aggression.

**Counter-strategy:** AoE damage (battlemage splash) is devastating against swarms. Tight formations with tank walls force the swarm to clump and take AoE. The Horde's weakness is they can't focus fire and they fold to organized resistance.

**Difficulty scaling:** Easy Horde just throws units in random waves. Hard Horde does multi-pronged attacks where sub-swarms hit from 3+ directions, forcing the player to split attention.

### 7.2 The Legion — Formation Controller AI

**Theme:** Disciplined, slow-moving, impossibly hard to break once set up. The Roman legion.

**Commander behavior:**
- Builds balanced armies with proper tank/ranged/support composition
- Marches in rigid formation (tanks front, archers behind, mages center, healers rear)
- Holds formation during combat — tanks don't chase, ranged don't scatter
- Advances as a unified block, grinding forward
- Exploits terrain (high ground, chokepoints, walls)

**Formation tuning:** High alignment (units stay in sync), rigid formation slots, slow march speed but perfect coordination. Tanks have extreme "hold position" — they anchor the line.

**Counter-strategy:** Flanking. The Legion is weak to attacks from the side or rear because their formation faces one direction. Assassins and riders that hit the back of the formation while it's engaged frontally. Also: siege units to crack their wall from range.

**Difficulty scaling:** Easy Legion is slow and predictable. Hard Legion adapts formation to terrain (line in open field, wedge in corridors, circle when surrounded) and rotates to face flanks.

### 7.3 The Conclave — Utility AI with Blackboard

**Theme:** Small elite armies, devastating combos, surgical strikes on high-value targets.

**Commander behavior:**
- Builds fewer units but higher-tier (mages, battlemages, assassins, paladins)
- Sequences elemental combos deliberately (primers → finishers)
- Focus-fires high-value targets (kill the enemy healer first, then the battlemage)
- Uses assassins for precision strikes, not mass engagement
- Retreats intelligently — pulls back when a combo window is on cooldown

**Blackboard tuning:** Heavy combo sequencing, threat scoring, focus fire coordination. The Conclave's army fights like a coordinated raid group, not a mass of soldiers.

**Counter-strategy:** Overwhelming numbers. The Conclave has few units — if you can force a sustained brawl, they run out of combo cooldowns and their small army gets ground down. Also: spreading out to prevent AoE combos from hitting multiple units.

**Difficulty scaling:** Easy Conclave wastes primers (applies Wet then follows with Fire, evaporating it). Hard Conclave chains perfect combos every time and focus-fires your most important unit with scary precision.

---

## 8. Implementation Priority

### Phase 1 — Foundation (Do First)
1. **TacticalGroup class** — army grouping, phase state machine, centroid computation
2. **Boids movement layer** — separation/alignment/cohesion forces blended into existing handleMoving()
3. **Role-based force weights** — tanks drift front, ranged drift back, during march
4. **March → Engage transition** — detect enemies, switch to combat forces

### Phase 2 — Combat Coordination
5. **Shared blackboard** — threat map, claimed targets, front-line position
6. **Coordinated peel** — one tank per threat, no double-peeling
7. **Kite-toward-tanks** — modify findKiteTile() to bias toward blackboard's tank line
8. **Diver flank routing** — assassins/riders get waypoints around the engagement
9. **Retreat logic** — army disengages when below strength threshold

### Phase 3 — Status Effects & Combos
10. **Status effect system** — apply, tick, expire, stack, visual indicators
11. **Elemental primers** — Wet, Burning, Chilled, Charged on mage attacks
12. **Combo triggers** — detect primer + trigger, resolve combo effect
13. **Mage spell schools** — water/fire/ice/lightning loadouts
14. **AI combo sequencing** — blackboard tracks primers, queues finishers

### Phase 4 — Tribe Personalities
15. **Armor type system** — light/medium/heavy damage multipliers
16. **Horde AI profile** — swarm boids weights, mass cheap units
17. **Legion AI profile** — rigid formation controller, terrain exploitation
18. **Conclave AI profile** — utility scoring, combo planning, focus fire

### Phase 5 — Polish
19. **Difficulty scaling** — per-tribe easy/medium/hard behavior variants
20. **Visual feedback** — status effect particles, combo flash effects, formation indicators
21. **Player micro tools** — formation presets, focus-fire commands, hold position toggle
22. **Balance tuning** — armor multipliers, combo damage numbers, status durations

---

## 9. Open Design Questions

**Q: Should mage schools be chosen at spawn or upgradeable?**
Option A: Chosen at spawn (4 separate mage "types" from the wizard tower). Simple, clear.
Option B: All mages start generic and specialize mid-game via a research/upgrade. More strategic depth but more UI complexity.

**Q: Should combos be purely AI/auto or require player input?**
Option A: Fully automatic — if a primer exists and a finisher is in range, it fires. Easy for players, AI and players play identically.
Option B: Manual for players, auto for AI — players must target primers deliberately. Higher skill ceiling but might feel clunky.
Option C: Auto with player override — combos fire automatically but players can hold/redirect them. Best of both worlds, most complex to implement.

**Q: How many units should an "army" be?**
Small armies (6-10) allow deeper micro but less spectacle. Large armies (20-30) look amazing but make individual unit control impossible. The combo system rewards smaller, more deliberate armies — each mage cast matters more when you have 3 mages, not 15. Suggest: 8-15 units per army group, with 1-3 groups per player max.

**Q: Should tribes be a player choice or map-determined?**
Choice = more replayability from deliberate strategy. Map-determined = AI opponents feel more like distinct factions. Could do both: player always chooses, AI tribes are pre-set per map or randomized.

**Q: What about berserker in the dive role — is the axe throw too good?**
Range 7 + slow + chase boost means a berserker can reliably solo any archer. The counter should be: tanks body-block the charge, archers kite during the slow duration, or another berserker throws an axe at the berserker (mirror matchup). If berserker axe throw only works once per target (current), that's already a natural limiter — they can't just spam axes at the same archer.
