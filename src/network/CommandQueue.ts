// ============================================
// CUBITOPIA - Command Queue (Deterministic Lockstep)
// Phase 5B: Buffers and replays commands in tick order
// ============================================
//
// Both clients maintain identical CommandQueues. On each
// simulation tick, both sides:
//   1. Buffer any local player commands for this tick
//   2. Receive remote player commands for this tick
//   3. Process ALL commands in deterministic order:
//      - Host commands first (sorted by command index)
//      - Guest commands second (sorted by command index)
//   4. Advance simulation by one tick
//
// This guarantees both clients execute identical state
// transitions, keeping the game in sync.
// ============================================

import { NetworkCommand, NetCommandType, GameStateHash, computeStateHash } from './Protocol';
import { NetworkManager } from './NetworkManager';

/** How many ticks between state hash checks */
const HASH_CHECK_INTERVAL = 60; // 3 seconds at 20 ticks/s

/** How many ticks ahead we allow commands to be buffered */
const MAX_FUTURE_TICKS = 20;

/** Input delay: commands execute N ticks in the future to give the network
 *  time to deliver them before both clients reach that tick. At 20hz,
 *  3 ticks = 150ms which covers most LAN/broadband latency. */
const INPUT_DELAY = 3;

/** Command with ordering index for deterministic sort */
interface IndexedCommand extends NetworkCommand {
  _index: number;
}

export class CommandQueue {
  private network: NetworkManager | null = null;
  private currentTick = 0;
  private commandIndex = 0;

  /** Commands buffered per tick: tick → commands[] */
  private tickBuffer: Map<number, IndexedCommand[]> = new Map();

  /** Local commands waiting to be sent */
  private localBuffer: IndexedCommand[] = [];

  /** Whether we're in multiplayer mode */
  private _isMultiplayer = false;

  /** Whether this is a ghost match (AI impersonation) */
  private _isGhostMatch = false;

  /** Desync state */
  private _desynced = false;
  private _desyncTick = -1;

  /** Callback for processing commands */
  private _commandProcessor: ((cmd: NetworkCommand) => void) | null = null;

  /** Callback for computing current state hash */
  private _stateHashProvider: (() => { units: any[]; p1Resources: Record<string, number>; p2Resources: Record<string, number> }) | null = null;

  /** Desync callback */
  private _onDesync: ((localHash: number, remoteHash: number, tick: number) => void) | null = null;

  /** Pending remote hashes waiting for us to reach their tick */
  private _pendingRemoteHashes: Map<number, GameStateHash> = new Map();

  // ── Getters ──────────────────────────────────────────────
  get tick() { return this.currentTick; }
  get isMultiplayer() { return this._isMultiplayer; }
  get isGhostMatch() { return this._isGhostMatch; }
  get isDesynced() { return this._desynced; }

  // ============================================
  // Initialization
  // ============================================

  /**
   * Initialize for multiplayer match.
   * @param network - NetworkManager instance (null for ghost matches)
   * @param isGhost - true if this is a ghost match (AI impersonation)
   */
  initMultiplayer(network: NetworkManager | null, isGhost: boolean): void {
    this._isMultiplayer = true;
    this._isGhostMatch = isGhost;
    this.network = network;
    this.currentTick = 0;
    this.commandIndex = 0;
    this.tickBuffer.clear();
    this.localBuffer = [];
    this._desynced = false;
    this._desyncTick = -1;
    this._pendingRemoteHashes.clear();

    // Listen for remote commands
    if (network) {
      network.setEvents({
        ...network['events'], // preserve existing events
        onCommand: (cmd: NetworkCommand) => this.receiveRemoteCommand(cmd),
        onStateHash: (hash: GameStateHash) => this.receiveStateHash(hash),
      });
    }
  }

  /** Initialize for single-player (no network, commands execute immediately) */
  initSinglePlayer(): void {
    this._isMultiplayer = false;
    this._isGhostMatch = false;
    this.network = null;
    this.currentTick = 0;
    this.commandIndex = 0;
    this.tickBuffer.clear();
    this.localBuffer = [];
    this._desynced = false;
  }

  /** Set the function that processes commands into game state changes */
  setCommandProcessor(processor: (cmd: NetworkCommand) => void): void {
    this._commandProcessor = processor;
  }

