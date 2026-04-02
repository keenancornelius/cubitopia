import * as THREE from 'three';
import { UnitType } from '../types';
import type { UnitMeshGroup } from './UnitRenderer';

type WorldPos = { x: number; y: number; z: number };
type TrailType = 'slash' | 'stab' | 'smash';

export class UnitAnimations {
  private readonly getUnitMeshesRef: () => Map<string, UnitMeshGroup>;
  private readonly spawnSwingTrailRef: (unitId: string, trailType: TrailType, time: number) => void;
  private readonly spawnBoulderRef: (fromPos: WorldPos, toPos: WorldPos, onImpact?: () => void) => void;

  constructor(
    private readonly scene: THREE.Scene,
    deps: {
      getUnitMeshes: () => Map<string, UnitMeshGroup>;
      spawnSwingTrail: (unitId: string, trailType: TrailType, time: number) => void;
      spawnBoulder: (fromPos: WorldPos, toPos: WorldPos, onImpact?: () => void) => void;
    },
  ) {
    this.getUnitMeshesRef = deps.getUnitMeshes;
    this.spawnSwingTrailRef = deps.spawnSwingTrail;
    this.spawnBoulderRef = deps.spawnBoulder;
  }

  private get unitMeshes(): Map<string, UnitMeshGroup> {
    return this.getUnitMeshesRef();
  }

  private spawnSwingTrail(unitId: string, trailType: TrailType, time: number): void {
    this.spawnSwingTrailRef(unitId, trailType, time);
  }

  private spawnBoulder(fromPos: WorldPos, toPos: WorldPos, onImpact?: () => void): void {
    this.spawnBoulderRef(fromPos, toPos, onImpact);
  }

  // Track per-unit swing state for alternating sides
  private swingState: Map<string, { side: number; lastSwingTime: number }> = new Map();

  /**
   * Wind-up / strike animation helper.
   * Returns a rotation value that:
   *   - Slowly winds up (rotates back) over the first part of the cycle
   *   - Quickly unwinds and stops abruptly (like hitting something)
   *   - Alternates which side it swings to
   *
   * @param time       Current elapsed time
   * @param speed      Swings per second
   * @param windUp     Max wind-up angle in radians
   * @param unitId     For tracking alternating sides
   */
  private getStrikeRotation(time: number, speed: number, windUp: number, unitId: string): { z: number; x: number } {
    const cycleDuration = 1 / speed;
    const cycleTime = time % cycleDuration;
    const t = cycleTime / cycleDuration; // 0..1 within one swing cycle

    // Get or init swing state
    let swing = this.swingState.get(unitId);
    if (!swing) {
      swing = { side: 1, lastSwingTime: 0 };
      this.swingState.set(unitId, swing);
    }

    // Flip side each cycle
    const currentCycle = Math.floor(time / cycleDuration);
    if (currentCycle !== swing.lastSwingTime) {
      swing.side *= -1;
      swing.lastSwingTime = currentCycle;
    }
    const side = swing.side;

    // Wind-up phase: 0..0.6 — slow, easing rotation back
    // Strike phase: 0.6..0.75 — fast snap forward past center
    // Hold phase: 0.75..0.85 — brief hold at impact
    // Return phase: 0.85..1.0 — ease back to neutral

    let z: number;
    let x: number;

    if (t < 0.6) {
      // Wind-up: ease-in (slow start, accelerate)
      const p = t / 0.6;
      const eased = p * p; // quadratic ease-in
      z = side * windUp * eased;
      x = -eased * 0.1; // slight lean back during wind-up
    } else if (t < 0.75) {
      // Strike: fast snap to opposite side (impact!)
      const p = (t - 0.6) / 0.15;
      const eased = 1 - (1 - p) * (1 - p); // ease-out (fast start, decel)
      z = side * windUp * (1 - eased * 2.2); // overshoot past center
      x = -0.1 + eased * 0.25; // lean forward into strike
    } else if (t < 0.85) {
      // Hold at impact — abrupt stop
      z = side * windUp * -1.2;
      x = 0.15;
    } else {
      // Return to neutral
      const p = (t - 0.85) / 0.15;
      const eased = p * p;
      z = side * windUp * -1.2 * (1 - eased);
      x = 0.15 * (1 - eased);
    }

    return { z, x };
  }
  // Track last swing trail spawn time per unit (prevent spamming)
  private lastTrailTime: Map<string, number> = new Map();

  /** Spawn a trail if enough time has passed since last one for this unit */
  private trySpawnTrail(unitId: string, trailType: 'slash' | 'stab' | 'smash', time: number, cooldown: number): void {
    const last = this.lastTrailTime.get(unitId) ?? 0;
    if (time - last < cooldown) return;
    this.lastTrailTime.set(unitId, time);
    this.spawnSwingTrail(unitId, trailType, time);
  }
  /**
   * Animate a unit based on its state and type — per-unit-type realistic animations.
   * Body stays stable; only arms, legs, and slight leans animate.
   */
  animateUnit(unitId: string, state: string, time: number, unitType?: UnitType): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    const type = unitType ?? entry.unitType;
    const armLeft = entry.group.getObjectByName('arm-left');
    const armRight = entry.group.getObjectByName('arm-right');
    const legLeft = entry.group.getObjectByName('leg-left');
    const legRight = entry.group.getObjectByName('leg-right');

    // Smoothly decay body rotation each frame (don't let it stay tilted)
    entry.group.rotation.z *= 0.85;
    entry.group.rotation.x *= 0.85;

    // Attack animation hold — prevent jerky snapping by ensuring the attack
    // animation plays for at least one full cycle before transitioning away.
    // Minimum hold = 0.6s (enough for one clean swing to complete).
    const ATTACK_HOLD_MIN = 0.6;
    let effectiveState = state;
    if (state === 'attacking') {
      if (entry.attackAnimStart === 0) entry.attackAnimStart = time;
    } else if (entry.attackAnimStart > 0) {
      // State left 'attacking' — check if we should keep animating the attack
      const elapsed = time - entry.attackAnimStart;
      if (elapsed < ATTACK_HOLD_MIN) {
        effectiveState = 'attacking'; // keep playing attack anim
      } else {
        entry.attackAnimStart = 0; // release hold
      }
    }

    if (effectiveState === 'gathering') {
      this.animateGathering(entry, type, armLeft, armRight, legLeft, legRight, time, unitId);
    } else if (effectiveState === 'attacking') {
      this.animateAttacking(entry, type, armLeft, armRight, legLeft, legRight, time, unitId);
    } else if (effectiveState === 'building') {
      this.animateBuilding(entry, type, armLeft, armRight, time);
    } else if (effectiveState === 'constructing') {
      this.animateConstructing(entry, armLeft, armRight, legLeft, legRight, time);
    } else if (effectiveState === 'returning') {
      this.animateReturning(entry, armLeft, armRight, legLeft, legRight, time);
      this.showCarryVisual(entry, true);
    } else if (effectiveState === 'moving') {
      this.animateMoving(entry, type, armLeft, armRight, legLeft, legRight, time);
      this.showCarryVisual(entry, false);
    } else {
      // Idle: smoothly reset all limbs
      this.animateIdle(entry, type, armLeft, armRight, legLeft, legRight, time);
      this.showCarryVisual(entry, false);
    }

    // ─── ATTACK ELBOW FLEX — natural arm bend during combat swings ───
    if (effectiveState === 'attacking') {
      const atkElbowL = entry.group.getObjectByName('arm-left-elbow');
      const atkElbowR = entry.group.getObjectByName('arm-right-elbow');
      // When arm swings forward (positive x), elbow bends to follow through
      // When arm winds back (negative x), elbow extends for reach
      if (atkElbowR && armRight) {
        const ax = armRight.rotation.x;
        atkElbowR.rotation.x = ax > 0.3 ? -0.3 - ax * 0.2 : Math.min(0, ax * 0.3);
      }
      if (atkElbowL && armLeft) {
        const ax = armLeft.rotation.x;
        atkElbowL.rotation.x = ax > 0.3 ? -0.3 - ax * 0.2 : Math.min(0, ax * 0.3);
      }
    }

