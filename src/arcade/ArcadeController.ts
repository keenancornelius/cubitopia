// ============================================
// CUBITOPIA - Arcade controller (Arena mode rules + touch HUD + host bridge)
// ============================================
// Glue between the main game (Cubitopia in main.ts) and the arcade layer:
//   • Arena match rules for every Player-vs-AI Arena game: elimination ends a
//     round (fixes the old stall where the last army standing just idled),
//     3-minute round clock with an HP tiebreak, best of 3 rounds.
//   • ?mode=arena: arcade menu instead of the full menu, phone HUD with big
//     tap buttons, desktop HUD hidden.
//   • Touch gestures on the canvas (TouchControls) for every mode.
//   • Legion app contract: ready/exit postMessage + window.__cubPause.
//
// main.ts calls: bootMenu(), returnToMenu(), onGameStarted(), afterSimulation(),
// interceptMainBaseCapture(), frame(), and reads `paused`.
// Like InputManager, it reaches into the game through an untyped handle.
// ============================================

import * as THREE from 'three';
import { MapType, UnitStance, UnitType } from '../types';
import type { Unit } from '../types';
import { ARCADE_ARENA, EMBED_LEGION, IS_TOUCH_DEVICE, ARENA_WINS_TO_TAKE_MATCH, ARENA_AI_HEALTH } from './ArcadeConfig';
import { notifyReady, notifyExit, installPauseHook } from './EmbedBridge';
import { ArcadeUI, type HudState } from './ArcadeUI';
import { TouchControls } from './TouchControls';

/** Round clock: when it runs out, the side with more total HP takes the round. */
const ROUND_SECONDS = 180;
/** Pause between a round ending and the next one starting (game seconds). */
const ROUND_END_DELAY = 2.8;

type RoundResult = 'win' | 'loss' | 'draw';

export class ArcadeController {
  /** Read by the main loop: while true the simulation and rendering are frozen. */
  paused = false;

  private ui: ArcadeUI;
  private touch: TouchControls;
  private game: any;

  // Arena match state
  private matchActive = false;
  private wins: [number, number] = [0, 0];
  private round = 1;
  private roundTime = 0;
  private matchTime = 0;
  private roundEnding = false;
  private pending: { delay: number; fn: () => void } | null = null;
  private kills = 0;
  private roundStartAlive: [number, number] = [0, 0];
  private lost = 0;
  private attackMoveArmed = false;
  private hudTimer = 0;
  private firstRoundHintShown = false;
  private pausedExternally = false;

