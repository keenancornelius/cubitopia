import * as THREE from 'three';
import { ElementType, Unit, UnitType } from '../types';
import type { UnitMeshGroup } from './UnitRenderer';

type WorldPos = { x: number; y: number; z: number };
type HealthBarAssets = {
  healthBar: THREE.Sprite;
  healthBarCanvas: HTMLCanvasElement;
  healthBarCtx: CanvasRenderingContext2D;
  healthBarTexture: THREE.CanvasTexture;
  lastHealthRatio: number;
};

export class UnitVFX {
  private readonly getUnitMeshesRef: () => Map<string, UnitMeshGroup>;
  private deferredEffects: Array<{ executeAt: number; callback: () => void }> = [];
  private swingTrails: Array<{ mesh: THREE.Mesh; startTime: number; duration: number }> = [];

  constructor(
    private readonly scene: THREE.Scene,
    deps: { getUnitMeshes: () => Map<string, UnitMeshGroup> },
  ) {
    this.getUnitMeshesRef = deps.getUnitMeshes;
  }

  private get unitMeshes(): Map<string, UnitMeshGroup> {
    return this.getUnitMeshesRef();
  }

  createHealthBar(unitType: UnitType, healthRatio: number): HealthBarAssets {
    const isSiege = unitType === UnitType.TREBUCHET;
    const healthBarCanvas = document.createElement('canvas');
    healthBarCanvas.width = 64;
    healthBarCanvas.height = 8;
    const healthBarCtx = healthBarCanvas.getContext('2d')!;
    const healthBarTexture = new THREE.CanvasTexture(healthBarCanvas);
    healthBarTexture.minFilter = THREE.NearestFilter;
    healthBarTexture.magFilter = THREE.NearestFilter;
    const healthBarMaterial = new THREE.SpriteMaterial({ map: healthBarTexture, depthTest: false });
    const healthBar = new THREE.Sprite(healthBarMaterial);
    const hbScale = isSiege ? 1.1 : 0.7;
    healthBar.scale.set(hbScale, hbScale * (8 / 64), 1);
    healthBar.position.y = isSiege ? 2.35 : 1.25;
    healthBar.renderOrder = 999;
    UnitVFX.drawHealthBar(healthBarCtx, healthRatio);
    healthBarTexture.needsUpdate = true;
    return { healthBar, healthBarCanvas, healthBarCtx, healthBarTexture, lastHealthRatio: healthRatio };
  }

  private static drawHealthBar(ctx: CanvasRenderingContext2D, ratio: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // Clear
    ctx.clearRect(0, 0, w, h);
    // Dark border/outline
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(0, 0, w, h);
    // Red background — represents missing health (deep saturated red)
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(1, 1, w - 2, h - 2);
    // Slightly lighter red strip on top half for depth
    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.fillRect(1, 1, w - 2, (h - 2) / 2);
    // Green fill — represents remaining health (deep saturated green)
    const fillW = Math.max((w - 2) * Math.max(ratio, 0), 0);
    if (fillW > 0) {
      ctx.fillStyle = '#006400';
      ctx.fillRect(1, 1, fillW, h - 2);
      // Slightly lighter green highlight on top half for gloss
      ctx.fillStyle = 'rgba(100, 255, 100, 0.15)';
      ctx.fillRect(1, 1, fillW, (h - 2) / 2);
    }
  }
  knockbackUnit(unitId: string, targetWorldPos: { x: number; y: number; z: number }): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    const start = entry.group.position.clone();
    const end = new THREE.Vector3(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z);
    const duration = 350; // ms — fast but visible
    const hopHeight = 0.15; // slight upward arc
    const startTime = performance.now();

    // Guard: prevent setWorldPosition from overriding us during the animation
    entry._knockbackUntil = startTime + duration + 50; // +50ms safety buffer

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out: fast launch, slow landing
      const eased = t * (2 - t);

      // Horizontal lerp
      entry.group.position.x = start.x + (end.x - start.x) * eased;
      entry.group.position.z = start.z + (end.z - start.z) * eased;
      // Vertical: parabolic hop arc (up then down)
      const hopArc = Math.sin(t * Math.PI) * hopHeight;
      entry.group.position.y = start.y + (end.y - start.y) * eased + hopArc;

