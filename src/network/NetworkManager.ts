// ============================================
// CUBITOPIA - Network Manager
// Phase 5B: WebRTC P2P via PeerJS + Firebase Signaling
// ============================================
//
// Once matchmaking pairs two players, NetworkManager:
//   1. Exchanges WebRTC signaling data through Firebase
//   2. Establishes a direct PeerJS DataChannel
//   3. Sends/receives NetworkCommands in lockstep
//   4. Exchanges state hashes for desync detection
//   5. Measures latency (ping)
//
// After connection, Firebase is out of the loop — all data
// flows directly P2P over WebRTC DataChannel.
// ============================================

import Peer, { DataConnection } from 'peerjs';
import {
  sendSignal,
  watchSignals,
  updateMatch,
  cleanupMatch,
  type Unsubscribe,
} from './FirebaseConfig';
import { NetworkCommand, NetworkMessage, MessageType, GameStateHash } from './Protocol';

export type ConnectionState = 'disconnected' | 'connecting' | 'signaling' | 'connected' | 'error';

export interface NetworkEvents {
  onStateChange?: (state: ConnectionState) => void;
  onCommand?: (cmd: NetworkCommand) => void;
  onStateHash?: (hash: GameStateHash) => void;
  onPingUpdate?: (pingMs: number) => void;
  onDesync?: (localHash: number, remoteHash: number, tick: number) => void;
  onDisconnect?: () => void;
  onError?: (err: string) => void;
}

