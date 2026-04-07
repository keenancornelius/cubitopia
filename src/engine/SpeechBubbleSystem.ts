// ============================================
// CUBITOPIA — Speech Bubble System
// Cartoon speech bubbles + Web Speech API voice barks.
// Throttled to feel like occasional flavor, not constant chatter.
// ============================================

import * as THREE from 'three';
import { UnitType } from '../types';
import { getDialogueLine, getPersonality, type DialogueContext } from './UnitDialogue';
import type { UnitMeshGroup } from './UnitRenderer';

// ── Configuration ─────────────────────────────────────────
const BUBBLE_DURATION = 2.5;              // seconds before fade starts
const BUBBLE_FADE_TIME = 0.5;             // seconds to fade out
const BUBBLE_CANVAS_WIDTH = 256;
const BUBBLE_CANVAS_HEIGHT = 80;
const BUBBLE_Y_OFFSET = 1.65;            // above unit (above health bar)
const BUBBLE_Y_OFFSET_LARGE = 2.8;       // for ogre/trebuchet
const BUBBLE_SCALE = 1.2;
const BUBBLE_BOUNCE_AMPLITUDE = 0.04;    // gentle float
const BUBBLE_BOUNCE_SPEED = 3;           // oscillation Hz

// Throttle settings — keeps speech as occasional flavor
const COMMAND_BARK_CHANCE = 0.2;          // 1 in 5 commands trigger bark
const COMBAT_BARK_COOLDOWN = 4000;        // ms between combat barks per unit
const GLOBAL_BARK_COOLDOWN = 1500;        // ms between any bark globally
const SELECT_BARK_CHANCE = 0.3;           // 1 in ~3 selections
const IDLE_BARK_INTERVAL = 15000;         // how long before idle bark triggers
const MAX_ACTIVE_BUBBLES = 4;             // max simultaneous bubbles on screen

// ── Types ─────────────────────────────────────────────────
interface ActiveBubble {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  unitId: string;
  startTime: number;
  duration: number;
  baseY: number;
}

const LARGE_UNITS = new Set<UnitType>([UnitType.OGRE, UnitType.TREBUCHET]);

// ── System ────────────────────────────────────────────────
export class SpeechBubbleSystem {
  private readonly scene: THREE.Scene;
  private readonly getUnitMeshesRef: () => Map<string, UnitMeshGroup>;
  private activeBubbles: ActiveBubble[] = [];
  private perUnitCooldowns: Map<string, number> = new Map();  // unitId → timestamp
  private lastGlobalBark = 0;
  private ttsEnabled = false;  // Disabled — browser TTS cancel+speak causes audio static pops
  private speechVolume = 0.3;

  constructor(
    scene: THREE.Scene,
    deps: { getUnitMeshes: () => Map<string, UnitMeshGroup> },
  ) {
    this.scene = scene;
    this.getUnitMeshesRef = deps.getUnitMeshes;
  }

  private get unitMeshes(): Map<string, UnitMeshGroup> {
    return this.getUnitMeshesRef();
  }

  // ── Public API ────────────────────────────────────────

  /** Attempt to trigger a speech bubble + TTS bark for a unit.
   *  Respects throttle rates — may silently skip if on cooldown. */
  trigger(unitId: string, unitType: UnitType, context: DialogueContext): void {
    // Check global cooldown
    const now = performance.now();
    if (now - this.lastGlobalBark < GLOBAL_BARK_COOLDOWN) return;

    // Check max active bubbles
    if (this.activeBubbles.length >= MAX_ACTIVE_BUBBLES) return;

    // Check per-unit cooldown (combat contexts)
    if (context === 'attack' || context === 'attacked' || context === 'kill') {
      const lastBark = this.perUnitCooldowns.get(unitId) ?? 0;
      if (now - lastBark < COMBAT_BARK_COOLDOWN) return;
    }

    // Probability gate
    if (!this.shouldBark(context)) return;

    // Check unit exists
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    // Remove any existing bubble for this unit
    this.removeBubbleForUnit(unitId);

    // Get line
    const line = getDialogueLine(unitType, context);

    // Create visual bubble
    this.createBubble(entry, unitId, unitType, line);

    // TTS voice bark
    if (this.ttsEnabled) {
      this.speakLine(line, unitType);
    }

    // Update cooldowns
    this.lastGlobalBark = now;
    this.perUnitCooldowns.set(unitId, now);
  }

