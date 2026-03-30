// ============================================
// CUBITOPIA - Procedural Map Generator
// Valleys, ridges, rivers, fords & choke points
// ============================================

import {
  GameMap,
  Tile,
  HexCoord,
  TerrainType,
  VoxelBlock,
  BlockType,
  ResourceType,
} from '../types';

// Seeded pseudo-random number generator (Mulberry32 — fast, good distribution)
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    // Hash the seed so even consecutive seeds (1, 2, 3…) diverge immediately
    this.seed = seed ^ 0xDEADBEEF;
    // Warm up: discard a few values to mix the state
    this.next(); this.next(); this.next();
  }

  next(): number {
    // Mulberry32: full-period 32-bit PRNG with excellent avalanche
    let t = (this.seed += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t = ((t ^ (t >>> 14)) >>> 0);
    return t / 4294967296;
  }

  nextRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// Simple 2D noise function (value noise)
class SimpleNoise {
  private permutation: number[];

  constructor(seed: number) {
    const rng = new SeededRandom(seed);
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = rng.nextRange(0, i);
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
  }

  noise2D(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.permutation[(this.permutation[xi] + yi) & 255];
    const ab = this.permutation[(this.permutation[xi] + yi + 1) & 255];
    const ba = this.permutation[(this.permutation[(xi + 1) & 255] + yi) & 255];
    const bb = this.permutation[(this.permutation[(xi + 1) & 255] + yi + 1) & 255];

    const x1 = this.lerp(aa / 255, ba / 255, u);
    const x2 = this.lerp(ab / 255, bb / 255, u);

    return this.lerp(x1, x2, v);
  }

  // Fractal Brownian motion — layered noise for more natural terrain
  fbm(x: number, y: number, octaves: number = 4): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    // Golden ratio lacunarity (φ ≈ 1.618) instead of standard 2×
    // produces less regular, more organic patterns because octaves
    // don't land on exact multiples of each other
    const lacunarity = (1 + Math.sqrt(5)) / 2; // φ
    const persistence = 1 / lacunarity;          // 1/φ ≈ 0.618

    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }
}

// Golden ratio constants for natural-feeling distributions
const PHI = (1 + Math.sqrt(5)) / 2;             // φ ≈ 1.6180339887
const PHI_INV = 1 / PHI;                         // 1/φ ≈ 0.6180339887
const GOLDEN_ANGLE = Math.PI * 2 * PHI_INV;      // ≈ 2.3999… rad (≈ 137.5°)
const PHI_SQ = PHI * PHI;                         // φ² ≈ 2.618

export class MapGenerator {
  private rng: SeededRandom;
  private noise: SimpleNoise;
  private noiseB: SimpleNoise; // second noise layer for variety
  private noiseC: SimpleNoise; // third noise layer for fine detail
  private mountainCenters: { q: number; r: number; radius: number; strength: number }[] = [];

  // --- Per-map randomized terrain parameters for variety ---
  private elevScale: number;      // base noise frequency (0.08–0.16)
  private warpStrength: number;   // domain warp intensity (2–6)
  private spiralStrength: number; // golden spiral distortion (0.01–0.08)
  private mountainWeight: number; // mountain ridge contribution (0.15–0.35)
  private valleyWeight: number;   // valley carve depth (0.10–0.30)
  private shelfWeight: number;    // continental shelf contribution (0.10–0.22)
  private coastFalloff: number;   // edge falloff power (1.0–1.6)
  private coastScale: number;     // coastline irregularity (1.8–2.4)
  private moistureScale: number;  // moisture noise frequency (0.09–0.17)
  private noiseOffsetX: number;   // large random offset to shift entire noise space
  private noiseOffsetY: number;

  constructor(seed?: number) {
    const s = seed ?? Math.floor(Math.random() * 999999);
    this.rng = new SeededRandom(s);
    this.noise = new SimpleNoise(s);
    this.noiseB = new SimpleNoise(s + 7919); // offset seed for second layer
    this.noiseC = new SimpleNoise(s + 15731); // third layer for color/detail

    // Randomize terrain shape parameters so each seed produces a distinct map
    this.elevScale = 0.08 + this.rng.next() * 0.08;        // 0.08–0.16
    this.warpStrength = 2 + this.rng.next() * 4;            // 2–6
    this.spiralStrength = 0.01 + this.rng.next() * 0.07;    // 0.01–0.08
    this.mountainWeight = 0.15 + this.rng.next() * 0.20;    // 0.15–0.35
    this.valleyWeight = 0.10 + this.rng.next() * 0.20;      // 0.10–0.30
    this.shelfWeight = 0.10 + this.rng.next() * 0.12;       // 0.10–0.22
    this.coastFalloff = 1.0 + this.rng.next() * 0.6;        // 1.0–1.6
    this.coastScale = 1.8 + this.rng.next() * 0.6;          // 1.8–2.4
    this.moistureScale = 0.09 + this.rng.next() * 0.08;     // 0.09–0.17
    // Large noise-space offset so even similar seeds produce wildly different terrain
    this.noiseOffsetX = this.rng.next() * 10000 - 5000;
    this.noiseOffsetY = this.rng.next() * 10000 - 5000;
  }

  /** Get fine-detail noise value for color variation at a hex coordinate */
  getColorNoise(q: number, r: number): number {
    return this.noiseC.fbm(q * 0.2, r * 0.2, 2);
  }

  generate(width: number, height: number, seed?: number): GameMap {
    const actualSeed = seed ?? Math.floor(this.rng.next() * 999999);
    const tiles = new Map<string, Tile>();

    // === PASS 0: Place mountain biome clusters using golden angle spiral ===
    // The golden angle (≈137.5°) distributes points evenly without clumping —
    // the same pattern sunflowers and pinecones use for optimal packing.
    const numMountains = 3 + Math.floor(this.rng.next() * 4); // 3-6 clusters
    this.mountainCenters = [];
    const centerQ = width / 2;
    const centerR = height / 2;
    const maxSpread = Math.min(width, height) * 0.38; // Stay within map bounds
    const angleOffset = this.rng.next() * Math.PI * 2; // Random starting rotation

    for (let i = 0; i < numMountains; i++) {
      // Golden angle spiral: each point rotates by the golden angle
      // and moves outward proportional to sqrt(index) for even area coverage
      const angle = angleOffset + i * GOLDEN_ANGLE;
      const dist = maxSpread * Math.sqrt((i + 1) / (numMountains + 1));
      // Small random jitter so it's not perfectly mechanical
      const jitterQ = (this.rng.next() - 0.5) * 3;
      const jitterR = (this.rng.next() - 0.5) * 3;
      const mq = Math.floor(centerQ + Math.cos(angle) * dist + jitterQ);
      const mr = Math.floor(centerR + Math.sin(angle) * dist + jitterR);

      // Clamp to map bounds (10% edge buffer)
      const clampedQ = Math.max(Math.floor(width * 0.1), Math.min(Math.floor(width * 0.9), mq));
      const clampedR = Math.max(Math.floor(height * 0.1), Math.min(Math.floor(height * 0.9), mr));

      // Radius and strength use φ-scaled Fibonacci-like progression
      const radius = 4 + (this.rng.next() * PHI + i * PHI_INV) * 2.5; // 4-10, grows subtly
      const strength = 0.15 + this.rng.next() * 0.2;
      this.mountainCenters.push({ q: clampedQ, r: clampedR, radius, strength });
    }

    // === PASS 1: Generate base terrain with elevation, moisture, and temperature ===
    // Base protection zones: guarantee land near where player bases spawn
    const BASE_INSET = 5;
    const midR = Math.floor(height / 2);
    const baseZones = [
      { q: BASE_INSET, r: midR },                    // Player 1
      { q: width - 1 - BASE_INSET, r: midR },        // Player 2
    ];
    const BASE_PROTECT_RADIUS = 7; // tiles around base guaranteed to be land

    const elevationMap = new Map<string, number>();
    const moistureMap = new Map<string, number>();
    const temperatureMap = new Map<string, number>();

    for (let q = 0; q < width; q++) {
      for (let r = 0; r < height; r++) {
        const key = `${q},${r}`;
        let elev = this.generateElevation(q, r, width, height);
        const moist = this.generateMoisture(q, r);
        const temp = this.generateTemperature(q, r, elev, width, height);

        // Boost elevation near base zones so terrain is always solid land
        for (const bz of baseZones) {
          const dq = q - bz.q;
          const dr = r - bz.r;
          const dist = Math.sqrt(dq * dq + dr * dr);
          if (dist < BASE_PROTECT_RADIUS) {
            const t = dist / BASE_PROTECT_RADIUS;
            // Smooth falloff: full boost at center, fading to zero at edge
            const boost = 0.35 * (1 - t * t);
            elev = Math.min(1, elev + boost);
          }
        }

        elevationMap.set(key, elev);
        moistureMap.set(key, moist);
        temperatureMap.set(key, temp);
      }
    }

    // === PASS 1b: Carve walkable mountain passes between bases ===
    // Generate 2-3 winding corridors of lower elevation and moisture
    // so units have natural routes between the two bases without needing
    // to clear massive forest/mountain blocks.
    this.carveMountainPasses(elevationMap, moistureMap, width, height);

    // === PASS 2: Identify lakes in low, enclosed areas ===
    const lakeTiles = this.identifyLakes(elevationMap, width, height);

    // === PASS 3: Carve rivers from high to low ===
    const riverTiles = this.carveRivers(elevationMap, width, height);

    // === PASS 4: Create fords at key river crossings ===
    const fordTiles = this.placeFords(riverTiles, elevationMap, width, height);

    // === PASS 4b: Basin flood fill — water propagates and fills enclosed areas ===
    this.fillBasins(elevationMap, riverTiles, lakeTiles, this._waterfallTiles, width, height);

    // === PASS 5: Generate tiles ===
    for (let q = 0; q < width; q++) {
      for (let r = 0; r < height; r++) {
        const key = `${q},${r}`;
        const coord: HexCoord = { q, r };
        const elev = elevationMap.get(key)!;
        const moist = moistureMap.get(key)!;
        const temp = temperatureMap.get(key)!;
        const isRiver = riverTiles.has(key);
        const isFord = fordTiles.has(key);
        const isLake = lakeTiles.has(key);

        const tile = this.buildTile(coord, elev, moist, temp, isRiver, isFord, isLake, width, height);
        tiles.set(key, tile);
      }
    }

    // === PASS 6: Compute shell blocks using neighbor data ===
    const gameMap: GameMap = { width, height, tiles, seed: actualSeed };
    this.computeShellBlocks(gameMap, width, height);

    // === PASS 6b: Carve lava tubes — underground tunnels connecting map features ===
    this.carveLavaTubes(gameMap, elevationMap, width, height);

    // === PASS 7: Balance resources across both player sides ===
    this.balanceResources(tiles, width, height);

    return gameMap;
  }

