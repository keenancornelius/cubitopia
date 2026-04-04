// ============================================
// CUBITOPIA — Genre-Based Music Player
// Loads MP3/OGG tracks from genre-specific folders under public/music/
// Each genre has its own peaceful + combat playlists.
// Player selects genre at the main menu; choice persisted to localStorage.
// Crossfades between peaceful and combat tracks based on game state.
// ============================================

import { Logger } from './Logger';

/** Mood presets the game can request. */
export enum MusicMood {
  CHILL_AMBIENT = 'chill_ambient',
  LOFI_COZY = 'lofi_cozy',
  FANTASY = 'fantasy',
  COMBAT = 'combat',
}

// ── Genre definitions ─────────────────────────────────────
// Each genre maps to a subfolder under public/music/<genre>/
// Drop MP3s named peaceful1..N.mp3, exploration1..N.mp3, combat1..N.mp3

export interface MusicGenre {
  id: string;
  label: string;
  description: string;
  color: string;        // Button accent color in menu
  icon: string;         // Emoji/symbol for the button
  folder: string;       // Subfolder name under public/music/
  peacefulCount: number; // Max peaceful+exploration files to probe
  combatCount: number;   // Max combat files to probe
}

export const MUSIC_GENRES: MusicGenre[] = [
  {
    id: 'fantasy',
    label: 'Ironveil',
    description: 'Tanks, mages, and healers — outlast through steel and sorcery',
    color: '#7f8c8d',
    icon: '\uD83D\uDEE1\uFE0F',  // 🛡️
    folder: 'fantasy',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'metal',
    label: 'Wildborne',
    description: 'Aggressive nature tribe — berserkers and beast dens',
    color: '#e74c3c',
    icon: '\uD83D\uDC3A',  // 🐺
    folder: 'metal',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'orchestral',
    label: 'Arcanists',
    description: 'Ranged magic wielders — battlemages and mana wells',
    color: '#9b59b6',
    icon: '\uD83D\uDD2E',  // 🔮
    folder: 'orchestral',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'celtic',
    label: 'Tidecallers',
    description: 'Naval traders — sea raiders and coastal dominance',
    color: '#3498db',
    icon: '\uD83C\uDF0A',  // 🌊
    folder: 'celtic',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'electronic',
    label: 'Tribe V',
    description: 'To be announced',
    color: '#1abc9c',
    icon: '\u2694',  // ⚔
    folder: 'electronic',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'hiphop',
    label: 'Tribe VI',
    description: 'To be announced',
    color: '#f1c40f',
    icon: '\u2694',  // ⚔
    folder: 'hiphop',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'lofi',
    label: 'Tribe VII',
    description: 'To be announced',
    color: '#e67e22',
    icon: '\u2694',  // ⚔
    folder: 'lofi',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'oldies',
    label: 'Tribe VIII',
    description: 'To be announced',
    color: '#d4a373',
    icon: '\u2694',  // ⚔
    folder: 'oldies',
    peacefulCount: 8,
    combatCount: 6,
  },
  {
    id: 'alternative',
    label: 'Tribe IX',
    description: 'To be announced',
    color: '#8e7cc3',
    icon: '\u2694',  // ⚔
    folder: 'alternative',
    peacefulCount: 8,
    combatCount: 6,
  },
];

// Fallback: also probe the root music/ folder (for legacy flat layout)
const LEGACY_PEACEFUL = [
  'music/peaceful1.mp3', 'music/peaceful2.mp3', 'music/peaceful3.mp3', 'music/peaceful4.mp3',
  'music/exploration1.mp3', 'music/exploration2.mp3',
];
const LEGACY_COMBAT = [
  'music/combat1.mp3', 'music/combat2.mp3', 'music/combat3.mp3',
];

const CROSSFADE_TIME = 2.0; // seconds

// Storage key for persisting genre choice
const GENRE_STORAGE_KEY = 'cubitopia_music_genre';

