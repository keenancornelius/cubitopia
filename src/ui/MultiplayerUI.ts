// ============================================
// CUBITOPIA - Multiplayer UI
// Phase 5C: Registration, Matchmaking, Leaderboard, Match Results
// ============================================
//
// Screens:
//   1. Registration  — Reddit username input, sign-in
//   2. Multiplayer Lobby — Find Match, Leaderboard, Profile
//   3. Searching     — Animated search with timer
//   4. Opponent Found — Flash opponent name + ELO
//   5. Match Result   — Victory/Defeat + ELO change
//   6. Leaderboard    — Top 25 players by ELO
//
// All UI uses the same inline-CSS pattern as MenuController.
// ============================================

import { MultiplayerController, type MultiplayerState, type MultiplayerEvents } from '../network/MultiplayerController';
import type { MatchFoundResult } from '../network/MatchmakingService';
import type { PlayerProfile } from '../network/FirebaseConfig';
import type { EloUpdateResult } from '../network/MultiplayerController';
import { MapType } from '../types';

// ============================================
// Shared styling constants
// ============================================
const FONT = "'Courier New', monospace";
const BLUE = '#3498db';
const GREEN = '#2ecc71';
const RED = '#e74c3c';
const GOLD = '#f39c12';
const PURPLE = '#9b59b6';
const GRAY = '#95a5a6';

const OVERLAY_BASE = `
  position:fixed; top:0; left:0; width:100%; height:100%;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  z-index:25000; font-family:${FONT};
  backdrop-filter: blur(4px);
`;

function glowText(color: string, size = 48): string {
  return `font-size:${size}px; font-weight:bold; color:${color};
    text-shadow: 0 0 30px ${color}, 0 0 60px ${color}; letter-spacing:6px;`;
}

function makeButton(label: string, color: string, size: 'large' | 'medium' | 'small' = 'medium'): HTMLButtonElement {
  const btn = document.createElement('button');
  const pad = size === 'large' ? '16px 56px' : size === 'medium' ? '10px 28px' : '6px 16px';
  const fs = size === 'large' ? '20px' : size === 'medium' ? '14px' : '11px';
  btn.style.cssText = `
    background: linear-gradient(135deg, ${color}, ${darken(color)});
    color:#fff; border:2px solid rgba(255,255,255,0.2); padding:${pad};
    font-size:${fs}; font-family:${FONT}; font-weight:bold;
    border-radius:6px; cursor:pointer; letter-spacing:2px;
    transition: all 0.2s; text-transform:uppercase;
  `;
  btn.textContent = label;
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.05)';
    btn.style.boxShadow = `0 0 25px ${color}66`;
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = 'none';
  });
  return btn;
}

function makeOutlineButton(label: string, color: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.style.cssText = `
    background: transparent; color:${color}; border:2px solid ${color}; padding:10px 24px;
    font-size:13px; font-family:${FONT}; font-weight:bold;
    border-radius:4px; cursor:pointer; letter-spacing:2px; min-width:160px;
    transition: all 0.2s;
  `;
  btn.textContent = label;
  btn.addEventListener('mouseenter', () => {
    btn.style.background = color;
    btn.style.color = '#000';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
    btn.style.color = color;
  });
  return btn;
}

function darken(hex: string): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 40);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 40);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 40);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function sectionLabel(text: string): HTMLElement {
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:11px; color:#555; letter-spacing:3px; text-transform:uppercase; margin-bottom:10px;';
  lbl.textContent = text;
  return lbl;
}

// ============================================
// Multiplayer UI Callbacks
// ============================================
export interface MultiplayerUICallbacks {
  onBackToMenu(): void;
  onStartMultiplayerGame(mapSeed: number, mapType: MapType, isGhost: boolean, opponentName: string, ghostDifficulty?: string): void;
  onReturnToLobby(): void;
}

// ============================================
// Main Multiplayer UI Class
// ============================================
export class MultiplayerUI {
  private overlay: HTMLElement | null = null;
  private mp: MultiplayerController;
  private callbacks: MultiplayerUICallbacks;
  private searchTimerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(mp: MultiplayerController, callbacks: MultiplayerUICallbacks) {
    this.mp = mp;
    this.callbacks = callbacks;
  }

