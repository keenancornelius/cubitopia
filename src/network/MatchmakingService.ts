// ============================================
// CUBITOPIA - Matchmaking Service
// Phase 5B: Firebase queue pairing + Ghost Player system
// ============================================
//
// Flow:
//   1. Player clicks "Find Match" → joinQueue()
//   2. Service watches queue for eligible opponents (ELO proximity)
//   3. If real opponent found within GHOST_TIMEOUT → pair them
//   4. If no opponent → silently create Ghost Match (AI impersonation)
//   5. Ghost matches use fake Reddit usernames, scaled AI difficulty
//   6. Player never knows they're fighting AI
// ============================================

import {
  joinQueue,
  leaveQueue,
  getQueueEntries,
  watchQueue,
  createMatch,
  updateMatch,
  getProfile,
  findMatchAsGuest,
  type QueueEntry,
  type MatchRecord,
  type PlayerProfile,
  type Unsubscribe,
} from './FirebaseConfig';
import { GameRNG, SeededRandom } from '../game/SeededRandom';

// ============================================
// Ghost Player System
// ============================================

/** Fake Reddit-style usernames for ghost players */
const GHOST_NAME_PREFIXES = [
  'Silent', 'Cube', 'Voxel', 'Dark', 'Iron', 'Storm', 'Shadow', 'Pixel',
  'Frost', 'Blaze', 'Thunder', 'Crystal', 'Stone', 'Ancient', 'Swift',
  'Chaos', 'Noble', 'Mystic', 'Savage', 'Brave', 'Fallen', 'Golden',
  'Cyber', 'Neon', 'Void', 'Lunar', 'Solar', 'Crimson', 'Ember', 'Rune',
];

const GHOST_NAME_SUFFIXES = [
  'Wolf', 'King', 'Lord', 'Slayer', 'Master', 'Knight', 'Mage', 'Titan',
  'Dragon', 'Hawk', 'Bear', 'Fox', 'Sage', 'Guardian', 'Hunter', 'Warden',
  'Blade', 'Crusher', 'Forge', 'Siege', 'General', 'Captain', 'Paladin',
  'Archer', 'Scout', 'Berserker', 'Sentinel', 'Phantom', 'Striker', 'Baron',
];

export interface GhostProfile {
  displayName: string;
  elo: number;
  wins: number;
  losses: number;
  /** AI difficulty level for this ghost */
  difficulty: 'easy' | 'medium' | 'hard' | 'brutal';
}

/** Generate a procedural fake Reddit-style username */
function generateGhostName(): string {
  const rng = new SeededRandom(Date.now() ^ (Math.random() * 0xFFFFFFFF));
  const prefix = GHOST_NAME_PREFIXES[Math.floor(rng.next() * GHOST_NAME_PREFIXES.length)];
  const suffix = GHOST_NAME_SUFFIXES[Math.floor(rng.next() * GHOST_NAME_SUFFIXES.length)];
  const num = Math.floor(rng.next() * 9000) + 1000; // 4-digit number

  // Varied formatting styles to look realistic
  const styles = [
    `${prefix}${suffix}_${num}`,           // SilentWolf_4281
    `${prefix}_${suffix}${num}`,           // Silent_Wolf4281
    `${prefix.toLowerCase()}${suffix}`,     // silentwolf
    `${prefix}${suffix}${Math.floor(rng.next() * 100)}`, // SilentWolf42
    `x${prefix}${suffix}x`,                // xSilentWolfx
    `The_${prefix}_${suffix}`,             // The_Silent_Wolf
  ];
  return styles[Math.floor(rng.next() * styles.length)];
}

/** Determine AI difficulty based on player's ELO bracket */
function getGhostDifficulty(playerElo: number): 'easy' | 'medium' | 'hard' | 'brutal' {
  if (playerElo < 800) return 'easy';
  if (playerElo < 1200) return 'medium';
  if (playerElo < 1600) return 'hard';
  return 'brutal';
}