  /** Set the function that provides current game state for hashing */
  setStateHashProvider(provider: () => { units: any[]; p1Resources: Record<string, number>; p2Resources: Record<string, number> }): void {
    this._stateHashProvider = provider;
  }

  /** Set desync callback */
  setDesyncHandler(handler: (localHash: number, remoteHash: number, tick: number) => void): void {
    this._onDesync = handler;
  }

  // ============================================
  // Enqueue local command
  // ============================================

  /**
   * Queue a local player command. In multiplayer, it's sent to the
   * remote peer and buffered for the next tick. In singleplayer,
   * it executes immediately.
   */
  enqueue(type: NetCommandType | string, payload: Record<string, unknown>): void {
    const delay = this._isMultiplayer ? INPUT_DELAY : 1;
    const cmd: IndexedCommand = {
      tick: this.currentTick + delay, // Execute after input delay (MP) or next tick (SP)
      playerId: this.network?.localUid ?? 'local',
      type,
      payload,
      _index: this.commandIndex++,
    };

    if (!this._isMultiplayer) {
      // Single-player: execute immediately
      this._commandProcessor?.(cmd);
      return;
    }

    // Multiplayer: buffer locally and send to peer
    this.addToBuffer(cmd);
    console.log(`[CmdQ] ENQUEUE local: type=${cmd.type} tick=${cmd.tick} player=${cmd.playerId?.slice(0,8)} isMP=${this._isMultiplayer} hasNet=${!!this.network} ghost=${this._isGhostMatch}`);

    if (this.network && !this._isGhostMatch) {
      // Send over network (strip internal index)
      const { _index, ...netCmd } = cmd;
      console.log(`[CmdQ] SENDING to peer: type=${netCmd.type} tick=${netCmd.tick} connOpen=${this.network.isConnected}`);
      this.network.sendCommand(netCmd);
    }
  }

  // ============================================
  // Receive remote command
  // ============================================

  /** Callback for surrender commands (bypasses tick buffering) */
  private _onSurrender: ((cmd: NetworkCommand) => void) | null = null;

  /** Set the surrender handler — called by MultiplayerController */
  setSurrenderHandler(handler: (cmd: NetworkCommand) => void): void {
    this._onSurrender = handler;
  }

  private receiveRemoteCommand(cmd: NetworkCommand): void {
    console.log(`[CmdQ] RECEIVED remote: type=${cmd.type} tick=${cmd.tick} player=${cmd.playerId?.slice(0,8)} curTick=${this.currentTick} hasProcessor=${!!this._commandProcessor}`);

    // Surrender is a meta-command — don't buffer, handle immediately
    if (cmd.type === 'surrender') {
      console.log('[CmdQ] Surrender received — routing to handler');
      this._onSurrender?.(cmd);
      return;
    }
    const indexed: IndexedCommand = {
      ...cmd,
      _index: this.commandIndex++,
    };

    // Don't process commands too far in the future
    if (cmd.tick > this.currentTick + MAX_FUTURE_TICKS) {
      console.warn(`[CmdQ] Dropping FUTURE command: tick ${cmd.tick} (current: ${this.currentTick})`);
      return;
    }

    // If command is for a past tick, reschedule to the next tick so both
    // clients process it at the same simulation state (executing immediately
    // would desync because the other client processed it at the correct tick).
    if (cmd.tick <= this.currentTick) {
      console.warn(`[CmdQ] LATE command for tick ${cmd.tick} (current: ${this.currentTick}) — rescheduling to tick ${this.currentTick + 1}`);
      indexed.tick = this.currentTick + 1;
    }

    console.log(`[CmdQ] BUFFERED for tick ${cmd.tick} (current: ${this.currentTick})`);
    this.addToBuffer(indexed);
  }

  // ============================================
  // Tick processing
  // ============================================