  // --- Elevation: continental shelves, mountain ranges, valleys ---
  // Noise frequencies use golden ratio (φ) scaling for harmonious, non-repeating patterns.
  // Layer weights follow Fibonacci proportions (1/φ^n) so no single octave dominates.
  private generateElevation(q: number, r: number, w: number, h: number): number {
    const scale = this.elevScale;
    // Shift into unique noise-space region so similar seeds don't overlap
    const oq = q + this.noiseOffsetX;
    const or = r + this.noiseOffsetY;

    // Domain warping for organic terrain — warp frequencies at φ-scaled intervals
    const warpX = this.noiseB.fbm(oq * scale * PHI_INV + 100, or * scale * PHI_INV + 100, 3) * this.warpStrength;
    const warpZ = this.noise.fbm(oq * scale * PHI_INV + 200, or * scale * PHI_INV + 200, 3) * this.warpStrength;

    // Golden spiral distortion: subtle large-scale swirl centered on map
    const spCx = q - w / 2;
    const spCz = r - h / 2;
    // Rotate coordinates by golden angle scaled by distance — creates spiral arms
    const spiralTwist = Math.sqrt(spCx * spCx + spCz * spCz) * 0.02 * PHI_INV;
    const spiralQ = spCx * Math.cos(spiralTwist) - spCz * Math.sin(spiralTwist);
    const spiralR = spCx * Math.sin(spiralTwist) + spCz * Math.cos(spiralTwist);
    const wq = oq + warpX + spiralQ * this.spiralStrength;
    const wr = or + warpZ + spiralR * this.spiralStrength;

    // Base elevation: continents — frequency at base scale
    const baseElev = this.noise.fbm(wq * scale, wr * scale, 5);

    // Continental shelves — frequency at scale / φ for broader features
    const shelfNoise = this.noiseB.fbm(wq * scale / PHI, wr * scale / PHI, 3);
    const continentalShelf = Math.pow(Math.max(0, shelfNoise - 0.3), 1.2);

    // Mountain ranges — φ-scaled anisotropic ridges at two harmonics
    const ridgeRaw1 = this.noiseB.fbm(wq * scale * PHI_INV * 1.8, wr * scale * PHI_INV * 1.5, 4);
    const ridgeRaw2 = this.noise.fbm(wq * scale * PHI_INV * 1.4, wr * scale * PHI_INV * 2.0, 3);
    const ridge1 = 1 - Math.abs(ridgeRaw1 - 0.5) * 2;
    const ridge2 = 1 - Math.abs(ridgeRaw2 - 0.5) * 2;
    const mountainRanges = Math.max(ridge1 * 0.6, ridge2 * 0.5);

    // Valleys — two perpendicular systems at φ-ratio frequencies
    const valleyNoise = this.noise.fbm(wq * scale * PHI_INV, wr * scale * (PHI_INV * PHI_INV + 0.2), 3);
    const valleyCarve = Math.pow(Math.max(0, 0.5 - Math.abs(valleyNoise - 0.5)), 1.1);
    const valleyNoise2 = this.noiseB.fbm(wq * scale * (PHI_INV * PHI_INV + 0.2), wr * scale * PHI_INV, 3);
    const valleyCarve2 = Math.pow(Math.max(0, 0.5 - Math.abs(valleyNoise2 - 0.5)), 1.1);
    const valleyDepth = Math.max(valleyCarve, valleyCarve2 * PHI_INV);

    // Combine layers with randomized weights for map variety
    let elevation = baseElev * (PHI_INV * PHI_INV);           // ≈ 0.382 (base always present)
    elevation += continentalShelf * this.shelfWeight;
    elevation += mountainRanges * this.mountainWeight;
    elevation -= valleyDepth * this.valleyWeight;

    // Fine detail at φ² frequency for micro-terrain that doesn't alias with larger features
    const detail = this.noise.noise2D(oq * scale * PHI_SQ, or * scale * PHI_SQ) * 0.07;
    elevation += detail;

    // Mountain biome clusters: gaussian-like boost near each center
    for (const mc of this.mountainCenters) {
      const dx = q - mc.q;
      const dy = r - mc.r;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mc.radius * 1.5) {
        // Smooth gaussian falloff from center
        const t = dist / mc.radius;
        const boost = mc.strength * Math.exp(-t * t * 2);
        elevation += boost;
      }
    }

    // Organic edge falloff with irregular coastline (bays and peninsulas)
    const cx = (q - w / 2) / w;
    const cr = (r - h / 2) / h;
    const distFromCenter = Math.sqrt(cx * cx + cr * cr);

    // Create irregular coastline with multiple scales of noise
    const coastlineNoise = this.noise.fbm(oq * 0.25, or * 0.25, 2) * 0.15;
    const falloff = 1 - Math.pow(distFromCenter * this.coastScale + coastlineNoise, this.coastFalloff);

    elevation = elevation * 0.7 + falloff * 0.3;

