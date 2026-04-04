// ============================================
// CUBITOPIA - Sky Cloud System
// Dreamy cloud void shader for Skyland map.
// Replaces the ocean plane with billowing pastel
// clouds, rainbow prismatic edges, and golden light.
// ============================================

import * as THREE from 'three';

// ---- Vertex Shader: gentle billowing displacement ----
const cloudVertexShader = /* glsl */ `
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDisplacement;

  void main() {
    vUv = uv;
    vec3 pos = position;

    vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos4.xyz;

    // Slow billowing cloud motion — softer and slower than water
    float wave1 = sin(worldPos4.x * 0.8 + uTime * 0.3) * 0.15;
    float wave2 = sin(worldPos4.z * 0.6 + uTime * 0.25) * 0.12;
    float wave3 = sin((worldPos4.x + worldPos4.z) * 0.5 + uTime * 0.4) * 0.08;

    float displacement = wave1 + wave2 + wave3;
    pos.y += displacement;
    vDisplacement = displacement;

    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
  }
`;

// ---- Fragment Shader: pastel clouds with prismatic highlights ----
const cloudFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCloudWhite;
  uniform vec3 uCloudPink;
  uniform vec3 uCloudLavender;
  uniform vec3 uGoldenGlow;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDisplacement;

  // Hash noise
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

  // FBM for cloud layers
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  // Rainbow hue from position (prismatic edge highlights)
  vec3 rainbow(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  void main() {
    // Scrolling cloud noise at two speeds for depth
    vec2 scroll1 = vWorldPos.xz * 0.4 + uTime * vec2(0.02, 0.015);
    vec2 scroll2 = vWorldPos.xz * 0.7 + uTime * vec2(-0.018, 0.025);
    float cloud1 = fbm(scroll1);
    float cloud2 = fbm(scroll2);
    float cloudDensity = (cloud1 + cloud2) * 0.5;

    // Toon-style banding (3 soft bands)
    float banded = floor(cloudDensity * 4.0) / 4.0;

    // Base color: blend white → pink → lavender based on density
    vec3 baseColor = mix(uCloudWhite, uCloudPink, smoothstep(0.3, 0.6, banded));
    baseColor = mix(baseColor, uCloudLavender, smoothstep(0.6, 0.85, banded));

    // Golden glow from below (simulates warm sunlight through clouds)
    float glowFactor = smoothstep(-0.05, 0.15, vDisplacement);
    baseColor = mix(baseColor, uGoldenGlow, glowFactor * 0.2);

    // Prismatic rainbow highlights at cloud edges (where density transitions)
    float edgeFactor = abs(fract(cloudDensity * 3.0) - 0.5) * 2.0;
    float prismatic = smoothstep(0.6, 0.9, edgeFactor);
    float rainbowPhase = (vWorldPos.x + vWorldPos.z) * 0.08 + uTime * 0.05;
    vec3 rainbowColor = rainbow(rainbowPhase);
    baseColor = mix(baseColor, rainbowColor, prismatic * 0.25);

    // Bright highlights on cloud peaks
    float highlight = smoothstep(0.1, 0.2, vDisplacement);
    baseColor += vec3(0.08, 0.06, 0.1) * highlight;

    // Soft sparkle noise
    float sparkle = noise(vWorldPos.xz * 8.0 + uTime * 0.5);
    sparkle = smoothstep(0.85, 0.95, sparkle);
    baseColor += vec3(0.15, 0.12, 0.18) * sparkle;

    gl_FragColor = vec4(baseColor, uOpacity);
  }
`;

// ---- Sky Cloud System Class ----

export class SkyCloudSystem {
  private scene: THREE.Scene;
  private cloudMesh: THREE.Mesh | null = null;
  private cloudMaterial: THREE.ShaderMaterial;
  private time: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime:          { value: 0 },
        uCloudWhite:    { value: new THREE.Color(0xffffff) },  // pure white
        uCloudPink:     { value: new THREE.Color(0xfff0f5) },  // lavender blush
        uCloudLavender: { value: new THREE.Color(0xe6e0fa) },  // soft lavender
        uGoldenGlow:    { value: new THREE.Color(0xfff8dc) },  // cornsilk gold
        uOpacity:       { value: 0.88 },
      },
    });
  }

  /**
   * Build a large cloud plane covering the entire map area.
   * Placed below island elevation so it appears as a cloud sea.
   */
  build(mapSize: number): void {
    this.dispose();

    // Large subdivided plane for smooth wave displacement
    const worldSize = mapSize * 1.5 + 10; // slightly larger than map
    const subdivisions = 64; // smooth cloud surface
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, subdivisions, subdivisions);
    geometry.rotateX(-Math.PI / 2); // horizontal

    this.cloudMesh = new THREE.Mesh(geometry, this.cloudMaterial);
    this.cloudMesh.position.set(worldSize / 2 - 5, -6.0, worldSize / 2 - 5); // below island base depth (-5)
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.renderOrder = 0; // render before transparent blocks
    this.scene.add(this.cloudMesh);
  }

  /** Call every frame to animate clouds */
  update(delta: number): void {
    this.time += delta;
    this.cloudMaterial.uniforms.uTime.value = this.time;
  }

  /** Remove and clean up */
  dispose(): void {
    if (this.cloudMesh) {
      this.scene.remove(this.cloudMesh);
      this.cloudMesh.geometry.dispose();
      this.cloudMesh = null;
    }
  }

  /** Access the material for external tweaking */
  getMaterial(): THREE.ShaderMaterial {
    return this.cloudMaterial;
  }
}
