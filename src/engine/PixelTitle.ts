/**
 * PixelTitle — Canvas-based pixel art title "CUBITOPIA"
 *
 * Renders the game title as chunky voxel-style pixel letters with:
 * - Block-based letterforms (each pixel = a 3D-styled cube)
 * - Game-themed decorations: swords, shields, crystals
 * - Animated shimmer/sparkle effect
 * - Drop shadow and edge highlights for depth
 */

// ═══════════════════════════════════════════════════════════
// PIXEL FONT — 5x7 bitmap for each letter (1 = filled block)
// Each letter is a string of '01' rows separated by commas
// ═══════════════════════════════════════════════════════════

const PIXEL_FONT: Record<string, number[][]> = {
  C: [
    [0,1,1,1,0],
    [1,1,0,0,1],
    [1,1,0,0,0],
    [1,1,0,0,0],
    [1,1,0,0,0],
    [1,1,0,0,1],
    [0,1,1,1,0],
  ],
  U: [
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [0,1,1,1,0],
  ],
  B: [
    [1,1,1,1,0],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,1,1,0],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,1,1,0],
  ],
  I: [
    [1,1,1,1,1],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [1,1,1,1,1],
  ],
  T: [
    [1,1,1,1,1],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
  ],
  O: [
    [0,1,1,1,0],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [0,1,1,1,0],
  ],
  P: [
    [1,1,1,1,0],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,1,1,0],
    [1,1,0,0,0],
    [1,1,0,0,0],
    [1,1,0,0,0],
  ],
  A: [
    [0,1,1,1,0],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,1,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
    [1,1,0,1,1],
  ],
};

// ═══════════════════════════════════════════════════════════
// COLOR PALETTE
// ═══════════════════════════════════════════════════════════

const PALETTE = {
  // Letter block colors — gradient from gold to blue
  letterColors: [
    '#FFD700', '#FFC125', '#FFB733', '#FFAA00', '#FF9944',  // C-U-B-I-T
    '#66BBFF', '#4499DD', '#3377CC', '#5588DD',              // O-P-I-A
  ],
  highlight: '#FFFFFF',       // Top-left highlight on each cube
  shadow: '#1a1a3a',          // Bottom-right shadow
  faceShadow: '#00000044',    // Right face of cube
  faceTop: '#FFFFFF33',       // Top face of cube
  outline: '#0a0a20',         // Dark outline around letters
  // Decoration colors
  swordBlade: '#C0C0C0',
  swordHilt: '#8B4513',
  swordGem: '#FF0044',
  shieldBase: '#3366AA',
  shieldBorder: '#FFD700',
  crystalCore: '#AA44FF',
  crystalGlow: '#DD88FF',
};

// ═══════════════════════════════════════════════════════════
// DECORATION SPRITES (drawn procedurally)
// ═══════════════════════════════════════════════════════════

