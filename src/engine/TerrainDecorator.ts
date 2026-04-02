// ============================================
// CUBITOPIA - Terrain Decorator
// Adds trees, rocks, flowers, and water effects
// ============================================

import * as THREE from 'three';
import { TerrainType, ResourceType, HexCoord } from '../types';
import { InstancedObjectManager } from './InstancedObjectManager';

const TREE_FOLIAGE_COLORS = [0x2e7d32, 0x388e3c, 0x43a047, 0x4caf50] as const;
const STAGE_TREE_COLORS = [
  [0x66bb6a, 0x81c784],
  [0x43a047, 0x4caf50],
  [0x2e7d32, 0x388e3c],
] as const;
const SNOW_PINE_COLORS = [0x1b5e20, 0x2e7d32, 0x33691e] as const;
const FLOWER_COLORS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0xc084fc, 0xff8fab] as const;
const DESERT_ROCK_COLORS = [0xc4a46c, 0xb8956a, 0xd4a96a, 0xc9935e] as const;
const JUNGLE_TREE_COLORS = [0x1b7a1e, 0x237b28, 0x2e7d32] as const;
const GRASS_VARIANT_COUNT = 4;

// Seeded random for consistent decoration placement
class SeededRand {
  private s: number;

  constructor(seed: number) {
    this.s = seed;
  }

  next(): number {
    this.s = (this.s * 16807 + 0) % 2147483647;
    return this.s / 2147483647;
  }
}

type Vec3Like = { x: number; y: number; z: number };

interface GeometryPart {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  position?: Vec3Like;
  rotation?: Vec3Like;
  scale?: Vec3Like;
}

interface InstanceDecorationRef {
  kind: 'instance';
  type: string;
  instanceId: number;
}

interface ObjectDecorationRef {
  kind: 'object';
  object: THREE.Object3D;
}

type TileDecorationRef = InstanceDecorationRef | ObjectDecorationRef;

interface GrassInstanceData {
  type: string;
  instanceId: number;
  position: THREE.Vector3;
  rotationY: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmount: number;
}

function coordKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

function worldFromCoord(coord: HexCoord): { x: number; z: number } {
  return {
    x: coord.q * 1.5,
    z: coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0),
  };
}

function createTransformMatrix(
  position: Vec3Like = { x: 0, y: 0, z: 0 },
  rotation: Vec3Like = { x: 0, y: 0, z: 0 },
  scale: Vec3Like = { x: 1, y: 1, z: 1 }
): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
  matrix.compose(
    new THREE.Vector3(position.x, position.y, position.z),
    quaternion,
    new THREE.Vector3(scale.x, scale.y, scale.z)
  );
  return matrix;
}

function createMergedGeometry(parts: GeometryPart[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];
  let totalVertices = 0;

  for (const part of parts) {
    const clone = part.geometry.clone();
    const geometry = clone.index ? clone.toNonIndexed() ?? clone : clone;
    if (geometry !== clone) clone.dispose();
    geometry.applyMatrix4(createTransformMatrix(part.position, part.rotation, part.scale));

    if (!geometry.getAttribute('normal')) {
      geometry.computeVertexNormals();
    }

    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = new THREE.Color(part.color);
    const colors = new Float32Array(positionAttr.count * 3);
    for (let i = 0; i < positionAttr.count; i++) {
      const offset = i * 3;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    prepared.push(geometry);
    totalVertices += positionAttr.count;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);

  let vertexOffset = 0;
  for (const geometry of prepared) {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    const arrayOffset = vertexOffset * 3;

    positions.set(positionAttr.array as ArrayLike<number>, arrayOffset);
    normals.set(normalAttr.array as ArrayLike<number>, arrayOffset);
    colors.set(colorAttr.array as ArrayLike<number>, arrayOffset);

    vertexOffset += positionAttr.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

function createTreeGeometry(foliageColor: THREE.ColorRepresentation, stage?: 0 | 1 | 2): THREE.BufferGeometry {
  const stageScales = [0.35, 0.65, 1.0] as const;
  const baseScale = stage === undefined ? 1 : stageScales[stage];
  const trunkRadius = stage === 0 ? 0.03 : stage === 1 ? 0.06 : 0.09;
  const trunkHeight = (stage === undefined ? 1.0 : 0.95) * baseScale;
  const foliageLayers = stage === undefined ? 3 : stage === 0 ? 1 : stage === 1 ? 2 : 3;
  const parts: GeometryPart[] = [
    {
      geometry: new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 5),
      color: stage === 0 ? 0x795548 : 0x5d4037,
      position: { x: 0, y: trunkHeight / 2, z: 0 },
    },
  ];

  for (let i = 0; i < foliageLayers; i++) {
    parts.push({
      geometry: new THREE.ConeGeometry((0.35 - i * 0.08) * baseScale, 0.4 * baseScale, 6),
      color: foliageColor,
      position: {
        x: 0,
        y: trunkHeight + i * 0.25 * baseScale + 0.1 * baseScale,
        z: 0,
      },
    });
  }

  return createMergedGeometry(parts);
}

function createSnowPineGeometry(foliageColor: THREE.ColorRepresentation): THREE.BufferGeometry {
  const trunkHeight = 1.0;
  const parts: GeometryPart[] = [
    {
      geometry: new THREE.CylinderGeometry(0.06, 0.09, trunkHeight, 5),
      color: 0x5d4037,
      position: { x: 0, y: trunkHeight / 2, z: 0 },
    },
  ];

  for (let i = 0; i < 3; i++) {
    const radius = 0.35 - i * 0.08;
    parts.push({
      geometry: new THREE.ConeGeometry(radius, 0.4, 6),
      color: foliageColor,
      position: { x: 0, y: trunkHeight + i * 0.25 + 0.1, z: 0 },
    });
    parts.push({
      geometry: new THREE.ConeGeometry(radius * 0.75, 0.12, 6),
      color: 0xf5f5f5,
      position: { x: 0, y: trunkHeight + i * 0.25 + 0.28, z: 0 },
    });
  }

  parts.push({
    geometry: new THREE.ConeGeometry(0.1, 0.12, 6),
    color: 0xfafafa,
    position: { x: 0, y: trunkHeight + 0.85, z: 0 },
  });

  return createMergedGeometry(parts);
}

function createFlowerStemGeometry(): THREE.BufferGeometry {
  return createMergedGeometry([
    {
      geometry: new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3),
      color: 0x2e7d32,
    },
  ]);
}

function createFlowerBloomGeometry(color: THREE.ColorRepresentation): THREE.BufferGeometry {
  return createMergedGeometry([
    {
      geometry: new THREE.SphereGeometry(0.04, 4, 4),
      color,
      position: { x: 0, y: 0.08, z: 0 },
    },
  ]);
}

function createCactusGeometry(withArm: boolean): THREE.BufferGeometry {
  const parts: GeometryPart[] = [
    {
      geometry: new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6),
      color: 0x558b2f,
      position: { x: 0, y: 0.25, z: 0 },
    },
  ];

  if (withArm) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.05, 0.06, 0.25, 5),
      color: 0x558b2f,
      position: { x: 0.12, y: 0.35, z: 0 },
      rotation: { x: 0, y: 0, z: -0.5 },
    });
  }

  return createMergedGeometry(parts);
}

