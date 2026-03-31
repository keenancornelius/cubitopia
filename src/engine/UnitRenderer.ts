// ============================================
// CUBITOPIA - Unit Renderer
// Renders units as small voxel figures on the map
// ============================================

import * as THREE from 'three';
import { Unit, UnitType, HexCoord } from '../types';
import { UNIT_COLORS } from '../game/entities/UnitFactory';

interface UnitMeshGroup {
  group: THREE.Group;
  unitId: string;
  unitType: UnitType;
  healthBar: THREE.Sprite;
  healthBarCanvas: HTMLCanvasElement;
  healthBarCtx: CanvasRenderingContext2D;
  healthBarTexture: THREE.CanvasTexture;
  lastHealthRatio: number;
  label: THREE.Sprite;
  facingAngle: number; // Y-axis rotation angle for movement direction
  lastPosition: THREE.Vector3; // Track previous position for rotation calculations
  // Trebuchet/catapult single-shot fire animation
  trebFireStart: number;            // timestamp when fire was triggered (0 = idle)
  trebPendingTarget: { x: number; y: number; z: number } | null; // queued boulder target
  trebOnImpact?: () => void; // callback when boulder lands
  // Attack animation hold — prevents jerky snapping between attack/idle
  attackAnimStart: number; // time when attack animation began (0 = not attacking)
}

// Player team colors for the base/flag
const PLAYER_COLORS = [
  0x3498db, // blue
  0xe74c3c, // red
  0x2ecc71, // green
  0xf1c40f, // yellow
];

export class UnitRenderer {
  private scene: THREE.Scene;
  private unitMeshes: Map<string, UnitMeshGroup> = new Map();
  private projectiles: Array<{
    mesh: THREE.Object3D;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTime: number;
    duration: number;
    arcHeight?: number;
    targetUnitId?: string; // track live target position
    onImpact?: () => void;  // callback when projectile lands
  }> = [];
  // Deferred visual effects queue (for syncing damage visuals to animation/projectile hits)
  private deferredEffects: Array<{ executeAt: number; callback: () => void }> = [];
  // Aggro indicator visuals
  private aggroLines: Map<string, THREE.Line> = new Map(); // unitId → line to target
  private aggroRings: Map<string, THREE.Mesh> = new Map(); // targetId → pulsing ring
  // Swing streak VFX trails
  private swingTrails: Array<{
    mesh: THREE.Mesh;
    startTime: number;
    duration: number;
  }> = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Convert hex coordinate to world position
   */
  hexToWorld(coord: HexCoord, elevation: number): THREE.Vector3 {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    return new THREE.Vector3(x, elevation + 0.25, z);
  }

  /**
   * Add or update a unit on the map
   */
  addUnit(unit: Unit, elevation: number): void {
    // Remove old mesh if exists
    this.removeUnit(unit.id);

    const group = new THREE.Group();
    const pos = this.hexToWorld(unit.position, elevation);
    group.position.copy(pos);

    const playerColor = PLAYER_COLORS[unit.owner % PLAYER_COLORS.length];

    // Build unit model based on type
    UnitRenderer.buildUnitModel(group, unit.type, playerColor);

    // Text label above head (higher for siege units)
    const isSiege = unit.type === UnitType.TREBUCHET || unit.type === UnitType.CATAPULT;
    const label = this.createLabel(unit.type);
    label.position.y = isSiege ? 2.5 : 1.4;
    group.add(label);

    // Health bar — canvas-based sprite (always faces camera, no rotation artifacts)
    const hbCanvas = document.createElement('canvas');
    hbCanvas.width = 64;
    hbCanvas.height = 8;
    const hbCtx = hbCanvas.getContext('2d')!;
    const hbTexture = new THREE.CanvasTexture(hbCanvas);
    hbTexture.minFilter = THREE.NearestFilter;
    hbTexture.magFilter = THREE.NearestFilter;
    const hbMaterial = new THREE.SpriteMaterial({ map: hbTexture, depthTest: false });
    const healthBar = new THREE.Sprite(hbMaterial);
    const hbScale = isSiege ? 1.1 : 0.7;
    healthBar.scale.set(hbScale, hbScale * (8 / 64), 1);
    healthBar.position.y = isSiege ? 2.35 : 1.25;
    healthBar.renderOrder = 999;
    group.add(healthBar);

    const healthRatio = unit.currentHealth / unit.stats.maxHealth;
    UnitRenderer.drawHealthBar(hbCtx, healthRatio);
    hbTexture.needsUpdate = true;

    // Store reference and add to scene
    this.unitMeshes.set(unit.id, {
      group,
      unitId: unit.id,
      unitType: unit.type,
      healthBar,
      healthBarCanvas: hbCanvas,
      healthBarCtx: hbCtx,
      healthBarTexture: hbTexture,
      lastHealthRatio: healthRatio,
      label,
      facingAngle: 0,
      lastPosition: pos.clone(),
      trebFireStart: 0,
      trebPendingTarget: null,
      attackAnimStart: 0,
    });
    this.scene.add(group);
  }

