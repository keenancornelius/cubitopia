import * as THREE from 'three';
import { ElementType, HexCoord, Unit, UnitType } from '../types';
import { UnitAnimations } from './UnitAnimations';
import { UnitModels } from './UnitModels';
import { ProjectileSystem } from './ProjectileSystem';
import { getPlayerHex } from '../game/PlayerConfig';
import { TRIBE_BY_ID, type TribeId, type TribeConfig } from '../game/TribeConfig';
import { UnitVFX } from './UnitVFX';
import { SpeechBubbleSystem } from './SpeechBubbleSystem';
import type { DialogueContext } from './UnitDialogue';

export interface UnitMeshGroup {
  group: THREE.Group;
  unitId: string;
  unitType: UnitType;
  healthBar: THREE.Sprite;
  healthBarCanvas: HTMLCanvasElement;
  healthBarCtx: CanvasRenderingContext2D;
  healthBarTexture: THREE.CanvasTexture;
  lastHealthRatio: number;
  label: THREE.Sprite;
  facingAngle: number;
  lastPosition: THREE.Vector3;
  trebFireStart: number;
  trebPendingTarget: { x: number; y: number; z: number } | null;
  trebOnImpact?: () => void;
  attackAnimStart: number;
  _knockbackUntil: number;

  // ── Organic movement state ──
  /** Smoothed Y velocity — low-pass filtered dy to detect sustained elevation change */
  _elevSpeed: number;
  /** Total accumulated elevation delta for current transition */
  _elevDelta: number;
  /** Hop/climb procedural Y offset (added on top of world Y) */
  _hopOffset: number;
  /** Landing squash timer — counts down from ~0.3 to 0 after an elevation drop */
  _landSquash: number;
  /** Movement start timer — counts down from ~0.2 to 0 for anticipation lean */
  _moveStartTime: number;
  /** Was the unit moving last frame? (for detecting start-of-movement) */
  _wasMoving: boolean;
  /** Stable Y before the current elevation transition began */
  _stableY: number;
}

// Use PlayerConfig for consistent team colors
const PLAYER_COLORS = [
  getPlayerHex(0),
  getPlayerHex(1),
  getPlayerHex(2),
  getPlayerHex(3),
];

