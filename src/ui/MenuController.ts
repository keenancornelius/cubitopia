/**
 * MenuController — Main menu, map selector, and game-over screen UI.
 * Pure DOM manipulation, no game state dependencies.
 */

import { MapType } from '../types';
import { MAP_PRESETS } from '../game/MapPresets';
import { MUSIC_GENRES, type MusicGenre } from '../engine/ProceduralMusic';

export interface MenuCallbacks {
  onStartGame(mode: 'pvai' | 'aivai', mapType: MapType): void;
  onPlayAgain(): void;
  onGenreChanged?(genreId: string): void;
  onMenuShown?(): void;
}

export default class MenuController {
  private mainMenuOverlay: HTMLElement | null = null;
  private gameOverOverlay: HTMLElement | null = null;
  private callbacks: MenuCallbacks;
  private selectedMap: MapType = MapType.STANDARD;
  private selectedMode: 'pvai' | 'aivai' = 'pvai';
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
      position:fixed; top:0; left:0; width:100%; height:100%;
      background: linear-gradient(180deg, rgba(5,5,16,0.7) 0%, rgba(10,10,30,0.45) 40%, rgba(10,10,30,0.45) 60%, rgba(5,5,16,0.7) 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      z-index:20000; font-family:'Courier New',monospace;
      backdrop-filter: blur(2px);
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
    const mkModeBtn = (label: string, mode: 'pvai' | 'aivai', color: string) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${color}; border:2px solid ${color}; padding:10px 24px;
        font-size:13px; font-family:'Courier New',monospace; font-weight:bold;
        border-radius:4px; cursor:pointer; letter-spacing:2px; min-width:160px;
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
    modeRow.appendChild(mkModeBtn('AI vs AI', 'aivai', '#e74c3c'));
    overlay.appendChild(modeRow);

    // --- Map Type Selector ---
    overlay.appendChild(sectionLabel('MAP TYPE'));

    const mapGrid = document.createElement('div');
    mapGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:12px; max-width:600px;';

    const mapButtons: HTMLButtonElement[] = [];
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:12px; color:#777; text-align:center; margin-bottom:30px; min-height:18px; max-width:400px;';

    for (const preset of MAP_PRESETS) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${preset.color}; border:2px solid ${preset.color}; padding:8px 18px;
        font-size:12px; font-family:'Courier New',monospace; font-weight:bold;
        border-radius:4px; cursor:pointer; letter-spacing:2px; min-width:120px;
        transition: all 0.2s;
      `;
      btn.textContent = preset.label;
      btn.dataset.color = preset.color;
      btn.dataset.type = preset.type;
      mapButtons.push(btn);

      const updateMapSelection = () => {
        mapButtons.forEach(b => {
          b.style.background = 'transparent';
          b.style.color = b.dataset.color!;
        });
        btn.style.background = preset.color;
        btn.style.color = '#000';
        descEl.textContent = preset.description;
      };

      btn.addEventListener('click', () => {
        this.selectedMap = preset.type;
        updateMapSelection();
      });

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
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${genre.color}; border:2px solid ${genre.color}; padding:6px 14px;
        font-size:12px; font-family:'Courier New',monospace; font-weight:bold;
        border-radius:4px; cursor:pointer; letter-spacing:1px; min-width:90px;
        transition: all 0.2s;
      `;
      btn.textContent = `${genre.icon} ${genre.label}`;
      btn.dataset.color = genre.color;
      btn.dataset.genreId = genre.id;
      genreButtons.push(btn);

      const updateGenreSelection = () => {
        genreButtons.forEach(b => {
          b.style.background = 'transparent';
          b.style.color = b.dataset.color!;
        });
        btn.style.background = genre.color;
        btn.style.color = '#000';
        genreDescEl.textContent = genre.description;
      };

      btn.addEventListener('click', () => {
        this.selectedGenre = genre.id;
        updateGenreSelection();
        this.callbacks.onGenreChanged?.(genre.id);
      });

      // Highlight saved/default genre
      if (genre.id === this.selectedGenre) {
        setTimeout(() => updateGenreSelection(), 0);
      }

      genreRow.appendChild(btn);
    }

    overlay.appendChild(genreRow);
    overlay.appendChild(genreDescEl);

    // --- Start Button ---
    const startBtn = document.createElement('button');
    startBtn.style.cssText = `
      background: linear-gradient(135deg, #2ecc71, #27ae60); color:#fff;
      border:2px solid rgba(255,255,255,0.2); padding:16px 56px;
      font-size:20px; font-family:'Courier New',monospace; font-weight:bold;
      border-radius:6px; cursor:pointer; letter-spacing:4px;
      transition: all 0.2s; text-transform:uppercase;
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
  showGameOverScreen(winner: string, isVictory: boolean, gameMode: string): void {
    if (this.gameOverOverlay) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 200;
      font-family: 'Courier New', monospace; color: white;
      pointer-events: auto; animation: fadeIn 0.5s ease;
    `;

    const color = isVictory ? '#2ecc71' : '#e74c3c';
    let titleText: string;
    let subtitleText: string;
    if (gameMode === 'aivai') {
      titleText = winner + ' WINS!';
      subtitleText = winner + ' destroyed the opposing base!';
    } else {
      titleText = isVictory ? 'VICTORY!' : 'DEFEAT!';
      subtitleText = isVictory ? 'You destroyed the enemy base!' : 'Your base has been destroyed!';
    }

    overlay.innerHTML = `
      <div style="font-size: 64px; font-weight: bold; color: ${color};
        text-shadow: 0 0 30px ${color}, 0 0 60px ${color}; margin-bottom: 16px;
        letter-spacing: 8px;">
        ${titleText}
      </div>
      <div style="font-size: 20px; color: #bbb; margin-bottom: 40px;">
        ${subtitleText}
      </div>
      <button id="play-again-btn" style="
        background: linear-gradient(135deg, ${color}, ${isVictory ? '#27ae60' : '#c0392b'});
        color: white; border: 2px solid rgba(255,255,255,0.3);
        padding: 14px 40px; font-size: 18px; font-family: 'Courier New', monospace;
        font-weight: bold; border-radius: 8px; cursor: pointer;
        text-transform: uppercase; letter-spacing: 3px;
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
