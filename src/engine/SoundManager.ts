// ============================================
// CUBITOPIA - Sound Manager (v2)
// Procedural audio using Web Audio API — no asset files needed.
// Multi-layered synthesis with filters, noise shaping, waveshaping
// distortion, ring modulation, and envelope sculpting.
// ============================================

export interface SoundConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

type SoundName =
  | 'hit_melee' | 'hit_ranged' | 'hit_siege'
  | 'hit_pierce' | 'hit_cleave' | 'hit_blunt'
  | 'death' | 'heal' | 'splash_aoe'
  | 'select' | 'command' | 'build'
  | 'rage' | 'assassin_strike'
  | 'ui_click' | 'ui_hover'
  | 'battle_start' | 'level_up'
  | 'queue_confirm' | 'queue_error' | 'craft_confirm';

export default class SoundManager {
  private ctx: AudioContext | null = null;
  private config: SoundConfig = {
    masterVolume: 0.3,
    sfxVolume: 0.7,
    musicVolume: 0.3,
    muted: false,
  };
  private lastPlayTime: Map<SoundName, number> = new Map();
  private minInterval = 0.05;
  private noiseBuffer: AudioBuffer | null = null;
  private distortionCurve: Float32Array | null = null;

  constructor() {
    const initAudio = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.noiseBuffer = this.createNoiseBuffer(2);
        this.distortionCurve = this.createDistortionCurve(400);
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);
  }

  setMuted(muted: boolean): void { this.config.muted = muted; }
  setVolume(volume: number): void { this.config.masterVolume = Math.max(0, Math.min(1, volume)); }

  play(name: SoundName, volume?: number): void {
    if (this.config.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const lastTime = this.lastPlayTime.get(name) || 0;
    if (now - lastTime < this.minInterval) return;
    this.lastPlayTime.set(name, now);
    const vol = (volume ?? 1) * this.config.sfxVolume * this.config.masterVolume;
    switch (name) {
      case 'hit_melee':    this.synthHitMelee(vol); break;
      case 'hit_ranged':   this.synthHitRanged(vol); break;
      case 'hit_siege':    this.synthHitSiege(vol); break;
      case 'hit_pierce':   this.synthHitPierce(vol); break;
      case 'hit_cleave':   this.synthHitCleave(vol); break;
      case 'hit_blunt':    this.synthHitBlunt(vol); break;
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
      case 'level_up':     this.synthLevelUp(vol); break;
      case 'queue_confirm': this.synthQueueConfirm(vol); break;
      case 'queue_error':   this.synthQueueError(vol); break;
      case 'craft_confirm': this.synthCraftConfirm(vol); break;
    }
  }

  // ==================== Core Helpers ====================

  /** Pre-baked white noise buffer (reusable) */
  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Sigmoid distortion curve for waveshaping */
  private createDistortionCurve(amount: number): Float32Array {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  /** Create a gain node with an exponential decay envelope */
  private envGain(vol: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    return g;
  }

  /** Play noise through a filter with envelope */
  private filteredNoise(
    filterType: BiquadFilterType, freq: number, q: number,
    vol: number, attack: number, decay: number, dest?: AudioNode,
  ): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    filter.Q.setValueAtTime(q, ctx.currentTime);
    const g = this.envGain(vol, attack, decay);
    src.connect(filter).connect(g).connect(dest ?? ctx.destination);
    src.start();
    src.stop(ctx.currentTime + attack + decay + 0.05);
  }

  /** Play an oscillator tone with attack/decay envelope + optional filter */
  private envTone(
    freq: number, type: OscillatorType, vol: number,
    attack: number, decay: number, opts?: {
      freqEnd?: number; filterType?: BiquadFilterType;
      filterFreq?: number; filterQ?: number; dest?: AudioNode;
      detune?: number;
    },
  ): OscillatorNode {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts?.detune) osc.detune.setValueAtTime(opts.detune, t);
    if (opts?.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + attack + decay);
    const g = this.envGain(vol, attack, decay);
    let chain: AudioNode = g;
    if (opts?.filterType) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filterType;
      f.frequency.setValueAtTime(opts.filterFreq ?? 1000, t);
      f.Q.setValueAtTime(opts.filterQ ?? 1, t);
      g.connect(f).connect(opts?.dest ?? ctx.destination);
      chain = g;
    } else {
      g.connect(opts?.dest ?? ctx.destination);
    }
    osc.connect(chain);
    osc.start();
    osc.stop(t + attack + decay + 0.05);
    return osc;
  }

  /** Waveshaper distortion node */
  private distortion(): WaveShaperNode {
    const ws = this.ctx!.createWaveShaper();
    ws.curve = this.distortionCurve as any;
    ws.oversample = '2x';
    return ws;
  }

  /** Slight random variation for organic feel */
  private vary(base: number, pct = 0.1): number {
    return base * (1 + (Math.random() - 0.5) * 2 * pct);
  }

  // ==================== Combat Sounds ====================

  /** Sword clash — layered metal resonance + noise impact transient */
  private synthHitMelee(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Layer 1: body resonance (low metallic ring)
    this.envTone(this.vary(350), 'triangle', vol * 0.35, 0.003, 0.18);
    // Layer 2: metallic clang (mid, inharmonic)
    this.envTone(this.vary(1400), 'square', vol * 0.2, 0.002, 0.1, {
      filterType: 'bandpass', filterFreq: 1500, filterQ: 4,
    });
    // Layer 3: high "shing" shimmer
    this.envTone(this.vary(4200), 'sine', vol * 0.12, 0.002, 0.06);
    // Layer 4: noise transient burst (impact texture)
    this.filteredNoise('highpass', 800, 1, vol * 0.25, 0.002, 0.05);
    // Layer 5: ring mod metallic overtone (two non-harmonic sines)
    const g1 = this.envGain(vol * 0.15, 0.002, 0.12);
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.frequency.setValueAtTime(this.vary(420), t);
    osc2.frequency.setValueAtTime(this.vary(680), t);
    osc1.type = 'sine'; osc2.type = 'sine';
    // Multiply via gain modulation (ring mod approximation)
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(0, t);
    osc1.connect(modGain);
    osc2.connect(modGain.gain);
    modGain.connect(g1).connect(ctx.destination);
    osc1.start(); osc2.start();
    osc1.stop(t + 0.15); osc2.stop(t + 0.15);
  }

  /** Arrow release + whoosh + impact thud */
  private synthHitRanged(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Bow string pluck: brief high-freq click
    this.envTone(this.vary(5500), 'sine', vol * 0.15, 0.001, 0.015);
    // Whoosh: noise swept through lowpass
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(3500, t);
    lpf.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    lpf.Q.setValueAtTime(2, t);
    const whooshGain = this.envGain(vol * 0.22, 0.005, 0.2);
    src.connect(lpf).connect(whooshGain).connect(ctx.destination);
    src.start(); src.stop(t + 0.25);
    // Impact body: low sine thud (delayed slightly)
    const impOsc = ctx.createOscillator();
    impOsc.type = 'sine';
    impOsc.frequency.setValueAtTime(this.vary(180), t + 0.08);
    const impG = ctx.createGain();
    impG.gain.setValueAtTime(0.001, t);
    impG.gain.setValueAtTime(0.001, t + 0.08);
    impG.gain.linearRampToValueAtTime(vol * 0.2, t + 0.083);
    impG.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    impOsc.connect(impG).connect(ctx.destination);
    impOsc.start(); impOsc.stop(t + 0.25);
    // Small noise impact at arrival
    this.filteredNoise('bandpass', 1200, 2, vol * 0.12, 0.001, 0.04);
  }

  /** Catapult/trebuchet launch rumble → heavy ground-shaking impact */
  private synthHitSiege(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Phase 1: Launch creak/strain (rising noise + sawtooth)
    this.envTone(this.vary(120), 'sawtooth', vol * 0.2, 0.005, 0.2, { freqEnd: 220 });
    this.filteredNoise('bandpass', 600, 3, vol * 0.15, 0.005, 0.15);
    // Phase 2: Sub-bass impact (delayed 200ms)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(this.vary(50), t + 0.2);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.001, t);
    subG.gain.setValueAtTime(0.001, t + 0.2);
    subG.gain.linearRampToValueAtTime(vol * 0.55, t + 0.205);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    subOsc.connect(subG).connect(ctx.destination);
    subOsc.start(); subOsc.stop(t + 0.85);
    // Phase 2b: Mid punch
    const midOsc = ctx.createOscillator();
    midOsc.type = 'sine';
    midOsc.frequency.setValueAtTime(this.vary(280), t + 0.2);
    midOsc.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const midG = ctx.createGain();
    midG.gain.setValueAtTime(0.001, t);
    midG.gain.setValueAtTime(0.001, t + 0.2);
    midG.gain.linearRampToValueAtTime(vol * 0.3, t + 0.205);
    midG.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    midOsc.connect(midG).connect(ctx.destination);
    midOsc.start(); midOsc.stop(t + 0.6);
    // Phase 2c: Noise crumble
    const crSrc = ctx.createBufferSource();
    crSrc.buffer = this.noiseBuffer!;
    const crF = ctx.createBiquadFilter();
    crF.type = 'bandpass'; crF.frequency.setValueAtTime(800, t + 0.2);
    crF.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    crF.Q.setValueAtTime(1.5, t);
    const crG = ctx.createGain();
    crG.gain.setValueAtTime(0.001, t);
    crG.gain.setValueAtTime(0.001, t + 0.2);
    crG.gain.linearRampToValueAtTime(vol * 0.3, t + 0.22);
    crG.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    crSrc.connect(crF).connect(crG).connect(ctx.destination);
    crSrc.start(); crSrc.stop(t + 0.7);
  }

  /** Pierce hit — sharp metallic stab with a "thunk" of penetration */
  private synthHitPierce(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Sharp high-freq click (blade tip hitting)
    this.envTone(this.vary(5800), 'sine', vol * 0.3, 0.001, 0.02);
    // Short metallic scrape (bandpass noise, narrow)
    this.filteredNoise('bandpass', 3200, 6, vol * 0.2, 0.001, 0.04);
    // Body thud (low sine = puncture into flesh)
    this.envTone(this.vary(160), 'sine', vol * 0.25, 0.003, 0.12, {
      freqEnd: 90,
    });
    // Squelch: very brief filtered noise for "wet" texture
    this.filteredNoise('lowpass', 800, 2, vol * 0.15, 0.005, 0.06);
  }

  /** Cleave hit — heavy whooshing arc + meaty impact */
  private synthHitCleave(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Whoosh: wide noise sweep (air displacement)
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'bandpass';
    lpf.frequency.setValueAtTime(2500, t);
    lpf.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    lpf.Q.setValueAtTime(1.5, t);
    const whooshG = this.envGain(vol * 0.3, 0.003, 0.15);
    src.connect(lpf).connect(whooshG).connect(ctx.destination);
    src.start(); src.stop(t + 0.2);
    // Heavy metallic chop (layered: low resonance + mid clang)
    this.envTone(this.vary(200), 'triangle', vol * 0.35, 0.002, 0.2, {
      freqEnd: 100,
    });
    this.envTone(this.vary(800), 'square', vol * 0.18, 0.002, 0.08, {
      filterType: 'bandpass', filterFreq: 900, filterQ: 3,
    });
    // Noise crunch at impact
    this.filteredNoise('highpass', 600, 1.5, vol * 0.22, 0.002, 0.06);
  }

  /** Blunt hit — deep bass thud + rattling overtones (shield bash, mace, staff slam) */
  private synthHitBlunt(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Deep bass punch (sub-100 Hz)
    this.envTone(this.vary(65), 'sine', vol * 0.45, 0.002, 0.25, {
      freqEnd: 40,
    });
    // Mid-body resonance (wood/metal thud)
    this.envTone(this.vary(320), 'triangle', vol * 0.25, 0.003, 0.15);
    // Rattle overtones (brief inharmonic clatter)
    this.envTone(this.vary(1800), 'square', vol * 0.1, 0.002, 0.05, {
      filterType: 'highpass', filterFreq: 1500, filterQ: 2,
    });
    // Noise transient (impact crunch)
    this.filteredNoise('lowpass', 1200, 1, vol * 0.3, 0.002, 0.07);
  }

  /** Death: sharp body-drop thud + bone crack + fading groan */
  private synthDeath(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Layer 1: Body impact — quick low thud (hitting the ground)
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(this.vary(90), t);
    thud.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const thudG = ctx.createGain();
    thudG.gain.setValueAtTime(0.001, t);
    thudG.gain.linearRampToValueAtTime(vol * 0.4, t + 0.005);
    thudG.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    thud.connect(thudG).connect(ctx.destination);
    thud.start(); thud.stop(t + 0.25);

    // Layer 2: Armor/bone crack — short mid-freq noise snap
    this.filteredNoise('bandpass', 1800, 4, vol * 0.2, 0.002, 0.04);

    // Layer 3: Descending groan — voice-like filtered saw, drops in pitch
    const groan = ctx.createOscillator();
    groan.type = 'sawtooth';
    groan.frequency.setValueAtTime(this.vary(320), t + 0.03);
    groan.frequency.exponentialRampToValueAtTime(100, t + 0.45);
    const groanLpf = ctx.createBiquadFilter();
    groanLpf.type = 'lowpass';
    groanLpf.frequency.setValueAtTime(600, t);
    groanLpf.frequency.exponentialRampToValueAtTime(150, t + 0.4);
    groanLpf.Q.setValueAtTime(3, t);
    const groanG = ctx.createGain();
    groanG.gain.setValueAtTime(0.001, t);
    groanG.gain.linearRampToValueAtTime(vol * 0.15, t + 0.05);
    groanG.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    groan.connect(groanLpf).connect(groanG).connect(ctx.destination);
    groan.start(); groan.stop(t + 0.5);

    // Layer 4: Metal clatter — brief high noise (weapon/shield dropping)
    const clatterSrc = ctx.createBufferSource();
    clatterSrc.buffer = this.noiseBuffer!;
    const clatterF = ctx.createBiquadFilter();
    clatterF.type = 'bandpass';
    clatterF.frequency.setValueAtTime(this.vary(2800), t + 0.06);
    clatterF.Q.setValueAtTime(2, t);
    const clatterG = ctx.createGain();
    clatterG.gain.setValueAtTime(0.001, t);
    clatterG.gain.setValueAtTime(0.001, t + 0.06);
    clatterG.gain.linearRampToValueAtTime(vol * 0.1, t + 0.065);
    clatterG.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    clatterSrc.connect(clatterF).connect(clatterG).connect(ctx.destination);
    clatterSrc.start(); clatterSrc.stop(t + 0.2);

    // Layer 5: Fading exhale — soft noise tail
    this.filteredNoise('lowpass', 500, 0.7, vol * 0.06, 0.05, 0.4);
  }

  /** Heal: angelic choir pad — warm stacked voices with slow swell and airy breath */
  private synthHeal(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Layer 1: Choir vowel pad — stacked 5ths with detuned pairs (simulates voices)
    // C4, G4, C5 chord with ±3 cent detune pairs for chorus/ensemble width
    const choirNotes = [262, 392, 523]; // C4, G4, C5
    choirNotes.forEach((freq) => {
      [-3, 3].forEach(detuneCents => {
        const osc = ctx.createOscillator();
        osc.type = 'sine'; // Pure tone = vowel fundamental
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.setValueAtTime(detuneCents, t);

        // Soft vowel formant — bandpass around 800Hz gives "ah" quality
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.setValueAtTime(800, t);
        formant.Q.setValueAtTime(2, t);

        // Gentle swell envelope (choir breathes in then sustains)
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(vol * 0.12, t + 0.15); // slow attack
        g.gain.setValueAtTime(vol * 0.12, t + 0.35); // sustain
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); // gentle release

        osc.connect(formant).connect(g).connect(ctx.destination);
        osc.start(); osc.stop(t + 0.75);
      });
    });

    // Layer 2: Upper harmonics — triangle waves an octave up for brightness/shimmer
    // E5, G5 add the major quality (angelic = major chord)
    const upperNotes = [659, 784]; // E5, G5
    upperNotes.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; // Softer harmonics than sine, slightly breathy
      osc.frequency.setValueAtTime(freq, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol * 0.06, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

      osc.connect(g).connect(ctx.destination);
      osc.start(); osc.stop(t + 0.65);
    });

    // Layer 3: Airy breath texture — very soft filtered noise (choir breathiness)
    const breathSrc = ctx.createBufferSource();
    breathSrc.buffer = this.noiseBuffer!;
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.setValueAtTime(1200, t);
    breathFilter.Q.setValueAtTime(0.8, t);
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0.001, t);
    breathGain.gain.linearRampToValueAtTime(vol * 0.025, t + 0.1);
    breathGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    breathSrc.connect(breathFilter).connect(breathGain).connect(ctx.destination);
    breathSrc.start(); breathSrc.stop(t + 0.6);

    // Layer 4: Slow vibrato on the whole choir (natural voice wobble ~5Hz)
    const vibLfo = ctx.createOscillator();
    vibLfo.frequency.setValueAtTime(5, t);
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(3, t); // ±3 Hz pitch wobble
    // Connect to all choir oscillators would be complex, so add a subtle
    // amplitude modulation instead (gives warmth/life)
    const amGain = ctx.createGain();
    amGain.gain.setValueAtTime(vol * 0.015, t);
    vibLfo.connect(amGain);
    vibLfo.start(); vibLfo.stop(t + 0.7);
  }

  /** AoE splash: initial blast + shockwave ring + secondary pops */
  private synthSplashAoE(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Initial blast: white noise burst + sub hit
    this.filteredNoise('lowpass', 4000, 1, vol * 0.35, 0.002, 0.06);
    this.envTone(this.vary(70), 'sine', vol * 0.4, 0.003, 0.25);
    // Shockwave sweep: resonant bandpass noise sweeping down
    const swSrc = ctx.createBufferSource();
    swSrc.buffer = this.noiseBuffer!;
    const swF = ctx.createBiquadFilter();
    swF.type = 'bandpass';
    swF.frequency.setValueAtTime(2500, t + 0.03);
    swF.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    swF.Q.setValueAtTime(5, t);
    const swG = this.envGain(vol * 0.25, 0.005, 0.25);
    swSrc.connect(swF).connect(swG).connect(ctx.destination);
    swSrc.start(); swSrc.stop(t + 0.35);
    // Arcane crackle: secondary pops (small noise bursts scattered)
    for (let i = 0; i < 3; i++) {
      const popDelay = 0.08 + Math.random() * 0.15;
      const popSrc = ctx.createBufferSource();
      popSrc.buffer = this.noiseBuffer!;
      const popF = ctx.createBiquadFilter();
      popF.type = 'bandpass';
      popF.frequency.setValueAtTime(this.vary(1200), t + popDelay);
      popF.Q.setValueAtTime(3, t);
      const popG = ctx.createGain();
      popG.gain.setValueAtTime(0.001, t);
      popG.gain.setValueAtTime(0.001, t + popDelay);
      popG.gain.linearRampToValueAtTime(vol * 0.1, t + popDelay + 0.003);
      popG.gain.exponentialRampToValueAtTime(0.001, t + popDelay + 0.04);
      popSrc.connect(popF).connect(popG).connect(ctx.destination);
      popSrc.start(); popSrc.stop(t + popDelay + 0.06);
    }
  }

  /** Berserker rage: aggressive rising distorted growl with tremolo */
  private synthRage(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const ws = this.distortion();
    // Thick detuned sawtooth stack (3 layers)
    [-60, 0, 55].forEach(detune => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(this.vary(180), t);
      osc.frequency.exponentialRampToValueAtTime(this.vary(600), t + 0.4);
      osc.detune.setValueAtTime(detune, t);
      const g = this.envGain(vol * 0.15, 0.01, 0.45);
      osc.connect(ws);
      ws.connect(g).connect(ctx.destination);
      osc.start(); osc.stop(t + 0.5);
    });
    // Fast tremolo for aggressive jitter
    const tremoloOsc = ctx.createOscillator();
    tremoloOsc.frequency.setValueAtTime(9, t);
    const tremoloG = ctx.createGain();
    tremoloG.gain.setValueAtTime(vol * 0.08, t);
    tremoloG.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    // Noise roar underneath
    this.filteredNoise('bandpass', 1500, 2, vol * 0.15, 0.01, 0.35);
    tremoloOsc.start(); tremoloOsc.stop(t + 0.5);
  }

  /** Assassin strike: silence → razor-sharp blade cut + metallic ring */
  private synthAssassinStrike(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Sharp attack transient: hi-freq noise burst (blade cut)
    this.filteredNoise('highpass', 4000, 2, vol * 0.3, 0.001, 0.03);
    // Metallic blade ring: ring mod of two close sines
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sine'; osc2.type = 'sine';
    osc1.frequency.setValueAtTime(this.vary(1100), t);
    osc2.frequency.setValueAtTime(this.vary(1500), t);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(0, t);
    osc1.connect(modGain);
    osc2.connect(modGain.gain);
    const outG = this.envGain(vol * 0.2, 0.002, 0.12);
    modGain.connect(outG).connect(ctx.destination);
    osc1.start(); osc2.start();
    osc1.stop(t + 0.15); osc2.stop(t + 0.15);
    // Body impact: low thud (dagger landing)
    this.envTone(this.vary(250), 'sine', vol * 0.15, 0.003, 0.08);
    // Descending pitch slice
    this.envTone(this.vary(3000), 'sine', vol * 0.12, 0.001, 0.05, { freqEnd: 600 });
  }

  // ==================== UI Sounds ====================

  /** Unit selected: bright percussive click */
  private synthSelect(vol: number): void {
    this.envTone(this.vary(2200), 'sine', vol * 0.2, 0.001, 0.08);
    this.filteredNoise('highpass', 5000, 1, vol * 0.06, 0.001, 0.015);
  }

  /** Command issued: two-tone confirmation chirp */
  private synthCommand(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.envTone(440, 'sine', vol * 0.15, 0.002, 0.05);
    // Second note slightly delayed and higher
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(580, t + 0.04);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, t);
    g2.gain.setValueAtTime(0.001, t + 0.04);
    g2.gain.linearRampToValueAtTime(vol * 0.15, t + 0.042);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc2.connect(g2).connect(ctx.destination);
    osc2.start(); osc2.stop(t + 0.12);
  }

  /** Build placement: stone/wood knock + brief noise */
  private synthBuild(vol: number): void {
    this.envTone(this.vary(280), 'triangle', vol * 0.2, 0.003, 0.1);
    this.envTone(this.vary(550), 'sine', vol * 0.1, 0.002, 0.06);
    this.filteredNoise('bandpass', 900, 2, vol * 0.15, 0.002, 0.06);
  }

  /** UI click: minimal crisp pop */
  private synthUIClick(vol: number): void {
    this.envTone(this.vary(2800), 'sine', vol * 0.12, 0.001, 0.04);
  }

  /** UI hover: soft, barely-there blip */
  private synthUIHover(vol: number): void {
    this.envTone(this.vary(3200), 'sine', vol * 0.05, 0.001, 0.025);
  }

  /** Queue confirm: crisp ascending two-note chime — "unit accepted" feedback */
  private synthQueueConfirm(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Note 1: short pop (C5)
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(523, t);
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.001, t);
    g1.gain.linearRampToValueAtTime(vol * 0.18, t + 0.005);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o1.connect(g1).connect(ctx.destination);
    o1.start(); o1.stop(t + 0.1);
    // Note 2: bright resolve (E5, slightly delayed)
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(659, t + 0.06);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, t);
    g2.gain.setValueAtTime(0.001, t + 0.06);
    g2.gain.linearRampToValueAtTime(vol * 0.2, t + 0.065);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o2.connect(g2).connect(ctx.destination);
    o2.start(); o2.stop(t + 0.18);
    // Tiny metallic click layer (triangle, high)
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(this.vary(4200), t);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.001, t);
    cg.gain.linearRampToValueAtTime(vol * 0.06, t + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(cg).connect(ctx.destination);
    click.start(); click.stop(t + 0.05);
  }

  /** Queue error: short descending buzz — "can't afford" rejection */
  private synthQueueError(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Buzzy low tone (sawtooth through lowpass)
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.15);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(800, t);
    lpf.Q.setValueAtTime(2, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol * 0.15, t + 0.008);
    g.gain.setValueAtTime(vol * 0.15, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(lpf).connect(g).connect(ctx.destination);
    osc.start(); osc.stop(t + 0.22);
    // Second hit (minor second dissonance — Db below)
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(260, t + 0.04);
    o2.frequency.exponentialRampToValueAtTime(140, t + 0.16);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, t);
    g2.gain.setValueAtTime(0.001, t + 0.04);
    g2.gain.linearRampToValueAtTime(vol * 0.08, t + 0.048);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    const lpf2 = ctx.createBiquadFilter();
    lpf2.type = 'lowpass';
    lpf2.frequency.setValueAtTime(600, t);
    o2.connect(lpf2).connect(g2).connect(ctx.destination);
    o2.start(); o2.stop(t + 0.2);
  }

  /** Craft confirm: anvil-like ting + shimmer — satisfying crafting feedback */
  private synthCraftConfirm(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Metallic strike (high sine with fast decay)
    const strike = ctx.createOscillator();
    strike.type = 'sine';
    strike.frequency.setValueAtTime(this.vary(1800), t);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.001, t);
    sg.gain.linearRampToValueAtTime(vol * 0.2, t + 0.003);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    strike.connect(sg).connect(ctx.destination);
    strike.start(); strike.stop(t + 0.15);
    // Resonant body (triangle, lower)
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(this.vary(880), t);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.001, t);
    bg.gain.linearRampToValueAtTime(vol * 0.12, t + 0.005);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    body.connect(bg).connect(ctx.destination);
    body.start(); body.stop(t + 0.22);
    // Tiny shimmer tail (high sine pair, detuned)
    [2640, 2680].forEach(freq => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.001, t + 0.05);
      g.gain.linearRampToValueAtTime(vol * 0.04, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(t + 0.25);
    });
  }

  /** Battle start: war horn fanfare — 3 layered ascending notes with harmonics */
  private synthBattleStart(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const notes = [
      { freq: 262, start: 0, dur: 0.3 },     // C4
      { freq: 330, start: 0.25, dur: 0.3 },   // E4
      { freq: 392, start: 0.5, dur: 0.5 },    // G4 (held longer)
    ];
    notes.forEach(n => {
      // Fundamental (horn-like triangle wave)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, t + n.start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.001, t + n.start);
      g.gain.linearRampToValueAtTime(vol * 0.3, t + n.start + 0.02);
      g.gain.setValueAtTime(vol * 0.3, t + n.start + n.dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(); osc.stop(t + n.start + n.dur + 0.05);
      // Octave harmonic (softer, adds body)
      const h = ctx.createOscillator();
      h.type = 'sine';
      h.frequency.setValueAtTime(n.freq * 2, t + n.start);
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.001, t);
      hg.gain.setValueAtTime(0.001, t + n.start);
      hg.gain.linearRampToValueAtTime(vol * 0.1, t + n.start + 0.02);
      hg.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);
      h.connect(hg).connect(ctx.destination);
      h.start(); h.stop(t + n.start + n.dur + 0.05);
    });
    // Subtle noise breath texture through the horn
    this.filteredNoise('bandpass', 1200, 1.5, vol * 0.05, 0.01, 0.9);
  }

  /** Level-up: triumphant ascending fanfare — distinct from heal's gentle shimmer.
   *  Quick brass-like stab → major triad arpeggio → bright sparkle tail */
  private synthLevelUp(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Layer 1: Triumphant brass stab — G4 power chord (triangle + sawtooth)
    const stabFreqs = [392, 494, 587]; // G4, B4, D5 — major triad
    stabFreqs.forEach((freq, i) => {
      // Triangle fundamental (warm body)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol * 0.22, t + 0.008);
      g.gain.setValueAtTime(vol * 0.22, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(); osc.stop(t + 0.25);

      // Sawtooth overtone (adds brass edge, softer)
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(freq, t);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(2500, t);
      lpf.Q.setValueAtTime(1, t);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.001, t);
      sg.gain.linearRampToValueAtTime(vol * 0.08, t + 0.008);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      saw.connect(lpf).connect(sg).connect(ctx.destination);
      saw.start(); saw.stop(t + 0.2);
    });

    // Layer 2: Ascending arpeggio — G5→B5→D6→G6 (staggered, bright sines)
    const arpeggioNotes = [784, 988, 1175, 1568]; // G5, B5, D6, G6
    arpeggioNotes.forEach((freq, i) => {
      const delay = 0.12 + i * 0.055;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + delay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.001, t + delay);
      g.gain.linearRampToValueAtTime(vol * (0.15 + i * 0.03), t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(); osc.stop(t + delay + 0.25);
    });

    // Layer 3: Sparkle tail — high sine with tremolo (crowning moment)
    const sparkleStart = 0.32;
    const sparkOsc = ctx.createOscillator();
    sparkOsc.type = 'sine';
    sparkOsc.frequency.setValueAtTime(3136, t + sparkleStart); // G7
    sparkOsc.frequency.exponentialRampToValueAtTime(2093, t + sparkleStart + 0.3); // gentle descent to C7
    const sparkG = ctx.createGain();
    sparkG.gain.setValueAtTime(0.001, t);
    sparkG.gain.setValueAtTime(0.001, t + sparkleStart);
    sparkG.gain.linearRampToValueAtTime(vol * 0.08, t + sparkleStart + 0.01);
    sparkG.gain.exponentialRampToValueAtTime(0.001, t + sparkleStart + 0.3);
    // Tremolo LFO for sparkle
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(8, t);
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(vol * 0.04, t);
    lfo.connect(lfoG).connect(sparkG.gain);
    sparkOsc.connect(sparkG).connect(ctx.destination);
    sparkOsc.start(); lfo.start();
    sparkOsc.stop(t + sparkleStart + 0.35); lfo.stop(t + sparkleStart + 0.35);

    // Layer 4: Sub bass punch for weight (low G2)
    this.envTone(98, 'sine', vol * 0.15, 0.005, 0.2);
  }

  cleanup(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