// ============================================
// MusicPlayer
// ============================================

export class ProceduralMusic {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Two audio sources for crossfading
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private nextSource: AudioBufferSourceNode | null = null;
  private nextGain: GainNode | null = null;

  // Track buffers
  private peacefulBuffers: AudioBuffer[] = [];
  private combatBuffers: AudioBuffer[] = [];
  private _loadedAny = false;

  // State
  private _initialized = false;
  private _loading = false;
  private _playing = false;
  private _mood: MusicMood = MusicMood.CHILL_AMBIENT;
  private _intensity = 0;
  private _volume = 0.5;
  private _intensityTimer = 0;
  private _currentTrackIndex = 0;
  private _isCombatTrack = false;
  private _crossfading = false;

  // Combat track lock
  private _combatTrackLocked = false;
  private _combatDuringTrack = false;

  // Game music paused (e.g. on title screen / menus)
  private _gameplayPaused = true;

  // Track end scheduling
  private _endCheckTimer = 0;

  // Genre selection
  private _currentGenre: string = 'fantasy';

  // ============================================
  // Public API
  // ============================================

  get mood(): MusicMood { return this._mood; }
  get intensity(): number { return this._intensity; }
  get playing(): boolean { return this._playing; }
  get currentGenre(): string { return this._currentGenre; }

  constructor() {
    // Restore saved genre preference
    try {
      const saved = localStorage.getItem(GENRE_STORAGE_KEY);
      if (saved && MUSIC_GENRES.some(g => g.id === saved)) {
        this._currentGenre = saved;
      }
    } catch {
      // localStorage unavailable — use default
    }
  }

