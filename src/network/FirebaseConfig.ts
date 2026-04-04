// ============================================
// CUBITOPIA - Firebase Configuration
// Phase 5B: Matchmaking, Signaling, Leaderboard
// ============================================
//
// Firebase Realtime Database paths:
//   /matchmaking/queue/{uid}   — players waiting for a match
//   /matches/{matchId}         — match state + signaling
//   /users/{uid}               — player profiles + ELO
//   /leaderboard               — top players by ELO
// ============================================

import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  Database,
  ref,
  set,
  get,
  onValue,
  onChildAdded,
  onChildRemoved,
  remove,
  push,
  update,
  serverTimestamp,
  DatabaseReference,
  DataSnapshot,
  Unsubscribe,
  query,
  orderByChild,
  limitToLast,
} from 'firebase/database';
import {
  getAuth,
  signInAnonymously,
  Auth,
  User,
} from 'firebase/auth';

// --- Firebase project config ---
// For alpha: these are public client-side keys (safe to commit).
// Security comes from Firebase Rules, not secret keys.
const FIREBASE_CONFIG = {
  apiKey: 'PLACEHOLDER_API_KEY',
  authDomain: 'cubitopia-alpha.firebaseapp.com',
  databaseURL: 'https://cubitopia-alpha-default-rtdb.firebaseio.com',
  projectId: 'cubitopia-alpha',
  storageBucket: 'cubitopia-alpha.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

// --- Singleton ---
let app: FirebaseApp | null = null;
let db: Database | null = null;
let auth: Auth | null = null;
let currentUser: User | null = null;

/** Player profile stored in Firebase */
export interface PlayerProfile {
  uid: string;
  displayName: string;
  elo: number;
  wins: number;
  losses: number;
  streak: number;
  lastSeen: number | object; // serverTimestamp returns object
}

/** Match record in Firebase */
export interface MatchRecord {
  matchId: string;
  player1: string;     // uid
  player2: string;     // uid
  mapSeed: number;
  mapType: string;
  createdAt: number | object;
  status: 'waiting' | 'signaling' | 'playing' | 'finished';
  winner?: string;
  isGhost?: boolean;   // true if opponent is AI impersonation
}

/** Queue entry for matchmaking */
export interface QueueEntry {
  uid: string;
  displayName: string;
  elo: number;
  timestamp: number | object;
}

// ============================================
// Initialization
// ============================================

export function initFirebase(): void {
  if (app) return; // already initialized
  app = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(app);
  auth = getAuth(app);
}

export async function signInAnon(): Promise<User> {
  if (!auth) initFirebase();
  const cred = await signInAnonymously(auth!);
  currentUser = cred.user;
  return currentUser;
}

export function getUser(): User | null {
  return currentUser;
}

export function getDb(): Database {
  if (!db) initFirebase();
  return db!;
}

// ============================================
// Player Profile CRUD
// ============================================

export async function createOrUpdateProfile(displayName: string): Promise<PlayerProfile> {
  const user = currentUser ?? await signInAnon();
  const profile: PlayerProfile = {
    uid: user.uid,
    displayName,
    elo: 1000,
    wins: 0,
    losses: 0,
    streak: 0,
    lastSeen: serverTimestamp(),
  };

  const existing = await getProfile(user.uid);
  if (existing) {
    // Keep existing stats, update name + lastSeen
    await update(ref(getDb(), `users/${user.uid}`), {
      displayName,
      lastSeen: serverTimestamp(),
    });
    return { ...existing, displayName };
  }

  await set(ref(getDb(), `users/${user.uid}`), profile);
  return profile;
}

export async function getProfile(uid: string): Promise<PlayerProfile | null> {
  const snap = await get(ref(getDb(), `users/${uid}`));
  return snap.exists() ? snap.val() as PlayerProfile : null;
}

export async function updateELO(uid: string, newElo: number, won: boolean, streak: number): Promise<void> {
  const updates: Record<string, unknown> = {
    elo: newElo,
    streak,
    lastSeen: serverTimestamp(),
  };
  if (won) {
    updates[`wins`] = (await getProfile(uid))?.wins ?? 0 + 1;
  } else {
    updates[`losses`] = (await getProfile(uid))?.losses ?? 0 + 1;
  }
  await update(ref(getDb(), `users/${uid}`), updates);
}

// ============================================
// Matchmaking Queue
// ============================================

export async function joinQueue(entry: QueueEntry): Promise<void> {
  await set(ref(getDb(), `matchmaking/queue/${entry.uid}`), {
    ...entry,
    timestamp: serverTimestamp(),
  });
}

export async function leaveQueue(uid: string): Promise<void> {
  await remove(ref(getDb(), `matchmaking/queue/${uid}`));
}

export function watchQueue(
  onAdded: (entry: QueueEntry) => void,
  onRemoved: (uid: string) => void,
): Unsubscribe[] {
  const qRef = ref(getDb(), 'matchmaking/queue');
  const unsub1 = onChildAdded(qRef, (snap: DataSnapshot) => {
    if (snap.exists()) onAdded(snap.val() as QueueEntry);
  });
  const unsub2 = onChildRemoved(qRef, (snap: DataSnapshot) => {
    onRemoved(snap.key ?? '');
  });
  return [unsub1, unsub2];
}

export async function getQueueEntries(): Promise<QueueEntry[]> {
  const snap = await get(ref(getDb(), 'matchmaking/queue'));
  if (!snap.exists()) return [];
  const entries: QueueEntry[] = [];
  snap.forEach((child) => {
    entries.push(child.val() as QueueEntry);
  });
  return entries;
}

// ============================================
// Match Records
// ============================================

export async function createMatch(match: Omit<MatchRecord, 'matchId' | 'createdAt'>): Promise<string> {
  const matchRef = push(ref(getDb(), 'matches'));
  const matchId = matchRef.key!;
  await set(matchRef, {
    ...match,
    matchId,
    createdAt: serverTimestamp(),
  });
  return matchId;
}

export async function getMatch(matchId: string): Promise<MatchRecord | null> {
  const snap = await get(ref(getDb(), `matches/${matchId}`));
  return snap.exists() ? snap.val() as MatchRecord : null;
}

export async function updateMatch(matchId: string, updates: Partial<MatchRecord>): Promise<void> {
  await update(ref(getDb(), `matches/${matchId}`), updates);
}

export function watchMatch(matchId: string, cb: (match: MatchRecord) => void): Unsubscribe {
  return onValue(ref(getDb(), `matches/${matchId}`), (snap) => {
    if (snap.exists()) cb(snap.val() as MatchRecord);
  });
}

// ============================================
// Signaling (WebRTC offer/answer/ICE)
// ============================================

export async function sendSignal(matchId: string, fromUid: string, data: unknown): Promise<void> {
  await push(ref(getDb(), `matches/${matchId}/signaling/${fromUid}`), data);
}

export function watchSignals(matchId: string, peerUid: string, cb: (signal: unknown) => void): Unsubscribe {
  return onChildAdded(ref(getDb(), `matches/${matchId}/signaling/${peerUid}`), (snap) => {
    if (snap.exists()) cb(snap.val());
  });
}

// ============================================
// Leaderboard
// ============================================

export async function getLeaderboard(limit = 25): Promise<PlayerProfile[]> {
  const q = query(ref(getDb(), 'users'), orderByChild('elo'), limitToLast(limit));
  const snap = await get(q);
  if (!snap.exists()) return [];
  const list: PlayerProfile[] = [];
  snap.forEach((child) => {
    list.push(child.val() as PlayerProfile);
  });
  // Firebase limitToLast returns ascending — reverse for descending
  return list.reverse();
}

// ============================================
// Cleanup helpers
// ============================================

export async function cleanupMatch(matchId: string): Promise<void> {
  await remove(ref(getDb(), `matches/${matchId}/signaling`));
}

/** Re-export Firebase utilities for convenience */
export { ref, onValue, remove, serverTimestamp };
export type { Unsubscribe, DatabaseReference, DataSnapshot };
