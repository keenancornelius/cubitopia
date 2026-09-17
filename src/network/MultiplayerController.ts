// ============================================
// CUBITOPIA - Multiplayer Controller
// Phase 5B: Top-level orchestrator for online play
// ============================================
//
// This is the main entry point the game calls for multiplayer.
// It coordinates:
//   - Player profile (Firebase anonymous auth + display name)
//   - Matchmaking (queue search + ghost fallback)
//   - Network connection (WebRTC P2P via PeerJS)
//   - Command queue (deterministic lockstep)
//   - ELO updates after match end
//
// Usage from main.ts:
//   const mp = new MultiplayerController();
//   await mp.initialize('MyRedditName');
//   mp.findMatch();
//   // ... game plays via command queue ...
//   mp.reportMatchResult(true); // won
// ============================================

import {
  initFirebase,
  signInAnon,
  createOrUpdateProfile,
  getProfile,
  updateELO,
  getLeaderboard,
  type PlayerProfile,
  type MatchMode,
} from './FirebaseConfig';
import { NetworkManager, type ConnectionState, type NetworkEvents } from './NetworkManager';
import {
  MatchmakingService,
  type MatchmakingState,
  type MatchFoundResult,
  calculateElo,
} from './MatchmakingService';
import { CommandQueue } from './CommandQueue';
import { NetworkCommand, NetCommandType, GameStateHash, ChatPayload, StartMatchPayload } from './Protocol';

export type MultiplayerState =
  | 'offline'       // Not initialized
  | 'ready'         // Signed in, idle
  | 'searching'     // Looking for opponent
  | 'connecting'    // WebRTC handshake
  | 'playing'       // In a match
  | 'finished'      // Match ended
  | 'error';

export interface MultiplayerEvents {
  onStateChange?: (state: MultiplayerState) => void;
  onMatchFound?: (result: MatchFoundResult) => void;
  onOpponentDisconnect?: () => void;
  onOpponentSurrender?: () => void;
  onDesync?: (tick: number) => void;
  onPingUpdate?: (ms: number) => void;
  onError?: (msg: string) => void;
  /** In-game chat line from the other player */
  onChat?: (msg: ChatPayload) => void;
}

/** One line of the in-game chat log (local echo + remote) */
export interface ChatLine {
  name: string;
  text: string;
  ts: number;
  local: boolean;
}

export class MultiplayerController {
  // Sub-systems
  readonly network = new NetworkManager();
  readonly matchmaking = new MatchmakingService();
  readonly commandQueue = new CommandQueue();

  // State
  private _state: MultiplayerState = 'offline';
  private _profile: PlayerProfile | null = null;
  private _currentMatch: MatchFoundResult | null = null;
  private _events: MultiplayerEvents = {};

  // ── Getters ──────────────────────────────────────────────
  get state() { return this._state; }
  get profile() { return this._profile; }
  get currentMatch() { return this._currentMatch; }
  get isInMatch() { return this._state === 'playing'; }
  get isGhostMatch() { return this._currentMatch?.isGhost ?? false; }
  get opponentName() { return this._currentMatch?.opponentName ?? 'Unknown'; }
  get opponentElo() { return this._currentMatch?.opponentElo ?? 0; }
  get ping() { return this.network.ping; }

  // ============================================
  // Event registration
  // ============================================
  setEvents(events: MultiplayerEvents): void {
    // Merge with existing events instead of replacing — prevents
    // showSearching() from wiping onOpponentDisconnect/onOpponentSurrender
    this._events = { ...this._events, ...events };
  }

  private setState(s: MultiplayerState): void {
    this._state = s;
    this._events.onStateChange?.(s);
  }

  // ============================================
  // Initialize — Firebase auth + profile
  // ============================================
  async initialize(displayName: string): Promise<PlayerProfile> {
    try {
      initFirebase();
      await signInAnon();
      this._profile = await createOrUpdateProfile(displayName);
      this.setState('ready');
      return this._profile;
    } catch (err) {
      this.setState('error');
      this._events.onError?.(`Failed to initialize: ${err}`);
      throw err;
    }
  }

  // ============================================
  // Find Match
  // ============================================
  /** Match mode for the NEXT search ('1v1' ranked, or 'coop' = both humans vs 2 built-in AIs) */
  private _matchMode: MatchMode = '1v1';
  get matchMode(): MatchMode { return this._matchMode; }
  setMatchMode(mode: MatchMode): void { this._matchMode = mode; }
  /** Mode of the match currently being played / just found */
  get currentMatchMode(): MatchMode { return this._currentMatch?.mode ?? '1v1'; }

