/**
 * MenuController — Main menu, map selector, and game-over screen UI.
 * Pure DOM manipulation, no game state dependencies.
 */

import { MapType } from '../types';
import { MAP_PRESETS } from '../game/MapPresets';
import { MUSIC_GENRES, type MusicGenre } from '../engine/ProceduralMusic';
import { UI, COLORS, FONT, BORDER, SHADOW, getCurrentSkin, setSkin, loadSavedSkin, type ThemeSkin } from './UITheme';

export interface GameOverStats {
  gameDuration: number;        // seconds
  playerUnitsKilled: number;   // units player killed
  playerUnitsLost: number;     // units player lost
  enemyUnitsKilled: number;    // units enemy killed
  enemyUnitsLost: number;      // units enemy lost
  basesOwned: number;          // zones player controls at end
  totalBases: number;          // total zones on map
  playerBaseTier: number;      // player's main base tier at end
}

export interface MenuCallbacks {
  onStartGame(mode: 'pvai' | 'aivai' | 'ffa' | '2v2', mapType: MapType): void;
  onPlayAgain(): void;
  onGenreChanged?(genreId: string): void;
  onMenuShown?(): void;
  onMultiplayer?(): void;
  onSkinChanged?(skin: ThemeSkin): void;
}

export default class MenuController {
  private mainMenuOverlay: HTMLElement | null = null;
  private gameOverOverlay: HTMLElement | null = null;
  private callbacks: MenuCallbacks;
  private selectedMap: MapType = MapType.STANDARD;
  private selectedMode: 'pvai' | 'aivai' | 'ffa' | '2v2' = 'pvai';
  private selectedGenre: string = 'fantasy';

  constructor(callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
    // Restore saved genre
    try {
      const saved = localStorage.getItem('cubitopia_music_genre');
      if (saved && MUSIC_GENRES.some(g => g.id === saved)) {
        this.selectedGenre = saved;
      }
    } catch {}
  }

