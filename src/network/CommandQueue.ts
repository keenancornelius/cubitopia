// ============================================
// CUBITOPIA - Command Queue (Deterministic Lockstep)
// Input-frame lockstep with a hard barrier
// ============================================
//
// Both clients maintain identical CommandQueues. Lockstep works
// via per-tick INPUT FRAMES instead of loose per-command messages:
//
//   - When a client simulates tick T, it first finalizes and sends
//     its input frame for tick T + INPUT_DELAY (commands issued since
//     the last tick, possibly EMPTY — empty frames still get sent).
//   - A client may NOT simulate tick T (for T > INPUT_DELAY) until the
//     peer's frame for tick T has arrived. If it hasn't, processTick()
//     returns false and the caller must stall (try again next render
//     frame). This is the lockstep barrier.
//   - Frames travel on a reliable, ordered DataChannel, so receiving
//     the frame for tick T means all frames < T have arrived too.
//
// Because of the barrier, a command can never arrive "late": the
// receiver physically cannot have advanced past the command's tick.
// (The old design free-ran ticks on each client's wall clock and
// rescheduled late commands on the receiver only — which guaranteed
// divergence as soon as clocks drifted by more than the input delay.)
//
// Per-tick execution order is deterministic on both clients:
//   host's commands first, then guest's, each in issue order.
// ============================================

import { NetworkCommand, NetCommandType, CommandPayload, GameStateHash, TickInputFrame, computeStateHash } from './Protocol';
import { NetworkManager } from './NetworkManager';

/** How many ticks between state hash checks */
const HASH_CHECK_INTERVAL = 5; // 250ms at 20 ticks/s — very tight for desync bisection

/** Input delay: commands execute N ticks in the future to give the network
 *  time to deliver them before both clients reach that tick. At 20hz,
 *  3 ticks = 150ms which covers most LAN/broadband latency. Thanks to the
 *  lockstep barrier this no longer needs to cover worst-case latency for
 *  correctness — a slow link just stalls the sim briefly instead of desyncing. */
const INPUT_DELAY = 3;

/** Command with ordering metadata for deterministic sort */
interface IndexedCommand extends NetworkCommand {
  /** true if issued by the match host (host commands execute first) */
  _fromHost: boolean;
  /** issue order within the player's frame */
  _index: number;
}

export class CommandQueue {
  private network: NetworkManager | null = null;
  private currentTick = 0;

  /** Commands scheduled per tick: tick → commands[] (local + remote) */
  private tickBuffer: Map<number, IndexedCommand[]> = new Map();

  /** Local commands issued since the last tick — assigned to a tick when the next frame is sent */
  private localBuffer: Array<{ type: NetCommandType | string; payload: CommandPayload }> = [];

  /** Highest tick for which the peer's input frame has arrived.
   *  Reliable ordered channel ⇒ all earlier frames have arrived too. */
  private _remoteFrameTick = 0;

  /** Whether we're in multiplayer mode */
  private _isMultiplayer = false;

  /** Whether this is a ghost match (AI impersonation — no peer, no barrier) */
  private _isGhostMatch = false;

  /** Desync state */
  private _desynced = false;
  private _desyncTick = -1;

  /** Callback for processing commands */
  private _commandProcessor: ((cmd: NetworkCommand) => void) | null = null;

  /** Callback for computing current state hash */
  private _stateHashProvider: (() => { units: any[]; p1Resources: Record<string, number>; p2Resources: Record<string, number>; rngState?: number; terrainFingerprint?: string; stockpileFingerprint?: string }) | null = null;

  /** Desync callback */
  private _onDesync: ((localHash: number, remoteHash: number, tick: number) => void) | null = null;

  /** Pending remote hashes waiting for us to reach their tick */
  private _pendingRemoteHashes: Map<number, GameStateHash> = new Map();

  /** Recent local hashes (so we can compare when a stale remote hash arrives) */
  private _localHashHistory: Map<number, GameStateHash> = new Map();

  /** Full state snapshot for the first desync (detailed diff) */
  private _desyncDetailLogged = false;

  /** Callback for surrender commands (bypasses tick buffering) */
  private _onSurrender: ((cmd: NetworkCommand) => void) | null = null;

  // ── Getters ──────────────────────────────────────────────
  get tick() { return this.currentTick; }
  get isMultiplayer() { return this._isMultiplayer; }
  get isGhostMatch() { return this._isGhostMatch; }
  get isDesynced() { return this._desynced; }

