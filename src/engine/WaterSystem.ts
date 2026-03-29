// ============================================
// CUBITOPIA - Stylized Water System
// Custom shader water with vertex displacement,
// toon shading, foam edges, and animated waves
// ============================================

import * as THREE from 'three';

// ---- Shader Code ----

const waterVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveFrequency;
  uniform float uWaveSpeed;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vWaveHeight;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // World position for wave calculation
    vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos4.xyz;

    // Multi-octave sine waves for organic movement
    float wave1 = sin(worldPos4.x * uWaveFrequency + uTime * uWaveSpeed) * uWaveHeight;
    float wave2 = sin(worldPos4.z * uWaveFrequency * 0.7 + uTime * uWaveSpeed * 0.8) * uWaveHeight * 0.6;
    float wave3 = sin((worldPos4.x + worldPos4.z) * uWaveFrequency * 1.3 + uTime * uWaveSpeed * 1.2) * uWaveHeight * 0.3;

    pos.y += wave1 + wave2 + wave3;
    vWaveHeight = wave1 + wave2 + wave3;

    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform float uOpacity;
  uniform float uFoamThreshold;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vWaveHeight;

  // Simple hash noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Smooth noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // Scrolling noise for surface detail
    vec2 scrollUV1 = vWorldPos.xz * 0.8 + uTime * vec2(0.04, 0.03);
    vec2 scrollUV2 = vWorldPos.xz * 1.2 + uTime * vec2(-0.03, 0.05);
    float n1 = noise(scrollUV1);
    float n2 = noise(scrollUV2);
    float surfaceNoise = (n1 + n2) * 0.5;

    // Toon-style color banding: mix between shallow and deep based on noise + wave
    float depthFactor = smoothstep(-0.02, 0.04, vWaveHeight) * 0.6 + surfaceNoise * 0.4;

    // Quantize for toon look (3 bands)
    depthFactor = floor(depthFactor * 4.0) / 4.0;

    vec3 baseColor = mix(uDeepColor, uShallowColor, depthFactor);

    // Foam / white highlights on wave crests
    float foam = smoothstep(uFoamThreshold, uFoamThreshold + 0.01, vWaveHeight);
    // Add noise-driven foam patches
    float foamNoise = noise(vWorldPos.xz * 2.5 + uTime * vec2(0.1, 0.08));
    foam += smoothstep(0.65, 0.75, foamNoise) * smoothstep(0.0, 0.02, vWaveHeight + 0.01);
    foam = clamp(foam, 0.0, 1.0);

    vec3 finalColor = mix(baseColor, uFoamColor, foam * 0.7);

    // Specular-like highlight from scrolling noise
    float spec = smoothstep(0.7, 0.85, surfaceNoise);
    finalColor += vec3(0.15, 0.2, 0.25) * spec;

    gl_FragColor = vec4(finalColor, uOpacity - foam * 0.05);
  }
`;

// ---- Water Tile Data ----
interface WaterTileInfo {
  x: number;
  z: number;
  elevation: number;
  type: 'river' | 'lake' | 'swamp';
}

// ---- Main Water System Class ----

export class WaterSystem {
  private scene: THREE.Scene;
  private waterMesh: THREE.Mesh | null = null;
  private waterMaterial: THREE.ShaderMaterial;
  private tiles: WaterTileInfo[] = [];
  private time: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: 0.045 },
        uWaveFrequency: { value: 3.0 },
        uWaveSpeed: { value: 1.8 },
        uShallowColor: { value: new THREE.Color(0x4fc3f7) }, // light cyan
        uDeepColor: { value: new THREE.Color(0x0d47a1) },     // deep blue
        uFoamColor: { value: new THREE.Color(0xe8f5e9) },     // white-green foam
        uOpacity: { value: 0.78 },
        uFoamThreshold: { value: 0.03 },
      },
    });
  }

  /** Register a water tile for batch rendering */
  addTile(worldX: number, worldZ: number, elevation: number, type: 'river' | 'lake' | 'swamp' = 'river'): void {
    this.tiles.push({ x: worldX, z: worldZ, elevation, type });
  }

  /** Build the merged water mesh from all registered tiles. Call once after all tiles added. */
  build(): void {
    if (this.tiles.length === 0) return;

    // Remove old mesh if rebuilding
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }

    const tileSize = 1.5;
    // Subdivide each tile plane for smooth wave displacement
    const subdivisions = 4; // 4x4 grid per tile for smooth waves
    const vertsPerTile = (subdivisions + 1) * (subdivisions + 1);
    const trisPerTile = subdivisions * subdivisions * 2;

    const totalVerts = this.tiles.length * vertsPerTile;
    const totalTris = this.tiles.length * trisPerTile;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const indices = new Uint32Array(totalTris * 3);

    let vertOffset = 0;
    let idxOffset = 0;

    for (const tile of this.tiles) {
      const baseVert = vertOffset / 3;
      const halfSize = tileSize / 2;
      const step = tileSize / subdivisions;

      // Generate subdivided quad vertices
      for (let iy = 0; iy <= subdivisions; iy++) {
        for (let ix = 0; ix <= subdivisions; ix++) {
          const lx = -halfSize + ix * step;
          const lz = -halfSize + iy * step;

          positions[vertOffset] = tile.x + lx;
          positions[vertOffset + 1] = tile.elevation + 0.06;
          positions[vertOffset + 2] = tile.z + lz;

          uvs[(vertOffset / 3) * 2] = ix / subdivisions;
          uvs[(vertOffset / 3) * 2 + 1] = iy / subdivisions;

          vertOffset += 3;
        }
      }

      // Generate triangle indices for the subdivided quad
      const cols = subdivisions + 1;
      for (let iy = 0; iy < subdivisions; iy++) {
        for (let ix = 0; ix < subdivisions; ix++) {
          const a = baseVert + iy * cols + ix;
          const b = a + 1;
          const c = a + cols;
          const d = c + 1;

          indices[idxOffset++] = a;
          indices[idxOffset++] = c;
          indices[idxOffset++] = b;

          indices[idxOffset++] = b;
          indices[idxOffset++] = c;
          indices[idxOffset++] = d;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    this.waterMesh = new THREE.Mesh(geometry, this.waterMaterial);
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 1; // render after opaque geometry
    this.scene.add(this.waterMesh);
  }

  /** Call every frame to animate the water */
  update(delta: number): void {
    this.time += delta;
    this.waterMaterial.uniforms.uTime.value = this.time;
  }

  /** Remove and clean up */
  dispose(): void {
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMaterial.dispose();
      this.waterMesh = null;
    }
    this.tiles = [];
  }

  /** Access the material for external tweaking */
  getMaterial(): THREE.ShaderMaterial {
    return this.waterMaterial;
  }

  /** Get tile count */
  getTileCount(): number {
    return this.tiles.length;
  }
}