  /** Call every frame to animate bubbles (float + fade). */
  update(time: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.activeBubbles.length; i++) {
      const bubble = this.activeBubbles[i];
      // Lazy-init startTime on first update tick so it uses the same clock as `time`
      if (bubble.startTime < 0) bubble.startTime = time;
      const elapsed = time - bubble.startTime;

      // Check if unit still exists
      const entry = this.unitMeshes.get(bubble.unitId);
      if (!entry) {
        toRemove.push(i);
        continue;
      }

      // Expired?
      if (elapsed > bubble.duration + BUBBLE_FADE_TIME) {
        toRemove.push(i);
        continue;
      }

      // Bounce animation
      const bounce = Math.sin(time * BUBBLE_BOUNCE_SPEED) * BUBBLE_BOUNCE_AMPLITUDE;
      bubble.sprite.position.y = bubble.baseY + bounce;

      // Fade out in final phase
      if (elapsed > bubble.duration) {
        const fadeProgress = (elapsed - bubble.duration) / BUBBLE_FADE_TIME;
        bubble.material.opacity = 1 - fadeProgress;
      }

      // Pop-in scale animation (first 0.15s)
      if (elapsed >= 0 && elapsed < 0.15) {
        const popScale = 0.5 + 0.5 * Math.min(elapsed / 0.15, 1);
        // Overshoot bounce
        const overshoot = elapsed < 0.1 ? 1 + 0.2 * (elapsed / 0.1) : 1.2 - 0.2 * ((elapsed - 0.1) / 0.05);
        const s = Math.min(BUBBLE_SCALE * popScale * overshoot, BUBBLE_SCALE * 1.5);  // Safety clamp
        bubble.sprite.scale.set(s, s * (BUBBLE_CANVAS_HEIGHT / BUBBLE_CANVAS_WIDTH), 1);
      }
    }