  // ── Lifecycle ────────────────────────────────────────────
  private clearOverlay(): void {
    if (this.searchTimerInterval) {
      clearInterval(this.searchTimerInterval);
      this.searchTimerInterval = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private createOverlay(bg = 'rgba(5,5,16,0.85)'): HTMLElement {
    this.clearOverlay();
    const el = document.createElement('div');
    el.style.cssText = `${OVERLAY_BASE} background: ${bg};`;
    document.body.appendChild(el);
    this.overlay = el;
    return el;
  }

  // ============================================
  // SCREEN 1: Registration
  // ============================================
  showRegistration(): void {
    const ov = this.createOverlay();

    // Title
    const title = document.createElement('div');
    title.style.cssText = glowText(BLUE, 42);
    title.textContent = 'MULTIPLAYER';
    ov.appendChild(title);

    const sub = document.createElement('div');
    sub.style.cssText = `font-size:14px; color:#aaa; letter-spacing:3px; margin:12px 0 40px; text-transform:uppercase;`;
    sub.textContent = 'Enter your display name to compete';
    ov.appendChild(sub);

    // Username input
    ov.appendChild(sectionLabel('DISPLAY NAME'));

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex; gap:12px; align-items:center; margin-bottom:16px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'YourRedditUsername';
    input.maxLength = 24;
    input.style.cssText = `
      background: rgba(255,255,255,0.08); color:#fff; border:2px solid ${BLUE};
      padding:12px 20px; font-size:16px; font-family:${FONT}; font-weight:bold;
      border-radius:6px; letter-spacing:1px; width:280px;
      outline:none; transition: all 0.2s;
    `;
    input.addEventListener('focus', () => { input.style.borderColor = GREEN; input.style.boxShadow = `0 0 15px ${GREEN}44`; });
    input.addEventListener('blur', () => { input.style.borderColor = BLUE; input.style.boxShadow = 'none'; });

    // Load saved name
    try {
      const saved = localStorage.getItem('cubitopia_username');
      if (saved) input.value = saved;
    } catch {}

    inputWrap.appendChild(input);
    ov.appendChild(inputWrap);

    // Info text
    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px; color:#666; margin-bottom:30px; max-width:360px; text-align:center; line-height:1.5;';
    info.textContent = 'This name appears on the leaderboard and to opponents. No account required — just pick a name and play.';
    ov.appendChild(info);

    // Error message area
    const errEl = document.createElement('div');
    errEl.style.cssText = `font-size:12px; color:${RED}; margin-bottom:16px; min-height:18px;`;
    ov.appendChild(errEl);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:16px;';

    const backBtn = makeOutlineButton('BACK', GRAY);
    backBtn.addEventListener('click', () => {
      this.clearOverlay();
      this.callbacks.onBackToMenu();
    });
    btnRow.appendChild(backBtn);

    const signInBtn = makeButton('ENTER ARENA', GREEN, 'large');
    signInBtn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name || name.length < 2) {
        errEl.textContent = 'Name must be at least 2 characters';
        return;
      }
      if (name.length > 24) {
        errEl.textContent = 'Name must be 24 characters or less';
        return;
      }
      if (!/^[a-zA-Z0-9_\-]+$/.test(name)) {
        errEl.textContent = 'Letters, numbers, underscores, and dashes only';
        return;
      }

      errEl.textContent = '';
      signInBtn.textContent = 'SIGNING IN...';
      signInBtn.style.opacity = '0.6';
      signInBtn.style.pointerEvents = 'none';

      try {
        localStorage.setItem('cubitopia_username', name);
      } catch {}

      try {
        await this.mp.initialize(name);
        this.showLobby();
      } catch (err) {
        errEl.textContent = `Sign-in failed: ${err}`;
        signInBtn.textContent = 'ENTER ARENA';
        signInBtn.style.opacity = '1';
        signInBtn.style.pointerEvents = 'auto';
      }
    });
    btnRow.appendChild(signInBtn);
    ov.appendChild(btnRow);