    return Math.max(0, Math.min(1, elevation));
  }

  private generateMoisture(q: number, r: number): number {
    const scale = this.moistureScale;
    const oq = q + this.noiseOffsetX;
    const or = r + this.noiseOffsetY;

    // Create wet and dry zones — base frequency at scale, detail at scale × φ
    const baseMoisture = this.noiseB.fbm(oq * scale + 50, or * scale + 50, 4);

    // Regional moisture bands using golden-ratio period for non-repeating feel
    const latitudeMoisture = Math.sin(oq * scale * PHI) * 0.4 + 0.5;

    // Local variation at φ-scaled frequency so it doesn't alias with base layer
    const localMoisture = this.noise.fbm(oq * scale * PHI, or * scale * PHI, 2);

    // Fibonacci-weighted blend: base (≈0.5), latitude (≈0.3), local (≈0.2)
    const moisture = baseMoisture * 0.5 + latitudeMoisture * 0.3 + localMoisture * 0.2;
    return Math.max(0, Math.min(1, moisture));
  }

  // --- Temperature based on elevation and latitude ---
  private generateTemperature(q: number, r: number, elevation: number, w: number, h: number): number {
    // Higher elevation = colder
    const elevationCold = (1 - elevation) * 0.6;

    // Latitude-based temperature (pole → equator)
    const centerR = h / 2;
    const distFromEquator = Math.abs(r - centerR) / centerR;
    const latitudeTemp = (1 - distFromEquator) * 0.4;

    // Noise for local variation
    const noiseTemp = this.noiseB.fbm((q + this.noiseOffsetX) * 0.11, (r + this.noiseOffsetY) * 0.11, 2) * 0.1;

    return elevationCold + latitudeTemp + noiseTemp;
  }

  // --- Mountain passes: carve walkable corridors between the two bases ---
  // Creates 2-3 winding passes with lowered elevation and moisture so the
  // terrain generator produces PLAINS instead of FOREST/MOUNTAIN, giving
  // units natural routes across the map.
  private carveMountainPasses(
    elevMap: Map<string, number>,
    moistMap: Map<string, number>,
    w: number,
    h: number,
  ): void {
    const BASE_INSET = 5;

    // Bases are at opposite corners: P1 at (BASE_INSET, h-1-BASE_INSET), P2 at (w-1-BASE_INSET, BASE_INSET)
    const p1Q = BASE_INSET;
    const p1R = h - 1 - BASE_INSET;
    const p2Q = w - 1 - BASE_INSET;
    const p2R = BASE_INSET;

    // Start and end positions (matching base spawn locations)
    const startQ = p1Q;
    const endQ = p2Q;

    // Generate 2-3 passes with slight offsets from the diagonal
    const passCount = 2 + (this.rng.next() > 0.5 ? 1 : 0);
    const passOffsets: number[] = [];

    if (passCount === 2) {
      const spread = Math.floor(h * 0.12);
      passOffsets.push(-spread, spread);
    } else {
      const spread = Math.floor(h * 0.15);
      passOffsets.push(0, -spread, spread);
    }

    for (let p = 0; p < passCount; p++) {
      const offset = passOffsets[p];
      const PASS_WIDTH = 2 + Math.floor(this.rng.next() * 2); // 2-3 tiles wide

      // Walk diagonally from P1 corner to P2 corner, wandering with noise
      const noiseOffset = this.rng.next() * 1000; // unique per pass
      // Interpolate R from p1R to p2R as Q goes from startQ to endQ
      let currentR = p1R + offset;

      for (let q = startQ; q <= endQ; q++) {
        // Base diagonal interpolation
        const t = (q - startQ) / (endQ - startQ);
        const diagonalR = p1R + (p2R - p1R) * t + offset;
        // Wander vertically using noise for organic curves
        const wander = this.noise.noise2D(q * 0.08 + noiseOffset, p * 7.3) - 0.5;
        currentR = diagonalR + wander * 2.5;
        // Keep within map bounds
        currentR = Math.max(PASS_WIDTH + 1, Math.min(h - PASS_WIDTH - 2, currentR));

        const centerR_i = Math.round(currentR);

        // Carve the pass: lower elevation and moisture in a band
        for (let dr = -PASS_WIDTH; dr <= PASS_WIDTH; dr++) {
          const r = centerR_i + dr;
          if (r < 0 || r >= h) continue;
          const key = `${q},${r}`;

          const distFromCenter = Math.abs(dr) / (PASS_WIDTH + 0.5);
          // Smooth falloff: full effect at center, tapering at edges
          const strength = 1 - distFromCenter * distFromCenter;

          // Lower elevation to mid-range (plains territory: 0.32-0.48)
          const currentElev = elevMap.get(key) ?? 0.5;
          const targetElev = 0.36 + this.noise.noise2D(q * 0.15 + noiseOffset, r * 0.15) * 0.06;
          const newElev = currentElev + (targetElev - currentElev) * strength * 0.85;
          elevMap.set(key, Math.max(0.28, Math.min(0.52, newElev)));

          // Lower moisture to push terrain away from forest (< 0.45)
          const currentMoist = moistMap.get(key) ?? 0.5;
          const targetMoist = 0.3 + this.noise.noise2D(q * 0.12 + noiseOffset + 50, r * 0.12) * 0.08;
          const newMoist = currentMoist + (targetMoist - currentMoist) * strength * 0.8;
          moistMap.set(key, Math.max(0.15, Math.min(0.44, newMoist)));
        }
      }
    }
  }

  // --- River carving: rivers spring from snow/mountain peaks and flow downhill ---
  // Water sources at high-elevation snow or mountain tiles, then traces
  // downhill following the elevation gradient. Waterfalls form naturally
  // where elevation drops sharply between river tiles.
  private carveRivers(elevMap: Map<string, number>, w: number, h: number): Set<string> {
    const rivers = new Set<string>();
    const waterfalls = new Set<string>();
    // Track elevation at each river tile for height computation
    this._riverElevations = new Map();

    // === Step 1: Find snow/mountain peak sources ===
    // Collect high-elevation tiles as candidate river sources
    const candidates: { q: number; r: number; elev: number }[] = [];
    const BASE_INSET = 5;
    for (let q = 3; q < w - 3; q++) {
      for (let r = 3; r < h - 3; r++) {
        // Skip tiles near bases
        if (q < BASE_INSET + 5 || q > w - BASE_INSET - 5) continue;
        const elev = elevMap.get(`${q},${r}`) ?? 0;
        if (elev > 0.58) { // High enough to be snow/mountain
          candidates.push({ q, r, elev });
        }
      }
    }

    // Sort by elevation (highest first) and pick 2-4 source peaks
    candidates.sort((a, b) => b.elev - a.elev);
    const sourceCount = Math.min(2 + Math.floor(this.rng.next() * 2), candidates.length);
    const sources: { q: number; r: number; elev: number }[] = [];

    for (let i = 0; i < candidates.length && sources.length < sourceCount; i++) {
      const c = candidates[i];
      // Ensure sources aren't too close to each other
      let tooClose = false;
      for (const s of sources) {
        if (Math.sqrt((c.q - s.q) ** 2 + (c.r - s.r) ** 2) < 10) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) sources.push(c);
    }

    // === Step 2: Trace each river downhill from its source ===
    for (const source of sources) {
      this.traceRiverDownhill(source.q, source.r, elevMap, rivers, waterfalls, w, h);
    }

    this._waterfallTiles = waterfalls;
    return rivers;
  }

  /** Trace a river from a high source downhill, following the gradient.
   *  Marks waterfall tiles where elevation drops sharply. */
  private traceRiverDownhill(
    startQ: number, startR: number,
    elevMap: Map<string, number>,
    rivers: Set<string>, waterfalls: Set<string>,
    w: number, h: number,
  ): void {
    let cq = startQ;
    let cr = startR;
    let prevElev = elevMap.get(`${cq},${cr}`) ?? 0.5;
    const maxSteps = w + h;
    const visited = new Set<string>();

    for (let step = 0; step < maxSteps; step++) {
      const key = `${cq},${cr}`;
      if (visited.has(key)) break;
      visited.add(key);

      const currentElev = elevMap.get(key) ?? 0;

      // Stop if we reach very low elevation (ocean edge)
      if (currentElev < 0.25) break;
      // Stop at map edge
      if (cq <= 1 || cq >= w - 2 || cr <= 1 || cr >= h - 2) break;

      // Mark river tile and its width
      rivers.add(key);
      // Slightly depress elevation for the river channel (but keep it high)
      const depressedElev = currentElev - 0.03;
      elevMap.set(key, Math.max(0.26, depressedElev));
      this._riverElevations.set(key, Math.max(0.26, depressedElev));

      // Look ahead: check if the NEXT tile is a significant drop.
      // If so, THIS tile (the cliff edge) is the waterfall — water spills from here.
      const peekNeighbors = this.hexNeighbors(cq, cr);
      let lowestNeighborElev = currentElev;
      for (const [nq, nr] of peekNeighbors) {
        if (nq < 1 || nq >= w - 1 || nr < 1 || nr >= h - 1) continue;
        const nElev = elevMap.get(`${nq},${nr}`) ?? currentElev;
        if (nElev < lowestNeighborElev) lowestNeighborElev = nElev;
      }
      const dropAhead = currentElev - lowestNeighborElev;
      if (dropAhead > 0.06 && step > 0) {
        waterfalls.add(key);
        // Store the ORIGINAL high elevation for the waterfall tile
        // so buildTile places it at the cliff edge, not the bottom
        this._waterfallElevations.set(key, currentElev);

        // Expand waterfall to neighboring tiles at similar elevation
        // to create a wider, more dramatic waterfall (2-3 tiles wide)
        for (const [nq, nr] of this.hexNeighbors(cq, cr)) {
          if (nq < 1 || nq >= w - 1 || nr < 1 || nr >= h - 1) continue;
          const nKey = `${nq},${nr}`;
          if (waterfalls.has(nKey) || rivers.has(nKey)) continue;
          const nElev = elevMap.get(nKey) ?? 0;
          // Only expand to neighbors at similar high elevation (cliff edge)
          if (Math.abs(nElev - currentElev) < 0.08 && nElev > 0.35) {
            waterfalls.add(nKey);
            this._waterfallElevations.set(nKey, nElev);
          }
        }
      }

      // Widen river by 1 tile on each side (narrower at high elevations)
      if (currentElev < 0.50) {
        for (const [nq, nr] of this.hexNeighbors(cq, cr)) {
          if (nq >= 0 && nq < w && nr >= 0 && nr < h) {
            const nKey = `${nq},${nr}`;
            if (!rivers.has(nKey)) {
              rivers.add(nKey);
              const nElev = elevMap.get(nKey) ?? currentElev;
              const nDepressed = nElev - 0.02;
              elevMap.set(nKey, Math.max(0.26, nDepressed));
              this._riverElevations.set(nKey, Math.max(0.26, nDepressed));
            }
          }
        }
      }

      // Find lowest neighbor to continue flowing downhill
      const neighbors = this.hexNeighbors(cq, cr);
      let lowestElev = currentElev + 0.01; // Must go lower (with slight tolerance)
      let nextQ = cq;
      let nextR = cr;
      let found = false;

      // Shuffle neighbors slightly to add organic variation
      const shuffled = [...neighbors];
      for (let i = shuffled.length - 1; i > 0; i--) {
        if (this.rng.next() > 0.6) {
          const j = Math.floor(this.rng.next() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
      }

      for (const [nq, nr] of shuffled) {
        if (nq < 1 || nq >= w - 1 || nr < 1 || nr >= h - 1) continue;
        if (visited.has(`${nq},${nr}`)) continue;

        const nElev = elevMap.get(`${nq},${nr}`) ?? 0;
        if (nElev < lowestElev) {
          lowestElev = nElev;
          nextQ = nq;
          nextR = nr;
          found = true;
        }
      }

      if (!found || (nextQ === cq && nextR === cr)) {
        // River pools here (no lower neighbor) — could form a small lake
        break;
      }

      prevElev = currentElev;
      cq = nextQ;
      cr = nextR;
    }
  }

  /**
   * Water propagation with basin filling and overflow.
   *
   * Rules:
   * 1. Water group at a given elevation tries to spread LATERALLY to adjacent
   *    open hex tiles at the same or similar elevation.
   * 2. If NO lateral open space exists for the whole group (basin), water rises
   *    to fill, checking higher neighbors until it finds an outlet.
   * 3. Once ONE tile in the group finds an open lateral neighbor, the rest of the
   *    group stops trying to spread — only that outlet tile continues outward.
   * 4. The outlet stream propagates laterally until it hits an elevation DROP,
   *    at which point it flows DOWN.
   * 5. After flowing down, it repeats from rule 1 at the new lower elevation.
   */
  private fillBasins(
    elevMap: Map<string, number>,
    rivers: Set<string>,
    lakes: Set<string>,
    waterfalls: Set<string>,
    w: number, h: number,
  ): void {
    const allWater = new Set<string>([...rivers, ...lakes, ...waterfalls]);
    const MAX_TOTAL = 80; // safety cap on total new water tiles
    let totalAdded = 0;

    const inBounds = (q: number, r: number) => q >= 2 && q < w - 2 && r >= 2 && r < h - 2;

    /** Mark a tile as lake water at a given surface elevation */
    const markWater = (key: string, surfElev: number): boolean => {
      if (allWater.has(key) || totalAdded >= MAX_TOTAL) return false;
      lakes.add(key);
      allWater.add(key);
      // Depress terrain to the water surface level
      const curElev = elevMap.get(key) ?? surfElev;
      elevMap.set(key, Math.max(0.24, Math.min(curElev, surfElev)));
      this._riverElevations.set(key, Math.max(0.24, Math.min(curElev, surfElev)));
      totalAdded++;
      return true;
    };

    /**
     * From a starting water tile, propagate water outward following the rules.
     * Returns when the stream dead-ends or hits the safety cap.
     */
    const propagateFrom = (startQ: number, startR: number, surfaceElev: number, depth: number) => {
      if (depth > 8 || totalAdded >= MAX_TOTAL) return; // prevent infinite recursion

      // PHASE 1: Fill basin at current elevation
      // BFS to find all connected tiles at roughly this elevation (the basin)
      const basinTiles: [number, number][] = [[startQ, startR]];
      const basinVisited = new Set<string>([`${startQ},${startR}`]);
      let basinIdx = 0;

      // Track the best outlet: tile with an open lateral neighbor
      let outletQ = -1, outletR = -1;
      let outletNQ = -1, outletNR = -1;
      let foundOutlet = false;

      // Track the best drop: tile with a significantly lower neighbor
      let dropQ = -1, dropR = -1;
      let dropNQ = -1, dropNR = -1;
      let dropElev = surfaceElev;
      let foundDrop = false;

      while (basinIdx < basinTiles.length) {
        const [bq, br] = basinTiles[basinIdx++];
        const neighbors = this.hexNeighbors(bq, br);

        for (const [nq, nr] of neighbors) {
          if (!inBounds(nq, nr)) continue;
          const nKey = `${nq},${nr}`;
          const nElev = elevMap.get(nKey) ?? 1;

          if (allWater.has(nKey)) {
            // Already water — expand basin search through it
            if (!basinVisited.has(nKey)) {
              basinVisited.add(nKey);
              basinTiles.push([nq, nr]);
            }
            continue;
          }

          // Check for elevation DROP (neighbor significantly lower)
          if (nElev < surfaceElev - 0.04) {
            if (!foundDrop || nElev < dropElev) {
              foundDrop = true;
              dropQ = bq; dropR = br;
              dropNQ = nq; dropNR = nr;
              dropElev = nElev;
            }
            continue;
          }

          // Check for lateral OUTLET (neighbor at similar elevation, open space)
          if (nElev <= surfaceElev + 0.05 && !foundOutlet) {
            foundOutlet = true;
            outletQ = bq; outletR = br;
            outletNQ = nq; outletNR = nr;
            // Don't break — keep scanning in case there's also a drop
          }
        }
      }

      // PHASE 2: Act on what we found

      if (foundDrop) {
        // Water found a drop — flow DOWN to the lower tile, then fill there
        const dropKey = `${dropNQ},${dropNR}`;
        markWater(dropKey, dropElev);

        // Also mark the waterfall edge for curtain rendering
        const srcKey = `${dropQ},${dropR}`;
        if (!waterfalls.has(srcKey) && allWater.has(srcKey)) {
          // Store as a mini-waterfall for curtain rendering
          const srcElev = elevMap.get(srcKey) ?? surfaceElev;
          if (srcElev - dropElev > 0.04) {
            this._waterfallElevations.set(srcKey, srcElev);
          }
        }

        // Recurse: start propagation at the new lower elevation
        propagateFrom(dropNQ, dropNR, dropElev, depth + 1);

      } else if (foundOutlet) {
        // Water found lateral open space — flow OUTWARD through the outlet
        // Only this one tile continues; the rest of the basin stays put
        const outKey = `${outletNQ},${outletNR}`;
        const outElev = elevMap.get(outKey) ?? surfaceElev;
        markWater(outKey, outElev);

        // Continue lateral propagation from the outlet
        propagateFrom(outletNQ, outletNR, outElev, depth + 1);

      } else {
        // No outlet and no drop — enclosed basin
        // Fill up: try to add water to the lowest neighbor above current level
        let lowestAboveElev = 999;
        let laQ = -1, laR = -1;

        for (const [bq, br] of basinTiles) {
          for (const [nq, nr] of this.hexNeighbors(bq, br)) {
            if (!inBounds(nq, nr)) continue;
            const nKey = `${nq},${nr}`;
            if (allWater.has(nKey)) continue;
            const nElev = elevMap.get(nKey) ?? 1;
            if (nElev > surfaceElev + 0.05 && nElev < lowestAboveElev) {
              lowestAboveElev = nElev;
              laQ = nq; laR = nr;
            }
          }
        }

        // If we found a slightly higher neighbor, fill up to it and continue
        if (laQ >= 0 && lowestAboveElev < surfaceElev + 0.15) {
          const riseKey = `${laQ},${laR}`;
          markWater(riseKey, lowestAboveElev);
          // Continue propagation at the new (slightly higher) level
          propagateFrom(laQ, laR, lowestAboveElev, depth + 1);
        }
        // Otherwise: truly enclosed deep basin — water just pools here
      }
    };

    // === Seed propagation from waterfall bases ===
    for (const wfKey of waterfalls) {
      const wfElev = this._waterfallElevations.get(wfKey) ?? elevMap.get(wfKey) ?? 0.5;
      const [wq, wr] = wfKey.split(',').map(Number);

      // Find the low side of the waterfall
      for (const [nq, nr] of this.hexNeighbors(wq, wr)) {
        if (!inBounds(nq, nr)) continue;
        const nKey = `${nq},${nr}`;
        const nElev = elevMap.get(nKey) ?? 1;

        if (nElev < wfElev - 0.06) {
          // Start filling from this low point
          markWater(nKey, nElev);
          propagateFrom(nq, nr, nElev, 0);
          break; // only one outflow per waterfall
        }
      }
    }

    // === Seed propagation from river endpoints (dead-ends) ===
    for (const rKey of rivers) {
      const [rq, rr] = rKey.split(',').map(Number);
      const rElev = elevMap.get(rKey) ?? 0.5;
      const neighbors = this.hexNeighbors(rq, rr);

      // Check if this river tile is a dead-end (no lower non-water neighbor)
      let hasOutflow = false;
      for (const [nq, nr] of neighbors) {
        const nKey = `${nq},${nr}`;
        const nElev = elevMap.get(nKey) ?? 1;
        if ((rivers.has(nKey) || lakes.has(nKey)) && nElev < rElev - 0.01) {
          hasOutflow = true;
          break;
        }
        if (!allWater.has(nKey) && nElev < rElev - 0.02) {
          hasOutflow = true;
          break;
        }
      }

      if (!hasOutflow) {
        propagateFrom(rq, rr, rElev, 0);
      }
    }
  }

  // Waterfall tiles, their original high elevations, and river elevations
  private _waterfallTiles: Set<string> = new Set();
  private _waterfallElevations: Map<string, number> = new Map();
  private _riverElevations: Map<string, number> = new Map();

  private hexNeighbors(q: number, r: number): [number, number][] {
    // Offset hex grid neighbors
    if (q % 2 === 0) {
      return [
        [q - 1, r - 1], [q, r - 1], [q + 1, r - 1],
        [q - 1, r],                  [q + 1, r],
                        [q, r + 1],
      ];
    } else {
      return [
                        [q, r - 1],
        [q - 1, r],                  [q + 1, r],
        [q - 1, r + 1], [q, r + 1], [q + 1, r + 1],
      ];
    }
  }

  // --- Fords: shallow crossings at strategic river points ---
  private placeFords(riverTiles: Set<string>, elevMap: Map<string, number>,
                     w: number, h: number): Set<string> {
    const fords = new Set<string>();
    const midQ = Math.floor(w / 2);

    // Place fords near the center column for strategic gameplay
    for (const key of riverTiles) {
      const [q, r] = key.split(',').map(Number);

      // Fords near the center of the map (where armies clash)
      const distFromCenter = Math.abs(q - midQ);
      if (distFromCenter < 4 && this.rng.next() > 0.6) {
        fords.add(key);
      }

      // Also occasional fords elsewhere for flanking routes
      if (this.rng.next() > 0.85) {
        fords.add(key);
      }
    }

    return fords;
  }

  // --- Build tile from computed values ---
  private buildTile(coord: HexCoord, elevation: number, moisture: number, temperature: number,
                    isRiver: boolean, isFord: boolean, isLake: boolean,
                    mapWidth: number, mapHeight: number): Tile {

    let terrain: TerrainType;

    const key = `${coord.q},${coord.r}`;
    if (this._waterfallTiles.has(key)) {
      terrain = TerrainType.WATERFALL;
    } else if (isRiver && !isFord) {
      terrain = TerrainType.RIVER;
    } else if (isLake) {
      terrain = TerrainType.LAKE;
    } else if (isFord) {
      terrain = TerrainType.RIVER; // Fords are shallow river crossings
    } else {
      terrain = this.terrainFromBiome(elevation, moisture, temperature);
    }

    // Height level — driven by raw elevation for natural terrain variation
    // This creates real mountains and valleys regardless of biome type
    let heightLevel: number;
    if (terrain === TerrainType.WATERFALL) {
      // Waterfalls sit at the HIGH cliff edge where water spills over.
      // Use the original pre-depression elevation so the waterfall
      // is visually at the top of the drop, not the bottom.
      const wfElev = this._waterfallElevations.get(key) ?? elevation;
      const normalizedElev = Math.max(0, Math.min(1, (wfElev - 0.24) / 0.6));
      const curved = Math.pow(normalizedElev, 1.3);
      heightLevel = Math.max(3, 2 + Math.floor(curved * 30));
    } else if (isRiver && !isFord) {
      // Rivers follow natural terrain elevation with a 1-block depression
      // for the channel effect. Water flows visibly downhill from peaks.
      const riverElev = this._riverElevations.get(key) ?? elevation;
      const normalizedElev = Math.max(0, Math.min(1, (riverElev - 0.24) / 0.6));
      const curved = Math.pow(normalizedElev, 1.3);
      heightLevel = Math.max(2, 2 + Math.floor(curved * 30));
      heightLevel = Math.max(1, heightLevel - 1);
    } else if (isFord) {
      // Fords match river elevation for smooth crossing
      const riverElev = this._riverElevations.get(key) ?? elevation;
      const normalizedElev = Math.max(0, Math.min(1, (riverElev - 0.24) / 0.6));
      const curved = Math.pow(normalizedElev, 1.3);
      heightLevel = Math.max(1, 2 + Math.floor(curved * 30) - 1);
    } else if (isLake) {
      heightLevel = 1; // Lake basins are low depressions
    } else {
      // All land terrain: height driven by elevation value
      // Power 1.5 curve: keeps lowlands flat but lets peaks rise dramatically
      // elevation range ~0.24-0.85 → height range 2-32
      const normalizedElev = Math.max(0, Math.min(1, (elevation - 0.24) / 0.6));
      const curved = Math.pow(normalizedElev, 1.3); // Gentler curve lets peaks rise dramatically
      heightLevel = 2 + Math.floor(curved * 30);
    }

    // Generate voxel column with elevation-aware surface treatment:
    // - High terrain (height >= 9) gets snow-capped tops
    // - Mountain biome tiles on high terrain (height >= 7) get peaked ridge blocks
    const voxelBlocks = this.generateVoxelColumn(terrain, heightLevel);
    const resource = this.generateResource(terrain);

    return {
      position: coord,
      terrain,
      elevation: heightLevel,
      walkableFloor: heightLevel,
      resource,
      improvement: null,
      unit: null,
      owner: null,
      voxelData: {
        blocks: voxelBlocks,
        destructible: true,
        heightMap: [[heightLevel]],
      },
      visible: false,
      explored: false,
    };
  }

  private terrainFromBiome(elevation: number, moisture: number, temperature: number): TerrainType {
    // Very low elevation: coastal wetlands and beaches
    if (elevation < 0.24) {
      if (moisture > 0.65) return TerrainType.JUNGLE;
      if (moisture > 0.45) return TerrainType.PLAINS;
      return TerrainType.DESERT; // sandy lowlands / beaches
    }

    // Coastal transition zone
    if (elevation < 0.32) {
      if (moisture > 0.6) return TerrainType.JUNGLE;
      if (temperature < 0.3) return TerrainType.SNOW;
      if (moisture > 0.4) return TerrainType.FOREST; // coastal forests
      return TerrainType.DESERT;
    }

    // High elevation: always mountains or snow peaks
    if (elevation > 0.6) {
      if (temperature < 0.3) return TerrainType.SNOW;
      return TerrainType.MOUNTAIN;
    }

    // Mid-high elevation: rocky highlands — mostly mountains
    if (elevation > 0.5) {
      if (temperature < 0.25) return TerrainType.SNOW;
      if (moisture > 0.7) return TerrainType.FOREST; // only very wet alpine forests
      return TerrainType.MOUNTAIN;
    }

    // Upper-mid elevation: rocky terrain with some vegetation
    if (elevation > 0.42) {
      if (temperature < 0.3) return TerrainType.SNOW;
      if (moisture > 0.65) return TerrainType.FOREST; // wet highlands get forest
      if (moisture < 0.25) return TerrainType.DESERT; // arid highlands
      // Drier elevated terrain reads as mountain, wetter as plains
      if (moisture < 0.5) return TerrainType.MOUNTAIN;
      return TerrainType.PLAINS;
    }

    // Mid-elevation: diverse biomes
    // Cold regions
    if (temperature < 0.3) {
      if (moisture > 0.5) return TerrainType.FOREST; // boreal forest / taiga
      return TerrainType.SNOW;
    }

    // Hot regions
    if (temperature > 0.7) {
      if (moisture > 0.65) return TerrainType.JUNGLE; // tropical jungle
      if (moisture > 0.45) return TerrainType.FOREST; // jungle
      if (moisture > 0.3) return TerrainType.PLAINS; // savanna
      return TerrainType.DESERT;
    }

    // Temperate regions
    if (moisture > 0.6) return TerrainType.FOREST;
    if (moisture > 0.45) {
      // Mixed forest / meadow transition
      return temperature > 0.55 ? TerrainType.FOREST : TerrainType.PLAINS;
    }
    if (moisture > 0.3) return TerrainType.PLAINS;
    if (moisture > 0.2) return TerrainType.DESERT; // steppe / dry grassland
    return TerrainType.DESERT;
  }

  // --- Identify lakes in low-lying basins ---
  private identifyLakes(elevMap: Map<string, number>, w: number, h: number): Set<string> {
    const lakes = new Set<string>();

    // Place 2-4 intentional lakes at low-elevation spots away from bases
    const lakeCount = 2 + Math.floor(this.rng.next() * 3);
    const BASE_INSET = 5;
    const placed: { q: number; r: number }[] = [];

    for (let attempt = 0; attempt < lakeCount * 10 && placed.length < lakeCount; attempt++) {
      // Pick a random position, avoiding base zones and map edges
      const lq = Math.floor(this.rng.next() * (w - 10)) + 5;
      const lr = Math.floor(this.rng.next() * (h - 10)) + 5;

      // Skip if too close to a base
      if (lq < BASE_INSET + 6 || lq > w - BASE_INSET - 6) continue;

      // Skip if too close to another lake
      let tooClose = false;
      for (const p of placed) {
        const dist = Math.sqrt((lq - p.q) ** 2 + (lr - p.r) ** 2);
        if (dist < 8) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Only place in lower-elevation areas
      const elev = elevMap.get(`${lq},${lr}`) ?? 0.5;
      if (elev > 0.50) continue;

      placed.push({ q: lq, r: lr });

      // Grow the lake organically using noise for irregular shape
      const lakeRadius = 2 + Math.floor(this.rng.next() * 2); // 2-3 tile radius
      const noiseOff = this.rng.next() * 1000;

      for (let dq = -lakeRadius - 1; dq <= lakeRadius + 1; dq++) {
        for (let dr = -lakeRadius - 1; dr <= lakeRadius + 1; dr++) {
          const q = lq + dq;
          const r = lr + dr;
          if (q < 1 || q >= w - 1 || r < 1 || r >= h - 1) continue;

          const dist = Math.sqrt(dq * dq + dr * dr);
          // Use noise to make irregular edges
          const noiseVal = this.noise.noise2D(q * 0.3 + noiseOff, r * 0.3 + noiseOff) * 1.2;
          const threshold = lakeRadius + noiseVal;

          if (dist < threshold) {
            const key = `${q},${r}`;
            lakes.add(key);
            // Depress elevation for the lake basin
            elevMap.set(key, Math.min(elevMap.get(key) ?? 0.5, 0.28));
          }
        }
      }
    }

    return lakes;
  }

  // Elevation thresholds for visual treatment
  private static readonly SNOW_CAP_HEIGHT = 13;    // Height >= 13: snow appears on upper mountain peaks
  private static readonly RIDGE_HEIGHT = 10;        // Height >= 10: mountain ridge blocks can appear
  private static readonly STONE_LAYER_HEIGHT = 8;   // Height >= 8: exposed stone layers visible
  private static readonly UNDERGROUND_DEPTH = -40;  // Depth of cube planet

  private generateVoxelColumn(terrain: TerrainType, height: number): VoxelBlock[] {
    // Minimal placeholder — will be replaced by computeShellBlocks second pass
    return [];
  }

  /** Second pass: compute shell blocks for each tile using neighbor info */
  public computeShellBlocks(map: GameMap, width: number, height: number): void {
    map.tiles.forEach((tile, key) => {
      const [q, r] = key.split(',').map(Number);
      const neighbors = this.hexNeighbors(q, r);

      // Determine if tile is on map edge
      let isEdge = q <= 0 || q >= width - 1 || r <= 0 || r >= height - 1;

      // Find minimum and maximum neighbor elevation
      let minNeighborElev = tile.elevation;
      let maxNeighborElev = tile.elevation;
      for (const [nq, nr] of neighbors) {
        const nTile = map.tiles.get(`${nq},${nr}`);
        if (nTile) {
          minNeighborElev = Math.min(minNeighborElev, nTile.elevation);
          maxNeighborElev = Math.max(maxNeighborElev, nTile.elevation);
        } else {
          // No neighbor = map edge, this side is exposed
          isEdge = true;
        }
      }

      tile.voxelData.blocks = this.generateShellColumn(
        tile.terrain,
        tile.elevation,
        isEdge,
        minNeighborElev,
        maxNeighborElev,
      );

      // Recalculate elevation from actual block positions — ridges are real terrain.
      // This means tile.elevation reflects the TRUE highest point including ridges,
      // not just the base surface level.
      let maxY = -Infinity;
      for (const b of tile.voxelData.blocks) {
        if (b.localPosition.y > maxY) maxY = b.localPosition.y;
      }
      if (maxY > -Infinity) {
        tile.elevation = maxY + 1;
        tile.voxelData.heightMap = [[tile.elevation]];
        // walkableFloor defaults to elevation (overridden later for tunnel tiles)
        tile.walkableFloor = tile.elevation;
      }
    });
  }

  private generateShellColumn(
    terrain: TerrainType,
    height: number,
    _isEdgeTile: boolean,
    _minNeighborElevation: number,
    maxNeighborElevation: number = height,
  ): VoxelBlock[] {
    const blocks: VoxelBlock[] = [];
    const DEPTH = MapGenerator.UNDERGROUND_DEPTH;

    const baseSurface = this.terrainToBlockType(terrain);
    const isSnowZone = height >= MapGenerator.SNOW_CAP_HEIGHT;
    const isHighEnoughForStone = height >= MapGenerator.STONE_LAYER_HEIGHT;
    const isRidgeTerrain = height >= MapGenerator.RIDGE_HEIGHT;
    const topBlock = (isSnowZone || isHighEnoughForStone) ? BlockType.STONE : baseSurface;
    const subBlock = isHighEnoughForStone ? BlockType.STONE :
                     terrain === TerrainType.DESERT ? BlockType.SAND : BlockType.DIRT;

    // For water features (rivers, lakes, waterfalls), extend solid fill UP to
    // match neighbor elevation. This prevents terrain gaps visible from below
    // and ensures solid underground for lava tube carving.
    const isWaterFeature = terrain === TerrainType.RIVER || terrain === TerrainType.LAKE
                        || terrain === TerrainType.WATERFALL;
    const fillHeight = isWaterFeature ? Math.max(height, maxNeighborElevation) : height;

    const offsets = [-0.5, 0, 0.5];

    // === SOLID FILL: every Y level from DEPTH to surface ===
    // This creates real mineable terrain all the way down through the world.
    // Block types change with depth: surface → sub-surface → dirt → stone → gold → iron
    // Water features fill to neighbor height to seal canyon gaps from below.
    for (const lx of offsets) {
      for (const lz of offsets) {
        for (let y = DEPTH; y < fillHeight; y++) {
          let blockType: BlockType;
          if (y === height - 1) {
            blockType = topBlock;            // water surface layer (sand/stone)
          } else if (y >= height - 2 && y < height) {
            blockType = subBlock;            // sub-surface
          } else if (y >= height) {
            // Above water surface but below neighbor elevation — solid underground fill
            blockType = y < 3 ? BlockType.STONE : BlockType.DIRT;
          } else if (y >= height - 4 && isHighEnoughForStone) {
            blockType = BlockType.STONE;     // mountain stone cap
          } else if (y < -20) {
            blockType = BlockType.IRON;      // deep iron veins
          } else if (y < -10) {
            blockType = BlockType.GOLD;      // gold layer
          } else if (y < 0) {
            blockType = BlockType.STONE;     // underground stone
          } else {
            blockType = y < 3 ? BlockType.STONE : BlockType.DIRT;  // shallow layers
          }
          blocks.push({
            localPosition: { x: lx, y, z: lz },
            type: blockType,
            health: 100, maxHealth: 100,
          });
        }
      }
    }

    // === RIDGE TERRAIN (real terrain, not decorations) — baked into elevation ===
    if (isRidgeTerrain && !isSnowZone && terrain !== TerrainType.WATERFALL) {
      // Stone ridges below snow line — sparse peaked blocks
      for (let y = 0; y < 3; y++) {
        blocks.push({ localPosition: { x: 0, y: height + y, z: 0 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
      }
      for (let y = 0; y < 2; y++) {
        blocks.push({ localPosition: { x: -0.5, y: height + y, z: 0.5 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
      }
      blocks.push({ localPosition: { x: 0.5, y: height, z: -0.5 }, type: BlockType.STONE, health: 100, maxHealth: 100 });
    }
    if (isSnowZone && terrain !== TerrainType.WATERFALL) {
      // Snow zone ridges — fuller, bulkier formation covered in snow
      // Stone core: a thick 3x3-ish column rising 4 blocks
      const ridgeOffsets: [number, number][] = [
        [0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5],
        [-0.5, 0.5], [0.5, -0.5],
      ];
      // Build stone core up to 4 blocks high (tapered)
      for (const [rx, rz] of ridgeOffsets) {
        const maxY = rx === 0 && rz === 0 ? 4 : (Math.abs(rx) + Math.abs(rz) < 0.8 ? 3 : 2);
        for (let y = 0; y < maxY; y++) {
          blocks.push({ localPosition: { x: rx, y: height + y, z: rz }, type: BlockType.STONE, health: 100, maxHealth: 100 });
        }
      }
      // Snow blanket on top of everything — covers the ridge peaks
      // Top snow on the tallest columns
      blocks.push({ localPosition: { x: 0, y: height + 4, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: -0.5, y: height + 3, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0.5, y: height + 3, z: 0 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0, y: height + 3, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0, y: height + 3, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      // Snow on mid-height columns
      blocks.push({ localPosition: { x: -0.5, y: height + 2, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: 0.5, y: height + 2, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      // Snow dusting on the surface around the ridge base
      blocks.push({ localPosition: { x: 0.5, y: height, z: 0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
      blocks.push({ localPosition: { x: -0.5, y: height, z: -0.5 }, type: BlockType.SNOW, health: 100, maxHealth: 100 });
    }

    return blocks;
  }

  // =====================================================
  // LAVA TUBE GENERATION
  // Worm-like underground tunnels connecting map features:
  //   cave entrance → sub-terrain → hill base / waterfall / mountain exit
  // =====================================================

  private carveLavaTubes(map: GameMap, elevMap: Map<string, number>, w: number, h: number): void {
    // --- Step 1: Find candidate entrance/exit points ---
    const highPoints: { q: number; r: number; elev: number }[] = [];
    const lowPoints: { q: number; r: number; elev: number }[] = [];
    const waterfallPoints: { q: number; r: number; elev: number }[] = [];

    const EDGE_BUFFER = 4;
    map.tiles.forEach((tile, key) => {
      const [q, r] = key.split(',').map(Number);
      if (q < EDGE_BUFFER || q >= w - EDGE_BUFFER || r < EDGE_BUFFER || r >= h - EDGE_BUFFER) return;
      // Skip water tiles as entrances
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.LAKE) return;

      const rawElev = elevMap.get(key) ?? 0.4;

      if (tile.terrain === TerrainType.WATERFALL) {
        waterfallPoints.push({ q, r, elev: rawElev });
      } else if (rawElev > 0.52) {
        // Mountain/hill — good cave entrance
        highPoints.push({ q, r, elev: rawElev });
      } else if (rawElev > 0.28 && rawElev < 0.40) {
        // Low-mid terrain — hill base / valley floor exit
        lowPoints.push({ q, r, elev: rawElev });
      }
    });

    if (highPoints.length === 0 || (lowPoints.length === 0 && waterfallPoints.length === 0)) return;

    // --- Step 2: Generate 2-4 tubes connecting high→low points ---
    const numTubes = 2 + Math.floor(this.rng.next() * 3); // 2-4 tubes
    const usedStarts = new Set<string>();
    const usedEnds = new Set<string>();

    for (let t = 0; t < numTubes; t++) {
      // Pick a random high point as entrance
      let start: { q: number; r: number; elev: number } | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const idx = Math.floor(this.rng.next() * highPoints.length);
        const candidate = highPoints[idx];
        const cKey = `${candidate.q},${candidate.r}`;
        if (!usedStarts.has(cKey)) {
          start = candidate;
          usedStarts.add(cKey);
          break;
        }
      }
      if (!start) continue;

      // Pick exit: prefer waterfall adjacency, then low points
      // Try to find exit far enough from start (at least 8 hexes)
      let end: { q: number; r: number; elev: number } | null = null;
      const candidates = this.rng.next() < 0.4 && waterfallPoints.length > 0
        ? waterfallPoints : lowPoints;

      for (let attempt = 0; attempt < 30; attempt++) {
        const idx = Math.floor(this.rng.next() * candidates.length);
        const candidate = candidates[idx];
        const cKey = `${candidate.q},${candidate.r}`;
        if (usedEnds.has(cKey)) continue;
        const dq = candidate.q - start.q;
        const dr = candidate.r - start.r;
        const dist = Math.sqrt(dq * dq + dr * dr);
        if (dist >= 8 && dist <= w * 0.6) {
          end = candidate;
          usedEnds.add(cKey);
          break;
        }
      }
      if (!end) continue;

      // --- Step 3: Trace a winding tunnel path from start to end ---
      const tubePath = this.traceTubePath(start, end, map, w, h);
      if (tubePath.length < 4) continue;

      // --- Step 4: Carve tunnel blocks and set tile properties ---
      this.carveTunnelBlocks(tubePath, map);
    }
  }

  /** Trace a winding path for a lava tube using noise-biased stepping */
  private traceTubePath(
    start: { q: number; r: number },
    end: { q: number; r: number },
    map: GameMap,
    w: number, h: number,
  ): { q: number; r: number }[] {
    const path: { q: number; r: number }[] = [];
    const visited = new Set<string>();
    let cq = start.q;
    let cr = start.r;
    const maxSteps = Math.floor(Math.sqrt((end.q - start.q) ** 2 + (end.r - start.r) ** 2) * 2.5);

    for (let step = 0; step < maxSteps; step++) {
      const key = `${cq},${cr}`;
      if (visited.has(key)) break;
      visited.add(key);

      const tile = map.tiles.get(key);
      if (!tile) break;
      // Don't tunnel through water/lake tiles
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.LAKE) break;

      path.push({ q: cq, r: cr });

      // Check if we're close enough to the end
      const dq = end.q - cq;
      const dr = end.r - cr;
      if (Math.abs(dq) <= 1 && Math.abs(dr) <= 1) {
        path.push({ q: end.q, r: end.r });
        break;
      }

      // Get hex neighbors and score them
      const neighbors = this.hexNeighbors(cq, cr);
      let bestScore = -Infinity;
      let bestNq = cq;
      let bestNr = cr;

      for (const [nq, nr] of neighbors) {
        if (nq < 2 || nq >= w - 2 || nr < 2 || nr >= h - 2) continue;
        const nKey = `${nq},${nr}`;
        if (visited.has(nKey)) continue;

        const nTile = map.tiles.get(nKey);
        if (!nTile || nTile.terrain === TerrainType.WATER || nTile.terrain === TerrainType.LAKE) continue;

        // Score: direction toward goal + noise for winding
        const dirScore = -(Math.abs(end.q - nq) + Math.abs(end.r - nr)); // closer to goal = higher
        const noiseWander = this.noise.fbm(nq * 0.3 + step * 0.1, nr * 0.3, 2) * 6; // organic winding
        const score = dirScore + noiseWander;

        if (score > bestScore) {
          bestScore = score;
          bestNq = nq;
          bestNr = nr;
        }
      }

      if (bestNq === cq && bestNr === cr) break; // stuck
      cq = bestNq;
      cr = bestNr;
    }

    return path;
  }

  /** Carve tunnel blocks out of the shell column for each tile on the tube path */
  private carveTunnelBlocks(path: { q: number; r: number }[], map: GameMap): void {
    const BORE_HEIGHT = 4;  // vertical clearance of tunnel (4 blocks tall)
    const BORE_WIDTH = 1;   // how many sub-block columns to carve (center column)

    for (let i = 0; i < path.length; i++) {
      const { q, r } = path[i];
      const key = `${q},${r}`;
      const tile = map.tiles.get(key);
      if (!tile) continue;

      // Tunnel floor Y: starts at surface near entrances, dips underground in middle
      // Use a smooth curve: entrance (surface-2) → middle (deep underground) → exit (surface-2)
      const t = path.length > 1 ? i / (path.length - 1) : 0; // 0..1 along path
      const depthCurve = Math.sin(t * Math.PI); // 0 at ends, 1 in middle

      // Surface Y for this tile (before tunnel carving)
      const surfaceY = tile.elevation - 1;

      // Entrance/exit: just 2 below surface. Middle: go as deep as 60% below surface
      const entranceFloor = Math.max(0, surfaceY - 3);
      const deepFloor = Math.max(-15, surfaceY - Math.floor(surfaceY * 0.6));
      const tunnelFloorY = Math.round(entranceFloor + (deepFloor - entranceFloor) * depthCurve);
      const tunnelCeilingY = tunnelFloorY + BORE_HEIGHT;

      // Don't carve if tunnel would be above terrain
      if (tunnelFloorY >= surfaceY - 1) continue;

      // Remove blocks in the tunnel bore
      tile.voxelData.blocks = tile.voxelData.blocks.filter(block => {
        const by = block.localPosition.y;
        // Keep blocks outside the tunnel bore
        if (by < tunnelFloorY || by >= tunnelCeilingY) return true;

        // For wider tunnels, only carve the center column (x=0, z=0)
        // For entrances/exits (near ends), carve wider
        const bx = block.localPosition.x;
        const bz = block.localPosition.z;
        const nearEnd = t < 0.15 || t > 0.85;
        if (nearEnd) {
          // Wide opening at entrance/exit — carve all sub-positions
          return false;
        } else {
          // Middle of tunnel — carve center and adjacent sub-columns
          return Math.abs(bx) > 0.25 && Math.abs(bz) > 0.25;
        }
      });

      // Mark tile as tunnel
      tile.hasTunnel = true;
      tile.tunnelFloorY = tunnelFloorY;
      tile.tunnelCeilingY = tunnelCeilingY;

      // walkableFloor = tunnel floor (units walk at the lowest open level)
      tile.walkableFloor = tunnelFloorY;

      // Note: elevation stays the same (highest block) — walkableFloor is what units use
    }
  }

  private terrainToBlockType(terrain: TerrainType): BlockType {
    switch (terrain) {
      case TerrainType.PLAINS: return BlockType.GRASS;
      case TerrainType.FOREST: return BlockType.GRASS;
      case TerrainType.MOUNTAIN: return BlockType.STONE;
      case TerrainType.WATER: return BlockType.WATER;
      case TerrainType.RIVER: return BlockType.SAND;   // Sandy riverbed
      case TerrainType.LAKE: return BlockType.SAND;     // Sandy lakebed
      case TerrainType.WATERFALL: return BlockType.STONE; // Rocky waterfall edge
      case TerrainType.DESERT: return BlockType.SAND;
      case TerrainType.SNOW: return BlockType.SNOW;
      case TerrainType.JUNGLE: return BlockType.JUNGLE;
      default: return BlockType.GRASS;
    }
  }

  private generateResource(terrain: TerrainType): ResourceType | null {
    // Snow tiles get special higher resource rates since they're already rare
    if (terrain === TerrainType.SNOW) {
      const roll = this.rng.next();
      if (roll < 0.6) return ResourceType.CRYSTAL;  // 60% crystal vein
      if (roll < 0.8) return ResourceType.STONE;     // 20% frozen stone
      return null;                                     // 20% barren peak
    }

    if (this.rng.next() > 0.2) return null;

    switch (terrain) {
      case TerrainType.PLAINS: return ResourceType.FOOD;
      case TerrainType.FOREST: return ResourceType.WOOD;
      case TerrainType.MOUNTAIN:
        return this.rng.next() > 0.5 ? ResourceType.IRON : ResourceType.STONE;
      case TerrainType.DESERT: return ResourceType.GOLD;
      case TerrainType.JUNGLE: return this.rng.next() > 0.5 ? ResourceType.WOOD : ResourceType.FOOD;
      case TerrainType.RIVER: return ResourceType.FOOD;
      case TerrainType.LAKE: return ResourceType.FOOD;
      case TerrainType.WATERFALL: return null;
      default: return null;
    }
  }

  // After generating tiles, mirror resources from left half to right half for fairness
  private balanceResources(tiles: Map<string, Tile>, width: number, height: number): void {
    const midQ = Math.floor(width / 2);

    // For each tile on the left side, mirror its resource to the corresponding right side tile
    for (let q = 0; q < midQ; q++) {
      for (let r = 0; r < height; r++) {
        const leftKey = `${q},${r}`;
        const mirrorQ = width - 1 - q;
        const rightKey = `${mirrorQ},${r}`;

        const leftTile = tiles.get(leftKey);
        const rightTile = tiles.get(rightKey);

        if (!leftTile || !rightTile) continue;

        // If left has a resource, ensure right gets an equivalent one
        if (leftTile.resource && !rightTile.resource) {
          // Find a compatible resource for the right side terrain
          rightTile.resource = this.compatibleResource(rightTile.terrain, leftTile.resource);
        } else if (rightTile.resource && !leftTile.resource) {
          leftTile.resource = this.compatibleResource(leftTile.terrain, rightTile.resource);
        }
      }
    }
  }

  private compatibleResource(terrain: TerrainType, desiredResource: ResourceType): ResourceType | null {
    // Try to give the same resource type if terrain supports it, otherwise give terrain-appropriate resource
    const terrainResources: Record<string, ResourceType[]> = {
      [TerrainType.PLAINS]: [ResourceType.FOOD, ResourceType.WOOD],
      [TerrainType.FOREST]: [ResourceType.WOOD, ResourceType.FOOD],
      [TerrainType.MOUNTAIN]: [ResourceType.STONE, ResourceType.IRON],
      [TerrainType.DESERT]: [ResourceType.GOLD, ResourceType.IRON],
      [TerrainType.SNOW]: [ResourceType.CRYSTAL, ResourceType.STONE],
      [TerrainType.JUNGLE]: [ResourceType.WOOD, ResourceType.FOOD],
      [TerrainType.RIVER]: [ResourceType.FOOD],
      [TerrainType.LAKE]: [ResourceType.FOOD],
      [TerrainType.WATERFALL]: [],
    };

    const allowed = terrainResources[terrain];
    if (!allowed) return null;

    // If the desired resource is compatible, use it
    if (allowed.includes(desiredResource)) return desiredResource;

    // Otherwise give the first compatible resource
    return allowed[0];
  }
}