  // ── Party lobby (post-pairing chat + ready-up; runs over the WebRTC link) ──
  private _localReady = false;
  private _peerReady = false;
  private _pendingStart: StartMatchPayload | null = null;
  get localReady(): boolean { return this._localReady; }
  get peerReady(): boolean { return this._peerReady; }
  /** Live peer + real (non-ghost) match → party features available */
  get isPartyConnected(): boolean {
    return !!this._currentMatch && !this._currentMatch.isGhost && this.network.isConnected;
  }
  resetPartyReady(): void { this._localReady = false; this._peerReady = false; this._pendingStart = null; }
  setReady(ready: boolean): void {
    this._localReady = ready;
    if (this.isPartyConnected) this.network.sendReady(ready);
  }
  /** HOST: both ready → roll a fresh seed, tell the guest, return the settings to start locally */
  hostStartMatch(): StartMatchPayload | null {
    if (!this._currentMatch || !this.network.isHost || !this.isPartyConnected) return null;
    const p: StartMatchPayload = {
      mapSeed: Math.floor(Math.random() * 999999),
      mapType: this._currentMatch.mapType || 'standard',
      mode: this._currentMatch.mode,
    };
    this._currentMatch = { ...this._currentMatch, mapSeed: p.mapSeed };
    this._resultReport = null;
    this._localReady = false; this._peerReady = false;
    this.network.sendStartMatch(p);
    this.setState('playing');
    return p;
  }
  /** GUEST: returns the host's START_MATCH once (null until it arrives) */
  consumeStartMatch(): StartMatchPayload | null {
    const p = this._pendingStart;
    if (!p) return null;
    this._pendingStart = null;
    if (this._currentMatch) this._currentMatch = { ...this._currentMatch, mapSeed: p.mapSeed };
    this._resultReport = null;
    this._localReady = false; this._peerReady = false;
    this.setState('playing');
    return p;
  }

  // ── In-game chat (outside the lockstep sim) ──
  private _chatLog: ChatLine[] = [];
  get chatLog(): readonly ChatLine[] { return this._chatLog; }
  /** Send a chat line to the other player. Returns false when there is no live peer. */
  sendChat(text: string): boolean {
    const clean = text.trim().slice(0, 200);
    if (!clean) return false;
    if (!this._currentMatch || this._currentMatch.isGhost || !this.network.isConnected) return false;
    const msg: ChatPayload = { name: this._profile?.displayName ?? 'You', text: clean, ts: Date.now() };
    this.network.sendChat(msg);
    this._chatLog.push({ ...msg, local: true });
    if (this._chatLog.length > 100) this._chatLog.shift();
    return true;
  }

  async findMatch(): Promise<void> {
    if (!this._profile) throw new Error('Not initialized — call initialize() first');
    if (this._state === 'error') {
      // A failed pairing/connection must not brick the lobby: clean up and retry
      this.network.cleanup();
      this.matchmaking.cleanup();
      this._currentMatch = null;
      this.setState('ready');
    }
    if (this._state !== 'ready') return;

    this.setState('searching');
    this._chatLog = [];

    this.matchmaking.setEvents({
      onStateChange: (ms: MatchmakingState) => {
        if (ms === 'error') {
          this.setState('error');
        }
      },
      onMatchFound: async (result: MatchFoundResult) => {
        this._currentMatch = result;
        this._resultReport = null; // fresh match → fresh (single) result report
        this._events.onMatchFound?.(result);

        if (result.isGhost) {
          // Ghost match — no network connection needed
          this.commandQueue.initMultiplayer(null, true);
          this.setState('playing');
        } else {
          // Real match — establish WebRTC connection
          this.setState('connecting');
          await this.connectToPeer(result);
        }
      },
      onError: (err: string) => {
        this.setState('error');
        this._events.onError?.(err);
      },
    });

    await this.matchmaking.startSearch(
      this._profile.uid,
      this._profile.displayName,
      this._profile.elo,
      this._matchMode,
    );
  }

  // ============================================
  // Cancel search
  // ============================================
  async cancelSearch(): Promise<void> {
    await this.matchmaking.cancelSearch();
    this.setState('ready');
  }

  // ============================================
  // Connect to peer (WebRTC)
  // ============================================
  private log(msg: string, color?: string): void {
    const dbg = (window as any).__mmDebug;
    if (dbg) dbg(msg, color);
    else console.log(`[MP] ${msg}`);
  }

