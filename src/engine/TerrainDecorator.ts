// ============================================
// CUBITOPIA - Terrain Decorator
// Adds trees, rocks, flowers, and water effects
// ============================================

import * as THREE from 'three';
import { TerrainType, ResourceType, HexCoord } from '../types';

// Seeded random for consistent decoration placement
class SeededRand {
  private s: number;
  constructor(seed: number) { this.s = seed; }
  next(): number {
    this.s = (this.s * 16807 + 0) % 2147483647;
    return this.s / 2147483647;
  }
}

export class TerrainDecorator {
  private scene: THREE.Scene;
  private decorations: THREE.Object3D[] = [];
  private decorationsByTile: Map<string, THREE.Object3D[]> = new Map();
  private waterMeshes: THREE.Mesh[] = [];
  private mistClouds: THREE.Mesh[] = []; // separate list for spinning mist
  private waterTime: number = 0;
  /** All grass clump meshes — animated with sway each frame (1 merged mesh per tile) */
  private grassBlades: THREE.Mesh[] = [];
  /** Grass clump meshes keyed by tile "q,r" for removal/regrowth */
  grassClumpsByTile: Map<string, THREE.Object3D> = new Map();
  private grassTime: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Remove all decorations on a specific tile (e.g. when a tree is chopped) */
  removeDecoration(coord: HexCoord): void {
    const key = `${coord.q},${coord.r}`;
    const objs = this.decorationsByTile.get(key);
    if (objs) {
      for (const obj of objs) {
        this.scene.remove(obj);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        const idx = this.decorations.indexOf(obj);
        if (idx !== -1) this.decorations.splice(idx, 1);
      }
      this.decorationsByTile.delete(key);
    }
  }

  /**
   * Decorate a tile based on terrain type
   */
  /** Helper: track a decoration object for a tile */
  private trackDecoration(obj: THREE.Object3D, tileKey: string): void {
    if (!this.decorationsByTile.has(tileKey)) {
      this.decorationsByTile.set(tileKey, []);
    }
    this.decorationsByTile.get(tileKey)!.push(obj);
  }

  /**
   * Decorate a tile. maxNeighborElevation prevents trees on tiles where
   * a much taller neighbor would cause visual clipping.
   */
  decorateTile(coord: HexCoord, terrain: TerrainType, elevation: number, maxNeighborElevation: number = elevation, resource: ResourceType | null = null): void {
    const tileKey = `${coord.q},${coord.r}`;
    const decorsBefore = this.decorations.length;
    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const rng = new SeededRand(coord.q * 1000 + coord.r);

    // Ridges are now real terrain — tile elevation already includes ridge height.
    // Trees sit at the tile's elevation directly (no manual spire offset needed).
    const treeElevation = elevation;

    // Only block trees if a neighbor is dramatically taller (would visually engulf the tree)
    const neighborTooTall = (maxNeighborElevation - treeElevation) > 2.5;

    switch (terrain) {
      case TerrainType.FOREST:
        if (!neighborTooTall) {
          // Above snow line (scaled elev >= 6.5) use snowy trees
          if (elevation >= 6.5) {
            this.addSnowPine(worldX, treeElevation, worldZ, rng);
            if (rng.next() > 0.6) this.addSnowPine(worldX + 0.3, treeElevation, worldZ + 0.3, rng);
          } else {
            this.addTree(worldX, treeElevation, worldZ, rng);
            if (rng.next() > 0.6) this.addTree(worldX + 0.3, treeElevation, worldZ + 0.3, rng);
          }
        }
        break;
      case TerrainType.PLAINS:
        if (!neighborTooTall) {
          // Skip grass/flowers on high-elevation plains where the surface is stone (elev >= 3.0 = height 6+)
          const hasGrassSurface = elevation < 3.0;
          if (hasGrassSurface && rng.next() > 0.7) this.addFlowers(worldX, treeElevation, worldZ, rng);
          // Most plains tiles get grass (70% chance) — spawns at medium stage
          if (hasGrassSurface && rng.next() > 0.3) {
            this.addGrassAtStage(coord, treeElevation, 1 + (rng.next() > 0.5 ? 1 : 0));
          }
        }
        break;
      case TerrainType.MOUNTAIN:
        // Mountains get sparse rocks + sparse trees at the correct height
        if (rng.next() > 0.55) this.addRock(worldX, treeElevation, worldZ, rng);
        if (rng.next() > 0.8) this.addRock(worldX + 0.3, treeElevation, worldZ - 0.2, rng);
        if (!neighborTooTall && rng.next() > 0.65) {
          if (elevation >= 6.5) {
            this.addSnowPine(worldX - 0.2, treeElevation, worldZ + 0.1, rng);
          } else {
            this.addTree(worldX - 0.2, treeElevation, worldZ + 0.1, rng);
          }
        }
        // Iron ore vein indicator — rusty-orange rocks on iron-rich mountains
        if (resource === ResourceType.IRON) {
          this.addIronOreVein(worldX, treeElevation, worldZ, rng);
        }
        break;
      case TerrainType.WATER:
        // Ocean plane handles water visuals — no decoration needed
        break;
      case TerrainType.DESERT:
        if (rng.next() > 0.8) this.addCactus(worldX, elevation, worldZ, rng);
        break;
      case TerrainType.SNOW:
        // No trees in snow zones — too high/cold. Just rocks occasionally.
        if (rng.next() > 0.75) this.addRock(worldX, elevation, worldZ, rng);
        break;
      case TerrainType.JUNGLE:
        // Dense jungle: multiple trees + undergrowth
        if (!neighborTooTall) {
          this.addJungleTree(worldX, treeElevation, worldZ, rng);
          if (rng.next() > 0.3) this.addJungleTree(worldX + 0.35, treeElevation, worldZ + 0.2, rng);
          if (rng.next() > 0.5) this.addJungleTree(worldX - 0.2, treeElevation, worldZ - 0.3, rng);
        }
        break;
      case TerrainType.RIVER:
        this.addWater(worldX, elevation, worldZ);
        break;
      case TerrainType.LAKE:
        this.addWater(worldX, elevation, worldZ);
        break;
      case TerrainType.WATERFALL:
        this.addWaterfall(worldX, elevation, worldZ, maxNeighborElevation);
        break;
    }

    // Track all decorations added for this tile
    const newDecors = this.decorations.slice(decorsBefore);
    if (newDecors.length > 0) {
      this.decorationsByTile.set(tileKey, newDecors);
    }
  }

