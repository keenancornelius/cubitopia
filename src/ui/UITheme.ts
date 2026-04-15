/**
 * UITheme — Centralized theme constants and CSS injection for all game UI.
 *
 * Provides a single source of truth for colors, fonts, borders, shadows, and
 * spacing used across HUD, MenuController, BuildingTooltipController, and
 * any other DOM-based UI in the game.
 *
 * Usage:
 *   import { UI } from './UITheme';
 *   el.style.cssText = UI.panel();            // standard panel
 *   el.style.cssText = UI.panel('#e74c3c');   // red-bordered panel
 *   btn.style.cssText = UI.button('#2980b9'); // blue button
 */

// ── Color Palette ──────────────────────────────────────────────
export const COLORS: Record<string, string> = {
  // Backgrounds
  panelBg:      'rgba(20, 20, 30, 0.95)',
  panelBgLight: 'rgba(20, 20, 30, 0.88)',
  panelBgEnemy: 'rgba(30, 15, 15, 0.95)',
  overlayBg:    'rgba(5, 5, 16, 0.92)',
  dropdownBg:   'rgba(10, 10, 18, 0.96)',

  // Borders
  borderDefault: 'rgba(255, 255, 255, 0.2)',
  borderHover:   'rgba(255, 255, 255, 0.35)',
  borderActive:  'rgba(255, 255, 255, 0.4)',
  divider:       'rgba(255, 255, 255, 0.1)',

  // Text
  textPrimary:   '#eee',
  textSecondary: '#aaa',
  textMuted:     '#888',
  textDim:       '#666',

  // Accent colors (game-wide)
  blue:    '#2980b9',
  red:     '#c0392b',
  green:   '#27ae60',
  orange:  '#e67e22',
  yellow:  '#f1c40f',
  purple:  '#9b59b6',
  gray:    '#7f8c8d',
  gold:    '#f0c040',
  cyan:    '#3498db',
  teal:    '#1abc9c',
  steel:   '#71797e',
  brown:   '#8b4513',

  // Status / semantic
  success:  '#2ecc71',
  danger:   '#e74c3c',
  warning:  '#f39c12',
  info:     '#3498db',
};

// ── Typography ─────────────────────────────────────────────────
export const FONT: Record<string, string> = {
  /** Primary UI font — clean, readable at small sizes */
  family:   "'Segoe UI', system-ui, -apple-system, sans-serif",
  /** Monospace font for hotkey badges, code-style text */
  mono:     "'Courier New', Consolas, monospace",

  // Sizes (px)
  xs: '9px',
  sm: '10px',
  md: '12px',
  base: '13px',
  lg: '14px',
  xl: '16px',
  '2xl': '18px',
  '3xl': '24px',
  '4xl': '36px',
  '5xl': '48px',
  title: '64px',
};

// ── Spacing ────────────────────────────────────────────────────
export const SPACE = {
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '48px',
} as const;

// ── Borders & Radius ───────────────────────────────────────────
export const BORDER: Record<string, any> = {
  width:  '2px',
  thin:   '1px',
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '10px',
    pill: '20px',
  },
};

// ── Shadows ────────────────────────────────────────────────────
export const SHADOW: Record<string, string | ((color: string, spread?: number) => string)> = {
  panel:    '0 4px 16px rgba(0, 0, 0, 0.5)',
  dropdown: '0 8px 28px rgba(0, 0, 0, 0.6)',
  glow: (color: string, spread = 8) => `0 0 ${spread}px ${color}`,
  inset:    'inset 0 1px 0 rgba(255,255,255,0.06)',
};

// ── Transitions ────────────────────────────────────────────────
export const TRANSITION = {
  fast:   'all 0.1s ease',
  normal: 'all 0.2s ease',
  slow:   'all 0.3s ease',
} as const;

// ── Composite Style Builders ───────────────────────────────────

/**
 * Collection of style string builders for common UI patterns.
 * Each returns a CSS string suitable for el.style.cssText.
 */
