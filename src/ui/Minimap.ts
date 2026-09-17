// ============================================
// CUBITOPIA - Minimap (bottom-right overlay)
// ============================================
// Self-contained minimap module. Two stacked canvases:
//   - terrain layer (static, redrawn only on rebuildTerrain)
//   - overlay layer (units / bases / viewport / pings, redrawn in update)
// No THREE dependency — pure DOM + 2D canvas.

export interface MinimapOps {
  getTiles(): Map<string, { terrain: string; elevation: number }> | null; // keyed "q,r"
  getUnits(): Array<{ owner: number; position: { q: number; r: number }; state: string }>;
  getBases(): Array<{ owner: number; position: { q: number; r: number }; destroyed: boolean }>;
  getLocalPlayerIndex(): number;
  getPlayerColorCSS(owner: number): string;   // e.g. '#3498db'
  getCameraTargetWorld(): { x: number; z: number };
  onJumpTo(worldX: number, worldZ: number): void; // user clicked minimap
}

const SIZE = 190;                 // CSS px (square)
const FULL_REDRAW_MS = 250;       // 4 Hz dynamic-layer rebuild
const PING_DURATION_MS = 2500;
const HEX_W = 1.5;                // world units per hex column/row step

const TERRAIN_COLORS: Record<string, string> = {
  plains: '#4a7c3a',
  forest: '#2d5a27',
  jungle: '#1f6b35',
  mountain: '#6b6b6b',
  desert: '#c2a557',
  snow: '#dde7ee',
  water: '#3a6ea5',
  river: '#3a6ea5',
  lake: '#3a6ea5',
  waterfall: '#3a6ea5',
};
const TERRAIN_FALLBACK = '#444';

interface Ping {
  worldX: number;
  worldZ: number;
  start: number; // performance.now() timestamp
}

/** Hex (q,r) → world (x,z). Matches the game's offset-hex layout. */
function hexToWorldXZ(q: number, r: number): { x: number; z: number } {
  return {
    x: q * HEX_W,
    z: r * HEX_W + (q % 2 === 1 ? 0.75 : 0),
  };
}

export class Minimap {
  private ops: MinimapOps;
  private container: HTMLDivElement;
  private terrainCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  /** Offscreen cache of units + bases, rebuilt at 4 Hz. Composited every update. */
  private dynamicCache: HTMLCanvasElement;

  private dpr: number;

  // World→canvas mapping (derived from tiles in rebuildTerrain)
  private hasBounds = false;
  private minX = 0;
  private minZ = 0;
  private scale = 1;      // canvas px (CSS) per world unit
  private offsetX = 0;    // canvas px offset to center the map
  private offsetZ = 0;

  private pings: Ping[] = [];
  private lastFullRedraw = 0;
  private dragging = false;
  private disposed = false;

  // Bound handlers (kept for removeEventListener in dispose)
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;