  /**
   * Add a tree at a specific growth stage (0=sapling, 1=young, 2=mature).
   * Scale and color vary by stage.
   */
  addTreeAtStage(coord: HexCoord, elevation: number, stage: number): void {
    const tileKey = `${coord.q},${coord.r}`;
    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const rng = new SeededRand(coord.q * 1000 + coord.r + stage * 7);

    const group = new THREE.Group();
    const y = elevation;

    // Stage-based scaling: sapling=0.35, young=0.65, mature=1.0+
    const stageScales = [0.35, 0.65, 1.0];
    const baseScale = stageScales[Math.min(stage, 2)];

    // Sapling: lighter green, thinner trunk
    const trunkH = (0.8 + rng.next() * 0.4) * baseScale;
    const trunkRadius = stage === 0 ? 0.03 : stage === 1 ? 0.06 : 0.09;
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkH, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: stage === 0 ? 0x795548 : 0x5d4037 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(0, trunkH / 2, 0);
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage — saplings are brighter/lighter green
    const foliageColors = stage === 0
      ? [0x66bb6a, 0x81c784]  // light green saplings
      : stage === 1
        ? [0x43a047, 0x4caf50] // medium green young
        : [0x2e7d32, 0x388e3c]; // dark green mature
    const color = foliageColors[Math.floor(rng.next() * foliageColors.length)];

    const layers = stage === 0 ? 1 : stage === 1 ? 2 : 3;
    for (let i = 0; i < layers; i++) {
      const radius = (0.35 - i * 0.08) * baseScale;
      const height = 0.4 * baseScale;
      const coneGeo = new THREE.ConeGeometry(radius, height, 6);
      const coneMat = new THREE.MeshLambertMaterial({ color });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0, trunkH + i * 0.25 * baseScale + 0.1 * baseScale, 0);
      cone.castShadow = true;
      group.add(cone);
    }

    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    group.position.set(worldX + offsetX, y, worldZ + offsetZ);
    group.rotation.y = rng.next() * Math.PI * 2;

    this.scene.add(group);
    this.decorations.push(group);