  // ── Main Menu ─────────────────────────────────────────────
  showMainMenu(): void {
    if (this.mainMenuOverlay) {
      this.mainMenuOverlay.remove();
      this.mainMenuOverlay = null;
    }
    this.selectedMap = MapType.STANDARD;
    this.selectedMode = 'pvai';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      ${UI.overlay('linear-gradient(180deg, rgba(5,5,16,0.7) 0%, rgba(10,10,30,0.45) 40%, rgba(10,10,30,0.45) 60%, rgba(5,5,16,0.7) 100%)')};
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      z-index:20000; backdrop-filter: blur(2px);
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `
      font-size:72px; font-weight:bold; color:#fff;
      text-shadow: 0 0 40px rgba(52,152,219,0.8), 0 0 80px rgba(52,152,219,0.4), 0 2px 8px rgba(0,0,0,0.9);
      letter-spacing:10px; margin-bottom:8px;
    `;
    title.textContent = 'CUBITOPIA';
    overlay.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:14px; color:#aaa; letter-spacing:4px; margin-bottom:40px; text-transform:uppercase; text-shadow: 0 1px 4px rgba(0,0,0,0.8);';
    subtitle.textContent = 'Voxel Strategy';
    overlay.appendChild(subtitle);

    // --- Game Mode Selector ---
    const sectionLabel = (text: string) => {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px; color:#555; letter-spacing:3px; text-transform:uppercase; margin-bottom:10px;';
      lbl.textContent = text;
      return lbl;
    };

    overlay.appendChild(sectionLabel('GAME MODE'));

    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex; gap:12px; margin-bottom:30px;';

    const modeButtons: HTMLButtonElement[] = [];
    const mkModeBtn = (label: string, mode: 'pvai' | 'aivai' | 'ffa' | '2v2', color: string) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${color}; border:${BORDER.width} solid ${color}; padding:10px 24px;
        font-size:${FONT.base}; font-family:${FONT.family}; font-weight:bold;
        border-radius:${BORDER.radius.sm}; cursor:pointer; letter-spacing:2px; min-width:160px;
        transition: all 0.2s;
      `;
      btn.textContent = label;
      modeButtons.push(btn);

      const updateModeSelection = () => {
        modeButtons.forEach(b => {
          b.style.background = 'transparent';
          b.style.color = b.dataset.color!;
        });
        btn.style.background = color;
        btn.style.color = '#000';
      };

      btn.dataset.color = color;
      btn.addEventListener('click', () => {
        this.selectedMode = mode;
        updateModeSelection();
      });

      // Default: pvai is selected
      if (mode === 'pvai') {
        setTimeout(() => updateModeSelection(), 0);
      }
      return btn;
    };

    modeRow.appendChild(mkModeBtn('PLAYER vs AI', 'pvai', '#3498db'));
    modeRow.appendChild(mkModeBtn('FREE-FOR-ALL', 'ffa', '#2ecc71'));
    modeRow.appendChild(mkModeBtn('AI vs AI', 'aivai', '#e74c3c'));

    // Ranked Multiplayer button (same row styling, but triggers MP flow)
    const mpBtn = document.createElement('button');
    mpBtn.style.cssText = `
      background: transparent; color:#9b59b6; border:2px solid #9b59b6; padding:10px 24px;
      font-size:13px; font-family:${FONT.family}; font-weight:bold;
      border-radius:4px; cursor:pointer; letter-spacing:2px; min-width:160px;
      transition: all 0.2s;
    `;
    mpBtn.textContent = '\u2694 RANKED MULTIPLAYER';
    mpBtn.dataset.color = '#9b59b6';
    mpBtn.addEventListener('mouseenter', () => {
      mpBtn.style.background = '#9b59b6';
      mpBtn.style.color = '#000';
      mpBtn.style.boxShadow = '0 0 20px rgba(155,89,182,0.4)';
    });
    mpBtn.addEventListener('mouseleave', () => {
      // Only reset if not "selected" (it never truly selects — it navigates away)
      mpBtn.style.background = 'transparent';
      mpBtn.style.color = '#9b59b6';
      mpBtn.style.boxShadow = 'none';
    });
    mpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
      this.mainMenuOverlay = null;
      this.callbacks.onMultiplayer?.();
    });
    modeRow.appendChild(mpBtn);

    overlay.appendChild(modeRow);

    // --- Map Type Selector ---
    overlay.appendChild(sectionLabel('MAP TYPE'));

    // Map terrain icons for visual flair
    const MAP_ICONS: Record<string, string> = {
      [MapType.STANDARD]: '\u26f0\ufe0f',   // mountain
      [MapType.ARENA]: '\u2694\ufe0f',       // swords
      [MapType.HIGHLAND]: '\ud83c\udfd4\ufe0f', // mountain snow
      [MapType.ARCHIPELAGO]: '\ud83c\udf0a',   // wave
      [MapType.FLATLAND]: '\ud83c\udf3e',      // rice
      [MapType.DESERT_TUNNELS]: '\ud83c\udfdc\ufe0f', // desert
      [MapType.VOLCANIC]: '\ud83c\udf0b',      // volcano
      [MapType.TUNDRA]: '\u2744\ufe0f',        // snowflake
      [MapType.SKYLAND]: '\u2601\ufe0f',      // cloud
    };

    const mapGrid = document.createElement('div');
    mapGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:12px; max-width:700px;';

    const mapButtons: HTMLButtonElement[] = [];
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:12px; color:#777; text-align:center; margin-bottom:30px; min-height:18px; max-width:480px;';

    const playableMaps = new Set(MAP_PRESETS.map(p => p.type));

    for (const preset of MAP_PRESETS) {
      const isPlayable = playableMaps.has(preset.type);
      const icon = MAP_ICONS[preset.type] ?? '';
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${isPlayable ? preset.color : '#333'}; border:2px solid ${isPlayable ? preset.color : '#222'};
        padding:10px 16px; font-family:${FONT.family};
        border-radius:6px; ${isPlayable ? 'cursor:pointer;' : 'cursor:not-allowed; opacity:0.35;'} min-width:130px;
        transition: all 0.2s; display:flex; flex-direction:column; align-items:center; gap:2px;
      `;
      btn.innerHTML = `
        <span style="font-size:20px; line-height:1;">${icon}</span>
        <span style="font-size:11px; font-weight:bold; letter-spacing:2px;">${preset.label}</span>
        <span style="font-size:9px; color:${isPlayable ? 'rgba(255,255,255,0.4)' : '#222'}; letter-spacing:1px;">${preset.size}x${preset.size}${!isPlayable ? ' \u2022 COMING SOON' : ''}</span>
      `;
      btn.dataset.color = isPlayable ? preset.color : '#333';
      btn.dataset.type = preset.type;
      mapButtons.push(btn);

      const updateMapSelection = () => {
        mapButtons.forEach(b => {
          const mp = playableMaps.has(b.dataset.type as MapType);
          b.style.background = 'transparent';
          b.style.color = mp ? b.dataset.color! : '#333';
          b.style.boxShadow = 'none';
        });
        btn.style.background = preset.color;
        btn.style.color = '#000';
        btn.style.boxShadow = `0 0 20px ${preset.color}44`;
        descEl.textContent = preset.description;
      };

      if (isPlayable) {
        btn.addEventListener('click', () => {
          this.selectedMap = preset.type;
          updateMapSelection();
        });
        btn.addEventListener('mouseenter', () => {
          if (btn.style.background === 'transparent') {
            btn.style.borderColor = preset.color;
            btn.style.boxShadow = `0 0 12px ${preset.color}33`;
          }
        });
        btn.addEventListener('mouseleave', () => {
          if (btn.style.background === 'transparent') {
            btn.style.boxShadow = 'none';
          }
        });
      }

      // Default: standard selected
      if (preset.type === MapType.STANDARD) {
        setTimeout(() => updateMapSelection(), 0);
      }

      mapGrid.appendChild(btn);
    }