    // ─── PALADIN DIVINE AURA ANIMATION (runs in ALL states) ───
    if (type === UnitType.PALADIN) {
      this._animatePaladinAura(entry, time);
    }
    // ─── HEALER AMBIENT EFFECTS (runs in ALL states) ───
    if (type === UnitType.HEALER) {
      this._animateHealerAmbient(entry, time);
    }
    // ─── BATTLEMAGE ARCANE AURA (runs in ALL states) ───
    if (type === UnitType.BATTLEMAGE) {
      this._animateBattlemageAura(entry, time);
    }
  }

  // ─── GATHERING ─────────────────────────────────────────
  private animateGathering(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number, unitId: string
  ): void {
    // Slight forward lean while working (no full body shake)
    entry.group.rotation.x = 0.06;

    switch (type) {
      case UnitType.LUMBERJACK: {
        // Two-handed overhead axe chop: both arms raise and swing down
        const speed = 1.8;
        const cycle = (time * speed) % 1;
        let armAngle: number;
        if (cycle < 0.5) {
          // Wind-up: raise arms behind head
          const p = cycle / 0.5;
          armAngle = -0.8 * p * p; // ease-in, arms go backward (negative X = behind)
        } else if (cycle < 0.7) {
          // Strike: fast forward chop
          const p = (cycle - 0.5) / 0.2;
          armAngle = -0.8 + (0.8 + 1.0) * p; // swing from -0.8 to +1.0
        } else if (cycle < 0.8) {
          // Hold at impact
          armAngle = 1.0;
          entry.group.rotation.x = 0.12; // lean into the chop
        } else {
          // Return to neutral
          const p = (cycle - 0.8) / 0.2;
          armAngle = 1.0 * (1 - p);
        }
        if (armRight) armRight.rotation.x = armAngle;
        if (armLeft) armLeft.rotation.x = armAngle * 0.7; // off-hand follows loosely

        // Chop particle on impact
        if (cycle >= 0.68 && cycle <= 0.72) {
          this.showChopParticle(entry.group, time);
        }
        break;
      }
      case UnitType.VILLAGER: {
        // Scythe sweep: arm swings side to side in a wide horizontal arc
        const speed = 1.5;
        const swing = Math.sin(time * speed * Math.PI * 2);
        if (armRight) {
          armRight.rotation.x = 0.6; // hold arm forward
          armRight.rotation.z = swing * 0.5; // sweep left-right
        }
        if (armLeft) {
          armLeft.rotation.x = 0.3; // steadying hand
        }
        // Subtle weight shift in legs
        if (legLeft && legRight) {
          legLeft.rotation.x = swing * 0.1;
          legRight.rotation.x = -swing * 0.1;
        }
        break;
      }
      case UnitType.BUILDER: {
        // Mining: pickaxe overhead strike at rock
        const speed = 2.0;
        const cycle = (time * speed) % 1;
        let armAngle: number;
        if (cycle < 0.45) {
          const p = cycle / 0.45;
          armAngle = -0.6 * p; // raise pick behind
        } else if (cycle < 0.65) {
          const p = (cycle - 0.45) / 0.2;
          armAngle = -0.6 + (0.6 + 0.9) * p; // fast strike forward
        } else if (cycle < 0.75) {
          armAngle = 0.9; // impact hold
        } else {
          const p = (cycle - 0.75) / 0.25;
          armAngle = 0.9 * (1 - p);
        }
        if (armRight) armRight.rotation.x = armAngle;
        if (armLeft) armLeft.rotation.x = armAngle * 0.4;
        break;
      }
      default: {
        // Generic gathering: simple arm pump
        if (armRight) armRight.rotation.x = Math.sin(time * 3) * 0.5;
        if (armLeft) armLeft.rotation.x = Math.sin(time * 3 + Math.PI) * 0.2;
        break;
      }
    }
  }

  // ─── ATTACKING ─────────────────────────────────────────
  private animateAttacking(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number, unitId: string
  ): void {
    switch (type) {
      case UnitType.WARRIOR: {
        // Sword-and-board overhead strike: shield guards while sword cleaves
        // Phase 1 (0–0.30): Wind-up — sword arm cocks back overhead, shield tucks in
        // Phase 2 (0.30–0.48): Strike — explosive overhead cleave, shield punches forward
        // Phase 3 (0.48–0.62): Impact hold — sword low, shield braced, tremor
        // Phase 4 (0.62–1.0): Recovery — smoothstep back to guard
        const wSpd = 1.05;
        const wCyc = (time * wSpd) % 1;

        // Shield arm constants — stays defensive throughout
        const SHIELD_GUARD  = -0.55; // raised guard (idle-like)
        const SHIELD_TUCK   = -0.70; // tucked tight during wind-up
        const SHIELD_PUNCH  = -0.20; // punched forward during strike (bash assist)

        // Sword arm constants
        const SWORD_READY   =  0.18; // idle position
        const SWORD_COCK    = -1.50; // cocked back overhead
        const SWORD_SLAM    =  1.60; // extended down after cleave

        if (wCyc < 0.30) {
          // Wind-up: sword cocks overhead, shield tucks tight, lean back
          const p = wCyc / 0.30;
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          if (armRight) {
            armRight.rotation.x = SWORD_READY + (SWORD_COCK - SWORD_READY) * ease;
            armRight.rotation.z = -0.12 * ease; // elbow out
          }
          if (armLeft) {
            armLeft.rotation.x = SHIELD_GUARD + (SHIELD_TUCK - SHIELD_GUARD) * ease;
            armLeft.rotation.z = 0.15 * ease; // tuck shield inward
          }
          entry.group.rotation.x = -0.10 * ease; // lean back
        } else if (wCyc < 0.48) {
          // Strike: explosive overhead cleave + shield bash forward
          const p = (wCyc - 0.30) / 0.18;
          const smash = p * p; // ease-in → accelerating hit
          if (armRight) {
            armRight.rotation.x = SWORD_COCK + (SWORD_SLAM - SWORD_COCK) * smash;
            armRight.rotation.z = -0.12 + 0.30 * smash;
          }
          if (armLeft) {
            armLeft.rotation.x = SHIELD_TUCK + (SHIELD_PUNCH - SHIELD_TUCK) * smash;
            armLeft.rotation.z = 0.15 - 0.25 * smash; // shield punches outward
          }
          entry.group.rotation.x = -0.10 + 0.28 * smash; // lean back → forward lunge
          if (wCyc >= 0.38 && wCyc < 0.46) this.trySpawnTrail(unitId, 'slash', time, 0.3);
        } else if (wCyc < 0.62) {
          // Impact hold: sword low, shield braced, body forward, micro-tremor
          const tremor = Math.sin(time * 60) * 0.008 * Math.max(0, 1 - (wCyc - 0.48) / 0.14);
          if (armRight) { armRight.rotation.x = SWORD_SLAM; armRight.rotation.z = 0.18; }
          if (armLeft) { armLeft.rotation.x = SHIELD_PUNCH; armLeft.rotation.z = -0.10; }
          entry.group.rotation.x = 0.18 + tremor;
          if (wCyc >= 0.48 && wCyc < 0.54) this.trySpawnTrail(unitId, 'smash', time, 0.35);
        } else {
          // Recovery: smoothstep back to guard stance
          const p = (wCyc - 0.62) / 0.38;
          const ss = p * p * (3 - 2 * p); // smoothstep
          if (armRight) {
            armRight.rotation.x = SWORD_SLAM + (SWORD_READY - SWORD_SLAM) * ss;
            armRight.rotation.z = 0.18 * (1 - ss);
          }
          if (armLeft) {
            armLeft.rotation.x = SHIELD_PUNCH + (SHIELD_GUARD - SHIELD_PUNCH) * ss;
            armLeft.rotation.z = -0.10 * (1 - ss);
          }
          entry.group.rotation.x = 0.18 * (1 - ss);
        }
        // Power stance: front foot steps in during strike, braces on impact
        if (legLeft) legLeft.rotation.x = wCyc >= 0.30 && wCyc < 0.62 ? 0.30 : 0.30 * Math.max(0, 1 - Math.abs(wCyc - 0.45) * 4);
        if (legRight) legRight.rotation.x = wCyc >= 0.30 && wCyc < 0.62 ? -0.15 : 0;
        break;
      }
      case UnitType.ARCHER: {
        // Bow cycle with visible draw-back: raise → nock → draw string → aim → release → follow-through
        const speed = 0.75; // slightly slower for dramatic draw
        const cycle = (time * speed) % 1;

        // Grab bowstring + nocked arrow for animation
        const bowstring = entry.group.getObjectByName('bowstring');
        const nockedArrow = entry.group.getObjectByName('nocked-arrow');

        // Body: slight lean forward (aiming stance)
        entry.group.rotation.x = 0.04;

        // Max bowstring pull-back distance (Z offset from resting -0.06)
        const stringRestZ = -0.06;
        const stringDrawZ = -0.34; // pulled way back toward archer

        if (cycle < 0.10) {
          // Phase 1: STANCE — bow arm rises, draw hand reaches for string, nock arrow
          const p = cycle / 0.10;
          const ease = p * p;
          if (armLeft) armLeft.rotation.x = -0.2 + 1.0 * ease; // bow arm rises to ~0.8
          if (armRight) armRight.rotation.x = 0.2 * ease;
          // Show nocked arrow partway through
          if (nockedArrow) nockedArrow.visible = p > 0.5;
          // Bowstring at rest
          if (bowstring) bowstring.position.z = stringRestZ;
          if (nockedArrow) nockedArrow.position.z = stringRestZ;
        } else if (cycle < 0.45) {
          // Phase 2: DRAW — bow arm locked, draw hand pulls string back to cheek
          // Bowstring visibly bends backward, nocked arrow follows
          const p = (cycle - 0.10) / 0.35;
          const ease = 1 - (1 - p) * (1 - p); // ease-out (smooth pull)
          if (armLeft) armLeft.rotation.x = 0.8;
          if (armRight) armRight.rotation.x = 0.2 - 0.9 * ease; // pull back to -0.7
          // Bowstring + arrow pulled back
          const drawZ = stringRestZ + (stringDrawZ - stringRestZ) * ease;
          if (bowstring) bowstring.position.z = drawZ;
          if (nockedArrow) { nockedArrow.visible = true; nockedArrow.position.z = drawZ; }
          // Body tension — lean back into draw
          entry.group.rotation.x = 0.04 - 0.04 * ease;
        } else if (cycle < 0.55) {
          // Phase 3: AIM HOLD — full draw, micro-adjustments, string taut
          const p = (cycle - 0.45) / 0.10;
          if (armLeft) armLeft.rotation.x = 0.8 + Math.sin(p * Math.PI * 2) * 0.01;
          if (armRight) armRight.rotation.x = -0.7;
          // String held at full draw
          if (bowstring) bowstring.position.z = stringDrawZ;
          if (nockedArrow) { nockedArrow.visible = true; nockedArrow.position.z = stringDrawZ; }
          entry.group.rotation.x = 0.0;
          if (legLeft) legLeft.rotation.x = -0.05;
          if (legRight) legRight.rotation.x = 0.05;
        } else if (cycle < 0.62) {
          // Phase 4: RELEASE — string snaps forward, arrow vanishes (fired), draw hand snaps
          const p = (cycle - 0.55) / 0.07;
          const snap = p * p * p; // cubic ease-in — explosive snap
          // Bowstring snaps forward past rest position (vibration overshoot)
          const releaseZ = stringDrawZ + (stringRestZ + 0.04 - stringDrawZ) * snap;
          if (bowstring) bowstring.position.z = releaseZ;
          // Arrow disappears at the moment of release
          if (nockedArrow) nockedArrow.visible = false;
          if (armRight) armRight.rotation.x = -0.7 + 1.2 * snap;
          if (armLeft) armLeft.rotation.x = 0.8 - 0.15 * snap;
          entry.group.rotation.x = 0.0 + 0.06 * snap;
          if (cycle >= 0.57 && cycle < 0.60) this.trySpawnTrail(unitId, 'stab', time, 0.58);
        } else {
          // Phase 5: FOLLOW-THROUGH — string settles back to rest, arms relax
          const p = (cycle - 0.62) / 0.38;
          const ease = 1 - Math.pow(1 - p, 2);
          // String vibration — oscillates then settles
          const vibration = Math.sin(p * Math.PI * 6) * 0.03 * (1 - ease);
          if (bowstring) bowstring.position.z = stringRestZ + vibration;
          if (nockedArrow) nockedArrow.visible = false;
          if (armLeft) armLeft.rotation.x = 0.65 + (0.8 - 0.65) * (1 - ease);
          if (armRight) armRight.rotation.x = 0.5 * (1 - ease);
          entry.group.rotation.x = 0.06 * (1 - ease) + 0.04 * ease;
          if (legLeft) legLeft.rotation.x = -0.05 * (1 - ease);
          if (legRight) legRight.rotation.x = 0.05 * (1 - ease);
        }
        break;
      }
      case UnitType.RIDER: {
        // Lance thrust: right arm punches forward, body leans
        const speed = 1.2;
        const cycle = (time * speed) % 1;
        if (cycle < 0.4) {
          const p = cycle / 0.4;
          if (armRight) armRight.rotation.x = 0.9 * p; // thrust forward
          entry.group.rotation.x = 0.1 * p; // lean into charge
        } else if (cycle < 0.55) {
          if (armRight) armRight.rotation.x = 0.9;
          entry.group.rotation.x = 0.1;
          // Stab trail at lance thrust
          if (cycle >= 0.4 && cycle < 0.47) this.trySpawnTrail(unitId, 'stab', time, 0.45);
        } else {
          const p = (cycle - 0.55) / 0.45;
          if (armRight) armRight.rotation.x = 0.9 * (1 - p);
        }
        if (armLeft) armLeft.rotation.x = 0.15;
        const legBackLeft = entry.group.getObjectByName('leg-back-left');
        const legBackRight = entry.group.getObjectByName('leg-back-right');
        const gallop = Math.sin(time * 6);
        if (legLeft) legLeft.rotation.x = gallop * 0.3;
        if (legRight) legRight.rotation.x = -gallop * 0.3;
        if (legBackLeft) legBackLeft.rotation.x = -gallop * 0.3;
        if (legBackRight) legBackRight.rotation.x = gallop * 0.3;
        break;
      }
      case UnitType.PALADIN: {
        // Ornate mace overhead smash: wind up high → slam down → divine impact
        const speed = 1.2;
        const cycle = (time * speed) % 1;
        if (cycle < 0.30) {
          // Wind-up: mace arm raises high overhead, body leans back, shield braces
          const p = cycle / 0.30;
          const easeP = p * p; // accelerating wind-up
          if (armRight) {
            armRight.rotation.x = -1.8 * easeP;  // arm goes way back overhead
            armRight.rotation.z = -0.2 * easeP;   // slight outward spread
          }
          if (armLeft) {
            armLeft.rotation.x = -0.3 * easeP;    // shield arm braces forward
            armLeft.rotation.z = 0.15 * easeP;
          }
          entry.group.rotation.x = -0.12 * easeP; // lean back for power
          entry.group.position.y = 0.05 * easeP;  // rise slightly
        } else if (cycle < 0.50) {
          // Smash down: explosive forward slam, mace arm crashes down
          const p = (cycle - 0.30) / 0.20;
          const smashP = 1 - (1 - p) * (1 - p); // ease-out for snappy impact
          if (armRight) {
            armRight.rotation.x = -1.8 + 3.2 * smashP; // -1.8 → +1.4 massive arc
            armRight.rotation.z = -0.2 * (1 - smashP);
          }
          if (armLeft) {
            armLeft.rotation.x = -0.3 + 0.8 * smashP;  // shield follows through
            armLeft.rotation.z = 0.15 * (1 - smashP);
          }
          entry.group.rotation.x = -0.12 + 0.28 * smashP; // lean forward into smash
          entry.group.position.y = 0.05 * (1 - smashP);
          // Slash trail at impact point
          if (cycle >= 0.42 && cycle < 0.50) this.trySpawnTrail(unitId, 'slash', time, 0.5);
        } else if (cycle < 0.60) {
          // Impact hold: mace buried, body leaned forward, tremor
          const tremor = Math.sin(cycle * 80) * 0.02;
          if (armRight) { armRight.rotation.x = 1.4; armRight.rotation.z = 0; }
          if (armLeft) { armLeft.rotation.x = 0.5; armLeft.rotation.z = 0; }
          entry.group.rotation.x = 0.16 + tremor;
          entry.group.position.y = 0;
        } else {
          // Recovery: smooth ease-out back to ready stance
          const p = (cycle - 0.60) / 0.40;
          const easeP = p * p * (3 - 2 * p); // smoothstep
          if (armRight) {
            armRight.rotation.x = 1.4 * (1 - easeP);
            armRight.rotation.z = 0;
          }
          if (armLeft) {
            armLeft.rotation.x = 0.5 * (1 - easeP) + (-0.45) * easeP; // back to shield guard
          }
          entry.group.rotation.x = 0.16 * (1 - easeP);
        }
        break;
      }
      case UnitType.LUMBERJACK: {
        // Axe combat swing: side-to-side chops
        const speed = 1.4;
        const swing = Math.sin(time * speed * Math.PI * 2);
        if (armRight) {
          armRight.rotation.x = 0.4 + Math.abs(swing) * 0.5; // forward swinging
          armRight.rotation.z = swing * 0.4; // side to side
        }
        if (armLeft) armLeft.rotation.x = 0.2;
        entry.group.rotation.x = 0.05;
        break;
      }
      case UnitType.ASSASSIN: {
        // Pierce attack: fast jump-stab lunge
        const speed = 1.2; // still fastest melee, but readable
        const cycle = (time * speed) % 1;
        if (cycle < 0.15) {
          // Crouch: body dips down, arms pull back
          const p = cycle / 0.15;
          entry.group.position.y -= 0.1 * p; // crouch down
          if (armRight) armRight.rotation.x = -0.8 * p; // pull dagger back
          if (armLeft) armLeft.rotation.x = -0.3 * p;
        } else if (cycle < 0.35) {
          // Lunge forward: body jumps up and arm stabs
          const p = (cycle - 0.15) / 0.2;
          entry.group.position.y += 0.15 * Math.sin(p * Math.PI); // jump arc
          entry.group.rotation.x = 0.15 * p; // lean forward into stab
          if (armRight) {
            armRight.rotation.x = -0.8 + 2.2 * p; // fast stab forward to +1.4
            armRight.rotation.z = 0; // straight ahead
          }
          if (armLeft) armLeft.rotation.x = -0.3 + 0.5 * p;
        } else if (cycle < 0.5) {
          // Impact hold: arm extended, slight recoil
          if (armRight) { armRight.rotation.x = 1.4; armRight.rotation.z = 0; }
          entry.group.rotation.x = 0.15;
          // Stab trail at impact
          if (cycle >= 0.35 && cycle < 0.42) this.trySpawnTrail(unitId, 'stab', time, 0.3);
        } else {
          const p = (cycle - 0.5) / 0.5;
          if (armRight) armRight.rotation.x = 1.4 * (1 - p);
          if (armLeft) armLeft.rotation.x = 0.2 * (1 - p);
          entry.group.rotation.x = 0.15 * (1 - p);
        }
        if (legLeft) legLeft.rotation.x = cycle < 0.35 ? 0.3 : 0.3 * (1 - (cycle - 0.35) / 0.65);
        if (legRight) legRight.rotation.x = cycle < 0.35 ? -0.15 : -0.15 * (1 - (cycle - 0.35) / 0.65);
        break;
      }
      case UnitType.BERSERKER: {
        // Viking dual-axe converging chop: raise wide → chop down & inward
        // CORRECTED COORDS:
        //   +rotation.z (right arm) = outward to the right
        //   -rotation.z (right arm) = inward (crossing body)
        //   -rotation.z (left arm)  = outward to the left
        //   +rotation.z (left arm)  = inward (crossing body)
        //
        // Phase 1 (0–0.28): Raise — arms spread WIDE (right +Z, left -Z), blades high
        // Phase 2 (0.28–0.46): Chop — arms swing down + cross inward (right -Z, left +Z)
        // Phase 3 (0.46–0.60): Impact — axes crossed in front, tremor
        // Phase 4 (0.60–1.0): Recovery — smoothstep back to ready
        const bkSpd = 1.0;
        const bkCyc = (time * bkSpd) % 1;

        // Raise pose: arms up and WIDE apart
        const BK_RAISE_X = -1.20;  // arms raised forward+up
        const BK_RAISE_Z =  0.90;  // magnitude of outward spread

        // Impact pose: arms chopped down and CROSSED together
        const BK_CHOP_X  =  0.60;  // arms swung down past neutral
        const BK_CHOP_Z  =  0.15;  // magnitude of inward cross

        // Idle ready
        const BK_REST_X  =  0.0;
        const BK_REST_Z  =  0.18;

        if (bkCyc < 0.28) {
          // Raise: arms spread wide apart, body leans back
          const p = bkCyc / 0.28;
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          if (armRight) {
            armRight.rotation.x = BK_REST_X + (BK_RAISE_X - BK_REST_X) * ease;
            armRight.rotation.z = BK_REST_Z + (BK_RAISE_Z - BK_REST_Z) * ease; // +0.18 → +0.90 (outward right)
          }
          if (armLeft) {
            armLeft.rotation.x = BK_REST_X + (BK_RAISE_X - BK_REST_X) * ease;
            armLeft.rotation.z = -BK_REST_Z + (-BK_RAISE_Z + BK_REST_Z) * ease; // -0.18 → -0.90 (outward left)
          }
          entry.group.rotation.x = -0.10 * ease;
        } else if (bkCyc < 0.46) {
          // CHOP: arms swing down and CROSS inward
          const p = (bkCyc - 0.28) / 0.18;
          const smash = p * p;
          if (armRight) {
            armRight.rotation.x = BK_RAISE_X + (BK_CHOP_X - BK_RAISE_X) * smash;
            armRight.rotation.z = BK_RAISE_Z + (-BK_CHOP_Z - BK_RAISE_Z) * smash; // +0.90 → -0.15 (cross inward)
          }
          if (armLeft) {
            armLeft.rotation.x = BK_RAISE_X + (BK_CHOP_X - BK_RAISE_X) * smash;
            armLeft.rotation.z = -BK_RAISE_Z + (BK_CHOP_Z + BK_RAISE_Z) * smash; // -0.90 → +0.15 (cross inward)
          }
          entry.group.rotation.x = -0.10 + 0.28 * smash;
          if (bkCyc >= 0.36 && bkCyc < 0.44) this.trySpawnTrail(unitId, 'slash', time, 0.4);
        } else if (bkCyc < 0.60) {
          // Impact hold: axes crossed in front, tremor
          const tremor = Math.sin(time * 55) * 0.010 * Math.max(0, 1 - (bkCyc - 0.46) / 0.14);
          if (armRight) { armRight.rotation.x = BK_CHOP_X; armRight.rotation.z = -BK_CHOP_Z; }
          if (armLeft) { armLeft.rotation.x = BK_CHOP_X; armLeft.rotation.z = BK_CHOP_Z; }
          entry.group.rotation.x = 0.18 + tremor;
          if (bkCyc >= 0.46 && bkCyc < 0.52) this.trySpawnTrail(unitId, 'smash', time, 0.5);
        } else {
          // Recovery: smoothstep back to ready
          const p = (bkCyc - 0.60) / 0.40;
          const ss = p * p * (3 - 2 * p);
          if (armRight) {
            armRight.rotation.x = BK_CHOP_X + (BK_REST_X - BK_CHOP_X) * ss;
            armRight.rotation.z = -BK_CHOP_Z + (BK_REST_Z + BK_CHOP_Z) * ss; // -0.15 → +0.18
          }
          if (armLeft) {
            armLeft.rotation.x = BK_CHOP_X + (BK_REST_X - BK_CHOP_X) * ss;
            armLeft.rotation.z = BK_CHOP_Z + (-BK_REST_Z - BK_CHOP_Z) * ss; // +0.15 → -0.18
          }
          entry.group.rotation.x = 0.18 * (1 - ss);
        }
        // Legs: wide power stance, front foot lunges during chop
        if (legLeft) legLeft.rotation.x = bkCyc >= 0.28 && bkCyc < 0.60 ? 0.30 : 0.30 * Math.max(0, 1 - Math.abs(bkCyc - 0.44) * 3.5);
        if (legRight) legRight.rotation.x = bkCyc >= 0.28 && bkCyc < 0.60 ? -0.15 : 0;
        break;
      }
      case UnitType.SHIELDBEARER: {
        // Shield bash: guard stance → body hops forward with shield thrust
        // The whole body lunges off the ground, shield arm punches out on impact
        const speed = 1.0; // deliberate, heavy tank feel
        const cycle = (time * speed) % 1;

        // Idle guard: shield high (-0.6), then coil back for the charge
        const GUARD_ARM = -0.6; // shield arm raised in guard position

        if (cycle < 0.30) {
          // Coil: crouch down, shield pulls slightly back, weight loads onto back foot
          const p = cycle / 0.30;
          const ease = p * p; // ease-in, building tension
          if (armLeft) {
            armLeft.rotation.x = GUARD_ARM - 0.3 * ease; // shield arm cocks back slightly
            armLeft.rotation.z = 0.1 * ease;
          }
          if (armRight) armRight.rotation.x = -0.15 * ease; // brace arm cocks
          entry.group.rotation.x = -0.12 * ease; // lean back, loading
          entry.group.position.y -= 0.001 * ease; // crouch micro-dip
          // Legs coil: front leg bends, weight shifts back
          if (legLeft) legLeft.rotation.x = 0.15 * ease;
          if (legRight) legRight.rotation.x = -0.2 * ease;
        } else if (cycle < 0.48) {
          // HOP FORWARD + SHIELD THRUST: explosive lunge off the ground
          const p = (cycle - 0.30) / 0.18;
          const snap = p * (2 - p); // ease-out snap
          // Shield arm drives straight forward from guard → full extension
          if (armLeft) {
            armLeft.rotation.x = (GUARD_ARM - 0.3) + (1.8 + 0.3) * snap; // → ~1.5 (fully extended)
            armLeft.rotation.z = 0.1 - 0.15 * snap; // tuck inward on impact
          }
          if (armRight) armRight.rotation.x = -0.15 + 0.45 * snap; // follow-through
          // Body lunges forward and hops up
          entry.group.rotation.x = -0.12 + 0.30 * snap; // lean back → lean into charge
          const hopArc = Math.sin(p * Math.PI); // parabolic hop: up then down
          entry.group.position.y += hopArc * 0.004; // hop off ground
          entry.group.position.z += 0.012 * snap; // lunge forward
          // Legs drive: back leg kicks, front leg leads
          if (legLeft) legLeft.rotation.x = 0.15 + 0.25 * snap; // front leg drives forward
          if (legRight) legRight.rotation.x = -0.2 - 0.15 * snap; // back leg pushes off
          // Smash trail at impact
          if (cycle >= 0.40 && cycle < 0.46) this.trySpawnTrail(unitId, 'smash', time, 0.45);
        } else if (cycle < 0.62) {
          // Impact hold: shield fully extended, body committed forward, landed from hop
          if (armLeft) { armLeft.rotation.x = 1.5; armLeft.rotation.z = -0.05; }
          if (armRight) armRight.rotation.x = 0.3;
          entry.group.rotation.x = 0.18;
          if (legLeft) legLeft.rotation.x = 0.4;
          if (legRight) legRight.rotation.x = -0.35;
        } else {
          // Recovery: settle back to guard stance
          const p = (cycle - 0.62) / 0.38;
          const ease = 1 - (1 - p) * (1 - p) * (1 - p); // cubic ease-out
          if (armLeft) {
            armLeft.rotation.x = 1.5 + (GUARD_ARM - 1.5) * ease; // return to guard
            armLeft.rotation.z = -0.05 * (1 - ease);
          }
          if (armRight) armRight.rotation.x = 0.3 * (1 - ease);
          entry.group.rotation.x = 0.18 * (1 - ease);
          if (legLeft) legLeft.rotation.x = 0.4 * (1 - ease);
          if (legRight) legRight.rotation.x = -0.35 * (1 - ease);
        }
        break;
      }
      case UnitType.BATTLEMAGE: {
        // Arcane war-staff slam: channel → overhead lift → devastating slam → arcane shockwave hold → recovery
        const speed = 0.9;
        const cycle = (time * speed) % 1;
        if (cycle < 0.25) {
          // Phase 1: Channel — draw power, left hand pulls arcane energy, body coils
          const p = cycle / 0.25;
          const ep = 1 - (1 - p) * (1 - p); // ease-out
          if (armRight) {
            armRight.rotation.x = -0.6 * ep;  // staff tips back, gathering
            armRight.rotation.z = -0.1 * ep;   // slight outward angle
          }
          if (armLeft) {
            armLeft.rotation.x = -0.5 * ep;   // casting hand pulls back
            armLeft.rotation.z = 0.2 * ep;     // hand draws inward
          }
          entry.group.position.y = -0.03 * ep; // crouch into channel
          entry.group.rotation.x = -0.04 * ep; // lean back, winding up
        } else if (cycle < 0.40) {
          // Phase 2: Overhead lift — staff sweeps high, both arms raised
          const p = (cycle - 0.25) / 0.15;
          const ep = 1 - (1 - p) * (1 - p);
          if (armRight) {
            armRight.rotation.x = -0.6 - 1.2 * ep;  // staff overhead (-1.8)
            armRight.rotation.z = -0.1 * (1 - ep);
          }
          if (armLeft) {
            armLeft.rotation.x = -0.5 - 0.8 * ep;   // casting hand high (-1.3)
            armLeft.rotation.z = 0.2 * (1 - ep);
          }
          entry.group.position.y = -0.03 + 0.05 * ep; // rise up
          entry.group.rotation.x = -0.04 + 0.04 * ep; // straighten
        } else if (cycle < 0.52) {
          // Phase 3: SLAM — explosive downward strike, staff crashes to ground
          const p = (cycle - 0.40) / 0.12;
          const smashP = p * p; // ease-in for acceleration feel
          if (armRight) {
            armRight.rotation.x = -1.8 + 3.2 * smashP;  // -1.8 → +1.4 (massive arc)
          }
          if (armLeft) {
            armLeft.rotation.x = -1.3 + 2.5 * smashP;   // follows through
            armLeft.rotation.z = 0.15 * smashP;           // hand thrusts outward on release
          }
          entry.group.rotation.x = 0.14 * smashP;        // lunge forward
          entry.group.position.y = 0.02 - 0.05 * smashP; // drop weight
        } else if (cycle < 0.68) {
          // Phase 4: Impact hold — tremor, staff planted, arcane shockwave
          if (armRight) armRight.rotation.x = 1.4;
          if (armLeft) { armLeft.rotation.x = 1.2; armLeft.rotation.z = 0.15; }
          entry.group.rotation.x = 0.14;
          entry.group.position.y = -0.03;
          // Tremor — rapid micro-shake
          const tremor = Math.sin(time * 45) * 0.008;
          entry.group.position.x = tremor;
          entry.group.rotation.z = tremor * 0.5;
          // Spawn smash trail
          if (cycle >= 0.52 && cycle < 0.60) this.trySpawnTrail(unitId, 'smash', time, 0.52);
        } else {
          // Phase 5: Recovery — smooth return to stance via smoothstep
          const p = (cycle - 0.68) / 0.32;
          const sp = p * p * (3 - 2 * p); // smoothstep
          if (armRight) {
            armRight.rotation.x = 1.4 * (1 - sp);
            armRight.rotation.z = 0;
          }
          if (armLeft) {
            armLeft.rotation.x = 1.2 * (1 - sp);
            armLeft.rotation.z = 0.15 * (1 - sp);
          }
          entry.group.rotation.x = 0.14 * (1 - sp);
          entry.group.position.y = -0.03 * (1 - sp);
          entry.group.position.x = 0;
          entry.group.rotation.z = 0;
        }
        break;
      }
      case UnitType.HEALER: {
        // Casting heal: gather energy → raise staff → thrust forward and release
        const speed = 0.9;
        const cycle = (time * speed) % 1;
        if (cycle < 0.30) {
          // Gather: both arms draw inward, body crouches slightly, energy charging
          const p = cycle / 0.30;
          if (armLeft) {
            armLeft.rotation.x = -0.3 * p;    // pull casting hand back
            armLeft.rotation.z = 0.3 * p;     // draw inward
          }
          if (armRight) {
            armRight.rotation.x = -0.2 * p;   // staff tips back
            armRight.rotation.z = -0.1 * p;
          }
          entry.group.position.y = -0.03 * p; // slight crouch
        } else if (cycle < 0.50) {
          // Cast: left arm thrusts forward to release heal orb, staff raised high
          const p = (cycle - 0.30) / 0.20;
          const castP = 1 - (1 - p) * (1 - p); // ease-out snap
          if (armLeft) {
            armLeft.rotation.x = -0.3 + 1.3 * castP;  // thrust forward to +1.0
            armLeft.rotation.z = 0.3 * (1 - castP);    // straighten
          }
          if (armRight) {
            armRight.rotation.x = -0.2 - 0.6 * castP;  // staff raised high
            armRight.rotation.z = -0.1 * (1 - castP);
          }
          entry.group.rotation.x = 0.08 * castP;        // lean forward into cast
          entry.group.position.y = -0.03 + 0.06 * castP; // rise up on release
        } else if (cycle < 0.60) {
          // Hold: arm extended, feeling the heal land
          if (armLeft) { armLeft.rotation.x = 1.0; armLeft.rotation.z = 0; }
          if (armRight) { armRight.rotation.x = -0.8; }
          entry.group.rotation.x = 0.08;
          entry.group.position.y = 0.03;
        } else {
          // Recovery: smooth return to idle stance
          const p = (cycle - 0.60) / 0.40;
          const easeP = p * p * (3 - 2 * p);
          if (armLeft) {
            armLeft.rotation.x = 1.0 * (1 - easeP) + (-0.25) * easeP;
            armLeft.rotation.z = 0.1 * easeP;
          }
          if (armRight) {
            armRight.rotation.x = -0.8 * (1 - easeP) + 0.2 * easeP;
          }
          entry.group.rotation.x = 0.08 * (1 - easeP);
          entry.group.position.y = 0.03 * (1 - easeP);
        }
        break;
      }
      case UnitType.SCOUT: {
        // Quick dagger slash: fast flurry of pokes
        const speed = 1.4;
        const cycle = (time * speed) % 1;
        if (cycle < 0.2) {
          const p = cycle / 0.2;
          if (armRight) armRight.rotation.x = -0.4 * p;
        } else if (cycle < 0.35) {
          const p = (cycle - 0.2) / 0.15;
          if (armRight) armRight.rotation.x = -0.4 + 1.6 * p;
          entry.group.rotation.x = 0.06 * p;
          if (cycle >= 0.28 && cycle < 0.33) this.trySpawnTrail(unitId, 'stab', time, 0.25);
        } else if (cycle < 0.5) {
          if (armRight) armRight.rotation.x = 1.2;
        } else {
          const p = (cycle - 0.5) / 0.5;
          if (armRight) armRight.rotation.x = 1.2 * (1 - p);
          entry.group.rotation.x = 0.06 * (1 - p);
        }
        if (armLeft) armLeft.rotation.x = 0.15;
        break;
      }
      case UnitType.MAGE: {
        // Staff channel: arms raise, staff glows, then thrust forward to cast
        const speed = 0.95;
        const cycle = (time * speed) % 1;
        if (cycle < 0.5) {
          // Channel: raise arms, lean back slightly
          const p = cycle / 0.5;
          if (armRight) armRight.rotation.x = -0.6 * p;
          if (armLeft) {
            armLeft.rotation.x = -0.4 * p;
            armLeft.rotation.z = -0.3 * p;
          }
          entry.group.rotation.x = -0.04 * p;
        } else if (cycle < 0.65) {
          // Cast: thrust staff forward
          const p = (cycle - 0.5) / 0.15;
          if (armRight) armRight.rotation.x = -0.6 + 1.8 * p;
          if (armLeft) armLeft.rotation.x = -0.4 + 0.8 * p;
          entry.group.rotation.x = -0.04 + 0.12 * p;
        } else if (cycle < 0.75) {
          if (armRight) armRight.rotation.x = 1.2;
          if (armLeft) armLeft.rotation.x = 0.4;
          entry.group.rotation.x = 0.08;
        } else {
          const p = (cycle - 0.75) / 0.25;
          if (armRight) armRight.rotation.x = 1.2 * (1 - p);
          if (armLeft) armLeft.rotation.x = 0.4 * (1 - p);
          entry.group.rotation.x = 0.08 * (1 - p);
        }
        break;
      }
      case UnitType.GREATSWORD: {
        // DEVASTATING OVERHEAD CLEAVE — sword raised high behind, slams down in front.
        // Both arms drive the blade. Body leans back then crashes forward.
        const speed = 0.8; // slow and heavy — sell the weight
        const cycle = (time * speed) % 1;

        if (cycle < 0.30) {
          // Phase 1: Wind-up — sword arm sweeps back overhead, body leans back, weight loads
          const p = cycle / 0.30;
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease-in-out
          if (armRight) {
            armRight.rotation.x = -1.8 * ease;  // sword arm sweeps far back overhead
            armRight.rotation.z = -0.15 * ease;  // slight outward for wind-up width
          }
          if (armLeft) {
            armLeft.rotation.x = -1.2 * ease;   // off-hand follows, slightly lower
            armLeft.rotation.z = 0.1 * ease;
          }
          entry.group.rotation.x = -0.12 * ease; // lean back, loading weight
          entry.group.position.y = -0.02 * ease;  // crouch into coil
          // Legs brace: back leg loads, front plants
          if (legLeft) legLeft.rotation.x = 0.12 * ease;
          if (legRight) legRight.rotation.x = -0.18 * ease;
        } else if (cycle < 0.46) {
          // Phase 2: CLEAVE — explosive downward arc, both arms crash forward
          const p = (cycle - 0.30) / 0.16;
          const smash = p * p; // ease-in for accelerating feel
          if (armRight) {
            armRight.rotation.x = -1.8 + 3.2 * smash;  // -1.8 → +1.4 (massive overhead arc)
            armRight.rotation.z = -0.15 * (1 - smash);
          }
          if (armLeft) {
            armLeft.rotation.x = -1.2 + 2.6 * smash;   // follows through
            armLeft.rotation.z = 0.1 * (1 - smash);
          }
          // Body crashes forward — lean back → lunge forward
          entry.group.rotation.x = -0.12 + 0.30 * smash;
          entry.group.position.y = -0.02 - 0.03 * smash; // drop weight into strike
          // Legs drive: front leg lunges, back pushes off
          if (legLeft) legLeft.rotation.x = 0.12 + 0.30 * smash;
          if (legRight) legRight.rotation.x = -0.18 - 0.12 * smash;
          // Slash trail at peak velocity
          if (cycle >= 0.38 && cycle < 0.45) this.trySpawnTrail(unitId, 'slash', time, 0.38);
        } else if (cycle < 0.60) {
          // Phase 3: Impact hold — sword buried forward, body committed, tremor
          if (armRight) { armRight.rotation.x = 1.4; armRight.rotation.z = 0; }
          if (armLeft) { armLeft.rotation.x = 1.4; armLeft.rotation.z = 0; }
          entry.group.rotation.x = 0.18;
          entry.group.position.y = -0.05;
          if (legLeft) legLeft.rotation.x = 0.42;
          if (legRight) legRight.rotation.x = -0.30;
          // Heavy tremor on impact
          const tremor = Math.sin(time * 40) * 0.008;
          entry.group.position.x = tremor;
          entry.group.rotation.z = tremor * 0.6;
          // Smash trail
          if (cycle >= 0.46 && cycle < 0.54) this.trySpawnTrail(unitId, 'smash', time, 0.46);
        } else {
          // Phase 4: Recovery — heavy pull back to stance via smoothstep
          const p = (cycle - 0.60) / 0.40;
          const sp = p * p * (3 - 2 * p); // smoothstep
          if (armRight) {
            armRight.rotation.x = 1.4 * (1 - sp);
            armRight.rotation.z = 0;
          }
          if (armLeft) {
            armLeft.rotation.x = 1.4 * (1 - sp);
            armLeft.rotation.z = 0;
          }
          entry.group.rotation.x = 0.18 * (1 - sp);
          entry.group.position.y = -0.05 * (1 - sp);
          entry.group.position.x = 0;
          entry.group.rotation.z = 0;
          if (legLeft) legLeft.rotation.x = 0.42 * (1 - sp);
          if (legRight) legRight.rotation.x = -0.30 * (1 - sp);
        }
        break;
      }
      case UnitType.OGRE: {
        // MASSIVE OVERHEAD CLUB SMASH — wind up high, slam down with ground-shaking impact.
        // Slowest, heaviest attack in the game. AOE knockback on impact.
        const speed = 0.6; // very slow — sell the massive weight
        const cycle = (time * speed) % 1;

        if (cycle < 0.35) {
          // Phase 1: Wind-up — club rises overhead, body leans way back
          const p = cycle / 0.35;
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          if (armRight) {
            armRight.rotation.x = -2.0 * ease; // massive overhead wind-up
            armRight.rotation.z = -0.2 * ease;
          }
          if (armLeft) {
            armLeft.rotation.x = -0.8 * ease; // off-hand braces
            armLeft.rotation.z = 0.3 * ease;
          }
          entry.group.rotation.x = -0.15 * ease; // lean back under club weight
          if (legLeft) legLeft.rotation.x = -0.25 * ease; // back leg plants
          if (legRight) legRight.rotation.x = 0.15 * ease; // front leg braces
        } else if (cycle < 0.50) {
          // Phase 2: SLAM — explosive downward smash
          const p = (cycle - 0.35) / 0.15;
          const smash = p * p; // accelerating impact
          if (armRight) {
            armRight.rotation.x = -2.0 + 3.5 * smash; // huge arc overhead to ground
            armRight.rotation.z = -0.2 * (1 - smash);
          }
          if (armLeft) {
            armLeft.rotation.x = -0.8 + 1.2 * smash;
            armLeft.rotation.z = 0.3 * (1 - smash);
          }
          entry.group.rotation.x = -0.15 + 0.35 * smash; // lunge forward
          entry.group.position.y = -0.08 * smash; // body drops with impact
          if (legLeft) legLeft.rotation.x = -0.25 + 0.55 * smash;
          if (legRight) legRight.rotation.x = 0.15 - 0.35 * smash;
          // Smash trail at peak
          if (p > 0.5) this.trySpawnTrail(unitId, 'smash', time, 0.46);
        } else if (cycle < 0.65) {
          // Phase 3: Ground impact hold — tremor effect, club stuck in ground
          const p = (cycle - 0.50) / 0.15;
          if (armRight) armRight.rotation.x = 1.5;
          if (armLeft) armLeft.rotation.x = 0.4;
          // Heavy tremor shaking the ogre
          const tremor = Math.sin(time * 50) * 0.012 * (1 - p);
          entry.group.rotation.x = 0.20 + tremor;
          entry.group.position.y = -0.08 + tremor * 2;
          entry.group.rotation.z = tremor * 0.5;
          if (legLeft) legLeft.rotation.x = 0.30;
          if (legRight) legRight.rotation.x = -0.20;
        } else {
          // Phase 4: Recovery — slow, labored pull back to ready stance
          const p = (cycle - 0.65) / 0.35;
          const sp = p * p * (3 - 2 * p); // smoothstep
          if (armRight) {
            armRight.rotation.x = 1.5 * (1 - sp);
            armRight.rotation.z = 0;
          }
          if (armLeft) {
            armLeft.rotation.x = 0.4 * (1 - sp);
            armLeft.rotation.z = 0;
          }
          entry.group.rotation.x = 0.20 * (1 - sp);
          entry.group.position.y = -0.08 * (1 - sp);
          entry.group.rotation.z = 0;
          if (legLeft) legLeft.rotation.x = 0.30 * (1 - sp);
          if (legRight) legRight.rotation.x = -0.20 * (1 - sp);
        }
        break;
      }
      default: {
        // Generic melee: simple arm swing
        const speed = 1.5;
        const cycle = (time * speed) % 1;
        const armAngle = cycle < 0.4 ? -0.5 * (cycle / 0.4)
          : cycle < 0.6 ? -0.5 + 1.5 * ((cycle - 0.4) / 0.2)
          : 1.0 * (1 - (cycle - 0.6) / 0.4);
        if (armRight) armRight.rotation.x = armAngle;
        if (armLeft) armLeft.rotation.x = 0.15;
        break;
      }
      case UnitType.TREBUCHET: {
        // Single-shot trebuchet animation synced to actual fire events.
        // Arm rests at neutral when idle; plays one winch→fire→settle cycle per shot.
        const throwArm = entry.group.getObjectByName('throw-arm');
        const CYCLE_DURATION = 1.4; // seconds for full winch-fire-settle

        if (entry.trebFireStart > 0) {
          const elapsed = time - entry.trebFireStart;
          const cycle = Math.min(elapsed / CYCLE_DURATION, 1);

          if (throwArm) {
            if (cycle < 0.35) {
              // Winching: sling drops back/down
              const p = cycle / 0.35;
              throwArm.rotation.x = -0.3 - 0.8 * p;
            } else if (cycle < 0.45) {
              // FIRE! Sling whips forward over the top
              const p = (cycle - 0.35) / 0.1;
              throwArm.rotation.x = -1.1 + 2.2 * p;
            } else if (cycle < 0.55) {
              // Hold at overswung position
              throwArm.rotation.x = 1.1;
            } else {
              // Settle back to resting
              const p = (cycle - 0.55) / 0.45;
              throwArm.rotation.x = 1.1 - 1.4 * p;
            }
          }

          // Machine lurch on fire
          if (cycle >= 0.35 && cycle < 0.6) {
            const p = (cycle - 0.35) / 0.25;
            entry.group.rotation.x = 0.08 * Math.sin(p * Math.PI);
          }

          // Operator flinch
          if (armLeft && armRight) {
            if (cycle >= 0.35 && cycle < 0.55) {
              armLeft.rotation.x = 0.3;
              armRight.rotation.x = 0.3;
            } else {
              armLeft.rotation.x = 0.7;
              armRight.rotation.x = 0.7;
            }
          }

          // At the release point (~40% through), spawn the actual boulder
          if (cycle >= 0.42 && entry.trebPendingTarget) {
            const pos = entry.group.position;
            this.spawnBoulder(
              { x: pos.x, y: pos.y, z: pos.z },
              entry.trebPendingTarget,
              entry.trebOnImpact
            );
            entry.trebPendingTarget = null;
            entry.trebOnImpact = undefined;
          }

          // Animation complete — reset to idle
          if (cycle >= 1) {
            entry.trebFireStart = 0;
            if (throwArm) throwArm.rotation.x = -0.3;
          }
        } else {
          // Idle: arm rests in loaded position
          if (throwArm) throwArm.rotation.x = -0.3;
          if (armLeft) armLeft.rotation.x = 0.7;
          if (armRight) armRight.rotation.x = 0.7;
        }
        break;
      }
    }
  }

  // ─── BUILDING ──────────────────────────────────────────
  private animateBuilding(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Gentle hammering: right arm taps down rhythmically
    const speed = 2.0;
    const cycle = (time * speed) % 1;
    let armAngle: number;
    if (cycle < 0.4) {
      armAngle = -0.3 * (cycle / 0.4); // raise
    } else if (cycle < 0.55) {
      const p = (cycle - 0.4) / 0.15;
      armAngle = -0.3 + 0.9 * p; // tap down
    } else if (cycle < 0.65) {
      armAngle = 0.6; // brief hold
    } else {
      armAngle = 0.6 * (1 - (cycle - 0.65) / 0.35);
    }
    if (armRight) armRight.rotation.x = armAngle;
    if (armLeft) armLeft.rotation.x = armAngle * 0.3; // helper hand

    // Very subtle lean, no full body shake
    entry.group.rotation.x = cycle >= 0.5 && cycle < 0.65 ? 0.04 : 0;
  }

  // ─── CONSTRUCTING (builder working on blueprint building) ───
  private animateConstructing(
    entry: UnitMeshGroup,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Scaffolding animation: alternating hammer swings with a wider, more energetic motion
    // than normal building (walls). Builder looks like they're constructing a structure.
    const speed = 2.5;
    const cycle = (time * speed) % 1;

    // Right arm: big overhead hammer swing
    let rightAngle: number;
    if (cycle < 0.3) {
      rightAngle = -0.8 * (cycle / 0.3); // wind up high
    } else if (cycle < 0.45) {
      const p = (cycle - 0.3) / 0.15;
      rightAngle = -0.8 + 1.6 * p; // slam down
    } else if (cycle < 0.55) {
      rightAngle = 0.8; // impact hold
    } else {
      rightAngle = 0.8 * (1 - (cycle - 0.55) / 0.45); // return
    }

    // Left arm: holding/steadying — slight offset motion
    let leftAngle: number;
    if (cycle < 0.45) {
      leftAngle = -0.2 + Math.sin(cycle * Math.PI * 2) * 0.15;
    } else {
      leftAngle = -0.2 + Math.sin(cycle * Math.PI * 2 + 1) * 0.1;
    }

    if (armRight) armRight.rotation.x = rightAngle;
    if (armLeft) armLeft.rotation.x = leftAngle;

    // Slight bob on impact
    const impactBob = (cycle >= 0.45 && cycle < 0.55) ? -0.02 : 0;
    entry.group.position.y += impactBob;

    // Very slight body lean forward during work
    entry.group.rotation.x = 0.06;

    // Subtle weight shift between legs
    if (legLeft) legLeft.rotation.x = Math.sin(time * 1.5) * 0.08;
    if (legRight) legRight.rotation.x = Math.sin(time * 1.5 + Math.PI) * 0.08;
  }

  // ─── RETURNING (carrying resources) ────────────────────
  private animateReturning(
    entry: UnitMeshGroup,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Loaded walk: slight forward lean, slower leg swing, arms held up (carrying)
    entry.group.rotation.x = 0.08;

    const walkSpeed = 5; // slower than normal walk
    if (legLeft && legRight) {
      legLeft.rotation.x = Math.sin(time * walkSpeed) * 0.3;
      legRight.rotation.x = Math.sin(time * walkSpeed + Math.PI) * 0.3;
    }
    // Arms stay more still — holding the load
    if (armLeft) armLeft.rotation.x = -0.3; // cradling
    if (armRight) armRight.rotation.x = -0.3;
  }

  // ─── MOVING ────────────────────────────────────────────
  private animateMoving(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    switch (type) {
      case UnitType.RIDER: {
        // Gallop: horse legs cycle fast, rider bobs
        const gallop = Math.sin(time * 8);
        const legBackLeft = entry.group.getObjectByName('leg-back-left');
        const legBackRight = entry.group.getObjectByName('leg-back-right');
        if (legLeft) legLeft.rotation.x = gallop * 0.5;
        if (legRight) legRight.rotation.x = -gallop * 0.5;
        if (legBackLeft) legBackLeft.rotation.x = -gallop * 0.5;
        if (legBackRight) legBackRight.rotation.x = gallop * 0.5;
        // Rider arms hold reins, slight bounce
        if (armLeft) armLeft.rotation.x = 0.3 + Math.sin(time * 8) * 0.05;
        if (armRight) armRight.rotation.x = 0.3 + Math.sin(time * 8 + 0.5) * 0.05;
        // Slight vertical bob on the rider body
        entry.group.rotation.x = Math.sin(time * 8) * 0.03;
        break;
      }
      case UnitType.WARRIOR:
      case UnitType.PALADIN: {
        // Heavy armored march: slower, deliberate steps
        const marchSpeed = 6;
        if (legLeft && legRight) {
          legLeft.rotation.x = Math.sin(time * marchSpeed) * 0.35;
          legRight.rotation.x = Math.sin(time * marchSpeed + Math.PI) * 0.35;
        }
        // Arms swing less (weighed down by armor/shield)
        if (armLeft) armLeft.rotation.x = Math.sin(time * marchSpeed + Math.PI) * 0.15;
        if (armRight) armRight.rotation.x = Math.sin(time * marchSpeed) * 0.15;
        break;
      }
      case UnitType.ARCHER: {
        // Agile ranger run: bow held across body, fast light footwork, forward lean
        const aRunSpeed = 9;
        const aRunCycle = Math.sin(time * aRunSpeed);
        // Legs: quick, light stride
        if (legLeft) legLeft.rotation.x = aRunCycle * 0.50;
        if (legRight) legRight.rotation.x = -aRunCycle * 0.50;
        // Bow arm: held steady across body (not swinging wildly)
        if (armLeft) armLeft.rotation.x = 0.35 + Math.sin(time * aRunSpeed + Math.PI) * 0.10;
        // Draw arm: swings naturally but shorter arc (hand near quiver)
        if (armRight) armRight.rotation.x = Math.sin(time * aRunSpeed) * 0.30;
        // Forward lean for speed
        entry.group.rotation.x = 0.06;
        // Subtle bob (light on feet)
        entry.group.position.y += Math.abs(Math.sin(time * aRunSpeed)) * 0.01;
        break;
      }
      case UnitType.SCOUT: {
        // Light quick jog: fast legs, loose arm swing
        const jogSpeed = 9;
        if (legLeft && legRight) {
          legLeft.rotation.x = Math.sin(time * jogSpeed) * 0.5;
          legRight.rotation.x = Math.sin(time * jogSpeed + Math.PI) * 0.5;
        }
        if (armLeft) armLeft.rotation.x = Math.sin(time * jogSpeed + Math.PI) * 0.35;
        if (armRight) armRight.rotation.x = Math.sin(time * jogSpeed) * 0.35;
        break;
      }
      case UnitType.TREBUCHET: {
        // Trebuchet rolling: wheels spin, operator walks, cart rocks
        // Spin wheels (disc face is in YZ plane, rolling forward = rotate around X)
        for (const wn of ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br']) {
          const w = entry.group.getObjectByName(wn);
          if (w) w.rotation.x = time * 4;
        }
        // Operator legs walk
        const walkSpd = 5;
        if (legLeft && legRight) {
          legLeft.rotation.x = Math.sin(time * walkSpd) * 0.45;
          legRight.rotation.x = Math.sin(time * walkSpd + Math.PI) * 0.45;
        }
        // Operator arms pump while pushing
        if (armLeft && armRight) {
          armLeft.rotation.x = 0.8 + Math.sin(time * walkSpd + Math.PI) * 0.12;
          armRight.rotation.x = 0.8 + Math.sin(time * walkSpd) * 0.12;
        }
        // Heavy cart: gentle side-to-side rock + very slight forward bob
        entry.group.rotation.z = Math.sin(time * 2.5) * 0.025;
        break;
      }
      case UnitType.OGRE: {
        // Heavy lumbering walk — slow, ground-shaking cadence
        const ogreWalkSpd = 4; // slower than standard (7)
        if (legLeft && legRight) {
          legLeft.rotation.x = Math.sin(time * ogreWalkSpd) * 0.35;
          legRight.rotation.x = Math.sin(time * ogreWalkSpd + Math.PI) * 0.35;
        }
        if (armLeft) armLeft.rotation.x = Math.sin(time * ogreWalkSpd + Math.PI) * 0.2;
        if (armRight) {
          armRight.rotation.x = Math.sin(time * ogreWalkSpd) * 0.15; // reduced swing (holding club)
        }
        // Heavy side-to-side sway
        entry.group.rotation.z = Math.sin(time * ogreWalkSpd * 0.5) * 0.04;
        // Subtle ground-shake bob
        entry.group.position.y = Math.abs(Math.sin(time * ogreWalkSpd)) * 0.02 - 0.01;
        break;
      }
      default: {
        // Standard walk
        const walkSpeed = 7;
        if (legLeft && legRight) {
          legLeft.rotation.x = Math.sin(time * walkSpeed) * 0.4;
          legRight.rotation.x = Math.sin(time * walkSpeed + Math.PI) * 0.4;
        }
        if (armLeft) armLeft.rotation.x = Math.sin(time * walkSpeed + Math.PI) * 0.25;
        if (armRight) armRight.rotation.x = Math.sin(time * walkSpeed) * 0.25;
        break;
      }
    }
    // === NATURAL WALK SWAY — applies to ALL units ===
    // Left-right body bobble synced to leg stride for natural walking feel.
    // Siege units (trebuchet) already have their own rocking — skip them.
    if (type !== UnitType.TREBUCHET) {
      // Use the same frequency as legs so the sway syncs with stride
      const swayFreq = type === UnitType.RIDER ? 8
        : (type === UnitType.WARRIOR || type === UnitType.PALADIN) ? 6
        : (type === UnitType.ARCHER || type === UnitType.SCOUT) ? 9
        : 7;
      // Body tilts left-right with each step (rotation.z)
      entry.group.rotation.z = Math.sin(time * swayFreq) * 0.04;
      // Slight vertical bob (bounce with each step)
      entry.group.position.y += Math.abs(Math.sin(time * swayFreq)) * 0.02;

      // === KNEE FLEX — natural bend during stride ===
      // When a leg swings forward (positive rotation.x), the knee bends back
      // When it swings back, knee straightens. This gives a natural stepping look.
      const kneeL = entry.group.getObjectByName('leg-left-knee');
      const kneeR = entry.group.getObjectByName('leg-right-knee');
      if (kneeL && legLeft) {
        // Bend knee when leg is in forward swing phase
        const legAngle = legLeft.rotation.x;
        kneeL.rotation.x = Math.max(0, legAngle * 0.6) + Math.abs(Math.sin(time * swayFreq)) * 0.15;
      }
      if (kneeR && legRight) {
        const legAngle = legRight.rotation.x;
        kneeR.rotation.x = Math.max(0, legAngle * 0.6) + Math.abs(Math.sin(time * swayFreq + Math.PI)) * 0.15;
      }

      // === ELBOW FLEX — natural arm bend while walking ===
      // Arms naturally bend at elbow during swing. Forearm curls inward on back-swing.
      const elbowL = entry.group.getObjectByName('arm-left-elbow');
      const elbowR = entry.group.getObjectByName('arm-right-elbow');
      if (elbowL && armLeft) {
        const armAngle = armLeft.rotation.x;
        // Elbow bends more when arm swings back (negative x = behind body)
        elbowL.rotation.x = -0.15 + Math.max(0, -armAngle * 0.5);
      }
      if (elbowR && armRight) {
        const armAngle = armRight.rotation.x;
        elbowR.rotation.x = -0.15 + Math.max(0, -armAngle * 0.5);
      }
    }
  }

  // ─── IDLE ──────────────────────────────────────────────
  private animateIdle(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Smoothly reset legs
    if (legLeft) legLeft.rotation.x *= 0.88;
    if (legRight) legRight.rotation.x *= 0.88;

    switch (type) {
      case UnitType.WARRIOR: {
        // Idle: armored knight guard stance — buckler raised, broadsword at the ready
        const wBreathe = Math.sin(time * 0.85) * 0.018;
        const wWeightShift = Math.sin(time * 0.45) * 0.008;

        // Left arm (buckler): raised guard, shield edge near chin, protective stance
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + (-0.50) * 0.12 + wBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.10 * 0.1; // elbow slightly out
        }
        // Right arm (broadsword): held low and ready, subtle sway from weapon weight
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.88 + 0.18 * 0.12 + wBreathe * 0.6;
          armRight.rotation.z = armRight.rotation.z * 0.9 + (-0.05) * 0.1;
          // Weapon weight sway — heavier than a dagger, lighter than a greatsword
          armRight.rotation.x += Math.sin(time * 0.65 + 0.8) * 0.012;
        }
        // Armored weight shift — slow, grounded sway
        entry.group.rotation.z = entry.group.rotation.z * 0.93 + wWeightShift;
        // Subtle forward lean — ready to engage
        entry.group.rotation.x = entry.group.rotation.x * 0.95 + 0.010 * 0.05;
        break;
      }
      case UnitType.BERSERKER: {
        // Idle: Viking berserker battle-ready — axes held wide, heavy breathing, menacing sway
        const bkBreathe = Math.sin(time * 1.1) * 0.025; // faster, heavier breathing than knights
        const bkRage = Math.sin(time * 0.6) * 0.010;

        // Both arms held slightly outward and forward — axes ready to swing
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.88 + 0.25 * 0.12 + bkBreathe;
          armRight.rotation.z = armRight.rotation.z * 0.88 + (-0.18) * 0.12; // held wide outward
          // Axe weight sway — restless, twitchy
          armRight.rotation.x += Math.sin(time * 1.3 + 0.5) * 0.018;
        }
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + 0.25 * 0.12 + bkBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.88 + 0.18 * 0.12; // held wide outward
          armLeft.rotation.x += Math.sin(time * 1.3 + 2.0) * 0.018;
        }
        // Aggressive forward lean — always ready to charge
        entry.group.rotation.x = entry.group.rotation.x * 0.92 + 0.04 * 0.08;
        // Restless weight shift — wider, more aggressive than knight sway
        entry.group.rotation.z = entry.group.rotation.z * 0.90 + bkRage;

        // Pulse rage-eyes and rune glow
        const bkPulse = 0.5 + Math.sin(time * 2.0) * 0.3;
        entry.group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.name === 'bk-rage-eye') {
            (child.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 3.0) * 0.4;
          }
          if (child instanceof THREE.Mesh && (child.name === 'bk-chest-rune' || child.name === 'bk-axe-rune-l' || child.name === 'bk-axe-rune-r')) {
            (child.material as THREE.MeshBasicMaterial).opacity = 0.5 + bkPulse * 0.3;
          }
        });
        break;
      }
      case UnitType.ARCHER: {
        // Idle: alert ranger stance — bow held low-ready, weight shifting, scanning
        const aBreathe = Math.sin(time * 1.1) * 0.015;
        const aShift = Math.sin(time * 0.6) * 0.008;

        // Bow arm: held at low-ready angle, slight drift like holding a real bow
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + 0.25 * 0.12 + aBreathe;
          // Subtle lateral sway — bow hand drifts with weight
          armLeft.rotation.z = armLeft.rotation.z * 0.92 + (Math.sin(time * 0.7) * 0.02) * 0.08;
        }
        // Draw arm: relaxed at side, fingers near quiver (ready to nock)
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.90 + (-0.10) * 0.10;
          armRight.rotation.z = armRight.rotation.z * 0.92 + (-0.04) * 0.08;
          // Occasional fidget — fingers brush arrow fletching
          armRight.rotation.x += Math.sin(time * 1.8 + 2.0) * 0.012;
        }
        // Weight shift — rangers don't stand still, they shift between feet
        entry.group.rotation.z = entry.group.rotation.z * 0.92 + aShift;
        // Subtle forward lean (always ready to move)
        entry.group.rotation.x = entry.group.rotation.x * 0.94 + 0.02 * 0.06;
        // Legs: very subtle weight alternation
        if (legLeft) legLeft.rotation.x = legLeft.rotation.x * 0.92 + (Math.sin(time * 0.6) * 0.03) * 0.08;
        if (legRight) legRight.rotation.x = legRight.rotation.x * 0.92 + (Math.sin(time * 0.6 + Math.PI) * 0.03) * 0.08;
        break;
      }
      case UnitType.PALADIN: {
        // Idle: ornate holy knight stance — tower shield held high, mace ready at side
        const paladinBreathe = Math.sin(time * 0.9) * 0.02;
        // Shield arm (left): raised guard, shield edge near chin
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + (-0.45) * 0.12 + paladinBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.08 * 0.1;
        }
        // Mace arm (right): held low at side, subtle ready sway
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.9 + 0.15 * 0.1;
          armRight.rotation.z = armRight.rotation.z * 0.9 + (-0.05) * 0.1;
          // Slight mace sway — weight shifting
          armRight.rotation.x += Math.sin(time * 0.7 + 1.0) * 0.015;
        }
        // Subtle body sway — heavy armor weight shift
        entry.group.rotation.z = entry.group.rotation.z * 0.92 + Math.sin(time * 0.5) * 0.008;
        break;
      }
      case UnitType.RIDER: {
        // Idle: arms resting on reins, horse legs still
        if (armLeft) armLeft.rotation.x = armLeft.rotation.x * 0.9 + 0.15 * 0.1;
        if (armRight) armRight.rotation.x = armRight.rotation.x * 0.9 + 0.15 * 0.1;
        const legBackLeft = entry.group.getObjectByName('leg-back-left');
        const legBackRight = entry.group.getObjectByName('leg-back-right');
        if (legBackLeft) legBackLeft.rotation.x *= 0.88;
        if (legBackRight) legBackRight.rotation.x *= 0.88;
        break;
      }
      case UnitType.TREBUCHET: {
        // Idle: operator rests, arms lower from pushing pose, subtle breathing
        if (armLeft) armLeft.rotation.x = armLeft.rotation.x * 0.92 + 0.3 * 0.08; // relax to ~0.3
        if (armRight) armRight.rotation.x = armRight.rotation.x * 0.92 + 0.3 * 0.08;
        // Subtle arm sway (idle fidget)
        if (armRight) armRight.rotation.x += Math.sin(time * 1.5) * 0.03;
        break;
      }
      case UnitType.SHIELDBEARER: {
        // Idle: shield held high in guard — top edge at eye level, arm raised
        // Left arm (shield arm) raised so shield covers chin to forehead
        const guardArmX = -0.6; // arm raised, pulling shield up in front of face
        const breathe = Math.sin(time * 1.0) * 0.02; // subtle breathing sway
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + guardArmX * 0.12 + breathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.05 * 0.1; // slightly out
        }
        // Right arm relaxed at side, ready to brace
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.9 + 0.05 * 0.1;
          armRight.rotation.z *= 0.9;
        }
        break;
      }
      case UnitType.HEALER: {
        // Idle: serene stance — staff arm slightly forward, casting hand gently raised
        const healBreathe = Math.sin(time * 0.8) * 0.02;
        // Right arm (staff): held slightly forward, gentle sway
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.9 + 0.2 * 0.1;
          armRight.rotation.x += Math.sin(time * 0.6) * 0.01;
        }
        // Left arm (casting hand): slightly raised, palm up gesture
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + (-0.25) * 0.12 + healBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.1 * 0.1;
        }
        // Gentle body sway — serene, meditative
        entry.group.rotation.z = entry.group.rotation.z * 0.92 + Math.sin(time * 0.4) * 0.006;
        break;
      }
      case UnitType.GREATSWORD: {
        // Idle: imposing ready stance — claymore held upright before them, weight planted
        const gsBreathe = Math.sin(time * 0.7) * 0.015;
        // Right arm (sword arm): slightly forward, blade vertical, grounded patience
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.88 + 0.15 * 0.12 + gsBreathe;
          armRight.rotation.z = armRight.rotation.z * 0.9 + (-0.06) * 0.1;
        }
        // Left arm: mirrors right slightly lower, two-hand ready
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + 0.10 * 0.12 + gsBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.06 * 0.1;
        }
        // Heavy armor weight shift — slow, deliberate sway
        entry.group.rotation.z = entry.group.rotation.z * 0.94 + Math.sin(time * 0.4) * 0.006;
        // Subtle forward lean — intimidating
        entry.group.rotation.x = entry.group.rotation.x * 0.95 + 0.012 * 0.05;
        break;
      }
      case UnitType.BATTLEMAGE: {
        // Idle: war-mage combat stance — staff planted, casting hand simmering with power
        const bmBreathe = Math.sin(time * 0.9) * 0.02;
        // Right arm (staff): held forward at ready angle, slow deliberate sway
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.88 + 0.25 * 0.12;
          armRight.rotation.x += Math.sin(time * 0.7) * 0.015 + bmBreathe;
          armRight.rotation.z = armRight.rotation.z * 0.9 + (-0.08) * 0.1;
        }
        // Left arm (casting hand): raised, palm forward, channeling energy
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.88 + (-0.35) * 0.12 + bmBreathe;
          armLeft.rotation.z = armLeft.rotation.z * 0.9 + 0.15 * 0.1;
        }
        // Heavy armor weight-shift — slow, powerful sway
        entry.group.rotation.z = entry.group.rotation.z * 0.92 + Math.sin(time * 0.45) * 0.008;
        // Subtle forward lean (menacing stance)
        entry.group.rotation.x = entry.group.rotation.x * 0.95 + 0.015 * 0.05;
        break;
      }
      case UnitType.OGRE: {
        // Ogre idle: slow breathing, club resting, menacing weight shifts
        const breathe = Math.sin(time * 0.6) * 0.008;
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.90 + (0.15 + breathe) * 0.10; // club rests forward
        }
        if (armLeft) {
          armLeft.rotation.x = armLeft.rotation.x * 0.90 + (-0.1 + breathe) * 0.10;
          armLeft.rotation.z = armLeft.rotation.z * 0.90 + 0.08 * 0.10; // slight outward
        }
        // Slow, heavy weight-shift sway
        entry.group.rotation.z = entry.group.rotation.z * 0.92 + Math.sin(time * 0.3) * 0.012;
        // Deep breathing chest expand
        entry.group.rotation.x = entry.group.rotation.x * 0.95 + breathe * 0.5;
        break;
      }
      default: {
        // Generic idle: all limbs relax to neutral
        if (armLeft) armLeft.rotation.x *= 0.88;
        if (armRight) {
          armRight.rotation.x *= 0.88;
          armRight.rotation.z *= 0.88;
        }
        break;
      }
    }

    // === IDLE JOINT FLEX — natural resting pose for all unit types ===
    // Elbows slightly bent at rest (not locked straight — looks robotic)
    const idleElbowL = entry.group.getObjectByName('arm-left-elbow');
    const idleElbowR = entry.group.getObjectByName('arm-right-elbow');
    if (idleElbowL) idleElbowL.rotation.x = idleElbowL.rotation.x * 0.9 + (-0.12) * 0.1;
    if (idleElbowR) idleElbowR.rotation.x = idleElbowR.rotation.x * 0.9 + (-0.12) * 0.1;
    // Knees very slightly bent — natural standing weight
    const idleKneeL = entry.group.getObjectByName('leg-left-knee');
    const idleKneeR = entry.group.getObjectByName('leg-right-knee');
    if (idleKneeL) idleKneeL.rotation.x = idleKneeL.rotation.x * 0.9 + 0.04 * 0.1;
    if (idleKneeR) idleKneeR.rotation.x = idleKneeR.rotation.x * 0.9 + 0.04 * 0.1;
  }

  // ─── HEALER AMBIENT EFFECTS (motes + crystal pulse, runs in all states) ───
  private _animateHealerAmbient(entry: UnitMeshGroup, time: number): void {
    // Orbiting green motes
    for (let i = 0; i < 3; i++) {
      const mote = entry.group.getObjectByName(`healer-mote-${i}`);
      if (!mote) continue;
      const phase = (i / 3) * Math.PI * 2;
      const angle = time * 1.0 + phase;
      mote.position.x = Math.cos(angle) * 0.4;
      mote.position.z = Math.sin(angle) * 0.4;
      mote.position.y = 0.5 + Math.sin(time * 2.0 + phase) * 0.12;
      const pulse = 0.7 + 0.5 * Math.sin(time * 2.5 + phase);
      mote.scale.setScalar(pulse);
    }
    // Staff crystal pulse
    const crystal = entry.group.getObjectByName('heal-crystal');
    if (crystal) {
      const cPulse = 0.9 + 0.2 * Math.sin(time * 2.0);
      crystal.scale.setScalar(cPulse);
    }
    const crystalGlow = entry.group.getObjectByName('heal-crystal-glow');
    if (crystalGlow) {
      const gPulse = 0.8 + 0.4 * Math.sin(time * 1.5);
      crystalGlow.scale.setScalar(gPulse);
    }
    // Palm orb pulse
    const palmOrb = entry.group.getObjectByName('heal-palm-orb');
    if (palmOrb) {
      const oPulse = 0.85 + 0.3 * Math.sin(time * 2.2 + 1.0);
      palmOrb.scale.setScalar(oPulse);
    }
    const palmGlow = entry.group.getObjectByName('heal-palm-glow');
    if (palmGlow) {
      const ogPulse = 0.7 + 0.5 * Math.sin(time * 1.8 + 0.5);
      palmGlow.scale.setScalar(ogPulse);
    }
  }

  // ─── PALADIN DIVINE AURA ANIMATION ──────────────────────────────
  private _animatePaladinAura(entry: UnitMeshGroup, time: number): void {
    // --- Orbiting shimmer motes ---
    // 4 motes orbit at different phases, bob vertically, and pulse in scale
    const ORBIT_SPEED = 1.4;   // radians per second
    const ORBIT_RADIUS = 0.7;  // distance from center
    const BOB_AMP = 0.15;      // vertical bob amplitude
    const BOB_SPEED = 2.5;     // vertical bob speed
    for (let i = 0; i < 4; i++) {
      const mote = entry.group.getObjectByName(`paladin-mote-${i}`);
      if (!mote) continue;
      const phase = (i / 4) * Math.PI * 2; // evenly spaced around circle
      const angle = time * ORBIT_SPEED + phase;
      mote.position.x = Math.cos(angle) * ORBIT_RADIUS;
      mote.position.z = Math.sin(angle) * ORBIT_RADIUS;
      mote.position.y = 1.6 + Math.sin(time * BOB_SPEED + phase) * BOB_AMP;
      // Pulse scale: gentle throb
      const pulse = 0.8 + 0.4 * Math.sin(time * 3.0 + phase * 1.5);
      mote.scale.setScalar(pulse);
      // Pulse opacity if material supports it
      const moteMat = (mote as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (moteMat && moteMat.opacity !== undefined) {
        moteMat.opacity = 0.5 + 0.35 * Math.sin(time * 2.5 + phase);
      }
    }

    // --- Floating halo (now a Group of ring segments) ---
    const halo = entry.group.getObjectByName('paladin-halo');
    if (halo) {
      // Gentle vertical float above head
      halo.position.y = 1.45 + Math.sin(time * 1.2) * 0.06;
      // Slow rotation
      halo.rotation.y = time * 0.8;
      // Subtle scale pulse (divine breathing)
      const haloPulse = 1.0 + 0.08 * Math.sin(time * 1.8);
      halo.scale.set(haloPulse, 1, haloPulse);
    }

    // --- Ground aura ring (now a Group of radial segments) ---
    const ring = entry.group.getObjectByName('paladin-aura-ring');
    if (ring) {
      // Slow rotation
      ring.rotation.y = time * 0.3;
      // Gentle scale breathing
      const ringPulse = 1.0 + 0.06 * Math.sin(time * 1.5);
      ring.scale.set(ringPulse, 1, ringPulse);
    }
  }

  // ─── BATTLEMAGE ARCANE AURA ANIMATION ──────────────────────────────
  private _animateBattlemageAura(entry: UnitMeshGroup, time: number): void {
    // --- 4 orbiting arcane motes ---
    const BM_ORBIT_SPEED = 1.6;
    const BM_ORBIT_RADIUS = 0.55;
    for (let i = 0; i < 4; i++) {
      const mote = entry.group.getObjectByName(`bm-mote-${i}`);
      if (!mote) continue;
      const phase = (i / 4) * Math.PI * 2;
      const angle = time * BM_ORBIT_SPEED + phase;
      // Elliptical orbit (wider on X, tighter on Z) for visual interest
      mote.position.x = Math.cos(angle) * BM_ORBIT_RADIUS;
      mote.position.z = Math.sin(angle) * (BM_ORBIT_RADIUS * 0.75);
      // Vertical bob — alternating heights
      mote.position.y = 0.55 + Math.sin(time * 2.2 + phase) * 0.18;
      // Scale pulse
      const pulse = 0.7 + 0.5 * Math.sin(time * 3.0 + phase * 1.3);
      mote.scale.setScalar(pulse);
    }

    // --- Staff orb glow pulse ---
    const orb = entry.group.getObjectByName('battlemage-orb');
    if (orb) {
      const orbPulse = 0.9 + 0.2 * Math.sin(time * 2.5);
      orb.scale.setScalar(orbPulse);
    }
    const orbGlow = entry.group.getObjectByName('bm-orb-glow');
    if (orbGlow) {
      const glowPulse = 0.8 + 0.4 * Math.sin(time * 1.8 + 0.5);
      orbGlow.scale.setScalar(glowPulse);
    }

    // --- Palm rune pulse ---
    const palmRune = entry.group.getObjectByName('bm-palm-rune');
    if (palmRune) {
      const pPulse = 0.8 + 0.4 * Math.sin(time * 2.8 + 1.0);
      palmRune.scale.setScalar(pPulse);
    }

    // --- Circlet gem shimmer ---
    const circletGem = entry.group.getObjectByName('bm-circlet-gem');
    if (circletGem) {
      const cPulse = 0.9 + 0.2 * Math.sin(time * 3.5);
      circletGem.scale.setScalar(cPulse);
    }

    // --- Buckle gem pulse ---
    const buckleGem = entry.group.getObjectByName('bm-buckle-gem');
    if (buckleGem) {
      const bPulse = 0.85 + 0.3 * Math.sin(time * 2.0 + 2.0);
      buckleGem.scale.setScalar(bPulse);
    }

    // --- Eye glow flicker ---
    entry.group.children.forEach(child => {
      if (child.name === 'bm-eye') {
        const eyeScale = 0.9 + 0.15 * Math.sin(time * 4.0 + Math.random() * 0.1);
        child.scale.setScalar(eyeScale);
      }
    });

    // --- Ground aura ring rotation ---
    const groundAura = entry.group.getObjectByName('bm-ground-aura');
    if (groundAura) {
      groundAura.rotation.y = time * 0.4;
      const ringPulse = 1.0 + 0.08 * Math.sin(time * 1.5);
      groundAura.scale.set(ringPulse, 1, ringPulse);
    }
  }

  // ─── HIT REACTION / TAKING DAMAGE ──────────────────────────────
  private animateHit(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Repeating hit-reaction cycle: recoil → flash → stagger → recover
    const CYCLE_SPEED = 0.8; // hits per second — slow enough to read the flinch
    const cycle = (time * CYCLE_SPEED) % 1;

    // --- Body recoil ---
    if (cycle < 0.15) {
      // Impact: snap backward + sideways jolt
      const p = cycle / 0.15;
      entry.group.rotation.x = -0.2 * p;
      entry.group.rotation.z = 0.12 * p;
      entry.group.position.y = -0.04 * p; // slight downward crunch
    } else if (cycle < 0.35) {
      // Stagger: wobble forward, try to recover
      const p = (cycle - 0.15) / 0.2;
      entry.group.rotation.x = -0.2 + 0.3 * p; // overshoot forward
      entry.group.rotation.z = 0.12 * (1 - p);
      entry.group.position.y = -0.04 * (1 - p);
    } else if (cycle < 0.55) {
      // Settle: damped wobble back to neutral
      const p = (cycle - 0.35) / 0.2;
      entry.group.rotation.x = 0.1 * (1 - p);
      entry.group.rotation.z = -0.04 * Math.sin(p * Math.PI);
    } else {
      // Rest: upright, small breathing before next hit
      const restP = (cycle - 0.55) / 0.45;
      entry.group.rotation.x = 0;
      entry.group.rotation.z = 0;
      entry.group.position.y = 0;
      // Slight defensive crouch as next hit approaches
      if (restP > 0.7) {
        const brace = (restP - 0.7) / 0.3;
        entry.group.rotation.x = -0.04 * brace;
      }
    }

    // --- Arm reactions (unit-type aware) ---
    const isShielded = type === UnitType.SHIELDBEARER || type === UnitType.PALADIN;
    const isRanged = type === UnitType.ARCHER || type === UnitType.MAGE || type === UnitType.BATTLEMAGE;

    if (cycle < 0.35) {
      // Flinch: arms fly up/back
      const p = Math.min(cycle / 0.15, 1);
      if (isShielded) {
        // Shield-bearers raise shield arm to block
        if (armLeft) { armLeft.rotation.x = 0.9 * p; armLeft.rotation.z = 0.3 * p; }
        if (armRight) armRight.rotation.x = -0.4 * p;
      } else if (isRanged) {
        // Ranged units flinch back, drop weapon arm
        if (armRight) { armRight.rotation.x = -0.6 * p; armRight.rotation.z = -0.2 * p; }
        if (armLeft) armLeft.rotation.x = -0.3 * p;
      } else {
        // Melee: arms jerk up defensively
        if (armRight) { armRight.rotation.x = -0.5 * p; armRight.rotation.z = -0.3 * p; }
        if (armLeft) { armLeft.rotation.x = -0.3 * p; armLeft.rotation.z = 0.2 * p; }
      }
    } else {
      // Recovery: arms return to neutral
      const p = Math.min((cycle - 0.35) / 0.3, 1);
      if (armRight) { armRight.rotation.x *= (1 - p * 0.7); armRight.rotation.z *= (1 - p * 0.7); }
      if (armLeft) { armLeft.rotation.x *= (1 - p * 0.7); armLeft.rotation.z *= (1 - p * 0.7); }
    }

    // --- Leg stagger ---
    if (cycle < 0.3) {
      const p = cycle / 0.3;
      if (legLeft) legLeft.rotation.x = -0.2 * p;
      if (legRight) legRight.rotation.x = 0.15 * p;
    } else {
      const p = Math.min((cycle - 0.3) / 0.3, 1);
      if (legLeft) legLeft.rotation.x = -0.2 * (1 - p);
      if (legRight) legRight.rotation.x = 0.15 * (1 - p);
    }

    // --- Rider: horse legs also react ---
    if (type === UnitType.RIDER) {
      const legBackLeft = entry.group.getObjectByName('leg-back-left');
      const legBackRight = entry.group.getObjectByName('leg-back-right');
      if (cycle < 0.3) {
        const p = cycle / 0.3;
        if (legBackLeft) legBackLeft.rotation.x = 0.2 * p;
        if (legBackRight) legBackRight.rotation.x = -0.15 * p;
      } else {
        const p = Math.min((cycle - 0.3) / 0.3, 1);
        if (legBackLeft) legBackLeft.rotation.x = 0.2 * (1 - p);
        if (legBackRight) legBackRight.rotation.x = -0.15 * (1 - p);
      }
    }

    // --- Red damage flash on impact frame ---
    // Tint meshes red at the impact point of the cycle, then restore
    const shouldFlash = cycle < 0.1;
    entry.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        if (shouldFlash) {
          if (!(child.material as any)._origColor) {
            (child.material as any)._origColor = child.material.color.getHex();
          }
          child.material.color.setHex(0xff2222);
        } else if ((child.material as any)._origColor !== undefined) {
          child.material.color.setHex((child.material as any)._origColor);
          delete (child.material as any)._origColor;
        }
      }
    });
  }

  // ─── BLOCK / PARRY REACTION ──────────────────────────────────
  private animateBlock(
    entry: UnitMeshGroup, type: UnitType,
    armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined,
    legLeft: THREE.Object3D | undefined, legRight: THREE.Object3D | undefined,
    time: number
  ): void {
    // Parry deflect: weapon sweeps sideways to knock incoming strike away
    // Cycle: ready → fast sideways sweep → follow-through → recover
    const CYCLE_SPEED = 1.0; // parry deflect — readable sweep
    const cycle = (time * CYCLE_SPEED) % 1;

    const isShielded = type === UnitType.SHIELDBEARER || type === UnitType.PALADIN;

    if (cycle < 0.12) {
      // Ready: weapon arm cocks slightly inward (loading the deflect)
      const p = cycle / 0.12;
      const easeIn = p * p; // accelerate into ready
      if (isShielded) {
        // Shield arm pulls slightly inward before bash-deflect
        if (armLeft) { armLeft.rotation.x = -0.3 * easeIn; armLeft.rotation.z = 0.3 * easeIn; }
        if (armRight) { armRight.rotation.x = -0.2 * easeIn; }
      } else {
        // Sword arm cocks to the right side (loading the sweep)
        if (armRight) { armRight.rotation.x = -0.5 * easeIn; armRight.rotation.z = 0.4 * easeIn; }
        if (armLeft) { armLeft.rotation.x = -0.2 * easeIn; }
      }
      entry.group.rotation.y = 0.15 * easeIn; // slight body twist loading
      entry.group.rotation.x = -0.05 * easeIn;
    } else if (cycle < 0.28) {
      // Deflect sweep: fast sideways weapon swing knocking the blow away
      const p = (cycle - 0.12) / 0.16;
      const easeOut = 1 - (1 - p) * (1 - p); // quick snap
      if (isShielded) {
        // Shield bash outward to the left
        if (armLeft) { armLeft.rotation.x = -0.3 + 0.6 * easeOut; armLeft.rotation.z = 0.3 - 0.8 * easeOut; }
        if (armRight) { armRight.rotation.x = -0.2; }
      } else {
        // Sword sweeps from right to left across body
        if (armRight) { armRight.rotation.x = -0.5 + 0.2 * easeOut; armRight.rotation.z = 0.4 - 1.0 * easeOut; }
        if (armLeft) { armLeft.rotation.x = -0.2 + 0.1 * easeOut; armLeft.rotation.z = -0.15 * easeOut; }
      }
      entry.group.rotation.y = 0.15 - 0.5 * easeOut; // body whips in sweep direction
      entry.group.rotation.x = -0.05;
    } else if (cycle < 0.42) {
      // Follow-through: slight overextension at end of sweep
      const p = (cycle - 0.28) / 0.14;
      const bounce = Math.sin(p * Math.PI) * 0.08; // small rebound
      if (isShielded) {
        if (armLeft) { armLeft.rotation.x = 0.3; armLeft.rotation.z = -0.5 + bounce; }
        if (armRight) { armRight.rotation.x = -0.2; }
      } else {
        if (armRight) { armRight.rotation.x = -0.3; armRight.rotation.z = -0.6 + bounce; }
        if (armLeft) { armLeft.rotation.x = -0.1; armLeft.rotation.z = -0.15; }
      }
      entry.group.rotation.y = -0.35 + bounce * 2;
      entry.group.rotation.z = 0.04 * Math.sin(p * Math.PI); // slight lateral sway from impact
    } else {
      // Recovery: smooth return to neutral
      const p = (cycle - 0.42) / 0.58;
      const ease = 1 - (1 - p) * (1 - p) * (1 - p); // cubic ease-out for smooth settle
      if (isShielded) {
        if (armLeft) { armLeft.rotation.x = 0.3 * (1 - ease); armLeft.rotation.z = -0.5 * (1 - ease); }
        if (armRight) { armRight.rotation.x = -0.2 * (1 - ease); }
      } else {
        if (armRight) { armRight.rotation.x = -0.3 * (1 - ease); armRight.rotation.z = -0.6 * (1 - ease); }
        if (armLeft) { armLeft.rotation.x = -0.1 * (1 - ease); armLeft.rotation.z = -0.15 * (1 - ease); }
      }
      entry.group.rotation.y = -0.35 * (1 - ease);
      entry.group.rotation.x = -0.05 * (1 - ease);
      entry.group.rotation.z = 0;
    }

    // Legs: weight shift during parry — front foot plants, back foot pivots
    if (legLeft) legLeft.rotation.x = cycle < 0.42 ? 0.2 : 0.2 * (1 - (cycle - 0.42) / 0.58);
    if (legRight) legRight.rotation.x = cycle < 0.42 ? -0.15 : -0.15 * (1 - (cycle - 0.42) / 0.58);

    // --- Metal flash on contact (0.12-0.22 = moment of deflect) ---
    const shouldFlash = cycle >= 0.12 && cycle < 0.22;
    entry.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        if (shouldFlash) {
          if (!(child.material as any)._origColor) {
            (child.material as any)._origColor = child.material.color.getHex();
          }
          child.material.color.setHex(0xffffcc); // bright white-yellow flash
        } else if ((child.material as any)._origColor !== undefined) {
          child.material.color.setHex((child.material as any)._origColor);
          delete (child.material as any)._origColor;
        }
      }
    });
  }
  /** Show or hide a small wood bundle on the unit when carrying resources */
  private showCarryVisual(entry: UnitMeshGroup, show: boolean): void {
    const existing = entry.group.getObjectByName('carry-wood');
    if (show && !existing) {
      // Add a small brown bundle on the unit's back
      const bundleGroup = new THREE.Group();
      bundleGroup.name = 'carry-wood';

      // Stack of 3 small logs
      const logGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3);
      const logMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(logGeo, logMat);
        log.position.set(-0.15, 0.55 + i * 0.09, -0.15);
        log.rotation.y = (i * 0.3) - 0.15;
        bundleGroup.add(log);
      }
      entry.group.add(bundleGroup);
    } else if (!show && existing) {
      entry.group.remove(existing);
      existing.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
  }

  /** Show small particle burst when chopping (simple wood chip effect) */
  private chopParticleTimers: Map<string, number> = new Map();

  private showChopParticle(group: THREE.Group, time: number): void {
    const key = group.uuid;
    const lastTime = this.chopParticleTimers.get(key) ?? 0;

    // Emit particles every 0.5 seconds
    if (time - lastTime < 0.5) return;
    this.chopParticleTimers.set(key, time);

    // Create a small brown particle that flies up and fades
    const chipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const chipMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? 0x8d6e63 : 0x4caf50, // brown or green chips
      transparent: true,
      opacity: 1.0,
    });
    const chip = new THREE.Mesh(chipGeo, chipMat);
    chip.position.set(
      group.position.x + (Math.random() - 0.5) * 0.5,
      group.position.y + 0.8,
      group.position.z + (Math.random() - 0.5) * 0.5,
    );

    const velocity = {
      x: (Math.random() - 0.5) * 2,
      y: 1.5 + Math.random(),
      z: (Math.random() - 0.5) * 2,
    };

    this.scene.add(chip);

    // Animate the particle
    let elapsed = 0;
    const animate = () => {
      elapsed += 0.016;
      chip.position.x += velocity.x * 0.016;
      chip.position.y += velocity.y * 0.016;
      chip.position.z += velocity.z * 0.016;
      velocity.y -= 3.0 * 0.016; // gravity
      chipMat.opacity = Math.max(0, 1 - elapsed * 2);

      if (elapsed < 0.8) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(chip);
        chipGeo.dispose();
        chipMat.dispose();
      }
    };
    requestAnimationFrame(animate);
  }
  // ─── PREVIEW ANIMATION (for debug panel) ──────────────────────────
  // Persistent fake entry used by animatePreviewGroup so the private
  // animation methods (animateAttacking, animateMoving, animateIdle)
  // can be called without registering in unitMeshes.
  private _previewEntry: UnitMeshGroup | null = null;

  /**
   * Animate a detached THREE.Group as if it were a unit — used by the
   * debug panel 3D preview.  No trails/particles are spawned because the
   * fake unitId isn't in unitMeshes.
   */
  animatePreviewGroup(
    group: THREE.Group,
    unitType: UnitType,
    state: 'idle' | 'moving' | 'attacking' | 'hit' | 'block',
    time: number,
  ): void {
    // Lazily create / reuse a minimal fake UnitMeshGroup
    if (!this._previewEntry || this._previewEntry.group !== group) {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      this._previewEntry = {
        group,
        unitId: '__preview__',
        unitType,
        healthBar: new THREE.Sprite(),
        healthBarCanvas: canvas,
        healthBarCtx: ctx,
        healthBarTexture: new THREE.CanvasTexture(canvas),
        lastHealthRatio: 1,
        label: new THREE.Sprite(),
        facingAngle: 0,
        lastPosition: new THREE.Vector3(),
        trebFireStart: 0,
        trebPendingTarget: null,
        attackAnimStart: 0,
      _knockbackUntil: 0,
      };
    }
    const entry = this._previewEntry;
    entry.unitType = unitType;

    const armLeft = group.getObjectByName('arm-left');
    const armRight = group.getObjectByName('arm-right');
    const legLeft = group.getObjectByName('leg-left');
    const legRight = group.getObjectByName('leg-right');

    // Smoothly decay body tilt each frame (same as real animateUnit)
    group.rotation.z *= 0.85;
    group.rotation.x *= 0.85;

    if (state === 'attacking') {
      if (entry.attackAnimStart === 0) entry.attackAnimStart = time;
      this.animateAttacking(entry, unitType, armLeft, armRight, legLeft, legRight, time, '__preview__');
    } else if (state === 'moving') {
      entry.attackAnimStart = 0;
      this.animateMoving(entry, unitType, armLeft, armRight, legLeft, legRight, time);
    } else if (state === 'hit') {
      entry.attackAnimStart = 0;
      this.animateHit(entry, unitType, armLeft, armRight, legLeft, legRight, time);
    } else if (state === 'block') {
      entry.attackAnimStart = 0;
      this.animateBlock(entry, unitType, armLeft, armRight, legLeft, legRight, time);
    } else {
      entry.attackAnimStart = 0;
      this.animateIdle(entry, unitType, armLeft, armRight, legLeft, legRight, time);
    }
  }
}