/** Generate a ghost ELO that looks realistic near the player's rating */
function generateGhostElo(playerElo: number): number {
  // Ghost ELO is within ±150 of the player, with slight randomness
  const offset = Math.floor(Math.random() * 300) - 150;
  return Math.max(100, playerElo + offset); // Floor at 100
}

/** Create a full ghost profile matched to a player's skill level */
export function createGhostProfile(playerElo: number): GhostProfile {
  const elo = generateGhostElo(playerElo);
  const difficulty = getGhostDifficulty(playerElo);

  // Generate plausible win/loss record based on ELO
  const totalGames = 20 + Math.floor(Math.random() * 80); // 20-100 games
  const winRate = 0.3 + (elo - 100) / 3000; // ~30% at ELO 100, ~63% at ELO 1100
  const wins = Math.floor(totalGames * Math.min(winRate, 0.85));
  const losses = totalGames - wins;

  return {
    displayName: generateGhostName(),
    elo,
    wins,
    losses,
    difficulty,
  };
}

// ============================================
// ELO Rating System
// ============================================

export interface EloResult {
  newElo: number;
  change: number;
}

/**
 * Calculate new ELO rating after a match.
 * K = 32 for new players (< 30 games), K = 16 for established.
 * Ghost matches: ±50% of normal change.
 */
export function calculateElo(
  playerElo: number,
  opponentElo: number,
  won: boolean,
  totalGames: number,
  isGhostMatch: boolean,
): EloResult {
  const K = totalGames < 30 ? 32 : 16;

  // Expected score (probability of winning)
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));

  // Actual score
  const actual = won ? 1 : 0;

  // ELO change
  let change = Math.round(K * (actual - expected));

  // Ghost match penalty — reduced gains/losses
  if (isGhostMatch) {
    change = Math.round(change * 0.5);
  }

  const newElo = Math.max(100, playerElo + change); // Floor at 100

  return { newElo, change };
}

// ============================================
// Matchmaking Service
// ============================================

export type MatchmakingState = 'idle' | 'searching' | 'found' | 'ghost' | 'connecting' | 'error';

export interface MatchFoundResult {
  matchId: string;
  mapSeed: number;
  mapType: string;
  isHost: boolean;
  opponentUid: string;
  opponentName: string;
  opponentElo: number;
  isGhost: boolean;
  ghostProfile?: GhostProfile;
}

export interface MatchmakingEvents {
  onStateChange?: (state: MatchmakingState) => void;
  onMatchFound?: (result: MatchFoundResult) => void;
  onError?: (err: string) => void;
  onQueuePosition?: (position: number) => void;
}

/** How long to wait before falling back to ghost match (ms) */
const GHOST_TIMEOUT = 30_000; // 30 seconds — give more time to find a real opponent

/** Max ELO difference to consider a fair match */
const MAX_ELO_DIFF = 300;

export class MatchmakingService {
  private state: MatchmakingState = 'idle';
  private events: MatchmakingEvents = {};
  private queueUnsubs: Unsubscribe[] = [];
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private _guestPollTimer: ReturnType<typeof setInterval> | null = null;
  private searchStartTime = 0;

  // Current player info
  private _uid: string = '';
  private _displayName: string = '';
  private _elo: number = 1000;

  // Last match result (for game to read)
  private _lastMatchResult: MatchFoundResult | null = null;

  get matchmakingState() { return this.state; }
  get lastMatchResult() { return this._lastMatchResult; }

  setEvents(events: MatchmakingEvents): void {
    this.events = events;
  }

  private setState(s: MatchmakingState): void {
    this.state = s;
    this.events.onStateChange?.(s);
  }

  /** Debug logger — writes to on-screen debug panel if available */
  private log(msg: string, color?: string): void {
    const dbg = (window as any).__mmDebug;
    if (dbg) dbg(msg, color);
    else console.log(`[MM] ${msg}`);
  }