  /** Switch genre. Stops current playback and reloads tracks from the new folder. */
  setGenre(genreId: string): void {
    if (genreId === this._currentGenre) return;
    const genre = MUSIC_GENRES.find(g => g.id === genreId);
    if (!genre) return;

    this._currentGenre = genreId;
    try { localStorage.setItem(GENRE_STORAGE_KEY, genreId); } catch {}

    Logger.info('Music', `Genre changed to: ${genre.label}`);

    // If already initialized, reload tracks immediately
    if (this._initialized && !this._loading) {
      this.stop();
      this.peacefulBuffers = [];
      this.combatBuffers = [];
      this._loadedAny = false;
      this._loadTracks();
    }

    // If title music is playing, swap to the genre's title track
    if (this._titlePlaying || this._titleWanted) {
      this._stopTitleSource();
      this._titleBuffer = null; // Force reload from new genre folder
      this.playTitleMusic();
    }
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.1);
    }
  }

  setMood(mood: MusicMood): void {
    if (mood === this._mood) return;
    this._mood = mood;
  }

  setIntensity(v: number): void {
    this._intensity = Math.max(0, Math.min(1, v));
  }

  /** Resume gameplay music (called when game starts). */
  resumeGameplay(): void {
    this._gameplayPaused = false;
  }

  /** Pause gameplay music and stop playback (called when returning to menu). */
  pauseGameplay(): void {
    this._gameplayPaused = true;
    this.stop();
  }

  /**
   * Called once per frame from the game loop.
   */
  updateFromGameState(
    delta: number,
    audioContext: AudioContext | null,
    musicVolume: number,
    allUnits: ArrayLike<{ owner: number; state: string }>,
  ): void {
    // Lazy-init: wait for AudioContext
    if (!this._initialized) {
      if (!audioContext) return;
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
        return;
      }
      if (audioContext.state !== 'running') return;

      this.ctx = audioContext;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = musicVolume;
      this.masterGain.connect(this.ctx.destination);
      this._volume = musicVolume;
      this._initialized = true;
      Logger.info('Music', 'AudioContext ready, loading tracks...');

      this._loadTracks();
      return;
    }

    // Update volume if changed
    if (Math.abs(musicVolume - this._volume) > 0.01) {
      this.setVolume(musicVolume);
    }

    // Don't do anything until tracks are loaded
    if (!this._loadedAny) return;

    // Don't auto-play game music while paused (e.g. on title screen)
    if (this._gameplayPaused) return;

    // Start playing if not yet
    if (!this._playing && (this.peacefulBuffers.length > 0 || this.combatBuffers.length > 0)) {
      this._startPlayback();
    }

    // Throttle intensity computation to every 0.5s
    this._intensityTimer += delta;
    if (this._intensityTimer < 0.5) return;
    this._intensityTimer = 0;

    // Compute combat intensity
    let total = 0, inCombat = 0;
    for (let i = 0, len = allUnits.length; i < len; i++) {
      const u = allUnits[i];
      if (u.owner === 0 && u.state !== 'dead') {
        total++;
        if (u.state === 'attacking') inCombat++;
      }
    }
    const raw = total > 0 ? inCombat / total : 0;
    const smoothed = this._intensity + (raw - this._intensity) * 0.3;
    this._intensity = smoothed;

    if (inCombat > 0) {
      this._combatDuringTrack = true;
    }

    const wantCombat = inCombat > 0 && this.combatBuffers.length > 0;

    if (wantCombat && !this._isCombatTrack && !this._crossfading) {
      this._combatTrackLocked = true;
      this._combatDuringTrack = true;
      this._crossfadeTo(true);
    }

    this._endCheckTimer += 0.5;
    if (this._endCheckTimer >= 2.0) {
      this._endCheckTimer = 0;
      this._checkTrackEnd();
    }
  }

  // ============================================
  // Track loading
  // ============================================

  private async _loadTracks(): Promise<void> {
    if (this._loading || !this.ctx) return;
    this._loading = true;

    const loadTrack = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const arrayBuf = await resp.arrayBuffer();
        return await this.ctx!.decodeAudioData(arrayBuf);
      } catch {
        return null;
      }
    };

    // Build track URLs from genre folder
    const genre = MUSIC_GENRES.find(g => g.id === this._currentGenre);
    const folder = genre ? `music/${genre.folder}` : 'music/fantasy';
    const maxPeaceful = genre?.peacefulCount ?? 8;
    const maxCombat = genre?.combatCount ?? 6;

    const peacefulUrls: string[] = [];
    for (let i = 1; i <= maxPeaceful; i++) {
      peacefulUrls.push(`${folder}/peaceful${i}.mp3`);
    }
    for (let i = 1; i <= Math.floor(maxPeaceful / 2); i++) {
      peacefulUrls.push(`${folder}/exploration${i}.mp3`);
    }

    const combatUrls: string[] = [];
    for (let i = 1; i <= maxCombat; i++) {
      combatUrls.push(`${folder}/combat${i}.mp3`);
    }

    // Load genre-specific tracks
    const [peaceful, combat] = await Promise.all([
      Promise.all(peacefulUrls.map(loadTrack)),
      Promise.all(combatUrls.map(loadTrack)),
    ]);

    this.peacefulBuffers = peaceful.filter((b): b is AudioBuffer => b !== null);
    this.combatBuffers = combat.filter((b): b is AudioBuffer => b !== null);

    // Fallback: if genre folder is empty, try legacy flat layout
    if (this.peacefulBuffers.length === 0 && this.combatBuffers.length === 0) {
      Logger.debug('Music', `No tracks in ${folder}/, trying legacy flat layout...`);
      const [legacyPeaceful, legacyCombat] = await Promise.all([
        Promise.all(LEGACY_PEACEFUL.map(loadTrack)),
        Promise.all(LEGACY_COMBAT.map(loadTrack)),
      ]);
      this.peacefulBuffers = legacyPeaceful.filter((b): b is AudioBuffer => b !== null);
      this.combatBuffers = legacyCombat.filter((b): b is AudioBuffer => b !== null);
    }

    const totalLoaded = this.peacefulBuffers.length + this.combatBuffers.length;
    this._loadedAny = totalLoaded > 0;

    if (totalLoaded > 0) {
      Logger.info('Music', `Genre "${this._currentGenre}" — loaded ${this.peacefulBuffers.length} peaceful + ${this.combatBuffers.length} combat tracks`);
    } else {
      Logger.warn('Music', `No tracks found for genre "${this._currentGenre}". Add MP3s to public/${folder}/:  Peaceful: peaceful1.mp3, peaceful2.mp3, ...  Combat: combat1.mp3, combat2.mp3, ...`);
    }

    this._loading = false;
  }

  // ============================================
  // Playback
  // ============================================

  private _startPlayback(): void {
    if (this._playing || !this.ctx || !this.masterGain) return;

    const buffers = this.peacefulBuffers.length > 0 ? this.peacefulBuffers : this.combatBuffers;
    if (buffers.length === 0) return;

    this._isCombatTrack = this.peacefulBuffers.length === 0;
    this._currentTrackIndex = Math.floor(Math.random() * buffers.length);

    this._playBuffer(buffers[this._currentTrackIndex]);
    this._playing = true;
    Logger.info('Music', `Playing ${this._isCombatTrack ? 'combat' : 'peaceful'} track ${this._currentTrackIndex}`);
  }

  private _playBuffer(buffer: AudioBuffer): void {
    if (!this.ctx || !this.masterGain) return;

    this._stopCurrent();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(gain);
    gain.connect(this.masterGain);

    source.onended = () => {
      if (this.currentSource === source) {
        this._advanceTrack();
      }
    };

    source.start(0);
    this.currentSource = source;
    this.currentGain = gain;
  }

  private _stopCurrent(): void {
    if (this.currentSource) {
      try { this.currentSource.onended = null; this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    if (this.currentGain) {
      try { this.currentGain.disconnect(); } catch {}
      this.currentGain = null;
    }
  }

  private _advanceTrack(): void {
    // Combat track just finished — decide whether to keep playing combat or return to peaceful
    if (this._isCombatTrack && this._combatTrackLocked) {
      if (this._combatDuringTrack && this._intensity > 0.05) {
        Logger.info('Music', 'Combat still active, playing next combat track');
        this._combatDuringTrack = false;
        const buffers = this.combatBuffers;
        if (buffers.length === 0) return;
        this._currentTrackIndex = (this._currentTrackIndex + 1) % buffers.length;
        this._playBuffer(buffers[this._currentTrackIndex]);
        Logger.debug('Music', `Advanced to combat track ${this._currentTrackIndex}`);
        return;
      } else {
        Logger.info('Music', 'Combat ended, returning to peaceful music');
        this._combatTrackLocked = false;
        this._combatDuringTrack = false;
        if (this.peacefulBuffers.length > 0) {
          this._crossfadeTo(false);
          return;
        }
      }
    }

    const buffers = this._isCombatTrack ? this.combatBuffers : this.peacefulBuffers;
    if (buffers.length === 0) return;

    this._currentTrackIndex = (this._currentTrackIndex + 1) % buffers.length;
    this._playBuffer(buffers[this._currentTrackIndex]);
    Logger.info('Music', `Advanced to ${this._isCombatTrack ? 'combat' : 'peaceful'} track ${this._currentTrackIndex}`);
  }

  private _checkTrackEnd(): void {
    if (!this.currentSource || !this.ctx) return;
  }

  // ============================================
  // Crossfading
  // ============================================

  private _crossfadeTo(combat: boolean): void {
    if (!this.ctx || !this.masterGain) return;

    const targetBuffers = combat ? this.combatBuffers : this.peacefulBuffers;
    if (targetBuffers.length === 0) return;

    this._crossfading = true;
    const t = this.ctx.currentTime;

    if (this.currentGain) {
      this.currentGain.gain.setTargetAtTime(0, t, CROSSFADE_TIME / 3);
    }

    const nextIndex = Math.floor(Math.random() * targetBuffers.length);
    const source = this.ctx.createBufferSource();
    source.buffer = targetBuffers[nextIndex];
    source.loop = false;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1.0, t, CROSSFADE_TIME / 3);
    source.connect(gain);
    gain.connect(this.masterGain);

    source.onended = () => {
      if (this.currentSource === source) {
        this._advanceTrack();
      }
    };

    source.start(0);

    const oldSource = this.currentSource;
    const oldGain = this.currentGain;
    setTimeout(() => {
      try { if (oldSource) { oldSource.onended = null; oldSource.stop(); } } catch {}
      try { if (oldGain) oldGain.disconnect(); } catch {}
    }, CROSSFADE_TIME * 1000 + 500);

    this.currentSource = source;
    this.currentGain = gain;
    this._isCombatTrack = combat;
    this._currentTrackIndex = nextIndex;

    Logger.info('Music', `Crossfading to ${combat ? 'combat' : 'peaceful'} track ${nextIndex}`);

    setTimeout(() => { this._crossfading = false; }, CROSSFADE_TIME * 1000);
  }

  // ============================================
  // Title screen music (plays on main menu)
  // ============================================

  private _titleBuffer: AudioBuffer | null = null;
  private _titleSource: AudioBufferSourceNode | null = null;
  private _titleGain: GainNode | null = null;
  private _titleLoading = false;
  private _titlePlaying = false;
  private _titleWanted = false; // Cancellation flag for async load
  private _titleGenre: string = ''; // Genre the cached title buffer belongs to

  /**
   * Play Title.mp3 on a loop for the main menu.
   * Self-initializes AudioContext if needed (requires user gesture).
   */
  async playTitleMusic(): Promise<void> {
    this._titleWanted = true;

    // Lazy-init AudioContext if the game loop hasn't created one yet
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this._volume;
        this.masterGain.connect(this.ctx.destination);
      } catch {
        Logger.warn('Music', 'Could not create AudioContext for title music');
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { return; }
    }

    // Load title track if not cached or genre changed
    const genre = MUSIC_GENRES.find(g => g.id === this._currentGenre);
    const genreFolder = genre?.folder ?? 'fantasy';
    if ((!this._titleBuffer || this._titleGenre !== this._currentGenre) && !this._titleLoading) {
      this._titleLoading = true;
      this._titleBuffer = null; // Clear stale buffer
      try {
        // Try genre-specific Title.mp3 first, then fall back to root
        let resp = await fetch(`music/${genreFolder}/Title.mp3`);
        if (!resp.ok) {
          resp = await fetch('music/Title.mp3');
        }
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          this._titleBuffer = await this.ctx!.decodeAudioData(arrayBuf);
          this._titleGenre = this._currentGenre;
        } else {
          Logger.warn('Music', 'Title.mp3 not found — add it to public/music/ or genre folder');
        }
      } catch {
        Logger.warn('Music', 'Failed to load Title.mp3');
      }
      this._titleLoading = false;
    }

    // Check cancellation — user may have clicked START while track was loading
    if (!this._titleWanted) return;
    if (!this._titleBuffer || !this.ctx) return;

    // Stop any existing title playback
    this._stopTitleSource();

    const source = this.ctx.createBufferSource();
    source.buffer = this._titleBuffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.5);
    source.connect(gain);
    gain.connect(this.ctx.destination); // Direct to output, bypasses masterGain

    source.start(0);
    this._titleSource = source;
    this._titleGain = gain;
    this._titlePlaying = true;
    Logger.info('Music', 'Title screen music playing');
  }

  /** Fade out and stop title music (called when game starts). */
  stopTitleMusic(): void {
    this._titleWanted = false; // Cancel any in-flight async load
    if (!this._titlePlaying && !this._titleSource) return;

    if (this._titleGain && this.ctx) {
      // Fade out over ~1 second then hard-stop
      this._titleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      const src = this._titleSource;
      const g = this._titleGain;
      setTimeout(() => {
        try { if (src) { src.onended = null; src.stop(); } } catch {}
        try { if (g) g.disconnect(); } catch {}
      }, 1500);
      this._titleSource = null;
      this._titleGain = null;
    } else {
      this._stopTitleSource();
    }

    this._titlePlaying = false;
    Logger.info('Music', 'Title screen music stopped');
  }

  private _stopTitleSource(): void {
    if (this._titleSource) {
      try { this._titleSource.onended = null; this._titleSource.stop(); } catch {}
      this._titleSource = null;
    }
    if (this._titleGain) {
      try { this._titleGain.disconnect(); } catch {}
      this._titleGain = null;
    }
    this._titlePlaying = false;
  }

  get isTitlePlaying(): boolean { return this._titlePlaying; }

  // ============================================
  // Tutorial track (plays over help overlay)
  // ============================================

  private _tutorialBuffer: AudioBuffer | null = null;
  private _tutorialSource: AudioBufferSourceNode | null = null;
  private _tutorialGain: GainNode | null = null;
  private _tutorialLoading = false;
  private _savedMasterVolume = 0.5;
  private _tutorialGenre: string = ''; // Genre the cached tutorial buffer belongs to

  /** Load and play Tutorial.mp3, ducking the game music volume. */
  async playTutorial(): Promise<void> {
    if (!this.ctx || !this.masterGain) return;

    // Duck game music to 15% while tutorial plays
    this._savedMasterVolume = this._volume;
    this.masterGain.gain.setTargetAtTime(this._volume * 0.15, this.ctx.currentTime, 0.3);

    // Load tutorial track if not cached or genre changed
    const tutGenre = MUSIC_GENRES.find(g => g.id === this._currentGenre);
    const tutFolder = tutGenre?.folder ?? 'fantasy';
    if ((!this._tutorialBuffer || this._tutorialGenre !== this._currentGenre) && !this._tutorialLoading) {
      this._tutorialLoading = true;
      this._tutorialBuffer = null;
      try {
        // Try genre-specific tutorial first, then fall back to root
        let resp = await fetch(`music/${tutFolder}/tutorial.mp3`);
        if (!resp.ok) {
          resp = await fetch('music/Tutorial.mp3');
        }
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          this._tutorialBuffer = await this.ctx.decodeAudioData(arrayBuf);
          this._tutorialGenre = this._currentGenre;
        } else {
          Logger.warn('Music', 'Tutorial.mp3 not found — add it to public/music/ or genre folder');
        }
      } catch {
        Logger.warn('Music', 'Failed to load Tutorial.mp3');
      }
      this._tutorialLoading = false;
    }

    if (!this._tutorialBuffer || !this.ctx) return;

    // Stop any existing tutorial playback
    this._stopTutorialSource();

    const source = this.ctx.createBufferSource();
    source.buffer = this._tutorialBuffer;
    source.loop = true; // Loop while help is open

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.3);
    source.connect(gain);
    gain.connect(this.ctx.destination); // Direct to output, not through masterGain

    source.start(0);
    this._tutorialSource = source;
    this._tutorialGain = gain;
    Logger.info('Music', 'Tutorial track playing');
  }

  /** Stop tutorial track and restore game music volume. */
  stopTutorial(): void {
    this._stopTutorialSource();

    // Restore game music volume
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this._savedMasterVolume, this.ctx.currentTime, 0.3);
    }
    Logger.info('Music', 'Tutorial track stopped');
  }

  private _stopTutorialSource(): void {
    if (this._tutorialSource) {
      try { this._tutorialSource.onended = null; this._tutorialSource.stop(); } catch {}
      this._tutorialSource = null;
    }
    if (this._tutorialGain) {
      try { this._tutorialGain.disconnect(); } catch {}
      this._tutorialGain = null;
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  stop(): void {
    this._playing = false;
    this._stopCurrent();
    this._stopTutorialSource();
  }
}