    // Enter key submits
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') signInBtn.click();
    });

    // Focus input
    setTimeout(() => input.focus(), 100);
  }

  // ============================================
  // SCREEN 2: Lobby (Find Match / Leaderboard / Profile)
  // ============================================
  showLobby(): void {
    const ov = this.createOverlay();
    const profile = this.mp.profile!;

    // Title
    const title = document.createElement('div');
    title.style.cssText = glowText(BLUE, 36);
    title.textContent = 'ARENA LOBBY';
    ov.appendChild(title);

    // Profile card
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255,255,255,0.05); border:2px solid ${BLUE}44;
      border-radius:10px; padding:20px 36px; margin:24px 0 32px;
      display:flex; gap:32px; align-items:center;
    `;

    // Player info
    const playerInfo = document.createElement('div');
    playerInfo.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size:22px; font-weight:bold; color:#fff; font-family:${FONT}; letter-spacing:2px;`;
    nameEl.textContent = profile.displayName;
    playerInfo.appendChild(nameEl);

    const statsRow = document.createElement('div');
    statsRow.style.cssText = 'display:flex; gap:20px;';

    const stat = (label: string, value: string | number, color: string) => {
      const el = document.createElement('div');
      el.style.cssText = `font-size:11px; color:#888; font-family:${FONT}; text-transform:uppercase; letter-spacing:1px;`;
      el.innerHTML = `${label} <span style="color:${color}; font-size:16px; font-weight:bold;">${value}</span>`;
      return el;
    };

    statsRow.appendChild(stat('ELO', profile.elo, GOLD));
    statsRow.appendChild(stat('W', profile.wins ?? 0, GREEN));
    statsRow.appendChild(stat('L', profile.losses ?? 0, RED));
    statsRow.appendChild(stat('STREAK', Math.max(0, profile.streak ?? 0), PURPLE));
    playerInfo.appendChild(statsRow);

    card.appendChild(playerInfo);
    ov.appendChild(card);

    // Action buttons
    const btnGrid = document.createElement('div');
    btnGrid.style.cssText = 'display:flex; gap:16px; margin-bottom:24px;';

    const findBtn = makeButton('FIND MATCH', GREEN, 'large');
    findBtn.addEventListener('click', () => {
      this.showSearching();
    });
    btnGrid.appendChild(findBtn);

    const leaderBtn = makeOutlineButton('LEADERBOARD', GOLD);
    leaderBtn.addEventListener('click', () => {
      this.showLeaderboard();
    });
    btnGrid.appendChild(leaderBtn);

    ov.appendChild(btnGrid);

    // Back button
    const backBtn = makeOutlineButton('MAIN MENU', GRAY);
    backBtn.addEventListener('click', () => {
      this.mp.cleanup();
      this.clearOverlay();
      this.callbacks.onBackToMenu();
    });
    ov.appendChild(backBtn);
  }

  // ============================================
  // SCREEN 3: Searching for Opponent
  // ============================================
  showSearching(): void {
    const ov = this.createOverlay('rgba(5,5,16,0.92)');

    // Animated searching title
    const title = document.createElement('div');
    title.style.cssText = glowText(BLUE, 36);
    title.textContent = 'SEARCHING';
    ov.appendChild(title);

    // Animated dots
    const dots = document.createElement('div');
    dots.style.cssText = `font-size:36px; color:${BLUE}; margin:8px 0 24px; letter-spacing:8px;`;
    let dotCount = 0;
    const dotInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      dots.textContent = '.'.repeat(dotCount || 1);
    }, 400);

    ov.appendChild(dots);

    // Timer
    const timerEl = document.createElement('div');
    timerEl.style.cssText = `font-size:14px; color:#888; font-family:${FONT}; margin-bottom:8px;`;
    timerEl.textContent = 'Searching for opponent... 0s';

    const startTime = Date.now();
    this.searchTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      timerEl.textContent = `Searching for opponent... ${elapsed}s`;
    }, 1000);

    ov.appendChild(timerEl);

    // ELO range info
    const eloInfo = document.createElement('div');
    eloInfo.style.cssText = `font-size:11px; color:#555; font-family:${FONT}; margin-bottom:8px;`;
    eloInfo.textContent = `Your ELO: ${this.mp.profile?.elo ?? 1000} | UID: ${this.mp.profile?.uid?.slice(0, 8) ?? '?'}`;
    ov.appendChild(eloInfo);

    // Debug log panel (visible on screen)
    const debugLog = document.createElement('div');
    debugLog.style.cssText = `
      font-size:10px; color:#666; font-family:monospace; margin-bottom:16px;
      max-height:120px; overflow-y:auto; text-align:left; padding:8px;
      background:rgba(0,0,0,0.3); border-radius:4px; width:80%; max-width:400px;
    `;
    debugLog.innerHTML = '<div style="color:#555;margin-bottom:4px;">── Debug Log ──</div>';
    ov.appendChild(debugLog);

    const addDebug = (msg: string, color = '#888') => {
      const line = document.createElement('div');
      line.style.color = color;
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      debugLog.appendChild(line);
      debugLog.scrollTop = debugLog.scrollHeight;
      console.log(`[MM] ${msg}`);
    };

    // Expose debug logger globally so MatchmakingService can use it
    (window as any).__mmDebug = addDebug;
    addDebug('Starting matchmaking...');

    // Cancel button
    const cancelBtn = makeOutlineButton('CANCEL', RED);
    cancelBtn.addEventListener('click', async () => {
      clearInterval(dotInterval);
      await this.mp.cancelSearch();
      this.showLobby();
    });
    ov.appendChild(cancelBtn);

    // Start matchmaking
    this.mp.setEvents({
      onMatchFound: (result: MatchFoundResult) => {
        clearInterval(dotInterval);
        addDebug(`Match found! host=${result.isHost} ghost=${result.isGhost} id=${result.matchId.slice(0,8)}`, GREEN);
        this.showOpponentFound(result);
      },
      onError: (msg: string) => {
        clearInterval(dotInterval);
        addDebug(`ERROR: ${msg}`, RED);
        title.textContent = 'ERROR';
        title.style.color = RED;
        timerEl.textContent = msg;
      },
    });

    this.mp.findMatch().catch((err) => {
      clearInterval(dotInterval);
      addDebug(`findMatch error: ${err}`, RED);
      timerEl.textContent = `Error: ${err}`;
    });
  }

  // ============================================
  // SCREEN 4: Opponent Found
  // ============================================
  showOpponentFound(result: MatchFoundResult): void {
    const ov = this.createOverlay('rgba(5,5,16,0.95)');

    // Flash effect
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:absolute; top:0; left:0; width:100%; height:100%;
      background: radial-gradient(circle, ${GREEN}22 0%, transparent 70%);
      animation: pulse 1s ease-out;
      pointer-events:none;
    `;
    ov.appendChild(flash);

    // Title
    const title = document.createElement('div');
    title.style.cssText = glowText(GREEN, 36);
    title.textContent = 'OPPONENT FOUND';
    ov.appendChild(title);

    // VS Display
    const vsContainer = document.createElement('div');
    vsContainer.style.cssText = `
      display:flex; align-items:center; gap:40px; margin:32px 0;
    `;

    // Player card
    const playerCard = this.createPlayerCard(
      this.mp.profile!.displayName,
      this.mp.profile!.elo,
      BLUE,
      'YOU',
    );
    vsContainer.appendChild(playerCard);

    // VS
    const vsEl = document.createElement('div');
    vsEl.style.cssText = `font-size:28px; font-weight:bold; color:#555; font-family:${FONT}; letter-spacing:4px;`;
    vsEl.textContent = 'VS';
    vsContainer.appendChild(vsEl);

    // Opponent card
    const oppCard = this.createPlayerCard(
      result.opponentName,
      result.opponentElo,
      RED,
      result.isGhost ? 'CHALLENGER' : 'OPPONENT',
    );
    vsContainer.appendChild(oppCard);

    ov.appendChild(vsContainer);

    // Map info
    const mapInfo = document.createElement('div');
    mapInfo.style.cssText = `font-size:12px; color:#666; font-family:${FONT}; letter-spacing:2px; margin-bottom:32px;`;
    mapInfo.textContent = `MAP SEED: ${result.mapSeed} | ${result.mapType.toUpperCase()}`;
    ov.appendChild(mapInfo);

    // Loading bar
    const barWrap = document.createElement('div');
    barWrap.style.cssText = `
      width:300px; height:4px; background:rgba(255,255,255,0.1);
      border-radius:2px; overflow:hidden; margin-bottom:16px;
    `;
    const bar = document.createElement('div');
    bar.style.cssText = `
      width:0%; height:100%; background:${GREEN};
      transition: width 2.5s ease-in-out;
    `;
    barWrap.appendChild(bar);
    ov.appendChild(barWrap);

    const loadingText = document.createElement('div');
    loadingText.style.cssText = `font-size:12px; color:#888; font-family:${FONT}; letter-spacing:2px;`;
    loadingText.textContent = 'LOADING MATCH...';
    ov.appendChild(loadingText);

    // Animate loading bar then start game
    setTimeout(() => { bar.style.width = '100%'; }, 100);

    setTimeout(() => {
      this.clearOverlay();
      this.callbacks.onStartMultiplayerGame(
        result.mapSeed,
        result.mapType as MapType,
        result.isGhost,
        result.opponentName,
        result.ghostProfile?.difficulty,
      );
    }, 3000);
  }

  private createPlayerCard(name: string, elo: number, color: string, label: string): HTMLElement {
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255,255,255,0.04); border:2px solid ${color}44;
      border-radius:10px; padding:20px 28px; min-width:180px;
      display:flex; flex-direction:column; align-items:center; gap:8px;
    `;

    const labelEl = document.createElement('div');
    labelEl.style.cssText = `font-size:10px; color:#666; font-family:${FONT}; letter-spacing:3px; text-transform:uppercase;`;
    labelEl.textContent = label;
    card.appendChild(labelEl);

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size:18px; font-weight:bold; color:${color}; font-family:${FONT}; letter-spacing:1px;`;
    nameEl.textContent = name;
    card.appendChild(nameEl);

    const eloEl = document.createElement('div');
    eloEl.style.cssText = `font-size:14px; color:${GOLD}; font-family:${FONT}; font-weight:bold;`;
    eloEl.textContent = `${elo} ELO`;
    card.appendChild(eloEl);

    return card;
  }

  // ============================================
  // SCREEN 5: Match Result (Victory/Defeat + ELO)
  // ============================================
  showMatchResult(won: boolean, eloResult: EloUpdateResult, opponentName: string): void {
    const ov = this.createOverlay('rgba(0,0,0,0.85)');
    const color = won ? GREEN : RED;

    // Result title
    const title = document.createElement('div');
    title.style.cssText = glowText(color, 56);
    title.textContent = won ? 'VICTORY' : 'DEFEAT';
    ov.appendChild(title);

    // Opponent info
    const oppInfo = document.createElement('div');
    oppInfo.style.cssText = `font-size:16px; color:#bbb; font-family:${FONT}; margin:12px 0 32px; letter-spacing:2px;`;
    oppInfo.textContent = won ? `You defeated ${opponentName}!` : `${opponentName} has won the battle`;
    ov.appendChild(oppInfo);

    // ELO change card
    const eloCard = document.createElement('div');
    eloCard.style.cssText = `
      background: rgba(255,255,255,0.05); border:2px solid ${GOLD}44;
      border-radius:12px; padding:24px 40px; margin-bottom:32px;
      display:flex; flex-direction:column; align-items:center; gap:12px;
    `;

    const eloLabel = document.createElement('div');
    eloLabel.style.cssText = `font-size:11px; color:#888; font-family:${FONT}; letter-spacing:3px; text-transform:uppercase;`;
    eloLabel.textContent = 'ELO RATING';
    eloCard.appendChild(eloLabel);

    const eloValue = document.createElement('div');
    eloValue.style.cssText = `font-size:36px; font-weight:bold; color:${GOLD}; font-family:${FONT};`;
    eloValue.textContent = String(eloResult.newElo);
    eloCard.appendChild(eloValue);

    const changeEl = document.createElement('div');
    const changeColor = eloResult.change >= 0 ? GREEN : RED;
    const changePrefix = eloResult.change >= 0 ? '+' : '';
    changeEl.style.cssText = `font-size:20px; font-weight:bold; color:${changeColor}; font-family:${FONT};`;
    changeEl.textContent = `${changePrefix}${eloResult.change}`;
    eloCard.appendChild(changeEl);

    if (this.mp.isGhostMatch) {
      const ghostNote = document.createElement('div');
      ghostNote.style.cssText = `font-size:10px; color:#555; font-family:${FONT}; letter-spacing:1px;`;
      ghostNote.textContent = 'RANKED MATCH';
      eloCard.appendChild(ghostNote);
    }

    ov.appendChild(eloCard);

    // Stats row
    const statsRow = document.createElement('div');
    statsRow.style.cssText = `display:flex; gap:24px; margin-bottom:32px;`;

    const profile = this.mp.profile;
    if (profile) {
      const miniStat = (label: string, value: string | number, c: string) => {
        const el = document.createElement('div');
        el.style.cssText = `text-align:center;`;
        el.innerHTML = `
          <div style="font-size:10px; color:#666; font-family:${FONT}; letter-spacing:2px; text-transform:uppercase;">${label}</div>
          <div style="font-size:18px; font-weight:bold; color:${c}; font-family:${FONT};">${value}</div>
        `;
        return el;
      };
      statsRow.appendChild(miniStat('WINS', profile.wins ?? 0, GREEN));
      statsRow.appendChild(miniStat('LOSSES', profile.losses ?? 0, RED));
      statsRow.appendChild(miniStat('STREAK', Math.max(0, profile.streak ?? 0), PURPLE));
    }
    ov.appendChild(statsRow);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:16px;';

    const rematchBtn = makeButton('FIND NEXT MATCH', GREEN, 'large');
    rematchBtn.addEventListener('click', () => {
      this.mp.returnToLobby();
      this.showSearching();
    });
    btnRow.appendChild(rematchBtn);

    const lobbyBtn = makeOutlineButton('LOBBY', BLUE);
    lobbyBtn.addEventListener('click', () => {
      this.mp.returnToLobby();
      this.showLobby();
    });
    btnRow.appendChild(lobbyBtn);

    const menuBtn = makeOutlineButton('MAIN MENU', GRAY);
    menuBtn.addEventListener('click', () => {
      this.mp.cleanup();
      this.clearOverlay();
      this.callbacks.onBackToMenu();
    });
    btnRow.appendChild(menuBtn);

    ov.appendChild(btnRow);
  }

  // ============================================
  // SCREEN 6: Leaderboard
  // ============================================
  async showLeaderboard(): Promise<void> {
    const ov = this.createOverlay('rgba(5,5,16,0.92)');

    // Title
    const title = document.createElement('div');
    title.style.cssText = glowText(GOLD, 36);
    title.textContent = 'LEADERBOARD';
    ov.appendChild(title);

    const sub = document.createElement('div');
    sub.style.cssText = `font-size:12px; color:#666; font-family:${FONT}; letter-spacing:3px; margin:8px 0 24px; text-transform:uppercase;`;
    sub.textContent = 'TOP 25 PLAYERS BY ELO';
    ov.appendChild(sub);

    // Loading spinner
    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = `font-size:14px; color:#888; font-family:${FONT}; margin:40px 0;`;
    loadingEl.textContent = 'Loading...';
    ov.appendChild(loadingEl);

    // Fetch leaderboard
    try {
      const players = await this.mp.getLeaderboard(25);
      loadingEl.remove();

      if (players.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.style.cssText = `font-size:14px; color:#666; font-family:${FONT}; margin:40px 0;`;
        emptyEl.textContent = 'No players yet — be the first to compete!';
        ov.appendChild(emptyEl);
      } else {
        // Table
        const table = document.createElement('div');
        table.style.cssText = `
          background: rgba(255,255,255,0.03); border:2px solid ${GOLD}22;
          border-radius:10px; overflow:hidden; width:480px; max-height:400px;
          overflow-y:auto;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
          display:grid; grid-template-columns: 40px 1fr 80px 60px 60px;
          padding:10px 16px; background:rgba(255,255,255,0.05);
          font-size:10px; color:#666; font-family:${FONT}; letter-spacing:2px;
          text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.1);
        `;
        header.innerHTML = '<div>#</div><div>PLAYER</div><div>ELO</div><div>W</div><div>L</div>';
        table.appendChild(header);

        // Rows
        players.forEach((p, i) => {
          const isMe = p.uid === this.mp.profile?.uid;
          const rankColor = i === 0 ? GOLD : i === 1 ? '#bdc3c7' : i === 2 ? '#cd7f32' : '#888';

          const row = document.createElement('div');
          row.style.cssText = `
            display:grid; grid-template-columns: 40px 1fr 80px 60px 60px;
            padding:8px 16px; font-size:12px; font-family:${FONT};
            border-bottom:1px solid rgba(255,255,255,0.04);
            background: ${isMe ? 'rgba(52,152,219,0.1)' : 'transparent'};
            transition: background 0.15s;
          `;

          const rankEl = document.createElement('div');
          rankEl.style.cssText = `color:${rankColor}; font-weight:bold;`;
          rankEl.textContent = String(i + 1);

          const nameCell = document.createElement('div');
          nameCell.style.cssText = `color:${isMe ? BLUE : '#ccc'}; font-weight:${isMe ? 'bold' : 'normal'};`;
          nameCell.textContent = p.displayName + (isMe ? ' (YOU)' : '');

          const eloCell = document.createElement('div');
          eloCell.style.cssText = `color:${GOLD}; font-weight:bold;`;
          eloCell.textContent = String(p.elo);

          const winsCell = document.createElement('div');
          winsCell.style.cssText = `color:${GREEN};`;
          winsCell.textContent = String(p.wins ?? 0);

          const lossCell = document.createElement('div');
          lossCell.style.cssText = `color:${RED};`;
          lossCell.textContent = String(p.losses ?? 0);

          row.appendChild(rankEl);
          row.appendChild(nameCell);
          row.appendChild(eloCell);
          row.appendChild(winsCell);
          row.appendChild(lossCell);

          row.addEventListener('mouseenter', () => {
            if (!isMe) row.style.background = 'rgba(255,255,255,0.04)';
          });
          row.addEventListener('mouseleave', () => {
            row.style.background = isMe ? 'rgba(52,152,219,0.1)' : 'transparent';
          });

          table.appendChild(row);
        });

        ov.appendChild(table);
      }
    } catch (err) {
      loadingEl.textContent = `Failed to load leaderboard: ${err}`;
    }

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:24px;';
    ov.appendChild(spacer);

    // Back button
    const backBtn = makeOutlineButton('BACK TO LOBBY', BLUE);
    backBtn.addEventListener('click', () => {
      this.showLobby();
    });
    ov.appendChild(backBtn);
  }

  // ============================================
  // In-match HUD overlay (ping, opponent name)
  // ============================================
  createMatchHUD(): HTMLElement {
    const hud = document.createElement('div');
    hud.style.cssText = `
      position:fixed; top:12px; right:12px;
      background:rgba(0,0,0,0.7); border:1px solid rgba(255,255,255,0.15);
      border-radius:8px; padding:8px 14px;
      font-family:${FONT}; font-size:11px; color:#aaa;
      z-index:150; display:flex; flex-direction:column; gap:4px;
      pointer-events:auto;
    `;

    const oppRow = document.createElement('div');
    oppRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
    oppRow.innerHTML = `
      <span style="color:#666; letter-spacing:1px; text-transform:uppercase; font-size:9px;">VS</span>
      <span style="color:${RED}; font-weight:bold;" id="mp-hud-opponent">${this.mp.opponentName}</span>
      <span style="color:${GOLD}; font-size:10px;" id="mp-hud-opp-elo">${this.mp.opponentElo}</span>
    `;
    hud.appendChild(oppRow);

    const pingRow = document.createElement('div');
    pingRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
    pingRow.innerHTML = `
      <span style="color:#666; letter-spacing:1px; text-transform:uppercase; font-size:9px;">PING</span>
      <span id="mp-hud-ping" style="color:${GREEN}; font-weight:bold;">--</span>
      <span style="color:#666; font-size:9px;">ms</span>
    `;
    hud.appendChild(pingRow);

    // Surrender button
    const surrenderBtn = document.createElement('button');
    surrenderBtn.style.cssText = `
      background:transparent; color:${RED}; border:1px solid ${RED}44;
      padding:4px 10px; font-size:9px; font-family:${FONT}; font-weight:bold;
      border-radius:4px; cursor:pointer; letter-spacing:1px;
      margin-top:4px; transition: all 0.2s; text-transform:uppercase;
    `;
    surrenderBtn.textContent = 'SURRENDER';
    surrenderBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to surrender?')) {
        this.mp.surrender();
      }
    });
    surrenderBtn.addEventListener('mouseenter', () => {
      surrenderBtn.style.background = RED;
      surrenderBtn.style.color = '#fff';
    });
    surrenderBtn.addEventListener('mouseleave', () => {
      surrenderBtn.style.background = 'transparent';
      surrenderBtn.style.color = RED;
    });
    hud.appendChild(surrenderBtn);

    return hud;
  }

  /** Update ping display in match HUD */
  updatePing(ms: number): void {
    const el = document.getElementById('mp-hud-ping');
    if (el) {
      el.textContent = String(ms);
      el.style.color = ms < 80 ? GREEN : ms < 150 ? GOLD : RED;
    }
  }

  // ── Cleanup ──────────────────────────────────────────────
  cleanup(): void {
    this.clearOverlay();
  }
}