  /** True when the sim is blocked waiting on the peer's input frame.
   *  Useful for HUD "waiting for opponent…" indicators. */
  get isStalled(): boolean {
    return this._isMultiplayer && !this._isGhostMatch && !this.canAdvance();
  }

  /** How many ticks ahead the peer's input allows us to simulate (network health display) */
  get remoteFrameLead(): number {
    return this._remoteFrameTick - this.currentTick;
  }

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
    this.tickBuffer.clear();
    this.localBuffer = [];
    this._remoteFrameTick = 0;
    this._desynced = false;
    this._desyncTick = -1;
    this._pendingRemoteHashes.clear();
    this._localHashHistory.clear();
    this._desyncDetailLogged = false;

    // Listen for remote frames / hashes
    if (network) {
      network.setEvents({
        ...network['events'], // preserve existing events
        onTickInput: (frame: TickInputFrame) => this.receiveTickInput(frame),
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
    this.tickBuffer.clear();
    this.localBuffer = [];
    this._remoteFrameTick = 0;
    this._desynced = false;
  }

  /** Set the function that processes commands into game state changes */
  setCommandProcessor(processor: (cmd: NetworkCommand) => void): void {
    this._commandProcessor = processor;
  }

  /** Set the function that provides current game state for hashing */
  setStateHashProvider(provider: () => { units: any[]; p1Resources: Record<string, number>; p2Resources: Record<string, number>; rngState?: number; terrainFingerprint?: string; stockpileFingerprint?: string }): void {
    this._stateHashProvider = provider;
  }

  /** Set desync callback */
  setDesyncHandler(handler: (localHash: number, remoteHash: number, tick: number) => void): void {
    this._onDesync = handler;
  }

  /** Set the surrender handler — called by MultiplayerController */
  setSurrenderHandler(handler: (cmd: NetworkCommand) => void): void {
    this._onSurrender = handler;
  }

  // ============================================
  // Enqueue local command
  // ============================================

  /**
   * Queue a local player command. In multiplayer it is buffered and
   * shipped inside the NEXT input frame (executing INPUT_DELAY ticks
   * ahead on both clients simultaneously). In singleplayer it executes
   * immediately.
   */
  enqueue(type: NetCommandType | string, payload: Record<string, unknown>, playerIdOverride?: string): void {
    if (!this._isMultiplayer) {
      // Single-player: execute immediately
      this._commandProcessor?.({
        tick: this.currentTick + 1,
        playerId: playerIdOverride ?? 'local',
        type,
        payload,
      });
      return;
    }

    this.localBuffer.push({ type, payload: payload as CommandPayload });
    console.log(`[CmdQ] ENQUEUE local: type=${type} (ships with next frame) curTick=${this.currentTick} buffered=${this.localBuffer.length}`);
  }

  // ============================================
  // Receive remote input frame (the lockstep heartbeat)
  // ============================================

  private receiveTickInput(frame: TickInputFrame): void {
    // Frames arrive in send order (reliable ordered channel). Monotonic check:
    if (frame.tick <= this._remoteFrameTick) {
      console.warn(`[CmdQ] Out-of-order/duplicate frame for tick ${frame.tick} (have up to ${this._remoteFrameTick}) — ignoring`);
      return;
    }

    // Barrier invariant: we can never have simulated past a tick whose frame
    // hadn't arrived. If this fires, the protocol is broken — flag it loudly.
    if (frame.tick <= this.currentTick) {
      console.error(`[CmdQ] PROTOCOL VIOLATION: frame for tick ${frame.tick} arrived but we already simulated tick ${this.currentTick}`);
      if (!this._desynced) {
        this._desynced = true;
        this._desyncTick = frame.tick;
        this._onDesync?.(0, 0, frame.tick);
      }
      return;
    }

    this._remoteFrameTick = frame.tick;

    if (frame.cmds.length > 0) {
      const remoteIsHost = !(this.network?.isHost ?? false);
      for (let i = 0; i < frame.cmds.length; i++) {
        this.addToBuffer({
          tick: frame.tick,
          playerId: frame.playerId,
          type: frame.cmds[i].type,
          payload: frame.cmds[i].payload,
          _fromHost: remoteIsHost,
          _index: i,
        });
      }
      console.log(`[CmdQ] FRAME tick=${frame.tick}: ${frame.cmds.length} cmd(s) buffered (curTick=${this.currentTick})`);
    }
  }

  // ============================================
  // Legacy single-command path (surrender meta-command only)
  // ============================================

  private receiveRemoteCommand(cmd: NetworkCommand): void {
    // Surrender is a meta-command — don't buffer, handle immediately
    if (cmd.type === 'surrender') {
      console.log('[CmdQ] Surrender received — routing to handler');
      this._onSurrender?.(cmd);
      return;
    }
    // Tick-scheduled commands must travel inside input frames now.
    console.warn(`[CmdQ] Ignoring loose COMMAND message (type=${cmd.type}) — commands must arrive via TICK_INPUT frames`);
  }

  // ============================================
  // Tick processing
  // ============================================

  /** Can we simulate the next tick, or must we stall for the peer's frame? */
  canAdvance(): boolean {
    if (!this._isMultiplayer || this._isGhostMatch || !this.network) return true;
    const nextTick = this.currentTick + 1;
    // Ticks 1..INPUT_DELAY are implicitly empty for both players (no frame
    // can exist for them — frames are sent for tick T+INPUT_DELAY while
    // simulating tick T ≥ 1).
    if (nextTick <= INPUT_DELAY) return true;
    return this._remoteFrameTick >= nextTick;
  }

  /**
   * Try to advance the simulation by one tick.
   *
   * Returns false WITHOUT advancing if the peer's input frame for the next
   * tick hasn't arrived yet (lockstep barrier) — the caller must NOT run
   * the simulation step and should retry on the next render frame.
   *
   * On success: finalizes + sends our input frame for tick+INPUT_DELAY,
   * processes all buffered commands for the new tick in deterministic
   * order, and runs periodic hash checks. Caller then runs one fixed-dt
   * simulation step.
   */
  processTick(): boolean {
    if (!this.canAdvance()) return false;

    this.currentTick++;

    // ── Finalize + send our input frame for currentTick + INPUT_DELAY ──
    // Sent every tick, even when empty: empty frames are what let the peer
    // advance past ticks where we had no input.
    if (this._isMultiplayer && this.network && !this._isGhostMatch) {
      const frameTick = this.currentTick + INPUT_DELAY;
      const frame: TickInputFrame = {
        tick: frameTick,
        playerId: this.network.localUid,
        cmds: this.localBuffer,
      };
      // Schedule our own commands locally at the same tick
      const localIsHost = this.network.isHost;
      for (let i = 0; i < this.localBuffer.length; i++) {
        this.addToBuffer({
          tick: frameTick,
          playerId: this.network.localUid,
          type: this.localBuffer[i].type,
          payload: this.localBuffer[i].payload,
          _fromHost: localIsHost,
          _index: i,
        });
      }
      this.localBuffer = [];
      this.network.sendTickInput(frame);
    } else if (this._isGhostMatch) {
      // Ghost match: no peer — schedule local commands with the same delay
      // so timing matches real matches.
      const frameTick = this.currentTick + INPUT_DELAY;
      for (let i = 0; i < this.localBuffer.length; i++) {
        this.addToBuffer({
          tick: frameTick,
          playerId: 'local',
          type: this.localBuffer[i].type,
          payload: this.localBuffer[i].payload,
          _fromHost: true,
          _index: i,
        });
      }
      this.localBuffer = [];
    }

    // ── Execute all commands scheduled for this tick ──
    const commands = this.tickBuffer.get(this.currentTick);
    if (commands && commands.length > 0) {
      // Deterministic order: host's commands first, then guest's, each in issue order
      commands.sort((a, b) => {
        if (a._fromHost !== b._fromHost) return a._fromHost ? -1 : 1;
        return a._index - b._index;
      });

      for (const cmd of commands) {
        console.log(`[CmdQ] PROCESS tick=${this.currentTick}: type=${cmd.type} player=${cmd.playerId?.slice(0, 8)} host=${cmd._fromHost}`);
        this._commandProcessor?.(cmd);
      }

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

    return true;
  }

  // ============================================
  // State hash (desync detection)
  // ============================================

  private sendStateHash(): void {
    if (!this._stateHashProvider || !this.network) return;

    const state = this._stateHashProvider();
    // Include unit details until first desync is logged (for debugging)
    const hash = computeStateHash(
      this.currentTick,
      state.units,
      state.p1Resources,
      state.p2Resources,
      !this._desyncDetailLogged, // include details until first desync is diagnosed
      state.rngState,
      state.terrainFingerprint,
      state.stockpileFingerprint,
    );

    // Store local hash so we can compare against stale remote hashes
    this._localHashHistory.set(this.currentTick, hash);
    // Keep only recent hashes (avoid memory leak)
    if (this._localHashHistory.size > 80) {
      const oldest = this.currentTick - HASH_CHECK_INTERVAL * 20;
      for (const [tick] of this._localHashHistory) {
        if (tick < oldest) this._localHashHistory.delete(tick);
      }
    }

    this.network.sendStateHash(hash);
  }

  private receiveStateHash(remoteHash: GameStateHash): void {
    if (remoteHash.tick > this.currentTick) {
      // Remote is ahead — store and compare when we reach that tick
      this._pendingRemoteHashes.set(remoteHash.tick, remoteHash);
    } else {
      // Same tick or we're ahead — compare using stored local hash
      // (_compareHash always uses _localHashHistory, never recomputes from live state)
      this._compareHash(remoteHash);
    }
  }

  /** Compare local state against a remote hash.
   *  IMPORTANT: Always use the STORED local hash from _localHashHistory, never
   *  recompute from current state.  The remote hash may arrive asynchronously
   *  (via WebRTC callback between frames) after _simulationStep has already
   *  advanced the game state past the tick the hash is for.  Recomputing would
   *  compare post-simulation state against pre-simulation state → false desync. */
  private _compareHash(remoteHash: GameStateHash): void {
    // Look up the local hash we stored when we originally processed this tick
    const localHash = this._localHashHistory.get(remoteHash.tick);
    if (!localHash) {
      console.warn(`[CmdQ] Cannot compare hash for tick ${remoteHash.tick} — no stored local hash (current tick: ${this.currentTick})`);
      return;
    }

    if (localHash.hash !== remoteHash.hash) {
      console.error(`[CmdQ] DESYNC at tick ${remoteHash.tick}! Local: ${localHash.hash}, Remote: ${remoteHash.hash} | Units: ${localHash.unitCount} vs ${remoteHash.unitCount} | P1res: ${localHash.p1Resources} vs ${remoteHash.p1Resources} | P2res: ${localHash.p2Resources} vs ${remoteHash.p2Resources}`);

      // Side-by-side fingerprint comparison — makes it trivial to see which
      // field drifted without hunting through unit-detail dumps.
      if (localHash.rngState !== undefined || remoteHash.rngState !== undefined) {
        const rngMatch = localHash.rngState === remoteHash.rngState ? 'match' : 'DIFF';
        console.error(`[CmdQ]   RNG [${rngMatch}] local=${localHash.rngState} remote=${remoteHash.rngState}`);
      }
      if (localHash.terrainFingerprint || remoteHash.terrainFingerprint) {
        const tfMatch = localHash.terrainFingerprint === remoteHash.terrainFingerprint ? 'match' : 'DIFF';
        console.error(`[CmdQ]   Terrain [${tfMatch}] local=${localHash.terrainFingerprint} remote=${remoteHash.terrainFingerprint}`);
      }
      if (localHash.stockpileFingerprint || remoteHash.stockpileFingerprint) {
        const spMatch = localHash.stockpileFingerprint === remoteHash.stockpileFingerprint ? 'match' : 'DIFF';
        console.error(`[CmdQ]   Stockpiles [${spMatch}]`);
        console.error(`[CmdQ]     local:  ${localHash.stockpileFingerprint}`);
        console.error(`[CmdQ]     remote: ${remoteHash.stockpileFingerprint}`);
      }

      // Log detailed unit state on first desync
      if (!this._desyncDetailLogged) {
        this._desyncDetailLogged = true;
        if (localHash.unitDetails) {
          console.error(`[CmdQ] LOCAL unit state at desync tick ${remoteHash.tick}:\n${localHash.unitDetails}`);
        }
        if (remoteHash.unitDetails) {
          console.error(`[CmdQ] REMOTE unit state at desync tick ${remoteHash.tick}:\n${remoteHash.unitDetails}`);
        }
      }

      if (!this._desynced) {
        this._desynced = true;
        this._desyncTick = remoteHash.tick;
        this._onDesync?.(localHash.hash, remoteHash.hash, remoteHash.tick);
      }
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
    return count + this.localBuffer.length;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    this.tickBuffer.clear();
    this.localBuffer = [];
    this.currentTick = 0;
    this._remoteFrameTick = 0;
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