  constructor(game: any) {
    this.game = game;
    this.ui = new ArcadeUI(EMBED_LEGION);
    if (IS_TOUCH_DEVICE) this.ui.enableTouchPage();
    if (ARCADE_ARENA) this.ui.enableArcadeBody();

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    // Keep the drag-select rectangle visible in arcade mode
    game.selectionManager.selectBoxElement.classList.add('cub-keep');
    this.touch = new TouchControls({
      canvas,
      camera: game.camera,
      selection: game.selectionManager,
      getUnits: () => game.allUnits,
      localPlayer: () => game._localPlayerIndex,
      canCommand: () => this.canCommand(),
      issueCommand: (w) => game.issueCommand(w),
      attackUnit: (enemy) => this.attackUnit(enemy),
      attackMove: (w) => this.attackMove(w),
      isAttackMoveArmed: () => this.attackMoveArmed,
      disarmAttackMove: () => { this.attackMoveArmed = false; this.refreshHud(); },
      hint: (msg) => this.hint(msg),
    });

    installPauseHook((p) => this.setPaused(p, true));
    // Arcade/embedded: pause when the page is hidden (app backgrounded, tab switched)
    if (ARCADE_ARENA || EMBED_LEGION) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.setPaused(true, true);
      });
    }

    if (ARCADE_ARENA) {
      // Desktop toasts live in the hidden HUD — route them to the arcade toast
      const hud = game.hud;
      hud.showNotification = (msg: string, color?: string) => {
        const c = typeof color === 'string' && color.startsWith('#') ? color : '#eef2ff';
        this.ui.toast(String(msg), c, 1500);
      };
    }
  }

  // ── Menus ─────────────────────────────────────────────────

  /** Boot: show the arcade menu (?mode=arena) or the full main menu. */
  bootMenu(): void {
    if (ARCADE_ARENA) this.showArcadeMenu();
    else this.game.menuController.showMainMenu();
    // Host contract: ready once the first menu is interactive (next frame = painted)
    requestAnimationFrame(() => requestAnimationFrame(() => notifyReady()));
  }

  /** Called where the game would show the main menu again (after a match). */
  returnToMenu(): boolean {
    if (!ARCADE_ARENA) return false;
    this.showArcadeMenu();
    return true;
  }

  private showArcadeMenu(): void {
    this.matchActive = false;
    this.ui.hideHUD();
    this.ui.hideOverlay();
    this.ui.clearBanner();
    this.game.hud.setVisible(false);
    this.ui.showMenu({
      onPlay: () => this.startArena(),
      onExit: EMBED_LEGION ? () => this.exitToHost() : undefined,
      onFullGame: EMBED_LEGION ? undefined : () => this.openFullGame(),
    });
  }

  private openFullGame(): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      window.location.href = url.toString();
    } catch { /* ignore */ }
  }

  private exitToHost(): void {
    notifyExit();
  }

  /** Start a fresh best-of-3 arena match (from the arcade menu). */
  private startArena(): void {
    const g = this.game;
    this.setPaused(false, false);
    this.ui.hideMenu();
    this.resetMatch();
    g.music.stopTitleMusic();
    g.music.resumeGameplay();
    g._stopTitleScene();
    g.hud.setVisible(true);
    g.gameMode = 'pvai';
    g.mapType = MapType.ARENA;
    g.playerTribe = g.menuController.getSelectedTribe();
    if (g.currentMap) g.restartGame(); else g.startNewGame();
  }

  private resetMatch(): void {
    this.wins = [0, 0];
    this.round = 1;
    this.matchTime = 0;
    this.kills = 0;
    this.lost = 0;
    this.firstRoundHintShown = false;
  }

  // ── Game hooks ────────────────────────────────────────────

  /** startNewGame() finished. Arena + Player-vs-AI games get round rules. */
  onGameStarted(isArena: boolean): void {
    const g = this.game;
    this.matchActive = isArena && g.gameMode === 'pvai';
    this.roundTime = 0;
    this.roundEnding = false;
    this.pending = null;
    this.attackMoveArmed = false;
    if (!this.matchActive) return;
    // Difficulty: scale the AI army's HP (see ARENA_AI_HEALTH)
    for (const u of g.allUnits as Unit[]) {
      if (u.owner === g._localPlayerIndex) continue;
      u.stats.maxHealth = Math.max(1, Math.round(u.stats.maxHealth * ARENA_AI_HEALTH));
      u.currentHealth = u.stats.maxHealth;
    }
    this.roundStartAlive = this.armyStats().alive;
    if (ARCADE_ARENA) {
      g.minimap.setVisible(false);
      this.frameArena();
      this.ui.showHUD({
        onMenu: () => this.setPaused(true, false),
        onSelectAll: () => this.selectArmy(),
        onDeselect: () => g.selectionManager.selectUnits([]),
        onAttackMove: () => this.toggleAttackMove(),
        onStance: (s) => this.setStance(s),
        onElement: (e) => this.lockElement(e),
        onCenter: () => this.centerOnArmy(),
      });
      this.refreshHud();
    }
    this.ui.banner(`ROUND ${this.round}`, this.wins[0] + this.wins[1] === 0 ? 'Wipe out the red army' : `YOU ${this.wins[0]} – ${this.wins[1]} AI`, '#ffc940', 1800);
    if (ARCADE_ARENA && !this.firstRoundHintShown) {
      this.firstRoundHintShown = true;
      window.setTimeout(() => this.hint('Tap ARMY, then tap a red unit to attack'), 2000);
    }
  }

  /** After each simulation step: elimination / round clock. */
  afterSimulation(delta: number): void {
    if (!this.matchActive || this.roundEnding) return;
    const g = this.game;
    this.roundTime += delta;
    this.matchTime += delta;
    if (g.gameOver) return;
    const { alive, hp } = this.armyStats();
    if (alive[0] === 0 || alive[1] === 0) {
      this.endRound(alive[0] === 0 && alive[1] === 0 ? 'draw' : alive[1] === 0 ? 'win' : 'loss');
    } else if (this.roundTime >= ROUND_SECONDS) {
      const a = hp[0], b = hp[1];
      this.endRound(Math.abs(a - b) < 1e-3 ? 'draw' : a > b ? 'win' : 'loss', true);
    }
  }

  /** A main base was captured. In an arena match that just ends the round. */
  interceptMainBaseCapture(newOwner: number): boolean {
    if (!this.matchActive) return false;
    if (!this.roundEnding) this.endRound(newOwner === this.game._localPlayerIndex ? 'win' : 'loss');
    return true;
  }

  /** Every rendered frame (real seconds). */
  frame(rawDelta: number): void {
    if (this.paused) return;
    if (this.pending) {
      this.pending.delay -= rawDelta;
      if (this.pending.delay <= 0) {
        const fn = this.pending.fn;
        this.pending = null;
        fn();
      }
    }
    this.hudTimer += rawDelta;
    if (this.hudTimer >= 0.2) { this.hudTimer = 0; this.refreshHud(); }
  }

  // ── Rounds ────────────────────────────────────────────────

  private endRound(result: RoundResult, timeUp = false): void {
    const g = this.game;
    this.roundEnding = true;
    this.attackMoveArmed = false;
    // Tally this round's casualties
    const { alive } = this.armyStats();
    this.lost += Math.max(0, this.roundStartAlive[0] - alive[0]);
    this.kills += Math.max(0, this.roundStartAlive[1] - alive[1]);
    if (result === 'win') this.wins[0]++;
    else if (result === 'loss') this.wins[1]++;
    const decided = this.wins[0] >= ARENA_WINS_TO_TAKE_MATCH || this.wins[1] >= ARENA_WINS_TO_TAKE_MATCH;
    const sub = timeUp ? 'Time! Most HP left takes it' : `YOU ${this.wins[0]} – ${this.wins[1]} AI`;
    if (result === 'win') { this.ui.banner('ROUND WON', sub, '#2fd27a'); g.sound.play('zone_captured', 0.6); }
    else if (result === 'loss') { this.ui.banner('ROUND LOST', sub, '#ff4d4d'); g.sound.play('queue_error', 0.6); }
    else this.ui.banner('DRAW', 'Replay the round', '#9cc4ff');
    this.refreshHud();
    this.pending = {
      delay: ROUND_END_DELAY,
      fn: () => {
        if (decided) this.finishMatch(this.wins[0] > this.wins[1]);
        else {
          if (result !== 'draw') this.round++;
          g.restartGame();
        }
      },
    };
  }

  private finishMatch(victory: boolean): void {
    const g = this.game;
    g.gameOver = true;
    this.matchActive = false;
    g.sound.stopAmbient();
    g.sound.play(victory ? 'victory' : 'defeat', 0.8);
    if (!ARCADE_ARENA) {
      g.showGameOverScreen(victory ? 'PLAYER' : 'AI RED', victory);
      return;
    }
    this.ui.hideHUD();
    this.ui.showResult({
      victory, wins: this.wins, kills: this.kills, lost: this.lost, seconds: this.matchTime,
      onPlayAgain: () => { this.ui.hideOverlay(); this.resetMatch(); g.restartGame(); },
      onExit: EMBED_LEGION ? () => this.exitToHost() : undefined,
      onMenu: () => { this.ui.hideOverlay(); this.showArcadeMenu(); },
    });
  }

  // ── Pause ─────────────────────────────────────────────────

  /**
   * Pause/resume. `external` = host app or page visibility (shows a simple
   * resume card). Internal pauses come from the ☰ button.
   */
  setPaused(p: boolean, external: boolean): void {
    const g = this.game;
    if (p) {
      this.pausedExternally = external;
      if (!this.paused) { this.paused = true; this.setAudio(false); }
      if (this.inMatch() && this.ui.overlayKind !== 'result' && this.ui.overlayKind !== 'howto') this.showPauseMenu();
      return;
    }
    if (!this.paused) return;
    this.paused = false;
    this.setAudio(true);
    if (this.ui.overlayKind === 'pause' || this.ui.overlayKind === 'howto') this.ui.hideOverlay();
    g.clock.getDelta(); // drop the paused gap so the sim doesn't jump
  }

  private setAudio(on: boolean): void {
    const g = this.game;
    for (const ctx of [g.sound?.ctx, g.music?.ctx] as (AudioContext | null | undefined)[]) {
      if (!ctx) continue;
      try { (on ? ctx.resume() : ctx.suspend()).catch(() => {}); } catch { /* ignore */ }
    }
  }

  private inMatch(): boolean {
    return !!this.game.currentMap && !this.game.gameOver && !this.ui.menuVisible;
  }

  private showPauseMenu(): void {
    this.ui.showPause({
      external: this.pausedExternally,
      onResume: () => this.setPaused(false, false),
      onRestart: () => {
        this.ui.hideOverlay();
        this.setPaused(false, false);
        if (this.matchActive || ARCADE_ARENA) { this.resetMatch(); }
        this.game.restartGame();
      },
      onHow: () => this.ui.showHowTo(() => this.showPauseMenu()),
      onExit: EMBED_LEGION ? () => this.exitToHost() : undefined,
      onMainMenu: !EMBED_LEGION ? () => {
        this.ui.hideOverlay();
        this.setPaused(false, false);
        if (ARCADE_ARENA) { this.game.gameOver = true; this.showArcadeMenu(); }
        else this.game.regenerateMap();
      } : undefined,
    });
  }

  // ── Commands ──────────────────────────────────────────────

  private canCommand(): boolean {
    const g = this.game;
    if (this.paused || !g.currentMap || g.gameOver) return false;
    if (this.ui.menuVisible || this.ui.overlayKind) return false;
    if (this.roundEnding) return false;
    return true;
  }

  private myArmy(): Unit[] {
    const me = this.game._localPlayerIndex;
    return (this.game.allUnits as Unit[]).filter(u => u.owner === me && u.state !== 'dead');
  }

  private selected(): Unit[] {
    return (this.game.selectionManager.getSelectedUnits() as Unit[]).filter(u => u.state !== 'dead');
  }

  private selectArmy(): void {
    const army = this.myArmy();
    this.game.selectionManager.selectUnits(army);
    this.hint(`Army selected (${army.length}) — tap ground to move, red unit to attack`);
  }

  private ensureSelection(): Unit[] {
    let sel = this.selected();
    if (sel.length === 0) {
      this.game.selectionManager.selectUnits(this.myArmy());
      sel = this.selected();
    }
    return sel;
  }

  private toggleAttackMove(): void {
    if (this.attackMoveArmed) { this.attackMoveArmed = false; this.refreshHud(); return; }
    if (this.ensureSelection().length === 0) return;
    this.attackMoveArmed = true;
    this.hint('Tap a spot — units attack anything on the way');
    this.refreshHud();
  }

  private setStance(s: 'charge' | 'hold'): void {
    if (this.ensureSelection().length === 0) return;
    this.game.setSelectedUnitsStance(s === 'charge' ? UnitStance.AGGRESSIVE : UnitStance.DEFENSIVE);
    this.hint(s === 'charge' ? 'CHARGE — hunting the nearest enemy' : 'HOLD — defending this ground');
    this.refreshHud();
  }

  private lockElement(element: string): void {
    const mages = this.selected().filter(u => u.type === UnitType.MAGE || u.type === UnitType.BATTLEMAGE);
    if (mages.length === 0) return;
    const allLocked = mages.every(m => m._lockedElement === element);
    const ids = mages.map(m => m.id);
    if (allLocked) {
      this.game.enqueueCommand('unlock_element', { unitIds: ids, element: null });
      this.hint(`${element.toUpperCase()} unlocked — mages cycle elements`);
    } else {
      this.game.enqueueCommand('lock_element', { unitIds: ids, element });
      this.hint(`${mages.length} mage${mages.length === 1 ? '' : 's'} locked to ${element.toUpperCase()}`);
    }
    // Lockstep queue applies on the next tick; refresh shortly after
    window.setTimeout(() => this.refreshHud(), 120);
  }

  private attackUnit(enemy: Unit): void {
    const g = this.game;
    const sel = this.selected();
    if (sel.length === 0) return;
    g.enqueueCommand('attack', { unitIds: sel.map(u => u.id), targetUnitId: enemy.id });
    const wp = enemy.worldPosition;
    g.spawnClickIndicator(new THREE.Vector3(wp.x, wp.y, wp.z), 0xff2222, 1.0);
    g.unitRenderer.triggerSpeechBubble(sel[0].id, sel[0].type, 'attack');
  }

  private attackMove(world: THREE.Vector3): void {
    const g = this.game;
    const sel = this.selected();
    const hex = g.worldToHex(world);
    if (!hex || sel.length === 0) return;
    g.enqueueCommand('attack_move', { unitIds: sel.map(u => u.id), target: hex });
    const elev = g.getElevation(hex);
    g.tileHighlighter.showAttackIndicator(hex, elev);
    g.spawnClickIndicator(world, 0xff9900, 1.0);
  }

  private hint(msg: string): void {
    if (ARCADE_ARENA) this.ui.toast(msg, '#eef2ff', 1800);
    else this.game.hud.showNotification(msg, '#4fc3f7');
  }

  // ── Camera framing ────────────────────────────────────────

  private basePos(owner: number): { x: number; z: number } | null {
    const b = (this.game.bases as { owner: number; position: { q: number; r: number } }[]).find(bb => bb.owner === owner);
    if (!b) return null;
    const { q, r } = b.position;
    return { x: q * 1.5, z: r * 1.5 + (q % 2 === 1 ? 0.75 : 0) };
  }

  /** Point the camera from behind your army toward the enemy: enemy at the top
   *  of the screen in portrait, on the right in landscape. */
  private frameArena(): void {
    const g = this.game;
    const me = g._localPlayerIndex;
    const mine = this.basePos(me), theirs = this.basePos(me === 0 ? 1 : 0);
    if (!mine || !theirs) return;
    let ex = theirs.x - mine.x, ez = theirs.z - mine.z;
    const len = Math.hypot(ex, ez) || 1; ex /= len; ez /= len;
    const portrait = window.innerHeight >= window.innerWidth;
    // Camera offset direction o (from target): portrait o = -e; landscape o = (-ez, ex)
    const theta = portrait ? Math.atan2(-ez, -ex) : Math.atan2(ex, -ez);
    const cx = (mine.x + theirs.x) / 2, cz = (mine.z + theirs.z) / 2;
    // Bias toward your side so your army fills the lower/left part of the view
    const bias = portrait ? 0.18 : 0.12;
    g.camera.focusOn(new THREE.Vector3(cx - ex * len * bias, 1, cz - ez * len * bias));
    g.camera.setOrbit(theta, portrait ? 0.78 : 0.72, portrait ? 44 : 36);
  }

  private centerOnArmy(): void {
    const units = this.selected().length ? this.selected() : this.myArmy();
    if (units.length === 0) return;
    let x = 0, z = 0;
    for (const u of units) { x += u.worldPosition.x; z += u.worldPosition.z; }
    this.game.camera.focusOn(new THREE.Vector3(x / units.length, 1, z / units.length));
  }

  // ── HUD ───────────────────────────────────────────────────

  private armyStats(): { alive: [number, number]; hp: [number, number] } {
    const g = this.game;
    const me = g._localPlayerIndex;
    const alive: [number, number] = [0, 0];
    const hp: [number, number] = [0, 0];
    for (const u of g.allUnits as Unit[]) {
      if (u.state === 'dead' || u.currentHealth <= 0) continue;
      const side = u.owner === me ? 0 : 1;
      alive[side]++;
      hp[side] += u.currentHealth;
    }
    return { alive, hp };
  }

  private refreshHud(): void {
    if (!ARCADE_ARENA || (!this.matchActive && !this.roundEnding)) return;
    const sel = this.selected();
    const counts = new Map<string, number>();
    for (const u of sel) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n > 1 ? n + ' ' : ''}${t.charAt(0).toUpperCase() + t.slice(1)}`).join(', ');
    const mages = sel.filter(u => u.type === UnitType.MAGE || u.type === UnitType.BATTLEMAGE);
    const locked = mages.length && mages.every(m => m._lockedElement && m._lockedElement === mages[0]._lockedElement)
      ? (mages[0]._lockedElement as string) : null;
    let stance: HudState['stance'] = null;
    if (sel.length) {
      const agg = sel.every(u => u.stance === UnitStance.AGGRESSIVE);
      const def = sel.every(u => u.stance === UnitStance.DEFENSIVE);
      stance = agg ? 'charge' : def ? 'hold' : 'mixed';
    }
    const { alive, hp } = this.armyStats();
    this.ui.updateHUD({
      round: this.round, wins: this.wins, timeLeft: ROUND_SECONDS - this.roundTime,
      alive, hp, selected: sel.length, selectedLabel: label, hasMages: mages.length > 0,
      lockedElement: locked, stance, attackMoveArmed: this.attackMoveArmed,
    });
  }
}
