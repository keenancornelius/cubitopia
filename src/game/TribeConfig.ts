// ============================================
// CUBITOPIA — Tribe Configuration
// Data-driven tribe definitions: visual identity, color palettes,
// unit model overrides, building styles, and music genre linkage.
// Foundation for Stripe cosmetic monetization.
// ============================================

// ─── Tribe IDs ──────────────────────────────────────────────
// Each tribe maps 1:1 to a music genre folder.
// The id doubles as the music genre key for ProceduralMusic.ts.

export type TribeId =
  | 'fantasy'      // Ironveil (Stoneguard)
  | 'metal'        // Wildborne
  | 'orchestral'   // Arcanists
  | 'celtic'       // Tidecallers
  | 'electronic'   // Forgeborn
  | 'hiphop'       // Sandstriders
  | 'lofi'         // Mistwalkers
  | 'oldies'       // Embercrown
  | 'alternative'; // Voidtouched

// ─── Color Palette ──────────────────────────────────────────

export interface TribePalette {
  /** Primary team color (used for unit highlights, flags, UI). Hex number. */
  primary: number;
  /** Secondary color (used for armor tints, building accents). */
  secondary: number;
  /** Accent color (buckles, trim, ornamental details). */
  accent: number;
  /** Metallic trim color (pauldron edges, weapon guards). */
  trim: number;
  /** CSS string of primary (for UI elements). */
  primaryCSS: string;
  /** CSS string of secondary (for UI elements). */
  secondaryCSS: string;
}

// ─── Unit Model Overrides ───────────────────────────────────

export type HelmStyle = 'bascinet' | 'barbute' | 'horned' | 'pointed' | 'crown' | 'hood' | 'circlet' | 'turban' | 'voidmask';
export type ArmorStyle = 'plate' | 'chainmail' | 'leather' | 'robes' | 'scale' | 'coral' | 'crystal' | 'sandcloth' | 'shadow';
export type WeaponVariant = 'sword' | 'axe' | 'hammer' | 'staff' | 'trident' | 'gauntlet' | 'scimitar' | 'dagger' | 'voidblade';

export interface TribeUnitOverrides {
  /** Default helm style for warriors/paladins/shieldbearers. */
  helmStyle: HelmStyle;
  /** Default armor appearance for melee units. */
  armorStyle: ArmorStyle;
  /** Primary melee weapon variant. */
  meleeWeapon: WeaponVariant;
  /** Primary ranged weapon variant (archers/rangers). */
  rangedWeapon: WeaponVariant;
  /** Mage weapon variant. */
  mageWeapon: WeaponVariant;
}

// ─── Building Style ─────────────────────────────────────────

export type BuildingStyleTag =
  | 'fortress'    // Ironveil — heavy stone, angular
  | 'wilderness'  // Wildborne — logs, beast dens, organic
  | 'arcane'      // Arcanists — towers, floating crystals
  | 'coastal'     // Tidecallers — domes, coral, driftwood
  | 'industrial'  // Forgeborn — iron, gears, smokestacks
  | 'desert'      // Sandstriders — sandstone, arches, tents
  | 'ethereal'    // Mistwalkers — mist-shrouded, paper lanterns
  | 'classical'   // Embercrown — marble, columns, braziers
  | 'void';       // Voidtouched — obsidian, rifts, floating shards

// ─── Full Tribe Config ──────────────────────────────────────

export interface TribeConfig {
  /** Unique tribe identifier (matches music genre id). */
  id: TribeId;
  /** Display name shown in tribe selector. */
  name: string;
  /** One-line tribe fantasy/gameplay description. */
  description: string;
  /** Menu button icon (emoji). */
  icon: string;
  /** Whether this tribe is playable (unlocked). */
  playable: boolean;
  /** Visual color palette. */
  palette: TribePalette;
  /** Unit model style overrides. */
  unitOverrides: TribeUnitOverrides;
  /** Building mesh style tag. */
  buildingStyle: BuildingStyleTag;
  /** Music genre folder name (under public/music/). */
  musicFolder: string;
}

// ─── Tribe Definitions ──────────────────────────────────────