    overlay.appendChild(mapGrid);
    overlay.appendChild(descEl);

    // --- Tribe Selector (maps to music genre) ---
    overlay.appendChild(sectionLabel('TRIBE'));

    const genreRow = document.createElement('div');
    genreRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:12px; max-width:600px;';

    const genreButtons: HTMLButtonElement[] = [];
    const genreDescEl = document.createElement('div');
    genreDescEl.style.cssText = 'font-size:12px; color:#777; text-align:center; margin-bottom:30px; min-height:18px; max-width:400px;';

    for (const genre of MUSIC_GENRES) {
      const isPlayable = genre.id === 'fantasy'; // Only Ironveil is playable for now
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${isPlayable ? genre.color : '#333'}; border:2px solid ${isPlayable ? genre.color : '#222'}; padding:6px 14px;
        font-size:12px; font-family:${FONT.family}; font-weight:bold;
        border-radius:4px; ${isPlayable ? 'cursor:pointer;' : 'cursor:not-allowed; opacity:0.4;'} letter-spacing:1px; min-width:90px;
        transition: all 0.2s;
      `;
      btn.textContent = `${genre.icon} ${genre.label}`;
      btn.dataset.color = isPlayable ? genre.color : '#333';
      btn.dataset.genreId = genre.id;
      genreButtons.push(btn);

      const updateGenreSelection = () => {
        genreButtons.forEach(b => {
          const playable = b.dataset.genreId === 'fantasy';
          b.style.background = 'transparent';
          b.style.color = playable ? b.dataset.color! : '#333';
        });
        btn.style.background = genre.color;
        btn.style.color = '#000';
        genreDescEl.textContent = genre.description;
      };

      if (isPlayable) {
        btn.addEventListener('click', () => {
          this.selectedGenre = genre.id;
          updateGenreSelection();
          this.callbacks.onGenreChanged?.(genre.id);
        });
      }

      // Ironveil is always selected (only playable tribe)
      if (genre.id === 'fantasy') {
        setTimeout(() => updateGenreSelection(), 0);
      }

      genreRow.appendChild(btn);
    }

    overlay.appendChild(genreRow);
    overlay.appendChild(genreDescEl);

    // --- UI Skin Toggle ---
    overlay.appendChild(sectionLabel('UI THEME'));
    const skinRow = document.createElement('div');
    skinRow.style.cssText = 'display:flex; gap:10px; margin-bottom:30px;';

    const currentSkin = loadSavedSkin();
    const skinOptions: { label: string; skin: ThemeSkin; color: string; desc: string }[] = [
      { label: 'MODERN', skin: 'modern', color: '#3498db', desc: 'Clean sans-serif, subtle shadows' },
      { label: 'CLASSIC', skin: 'classic', color: '#7f8c8d', desc: 'Monospace terminal, flat black' },
    ];
    const skinButtons: HTMLButtonElement[] = [];

    for (const opt of skinOptions) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${opt.color}; border:${BORDER.width} solid ${opt.color}; padding:8px 20px;
        font-size:${FONT.md}; font-family:${FONT.family}; font-weight:bold;
        border-radius:${BORDER.radius.sm}; cursor:pointer; letter-spacing:2px; min-width:120px;
        transition: all 0.2s;
      `;
      btn.textContent = opt.label;
      btn.dataset.color = opt.color;
      skinButtons.push(btn);

      const updateSkinSelection = () => {
        skinButtons.forEach(b => {
          b.style.background = 'transparent';
          b.style.color = b.dataset.color!;
        });
        btn.style.background = opt.color;
        btn.style.color = '#000';
      };

      btn.addEventListener('click', () => {
        setSkin(opt.skin);
        updateSkinSelection();
        this.callbacks.onSkinChanged?.(opt.skin);
      });

      if (opt.skin === currentSkin) {
        setTimeout(() => updateSkinSelection(), 0);
      }

      skinRow.appendChild(btn);
    }
    overlay.appendChild(skinRow);