function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const s = scale;

  // ─── BLADE — thick, imposing double-edged greatsword ───
  // Blade outline (dark edge)
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(-2.5 * s, -22 * s, 5 * s, 28 * s);
  // Main blade body — polished steel
  ctx.fillStyle = PALETTE.swordBlade;
  ctx.fillRect(-2 * s, -21 * s, 4 * s, 27 * s);
  // Central fuller (groove down middle of blade)
  ctx.fillStyle = '#A0A8B8';
  ctx.fillRect(-0.5 * s, -18 * s, 1 * s, 22 * s);
  // Left edge highlight — catches light
  ctx.fillStyle = '#FFFFFF88';
  ctx.fillRect(-2 * s, -21 * s, 1 * s, 27 * s);
  // Right edge shadow
  ctx.fillStyle = '#88889944';
  ctx.fillRect(1 * s, -21 * s, 1 * s, 27 * s);
  // Blade tip — pointed triangle
  ctx.fillStyle = PALETTE.swordBlade;
  ctx.beginPath();
  ctx.moveTo(0, -25 * s);
  ctx.lineTo(-2 * s, -21 * s);
  ctx.lineTo(2 * s, -21 * s);
  ctx.closePath();
  ctx.fill();
  // Tip highlight
  ctx.fillStyle = '#FFFFFF66';
  ctx.beginPath();
  ctx.moveTo(0, -25 * s);
  ctx.lineTo(-2 * s, -21 * s);
  ctx.lineTo(0, -21 * s);
  ctx.closePath();
  ctx.fill();

  // ─── CROSSGUARD — ornate, wide, with curled ends ───
  // Main guard bar — thick and wide
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(-7 * s, 5 * s, 14 * s, 3 * s);
  // Gold top edge
  ctx.fillStyle = PALETTE.shieldBorder;
  ctx.fillRect(-7 * s, 5 * s, 14 * s, 1 * s);
  // Curled ends (round terminals)
  for (const dx of [-1, 1]) {
    ctx.fillStyle = '#8B6914';
    ctx.beginPath();
    ctx.arc(dx * 7 * s, 6.5 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
    // Gold highlight on ball
    ctx.fillStyle = PALETTE.shieldBorder;
    ctx.beginPath();
    ctx.arc(dx * 7 * s - 0.3 * s, 6 * s, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Center guard gem mount
  ctx.fillStyle = '#5C4400';
  ctx.fillRect(-1.5 * s, 4.5 * s, 3 * s, 4 * s);
  // Guard gem
  ctx.fillStyle = PALETTE.swordGem;
  ctx.beginPath();
  ctx.arc(0, 6.5 * s, 1.2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FF446688';
  ctx.beginPath();
  ctx.arc(0, 6.5 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();

  // ─── GRIP — leather-wrapped with rings ───
  ctx.fillStyle = '#4A3520';
  ctx.fillRect(-1.5 * s, 8 * s, 3 * s, 8 * s);
  // Leather wrap lines
  ctx.fillStyle = '#5C4430';
  for (let gy = 0; gy < 4; gy++) {
    ctx.fillRect(-1.5 * s, (9 + gy * 2) * s, 3 * s, 0.8 * s);
  }
  // Gold rings on grip
  ctx.fillStyle = PALETTE.shieldBorder;
  ctx.fillRect(-2 * s, 8 * s, 4 * s, 0.8 * s);
  ctx.fillRect(-2 * s, 15 * s, 4 * s, 0.8 * s);

  // ─── POMMEL — large ornate sphere ───
  ctx.fillStyle = '#8B6914';
  ctx.beginPath();
  ctx.arc(0, 18 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();
  // Pommel highlight
  ctx.fillStyle = PALETTE.shieldBorder;
  ctx.beginPath();
  ctx.arc(-0.5 * s, 17 * s, 1.2 * s, 0, Math.PI * 2);
  ctx.fill();
  // Pommel gem
  ctx.fillStyle = PALETTE.swordGem;
  ctx.beginPath();
  ctx.arc(0, 18 * s, 1 * s, 0, Math.PI * 2);
  ctx.fill();
  // Gem glow
  ctx.fillStyle = '#FF004444';
  ctx.beginPath();
  ctx.arc(0, 18 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  const s = scale;

  // ─── HERALDIC SHIELD — ornate coat of arms ───
  // Shield shape: classic pointed heater shield, larger and more detailed
  const shieldPath = () => {
    ctx.beginPath();
    ctx.moveTo(0, -12 * s);              // top center
    ctx.lineTo(10 * s, -10 * s);         // top right
    ctx.lineTo(11 * s, -6 * s);          // upper right
    ctx.lineTo(10 * s, 2 * s);           // mid right
    ctx.quadraticCurveTo(8 * s, 10 * s, 0, 14 * s); // lower right curve to point
    ctx.quadraticCurveTo(-8 * s, 10 * s, -10 * s, 2 * s); // lower left curve
    ctx.lineTo(-11 * s, -6 * s);         // upper left
    ctx.lineTo(-10 * s, -10 * s);        // top left
    ctx.closePath();
  };

  // Outer border (thick gold frame)
  shieldPath();
  ctx.fillStyle = '#8B6914';
  ctx.fill();

  // Inner shield body (slightly inset)
  ctx.save();
  ctx.scale(0.88, 0.88);
  shieldPath();
  ctx.fillStyle = PALETTE.shieldBase;
  ctx.fill();
  ctx.restore();

  // ─── QUARTERED FIELD — classic heraldic division ───
  // Vertical divider
  ctx.fillStyle = PALETTE.shieldBorder;
  ctx.fillRect(-0.8 * s, -9 * s, 1.6 * s, 20 * s);
  // Horizontal divider
  ctx.fillRect(-8 * s, -1.5 * s, 16 * s, 1.6 * s);

  // Quarter 1 (top-left): darker blue
  ctx.fillStyle = '#1a3d6e';
  ctx.fillRect(-8 * s, -9 * s, 7 * s, 7 * s);
  // Quarter 4 (bottom-right): darker blue
  ctx.fillRect(1 * s, 0.5 * s, 7 * s, 7 * s);

  // ─── CENTRAL CREST — lion/crown motif (simplified pixel style) ───
  // Crown at top center
  ctx.fillStyle = PALETTE.shieldBorder;
  // Crown base
  ctx.fillRect(-3 * s, -7 * s, 6 * s, 2.5 * s);
  // Crown points
  for (const cx of [-2.2, 0, 2.2]) {
    ctx.fillRect((cx - 0.6) * s, -9 * s, 1.2 * s, 2.5 * s);
  }
  // Crown gems
  ctx.fillStyle = PALETTE.swordGem;
  for (const cx of [-2.2, 0, 2.2]) {
    ctx.beginPath();
    ctx.arc(cx * s, -8 * s, 0.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rampant lion body (simplified blocky)
  ctx.fillStyle = PALETTE.shieldBorder;
  // Torso
  ctx.fillRect(-2 * s, -4 * s, 4 * s, 5 * s);
  // Head
  ctx.fillRect(-1.5 * s, -5.5 * s, 3 * s, 2.5 * s);
  // Forelegs raised
  ctx.fillRect(-3.5 * s, -3 * s, 1.5 * s, 4 * s);
  ctx.fillRect(2 * s, -3 * s, 1.5 * s, 4 * s);
  // Hind legs
  ctx.fillRect(-2.5 * s, 1 * s, 1.5 * s, 3 * s);
  ctx.fillRect(1 * s, 1 * s, 1.5 * s, 3 * s);
  // Tail
  ctx.fillRect(2.5 * s, -4 * s, 1 * s, 2 * s);
  ctx.fillRect(3 * s, -5.5 * s, 1 * s, 2 * s);

  // ─── ORNATE BORDER — gold embossing with rivets ───
  // Outer gold rim
  shieldPath();
  ctx.strokeStyle = PALETTE.shieldBorder;
  ctx.lineWidth = 2.5 * s;
  ctx.stroke();

  // Inner highlight rim
  ctx.save();
  ctx.scale(0.92, 0.92);
  shieldPath();
  ctx.strokeStyle = '#FFE066';
  ctx.lineWidth = 0.8 * s;
  ctx.stroke();
  ctx.restore();

  // Gold rivets around border
  ctx.fillStyle = PALETTE.shieldBorder;
  const rivetPositions = [
    [0, -11.5], [6, -9], [9, -5], [9.5, 1], [7, 7], [3, 11],
    [-6, -9], [-9, -5], [-9.5, 1], [-7, 7], [-3, 11],
  ];
  for (const [rx, ry] of rivetPositions) {
    ctx.beginPath();
    ctx.arc(rx * s, ry * s, 0.7 * s, 0, Math.PI * 2);
    ctx.fill();
    // Rivet highlight
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc((rx - 0.15) * s, (ry - 0.15) * s, 0.3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.shieldBorder;
  }

  // Bottom banner/scroll
  ctx.fillStyle = '#DCC080';
  ctx.fillRect(-6 * s, 10 * s, 12 * s, 3 * s);
  // Banner curl ends
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(dx * 6 * s, 11.5 * s, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Banner shadow line
  ctx.fillStyle = '#B8A060';
  ctx.fillRect(-6 * s, 12 * s, 12 * s, 0.8 * s);

  ctx.restore();
}

function drawCrystal(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  const s = scale;

  // Glow aura
  ctx.fillStyle = PALETTE.crystalGlow + '33';
  ctx.beginPath();
  ctx.arc(0, 0, 8 * s, 0, Math.PI * 2);
  ctx.fill();

  // Crystal body (hexagonal prism approximation)
  ctx.fillStyle = PALETTE.crystalCore;
  ctx.beginPath();
  ctx.moveTo(0, -8 * s);
  ctx.lineTo(4 * s, -3 * s);
  ctx.lineTo(4 * s, 4 * s);
  ctx.lineTo(0, 8 * s);
  ctx.lineTo(-4 * s, 4 * s);
  ctx.lineTo(-4 * s, -3 * s);
  ctx.closePath();
  ctx.fill();

  // Highlight facet
  ctx.fillStyle = '#FFFFFF55';
  ctx.beginPath();
  ctx.moveTo(0, -8 * s);
  ctx.lineTo(4 * s, -3 * s);
  ctx.lineTo(2 * s, 3 * s);
  ctx.lineTo(0, -2 * s);
  ctx.closePath();
  ctx.fill();

  // Inner glow
  ctx.fillStyle = '#FFFFFF44';
  ctx.fillRect(-1 * s, -4 * s, 2 * s, 6 * s);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// SPARKLE ANIMATION STATE
// ═══════════════════════════════════════════════════════════

interface Sparkle {
  x: number;
  y: number;
  phase: number;
  speed: number;
  size: number;
}

// ═══════════════════════════════════════════════════════════
// MAIN RENDERER
// ═══════════════════════════════════════════════════════════

export class PixelTitle {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sparkles: Sparkle[] = [];
  private animFrame = 0;
  private _raf = 0;

  /** Pixel size of each "block" in the font grid */
  private blockSize: number;
  /** Total pixel width of the rendered title */
  private totalWidth: number;
  /** Total pixel height of the rendered title */
  private totalHeight: number;
  /** Left offset to center the title */
  private offsetX: number;
  /** Top offset */
  private offsetY: number;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;

    // Compute layout
    const text = 'CUBITOPIA';
    const letterWidth = 5;
    const letterSpacing = 1; // blocks between letters
    const totalLetterBlocks = text.length * letterWidth + (text.length - 1) * letterSpacing;

    // Target ~600px wide for the title
    this.blockSize = Math.max(6, Math.floor(600 / totalLetterBlocks));
    const bs = this.blockSize;

    // Canvas dimensions with room for decorations (extra margin for imposing swords)
    const decoMargin = bs * 12; // wider margin for large swords + crystals
    this.totalWidth = totalLetterBlocks * bs + decoMargin * 2;
    this.totalHeight = 7 * bs + bs * 14; // letter height + top/bottom deco space (larger shield below)

    this.canvas.width = this.totalWidth;
    this.canvas.height = this.totalHeight;
    this.canvas.style.imageRendering = 'pixelated';

    this.offsetX = decoMargin;
    this.offsetY = bs * 4; // vertical centering offset

    // Create sparkles distributed across the title area
    for (let i = 0; i < 20; i++) {
      this.sparkles.push({
        x: Math.random() * this.totalWidth,
        y: this.offsetY - bs * 2 + Math.random() * (7 * bs + bs * 4),
        phase: Math.random() * Math.PI * 2,
        speed: 1.5 + Math.random() * 2.0,
        size: 1 + Math.random() * 2.5,
      });
    }

    this.render(0);
    this.startAnimation();
  }

  /** Get the canvas element for insertion into DOM */
  getElement(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Stop the animation loop (cleanup) */
  dispose(): void {
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  private startAnimation(): void {
    const loop = (time: number) => {
      this.render(time / 1000);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  private render(time: number): void {
    const ctx = this.ctx;
    const bs = this.blockSize;

    // Clear
    ctx.clearRect(0, 0, this.totalWidth, this.totalHeight);

    const text = 'CUBITOPIA';
    const letterWidth = 5;
    const letterSpacing = 1;

    // ── Draw each letter ──
    let cursorX = this.offsetX;

    for (let li = 0; li < text.length; li++) {
      const ch = text[li];
      const grid = PIXEL_FONT[ch];
      if (!grid) { cursorX += (letterWidth + letterSpacing) * bs; continue; }

      // Pick color for this letter (cycle through palette)
      const baseColor = PALETTE.letterColors[li % PALETTE.letterColors.length];

      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[row].length; col++) {
          if (!grid[row][col]) continue;

          const x = cursorX + col * bs;
          const y = this.offsetY + row * bs;

          // Subtle wave animation — blocks bob up/down
          const wave = Math.sin(time * 2.0 + (li * 0.5) + col * 0.3) * bs * 0.12;

          this.drawVoxelBlock(ctx, x, y + wave, bs, baseColor, time, li, row, col);
        }
      }

      cursorX += (letterWidth + letterSpacing) * bs;
    }

    // ── Draw decorations ──
    const decoScale = bs * 0.35;
    const centerY = this.offsetY + 3.5 * bs;

    // Left sword (angled, pointing up-right) — large imposing greatsword
    drawSword(ctx, this.offsetX - bs * 5, centerY, decoScale, -Math.PI * 0.22);

    // Right sword (angled, pointing up-left, mirrored)
    drawSword(ctx, cursorX + bs * 4, centerY, decoScale, Math.PI * 0.22);

    // Heraldic shield centered below the title (family crest style)
    const shieldX = this.offsetX + (4 * (letterWidth + letterSpacing) + 2) * bs;
    drawShield(ctx, shieldX, this.offsetY + 7 * bs + bs * 3.5, decoScale * 1.1);

    // Crystals flanking the title (moved outward for larger swords)
    drawCrystal(ctx, this.offsetX - bs * 2, this.offsetY - bs * 2, decoScale * 0.8);
    drawCrystal(ctx, cursorX + bs * 1, this.offsetY - bs * 2, decoScale * 0.8);

    // Small crystals between letters (pulsing)
    if (time % 1 < 0.5) {
      const smallScale = decoScale * 0.4;
      drawCrystal(ctx, this.offsetX + (2 * (letterWidth + letterSpacing) + 2.5) * bs, this.offsetY - bs * 0.5, smallScale);
      drawCrystal(ctx, this.offsetX + (6 * (letterWidth + letterSpacing) + 2.5) * bs, this.offsetY - bs * 0.5, smallScale);
    }

    // ── Draw sparkles ──
    for (const sp of this.sparkles) {
      const alpha = (Math.sin(time * sp.speed + sp.phase) + 1) * 0.5;
      if (alpha < 0.2) continue;

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
      const s = sp.size * (0.5 + alpha * 0.5);

      // 4-point star shape
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - s * 2);
      ctx.lineTo(sp.x + s * 0.5, sp.y - s * 0.5);
      ctx.lineTo(sp.x + s * 2, sp.y);
      ctx.lineTo(sp.x + s * 0.5, sp.y + s * 0.5);
      ctx.lineTo(sp.x, sp.y + s * 2);
      ctx.lineTo(sp.x - s * 0.5, sp.y + s * 0.5);
      ctx.lineTo(sp.x - s * 2, sp.y);
      ctx.lineTo(sp.x - s * 0.5, sp.y - s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Draw a single voxel-style block with isometric-ish 3D look.
   */
  private drawVoxelBlock(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    color: string, time: number,
    letterIndex: number, row: number, col: number,
  ): void {
    const depth = size * 0.2; // isometric depth offset

    // ── Drop shadow ──
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + depth * 0.5, y + depth * 0.5, size, size);

    // ── Outline ──
    ctx.fillStyle = PALETTE.outline;
    ctx.fillRect(x - 1, y - 1, size + 2, size + 2);

    // ── Main face ──
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);

    // ── Top face (lighter) ──
    ctx.fillStyle = PALETTE.faceTop;
    ctx.fillRect(x, y, size, size * 0.3);

    // ── Right face (darker) ──
    ctx.fillStyle = PALETTE.faceShadow;
    ctx.fillRect(x + size * 0.7, y, size * 0.3, size);

    // ── Top-left highlight (specular) ──
    const shimmer = (Math.sin(time * 3 + letterIndex * 0.7 + row * 0.4 + col * 0.3) + 1) * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.15 + shimmer})`;
    ctx.fillRect(x + 1, y + 1, size * 0.35, size * 0.35);

    // ── Bottom-right shadow notch ──
    ctx.fillStyle = PALETTE.shadow;
    ctx.fillRect(x + size - 2, y + size - 2, 2, 2);
  }
}