  constructor(ops: MinimapOps) {
    this.ops = ops;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // --- Container panel (bottom-right, above unit stats panel) ---
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'absolute',
      right: '16px',
      bottom: '230px',
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      background: 'rgba(20,24,32,0.85)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px',
      boxSizing: 'content-box',
      overflow: 'hidden',
      zIndex: '100',
      cursor: 'crosshair',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.terrainCanvas = this.makeCanvas();
    this.overlayCanvas = this.makeCanvas();
    this.container.appendChild(this.terrainCanvas);
    this.container.appendChild(this.overlayCanvas);
    document.body.appendChild(this.container);

    this.dynamicCache = document.createElement('canvas');
    this.dynamicCache.width = SIZE * this.dpr;
    this.dynamicCache.height = SIZE * this.dpr;

    // --- Click / drag to jump camera ---
    this.onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.overlayCanvas.setPointerCapture?.(e.pointerId);
      this.jumpFromEvent(e);
      e.preventDefault();
      e.stopPropagation();
    };
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.jumpFromEvent(e);
      e.preventDefault();
    };
    this.onPointerUp = (e: PointerEvent) => {
      this.dragging = false;
      this.overlayCanvas.releasePointerCapture?.(e.pointerId);
    };
    this.overlayCanvas.addEventListener('pointerdown', this.onPointerDown);
    this.overlayCanvas.addEventListener('pointermove', this.onPointerMove);
    this.overlayCanvas.addEventListener('pointerup', this.onPointerUp);
    this.overlayCanvas.addEventListener('pointercancel', this.onPointerUp);

    this.rebuildTerrain();
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  setVisible(v: boolean): void {
    this.container.style.display = v ? 'block' : 'none';
  }

  /** Call ~every frame. Full dynamic redraw throttled to 4 Hz; viewport + pings every call. */
  update(): void {
    if (this.disposed || !this.hasBounds) return;
    const now = performance.now();

    if (now - this.lastFullRedraw >= FULL_REDRAW_MS) {
      this.lastFullRedraw = now;
      this.redrawDynamicCache();
    }

    // Cheap composite every call: cached units/bases + live viewport + pings
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    ctx.drawImage(this.dynamicCache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawViewport(ctx);
    this.drawPings(ctx, now);
  }

  /** Rebuild terrain layer (call on new map). */
  rebuildTerrain(): void {
    if (this.disposed) return;
    const tiles = this.ops.getTiles();
    const tctx = this.terrainCanvas.getContext('2d');
    if (!tctx) return;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, this.terrainCanvas.width, this.terrainCanvas.height);

    if (!tiles || tiles.size === 0) {
      this.hasBounds = false;
      return;
    }

    // Derive world bounds from tiles (+1 hex padding)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const key of tiles.keys()) {
      const [q, r] = key.split(',').map(Number);
      if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
      const w = hexToWorldXZ(q, r);
      if (w.x < minX) minX = w.x;
      if (w.x > maxX) maxX = w.x;
      if (w.z < minZ) minZ = w.z;
      if (w.z > maxZ) maxZ = w.z;
    }
    if (!Number.isFinite(minX)) {
      this.hasBounds = false;
      return;
    }
    minX -= HEX_W; maxX += HEX_W;
    minZ -= HEX_W; maxZ += HEX_W;

    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    this.scale = Math.min(SIZE / spanX, SIZE / spanZ);
    this.minX = minX;
    this.minZ = minZ;
    this.offsetX = (SIZE - spanX * this.scale) / 2;
    this.offsetZ = (SIZE - spanZ * this.scale) / 2;
    this.hasBounds = true;

    // Draw tiles as small filled squares (slightly darkened by elevation)
    tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cell = Math.max(2, this.scale * HEX_W + 0.5);
    for (const [key, tile] of tiles) {
      const [q, r] = key.split(',').map(Number);
      if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
      const w = hexToWorldXZ(q, r);
      const p = this.worldToCanvas(w.x, w.z);
      tctx.fillStyle = this.terrainColor(tile.terrain, tile.elevation);
      tctx.fillRect(p.x - cell / 2, p.y - cell / 2, cell, cell);
    }

    // Force dynamic layer rebuild on next update
    this.lastFullRedraw = 0;
  }

  /** Flash an attack ping at a hex for ~2.5s (expanding red ring). */
  ping(q: number, r: number): void {
    const w = hexToWorldXZ(q, r);
    this.pings.push({ worldX: w.x, worldZ: w.z, start: performance.now() });
    // Cap stored pings to avoid unbounded growth under heavy spam
    if (this.pings.length > 24) this.pings.splice(0, this.pings.length - 24);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlayCanvas.removeEventListener('pointerdown', this.onPointerDown);
    this.overlayCanvas.removeEventListener('pointermove', this.onPointerMove);
    this.overlayCanvas.removeEventListener('pointerup', this.onPointerUp);
    this.overlayCanvas.removeEventListener('pointercancel', this.onPointerUp);
    this.container.remove();
    this.pings.length = 0;
  }

  // ──────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────

  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = SIZE * this.dpr;
    c.height = SIZE * this.dpr;
    Object.assign(c.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${SIZE}px`,
      height: `${SIZE}px`,
    } as Partial<CSSStyleDeclaration>);
    return c;
  }

  private terrainColor(terrain: string, elevation: number): string {
    const base = TERRAIN_COLORS[terrain] ?? TERRAIN_FALLBACK;
    // Slightly darken with elevation (clamped, subtle)
    const darken = Math.min(Math.max(elevation, 0), 8) * 0.025;
    if (darken <= 0) return base;
    const n = parseInt(base.slice(1), 16);
    if (Number.isNaN(n)) return base;
    const f = 1 - darken;
    const rr = Math.round(((n >> 16) & 0xff) * f);
    const gg = Math.round(((n >> 8) & 0xff) * f);
    const bb = Math.round((n & 0xff) * f);
    return `rgb(${rr},${gg},${bb})`;
  }

  private worldToCanvas(x: number, z: number): { x: number; y: number } {
    return {
      x: this.offsetX + (x - this.minX) * this.scale,
      y: this.offsetZ + (z - this.minZ) * this.scale,
    };
  }

  private canvasToWorld(px: number, py: number): { x: number; z: number } {
    return {
      x: this.minX + (px - this.offsetX) / this.scale,
      z: this.minZ + (py - this.offsetZ) / this.scale,
    };
  }

  private jumpFromEvent(e: PointerEvent): void {
    if (!this.hasBounds) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - rect.left, 0), SIZE);
    const py = Math.min(Math.max(e.clientY - rect.top, 0), SIZE);
    const w = this.canvasToWorld(px, py);
    this.ops.onJumpTo(w.x, w.z);
  }

  /** Rebuild the cached units + bases layer (4 Hz). */
  private redrawDynamicCache(): void {
    const ctx = this.dynamicCache.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dynamicCache.width, this.dynamicCache.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Units: 2px squares in owner color
    const units = this.ops.getUnits();
    for (const u of units) {
      if (u.state === 'dead') continue;
      const w = hexToWorldXZ(u.position.q, u.position.r);
      const p = this.worldToCanvas(w.x, w.z);
      ctx.fillStyle = this.ownerColor(u.owner);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }

    // Bases: 5px diamonds with white outline
    const bases = this.ops.getBases();
    for (const b of bases) {
      if (b.destroyed) continue;
      const w = hexToWorldXZ(b.position.q, b.position.r);
      const p = this.worldToCanvas(w.x, w.z);
      const s = 3.5; // half-diagonal of the diamond (~5px wide overall + outline)
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      ctx.fillStyle = this.ownerColor(b.owner);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  private ownerColor(owner: number): string {
    if (owner === 4) return '#999'; // neutral
    try {
      return this.ops.getPlayerColorCSS(owner) || '#999';
    } catch {
      return '#999';
    }
  }

  /** White rect + crosshair at the camera target position (drawn every update). */
  private drawViewport(ctx: CanvasRenderingContext2D): void {
    const cam = this.ops.getCameraTargetWorld();
    if (!cam) return;
    const p = this.worldToCanvas(cam.x, cam.z);
    const half = 9;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - half, p.y - half * 0.7, half * 2, half * 1.4);
    // Small center cross
    ctx.beginPath();
    ctx.moveTo(p.x - 3, p.y);
    ctx.lineTo(p.x + 3, p.y);
    ctx.moveTo(p.x, p.y - 3);
    ctx.lineTo(p.x, p.y + 3);
    ctx.stroke();
  }

  /** Expanding red rings, ~2.5s lifetime. */
  private drawPings(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.pings.length === 0) return;
    this.pings = this.pings.filter((p) => now - p.start < PING_DURATION_MS);
    for (const ping of this.pings) {
      const t = (now - ping.start) / PING_DURATION_MS; // 0..1
      // Two staggered ring pulses for a sonar feel
      const pulse = (t * 2.5) % 1;
      const radius = 2 + pulse * 14;
      const alpha = (1 - pulse) * (1 - t * 0.5);
      const p = this.worldToCanvas(ping.worldX, ping.worldZ);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(231,60,50,${Math.max(alpha, 0).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