export const UI = {
  /**
   * Standard game panel — the "building tooltip" look.
   * @param borderColor  Accent border color (default: subtle white)
   * @param bg           Background override
   */
  panel(borderColor: string = COLORS.borderDefault, bg: string = COLORS.panelBg): string {
    return `
      background: ${bg};
      border: ${BORDER.width} solid ${borderColor};
      border-radius: ${BORDER.radius.lg};
      padding: 10px 14px;
      color: ${COLORS.textPrimary};
      font-family: ${FONT.family};
      font-size: ${FONT.base};
      box-shadow: ${SHADOW.panel};
      pointer-events: auto;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Dropdown / popover panels — slightly more shadow, blur backdrop */
  dropdown(borderColor: string = COLORS.borderDefault): string {
    return `
      background: ${COLORS.dropdownBg};
      border: ${BORDER.width} solid ${borderColor};
      border-radius: ${BORDER.radius.lg};
      padding: 10px 14px;
      color: ${COLORS.textPrimary};
      font-family: ${FONT.family};
      font-size: ${FONT.base};
      box-shadow: ${SHADOW.dropdown};
      backdrop-filter: blur(10px);
      pointer-events: auto;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Full-screen overlay (menus, help, game-over) */
  overlay(bg: string = COLORS.overlayBg): string {
    return `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: ${bg};
      font-family: ${FONT.family};
      color: ${COLORS.textPrimary};
      pointer-events: auto;
      z-index: 300;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Small action button (queue unit, stance, formation, etc.) */
  button(bg: string, active = false): string {
    const border = active ? COLORS.borderActive : 'rgba(255,255,255,0.15)';
    const shadow = active ? SHADOW.glow(bg + '60') : 'none';
    return `
      display: inline-flex; align-items: center;
      padding: 4px 10px; margin: 2px 4px 2px 0;
      border-radius: ${BORDER.radius.sm};
      cursor: pointer; font-size: ${FONT.md};
      font-family: ${FONT.family};
      border: ${BORDER.thin} solid ${border};
      color: ${COLORS.textPrimary};
      background: ${active ? bg : 'rgba(60,60,60,0.8)'};
      text-transform: uppercase; letter-spacing: 0.5px;
      box-shadow: ${shadow};
      transition: ${TRANSITION.fast};
      user-select: none;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Larger CTA button (Start Game, Play Again) */
  ctaButton(bg: string): string {
    return `
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 40px;
      border-radius: ${BORDER.radius.md};
      cursor: pointer; font-size: ${FONT.xl};
      font-family: ${FONT.family};
      font-weight: bold;
      border: ${BORDER.width} solid rgba(255,255,255,0.2);
      color: #fff;
      background: ${bg};
      text-transform: uppercase; letter-spacing: 3px;
      box-shadow: ${SHADOW.panel};
      transition: ${TRANSITION.normal};
      user-select: none;
      pointer-events: auto;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Inline hotkey badge — the [Q] [W] [E] look */
  keyBadge(): string {
    return `
      display: inline-block;
      min-width: 16px; padding: 1px 5px;
      border-radius: ${BORDER.radius.sm};
      background: linear-gradient(180deg, #444, #333);
      border: ${BORDER.thin} solid #666;
      color: ${COLORS.gold};
      font-family: ${FONT.mono};
      font-size: ${FONT.sm}; font-weight: bold;
      text-align: center;
      box-shadow: 0 2px 0 #222;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Section header within panels */
  sectionHeader(color: string = COLORS.textSecondary): string {
    return `
      color: ${color};
      font-size: ${FONT.xs}; font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding-left: 2px;
      font-family: ${FONT.family};
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Horizontal divider line */
  divider(): string {
    return `margin: 6px 0; border: 0; border-top: ${BORDER.thin} solid ${COLORS.divider};`;
  },

  /** HP / progress bar wrapper */
  barWrap(height = '6px'): string {
    return `
      width: 100%; height: ${height};
      border-radius: ${BORDER.radius.sm};
      overflow: hidden;
      background: rgba(255,255,255,0.08);
      border: ${BORDER.thin} solid rgba(255,255,255,0.06);
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** HP / progress bar fill */
  barFill(color: string, pct: number): string {
    return `
      height: 100%; width: ${pct}%;
      border-radius: ${BORDER.radius.sm};
      background: ${color};
      transition: width 0.3s ease;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Minimize / collapse toggle button — small clickable icon in panel headers */
  minimizeBtn(): string {
    return `
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px;
      border-radius: ${BORDER.radius.sm};
      cursor: pointer; font-size: 14px; line-height: 1;
      font-family: ${FONT.mono};
      border: ${BORDER.thin} solid ${COLORS.borderDefault};
      color: ${COLORS.textMuted};
      background: rgba(255,255,255,0.05);
      transition: ${TRANSITION.fast};
      user-select: none;
      pointer-events: auto;
      flex-shrink: 0;
    `.replace(/\n\s+/g, ' ').trim();
  },

  /** Mode indicator bar (bottom center, shows build mode, etc.) */
  modeIndicator(borderColor: string): string {
    return `
      position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
      background: ${COLORS.panelBg};
      border: ${BORDER.width} solid ${borderColor};
      border-radius: ${BORDER.radius.lg};
      padding: 10px 24px;
      font-family: ${FONT.family};
      font-size: ${FONT.xl}; font-weight: bold;
      color: ${borderColor};
      text-transform: uppercase; letter-spacing: 2px;
      text-align: center;
      box-shadow: ${SHADOW.panel};
      display: none;
      z-index: 100;
    `.replace(/\n\s+/g, ' ').trim();
  },
} as const;

// ── CSS Injection (call once at startup) ───────────────────────

let _injected = false;

/**
 * Injects shared CSS custom properties and utility classes into <head>.
 * Safe to call multiple times — only injects once.
 */
export function injectUIThemeCSS(): void {
  if (_injected) return;
  _injected = true;

  const style = document.createElement('style');
  style.id = 'cubitopia-ui-theme';
  style.textContent = `
    /* ── Cubitopia UI Theme ── */
    :root {
      --ui-panel-bg: ${COLORS.panelBg};
      --ui-panel-bg-light: ${COLORS.panelBgLight};
      --ui-overlay-bg: ${COLORS.overlayBg};
      --ui-dropdown-bg: ${COLORS.dropdownBg};
      --ui-border: ${COLORS.borderDefault};
      --ui-border-hover: ${COLORS.borderHover};
      --ui-divider: ${COLORS.divider};
      --ui-text: ${COLORS.textPrimary};
      --ui-text-secondary: ${COLORS.textSecondary};
      --ui-text-muted: ${COLORS.textMuted};
      --ui-font: ${FONT.family};
      --ui-font-mono: ${FONT.mono};
      --ui-shadow: ${SHADOW.panel};
      --ui-radius: ${BORDER.radius.lg};
    }

    /* Shared keyframes */
    @keyframes uiFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes uiSlideUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Theme utility: .ui-key badge */
    .ui-key {
      display: inline-block;
      min-width: 16px; padding: 1px 5px;
      border-radius: ${BORDER.radius.sm};
      background: linear-gradient(180deg, #444, #333);
      border: ${BORDER.thin} solid #666;
      color: ${COLORS.gold};
      font-family: ${FONT.mono};
      font-size: ${FONT.sm}; font-weight: bold;
      text-align: center;
      box-shadow: 0 2px 0 #222;
      margin: 0 1px;
    }

    /* Theme utility: voxel block icon */
    .vx {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 2px;
      vertical-align: middle;
      margin-right: 4px;
      box-shadow: inset -1px -1px 0 rgba(0,0,0,0.3), inset 1px 1px 0 rgba(255,255,255,0.15);
      image-rendering: pixelated;
    }
    .vx-lg {
      width: 14px; height: 14px;
      margin-right: 6px;
    }
  `;
  document.head.appendChild(style);
}

// ── Theme Skin System ──────────────────────────────────────────

export type ThemeSkin = 'modern' | 'classic';

/** Current active skin (persisted in localStorage) */
let _currentSkin: ThemeSkin = 'modern';

/** Load saved skin from localStorage */
export function loadSavedSkin(): ThemeSkin {
  try {
    const saved = localStorage.getItem('cubitopia_ui_skin');
    if (saved === 'classic' || saved === 'modern') {
      _currentSkin = saved;
    }
  } catch {}
  return _currentSkin;
}

/** Get the current skin */
export function getCurrentSkin(): ThemeSkin {
  return _currentSkin;
}

/**
 * Switch between theme skins. Updates CSS custom properties and
 * persists the choice to localStorage.
 *
 * - 'modern': Building tooltip style — Segoe UI, blue-gray panels, drop shadows
 * - 'classic': Retro terminal — Courier New monospace, pure black panels, no shadows
 */
/**
 * Classic skin definition — retro CRT terminal aesthetic.
 * Green-on-black, monospace, sharp corners, scanline hints, no soft shadows.
 */
const SKIN_CLASSIC = {
  panelBg:      'rgba(0, 4, 0, 0.92)',
  panelBgLight: 'rgba(0, 8, 0, 0.85)',
  panelBgEnemy: 'rgba(20, 0, 0, 0.92)',
  overlayBg:    'rgba(0, 0, 0, 0.94)',
  dropdownBg:   'rgba(0, 2, 0, 0.96)',
  borderDefault:'rgba(0, 255, 65, 0.25)',
  borderHover:  'rgba(0, 255, 65, 0.45)',
  borderActive: 'rgba(0, 255, 65, 0.6)',
  divider:      'rgba(0, 255, 65, 0.1)',
  textPrimary:  '#00ff41',
  textSecondary:'#00cc33',
  textMuted:    '#008822',
  textDim:      '#005511',
  font:         "'Courier New', Consolas, monospace",
  shadow:       '0 0 8px rgba(0, 255, 65, 0.15)',
  radiusLg:     '2px',
  radiusMd:     '2px',
  radiusSm:     '1px',
} as const;

/** Modern skin definition — the building tooltip look. */
const SKIN_MODERN = {
  panelBg:      'rgba(20, 20, 30, 0.95)',
  panelBgLight: 'rgba(20, 20, 30, 0.88)',
  panelBgEnemy: 'rgba(30, 15, 15, 0.95)',
  overlayBg:    'rgba(5, 5, 16, 0.92)',
  dropdownBg:   'rgba(10, 10, 18, 0.96)',
  borderDefault:'rgba(255, 255, 255, 0.2)',
  borderHover:  'rgba(255, 255, 255, 0.35)',
  borderActive: 'rgba(255, 255, 255, 0.4)',
  divider:      'rgba(255, 255, 255, 0.1)',
  textPrimary:  '#eee',
  textSecondary:'#aaa',
  textMuted:    '#888',
  textDim:      '#666',
  font:         "'Segoe UI', system-ui, -apple-system, sans-serif",
  shadow:       '0 4px 16px rgba(0, 0, 0, 0.5)',
  radiusLg:     '8px',
  radiusMd:     '6px',
  radiusSm:     '4px',
} as const;

export function setSkin(skin: ThemeSkin): void {
  _currentSkin = skin;
  try { localStorage.setItem('cubitopia_ui_skin', skin); } catch {}

  const s = skin === 'classic' ? SKIN_CLASSIC : SKIN_MODERN;
  const root = document.documentElement;

  // CSS custom properties (for any stylesheet-based consumers)
  root.style.setProperty('--ui-panel-bg', s.panelBg);
  root.style.setProperty('--ui-panel-bg-light', s.panelBgLight);
  root.style.setProperty('--ui-overlay-bg', s.overlayBg);
  root.style.setProperty('--ui-dropdown-bg', s.dropdownBg);
  root.style.setProperty('--ui-border', s.borderDefault);
  root.style.setProperty('--ui-border-hover', s.borderHover);
  root.style.setProperty('--ui-divider', s.divider);
  root.style.setProperty('--ui-text', s.textPrimary);
  root.style.setProperty('--ui-text-secondary', s.textSecondary);
  root.style.setProperty('--ui-text-muted', s.textMuted);
  root.style.setProperty('--ui-font', s.font);
  root.style.setProperty('--ui-shadow', s.shadow);
  root.style.setProperty('--ui-radius', s.radiusLg);

  // Override the mutable JS constants so UI.panel() etc. produce the right styles
  COLORS.panelBg      = s.panelBg;
  COLORS.panelBgLight = s.panelBgLight;
  COLORS.panelBgEnemy = s.panelBgEnemy;
  COLORS.overlayBg    = s.overlayBg;
  COLORS.dropdownBg   = s.dropdownBg;
  COLORS.borderDefault= s.borderDefault;
  COLORS.borderHover  = s.borderHover;
  COLORS.borderActive = s.borderActive;
  COLORS.divider      = s.divider;
  COLORS.textPrimary  = s.textPrimary;
  COLORS.textSecondary= s.textSecondary;
  COLORS.textMuted    = s.textMuted;
  COLORS.textDim      = s.textDim;
  FONT.family         = s.font;
  SHADOW.panel        = s.shadow;
  BORDER.radius.lg    = s.radiusLg;
  BORDER.radius.md    = s.radiusMd;
  BORDER.radius.sm    = s.radiusSm;

  // Inject/update scanline overlay for classic skin
  let scanline = document.getElementById('cubitopia-scanline');
  if (skin === 'classic') {
    if (!scanline) {
      scanline = document.createElement('div');
      scanline.id = 'cubitopia-scanline';
      scanline.style.cssText = `
        position:fixed; top:0; left:0; width:100%; height:100%;
        pointer-events:none; z-index:99999;
        background: repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0,0,0,0.06) 2px,
          rgba(0,0,0,0.06) 4px
        );
        mix-blend-mode: multiply;
      `;
      document.body.appendChild(scanline);
    }
    scanline.style.display = 'block';
  } else {
    if (scanline) scanline.style.display = 'none';
  }
}
