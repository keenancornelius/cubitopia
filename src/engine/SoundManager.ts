// ============================================
// CUBITOPIA - Sound Manager
// Procedural audio using Web Audio API — no asset files needed.
// Synthesizes combat SFX, ambient, and UI sounds on the fly.
// ============================================

export interface SoundConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

type SoundName =
  | 'hit_melee' | 'hit_ranged' | 'hit_siege'
  | 'death' | 'heal' | 'splash_aoe'
  | 'select' | 'command' | 'build'
  | 'rage' | 'assassin_strike'
  | 'ui_click' | 'ui_hover'
  | 'battle_start';

export default class SoundManager {
  private ctx: AudioContext | null = null;
  private config: SoundConfig = {
    masterVolume: 0.3,
    sfxVolume: 0.7,
    musicVolume: 0.3,
    muted: false,
  };
  private lastPlayTime: Map<SoundName, number> = new Map();
  private minInterval = 0.05; // Minimum seconds between same sound

  constructor() {
    // Defer AudioContext creation until first user interaction
    const initAudio = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);
  }

  setMuted(muted: boolean): void {
    this.config.muted = muted;
  }

  setVolume(volume: number): void {
    this.config.masterVolume = Math.max(0, Math.min(1, volume));
  }

  play(name: SoundName, volume?: number): void {
    if (this.config.muted || !this.ctx) return;

    // Throttle rapid-fire sounds
    const now = this.ctx.currentTime;
    const lastTime = this.lastPlayTime.get(name) || 0;
    if (now - lastTime < this.minInterval) return;
    this.lastPlayTime.set(name, now);

    const vol = (volume ?? 1) * this.config.sfxVolume * this.config.masterVolume;

    switch (name) {
      case 'hit_melee':    this.synthHitMelee(vol); break;
      case 'hit_ranged':   this.synthHitRanged(vol); break;
      case 'hit_siege':    this.synthHitSiege(vol); break;
      case 'death':        this.synthDeath(vol); break;
      case 'heal':         this.synthHeal(vol); break;
      case 'splash_aoe':   this.synthSplashAoE(vol); break;
      case 'select':       this.synthSelect(vol); break;
      case 'command':      this.synthCommand(vol); break;
      case 'build':        this.synthBuild(vol); break;
      case 'rage':         this.synthRage(vol); break;
      case 'assassin_strike': this.synthAssassinStrike(vol); break;
      case 'ui_click':     this.synthUIClick(vol); break;
      case 'ui_hover':     this.synthUIHover(vol); break;
      case 'battle_start': this.synthBattleStart(vol); break;
    }
  }

  // --- Synth Helpers ---

  private gain(vol: number, duration: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(vol, this.ctx!.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + duration);
    g.connect(this.ctx!.destination);
    return g;
  }

  private noise(duration: number, vol: number): void {
    const ctx = this.ctx!;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const g = this.gain(vol, duration);
    source.connect(g);
    source.start();
  }

  private tone(freq: number, duration: number, vol: number, type: OscillatorType = 'sine'): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    const g = this.gain(vol, duration);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    return osc;
  }

  // --- Combat Sounds ---

  private synthHitMelee(vol: number): void {
    // Sharp metallic clang + thud
    this.tone(800, 0.08, vol * 0.6, 'square');
    this.tone(200, 0.1, vol * 0.4, 'sine');
    this.noise(0.06, vol * 0.3);
  }

  private synthHitRanged(vol: number): void {
    // Whoosh + impact
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);
    const g = this.gain(vol * 0.5, 0.12);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    this.noise(0.04, vol * 0.2);
  }

  private synthHitSiege(vol: number): void {
    // Deep boom + rumble
    this.tone(60, 0.3, vol * 0.7, 'sine');
    this.tone(40, 0.4, vol * 0.4, 'sine');
    this.noise(0.15, vol * 0.5);
  }

  private synthDeath(vol: number): void {
    // Descending tone + soft noise
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
    const g = this.gain(vol * 0.4, 0.35);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }

  private synthHeal(vol: number): void {
    // Bright ascending chime
    this.tone(523, 0.1, vol * 0.3, 'sine');  // C5
    setTimeout(() => this.tone(659, 0.1, vol * 0.3, 'sine'), 60);  // E5
    setTimeout(() => this.tone(784, 0.15, vol * 0.4, 'sine'), 120); // G5
  }

  private synthSplashAoE(vol: number): void {
    // Arcane burst — rising sweep + noise
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
    const g = this.gain(vol * 0.4, 0.2);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    this.noise(0.1, vol * 0.3);
  }

  private synthRage(vol: number): void {
    // Low growl + rising distortion
    this.tone(80, 0.3, vol * 0.5, 'sawtooth');
    this.tone(120, 0.25, vol * 0.3, 'square');
  }

  private synthAssassinStrike(vol: number): void {
    // Quick slice — high-pitched swoosh
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.06);
    const g = this.gain(vol * 0.5, 0.08);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  // --- UI Sounds ---

  private synthSelect(vol: number): void {
    this.tone(600, 0.06, vol * 0.3, 'sine');
  }

  private synthCommand(vol: number): void {
    this.tone(400, 0.05, vol * 0.2, 'sine');
    setTimeout(() => this.tone(500, 0.05, vol * 0.2, 'sine'), 40);
  }

  private synthBuild(vol: number): void {
    this.noise(0.08, vol * 0.3);
    this.tone(300, 0.1, vol * 0.2, 'triangle');
  }

  private synthUIClick(vol: number): void {
    this.tone(800, 0.04, vol * 0.2, 'sine');
  }

  private synthUIHover(vol: number): void {
    this.tone(1000, 0.02, vol * 0.1, 'sine');
  }

  private synthBattleStart(vol: number): void {
    // Horn fanfare — 3-note ascending
    this.tone(262, 0.2, vol * 0.4, 'triangle');  // C4
    setTimeout(() => this.tone(330, 0.2, vol * 0.4, 'triangle'), 200); // E4
    setTimeout(() => this.tone(392, 0.4, vol * 0.5, 'triangle'), 400); // G4
  }

  cleanup(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
