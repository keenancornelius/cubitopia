// ============================================
// CUBITOPIA - Network Module Barrel Export
// Phase 5B: All multiplayer networking
// ============================================

export { MultiplayerController, type MultiplayerState, type MultiplayerEvents, type EloUpdateResult } from './MultiplayerController';
export { NetworkManager, type ConnectionState, type NetworkEvents } from './NetworkManager';
export { MatchmakingService, createGhostProfile, calculateElo, type MatchmakingState, type MatchFoundResult, type GhostProfile } from './MatchmakingService';
export { CommandQueue } from './CommandQueue';
export {
  MessageType,
  NetCommandType,
  type NetworkCommand,
  type NetworkMessage,
  type GameStateHash,
  type CommandPayload,
  computeStateHash,
  crc32,
} from './Protocol';
export {
  initFirebase,
  signInAnon,
  createOrUpdateProfile,
  getProfile,
  getLeaderboard,
  type PlayerProfile,
  type MatchRecord,
  type QueueEntry,
} from './FirebaseConfig';