export class NetworkManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private state: ConnectionState = 'disconnected';
  private events: NetworkEvents = {};
  private signalUnsub: Unsubscribe | null = null;

  // Connection metadata
  private _matchId: string = '';
  private _localUid: string = '';
  private _remoteUid: string = '';
  private _isHost: boolean = false;

  // Ping tracking
  private _lastPingSent = 0;
  private _pingMs = 0;
  private _pingInterval: ReturnType<typeof setInterval> | null = null;

  // Outbound queue (buffered if not yet connected)
  private _sendBuffer: NetworkMessage[] = [];

  // ── Getters ──────────────────────────────────────────────
  get matchId() { return this._matchId; }
  get localUid() { return this._localUid; }
  get remoteUid() { return this._remoteUid; }
  get isHost() { return this._isHost; }
  get ping() { return this._pingMs; }
  get connectionState() { return this.state; }
  get isConnected() { return this.state === 'connected'; }

  /** Sanitize a string for use as a PeerJS ID (alphanumeric + hyphens only, no leading hyphen) */
  private sanitizePeerId(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9-]/g, '').replace(/^-+/, '');
  }

  // ── Setup ────────────────────────────────────────────────
  setEvents(events: NetworkEvents): void {
    this.events = events;
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.events.onStateChange?.(s);
  }

  // ============================================
  // Connect as HOST (Player 1 — creates PeerJS peer, waits for guest)
  // ============================================
  async connectAsHost(matchId: string, localUid: string, remoteUid: string): Promise<void> {
    this._matchId = matchId;
    this._localUid = localUid;
    this._remoteUid = remoteUid;
    this._isHost = true;
    this.setState('connecting');

    // Create PeerJS instance with a match-scoped ID
    // Firebase push IDs start with '-' which PeerJS rejects, so sanitize
    const safeMatchId = this.sanitizePeerId(matchId);
    const peerId = `cubitopia-${safeMatchId}-host`;
    this.peer = new Peer(peerId, {
      debug: 0, // silent
    });

    return new Promise<void>((resolve, reject) => {
      this.peer!.on('open', () => {
        this.setState('signaling');
        // Write our PeerJS ID to Firebase so guest can connect
        sendSignal(matchId, localUid, { type: 'peer-id', peerId });

        // Wait for incoming connection from guest
        this.peer!.on('connection', (conn) => {
          this.conn = conn;
          this.setupDataChannel(conn);
          resolve();
        });

        // Timeout — if guest doesn't connect in 30s
        setTimeout(() => {
          if (this.state !== 'connected') {
            this.setState('error');
            reject(new Error('Connection timeout — guest did not connect'));
          }
        }, 30_000);
      });

      this.peer!.on('error', (err) => {
        this.setState('error');
        this.events.onError?.(err.message ?? String(err));
        reject(err);
      });
    });
  }

  // ============================================
  // Connect as GUEST (Player 2 — reads host PeerJS ID, initiates connection)
  // ============================================
  async connectAsGuest(matchId: string, localUid: string, remoteUid: string): Promise<void> {
    this._matchId = matchId;
    this._localUid = localUid;
    this._remoteUid = remoteUid;
    this._isHost = false;
    this.setState('connecting');

    const safeMatchId = this.sanitizePeerId(matchId);
    const peerId = `cubitopia-${safeMatchId}-guest`;
    this.peer = new Peer(peerId, { debug: 0 });

    return new Promise<void>((resolve, reject) => {
      this.peer!.on('open', () => {
        this.setState('signaling');

        // Watch Firebase for host's PeerJS ID
        this.signalUnsub = watchSignals(matchId, remoteUid, (signal: unknown) => {
          const sig = signal as { type: string; peerId?: string };
          if (sig.type === 'peer-id' && sig.peerId) {
            // Connect to host
            const conn = this.peer!.connect(sig.peerId, { reliable: true });
            this.conn = conn;
            this.setupDataChannel(conn);
            resolve();
          }
        });

        setTimeout(() => {
          if (this.state !== 'connected') {
            this.setState('error');
            reject(new Error('Connection timeout — could not reach host'));
          }
        }, 30_000);
      });

      this.peer!.on('error', (err) => {
        this.setState('error');
        this.events.onError?.(err.message ?? String(err));
        reject(err);
      });
    });
  }

  // ============================================
  // DataChannel setup (shared by host and guest)
  // ============================================
  private setupDataChannel(conn: DataConnection): void {
    conn.on('open', () => {
      this.setState('connected');

      // Clean up Firebase signaling — no longer needed
      cleanupMatch(this._matchId).catch(() => {});
      if (this.signalUnsub) {
        this.signalUnsub();
        this.signalUnsub = null;
      }

      // Flush any buffered messages
      for (const msg of this._sendBuffer) {
        conn.send(JSON.stringify(msg));
      }
      this._sendBuffer = [];

      // Start ping loop
      this.startPingLoop();

      // Mark match as playing
      updateMatch(this._matchId, { status: 'playing' }).catch(() => {});
    });

    conn.on('data', (raw) => {
      try {
        const msg: NetworkMessage = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this.handleMessage(msg);
      } catch (e) {
        console.warn('[Net] Failed to parse message:', e);
      }
    });

    conn.on('close', () => {
      this.setState('disconnected');
      this.events.onDisconnect?.();
      this.cleanup();
    });

    conn.on('error', (err) => {
      this.setState('error');
      this.events.onError?.(err.message ?? String(err));
    });
  }

  // ============================================
  // Message handling
  // ============================================
  private handleMessage(msg: NetworkMessage): void {
    switch (msg.type) {
      case MessageType.COMMAND: {
        const cmd = msg.payload as NetworkCommand;
        console.log(`[Net] RECV COMMAND: type=${cmd.type} tick=${cmd.tick} player=${cmd.playerId?.slice(0,8)} hasHandler=${!!this.events.onCommand}`);
        this.events.onCommand?.(cmd);
        break;
      }

      case MessageType.STATE_HASH:
        this.events.onStateHash?.(msg.payload as GameStateHash);
        break;

      case MessageType.PING:
        // Respond immediately with pong
        this.sendRaw({ type: MessageType.PONG, payload: msg.payload });
        break;

      case MessageType.PONG:
        // Calculate round-trip time
        const sent = (msg.payload as { timestamp: number }).timestamp;
        this._pingMs = Math.round(performance.now() - sent);
        this.events.onPingUpdate?.(this._pingMs);
        break;

      case MessageType.SURRENDER:
        // Opponent surrendered — game over
        this.events.onCommand?.({
          tick: 0,
          playerId: this._remoteUid,
          type: 'surrender',
          payload: {},
        } as NetworkCommand);
        break;

      case MessageType.CHAT:
        // Future: in-game chat
        break;
    }
  }

  // ============================================
  // Send methods
  // ============================================
  sendCommand(cmd: NetworkCommand): void {
    this.sendRaw({ type: MessageType.COMMAND, payload: cmd });
  }

  sendStateHash(hash: GameStateHash): void {
    this.sendRaw({ type: MessageType.STATE_HASH, payload: hash });
  }

  sendSurrender(): void {
    this.sendRaw({ type: MessageType.SURRENDER, payload: {} });
  }

  private sendRaw(msg: NetworkMessage): void {
    if (this.conn && this.conn.open) {
      if (msg.type === MessageType.COMMAND) {
        console.log(`[Net] SEND COMMAND via DataChannel (open=true)`);
      }
      this.conn.send(JSON.stringify(msg));
    } else {
      if (msg.type === MessageType.COMMAND) {
        console.log(`[Net] BUFFERING COMMAND — conn=${!!this.conn} open=${this.conn?.open}`);
      }
      // Buffer until connected
      this._sendBuffer.push(msg);
    }
  }

  // ============================================
  // Ping loop
  // ============================================
  private startPingLoop(): void {
    this._pingInterval = setInterval(() => {
      if (this.isConnected) {
        this._lastPingSent = performance.now();
        this.sendRaw({
          type: MessageType.PING,
          payload: { timestamp: this._lastPingSent },
        });
      }
    }, 2000); // Ping every 2 seconds
  }

  // ============================================
  // Cleanup
  // ============================================
  cleanup(): void {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this.signalUnsub) {
      this.signalUnsub();
      this.signalUnsub = null;
    }
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.setState('disconnected');
    this._sendBuffer = [];
  }
}
