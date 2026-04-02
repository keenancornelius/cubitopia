// ============================================
// CUBITOPIA — Cinematic Title Screen: Real AI Battle
// Uses UnitFactory for real stats, UnitRenderer for real animations,
// and a lightweight combat simulator that mirrors UnitAI behavior.
// Units fight, die, and respawn endlessly behind the menu overlay.
// Full VFX: projectiles, hit effects, knockback, elemental impacts.
// ============================================

import * as THREE from 'three';
import { UnitRenderer } from './UnitRenderer';
import { UnitType, UnitState, HexCoord, Unit, TerrainType, ElementType } from '../types';
import { UnitFactory, UNIT_CONFIG } from '../game/entities/UnitFactory';
import { CombatSystem } from '../game/systems/CombatSystem';
import { Pathfinder } from '../game/systems/Pathfinder';

// ── Arena config ─────────────────────────────────────────
const ARENA_RADIUS = 10;        // hex tiles from center
const RESPAWN_THRESHOLD = 4;    // respawn wave when ≤ this many alive per side
const RESPAWN_DELAY = 2.0;      // seconds before fresh wave spawns
const DETECTION_RANGE = 12;     // how far units look for enemies
const MIN_ATTACK_COOLDOWN: Partial<Record<UnitType, number>> = {
  [UnitType.WARRIOR]: 0.91,
  [UnitType.ARCHER]: 0.67,
  [UnitType.RIDER]: 0.83,
  [UnitType.PALADIN]: 1.67,
  [UnitType.MAGE]: 1.25,
  [UnitType.ASSASSIN]: 0.56,
  [UnitType.SHIELDBEARER]: 2.0,
  [UnitType.BERSERKER]: 0.77,
  [UnitType.BATTLEMAGE]: 2.0,
  [UnitType.GREATSWORD]: 1.43,
  [UnitType.OGRE]: 2.5,
  [UnitType.SCOUT]: 0.67,
  [UnitType.HEALER]: 1.5,
};

// Ranged units that kite away from melee threats
const RANGED_KITERS = new Set<UnitType>([
  UnitType.ARCHER, UnitType.MAGE, UnitType.BATTLEMAGE,
]);
const KITE_TRIGGER_BONUS = 1; // how close a melee threat must be beyond weapon range to trigger kiting
const ELEMENT_CYCLE: ElementType[] = [
  ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH,
];

// Melee strike delays — how long to wait before applying damage visuals (syncs to animation)
const MELEE_STRIKE_DELAY: Partial<Record<UnitType, number>> = {
  [UnitType.WARRIOR]: 420,
  [UnitType.PALADIN]: 390,
  [UnitType.RIDER]: 420,
  [UnitType.SCOUT]: 230,
  [UnitType.ASSASSIN]: 360,
  [UnitType.BERSERKER]: 420,
  [UnitType.SHIELDBEARER]: 460,
  [UnitType.GREATSWORD]: 510,
  [UnitType.OGRE]: 580,
};

// Combat unit types used in the arena — one of each
const ARENA_UNIT_POOL: UnitType[] = [
  UnitType.WARRIOR, UnitType.ARCHER, UnitType.RIDER, UnitType.PALADIN,
  UnitType.MAGE, UnitType.ASSASSIN, UnitType.SHIELDBEARER, UnitType.BERSERKER,
  UnitType.BATTLEMAGE, UnitType.GREATSWORD, UnitType.OGRE, UnitType.SCOUT,
  UnitType.HEALER,
];

// ── Camera keyframes ─────────────────────────────────────
interface CameraKeyframe {
  distance: number;
  phi: number;
  theta: number;
  duration: number;
}

// ── Tile stub for arena map ──────────────────────────────
interface ArenaTile {
  position: HexCoord;
  terrain: TerrainType;
  elevation: number;
  walkableFloor: number;
  resource: null;
  improvement: null;
  unit: null;
  owner: null;
  voxelData: any;
  visible: boolean;
  explored: boolean;
}

function hexDist(a: HexCoord, b: HexCoord): number {
  const aq = a.q, ar = a.r;
  const bq = b.q, br = b.r;
  // offset coords → cube coords then manhattan/2
  const ac = aq; const af = ar - (aq - (aq & 1)) / 2; const ae = -ac - af;
  const bc = bq; const bf = br - (bq - (bq & 1)) / 2; const be = -bc - bf;
  return Math.max(Math.abs(ac - bc), Math.abs(af - bf), Math.abs(ae - be));
}

function hexToWorld(coord: HexCoord, elevation = 0): THREE.Vector3 {
  const x = coord.q * 1.5;
  const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
  return new THREE.Vector3(x, elevation * 0.5 + 0.25, z);
}