    // Remove expired bubbles in reverse order
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.destroyBubble(toRemove[i]);
    }
  }

  /** Enable/disable TTS voice output. Bubbles still show. */
  setTTSEnabled(enabled: boolean): void {
    this.ttsEnabled = enabled;
    if (!enabled) {
      window.speechSynthesis?.cancel();
    }
  }

  /** Set speech volume (0–1). */
  setSpeechVolume(vol: number): void {
    this.speechVolume = Math.max(0, Math.min(1, vol));
  }

  /** Clean up all active bubbles. */
  cleanup(): void {
    for (let i = this.activeBubbles.length - 1; i >= 0; i--) {
      this.destroyBubble(i);
    }
    this.perUnitCooldowns.clear();
    window.speechSynthesis?.cancel();
  }

  // ── Private: Probability gate ─────────────────────────

  private shouldBark(context: DialogueContext): boolean {
    switch (context) {
      case 'command':   return Math.random() < COMMAND_BARK_CHANCE;
      case 'select':    return Math.random() < SELECT_BARK_CHANCE;
      case 'attack':    return Math.random() < 0.15;
      case 'attacked':  return Math.random() < 0.1;
      case 'kill':      return Math.random() < 0.25;
      case 'death':     return Math.random() < 0.5;  // Deaths are important, show more often
      case 'level_up':  return true;                   // Always show level-up bark
      case 'idle':      return Math.random() < 0.3;
      default:          return Math.random() < 0.15;
    }
  }

  // ── Private: Visual bubble ────────────────────────────

  private createBubble(entry: UnitMeshGroup, unitId: string, unitType: UnitType, text: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = BUBBLE_CANVAS_WIDTH;
    canvas.height = BUBBLE_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d')!;

    // Draw the cartoon speech bubble
    this.drawBubble(ctx, text);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      opacity: 1,
    });

    const sprite = new THREE.Sprite(material);
    const isLarge = LARGE_UNITS.has(unitType);
    const yOff = isLarge ? BUBBLE_Y_OFFSET_LARGE : BUBBLE_Y_OFFSET;
    sprite.position.y = yOff;
    sprite.scale.set(
      BUBBLE_SCALE,
      BUBBLE_SCALE * (BUBBLE_CANVAS_HEIGHT / BUBBLE_CANVAS_WIDTH),
      1,
    );
    sprite.renderOrder = 1000;  // Above health bars (999)

    // Add to unit's group so it follows automatically
    entry.group.add(sprite);

    this.activeBubbles.push({
      sprite,
      material,
      canvas,
      ctx,
      texture,
      unitId,
      startTime: -1,  // set on first update() tick to match game clock
      duration: BUBBLE_DURATION,
      baseY: yOff,
    });
  }

  private drawBubble(ctx: CanvasRenderingContext2D, text: string): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const padding = 12;
    const tailSize = 10;
    const bubbleH = h - tailSize - 4;
    const radius = 14;

    ctx.clearRect(0, 0, w, h);

    // ── Bubble body (rounded rectangle) ──
    ctx.beginPath();
    const x = padding;
    const y = 4;
    const bw = w - padding * 2;
    const bh = bubbleH;

    // Rounded rect path
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + bw - radius, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + radius);
    ctx.lineTo(x + bw, y + bh - radius);
    ctx.quadraticCurveTo(x + bw, y + bh, x + bw - radius, y + bh);
    ctx.lineTo(x + radius, y + bh);
    ctx.quadraticCurveTo(x, y + bh, x, y + bh - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    // Fill — white with slight transparency
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill();

    // Border — thick dark outline for cartoon feel
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ── Tail (pointing down to unit) ──
    const tailX = w / 2;
    const tailY = y + bh;
    ctx.beginPath();
    ctx.moveTo(tailX - 8, tailY - 1);
    ctx.lineTo(tailX, tailY + tailSize);
    ctx.lineTo(tailX + 8, tailY - 1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cover the tail-body seam with a white rect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(tailX - 9, tailY - 3, 18, 4);

    // ── Text ──
    const fontSize = this.fitFontSize(ctx, text, bw - 20, bh - 12);
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap if needed
    const lines = this.wrapText(ctx, text, bw - 24);
    const lineHeight = fontSize * 1.2;
    const totalTextH = lines.length * lineHeight;
    const textStartY = y + (bh - totalTextH) / 2 + lineHeight / 2;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], w / 2, textStartY + i * lineHeight);
    }
  }

  private fitFontSize(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number): number {
    let size = 22;
    while (size > 10) {
      ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
      const lines = this.wrapText(ctx, text, maxW);
      const totalH = lines.length * size * 1.2;
      if (totalH <= maxH) {
        const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width));
        if (maxLineW <= maxW) return size;
      }
      size -= 2;
    }
    return size;
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [text];
  }

  // ── Private: TTS voice bark ───────────────────────────

  private speakLine(text: string, unitType: UnitType): void {
    if (!window.speechSynthesis) return;

    // Cancel any in-progress speech to keep it snappy
    window.speechSynthesis.cancel();

    // Clean text of asterisks and emotes
    const cleanText = text.replace(/\*/g, '').replace(/~+/g, '');
    if (!cleanText.trim()) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const personality = getPersonality(unitType);

    utterance.rate = personality.pitchRate;
    utterance.pitch = personality.pitchShift;
    utterance.volume = Math.min(personality.volume * this.speechVolume * 2, 1);

    // Try to pick a voice — prefer English, and vary by unit personality
    try {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        // Prefer English voices
        const englishVoices = voices.filter(v => v.lang.startsWith('en'));
        if (englishVoices.length > 0) {
          // Pick a varied voice based on unit type hash
          const hash = unitType.charCodeAt(0) + unitType.charCodeAt(unitType.length - 1);
          utterance.voice = englishVoices[hash % englishVoices.length];
        }
      }
    } catch {
      // Voice selection failed — use default
    }

    window.speechSynthesis.speak(utterance);
  }

  // ── Private: Cleanup helpers ──────────────────────────

  private removeBubbleForUnit(unitId: string): void {
    for (let i = this.activeBubbles.length - 1; i >= 0; i--) {
      if (this.activeBubbles[i].unitId === unitId) {
        this.destroyBubble(i);
      }
    }
  }

  private destroyBubble(index: number): void {
    const bubble = this.activeBubbles[index];
    if (!bubble) return;

    // Remove sprite from parent group
    const entry = this.unitMeshes.get(bubble.unitId);
    if (entry) {
      entry.group.remove(bubble.sprite);
    } else {
      // Unit was removed — sprite might still be in scene
      bubble.sprite.removeFromParent();
    }

    // Dispose GPU resources
    bubble.texture.dispose();
    bubble.material.dispose();

    this.activeBubbles.splice(index, 1);
  }
}
