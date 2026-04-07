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

    // Add ourselves to the matchmaking queue
    const entry: QueueEntry = {
      uid,
      displayName,
      elo,
      timestamp: Date.now(),
    };
    await joinQueue(entry);

    // Check for existing players in the queue
    this.checkForOpponent();

    // Watch for new players joining
    this.queueUnsubs = watchQueue(
      (newEntry: QueueEntry) => {
        if (newEntry.uid !== uid) {
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
    const candidates = entries
      .filter(e => e.uid !== this._uid)
      .sort((a, b) => Math.abs(a.elo - this._elo) - Math.abs(b.elo - this._elo));

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
    if (this.state !== 'searching') return;
    if (Math.abs(opponent.elo - this._elo) > MAX_ELO_DIFF) return;

    this.setState('found');

    // Deterministic host selection: lower UID is host
    const isHost = this._uid < opponent.uid;
    const mapSeed = Math.floor(Math.random() * 999999);

    // Only the host creates the match record to avoid double-creation
    let matchId: string;
    if (isHost) {
      matchId = await createMatch({
        player1: this._uid,
        player2: opponent.uid,
        mapSeed,
        mapType: 'standard',
        status: 'signaling',
      });

      // Remove both players from queue
      await Promise.all([
        leaveQueue(this._uid),
        leaveQueue(opponent.uid),
      ]);
    } else {
      // Guest waits for host to create match — poll briefly
      // In practice, the watchMatch listener in the game will handle this
      matchId = `pending-${opponent.uid}`;
    }

    this._lastMatchResult = {
      matchId,
      mapSeed,
      mapType: 'standard',
      isHost,
      opponentName: opponent.displayName,
      opponentElo: opponent.elo,
      isGhost: false,
    };

    this.cleanupSearch();
    this.events.onMatchFound?.(this._lastMatchResult);
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