// ============================================
// TitleScene
// ============================================
export class TitleScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private webglRenderer: THREE.WebGLRenderer | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private unitRenderer!: UnitRenderer;
  private _running = false;
  private _animFrameId = 0;
  private _clock = new THREE.Clock(false);
  private _time = 0;
  private _gameTime = 0;

  // Arena data
  private _units: Unit[] = [];
  private _arenaMap: any; // GameMap stub
  private _deadUnits: Set<string> = new Set();
  private _respawnTimer = 0;

  // Camera
  private _camTarget = new THREE.Vector3(0, 1, 0);
  private _camDistance = 22;
  private _camPhi = Math.PI / 3.2;
  private _camTheta = 0;
  private _keyframes: CameraKeyframe[] = [];
  private _kfIndex = 0;
  private _kfTime = 0;
  private _kfFrom = { distance: 0, phi: 0, theta: 0 };

  // Particles
  private _particles: THREE.Points | null = null;
  private _particleTime = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = this._createSkyGradient();
    this.scene.fog = new THREE.FogExp2(0x0a0a15, 0.010);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 250);

    this._setupLighting();
    this._buildArenaMap();
    // No terrain mesh — just the sky backdrop, lighting, and particles
    this._buildParticles();
    this._setupKeyframes();

    this.unitRenderer = new UnitRenderer(this.scene);
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Start the title scene on its own dedicated canvas (overlaid behind the menu).
   * Completely independent from the game's renderer — no shared state.
   */
  start(): void {
    if (this._running) return;

    // Create a dedicated canvas for the title scene
    this._canvas = document.createElement('canvas');
    this._canvas.id = 'title-scene-canvas';
    this._canvas.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      z-index:19999; pointer-events:none;
    `;
    document.body.appendChild(this._canvas);

    this.webglRenderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: false,
    });
    this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webglRenderer.shadowMap.enabled = true;
    this.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.webglRenderer.toneMappingExposure = 1.3;

    this._running = true;
    this._clock.start();

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this._spawnWave();

    window.addEventListener('resize', this._onResize);

    const animate = () => {
      if (!this._running) return;
      this._animFrameId = requestAnimationFrame(animate);
      const delta = Math.min(this._clock.getDelta(), 0.05);
      this._time += delta;
      this._gameTime += delta;

      this._updateAI(delta);
      this._updateRendering(delta);
      this._updateCamera(delta);
      this._updateParticles(delta);
      this._checkRespawn(delta);

      this.webglRenderer!.render(this.scene, this.camera);
    };
    animate();
  }

  stop(): void {
    this._running = false;
    this._clock.stop();
    cancelAnimationFrame(this._animFrameId);
    window.removeEventListener('resize', this._onResize);
    if (this.webglRenderer) {
      this.webglRenderer.dispose();
      this.webglRenderer = null;
    }
    if (this._canvas) {
      this._canvas.remove();
      this._canvas = null;
    }
  }

  get isRunning(): boolean { return this._running; }

  dispose(): void {
    this.stop();
    this.unitRenderer.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
  }

  // ── Resize ─────────────────────────────────────────────
  private _onResize = (): void => {
    if (!this.webglRenderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
  };

  // ══════════════════════════════════════════════════════
  // ARENA MAP (flat plains — minimal GameMap stub)
  // ══════════════════════════════════════════════════════

  private _buildArenaMap(): void {
    const tiles = new Map<string, ArenaTile>();
    for (let q = -ARENA_RADIUS; q <= ARENA_RADIUS; q++) {
      for (let r = -ARENA_RADIUS; r <= ARENA_RADIUS; r++) {
        const key = `${q},${r}`;
        tiles.set(key, {
          position: { q, r },
          terrain: TerrainType.PLAINS,
          elevation: 0,
          walkableFloor: 0,
          resource: null,
          improvement: null,
          unit: null,
          owner: null,
          voxelData: { blocks: [] },
          visible: true,
          explored: true,
        });
      }
    }
    this._arenaMap = {
      width: ARENA_RADIUS * 2 + 1,
      height: ARENA_RADIUS * 2 + 1,
      tiles,
      seed: 42,
    };
  }

  // ══════════════════════════════════════════════════════
  // UNIT SPAWNING
  // ══════════════════════════════════════════════════════

  private _spawnWave(): void {
    // Tactical formation: tanks front, ranged back, flankers on the wings
    // FRONT LINE (closest to enemy): Shieldbearer, Warrior, Paladin, Ogre, Greatsword
    // BACK LINE (behind front): Archer, Mage, Battlemage, Berserker
    // FLANKERS (wide on the sides): Rider, Assassin, Scout

    const frontLine: UnitType[] = [
      UnitType.SHIELDBEARER, UnitType.WARRIOR, UnitType.PALADIN, UnitType.OGRE, UnitType.GREATSWORD,
    ];
    const backLine: UnitType[] = [
      UnitType.ARCHER, UnitType.MAGE, UnitType.BATTLEMAGE, UnitType.BERSERKER, UnitType.HEALER,
    ];
    const flankers: UnitType[] = [
      UnitType.RIDER, UnitType.ASSASSIN, UnitType.SCOUT,
    ];

    for (let army = 0; army < 2; army++) {
      const side = army === 0 ? -1 : 1;

      // Front line — row closest to center, spread along r-axis
      for (let i = 0; i < frontLine.length; i++) {
        const spread = (i - (frontLine.length - 1) / 2) * 2; // centered spread
        const q = Math.round(side * 3);        // close to center
        const r = Math.round(spread);
        this._spawnUnit(frontLine[i], army, q, r);
      }

      // Back line — behind the front, spread along r-axis
      for (let i = 0; i < backLine.length; i++) {
        const spread = (i - (backLine.length - 1) / 2) * 2;
        const q = Math.round(side * 6);        // further back
        const r = Math.round(spread);
        this._spawnUnit(backLine[i], army, q, r);
      }

      // Flankers — wide on the wings, at front-line depth
      for (let i = 0; i < flankers.length; i++) {
        const q = Math.round(side * (2 + i));  // staggered depth
        const flankDir = i % 2 === 0 ? 1 : -1; // alternate top/bottom
        const r = Math.round(flankDir * (5 + i));  // wide out on the sides
        this._spawnUnit(flankers[i], army, q, r);
      }
    }
  }

  private _spawnUnit(type: UnitType, army: number, q: number, r: number): void {
    const unit = UnitFactory.create(type, army, { q, r });
    unit.state = UnitState.IDLE;

    const wp = hexToWorld(unit.position, 0);
    unit.worldPosition = { x: wp.x, y: 0.25, z: wp.z };

    this._units.push(unit);
    this.unitRenderer.addUnit(unit, 0);
  }

  /** Max units per team — matches the initial wave (5 front + 5 back + 3 flankers) */
  private static readonly MAX_TEAM_SIZE = 13;

  /** Full roster to pick reinforcements from (shuffled each time) */
  private static readonly REINFORCE_POOL: UnitType[] = [
    UnitType.WARRIOR, UnitType.ARCHER, UnitType.RIDER, UnitType.PALADIN,
    UnitType.MAGE, UnitType.ASSASSIN, UnitType.SHIELDBEARER, UnitType.BERSERKER,
    UnitType.BATTLEMAGE, UnitType.GREATSWORD, UnitType.OGRE, UnitType.SCOUT,
    UnitType.HEALER,
  ];

  private _clearDeadAndRespawn(): void {
    // Remove all dead units from renderer
    for (const unit of this._units) {
      if (unit.state === UnitState.DEAD || this._deadUnits.has(unit.id)) {
        this.unitRenderer.removeUnit(unit.id);
      }
    }
    // Remove dead from arrays
    this._units = this._units.filter(u => u.state !== UnitState.DEAD && !this._deadUnits.has(u.id));
    this._deadUnits.clear();

    // Count survivors per team
    const aliveByTeam = [0, 0];
    for (const u of this._units) aliveByTeam[u.owner]++;

    // If both teams are wiped or very low, do a full fresh wave for both
    if (aliveByTeam[0] <= 2 && aliveByTeam[1] <= 2) {
      for (const u of this._units) this.unitRenderer.removeUnit(u.id);
      this._units = [];
      this._spawnWave();
      return;
    }

    // Reinforce BOTH teams back up to max — losing team gets more, winning team tops off
    for (let army = 0; army < 2; army++) {
      const needed = TitleScene.MAX_TEAM_SIZE - aliveByTeam[army];
      if (needed <= 0) continue;

      // Shuffle the pool so reinforcements are varied each wave
      const pool = [...TitleScene.REINFORCE_POOL];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }

      const toSpawn = pool.slice(0, needed);
      const side = army === 0 ? -1 : 1;
      for (let i = 0; i < toSpawn.length; i++) {
        const spread = (i - (toSpawn.length - 1) / 2) * 2;
        const q = Math.round(side * 7); // spawn behind the lines
        const r = Math.round(spread);
        this._spawnUnit(toSpawn[i], army, q, r);
      }
    }
  }

  // ══════════════════════════════════════════════════════
  // COMBAT AI (lightweight — mirrors UnitAI patterns)
  // ══════════════════════════════════════════════════════

  private _updateAI(delta: number): void {
    const alive = this._units.filter(u => u.state !== UnitState.DEAD && !this._deadUnits.has(u.id));

    for (const unit of alive) {
      if (this._deadUnits.has(unit.id)) continue;
      unit.attackCooldown = Math.max(0, unit.attackCooldown - delta);

      // Healers have their own AI — they heal injured allies
      if (unit.type === UnitType.HEALER) {
        this._aiHealer(unit, alive, delta);
        continue;
      }

      switch (unit.state) {
        case UnitState.IDLE:
          this._aiIdle(unit, alive);
          break;
        case UnitState.MOVING:
          this._aiMoving(unit, alive, delta);
          break;
        case UnitState.ATTACKING:
          this._aiAttacking(unit, alive, delta);
          break;
      }
    }
  }

  private _findBestTarget(unit: Unit, allAlive: Unit[]): Unit | null {
    let best: Unit | null = null;
    let bestDist = Infinity;

    for (const other of allAlive) {
      if (other.owner === unit.owner) continue;
      if (other.state === UnitState.DEAD || this._deadUnits.has(other.id)) continue;
      const d = hexDist(unit.position, other.position);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return bestDist <= DETECTION_RANGE ? best : null;
  }

  // ── HEALER AI: find most injured ally, move to them, heal ──
  private _aiHealer(unit: Unit, allAlive: Unit[], delta: number): void {
    // Find most injured friendly unit within detection range
    let bestTarget: Unit | null = null;
    let bestMissingHp = 0;
    for (const other of allAlive) {
      if (other.id === unit.id) continue;
      if (other.owner !== unit.owner) continue;
      if (other.state === UnitState.DEAD || this._deadUnits.has(other.id)) continue;
      const missing = other.stats.maxHealth - other.currentHealth;
      if (missing > bestMissingHp) {
        bestMissingHp = missing;
        bestTarget = other;
      }
    }

    // Nothing to heal — follow the group loosely
    if (!bestTarget || bestMissingHp <= 0) {
      // Follow center of friendly army
      const friendlies = allAlive.filter(u => u.owner === unit.owner && u.id !== unit.id);
      if (friendlies.length > 0) {
        const center = friendlies[Math.floor(friendlies.length / 2)];
        const dist = hexDist(unit.position, center.position);
        if (dist > 3) {
          this._startMoveToward(unit, center);
        } else {
          unit.state = UnitState.IDLE;
        }
      }
      return;
    }

    const healRange = unit.stats.range || 3;
    const dist = hexDist(unit.position, bestTarget.position);

    if (dist > healRange) {
      // Move toward injured ally
      this._startMoveToward(unit, bestTarget);
      // Continue movement if already pathing
      if (unit.state === UnitState.MOVING) {
        this._aiMoving(unit, allAlive, delta);
      }
      return;
    }

    // In range — heal on cooldown
    if (unit.attackCooldown > 0) return;

    const healAmount = Math.max(2, Math.floor(unit.stats.attack * 0.8));
    bestTarget.currentHealth = Math.min(bestTarget.stats.maxHealth, bestTarget.currentHealth + healAmount);
    this.unitRenderer.updateHealthBar(bestTarget);

    // Fire heal orb VFX
    this.unitRenderer.fireHealOrb(unit.worldPosition, bestTarget.worldPosition, bestTarget.id, () => {
      // Heal orb impact — flash green
      this.unitRenderer.flashUnit(bestTarget.id, 0.2);
    });

    // Face the target
    this.unitRenderer.faceTarget(unit.id, bestTarget.worldPosition);

    // Set cooldown
    unit.attackCooldown = MIN_ATTACK_COOLDOWN[UnitType.HEALER] ?? 1.5;
  }

  // ── IDLE: find enemy, start moving toward them ─────────
  private _aiIdle(unit: Unit, allAlive: Unit[]): void {
    const target = this._findBestTarget(unit, allAlive);
    if (!target) return;

    const dist = hexDist(unit.position, target.position);
    if (dist <= unit.stats.range) {
      // Already in range — attack directly
      unit.state = UnitState.ATTACKING;
      (unit as any)._targetUnitId = target.id;
    } else {
      // Move toward target
      this._startMoveToward(unit, target);
    }
  }

  // ── MOVING: advance toward target, check if in range ──
  private _aiMoving(unit: Unit, allAlive: Unit[], delta: number): void {
    const targetId = (unit as any)._targetUnitId as string | undefined;
    const target = targetId ? allAlive.find(u => u.id === targetId) : null;

    // Target died? Go idle to pick new one
    if (!target || target.state === UnitState.DEAD || this._deadUnits.has(target.id)) {
      unit.state = UnitState.IDLE;
      (unit as any)._targetUnitId = undefined;
      (unit as any)._path = undefined;
      return;
    }

    const dist = hexDist(unit.position, target.position);
    if (dist <= unit.stats.range) {
      unit.state = UnitState.ATTACKING;
      (unit as any)._path = undefined;
      return;
    }

    // Advance along path
    let path = (unit as any)._path as HexCoord[] | undefined;
    if (!path || path.length === 0) {
      // Repath
      this._startMoveToward(unit, target);
      path = (unit as any)._path;
      if (!path || path.length === 0) {
        unit.state = UnitState.IDLE;
        return;
      }
    }

    // Move toward next waypoint
    const nextHex = path[0];
    const targetWorld = hexToWorld(nextHex, 0);
    const speed = unit.moveSpeed * delta * 1.5; // Slightly faster for cinematic effect

    const dx = targetWorld.x - unit.worldPosition.x;
    const dz = targetWorld.z - unit.worldPosition.z;
    const d2d = Math.sqrt(dx * dx + dz * dz);

    if (d2d < speed * 1.5) {
      // Arrived at waypoint
      unit.position = { ...nextHex };
      unit.worldPosition.x = targetWorld.x;
      unit.worldPosition.z = targetWorld.z;
      path.shift();
    } else {
      // Lerp toward
      const nx = dx / d2d;
      const nz = dz / d2d;
      unit.worldPosition.x += nx * speed;
      unit.worldPosition.z += nz * speed;
    }
  }

  private _startMoveToward(unit: Unit, target: Unit): void {
    try {
      const path = Pathfinder.findPath(unit.position, target.position, this._arenaMap, false, unit.owner, false, false, true);
      if (path.length > 1) {
        (unit as any)._path = path.slice(1); // Skip current position
        (unit as any)._targetUnitId = target.id;
        unit.state = UnitState.MOVING;
      }
    } catch {
      // Pathfinding failed — just charge directly
      (unit as any)._path = [target.position];
      (unit as any)._targetUnitId = target.id;
      unit.state = UnitState.MOVING;
    }
  }

  // ── ATTACKING: deal damage with full VFX pipeline ──────
  private _aiAttacking(unit: Unit, allAlive: Unit[], delta: number): void {
    const targetId = (unit as any)._targetUnitId as string | undefined;
    let target = targetId ? allAlive.find(u => u.id === targetId) : null;

    // Target dead? Chain to next
    if (!target || target.state === UnitState.DEAD || this._deadUnits.has(target.id)) {
      (unit as any)._targetUnitId = undefined;
      const next = this._findBestTarget(unit, allAlive);
      if (next) {
        (unit as any)._targetUnitId = next.id;
        target = next;
        const dist = hexDist(unit.position, next.position);
        if (dist > unit.stats.range) {
          this._startMoveToward(unit, next);
          return;
        }
      } else {
        unit.state = UnitState.IDLE;
        return;
      }
    }

    if (!target) { unit.state = UnitState.IDLE; return; }

    const dist = hexDist(unit.position, target.position);

    // Out of range? Chase
    if (dist > unit.stats.range) {
      this._startMoveToward(unit, target);
      return;
    }

    // ── Kiting check for ranged units ──
    // After firing, ranged kiters check for melee threats and flee
    if (RANGED_KITERS.has(unit.type)) {
      const kiteRange = unit.stats.range + KITE_TRIGGER_BONUS;
      const meleeThreat = this._findNearestMeleeThreat(unit, allAlive, kiteRange);
      if (meleeThreat && unit.attackCooldown > 0) {
        // Already on cooldown — kite away while waiting
        const kiteTile = this._findKiteTile(unit, meleeThreat);
        if (kiteTile) {
          (unit as any)._path = [kiteTile];
          (unit as any)._targetUnitId = target.id; // keep original target
          unit.state = UnitState.MOVING;
          return;
        }
      }
    }

    // Attack cooldown
    if (unit.attackCooldown > 0) return;

    // Resolve combat!
    const result = CombatSystem.resolve(unit, target);
    CombatSystem.apply(unit, target, result);

    // Set cooldown
    const baseCd = unit.attackSpeed > 0 ? 1 / unit.attackSpeed : 2;
    unit.attackCooldown = Math.max(baseCd, MIN_ATTACK_COOLDOWN[unit.type] ?? 0.4);

    // ── Dispatch VFX ──
    const isRangedAttack = unit.stats.range > 1;
    const isDeflected = !!result.deflected;
    const isBlocked = !!result.blocked;

    if (isRangedAttack) {
      this._dispatchRangedVFX(unit, target, result, isDeflected, allAlive);
    } else {
      this._dispatchMeleeVFX(unit, target, result, isBlocked, allAlive);
    }

    // Health bar updates
    this.unitRenderer.updateHealthBar(unit);
    this.unitRenderer.updateHealthBar(target);

    // Handle deaths
    if (target.currentHealth <= 0) {
      target.state = UnitState.DEAD;
      this._deadUnits.add(target.id);
      setTimeout(() => {
        this.unitRenderer.removeUnit(target.id);
      }, 800);
    }

    if (unit.currentHealth <= 0) {
      unit.state = UnitState.DEAD;
      this._deadUnits.add(unit.id);
      setTimeout(() => {
        this.unitRenderer.removeUnit(unit.id);
      }, 800);
    }

    // ── Post-attack kiting: ranged units flee immediately after firing ──
    if (RANGED_KITERS.has(unit.type) && unit.state !== UnitState.DEAD) {
      const kiteRange = unit.stats.range + KITE_TRIGGER_BONUS;
      const meleeThreat = this._findNearestMeleeThreat(unit, allAlive, kiteRange);
      if (meleeThreat) {
        const kiteTile = this._findKiteTile(unit, meleeThreat);
        if (kiteTile) {
          (unit as any)._path = [kiteTile];
          (unit as any)._targetUnitId = target.id;
          unit.state = UnitState.MOVING;
        }
      }
    }
  }

  // ── Ranged VFX dispatch (arrows, spells, orbs) ────────
  private _dispatchRangedVFX(
    attacker: Unit, defender: Unit, result: any,
    isDeflected: boolean, allAlive: Unit[],
  ): void {
    const defId = defender.id;

    const applyDamageVisuals = () => {
      this.unitRenderer.flashUnit(defId, 0.15);
      this.unitRenderer.showDamageEffect(defender.worldPosition);
    };

    if (attacker.type === UnitType.ARCHER) {
      if (isDeflected) {
        this.unitRenderer.fireDeflectedArrow(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
      } else {
        this.unitRenderer.fireArrow(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
      }
    } else if (attacker.type === UnitType.MAGE) {
      const elem = attacker.element ?? ElementType.FIRE;
      switch (elem) {
        case ElementType.LIGHTNING:
          this.unitRenderer.fireLightningBolt(attacker.worldPosition, defender.worldPosition, defId, () => {
            applyDamageVisuals();
            this.unitRenderer.spawnElectrocuteEffect(defId);
            // Chain lightning to 2 nearby enemies
            const chainTargets = allAlive
              .filter(u => u.id !== defId && u.owner !== attacker.owner && u.state !== UnitState.DEAD && !this._deadUnits.has(u.id))
              .map(u => ({ unit: u, dist: Math.hypot(u.worldPosition.x - defender.worldPosition.x, u.worldPosition.z - defender.worldPosition.z) }))
              .filter(e => e.dist < 3.0)
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 2);
            for (const ct of chainTargets) {
              const chainDmg = Math.max(1, Math.floor((result.attackerDamage ?? 0) * 0.5));
              ct.unit.currentHealth = Math.max(0, ct.unit.currentHealth - chainDmg);
              this.unitRenderer.queueDeferredEffect(150, () => {
                this.unitRenderer.fireLightningChain(defender.worldPosition, ct.unit.worldPosition, ct.unit.id);
                this.unitRenderer.spawnElectrocuteEffect(ct.unit.id);
                this.unitRenderer.updateHealthBar(ct.unit);
                if (ct.unit.currentHealth <= 0) {
                  ct.unit.state = UnitState.DEAD;
                  this._deadUnits.add(ct.unit.id);
                  setTimeout(() => this.unitRenderer.removeUnit(ct.unit.id), 800);
                }
              });
            }
          });
          break;
        case ElementType.FIRE:
          this.unitRenderer.fireFlamethrower(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
          break;
        case ElementType.EARTH:
          this.unitRenderer.fireStoneColumn(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
          break;
        case ElementType.WATER:
          this.unitRenderer.fireWaterWave(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
          break;
        case ElementType.WIND:
          this.unitRenderer.fireWindTornado(attacker.worldPosition, defender.worldPosition, defId, applyDamageVisuals);
          break;
      }
      // Cycle element
      const cycleIdx = attacker._elementCycleIndex ?? 0;
      const nextIdx = (cycleIdx + 1) % ELEMENT_CYCLE.length;
      attacker._elementCycleIndex = nextIdx;
      attacker.element = ELEMENT_CYCLE[nextIdx];

    } else if (attacker.type === UnitType.BATTLEMAGE) {
      const orbColor = attacker.element ? UnitRenderer.elementOrbColor(attacker.element) : 0x7c4dff;
      this.unitRenderer.fireMagicOrb(attacker.worldPosition, defender.worldPosition, orbColor, defId, true, () => {
        applyDamageVisuals();
        // AoE splash to nearby enemies
        const splash = allAlive
          .filter(u => u.id !== defId && u.owner !== attacker.owner && u.state !== UnitState.DEAD && !this._deadUnits.has(u.id))
          .filter(u => hexDist(u.position, defender.position) <= 1);
        for (const v of splash) {
          const splashDmg = Math.max(1, Math.floor(attacker.stats.attack * 0.35));
          v.currentHealth = Math.max(0, v.currentHealth - splashDmg);
          this.unitRenderer.flashUnit(v.id, 0.15);
          this.unitRenderer.showDamageEffect(v.worldPosition);
          this.unitRenderer.updateHealthBar(v);
          if (v.currentHealth <= 0) {
            v.state = UnitState.DEAD;
            this._deadUnits.add(v.id);
            setTimeout(() => this.unitRenderer.removeUnit(v.id), 800);
          }
        }
      });
      // Cycle element
      const cycleIdx = attacker._elementCycleIndex ?? 0;
      const nextIdx = (cycleIdx + 1) % ELEMENT_CYCLE.length;
      attacker._elementCycleIndex = nextIdx;
      attacker.element = ELEMENT_CYCLE[nextIdx];

    } else if (attacker.type === UnitType.BERSERKER) {
      // Berserker axe throw
      this.unitRenderer.fireAxeThrow(attacker.worldPosition, defender.worldPosition, defId, () => {
        applyDamageVisuals();
        if (isDeflected) {
          this.unitRenderer.spawnDeflectedAxe(defender.worldPosition);
        }
      });
    } else {
      // Generic ranged projectile (Scout, etc.)
      this.unitRenderer.fireProjectile(attacker.worldPosition, defender.worldPosition, 0xFF8800, defId, applyDamageVisuals);
    }
  }

  // ── Melee VFX dispatch (swings, blocks, knockback) ────
  private _dispatchMeleeVFX(
    attacker: Unit, defender: Unit, result: any,
    isBlocked: boolean, allAlive: Unit[],
  ): void {
    const defId = defender.id;
    const strikeDelay = MELEE_STRIKE_DELAY[attacker.type] ?? 250;

    const applyDamageVisuals = () => {
      this.unitRenderer.flashUnit(defId, 0.15);
      this.unitRenderer.showDamageEffect(defender.worldPosition);
      if (isBlocked) {
        this.unitRenderer.spawnBlockSparks(defender.worldPosition);
      }
    };

    // Queue damage visuals on melee strike delay (animation sync)
    this.unitRenderer.queueDeferredEffect(strikeDelay, applyDamageVisuals);

    // ── Greatsword cleave knockback ──
    if (attacker.type === UnitType.GREATSWORD) {
      this.unitRenderer.queueDeferredEffect(strikeDelay + 50, () => {
        // Knockback primary target
        this._applyKnockback(defender, attacker);
        // Cleave splash to adjacent enemies
        const splash = allAlive
          .filter(u => u.id !== defId && u.owner !== attacker.owner && u.state !== UnitState.DEAD && !this._deadUnits.has(u.id))
          .filter(u => hexDist(u.position, defender.position) <= 1);
        for (const v of splash) {
          const cleaveDmg = Math.max(1, Math.floor(attacker.stats.attack * 0.6));
          v.currentHealth = Math.max(0, v.currentHealth - cleaveDmg);
          this.unitRenderer.flashUnit(v.id, 0.15);
          this.unitRenderer.showDamageEffect(v.worldPosition);
          this.unitRenderer.updateHealthBar(v);
          this._applyKnockback(v, attacker);
          if (v.currentHealth <= 0) {
            v.state = UnitState.DEAD;
            this._deadUnits.add(v.id);
            setTimeout(() => this.unitRenderer.removeUnit(v.id), 800);
          }
        }
      });
    }

    // ── Ogre club swipe knockback ──
    if (attacker.type === UnitType.OGRE) {
      this.unitRenderer.queueDeferredEffect(strikeDelay + 50, () => {
        this._applyKnockback(defender, attacker);
        // Swipe splash within 2 hex of attacker
        const splash = allAlive
          .filter(u => u.id !== defId && u.owner !== attacker.owner && u.state !== UnitState.DEAD && !this._deadUnits.has(u.id))
          .filter(u => hexDist(u.position, attacker.position) <= 2);
        for (const v of splash) {
          const swipeDmg = Math.max(1, Math.floor(attacker.stats.attack * 0.7));
          v.currentHealth = Math.max(0, v.currentHealth - swipeDmg);
          this.unitRenderer.flashUnit(v.id, 0.15);
          this.unitRenderer.showDamageEffect(v.worldPosition);
          this.unitRenderer.updateHealthBar(v);
          this._applyKnockback(v, attacker);
          if (v.currentHealth <= 0) {
            v.state = UnitState.DEAD;
            this._deadUnits.add(v.id);
            setTimeout(() => this.unitRenderer.removeUnit(v.id), 800);
          }
        }
      });
    }

    // ── Shieldbearer shield bash knockback ──
    if (attacker.type === UnitType.SHIELDBEARER) {
      this.unitRenderer.queueDeferredEffect(strikeDelay + 50, () => {
        this._applyKnockback(defender, attacker);
      });
    }
  }

  // ── Knockback helper: push unit 1 hex away from attacker ──
  private _applyKnockback(unit: Unit, attacker: Unit): void {
    const dx = unit.worldPosition.x - attacker.worldPosition.x;
    const dz = unit.worldPosition.z - attacker.worldPosition.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const knockX = unit.worldPosition.x + (dx / len) * 1.5;
    const knockZ = unit.worldPosition.z + (dz / len) * 1.5;
    const knockY = unit.worldPosition.y;
    this.unitRenderer.knockbackUnit(unit.id, { x: knockX, y: knockY, z: knockZ });
    // Update unit world pos to match knockback destination
    unit.worldPosition.x = knockX;
    unit.worldPosition.z = knockZ;
    // Approximate hex position from world pos
    unit.position = { q: Math.round(knockX / 1.5), r: Math.round(knockZ / 1.5) };
  }

  // ── Find nearest melee enemy threatening a ranged unit ──
  private _findNearestMeleeThreat(unit: Unit, allAlive: Unit[], kiteRange: number): Unit | null {
    let best: Unit | null = null;
    let bestDist = Infinity;
    for (const other of allAlive) {
      if (other.owner === unit.owner) continue;
      if (other.state === UnitState.DEAD || this._deadUnits.has(other.id)) continue;
      if (other.stats.range > 1) continue; // Only melee threats
      const d = hexDist(unit.position, other.position);
      if (d <= kiteRange && d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  // ── Find safe tile to kite toward (away from threat, at weapon range) ──
  private _findKiteTile(unit: Unit, threat: Unit): HexCoord | null {
    const ux = unit.position.q, ur = unit.position.r;
    const tx = threat.position.q, tr = threat.position.r;
    const awayDirQ = ux - tx;
    const awayDirR = ur - tr;
    const len = Math.sqrt(awayDirQ * awayDirQ + awayDirR * awayDirR) || 1;

    let bestTile: HexCoord | null = null;
    let bestScore = -Infinity;

    // Check tiles within movement range
    const moveRange = 3;
    for (let dq = -moveRange; dq <= moveRange; dq++) {
      for (let dr = -moveRange; dr <= moveRange; dr++) {
        const nq = ux + dq;
        const nr = ur + dr;
        const candidate = { q: nq, r: nr };

        // Must be on the arena map
        if (!this._arenaMap.tiles.has(`${nq},${nr}`)) continue;

        const distToUs = hexDist(unit.position, candidate);
        if (distToUs > moveRange) continue;

        const distToThreat = hexDist(candidate, threat.position);

        // Score: prefer landing at weapon range, moving away from threat
        const awayDot = (dq * awayDirQ + dr * awayDirR) / (len * Math.max(1, distToUs));
        const rangeFit = 1 - Math.abs(distToThreat - unit.stats.range) * 0.5;

        const score = awayDot * 2 + rangeFit * 3 - distToUs * 0.5;

        if (score > bestScore) {
          bestScore = score;
          bestTile = candidate;
        }
      }
    }
    return bestTile;
  }

  // ══════════════════════════════════════════════════════
  // RENDERING (position sync + animation)
  // ══════════════════════════════════════════════════════

  private _updateRendering(delta: number): void {
    const time = this._gameTime;

    for (const unit of this._units) {
      if (unit.state === UnitState.DEAD && this._deadUnits.has(unit.id)) continue;

      // Sync renderer position
      this.unitRenderer.setWorldPosition(unit.id, unit.worldPosition.x, unit.worldPosition.y, unit.worldPosition.z);

      // Animate based on state
      const animState = unit.state === UnitState.ATTACKING ? 'attacking'
        : unit.state === UnitState.MOVING ? 'moving'
        : 'idle';
      this.unitRenderer.animateUnit(unit.id, animState, time, unit.type);

      // Face target while attacking
      if (unit.state === UnitState.ATTACKING) {
        const targetId = (unit as any)._targetUnitId as string | undefined;
        const target = targetId ? this._units.find(u => u.id === targetId) : null;
        if (target && target.state !== UnitState.DEAD) {
          this.unitRenderer.faceTarget(unit.id, target.worldPosition);
          this.unitRenderer.applyCombatStrafe(unit.id, target.worldPosition, time);
        }
      }

      // Face movement direction while moving
      if (unit.state === UnitState.MOVING) {
        const path = (unit as any)._path as HexCoord[] | undefined;
        if (path && path.length > 0) {
          const nextW = hexToWorld(path[0], 0);
          this.unitRenderer.faceTarget(unit.id, { x: nextW.x, y: nextW.y, z: nextW.z });
        }
      }
    }

    // Update VFX
    this.unitRenderer.updateSwingTrails(time);
    this.unitRenderer.updateProjectiles(delta);
    this.unitRenderer.updateDeferredEffects();
  }

  // ══════════════════════════════════════════════════════
  // RESPAWN CHECK
  // ══════════════════════════════════════════════════════

  private _checkRespawn(delta: number): void {
    const aliveByTeam = [0, 0];
    for (const u of this._units) {
      if (u.state !== UnitState.DEAD && !this._deadUnits.has(u.id)) {
        aliveByTeam[u.owner]++;
      }
    }

    if (aliveByTeam[0] <= RESPAWN_THRESHOLD || aliveByTeam[1] <= RESPAWN_THRESHOLD) {
      this._respawnTimer += delta;
      if (this._respawnTimer >= RESPAWN_DELAY) {
        this._respawnTimer = 0;
        this._clearDeadAndRespawn();
      }
    } else {
      this._respawnTimer = 0;
    }
  }

  // ══════════════════════════════════════════════════════
  // CINEMATIC CAMERA
  // ══════════════════════════════════════════════════════

  private _setupKeyframes(): void {
    this._keyframes = [
      { distance: 24, phi: Math.PI / 3.2, theta: 0, duration: 8 },
      { distance: 14, phi: Math.PI / 4, theta: Math.PI / 3, duration: 6 },
      { distance: 11, phi: Math.PI / 3, theta: Math.PI * 0.8, duration: 5 },
      { distance: 30, phi: Math.PI / 2.5, theta: Math.PI * 1.3, duration: 7 },
      { distance: 16, phi: Math.PI / 3.5, theta: Math.PI * 1.7, duration: 6 },
      { distance: 22, phi: Math.PI / 3, theta: Math.PI * 2, duration: 8 },
    ];
    const kf = this._keyframes[0];
    this._camDistance = kf.distance;
    this._camPhi = kf.phi;
    this._camTheta = kf.theta;
    this._kfIndex = 0;
    this._kfTime = 0;
    this._saveKfFrom();
  }

  private _saveKfFrom(): void {
    this._kfFrom.distance = this._camDistance;
    this._kfFrom.phi = this._camPhi;
    this._kfFrom.theta = this._camTheta;
  }

  private _updateCamera(delta: number): void {
    // Smoothly track the center of the battle
    const alive = this._units.filter(u => u.state !== UnitState.DEAD && !this._deadUnits.has(u.id));
    if (alive.length > 0) {
      let cx = 0, cy = 0, cz = 0;
      for (const u of alive) {
        cx += u.worldPosition.x;
        cy += u.worldPosition.y;
        cz += u.worldPosition.z;
      }
      cx /= alive.length;
      cy /= alive.length;
      cz /= alive.length;
      this._camTarget.lerp(new THREE.Vector3(cx, cy + 0.5, cz), 0.02);
    }

    // Keyframe interpolation
    this._kfTime += delta;
    const kf = this._keyframes[this._kfIndex];
    let t = Math.min(this._kfTime / kf.duration, 1);
    t = t * t * (3 - 2 * t); // smoothstep

    this._camDistance = this._kfFrom.distance + (kf.distance - this._kfFrom.distance) * t;
    this._camPhi = this._kfFrom.phi + (kf.phi - this._kfFrom.phi) * t;
    this._camTheta = this._kfFrom.theta + (kf.theta - this._kfFrom.theta) * t;

    if (this._kfTime >= kf.duration) {
      this._saveKfFrom();
      this._kfTime = 0;
      this._kfIndex = (this._kfIndex + 1) % this._keyframes.length;
    }

    // Apply spherical coords
    const x = this._camTarget.x + this._camDistance * Math.sin(this._camPhi) * Math.cos(this._camTheta);
    const y = this._camTarget.y + this._camDistance * Math.cos(this._camPhi);
    const z = this._camTarget.z + this._camDistance * Math.sin(this._camPhi) * Math.sin(this._camTheta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this._camTarget);
  }

  // ══════════════════════════════════════════════════════
  // SCENE SETUP (sky, lights, terrain, particles)
  // ══════════════════════════════════════════════════════

  private _createSkyGradient(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.2, '#0a0a1e');
    grad.addColorStop(0.45, '#101830');
    grad.addColorStop(0.65, '#1a2540');
    grad.addColorStop(0.80, '#253050');
    grad.addColorStop(0.92, '#3a3048');
    grad.addColorStop(1, '#4a3040');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  private _setupLighting(): void {
    this.scene.add(new THREE.AmbientLight(0xfff5e6, 0.5));

    const sun = new THREE.DirectionalLight(0xffeedd, 2.5);
    sun.position.set(15, 40, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    ([-20, 20, 20, -20] as const).forEach((v, i) => {
      const cam = sun.shadow.camera;
      [cam.left, cam.right, cam.top, cam.bottom][i] = v;
    });
    this.scene.add(sun);

    this.scene.add(new THREE.DirectionalLight(0x8ec8f0, 0.4).translateX(-10).translateY(15).translateZ(10));
    this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d6b2f, 0.35));

    const rim = new THREE.DirectionalLight(0xffc880, 0.3);
    rim.position.set(-5, 10, -15);
    this.scene.add(rim);

    // Sun visual
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfffae0 }),
    );
    sunMesh.position.copy(sun.position);
    this.scene.add(sunMesh);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(5, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfffae0, transparent: true, opacity: 0.1 }),
    );
    glow.position.copy(sun.position);
    this.scene.add(glow);
  }

  private _buildParticles(): void {
    const COUNT = 150;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 20 + 1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffcc, size: 0.15, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.scene.add(this._particles);
  }

  private _updateParticles(delta: number): void {
    if (!this._particles) return;
    this._particleTime += delta;
    const arr = (this._particles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += Math.sin(this._particleTime * 0.3 + i) * 0.003;
      arr[i + 1] += Math.sin(this._particleTime * 0.5 + i * 0.7) * 0.002;
      arr[i + 2] += Math.cos(this._particleTime * 0.4 + i * 0.3) * 0.003;
    }
    (this._particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
