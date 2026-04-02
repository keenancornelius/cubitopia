import * as THREE from 'three';
import { UnitType } from '../types';
import type { UnitMeshGroup } from './UnitRenderer';

type WorldPos = { x: number; y: number; z: number };

export class ProjectileSystem {
  private readonly getUnitMeshesRef: () => Map<string, UnitMeshGroup>;
  private projectiles: Array<{
    mesh: THREE.Object3D;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTime: number;
    duration: number;
    arcHeight?: number;
    targetUnitId?: string;
    onImpact?: () => void;
  }> = [];
  private static _scratchV3a = new THREE.Vector3();
  private static _scratchV3b = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    deps: { getUnitMeshes: () => Map<string, UnitMeshGroup> },
  ) {
    this.getUnitMeshesRef = deps.getUnitMeshes;
  }

  private get unitMeshes(): Map<string, UnitMeshGroup> {
    return this.getUnitMeshesRef();
  }

  // Active trail emitters (attached to projectiles)
  private trailParticles: Array<{
    mesh: THREE.Mesh;
    velocity: { x: number; y: number; z: number };
    startTime: number;
    duration: number;
  }> = [];

  // ─── Particle pool (avoids per-frame geometry/material allocation) ───
  private _particlePool: THREE.Mesh[] = [];
  private _sharedParticleGeo: THREE.BoxGeometry | null = null;
  private _particleMatCache: Map<number, THREE.MeshBasicMaterial> = new Map();

  private getPooledParticle(color: number, opacity = 0.9): THREE.Mesh {
    if (!this._sharedParticleGeo) {
      this._sharedParticleGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
    }
    let mat = this._particleMatCache.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
      this._particleMatCache.set(color, mat);
    }
    let mesh: THREE.Mesh;
    if (this._particlePool.length > 0) {
      mesh = this._particlePool.pop()!;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      mesh.visible = true;
      mesh.scale.set(1, 1, 1);
    } else {
      mesh = new THREE.Mesh(this._sharedParticleGeo, mat.clone());
      (mesh.material as THREE.MeshBasicMaterial).transparent = true;
    }
    return mesh;
  }

  private returnParticleToPool(mesh: THREE.Mesh): void {
    mesh.visible = false;
    this.scene.remove(mesh);
    if (this._particlePool.length < 200) { // cap pool size
      this._particlePool.push(mesh);
    } else {
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
  /**
   * Fire an arrow projectile — shaft + fletching + arrowhead
   */
  fireArrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();
    // Shaft
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x8B4513 }) // wood brown
    );
    group.add(shaft);
    // Arrowhead (darker metal)
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x444444 })
    );
    head.position.z = 0.2;
    group.add(head);
    // Fletching (3 colored fins)
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.01, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xFF8800, transparent: true, opacity: 0.9 })
      );
      fin.position.z = -0.15;
      fin.rotation.z = (i / 3) * Math.PI * 2;
      group.add(fin);
    }
    group.position.set(fromPos.x, fromPos.y + 0.5, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.5, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    this.projectiles.push({ mesh: group as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.5, targetUnitId, onImpact });
  }

  /**
   * Fire an arrow that comically bounces off a shield unit on impact.
   * The arrow flies normally, then on impact spawns a ricocheting arrow
   * that tumbles and spins off at a random angle before fading out.
   */
  fireDeflectedArrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    // Fire a normal arrow first — the deflect visual triggers on impact
    const wrappedImpact = () => {
      // Call original impact callback (damage visuals, sound)
      if (onImpact) onImpact();
      // Spawn the comical bouncing arrow
      this.spawnDeflectedArrow(toPos);
    };
    this.fireArrow(fromPos, toPos, targetUnitId, wrappedImpact);
  }

  /**
   * Spawn a deflected arrow that tumbles away from impact point with spin.
   * Creates a comedic ricochet effect — arrow flips end over end and fades out.
   */
  private spawnDeflectedArrow(impactPos: { x: number; y: number; z: number }): void {
    const group = new THREE.Group();
    // Shaft (slightly bent for comedy)
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x8B4513 })
    );
    group.add(shaft);
    // Bent arrowhead (knocked askew)
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.06),
      new THREE.MeshLambertMaterial({ color: 0x666666 })
    );
    head.position.z = 0.17;
    head.rotation.x = 0.3; // Slightly bent
    group.add(head);
    // Fletching
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.01, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xFF8800, transparent: true, opacity: 0.9 })
      );
      fin.position.z = -0.12;
      fin.rotation.z = (i / 3) * Math.PI * 2;
      group.add(fin);
    }

    // Position at impact, slightly above
    const startY = impactPos.y + 0.6;
    group.position.set(impactPos.x, startY, impactPos.z);
    this.scene.add(group);

    // Random ricochet direction (upward + sideways)
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle) * (1.5 + Math.random() * 1.5);
    const vz = Math.sin(angle) * (1.5 + Math.random() * 1.5);
    const vy = 3 + Math.random() * 2; // Pop upward
    // Random spin speeds
    const spinX = (Math.random() - 0.5) * 20;
    const spinY = (Math.random() - 0.5) * 15;
    const spinZ = (Math.random() - 0.5) * 25;

    const startTime = performance.now() / 1000;
    const duration = 0.8 + Math.random() * 0.4; // 0.8–1.2 seconds
    const gravity = 8;

    // Animate via the trail particles array (reuse existing cleanup)
    const animateDeflect = () => {
      const now = performance.now() / 1000;
      const t = now - startTime;
      if (t >= duration) {
        this.scene.remove(group);
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        return;
      }
      const progress = t / duration;
      // Physics: position with gravity
      group.position.x = impactPos.x + vx * t;
      group.position.y = startY + vy * t - 0.5 * gravity * t * t;
      group.position.z = impactPos.z + vz * t;
      // Tumbling spin
      group.rotation.x += spinX * (1 / 60);
      group.rotation.y += spinY * (1 / 60);
      group.rotation.z += spinZ * (1 / 60);
      // Fade out in last 40%
      if (progress > 0.6) {
        const fade = 1 - (progress - 0.6) / 0.4;
        group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
            (child.material as any).opacity = fade;
            child.material.transparent = true;
          }
        });
      }
      requestAnimationFrame(animateDeflect);
    };
    requestAnimationFrame(animateDeflect);

    // Spawn a few spark particles at impact point (pooled)
    for (let i = 0; i < 6; i++) {
      const spark = this.getPooledParticle(i % 2 === 0 ? 0xFFDD44 : 0xFFFFFF, 0.9);
      spark.position.set(impactPos.x, impactPos.y + 0.5, impactPos.z);
      this.scene.add(spark);
      this.trailParticles.push({
        mesh: spark,
        velocity: {
          x: (Math.random() - 0.5) * 3,
          y: 1 + Math.random() * 2,
          z: (Math.random() - 0.5) * 3,
        },
        startTime: performance.now() / 1000,
        duration: 0.3 + Math.random() * 0.2,
      });
    }
  }

  /**
   * Spawn a deflected axe that tumbles away from a shield impact point.
   * Same physics as spawnDeflectedArrow but with an axe mesh.
   */
  spawnDeflectedAxe(impactPos: { x: number; y: number; z: number }): void {
    const group = new THREE.Group();
    // Handle
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.25, 0.04),
      new THREE.MeshLambertMaterial({ color: 0x5C3A1E })
    );
    group.add(handle);
    // Axe head (knocked askew)
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.10),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    blade.position.set(0, 0.15, 0.05);
    blade.rotation.x = 0.4; // Bent from impact
    group.add(blade);
    // Edge
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.06, 0.12),
      new THREE.MeshLambertMaterial({ color: 0xCCCCCC })
    );
    edge.position.set(0, 0.15, 0.12);
    edge.rotation.x = 0.4;
    group.add(edge);

    const startY = impactPos.y + 0.6;
    group.position.set(impactPos.x, startY, impactPos.z);
    this.scene.add(group);

    // Random ricochet direction
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle) * (1.5 + Math.random() * 1.5);
    const vz = Math.sin(angle) * (1.5 + Math.random() * 1.5);
    const vy = 3 + Math.random() * 2;
    const spinX = (Math.random() - 0.5) * 20;
    const spinY = (Math.random() - 0.5) * 15;
    const spinZ = (Math.random() - 0.5) * 25;

    const startTime = performance.now() / 1000;
    const duration = 0.8 + Math.random() * 0.4;
    const gravity = 8;

    const animateDeflect = () => {
      const now = performance.now() / 1000;
      const t = now - startTime;
      if (t >= duration) {
        this.scene.remove(group);
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        return;
      }
      const progress = t / duration;
      group.position.x = impactPos.x + vx * t;
      group.position.y = startY + vy * t - 0.5 * gravity * t * t;
      group.position.z = impactPos.z + vz * t;
      group.rotation.x += spinX * (1 / 60);
      group.rotation.y += spinY * (1 / 60);
      group.rotation.z += spinZ * (1 / 60);
      if (progress > 0.6) {
        const fade = 1 - (progress - 0.6) / 0.4;
        group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
            (child.material as any).opacity = fade;
            child.material.transparent = true;
          }
        });
      }
      requestAnimationFrame(animateDeflect);
    };
    requestAnimationFrame(animateDeflect);

    // Spark particles at impact (pooled)
    for (let i = 0; i < 8; i++) {
      const spark = this.getPooledParticle(i % 2 === 0 ? 0xFFDD44 : 0xFFFFFF, 0.9);
      spark.position.set(impactPos.x, impactPos.y + 0.5, impactPos.z);
      this.scene.add(spark);
      this.trailParticles.push({
        mesh: spark,
        velocity: {
          x: (Math.random() - 0.5) * 3,
          y: 1 + Math.random() * 2,
          z: (Math.random() - 0.5) * 3,
        },
        startTime: performance.now() / 1000,
        duration: 0.3 + Math.random() * 0.2,
      });
    }
  }

  /**
   * Fire a magic orb — glowing sphere + orbiting sparkles + trail
   */
  fireMagicOrb(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number, targetUnitId?: string, isAoE = false, onImpact?: () => void): void {
    const group = new THREE.Group();
    // Core glowing orb
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    group.add(core);
    // Bright inner glow
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.BackSide })
    );
    group.add(glow);
    // Orbiting sparkle ring (4 tiny cubes)
    for (let i = 0; i < 4; i++) {
      const sparkle = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
      );
      sparkle.name = `sparkle-${i}`;
      const angle = (i / 4) * Math.PI * 2;
      sparkle.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0);
      group.add(sparkle);
    }
    // Mark as magic for trail spawning in update loop
    (group as any)._magicColor = color;
    (group as any)._isAoE = isAoE;
    group.position.set(fromPos.x, fromPos.y + 0.5, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.5, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    this.projectiles.push({ mesh: group as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.6, targetUnitId, onImpact });
  }

  /**
   * Fire a lightning bolt — jagged electric arc from caster to target
   */
  fireLightningBolt(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();
    const start = new THREE.Vector3(fromPos.x, fromPos.y + 1.2, fromPos.z);
    const end = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    const segments = Math.max(5, Math.floor(dist * 4));

    // Build jagged bolt from segments
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.95 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4 });

    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const p0 = start.clone().lerp(end.clone(), t0);
      const p1 = start.clone().lerp(end.clone(), t1);
      // Add random jitter to middle segments (not first/last)
      if (i > 0 && i < segments - 1) {
        const jitter = 0.15;
        p0.x += (Math.random() - 0.5) * jitter;
        p0.y += (Math.random() - 0.5) * jitter;
        p0.z += (Math.random() - 0.5) * jitter;
      }
      if (i + 1 > 0 && i + 1 < segments - 1) {
        const jitter = 0.15;
        p1.x += (Math.random() - 0.5) * jitter;
        p1.y += (Math.random() - 0.5) * jitter;
        p1.z += (Math.random() - 0.5) * jitter;
      }
      const segDir = p1.clone().sub(p0);
      const segLen = segDir.length();
      // Core bolt segment
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, segLen), boltMat);
      seg.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
      seg.lookAt(p1);
      group.add(seg);
      // Glow around bolt
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, segLen), glowMat);
      glow.position.copy(seg.position);
      glow.lookAt(p1);
      group.add(glow);
    }
    // Bright flash at origin
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    flash.position.copy(start);
    group.add(flash);
    // Impact flash at end
    const impactFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0.8 })
    );
    impactFlash.position.copy(end);
    group.add(impactFlash);

    (group as any)._lightningBolt = true;
    (group as any)._spawnTime = performance.now() / 1000;
    (group as any)._duration = 0.35;
    this.scene.add(group);

    // Lightning is instant — no projectile travel, just display then impact
    setTimeout(() => {
      if (onImpact) onImpact();
      // Fade and remove
      setTimeout(() => {
        this.scene.remove(group);
        group.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
      }, 250);
    }, 80);
  }

  /**
   * Fire a secondary chain lightning arc between two positions (no projectile travel)
   */
  fireLightningChain(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, _targetUnitId?: string): void {
    const group = new THREE.Group();
    const start = new THREE.Vector3(fromPos.x, fromPos.y + 0.5, fromPos.z);
    const end = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    const segments = Math.max(3, Math.floor(dist * 3));

    const boltMat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.85 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x6688ff, transparent: true, opacity: 0.3 });

    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const p0 = start.clone().lerp(end.clone(), t0);
      const p1 = start.clone().lerp(end.clone(), t1);
      if (i > 0) {
        p0.x += (Math.random() - 0.5) * 0.12;
        p0.y += (Math.random() - 0.5) * 0.12;
        p0.z += (Math.random() - 0.5) * 0.12;
      }
      if (i + 1 < segments) {
        p1.x += (Math.random() - 0.5) * 0.12;
        p1.y += (Math.random() - 0.5) * 0.12;
        p1.z += (Math.random() - 0.5) * 0.12;
      }
      const segLen = p1.clone().sub(p0).length();
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, segLen), boltMat);
      seg.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
      seg.lookAt(p1);
      group.add(seg);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, segLen), glowMat);
      glow.position.copy(seg.position);
      glow.lookAt(p1);
      group.add(glow);
    }

    this.scene.add(group);
    // Auto-remove after brief display
    setTimeout(() => {
      this.scene.remove(group);
      group.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }, 300);
  }

  /**
   * Spawn electrocute visual on a unit — yellow flicker, sparks, mini lightning bolts
   */
  spawnElectrocuteEffect(unitId: string): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    const pos = entry.group.position;
    const startTime = performance.now();
    const duration = 600; // ms

    // Create sparks group
    const sparksGroup = new THREE.Group();
    sparksGroup.position.copy(pos);
    sparksGroup.position.y += 0.5;
    this.scene.add(sparksGroup);

    // 8-12 electric sparks
    const sparkCount = 8 + Math.floor(Math.random() * 5);
    const sparks: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[] = [];
    for (let i = 0; i < sparkCount; i++) {
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.08),
        new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xffff44 : 0x88ccff, transparent: true, opacity: 0.9 })
      );
      spark.position.set(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.3
      );
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      sparksGroup.add(spark);
      sparks.push({ mesh: spark, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2 + 1, vz: (Math.random() - 0.5) * 3 });
    }

    // 3-4 mini lightning bolts shooting out from unit
    for (let b = 0; b < 3 + Math.floor(Math.random() * 2); b++) {
      const angle = Math.random() * Math.PI * 2;
      const boltLen = 0.3 + Math.random() * 0.3;
      const bolt = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, boltLen),
        new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.8 })
      );
      bolt.position.set(
        Math.cos(angle) * 0.15,
        (Math.random() - 0.5) * 0.4,
        Math.sin(angle) * 0.15
      );
      bolt.lookAt(new THREE.Vector3(
        Math.cos(angle) * (0.15 + boltLen),
        bolt.position.y + (Math.random() - 0.5) * 0.2,
        Math.sin(angle) * (0.15 + boltLen)
      ));
      sparksGroup.add(bolt);
    }

    // Yellow flicker on the unit itself
    const origMaterials: Map<THREE.Mesh, THREE.Material> = new Map();
    const flickerMat = new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0.6 });
    entry.group.traverse((child: any) => {
      if (child.isMesh && child.material) {
        origMaterials.set(child, child.material);
      }
    });

    let flickerFrame = 0;
    const flickerInterval = setInterval(() => {
      flickerFrame++;
      const showFlicker = flickerFrame % 3 < 2;
      entry.group.traverse((child: any) => {
        if (child.isMesh && origMaterials.has(child)) {
          child.material = showFlicker ? flickerMat : origMaterials.get(child);
        }
      });
    }, 50);

    // Animate sparks outward
    const animSparks = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed > duration) {
        clearInterval(flickerInterval);
        // Restore original materials
        entry.group.traverse((child: any) => {
          if (child.isMesh && origMaterials.has(child)) {
            child.material = origMaterials.get(child);
          }
        });
        this.scene.remove(sparksGroup);
        sparksGroup.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
        return;
      }
      const dt = 0.016;
      const fade = 1 - elapsed / duration;
      for (const s of sparks) {
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.vy -= 4 * dt; // gravity
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
      }
      requestAnimationFrame(animSparks);
    };
    requestAnimationFrame(animSparks);
  }

  /**
   * Fire a flamethrower stream — multiple flame particles with black smoke trail
   */
  /**
   * Fire a flamethrower stream — long arcing flame with black smoke and dramatic fire trail
   */
  fireFlamethrower(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();

    // Bright muzzle flash core at staff
    const muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0.9 })
    );
    group.add(muzzle);

    // Core flame mass — large elongated fire blob
    const flameCoreInner = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 })
    );
    flameCoreInner.position.z = 0.15;
    group.add(flameCoreInner);

    const flameCoreOuter = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.6 })
    );
    flameCoreOuter.position.z = 0.1;
    flameCoreOuter.scale.set(1.2, 0.8, 1.5);
    group.add(flameCoreOuter);

    // Flame tendrils — 8-10 elongated fire pieces trailing behind
    const tendrilColors = [0xff2200, 0xff4400, 0xff6600, 0xff8800, 0xffaa00, 0xffcc00];
    for (let t = 0; t < 10; t++) {
      const color = tendrilColors[Math.floor(Math.random() * tendrilColors.length)];
      const size = 0.08 + Math.random() * 0.12;
      const tendril = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 0.6, size * 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 + Math.random() * 0.3 })
      );
      tendril.name = `tendril-${t}`;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.15;
      tendril.position.set(
        Math.cos(angle) * r,
        Math.sin(angle) * r,
        -0.1 - Math.random() * 0.3
      );
      tendril.rotation.set(Math.random() * 0.3, Math.random() * 0.3, Math.random() * 0.3);
      group.add(tendril);
    }

    // Black smoke plume — 6-8 dark particles trailing above flame
    for (let s = 0; s < 8; s++) {
      const smokeSize = 0.1 + Math.random() * 0.15;
      const smoke = new THREE.Mesh(
        new THREE.BoxGeometry(smokeSize, smokeSize, smokeSize),
        new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35 - s * 0.03 })
      );
      smoke.name = `smoke-${s}`;
      smoke.position.set(
        (Math.random() - 0.5) * 0.15,
        0.1 + s * 0.06,
        -0.15 - s * 0.05
      );
      group.add(smoke);
    }

    // Ember sparks — tiny bright particles that fly off
    for (let e = 0; e < 6; e++) {
      const ember = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.025, 0.025),
        new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.8 })
      );
      ember.name = `ember-${e}`;
      ember.position.set(
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        Math.random() * 0.1
      );
      group.add(ember);
    }

    (group as any)._flamethrower = true;
    (group as any)._magicColor = 0xff5500;
    group.position.set(fromPos.x, fromPos.y + 0.8, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.8, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.3, toPos.z);

    // Use the projectile system with a moderate arc
    this.projectiles.push({
      mesh: group as any, startPos, endPos,
      startTime: performance.now() / 1000, duration: 0.55,
      arcHeight: 1.2, targetUnitId, onImpact
    });
  }

  /**
   * Fire a massive stone column projectile — tumbling boulder that arcs toward target
   */
  fireStoneColumn(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();
    // Main stone column — rectangular pillar
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
    const stoneDkMat = new THREE.MeshLambertMaterial({ color: 0x6b5340 });
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.6, 0.55), stoneMat);
    group.add(column);
    // Stone texture detail — smaller blocks overlaid
    const detail1 = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.35, 0.60), stoneDkMat);
    detail1.position.y = 0.50;
    group.add(detail1);
    const detail2 = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.35, 0.60), stoneDkMat);
    detail2.position.y = -0.50;
    group.add(detail2);
    // Cracks/lines (thin dark strips)
    for (let i = 0; i < 3; i++) {
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.24 + Math.random() * 0.3, 0.28),
        new THREE.MeshBasicMaterial({ color: 0x3a2a1a })
      );
      crack.position.set((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.9, 0.28);
      group.add(crack);
    }
    // Dirt/dust particles orbiting
    for (let d = 0; d < 4; d++) {
      const dust = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.10, 0.10),
        new THREE.MeshBasicMaterial({ color: 0xaa9070, transparent: true, opacity: 0.6 })
      );
      dust.name = `dust-${d}`;
      const angle = (d / 4) * Math.PI * 2;
      dust.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
      group.add(dust);
    }

    (group as any)._stoneColumn = true;
    group.position.set(fromPos.x, fromPos.y + 1.0, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 1.0, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.3, toPos.z);
    this.projectiles.push({
      mesh: group as any, startPos, endPos,
      startTime: performance.now() / 1000, duration: 0.7,
      arcHeight: 4.0, targetUnitId, onImpact
    });
  }

  /**
   * Fire a water wave/splash projectile — flowing water stream
   */
  fireWaterWave(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x2288ff, transparent: true, opacity: 0.7 });
    const waterLightMat = new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.5 });
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xcceeFF, transparent: true, opacity: 0.6 });
    // Core water mass
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), waterMat);
    group.add(core);
    // Outer wave shape
    const wave = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), waterLightMat);
    wave.scale.set(1.3, 0.7, 1.0);
    group.add(wave);
    // Foam/spray on leading edge
    for (let f = 0; f < 5; f++) {
      const foam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), foamMat);
      foam.name = `foam-${f}`;
      foam.position.set((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.1 + 0.1, 0.15 + Math.random() * 0.1);
      group.add(foam);
    }
    // Trailing water droplets
    for (let d = 0; d < 4; d++) {
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), waterMat);
      drop.name = `drop-${d}`;
      drop.position.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15, -0.1 - Math.random() * 0.15);
      group.add(drop);
    }
    (group as any)._waterWave = true;
    (group as any)._magicColor = 0x2288ff;
    group.position.set(fromPos.x, fromPos.y + 0.6, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.6, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.3, toPos.z);
    this.projectiles.push({
      mesh: group as any, startPos, endPos,
      startTime: performance.now() / 1000, duration: 0.5,
      arcHeight: 0.5, targetUnitId, onImpact
    });
  }

  /**
   * Fire a wind tornado — spinning vortex that travels toward the target
   */
  fireWindTornado(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();

    // Build tornado from stacked rings that get wider toward the top
    const ringCount = 8;
    const windMat = new THREE.MeshBasicMaterial({ color: 0x88dd88, transparent: true, opacity: 0.35 });
    const windLightMat = new THREE.MeshBasicMaterial({ color: 0xccffcc, transparent: true, opacity: 0.25 });
    const debrisMat = new THREE.MeshBasicMaterial({ color: 0x886644, transparent: true, opacity: 0.7 });
    const leafMat = new THREE.MeshBasicMaterial({ color: 0x44aa44, transparent: true, opacity: 0.6 });

    // Funnel shape — rings of boxes forming a cone
    for (let r = 0; r < ringCount; r++) {
      const t = r / ringCount;
      const radius = 0.08 + t * 0.25; // wider at top
      const y = t * 1.2 - 0.3; // bottom to top
      const segCount = 6 + Math.floor(t * 4);
      for (let s = 0; s < segCount; s++) {
        const angle = (s / segCount) * Math.PI * 2;
        const size = 0.06 + t * 0.04;
        const ring = new THREE.Mesh(
          new THREE.BoxGeometry(size, 0.08, size),
          r % 2 === 0 ? windMat : windLightMat
        );
        ring.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        ring.name = `ring-${r}-${s}`;
        group.add(ring);
      }
    }

    // Debris particles orbiting inside (leaves, dirt, small rocks)
    for (let d = 0; d < 10; d++) {
      const isLeaf = Math.random() > 0.4;
      const debris = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.02, isLeaf ? 0.06 : 0.04),
        isLeaf ? leafMat : debrisMat
      );
      debris.name = `debris-${d}`;
      const angle = Math.random() * Math.PI * 2;
      const r = 0.05 + Math.random() * 0.2;
      const y = Math.random() * 1.0 - 0.2;
      debris.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      debris.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(debris);
    }

    // Dust cloud at base
    for (let dc = 0; dc < 5; dc++) {
      const dust = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.05, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xccbb99, transparent: true, opacity: 0.3 })
      );
      const a = (dc / 5) * Math.PI * 2;
      dust.position.set(Math.cos(a) * 0.15, -0.35, Math.sin(a) * 0.15);
      group.add(dust);
    }

    // White swirl lines (visible wind streaks)
    for (let w = 0; w < 4; w++) {
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.5 + Math.random() * 0.4, 0.015),
        new THREE.MeshBasicMaterial({ color: 0xeeffee, transparent: true, opacity: 0.4 })
      );
      const a = (w / 4) * Math.PI * 2;
      streak.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
      streak.rotation.z = 0.3 + Math.random() * 0.4;
      streak.name = `streak-${w}`;
      group.add(streak);
    }

    (group as any)._tornado = true;
    (group as any)._spawnTime = performance.now() / 1000;
    group.position.set(fromPos.x, fromPos.y + 0.3, fromPos.z);
    this.scene.add(group);

    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.3, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.3, toPos.z);
    const travelStart = performance.now() / 1000;
    const duration = 0.65;

    const animTornado = () => {
      const elapsed = performance.now() / 1000 - travelStart;
      if (elapsed > duration) {
        if (onImpact) onImpact();
        // Brief linger then remove
        setTimeout(() => {
          this.scene.remove(group);
          group.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
        }, 200);
        return;
      }
      const progress = elapsed / duration;
      // Move toward target
      group.position.lerpVectors(startPos, endPos, progress);
      group.position.y += Math.sin(progress * Math.PI) * 0.3; // slight arc
      // Spin the whole tornado
      group.rotation.y += 0.25;
      // Animate debris orbiting
      group.children.forEach((child: any) => {
        if (child.name?.startsWith('debris-')) {
          const a = performance.now() / 1000 * 5 + parseFloat(child.name.split('-')[1]) * 0.7;
          const r = 0.08 + Math.sin(a * 0.5) * 0.12;
          child.position.x = Math.cos(a) * r;
          child.position.z = Math.sin(a) * r;
          child.rotation.x += 0.15;
          child.rotation.z += 0.1;
        }
      });
      requestAnimationFrame(animTornado);
    };
    requestAnimationFrame(animTornado);
  }

  /**
   * Fire a green shimmering heal orb that arcs toward a friendly unit.
   * On impact, spawns water-splash + green glow-up heal effect.
   */
  fireHealOrb(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const group = new THREE.Group();
    // Core green heal orb (sphere)
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.9 })
    );
    group.add(core);
    // Bright green inner glow
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: 0.25, side: THREE.BackSide })
    );
    group.add(glow);
    // White shimmer sparkles orbiting (6 tiny cubes for extra shimmer)
    for (let i = 0; i < 6; i++) {
      const sparkle = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffffff : 0xb9f6ca, transparent: true, opacity: 0.85 })
      );
      sparkle.name = `sparkle-${i}`;
      const angle = (i / 6) * Math.PI * 2;
      sparkle.position.set(Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0);
      group.add(sparkle);
    }
    // Mark as magic (green) for trail system
    (group as any)._magicColor = 0x00e676;
    (group as any)._isHealOrb = true;
    group.position.set(fromPos.x, fromPos.y + 0.8, fromPos.z);
    this.scene.add(group);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.8, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    // Heal orb arcs higher and slower than attack orbs for a graceful feel
    this.projectiles.push({
      mesh: group as any, startPos, endPos,
      startTime: performance.now() / 1000,
      duration: 0.7,      // slightly slower than combat orbs
      arcHeight: 2.0,     // gentle healing arc
      targetUnitId,
      onImpact: () => {
        // Spawn water splash + green glow-up at impact point
        this.spawnHealImpact({ x: endPos.x, y: endPos.y - 0.5, z: endPos.z });
        if (onImpact) onImpact();
      },
    });
  }

  /**
   * Spawn a water-splash + green glow-up heal impact at the target position.
   * Water droplets splash outward, green column of light rises, green sparkles.
   */
  spawnHealImpact(pos: { x: number; y: number; z: number }): void {
    const t0 = performance.now() / 1000;
    const cx = pos.x, cy = pos.y, cz = pos.z;

    // --- Water splash droplets (radial burst outward + upward) ---
    const droplets: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 1.2 + Math.random() * 1.5;
      const droplet = new THREE.Mesh(
        new THREE.SphereGeometry(0.03 + Math.random() * 0.02, 5, 5),
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0x80deea : (i % 3 === 1 ? 0x4dd0e1 : 0xb2ebf2),
          transparent: true, opacity: 0.8
        })
      );
      droplet.position.set(cx, cy + 0.3, cz);
      this.scene.add(droplet);
      droplets.push({
        mesh: droplet,
        vx: Math.cos(angle) * speed,
        vy: 2.0 + Math.random() * 2.0,
        vz: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.3,
      });
    }

    // --- Green glow-up column (rising pillar of light) ---
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.35, 0.1, 8),
      new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.5 })
    );
    column.position.set(cx, cy + 0.1, cz);
    this.scene.add(column);

    // --- Green sparkle particles rising up ---
    const sparkles: Array<{ mesh: THREE.Mesh; vy: number; life: number }> = [];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0x69f0ae : 0xb9f6ca,
          transparent: true, opacity: 0.9
        })
      );
      sp.position.set(
        cx + (Math.random() - 0.5) * 0.4,
        cy + Math.random() * 0.3,
        cz + (Math.random() - 0.5) * 0.4
      );
      this.scene.add(sp);
      sparkles.push({ mesh: sp, vy: 1.0 + Math.random() * 1.5, life: 0.5 + Math.random() * 0.4 });
    }

    // --- Ground splash ring (expanding water ring) ---
    const splashRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.03, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0x80deea, transparent: true, opacity: 0.6 })
    );
    splashRing.position.set(cx, cy + 0.05, cz);
    splashRing.rotation.x = Math.PI / 2;
    this.scene.add(splashRing);

    const animate = () => {
      const elapsed = performance.now() / 1000 - t0;
      if (elapsed > 1.2) {
        // Cleanup all meshes
        for (const d of droplets) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); }
        for (const s of sparkles) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
        this.scene.remove(column); column.geometry.dispose(); (column.material as THREE.Material).dispose();
        this.scene.remove(splashRing); splashRing.geometry.dispose(); (splashRing.material as THREE.Material).dispose();
        return;
      }
      const dt = 0.016;

      // Animate water droplets (gravity + fade)
      for (const d of droplets) {
        d.life -= dt;
        d.vy -= 6.0 * dt; // gravity
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        const mat = d.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, d.life / 0.6);
      }

      // Animate green column (grows up, fades)
      const colProgress = Math.min(elapsed / 0.6, 1);
      const colHeight = 1.8 * colProgress;
      column.scale.set(1 - colProgress * 0.3, colHeight / 0.1, 1 - colProgress * 0.3);
      column.position.y = cy + 0.1 + colHeight * 0.5;
      (column.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - colProgress * 0.8);

      // Animate rising sparkles
      for (const s of sparkles) {
        s.life -= dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.rotation.y += 3 * dt;
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, s.life / 0.7);
        s.mesh.scale.setScalar(Math.max(0, s.life / 0.7));
      }

      // Animate expanding splash ring
      const ringProgress = Math.min(elapsed / 0.5, 1);
      const ringScale = 1 + ringProgress * 4;
      splashRing.scale.set(ringScale, ringScale, 1);
      (splashRing.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ringProgress);

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /**
   * Fire a generic projectile (legacy fallback)
   */
  fireProjectile(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number = 0xFF8800, targetUnitId?: string, onImpact?: () => void): void {
    const arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const arrowMat = new THREE.MeshBasicMaterial({ color });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(fromPos.x, fromPos.y + 0.5, fromPos.z);
    this.scene.add(arrow);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.5, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    this.projectiles.push({ mesh: arrow, startPos, endPos, startTime: performance.now() / 1000, duration: 0.5, targetUnitId, onImpact });
  }

  /**
   * Spawn a massive AoE explosion at a hex position.
   * Firecracker sparks shoot from center, smoke puffs billow, fire flashes on surrounding hexes.
   * @param centerWorld world position of impact center
   * @param radius number of hex rings to affect (1 = 7 hexes, 2 = 19 hexes)
   * @param color primary explosion color
   */
  spawnAoEExplosion(centerWorld: { x: number; y: number; z: number }, radius: number, color: number): void {
    const t = performance.now() / 1000;
    const cx = centerWorld.x, cy = centerWorld.y, cz = centerWorld.z;

    // === PHASE 1: Central flash burst ===
    const flashGeo = new THREE.SphereGeometry(0.6, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 1.0 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(cx, cy + 0.5, cz);
    this.scene.add(flash);
    // Animate flash: expand + fade
    const flashStart = t;
    const animFlash = () => {
      const elapsed = performance.now() / 1000 - flashStart;
      if (elapsed > 0.3) {
        this.scene.remove(flash);
        flashGeo.dispose(); flashMat.dispose();
        return;
      }
      const p = elapsed / 0.3;
      const s = 1 + p * 3;
      flash.scale.set(s, s, s);
      flashMat.opacity = 1.0 - p;
      requestAnimationFrame(animFlash);
    };
    requestAnimationFrame(animFlash);

    // === PHASE 2: Firecracker sparks shooting out from center ===
    const sparkCount = 25 + radius * 15;
    for (let i = 0; i < sparkCount; i++) {
      const isWhite = Math.random() > 0.5;
      const sparkColor = isWhite ? 0xFFFFCC : color;
      const spark = this.getPooledParticle(sparkColor, 1.0);
      spark.position.set(cx, cy + 0.5, cz);
      this.scene.add(spark);

      // Random direction — radiate outward with upward bias
      const angle = Math.random() * Math.PI * 2;
      const upAngle = Math.random() * Math.PI * 0.6; // mostly upward
      const speed = 2 + Math.random() * 4;
      const vx = Math.cos(angle) * Math.sin(upAngle) * speed;
      const vy = Math.cos(upAngle) * speed * 0.8 + 1;
      const vz = Math.sin(angle) * Math.sin(upAngle) * speed;

      const startTime = t + Math.random() * 0.05; // slight stagger
      const duration = 0.4 + Math.random() * 0.5;

      this.trailParticles.push({
        mesh: spark, velocity: { x: vx, y: vy, z: vz },
        startTime, duration,
      });
    }

    // === PHASE 3: Smoke puffs billowing outward ===
    const smokeCount = 8 + radius * 4;
    for (let i = 0; i < smokeCount; i++) {
      const smokeGeo = new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 6, 6);
      const smokeMat = new THREE.MeshBasicMaterial({
        color: 0x333333, transparent: true, opacity: 0.6,
      });
      const smoke = new THREE.Mesh(smokeGeo, smokeMat);
      const sAngle = Math.random() * Math.PI * 2;
      const sDist = Math.random() * 0.5;
      smoke.position.set(cx + Math.cos(sAngle) * sDist, cy + 0.3, cz + Math.sin(sAngle) * sDist);
      this.scene.add(smoke);

      const smokeStart = t + Math.random() * 0.15;
      const smokeDuration = 0.8 + Math.random() * 0.6;
      const svx = Math.cos(sAngle) * (0.5 + Math.random() * 1.0);
      const svy = 0.8 + Math.random() * 1.5;
      const svz = Math.sin(sAngle) * (0.5 + Math.random() * 1.0);

      this.trailParticles.push({
        mesh: smoke, velocity: { x: svx, y: svy, z: svz },
        startTime: smokeStart, duration: smokeDuration,
      });
    }

    // === PHASE 4: Fire flashes on hex positions in the AoE radius ===
    // Generate hex ring positions around center
    const hexPositions: Array<{ x: number; z: number }> = [{ x: cx, z: cz }]; // center hex
    for (let ring = 1; ring <= radius; ring++) {
      const hexesInRing = 6 * ring;
      for (let h = 0; h < hexesInRing; h++) {
        const hAngle = (h / hexesInRing) * Math.PI * 2;
        const hx = cx + Math.cos(hAngle) * ring * 1.5;
        const hz = cz + Math.sin(hAngle) * ring * 1.5;
        hexPositions.push({ x: hx, z: hz });
      }
    }

    for (let hi = 0; hi < hexPositions.length; hi++) {
      const hp = hexPositions[hi];
      const delay = 0.02 + hi * 0.015 + Math.random() * 0.05; // ripple outward

      // Fire column flash
      const fireGeo = new THREE.BoxGeometry(0.8, 0.4, 0.8);
      const fireMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.0,
      });
      const fire = new THREE.Mesh(fireGeo, fireMat);
      fire.position.set(hp.x, cy + 0.2, hp.z);
      this.scene.add(fire);

      // Ember particles shooting up from each hex (pooled)
      const emberCount = 3 + Math.floor(Math.random() * 3);
      for (let ei = 0; ei < emberCount; ei++) {
        const emberColor = Math.random() > 0.3 ? color : 0xFFCC00;
        const ember = this.getPooledParticle(emberColor, 1.0);
        ember.position.set(hp.x + (Math.random() - 0.5) * 0.5, cy + 0.3, hp.z + (Math.random() - 0.5) * 0.5);
        this.scene.add(ember);
        this.trailParticles.push({
          mesh: ember,
          velocity: { x: (Math.random() - 0.5) * 1.5, y: 2 + Math.random() * 3, z: (Math.random() - 0.5) * 1.5 },
          startTime: t + delay, duration: 0.4 + Math.random() * 0.4,
        });
      }

      // Animate fire flash: appear → peak → fade
      const fireStart = t + delay;
      const fireDur = 0.3 + Math.random() * 0.15;
      const animFire = () => {
        const elapsed = performance.now() / 1000 - fireStart;
        if (elapsed < 0) { requestAnimationFrame(animFire); return; }
        if (elapsed > fireDur) {
          this.scene.remove(fire);
          fireGeo.dispose(); fireMat.dispose();
          return;
        }
        const p = elapsed / fireDur;
        // Quick flash up, slow fade
        if (p < 0.3) {
          fireMat.opacity = (p / 0.3) * 0.7;
          const s = 1 + p * 2;
          fire.scale.set(1, s, 1);
        } else {
          fireMat.opacity = 0.7 * (1 - (p - 0.3) / 0.7);
          fire.scale.y = 1 + 0.6 * (1 - (p - 0.3) / 0.7);
        }
        fire.position.y = cy + 0.2 + fire.scale.y * 0.15;
        requestAnimationFrame(animFire);
      };
      requestAnimationFrame(animFire);
    }
  }

  /** Update trail particles (sparks, smoke, embers) — gravity + fade */
  updateTrailParticles(): void {
    const now = performance.now() / 1000;
    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const tp = this.trailParticles[i];
      const elapsed = now - tp.startTime;
      if (elapsed < 0) continue; // not started yet (delayed spawn)
      const progress = elapsed / tp.duration;
      if (progress >= 1) {
        this.returnParticleToPool(tp.mesh);
        this.trailParticles.splice(i, 1);
        continue;
      }
      // Apply velocity + gravity
      const dt = 0.016;
      tp.mesh.position.x += tp.velocity.x * dt;
      tp.mesh.position.y += tp.velocity.y * dt;
      tp.mesh.position.z += tp.velocity.z * dt;
      tp.velocity.y -= 6 * dt; // gravity
      // Drag
      tp.velocity.x *= 0.98;
      tp.velocity.z *= 0.98;
      // Fade
      const mat = tp.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - progress) * (mat.opacity > 0 ? 1 : 0);
    }
  }

  /**
   * Fire a boulder (trebuchet) — queues the shot so it syncs with the throw animation.
   * The actual boulder spawns when the arm reaches the release point in animateAttacking.
   */
  fireBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
    // Find the siege unit at this position and queue the fire
    for (const [, entry] of this.unitMeshes) {
      if ((entry.unitType === UnitType.TREBUCHET) &&
          Math.abs(entry.group.position.x - fromPos.x) < 1.5 &&
          Math.abs(entry.group.position.z - fromPos.z) < 1.5 &&
          !entry.trebPendingTarget) {
        entry.trebFireStart = performance.now() / 1000;
        entry.trebPendingTarget = { ...toPos };
        entry.trebOnImpact = onImpact;
        return;
      }
    }
    // Fallback: no matching unit found, fire immediately
    this.spawnBoulder(fromPos, toPos, onImpact);
  }

  /** Actually spawn the boulder projectile (called at the animation release point) */
  spawnBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
    const boulderGroup = new THREE.Group();
    const stoneGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    boulderGroup.add(new THREE.Mesh(stoneGeo, stoneMat));
    for (let i = 0; i < 3; i++) {
      const debris = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x999999 })
      );
      debris.position.set((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, -0.1 - Math.random() * 0.1);
      boulderGroup.add(debris);
    }
    const launchY = fromPos.y + 1.8;
    boulderGroup.position.set(fromPos.x, launchY, fromPos.z);
    this.scene.add(boulderGroup);
    const startPos = new THREE.Vector3(fromPos.x, launchY, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.3, toPos.z);
    this.projectiles.push({ mesh: boulderGroup as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.9, arcHeight: 5, onImpact });
  }

  /**
   * Fire a spinning thrown axe projectile (Berserker special ability).
   * The axe tumbles end-over-end in a gentle arc toward the target, then
   * triggers the onImpact callback (damage + slow debuff).
   */
  fireAxeThrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    const axeGroup = new THREE.Group();

    // --- Axe handle (dark wood) ---
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x5C3A1E });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 0.04), handleMat);
    handle.position.y = 0;
    axeGroup.add(handle);

    // --- Axe head (iron) ---
    const ironMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.12), ironMat);
    blade.position.set(0, 0.18, 0.06);
    axeGroup.add(blade);

    // --- Cutting edge (bright steel) ---
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0xCCCCCC });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.14), edgeMat);
    edge.position.set(0, 0.18, 0.14);
    axeGroup.add(edge);

    // --- Beard hook ---
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.06), ironMat);
    beard.position.set(0, 0.24, 0.06);
    axeGroup.add(beard);

    // Launch from chest height
    const launchY = fromPos.y + 0.8;
    axeGroup.position.set(fromPos.x, launchY, fromPos.z);
    this.scene.add(axeGroup);

    const startPos = new THREE.Vector3(fromPos.x, launchY, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);

    // Tag the mesh so updateProjectiles knows to spin it
    (axeGroup as any)._isAxeThrow = true;

    this.projectiles.push({
      mesh: axeGroup as any,
      startPos,
      endPos,
      startTime: performance.now() / 1000,
      duration: 0.7,       // slightly slower than arrow, faster than boulder
      arcHeight: 1.5,      // gentle arc
      targetUnitId,
      onImpact,
    });
  }

  /**
   * Update all active projectiles (call this in the game loop)
   */
  updateProjectiles(delta: number): void {
    const currentTime = performance.now() / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];

      // Track live target position if we have a target unit ID
      if (proj.targetUnitId) {
        const targetEntry = this.unitMeshes.get(proj.targetUnitId);
        if (targetEntry) {
          proj.endPos.set(targetEntry.group.position.x, targetEntry.group.position.y + 0.5, targetEntry.group.position.z);
        }
      }

      const elapsed = currentTime - proj.startTime;
      const progress = Math.min(elapsed / proj.duration, 1);

      if (progress < 1) {
        const height = proj.arcHeight ?? 3;
        const arcY = Math.sin(progress * Math.PI) * height;

        const pos = ProjectileSystem._scratchV3a;
        pos.lerpVectors(proj.startPos, proj.endPos, progress);
        pos.y = proj.startPos.y + (proj.endPos.y - proj.startPos.y) * progress + arcY;
        proj.mesh.position.copy(pos);

        // Orient projectile along flight direction
        const nextProgress = Math.min((currentTime + 0.016 - proj.startTime) / proj.duration, 1);
        const nextPos = ProjectileSystem._scratchV3b;
        nextPos.lerpVectors(proj.startPos, proj.endPos, nextProgress);
        nextPos.y = proj.startPos.y + (proj.endPos.y - proj.startPos.y) * nextProgress + Math.sin(nextProgress * Math.PI) * height;
        proj.mesh.lookAt(nextPos);

        if (proj.arcHeight && proj.arcHeight > 3) {
          proj.mesh.rotation.x += 0.15;
          proj.mesh.rotation.z += 0.08;
        }

        // Thrown axe: fast end-over-end tumble
        if ((proj.mesh as any)._isAxeThrow) {
          proj.mesh.rotation.x += 0.35;  // end-over-end spin
        }

        // Magic orb effects: rotate sparkles + emit trail particles
        const magicColor = (proj.mesh as any)._magicColor;
        if (magicColor !== undefined) {
          // Rotate sparkle ring around the orb (supports 4 or 6 sparkles)
          const sparkleCount = (proj.mesh as any)._isHealOrb ? 6 : 4;
          for (let si = 0; si < sparkleCount; si++) {
            const sparkle = proj.mesh.getObjectByName(`sparkle-${si}`);
            if (sparkle) {
              const angle = currentTime * 5 + (si / sparkleCount) * Math.PI * 2;
              const r = 0.18 + Math.sin(currentTime * 3) * 0.05;
              sparkle.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
            }
          }
          // Emit trail sparkles behind the projectile
          if (Math.random() < 0.4) {
            const tColor = Math.random() > 0.5 ? magicColor : 0xFFFFCC;
            const tParticle = this.getPooledParticle(tColor, 0.8);
            tParticle.position.copy(proj.mesh.position);
            this.scene.add(tParticle);
            this.trailParticles.push({
              mesh: tParticle,
              velocity: { x: (Math.random() - 0.5) * 0.5, y: 0.3 + Math.random() * 0.5, z: (Math.random() - 0.5) * 0.5 },
              startTime: currentTime, duration: 0.3 + Math.random() * 0.2,
            });
          }
        }
      } else {
        // Projectile arrived — check for AoE explosion
        if ((proj.mesh as any)._isAoE) {
          const magicCol = (proj.mesh as any)._magicColor ?? 0x7c4dff;
          this.spawnAoEExplosion(
            { x: proj.endPos.x, y: proj.endPos.y - 0.5, z: proj.endPos.z },
            1, magicCol
          );
        }
        // Fire impact callback (for deferred damage visuals)
        if (proj.onImpact) proj.onImpact();
        toRemove.push(i);
      }
    }

    // Remove completed projectiles (in reverse order to avoid index shifting)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const proj = this.projectiles[toRemove[i]];
      this.scene.remove(proj.mesh);
      proj.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
      this.projectiles.splice(toRemove[i], 1);
    }
  }
  dispose(): void {
    for (const proj of this.projectiles) {
      this.scene.remove(proj.mesh);
      proj.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    this.projectiles = [];
    for (const tp of this.trailParticles) {
      this.scene.remove(tp.mesh);
      if (tp.mesh.geometry !== this._sharedParticleGeo) {
        tp.mesh.geometry?.dispose();
      }
      if (tp.mesh.material instanceof THREE.Material) {
        tp.mesh.material.dispose();
      }
    }
    this.trailParticles = [];
    for (const mesh of this._particlePool) {
      this.scene.remove(mesh);
      if (mesh.geometry !== this._sharedParticleGeo) {
        mesh.geometry?.dispose();
      }
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    }
    this._particlePool = [];
    this._sharedParticleGeo?.dispose();
    this._sharedParticleGeo = null;
    for (const mat of this._particleMatCache.values()) {
      mat.dispose();
    }
    this._particleMatCache.clear();
  }
}
