// ============================================
// CUBITOPIA — Base Upgrade System
// Handles base tier progression (Camp → Fort → Castle → Citadel)
// and reward unit spawning on tier-up.
// ============================================

import { Base, BaseTier, HexCoord, BuildingKind, PlacedBuilding } from '../../types';

// --- Tier thresholds ---
// Each tier requires BOTH a population count AND unique building types in the base's zone.
export const BASE_TIER_CONFIG: Record<number, { name: string; populationRequired: number; uniqueBuildingsRequired: number }> = {
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
  [BaseTier.CITADEL]: {
    name: 'Citadel',
    populationRequired: 90,
    uniqueBuildingsRequired: 9,  // All building types
  },
};

/** Max tier — no upgrades beyond this */
const MAX_TIER = BaseTier.CITADEL;

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
  playSound(name: string, volume?: number): void;
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
    return BASE_TIER_CONFIG[tier]?.name ?? 'Camp';
  }

  /**
   * Get the next tier's requirements for a base. Returns null if already max tier.
   */
  getNextTierRequirements(base: Base): { name: string; populationRequired: number; uniqueBuildingsRequired: number } | null {
    if (base.tier >= MAX_TIER) return null;
    const nextTier = (base.tier + 1) as BaseTier;
    return BASE_TIER_CONFIG[nextTier] ?? null;
  }

  /**
   * Check if a base qualifies for a tier upgrade. Returns upgrade event or null.
   * Called after unit spawns, building placements, or capture events.
   */
  checkUpgrade(base: Base): BaseUpgradeEvent | null {
    if (base.destroyed) return null;
    if (base.tier >= MAX_TIER) return null;  // Already max

    const nextTier = (base.tier + 1) as BaseTier;
    const req = BASE_TIER_CONFIG[nextTier];
    if (!req) return null;

    const totalPop = this.ops.getTotalUnitCount(base.owner);
    const uniqueBuildings = this.getUniqueBuildingsInZone(base);

    if (totalPop >= req.populationRequired && uniqueBuildings.size >= req.uniqueBuildingsRequired) {
      const previousTier = base.tier;
      base.tier = nextTier;
      this.ops.playSound('tier_upgrade', 0.6);
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
