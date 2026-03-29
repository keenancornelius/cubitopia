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
  healthBar: THREE.Mesh;
  healthBarBg: THREE.Mesh;
  label: THREE.Sprite;
  facingAngle: number; // Y-axis rotation angle for movement direction
  lastPosition: THREE.Vector3; // Track previous position for rotation calculations
  // Trebuchet/catapult single-shot fire animation
  trebFireStart: number;            // timestamp when fire was triggered (0 = idle)
  trebPendingTarget: { x: number; y: number; z: number } | null; // queued boulder target
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
  }> = [];
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
    this.buildUnitModel(group, unit.type, playerColor);

    // Text label above head (higher for siege units)
    const isSiege = unit.type === UnitType.TREBUCHET || unit.type === UnitType.CATAPULT;
    const label = this.createLabel(unit.type);
    label.position.y = isSiege ? 2.5 : 1.4;
    group.add(label);

    // Health bar background
    const hbBgGeo = new THREE.PlaneGeometry(isSiege ? 0.9 : 0.6, 0.08);
    const hbBgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const healthBarBg = new THREE.Mesh(hbBgGeo, hbBgMat);
    healthBarBg.position.y = isSiege ? 2.35 : 1.25;
    group.add(healthBarBg);

    // Health bar fill
    const healthRatio = unit.currentHealth / unit.stats.maxHealth;
    const hbWidth = isSiege ? 0.88 : 0.58;
    const hbGeo = new THREE.PlaneGeometry(hbWidth * healthRatio, 0.06);
    const hbColor = healthRatio > 0.5 ? 0x2ecc71 : healthRatio > 0.25 ? 0xf39c12 : 0xe74c3c;
    const hbMat = new THREE.MeshBasicMaterial({ color: hbColor, side: THREE.DoubleSide });
    const healthBar = new THREE.Mesh(hbGeo, hbMat);
    healthBar.position.y = isSiege ? 2.35 : 1.25;
    healthBar.position.z = 0.001;
    healthBar.position.x = -(hbWidth * (1 - healthRatio)) / 2;
    group.add(healthBar);

    // Store reference and add to scene
    this.unitMeshes.set(unit.id, {
      group,
      unitId: unit.id,
      unitType: unit.type,
      healthBar,
      healthBarBg,
      label,
      facingAngle: 0,
      lastPosition: pos.clone(),
      trebFireStart: 0,
      trebPendingTarget: null,
    });
    this.scene.add(group);
  }

  private buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number): void {
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
        // === ASSASSIN — Dark purple cloak, daggers, slim build ===
        const cloakGeo = new THREE.BoxGeometry(0.4, 0.6, 0.4);
        const cloakMat = new THREE.MeshLambertMaterial({ color: 0x1a0033 });
        const cloak = new THREE.Mesh(cloakGeo, cloakMat);
        cloak.position.y = 0.3;
        cloak.castShadow = true;
        group.add(cloak);
        // Dark hood
        const aHood = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.38), new THREE.MeshLambertMaterial({ color: 0x0d001a }));
        aHood.position.y = 0.78;
        group.add(aHood);
        // Glowing eyes
        const eyeMat = new THREE.MeshLambertMaterial({ color: 0xaa00ff, emissive: 0xaa00ff, emissiveIntensity: 0.8 });
        for (const ex of [-0.07, 0.07]) {
          const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), eyeMat);
          eye.position.set(ex, 0.82, 0.18);
          group.add(eye);
        }
        // Oversized wicked daggers — curved blades, poison-drip look
        group.add(makeArmGroup('arm-left', 0x1a0033, -0.25, 0.3));
        group.add(makeArmGroup('arm-right', 0x1a0033, 0.25, 0.3));
        const daggerBladeMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
        const daggerPoisonMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.3 });
        for (const dx of [-0.25, 0.25]) {
          // Long curved blade
          const dBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.08), daggerBladeMat);
          dBlade.position.set(dx, 0.0, 0.12);
          dBlade.rotation.z = dx > 0 ? 0.1 : -0.1; // slight outward curve
          group.add(dBlade);
          // Poison edge glow along blade
          const pEdge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.35, 0.09), daggerPoisonMat);
          pEdge.position.set(dx + (dx > 0 ? 0.03 : -0.03), -0.03, 0.12);
          pEdge.rotation.z = dx > 0 ? 0.1 : -0.1;
          group.add(pEdge);
          // Serrated grip
          const dGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
          dGrip.position.set(dx, 0.25, 0.12);
          group.add(dGrip);
        }
        group.add(makeLegGroup('leg-left', 0x1a0033, -0.1, 0));
        group.add(makeLegGroup('leg-right', 0x1a0033, 0.1, 0));
        break;
      }
      case UnitType.SHIELDBEARER: {
        // === SHIELDBEARER — Massive armor, huge shield, bulky ===
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
        // Helmet
        const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.4), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        helmet.position.y = 0.9;
        group.add(helmet);
        // Visor slit
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.42), new THREE.MeshLambertMaterial({ color: 0x263238 }));
        visor.position.y = 0.9;
        group.add(visor);
        // Massive tower shield — nearly body-sized
        const sbArmLeft = makeArmGroup('arm-left', 0x78909c, -0.35, 0.35);
        const towerShield = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.1), new THREE.MeshLambertMaterial({ color: playerColor }));
        towerShield.position.set(0.18, -0.15, 0.18);
        sbArmLeft.add(towerShield);
        // Reinforced steel bands
        for (const by of [-0.4, 0, 0.25]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.12), new THREE.MeshLambertMaterial({ color: 0x666666 }));
          band.position.set(0.18, by - 0.15, 0.18);
          sbArmLeft.add(band);
        }
        // Large boss with spike
        const sbBoss = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.14), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        sbBoss.position.set(0.18, -0.1, 0.25);
        sbArmLeft.add(sbBoss);
        const sbSpike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
        sbSpike.position.set(0.18, -0.1, 0.34);
        sbArmLeft.add(sbSpike);
        group.add(sbArmLeft);
        // Right arm with short gladius
        const sbArmRight = makeArmGroup('arm-right', 0x78909c, 0.35, 0.35);
        const gladius = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.4), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
        gladius.position.set(0, -0.12, 0.2);
        sbArmRight.add(gladius);
        const gladGuard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.04), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        gladGuard.position.set(0, -0.12, 0.02);
        sbArmRight.add(gladGuard);
        group.add(sbArmRight);
        group.add(makeLegGroup('leg-left', 0x546e7a, -0.15, 0));
        group.add(makeLegGroup('leg-right', 0x546e7a, 0.15, 0));
        break;
      }
      case UnitType.BERSERKER: {
        // === BERSERKER — Bare-chested, war paint, dual axes ===
        const bBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.45), new THREE.MeshLambertMaterial({ color: 0xd4a574 }));
        bBody.position.y = 0.3;
        bBody.castShadow = true;
        group.add(bBody);
        // War paint (red X across chest)
        const paintMat = new THREE.MeshLambertMaterial({ color: 0xd50000 });
        const paintV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.47), paintMat);
        paintV.position.set(0, 0.35, 0);
        paintV.rotation.z = 0.4;
        group.add(paintV);
        const paintV2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.47), paintMat);
        paintV2.position.set(0, 0.35, 0);
        paintV2.rotation.z = -0.4;
        group.add(paintV2);
        // Wild hair
        const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
        hair.position.y = 1.0;
        group.add(hair);
        const bHead = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.35), new THREE.MeshLambertMaterial({ color: 0xd4a574 }));
        bHead.position.y = 0.82;
        group.add(bHead);
        // Rage eyes (glow brighter at low HP — visual handled in update)
        const rEyeMat = new THREE.MeshLambertMaterial({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 0.3 });
        for (const ex of [-0.07, 0.07]) {
          const rEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), rEyeMat);
          rEye.position.set(ex, 0.85, 0.17);
          rEye.name = 'rage-eye';
          group.add(rEye);
        }
        // Oversized dual war axes — massive crescent blades
        group.add(makeArmGroup('arm-left', 0xd4a574, -0.32, 0.3));
        group.add(makeArmGroup('arm-right', 0xd4a574, 0.32, 0.3));
        const axeBladeMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
        const axeHandleMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const axeEdgeMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
        for (const ax of [-0.32, 0.32]) {
          // Long handle
          const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.05), axeHandleMat);
          handle.position.set(ax, 0.05, 0.08);
          group.add(handle);
          // Oversized axe head — main blade
          const bigBlade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.06), axeBladeMat);
          bigBlade.position.set(ax + (ax > 0 ? 0.12 : -0.12), -0.18, 0.08);
          group.add(bigBlade);
          // Sharp edge extension (wider crescent)
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.04), axeEdgeMat);
          edge.position.set(ax + (ax > 0 ? 0.15 : -0.15), -0.28, 0.08);
          group.add(edge);
          // Back spike
          const spike = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), axeBladeMat);
          spike.position.set(ax + (ax > 0 ? -0.08 : 0.08), -0.18, 0.08);
          group.add(spike);
        }
        group.add(makeLegGroup('leg-left', 0x5d4037, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x5d4037, 0.12, 0));
        break;
      }
      case UnitType.BATTLEMAGE: {
        // === BATTLEMAGE — Arcane robes, floating orbs, staff ===
        const bmRobe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), new THREE.MeshLambertMaterial({ color: 0x311b92 }));
        bmRobe.position.y = 0.35;
        bmRobe.castShadow = true;
        group.add(bmRobe);
        // Glowing rune belt
        const runeBelt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.52), new THREE.MeshLambertMaterial({ color: 0x7c4dff, emissive: 0x7c4dff, emissiveIntensity: 0.6 }));
        runeBelt.position.y = 0.15;
        group.add(runeBelt);
        // Head with arcane circlet
        const bmHead = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshLambertMaterial({ color: 0xffdbac }));
        bmHead.position.y = 0.88;
        group.add(bmHead);
        const circlet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.38), new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.3 }));
        circlet.position.y = 1.02;
        group.add(circlet);
        // Staff in right hand
        const staff = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshLambertMaterial({ color: 0x4a148c }));
        staff.position.set(0.3, 0.5, 0);
        group.add(staff);
        // Orb atop staff
        const orbMat = new THREE.MeshLambertMaterial({ color: 0xb388ff, emissive: 0x7c4dff, emissiveIntensity: 0.8 });
        const orb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), orbMat);
        orb.position.set(0.3, 1.05, 0);
        orb.name = 'battlemage-orb';
        group.add(orb);
        group.add(makeArmGroup('arm-left', 0x311b92, -0.3, 0.35));
        group.add(makeArmGroup('arm-right', 0x311b92, 0.3, 0.35));
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
        // Glowing rune on chest (team color, emissive)
        const rune = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.12, 0.02),
          new THREE.MeshBasicMaterial({ color: playerColor, transparent: true, opacity: 0.8 })
        );
        rune.position.set(0, 0.42, 0.23);
        group.add(rune);
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
   * Update health bar for a unit
   */
  updateHealthBar(unit: Unit): void {
    const entry = this.unitMeshes.get(unit.id);
    if (!entry) return;

    // Remove old health bar
    entry.group.remove(entry.healthBar);
    entry.healthBar.geometry.dispose();
    (entry.healthBar.material as THREE.Material).dispose();

    // Create new health bar
    const isSiege = unit.type === UnitType.TREBUCHET || unit.type === UnitType.CATAPULT;
    const healthRatio = unit.currentHealth / unit.stats.maxHealth;
    const hbW = isSiege ? 0.88 : 0.58;
    const hbGeo = new THREE.PlaneGeometry(hbW * Math.max(healthRatio, 0.01), 0.06);
    const hbColor = healthRatio > 0.5 ? 0x2ecc71 : healthRatio > 0.25 ? 0xf39c12 : 0xe74c3c;
    const hbMat = new THREE.MeshBasicMaterial({ color: hbColor, side: THREE.DoubleSide });
    const healthBar = new THREE.Mesh(hbGeo, hbMat);
    healthBar.position.y = isSiege ? 2.35 : 1.15;
    healthBar.position.z = 0.001;
    healthBar.position.x = -(hbW * (1 - healthRatio)) / 2;
    entry.group.add(healthBar);
    entry.healthBar = healthBar;
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

    if (state === 'gathering') {
      this.animateGathering(entry, type, armLeft, armRight, legLeft, legRight, time, unitId);
    } else if (state === 'attacking') {
      this.animateAttacking(entry, type, armLeft, armRight, legLeft, legRight, time, unitId);
    } else if (state === 'building') {
      this.animateBuilding(entry, type, armLeft, armRight, time);
    } else if (state === 'returning') {
      this.animateReturning(entry, armLeft, armRight, legLeft, legRight, time);
      this.showCarryVisual(entry, true);
    } else if (state === 'moving') {
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
        const speed = 3.0; // faster than others — assassin is quick
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
        // Shield bash + short sword combo
        const speed = 2.0;
        const cycle = (time * speed) % 1;
        if (cycle < 0.3) {
          // Shield push: left arm (shield) shoves forward
          const p = cycle / 0.3;
          if (armLeft) armLeft.rotation.x = 0.9 * p;
          if (armRight) armRight.rotation.x = -0.3 * p; // pull sword back
          entry.group.rotation.x = 0.06 * p;
        } else if (cycle < 0.5) {
          // Shield hold, sword stab
          const p = (cycle - 0.3) / 0.2;
          if (armLeft) armLeft.rotation.x = 0.9;
          if (armRight) armRight.rotation.x = -0.3 + 1.3 * p; // stab to +1.0
        } else if (cycle < 0.65) {
          // Hold both extended
          if (armLeft) armLeft.rotation.x = 0.9;
          if (armRight) armRight.rotation.x = 1.0;
          entry.group.rotation.x = 0.06;
          // Slash trail at shield bash + stab
          if (cycle >= 0.5 && cycle < 0.57) this.trySpawnTrail(unitId, 'slash', time, 0.45);
        } else {
          const p = (cycle - 0.65) / 0.35;
          if (armLeft) armLeft.rotation.x = 0.9 * (1 - p);
          if (armRight) armRight.rotation.x = 1.0 * (1 - p);
        }
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
        const speed = 3.5;
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
        // Massive 360° claymore spin slash — slow wind-up, devastating sweep
        const speed = 1.2; // very slow, heavy
        const cycle = (time * speed) % 1;
        if (cycle < 0.3) {
          // Wind-up: raise claymore high overhead, lean back
          const p = cycle / 0.3;
          if (armRight) {
            armRight.rotation.x = -1.4 * p; // arms high behind head
            armRight.rotation.z = -0.3 * p;
          }
          if (armLeft) {
            armLeft.rotation.x = -1.0 * p;
            armLeft.rotation.z = 0.2 * p;
          }
          entry.group.rotation.x = -0.12 * p; // lean back
        } else if (cycle < 0.6) {
          // SPIN SLASH: full body rotation with claymore extended
          const p = (cycle - 0.3) / 0.3;
          const spinAngle = p * Math.PI * 2; // full 360° spin
          entry.group.rotation.y += 0.22; // continuous spin (adds each frame)
          // Arms swing down and outward during spin
          if (armRight) {
            armRight.rotation.x = -1.4 + 3.0 * p; // sweep from behind to extended
            armRight.rotation.z = -0.3 + 0.8 * p;
          }
          if (armLeft) {
            armLeft.rotation.x = -1.0 + 2.2 * p;
            armLeft.rotation.z = 0.2 - 0.5 * p;
          }
          entry.group.rotation.x = -0.12 + 0.2 * p; // lean into sweep
          // Smash trail at peak of spin
          if (cycle >= 0.4 && cycle < 0.48) this.trySpawnTrail(unitId, 'slash', time, 0.45);
          if (cycle >= 0.52 && cycle < 0.58) this.trySpawnTrail(unitId, 'smash', time, 0.5);
        } else if (cycle < 0.75) {
          // Follow-through: arms extended, body settled
          if (armRight) { armRight.rotation.x = 1.6; armRight.rotation.z = 0.5; }
          if (armLeft) { armLeft.rotation.x = 1.2; armLeft.rotation.z = -0.3; }
          entry.group.rotation.x = 0.08;
        } else {
          // Recovery: return to stance
          const p = (cycle - 0.75) / 0.25;
          if (armRight) { armRight.rotation.x = 1.6 * (1 - p); armRight.rotation.z = 0.5 * (1 - p); }
          if (armLeft) { armLeft.rotation.x = 1.2 * (1 - p); armLeft.rotation.z = -0.3 * (1 - p); }
          entry.group.rotation.x = 0.08 * (1 - p);
        }
        // Power stance legs
        if (legLeft) legLeft.rotation.x = cycle >= 0.3 && cycle < 0.65 ? 0.3 : 0;
        if (legRight) legRight.rotation.x = cycle >= 0.3 && cycle < 0.65 ? -0.15 : 0;
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
              entry.trebPendingTarget
            );
            entry.trebPendingTarget = null;
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
  fireArrow(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, targetUnitId?: string): void {
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
    this.projectiles.push({ mesh: group as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.5, targetUnitId });
  }

  /**
   * Fire a magic orb — glowing sphere + orbiting sparkles + trail
   */
  fireMagicOrb(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number, targetUnitId?: string, isAoE = false): void {
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
    this.projectiles.push({ mesh: group as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.6, targetUnitId });
  }

  /**
   * Fire a generic projectile (legacy fallback)
   */
  fireProjectile(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }, color: number = 0xFF8800, targetUnitId?: string): void {
    const arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const arrowMat = new THREE.MeshBasicMaterial({ color });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(fromPos.x, fromPos.y + 0.5, fromPos.z);
    this.scene.add(arrow);
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 0.5, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 0.5, toPos.z);
    this.projectiles.push({ mesh: arrow, startPos, endPos, startTime: performance.now() / 1000, duration: 0.5, targetUnitId });
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
  fireBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }): void {
    // Find the siege unit at this position and queue the fire
    for (const [, entry] of this.unitMeshes) {
      if ((entry.unitType === UnitType.TREBUCHET || entry.unitType === UnitType.CATAPULT) &&
          Math.abs(entry.group.position.x - fromPos.x) < 1.5 &&
          Math.abs(entry.group.position.z - fromPos.z) < 1.5 &&
          !entry.trebPendingTarget) {
        entry.trebFireStart = performance.now() / 1000;
        entry.trebPendingTarget = { ...toPos };
        return;
      }
    }
    // Fallback: no matching unit found, fire immediately
    this.spawnBoulder(fromPos, toPos);
  }

  /** Actually spawn the boulder projectile (called at the animation release point) */
  private spawnBoulder(fromPos: { x: number; y: number; z: number }, toPos: { x: number; y: number; z: number }): void {
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
    this.projectiles.push({ mesh: boulderGroup as any, startPos, endPos, startTime: performance.now() / 1000, duration: 0.9, arcHeight: 5 });
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
   * Billboard health bars to face camera
   */
  updateBillboards(camera: THREE.Camera): void {
    for (const entry of this.unitMeshes.values()) {
      entry.healthBar.lookAt(camera.position);
      entry.healthBarBg.lookAt(camera.position);
    }
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
