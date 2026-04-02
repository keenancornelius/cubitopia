// ============================================
// CUBITOPIA — Base Upgrade System
// Handles base tier progression (Camp → Fort → Castle)
// and Ogre reward unit spawning on tier-up.
// ============================================

import { Base, BaseTier, HexCoord, BuildingKind, PlacedBuilding } from '../../types';

// --- Tier thresholds ---
// Each tier requires BOTH a population count AND unique building types in the base's zone.
export const BASE_TIER_CONFIG = {
  [BaseTier.CAMP]: {
    name: 'Camp',
    populationRequired: 0,
    uniqueBuildingsRequired: 0,
  },
  [BaseTier.FORT]: {
    name: 'Fort',
    populationRequired: 30,
    uniqueBuildingsRequired: 3,
  },
  [BaseTier.CASTLE]: {
    name: 'Castle',
    populationRequired: 60,
    uniqueBuildingsRequired: 6,
  },
};

// Tier 3 (max) — not in config because there's no tier above it
export const TIER_3_REQUIREMENTS = {
  name: 'Citadel',
  populationRequired: 90,
  uniqueBuildingsRequired: 9,  // All building types
};

/** All 9 building kinds that count toward tier requirements (excludes walls/gates) */
export const TIER_BUILDING_KINDS: BuildingKind[] = [
  'barracks', 'forestry', 'masonry', 'farmhouse', 'workshop',
  'silo', 'smelter', 'armory', 'wizard_tower',
];

/** Capture zone radius for counting buildings near a base */
const ZONE_RADIUS = 5;

/** Event emitted when a base upgrades */
export interface BaseUpgradeEvent {
  baseId: string;
  owner: number;
  previousTier: BaseTier;
  newTier: BaseTier;
  basePosition: HexCoord;
}

/** Slim ops interface — keeps this module decoupled from main.ts */
export interface BaseUpgradeOps {
  getBases(): Base[];
  getPlacedBuildings(): PlacedBuilding[];
  getTotalUnitCount(owner: number): number;
  hexDistance(a: HexCoord, b: HexCoord): number;
}

export class BaseUpgradeSystem {
  private ops: BaseUpgradeOps;

  constructor(ops: BaseUpgradeOps) {
    this.ops = ops;
  }

  /**
   * Count unique building kinds within a base's capture zone.
   * Only counts buildings owned by the same player as the base.
   */
  getUniqueBuildingsInZone(base: Base): Set<BuildingKind> {
    const kinds = new Set<BuildingKind>();
    for (const pb of this.ops.getPlacedBuildings()) {
      if (pb.owner !== base.owner) continue;
      const dist = this.ops.hexDistance(pb.position, base.position);
      if (dist <= ZONE_RADIUS) {
        kinds.add(pb.kind);
      }
    }
    return kinds;
  }

  /**
   * Get the tier name for display.
   */
  getTierName(tier: BaseTier): string {
    if (tier === BaseTier.CAMP) return 'Camp';
    if (tier === BaseTier.FORT) return 'Fort';
    return 'Castle';
  }

  /**
   * Get the next tier's requirements for a base. Returns null if already max tier.
   */
  getNextTierRequirements(base: Base): { name: string; populationRequired: number; uniqueBuildingsRequired: number } | null {
    if (base.tier >= BaseTier.CASTLE) return null;
    const nextTier = (base.tier + 1) as BaseTier;
    if (nextTier === BaseTier.FORT) return BASE_TIER_CONFIG[BaseTier.FORT];
    if (nextTier === BaseTier.CASTLE) return BASE_TIER_CONFIG[BaseTier.CASTLE];
    return null;
  }

  /**
   * Check if a base qualifies for a tier upgrade. Returns upgrade event or null.
   * Called after unit spawns, building placements, or capture events.
   */
  checkUpgrade(base: Base): BaseUpgradeEvent | null {
    if (base.destroyed) return null;
    if (base.tier >= BaseTier.CASTLE) return null;  // Already max

    const nextTier = (base.tier + 1) as BaseTier;
    let popRequired: number;
    let buildingsRequired: number;

    if (nextTier === BaseTier.FORT) {
      popRequired = BASE_TIER_CONFIG[BaseTier.FORT].populationRequired;
      buildingsRequired = BASE_TIER_CONFIG[BaseTier.FORT].uniqueBuildingsRequired;
    } else if (nextTier === BaseTier.CASTLE) {
      popRequired = BASE_TIER_CONFIG[BaseTier.CASTLE].populationRequired;
      buildingsRequired = BASE_TIER_CONFIG[BaseTier.CASTLE].uniqueBuildingsRequired;
    } else {
      return null;
    }

    const totalPop = this.ops.getTotalUnitCount(base.owner);
    const uniqueBuildings = this.getUniqueBuildingsInZone(base);

    if (totalPop >= popRequired && uniqueBuildings.size >= buildingsRequired) {
      const previousTier = base.tier;
      base.tier = nextTier;
      return {
        baseId: base.id,
        owner: base.owner,
        previousTier,
        newTier: nextTier,
        basePosition: base.position,
      };
    }

    return null;
  }

  /**
   * Check ALL bases for a given owner for tier upgrades. Returns all upgrade events.
   * Call this periodically (e.g. after spawns or building placements).
   */
  checkAllUpgrades(owner: number): BaseUpgradeEvent[] {
    const events: BaseUpgradeEvent[] = [];
    for (const base of this.ops.getBases()) {
      if (base.owner !== owner || base.destroyed) continue;
      // Check repeatedly in case a base skips a tier (unlikely but safe)
      let evt = this.checkUpgrade(base);
      while (evt) {
        events.push(evt);
        evt = this.checkUpgrade(base);
      }
    }
    return events;
  }

  /**
   * Initialize a newly captured base to Camp tier.
   */
  initCapturedBase(base: Base): void {
    base.tier = BaseTier.CAMP;
    base.ogresSpawned = 0;
  }

  cleanup(): void {
    // Stateless — nothing to clean up
  }
}