  // ============================================
  // Start searching for a match
  // ============================================
  async startSearch(uid: string, displayName: string, elo: number): Promise<void> {
    if (this.state !== 'idle') return;

    this._uid = uid;
    this._displayName = displayName;
    this._elo = elo;
    this.searchStartTime = Date.now();
    this.setState('searching');
    this.log(`Joined queue as ${displayName} (uid=${uid.slice(0,8)}, elo=${elo})`);

    // Add ourselves to the matchmaking queue
    const entry: QueueEntry = {
      uid,
      displayName,
      elo,
      timestamp: Date.now(),
    };
    await joinQueue(entry);
    this.log('Queue entry written to Firebase');

    // Check for existing players in the queue
    this.checkForOpponent();

    // Watch for new players joining
    this.queueUnsubs = watchQueue(
      (newEntry: QueueEntry) => {
        if (newEntry.uid !== uid) {
          this.log(`Watcher saw: ${newEntry.displayName} (uid=${newEntry.uid.slice(0,8)})`);
          this.tryPairWith(newEntry);
        }
      },
      (_removedUid: string) => {
        // Someone left the queue — update position
        this.updateQueuePosition();
      },
    );

    // Start ghost timer — if no opponent in GHOST_TIMEOUT, spawn ghost
    this.ghostTimer = setTimeout(() => {
      if (this.state === 'searching') {
        this.log('Ghost timeout — creating AI match', '#e67e22');
        this.createGhostMatch();
      }
    }, GHOST_TIMEOUT);
  }

  // ============================================
  // Cancel search
  // ============================================
  async cancelSearch(): Promise<void> {
    if (this.state === 'idle') return;

    await leaveQueue(this._uid).catch(() => {});
    this.cleanupSearch();
    this.setState('idle');
  }

  // ============================================
  // Check existing queue for opponents
  // ============================================
  private async checkForOpponent(): Promise<void> {
    const entries = await getQueueEntries();
    this.log(`Queue has ${entries.length} entries`);
    const candidates = entries
      .filter(e => e.uid !== this._uid)
      .sort((a, b) => Math.abs(a.elo - this._elo) - Math.abs(b.elo - this._elo));

    this.log(`Found ${candidates.length} candidate(s): ${candidates.map(c => c.displayName).join(', ') || 'none'}`);

    for (const candidate of candidates) {
      if (Math.abs(candidate.elo - this._elo) <= MAX_ELO_DIFF) {
        await this.tryPairWith(candidate);
        return;
      }
    }

    this.updateQueuePosition();
  }

