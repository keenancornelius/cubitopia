import { UnitType } from '../types';

export const GAME_CONFIG = {
  population: {
    foodPerCombatUnit: 2,   // 2 food per combat unit (was 3 — lets early armies feel larger)
    startingFood: 10,       // Starting food — enough for 5 combat units
    baseFoodBonus: 4,       // Bonus food from base tier (Camp=0, Fort=4, Castle=8)
    farmhouseFoodBonus: 3,  // Each farmhouse adds +3 to effective food storage
    farmhouseYieldBonus: 1, // Each farmhouse adds +1 food yield to nearby farm patches
    farmhouseRadius: 6,     // Hex radius for farmhouse yield bonus
    // Morale thresholds — food ratio = effectiveFood / foodNeeded
    morale: {
      starvingThreshold: 0.5,   // Below 50% food ratio → starving (heavy debuff)
      hungryThreshold: 0.8,     // Below 80% food ratio → hungry (mild debuff)
      wellFedThreshold: 1.5,    // Above 150% food ratio → well-fed (bonus)
      starvingModifier: 0.7,    // 30% penalty to attack/move speed when starving
      hungryModifier: 0.85,     // 15% penalty when hungry
      wellFedModifier: 1.1,     // 10% bonus when well-fed
      normalModifier: 1.0,      // No change in normal range
      starvingHealthDrain: 0.5, // HP/sec drain on combat units when starving
    },
  },

  defenses: {
    wall: {
      cost: { stone: 1 },
      maxHealth: 20,
    },
    gate: {
      cost: { stone: 2 },
      maxHealth: 20,
    },
    barracks: {
      maxHealth: 250,
    },
  },

  units: {
    [UnitType.WARRIOR]: {
      costs: {
        menu: { gold: 5 },
        tooltipQueue: { gold: 5 },
        ai: { gold: 5 },
      },
      aiWeight: 20,
    },
    [UnitType.ARCHER]: {
      costs: {
        menu: { gold: 8 },
        tooltipQueue: { gold: 8 },
        ai: { gold: 8 },
      },
      aiWeight: 15,
    },
    [UnitType.RIDER]: {
      costs: {
        menu: { gold: 10 },
        tooltipQueue: { gold: 10 },
        ai: { gold: 10 },
      },
      aiWeight: 8,
    },
    [UnitType.PALADIN]: {
      costs: {
        menu: { gold: 12, crystal: 2 },
        tooltipQueue: { gold: 6, crystal: 1 },
        ai: { gold: 12, crystal: 1 },
      },
      aiWeight: 8,
    },
    [UnitType.TREBUCHET]: {
      costs: {
        playerQueue: { wood: 5, stone: 5, rope: 3 },
        tooltipQueue: { wood: 4, stone: 4, rope: 6 },
        ai: { gold: 15 },
      },
      aiWeight: 4,
    },
    [UnitType.SCOUT]: {
      costs: {
        menu: { gold: 6 },
        tooltipQueue: { wood: 4 },
        ai: { gold: 6 },
      },
      aiWeight: 10,
    },
    [UnitType.MAGE]: {
      costs: {
        menu: { gold: 8, crystal: 2 },
        ai: { gold: 9, crystal: 1 },
      },
      aiWeight: 7,
    },
    [UnitType.BUILDER]: {
      costs: {
        menu: { wood: 3 },
        tooltipQueue: { wood: 4 },
      },
    },
    [UnitType.LUMBERJACK]: {
      costs: {
        menu: { wood: 3 },
        tooltipQueue: { wood: 3 },
      },
    },
    [UnitType.VILLAGER]: {
      costs: {
        menu: { wood: 3 },
        tooltipQueue: { wood: 3 },
      },
    },
    [UnitType.HEALER]: {
      costs: {
        menu: { gold: 6, crystal: 1 },
        ai: { gold: 10, crystal: 1 },
      },
      aiWeight: 8,
    },
    [UnitType.ASSASSIN]: {
      costs: {
        menu: { gold: 7, steel: 1 },
        ai: { gold: 13, steel: 1 },
      },
      aiWeight: 5,
    },
    [UnitType.SHIELDBEARER]: {
      costs: {
        menu: { gold: 8, steel: 3 },
        ai: { gold: 11, steel: 1 },
      },
      aiWeight: 7,
    },
    [UnitType.BERSERKER]: {
      costs: {
        menu: { gold: 7, steel: 2 },
        ai: { gold: 14, steel: 1 },
      },
      aiWeight: 6,
    },
    [UnitType.BATTLEMAGE]: {
      costs: {
        menu: { gold: 12, crystal: 3 },
        ai: { gold: 15, crystal: 1 },
      },
      aiWeight: 5,
    },
    [UnitType.GREATSWORD]: {
      costs: {
        menu: { gold: 8, steel: 2 },
        ai: { gold: 12, steel: 1 },
      },
      aiWeight: 7,
    },
    [UnitType.OGRE]: {
      costs: {},
    },
  },

  buildings: {
    barracks: {
      cost: {
        player: { wood: 10, stone: 0, steel: 0, crystal: 0 },
        ai: { wood: 10, stone: 0, steel: 0, crystal: 0 },
      },
      refund: { wood: 5 },
      spawnTime: 5,
    },
    forestry: {
      cost: {
        player: { wood: 8, stone: 0, steel: 0, crystal: 0 },
        ai: { wood: 8, stone: 0, steel: 0, crystal: 0 },
      },
      refund: { wood: 4 },
      spawnTime: 5,
    },
    masonry: {
      cost: {
        player: { wood: 8, stone: 0, steel: 0, crystal: 0 },
        ai: { wood: 10, stone: 0, steel: 0, crystal: 0 },
      },
      refund: { wood: 5 },
      spawnTime: 5,
    },
    farmhouse: {
      cost: {
        player: { wood: 6, stone: 0, steel: 0, crystal: 0 },
        ai: { wood: 8, stone: 0, steel: 0, crystal: 0 },
      },
      refund: { wood: 4 },
      spawnTime: 5,
    },
    workshop: {
      cost: {
        player: { wood: 12, stone: 4, steel: 0, crystal: 0 },
        ai: { wood: 15, stone: 5, steel: 0, crystal: 0 },
      },
      refund: { wood: 8 },
      spawnTime: 8,
    },
    silo: {
      cost: {
        player: { wood: 5, stone: 0, steel: 0, crystal: 0 },
        ai: { wood: 6, stone: 0, steel: 0, crystal: 0 },
      },
      refund: { wood: 3 },
    },
    smelter: {
      cost: {
        player: { wood: 8, stone: 6, steel: 0, crystal: 0 },
        ai: { wood: 8, stone: 6, steel: 0, crystal: 0 },
      },
      refund: { wood: 4 },
    },
    armory: {
      cost: {
        player: { wood: 10, stone: 5, steel: 3, crystal: 0 },
        ai: { wood: 10, stone: 5, steel: 3, crystal: 0 },
      },
      refund: { wood: 5 },
      spawnTime: 6,
    },
    wizard_tower: {
      cost: {
        player: { wood: 10, stone: 5, steel: 0, crystal: 3 },
        ai: { wood: 10, stone: 5, steel: 0, crystal: 3 },
      },
      refund: { wood: 5 },
      spawnTime: 7,
    },
  },

  combat: {
    unitAI: {
      detectionRanges: {
        [UnitType.ARCHER]: 6,
        [UnitType.PALADIN]: 5,
        [UnitType.SCOUT]: 7,
        [UnitType.RIDER]: 4,
        [UnitType.TREBUCHET]: 7,
        [UnitType.HEALER]: 5,
        [UnitType.ASSASSIN]: 6,
        [UnitType.SHIELDBEARER]: 3,
        [UnitType.BERSERKER]: 5,
        [UnitType.BATTLEMAGE]: 6,
        [UnitType.GREATSWORD]: 4,
        default: 4,
      },
      kiteTriggerBonus: 1,
      moveReaggro: {
        squadAttackMoveBonus: 2,
        defensiveBonus: 1,
      },
      miningPriorities: {
        crystal: { threshold: 4, criticalThreshold: 1, urgency: 12, criticalUrgency: 20 },
        iron: { threshold: 4, criticalThreshold: 1, urgency: 10, criticalUrgency: 18 },
        gold: { threshold: 8, criticalThreshold: 2, urgency: 9, criticalUrgency: 16 },
        clay: { threshold: 4, criticalThreshold: 1, urgency: 8, criticalUrgency: 15 },
        stone: { threshold: 10, criticalThreshold: 3, urgency: 5, criticalUrgency: 14, fallbackUrgency: 3 },
        steelDependencyThreshold: 3,
        charcoalDependencyThreshold: 3,
      },
      miningSearch: {
        minBaseDistance: 4,
        maxRangeStone: 12,
        maxRangeRare: 20,
        maxReachFactor: 0.7,
        clusterClaimBonus: -2,
        clusterCaveBonus: -1,
        buddyDistance: 4,
        buddyBonus: -3,
        idealBaseDistanceStone: 6,
        idealBaseDistanceRare: 8,
        baseDistancePenaltyFactor: 0.8,
        travelPenaltyFactor: 0.6,
      },
      builder: {
        wallBuildCooldown: 1.5,
      },
    },
    highGround: {
      threshold: 3,
      attackBonus: 2,
      defenseBonus: 2,
    },
    damage: {
      attackerMultiplier: 4.5,
      counterMultiplier: 3.5,
    },
    block: {
      baseChance: 0.1,
      defenseScaling: 0.05,
      baseCap: 0.55,
      shieldBonus: 0.15,
      finalCap: 0.65,
      damageMultiplier: 0.35,
    },
    deflect: {
      damageMultiplier: 0.2,
    },
    experience: {
      kill: 3,
      hit: 1,
      levelThresholdMultiplier: 5,
      levelUpHealRatio: 0.3,
    },
    healer: {
      projectileCooldown: 2.0,
      healAmount: 3,
    },
    berserker: {
      axeThrowDamageMultiplier: 0.4,
      rageAttackBonusMax: 4,
    },
    assassin: {
      fullHealthAttackBonus: 3,
    },
    paladin: {
      auraRange: 2,
      auraDefenseBonus: 2,
    },
    battlemage: {
      splashRadius: 1,
      splashDamageMultiplier: 0.4,   // Low AoE damage — battlemage is a setup caster, not a DPS
      cyclonePullRadius: 2,
      cyclonePullDamageMultiplier: 0.15, // Cyclone pull is for CC not damage
      cycloneCooldown: 8,
    },
    mageSynergy: {
      proximityRange: 3,
      minMages: 2,
      cooldown: 12,
      damagePerMage: 4,
      effectRadius: 2,
    },
    statusEffects: {
      // ── BALANCE TARGETS ──
      // Base spells = weak. Only combos chunk.
      // Full combo on squishy (8 HP) ≈ 90% = ~7 HP total.
      // Full combo on tank (18 HP) ≈ 50% = ~9 HP total.
      // Mage base attack = 5. After CombatSystem.resolve vs squishy, base hit ≈ 3-4.
      // So combo bonus needs to add ~3-5 more on top of base hit.

      // --- Mage status effects ---
      wet: {
        duration: 5,                  // seconds the Wet status lasts — just a marker, no damage
      },
      ablaze: {
        duration: 4,                  // seconds (down from 6) — shorter burn window
        dps: 0.3,                     // burn DPS (down from 1.5) — total burn ≈ 1.2 HP. Negligible alone.
      },

      // --- Mage combo interactions ---
      // Wet + Lightning → Electrocute Crit: chain lightning to nearby enemies
      electrocuteCrit: {
        chainRadius: 3,               // hex radius for chain spread (up from 2 for better group hits)
        chainCount: 3,                // max chain targets
        damageMultiplier: 0.8,        // 0.8× Mage ATK = 4 per chain. Primary gets normal combat damage only.
      },
      // Ablaze + Wind → Inferno: consumes burn, big burst + fire spread
      inferno: {
        spreadRadius: 2,              // hex radius to spread Ablaze
        spreadCount: 3,               // max targets to spread to
        burstDamage: 4,               // burst on primary. Total = combat(~4) + burst(4) = ~8 = near-kill on squishy.
      },
      // Water + Ablaze → Soothe (anti-synergy): consumes Ablaze, heals enemy
      soothe: {
        healAmount: 3,                // HP restored (down from 4)
      },

      // --- Battlemage AoE status effects ---
      battlemageWetSplashDamageMultiplier: 0.15, // Water AoE = almost no damage, just applies Wet to group
      knockup: {
        duration: 1.2,                // seconds airborne — brief CC, can't move or attack
      },
      arcane: {
        duration: 6,                  // seconds the purple Arcane orbs persist (from BM Earth AoE)
      },
      highVoltage: {
        duration: 6,                  // seconds High Voltage persists (from BM Lightning AoE)
        cascadeDamageMultiplier: 1.2, // 120% crit damage on arc cascade
        cascadeChainCount: 3,         // how many enemies the cascade arcs to
        cascadeChainRadius: 3,        // hex radius for cascade chain targets
        stunDuration: 1.0,            // seconds of stun (knockup) from cascade
      },

      // --- Cross-class combos ---
      // Arcane (Battlemage Earth) + Lightning (Mage) → Kamehameha piercing laser
      kamehameha: {
        damageMultiplier: 1.0,        // 1.0× Mage ATK = 5 per pierce. Primary = combat(~4)+laser(5) = ~9. Kills squishy, halves tank.
        pierceCount: 4,               // max enemies the beam can pierce through
        beamRange: 5,                 // hex range of the laser beam
      },

      // --- Healer Cleanse ---
      cleanse: {
        cooldown: 8,                  // seconds between cleanse casts
        speedBoostDuration: 2.5,      // seconds the speed boost lasts after cleanse
        speedBoostFactor: 1.5,        // 50% faster movement during boost
        lingerDuration: 3,            // seconds of status immunity after cleanse
      },
    },
    greatsword: {
      cleaveRadius: 1,
      cleaveDamageMultiplier: 0.6,
      knockbackDistance: 1,
    },
    ogre: {
      swipeRadius: 2,
      swipeDamageMultiplier: 0.7,
      knockbackDistance: 1,
    },
    shieldbearer: {
      bashKnockbackDistance: 1,
    },
  },

  timers: {
    ai: {
      economyTick: 3,
      combatSpawn: 5,
      workerSpawn: 4,
      autoMarchStart: 3,
      commanderTick: 1.0,
    },
    nature: {
      maxHarvests: 3,
      treeRegrowTime: 12,
      treeGrowthTime: 10,
      treeSproutInterval: 5,
      treeSproutChance: 0.2,
      regrowHarvestScale: 0.5,
      /** Forestry building aura */
      forestryAuraRadius: 8,         // hex distance — tiles within this of a forestry get bonuses
      forestryRegrowMultiplier: 0.4, // regrow timer ×0.4 (2.5× faster) near a forestry
      forestryGrowthMultiplier: 0.5, // growth timer ×0.5 (2× faster) near a forestry
      forestryExtraHarvests: 3,      // +3 harvests before exhaustion (6 total near forestry)
      forestryAutoPlantInterval: 8,  // seconds between auto-planting a sapling nearby
      forestryAutoPlantRadius: 5,    // max hex distance for auto-planting
      forestryWoodTrickle: 1,        // passive wood per forestry per trickle tick
      forestryTrickleInterval: 15,   // seconds between trickle income
      grassGrowthTime: 8,
      grassSpreadInterval: 6,
      grassSpreadChance: 0.15,
      grassSpreadMaxPerTick: 3,
      initialGrassMatureChance: 0.5,
      grassSpreadElevationCap: 3.0,
    },
  },

  formation: {
    boxMaxRadius: 5,
    wedgeMaxRows: 6,
    circleMaxRadius: 5,
    aiRangedLineThreshold: 0.5,
    aiWedgeMinUnits: 5,
    aiMarchSpeedCatchupFactor: 0.35,
    priorities: {
      [UnitType.PALADIN]: 0,
      [UnitType.WARRIOR]: 1,
      [UnitType.RIDER]: 2,
      [UnitType.LUMBERJACK]: 3,
      [UnitType.BUILDER]: 3,
      [UnitType.VILLAGER]: 3,
      [UnitType.ARCHER]: 4,
      [UnitType.MAGE]: 4,
      [UnitType.TREBUCHET]: 5,
      [UnitType.SCOUT]: 5,
      default: 3,
    },
    aiPriorities: {
      [UnitType.PALADIN]: 0,
      [UnitType.GREATSWORD]: 0,
      [UnitType.SHIELDBEARER]: 0,
      [UnitType.WARRIOR]: 1,
      [UnitType.BERSERKER]: 1,
      [UnitType.RIDER]: 2,
      [UnitType.LUMBERJACK]: 3,
      [UnitType.BUILDER]: 3,
      [UnitType.VILLAGER]: 3,
      [UnitType.ARCHER]: 4,
      [UnitType.MAGE]: 4,
      [UnitType.BATTLEMAGE]: 4,
      [UnitType.ASSASSIN]: 5,
      [UnitType.SCOUT]: 5,
      [UnitType.HEALER]: 6,
      [UnitType.TREBUCHET]: 7,
      default: 3,
    },
  },

  economy: {
    trade: {
      sellWoodThreshold: 15,
      sellWood: {
        input: { wood: 4 },
        output: { gold: 5 },
      },
      combatRewards: {
        unitKillGold: 3,
        siegeKillGold: 5,
      },
      tradeRoute: {
        goldPerDelivery: 2,       // bonus gold when worker deposits at a non-home base
        proximityRadius: 3,       // hex distance to count as "near" a base
        minBases: 2,              // player must own at least this many bases for trade to activate
      },
    },
    recipes: {
      rope: {
        input: { grass_fiber: 3, clay: 2 },
        output: { rope: 1 },
      },
      charcoal: {
        input: { wood: 3, clay: 2 },
        output: { charcoal: 2 },
      },
      steel: {
        input: { iron: 2, charcoal: 1 },
        output: { steel: 1 },
      },
    },
    harvest: {
      crops: {
        foodYield: 3,
      },
      tree: {
        plantCost: { wood: 1 },
        woodYieldByAge: {
          sapling: 2,
          young: 4,
          mature: 6,
        },
      },
      grass: {
        hayBase: 2,
        hayVariance: 2,
        fiberBase: 1,
        fiberVariance: 2,
      },
    },
    mining: {
      defaultBlockYield: 1,
      crystalYield: 3,
    },
    ai: {
      charcoalTarget: 5,
      steelTarget: 5,
      workerCaps: {
        lumberjack: 4,
        builder: 4,
        villager: 3,
      },
      spawnQueue: {
        baseSize: 3,
        maxSize: 8,
      },
    },
  },

  captureZone: {
    captureDuration: 20,       // seconds for full capture
    zoneRadius: 5,             // hex radius of capture zone
    minAdvantage: 1,           // minimum unit advantage to make progress
  },

  tacticalGroup: {
    minMusterSize: 3,          // minimum army size to start marching (was 2 — too easy to send solo pairs)
    maxMusterWait: 6,          // seconds before marching with partial army (was 8 — get moving faster)
    reformDelay: 2.5,          // seconds without enemy contact before reforming (was 4 — resume march faster)
    retreatThreshold: 0.35,    // health-weighted strength ratio to retreat
    contactRange: 10,          // hex range to detect enemies during march (was hardcoded 8)
  },

  gather: {
    builderMineCooldown: 0.8,  // seconds between builder mine swings
    villagerGrassCooldown: 2.0,// seconds for grass gathering (was 2.5 — reworked for multi-harvest)
    villagerFarmCooldown: 3.0, // seconds for farm crop gathering (was 4.0 — reworked for multi-harvest)
    lumberjackChopCooldown: 2.0, // seconds between tree chops (was 3.0 — reworked for multi-chop)
    initialConstructionDelay: 0.5, // seconds before first construction tick
    constructionRate: 0.125,   // progress per tick (1/8 = 8 seconds to build)
    constructionCooldown: 1.0, // seconds between construction ticks
    wallBuildCooldown: 1.5,    // seconds between wall placements
    healerCastDelay: 1200,     // ms for healer cast animation
    workerFleeRange: 4,        // hex range for enemy detection flee
    workerGroupFleeRange: 5,   // hex range for group flee
    workerFleeDistance: 3,     // hex distance to flee from base
  },
} as const;