function createJungleTreeGeometry(canopyColor: THREE.ColorRepresentation, includeLowerCanopy: boolean): THREE.BufferGeometry {
  const height = 0.9;
  const canopySize = 0.35;
  const parts: GeometryPart[] = [
    {
      geometry: new THREE.CylinderGeometry(0.03, 0.08, height, 5),
      color: 0x4e3b2a,
      position: { x: 0, y: height / 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0.08 },
    },
    {
      geometry: new THREE.SphereGeometry(canopySize, 6, 5),
      color: canopyColor,
      position: { x: 0, y: height + canopySize * 0.5, z: 0 },
      scale: { x: 1.2, y: 0.8, z: 1.2 },
    },
  ];

  if (includeLowerCanopy) {
    parts.push({
      geometry: new THREE.SphereGeometry(canopySize * 0.7, 5, 4),
      color: 0x2e7d32,
      position: { x: 0.05, y: height * 0.6, z: -0.05 },
    });
  }

  return createMergedGeometry(parts);
}

function createGrassClumpGeometry(stage: number, variantSeed: number): THREE.BufferGeometry {
  const rng = new SeededRand(variantSeed);
  const stageScale = [0.45, 0.75, 1.0][Math.min(stage, 2)];
  const bladeCount = [30, 50, 80][Math.min(stage, 2)];
  const colors = [
    new THREE.Color(0.35, 0.65, 0.12),
    new THREE.Color(0.30, 0.58, 0.10),
    new THREE.Color(0.45, 0.55, 0.12),
  ];
  const baseColor = colors[Math.min(stage, 2)];
  const positions: number[] = [];
  const normals: number[] = [];
  const vertColors: number[] = [];
  const spread = 0.85;

  for (let i = 0; i < bladeCount; i++) {
    const h = (0.2 + rng.next() * 0.2) * stageScale;
    const w = (0.04 + rng.next() * 0.03) * stageScale;
    const bx = (rng.next() - 0.5) * spread * 2;
    const bz = (rng.next() - 0.5) * spread * 2;
    const angle = rng.next() * Math.PI;
    const lean = (rng.next() - 0.5) * 0.3;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const shade = 0.85 + rng.next() * 0.3;
    const cr = baseColor.r * shade;
    const cg = baseColor.g * shade;
    const cb = baseColor.b * shade;
    const hw = w / 2;
    const pts = [
      [-hw, 0, 0],
      [hw, 0, 0],
      [-hw, h, lean * h],
      [hw, h, lean * h],
    ] as const;
    const transformed = pts.map(([px, py, pz]) => {
      const rx = px * cosA - pz * sinA + bx;
      const ry = py;
      const rz = px * sinA + pz * cosA + bz;
      return [rx, ry, rz] as const;
    });
    const nx = -sinA;
    const nz = cosA;

    positions.push(
      transformed[0][0], transformed[0][1], transformed[0][2],
      transformed[1][0], transformed[1][1], transformed[1][2],
      transformed[2][0], transformed[2][1], transformed[2][2],
      transformed[1][0], transformed[1][1], transformed[1][2],
      transformed[3][0], transformed[3][1], transformed[3][2],
      transformed[2][0], transformed[2][1], transformed[2][2]
    );

    for (let n = 0; n < 6; n++) {
      normals.push(nx, 0.3, nz);
      vertColors.push(cr, cg, cb);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertColors, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export class TerrainDecorator {
  private scene: THREE.Scene;
  private instancedObjects: InstancedObjectManager;
  private decorations: THREE.Object3D[] = [];
  private decorationsByTile: Map<string, TileDecorationRef[]> = new Map();
  private waterMeshes: THREE.Mesh[] = [];
  private mistClouds: THREE.Mesh[] = [];
  private waterTime = 0;
  grassClumpsByTile: Map<string, GrassInstanceData> = new Map();
  private grassTime = 0;
  /** When true, MOUNTAIN tiles get desert decorations (cacti/rocks) instead of trees */
  desertMode = false;
  /** Camera position reference for grass distance culling. Set externally each frame. */
  cameraWorldPos: { x: number; z: number } = { x: 0, z: 0 };
  private _grassFrameSkip = 0;
  private readonly tempEuler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.instancedObjects = new InstancedObjectManager(scene);
    this.registerInstancedTypes();
  }

  /** Apply Y-level clipping to all water decoration meshes (curtains, surfaces).
   *  Pass null to remove clipping. */
  setWaterClipPlane(clipPlane: THREE.Plane | null): void {
    const planes = clipPlane ? [clipPlane] : null;
    for (const mesh of this.waterMeshes) {
      if (mesh.material instanceof THREE.Material) {
        (mesh.material as THREE.MeshPhongMaterial).clippingPlanes = planes as THREE.Plane[] | null;
      }
    }
  }

  /** Apply Y-level clipping to ALL decoration meshes (trees, rocks, grass, flowers, water).
   *  Hides decorations above the slice level. Pass null to remove clipping. */
  setDecorationClipPlane(clipPlane: THREE.Plane | null): void {
    const planes = clipPlane ? [clipPlane] : null;
    this.instancedObjects.setClippingPlanes(planes);

    for (const mesh of this.waterMeshes) {
      if (mesh.material instanceof THREE.Material) {
        (mesh.material as THREE.MeshPhongMaterial).clippingPlanes = planes as THREE.Plane[] | null;
      }
    }

    for (const obj of this.decorations) {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
          child.material.clippingPlanes = planes as THREE.Plane[] | null;
        }
      });
    }

    for (const mesh of this.mistClouds) {
      if (mesh.material instanceof THREE.Material) {
        mesh.material.clippingPlanes = planes as THREE.Plane[] | null;
      }
    }
  }

  /** Remove all decorations on a specific tile (e.g. when a tree is chopped) */
  removeDecoration(coord: HexCoord): void {
    const key = coordKey(coord);
    const refs = this.decorationsByTile.get(key);
    if (!refs) return;

    const grass = this.grassClumpsByTile.get(key);

    for (const ref of refs) {
      if (ref.kind === 'instance') {
        this.instancedObjects.removeInstance(ref.type, ref.instanceId);
        if (grass && grass.type === ref.type && grass.instanceId === ref.instanceId) {
          this.grassClumpsByTile.delete(key);
        }
      } else {
        this.removeLooseDecorationObject(ref.object);
      }
    }

    this.decorationsByTile.delete(key);
  }

  /**
   * Decorate a tile. maxNeighborElevation prevents trees on tiles where
   * a much taller neighbor would cause visual clipping.
   */
  decorateTile(
    coord: HexCoord,
    terrain: TerrainType,
    elevation: number,
    maxNeighborElevation: number = elevation,
    resource: ResourceType | null = null
  ): void {
    const tileKey = coordKey(coord);
    const { x: worldX, z: worldZ } = worldFromCoord(coord);
    const rng = new SeededRand(coord.q * 1000 + coord.r);

    const treeElevation = elevation;
    const neighborTooTall = (maxNeighborElevation - treeElevation) > 2.5;

    switch (terrain) {
      case TerrainType.FOREST:
        if (!neighborTooTall) {
          if (elevation >= 6.5) {
            this.addSnowPine(worldX, treeElevation, worldZ, rng, tileKey);
            if (rng.next() > 0.6) this.addSnowPine(worldX + 0.3, treeElevation, worldZ + 0.3, rng, tileKey);
          } else {
            this.addTree(worldX, treeElevation, worldZ, rng, tileKey);
            if (rng.next() > 0.6) this.addTree(worldX + 0.3, treeElevation, worldZ + 0.3, rng, tileKey);
          }
        }
        break;
      case TerrainType.PLAINS:
        if (!neighborTooTall) {
          const hasGrassSurface = elevation < 3.0;
          if (hasGrassSurface && rng.next() > 0.7) this.addFlowers(worldX, treeElevation, worldZ, rng, tileKey);
          if (hasGrassSurface && rng.next() > 0.3) {
            this.addGrassAtStage(coord, treeElevation, 1 + (rng.next() > 0.5 ? 1 : 0));
          }
        }
        break;
      case TerrainType.MOUNTAIN:
        if (this.desertMode) {
          if (rng.next() > 0.6) this.addDesertRock(worldX, treeElevation, worldZ, rng, tileKey);
          if (rng.next() > 0.8) this.addDesertRock(worldX + 0.3, treeElevation, worldZ - 0.2, rng, tileKey);
          if (!neighborTooTall && rng.next() > 0.7) this.addCactus(worldX - 0.2, treeElevation, worldZ + 0.1, rng, tileKey);
        } else {
          if (rng.next() > 0.55) this.addRock(worldX, treeElevation, worldZ, rng, tileKey);
          if (rng.next() > 0.8) this.addRock(worldX + 0.3, treeElevation, worldZ - 0.2, rng, tileKey);
          if (!neighborTooTall && rng.next() > 0.65) {
            if (elevation >= 6.5) {
              this.addSnowPine(worldX - 0.2, treeElevation, worldZ + 0.1, rng, tileKey);
            } else {
              this.addTree(worldX - 0.2, treeElevation, worldZ + 0.1, rng, tileKey);
            }
          }
        }
        if (resource === ResourceType.IRON) {
          this.addIronOreVein(worldX, treeElevation, worldZ, rng, tileKey);
        }
        break;
      case TerrainType.WATER:
        break;
      case TerrainType.DESERT:
        if (rng.next() > 0.75) this.addCactus(worldX, elevation, worldZ, rng, tileKey);
        if (rng.next() > 0.85) {
          this.addTumbleweed(
            worldX + (rng.next() - 0.5) * 0.5,
            elevation,
            worldZ + (rng.next() - 0.5) * 0.5,
            rng,
            tileKey
          );
        }
        if (rng.next() > 0.92) {
          this.addDesertRock(
            worldX + (rng.next() - 0.5) * 0.4,
            elevation,
            worldZ + (rng.next() - 0.5) * 0.4,
            rng,
            tileKey
          );
        }
        break;
      case TerrainType.SNOW:
        if (rng.next() > 0.75) this.addRock(worldX, elevation, worldZ, rng, tileKey);
        break;
      case TerrainType.JUNGLE:
        if (!neighborTooTall) {
          this.addJungleTree(worldX, treeElevation, worldZ, rng, tileKey);
          if (rng.next() > 0.3) this.addJungleTree(worldX + 0.35, treeElevation, worldZ + 0.2, rng, tileKey);
          if (rng.next() > 0.5) this.addJungleTree(worldX - 0.2, treeElevation, worldZ - 0.3, rng, tileKey);
        }
        break;
      case TerrainType.RIVER:
        this.addWater(worldX, elevation, worldZ, tileKey);
        break;
      case TerrainType.LAKE:
        this.addWater(worldX, elevation, worldZ, tileKey);
        break;
      case TerrainType.WATERFALL:
        this.addWaterfall(worldX, elevation, worldZ, maxNeighborElevation, tileKey);
        break;
    }
  }

  /**
   * Add a tree at a specific growth stage (0=sapling, 1=young, 2=mature).
   * Scale and color vary by stage.
   */
  addTreeAtStage(coord: HexCoord, elevation: number, stage: number): void {
    const tileKey = coordKey(coord);
    const { x: worldX, z: worldZ } = worldFromCoord(coord);
    const clampedStage = Math.min(stage, 2) as 0 | 1 | 2;
    const rng = new SeededRand(coord.q * 1000 + coord.r + clampedStage * 7);
    const variant = Math.floor(rng.next() * STAGE_TREE_COLORS[clampedStage].length);
    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    const rotationY = rng.next() * Math.PI * 2;
    const scale = 0.95 + rng.next() * 0.1;
    const type = `tree_stage_${clampedStage}_${variant}`;
    const instanceId = this.instancedObjects.addInstance(
      type,
      { x: worldX + offsetX, y: elevation, z: worldZ + offsetZ },
      new THREE.Euler(0, rotationY, 0),
      { x: scale, y: scale, z: scale }
    );
    this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  /** Remove grass clump from a tile */
  removeGrassClump(tileKey: string): void {
    const existing = this.grassClumpsByTile.get(tileKey);
    if (!existing) return;

    this.instancedObjects.removeInstance(existing.type, existing.instanceId);
    this.grassClumpsByTile.delete(tileKey);

    const tileDecors = this.decorationsByTile.get(tileKey);
    if (!tileDecors) return;

    const filtered = tileDecors.filter(
      (ref) => ref.kind !== 'instance' || ref.type !== existing.type || ref.instanceId !== existing.instanceId
    );
    if (filtered.length > 0) {
      this.decorationsByTile.set(tileKey, filtered);
    } else {
      this.decorationsByTile.delete(tileKey);
    }
  }

  /** Check if a tile has grass */
  hasGrass(tileKey: string): boolean {
    return this.grassClumpsByTile.has(tileKey);
  }

  /** Legacy addGrass — now delegates to addGrassAtStage for map-generation */
  private addGrass(x: number, elevation: number, z: number, rng: SeededRand, coord?: HexCoord): void {
    if (!coord) return;
    void x;
    void z;
    void rng;
    this.addGrassAtStage(coord, elevation, 1);
  }

  private addTree(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const variant = Math.floor(rng.next() * TREE_FOLIAGE_COLORS.length);
    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    const rotationY = rng.next() * Math.PI * 2;
    const scale = 0.8 + rng.next() * 0.5;
    const type = `tree_mature_${variant}`;
    const instanceId = this.instancedObjects.addInstance(
      type,
      { x: x + offsetX, y: elevation, z: z + offsetZ },
      new THREE.Euler(0, rotationY, 0),
      { x: scale, y: scale, z: scale }
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  private addSnowPine(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const variant = Math.floor(rng.next() * SNOW_PINE_COLORS.length);
    const offsetX = (rng.next() - 0.5) * 0.3;
    const offsetZ = (rng.next() - 0.5) * 0.3;
    const rotationY = rng.next() * Math.PI * 2;
    const scale = 0.8 + rng.next() * 0.5;
    const type = `snow_pine_${variant}`;
    const instanceId = this.instancedObjects.addInstance(
      type,
      { x: x + offsetX, y: elevation, z: z + offsetZ },
      new THREE.Euler(0, rotationY, 0),
      { x: scale, y: scale, z: scale }
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  private addRock(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const size = 0.15 + rng.next() * 0.15;
    const yScale = 0.6 + rng.next() * 0.3;
    const color = new THREE.Color(0.45 + rng.next() * 0.1, 0.43 + rng.next() * 0.1, 0.4 + rng.next() * 0.1);
    const instanceId = this.instancedObjects.addInstance(
      'rock',
      {
        x: x + (rng.next() - 0.5) * 0.4,
        y: elevation - 0.05,
        z: z + (rng.next() - 0.5) * 0.4,
      },
      new THREE.Euler(rng.next(), rng.next(), rng.next()),
      { x: size, y: size * yScale, z: size },
      color
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, 'rock', instanceId);
  }

  /** Iron ore vein — cluster of rusty-orange rocks with metallic sheen */
  private addIronOreVein(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const count = 2 + Math.floor(rng.next() * 2);
    for (let i = 0; i < count; i++) {
      const size = 0.1 + rng.next() * 0.12;
      const rotation = new THREE.Euler(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
      const color = new THREE.Color(0.55 + rng.next() * 0.15, 0.25 + rng.next() * 0.1, 0.1 + rng.next() * 0.05);
      const instanceId = this.instancedObjects.addInstance(
        'iron_ore',
        {
          x: x + (rng.next() - 0.5) * 0.5,
          y: elevation - 0.06 + rng.next() * 0.04,
          z: z + (rng.next() - 0.5) * 0.5,
        },
        rotation,
        { x: size, y: size * (0.6 + rng.next() * 0.4), z: size },
        color
      );
      if (tileKey) this.trackInstanceDecoration(tileKey, 'iron_ore', instanceId);
    }
  }

  private addFlowers(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const count = 2 + Math.floor(rng.next() * 3);

    for (let i = 0; i < count; i++) {
      const variant = Math.floor(rng.next() * FLOWER_COLORS.length);
      const baseX = x + (rng.next() - 0.5) * 0.6;
      const baseY = elevation + 0.07;
      const baseZ = z + (rng.next() - 0.5) * 0.6;
      const scale = 0.9 + rng.next() * 0.2;
      const rotationY = rng.next() * Math.PI * 2;
      const rotation = new THREE.Euler(0, rotationY, 0);
      const scaleVec = { x: scale, y: scale, z: scale };
      const stemId = this.instancedObjects.addInstance('flower_stem', { x: baseX, y: baseY, z: baseZ }, rotation, scaleVec);
      const bloomType = `flower_bloom_${variant}`;
      const bloomId = this.instancedObjects.addInstance(bloomType, { x: baseX, y: baseY, z: baseZ }, rotation, scaleVec);

      if (tileKey) {
        this.trackInstanceDecoration(tileKey, 'flower_stem', stemId);
        this.trackInstanceDecoration(tileKey, bloomType, bloomId);
      }
    }
  }

  /**
   * Add a grass clump at a growth stage (0=short, 1=medium, 2=tall/harvestable).
   * Each stage uses a shared clump archetype and animates via per-instance transforms.
   */
  addGrassAtStage(coord: HexCoord, elevation: number, stage: number): void {
    const tileKey = coordKey(coord);
    const { x: worldX, z: worldZ } = worldFromCoord(coord);
    const clampedStage = Math.min(stage, 2);
    const rng = new SeededRand(coord.q * 997 + coord.r * 131 + clampedStage * 17);

    this.removeGrassClump(tileKey);

    const variant = Math.floor(rng.next() * GRASS_VARIANT_COUNT);
    const type = `grass_stage_${clampedStage}_${variant}`;
    const instanceId = this.instancedObjects.addInstance(type, { x: worldX, y: elevation, z: worldZ });
    const grassData: GrassInstanceData = {
      type,
      instanceId,
      position: new THREE.Vector3(worldX, elevation, worldZ),
      rotationY: 0,
      swayPhase: rng.next() * Math.PI * 2,
      swaySpeed: 1.8 + rng.next() * 0.6,
      swayAmount: 0.04 + clampedStage * 0.02,
    };

    this.grassClumpsByTile.set(tileKey, grassData);
    this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  private addCactus(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const type = rng.next() > 0.4 ? 'cactus_arm' : 'cactus_plain';
    const scale = 0.9 + rng.next() * 0.2;
    const instanceId = this.instancedObjects.addInstance(
      type,
      { x, y: elevation, z },
      new THREE.Euler(0, rng.next() * Math.PI * 2, 0),
      { x: scale, y: scale, z: scale }
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  private addTumbleweed(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const size = 0.12 + rng.next() * 0.1;
    const ballId = this.instancedObjects.addInstance(
      'tumbleweed_ball',
      { x, y: elevation, z },
      new THREE.Euler(rng.next() * Math.PI, rng.next() * Math.PI, 0),
      { x: size, y: size, z: size }
    );
    const coreId = this.instancedObjects.addInstance(
      'tumbleweed_core',
      { x, y: elevation, z },
      undefined,
      { x: size, y: size, z: size }
    );

    if (tileKey) {
      this.trackInstanceDecoration(tileKey, 'tumbleweed_ball', ballId);
      this.trackInstanceDecoration(tileKey, 'tumbleweed_core', coreId);
    }
  }

  private addDesertRock(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const scale = {
      x: 0.15 + rng.next() * 0.2,
      y: 0.1 + rng.next() * 0.15,
      z: 0.15 + rng.next() * 0.15,
    };
    const color = DESERT_ROCK_COLORS[Math.floor(rng.next() * DESERT_ROCK_COLORS.length)];
    const instanceId = this.instancedObjects.addInstance(
      'desert_rock',
      { x, y: elevation, z },
      new THREE.Euler((rng.next() - 0.5) * 0.3, rng.next() * Math.PI, 0),
      scale,
      color
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, 'desert_rock', instanceId);
  }

  private addJungleTree(x: number, elevation: number, z: number, rng: SeededRand, tileKey?: string): void {
    const colorIndex = Math.floor(rng.next() * JUNGLE_TREE_COLORS.length);
    const withLowerCanopy = rng.next() > 0.4 ? 1 : 0;
    const type = `jungle_tree_${colorIndex}_${withLowerCanopy}`;
    const scale = 0.9 + rng.next() * 0.5;
    const instanceId = this.instancedObjects.addInstance(
      type,
      { x, y: elevation, z },
      new THREE.Euler(0, rng.next() * Math.PI * 2, 0),
      { x: scale, y: scale, z: scale }
    );
    if (tileKey) this.trackInstanceDecoration(tileKey, type, instanceId);
  }

  private addWater(x: number, elevation: number, z: number, tileKey?: string): void {
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
    water.position.set(x, elevation + 0.05, z);
    this.scene.add(water);
    this.waterMeshes.push(water);
    this.trackLooseDecoration(water, tileKey);
  }

  /**
   * Add water curtains on specific edges of a water tile where it drops to a lower neighbor.
   * faces: array of { dx, dz } indicating which side has the drop (e.g. {dx:0, dz:-1} = north face)
   * dropHeight: how far the water drops (in world units)
   */
  addWaterEdgeCurtain(x: number, elevation: number, z: number, dx: number, dz: number, dropHeight: number): void {
    const tileWidth = 1.5;
    const halfW = tileWidth / 2;
    const outset = halfW + 0.20;
    const curtainH = Math.min(dropHeight + 0.3, 5);

    let px: number;
    let pz: number;
    let ry: number;
    if (dz !== 0) {
      px = 0;
      pz = dz < 0 ? -outset : outset;
      ry = 0;
    } else {
      px = dx < 0 ? -outset : outset;
      pz = 0;
      ry = Math.PI / 2;
    }

    const group = new THREE.Group();

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
    this.trackLooseDecoration(group);
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
    this.trackLooseDecoration(water);
  }

  private addWaterfall(x: number, elevation: number, z: number, maxNeighborElevation: number, tileKey?: string): void {
    void maxNeighborElevation;
    const group = new THREE.Group();
    const tileWidth = 1.5;
    const halfW = tileWidth / 2;
    const fallHeight = Math.min(Math.max(1.5, elevation - 0.5), 5);
    const faceOutset = halfW + 0.20;

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

    const faces = [
      { px: 0, pz: -faceOutset, ry: 0 },
      { px: 0, pz: faceOutset, ry: 0 },
      { px: -faceOutset, pz: 0, ry: Math.PI / 2 },
      { px: faceOutset, pz: 0, ry: Math.PI / 2 },
    ];

    for (const face of faces) {
      const curtainH = fallHeight + 0.5;
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
        const extraOut = 0.04;
        const outset = face.ry === 0
          ? { x: lateral, z: (face.pz > 0 ? -extraOut : extraOut) }
          : { x: (face.px > 0 ? -extraOut : extraOut), z: lateral };
        streak.position.set(face.px + outset.x, -curtainH / 2 + vertOff, face.pz + outset.z);
        streak.rotation.y = face.ry;
        group.add(streak);
      }
    }

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
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * cloudSpread * 0.6;
      mist.position.set(
        Math.cos(angle) * dist,
        -fallHeight + 0.2 + Math.random() * (fallHeight * 0.8),
        Math.sin(angle) * dist
      );
      mist.scale.set(
        1.0 + Math.random() * 0.8,
        0.3 + Math.random() * 0.4,
        1.0 + Math.random() * 0.8
      );
      mist.userData.spinSpeed = (Math.random() - 0.5) * 1.5;
      mist.userData.bobSpeed = 0.5 + Math.random() * 1.0;
      mist.userData.bobPhase = Math.random() * Math.PI * 2;
      mist.userData.isMistCloud = true;

      group.add(mist);
      this.mistClouds.push(mist);
      this.waterMeshes.push(mist);
    }

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
        Math.sin(sAngle) * sDist
      );
      sparkle.userData.sparklePhase = Math.random() * Math.PI * 2;
      group.add(sparkle);
      this.waterMeshes.push(sparkle);
    }

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
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * tileWidth * 0.8;
      spray.position.set(
        Math.cos(angle) * dist,
        -0.3 + Math.random() * 0.8,
        Math.sin(angle) * dist
      );
      spray.scale.set(
        0.8 + Math.random() * 0.6,
        0.4 + Math.random() * 0.3,
        0.8 + Math.random() * 0.6
      );
      spray.userData.isMistCloud = true;
      spray.userData.spinSpeed = (Math.random() - 0.5) * 2.0;
      spray.userData.bobSpeed = 1.0 + Math.random() * 1.5;
      spray.userData.bobPhase = Math.random() * Math.PI * 2;

      group.add(spray);
      this.mistClouds.push(spray);
      this.waterMeshes.push(spray);
    }

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
        0.4
      );
      band.rotation.z = angle - Math.PI / 2;
      group.add(band);
    }

    group.position.set(x, elevation, z);
    this.scene.add(group);
    this.trackLooseDecoration(group, tileKey);
  }

  /**
   * Animate water tiles (call each frame)
   */
  /** Frame counter for water animation throttle */
  private _waterFrameSkip = 0;

  updateWater(delta: number): void {
    this.waterTime += delta;
    // Animate every 3rd frame — water bob is subtle
    if (++this._waterFrameSkip % 3 !== 0) return;
    for (const water of this.waterMeshes) {
      water.position.y += Math.sin(this.waterTime * 2 + water.position.x) * 0.0008;

      if (water.userData.sparklePhase !== undefined) {
        const phase = water.userData.sparklePhase as number;
        const twinkle = 0.3 + Math.abs(Math.sin(this.waterTime * 3 + phase)) * 0.7;
        (water.material as THREE.MeshPhongMaterial).opacity = twinkle;
        (water.material as THREE.MeshPhongMaterial).emissiveIntensity = twinkle * 0.6;
        continue;
      }

      (water.material as THREE.MeshPhongMaterial).opacity =
        0.6 + Math.sin(this.waterTime * 1.5 + water.position.z) * 0.1;
    }

    for (const cloud of this.mistClouds) {
      const spin = cloud.userData.spinSpeed as number;
      const bobSpd = cloud.userData.bobSpeed as number;
      const bobPhase = cloud.userData.bobPhase as number;

      cloud.rotation.y += spin * delta;
      cloud.position.y += Math.sin(this.waterTime * bobSpd + bobPhase) * 0.002;

      const baseOpacity = 0.08 + Math.abs(Math.sin(this.waterTime * 0.5 + bobPhase)) * 0.08;
      (cloud.material as THREE.MeshPhongMaterial).opacity = baseOpacity;
    }
  }

  /**
   * Animate grass meshes swaying in the wind (call each frame).
   * Each grass tile is a single instanced clump updated in-place.
   */
  updateGrass(delta: number): void {
    this.grassTime += delta;
    // Animate every 3rd frame — sway is subtle enough that 20Hz looks fine
    if (++this._grassFrameSkip % 3 !== 0) return;

    const cx = this.cameraWorldPos.x;
    const cz = this.cameraWorldPos.z;
    const cullSq = 45 * 45;

    for (const grass of this.grassClumpsByTile.values()) {
      const dx = grass.position.x - cx;
      const dz = grass.position.z - cz;
      if (dx * dx + dz * dz > cullSq) continue;

      this.tempEuler.set(
        Math.sin(this.grassTime * grass.swaySpeed * 0.7 + grass.swayPhase + 1.5) * grass.swayAmount * 0.4,
        grass.rotationY,
        Math.sin(this.grassTime * grass.swaySpeed + grass.swayPhase) * grass.swayAmount
      );
      this.instancedObjects.updateInstance(grass.type, grass.instanceId, grass.position, this.tempEuler);
    }
  }

  /** Remove all water meshes near a world position (for damming) */
  removeWater(tileKey: string): void {
    const [q, r] = tileKey.split(',').map(Number);
    const worldX = q * 1.5;
    const worldZ = r * 1.5 + (q % 2 === 1 ? 0.75 : 0);
    const matchDist = 1.0;

    const toRemove: THREE.Mesh[] = [];
    for (const water of this.waterMeshes) {
      const dx = water.position.x - worldX;
      const dz = water.position.z - worldZ;
      if (Math.sqrt(dx * dx + dz * dz) < matchDist) {
        toRemove.push(water);
        this.scene.remove(water);
        water.geometry.dispose();
        if (water.material instanceof THREE.Material) water.material.dispose();
        const idx = this.decorations.indexOf(water);
        if (idx !== -1) this.decorations.splice(idx, 1);
      }
    }

    this.waterMeshes = this.waterMeshes.filter((w) => !toRemove.includes(w));
    this.mistClouds = this.mistClouds.filter((c) => !toRemove.includes(c));
  }

  /** Flush deferred bounding-sphere recomputation. Call once per frame. */
  flushBounds(): void {
    this.instancedObjects.flushBounds();
  }

  dispose(): void {
    this.instancedObjects.dispose();

    for (const obj of [...this.decorations]) {
      this.removeLooseDecorationObject(obj);
    }

    this.decorations = [];
    this.decorationsByTile.clear();
    this.waterMeshes = [];
    this.mistClouds = [];
    this.grassClumpsByTile.clear();
  }

  private registerInstancedTypes(): void {
    const treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    const grassMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    for (let i = 0; i < TREE_FOLIAGE_COLORS.length; i++) {
      this.instancedObjects.registerType(
        `tree_mature_${i}`,
        createTreeGeometry(TREE_FOLIAGE_COLORS[i]),
        treeMaterial.clone(),
        { castShadow: true, initialCapacity: 128 }
      );
    }

    for (let stage = 0; stage < STAGE_TREE_COLORS.length; stage++) {
      for (let variant = 0; variant < STAGE_TREE_COLORS[stage].length; variant++) {
        this.instancedObjects.registerType(
          `tree_stage_${stage}_${variant}`,
          createTreeGeometry(STAGE_TREE_COLORS[stage][variant], stage as 0 | 1 | 2),
          treeMaterial.clone(),
          { castShadow: true, initialCapacity: 96 }
        );
      }
    }

    for (let i = 0; i < SNOW_PINE_COLORS.length; i++) {
      this.instancedObjects.registerType(
        `snow_pine_${i}`,
        createSnowPineGeometry(SNOW_PINE_COLORS[i]),
        treeMaterial.clone(),
        { castShadow: true, initialCapacity: 128 }
      );
    }

    this.instancedObjects.registerType(
      'rock',
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      { castShadow: true, initialCapacity: 256 }
    );

    this.instancedObjects.registerType(
      'iron_ore',
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0.15, 0.06, 0.02),
      }),
      { castShadow: true, initialCapacity: 192 }
    );

    this.instancedObjects.registerType(
      'flower_stem',
      createFlowerStemGeometry(),
      treeMaterial.clone(),
      { castShadow: false, initialCapacity: 256 }
    );
    for (let i = 0; i < FLOWER_COLORS.length; i++) {
      this.instancedObjects.registerType(
        `flower_bloom_${i}`,
        createFlowerBloomGeometry(FLOWER_COLORS[i]),
        treeMaterial.clone(),
        { castShadow: false, initialCapacity: 256 }
      );
    }

    for (let stage = 0; stage <= 2; stage++) {
      for (let variant = 0; variant < GRASS_VARIANT_COUNT; variant++) {
        this.instancedObjects.registerType(
          `grass_stage_${stage}_${variant}`,
          createGrassClumpGeometry(stage, 1000 + stage * 97 + variant * 211),
          grassMaterial.clone(),
          { initialCapacity: 512, castShadow: false, receiveShadow: false }
        );
      }
    }

    this.instancedObjects.registerType(
      'cactus_plain',
      createCactusGeometry(false),
      treeMaterial.clone(),
      { castShadow: true, initialCapacity: 96 }
    );
    this.instancedObjects.registerType(
      'cactus_arm',
      createCactusGeometry(true),
      treeMaterial.clone(),
      { castShadow: true, initialCapacity: 96 }
    );

    const tumbleweedBall = new THREE.IcosahedronGeometry(1, 1);
    tumbleweedBall.translate(0, 1, 0);
    const tumbleweedCore = new THREE.IcosahedronGeometry(0.5, 0);
    tumbleweedCore.translate(0, 1, 0);
    this.instancedObjects.registerType(
      'tumbleweed_ball',
      tumbleweedBall,
      new THREE.MeshLambertMaterial({ color: 0xb8860b, wireframe: true }),
      { castShadow: false, initialCapacity: 96 }
    );
    this.instancedObjects.registerType(
      'tumbleweed_core',
      tumbleweedCore,
      new THREE.MeshLambertMaterial({ color: 0x8b7355 }),
      { castShadow: false, initialCapacity: 96 }
    );

    const desertRockGeometry = new THREE.BoxGeometry(1, 1, 1);
    desertRockGeometry.translate(0, 0.5, 0);
    this.instancedObjects.registerType(
      'desert_rock',
      desertRockGeometry,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      { castShadow: true, initialCapacity: 192 }
    );

    for (let colorIndex = 0; colorIndex < JUNGLE_TREE_COLORS.length; colorIndex++) {
      for (const lower of [0, 1] as const) {
        this.instancedObjects.registerType(
          `jungle_tree_${colorIndex}_${lower}`,
          createJungleTreeGeometry(JUNGLE_TREE_COLORS[colorIndex], lower === 1),
          treeMaterial.clone(),
          { castShadow: true, initialCapacity: 128 }
        );
      }
    }
  }

  private trackInstanceDecoration(tileKey: string, type: string, instanceId: number): void {
    if (!this.decorationsByTile.has(tileKey)) {
      this.decorationsByTile.set(tileKey, []);
    }
    this.decorationsByTile.get(tileKey)!.push({ kind: 'instance', type, instanceId });
  }

  private trackLooseDecoration(object: THREE.Object3D, tileKey?: string): void {
    this.decorations.push(object);
    if (!tileKey) return;
    if (!this.decorationsByTile.has(tileKey)) {
      this.decorationsByTile.set(tileKey, []);
    }
    this.decorationsByTile.get(tileKey)!.push({ kind: 'object', object });
  }

  private removeLooseDecorationObject(object: THREE.Object3D): void {
    const removedMeshes = new Set<THREE.Mesh>();
    this.scene.remove(object);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        removedMeshes.add(child);
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
    this.waterMeshes = this.waterMeshes.filter((mesh) => !removedMeshes.has(mesh));
    this.mistClouds = this.mistClouds.filter((mesh) => !removedMeshes.has(mesh));
    const idx = this.decorations.indexOf(object);
    if (idx !== -1) this.decorations.splice(idx, 1);
  }
}