  /**
   * Advance the simulation by one tick. Processes all buffered
   * commands for this tick in deterministic order, then checks
   * for desync if needed.
   */
  processTick(): void {
    this.currentTick++;

    const commands = this.tickBuffer.get(this.currentTick);
    if (commands && commands.length > 0) {
      // Sort deterministically: host commands first, then by index
      commands.sort((a, b) => {
        // Host (isHost=true player) goes first
        const aHost = this.network?.isHost ? a.playerId === this.network.localUid : a.playerId !== this.network?.localUid;
        const bHost = this.network?.isHost ? b.playerId === this.network.localUid : b.playerId !== this.network?.localUid;

        if (aHost !== bHost) return aHost ? -1 : 1;
        return a._index - b._index;
      });

      // Process each command
      for (const cmd of commands) {
        console.log(`[CmdQ] PROCESS tick=${this.currentTick}: type=${cmd.type} player=${cmd.playerId?.slice(0,8)} hasProcessor=${!!this._commandProcessor}`);
        this._commandProcessor?.(cmd);
      }

      // Clean up processed tick
      this.tickBuffer.delete(this.currentTick);
    }

    // Periodic state hash check (multiplayer only, not ghost)
    if (this._isMultiplayer && !this._isGhostMatch && this.currentTick % HASH_CHECK_INTERVAL === 0) {
      this.sendStateHash();
    }

    // Check if we have a pending remote hash for this tick
    const pendingHash = this._pendingRemoteHashes.get(this.currentTick);
    if (pendingHash) {
      this._pendingRemoteHashes.delete(this.currentTick);
      this._compareHash(pendingHash);
    }

    // Clean up very old pending hashes (shouldn't happen, but prevent memory leak)
    if (this._pendingRemoteHashes.size > 10) {
      for (const [tick] of this._pendingRemoteHashes) {
        if (tick < this.currentTick - HASH_CHECK_INTERVAL * 2) {
          this._pendingRemoteHashes.delete(tick);
        }
      }
    }
  }

  // ============================================
  // State hash (desync detection)
  // ============================================

  private sendStateHash(): void {
    if (!this._stateHashProvider || !this.network) return;

    const state = this._stateHashProvider();
    const hash = computeStateHash(
      this.currentTick,
      state.units,
      state.p1Resources,
      state.p2Resources,
    );

    this.network.sendStateHash(hash);
  }

  private receiveStateHash(remoteHash: GameStateHash): void {
    if (!this._stateHashProvider) return;

    if (remoteHash.tick === this.currentTick) {
      // Same tick — compare immediately
      this._compareHash(remoteHash);
    } else if (remoteHash.tick > this.currentTick) {
      // Remote is ahead — store and compare when we reach that tick
      this._pendingRemoteHashes.set(remoteHash.tick, remoteHash);
    } else {
      // We're ahead — compute hash for their tick? Can't rewind.
      // Log but don't compare (we've already advanced past that state).
      console.warn(`[CmdQ] Received stale hash for tick ${remoteHash.tick} (current: ${this.currentTick}) — skipping`);
    }
  }

  /** Compare local state against a remote hash at the current tick */
  private _compareHash(remoteHash: GameStateHash): void {
    if (!this._stateHashProvider) return;
    const state = this._stateHashProvider();
    const localHash = computeStateHash(
      remoteHash.tick,
      state.units,
      state.p1Resources,
      state.p2Resources,
    );

    if (localHash.hash !== remoteHash.hash) {
      console.error(`[CmdQ] DESYNC at tick ${remoteHash.tick}! Local: ${localHash.hash}, Remote: ${remoteHash.hash}`);
      this._desynced = true;
      this._desyncTick = remoteHash.tick;
      this._onDesync?.(localHash.hash, remoteHash.hash, remoteHash.tick);
    } else {
      console.log(`[CmdQ] Hash OK at tick ${remoteHash.tick}`);
    }
  }

  // ============================================
  // Internal helpers
  // ============================================

  private addToBuffer(cmd: IndexedCommand): void {
    const tick = cmd.tick;
    if (!this.tickBuffer.has(tick)) {
      this.tickBuffer.set(tick, []);
    }
    this.tickBuffer.get(tick)!.push(cmd);
  }

  /** Get pending command count (for network health display) */
  getPendingCommandCount(): number {
    let count = 0;
    for (const [, cmds] of this.tickBuffer) {
      count += cmds.length;
    }
    return count;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    this.tickBuffer.clear();
    this.localBuffer = [];
    this.currentTick = 0;
    this.commandIndex = 0;
    this._isMultiplayer = false;
    this._isGhostMatch = false;
    this._desynced = false;
    this._desyncTick = -1;
    this.network = null;
    this._commandProcessor = null;
    this._stateHashProvider = null;
    this._onDesync = null;
    this._onSurrender = null;
  }
}