    // --- Start Button ---
    const startBtn = document.createElement('button');
    startBtn.style.cssText = `
      ${UI.ctaButton('linear-gradient(135deg, #2ecc71, #27ae60)')};
      padding:16px 56px; font-size:20px; letter-spacing:4px;
    `;
    startBtn.textContent = 'START BATTLE';
    startBtn.addEventListener('mouseenter', () => {
      startBtn.style.transform = 'scale(1.05)';
      startBtn.style.boxShadow = '0 0 30px rgba(46,204,113,0.4)';
    });
    startBtn.addEventListener('mouseleave', () => {
      startBtn.style.transform = 'scale(1)';
      startBtn.style.boxShadow = 'none';
    });
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent bubble to overlay (which would restart title scene)
      overlay.remove();
      this.mainMenuOverlay = null;
      this.callbacks.onStartGame(this.selectedMode, this.selectedMap);
    });
    overlay.appendChild(startBtn);

    // Version
    const ver = document.createElement('div');
    ver.style.cssText = 'position:absolute; bottom:20px; color:#444; font-size:10px; letter-spacing:2px;';
    ver.textContent = 'v0.2 — PLAYTEST BUILD';
    overlay.appendChild(ver);

    document.body.appendChild(overlay);
    this.mainMenuOverlay = overlay;

    // Start title music — fires immediately (works if returning from game)
    // and also on first click (needed for initial page load when AudioContext is suspended)
    this.callbacks.onMenuShown?.();
    let titleStarted = false;
    const tryStartTitle = () => {
      if (!titleStarted) {
        titleStarted = true;
        this.callbacks.onMenuShown?.();
        overlay.removeEventListener('click', tryStartTitle);
      }
    };
    overlay.addEventListener('click', tryStartTitle);
  }

  // ── Game Over Screen ──────────────────────────────────────
  showGameOverScreen(winner: string, isVictory: boolean, gameMode: string, stats?: GameOverStats): void {
    if (this.gameOverOverlay) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      ${UI.overlay('rgba(5, 5, 16, 0.92)')};
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 200; animation: uiFadeIn 0.5s ease;
    `;

    const color = isVictory ? '#2ecc71' : '#e74c3c';
    let titleText: string;
    let subtitleText: string;
    if (gameMode === 'aivai') {
      titleText = winner + ' WINS!';
      subtitleText = winner + ' captured the opposing base!';
    } else {
      titleText = isVictory ? 'VICTORY!' : 'DEFEAT!';
      subtitleText = isVictory ? 'You captured the enemy base!' : 'Your base has been captured!';
    }

    // Format duration
    const formatTime = (seconds: number): string => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // Build stats section
    let statsHTML = '';
    if (stats) {
      const TIER_NAMES = ['Camp', 'Fort', 'Castle'];
      const tierName = TIER_NAMES[stats.playerBaseTier] ?? 'Camp';
      statsHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px 40px;
          background:rgba(255,255,255,0.04); border:1px solid ${COLORS.divider};
          border-radius:${BORDER.radius.lg}; padding:20px 32px; margin-bottom:32px; min-width:400px;
          text-align:center; font-family:${FONT.family};">
          <div style="grid-column:1/3; font-size:11px; color:#666; letter-spacing:3px; text-transform:uppercase; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px;">
            BATTLE REPORT
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#f0c040;">${formatTime(stats.gameDuration)}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">Duration</div>
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#3498db;">${stats.basesOwned}/${stats.totalBases}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">Zones Held</div>
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#2ecc71;">${stats.playerUnitsKilled}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">Enemies Killed</div>
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#e74c3c;">${stats.playerUnitsLost}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">Units Lost</div>
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#9b59b6;">${tierName}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">Base Tier</div>
          </div>
          <div>
            <div style="font-size:28px; font-weight:bold; color:#e67e22;">${stats.playerUnitsKilled > 0 && stats.playerUnitsLost > 0 ? (stats.playerUnitsKilled / stats.playerUnitsLost).toFixed(1) : stats.playerUnitsKilled > 0 ? '∞' : '0'}</div>
            <div style="font-size:10px; color:#888; letter-spacing:2px; text-transform:uppercase;">K/D Ratio</div>
          </div>
        </div>
      `;
    }

    overlay.innerHTML = `
      <div style="font-size: 64px; font-weight: bold; color: ${color};
        text-shadow: 0 0 30px ${color}, 0 0 60px ${color}; margin-bottom: 16px;
        letter-spacing: 8px;">
        ${titleText}
      </div>
      <div style="font-size: 20px; color: #bbb; margin-bottom: 24px;">
        ${subtitleText}
      </div>
      ${statsHTML}
      <button id="play-again-btn" style="
        ${UI.ctaButton(`linear-gradient(135deg, ${color}, ${isVictory ? '#27ae60' : '#c0392b'})`)};
      ">NEW BATTLE</button>
    `;

    document.body.appendChild(overlay);
    this.gameOverOverlay = overlay;

    const btn = document.getElementById('play-again-btn');
    if (btn) {
      btn.addEventListener('click', () => this.callbacks.onPlayAgain());
    }
  }

  // ── Cleanup ───────────────────────────────────────────────
  removeGameOverOverlay(): void {
    if (this.gameOverOverlay) {
      this.gameOverOverlay.remove();
      this.gameOverOverlay = null;
    }
  }

  removeMainMenuOverlay(): void {
    if (this.mainMenuOverlay) {
      this.mainMenuOverlay.remove();
      this.mainMenuOverlay = null;
    }
  }
}