  private async connectToPeer(result: MatchFoundResult): Promise<void> {
    this.log(`connectToPeer: ${result.isHost ? 'HOST' : 'GUEST'} matchId=${result.matchId.slice(0,8)} opponent=${result.opponentUid.slice(0,8)}`);

    // Set up network events
    this.network.setEvents({
      onStateChange: (cs: ConnectionState) => {
        this.log(`WebRTC state: ${cs}`, cs === 'connected' ? '#2ecc71' : '#f39c12');
        if (cs === 'connected') {
          this.commandQueue.initMultiplayer(this.network, false);
          // Set surrender handler so it bypasses tick buffering
          this.commandQueue.setSurrenderHandler(() => {
            this._events.onOpponentSurrender?.();
          });
          this.setState('playing');
        }
      },
      onCommand: (cmd: NetworkCommand) => {
        // Handle surrender command explicitly
        if (cmd.type === 'surrender') {
          this._events.onOpponentSurrender?.();
          return;
        }
        // Other commands are routed through CommandQueue
      },
      onDisconnect: () => {
        this.log('WebRTC: opponent disconnected', '#e74c3c');
        this._events.onOpponentDisconnect?.();
      },
      onChat: (msg: ChatPayload) => {
        this._chatLog.push({ ...msg, local: false });
        if (this._chatLog.length > 100) this._chatLog.shift();
        this._events.onChat?.(msg);
      },
      onPeerReady: (ready: boolean) => { this._peerReady = ready; },
      onStartMatch: (p: StartMatchPayload) => { this._pendingStart = p; },
      onPingUpdate: (ms: number) => {
        this._events.onPingUpdate?.(ms);
      },
      onDesync: (local: number, remote: number, tick: number) => {
        this._events.onDesync?.(tick);
      },
      onError: (err: string) => {
        this.log(`WebRTC error: ${err}`, '#e74c3c');
        this.setState('error');
        this._events.onError?.(err);
      },
    });

    try {
      if (result.isHost) {
        this.log('HOST: Creating PeerJS peer, waiting for guest...');
        await this.network.connectAsHost(
          result.matchId,
          this._profile!.uid,
          result.opponentUid,
        );
        this.log('HOST: Peer connected!', '#2ecc71');
      } else {
        this.log('GUEST: Creating PeerJS peer, looking for host signal...');
        await this.network.connectAsGuest(
          result.matchId,
          this._profile!.uid,
          result.opponentUid,
        );
        this.log('GUEST: Connected to host!', '#2ecc71');
      }
    } catch (err) {
      this.log(`Connection failed: ${err}`, '#e74c3c');
      this.setState('error');
      this._events.onError?.(`Connection failed: ${err}`);
    }
  }

  // ============================================
  // Report match result (called when game ends)
  // ============================================
  /** In-flight / completed result report for the current match — guards against double reporting
   *  (e.g. two main-base capture events, or capture + disconnect firing together). */
  private _resultReport: Promise<EloUpdateResult> | null = null;

  async reportMatchResult(won: boolean): Promise<EloUpdateResult> {
    if (this._resultReport) return this._resultReport;
    this._resultReport = this._reportMatchResultOnce(won);
    return this._resultReport;
  }

  private async _reportMatchResultOnce(won: boolean): Promise<EloUpdateResult> {
    if (!this._profile || !this._currentMatch) {
      return { newElo: this._profile?.elo ?? 1000, change: 0 };
    }

    const totalGames = (this._profile.wins ?? 0) + (this._profile.losses ?? 0);
    const result = calculateElo(
      this._profile.elo,
      this._currentMatch.opponentElo,
      won,
      totalGames,
      this._currentMatch.isGhost,
    );

    // Update Firebase
    try {
      const newStreak = won
        ? Math.max(0, (this._profile.streak ?? 0)) + 1
        : -1; // Reset streak on loss

      await updateELO(this._profile.uid, result.newElo, won, newStreak);
      this._profile.elo = result.newElo;
      this._profile.streak = newStreak;
      if (won) this._profile.wins++;
      else this._profile.losses++;
    } catch (err) {
      console.warn('[MP] Failed to update ELO:', err);
    }

    this.setState('finished');
    return result;
  }

  // ============================================
  // Surrender
  // ============================================
  async surrender(): Promise<void> {
    if (this._state !== 'playing') return;

    if (!this._currentMatch?.isGhost) {
      this.network.sendSurrender();
    }

    await this.reportMatchResult(false);
  }

  // ============================================
  // Get leaderboard
  // ============================================
  async getLeaderboard(limit = 25): Promise<PlayerProfile[]> {
    return getLeaderboard(limit);
  }

  // ============================================
  // Return to ready state (after match)
  // ============================================
  returnToLobby(): void {
    this.network.cleanup();
    this.matchmaking.cleanup();
    this.commandQueue.cleanup();
    this._currentMatch = null;
    this._resultReport = null;
    this.resetPartyReady();
    this.setState('ready');
  }

  // ============================================
  // Full cleanup
  // ============================================
  cleanup(): void {
    this.network.cleanup();
    this.matchmaking.cleanup();
    this.commandQueue.cleanup();
    this._state = 'offline';
    this._profile = null;
    this._currentMatch = null;
    this._resultReport = null;
  }
}

export interface EloUpdateResult {
  newElo: number;
  change: number;
}

// ── Barrel exports ─────────────────────────────────────────
export { NetworkManager } from './NetworkManager';
export { MatchmakingService, createGhostProfile, calculateElo } from './MatchmakingService';
export { CommandQueue } from './CommandQueue';
export { NetCommandType } from './Protocol';
export type { NetworkCommand, GameStateHash, MatchFoundResult };
