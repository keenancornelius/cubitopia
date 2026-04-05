// ============================================
// CUBITOPIA - WebGL Renderer Manager
// Enhanced with atmosphere, fog, and particles
// ============================================

import * as THREE from 'three';
import { EngineConfig } from '../types';

export class Renderer {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  private config: EngineConfig;
  private particles: THREE.Points | null = null;
  private particleTime: number = 0;
  private sunMesh: THREE.Mesh | null = null;
  private sunGlow: THREE.Mesh | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private sunTime: number = 0;

  constructor(config: EngineConfig) {
    this.config = config;
    this.scene = new THREE.Scene();

    // Sky gradient background
    this.scene.background = this.createSkyGradient();

    // No fog — removed to prevent terrain visibility issues

    // Create WebGL renderer
    const canvas = document.getElementById(config.canvasId) as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: config.antialias,
      alpha: false,
    });

    this.renderer.setSize(config.width, config.height);
    this.renderer.setPixelRatio(config.pixelRatio);

    if (config.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Tone mapping for richer colors
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Enable clipping planes for Y-level slicer
    this.renderer.localClippingEnabled = true;

    this.setupLighting();
    this.createParticles();
  }

  private createSkyGradient(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#050510');     // deep space at zenith
    gradient.addColorStop(0.2, '#0a0a1e');   // dark blue-black
    gradient.addColorStop(0.45, '#101830');  // deep twilight blue
    gradient.addColorStop(0.65, '#1a2540');  // mid sky
    gradient.addColorStop(0.8, '#253050');   // lighter blue near horizon
    gradient.addColorStop(0.92, '#3a3048');  // warm purple at horizon line
    gradient.addColorStop(1, '#4a3040');     // warm sunset-haze horizon

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  }

  private setupLighting(): void {
    // Warm ambient light
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.45);
    this.scene.add(ambientLight);

    // === VISIBLE SUN ===
    // Map center for a 50-tile map is roughly (37, 0, 37)
    const mapCenter = new THREE.Vector3(37, 0, 37);
    // Sun position: high above and offset from map center for angled shadows
    const sunPos = new THREE.Vector3(mapCenter.x + 30, 70, mapCenter.z - 10);

    // Main directional light — target the map center so light hits the terrain
    const sunLight = new THREE.DirectionalLight(0xffeedd, 2.2);
    sunLight.position.copy(sunPos);
    sunLight.target.position.copy(mapCenter);
    this.scene.add(sunLight.target); // target must be added to scene
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 300;
    // Shadow frustum centered on map
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);
    this.sunLight = sunLight;

    // Point light near the terrain for warm local illumination
    // Position it lower than the sun sphere so it actually reaches the ground
    const pointLightPos = new THREE.Vector3(mapCenter.x + 15, 30, mapCenter.z);
    const sunPointLight = new THREE.PointLight(0xffe8c0, 1.5, 160, 0.8);
    sunPointLight.position.copy(pointLightPos);
    this.scene.add(sunPointLight);

    // Glowing sun sphere (emissive, unlit)
    const sunGeo = new THREE.SphereGeometry(3.5, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.copy(sunPos);
    this.scene.add(sunMesh);
    this.sunMesh = sunMesh;

    // Sun glow halo (soft additive billboard)
    const glowGeo = new THREE.SphereGeometry(8, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xfff0c0,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const sunGlow = new THREE.Mesh(glowGeo, glowMat);
    sunGlow.position.copy(sunPos);
    this.scene.add(sunGlow);
    this.sunGlow = sunGlow;

    // Secondary glow ring (wider, fainter)
    const glow2Geo = new THREE.SphereGeometry(14, 12, 12);
    const glow2Mat = new THREE.MeshBasicMaterial({
      color: 0xffe8a0,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const sunGlow2 = new THREE.Mesh(glow2Geo, glow2Mat);
    sunGlow2.position.copy(sunPos);
    this.scene.add(sunGlow2);

    // Fill light from opposite side of sun (cool blue) — aimed at map center
    const fillLight = new THREE.DirectionalLight(0x8ec8f0, 0.35);
    fillLight.position.set(mapCenter.x - 30, 40, mapCenter.z + 30);
    fillLight.target.position.copy(mapCenter);
    this.scene.add(fillLight.target);
    this.scene.add(fillLight);

    // Hemisphere light — sky vs ground
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d6b2f, 0.4);
    this.scene.add(hemiLight);

    // Subtle rim light for depth (warm backlight from sun direction)
    const rimLight = new THREE.DirectionalLight(0xffc880, 0.25);
    rimLight.position.set(mapCenter.x - 20, 55, mapCenter.z + 20);
    rimLight.target.position.copy(mapCenter);
    this.scene.add(rimLight.target);
    this.scene.add(rimLight);
  }

  private createParticles(): void {
    const count = 200;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 20 + 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      sizes[i] = Math.random() * 2 + 0.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  private _particleFrameSkip = 0;

  updateParticles(delta: number): void {
    if (!this.particles) return;
    this.particleTime += delta;
    this.sunTime += delta;

    // Subtle sun glow pulse
    if (this.sunGlow) {
      const pulse = 1 + Math.sin(this.sunTime * 0.8) * 0.03;
      this.sunGlow.scale.setScalar(pulse);
      (this.sunGlow.material as THREE.MeshBasicMaterial).opacity = 0.10 + Math.sin(this.sunTime * 1.2) * 0.02;
    }

    // Throttle particle GPU upload to every 3rd frame — drift is barely visible
    if (++this._particleFrameSkip % 3 !== 0) return;

    const positions = this.particles.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < positions.length / 3; i++) {
      // Gentle floating drift
      positions[i * 3] += Math.sin(this.particleTime + i * 0.5) * 0.003;
      positions[i * 3 + 1] += Math.cos(this.particleTime * 0.5 + i) * 0.002;
      positions[i * 3 + 2] += Math.sin(this.particleTime * 0.3 + i * 0.7) * 0.003;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  render(camera: THREE.PerspectiveCamera): void {
    this.renderer.render(this.scene, camera);
  }

  /** Get WebGL renderer performance info (draw calls, triangles, textures, geometries) */
  getPerfInfo(): { drawCalls: number; triangles: number; textures: number; geometries: number; programs: number } {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      programs: info.programs?.length ?? 0,
    };
  }

  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.renderer.dispose();
  }

  /** Re-create the WebGLRenderer on the same canvas (used after title scene releases it). */
  reinitWebGL(): void {
    // Don't dispose the old renderer if the context was already lost/replaced
    try { this.renderer.dispose(); } catch {}

    const canvas = document.getElementById(this.config.canvasId) as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.config.antialias,
      alpha: false,
    });
    this.renderer.setSize(this.config.width, this.config.height);
    this.renderer.setPixelRatio(this.config.pixelRatio);
    if (this.config.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.localClippingEnabled = true;
  }

  /**
   * Spawn a 3D click indicator at a world position — a colored ring/dot/pole that fades out.
   * Moved from main.ts to keep Cubitopia class lean.
   */
  spawnClickIndicator(worldPos: THREE.Vector3, color: number, size = 0.8): void {
    // Outer ring
    const ringGeo = new THREE.RingGeometry(size * 0.6, size, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(worldPos);
    ring.position.y += 0.1;
    this.scene.add(ring);

    // Inner dot
    const dotGeo = new THREE.CircleGeometry(size * 0.15, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.copy(worldPos);
    dot.position.y += 0.12;
    this.scene.add(dot);

    // Vertical line (flag pole)
    const poleGeo = new THREE.BoxGeometry(0.03, 0.6, 0.03);
    const poleMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.copy(worldPos);
    pole.position.y += 0.4;
    this.scene.add(pole);

    // Animate: expand ring slightly, then fade out
    const scene = this.scene;
    let life = 1.0;
    const animate = () => {
      life -= 0.025;
      if (life <= 0) {
        scene.remove(ring); scene.remove(dot); scene.remove(pole);
        ringGeo.dispose(); ringMat.dispose();
        dotGeo.dispose(); dotMat.dispose();
        poleGeo.dispose(); poleMat.dispose();
        return;
      }
      ringMat.opacity = life * 0.7;
      dotMat.opacity = life * 0.9;
      poleMat.opacity = life * 0.8;
      const scale = 1 + (1 - life) * 0.3;
      ring.scale.set(scale, scale, scale);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
}