  static buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number): void {
    // Helper: create an arm group with a mesh inside, so weapons can be children of the arm
    const makeArmGroup = (name: string, color: number, posX: number, posY: number): THREE.Group => {
      const armGroup = new THREE.Group();
      armGroup.name = name;
      armGroup.position.set(posX, posY, 0);
      const armGeo = new THREE.BoxGeometry(0.1, 0.3, 0.1);
      const armMat = new THREE.MeshLambertMaterial({ color });
      const armMesh = new THREE.Mesh(armGeo, armMat);
      // Mesh is centered at 0,0,0 inside the group (pivot at shoulder)
      armGroup.add(armMesh);
      return armGroup;
    };

    // Helper: create a leg group
    const makeLegGroup = (name: string, color: number, posX: number, posY: number): THREE.Group => {
      const legGroup = new THREE.Group();
      legGroup.name = name;
      legGroup.position.set(posX, posY, 0);
      const legGeo = new THREE.BoxGeometry(0.12, 0.3, 0.12);
      const legMat = new THREE.MeshLambertMaterial({ color });
      const legMesh = new THREE.Mesh(legGeo, legMat);
      legGroup.add(legMesh);
      return legGroup;
    };

    switch (type) {
      case UnitType.WARRIOR: {
        // === ARMORED KNIGHT ===
        // Armored body (wider, silver/steel)
        const armorGeo = new THREE.BoxGeometry(0.55, 0.65, 0.5);
        const armorMat = new THREE.MeshLambertMaterial({ color: 0xb0b0b0 });
        const armor = new THREE.Mesh(armorGeo, armorMat);
        armor.position.y = 0.33;
        armor.castShadow = true;
        group.add(armor);

        // Chest plate accent (darker steel)
        const chestGeo = new THREE.BoxGeometry(0.35, 0.3, 0.52);
        const chestMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const chest = new THREE.Mesh(chestGeo, chestMat);
        chest.position.y = 0.35;
        group.add(chest);

        // Belt accent (team color)
        const beltGeo = new THREE.BoxGeometry(0.57, 0.08, 0.52);
        const beltMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const belt = new THREE.Mesh(beltGeo, beltMat);
        belt.position.y = 0.08;
        group.add(belt);

        // Helmet (covers head — no skin visible)
        const helmetGeo = new THREE.BoxGeometry(0.4, 0.38, 0.4);
        const helmetMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
        const helmet = new THREE.Mesh(helmetGeo, helmetMat);
        helmet.position.y = 0.85;
        helmet.castShadow = true;
        group.add(helmet);

        // Helmet visor slit (dark)
        const visorGeo = new THREE.BoxGeometry(0.3, 0.06, 0.42);
        const visorMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.y = 0.83;
        group.add(visor);

        // Helmet plume/crest (team color)
        const plumeGeo = new THREE.BoxGeometry(0.08, 0.2, 0.3);
        const plumeMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const plume = new THREE.Mesh(plumeGeo, plumeMat);
        plume.position.y = 1.05;
        group.add(plume);

        // Shoulder pauldrons (team colored trim)
        for (const side of [-0.35, 0.35]) {
          const paulGeo = new THREE.BoxGeometry(0.2, 0.18, 0.25);
          const paulMat = new THREE.MeshLambertMaterial({ color: playerColor });
          const paul = new THREE.Mesh(paulGeo, paulMat);
          paul.position.set(side, 0.6, 0);
          group.add(paul);
        }

        // Right arm with oversized broadsword
        const armRight = makeArmGroup('arm-right', 0xb0b0b0, 0.3, 0.35);
        // Broad blade — wide, thick, imposing
        const bladeMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.85), bladeMat);
        blade.position.set(0, -0.15, 0.45);
        armRight.add(blade);
        // Fuller groove (dark line down center of blade)
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.6), new THREE.MeshLambertMaterial({ color: 0x999999 }));
        fuller.position.set(0, -0.15, 0.4);
        armRight.add(fuller);
        // Wide crossguard
        const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        crossguard.position.set(0, -0.15, 0.04);
        armRight.add(crossguard);
        // Leather grip
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        grip.position.set(0, -0.15, -0.04);
        armRight.add(grip);
        // Pommel
        const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        pommel.position.set(0, -0.15, -0.1);
        armRight.add(pommel);
        group.add(armRight);

        // Left arm with buckler shield
        const armLeft = makeArmGroup('arm-left', 0xb0b0b0, -0.3, 0.35);
        const buckler = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: playerColor }));
        buckler.position.set(-0.08, -0.08, 0.1);
        armLeft.add(buckler);
        const bucklerBoss = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        bucklerBoss.position.set(-0.1, -0.08, 0.1);
        armLeft.add(bucklerBoss);
        // Buckler rim
        const bucklerRim = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.04), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        bucklerRim.position.set(-0.08, -0.08, 0.25);
        armLeft.add(bucklerRim);
        group.add(armLeft);

        // Legs (darker armor color)
        group.add(makeLegGroup('leg-left', 0x808080, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x808080, 0.12, 0));
        break;
      }
      case UnitType.ARCHER: {
        // Green-tinted leather body
        const bodyGeo = new THREE.BoxGeometry(0.45, 0.55, 0.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x567d46 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.28;
        body.castShadow = true;
        group.add(body);

        // Team color sash across chest
        const sashGeo = new THREE.BoxGeometry(0.47, 0.06, 0.42);
        const sashMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const sash = new THREE.Mesh(sashGeo, sashMat);
        sash.position.y = 0.42;
        group.add(sash);

        // Head with hood
        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.78;
        group.add(head);

        const hoodGeo = new THREE.BoxGeometry(0.38, 0.2, 0.38);
        const hoodMat = new THREE.MeshLambertMaterial({ color: 0x3d5c2e });
        const hood = new THREE.Mesh(hoodGeo, hoodMat);
        hood.position.y = 0.92;
        group.add(hood);

        // Hood trim (team color)
        const hoodTrimGeo = new THREE.BoxGeometry(0.39, 0.04, 0.39);
        const hoodTrimMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const hoodTrim = new THREE.Mesh(hoodTrimGeo, hoodTrimMat);
        hoodTrim.position.y = 0.83;
        group.add(hoodTrim);

        // Quiver on back
        const quiverGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
        const quiverMat = new THREE.MeshLambertMaterial({ color: 0x654321 });
        const quiver = new THREE.Mesh(quiverGeo, quiverMat);
        quiver.position.set(-0.15, 0.5, -0.25);
        group.add(quiver);

        // Left arm (holds bow — bow faces forward)
        const archerArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.35);
        const bowGeo = new THREE.TorusGeometry(0.22, 0.03, 4, 8, Math.PI);
        const bowMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const bow = new THREE.Mesh(bowGeo, bowMat);
        bow.position.set(0, -0.1, 0.15); // at hand, facing forward
        bow.rotation.x = Math.PI / 2; // rotate so bow plane faces forward
        archerArmLeft.add(bow);
        group.add(archerArmLeft);

        // Right arm (draws string)
        const archerArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.35);
        group.add(archerArmRight);

        // Legs
        group.add(makeLegGroup('leg-left', 0x567d46, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x567d46, 0.12, 0));
        break;
      }
      case UnitType.RIDER: {
        // Horse body
        const horseGeo = new THREE.BoxGeometry(0.4, 0.35, 0.75);
        const horseMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const horse = new THREE.Mesh(horseGeo, horseMat);
        horse.position.set(0, 0.08, 0);
        group.add(horse);

        // Horse saddle blanket (team color)
        const saddleGeo = new THREE.BoxGeometry(0.42, 0.04, 0.35);
        const saddleMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const saddle = new THREE.Mesh(saddleGeo, saddleMat);
        saddle.position.set(0, 0.28, 0);
        group.add(saddle);

        // Rider body (smaller, sits on horse)
        const riderGeo = new THREE.BoxGeometry(0.35, 0.4, 0.35);
        const riderMat = new THREE.MeshLambertMaterial({ color: 0xb0b0b0 });
        const rider = new THREE.Mesh(riderGeo, riderMat);
        rider.position.y = 0.48;
        rider.castShadow = true;
        group.add(rider);

        // Rider head
        const headGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.85;
        group.add(head);

        // Rider helmet crest (team color)
        const riderCrestGeo = new THREE.BoxGeometry(0.06, 0.12, 0.2);
        const riderCrestMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const riderCrest = new THREE.Mesh(riderCrestGeo, riderCrestMat);
        riderCrest.position.y = 1.0;
        group.add(riderCrest);

        // Right arm with oversized jousting lance
        const riderArmRight = makeArmGroup('arm-right', 0xb0b0b0, 0.25, 0.55);
        // Thick lance shaft
        const lanceShaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.2), new THREE.MeshLambertMaterial({ color: 0xbdc3c7 }));
        lanceShaft.position.set(0, -0.1, 0.55);
        riderArmRight.add(lanceShaft);
        // Lance tip — sharp steel point
        const lanceTip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
        lanceTip.position.set(0, -0.1, 1.2);
        riderArmRight.add(lanceTip);
        // Vamplate (hand guard disc)
        const vamplate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), new THREE.MeshLambertMaterial({ color: playerColor }));
        vamplate.position.set(0, -0.1, 0.1);
        riderArmRight.add(vamplate);
        // Team pennant near tip
        const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: playerColor }));
        pennant.position.set(0.08, -0.1, 1.0);
        riderArmRight.add(pennant);
        group.add(riderArmRight);

        // Left arm with kite shield
        const riderArmLeft = makeArmGroup('arm-left', 0xb0b0b0, -0.25, 0.55);
        const kiteShield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.25), new THREE.MeshLambertMaterial({ color: playerColor }));
        kiteShield.position.set(-0.06, -0.1, 0.08);
        riderArmLeft.add(kiteShield);
        const kiteBoss = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
        kiteBoss.position.set(-0.08, -0.1, 0.08);
        riderArmLeft.add(kiteBoss);
        group.add(riderArmLeft);

        // Horse legs (4 legs)
        const horseLegGeo = new THREE.BoxGeometry(0.08, 0.25, 0.08);
        const horseLegMat = new THREE.MeshLambertMaterial({ color: 0x654321 });
        const positions = [
          { x: -0.15, z: -0.25, name: 'leg-left' },
          { x: 0.15, z: -0.25, name: 'leg-right' },
          { x: -0.15, z: 0.25, name: 'leg-back-left' },
          { x: 0.15, z: 0.25, name: 'leg-back-right' },
        ];
        for (const pos of positions) {
          const legGroup = new THREE.Group();
          legGroup.name = pos.name;
          legGroup.position.set(pos.x, -0.05, pos.z);
          const leg = new THREE.Mesh(horseLegGeo, horseLegMat);
          legGroup.add(leg);
          group.add(legGroup);
        }
        break;
      }
      case UnitType.PALADIN: {
        // Heavy armor body
        const bodyGeo = new THREE.BoxGeometry(0.55, 0.6, 0.5);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x7f8c8d });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        body.castShadow = true;
        group.add(body);

        // Team color chest emblem
        const emblemGeo = new THREE.BoxGeometry(0.2, 0.2, 0.52);
        const emblemMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const emblem = new THREE.Mesh(emblemGeo, emblemMat);
        emblem.position.y = 0.4;
        group.add(emblem);

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.8;
        group.add(head);

        // Left arm with oversized tower shield (front-facing, covers body)
        const defArmLeft = makeArmGroup('arm-left', 0x7f8c8d, -0.3, 0.35);
        // Tower shield — tall, wide, imposing
        const tShield = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.1), new THREE.MeshLambertMaterial({ color: playerColor }));
        tShield.position.set(0.15, -0.1, 0.2); // centered in front of body
        defArmLeft.add(tShield);
        // Shield steel rim
        const tRimTop = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        tRimTop.position.set(0.15, 0.27, 0.2);
        defArmLeft.add(tRimTop);
        const tRimBot = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        tRimBot.position.set(0.15, -0.47, 0.2);
        defArmLeft.add(tRimBot);
        // Large golden boss
        const tBoss = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.14), new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
        tBoss.position.set(0.15, -0.1, 0.27);
        defArmLeft.add(tBoss);
        // Cross emblem on shield
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.11), new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
        crossV.position.set(0.15, -0.1, 0.21);
        defArmLeft.add(crossV);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.11), new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
        crossH.position.set(0.15, -0.05, 0.21);
        defArmLeft.add(crossH);
        group.add(defArmLeft);

        // Right arm with flanged mace
        const defArmRight = makeArmGroup('arm-right', 0x7f8c8d, 0.3, 0.35);
        // Mace handle
        const maceHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        maceHandle.position.set(0, -0.15, 0.25);
        defArmRight.add(maceHandle);
        // Mace head — oversized flanged ball
        const maceHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        maceHead.position.set(0, -0.15, 0.52);
        defArmRight.add(maceHead);
        // Flanges (4 protruding ridges)
        const flangeMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
        for (const [fx, fy] of [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]] as [number, number][]) {
          const flange = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), flangeMat);
          flange.position.set(fx, -0.15 + fy, 0.52);
          defArmRight.add(flange);
        }
        group.add(defArmRight);

        // Legs
        group.add(makeLegGroup('leg-left', 0x7f8c8d, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x7f8c8d, 0.12, 0));
        break;
      }
      case UnitType.BUILDER: {
        // Brown work clothes
        const bodyGeo = new THREE.BoxGeometry(0.45, 0.55, 0.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd4a574 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.28;
        body.castShadow = true;
        group.add(body);

        // Tool belt (team color)
        const bldBeltGeo = new THREE.BoxGeometry(0.47, 0.06, 0.42);
        const bldBeltMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const bldBelt = new THREE.Mesh(bldBeltGeo, bldBeltMat);
        bldBelt.position.y = 0.08;
        group.add(bldBelt);

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.78;
        group.add(head);

        // Hard hat (team color)
        const hatGeo = new THREE.BoxGeometry(0.38, 0.1, 0.38);
        const hatMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const hat = new THREE.Mesh(hatGeo, hatMat);
        hat.position.y = 0.97;
        group.add(hat);

        // Right arm with hammer (pointing forward from hand)
        const bldArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.35);
        const handleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.4);
        const handleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.15, 0.2); // hand end, extending forward
        bldArmRight.add(handle);
        const hammerGeo = new THREE.BoxGeometry(0.15, 0.12, 0.12);
        const hammerMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
        const hammer = new THREE.Mesh(hammerGeo, hammerMat);
        hammer.position.set(0, -0.15, 0.42); // head at end of handle
        bldArmRight.add(hammer);
        group.add(bldArmRight);

        // Left arm
        const bldArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.35);
        group.add(bldArmLeft);

        // Legs
        group.add(makeLegGroup('leg-left', 0xd4a574, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0xd4a574, 0.12, 0));
        break;
      }
      case UnitType.LUMBERJACK: {
        // Green work clothes
        const bodyGeo = new THREE.BoxGeometry(0.45, 0.55, 0.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6b8e23 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.28;
        body.castShadow = true;
        group.add(body);

        // Suspenders (team color)
        for (const sx of [-0.1, 0.1]) {
          const suspGeo = new THREE.BoxGeometry(0.06, 0.5, 0.42);
          const suspMat = new THREE.MeshLambertMaterial({ color: playerColor });
          const susp = new THREE.Mesh(suspGeo, suspMat);
          susp.position.set(sx, 0.3, 0);
          group.add(susp);
        }

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.78;
        group.add(head);

        // Bandana (team color)
        const bandanaGeo = new THREE.BoxGeometry(0.37, 0.08, 0.37);
        const bandanaMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const bandana = new THREE.Mesh(bandanaGeo, bandanaMat);
        bandana.position.y = 0.9;
        group.add(bandana);

        // Right arm with axe (pointing forward from hand)
        const lumArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.35);
        const axeHandleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
        const axeHandleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const axeHandle = new THREE.Mesh(axeHandleGeo, axeHandleMat);
        axeHandle.position.set(0, -0.15, 0.25); // hand end, extending forward
        lumArmRight.add(axeHandle);
        const axeHeadGeo = new THREE.BoxGeometry(0.2, 0.15, 0.06);
        const axeHeadMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const axeHead = new THREE.Mesh(axeHeadGeo, axeHeadMat);
        axeHead.position.set(0, -0.15, 0.5); // blade at end of handle
        lumArmRight.add(axeHead);
        group.add(lumArmRight);

        // Left arm
        const lumArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.35);
        group.add(lumArmLeft);

        // Legs
        group.add(makeLegGroup('leg-left', 0x556b2f, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x556b2f, 0.12, 0));
        break;
      }
      case UnitType.VILLAGER: {
        // Goldenrod work clothes
        const bodyGeo = new THREE.BoxGeometry(0.45, 0.55, 0.4);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0xdaa520 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.28;
        body.castShadow = true;
        group.add(body);

        // Apron/sash (team color)
        const apronGeo = new THREE.BoxGeometry(0.3, 0.4, 0.42);
        const apronMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const apron = new THREE.Mesh(apronGeo, apronMat);
        apron.position.y = 0.2;
        group.add(apron);

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.78;
        group.add(head);

        // Straw hat with team color ribbon
        const hatBrimGeo = new THREE.BoxGeometry(0.45, 0.04, 0.45);
        const hatBrimMat = new THREE.MeshLambertMaterial({ color: 0xf5deb3 });
        const hatBrim = new THREE.Mesh(hatBrimGeo, hatBrimMat);
        hatBrim.position.y = 0.93;
        group.add(hatBrim);
        const hatTopGeo = new THREE.BoxGeometry(0.3, 0.12, 0.3);
        const hatTopMat = new THREE.MeshLambertMaterial({ color: 0xf5deb3 });
        const hatTop = new THREE.Mesh(hatTopGeo, hatTopMat);
        hatTop.position.y = 1.01;
        group.add(hatTop);
        const ribbonGeo = new THREE.BoxGeometry(0.32, 0.04, 0.32);
        const ribbonMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
        ribbon.position.y = 0.96;
        group.add(ribbon);

        // Right arm with scythe (pointing forward from hand)
        const vilArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.35);
        const scytheHandleGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
        const scytheHandleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const scytheHandle = new THREE.Mesh(scytheHandleGeo, scytheHandleMat);
        scytheHandle.position.set(0, -0.15, 0.3); // hand end, extending forward
        vilArmRight.add(scytheHandle);
        const bladeGeo = new THREE.BoxGeometry(0.28, 0.04, 0.08);
        const bladeMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(0.12, -0.15, 0.6); // curved blade at tip
        blade.rotation.y = 0.3; // angled outward like a scythe
        vilArmRight.add(blade);
        group.add(vilArmRight);

        // Left arm
        const vilArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.35);
        group.add(vilArmLeft);

        // Legs
        group.add(makeLegGroup('leg-left', 0xdaa520, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0xdaa520, 0.12, 0));
        break;
      }
      case UnitType.TREBUCHET: {
        // === TREBUCHET SIEGE ENGINE with OPERATOR ===
        // Forward = +Z (matches atan2 facing). Operator pushes from -Z (rear).
        // Built at 1.6x scale so the operator is human-sized relative to other units.
        const trebGroup = new THREE.Group();
        trebGroup.name = 'trebuchet-body';
        trebGroup.scale.set(1.6, 1.6, 1.6);
        // Shift down slightly so wheels sit on the ground at scaled size
        trebGroup.position.y = -0.1;

        const WD = 0x5d4037; // dark wood
        const WM = 0x6d4c2a; // medium wood
        const WL = 0x8B6914; // light wood (arm)
        const IR = 0x555555; // iron
        const RP = 0xc4a56a; // rope
        const SK = 0xffdbac; // skin

        // All parts go into trebGroup (which is scaled 1.6x)
        const tg = trebGroup; // short alias

        // ── CART BASE ── (thick plank, long along Z)
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.14, 1.2),
          new THREE.MeshLambertMaterial({ color: WM })
        );
        base.position.y = 0.28;
        base.castShadow = true;
        tg.add(base);

        // ── 4 WHEELS ── solid wooden discs with cross spokes
        const wheelData: [number, number, string][] = [
          [-0.5, 0.38, 'wheel-fl'], [0.5, 0.38, 'wheel-fr'],
          [-0.5, -0.38, 'wheel-bl'], [0.5, -0.38, 'wheel-br'],
        ];
        for (const [wx, wz, wn] of wheelData) {
          const wg = new THREE.Group();
          wg.name = wn;
          wg.position.set(wx, 0.18, wz);
          // Wheel disc (thin on X, round face in YZ)
          wg.add(new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.34, 0.34),
            new THREE.MeshLambertMaterial({ color: 0x3e2723 })
          ));
          // Cross spokes
          wg.add((() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.06), new THREE.MeshLambertMaterial({ color: WD })); return m; })());
          wg.add((() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.3), new THREE.MeshLambertMaterial({ color: WD })); return m; })());
          // Iron hub
          wg.add(new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.1, 0.1),
            new THREE.MeshLambertMaterial({ color: IR })
          ));
          tg.add(wg);
        }

        // ── AXLES ──
        for (const az of [0.38, -0.38]) {
          const axle = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.06, 0.06),
            new THREE.MeshLambertMaterial({ color: IR })
          );
          axle.position.set(0, 0.18, az);
          tg.add(axle);
        }

        // ── A-FRAME UPRIGHTS ──
        for (const sx of [-0.25, 0.25]) {
          const post = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.9, 0.14),
            new THREE.MeshLambertMaterial({ color: WD })
          );
          post.position.set(sx, 0.8, 0.1);
          post.rotation.z = sx > 0 ? -0.08 : 0.08;
          tg.add(post);
        }

        // Crossbeam at top
        const xbeam = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.1, 0.12),
          new THREE.MeshLambertMaterial({ color: WD })
        );
        xbeam.position.set(0, 1.25, 0.1);
        tg.add(xbeam);

        // ── THROWING ARM (pivots on X axis at crossbeam) ──
        // Real trebuchet: counterweight on SHORT arm (forward/+Z toward enemy),
        // sling on LONG arm (behind/-Z). At rest, sling hangs back; when fired,
        // counterweight drops and sling swings forward over the top.
        const armPivot = new THREE.Group();
        armPivot.name = 'throw-arm';
        armPivot.position.set(0, 1.25, 0.1);
        armPivot.rotation.x = 0.25;

        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 1.5),
          new THREE.MeshLambertMaterial({ color: WL })
        );
        beam.position.z = -0.15; // center slightly behind pivot (long arm = rear)
        armPivot.add(beam);

        // Counterweight on SHORT arm (forward, toward enemy +Z)
        const cw = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.3, 0.24),
          new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
        );
        cw.position.set(0, -0.18, 0.5);
        armPivot.add(cw);

        // Sling basket on LONG arm (behind, -Z rear)
        const sling = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.08, 0.2),
          new THREE.MeshLambertMaterial({ color: RP })
        );
        sling.position.set(0, -0.08, -0.88);
        armPivot.add(sling);

        // Boulder in sling (at rest, sitting behind the machine)
        armPivot.add((() => {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: 0x888888 }));
          b.position.set(0, 0.02, -0.88);
          return b;
        })());

        // Rope lashings at pivot
        armPivot.add((() => {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), new THREE.MeshLambertMaterial({ color: RP }));
          return r;
        })());

        tg.add(armPivot);

        // ── TEAM COLOR ──
        const banner = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.28, 0.2),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        banner.position.set(0.32, 1.0, 0.1);
        tg.add(banner);

        const shield = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.2, 0.2),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        shield.position.set(-0.47, 0.4, 0);
        tg.add(shield);

        // ── OPERATOR (behind machine at -Z) ──
        const opBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.4, 0.28),
          new THREE.MeshLambertMaterial({ color: 0x6b5b45 })
        );
        opBody.position.set(0, 0.46, -0.85);
        tg.add(opBody);

        const belt = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.06, 0.29),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        belt.position.set(0, 0.36, -0.85);
        tg.add(belt);

        const opHead = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.24, 0.24),
          new THREE.MeshLambertMaterial({ color: SK })
        );
        opHead.position.set(0, 0.78, -0.85);
        tg.add(opHead);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 0.1, 0.26),
          new THREE.MeshLambertMaterial({ color: 0x4a3728 })
        );
        cap.position.set(0, 0.92, -0.85);
        tg.add(cap);

        // Operator arms (reaching forward to push)
        const oArmR = makeArmGroup('arm-right', SK, 0.24, 0.54);
        oArmR.position.z = -0.85;
        oArmR.rotation.x = 0.8;
        tg.add(oArmR);
        const oArmL = makeArmGroup('arm-left', SK, -0.24, 0.54);
        oArmL.position.z = -0.85;
        oArmL.rotation.x = 0.8;
        tg.add(oArmL);

        // Operator legs
        const oLegL = makeLegGroup('leg-left', 0x5a4a3a, -0.1, 0.25);
        oLegL.position.z = -0.85;
        tg.add(oLegL);
        const oLegR = makeLegGroup('leg-right', 0x5a4a3a, 0.1, 0.25);
        oLegR.position.z = -0.85;
        tg.add(oLegR);

        group.add(trebGroup);
        break;
      }
      case UnitType.CATAPULT: {
        // === CATAPULT SIEGE ENGINE ===
        // Smaller siege weapon — wooden cart with torsion-powered arm

        // Wooden base cart
        const baseGeo = new THREE.BoxGeometry(0.9, 0.12, 0.7);
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x6d4c2a });
        const basePlatform = new THREE.Mesh(baseGeo, baseMat);
        basePlatform.position.y = 0.12;
        basePlatform.castShadow = true;
        group.add(basePlatform);

        // Wheels (4 smaller)
        const wheelGeo = new THREE.BoxGeometry(0.06, 0.22, 0.22);
        const wheelMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
        for (const [wx, wz] of [[0.48, 0.2], [0.48, -0.2], [-0.48, 0.2], [-0.48, -0.2]]) {
          const wheel = new THREE.Mesh(wheelGeo, wheelMat);
          wheel.position.set(wx, 0.11, wz);
          wheel.rotation.z = Math.PI / 4;
          group.add(wheel);
        }

        // Upright frame (shorter than trebuchet)
        const pillarGeo = new THREE.BoxGeometry(0.1, 0.6, 0.1);
        const pillarMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
        pillarL.position.set(0.1, 0.5, 0.2);
        group.add(pillarL);
        const pillarR = new THREE.Mesh(pillarGeo, pillarMat);
        pillarR.position.set(0.1, 0.5, -0.2);
        group.add(pillarR);

        // Torsion arm (shorter than trebuchet arm)
        const armGeo = new THREE.BoxGeometry(1.0, 0.08, 0.08);
        const armMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
        const throwArm = new THREE.Mesh(armGeo, armMat);
        throwArm.position.set(0.1, 0.8, 0);
        throwArm.rotation.z = -0.4;
        throwArm.name = 'throw-arm';
        group.add(throwArm);

        // Bucket/cup at end
        const bucketGeo = new THREE.BoxGeometry(0.2, 0.1, 0.2);
        const bucketMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const bucket = new THREE.Mesh(bucketGeo, bucketMat);
        bucket.position.set(0.55, 0.95, 0);
        group.add(bucket);

        // Torsion rope bundle
        const torsionGeo = new THREE.BoxGeometry(0.14, 0.14, 0.45);
        const torsionMat = new THREE.MeshLambertMaterial({ color: 0xc4a56a });
        const torsion = new THREE.Mesh(torsionGeo, torsionMat);
        torsion.position.set(0.1, 0.35, 0);
        group.add(torsion);

        // Team color flag
        const bannerGeo = new THREE.BoxGeometry(0.02, 0.2, 0.15);
        const bannerMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const banner = new THREE.Mesh(bannerGeo, bannerMat);
        banner.position.set(-0.3, 0.35, 0.25);
        group.add(banner);

        break;
      }
      case UnitType.HEALER: {
        // === HEALER — White robes, green cross, glowing hands ===
        const robeGeo = new THREE.BoxGeometry(0.5, 0.7, 0.5);
        const robeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const robe = new THREE.Mesh(robeGeo, robeMat);
        robe.position.y = 0.35;
        robe.castShadow = true;
        group.add(robe);
        // Green cross on chest
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.52), new THREE.MeshLambertMaterial({ color: 0x00e676 }));
        crossV.position.set(0, 0.38, 0);
        group.add(crossV);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.52), new THREE.MeshLambertMaterial({ color: 0x00e676 }));
        crossH.position.set(0, 0.38, 0);
        group.add(crossH);
        // Head
        const hHead = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshLambertMaterial({ color: 0xffdbac }));
        hHead.position.y = 0.88;
        group.add(hHead);
        // Hood
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
        hood.position.y = 1.0;
        group.add(hood);
        // Team color hood trim
        const hoodTrim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshLambertMaterial({ color: playerColor }));
        hoodTrim.position.y = 0.92;
        group.add(hoodTrim);
        // Team color belt
        const healBelt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.52), new THREE.MeshLambertMaterial({ color: playerColor }));
        healBelt.position.y = 0.08;
        group.add(healBelt);
        // Glowing hands (emissive green)
        const glowMat = new THREE.MeshLambertMaterial({ color: 0x00e676, emissive: 0x00e676, emissiveIntensity: 0.5 });
        group.add(makeArmGroup('arm-left', 0xffffff, -0.3, 0.35));
        group.add(makeArmGroup('arm-right', 0xffffff, 0.3, 0.35));
        const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glowMat);
        glowL.position.set(-0.3, 0.15, 0);
        glowL.name = 'heal-glow-l';
        group.add(glowL);
        const glowR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glowMat);
        glowR.position.set(0.3, 0.15, 0);
        glowR.name = 'heal-glow-r';
        group.add(glowR);
        group.add(makeLegGroup('leg-left', 0xffffff, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0xffffff, 0.12, 0));
        break;
      }
      case UnitType.ASSASSIN: {
        // === ASSASSIN — Slim, hooded rogue with daggers attached to arms ===
        // Slim torso — dark leather armor
        const aBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.35), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
        aBody.position.y = 0.28;
        aBody.castShadow = true;
        group.add(aBody);
        // Leather straps across chest (X pattern)
        const strapMat = new THREE.MeshLambertMaterial({ color: 0x2d1b4e });
        const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.37), strapMat);
        strapL.position.set(0, 0.3, 0);
        strapL.rotation.z = 0.35;
        group.add(strapL);
        const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.37), strapMat);
        strapR.position.set(0, 0.3, 0);
        strapR.rotation.z = -0.35;
        group.add(strapR);
        // Team color belt with poison vials
        const aBelt = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.37), new THREE.MeshLambertMaterial({ color: playerColor }));
        aBelt.position.y = 0.05;
        group.add(aBelt);
        // Tiny poison vials on belt
        const vialMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.4 });
        for (const vx of [-0.1, 0.0, 0.1]) {
          const vial = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), vialMat);
          vial.position.set(vx, 0.05, 0.18);
          group.add(vial);
        }
        // Hooded head — deep cowl
        const aHoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.38), new THREE.MeshLambertMaterial({ color: 0x0d001a }));
        aHoodBack.position.y = 0.78;
        group.add(aHoodBack);
        // Hood peak (pointed front drape)
        const hoodPeak = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.1), new THREE.MeshLambertMaterial({ color: 0x0d001a }));
        hoodPeak.position.set(0, 0.9, 0.2);
        group.add(hoodPeak);
        // Face shadow (dark recessed area under hood)
        const faceShadow = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.04), new THREE.MeshLambertMaterial({ color: 0x050010 }));
        faceShadow.position.set(0, 0.78, 0.19);
        group.add(faceShadow);
        // Glowing eyes (sinister purple)
        const eyeMat = new THREE.MeshLambertMaterial({ color: 0xaa00ff, emissive: 0xaa00ff, emissiveIntensity: 1.0 });
        for (const ex of [-0.06, 0.06]) {
          const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), eyeMat);
          eye.position.set(ex, 0.8, 0.2);
          group.add(eye);
        }
        // Team color shoulder pads
        for (const sx of [-0.22, 0.22]) {
          const sPad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.15), new THREE.MeshLambertMaterial({ color: playerColor }));
          sPad.position.set(sx, 0.55, 0);
          group.add(sPad);
        }
        // LEFT ARM with WICKED DAGGER
        const aArmL = makeArmGroup('arm-left', 0x1a0033, -0.24, 0.3);
        const daggerBladeMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
        const daggerPoisonMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.3 });
        // Left dagger blade (extends forward from hand)
        const ldBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        ldBlade.position.set(0, -0.15, 0.25);
        aArmL.add(ldBlade);
        // Left poison edge
        const ldPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        ldPoison.position.set(-0.03, -0.15, 0.25);
        aArmL.add(ldPoison);
        // Left grip
        const ldGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
        ldGrip.position.set(0, -0.15, 0.02);
        aArmL.add(ldGrip);
        group.add(aArmL);
        // RIGHT ARM with WICKED DAGGER
        const aArmR = makeArmGroup('arm-right', 0x1a0033, 0.24, 0.3);
        const rdBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        rdBlade.position.set(0, -0.15, 0.25);
        aArmR.add(rdBlade);
        const rdPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        rdPoison.position.set(0.03, -0.15, 0.25);
        aArmR.add(rdPoison);
        const rdGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
        rdGrip.position.set(0, -0.15, 0.02);
        aArmR.add(rdGrip);
        group.add(aArmR);
        // Legs — slim, dark
        group.add(makeLegGroup('leg-left', 0x1a0033, -0.1, 0));
        group.add(makeLegGroup('leg-right', 0x1a0033, 0.1, 0));
        break;
      }
      case UnitType.SHIELDBEARER: {
        // === SHIELDBEARER — Massive armor, heater shield (3-point top, pointed bottom) ===
        const sbArmor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 0.55), new THREE.MeshLambertMaterial({ color: 0x78909c }));
        sbArmor.position.y = 0.35;
        sbArmor.castShadow = true;
        group.add(sbArmor);
        // Thick shoulder plates (team color)
        for (const sx of [-0.35, 0.35]) {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: playerColor }));
          plate.position.set(sx, 0.65, 0);
          group.add(plate);
        }
        // Helmet with nose guard
        const sbHelm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        sbHelm.position.y = 0.9;
        group.add(sbHelm);
        const sbVisor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.44), new THREE.MeshLambertMaterial({ color: 0x263238 }));
        sbVisor.position.y = 0.9;
        group.add(sbVisor);
        // Nose guard
        const noseGuard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        noseGuard.position.set(0, 0.85, 0.22);
        group.add(noseGuard);

        // Left arm with HEATER SHIELD — flat top with 3 corners, pointed bottom
        // Built as arm-child so it moves with the arm for bash animation
        const sbArmLeft = makeArmGroup('arm-left', 0x78909c, -0.35, 0.35);
        // Shield is a group for composite shape
        const shieldGroup = new THREE.Group();
        shieldGroup.name = 'shield-group';
        // Main body — wide rectangle for the top 2/3
        const shMain = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shMain.position.set(0, 0.05, 0);
        shieldGroup.add(shMain);
        // Bottom point — narrowing wedge (2 angled blocks)
        const shPointL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shPointL.position.set(-0.07, -0.3, 0);
        shPointL.rotation.z = -0.25;
        shieldGroup.add(shPointL);
        const shPointR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shPointR.position.set(0.07, -0.3, 0);
        shPointR.rotation.z = 0.25;
        shieldGroup.add(shPointR);
        // Flat top edge (the 3 points at top — left, center-top, right)
        const shTopEdge = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x666666 }));
        shTopEdge.position.set(0, 0.32, 0);
        shieldGroup.add(shTopEdge);
        // Steel rim left/right
        for (const rx of [-0.28, 0.28]) {
          const shRim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.1), new THREE.MeshLambertMaterial({ color: 0x666666 }));
          shRim.position.set(rx, 0.05, 0);
          shieldGroup.add(shRim);
        }
        // Center boss with spike
        const shBoss = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.12), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        shBoss.position.set(0, 0.05, 0.05);
        shieldGroup.add(shBoss);
        const shSpike = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
        shSpike.position.set(0, 0.05, 0.14);
        shieldGroup.add(shSpike);
        // Team emblem — chevron pattern
        const chevron1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        chevron1.position.set(0, 0.18, 0.01);
        shieldGroup.add(chevron1);
        const chevron2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        chevron2.position.set(0, -0.08, 0.01);
        shieldGroup.add(chevron2);
        // Position shield in front of arm, offset outward to avoid torso clipping
        shieldGroup.position.set(0.25, -0.15, 0.3);
        sbArmLeft.add(shieldGroup);
        group.add(sbArmLeft);
        // Right arm — empty fist (shield bash is the weapon)
        group.add(makeArmGroup('arm-right', 0x78909c, 0.35, 0.35));
        group.add(makeLegGroup('leg-left', 0x546e7a, -0.15, 0));
        group.add(makeLegGroup('leg-right', 0x546e7a, 0.15, 0));
        break;
      }
      case UnitType.BERSERKER: {
        // === BERSERKER — Massive bare-chested brute, war paint, spiked fur mantle, dual war axes on arms ===
        // Muscular torso (wide, stocky)
        const bBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.65, 0.5), new THREE.MeshLambertMaterial({ color: 0xc9956b }));
        bBody.position.y = 0.33;
        bBody.castShadow = true;
        group.add(bBody);
        // Pectoral definition (darker skin tone for muscle shadow)
        const pecMat = new THREE.MeshLambertMaterial({ color: 0xb07d55 });
        const pecL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.52), pecMat);
        pecL.position.set(-0.1, 0.45, 0);
        group.add(pecL);
        const pecR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.52), pecMat);
        pecR.position.set(0.1, 0.45, 0);
        group.add(pecR);
        // War paint — jagged red V across chest
        const paintMat = new THREE.MeshLambertMaterial({ color: 0xd50000 });
        const paintV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.52), paintMat);
        paintV.position.set(0, 0.35, 0);
        paintV.rotation.z = 0.35;
        group.add(paintV);
        const paintV2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.52), paintMat);
        paintV2.position.set(0, 0.35, 0);
        paintV2.rotation.z = -0.35;
        group.add(paintV2);
        // Fur mantle across shoulders (ragged animal hide)
        const furMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const furMantle = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.15, 0.55), furMat);
        furMantle.position.y = 0.63;
        group.add(furMantle);
        // Fur spikes/tufts sticking up from mantle
        for (const sx of [-0.25, 0, 0.25]) {
          const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.08), furMat);
          tuft.position.set(sx, 0.75, -0.15);
          tuft.rotation.z = sx * 0.3;
          group.add(tuft);
        }
        // Skull trophy on belt
        const skullMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
        const skull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08), skullMat);
        skull.position.set(0.15, 0.05, 0.26);
        group.add(skull);
        const skullJaw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.06), skullMat);
        skullJaw.position.set(0.15, 0.0, 0.28);
        group.add(skullJaw);
        // Team color fur mantle trim
        const furTrim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.57), new THREE.MeshLambertMaterial({ color: playerColor }));
        furTrim.position.y = 0.57;
        group.add(furTrim);
        // Leather belt with team color buckle
        const bBelt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.52), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
        bBelt.position.y = 0.05;
        group.add(bBelt);
        const bBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: playerColor }));
        bBuckle.position.set(0, 0.05, 0.26);
        group.add(bBuckle);
        // Head — scarred, fierce
        const bHead = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), new THREE.MeshLambertMaterial({ color: 0xc9956b }));
        bHead.position.y = 0.84;
        group.add(bHead);
        // Wild spiked hair (multiple tufts going back and up)
        const hairMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
        const hairBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.4), hairMat);
        hairBase.position.y = 1.0;
        group.add(hairBase);
        for (const hx of [-0.12, 0, 0.12]) {
          const spike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), hairMat);
          spike.position.set(hx, 1.12, -0.1);
          spike.rotation.x = -0.3;
          group.add(spike);
        }
        // Scar across face (diagonal dark line)
        const scarMat = new THREE.MeshLambertMaterial({ color: 0x8b5e3c });
        const scar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.4), scarMat);
        scar.position.set(0.05, 0.87, 0);
        scar.rotation.z = 0.3;
        group.add(scar);
        // Rage eyes (glow brighter at low HP)
        const rEyeMat = new THREE.MeshLambertMaterial({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 0.5 });
        for (const ex of [-0.08, 0.08]) {
          const rEye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), rEyeMat);
          rEye.position.set(ex, 0.87, 0.19);
          rEye.name = 'rage-eye';
          group.add(rEye);
        }
        // Angry brow ridge
        const browMat = new THREE.MeshLambertMaterial({ color: 0xb07d55 });
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.04), browMat);
        brow.position.set(0, 0.92, 0.19);
        group.add(brow);
        // LEFT ARM with WAR AXE
        const bArmL = makeArmGroup('arm-left', 0xc9956b, -0.35, 0.33);
        const axeHandleMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const axeBladeMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
        const axeEdgeMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
        // Left axe handle
        const lHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.6), axeHandleMat);
        lHandle.position.set(0, -0.15, 0.3);
        bArmL.add(lHandle);
        // Left axe blade (crescent)
        const lBlade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.2), axeBladeMat);
        lBlade.position.set(-0.1, -0.15, 0.55);
        bArmL.add(lBlade);
        const lEdge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.1), axeEdgeMat);
        lEdge.position.set(-0.13, -0.15, 0.65);
        bArmL.add(lEdge);
        // Left back spike
        const lSpike = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), axeBladeMat);
        lSpike.position.set(0.08, -0.15, 0.55);
        bArmL.add(lSpike);
        group.add(bArmL);
        // RIGHT ARM with WAR AXE
        const bArmR = makeArmGroup('arm-right', 0xc9956b, 0.35, 0.33);
        const rHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.6), axeHandleMat);
        rHandle.position.set(0, -0.15, 0.3);
        bArmR.add(rHandle);
        const rBlade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.2), axeBladeMat);
        rBlade.position.set(0.1, -0.15, 0.55);
        bArmR.add(rBlade);
        const rEdge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.1), axeEdgeMat);
        rEdge.position.set(0.13, -0.15, 0.65);
        bArmR.add(rEdge);
        const rSpike = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), axeBladeMat);
        rSpike.position.set(-0.08, -0.15, 0.55);
        bArmR.add(rSpike);
        group.add(bArmR);
        // Legs — leather pants, fur-trimmed boots
        group.add(makeLegGroup('leg-left', 0x5d4037, -0.14, 0));
        group.add(makeLegGroup('leg-right', 0x5d4037, 0.14, 0));
        break;
      }
      case UnitType.BATTLEMAGE: {
        // === BATTLEMAGE — Wizard with floppy hat, arcane robes, staff ===
        // Flowing robes (wider at bottom for wizard silhouette)
        const bmRobeBottom = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.55), new THREE.MeshLambertMaterial({ color: 0x1a0066 }));
        bmRobeBottom.position.y = 0.18;
        bmRobeBottom.castShadow = true;
        group.add(bmRobeBottom);
        const bmRobeTop = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.4, 0.45), new THREE.MeshLambertMaterial({ color: 0x311b92 }));
        bmRobeTop.position.y = 0.45;
        group.add(bmRobeTop);
        // Robe collar (team colored, raised)
        const collarMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const collarL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.3), collarMat);
        collarL.position.set(-0.24, 0.65, -0.05);
        group.add(collarL);
        const collarR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.3), collarMat);
        collarR.position.set(0.24, 0.65, -0.05);
        group.add(collarR);
        // Glowing rune belt with arcane buckle
        const runeBelt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.47), new THREE.MeshLambertMaterial({ color: 0x7c4dff, emissive: 0x7c4dff, emissiveIntensity: 0.6 }));
        runeBelt.position.y = 0.28;
        group.add(runeBelt);
        const runeBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.06), new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.5 }));
        runeBuckle.position.set(0, 0.28, 0.24);
        group.add(runeBuckle);
        // Arcane symbols on robe front
        const symMat = new THREE.MeshLambertMaterial({ color: 0x9c27b0, emissive: 0x9c27b0, emissiveIntensity: 0.3 });
        const sym1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.47), symMat);
        sym1.position.set(0, 0.5, 0);
        group.add(sym1);
        const sym2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.47), symMat);
        sym2.position.set(0, 0.5, 0);
        group.add(sym2);
        // Head — old wizard face
        const bmHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.32), new THREE.MeshLambertMaterial({ color: 0xffdbac }));
        bmHead.position.y = 0.85;
        group.add(bmHead);
        // Bushy eyebrows
        const browMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
        for (const bx of [-0.08, 0.08]) {
          const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), browMat);
          brow.position.set(bx, 0.92, 0.16);
          group.add(brow);
        }
        // Wise eyes
        const bmEyeMat = new THREE.MeshLambertMaterial({ color: 0x2196f3, emissive: 0x2196f3, emissiveIntensity: 0.4 });
        for (const ex of [-0.07, 0.07]) {
          const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), bmEyeMat);
          eye.position.set(ex, 0.87, 0.17);
          group.add(eye);
        }
        // Short beard
        const beardMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
        const beard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), beardMat);
        beard.position.set(0, 0.74, 0.15);
        group.add(beard);
        // === FLOPPY WIZARD HAT ===
        // Hat brim (wide, flat disk)
        const hatBrimMat = new THREE.MeshLambertMaterial({ color: 0x1a0066 });
        const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.55), hatBrimMat);
        hatBrim.position.y = 1.02;
        group.add(hatBrim);
        // Hat cone base (shorter, wider)
        const hatConeMat = new THREE.MeshLambertMaterial({ color: 0x220077 });
        const hatBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), hatConeMat);
        hatBase.position.y = 1.15;
        group.add(hatBase);
        // Hat cone mid (narrowing)
        const hatMid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), hatConeMat);
        hatMid.position.y = 1.35;
        group.add(hatMid);
        // Hat tip (bent/floppy — tilts to one side)
        const hatTip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), hatConeMat);
        hatTip.position.set(0.1, 1.48, 0.05);
        hatTip.rotation.z = -0.4; // floppy lean to the right
        hatTip.rotation.x = 0.2; // slight forward droop
        hatTip.name = 'wizard-hat-tip';
        group.add(hatTip);
        // Team color hat band
        const hatBand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.32), new THREE.MeshLambertMaterial({ color: playerColor }));
        hatBand.position.y = 1.04;
        group.add(hatBand);
        // Star emblem on hat
        const starMat = new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.6 });
        const star = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), starMat);
        star.position.set(0, 1.12, 0.16);
        star.rotation.z = Math.PI / 4; // diamond orientation
        group.add(star);
        // RIGHT ARM with STAFF (staff is arm child so it moves with animation)
        const bmArmR = makeArmGroup('arm-right', 0x311b92, 0.3, 0.4);
        const staff = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), new THREE.MeshLambertMaterial({ color: 0x4a148c }));
        staff.position.set(0, -0.15, 0.5);
        bmArmR.add(staff);
        // Orb atop staff
        const orbMat = new THREE.MeshLambertMaterial({ color: 0xb388ff, emissive: 0x7c4dff, emissiveIntensity: 0.8 });
        const orb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), orbMat);
        orb.position.set(0, -0.15, 1.1);
        orb.name = 'battlemage-orb';
        bmArmR.add(orb);
        group.add(bmArmR);
        // Left arm — open hand for casting
        const bmArmL = makeArmGroup('arm-left', 0x311b92, -0.3, 0.4);
        group.add(bmArmL);
        // Floating arcane particles around the mage (2 small orbiting spheres)
        for (let i = 0; i < 2; i++) {
          const fOrb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0xb388ff, emissive: 0x7c4dff, emissiveIntensity: 1.0 }));
          fOrb.position.set(Math.cos(i * Math.PI) * 0.4, 0.6, Math.sin(i * Math.PI) * 0.4);
          fOrb.name = 'float-orb';
          group.add(fOrb);
        }
        group.add(makeLegGroup('leg-left', 0x1a0033, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x1a0033, 0.12, 0));
        break;
      }
      case UnitType.GREATSWORD: {
        // === GREATSWORD — Heavy plate, massive two-handed claymore ===
        // Heavy plate body (wide, imposing)
        const gsBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.5), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        gsBody.position.y = 0.35; gsBody.castShadow = true;
        group.add(gsBody);
        // Chest plate with team emblem
        const gsChest = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.52), new THREE.MeshLambertMaterial({ color: playerColor }));
        gsChest.position.y = 0.42;
        group.add(gsChest);
        // Waist belt with buckle
        const gsBelt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.52), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        gsBelt.position.y = 0.08;
        group.add(gsBelt);
        const gsBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        gsBuckle.position.set(0, 0.08, 0.26);
        group.add(gsBuckle);
        // Large shoulder pauldrons
        for (const sx of [-0.38, 0.38]) {
          const gsP = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.3), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
          gsP.position.set(sx, 0.65, 0);
          group.add(gsP);
          // Spike on each pauldron
          const gsPSpike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), new THREE.MeshLambertMaterial({ color: 0x888888 }));
          gsPSpike.position.set(sx, 0.78, 0);
          group.add(gsPSpike);
        }
        // Full helm with T-visor
        const gsHelm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
        gsHelm.position.y = 0.9;
        group.add(gsHelm);
        const gsVisor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.44), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        gsVisor.position.y = 0.88;
        group.add(gsVisor);
        const gsVisorV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.44), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        gsVisorV.position.y = 0.85;
        group.add(gsVisorV);
        // Arms — both grip the claymore
        const gsArmR = makeArmGroup('arm-right', 0x546e7a, 0.35, 0.35);
        const gsArmL = makeArmGroup('arm-left', 0x546e7a, -0.35, 0.35);
        // === THE CLAYMORE — massive two-handed sword ===
        // Long blade (oversized — nearly as tall as the unit)
        const clayBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.3), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
        clayBlade.position.set(0.15, -0.15, 0.65);
        gsArmR.add(clayBlade);
        // Fuller groove
        const clayFuller = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 1.0), new THREE.MeshLambertMaterial({ color: 0x999999 }));
        clayFuller.position.set(0.15, -0.15, 0.55);
        gsArmR.add(clayFuller);
        // Blade edge highlights (both sides — sharp!)
        const clayEdgeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        for (const ex of [-0.085, 0.085]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 1.2), clayEdgeMat);
          edge.position.set(0.15 + ex, -0.15, 0.6);
          gsArmR.add(edge);
        }
        // Wide crossguard (angled downward like real claymore quillons)
        const clayGuard = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.06), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        clayGuard.position.set(0.15, -0.15, 0.02);
        gsArmR.add(clayGuard);
        // Guard tips angled down
        for (const gx of [-0.2, 0.2]) {
          const guardTip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
          guardTip.position.set(0.15 + gx, -0.18, -0.02);
          gsArmR.add(guardTip);
        }
        // Long ricasso (leather-wrapped grip for two-hand hold)
        const clayGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), new THREE.MeshLambertMaterial({ color: 0x3e2723 }));
        clayGrip.position.set(0.15, -0.15, -0.1);
        gsArmR.add(clayGrip);
        // Heavy pommel
        const clayPommel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        clayPommel.position.set(0.15, -0.15, -0.22);
        gsArmR.add(clayPommel);
        group.add(gsArmR);
        group.add(gsArmL);
        // Heavy armored legs
        group.add(makeLegGroup('leg-left', 0x37474f, -0.14, 0));
        group.add(makeLegGroup('leg-right', 0x37474f, 0.14, 0));
        break;
      }
      case UnitType.SCOUT: {
        // Agile scout — light leather armor, binoculars/spyglass, messenger bag, team bandana
        const scoutBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.55, 0.4),
          new THREE.MeshLambertMaterial({ color: 0x5D4037 }) // dark leather
        );
        scoutBody.position.y = 0.3; scoutBody.castShadow = true;
        group.add(scoutBody);
        // Leather belt with team color buckle
        const scoutBelt = new THREE.Mesh(
          new THREE.BoxGeometry(0.48, 0.06, 0.42),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        scoutBelt.position.y = 0.18;
        group.add(scoutBelt);
        // Messenger bag strap (diagonal across chest)
        const strap = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.5, 0.06),
          new THREE.MeshLambertMaterial({ color: 0x3E2723 })
        );
        strap.position.set(-0.1, 0.35, 0.15);
        strap.rotation.z = 0.4;
        group.add(strap);
        // Messenger bag on hip
        const bag = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.15, 0.12),
          new THREE.MeshLambertMaterial({ color: 0x4E342E })
        );
        bag.position.set(0.2, 0.1, 0.1);
        group.add(bag);
        // Head
        const scoutHead = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.3, 0.32),
          new THREE.MeshLambertMaterial({ color: 0xffdbac })
        );
        scoutHead.position.y = 0.78;
        group.add(scoutHead);
        // Bandana (team color, wrapped around head)
        const bandana = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.1, 0.36),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        bandana.position.y = 0.88;
        group.add(bandana);
        // Right arm with oversized curved scimitar
        const scoutArmRight = makeArmGroup('arm-right', 0x5D4037, 0.28, 0.35);
        const scimBlade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.55), new THREE.MeshLambertMaterial({ color: 0xd0d0d0 }));
        scimBlade.position.set(0, -0.12, 0.3);
        scimBlade.rotation.y = 0.15; // slight curve
        scoutArmRight.add(scimBlade);
        // Sharp edge highlight
        const scimEdge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        scimEdge.position.set(0, -0.14, 0.3);
        scimEdge.rotation.y = 0.15;
        scoutArmRight.add(scimEdge);
        const scimGuard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        scimGuard.position.set(0, -0.12, 0.04);
        scoutArmRight.add(scimGuard);
        group.add(scoutArmRight);
        // Left arm — spyglass strapped to belt, hand free
        const scoutArmLeft = makeArmGroup('arm-left', 0x5D4037, -0.28, 0.35);
        // Spyglass on belt (decorative)
        const spyglass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        spyglass.position.set(-0.18, 0.08, 0.05);
        spyglass.rotation.x = 1.2;
        group.add(spyglass);
        group.add(scoutArmLeft);
        // Light boots
        group.add(makeLegGroup('leg-left', 0x3E2723, -0.1, 0));
        group.add(makeLegGroup('leg-right', 0x3E2723, 0.1, 0));
        break;
      }
      case UnitType.MAGE: {
        // Arcane mage — flowing blue robe, pointed hat, staff with crystal, rune accents
        const mageBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.65, 0.45),
          new THREE.MeshLambertMaterial({ color: 0x1565C0 }) // deep blue robe
        );
        mageBody.position.y = 0.32; mageBody.castShadow = true;
        group.add(mageBody);
        // Robe hem (wider at bottom — gives flowing robe look)
        const robeHem = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.15, 0.52),
          new THREE.MeshLambertMaterial({ color: 0x0D47A1 })
        );
        robeHem.position.y = 0.07;
        group.add(robeHem);
        // Golden trim at waist
        const mageWaist = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.04, 0.47),
          new THREE.MeshLambertMaterial({ color: 0xFFD700 })
        );
        mageWaist.position.y = 0.55;
        group.add(mageWaist);
        // Team color sash/belt
        const mageSash = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.06, 0.47),
          new THREE.MeshLambertMaterial({ color: playerColor })
        );
        mageSash.position.y = 0.15;
        group.add(mageSash);
        // Team color shoulder marks
        for (const sx of [-0.28, 0.28]) {
          const mMark = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.08, 0.2),
            new THREE.MeshLambertMaterial({ color: playerColor })
          );
          mMark.position.set(sx, 0.6, 0);
          group.add(mMark);
        }
        // Head
        const mageHead = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshLambertMaterial({ color: 0xffdbac })
        );
        mageHead.position.y = 0.82;
        group.add(mageHead);
        // Pointed wizard hat — brim + cone
        const hatBrim = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.04, 0.5),
          new THREE.MeshLambertMaterial({ color: 0x0D47A1 })
        );
        hatBrim.position.y = 0.95;
        group.add(hatBrim);
        const hatCone = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.35, 0.25),
          new THREE.MeshLambertMaterial({ color: 0x1565C0 })
        );
        hatCone.position.y = 1.15;
        group.add(hatCone);
        const hatTip = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.15, 0.12),
          new THREE.MeshLambertMaterial({ color: 0x0D47A1 })
        );
        hatTip.position.y = 1.35;
        group.add(hatTip);
        // Hat star (golden accent on front)
        const hatStar = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, 0.02),
          new THREE.MeshBasicMaterial({ color: 0xFFD700 })
        );
        hatStar.position.set(0, 1.1, 0.13);
        group.add(hatStar);
        // Staff in right hand — tall wooden staff with crystal orb
        const staffShaft = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.9, 0.05),
          new THREE.MeshLambertMaterial({ color: 0x5D4037 })
        );
        staffShaft.position.set(0, 0.1, 0);
        // Crystal orb at top (glowing blue, emissive)
        const crystal = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0x42A5F5, transparent: true, opacity: 0.85 })
        );
        crystal.position.set(0, 0.6, 0);
        // Crystal cage (golden prongs holding the orb)
        for (let ci = 0; ci < 3; ci++) {
          const prong = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.15, 0.02),
            new THREE.MeshLambertMaterial({ color: 0xFFD700 })
          );
          const cAngle = (ci / 3) * Math.PI * 2;
          prong.position.set(Math.cos(cAngle) * 0.06, 0.55, Math.sin(cAngle) * 0.06);
          staffShaft.add(prong);
        }
        staffShaft.add(crystal);
        const mageRightArm = makeArmGroup('arm-right', 0x1565C0, 0.3, 0.35);
        mageRightArm.add(staffShaft);
        group.add(mageRightArm);
        group.add(makeArmGroup('arm-left', 0x1565C0, -0.3, 0.35));
        group.add(makeLegGroup('leg-left', 0x0D47A1, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x0D47A1, 0.12, 0));
        break;
      }
      default: {
        // Generic unit: simple body + head + limbs + team color shoulder marks
        const unitColor = UNIT_COLORS[type] || 0xffffff;
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
        const bodyMat = new THREE.MeshLambertMaterial({ color: unitColor });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        body.castShadow = true;
        group.add(body);

        for (const sx of [-0.27, 0.27]) {
          const markGeo = new THREE.BoxGeometry(0.12, 0.08, 0.2);
          const markMat = new THREE.MeshLambertMaterial({ color: playerColor });
          const mark = new THREE.Mesh(markGeo, markMat);
          mark.position.set(sx, 0.58, 0);
          group.add(mark);
        }

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 0.8;
        group.add(head);

        group.add(makeArmGroup('arm-left', 0xffdbac, -0.3, 0.35));
        group.add(makeArmGroup('arm-right', 0xffdbac, 0.3, 0.35));
        group.add(makeLegGroup('leg-left', unitColor, -0.12, 0));
        group.add(makeLegGroup('leg-right', unitColor, 0.12, 0));
        break;
      }
    }
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
      [UnitType.CATAPULT]: 'CATAPULT',
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

  /**
   * Remove a unit from the scene
   */
  removeUnit(unitId: string): void {
    const entry = this.unitMeshes.get(unitId);
    if (entry) {
      this.scene.remove(entry.group);
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.unitMeshes.delete(unitId);
    }
  }

  /**
   * Move a unit mesh to a new position (with simple animation)
   */
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

  /**
   * Draw a health bar onto a canvas context
   */
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

  /**
   * Update health bar for a unit (just repaints the canvas — no geometry churn)
   */
  updateHealthBar(unit: Unit): void {
    const entry = this.unitMeshes.get(unit.id);
    if (!entry) return;

    const healthRatio = Math.max(unit.currentHealth / unit.stats.maxHealth, 0);
    // Skip if ratio hasn't changed meaningfully
    if (Math.abs(healthRatio - entry.lastHealthRatio) < 0.005) return;

    entry.lastHealthRatio = healthRatio;
    UnitRenderer.drawHealthBar(entry.healthBarCtx, healthRatio);
    entry.healthBarTexture.needsUpdate = true;
  }

  /**
   * Set world position directly (for RTS smooth movement)
   * Also updates unit rotation based on movement direction
   */
  setWorldPosition(unitId: string, x: number, y: number, z: number): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;

    const newPos = new THREE.Vector3(x, y, z);
    const oldPos = entry.lastPosition;

    // Compute direction of movement
    const direction = newPos.clone().sub(oldPos);

    // Only rotate if there's meaningful movement
    if (direction.length() > 0.005) {
      // Calculate target facing angle (Y-axis rotation)
      const targetAngle = Math.atan2(direction.x, direction.z);

      // Smooth lerp the rotation angle — faster for small units, slower for siege
      const angleDiff = targetAngle - entry.facingAngle;
      // Handle wrapping around pi/-pi
      const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      // Lerp factor: higher = snappier rotation
      const lerpFactor = (entry.unitType === UnitType.TREBUCHET || entry.unitType === UnitType.CATAPULT)
        ? 0.12 : 0.18;
      entry.facingAngle += normalizedDiff * lerpFactor;

      entry.group.rotation.y = entry.facingAngle;
    }

    entry.group.position.set(x, y, z);
    entry.lastPosition.copy(newPos);
  }

  /**
   * Highlight a unit (selection glow)
   */
  setSelected(unitId: string, selected: boolean): void {
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
    }
  }

  /** Show or hide a unit's mesh group (for garrison) */
  setVisible(unitId: string, visible: boolean): void {
    const entry = this.unitMeshes.get(unitId);
    if (!entry) return;
    entry.group.visible = visible;
  }

  /**
   * Get the Three.js group for a unit (for raycasting)
   */
  getUnitGroup(unitId: string): THREE.Group | null {
    return this.unitMeshes.get(unitId)?.group || null;
  }

  /**
   * Get all unit groups (for raycasting)
   */
  getAllGroups(): THREE.Group[] {
    return Array.from(this.unitMeshes.values()).map((m) => m.group);
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

  // Melee unit types that should strafe in combat
  private static MELEE_TYPES: Set<UnitType> = new Set([
    UnitType.WARRIOR, UnitType.RIDER, UnitType.ASSASSIN,
    UnitType.SHIELDBEARER, UnitType.BERSERKER, UnitType.PALADIN,
    UnitType.GREATSWORD,
  ]);
  // Per-unit strafe state: orbit phase offset (unique per unit)
  private strafePhases: Map<string, number> = new Map();
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
   * Apply combat strafing offset for a melee unit attacking a target.
   * Orbits the unit around its target at a small radius, moving in and out.
   * Visual-only — does not alter game-state position.
   */
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

  /**
   * Rotate a unit to face a target position (for combat orientation).
   * Smooth lerp so units don't snap instantly.
   */
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
        // Sword slash: right arm does a fast horizontal/diagonal slash
        const speed = 2.5;
        const cycle = (time * speed) % 1;
        if (cycle < 0.3) {
          const p = cycle / 0.3;
          if (armRight) {
            armRight.rotation.x = -0.5 * p;
            armRight.rotation.z = -0.3 * p;
          }
        } else if (cycle < 0.5) {
          const p = (cycle - 0.3) / 0.2;
          if (armRight) {
            armRight.rotation.x = -0.5 + 1.8 * p;
            armRight.rotation.z = -0.3 + 0.6 * p;
          }
          entry.group.rotation.x = 0.08 * p;
          // Spawn slash trail at strike
          if (cycle >= 0.35 && cycle < 0.42) this.trySpawnTrail(unitId, 'slash', time, 0.35);
        } else if (cycle < 0.65) {
          if (armRight) { armRight.rotation.x = 1.3; armRight.rotation.z = 0.3; }
          entry.group.rotation.x = 0.08;
        } else {
          const p = (cycle - 0.65) / 0.35;
          if (armRight) { armRight.rotation.x = 1.3 * (1 - p); armRight.rotation.z = 0.3 * (1 - p); }
        }
        if (armLeft) armLeft.rotation.x = 0.2;
        if (legLeft) legLeft.rotation.x = cycle < 0.5 ? 0.15 : 0.15 * (1 - (cycle - 0.5) * 2);
        break;
      }
      case UnitType.ARCHER: {
        // Bowstring draw and release cycle
        const speed = 1.5;
        const cycle = (time * speed) % 1;
        if (cycle < 0.6) {
          // Draw: left arm extends forward (holding bow), right arm pulls back
          const p = cycle / 0.6;
          if (armLeft) {
            armLeft.rotation.x = 0.8; // hold bow forward and steady
          }
          if (armRight) {
            armRight.rotation.x = -0.6 * p; // pull string back
          }
        } else if (cycle < 0.7) {
          // Release: right arm snaps forward
          const p = (cycle - 0.6) / 0.1;
          if (armLeft) armLeft.rotation.x = 0.8;
          if (armRight) armRight.rotation.x = -0.6 + 1.0 * p; // snap to 0.4
        } else {
          // Reset draw arm
          const p = (cycle - 0.7) / 0.3;
          if (armLeft) armLeft.rotation.x = 0.8 * (1 - p * 0.3); // slight relax
          if (armRight) armRight.rotation.x = 0.4 * (1 - p);
        }
        break;
      }
      case UnitType.RIDER: {
        // Lance thrust: right arm punches forward, body leans
        const speed = 2.0;
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
        // Shield bash: left arm (with shield) shoves forward, body leans
        const speed = 2.0;
        const cycle = (time * speed) % 1;
        if (cycle < 0.35) {
          const p = cycle / 0.35;
          if (armLeft) armLeft.rotation.x = 0.8 * p;
          entry.group.rotation.x = 0.06 * p;
        } else if (cycle < 0.5) {
          if (armLeft) armLeft.rotation.x = 0.8;
          entry.group.rotation.x = 0.06;
          // Slash trail at shield bash
          if (cycle >= 0.35 && cycle < 0.42) this.trySpawnTrail(unitId, 'slash', time, 0.45);
        } else {
          const p = (cycle - 0.5) / 0.5;
          if (armLeft) armLeft.rotation.x = 0.8 * (1 - p);
        }
        if (armRight) armRight.rotation.x = 0.1; // ready stance
        break;
      }
      case UnitType.LUMBERJACK: {
        // Axe combat swing: side-to-side chops
        const speed = 2.2;
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
        const speed = 1.8; // fast but readable — gives time for wind-up and strike
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
        // Cleave attack: wide two-handed overhead axe swing (AoE feel)
        const speed = 1.8; // slower, heavier
        const cycle = (time * speed) % 1;
        if (cycle < 0.35) {
          // Wind-up: both arms raise high overhead
          const p = cycle / 0.35;
          const raise = -1.2 * p; // arms go high behind head
          if (armRight) {
            armRight.rotation.x = raise;
            armRight.rotation.z = -0.2 * p; // spread wide
          }
          if (armLeft) {
            armLeft.rotation.x = raise;
            armLeft.rotation.z = 0.2 * p;
          }
          entry.group.rotation.x = -0.08 * p; // lean back for wind-up
        } else if (cycle < 0.55) {
          // CLEAVE: both arms swing down hard in a wide arc
          const p = (cycle - 0.35) / 0.2;
          const swingAngle = -1.2 + 2.8 * p; // swing from -1.2 to +1.6
          if (armRight) {
            armRight.rotation.x = swingAngle;
            armRight.rotation.z = -0.2 + 0.5 * p; // sweep inward
          }
          if (armLeft) {
            armLeft.rotation.x = swingAngle;
            armLeft.rotation.z = 0.2 - 0.5 * p;
          }
          entry.group.rotation.x = -0.08 + 0.25 * p; // lean forward into cleave
        } else if (cycle < 0.7) {
          // Impact: hold at extended position, body leans forward
          if (armRight) { armRight.rotation.x = 1.6; armRight.rotation.z = 0.3; }
          if (armLeft) { armLeft.rotation.x = 1.6; armLeft.rotation.z = -0.3; }
          entry.group.rotation.x = 0.17;
          // Smash trail at impact
          if (cycle >= 0.55 && cycle < 0.62) this.trySpawnTrail(unitId, 'smash', time, 0.5);
        } else {
          const p = (cycle - 0.7) / 0.3;
          if (armRight) { armRight.rotation.x = 1.6 * (1 - p); armRight.rotation.z = 0.3 * (1 - p); }
          if (armLeft) { armLeft.rotation.x = 1.6 * (1 - p); armLeft.rotation.z = -0.3 * (1 - p); }
          entry.group.rotation.x = 0.17 * (1 - p);
        }
        if (legLeft) legLeft.rotation.x = cycle >= 0.35 && cycle < 0.6 ? 0.25 : 0;
        if (legRight) legRight.rotation.x = cycle >= 0.35 && cycle < 0.6 ? -0.1 : 0;
        break;
      }
      case UnitType.SHIELDBEARER: {
        // Shield bash: draw back, then explosive forward slam
        const speed = 1.6; // deliberate, heavy
        const cycle = (time * speed) % 1;
        if (cycle < 0.35) {
          // Draw back: pull shield arm back, lean away, coil for bash
          const p = cycle / 0.35;
          if (armLeft) {
            armLeft.rotation.x = -0.8 * p; // pull shield arm back
            armLeft.rotation.z = 0.3 * p; // arm out wide
          }
          if (armRight) armRight.rotation.x = -0.2 * p; // brace
          entry.group.rotation.x = -0.1 * p; // lean back
        } else if (cycle < 0.55) {
          // BASH: explosive forward slam — whole body lunges
          const p = (cycle - 0.35) / 0.2;
          if (armLeft) {
            armLeft.rotation.x = -0.8 + 2.4 * p; // slam forward to +1.6
            armLeft.rotation.z = 0.3 - 0.5 * p; // sweep inward
          }
          if (armRight) armRight.rotation.x = -0.2 + 0.5 * p; // follow-through
          entry.group.rotation.x = -0.1 + 0.25 * p; // lunge forward
          entry.group.position.z += 0.008; // micro-lunge each frame
          // Smash trail at impact moment
          if (cycle >= 0.45 && cycle < 0.52) this.trySpawnTrail(unitId, 'smash', time, 0.4);
        } else if (cycle < 0.7) {
          // Impact hold: shield extended, body forward
          if (armLeft) { armLeft.rotation.x = 1.6; armLeft.rotation.z = -0.2; }
          if (armRight) armRight.rotation.x = 0.3;
          entry.group.rotation.x = 0.15;
        } else {
          // Recovery: return to stance
          const p = (cycle - 0.7) / 0.3;
          if (armLeft) {
            armLeft.rotation.x = 1.6 * (1 - p);
            armLeft.rotation.z = -0.2 * (1 - p);
          }
          if (armRight) armRight.rotation.x = 0.3 * (1 - p);
          entry.group.rotation.x = 0.15 * (1 - p);
        }
        // Power stance
        if (legLeft) legLeft.rotation.x = cycle >= 0.35 && cycle < 0.6 ? 0.25 : 0;
        if (legRight) legRight.rotation.x = cycle >= 0.35 && cycle < 0.6 ? -0.1 : 0;
        break;
      }
      case UnitType.BATTLEMAGE: {
        // Staff slam: raise staff overhead then slam down (AoE magic)
        const speed = 1.6;
        const cycle = (time * speed) % 1;
        if (cycle < 0.4) {
          const p = cycle / 0.4;
          if (armRight) armRight.rotation.x = -1.0 * p;
          if (armLeft) armLeft.rotation.x = -0.8 * p;
        } else if (cycle < 0.55) {
          const p = (cycle - 0.4) / 0.15;
          if (armRight) armRight.rotation.x = -1.0 + 2.2 * p;
          if (armLeft) armLeft.rotation.x = -0.8 + 1.8 * p;
          entry.group.rotation.x = 0.12 * p;
        } else if (cycle < 0.7) {
          if (armRight) armRight.rotation.x = 1.2;
          if (armLeft) armLeft.rotation.x = 1.0;
          entry.group.rotation.x = 0.12;
          // Smash trail at staff slam impact
          if (cycle >= 0.55 && cycle < 0.62) this.trySpawnTrail(unitId, 'smash', time, 0.55);
        } else {
          const p = (cycle - 0.7) / 0.3;
          if (armRight) armRight.rotation.x = 1.2 * (1 - p);
          if (armLeft) armLeft.rotation.x = 1.0 * (1 - p);
          entry.group.rotation.x = 0.12 * (1 - p);
        }
        break;
      }
      case UnitType.HEALER: {
        // Channeling: arms sway gently side-to-side (healing gesture)
        const sway = Math.sin(time * 2.5) * 0.35;
        if (armRight) { armRight.rotation.x = 0.5; armRight.rotation.z = sway; }
        if (armLeft) { armLeft.rotation.x = 0.5; armLeft.rotation.z = -sway; }
        break;
      }
      case UnitType.SCOUT: {
        // Quick dagger slash: fast flurry of pokes
        const speed = 2.2;
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
        const speed = 1.5;
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
        // Massive horizontal claymore sweep — wind-up right, slash left across body
        const speed = 1.4;
        const cycle = (time * speed) % 1;
        if (cycle < 0.25) {
          // Wind-up: pull sword to the right, coil body
          const p = cycle / 0.25;
          if (armRight) {
            armRight.rotation.x = 0.3 * p;       // arms slightly forward
            armRight.rotation.z = -1.2 * p;       // sword cocked far right
          }
          if (armLeft) {
            armLeft.rotation.x = 0.2 * p;
            armLeft.rotation.z = -0.8 * p;        // left hand follows grip
          }
          entry.group.rotation.y = entry.facingAngle - 0.25 * p; // coil rightward
          entry.group.rotation.x = -0.06 * p;     // slight lean back
        } else if (cycle < 0.5) {
          // HORIZONTAL SWEEP: slash from right to left across the body
          const p = (cycle - 0.25) / 0.25;
          const sweepZ = -1.2 + 2.4 * p;          // -1.2 → +1.2 (full horizontal arc)
          if (armRight) {
            armRight.rotation.x = 0.3 + 0.2 * p;  // arms push forward during sweep
            armRight.rotation.z = sweepZ;
          }
          if (armLeft) {
            armLeft.rotation.x = 0.2 + 0.3 * p;
            armLeft.rotation.z = sweepZ * 0.7;     // left hand follows slightly behind
          }
          // Body rotates into the sweep (coil → uncoil)
          entry.group.rotation.y = entry.facingAngle - 0.25 + 0.55 * p;
          entry.group.rotation.x = -0.06 + 0.16 * p; // lean into slash
          // Slash trail at the midpoint of sweep
          if (cycle >= 0.32 && cycle < 0.40) this.trySpawnTrail(unitId, 'slash', time, 0.35);
          if (cycle >= 0.42 && cycle < 0.48) this.trySpawnTrail(unitId, 'smash', time, 0.45);
        } else if (cycle < 0.65) {
          // Follow-through: arms extended left, body rotated
          const p = (cycle - 0.5) / 0.15;
          if (armRight) { armRight.rotation.x = 0.5; armRight.rotation.z = 1.2 - 0.3 * p; }
          if (armLeft) { armLeft.rotation.x = 0.5; armLeft.rotation.z = 0.84 - 0.2 * p; }
          entry.group.rotation.y = entry.facingAngle + 0.3 - 0.1 * p;
          entry.group.rotation.x = 0.1;
        } else {
          // Recovery: return to neutral stance
          const p = (cycle - 0.65) / 0.35;
          if (armRight) { armRight.rotation.x = 0.5 * (1 - p); armRight.rotation.z = 0.9 * (1 - p); }
          if (armLeft) { armLeft.rotation.x = 0.5 * (1 - p); armLeft.rotation.z = 0.64 * (1 - p); }
          entry.group.rotation.y = entry.facingAngle + 0.2 * (1 - p);
          entry.group.rotation.x = 0.1 * (1 - p);
        }
        // Power stance: wide legs during the sweep
        if (legLeft) legLeft.rotation.x = cycle >= 0.2 && cycle < 0.6 ? 0.3 : 0;
        if (legRight) legRight.rotation.x = cycle >= 0.2 && cycle < 0.6 ? -0.2 : 0;
        break;
      }
      default: {
        // Generic melee: simple arm swing
        const speed = 2.5;
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
      case UnitType.CATAPULT: {
        // Catapult firing: arm pivots on X
        const throwArmC = entry.group.getObjectByName('throw-arm');
        const speedC = 0.8;
        const cycleC = (time * speedC) % 1;
        if (throwArmC) {
          if (cycleC < 0.5) {
            const p = cycleC / 0.5;
            throwArmC.rotation.z = -0.4 - 0.5 * p;
          } else if (cycleC < 0.65) {
            const p = (cycleC - 0.5) / 0.15;
            throwArmC.rotation.z = -0.9 + 1.7 * p;
          } else if (cycleC < 0.75) {
            throwArmC.rotation.z = 0.8;
          } else {
            const p = (cycleC - 0.75) / 0.25;
            throwArmC.rotation.z = 0.8 - 1.2 * p;
          }
        }
        if (cycleC >= 0.5 && cycleC < 0.7) {
          entry.group.rotation.x = 0.06 * Math.sin((cycleC - 0.5) / 0.2 * Math.PI);
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
      case UnitType.ARCHER:
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
      case UnitType.CATAPULT: {
        // Catapult rolling: subtle rocking
        entry.group.rotation.z = Math.sin(time * 3) * 0.04;
        entry.group.rotation.x = Math.sin(time * 2.3) * 0.02;
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
    // Siege units (trebuchet, catapult) already have their own rocking — skip them.
    if (type !== UnitType.TREBUCHET && type !== UnitType.CATAPULT) {
      // Use the same frequency as legs so the sway syncs with stride
      const swayFreq = type === UnitType.RIDER ? 8
        : (type === UnitType.WARRIOR || type === UnitType.PALADIN) ? 6
        : (type === UnitType.ARCHER || type === UnitType.SCOUT) ? 9
        : 7;
      // Body tilts left-right with each step (rotation.z)
      entry.group.rotation.z = Math.sin(time * swayFreq) * 0.04;
      // Slight vertical bob (bounce with each step)
      entry.group.position.y += Math.abs(Math.sin(time * swayFreq)) * 0.02;
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
        // Idle: sword arm rests at side, subtle breathing sway
        if (armRight) {
          armRight.rotation.x = armRight.rotation.x * 0.9 + 0.05 * Math.sin(time * 1.2) * 0.1;
          armRight.rotation.z *= 0.9;
        }
        if (armLeft) armLeft.rotation.x *= 0.9;
        break;
      }
      case UnitType.ARCHER: {
        // Idle: bow arm slightly forward, draw arm relaxed
        if (armLeft) armLeft.rotation.x = armLeft.rotation.x * 0.9 + 0.15 * 0.1;
        if (armRight) armRight.rotation.x *= 0.9;
        break;
      }
      case UnitType.PALADIN: {
        // Idle: shield arm slightly raised in ready stance
        if (armLeft) armLeft.rotation.x = armLeft.rotation.x * 0.9 + 0.1 * 0.1;
        if (armRight) armRight.rotation.x *= 0.9;
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
      case UnitType.CATAPULT: {
        // Catapult idle: nothing moves
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

  // Active trail emitters (attached to projectiles)
  private trailParticles: Array<{
    mesh: THREE.Mesh;
    velocity: { x: number; y: number; z: number };
    startTime: number;
    duration: number;
  }> = [];

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

    // Spawn a few spark particles at impact point
    for (let i = 0; i < 6; i++) {
      const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
      const sparkMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xFFDD44 : 0xFFFFFF,
        transparent: true, opacity: 0.9,
      });
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
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
      const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
      const isWhite = Math.random() > 0.5;
      const sparkColor = isWhite ? 0xFFFFCC : color;
      const sparkMat = new THREE.MeshBasicMaterial({ color: sparkColor, transparent: true, opacity: 1.0 });
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
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

      // Ember particles shooting up from each hex
      const emberCount = 3 + Math.floor(Math.random() * 3);
      for (let ei = 0; ei < emberCount; ei++) {
        const emberGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
        const emberMat = new THREE.MeshBasicMaterial({
          color: Math.random() > 0.3 ? color : 0xFFCC00,
          transparent: true, opacity: 1.0,
        });
        const ember = new THREE.Mesh(emberGeo, emberMat);
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
        this.scene.remove(tp.mesh);
        tp.mesh.geometry?.dispose();
        (tp.mesh.material as THREE.Material).dispose();
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
   * Fire a boulder (trebuchet/catapult) — queues the shot so it syncs with the throw animation.
   * The actual boulder spawns when the arm reaches the release point in animateAttacking.
   */
  fireBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
    // Find the siege unit at this position and queue the fire
    for (const [, entry] of this.unitMeshes) {
      if ((entry.unitType === UnitType.TREBUCHET || entry.unitType === UnitType.CATAPULT) &&
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
  private spawnBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, onImpact?: () => void): void {
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

        const pos = proj.startPos.clone().lerp(proj.endPos, progress);
        pos.y = proj.startPos.y + (proj.endPos.y - proj.startPos.y) * progress + arcY;
        proj.mesh.position.copy(pos);

        // Orient projectile along flight direction
        const nextProgress = Math.min((currentTime + 0.016 - proj.startTime) / proj.duration, 1);
        const nextPos = proj.startPos.clone().lerp(proj.endPos, nextProgress);
        nextPos.y = proj.startPos.y + (proj.endPos.y - proj.startPos.y) * nextProgress + Math.sin(nextProgress * Math.PI) * height;
        proj.mesh.lookAt(nextPos);

        if (proj.arcHeight && proj.arcHeight > 3) {
          proj.mesh.rotation.x += 0.15;
          proj.mesh.rotation.z += 0.08;
        }

        // Magic orb effects: rotate sparkles + emit trail particles
        const magicColor = (proj.mesh as any)._magicColor;
        if (magicColor !== undefined) {
          // Rotate sparkle ring around the orb
          for (let si = 0; si < 4; si++) {
            const sparkle = proj.mesh.getObjectByName(`sparkle-${si}`);
            if (sparkle) {
              const angle = currentTime * 5 + (si / 4) * Math.PI * 2;
              const r = 0.2 + Math.sin(currentTime * 3) * 0.05;
              sparkle.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
            }
          }
          // Emit trail sparkles behind the projectile
          if (Math.random() < 0.4) {
            const tGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
            const tMat = new THREE.MeshBasicMaterial({
              color: Math.random() > 0.5 ? magicColor : 0xFFFFCC,
              transparent: true, opacity: 0.8,
            });
            const tParticle = new THREE.Mesh(tGeo, tMat);
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

  /**
   * Show damage effect at target position (red particles bursting outward)
   */
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
    const remaining: typeof this.deferredEffects = [];
    for (const effect of this.deferredEffects) {
      if (now >= effect.executeAt) {
        effect.callback();
      } else {
        remaining.push(effect);
      }
    }
    this.deferredEffects = remaining;
  }

  showDamageEffect(worldPos: { x: number; y: number; z: number }): void {
    const particleCount = 3 + Math.floor(Math.random() * 3); // 3-5 particles

    for (let i = 0; i < particleCount; i++) {
      const particleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      const particleMat = new THREE.MeshBasicMaterial({
        color: 0xff0000, // red
        transparent: true,
        opacity: 1.0,
      });
      const particle = new THREE.Mesh(particleGeo, particleMat);

      particle.position.set(
        worldPos.x + (Math.random() - 0.5) * 0.3,
        worldPos.y + 0.5 + (Math.random() - 0.5) * 0.3,
        worldPos.z + (Math.random() - 0.5) * 0.3
      );

      const velocity = {
        x: (Math.random() - 0.5) * 3,
        y: 1 + Math.random() * 2,
        z: (Math.random() - 0.5) * 3,
      };

      this.scene.add(particle);

      // Animate particle
      let elapsed = 0;
      const animate = () => {
        elapsed += 0.016;
        particle.position.x += velocity.x * 0.016;
        particle.position.y += velocity.y * 0.016;
        particle.position.z += velocity.z * 0.016;
        velocity.y -= 5 * 0.016; // gravity

        particleMat.opacity = Math.max(0, 1 - elapsed / 0.5);

        if (elapsed < 0.5) {
          requestAnimationFrame(animate);
        } else {
          this.scene.remove(particle);
          particleGeo.dispose();
          particleMat.dispose();
        }
      };
      requestAnimationFrame(animate);
    }
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

    // Restore after duration
    setTimeout(() => {
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh && originalMaterials.has(child)) {
          child.material = originalMaterials.get(child)!;
        }
      });
    }, duration * 1000);
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
   * Billboard health bars to face camera (sprites auto-billboard, so this is now a no-op
   * kept for API compatibility in case other elements need billboarding later)
   */
  updateBillboards(_camera: THREE.Camera): void {
    // Sprites are inherently camera-facing — no manual lookAt needed
  }

  dispose(): void {
    // Clean up projectiles
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
    this.deferredEffects = [];

    // Clean up units
    for (const unitId of this.unitMeshes.keys()) {
      this.removeUnit(unitId);
    }

    // Clean up aggro visuals
    this.clearAggroIndicators();
  }

  // ═══════════════════════════════════════════════════════
  //  AGGRO / TARGET INDICATORS
  // ═══════════════════════════════════════════════════════

  /**
   * Call once per frame with the list of active aggro relationships.
   * Each entry: { attackerId, targetId }.
   * This manages the lifecycle of all aggro lines + target rings.
   */
  updateAggroIndicators(aggroList: Array<{ attackerId: string; targetId: string }>, time: number): void {
    const activeAttackerIds = new Set<string>();
    const activeTargetIds = new Set<string>();

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
          color: 0xff4444,
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
          color: 0xff2222,
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
}
