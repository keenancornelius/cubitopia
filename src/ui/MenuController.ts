/**
 * MenuController — Main menu and game-over screen UI.
 * Pure DOM manipulation, no game state dependencies.
 */

export interface MenuCallbacks {
  onStartGame(mode: 'pvai' | 'aivai'): void;
  onPlayAgain(): void;
}

export default class MenuController {
  private mainMenuOverlay: HTMLElement | null = null;
  private gameOverOverlay: HTMLElement | null = null;
  private callbacks: MenuCallbacks;

  constructor(callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
  }

  // ── Main Menu ─────────────────────────────────────────────
  showMainMenu(): void {
    if (this.mainMenuOverlay) {
      this.mainMenuOverlay.remove();
      this.mainMenuOverlay = null;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #0a0a1a 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      z-index:20000; font-family:'Courier New',monospace;
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `
      font-size:64px; font-weight:bold; color:#fff; text-shadow: 0 0 40px rgba(52,152,219,0.6), 0 0 80px rgba(52,152,219,0.3);
      letter-spacing:8px; margin-bottom:8px;
    `;
    title.textContent = 'CUBITOPIA';
    overlay.appendChild(title);

    // Subtitle
    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:14px; color:#888; letter-spacing:4px; margin-bottom:60px; text-transform:uppercase;';
    subtitle.textContent = 'Voxel Strategy';
    overlay.appendChild(subtitle);

    // Mode buttons
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex; flex-direction:column; gap:16px; align-items:center;';

    const mkMenuBtn = (label: string, sublabel: string, color: string, mode: 'pvai' | 'aivai') => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: transparent; color:${color}; border:2px solid ${color}; padding:16px 48px;
        font-size:18px; font-family:'Courier New',monospace; font-weight:bold;
        border-radius:4px; cursor:pointer; letter-spacing:3px; min-width:320px;
        transition: all 0.2s;
      `;
      btn.innerHTML = `${label}<br><span style="font-size:11px;color:#888;font-weight:normal;letter-spacing:1px;">${sublabel}</span>`;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = color;
        btn.style.color = '#000';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = color;
      });
      btn.addEventListener('click', () => {
        overlay.remove();
        this.mainMenuOverlay = null;
        this.callbacks.onStartGame(mode);
      });
      return btn;
    };

    btnContainer.appendChild(mkMenuBtn('PLAYER vs AI', 'Command your army against the AI opponent', '#3498db', 'pvai'));
    btnContainer.appendChild(mkMenuBtn('AI vs AI', 'Watch two AI commanders battle it out', '#e74c3c', 'aivai'));
    overlay.appendChild(btnContainer);

    // Version
    const ver = document.createElement('div');
    ver.style.cssText = 'position:absolute; bottom:20px; color:#444; font-size:10px; letter-spacing:2px;';
    ver.textContent = 'v0.1 — PLAYTEST BUILD';
    overlay.appendChild(ver);

    document.body.appendChild(overlay);
    this.mainMenuOverlay = overlay;
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
    let title: string;
    let subtitle: string;
    if (gameMode === 'aivai') {
      title = winner + ' WINS!';
      subtitle = winner + ' destroyed the opposing base!';
    } else {
      title = isVictory ? 'VICTORY!' : 'DEFEAT!';
      subtitle = isVictory ? 'You destroyed the enemy base!' : 'Your base has been destroyed!';
    }

    overlay.innerHTML = `
      <div style="font-size: 64px; font-weight: bold; color: ${color};
        text-shadow: 0 0 30px ${color}, 0 0 60px ${color}; margin-bottom: 16px;
        letter-spacing: 8px;">
        ${title}
      </div>
      <div style="font-size: 20px; color: #bbb; margin-bottom: 40px;">
        ${subtitle}
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