  // ============================================
  // Try to pair with a specific opponent
  // ============================================
  private async tryPairWith(opponent: QueueEntry): Promise<void> {
    if (this.state !== 'searching') {
      this.log(`tryPairWith skipped — state=${this.state}`);
      return;
    }
    if (Math.abs(opponent.elo - this._elo) > MAX_ELO_DIFF) {
      this.log(`tryPairWith skipped — ELO too far (${opponent.elo} vs ${this._elo})`);
      return;
    }

    // Deterministic host selection: lower UID is host
    const isHost = this._uid < opponent.uid;
    this.log(`tryPairWith ${opponent.displayName}: I am ${isHost ? 'HOST' : 'GUEST'} (my=${this._uid.slice(0,8)} vs ${opponent.uid.slice(0,8)})`, isHost ? '#2ecc71' : '#3498db');

    try {
    if (isHost) {
      // ── HOST: create the match and notify ──
      this.setState('found');
      const mapSeed = Math.floor(Math.random() * 999999);

      this.log('HOST: Creating match in Firebase...');
      const matchId = await createMatch({
        player1: this._uid,
        player2: opponent.uid,
        mapSeed,
        mapType: 'standard',
        status: 'signaling',
      });
      this.log(`HOST: Match created: ${matchId.slice(0,8)}`, '#2ecc71');

      // Remove ourselves from queue (opponent removes themselves when they find the match)
      await leaveQueue(this._uid).catch(() => {});
      this.log('HOST: Removed self from queue');

      this._lastMatchResult = {
        matchId,
        mapSeed,
        mapType: 'standard',
        isHost: true,
        opponentUid: opponent.uid,
        opponentName: opponent.displayName,
        opponentElo: opponent.elo,
        isGhost: false,
      };

      this.cleanupSearch();
      this.events.onMatchFound?.(this._lastMatchResult);
    } else {
      // ── GUEST: poll for the match the host will create ──
      if (this._guestPollTimer) {
        this.log('GUEST: Already polling, skip');
        return;
      }
      this.log('GUEST: Starting poll for host-created match...');
      let pollCount = 0;
      this._guestPollTimer = setInterval(async () => {
        if (this.state !== 'searching') return;
        pollCount++;
        const match = await findMatchAsGuest(this._uid);
        if (match) {
          this.log(`GUEST: Found match! id=${match.matchId.slice(0,8)} host=${match.player1.slice(0,8)}`, '#2ecc71');
          // Remove ourselves from queue
          await leaveQueue(this._uid).catch(() => {});
          this.setState('found');
          this._lastMatchResult = {
            matchId: match.matchId,
            mapSeed: match.mapSeed,
            mapType: match.mapType,
            isHost: false,
            opponentUid: match.player1,
            opponentName: opponent.displayName,
            opponentElo: opponent.elo,
            isGhost: false,
          };
          this.cleanupSearch();
          this.events.onMatchFound?.(this._lastMatchResult);
        } else {
          if (pollCount % 5 === 0) this.log(`GUEST: Poll #${pollCount} — no match yet`);
        }
      }, 1000); // poll every 1s
    }
    } catch (err) {
      this.log(`ERROR in tryPairWith: ${err}`, '#e74c3c');
      this.events.onError?.(`Pairing failed: ${err}`);
    }
  }

  // ============================================
  // Ghost Match — AI impersonation
  // ============================================
  private async createGhostMatch(): Promise<void> {
    if (this.state !== 'searching') return;

    this.setState('ghost');

    const ghostProfile = createGhostProfile(this._elo);
    const mapSeed = Math.floor(Math.random() * 999999);
    const ghostUid = `ghost_${Date.now()}`;

    // Create match record (flagged as ghost)
    const matchId = await createMatch({
      player1: this._uid,
      player2: ghostUid,
      mapSeed,
      mapType: 'standard',
      status: 'playing', // Skip signaling — no real connection needed
      isGhost: true,
    });

    // Remove from queue
    await leaveQueue(this._uid);

    this._lastMatchResult = {
      matchId,
      mapSeed,
      mapType: 'standard',
      isHost: true, // Player is always host in ghost matches
      opponentUid: ghostUid,
      opponentName: ghostProfile.displayName,
      opponentElo: ghostProfile.elo,
      isGhost: true,
      ghostProfile,
    };

    this.cleanupSearch();

    // Simulate a realistic "connecting" delay (2-3 seconds)
    setTimeout(() => {
      this.setState('found');
      this.events.onMatchFound?.(this._lastMatchResult!);
    }, 2000 + Math.random() * 1000);
  }

  // ============================================
  // Queue position update
  // ============================================
  private async updateQueuePosition(): Promise<void> {
    const entries = await getQueueEntries();
    const pos = entries.findIndex(e => e.uid === this._uid);
    if (pos >= 0) {
      this.events.onQueuePosition?.(pos + 1);
    }
  }

  /** Time spent searching (seconds) */
  getSearchTime(): number {
    if (this.state !== 'searching') return 0;
    return Math.floor((Date.now() - this.searchStartTime) / 1000);
  }

  // ============================================
  // Cleanup
  // ============================================
  private cleanupSearch(): void {
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
      this.ghostTimer = null;
    }
    if (this._guestPollTimer) {
      clearInterval(this._guestPollTimer);
      this._guestPollTimer = null;
    }
    for (const unsub of this.queueUnsubs) {
      unsub();
    }
    this.queueUnsubs = [];
  }

  cleanup(): void {
    this.cleanupSearch();
    this.state = 'idle';
    this._lastMatchResult = null;
  }
}