export class UnitRenderer {
  private readonly scene: THREE.Scene;
  private readonly unitMeshes: Map<string, UnitMeshGroup> = new Map();
  private readonly models: UnitModels;
  private readonly animations: UnitAnimations;
  private readonly projectileSystem: ProjectileSystem;
  private readonly vfx: UnitVFX;
  private readonly speechBubbles: SpeechBubbleSystem;
  private aggroLines: Map<string, THREE.Line> = new Map();
  private aggroRings: Map<string, THREE.Mesh> = new Map();
  private squadRings: Map<string, THREE.Mesh> = new Map();
  private squadLabels: Map<number, THREE.Sprite> = new Map();
  private squadLabelCanvases: Map<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; lastText: string }> = new Map();
  private squadMemberLines: Map<number, THREE.LineSegments> = new Map();
  private _selectedSquadId: number | null = null;
  private static MELEE_TYPES: Set<UnitType> = new Set([
    UnitType.WARRIOR, UnitType.RIDER, UnitType.ASSASSIN,
    UnitType.SHIELDBEARER, UnitType.BERSERKER, UnitType.PALADIN,
    UnitType.GREATSWORD,
  ]);
  private strafePhases: Map<string, number> = new Map();
  /** Per-player tribe color override (unused — team colors remain primary). */
  private playerTribeColors: Map<number, number> = new Map();
  /** Per-player tribe config for model skinning. */
  private playerTribeConfigs: Map<number, TribeConfig> = new Map();

  /** Register tribe assignments for all players. Call after game start.
   *  Stores tribe configs so UnitModels can apply tribe-specific armor/accent/trim
   *  colors. Does NOT override playerColor — team colors remain primary identifier. */
  setPlayerTribes(players: Array<{ id: number; tribeId?: string }>): void {
    this.playerTribeColors.clear();
    this.playerTribeConfigs.clear();
    for (const p of players) {
      if (p.tribeId) {
        const tribe = TRIBE_BY_ID.get(p.tribeId as TribeId);
        if (tribe) this.playerTribeConfigs.set(p.id, tribe);
      }
    }
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.models = new UnitModels(scene);
    this.vfx = new UnitVFX(scene, { getUnitMeshes: () => this.unitMeshes });
    this.projectileSystem = new ProjectileSystem(scene, { getUnitMeshes: () => this.unitMeshes });
    this.speechBubbles = new SpeechBubbleSystem(scene, { getUnitMeshes: () => this.unitMeshes });
    this.animations = new UnitAnimations(scene, {
      getUnitMeshes: () => this.unitMeshes,
      spawnSwingTrail: (unitId, trailType, time) => this.vfx.spawnSwingTrail(unitId, trailType, time),
      spawnBoulder: (fromPos, toPos, onImpact) => this.projectileSystem.spawnBoulder(fromPos, toPos, onImpact),
    });
  }

  hexToWorld(coord: HexCoord, elevation: number): THREE.Vector3 {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    return new THREE.Vector3(x, elevation + 0.25, z);
  }

  addUnit(unit: Unit, elevation: number): void {
    this.removeUnit(unit.id);

    const group = new THREE.Group();
    const pos = this.hexToWorld(unit.position, elevation);
    group.position.copy(pos);
    const playerColor = this.playerTribeColors.get(unit.owner)
      ?? PLAYER_COLORS[unit.owner % PLAYER_COLORS.length];
    const tribeConf = this.playerTribeConfigs.get(unit.owner);
    const tribeSkin = tribeConf
      ? { secondary: tribeConf.palette.secondary, accent: tribeConf.palette.accent, trim: tribeConf.palette.trim }
      : undefined;
    this.models.buildUnitModel(group, unit.type, playerColor, tribeSkin);
    const isSiege = unit.type === UnitType.TREBUCHET;
    const label = this.createLabel(unit.type);
    label.position.y = isSiege ? 2.5 : 1.4;
    group.add(label);
    const healthRatio = unit.currentHealth / unit.stats.maxHealth;
    const healthBarAssets = this.vfx.createHealthBar(unit.type, healthRatio);
    group.add(healthBarAssets.healthBar);
    this.unitMeshes.set(unit.id, {
      group,
      unitId: unit.id,
      unitType: unit.type,
      healthBar: healthBarAssets.healthBar,
      healthBarCanvas: healthBarAssets.healthBarCanvas,
      healthBarCtx: healthBarAssets.healthBarCtx,
      healthBarTexture: healthBarAssets.healthBarTexture,
      lastHealthRatio: healthBarAssets.lastHealthRatio,
      label,
      facingAngle: 0,
      lastPosition: pos.clone(),
      trebFireStart: 0,
      trebPendingTarget: null,
      attackAnimStart: 0,
      _knockbackUntil: 0,
      _elevSpeed: 0,
      _elevDelta: 0,
      _hopOffset: 0,
      _landSquash: 0,
      _moveStartTime: 0,
      _wasMoving: false,
      _stableY: pos.y,
    });
    this.scene.add(group);
  }

  static buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number): void {
    UnitModels.buildUnitModel(group, type, playerColor);
  }

  private createLabel(type: UnitType): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    // Label text based on type
    const labels: Record<string, string> = {
      [UnitType.WARRIOR]: 'KNIGHT',
      [UnitType.ARCHER]: 'ARCHER',
      [UnitType.RIDER]: 'RIDER',
      [UnitType.PALADIN]: 'PALADIN',
      [UnitType.TREBUCHET]: 'TREBUCHET',
      [UnitType.SCOUT]: 'SCOUT',
      [UnitType.MAGE]: 'MAGE',
      [UnitType.BUILDER]: 'BUILDER',
      [UnitType.LUMBERJACK]: 'LUMBER',
      [UnitType.VILLAGER]: 'VILLAGER',
      [UnitType.HEALER]: 'HEALER',
      [UnitType.ASSASSIN]: 'ASSASSIN',
      [UnitType.SHIELDBEARER]: 'SHIELD',
      [UnitType.BERSERKER]: 'BERSERK',
      [UnitType.BATTLEMAGE]: 'B.MAGE',
    };

    const text = labels[type] || type.toUpperCase();

    // Draw text with shadow
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(text, 65, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 64, 21);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.8, 0.2, 1);
    sprite.renderOrder = 999;
    return sprite;
  }
  removeUnit(unitId: string): void {
    const entry = this.unitMeshes.get(unitId);
    if (entry) {
      // Clean up VFX state FIRST (cancels flash timers, restores shared materials,
      // disposes bleed-tint clones) — must happen while entry is still in the map
      this.vfx.cleanupUnit(unitId);

      this.scene.remove(entry.group);
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          // Don't dispose materials — they may be shared via the global material cache.
          // Cache manages material lifecycle. Only dispose non-cached materials (sprites, etc.)
          // (Bleed-tint cloned materials are already disposed by vfx.cleanupUnit above)
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
      this.unitMeshes.delete(unitId);
    }
  }
  moveUnit(unitId: string, newCoord: HexCoord, elevation: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    const target = this.hexToWorld(newCoord, elevation);

    // Simple lerp animation
    const start = entry.group.position.clone();
    const duration = 300; // ms
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = t * (2 - t); // ease-out quad

      entry.group.position.lerpVectors(start, target, eased);

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    animate();
  }
  knockbackUnit(unitId: string, targetWorldPos: { x: number; y: number; z: number }): void {
    this.vfx.knockbackUnit(unitId, targetWorldPos);
  }

  updateHealthBar(unit: Unit): void {
    this.vfx.updateHealthBar(unit);
  }

  setWorldPosition(
    unitId: string, x: number, y: number, z: number,
    elevActive?: boolean, elevGoingUp?: boolean, elevProgress?: number
  ): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    // If the unit is mid-knockback animation, don't override its position
    if (entry._knockbackUntil > performance.now()) return;

    const oldPos = entry.lastPosition;

    // Compute direction of movement (allocation-free)
    const dx = x - oldPos.x;
    const dz = z - oldPos.z;
    const lenSq = dx * dx + dz * dz; // XZ only for movement detection
    const isMoving = lenSq > 0.000025;

    // Only rotate if there's meaningful movement (0.005² = 0.000025)
    if (isMoving) {
      const targetAngle = Math.atan2(dx, dz);
      const angleDiff = targetAngle - entry.facingAngle;
      const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const lerpFactor = (entry.unitType === UnitType.TREBUCHET) ? 0.12 : 0.18;
      entry.facingAngle += normalizedDiff * lerpFactor;
      entry.group.rotation.y = entry.facingAngle;
    }

    // ═══ ORGANIC MOVEMENT: hop arc, landing squash, anticipation lean ═══
    // Uses DIRECT elevation state from UnitAI (elevActive/elevGoingUp/elevProgress)
    // instead of trying to detect dy between frames.

    const DT = 0.016; // ~60fps
    const wasInElev = entry._elevDelta !== 0; // were we in an elevation transition last frame?

    // ── 1. Hop arc during elevation transitions ──
    if (elevActive && elevProgress != null && elevProgress > 0 && elevProgress < 1) {
      // Mark that we're in an elevation transition
      entry._elevDelta = elevGoingUp ? 1 : -1; // just direction flag, not actual delta
      entry._elevSpeed = elevProgress;

      // Parabolic arc: peaks at progress=0.5, returns to 0 at progress=1.0
      const arc = 4 * elevProgress * (1 - elevProgress); // 0→1→0 parabola

      if (elevGoingUp) {
        // CLIMBING: hop upward — body springs above the interpolated Y
        entry._hopOffset = arc * 0.22;
      } else {
        // DESCENDING: dip below — body drops past the interpolated Y briefly
        entry._hopOffset = -arc * 0.15;
      }
    } else {
      // Not in an elevation transition
      if (wasInElev && entry._landSquash <= 0) {
        // Just finished an elevation change — trigger landing squash
        entry._landSquash = 0.30;
      }
      entry._elevDelta = 0;
      entry._elevSpeed = 0;

      // Decay hop offset back to 0 (fast spring) when not squashing
      if (entry._landSquash <= 0) {
        entry._hopOffset *= 0.70;
        if (Math.abs(entry._hopOffset) < 0.003) entry._hopOffset = 0;
      }
    }

    // ── 2. Landing squash — compress on touchdown, bounce back ──
    if (entry._landSquash > 0) {
      entry._landSquash -= DT;
      if (entry._landSquash < 0) entry._landSquash = 0;
      const t = entry._landSquash / 0.30; // 1.0 → 0.0
      if (t > 0.55) {
        // Impact compress — squish down
        const ct = (t - 0.55) / 0.45;
        entry._hopOffset = -0.12 * ct;
        entry.group.scale.set(1.0 + 0.08 * ct, 1.0 - 0.15 * ct, 1.0 + 0.08 * ct);
      } else if (t > 0.2) {
        // Overshoot bounce — spring back up
        const bt = (t - 0.2) / 0.35;
        const bounce = Math.sin((1 - bt) * Math.PI);
        entry._hopOffset = 0.05 * bounce;
        entry.group.scale.set(1.0 - 0.04 * bounce, 1.0 + 0.06 * bounce, 1.0 - 0.04 * bounce);
      } else {
        // Settle back to normal
        const st = t / 0.2;
        entry._hopOffset = 0.02 * st;
        entry.group.scale.set(1.0, 1.0, 1.0);
      }
    } else {
      // Ensure scale is normal when not squashing
      if (entry.group.scale.x !== 1.0) entry.group.scale.set(1.0, 1.0, 1.0);
    }

    // ── 3. Anticipation lean — forward tilt when starting to move ──
    if (isMoving && !entry._wasMoving) {
      entry._moveStartTime = 0.22;
    }
    entry._wasMoving = isMoving;

    if (entry._moveStartTime > 0) {
      entry._moveStartTime -= DT;
      if (entry._moveStartTime < 0) entry._moveStartTime = 0;
      const leanT = entry._moveStartTime / 0.22;
      entry.group.rotation.x = -(leanT * leanT * 0.12);
    }

    // ── 4. Step-climb body tilt ──
    if (elevActive && elevProgress != null && elevProgress > 0) {
      const tiltTarget = elevGoingUp ? -0.20 : 0.16;
      entry.group.rotation.x += (tiltTarget - entry.group.rotation.x) * 0.25;
    }

    // Apply final position with hop offset
    entry.group.position.set(x, y + entry._hopOffset, z);
    oldPos.set(x, y, z);
  }
  setSelected(unitId: string, selected: boolean, attackRange?: number): void {
    this.vfx.setSelected(unitId, selected, attackRange);
  }

  setVisible(unitId: string, visible: boolean): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    entry.group.visible = visible;
  }
  getUnitGroup(unitId: string): THREE.Group | null {
    return this.unitMeshes.get(unitId)?.group || null;
  }
  getAllGroups(): THREE.Group[] {
    return Array.from(this.unitMeshes.values()).map((m) => m.group);
  }
  highlightAttackTarget(unitId: string | null): void {
    this.vfx.highlightAttackTarget(unitId);
  }

  updateAttackTargetRing(time: number): void {
    this.vfx.updateAttackTargetRing(time);
  }

  spawnSwingTrail(unitId: string, trailType: "slash" | "stab" | "smash", time: number): void {
    this.vfx.spawnSwingTrail(unitId, trailType, time);
  }

  updateSwingTrails(time: number): void {
    this.vfx.updateSwingTrails(time);
  }

  applyCombatStrafe(unitId: string, targetWorldPos: { x: number; y: number; z: number }, time: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    if (!UnitRenderer.MELEE_TYPES.has(entry.unitType)) return;

    // Get or create a unique phase offset for this unit (so units don't all orbit in sync)
    if (!this.strafePhases.has(unitId)) {
      let hash = 0;
      for (let i = 0; i < unitId.length; i++) hash = ((hash << 5) - hash + unitId.charCodeAt(i)) | 0;
      this.strafePhases.set(unitId, (hash % 628) / 100); // 0 to ~6.28
    }
    const phaseOffset = this.strafePhases.get(unitId)!;

    // Orbit parameters
    const orbitSpeed = 1.2; // radians per second
    const orbitRadius = 0.35; // small circle-strafe radius
    const lungeFreq = 2.5; // in-out lunge frequency
    const lungeAmp = 0.2; // lunge depth

    const angle = time * orbitSpeed + phaseOffset;
    const dx = targetWorldPos.x - entry.group.position.x;
    const dz = targetWorldPos.z - entry.group.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) return; // overlapping, skip

    // Tangent direction for orbit (perpendicular to target vector)
    const nx = dx / dist;
    const nz = dz / dist;
    const tangentX = -nz;
    const tangentZ = nx;

    // Circle-strafe offset (perpendicular to target direction)
    const strafeX = tangentX * Math.sin(angle) * orbitRadius;
    const strafeZ = tangentZ * Math.sin(angle) * orbitRadius;

    // Lunge in-out toward target
    const lunge = Math.sin(time * lungeFreq + phaseOffset) * lungeAmp;
    const lungeX = nx * lunge;
    const lungeZ = nz * lunge;

    entry.group.position.x += strafeX + lungeX;
    entry.group.position.z += strafeZ + lungeZ;
  }

  /** Clear strafe phase for removed units */
  clearStrafePhase(unitId: string): void {
    this.strafePhases.delete(unitId);
  }
 
  faceTarget(unitId: string, targetWorldPos: { x: number; y: number; z: number }): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    const dx = targetWorldPos.x - entry.group.position.x;
    const dz = targetWorldPos.z - entry.group.position.z;
    if (dx * dx + dz * dz < 0.01) return; // too close, skip
    const targetAngle = Math.atan2(dx, dz);
    const angleDiff = Math.atan2(Math.sin(targetAngle - entry.facingAngle), Math.cos(targetAngle - entry.facingAngle));
    entry.facingAngle += angleDiff * 0.2;
    entry.group.rotation.y = entry.facingAngle;
  }
  animateUnit(unitId: string, state: string, time: number, unitType?: UnitType): void {
    this.animations.animateUnit(unitId, state, time, unitType);
  }

  resetAttackAnim(unitId: string): void {
    this.animations.resetAttackAnim(unitId);
  }

  spawnBlockSparks(worldPos: { x: number; y: number; z: number }): void {
    this.vfx.spawnBlockSparks(worldPos);
  }

  spawnElementalImpact(worldPos: { x: number; y: number; z: number }, element: ElementType): void {
    this.vfx.spawnElementalImpact(worldPos, element);
  }

  static elementOrbColor(element: ElementType): number {
    return UnitVFX.elementOrbColor(element);
  }

  animatePreviewGroup(group: THREE.Group, unitType: UnitType, state: "idle" | "moving" | "attacking" | "hit" | "block", time: number): void {
    this.animations.animatePreviewGroup(group, unitType, state, time);
  }

  /** Clear preview animation state — call when debug preview is destroyed */
  clearPreviewAnimation(): void {
    this.animations.clearPreviewEntry();
  }

  fireArrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireArrow(fromPos, toPos, targetUnitId, onImpact);
  }

  fireDeflectedArrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireDeflectedArrow(fromPos, toPos, targetUnitId, onImpact);
  }

  spawnDeflectedAxe(impactPos: { x: number; y: number; z: number }): void {
    this.projectileSystem.spawnDeflectedAxe(impactPos);
  }

  spawnOgreGroundPound(centerPos: { x: number; y: number; z: number }): void {
    this.projectileSystem.spawnOgreGroundPound(centerPos);
  }

  fireMagicOrb(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number, targetUnitId?: string, isAoE = false, onImpact?: () => void): void {
    this.projectileSystem.fireMagicOrb(fromPos, toPos, color, targetUnitId, isAoE, onImpact);
  }

  fireLightningBolt(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireLightningBolt(fromPos, toPos, targetUnitId, onImpact);
  }

  fireLightningChain(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string): void {
    this.projectileSystem.fireLightningChain(fromPos, toPos, targetUnitId);
  }

  fireKamehamehaBeam(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, piercedPositions: { x: number; y: number; z: number }[]): void {
    this.projectileSystem.fireKamehamehaBeam(fromPos, toPos, piercedPositions);
  }

  fireArrowVolley(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, count: number, onImpact?: () => void): void {
    this.projectileSystem.fireArrowVolley(fromPos, toPos, count, onImpact);
  }

  fireCannonball(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
    this.projectileSystem.fireCannonball(fromPos, toPos, onImpact);
  }

  addCannonTurret(buildingKey: string, worldPos: { x: number; y: number; z: number }, playerColor?: number): void {
    this.projectileSystem.addCannonTurret(buildingKey, worldPos, playerColor);
  }

  removeCannonTurret(buildingKey: string): void {
    this.projectileSystem.removeCannonTurret(buildingKey);
  }

  setCannonTarget(buildingKey: string, targetPos: { x: number; y: number; z: number } | null): void {
    this.projectileSystem.setCannonTarget(buildingKey, targetPos);
  }

  hasCannonTurret(buildingKey: string): boolean {
    return this.projectileSystem.hasCannonTurret(buildingKey);
  }

  spawnElectrocuteEffect(unitId: string): void {
    this.projectileSystem.spawnElectrocuteEffect(unitId);
  }

  fireFlamethrower(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireFlamethrower(fromPos, toPos, targetUnitId, onImpact);
  }

  fireStoneColumn(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireStoneColumn(fromPos, toPos, targetUnitId, onImpact);
  }

  fireWaterWave(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireWaterWave(fromPos, toPos, targetUnitId, onImpact);
  }

  fireWindTornado(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireWindTornado(fromPos, toPos, targetUnitId, onImpact);
  }

  fireHealOrb(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireHealOrb(fromPos, toPos, targetUnitId, onImpact);
  }

  spawnHealImpact(pos: { x: number; y: number; z: number }): void {
    this.projectileSystem.spawnHealImpact(pos);
  }

  fireProjectile(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number = 0xFF8800, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireProjectile(fromPos, toPos, color, targetUnitId, onImpact);
  }

  spawnAoEExplosion(centerWorld: { x: number; y: number; z: number }, radius: number, color: number): void {
    this.projectileSystem.spawnAoEExplosion(centerWorld, radius, color);
  }

  updateTrailParticles(): void {
    this.projectileSystem.updateTrailParticles();
  }

  fireBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
    this.projectileSystem.fireBoulder(fromPos, toPos, onImpact);
  }

  fireAxeThrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string, onImpact?: () => void): void {
    this.projectileSystem.fireAxeThrow(fromPos, toPos, targetUnitId, onImpact);
  }

  updateProjectiles(delta: number): void {
    this.projectileSystem.updateProjectiles(delta);
  }

  queueDeferredEffect(delayMs: number, callback: () => void): void {
    this.vfx.queueDeferredEffect(delayMs, callback);
  }

  updateDeferredEffects(): void {
    this.vfx.updateDeferredEffects();
  }

  showDamageEffect(worldPos: { x: number; y: number; z: number }): void {
    this.vfx.showDamageEffect(worldPos);
  }

  flashUnit(unitId: string, duration: number = 0.15): void {
    this.vfx.flashUnit(unitId, duration);
  }

  showXPText(worldPos: { x: number; y: number; z: number }, xp: number): void {
    this.vfx.showXPText(worldPos, xp);
  }

  showCritText(worldPos: { x: number; y: number; z: number }, combo: string, damage: number, color: string): void {
    this.vfx.showCritText(worldPos, combo, damage, color);
  }

  showLevelUpEffect(unitId: string, worldPos: { x: number; y: number; z: number }, newLevel: number): void {
    this.vfx.showLevelUpEffect(unitId, worldPos, newLevel);
  }

  applyBleedTint(unitId: string, healthPercent: number): void {
    this.vfx.applyBleedTint(unitId, healthPercent);
  }

  // Secondary melee attack VFX
  spawnGreatswordSpin(worldPos: { x: number; y: number; z: number }): void {
    this.vfx.spawnGreatswordSpin(worldPos);
  }
  spawnJumpAttackImpact(worldPos: { x: number; y: number; z: number }): void {
    this.vfx.spawnJumpAttackImpact(worldPos);
  }
  animateJumpAttack(unitId: string): void {
    this.vfx.animateJumpAttack(unitId);
  }
  spawnPaladinChargeField(unitId: string): void {
    this.vfx.spawnPaladinChargeField(unitId);
  }
  spawnPaladinImpactBurst(worldPos: { x: number; y: number; z: number }): void {
    this.vfx.spawnPaladinImpactBurst(worldPos);
  }
  applyLevelUpVisuals(unitId: string, newLevel: number): void {
    this.vfx.applyLevelUpVisuals(unitId, newLevel);
  }

  updateBillboards(camera: THREE.Camera): void {
    this.vfx.updateBillboards(camera);
  }

  // ── Speech Bubble facade ──────────────────────────────
  /** Trigger a speech bubble + voice bark on a unit (throttled internally). */
  triggerSpeechBubble(unitId: string, unitType: UnitType, context: DialogueContext): void {
    this.speechBubbles.trigger(unitId, unitType, context);
  }
  /** Call per-frame to animate active speech bubbles. */
  updateSpeechBubbles(time: number): void {
    this.speechBubbles.update(time);
  }
  /** Enable/disable text-to-speech voice output. */
  setSpeechTTSEnabled(enabled: boolean): void {
    this.speechBubbles.setTTSEnabled(enabled);
  }
  /** Set speech volume (0–1). */
  setSpeechVolume(vol: number): void {
    this.speechBubbles.setSpeechVolume(vol);
  }

  dispose(): void {
    this.projectileSystem.dispose();
    this.vfx.dispose();
    this.speechBubbles.cleanup();
    for (const unitId of [...this.unitMeshes.keys()]) {
      this.removeUnit(unitId);
    }
    this.clearAggroIndicators();
    this.clearSquadIndicators();
  }

  // Reusable sets for aggro indicator cleanup — avoids per-frame allocation
  private _activeAttackerIds: Set<string> = new Set();
  private _activeTargetIds: Set<string> = new Set();

  updateAggroIndicators(aggroList: Array<{ attackerId: string; targetId: string }>, time: number): void {
    const activeAttackerIds = this._activeAttackerIds;
    const activeTargetIds = this._activeTargetIds;
    activeAttackerIds.clear();
    activeTargetIds.clear();

    for (const { attackerId, targetId } of aggroList) {
      activeAttackerIds.add(attackerId);
      activeTargetIds.add(targetId);

      const attackerEntry = this.unitMeshes.get(attackerId);
      const targetEntry = this.unitMeshes.get(targetId);
      if (!attackerEntry || !targetEntry) continue;

      const aPos = attackerEntry.group.position;
      const tPos = targetEntry.group.position;

      // ── Aggro line (attacker → target) ──
      let line = this.aggroLines.get(attackerId);
      if (!line) {
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 vertices × 3 components
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({
          color: 0x9b59b6, // purple — distinct from squad indicators
          transparent: true,
          opacity: 0.5,
          depthTest: false,
        });
        line = new THREE.Line(geom, mat);
        line.renderOrder = 998;
        this.scene.add(line);
        this.aggroLines.set(attackerId, line);
      }
      // Update line endpoints
      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, aPos.x, aPos.y + 0.5, aPos.z);
      posAttr.setXYZ(1, tPos.x, tPos.y + 0.5, tPos.z);
      posAttr.needsUpdate = true;
      // Pulse opacity
      (line.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.2 * Math.sin(time * 4);

      // ── Target ring (pulsing red ring under the enemy) ──
      let ring = this.aggroRings.get(targetId);
      if (!ring) {
        const ringGeo = new THREE.RingGeometry(0.35, 0.5, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x8e44ad, // purple — distinct from squad indicators
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        });
        ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 997;
        this.scene.add(ring);
        this.aggroRings.set(targetId, ring);
      }
      // Update ring position and pulse
      ring.position.set(tPos.x, tPos.y + 0.03, tPos.z);
      const pulse = 0.5 + 0.3 * Math.sin(time * 5);
      (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      const scale = 1.0 + 0.15 * Math.sin(time * 5);
      ring.scale.set(scale, scale, scale);
    }

    // ── Clean up stale lines ──
    for (const [id, line] of this.aggroLines) {
      if (!activeAttackerIds.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.aggroLines.delete(id);
      }
    }

    // ── Clean up stale rings ──
    for (const [id, ring] of this.aggroRings) {
      if (!activeTargetIds.has(id)) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.aggroRings.delete(id);
      }
    }
  }

  /** Remove all aggro indicators (e.g. on game reset) */
  clearAggroIndicators(): void {
    for (const [, line] of this.aggroLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.aggroLines.clear();
    for (const [, ring] of this.aggroRings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.aggroRings.clear();
  }

  // ===================== SQUAD INDICATORS =====================
  // Shows colored rings under squad members and floating labels at squad centroids
  // with objective type abbreviations (CAPTURE, ESCORT, HARASS, SCOUT, etc.)

  /** Squad color palette — each squad gets a distinct color */
  private static SQUAD_COLORS = [
    0x00ffff, // cyan
    0xff8800, // orange
    0x88ff00, // lime
    0xff00ff, // magenta
    0xffff00, // yellow
    0x00ff88, // mint
    0x8888ff, // lavender
    0xff4488, // pink
    0x44ddff, // sky
    0xffaa44, // amber
  ];

  /** Get a consistent color for a squad ID */
  private getSquadColor(squadId: number): number {
    return UnitRenderer.SQUAD_COLORS[squadId % UnitRenderer.SQUAD_COLORS.length];
  }

  /**
   * Update squad indicators — called each frame from main loop.
   * @param squads Array of active squad data:
   *   - squadId: numeric squad identifier
   *   - label: objective label string (e.g. "SQD 1 CAPTURE")
   *   - unitIds: list of unit IDs in this squad
   *   - centroidWorld: {x, y, z} world position for the label
   */
  /** Team colors for squad member lines */
  private static TEAM_COLORS_HEX: Record<number, number> = {
    0: getPlayerHex(0),
    1: getPlayerHex(1),
    2: getPlayerHex(2),
    3: getPlayerHex(3),
  };

  updateSquadIndicators(
    squads: Array<{
      squadId: number;
      label: string;
      unitIds: string[];
      centroidWorld: { x: number; y: number; z: number };
      teamId?: number;
      unitPositions?: Array<{ x: number; y: number; z: number }>;
    }>,
    time: number
  ): void {
    const activeSquadIds = new Set<number>();
    const activeUnitIds = new Set<string>();

    for (const squad of squads) {
      activeSquadIds.add(squad.squadId);
      const color = this.getSquadColor(squad.squadId);
      const isSelected = this._selectedSquadId === squad.squadId;

      // ── Per-unit squad rings ──
      for (const uid of squad.unitIds) {
        activeUnitIds.add(uid);
        const entry = this.unitMeshes.get(uid);
        if (!entry) continue;

        let ring = this.squadRings.get(uid);
        if (!ring) {
          const ringGeo = new THREE.RingGeometry(0.3, 0.42, 16);
          const ringMat = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
          });
          ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.renderOrder = 996;
          ring.name = 'squad-ring';
          this.scene.add(ring);
          this.squadRings.set(uid, ring);
        }

        // Update position to follow unit
        const pos = entry.group.position;
        ring.position.set(pos.x, pos.y + 0.03, pos.z);

        // Update color if squad changed
        const mat = ring.material as THREE.MeshBasicMaterial;
        if (mat.color.getHex() !== color) mat.color.setHex(color);

        // Selected squad gets brighter, pulsing rings
        if (isSelected) {
          mat.opacity = 0.6 + 0.3 * Math.sin(time * 5);
          const s = 1.1 + 0.1 * Math.sin(time * 5);
          ring.scale.set(s, s, s);
        } else {
          mat.opacity = 0.4;
          ring.scale.set(1, 1, 1);
        }
      }

      // ── Floating squad label at centroid ──
      let labelSprite = this.squadLabels.get(squad.squadId);
      let labelData = this.squadLabelCanvases.get(squad.squadId);

      if (!labelSprite) {
        // Create canvas + sprite (large for visibility)
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 72;
        const ctx = canvas.getContext('2d')!;
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        });
        labelSprite = new THREE.Sprite(spriteMat);
        labelSprite.scale.set(4.0, 0.6, 1);
        labelSprite.renderOrder = 1000;
        this.scene.add(labelSprite);
        this.squadLabels.set(squad.squadId, labelSprite);
        labelData = { canvas, ctx, texture, lastText: '' };
        this.squadLabelCanvases.set(squad.squadId, labelData);
      }

      // Redraw canvas only when text changes
      if (labelData && labelData.lastText !== squad.label) {
        const { canvas, ctx, texture } = labelData;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background pill
        ctx.font = 'bold 28px monospace';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        const textWidth = ctx.measureText(squad.label).width || 280;
        const pillW = Math.min(canvas.width - 8, textWidth + 40);
        const pillX = (canvas.width - pillW) / 2;
        ctx.beginPath();
        ctx.roundRect(pillX, 4, pillW, 64, 8);
        ctx.fill();

        // Colored left accent bar
        const colorHex = '#' + color.toString(16).padStart(6, '0');
        ctx.fillStyle = colorHex;
        ctx.fillRect(pillX + 5, 8, 6, 56);

        // Text with shadow for readability
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(squad.label, canvas.width / 2, 38);
        ctx.shadowBlur = 0;

        // Colored text overlay (slightly transparent for glow effect)
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = colorHex;
        ctx.fillText(squad.label, canvas.width / 2, 38);
        ctx.globalAlpha = 1.0;

        texture.needsUpdate = true;
        labelData.lastText = squad.label;
      }

      // Position label above squad centroid (raised for visibility)
      const labelY = squad.centroidWorld.y + 3.5;
      labelSprite.position.set(
        squad.centroidWorld.x,
        labelY,
        squad.centroidWorld.z
      );

      // Selected squad label pulses
      if (isSelected && labelSprite.material instanceof THREE.SpriteMaterial) {
        labelSprite.material.opacity = 0.9 + 0.1 * Math.sin(time * 4);
      } else if (labelSprite.material instanceof THREE.SpriteMaterial) {
        labelSprite.material.opacity = 0.95;
      }

      // ── Team-colored lines from label to each squad member ──
      const teamColor = UnitRenderer.TEAM_COLORS_HEX[squad.teamId ?? 0] ?? getPlayerHex(0);
      const unitPositions = squad.unitPositions || [];
      const numUnits = unitPositions.length;
      let memberLines = this.squadMemberLines.get(squad.squadId);

      if (!memberLines) {
        // Create LineSegments with enough capacity (2 verts per line segment)
        const maxVerts = 64 * 2; // support up to 64 members
        const posArr = new Float32Array(maxVerts * 3);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geom.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({
          color: teamColor,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
          linewidth: 2, // Note: WebGL may clamp this, but it helps on some renderers
        });
        memberLines = new THREE.LineSegments(geom, mat);
        memberLines.renderOrder = 995;
        memberLines.frustumCulled = false;
        this.scene.add(memberLines);
        this.squadMemberLines.set(squad.squadId, memberLines);
      }

      // Update line color if team changed
      const lineMat = memberLines.material as THREE.LineBasicMaterial;
      if (lineMat.color.getHex() !== teamColor) lineMat.color.setHex(teamColor);
      lineMat.opacity = isSelected ? 0.55 : 0.4;

      // Update line vertices: each member gets a line from label pos to unit pos
      const linePos = memberLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const drawCount = Math.min(numUnits, 64) * 2;
      for (let i = 0; i < Math.min(numUnits, 64); i++) {
        const up = unitPositions[i];
        const vi = i * 2;
        // Start vertex: label position
        linePos.setXYZ(vi, squad.centroidWorld.x, labelY, squad.centroidWorld.z);
        // End vertex: unit position (slightly above ground)
        linePos.setXYZ(vi + 1, up.x, up.y + 0.5, up.z);
      }
      linePos.needsUpdate = true;
      memberLines.geometry.setDrawRange(0, drawCount);
    }

    // ── Clean up stale squad rings ──
    for (const [uid, ring] of this.squadRings) {
      if (!activeUnitIds.has(uid)) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.squadRings.delete(uid);
      }
    }

    // ── Clean up stale squad labels ──
    for (const [sid, sprite] of this.squadLabels) {
      if (!activeSquadIds.has(sid)) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        this.squadLabels.delete(sid);
        this.squadLabelCanvases.delete(sid);
      }
    }

    // ── Clean up stale squad member lines ──
    for (const [sid, lines] of this.squadMemberLines) {
      if (!activeSquadIds.has(sid)) {
        this.scene.remove(lines);
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
        this.squadMemberLines.delete(sid);
      }
    }
  }

  /** Select a squad by ID for bright highlight, or null to deselect */
  selectSquad(squadId: number | null): void {
    this._selectedSquadId = squadId;
  }

  /** Get the currently selected squad ID */
  get selectedSquadId(): number | null {
    return this._selectedSquadId;
  }

  /** Clear all squad indicators (e.g. on game reset) */
  clearSquadIndicators(): void {
    for (const [, ring] of this.squadRings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.squadRings.clear();
    for (const [, sprite] of this.squadLabels) {
      this.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.squadLabels.clear();
    this.squadLabelCanvases.clear();
    this._selectedSquadId = null;
  }
}