    // Track for tile
    if (!this.decorationsByTile.has(tileKey)) {
      this.decorationsByTile.set(tileKey, []);
    }
    this.decorationsByTile.get(tileKey)!.push(group);
  }

  private addTree(x: number, elevation: number, z: number, rng: SeededRand): void {
    const group = new THREE.Group();
    const y = elevation;

    // Trunk
    const trunkH = 0.8 + rng.next() * 0.4;
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, trunkH, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(0, trunkH / 2, 0);
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage layers (stacked cones for a low-poly tree)
    const foliageColors = [0x2e7d32, 0x388e3c, 0x43a047, 0x4caf50];
    const color = foliageColors[Math.floor(rng.next() * foliageColors.length)];

    for (let i = 0; i < 3; i++) {
      const radius = 0.35 - i * 0.08;
      const height = 0.4;
      const coneGeo = new THREE.ConeGeometry(radius, height, 6);
      const coneMat = new THREE.MeshLambertMaterial({ color });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0, trunkH + i * 0.25 + 0.1, 0);
      cone.castShadow = true;
      group.add(cone);
    }

    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    group.position.set(x + offsetX, y, z + offsetZ);

    // Slight random rotation
    group.rotation.y = rng.next() * Math.PI * 2;
    const scale = 0.8 + rng.next() * 0.5;
    group.scale.setScalar(scale);

    this.scene.add(group);
    this.decorations.push(group);
  }

  private addSnowPine(x: number, elevation: number, z: number, rng: SeededRand): void {
    const group = new THREE.Group();
    const y = elevation;

    // Brown trunk (same as normal tree)
    const trunkH = 0.8 + rng.next() * 0.4;
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, trunkH, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(0, trunkH / 2, 0);
    trunk.castShadow = true;
    group.add(trunk);

    // Green foliage layers with snow dusting — darker green than normal trees
    const foliageColors = [0x1b5e20, 0x2e7d32, 0x33691e];
    const color = foliageColors[Math.floor(rng.next() * foliageColors.length)];

    for (let i = 0; i < 3; i++) {
      const radius = 0.35 - i * 0.08;
      const coneGeo = new THREE.ConeGeometry(radius, 0.4, 6);
      const coneMat = new THREE.MeshLambertMaterial({ color });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0, trunkH + i * 0.25 + 0.1, 0);
      cone.castShadow = true;
      group.add(cone);

      // Snow dusting on top of each foliage layer
      const snowRadius = radius * 0.75;
      const snowGeo = new THREE.ConeGeometry(snowRadius, 0.12, 6);
      const snowMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
      const snowDust = new THREE.Mesh(snowGeo, snowMat);
      snowDust.position.set(0, trunkH + i * 0.25 + 0.28, 0);
      group.add(snowDust);
    }

    // Snow cap on the very top
    const capGeo = new THREE.ConeGeometry(0.1, 0.12, 6);
    const capMat = new THREE.MeshLambertMaterial({ color: 0xfafafa });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(0, trunkH + 0.85, 0);
    group.add(cap);

    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    group.position.set(x + offsetX, y, z + offsetZ);
    group.rotation.y = rng.next() * Math.PI * 2;
    group.scale.setScalar(0.8 + rng.next() * 0.5);
    this.scene.add(group);
    this.decorations.push(group);
  }

  private addRock(x: number, elevation: number, z: number, rng: SeededRand): void {
    const rockGeo = new THREE.DodecahedronGeometry(0.15 + rng.next() * 0.15, 0);
    const rockMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.45 + rng.next() * 0.1, 0.43 + rng.next() * 0.1, 0.4 + rng.next() * 0.1),
    });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(
      x + (rng.next() - 0.5) * 0.4,
      elevation - 0.05,
      z + (rng.next() - 0.5) * 0.4
    );
    rock.rotation.set(rng.next(), rng.next(), rng.next());
    rock.scale.y = 0.6 + rng.next() * 0.3;
    rock.castShadow = true;
    this.scene.add(rock);
    this.decorations.push(rock);
  }

  /** Iron ore vein — cluster of rusty-orange rocks with metallic sheen */
  private addIronOreVein(x: number, elevation: number, z: number, rng: SeededRand): void {
    const count = 2 + Math.floor(rng.next() * 2); // 2-3 ore chunks
    for (let i = 0; i < count; i++) {
      const size = 0.1 + rng.next() * 0.12;
      const oreGeo = new THREE.DodecahedronGeometry(size, 0);
      // Rusty orange-brown color with slight variation
      const r = 0.55 + rng.next() * 0.15;
      const g = 0.25 + rng.next() * 0.1;
      const b = 0.1 + rng.next() * 0.05;
      const oreMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(r, g, b),
        emissive: new THREE.Color(0.15, 0.06, 0.02), // subtle warm glow
      });
      const ore = new THREE.Mesh(oreGeo, oreMat);
      ore.position.set(
        x + (rng.next() - 0.5) * 0.5,
        elevation - 0.06 + rng.next() * 0.04,
        z + (rng.next() - 0.5) * 0.5
      );
      ore.rotation.set(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
      ore.scale.set(1, 0.6 + rng.next() * 0.4, 1);
      ore.castShadow = true;
      this.scene.add(ore);
      this.decorations.push(ore);
    }
  }

  private addFlowers(x: number, elevation: number, z: number, rng: SeededRand): void {
    const flowerColors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0xc084fc, 0xff8fab];
    const count = 2 + Math.floor(rng.next() * 3);

    for (let i = 0; i < count; i++) {
      const color = flowerColors[Math.floor(rng.next() * flowerColors.length)];

      // Stem
      const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3);
      const stemMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
      const stem = new THREE.Mesh(stemGeo, stemMat);

      // Bloom
      const bloomGeo = new THREE.SphereGeometry(0.04, 4, 4);
      const bloomMat = new THREE.MeshLambertMaterial({ color });
      const bloom = new THREE.Mesh(bloomGeo, bloomMat);
      bloom.position.y = 0.08;

      const group = new THREE.Group();
      group.add(stem);
      group.add(bloom);
      group.position.set(
        x + (rng.next() - 0.5) * 0.6,
        elevation + 0.07,
        z + (rng.next() - 0.5) * 0.6
      );

      this.scene.add(group);
      this.decorations.push(group);
    }
  }

  /**
   * Add a grass clump at a growth stage (0=short, 1=medium, 2=tall/harvestable).
   * All blades merged into a single mesh per tile for performance.
   * Spread radius extends slightly beyond tile edge so adjacent grass tiles blend seamlessly.
   */
  addGrassAtStage(coord: HexCoord, elevation: number, stage: number): void {
    const tileKey = `${coord.q},${coord.r}`;
    const worldX = coord.q * 1.5;
    const worldZ = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    const rng = new SeededRand(coord.q * 997 + coord.r * 131 + stage * 17);

    // Remove existing grass clump on this tile
    this.removeGrassClump(tileKey);

    const stageScale = [0.45, 0.75, 1.0][Math.min(stage, 2)];
    const bladeCount = [30, 50, 80][Math.min(stage, 2)];

    // Color per stage — lighter = short, golden = ready to harvest
    const colors = [
      new THREE.Color(0.35, 0.65, 0.12),  // stage 0: bright lime
      new THREE.Color(0.30, 0.58, 0.10),  // stage 1: warm green
      new THREE.Color(0.45, 0.55, 0.12),  // stage 2: golden-green (ready to harvest)
    ];
    const baseColor = colors[Math.min(stage, 2)];

    // Build a merged BufferGeometry from all blades (1 draw call per tile!)
    const positions: number[] = [];
    const normals: number[] = [];
    const vertColors: number[] = [];
    // Spread radius slightly beyond tile boundary (0.85 vs tile spacing 1.5/2 = 0.75)
    const SPREAD = 0.85;

    for (let i = 0; i < bladeCount; i++) {
      const h = (0.2 + rng.next() * 0.2) * stageScale;
      const w = (0.04 + rng.next() * 0.03) * stageScale;

      // Position within tile (extended radius for seamless blending)
      const bx = (rng.next() - 0.5) * SPREAD * 2;
      const bz = (rng.next() - 0.5) * SPREAD * 2;

      // Random rotation around Y
      const angle = rng.next() * Math.PI;
      const lean = (rng.next() - 0.5) * 0.3;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Per-blade color variation
      const shade = 0.85 + rng.next() * 0.3;
      const cr = baseColor.r * shade;
      const cg = baseColor.g * shade;
      const cb = baseColor.b * shade;

      // Build two triangles (quad) for each blade
      // Bottom-left, bottom-right, top-left, top-right in local space
      const hw = w / 2;
      const pts = [
        [-hw, 0, 0], [hw, 0, 0], [-hw, h, lean * h], [hw, h, lean * h]
      ];

      // Rotate and translate each vertex
      const transformed = pts.map(([px, py, pz]) => {
        const rx = px * cosA - pz * sinA + bx;
        const ry = py;
        const rz = px * sinA + pz * cosA + bz;
        return [rx, ry, rz];
      });

      // Normal (face normal of the quad, roughly)
      const nx = -sinA;
      const nz = cosA;

      // Triangle 1: 0, 1, 2
      positions.push(
        transformed[0][0], transformed[0][1], transformed[0][2],
        transformed[1][0], transformed[1][1], transformed[1][2],
        transformed[2][0], transformed[2][1], transformed[2][2]
      );
      // Triangle 2: 1, 3, 2
      positions.push(
        transformed[1][0], transformed[1][1], transformed[1][2],
        transformed[3][0], transformed[3][1], transformed[3][2],
        transformed[2][0], transformed[2][1], transformed[2][2]
      );

      // Normals (6 vertices)
      for (let n = 0; n < 6; n++) {
        normals.push(nx, 0.3, nz);
      }
      // Colors (6 vertices)
      for (let n = 0; n < 6; n++) {
        vertColors.push(cr, cg, cb);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(vertColors, 3));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(worldX, elevation, worldZ);
    mesh.frustumCulled = false;

    // Store sway data on the mesh
    mesh.userData.swayPhase = rng.next() * Math.PI * 2;
    mesh.userData.swaySpeed = 1.8 + rng.next() * 0.6;
    mesh.userData.swayAmount = 0.04 + stage * 0.02;

    this.scene.add(mesh);
    this.decorations.push(mesh);
    this.grassBlades.push(mesh); // For sway animation (now 1 mesh per tile)
    this.grassClumpsByTile.set(tileKey, mesh);

    // Track for tile-based removal
    if (!this.decorationsByTile.has(tileKey)) {
      this.decorationsByTile.set(tileKey, []);
    }
    this.decorationsByTile.get(tileKey)!.push(mesh);
  }

  /** Remove grass clump from a tile */
  removeGrassClump(tileKey: string): void {
    const existing = this.grassClumpsByTile.get(tileKey);
    if (existing) {
      // Remove from animation list
      const idx2 = this.grassBlades.indexOf(existing as THREE.Mesh);
      if (idx2 !== -1) this.grassBlades.splice(idx2, 1);

      this.scene.remove(existing);
      if (existing instanceof THREE.Mesh) {
        existing.geometry.dispose();
        if (existing.material instanceof THREE.Material) existing.material.dispose();
      } else {
        existing.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
      }
      const idx = this.decorations.indexOf(existing);
      if (idx !== -1) this.decorations.splice(idx, 1);
      this.grassClumpsByTile.delete(tileKey);

      // Also remove from decorationsByTile
      const tileDecors = this.decorationsByTile.get(tileKey);
      if (tileDecors) {
        const gi = tileDecors.indexOf(existing);
        if (gi !== -1) tileDecors.splice(gi, 1);
      }
    }
  }

  /** Check if a tile has grass */
  hasGrass(tileKey: string): boolean {
    return this.grassClumpsByTile.has(tileKey);
  }

  /** Legacy addGrass — now delegates to addGrassAtStage for map-generation */
  private addGrass(x: number, elevation: number, z: number, rng: SeededRand, coord?: HexCoord): void {
    if (!coord) return;
    this.addGrassAtStage(coord, elevation, 1);
  }

  private addCactus(x: number, elevation: number, z: number, rng: SeededRand): void {
    const group = new THREE.Group();

    // Main body
    const bodyGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6);
    const cactusMat = new THREE.MeshLambertMaterial({ color: 0x558b2f });
    const body = new THREE.Mesh(bodyGeo, cactusMat);
    body.position.y = 0.25;
    body.castShadow = true;
    group.add(body);

    // Arm
    if (rng.next() > 0.4) {
      const armGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.25, 5);
      const arm = new THREE.Mesh(armGeo, cactusMat);
      arm.position.set(0.12, 0.35, 0);
      arm.rotation.z = -0.5;
      group.add(arm);
    }

    group.position.set(x, elevation, z);
    this.scene.add(group);
    this.decorations.push(group);
  }

  private addJungleTree(x: number, elevation: number, z: number, rng: SeededRand): void {
    const group = new THREE.Group();

    // Tall tropical trunk
    const height = 0.6 + rng.next() * 0.5;
    const trunkGeo = new THREE.CylinderGeometry(0.03, 0.08, height, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4e3b2a });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = height / 2;
    trunk.rotation.z = (rng.next() - 0.5) * 0.15;
    trunk.castShadow = true;
    group.add(trunk);

    // Dense canopy — large lush foliage
    const canopySize = 0.25 + rng.next() * 0.2;
    const foliageGeo = new THREE.SphereGeometry(canopySize, 6, 5);
    const greenShade = 0x1b7a1e + Math.floor(rng.next() * 0x002200);
    const foliageMat = new THREE.MeshLambertMaterial({ color: greenShade });
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.y = height + canopySize * 0.5;
    foliage.scale.set(1.2, 0.8, 1.2);
    foliage.castShadow = true;
    group.add(foliage);

    // Secondary lower canopy layer for lushness
    if (rng.next() > 0.4) {
      const lowerGeo = new THREE.SphereGeometry(canopySize * 0.7, 5, 4);
      const lowerMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
      const lower = new THREE.Mesh(lowerGeo, lowerMat);
      lower.position.set((rng.next() - 0.5) * 0.15, height * 0.6, (rng.next() - 0.5) * 0.15);
      lower.castShadow = true;
      group.add(lower);
    }

    group.position.set(x, elevation, z);
    this.scene.add(group);
    this.decorations.push(group);
  }

  private addWater(x: number, elevation: number, z: number): void {
    const waterGeo = new THREE.PlaneGeometry(1.5, 1.5);
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x1e88e5,
      transparent: true,
      opacity: 0.65,
      shininess: 120,
      specular: 0x88ccff,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    // Place just above the voxel surface
    water.position.set(x, elevation + 0.05, z);
    this.scene.add(water);
    this.waterMeshes.push(water);
    this.decorations.push(water);
  }

  /**
   * Add water curtains on specific edges of a water tile where it drops to a lower neighbor.
   * faces: array of { dx, dz } indicating which side has the drop (e.g. {dx:0, dz:-1} = north face)
   * dropHeight: how far the water drops (in world units)
   */
  addWaterEdgeCurtain(x: number, elevation: number, z: number, dx: number, dz: number, dropHeight: number): void {
    const tileWidth = 1.5;
    const halfW = tileWidth / 2;
    const outset = halfW + 0.20; // push in front of blocks
    const curtainH = dropHeight + 0.3;

    // Determine face position and rotation based on direction
    let px: number, pz: number, ry: number;
    if (dz !== 0) {
      // North or south face
      px = 0;
      pz = dz < 0 ? -outset : outset;
      ry = 0;
    } else {
      // East or west face
      px = dx < 0 ? -outset : outset;
      pz = 0;
      ry = Math.PI / 2;
    }

    const group = new THREE.Group();

    // Blue water curtain
    const wallGeo = new THREE.PlaneGeometry(tileWidth * 1.05, curtainH);
    const wallMat = new THREE.MeshPhongMaterial({
      color: 0x2196f3,
      transparent: true,
      opacity: 0.5,
      shininess: 120,
      specular: 0x88ccff,
      emissive: 0x0d47a1,
      emissiveIntensity: 0.06,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(px, -curtainH / 2 + 0.05, pz);
    wall.rotation.y = ry;
    group.add(wall);
    this.waterMeshes.push(wall);

    // White streaks
    const streakCount = 3 + Math.floor(Math.random() * 2);
    for (let s = 0; s < streakCount; s++) {
      const sw = 0.06 + Math.random() * 0.12;
      const sh = curtainH * (0.4 + Math.random() * 0.5);
      const streakGeo = new THREE.PlaneGeometry(sw, sh);
      const streakMat = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35 + Math.random() * 0.3,
        shininess: 60,
        emissive: 0xffffff,
        emissiveIntensity: 0.06,
        side: THREE.DoubleSide,
      });
      const streak = new THREE.Mesh(streakGeo, streakMat);
      const lateral = (Math.random() - 0.5) * tileWidth * 0.7;
      const vertOff = (Math.random() - 0.5) * curtainH * 0.25;
      const extra = 0.04;
      const sOutset = dz !== 0
        ? { x: lateral, z: (pz > 0 ? -extra : extra) }
        : { x: (px > 0 ? -extra : extra), z: lateral };
      streak.position.set(px + sOutset.x, -curtainH / 2 + vertOff, pz + sOutset.z);
      streak.rotation.y = ry;
      group.add(streak);
    }

    group.position.set(x, elevation + 0.05, z);
    this.scene.add(group);
    this.decorations.push(group);
  }

  private addSwampWater(x: number, elevation: number, z: number): void {
    const waterGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x556b2f,
      transparent: true,
      opacity: 0.45,
      shininess: 30,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, elevation + 0.03, z);
    this.scene.add(water);
    this.waterMeshes.push(water);
    this.decorations.push(water);
  }

  private addWaterfall(x: number, elevation: number, z: number, maxNeighborElevation: number): void {
    const group = new THREE.Group();
    const tileWidth = 1.5;
    const halfW = tileWidth / 2;
    const fallHeight = Math.max(1.5, elevation - 0.5);

    // Outward offset so curtains render IN FRONT of the block faces
    // Blocks extend to ~0.76 from center (offset 0.5 + voxelSize/2=0.26)
    // so we push curtains to 0.95 from center to be clearly visible
    const faceOutset = halfW + 0.20;

    // --- Water surface on top (blue river feeding into falls) ---
    const topGeo = new THREE.PlaneGeometry(tileWidth * 1.1, tileWidth * 1.1);
    const topMat = new THREE.MeshPhongMaterial({
      color: 0x1e88e5,
      transparent: true,
      opacity: 0.7,
      shininess: 120,
      specular: 0x88ccff,
      side: THREE.DoubleSide,
    });
    const topWater = new THREE.Mesh(topGeo, topMat);
    topWater.rotation.x = -Math.PI / 2;
    topWater.position.set(0, 0.08, 0);
    group.add(topWater);
    this.waterMeshes.push(topWater);

    // --- Glass water curtains on ALL 4 side faces, pushed OUTWARD past block geometry ---
    const faces = [
      { px: 0,         pz: -faceOutset, ry: 0 },
      { px: 0,         pz: faceOutset,  ry: 0 },
      { px: -faceOutset, pz: 0,         ry: Math.PI / 2 },
      { px: faceOutset,  pz: 0,         ry: Math.PI / 2 },
    ];

    for (const face of faces) {
      // Glass water curtain — visible in front of dark rock
      const curtainH = fallHeight + 0.5; // extend slightly past the block column
      const wallGeo = new THREE.PlaneGeometry(tileWidth * 1.1, curtainH);
      const wallMat = new THREE.MeshPhongMaterial({
        color: 0x2196f3,
        transparent: true,
        opacity: 0.55,
        shininess: 140,
        specular: 0x88ccff,
        emissive: 0x0d47a1,
        emissiveIntensity: 0.08,
        side: THREE.DoubleSide,
      });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(face.px, -curtainH / 2 + 0.1, face.pz);
      wall.rotation.y = face.ry;
      group.add(wall);
      this.waterMeshes.push(wall);

      // White water streaks flowing down each face
      const streakCount = 4 + Math.floor(Math.random() * 3);
      for (let s = 0; s < streakCount; s++) {
        const sw = 0.08 + Math.random() * 0.16;
        const sh = curtainH * (0.5 + Math.random() * 0.5);
        const streakGeo = new THREE.PlaneGeometry(sw, sh);
        const streakMat = new THREE.MeshPhongMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.45 + Math.random() * 0.35,
          shininess: 80,
          emissive: 0xffffff,
          emissiveIntensity: 0.1,
          side: THREE.DoubleSide,
        });
        const streak = new THREE.Mesh(streakGeo, streakMat);
        const lateral = (Math.random() - 0.5) * tileWidth * 0.8;
        const vertOff = (Math.random() - 0.5) * curtainH * 0.3;
        // Push streaks slightly further out than the curtain so they're on top
        const extraOut = 0.04;
        const outset = face.ry === 0
          ? { x: lateral, z: (face.pz > 0 ? -extraOut : extraOut) }
          : { x: (face.px > 0 ? -extraOut : extraOut), z: lateral };
        streak.position.set(face.px + outset.x, -curtainH / 2 + vertOff, face.pz + outset.z);
        streak.rotation.y = face.ry;
        group.add(streak);
      }
    }

    // --- Big billowing mist clouds that SPIN ---
    // These are large, overlapping, flattened spheres that create swirling fog
    const cloudSpread = tileWidth * 1.8;
    for (let i = 0; i < 12; i++) {
      const radius = 0.3 + Math.random() * 0.6;
      const mistGeo = new THREE.SphereGeometry(radius, 8, 6);
      const mistMat = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08 + Math.random() * 0.14,
        shininess: 5,
        side: THREE.DoubleSide,
      });
      const mist = new THREE.Mesh(mistGeo, mistMat);

      // Position clouds in a wide volume around the base and up the falls
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * cloudSpread * 0.6;
      mist.position.set(
        Math.cos(angle) * dist,
        -fallHeight + 0.2 + Math.random() * (fallHeight * 0.8),
        Math.sin(angle) * dist,
      );
      // Flatten into cloud/disc shapes
      mist.scale.set(
        1.0 + Math.random() * 0.8,
        0.3 + Math.random() * 0.4,
        1.0 + Math.random() * 0.8,
      );
      // Store spin data for animation
      mist.userData.spinSpeed = (Math.random() - 0.5) * 1.5;
      mist.userData.bobSpeed = 0.5 + Math.random() * 1.0;
      mist.userData.bobPhase = Math.random() * Math.PI * 2;
      mist.userData.isMistCloud = true;

      group.add(mist);
      this.mistClouds.push(mist);
      this.waterMeshes.push(mist);
    }

    // --- Sparkle particles scattered through the mist ---
    for (let i = 0; i < 15; i++) {
      const sparkleGeo = new THREE.SphereGeometry(0.015 + Math.random() * 0.025, 4, 4);
      const sparkleMat = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4 + Math.random() * 0.6,
        shininess: 200,
        specular: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.4 + Math.random() * 0.5,
      });
      const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
      const sAngle = Math.random() * Math.PI * 2;
      const sDist = Math.random() * cloudSpread * 0.5;
      sparkle.position.set(
        Math.cos(sAngle) * sDist,
        -fallHeight * 0.2 + Math.random() * fallHeight * 0.7,
        Math.sin(sAngle) * sDist,
      );
      sparkle.userData.sparklePhase = Math.random() * Math.PI * 2;
      group.add(sparkle);
      this.waterMeshes.push(sparkle);
    }

    // --- White spray / smoke at the TOP where water crashes over the edge ---
    // Brownian-motion style puffs clustered around the spill point
    const sprayCount = 18;
    for (let i = 0; i < sprayCount; i++) {
      const r = 0.12 + Math.random() * 0.28;
      const sprayGeo = new THREE.SphereGeometry(r, 6, 5);
      const sprayMat = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.15 + Math.random() * 0.25,
        shininess: 10,
        emissive: 0xffffff,
        emissiveIntensity: 0.06,
        side: THREE.DoubleSide,
      });
      const spray = new THREE.Mesh(sprayGeo, sprayMat);
      // Cluster around the top edge (y ~ 0) with some spreading outward
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * tileWidth * 0.8;
      spray.position.set(
        Math.cos(angle) * dist,
        -0.3 + Math.random() * 0.8, // concentrated near the top spill edge
        Math.sin(angle) * dist,
      );
      // Flatten slightly into wispy puff shapes
      spray.scale.set(
        0.8 + Math.random() * 0.6,
        0.4 + Math.random() * 0.3,
        0.8 + Math.random() * 0.6,
      );
      // Brownian drift animation data
      spray.userData.isMistCloud = true;
      spray.userData.spinSpeed = (Math.random() - 0.5) * 2.0; // faster spin for turbulence
      spray.userData.bobSpeed = 1.0 + Math.random() * 1.5; // quick bobbing
      spray.userData.bobPhase = Math.random() * Math.PI * 2;

      group.add(spray);
      this.mistClouds.push(spray);
      this.waterMeshes.push(spray);
    }

    // --- Rainbow arc in the mist ---
    const rainbowColors = [0xff0000, 0xff8800, 0xffff00, 0x00cc00, 0x0066ff, 0x4400aa, 0x8800ff];
    for (let i = 0; i < rainbowColors.length; i++) {
      const angle = (i / (rainbowColors.length - 1)) * Math.PI * 0.6 + Math.PI * 0.2;
      const arcR = fallHeight * 0.5 + i * 0.05;
      const bandGeo = new THREE.PlaneGeometry(0.05, fallHeight * 0.5);
      const bandMat = new THREE.MeshPhongMaterial({
        color: rainbowColors[i],
        transparent: true,
        opacity: 0.1,
        emissive: rainbowColors[i],
        emissiveIntensity: 0.12,
        side: THREE.DoubleSide,
      });
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(
        Math.cos(angle) * arcR * 0.4,
        -fallHeight * 0.45 + Math.sin(angle) * arcR,
        0.4,
      );
      band.rotation.z = angle - Math.PI / 2;
      group.add(band);
    }

    group.position.set(x, elevation, z);
    this.scene.add(group);
    this.decorations.push(group);
  }

  /**
   * Animate water tiles (call each frame)
   */
  updateWater(delta: number): void {
    this.waterTime += delta;
    for (const water of this.waterMeshes) {
      // Standard water bob
      water.position.y += Math.sin(this.waterTime * 2 + water.position.x) * 0.0008;

      // Sparkle twinkle
      if (water.userData.sparklePhase !== undefined) {
        const phase = water.userData.sparklePhase as number;
        const twinkle = 0.3 + Math.abs(Math.sin(this.waterTime * 3 + phase)) * 0.7;
        (water.material as THREE.MeshPhongMaterial).opacity = twinkle;
        (water.material as THREE.MeshPhongMaterial).emissiveIntensity = twinkle * 0.6;
        continue; // skip default opacity animation for sparkles
      }

      (water.material as THREE.MeshPhongMaterial).opacity =
        0.6 + Math.sin(this.waterTime * 1.5 + water.position.z) * 0.1;
    }

    // Spin and bob the mist clouds
    for (const cloud of this.mistClouds) {
      const spin = cloud.userData.spinSpeed as number;
      const bobSpd = cloud.userData.bobSpeed as number;
      const bobPhase = cloud.userData.bobPhase as number;

      cloud.rotation.y += spin * delta;
      cloud.position.y += Math.sin(this.waterTime * bobSpd + bobPhase) * 0.002;

      // Gentle opacity pulse for breathing effect
      const baseOpacity = 0.08 + Math.abs(Math.sin(this.waterTime * 0.5 + bobPhase)) * 0.08;
      (cloud.material as THREE.MeshPhongMaterial).opacity = baseOpacity;
    }
  }

  /**
   * Animate grass meshes swaying in the wind (call each frame).
   * Each mesh is a merged clump — rotate the whole mesh gently.
   */
  updateGrass(delta: number): void {
    this.grassTime += delta;
    for (const mesh of this.grassBlades) {
      const { swayPhase, swaySpeed, swayAmount } = mesh.userData;
      // Gentle lean on Z axis (wind direction)
      mesh.rotation.z = Math.sin(this.grassTime * swaySpeed + swayPhase) * swayAmount;
      // Slight X wobble for natural feel
      mesh.rotation.x = Math.sin(this.grassTime * swaySpeed * 0.7 + swayPhase + 1.5) * swayAmount * 0.4;
    }
  }

  /** Remove all water meshes near a world position (for damming) */
  removeWater(tileKey: string): void {
    // Parse hex key to get world coordinates
    const [q, r] = tileKey.split(',').map(Number);
    const worldX = q * 1.5;
    const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);
    const MATCH_DIST = 1.0; // Radius to match water meshes near this tile

    // Remove water meshes near this position
    const toRemove: THREE.Mesh[] = [];
    for (const water of this.waterMeshes) {
      const dx = water.position.x - worldX;
      const dz = water.position.z - worldZ;
      if (Math.sqrt(dx * dx + dz * dz) < MATCH_DIST) {
        toRemove.push(water);
        this.scene.remove(water);
        water.geometry.dispose();
        if (water.material instanceof THREE.Material) water.material.dispose();
        // Also remove from decorations array
        const idx = this.decorations.indexOf(water);
        if (idx !== -1) this.decorations.splice(idx, 1);
      }
    }
    // Remove from waterMeshes array
    this.waterMeshes = this.waterMeshes.filter(w => !toRemove.includes(w));
    // Also remove from mistClouds if any matched
    this.mistClouds = this.mistClouds.filter(c => !toRemove.includes(c as any));
  }

  dispose(): void {
    for (const obj of this.decorations) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    this.decorations = [];
    this.waterMeshes = [];
    this.mistClouds = [];
  }
}