export const TRIBES: readonly TribeConfig[] = [
  // ── 1. IRONVEIL (Stoneguard) ──────────────────────────────
  {
    id: 'fantasy',
    name: 'Ironveil',
    description: 'Tanks, mages, and healers — outlast through steel and sorcery',
    icon: '\uD83D\uDEE1\uFE0F', // 🛡️
    playable: true,
    palette: {
      primary: 0x3498db,    // Steel blue
      secondary: 0x9e9e9e,  // Polished steel
      accent: 0xb8860b,     // Brass/gold
      trim: 0xffd700,       // Bright gold
      primaryCSS: '#3498db',
      secondaryCSS: '#9e9e9e',
    },
    unitOverrides: {
      helmStyle: 'bascinet',
      armorStyle: 'plate',
      meleeWeapon: 'sword',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'fortress',
    musicFolder: 'fantasy',
  },

  // ── 2. WILDBORNE ──────────────────────────────────────────
  {
    id: 'metal',
    name: 'Wildborne',
    description: 'Aggressive nature tribe — berserkers and beast dens',
    icon: '\uD83D\uDC3A', // 🐺
    playable: true,
    palette: {
      primary: 0xe74c3c,    // Blood red
      secondary: 0x5d4037,  // Dark wood brown
      accent: 0x8d6e63,     // Bark tan
      trim: 0xcd7f32,       // Bronze
      primaryCSS: '#e74c3c',
      secondaryCSS: '#5d4037',
    },
    unitOverrides: {
      helmStyle: 'horned',
      armorStyle: 'leather',
      meleeWeapon: 'axe',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'wilderness',
    musicFolder: 'metal',
  },

  // ── 3. ARCANISTS ──────────────────────────────────────────
  {
    id: 'orchestral',
    name: 'Arcanists',
    description: 'Ranged magic wielders — battlemages and mana wells',
    icon: '\uD83D\uDD2E', // 🔮
    playable: true,
    palette: {
      primary: 0x9b59b6,    // Mystic purple
      secondary: 0x1a1a2e,  // Dark indigo
      accent: 0xffd700,     // Arcane gold
      trim: 0xc0c0ff,       // Pale violet shimmer
      primaryCSS: '#9b59b6',
      secondaryCSS: '#1a1a2e',
    },
    unitOverrides: {
      helmStyle: 'pointed',
      armorStyle: 'robes',
      meleeWeapon: 'staff',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'arcane',
    musicFolder: 'orchestral',
  },

  // ── 4. TIDECALLERS ────────────────────────────────────────
  {
    id: 'celtic',
    name: 'Tidecallers',
    description: 'Naval traders — sea raiders and coastal dominance',
    icon: '\uD83C\uDF0A', // 🌊
    playable: true,
    palette: {
      primary: 0x3498db,    // Ocean blue
      secondary: 0x1abc9c,  // Teal
      accent: 0xe0e0e0,     // Seafoam white
      trim: 0xf0c040,       // Coral gold
      primaryCSS: '#3498db',
      secondaryCSS: '#1abc9c',
    },
    unitOverrides: {
      helmStyle: 'barbute',
      armorStyle: 'coral',
      meleeWeapon: 'trident',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'coastal',
    musicFolder: 'celtic',
  },

  // ── 5. FORGEBORN ──────────────────────────────────────────
  {
    id: 'electronic',
    name: 'Forgeborn',
    description: 'Mechanist engineers — siege weapons and automated defenses',
    icon: '\u2699\uFE0F', // ⚙️
    playable: true,
    palette: {
      primary: 0x1abc9c,    // Forge teal
      secondary: 0x424242,  // Dark iron
      accent: 0xff6f00,     // Molten orange
      trim: 0xbdbdbd,       // Brushed steel
      primaryCSS: '#1abc9c',
      secondaryCSS: '#424242',
    },
    unitOverrides: {
      helmStyle: 'crown',
      armorStyle: 'scale',
      meleeWeapon: 'hammer',
      rangedWeapon: 'gauntlet',
      mageWeapon: 'gauntlet',
    },
    buildingStyle: 'industrial',
    musicFolder: 'electronic',
  },

  // ── 6. SANDSTRIDERS ───────────────────────────────────────
  {
    id: 'hiphop',
    name: 'Sandstriders',
    description: 'Desert nomads — swift cavalry and trade caravans',
    icon: '\uD83C\uDFDC\uFE0F', // 🏜️
    playable: true,
    palette: {
      primary: 0xf1c40f,    // Desert gold
      secondary: 0xd4a373,  // Sandstone tan
      accent: 0x8b0000,     // Deep crimson sash
      trim: 0xffd700,       // Gilded
      primaryCSS: '#f1c40f',
      secondaryCSS: '#d4a373',
    },
    unitOverrides: {
      helmStyle: 'turban',
      armorStyle: 'sandcloth',
      meleeWeapon: 'scimitar',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'desert',
    musicFolder: 'hiphop',
  },

  // ── 7. MISTWALKERS ────────────────────────────────────────
  {
    id: 'lofi',
    name: 'Mistwalkers',
    description: 'Enigmatic scholars — stealth and illusion warfare',
    icon: '\uD83C\uDF2B\uFE0F', // 🌫️
    playable: true,
    palette: {
      primary: 0xe67e22,    // Amber lantern
      secondary: 0x263238,  // Mist dark
      accent: 0xfff8e1,     // Pale parchment
      trim: 0x90a4ae,       // Silver grey
      primaryCSS: '#e67e22',
      secondaryCSS: '#263238',
    },
    unitOverrides: {
      helmStyle: 'hood',
      armorStyle: 'robes',
      meleeWeapon: 'dagger',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'ethereal',
    musicFolder: 'lofi',
  },

  // ── 8. EMBERCROWN ─────────────────────────────────────────
  {
    id: 'oldies',
    name: 'Embercrown',
    description: 'Imperial legionnaires — disciplined formations and fire magic',
    icon: '\uD83D\uDD25', // 🔥
    playable: true,
    palette: {
      primary: 0xd4a373,    // Imperial bronze
      secondary: 0x8b0000,  // Crimson cape
      accent: 0xffd700,     // Laurel gold
      trim: 0xf5f5dc,       // Marble white
      primaryCSS: '#d4a373',
      secondaryCSS: '#8b0000',
    },
    unitOverrides: {
      helmStyle: 'crown',
      armorStyle: 'plate',
      meleeWeapon: 'sword',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'classical',
    musicFolder: 'oldies',
  },

  // ── 9. VOIDTOUCHED ────────────────────────────────────────
  {
    id: 'alternative',
    name: 'Voidtouched',
    description: 'Eldritch corrupted — summon void creatures and drain life',
    icon: '\uD83D\uDD73\uFE0F', // 🕳️
    playable: true,
    palette: {
      primary: 0x8e7cc3,    // Void purple
      secondary: 0x1a1a1a,  // Obsidian black
      accent: 0x00e676,     // Toxic green
      trim: 0x6a1b9a,       // Deep violet
      primaryCSS: '#8e7cc3',
      secondaryCSS: '#1a1a1a',
    },
    unitOverrides: {
      helmStyle: 'voidmask',
      armorStyle: 'shadow',
      meleeWeapon: 'voidblade',
      rangedWeapon: 'staff',
      mageWeapon: 'staff',
    },
    buildingStyle: 'void',
    musicFolder: 'alternative',
  },
] as const;

// ─── Lookup Utilities ───────────────────────────────────────

/** Map from TribeId to TribeConfig for O(1) lookup. */
export const TRIBE_BY_ID: ReadonlyMap<TribeId, TribeConfig> = new Map(
  TRIBES.map(t => [t.id, t])
);

/** Get a tribe config by id. Throws if not found. */
export function getTribe(id: TribeId): TribeConfig {
  const tribe = TRIBE_BY_ID.get(id);
  if (!tribe) throw new Error(`Unknown tribe: ${id}`);
  return tribe;
}

/** Get the default/starting tribe (Ironveil). */
export function getDefaultTribe(): TribeConfig {
  return getTribe('fantasy');
}

/** Get all playable tribes (for menu filtering). */
export function getPlayableTribes(): TribeConfig[] {
  return TRIBES.filter(t => t.playable);
}

/** Get the player color (primary palette) for a tribe. Returns hex number. */
export function getTribeColor(id: TribeId): number {
  return getTribe(id).palette.primary;
}