      // Slight backward tilt during the knockback
      entry.group.rotation.x = -0.15 * Math.sin(t * Math.PI);

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Snap to exact final position and clear the guard
        entry.group.position.copy(end);
        entry.lastPosition.copy(end);
        entry._knockbackUntil = 0;
      }
    };
    animate();
  }
  updateHealthBar(unit: Unit): void {
    const entry = this.unitMeshes.get(unit.id);
    if (!entry) return;

    const healthRatio = Math.max(unit.currentHealth / unit.stats.maxHealth, 0);
    // Skip if ratio hasn't changed meaningfully
    if (Math.abs(healthRatio - entry.lastHealthRatio) < 0.005) return;

    entry.lastHealthRatio = healthRatio;
    UnitVFX.drawHealthBar(entry.healthBarCtx, healthRatio);
    entry.healthBarTexture.needsUpdate = true;
  }
  setSelected(unitId: string, selected: boolean, attackRange?: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    if (selected) {
      // Add selection ring
      const ringGeo = new THREE.RingGeometry(0.4, 0.5, 16);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.name = 'selection-ring';
      entry.group.add(ring);

      // Add attack range indicator circle (faint red ring on the ground)
      if (attackRange && attackRange > 1) {
        const HEX_SPACING = 1.5; // world units per hex tile
        const radius = attackRange * HEX_SPACING;
        const rangeGeo = new THREE.RingGeometry(radius - 0.06, radius + 0.06, 48);
        const rangeMat = new THREE.MeshBasicMaterial({
          color: 0xff4444,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        });
        const rangeRing = new THREE.Mesh(rangeGeo, rangeMat);
        rangeRing.rotation.x = -Math.PI / 2;
        rangeRing.position.y = 0.01;
        rangeRing.name = 'range-ring';
        entry.group.add(rangeRing);
      }
    } else {
      // Remove selection ring
      const ring = entry.group.getObjectByName('selection-ring');
      if (ring) {
        entry.group.remove(ring);
        if (ring instanceof THREE.Mesh) {
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
      }
      // Remove range ring
      const rangeRing = entry.group.getObjectByName('range-ring');
      if (rangeRing) {
        entry.group.remove(rangeRing);
        if (rangeRing instanceof THREE.Mesh) {
          rangeRing.geometry.dispose();
          (rangeRing.material as THREE.Material).dispose();
        }
      }
    }
  }
  private attackTargetRing: THREE.Mesh | null = null;
  private attackTargetUnitId: string | null = null;

  /** Highlight a unit as an attack target (red pulsing ring) */
  highlightAttackTarget(unitId: string | null): void {
    // Remove previous highlight
    if (this.attackTargetRing) {
      this.scene.remove(this.attackTargetRing);
      this.attackTargetRing.geometry?.dispose();
      this.attackTargetRing = null;
    }
    this.attackTargetUnitId = unitId;
    if (!unitId) return;
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.65, 16),
      new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    ring.name = 'attack-target-ring';
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(entry.group.position);
    ring.position.y += 0.05;
    this.scene.add(ring);
    this.attackTargetRing = ring;
  }

  /** Update attack target ring position + pulse each frame */
  updateAttackTargetRing(time: number): void {
    if (!this.attackTargetRing || !this.attackTargetUnitId) return;
    const entry = this.unitMeshes.get(this.attackTargetUnitId);
    if (!entry) {
      this.highlightAttackTarget(null);
      return;
    }
    // Follow target position
    this.attackTargetRing.position.copy(entry.group.position);
    this.attackTargetRing.position.y += 0.05;
    // Pulse opacity
    const mat = this.attackTargetRing.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.4 + 0.3 * Math.sin(time * 6);
    // Pulse scale
    const s = 1.0 + 0.1 * Math.sin(time * 6);
    this.attackTargetRing.scale.set(s, s, s);
  }

  /**
   * Spawn a swing streak arc at a unit's position.
   * type: 'slash' (wide arc), 'stab' (narrow thrust line), 'smash' (overhead arc)
   */
  spawnSwingTrail(unitId: string, trailType: 'slash' | 'stab' | 'smash', time: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    let geo: THREE.BufferGeometry;
    let color: number;
    const duration = 0.35; // trail fades over 350ms

    if (trailType === 'slash') {
      // Wide horizontal arc — a thin curved plane
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.absarc(0, 0, 0.6, -0.8, 0.8, false);
      shape.lineTo(0.45 * Math.cos(0.8), 0.45 * Math.sin(0.8));
      shape.absarc(0, 0, 0.45, 0.8, -0.8, true);
      shape.closePath();
      geo = new THREE.ShapeGeometry(shape, 8);
      color = 0xffffff;
    } else if (trailType === 'stab') {
      // Narrow thrust line — thin elongated triangle
      geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        0, 0, 0,
        0.05, 0, 0.7,
        -0.05, 0, 0.7,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      color = 0xccffff;
    } else {
      // Smash — vertical overhead arc
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.absarc(0, 0, 0.55, 0.3, Math.PI - 0.3, false);
      shape.lineTo(0.4 * Math.cos(Math.PI - 0.3), 0.4 * Math.sin(Math.PI - 0.3));
      shape.absarc(0, 0, 0.4, Math.PI - 0.3, 0.3, true);
      shape.closePath();
      geo = new THREE.ShapeGeometry(shape, 8);
      color = 0xffcc44;
    }

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Position at unit's arm height, oriented by facing
    mesh.position.copy(entry.group.position);
    mesh.position.y += 0.6; // arm height
    mesh.rotation.y = entry.facingAngle;

    // For slash, rotate to horizontal plane
    if (trailType === 'slash') {
      mesh.rotation.x = -Math.PI / 2;
    }

    this.scene.add(mesh);
    this.swingTrails.push({ mesh, startTime: time, duration });
  }

  /** Update and fade out swing trails each frame */
  updateSwingTrails(time: number): void {
    for (let i = this.swingTrails.length - 1; i >= 0; i--) {
      const trail = this.swingTrails[i];
      const elapsed = time - trail.startTime;
      const progress = elapsed / trail.duration;

      if (progress >= 1) {
        // Remove expired trail
        this.scene.remove(trail.mesh);
        trail.mesh.geometry?.dispose();
        (trail.mesh.material as THREE.Material).dispose();
        this.swingTrails.splice(i, 1);
      } else {
        // Fade out + scale up slightly
        const mat = trail.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.8 * (1 - progress);
        const scale = 1 + progress * 0.3;
        trail.mesh.scale.set(scale, scale, scale);
      }
    }
  }
  /**
   * Spawn metal-on-metal spark burst at a world position.
   * Bright orange/yellow sparks that fly outward and fade — used for melee blocks.
   */
  spawnBlockSparks(worldPos: { x: number; y: number; z: number }): void {
    const sparkCount = 8 + Math.floor(Math.random() * 5); // 8-12 sparks

    for (let i = 0; i < sparkCount; i++) {
      const geo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
      // Mix of orange, yellow, and white sparks
      const colors = [0xff8800, 0xffcc00, 0xffffaa, 0xff6600, 0xffffff];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 });
      const spark = new THREE.Mesh(geo, mat);

      // Start at impact point (slightly above ground, at weapon height)
      spark.position.set(
        worldPos.x + (Math.random() - 0.5) * 0.15,
        worldPos.y + 0.5 + Math.random() * 0.2,
        worldPos.z + (Math.random() - 0.5) * 0.15
      );

      this.scene.add(spark);

      // Velocity: sparks fly outward and upward
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      const vx = Math.cos(angle) * speed;
      const vy = 1.0 + Math.random() * 2.0; // strong upward
      const vz = Math.sin(angle) * speed;
      const gravity = -8;
      const lifetime = 0.25 + Math.random() * 0.3;
      const startTime = performance.now() / 1000;

      const animate = () => {
        const elapsed = performance.now() / 1000 - startTime;
        if (elapsed > lifetime) {
          this.scene.remove(spark);
          geo.dispose();
          mat.dispose();
          return;
        }
        const t = elapsed;
        spark.position.x += vx * 0.016;
        spark.position.y += (vy + gravity * t) * 0.016;
        spark.position.z += vz * 0.016;
        mat.opacity = 1 - (elapsed / lifetime);
        // Sparks shrink as they die
        const scale = 1 - elapsed / lifetime * 0.5;
        spark.scale.setScalar(scale);
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }

  // ==============================
  // ELEMENTAL IMPACT EFFECTS
  // ==============================

  /** Dispatch to the correct elemental impact effect */
  spawnElementalImpact(worldPos: { x: number; y: number; z: number }, element: ElementType): void {
    switch (element) {
      case ElementType.FIRE: this._spawnFireImpact(worldPos); break;
      case ElementType.WATER: this._spawnWaterImpact(worldPos); break;
      case ElementType.LIGHTNING: this._spawnLightningImpact(worldPos); break;
      case ElementType.WIND: this._spawnWindImpact(worldPos); break;
      case ElementType.EARTH: this._spawnEarthImpact(worldPos); break;
    }
  }

  /** 🔥 Fire: burst of flame particles that rise and fade, embers drift upward */
  private _spawnFireImpact(wp: { x: number; y: number; z: number }): void {
    const count = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const size = 0.04 + Math.random() * 0.06;
      const geo = new THREE.BoxGeometry(size, size, size);
      const colors = [0xff4400, 0xff6600, 0xff8800, 0xffaa00, 0xffcc00];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(
        wp.x + (Math.random() - 0.5) * 0.3,
        wp.y + 0.4 + Math.random() * 0.3,
        wp.z + (Math.random() - 0.5) * 0.3
      );
      this.scene.add(p);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.5;
      const vx = Math.cos(angle) * speed * 0.4;
      const vy = 1.5 + Math.random() * 2.5; // flames rise
      const vz = Math.sin(angle) * speed * 0.4;
      const lifetime = 0.4 + Math.random() * 0.4;
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(p); geo.dispose(); mat.dispose(); return; }
        p.position.x += vx * 0.016;
        p.position.y += vy * 0.016; // fire goes UP, no gravity
        p.position.z += vz * 0.016;
        mat.opacity = 1 - el / lifetime;
        const s = 1 + el * 0.5; // flames grow slightly as they rise
        p.scale.setScalar(s);
        // Color shift: orange → yellow → white as particles age
        const t = el / lifetime;
        if (t > 0.6) mat.color.setHex(0xffeeaa);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    // Central flash
    this._spawnElementFlash(wp, 0xff6600, 0.5);
  }

  /** 💧 Water: splash ring of blue droplets that arc outward then fall */
  private _spawnWaterImpact(wp: { x: number; y: number; z: number }): void {
    const count = 12 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const size = 0.03 + Math.random() * 0.05;
      const geo = new THREE.SphereGeometry(size, 4, 4);
      const colors = [0x2288ff, 0x44aaff, 0x66ccff, 0x88ddff, 0xaaeeff];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const drop = new THREE.Mesh(geo, mat);
      drop.position.set(
        wp.x + (Math.random() - 0.5) * 0.15,
        wp.y + 0.5 + Math.random() * 0.1,
        wp.z + (Math.random() - 0.5) * 0.15
      );
      this.scene.add(drop);
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const speed = 1.5 + Math.random() * 2.0;
      const vx = Math.cos(angle) * speed;
      const vy = 1.0 + Math.random() * 1.5;
      const vz = Math.sin(angle) * speed;
      const gravity = -7;
      const lifetime = 0.5 + Math.random() * 0.3;
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(drop); geo.dispose(); mat.dispose(); return; }
        drop.position.x += vx * 0.016;
        drop.position.y += (vy + gravity * el) * 0.016;
        drop.position.z += vz * 0.016;
        mat.opacity = 0.9 * (1 - el / lifetime);
        drop.scale.setScalar(1 - el / lifetime * 0.3);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    this._spawnElementFlash(wp, 0x44aaff, 0.4);
  }

  /** ⚡ Lightning: electric arcs + jittering bright sparks + body flash */
  private _spawnLightningImpact(wp: { x: number; y: number; z: number }): void {
    // Electric arc bolts (3-5 jagged lines radiating from impact)
    const boltCount = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < boltCount; b++) {
      const segments = 5 + Math.floor(Math.random() * 4);
      const points: THREE.Vector3[] = [];
      const angle = (b / boltCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const boltLen = 0.4 + Math.random() * 0.5;
      let cx = wp.x, cy = wp.y + 0.5, cz = wp.z;
      points.push(new THREE.Vector3(cx, cy, cz));
      for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        cx = wp.x + Math.cos(angle) * boltLen * t + (Math.random() - 0.5) * 0.15;
        cy = wp.y + 0.5 + (Math.random() - 0.5) * 0.2;
        cz = wp.z + Math.sin(angle) * boltLen * t + (Math.random() - 0.5) * 0.15;
        points.push(new THREE.Vector3(cx, cy, cz));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xccddff, transparent: true, opacity: 1.0, linewidth: 2
      });
      const bolt = new THREE.Line(lineGeo, lineMat);
      this.scene.add(bolt);
      const start = performance.now() / 1000;
      const lifetime = 0.15 + Math.random() * 0.15;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(bolt); lineGeo.dispose(); lineMat.dispose(); return; }
        lineMat.opacity = 1 - el / lifetime;
        // Jitter bolt segments for crackling effect
        const pos = lineGeo.attributes.position;
        for (let i = 1; i < pos.count - 1; i++) {
          (pos as any).setY(i, (pos as any).getY(i) + (Math.random() - 0.5) * 0.03);
          (pos as any).setX(i, (pos as any).getX(i) + (Math.random() - 0.5) * 0.03);
        }
        pos.needsUpdate = true;
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    // Bright electric sparks
    const sparkCount = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < sparkCount; i++) {
      const geo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
      const colors = [0xffffff, 0xccddff, 0x88aaff, 0xeeeeff];
      const mat = new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)], transparent: true, opacity: 1 });
      const spark = new THREE.Mesh(geo, mat);
      spark.position.set(
        wp.x + (Math.random() - 0.5) * 0.3,
        wp.y + 0.4 + Math.random() * 0.3,
        wp.z + (Math.random() - 0.5) * 0.3
      );
      this.scene.add(spark);
      const vx = (Math.random() - 0.5) * 4;
      const vy = Math.random() * 3;
      const vz = (Math.random() - 0.5) * 4;
      const lifetime = 0.12 + Math.random() * 0.2;
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(spark); geo.dispose(); mat.dispose(); return; }
        spark.position.x += vx * 0.016;
        spark.position.y += vy * 0.016;
        spark.position.z += vz * 0.016;
        mat.opacity = 1 - el / lifetime;
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    this._spawnElementFlash(wp, 0xccddff, 0.6);
  }

  /** 🌪 Wind: swirling leaf/debris particles in a mini cyclone */
  private _spawnWindImpact(wp: { x: number; y: number; z: number }): void {
    const count = 14 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const size = 0.03 + Math.random() * 0.04;
      const geo = new THREE.BoxGeometry(size, size * 0.4, size); // flat debris
      const colors = [0xccffcc, 0xaaddaa, 0x88cc88, 0xddffdd, 0xeeffee];
      const mat = new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)], transparent: true, opacity: 0.85 });
      const leaf = new THREE.Mesh(geo, mat);
      const startAngle = (i / count) * Math.PI * 2;
      const radius = 0.1 + Math.random() * 0.1;
      leaf.position.set(
        wp.x + Math.cos(startAngle) * radius,
        wp.y + 0.3 + Math.random() * 0.2,
        wp.z + Math.sin(startAngle) * radius
      );
      this.scene.add(leaf);
      const spinSpeed = 4 + Math.random() * 3; // radians/sec
      const riseSpeed = 1.0 + Math.random() * 1.5;
      const expandRate = 0.8 + Math.random() * 1.2;
      const lifetime = 0.6 + Math.random() * 0.4;
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(leaf); geo.dispose(); mat.dispose(); return; }
        const a = startAngle + el * spinSpeed;
        const r = radius + el * expandRate;
        leaf.position.x = wp.x + Math.cos(a) * r;
        leaf.position.y = wp.y + 0.3 + el * riseSpeed;
        leaf.position.z = wp.z + Math.sin(a) * r;
        leaf.rotation.x += 0.1;
        leaf.rotation.z += 0.15;
        mat.opacity = 0.85 * (1 - el / lifetime);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    // White swirl lines (2-3 arcing trails)
    for (let t = 0; t < 3; t++) {
      const points: THREE.Vector3[] = [];
      const baseAngle = (t / 3) * Math.PI * 2;
      for (let s = 0; s <= 12; s++) {
        const frac = s / 12;
        const a = baseAngle + frac * Math.PI * 1.5;
        const r = 0.1 + frac * 0.5;
        points.push(new THREE.Vector3(
          wp.x + Math.cos(a) * r,
          wp.y + 0.4 + frac * 0.6,
          wp.z + Math.sin(a) * r
        ));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xeeffee, transparent: true, opacity: 0.6 });
      const trail = new THREE.Line(lineGeo, lineMat);
      this.scene.add(trail);
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > 0.5) { this.scene.remove(trail); lineGeo.dispose(); lineMat.dispose(); return; }
        lineMat.opacity = 0.6 * (1 - el / 0.5);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
  }

  /** 🪨 Earth: chunks of rock/dirt fly up, heavy ground shake feel */
  private _spawnEarthImpact(wp: { x: number; y: number; z: number }): void {
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const size = 0.05 + Math.random() * 0.08;
      const geo = new THREE.BoxGeometry(size, size * (0.6 + Math.random() * 0.8), size);
      const colors = [0x886644, 0x665533, 0x997755, 0x554422, 0xaa8866];
      const mat = new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)], transparent: true, opacity: 1.0 });
      const chunk = new THREE.Mesh(geo, mat);
      chunk.position.set(
        wp.x + (Math.random() - 0.5) * 0.2,
        wp.y + 0.2 + Math.random() * 0.1,
        wp.z + (Math.random() - 0.5) * 0.2
      );
      // Random initial rotation for variety
      chunk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(chunk);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 2.0;
      const vx = Math.cos(angle) * speed;
      const vy = 2.0 + Math.random() * 2.5; // launch up
      const vz = Math.sin(angle) * speed;
      const gravity = -10; // heavy chunks
      const rotSpeed = (Math.random() - 0.5) * 8;
      const lifetime = 0.5 + Math.random() * 0.3;
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > lifetime) { this.scene.remove(chunk); geo.dispose(); mat.dispose(); return; }
        chunk.position.x += vx * 0.016;
        chunk.position.y += (vy + gravity * el) * 0.016;
        chunk.position.z += vz * 0.016;
        chunk.rotation.x += rotSpeed * 0.016;
        chunk.rotation.z += rotSpeed * 0.5 * 0.016;
        mat.opacity = 1 - (el / lifetime) * 0.6; // chunks stay mostly opaque
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    // Dust cloud ring at ground level
    for (let d = 0; d < 6; d++) {
      const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xbbaa88, transparent: true, opacity: 0.5 });
      const dust = new THREE.Mesh(geo, mat);
      const a = (d / 6) * Math.PI * 2;
      dust.position.set(wp.x + Math.cos(a) * 0.1, wp.y + 0.15, wp.z + Math.sin(a) * 0.1);
      this.scene.add(dust);
      const expandSpeed = 1.5 + Math.random();
      const start = performance.now() / 1000;
      const anim = () => {
        const el = performance.now() / 1000 - start;
        if (el > 0.6) { this.scene.remove(dust); geo.dispose(); mat.dispose(); return; }
        const r = 0.1 + el * expandSpeed;
        dust.position.x = wp.x + Math.cos(a) * r;
        dust.position.z = wp.z + Math.sin(a) * r;
        dust.scale.setScalar(1 + el * 2);
        mat.opacity = 0.5 * (1 - el / 0.6);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    }
    this._spawnElementFlash(wp, 0x886644, 0.3);
  }

  /** Shared helper: expanding sphere flash at impact point */
  private _spawnElementFlash(wp: { x: number; y: number; z: number }, color: number, duration: number): void {
    const geo = new THREE.SphereGeometry(0.2, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.BackSide });
    const flash = new THREE.Mesh(geo, mat);
    flash.position.set(wp.x, wp.y + 0.5, wp.z);
    this.scene.add(flash);
    const start = performance.now() / 1000;
    const anim = () => {
      const el = performance.now() / 1000 - start;
      if (el > duration) { this.scene.remove(flash); geo.dispose(); mat.dispose(); return; }
      const p = el / duration;
      flash.scale.setScalar(1 + p * 3);
      mat.opacity = 0.8 * (1 - p);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  /** Get the projectile orb color for an element */
  static elementOrbColor(element: ElementType): number {
    switch (element) {
      case ElementType.FIRE: return 0xff5500;
      case ElementType.WATER: return 0x2288ff;
      case ElementType.LIGHTNING: return 0xccddff;
      case ElementType.WIND: return 0x88dd88;
      case ElementType.EARTH: return 0x886644;
    }
  }
  /**
   * Queue a visual effect to execute after a delay (for melee attack sync)
   */
  queueDeferredEffect(delayMs: number, callback: () => void): void {
    this.deferredEffects.push({ executeAt: performance.now() + delayMs, callback });
  }

  /**
   * Process deferred visual effects (call in game loop)
   */
  updateDeferredEffects(): void {
    const now = performance.now();
    let writeIdx = 0;
    for (let i = 0; i < this.deferredEffects.length; i++) {
      const effect = this.deferredEffects[i];
      if (now >= effect.executeAt) {
        effect.callback();
      } else {
        this.deferredEffects[writeIdx++] = effect;
      }
    }
    this.deferredEffects.length = writeIdx;
  }

  // Shared geometry for damage particles — never disposed
  private static _damageParticleGeo: THREE.BoxGeometry | null = null;
  private static getDamageGeo(): THREE.BoxGeometry {
    if (!UnitVFX._damageParticleGeo) {
      UnitVFX._damageParticleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    }
    return UnitVFX._damageParticleGeo;
  }

  showDamageEffect(worldPos: { x: number; y: number; z: number }): void {
    const sharedGeo = UnitVFX.getDamageGeo();

    // === Layer 1: Blood/damage spray particles (6-9) — varied red shades ===
    const particleCount = 6 + Math.floor(Math.random() * 4);
    const redShades = [0xff0000, 0xcc2200, 0xff3333, 0xdd1111, 0xaa0000, 0xff4422];

    for (let i = 0; i < particleCount; i++) {
      const colorIdx = Math.floor(Math.random() * redShades.length);
      const particleMat = new THREE.MeshBasicMaterial({
        color: redShades[colorIdx],
        transparent: true,
        opacity: 1.0,
      });
      const particle = new THREE.Mesh(sharedGeo, particleMat);
      // Randomize size slightly
      const scale = 0.7 + Math.random() * 0.8;
      particle.scale.setScalar(scale);

      particle.position.set(
        worldPos.x + (Math.random() - 0.5) * 0.3,
        worldPos.y + 0.5 + (Math.random() - 0.5) * 0.3,
        worldPos.z + (Math.random() - 0.5) * 0.3,
      );

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      const velocity = {
        x: Math.cos(angle) * speed,
        y: 1.5 + Math.random() * 2.5,
        z: Math.sin(angle) * speed,
      };

      this.scene.add(particle);

      const lifetime = 0.4 + Math.random() * 0.25;
      let elapsed = 0;
      const animate = () => {
        elapsed += 0.016;
        particle.position.x += velocity.x * 0.016;
        particle.position.y += velocity.y * 0.016;
        particle.position.z += velocity.z * 0.016;
        velocity.y -= 7 * 0.016; // gravity
        velocity.x *= 0.97; // drag
        velocity.z *= 0.97;

        const t = elapsed / lifetime;
        particleMat.opacity = Math.max(0, 1 - t * t); // ease-out fade
        particle.scale.setScalar(scale * (1 - t * 0.4)); // shrink slightly

        if (elapsed < lifetime) {
          requestAnimationFrame(animate);
        } else {
          this.scene.remove(particle);
          particleMat.dispose();
        }
      };
      requestAnimationFrame(animate);
    }

    // === Layer 2: Quick white hit flash at impact point ===
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), flashMat);
    flash.position.set(worldPos.x, worldPos.y + 0.5, worldPos.z);
    this.scene.add(flash);

    let flashElapsed = 0;
    const animateFlash = () => {
      flashElapsed += 0.016;
      const ft = flashElapsed / 0.15;
      flash.scale.setScalar(1 + ft * 2);
      flashMat.opacity = 0.7 * Math.max(0, 1 - ft);
      if (flashElapsed < 0.15) {
        requestAnimationFrame(animateFlash);
      } else {
        this.scene.remove(flash);
        flashMat.dispose();
        flash.geometry.dispose();
      }
    };
    requestAnimationFrame(animateFlash);
  }

  /**
   * Flash a unit red briefly (damage indicator)
   */
  flashUnit(unitId: string, duration: number = 0.15): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    const originalMaterials = new Map<THREE.Mesh, THREE.Material>();

    // Store original materials and apply red tint
    entry.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        originalMaterials.set(child, child.material.clone());
        const tintedMat = new THREE.MeshLambertMaterial({
          color: 0xff4444,
        });
        child.material = tintedMat;
      }
    });

    // Body flinch: snap backward + sideways jolt, then spring back
    const origRx = entry.group.rotation.x;
    const origRz = entry.group.rotation.z;
    // Random hit direction for variety
    const hitDir = (Math.random() > 0.5 ? 1 : -1);
    entry.group.rotation.x = origRx - 0.15;
    entry.group.rotation.z = origRz + 0.1 * hitDir;

    // Arms flinch
    const armLeft = entry.group.getObjectByName('arm-left');
    const armRight = entry.group.getObjectByName('arm-right');
    const armLOrig = armLeft ? armLeft.rotation.x : 0;
    const armROrig = armRight ? armRight.rotation.x : 0;
    if (armLeft) armLeft.rotation.x = -0.3;
    if (armRight) armRight.rotation.x = -0.4;

    // Restore after duration
    const restoreTime = duration * 1000;
    const springTime = restoreTime * 2.5; // body springs back slower than flash

    setTimeout(() => {
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh && originalMaterials.has(child)) {
          child.material = originalMaterials.get(child)!;
        }
      });
    }, restoreTime);

    // Spring body back to original rotation
    setTimeout(() => {
      entry.group.rotation.x = origRx;
      entry.group.rotation.z = origRz;
      if (armLeft) armLeft.rotation.x = armLOrig;
      if (armRight) armRight.rotation.x = armROrig;
    }, springTime);
  }

  // === Persistent bleed tint tracking ===
  private bleedTintedUnits = new Set<string>();
  /** Original (pre-tint) material colors per unit, keyed by unitId → (mesh → original color) */
  private bleedOriginalColors = new Map<string, Map<THREE.Mesh, THREE.Color>>();

  /**
   * Apply a persistent red bleed tint to a wounded unit.
   * Intensity scales with damage taken (healthPercent 0–1 where 1 = full health).
   * The tint persists for the rest of the fight — never auto-restores.
   * Also spawns periodic red drip particles from the unit.
   *
   * FIX: On first application, clone materials (so cached shared materials are untouched)
   * and store original colors. On subsequent calls, recompute tint from stored originals
   * instead of re-cloning (which caused compounding red shift — the "everything red" bug).
   */
  applyBleedTint(unitId: string, healthPercent: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    // Bleed intensity: stronger as health drops. 0 at full health, ~0.4 at near-death.
    const intensity = Math.min(0.4, (1 - healthPercent) * 0.5);
    if (intensity < 0.02) return; // negligible damage, skip

    this.bleedTintedUnits.add(unitId);

    // First time: clone materials and store original colors
    // Subsequent times: reuse existing clones and recompute from stored originals
    let origColors = this.bleedOriginalColors.get(unitId);
    const isFirstApplication = !origColors;
    if (!origColors) {
      origColors = new Map();
      this.bleedOriginalColors.set(unitId, origColors);
    }

    const bloodR = 0x88 / 255;
    const bloodG = 0x00 / 255;
    const bloodB = 0x00 / 255;

    entry.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        if (isFirstApplication) {
          // First time: save original color, then clone material so shared cache is untouched
          origColors!.set(child, child.material.color.clone());
          child.material = child.material.clone();
        }
        // Always compute tint from ORIGINAL color (not current tinted color)
        const orig = origColors!.get(child);
        if (orig && child.material instanceof THREE.MeshLambertMaterial) {
          child.material.color.setRGB(
            orig.r + (bloodR - orig.r) * intensity,
            orig.g + (bloodG - orig.g) * intensity,
            orig.b + (bloodB - orig.b) * intensity,
          );
        }
      }
    });

    // Spawn a slow red drip particle
    this.spawnBleedDrip(entry.group.position);
  }

  /**
   * Spawn a single red drip particle falling from a wounded unit's position.
   */
  private spawnBleedDrip(worldPos: THREE.Vector3): void {
    const geo = UnitVFX.getDamageGeo();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xaa0000, transparent: true, opacity: 0.8,
    });
    const drip = new THREE.Mesh(geo, mat);
    drip.scale.setScalar(0.4 + Math.random() * 0.3);
    drip.position.set(
      worldPos.x + (Math.random() - 0.5) * 0.3,
      worldPos.y + 0.2 + Math.random() * 0.3,
      worldPos.z + (Math.random() - 0.5) * 0.3,
    );
    this.scene.add(drip);

    let elapsed = 0;
    const lifetime = 0.5 + Math.random() * 0.3;
    const animate = () => {
      elapsed += 0.016;
      drip.position.y -= 1.5 * 0.016; // slow fall
      const t = elapsed / lifetime;
      mat.opacity = 0.8 * Math.max(0, 1 - t);
      drip.scale.y *= 0.98; // stretch vertically as it falls

      if (elapsed < lifetime) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(drip);
        mat.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Clear bleed tint tracking (call on game reset / new game).
   */
  clearBleedTints(): void {
    this.bleedTintedUnits.clear();
    this.bleedOriginalColors.clear();
  }

  /**
   * Check if a unit has bleed tint applied.
   */
  hasBleedTint(unitId: string): boolean {
    return this.bleedTintedUnits.has(unitId);
  }

  // === Secondary Melee Attack VFX ===

  /**
   * Greatsword spin attack: green glow charge-up ring → expanding green slash arc.
   */
  spawnGreatswordSpin(worldPos: { x: number; y: number; z: number }): void {
    // Green charge-up glow sphere
    const chargeMat = new THREE.MeshBasicMaterial({
      color: 0x44ff44, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const chargeGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const charge = new THREE.Mesh(chargeGeo, chargeMat);
    charge.position.set(worldPos.x, worldPos.y + 0.5, worldPos.z);
    this.scene.add(charge);

    // Charge-up phase: grow for 0.25s
    let elapsed = 0;
    const chargeTime = 0.25;
    const animateCharge = () => {
      elapsed += 0.016;
      const t = Math.min(1, elapsed / chargeTime);
      charge.scale.setScalar(1 + t * 2);
      chargeMat.opacity = 0.6 * (1 - t * 0.3);
      if (elapsed < chargeTime) {
        requestAnimationFrame(animateCharge);
      } else {
        this.scene.remove(charge);
        chargeMat.dispose();
        chargeGeo.dispose();
        // Spin slash ring
        this._spawnSpinRing(worldPos);
      }
    };
    requestAnimationFrame(animateCharge);
  }

  private _spawnSpinRing(worldPos: { x: number; y: number; z: number }): void {
    const ringGeo = new THREE.RingGeometry(0.3, 1.2, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x66ff66, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(worldPos.x, worldPos.y + 0.4, worldPos.z);
    ring.rotation.x = -Math.PI / 2; // horizontal
    this.scene.add(ring);

    // Green slash particles in a ring
    const particleCount = 8;
    const particles: THREE.Mesh[] = [];
    const geo = UnitVFX.getDamageGeo();
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44ff44, transparent: true, opacity: 0.9,
      });
      const p = new THREE.Mesh(geo, mat);
      p.scale.setScalar(0.6);
      p.position.set(
        worldPos.x + Math.cos(angle) * 0.5,
        worldPos.y + 0.4,
        worldPos.z + Math.sin(angle) * 0.5,
      );
      this.scene.add(p);
      particles.push(p);
    }

    let elapsed = 0;
    const duration = 0.4;
    const animate = () => {
      elapsed += 0.016;
      const t = elapsed / duration;
      ring.scale.setScalar(1 + t * 2);
      ringMat.opacity = 0.7 * Math.max(0, 1 - t);
      ring.rotation.z += 0.3; // spin

      for (let i = 0; i < particles.length; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + elapsed * 8;
        const radius = 0.5 + t * 1.5;
        particles[i].position.x = worldPos.x + Math.cos(angle) * radius;
        particles[i].position.z = worldPos.z + Math.sin(angle) * radius;
        (particles[i].material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0, 1 - t);
      }

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(ring);
        ringMat.dispose();
        ringGeo.dispose();
        for (const p of particles) {
          this.scene.remove(p);
          (p.material as THREE.Material).dispose();
        }
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Warrior jump attack: unit leaps up then slams down with dust impact.
   */
  spawnJumpAttackImpact(worldPos: { x: number; y: number; z: number }): void {
    // Ground slam shockwave
    const ringGeo = new THREE.RingGeometry(0.1, 0.8, 12);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffcc44, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(worldPos.x, worldPos.y + 0.1, worldPos.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    // Dust particles on impact
    const dustCount = 6;
    const geo = UnitVFX.getDamageGeo();
    const dustParticles: { mesh: THREE.Mesh; vx: number; vz: number }[] = [];
    for (let i = 0; i < dustCount; i++) {
      const angle = (Math.PI * 2 * i) / dustCount;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbbaa88, transparent: true, opacity: 0.8,
      });
      const p = new THREE.Mesh(geo, mat);
      p.scale.setScalar(0.5 + Math.random() * 0.3);
      p.position.set(worldPos.x, worldPos.y + 0.15, worldPos.z);
      this.scene.add(p);
      dustParticles.push({ mesh: p, vx: Math.cos(angle) * 2, vz: Math.sin(angle) * 2 });
    }

    let elapsed = 0;
    const duration = 0.5;
    const animate = () => {
      elapsed += 0.016;
      const t = elapsed / duration;
      ring.scale.setScalar(1 + t * 3);
      ringMat.opacity = 0.7 * Math.max(0, 1 - t);

      for (const d of dustParticles) {
        d.mesh.position.x += d.vx * 0.016;
        d.mesh.position.z += d.vz * 0.016;
        d.mesh.position.y += 0.5 * 0.016;
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.max(0, 1 - t);
      }

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(ring);
        ringMat.dispose();
        ringGeo.dispose();
        for (const d of dustParticles) {
          this.scene.remove(d.mesh);
          (d.mesh.material as THREE.Material).dispose();
        }
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Animate a unit jumping up (for warrior jump attack).
   * Lifts the unit mesh up and back down over ~0.4s.
   */
  animateJumpAttack(unitId: string): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    const baseY = entry.group.position.y;
    const jumpHeight = 0.8;
    let elapsed = 0;
    const duration = 0.4;

    const animate = () => {
      elapsed += 0.016;
      const t = Math.min(1, elapsed / duration);
      // Parabolic arc: up then down
      const arc = 4 * t * (1 - t); // peaks at t=0.5
      entry.group.position.y = baseY + arc * jumpHeight;

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        entry.group.position.y = baseY;
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Paladin charge: blue force field sphere around unit during charge,
   * white light burst on arrival, golden rally particles on nearby allies.
   */
  spawnPaladinChargeField(unitId: string): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    // Blue force field sphere around the paladin
    const shieldGeo = new THREE.SphereGeometry(0.6, 12, 12);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    entry.group.add(shield); // attach to unit so it moves with them
    shield.position.set(0, 0.3, 0);

    // Pulsing animation for 1.5s (duration of charge movement)
    let elapsed = 0;
    const duration = 1.5;
    const animate = () => {
      elapsed += 0.016;
      const t = elapsed / duration;
      const pulse = 1 + Math.sin(elapsed * 12) * 0.1;
      shield.scale.setScalar(pulse);
      shieldMat.opacity = 0.3 * Math.max(0, 1 - t * 0.5);

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        entry.group.remove(shield);
        shieldMat.dispose();
        shieldGeo.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Paladin charge arrival: white light burst at impact position.
   */
  spawnPaladinImpactBurst(worldPos: { x: number; y: number; z: number }): void {
    // White expanding sphere burst
    const burstGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const burstMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const burst = new THREE.Mesh(burstGeo, burstMat);
    burst.position.set(worldPos.x, worldPos.y + 0.5, worldPos.z);
    this.scene.add(burst);

    // Golden rally particles rising from impact
    const particleCount = 10;
    const geo = UnitVFX.getDamageGeo();
    const rallyParticles: THREE.Mesh[] = [];
    for (let i = 0; i < particleCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffdd44, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const p = new THREE.Mesh(geo, mat);
      p.scale.setScalar(0.3 + Math.random() * 0.2);
      const angle = (Math.PI * 2 * i) / particleCount;
      p.position.set(
        worldPos.x + Math.cos(angle) * 0.3,
        worldPos.y + 0.3,
        worldPos.z + Math.sin(angle) * 0.3,
      );
      this.scene.add(p);
      rallyParticles.push(p);
    }

    let elapsed = 0;
    const duration = 0.6;
    const animate = () => {
      elapsed += 0.016;
      const t = elapsed / duration;
      burst.scale.setScalar(1 + t * 5);
      burstMat.opacity = 0.9 * Math.max(0, 1 - t);

      for (let i = 0; i < rallyParticles.length; i++) {
        const angle = (Math.PI * 2 * i) / particleCount;
        const radius = 0.3 + t * 1.5;
        rallyParticles[i].position.x = worldPos.x + Math.cos(angle) * radius;
        rallyParticles[i].position.y = worldPos.y + 0.3 + t * 1.2;
        rallyParticles[i].position.z = worldPos.z + Math.sin(angle) * radius;
        (rallyParticles[i].material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0, 1 - t);
      }

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(burst);
        burstMat.dispose();
        burstGeo.dispose();
        for (const p of rallyParticles) {
          this.scene.remove(p);
          (p.material as THREE.Material).dispose();
        }
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Show floating XP text (+1 XP, +3 XP) rising from a unit
   */
  showXPText(worldPos: { x: number; y: number; z: number }, xp: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Gold outline + white fill
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(`+${xp} XP`, 64, 24);
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`+${xp} XP`, 64, 24);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.3, 1);
    sprite.position.set(worldPos.x + 0.3, worldPos.y + 1.2, worldPos.z);
    this.scene.add(sprite);

    let elapsed = 0;
    const animate = () => {
      elapsed += 0.016;
      sprite.position.y += 0.8 * 0.016; // float upward
      mat.opacity = Math.max(0, 1 - elapsed / 1.0);
      if (elapsed < 1.0) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(sprite);
        texture.dispose();
        mat.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Show floating CRIT text for combo/status-consumption damage.
   * Much larger and more dynamic than normal damage — scales with damage, punchy animation.
   * @param combo  e.g. 'ELECTROCUTE', 'INFERNO', 'KAMEHAMEHA', 'SOOTHE'
   * @param damage numeric damage dealt (or heal amount for soothe)
   * @param color  hex color string e.g. '#ffee44'
   */
  showCritText(worldPos: { x: number; y: number; z: number }, combo: string, damage: number, color: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Dynamic font size: bigger for bigger damage (32-64px range)
    const fontSize = Math.min(64, Math.max(36, 28 + damage * 2));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Line 1: combo name
    const label = combo.toUpperCase();
    // Line 2: damage number
    const dmgStr = damage > 0 ? `${Math.round(damage)}` : '';

    // Black outline for readability
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, 256, 38);
    if (dmgStr) {
      ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
      ctx.strokeText(dmgStr, 256, 90);
    }

    // Colored fill
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillText(label, 256, 38);
    if (dmgStr) {
      ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
      ctx.fillText(dmgStr, 256, 90);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);

    // Start scale — big, then grows slightly and fades (punch-in effect)
    const baseScale = 1.2 + damage * 0.04; // larger text for bigger damage
    sprite.scale.set(baseScale, baseScale * 0.3, 1);
    sprite.position.set(
      worldPos.x + (Math.random() - 0.5) * 0.3,
      worldPos.y + 1.0,
      worldPos.z + (Math.random() - 0.5) * 0.3
    );
    this.scene.add(sprite);

    let elapsed = 0;
    const duration = 1.4;
    const animate = () => {
      elapsed += 0.016;
      const t = elapsed / duration;

      // Punch-in: quick scale up then settle
      const scaleMult = t < 0.1 ? 1 + (1 - t / 0.1) * 0.4 : 1.0; // 1.4x → 1.0x in first 0.1s
      sprite.scale.set(baseScale * scaleMult, baseScale * 0.3 * scaleMult, 1);

      // Float upward, accelerating slightly
      sprite.position.y += (0.6 + elapsed * 0.4) * 0.016;

      // Fade out in the last 40%
      mat.opacity = t < 0.6 ? 1.0 : Math.max(0, 1 - (t - 0.6) / 0.4);

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(sprite);
        texture.dispose();
        mat.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * Show level-up effect — golden particle burst + "LEVEL UP!" text + brief golden glow on unit
   */
  showLevelUpEffect(unitId: string, worldPos: { x: number; y: number; z: number }, newLevel: number): void {
    // --- Golden particle burst ---
    const particleCount = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < particleCount; i++) {
      const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xFFD700 : 0xFFF8DC,
        transparent: true,
        opacity: 1.0,
      });
      const p = new THREE.Mesh(geo, mat);
      const angle = (i / particleCount) * Math.PI * 2;
      p.position.set(
        worldPos.x + Math.cos(angle) * 0.15,
        worldPos.y + 0.6,
        worldPos.z + Math.sin(angle) * 0.15
      );
      const vel = {
        x: Math.cos(angle) * (1.5 + Math.random()),
        y: 2 + Math.random() * 2,
        z: Math.sin(angle) * (1.5 + Math.random()),
      };
      this.scene.add(p);
      let el = 0;
      const anim = () => {
        el += 0.016;
        p.position.x += vel.x * 0.016;
        p.position.y += vel.y * 0.016;
        p.position.z += vel.z * 0.016;
        vel.y -= 4 * 0.016;
        p.rotation.x += 5 * 0.016;
        p.rotation.z += 3 * 0.016;
        mat.opacity = Math.max(0, 1 - el / 0.8);
        if (el < 0.8) {
          requestAnimationFrame(anim);
        } else {
          this.scene.remove(p);
          geo.dispose();
          mat.dispose();
        }
      };
      requestAnimationFrame(anim);
    }

    // --- Expanding golden ring ---
    const ringGeo = new THREE.RingGeometry(0.1, 0.15, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xFFD700,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(worldPos.x, worldPos.y + 0.1, worldPos.z);
    ring.rotation.x = -Math.PI / 2; // lay flat
    this.scene.add(ring);
    let ringEl = 0;
    const ringAnim = () => {
      ringEl += 0.016;
      const s = 1 + ringEl * 6;
      ring.scale.set(s, s, s);
      ringMat.opacity = Math.max(0, 0.8 - ringEl / 0.6);
      if (ringEl < 0.6) {
        requestAnimationFrame(ringAnim);
      } else {
        this.scene.remove(ring);
        ringGeo.dispose();
        ringMat.dispose();
      }
    };
    requestAnimationFrame(ringAnim);

    // --- "LEVEL UP!" floating text ---
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Black outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(`LEVEL ${newLevel}!`, 128, 32);
    // Gold fill
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`LEVEL ${newLevel}!`, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const spMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(spMat);
    sp.scale.set(1.4, 0.35, 1);
    sp.position.set(worldPos.x, worldPos.y + 1.6, worldPos.z);
    this.scene.add(sp);

    let spEl = 0;
    const spAnim = () => {
      spEl += 0.016;
      sp.position.y += 0.5 * 0.016;
      // Scale pulse at start
      const pulse = spEl < 0.3 ? 1 + Math.sin(spEl * 20) * 0.15 : 1;
      sp.scale.set(1.4 * pulse, 0.35 * pulse, 1);
      spMat.opacity = spEl < 1.0 ? 1.0 : Math.max(0, 1 - (spEl - 1.0) / 0.5);
      if (spEl < 1.5) {
        requestAnimationFrame(spAnim);
      } else {
        this.scene.remove(sp);
        tex.dispose();
        spMat.dispose();
      }
    };
    requestAnimationFrame(spAnim);

    // --- Brief golden glow on the unit model ---
    const entry = this.unitMeshes.get(unitId);
    if (entry) {
      const origMats = new Map<THREE.Mesh, THREE.Material>();
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
          origMats.set(child, child.material.clone());
          child.material = new THREE.MeshLambertMaterial({
            color: 0xFFD700,
            emissive: 0xFFAA00,
            emissiveIntensity: 0.5,
          });
        }
      });
      setTimeout(() => {
        entry.group.traverse((child) => {
          if (child instanceof THREE.Mesh && origMats.has(child)) {
            (child.material as THREE.Material).dispose();
            child.material = origMats.get(child)!;
          }
        });
      }, 500);
    }
  }

  /**
   * Apply permanent visual upgrades to a unit based on its new level.
   * Called once per level-up, after the temporary VFX plays.
   *
   * Level 2+: 3% size increase per level, subtle emissive shimmer on armor
   * Level 3+: Shoulder badge (colored cube) — silver at 3, gold at 5+
   * Level 5+: Captain-tier gold trim on armor meshes, fancier helmet glow
   */
  applyLevelUpVisuals(unitId: string, newLevel: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    // --- Scale increase: 3% per level above 1 ---
    const scaleFactor = 1 + (newLevel - 1) * 0.03;
    entry.group.scale.setScalar(scaleFactor);

    // --- Emissive shimmer on armor at level 2+ ---
    if (newLevel >= 2) {
      const emissiveColor = newLevel >= 5 ? 0xFFAA00 : newLevel >= 3 ? 0x888888 : 0x444444;
      const emissiveIntensity = newLevel >= 5 ? 0.15 : newLevel >= 3 ? 0.1 : 0.05;
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
          // Only tint armor-like meshes (not eyes, not weapons held in hand)
          const name = child.name || '';
          if (name.includes('eye') || name.includes('pupil')) return;
          // Clone material to avoid mutating the global cache
          const cloned = child.material.clone();
          child.material = cloned;
          cloned.emissive = new THREE.Color(emissiveColor);
          cloned.emissiveIntensity = emissiveIntensity;
        }
      });
    }

    // --- Shoulder badge at level 3+ ---
    if (newLevel >= 3) {
      // Remove old badge if upgrading
      const oldBadge = entry.group.getObjectByName('level-badge');
      if (oldBadge) entry.group.remove(oldBadge);

      const badgeColor = newLevel >= 5 ? 0xFFD700 : 0xC0C0C0; // gold vs silver
      const badgeSize = newLevel >= 5 ? 0.09 : 0.07;
      const badgeGeo = new THREE.BoxGeometry(badgeSize, badgeSize, badgeSize);
      const badgeMat = new THREE.MeshLambertMaterial({
        color: badgeColor,
        emissive: newLevel >= 5 ? 0xFFAA00 : 0x666666,
        emissiveIntensity: newLevel >= 5 ? 0.3 : 0.15,
      });
      const badge = new THREE.Mesh(badgeGeo, badgeMat);
      badge.name = 'level-badge';
      // Position on left shoulder area
      badge.position.set(-0.22, 0.55, 0);
      entry.group.add(badge);

      // Second badge on right shoulder at level 5+
      if (newLevel >= 5) {
        const oldBadge2 = entry.group.getObjectByName('level-badge-r');
        if (oldBadge2) entry.group.remove(oldBadge2);

        const badge2 = new THREE.Mesh(badgeGeo, badgeMat);
        badge2.name = 'level-badge-r';
        badge2.position.set(0.22, 0.55, 0);
        entry.group.add(badge2);
      }
    }

    // --- Captain helmet glow at level 5+ ---
    if (newLevel >= 5) {
      // Find helmet-like meshes and add a subtle halo
      const helmNames = ['helm', 'helmet', 'head', 'plume', 'crest', 'visor', 'crown'];
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const name = (child.name || '').toLowerCase();
          if (helmNames.some(h => name.includes(h))) {
            if (child.material instanceof THREE.MeshLambertMaterial) {
              child.material.emissive = new THREE.Color(0xFFD700);
              child.material.emissiveIntensity = 0.2;
            }
          }
        }
      });
    }
  }

  /**
   * Billboard health bars to face camera (sprites auto-billboard, so this is now a no-op
   * kept for API compatibility in case other elements need billboarding later)
   */
  updateBillboards(_camera: THREE.Camera): void {
    // Sprites are inherently camera-facing — no manual lookAt needed
  }
  dispose(): void {
    if (this.attackTargetRing) {
      this.scene.remove(this.attackTargetRing);
      this.attackTargetRing.geometry?.dispose();
      if (this.attackTargetRing.material instanceof THREE.Material) {
        this.attackTargetRing.material.dispose();
      }
      this.attackTargetRing = null;
    }
    this.attackTargetUnitId = null;
    for (const trail of this.swingTrails) {
      this.scene.remove(trail.mesh);
      trail.mesh.geometry?.dispose();
      if (trail.mesh.material instanceof THREE.Material) {
        trail.mesh.material.dispose();
      }
    }
    this.swingTrails = [];
    this.deferredEffects = [];
  }
}
