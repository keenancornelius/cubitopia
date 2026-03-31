// ============================================
// CUBITOPIA - Unit Renderer
// Renders units as small voxel figures on the map
// ============================================

import * as THREE from 'three';
import { Unit, UnitType, HexCoord, ElementType } from '../types';
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
  // Knockback animation guard — while set, setWorldPosition won't override the position
  _knockbackUntil: number; // timestamp (ms) when knockback animation ends (0 = not active)
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
      _knockbackUntil: 0,
    });
    this.scene.add(group);
  }

  static buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number): void {
    // Helper: create an arm group with a mesh inside, so weapons can be children of the arm
    const makeArmGroup = (name: string, color: number, posX: number, posY: number): THREE.Group => {
      const armGroup = new THREE.Group();
      armGroup.name = name;
      armGroup.position.set(posX, posY, 0);
      const mat = new THREE.MeshLambertMaterial({ color });
      // Upper arm (humerus) — wider, attached at shoulder pivot
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.11), mat);
      upper.position.y = -0.04;
      upper.name = `${name}-upper`;
      armGroup.add(upper);
      // Elbow joint group — pivot point for forearm bend
      const elbowGroup = new THREE.Group();
      elbowGroup.name = `${name}-elbow`;
      elbowGroup.position.y = -0.13;
      // Forearm — slightly thinner
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.09), mat);
      forearm.position.y = -0.08;
      forearm.name = `${name}-forearm`;
      elbowGroup.add(forearm);
      // Hand — small block at end of forearm
      const handMat = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // skin tone
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), handMat);
      hand.position.y = -0.18;
      hand.name = `${name}-hand`;
      elbowGroup.add(hand);
      armGroup.add(elbowGroup);
      return armGroup;
    };

    // Helper: create a leg group with thigh, knee, shin, foot
    const makeLegGroup = (name: string, color: number, posX: number, posY: number): THREE.Group => {
      const legGroup = new THREE.Group();
      legGroup.name = name;
      legGroup.position.set(posX, posY, 0);
      const mat = new THREE.MeshLambertMaterial({ color });
      // Thigh — upper leg, wider
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.13), mat);
      thigh.position.y = -0.03;
      thigh.name = `${name}-thigh`;
      legGroup.add(thigh);
      // Knee joint group — pivot for lower leg
      const kneeGroup = new THREE.Group();
      kneeGroup.name = `${name}-knee`;
      kneeGroup.position.y = -0.12;
      // Knee cap — small protruding block
      const kneeCap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), mat);
      kneeCap.position.set(0, 0, 0.03);
      kneeCap.name = `${name}-kneecap`;
      kneeGroup.add(kneeCap);
      // Shin — lower leg, slightly thinner
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.11), mat);
      shin.position.y = -0.09;
      shin.name = `${name}-shin`;
      kneeGroup.add(shin);
      // Foot — flat block angled forward
      const footMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 }); // dark brown boot
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.16), footMat);
      foot.position.set(0, -0.18, 0.03); // extends forward
      foot.name = `${name}-foot`;
      kneeGroup.add(foot);
      legGroup.add(kneeGroup);
      return legGroup;
    };

    switch (type) {
      case UnitType.WARRIOR: {
        // === WARRIOR — Armored Knight with broadsword & buckler ===
        // The backbone melee unit. Medium plate armor, distinctive helm with team plume.

        // --- Shared materials ---
        const wPlateMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e }); // polished steel
        const wPlateHiMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd }); // bright steel highlight
        const wPlateDkMat = new THREE.MeshLambertMaterial({ color: 0x757575 }); // shadow steel
        const wGoldMat = new THREE.MeshLambertMaterial({ color: 0xb8860b }); // brass/gold
        const wGoldBright = new THREE.MeshLambertMaterial({ color: 0xffd700 }); // bright gold
        const wLeatherMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 }); // dark leather
        const wTeamMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const wBladeMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }); // polished blade
        const wBlackMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a }); // visor slits
        const wChainMat = new THREE.MeshLambertMaterial({ color: 0x808080 }); // chainmail

        // ─── PASS 1: SILHOUETTE — medium build, solid fighter ───
        // Core torso
        const wBody = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.60, 0.46), wPlateMat);
        wBody.position.y = 0.32; wBody.castShadow = true;
        group.add(wBody);

        // ─── PASS 2: LAYERING — breastplate, mail, tassets ───
        // Upper breastplate (raised, lighter)
        const wBreast = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.38), wPlateHiMat);
        wBreast.position.set(0, 0.48, 0.02);
        group.add(wBreast);
        // Lower breastplate (abs section)
        const wBreastLow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.36), wPlateMat);
        wBreastLow.position.set(0, 0.30, 0.03);
        group.add(wBreastLow);
        // Chainmail visible at sides (between plates)
        for (const cx of [-0.24, 0.24]) {
          const chain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.20), wChainMat);
          chain.position.set(cx, 0.38, 0);
          group.add(chain);
        }
        // Gorget (throat)
        const wGorget = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.36), wPlateDkMat);
        wGorget.position.y = 0.64;
        group.add(wGorget);
        // Tassets (armored hip flaps, 2 front)
        for (const tx of [-0.14, 0.14]) {
          const tasset = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.10), wPlateMat);
          tasset.position.set(tx, 0.10, 0.16);
          group.add(tasset);
          const tRivet = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), wGoldMat);
          tRivet.position.set(tx, 0.14, 0.22);
          group.add(tRivet);
        }
        // Pauldrons — two-tier on each shoulder
        for (const px of [-0.32, 0.32]) {
          const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.09, 0.24), wPlateMat);
          p1.position.set(px, 0.58, 0);
          group.add(p1);
          const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.20), wPlateHiMat);
          p2.position.set(px, 0.64, 0);
          group.add(p2);
          // Gold trim on lower edge
          const pTrim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.04), wGoldMat);
          pTrim.position.set(px, 0.55, 0.10);
          group.add(pTrim);
        }

        // ─── PASS 3: ORNAMENTATION — belt, emblem, studs, plume ───
        // Leather belt
        const wBelt = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.07, 0.48), wLeatherMat);
        wBelt.position.y = 0.18;
        group.add(wBelt);
        // Belt buckle (gold)
        const wBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.05), wGoldBright);
        wBuckle.position.set(0, 0.18, 0.24);
        group.add(wBuckle);
        // Team-color tabard front (hangs from belt)
        const wTabard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), wTeamMat);
        wTabard.position.set(0, 0.08, 0.22);
        group.add(wTabard);
        // Gold tabard border
        const wTabBorder = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.05), wGoldMat);
        wTabBorder.position.set(0, 0.02, 0.22);
        group.add(wTabBorder);
        // Chest emblem — team-color cross
        const wEmbH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.40), wTeamMat);
        wEmbH.position.set(0, 0.48, 0);
        group.add(wEmbH);
        const wEmbV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.40), wTeamMat);
        wEmbV.position.set(0, 0.48, 0);
        group.add(wEmbV);
        // Rivets along breastplate
        for (const ry of [0.38, 0.50]) {
          for (const rx of [-0.20, 0.20]) {
            const stud = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), wGoldMat);
            stud.position.set(rx, ry, 0.20);
            group.add(stud);
          }
        }

        // ─── HEAD: Knight's Bascinet Helm ───
        // Helm shell
        const wHelm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.38), wPlateMat);
        wHelm.position.y = 0.88;
        group.add(wHelm);
        // Faceplate (snout/visor, slightly forward)
        const wFace = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.20, 0.06), wPlateDkMat);
        wFace.position.set(0, 0.84, 0.18);
        group.add(wFace);
        // Visor slit (horizontal)
        const wVisorH = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.07), wBlackMat);
        wVisorH.position.set(0, 0.87, 0.19);
        group.add(wVisorH);
        // Breathing holes (small dots on lower faceplate)
        for (let bi = 0; bi < 3; bi++) {
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.07), wBlackMat);
          hole.position.set(-0.06 + bi * 0.06, 0.79, 0.19);
          group.add(hole);
        }
        // Helm crest ridge (front to back)
        const wCrest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.30), wPlateHiMat);
        wCrest.position.set(0, 1.06, -0.02);
        group.add(wCrest);
        // Team-color plume (tall, mounted on crest)
        const wPlume = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.24), wTeamMat);
        wPlume.position.set(0, 1.12, -0.04);
        group.add(wPlume);
        // Plume gold base mount
        const wPlumeBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), wGoldMat);
        wPlumeBase.position.set(0, 1.02, 0);
        group.add(wPlumeBase);
        // Gold band around brow
        const wBrowBand = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.035, 0.04), wGoldMat);
        wBrowBand.position.set(0, 0.94, 0.17);
        group.add(wBrowBand);
        // Cheek guards
        for (const cgx of [-0.16, 0.16]) {
          const guard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.08), wPlateMat);
          guard.position.set(cgx, 0.80, 0.12);
          group.add(guard);
        }

        // ─── PASS 4: WEAPONS — Broadsword + Buckler ───
        // RIGHT ARM — Broadsword (tilted 25° forward)
        const armRight = makeArmGroup('arm-right', 0x9e9e9e, 0.3, 0.55);
        const wElbowR = armRight.getObjectByName('arm-right-elbow')!;
        const wSwordGrp = new THREE.Group();
        wSwordGrp.rotation.x = 0.436; // 25° forward tilt
        wElbowR.add(wSwordGrp);
        // Blade — broad, imposing
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.05), wBladeMat);
        blade.position.set(0, 0.28, 0);
        wSwordGrp.add(blade);
        // Fuller groove
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 0.06), new THREE.MeshLambertMaterial({ color: 0x999999 }));
        fuller.position.set(0, 0.30, 0);
        wSwordGrp.add(fuller);
        // Edge highlights
        for (const ex of [-0.065, 0.065]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.80, 0.06), new THREE.MeshLambertMaterial({ color: 0xffffff }));
          edge.position.set(ex, 0.28, 0);
          wSwordGrp.add(edge);
        }
        // Blade tip (narrowing)
        const wTip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.04), wBladeMat);
        wTip.position.set(0, 0.73, 0);
        wSwordGrp.add(wTip);
        // Crossguard (gold, ornate)
        const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.06), wGoldBright);
        crossguard.position.set(0, -0.16, 0);
        wSwordGrp.add(crossguard);
        // Guard tips (downturned)
        for (const gx of [-0.13, 0.13]) {
          const gTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.05), wGoldMat);
          gTip.position.set(gx, -0.20, 0);
          wSwordGrp.add(gTip);
        }
        // Guard center boss
        const wGuardBoss = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 6, 6), wGoldBright
        );
        wGuardBoss.position.set(0, -0.16, 0.04);
        wSwordGrp.add(wGuardBoss);
        // Leather grip
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), wLeatherMat);
        grip.position.set(0, -0.25, 0);
        wSwordGrp.add(grip);
        // Grip wrap
        for (let wi = 0; wi < 2; wi++) {
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
          wrap.position.set(0, -0.22 + wi * 0.06, 0);
          wSwordGrp.add(wrap);
        }
        // Pommel (round, gold)
        const pommel = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 6, 6), wGoldBright
        );
        pommel.position.set(0, -0.34, 0);
        wSwordGrp.add(pommel);
        group.add(armRight);

        // LEFT ARM — Buckler Shield (round-ish, held forward)
        const armLeft = makeArmGroup('arm-left', 0x9e9e9e, -0.3, 0.55);
        const wElbowL = armLeft.getObjectByName('arm-left-elbow')!;
        // Buckler face (team color, multi-layered)
        const bucklerMain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.30), wTeamMat);
        bucklerMain.position.set(-0.08, -0.12, 0.08);
        wElbowL.add(bucklerMain);
        // Buckler rim (steel edge)
        const bucklerRim = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.32), wPlateDkMat);
        bucklerRim.position.set(-0.07, -0.12, 0.08);
        wElbowL.add(bucklerRim);
        // Inner face plate (slightly smaller, for depth)
        const bucklerInner = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.24), new THREE.MeshLambertMaterial({
          color: (playerColor as number) !== 0 ? playerColor : 0x4488cc
        }));
        bucklerInner.position.set(-0.09, -0.12, 0.08);
        wElbowL.add(bucklerInner);
        // Central boss (gold sphere)
        const bucklerBoss = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 6), wGoldBright
        );
        bucklerBoss.position.set(-0.11, -0.12, 0.08);
        wElbowL.add(bucklerBoss);
        // Boss spike
        const bossSpike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), wPlateMat);
        bossSpike.position.set(-0.15, -0.12, 0.08);
        wElbowL.add(bossSpike);
        // Gold cross emblem on buckler face
        const bkEmbH = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.16), wGoldMat);
        bkEmbH.position.set(-0.09, -0.12, 0.08);
        wElbowL.add(bkEmbH);
        const bkEmbV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.03), wGoldMat);
        bkEmbV.position.set(-0.09, -0.12, 0.08);
        wElbowL.add(bkEmbV);
        group.add(armLeft);

        // ─── PASS 5: BACK DETAIL ───
        // Backplate
        const wBackplate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.05), wPlateMat);
        wBackplate.position.set(0, 0.40, -0.22);
        group.add(wBackplate);
        // Spine ridge
        const wSpine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.30, 0.03), wPlateHiMat);
        wSpine.position.set(0, 0.40, -0.25);
        group.add(wSpine);
        // Gold trim at top edge
        const wBackTrim = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.04), wGoldMat);
        wBackTrim.position.set(0, 0.57, -0.22);
        group.add(wBackTrim);
        // Rear tabard (team color, shorter)
        const wRearTab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), wTeamMat);
        wRearTab.position.set(0, 0.10, -0.24);
        group.add(wRearTab);
        const wRearTabTrim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.05), wGoldMat);
        wRearTabTrim.position.set(0, 0.04, -0.24);
        group.add(wRearTabTrim);
        // Helm nape guard
        const wNape = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.05), wPlateMat);
        wNape.position.set(0, 0.82, -0.18);
        group.add(wNape);
        // Back cross emblem (gold inlay)
        const wBkCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.04), wGoldMat);
        wBkCrossH.position.set(0, 0.42, -0.25);
        group.add(wBkCrossH);
        const wBkCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.04), wGoldMat);
        wBkCrossV.position.set(0, 0.42, -0.25);
        group.add(wBkCrossV);

        // ─── LEGS (steel greaves) ───
        group.add(makeLegGroup('leg-left', 0x757575, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x757575, 0.12, 0));
        // Knee cops
        for (const kx of [-0.12, 0.12]) {
          const kneeCop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.10), wPlateHiMat);
          kneeCop.position.set(kx, 0.18, 0.05);
          group.add(kneeCop);
        }
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

        // Left arm (holds bow — bow faces forward, attached at hand)
        const archerArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.52);
        const archerElbowL = archerArmLeft.getObjectByName('arm-left-elbow')!;
        const bowGeo = new THREE.TorusGeometry(0.22, 0.03, 4, 8, Math.PI);
        const bowMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const bow = new THREE.Mesh(bowGeo, bowMat);
        bow.position.set(0, -0.16, 0.15);
        bow.rotation.x = Math.PI / 2;
        archerElbowL.add(bow);
        group.add(archerArmLeft);

        // Right arm (draws string)
        const archerArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.52);
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

        // Right arm with oversized jousting lance (held in hand)
        const riderArmRight = makeArmGroup('arm-right', 0xb0b0b0, 0.25, 0.55);
        const riderElbowR = riderArmRight.getObjectByName('arm-right-elbow')!;
        const lanceShaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.2), new THREE.MeshLambertMaterial({ color: 0xbdc3c7 }));
        lanceShaft.position.set(0, -0.16, 0.55);
        riderElbowR.add(lanceShaft);
        const lanceTip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
        lanceTip.position.set(0, -0.16, 1.2);
        riderElbowR.add(lanceTip);
        const vamplate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), new THREE.MeshLambertMaterial({ color: playerColor }));
        vamplate.position.set(0, -0.16, 0.1);
        riderElbowR.add(vamplate);
        const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: playerColor }));
        pennant.position.set(0.08, -0.16, 1.0);
        riderElbowR.add(pennant);
        group.add(riderArmRight);

        // Left arm with kite shield (held in hand)
        const riderArmLeft = makeArmGroup('arm-left', 0xb0b0b0, -0.25, 0.55);
        const riderElbowL = riderArmLeft.getObjectByName('arm-left-elbow')!;
        const kiteShield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.25), new THREE.MeshLambertMaterial({ color: playerColor }));
        kiteShield.position.set(-0.06, -0.16, 0.08);
        riderElbowL.add(kiteShield);
        const kiteBoss = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xf1c40f }));
        kiteBoss.position.set(-0.08, -0.16, 0.08);
        riderElbowL.add(kiteBoss);
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
        // === PALADIN — Holy knight, ornate gilded plate, great mace, tower shield, divine aura ===

        // --- TORSO: Layered ornate plate armor ---
        const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.65, 0.5), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
        pBody.position.y = 0.32;
        pBody.castShadow = true;
        group.add(pBody);
        // Polished front breastplate (bright steel, slightly forward)
        const pBreast = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.45, 0.08), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
        pBreast.position.set(0, 0.38, 0.26);
        group.add(pBreast);
        // Gold chest emblem — sunburst cross
        const pEmbV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pEmbV.position.set(0, 0.38, 0.31);
        group.add(pEmbV);
        const pEmbH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pEmbH.position.set(0, 0.38, 0.31);
        group.add(pEmbH);
        // Sunburst rays (4 diagonal)
        for (const rz of [-0.78, 0.78, -2.36, 2.36]) {
          const ray = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          ray.position.set(0, 0.38, 0.31);
          ray.rotation.z = rz;
          group.add(ray);
        }
        // Belt with ornate buckle
        const pBelt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.54), new THREE.MeshLambertMaterial({ color: 0x6d4c41 }));
        pBelt.position.set(0, 0.05, 0);
        group.add(pBelt);
        const pBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pBuckle.position.set(0, 0.05, 0.28);
        group.add(pBuckle);
        // Gorget (neck armor)
        const pGorget = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.46), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
        pGorget.position.set(0, 0.68, 0);
        group.add(pGorget);
        // Tabard / battle skirt — front (team color)
        const pTabard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        pTabard.position.set(0, -0.05, 0.22);
        group.add(pTabard);
        // Tabard / battle skirt — back (team color, matching front)
        const pTabardBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        pTabardBack.position.set(0, -0.07, -0.22);
        group.add(pTabardBack);

        // --- BACK DECORATIONS: polished backplate, spine ridge, holy symbol ---
        // Polished back plate (bright steel)
        const pBackPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.08), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
        pBackPlate.position.set(0, 0.38, -0.26);
        group.add(pBackPlate);
        // Raised spine ridge (center of back)
        const pSpine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.06), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
        pSpine.position.set(0, 0.36, -0.30);
        group.add(pSpine);
        // Gold cross emblem on back (matching front sunburst cross)
        const pBackCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pBackCrossV.position.set(0, 0.38, -0.31);
        group.add(pBackCrossV);
        const pBackCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pBackCrossH.position.set(0, 0.40, -0.31);
        group.add(pBackCrossH);
        // Gold trim lines flanking spine (decorative channels)
        for (const bx of [-0.12, 0.12]) {
          const channel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          channel.position.set(bx, 0.36, -0.31);
          group.add(channel);
        }
        // Back of helm — raised guard plate
        const pHelmBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
        pHelmBack.position.set(0, 0.88, -0.24);
        group.add(pHelmBack);
        // Gold trim on back of helm
        const pHelmBackTrim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pHelmBackTrim.position.set(0, 0.80, -0.24);
        group.add(pHelmBackTrim);

        // --- SHOULDER PAULDRONS: massive ornate layered plates ---
        for (const sx of [-0.36, 0.36]) {
          // Main pauldron
          const ppMain = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
          ppMain.position.set(sx, 0.68, 0);
          group.add(ppMain);
          // Gold trim on bottom edge
          const ppTrim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.4), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          ppTrim.position.set(sx, 0.60, 0);
          group.add(ppTrim);
          // Raised top ridge
          const ppRidge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.3), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
          ppRidge.position.set(sx, 0.78, 0);
          group.add(ppRidge);
          // Gold stud on pauldron face
          const ppStud = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          ppStud.position.set(sx, 0.68, 0.18);
          group.add(ppStud);
        }

        // --- HELMET: Great helm with crown crest, visor, cheek plates ---
        // Main helm
        const pHelm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
        pHelm.position.y = 0.96;
        group.add(pHelm);
        // Darker faceplate
        const pFace = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.32, 0.08), new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
        pFace.position.set(0, 0.92, 0.24);
        group.add(pFace);
        // Eye slit (dark)
        const pEyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.09), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        pEyeSlit.position.set(0, 0.96, 0.26);
        group.add(pEyeSlit);
        // Breathing holes (3 small dots below visor)
        for (let bx = -0.06; bx <= 0.06; bx += 0.06) {
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.09), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
          hole.position.set(bx, 0.86, 0.26);
          group.add(hole);
        }
        // Crown crest on top — 5 points like a crown
        for (let ci = -2; ci <= 2; ci++) {
          const h = ci === 0 ? 0.14 : (Math.abs(ci) === 1 ? 0.10 : 0.07);
          const crestPt = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          crestPt.position.set(ci * 0.08, 1.19 + h / 2, 0);
          group.add(crestPt);
        }
        // Crown base band
        const crownBand = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.48), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        crownBand.position.set(0, 1.19, 0);
        group.add(crownBand);
        // Cheek guards
        for (const cx of [-0.24, 0.24]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
          cheek.position.set(cx, 0.88, 0.2);
          group.add(cheek);
        }

        // --- LEFT ARM + TOWER SHIELD (unique design) — pushed out to avoid body clipping ---
        const pArmL = makeArmGroup('arm-left', 0xc0c0c0, -0.36, 0.55);
        // Shield body — tall tower shield (offset further from arm)
        const shZ = 0.32; // shield Z offset — farther out from body
        const shX = 0.18; // shield X offset
        const pShield = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.1), new THREE.MeshLambertMaterial({ color: playerColor }));
        pShield.position.set(shX, -0.05, shZ);
        pArmL.add(pShield);
        // Steel rim — top
        const pRimT = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
        pRimT.position.set(shX, 0.35, shZ);
        pArmL.add(pRimT);
        // Steel rim — bottom
        const pRimB = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
        pRimB.position.set(shX, -0.45, shZ);
        pArmL.add(pRimB);
        // Steel rim — sides
        for (const rx of [-0.28, 0.28]) {
          const pRimS = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.12), new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
          pRimS.position.set(shX + rx, -0.05, shZ);
          pArmL.add(pRimS);
        }
        // Large golden sun boss
        const pBoss = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.14), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pBoss.position.set(shX, 0.05, shZ + 0.07);
        pArmL.add(pBoss);
        // Sun rays from boss (8 directions)
        for (let ri = 0; ri < 8; ri++) {
          const angle = (ri / 8) * Math.PI * 2;
          const rayLen = 0.15;
          const sunRay = new THREE.Mesh(new THREE.BoxGeometry(0.04, rayLen, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          sunRay.position.set(
            shX + Math.sin(angle) * 0.16,
            0.05 + Math.cos(angle) * 0.16,
            shZ + 0.08
          );
          sunRay.rotation.z = -angle;
          pArmL.add(sunRay);
        }
        // Vertical gold stripe on shield
        const pStripeV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pStripeV.position.set(shX, -0.05, shZ + 0.06);
        pArmL.add(pStripeV);
        // Horizontal gold stripe
        const pStripeH = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pStripeH.position.set(shX, 0.05, shZ + 0.06);
        pArmL.add(pStripeH);
        group.add(pArmL);

        // --- RIGHT ARM + GREAT MACE (ornate holy weapon — held in hand) ---
        const pArmR = makeArmGroup('arm-right', 0xc0c0c0, 0.3, 0.55);
        const pElbowR = pArmR.getObjectByName('arm-right-elbow')!;
        // Long mace handle (dark wood with gold wrap)
        const pMHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        pMHandle.position.set(0, -0.16, 0.28);
        pElbowR.add(pMHandle);
        // Gold grip wrapping (two bands)
        for (const gz of [0.1, 0.2]) {
          const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          grip.position.set(0, -0.16, gz);
          pElbowR.add(grip);
        }
        // Pommel (gold ball at base)
        const pPommel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pPommel.position.set(0, -0.16, 0.02);
        pElbowR.add(pPommel);
        // Mace head — large ornate flanged ball (bright steel)
        const pMHead = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
        pMHead.position.set(0, -0.16, 0.57);
        pElbowR.add(pMHead);
        // 6 big flanges radiating from mace head
        const flMat = new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });
        const flangePositions: [number, number][] = [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12], [0.08, 0.08], [-0.08, -0.08]];
        for (const [fx, fy] of flangePositions) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.16), flMat);
          fl.position.set(fx, -0.16 + fy, 0.57);
          pElbowR.add(fl);
        }
        // Gold cap on mace tip
        const pMTip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        pMTip.position.set(0, -0.16, 0.68);
        pElbowR.add(pMTip);
        group.add(pArmR);

        // --- LEGS with ornate greaves ---
        group.add(makeLegGroup('leg-left', 0xc0c0c0, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0xc0c0c0, 0.12, 0));
        // Knee guards (gold-trimmed)
        for (const kx of [-0.12, 0.12]) {
          const knee = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }));
          knee.position.set(kx, 0.05, 0.08);
          group.add(knee);
          const kneeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.13), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          kneeTrim.position.set(kx, 0.02, 0.08);
          group.add(kneeTrim);
        }

        // --- DIVINE AURA: glowing holy light ring at feet + halo + shimmer motes ---
        // Ground aura ring — circular shape made from radial box segments
        const auraRingGroup = new THREE.Group();
        auraRingGroup.name = 'paladin-aura-ring';
        auraRingGroup.position.y = 0.01;
        const auraMat = new THREE.MeshBasicMaterial({ color: 0xfff8e1, transparent: true, opacity: 0.15 });
        const AURA_SEGMENTS = 16;
        const AURA_RADIUS = 0.6;
        for (let ai = 0; ai < AURA_SEGMENTS; ai++) {
          const aAngle = (ai / AURA_SEGMENTS) * Math.PI * 2;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.18), auraMat);
          seg.position.set(Math.cos(aAngle) * AURA_RADIUS, 0, Math.sin(aAngle) * AURA_RADIUS);
          seg.rotation.y = aAngle;
          auraRingGroup.add(seg);
        }
        // Fill center with a slightly transparent disc
        const auraCenter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.8), new THREE.MeshBasicMaterial({ color: 0xfff8e1, transparent: true, opacity: 0.08 }));
        auraRingGroup.add(auraCenter);
        group.add(auraRingGroup);

        // Halo above head — golden ring made from box segments (NOT a solid square)
        const haloGroup = new THREE.Group();
        haloGroup.name = 'paladin-halo';
        haloGroup.position.y = 1.45;
        const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.65 });
        (haloMat as any).emissiveIntensity = 0.8; // for animation lookup
        const HALO_SEGMENTS = 12;
        const HALO_RADIUS = 0.22;
        for (let hi = 0; hi < HALO_SEGMENTS; hi++) {
          const hAngle = (hi / HALO_SEGMENTS) * Math.PI * 2;
          const hSeg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), haloMat);
          hSeg.position.set(Math.cos(hAngle) * HALO_RADIUS, 0, Math.sin(hAngle) * HALO_RADIUS);
          haloGroup.add(hSeg);
        }
        group.add(haloGroup);

        // 4 small shimmer motes orbiting the paladin (animated in animateUnit)
        for (let mi = 0; mi < 4; mi++) {
          const mote = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.04),
            new THREE.MeshBasicMaterial({ color: 0xfff8e1, transparent: true, opacity: 0.5 })
          );
          mote.name = `paladin-mote-${mi}`;
          const a = (mi / 4) * Math.PI * 2;
          mote.position.set(Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5);
          group.add(mote);
        }
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
        const bldArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50);
        const bldArmRightElbow = bldArmRight.getObjectByName('arm-right-elbow')!;
        const handleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.4);
        const handleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.16, 0.2); // hand end, extending forward
        bldArmRightElbow.add(handle);
        const hammerGeo = new THREE.BoxGeometry(0.15, 0.12, 0.12);
        const hammerMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
        const hammer = new THREE.Mesh(hammerGeo, hammerMat);
        hammer.position.set(0, -0.16, 0.42); // head at end of handle
        bldArmRightElbow.add(hammer);
        group.add(bldArmRight);

        // Left arm
        const bldArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50);
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
        const lumArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50);
        const lumArmRightElbow = lumArmRight.getObjectByName('arm-right-elbow')!;
        const axeHandleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
        const axeHandleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const axeHandle = new THREE.Mesh(axeHandleGeo, axeHandleMat);
        axeHandle.position.set(0, -0.16, 0.25); // hand end, extending forward
        lumArmRightElbow.add(axeHandle);
        const axeHeadGeo = new THREE.BoxGeometry(0.2, 0.15, 0.06);
        const axeHeadMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const axeHead = new THREE.Mesh(axeHeadGeo, axeHeadMat);
        axeHead.position.set(0, -0.16, 0.5); // blade at end of handle
        lumArmRightElbow.add(axeHead);
        group.add(lumArmRight);

        // Left arm
        const lumArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50);
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
        const vilArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50);
        const vilArmRightElbow = vilArmRight.getObjectByName('arm-right-elbow')!;
        const scytheHandleGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
        const scytheHandleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const scytheHandle = new THREE.Mesh(scytheHandleGeo, scytheHandleMat);
        scytheHandle.position.set(0, -0.16, 0.3); // hand end, extending forward
        vilArmRightElbow.add(scytheHandle);
        const bladeGeo = new THREE.BoxGeometry(0.28, 0.04, 0.08);
        const bladeMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(0.12, -0.16, 0.6); // curved blade at tip
        blade.rotation.y = 0.3; // angled outward like a scythe
        vilArmRightElbow.add(blade);
        group.add(vilArmRight);

        // Left arm
        const vilArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50);
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
        // === HEALER — Ornate cleric with flowing robes, healing staff, crystal focus ===

        // --- TORSO: layered white/ivory robes with green trim ---
        const hRobe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.65, 0.44), new THREE.MeshLambertMaterial({ color: 0xf5f5f0 }));
        hRobe.position.y = 0.32;
        hRobe.castShadow = true;
        group.add(hRobe);
        // Inner robe layer (slightly darker, peeks at edges)
        const hInner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.38), new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }));
        hInner.position.set(0, 0.32, 0.04);
        group.add(hInner);
        // Front robe panel — open collar showing inner layer
        const hFrontPanel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.06), new THREE.MeshLambertMaterial({ color: 0xe0e0d8 }));
        hFrontPanel.position.set(0, 0.34, 0.24);
        group.add(hFrontPanel);
        // Green trim lines down front opening
        for (const tx of [-0.1, 0.1]) {
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.52, 0.02), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
          trim.position.set(tx, 0.34, 0.26);
          group.add(trim);
        }
        // Green life cross emblem on chest (smaller, elegant)
        const hCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.02), new THREE.MeshLambertMaterial({ color: 0x00e676, emissive: 0x00e676, emissiveIntensity: 0.3 }));
        hCrossV.position.set(0, 0.42, 0.27);
        group.add(hCrossV);
        const hCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.02), new THREE.MeshLambertMaterial({ color: 0x00e676, emissive: 0x00e676, emissiveIntensity: 0.3 }));
        hCrossH.position.set(0, 0.44, 0.27);
        group.add(hCrossH);
        // Ornate belt with team color + gold buckle
        const hBelt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.48), new THREE.MeshLambertMaterial({ color: playerColor }));
        hBelt.position.set(0, 0.06, 0);
        group.add(hBelt);
        const hBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        hBuckle.position.set(0, 0.06, 0.25);
        group.add(hBuckle);
        // Sash hanging from belt (team color, diagonal)
        const hSash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.04), new THREE.MeshLambertMaterial({ color: playerColor }));
        hSash.position.set(0.12, -0.08, 0.2);
        hSash.rotation.z = -0.15;
        group.add(hSash);
        // Flowing robe skirt (wider at bottom)
        const hSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.5), new THREE.MeshLambertMaterial({ color: 0xf0f0e8 }));
        hSkirt.position.set(0, -0.08, 0);
        group.add(hSkirt);
        const hSkirtBottom = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.54), new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }));
        hSkirtBottom.position.set(0, -0.16, 0);
        group.add(hSkirtBottom);
        // Green trim at skirt hem
        const hHemTrim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.03, 0.56), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
        hHemTrim.position.set(0, -0.19, 0);
        group.add(hHemTrim);

        // --- BACK: robe detail, hood drape, embroidered symbol ---
        const hBackPanel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.06), new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }));
        hBackPanel.position.set(0, 0.36, -0.24);
        group.add(hBackPanel);
        // Embroidered green vine pattern on back (vertical + leaf accents)
        const hBackVine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.02), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
        hBackVine.position.set(0, 0.36, -0.28);
        group.add(hBackVine);
        for (const [lx, ly] of [[0.06, 0.48], [-0.06, 0.38], [0.06, 0.28], [-0.06, 0.18]] as [number, number][]) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), new THREE.MeshLambertMaterial({ color: 0x00e676 }));
          leaf.position.set(lx, ly, -0.28);
          group.add(leaf);
        }

        // --- HEAD: warm face, flowing hood ---
        const hHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), new THREE.MeshLambertMaterial({ color: 0xffdbac }));
        hHead.position.y = 0.86;
        group.add(hHead);
        // Kind eyes (warm brown)
        for (const ex of [-0.08, 0.08]) {
          const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
          eye.position.set(ex, 0.89, 0.17);
          group.add(eye);
        }
        // Hood — deep cowl shape with box layers
        const hHoodMain = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.42), new THREE.MeshLambertMaterial({ color: 0xf0f0e8 }));
        hHoodMain.position.y = 0.98;
        group.add(hHoodMain);
        // Hood brow overhang (casts shadow on face)
        const hHoodBrow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }));
        hHoodBrow.position.set(0, 0.98, 0.2);
        group.add(hHoodBrow);
        // Hood back drape (falls behind neck)
        const hHoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.1), new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }));
        hHoodBack.position.set(0, 0.78, -0.22);
        group.add(hHoodBack);
        // Green hood trim
        const hHoodTrim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.44), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
        hHoodTrim.position.y = 0.86;
        group.add(hHoodTrim);

        // --- LEFT ARM: open hand with green glow orb (casting hand) ---
        const hArmL = makeArmGroup('arm-left', 0xf0f0e8, -0.3, 0.52);
        const hArmLElbow = hArmL.getObjectByName('arm-left-elbow')!;
        // Sleeve cuff trim (stays on arm)
        const hCuffL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
        hCuffL.position.set(0, -0.08, 0);
        hArmL.add(hCuffL);
        // Glowing orb floating above palm (emissive green sphere) — move to elbow
        const hPalmOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.7 })
        );
        hPalmOrb.position.set(0, -0.16, 0.08);
        hPalmOrb.name = 'heal-palm-orb';
        hArmLElbow.add(hPalmOrb);
        // Orb outer glow — move to elbow
        const hPalmGlow = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: 0.2, side: THREE.BackSide })
        );
        hPalmGlow.position.set(0, -0.16, 0.08);
        hPalmGlow.name = 'heal-palm-glow';
        hArmLElbow.add(hPalmGlow);
        group.add(hArmL);

        // --- RIGHT ARM: ornate healing staff ---
        const hArmR = makeArmGroup('arm-right', 0xf0f0e8, 0.3, 0.52);
        const hArmRElbow = hArmR.getObjectByName('arm-right-elbow')!;
        // Sleeve cuff trim (stays on arm)
        const hCuffR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), new THREE.MeshLambertMaterial({ color: 0x00c853 }));
        hCuffR.position.set(0, -0.08, 0);
        hArmR.add(hCuffR);
        // Staff wrapper group — tilted forward 25° so it doesn't clip shoulder
        const hStaffGrp = new THREE.Group();
        hStaffGrp.rotation.x = 0.436; // 25 degrees forward tilt
        hArmRElbow.add(hStaffGrp);
        // Staff shaft — dark wood
        const hStaff = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6),
          new THREE.MeshLambertMaterial({ color: 0x5d4037 })
        );
        hStaff.position.set(0, 0.15, 0.1);
        hStaffGrp.add(hStaff);
        // Staff head — golden cradle/cage holding a crystal
        const hCradleRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.08, 0.015, 6, 8),
          new THREE.MeshLambertMaterial({ color: 0xffd700 })
        );
        hCradleRing.position.set(0, 0.75, 0.1);
        hCradleRing.rotation.x = Math.PI / 2;
        hStaffGrp.add(hCradleRing);
        // Four gold prongs curving up to hold crystal
        for (let pi = 0; pi < 4; pi++) {
          const pAngle = (pi / 4) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          prong.position.set(Math.cos(pAngle) * 0.06, 0.82, 0.1 + Math.sin(pAngle) * 0.06);
          prong.rotation.x = Math.sin(pAngle) * 0.2;
          prong.rotation.z = -Math.cos(pAngle) * 0.2;
          hStaffGrp.add(prong);
        }
        // Crystal focus — green glowing sphere atop staff
        const hCrystal = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.85 })
        );
        hCrystal.position.set(0, 0.86, 0.1);
        hCrystal.name = 'heal-crystal';
        hStaffGrp.add(hCrystal);
        // Crystal outer glow
        const hCrystalGlow = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: 0.15, side: THREE.BackSide })
        );
        hCrystalGlow.position.set(0, 0.86, 0.1);
        hCrystalGlow.name = 'heal-crystal-glow';
        hStaffGrp.add(hCrystalGlow);
        // Gold band wraps on staff shaft
        for (const gy of [-0.1, 0.15, 0.4]) {
          const band = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6),
            new THREE.MeshLambertMaterial({ color: 0xffd700 })
          );
          band.position.set(0, gy, 0.1);
          hStaffGrp.add(band);
        }
        group.add(hArmR);

        // --- LEGS (hidden under robe, just peeks of boots) ---
        group.add(makeLegGroup('leg-left', 0x795548, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x795548, 0.12, 0));

        // --- AMBIENT HEAL PARTICLES (2 small green motes orbiting, animated) ---
        for (let mi = 0; mi < 3; mi++) {
          const mote = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: 0.5 })
          );
          mote.name = `healer-mote-${mi}`;
          const a = (mi / 3) * Math.PI * 2;
          mote.position.set(Math.cos(a) * 0.35, 0.5, Math.sin(a) * 0.35);
          group.add(mote);
        }
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
        const aArmL = makeArmGroup('arm-left', 0x1a0033, -0.24, 0.48);
        const aArmLElbow = aArmL.getObjectByName('arm-left-elbow')!;
        const daggerBladeMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
        const daggerPoisonMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.3 });
        // Left dagger blade (extends forward from hand)
        const ldBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        ldBlade.position.set(0, -0.16, 0.25);
        aArmLElbow.add(ldBlade);
        // Left poison edge
        const ldPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        ldPoison.position.set(-0.03, -0.16, 0.25);
        aArmLElbow.add(ldPoison);
        // Left grip
        const ldGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
        ldGrip.position.set(0, -0.16, 0.02);
        aArmLElbow.add(ldGrip);
        group.add(aArmL);
        // RIGHT ARM with WICKED DAGGER
        const aArmR = makeArmGroup('arm-right', 0x1a0033, 0.24, 0.48);
        const aArmRElbow = aArmR.getObjectByName('arm-right-elbow')!;
        const rdBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        rdBlade.position.set(0, -0.16, 0.25);
        aArmRElbow.add(rdBlade);
        const rdPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        rdPoison.position.set(0.03, -0.16, 0.25);
        aArmRElbow.add(rdPoison);
        const rdGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a0033 }));
        rdGrip.position.set(0, -0.16, 0.02);
        aArmRElbow.add(rdGrip);
        group.add(aArmR);
        // Legs — slim, dark
        group.add(makeLegGroup('leg-left', 0x1a0033, -0.1, 0));
        group.add(makeLegGroup('leg-right', 0x1a0033, 0.1, 0));
        break;
      }
      case UnitType.SHIELDBEARER: {
        // === SHIELDBEARER — Bulky ornate plate armor, imposing great helm, heater shield ===
        // All box geometry — voxel aesthetic, but heavily ornamented

        // --- TORSO: layered plate armor ---
        // Inner breastplate
        const sbChest = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 0.55), new THREE.MeshLambertMaterial({ color: 0x78909c }));
        sbChest.position.y = 0.35;
        sbChest.castShadow = true;
        group.add(sbChest);
        // Front plate overlay (slightly protruding, lighter steel)
        const sbFrontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshLambertMaterial({ color: 0x90a4ae }));
        sbFrontPlate.position.set(0, 0.4, 0.28);
        group.add(sbFrontPlate);
        // Belt / waist guard
        const sbBelt = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 0.58), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        sbBelt.position.set(0, 0.05, 0);
        group.add(sbBelt);
        // Belt buckle
        const sbBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        sbBuckle.position.set(0, 0.05, 0.3);
        group.add(sbBuckle);
        // Gorget (neck guard)
        const sbGorget = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.48), new THREE.MeshLambertMaterial({ color: 0x607d8b }));
        sbGorget.position.set(0, 0.72, 0);
        group.add(sbGorget);

        // --- SHOULDER PAULDRONS: big blocky layered plates (team color) ---
        for (const sx of [-0.38, 0.38]) {
          // Main pauldron block
          const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.36), new THREE.MeshLambertMaterial({ color: playerColor }));
          pauldron.position.set(sx, 0.68, 0);
          group.add(pauldron);
          // Pauldron top ridge
          const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.28), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
          ridge.position.set(sx, 0.77, 0);
          group.add(ridge);
          // Pauldron edge trim (gold)
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.03, 0.38), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
          trim.position.set(sx, 0.62, 0);
          group.add(trim);
        }

        // --- HELMET: Great helm with T-visor, crest, and face plate ---
        // Main helm block
        const sbHelm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.46), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        sbHelm.position.y = 0.95;
        group.add(sbHelm);
        // Helm top crest / ridge (raised stripe on top)
        const sbCrest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), new THREE.MeshLambertMaterial({ color: playerColor }));
        sbCrest.position.set(0, 1.2, 0);
        group.add(sbCrest);
        // Face plate (slightly forward, darker)
        const sbFacePlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.08), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
        sbFacePlate.position.set(0, 0.92, 0.25);
        group.add(sbFacePlate);
        // T-shaped visor slit (horizontal bar + vertical bar)
        const sbVisorH = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        sbVisorH.position.set(0, 0.95, 0.28);
        group.add(sbVisorH);
        const sbVisorV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.09), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        sbVisorV.position.set(0, 0.88, 0.28);
        group.add(sbVisorV);
        // Chin guard (protruding lower jaw plate)
        const sbChin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.12), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
        sbChin.position.set(0, 0.76, 0.24);
        group.add(sbChin);
        // Helm side cheek guards
        for (const hx of [-0.24, 0.24]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
          cheek.position.set(hx, 0.88, 0.22);
          group.add(cheek);
        }

        // --- LEFT ARM + HEATER SHIELD ---
        const sbArmLeft = makeArmGroup('arm-left', 0x78909c, -0.35, 0.55);
        const sbArmLeftElbow = sbArmLeft.getObjectByName('arm-left-elbow')!;
        const shieldGroup = new THREE.Group();
        shieldGroup.name = 'shield-group';
        // Main shield body — tall rectangle
        const shMain = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shMain.position.set(0, 0.05, 0);
        shieldGroup.add(shMain);
        // Bottom point — two angled blocks forming the kite point
        const shPointL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shPointL.position.set(-0.07, -0.32, 0);
        shPointL.rotation.z = -0.25;
        shieldGroup.add(shPointL);
        const shPointR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), new THREE.MeshLambertMaterial({ color: playerColor }));
        shPointR.position.set(0.07, -0.32, 0);
        shPointR.rotation.z = 0.25;
        shieldGroup.add(shPointR);
        // Steel rim — top edge
        const shTopRim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x607d8b }));
        shTopRim.position.set(0, 0.35, 0);
        shieldGroup.add(shTopRim);
        // Steel rim — side edges
        for (const rx of [-0.28, 0.28]) {
          const shRim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.1), new THREE.MeshLambertMaterial({ color: 0x607d8b }));
          shRim.position.set(rx, 0.05, 0);
          shieldGroup.add(shRim);
        }
        // Center boss (square, raised)
        const shBoss = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.14), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        shBoss.position.set(0, 0.05, 0.06);
        shieldGroup.add(shBoss);
        // Boss spike
        const shSpike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
        shSpike.position.set(0, 0.05, 0.15);
        shieldGroup.add(shSpike);
        // Gold chevron emblem (upper shield)
        const chevron1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        chevron1.position.set(0, 0.2, 0.01);
        shieldGroup.add(chevron1);
        const chevron2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        chevron2.position.set(0, -0.1, 0.01);
        shieldGroup.add(chevron2);
        // Diagonal cross on lower shield
        const diagL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        diagL.position.set(-0.06, -0.08, 0.01);
        diagL.rotation.z = 0.35;
        shieldGroup.add(diagL);
        const diagR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.09), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
        diagR.position.set(0.06, -0.08, 0.01);
        diagR.rotation.z = -0.35;
        shieldGroup.add(diagR);
        // Position shield in front of arm (move to elbow, change y from -0.1 to -0.12)
        shieldGroup.position.set(0.25, -0.12, 0.3);
        sbArmLeftElbow.add(shieldGroup);
        group.add(sbArmLeft);

        // --- RIGHT ARM (gauntleted fist) ---
        group.add(makeArmGroup('arm-right', 0x78909c, 0.35, 0.55));

        // --- LEGS with armored greaves ---
        group.add(makeLegGroup('leg-left', 0x546e7a, -0.15, 0));
        group.add(makeLegGroup('leg-right', 0x546e7a, 0.15, 0));
        // Knee guards
        for (const kx of [-0.15, 0.15]) {
          const knee = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), new THREE.MeshLambertMaterial({ color: 0x607d8b }));
          knee.position.set(kx, 0.05, 0.08);
          group.add(knee);
        }
        break;
      }
      case UnitType.BERSERKER: {
        // === BERSERKER — Viking Raider: bare-chested Norse berserker with dual bearded axes ===
        // Design: massive bare torso, chainmail skirt, wolf-pelt mantle, horned helm, rune tattoos,
        // dual bearded axes in tilted wrapper groups with blades facing correct chopping direction.

        // --- Shared materials ---
        const bkSkinMat = new THREE.MeshLambertMaterial({ color: 0xd4a574 }); // weathered Norse skin
        const bkSkinShadow = new THREE.MeshLambertMaterial({ color: 0xb8895a }); // muscle shadow
        const bkChainMat = new THREE.MeshLambertMaterial({ color: 0x6d6d6d }); // chainmail
        const bkChainDark = new THREE.MeshLambertMaterial({ color: 0x555555 }); // chainmail shadow
        const bkFurMat = new THREE.MeshLambertMaterial({ color: 0x4e3b2a }); // wolf pelt
        const bkFurLight = new THREE.MeshLambertMaterial({ color: 0x6d5640 }); // lighter fur tufts
        const bkFurDark = new THREE.MeshLambertMaterial({ color: 0x3e2d1c }); // dark fur underside
        const bkLeatherMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 }); // leather straps
        const bkLeatherDark = new THREE.MeshLambertMaterial({ color: 0x3e2723 }); // dark leather
        const bkIronMat = new THREE.MeshLambertMaterial({ color: 0x78909c }); // dark iron
        const bkSteelMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 }); // polished steel edge
        const bkBronzeMat = new THREE.MeshLambertMaterial({ color: 0xcd7f32 }); // bronze fittings
        const bkBoneMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 }); // bone/skull
        const bkPaintMat = new THREE.MeshLambertMaterial({ color: 0x1565c0 }); // woad blue war paint
        const bkRuneMat = new THREE.MeshBasicMaterial({ color: 0x42a5f5, transparent: true, opacity: 0.8 }); // glowing rune
        const bkTeamMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const bkEyeMat = new THREE.MeshBasicMaterial({ color: 0xff1744 }); // rage eyes

        // ─── PASS 1: SILHOUETTE — wide muscular torso, chainmail skirt ───
        // Chainmail skirt (Viking-era byrnie bottom)
        const bkSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.50), bkChainMat);
        bkSkirt.position.y = 0.13; bkSkirt.castShadow = true;
        group.add(bkSkirt);
        // Chainmail detail rows (horizontal lines for ring texture)
        for (const ry of [0.06, 0.14, 0.22]) {
          const row = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.52), bkChainDark);
          row.position.y = ry;
          group.add(row);
        }
        // Leather hem band at bottom of skirt
        const bkHem = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.52), bkLeatherMat);
        bkHem.position.y = 0.02;
        group.add(bkHem);
        // Bare muscular torso (wide, powerful)
        const bkTorso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.50, 0.50), bkSkinMat);
        bkTorso.position.y = 0.48; bkTorso.castShadow = true;
        group.add(bkTorso);

        // ─── PASS 2: LAYERING — muscle definition, chainmail vest, leather harness ───
        // Pectoral slabs (raised muscle definition)
        for (const px of [-0.12, 0.12]) {
          const pec = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.52), bkSkinShadow);
          pec.position.set(px, 0.56, 0);
          group.add(pec);
        }
        // Abdominal ridges (six-pack)
        for (const ay of [0.30, 0.38, 0.46]) {
          const ab = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.52), bkSkinShadow);
          ab.position.set(0, ay, 0);
          group.add(ab);
        }
        // Leather X-harness across chest (two crossed straps)
        const bkStrapA = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.52, 0.52), bkLeatherDark);
        bkStrapA.position.set(0, 0.45, 0); bkStrapA.rotation.z = 0.32;
        group.add(bkStrapA);
        const bkStrapB = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.52, 0.52), bkLeatherDark);
        bkStrapB.position.set(0, 0.45, 0); bkStrapB.rotation.z = -0.32;
        group.add(bkStrapB);
        // Bronze rivets at strap intersections
        for (const rv of [{ x: 0, y: 0.45 }, { x: -0.10, y: 0.58 }, { x: 0.10, y: 0.58 }, { x: -0.10, y: 0.32 }, { x: 0.10, y: 0.32 }]) {
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), bkBronzeMat);
          rivet.position.set(rv.x, rv.y, 0.26);
          group.add(rivet);
        }
        // Leather belt with bronze buckle
        const bkBelt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.52), bkLeatherMat);
        bkBelt.position.y = 0.24;
        group.add(bkBelt);
        const bkBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.04), bkBronzeMat);
        bkBuckle.position.set(0, 0.24, 0.26);
        group.add(bkBuckle);
        // Team-color buckle gem
        const bkBuckleGem = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), bkTeamMat);
        bkBuckleGem.position.set(0, 0.24, 0.29);
        group.add(bkBuckleGem);

        // ─── PASS 3: ORNAMENTATION — woad tattoos, rune marks, skull trophy ───
        // Woad war paint — diagonal slash across left pec
        const bkWoadSlash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 0.52), bkPaintMat);
        bkWoadSlash.position.set(-0.08, 0.50, 0); bkWoadSlash.rotation.z = 0.45;
        group.add(bkWoadSlash);
        // Woad zigzag across right arm area
        const bkWoadZig = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.20, 0.52), bkPaintMat);
        bkWoadZig.position.set(0.18, 0.52, 0); bkWoadZig.rotation.z = -0.35;
        group.add(bkWoadZig);
        // Glowing rune on chest center (Norse bind-rune)
        const bkChestRune = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), bkRuneMat);
        bkChestRune.position.set(0, 0.55, 0.26); bkChestRune.name = 'bk-chest-rune';
        group.add(bkChestRune);
        const bkRuneCross = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.04), bkRuneMat);
        bkRuneCross.position.set(0, 0.55, 0.26);
        group.add(bkRuneCross);
        // Skull trophy dangling from belt (right hip)
        const bkSkull = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.08), bkBoneMat);
        bkSkull.position.set(0.20, 0.16, 0.22);
        group.add(bkSkull);
        const bkSkullJaw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.06), bkBoneMat);
        bkSkullJaw.position.set(0.20, 0.11, 0.24);
        group.add(bkSkullJaw);
        const bkSkullEye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), bkLeatherDark);
        bkSkullEye.position.set(0.18, 0.17, 0.27);
        group.add(bkSkullEye);
        // Bone tooth necklace
        for (const nx of [-0.10, -0.04, 0.04, 0.10]) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), bkBoneMat);
          tooth.position.set(nx, 0.62, 0.26);
          tooth.rotation.z = nx * 0.3;
          group.add(tooth);
        }
        // Hip pouch (left side)
        const bkPouch = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.08), bkLeatherMat);
        bkPouch.position.set(-0.22, 0.18, 0.16);
        group.add(bkPouch);
        const bkPouchFlap = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.09), bkLeatherDark);
        bkPouchFlap.position.set(-0.22, 0.23, 0.16);
        group.add(bkPouchFlap);

        // ─── HEAD — Viking horned helm with face guard ───
        // Base head (skin)
        const bkHead = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), bkSkinMat);
        bkHead.position.y = 0.88;
        group.add(bkHead);
        // Iron spectacle helm (Norse gjermundbu style)
        const bkHelm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.42), bkIronMat);
        bkHelm.position.y = 0.96;
        group.add(bkHelm);
        // Helm dome (rounded top)
        const bkHelmDome = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), bkIronMat);
        bkHelmDome.position.y = 1.06;
        group.add(bkHelmDome);
        // Central helm ridge (nasal + crest)
        const bkNasal = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 0.44), bkIronMat);
        bkNasal.position.y = 0.94;
        group.add(bkNasal);
        // Spectacle eye guards (the distinctive Viking eye rings)
        for (const ex of [-0.09, 0.09]) {
          const eyeRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 8), bkIronMat);
          eyeRing.position.set(ex, 0.90, 0.19);
          eyeRing.rotation.y = Math.PI / 2;
          group.add(eyeRing);
        }
        // Rage eyes glowing through the spectacle holes
        for (const ex of [-0.09, 0.09]) {
          const rageEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), bkEyeMat);
          rageEye.position.set(ex, 0.90, 0.20);
          rageEye.name = 'bk-rage-eye';
          group.add(rageEye);
        }
        // Cheek guards hanging from helm sides
        for (const cx of [-0.20, 0.20]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.12), bkIronMat);
          cheek.position.set(cx, 0.86, 0.06);
          group.add(cheek);
        }
        // Bronze helm trim band
        const bkHelmBand = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.44), bkBronzeMat);
        bkHelmBand.position.y = 0.87;
        group.add(bkHelmBand);
        // HORNS — curved upward and outward (signature Viking silhouette)
        for (const hside of [-1, 1]) {
          // Horn base
          const hornBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), bkBoneMat);
          hornBase.position.set(hside * 0.22, 1.02, -0.04);
          hornBase.rotation.z = hside * -0.5; // angle outward
          hornBase.rotation.x = -0.2; // slight backward tilt
          group.add(hornBase);
          // Horn mid
          const hornMid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.14, 6), bkBoneMat);
          hornMid.position.set(hside * 0.30, 1.12, -0.06);
          hornMid.rotation.z = hside * -0.3;
          hornMid.rotation.x = 0.2; // curve upward
          group.add(hornMid);
          // Horn tip
          const hornTip = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 0.10, 6), bkBoneMat);
          hornTip.position.set(hside * 0.34, 1.22, -0.04);
          hornTip.rotation.z = hside * -0.15;
          hornTip.rotation.x = 0.4; // curve up more
          group.add(hornTip);
        }
        // Wild beard (braided, hanging below chin)
        const bkBeardMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
        const bkBeard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.10), bkBeardMat);
        bkBeard.position.set(0, 0.74, 0.18);
        group.add(bkBeard);
        // Beard braid (hangs lower)
        const bkBraid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.06), bkBeardMat);
        bkBraid.position.set(0, 0.66, 0.20);
        group.add(bkBraid);
        // Bronze beard ring
        const bkBeardRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 8), bkBronzeMat);
        bkBeardRing.position.set(0, 0.68, 0.20);
        group.add(bkBeardRing);

        // ─── PASS 4: WEAPONS — Dual bearded axes in tilted wrapper groups ───
        // Axes are held vertically with forward tilt. Blade orientation:
        // In elbow space (Y=down arm, Z=forward): handle runs along Y (downward from hand),
        // blade is wide on Z (forward-facing cutting edge) and thin on X.
        // This way when arms swing down in a chopping motion, blades face the right way.

        // LEFT ARM with BEARDED AXE
        const bkArmL = makeArmGroup('arm-left', 0xd4a574, -0.38, 0.53);
        const bkElbowL = bkArmL.getObjectByName('arm-left-elbow')!;
        // Leather bracer on forearm
        const bkBracerL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.17), bkLeatherMat);
        bkBracerL.position.set(0, -0.12, 0);
        bkElbowL.add(bkBracerL);
        const bkBracerStudL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), bkBronzeMat);
        bkBracerStudL.position.set(0, -0.12, 0.09);
        bkElbowL.add(bkBracerStudL);
        // Left axe in tilted wrapper group — blade UP (above hand), handle hangs down
        const lAxeGrp = new THREE.Group();
        lAxeGrp.rotation.x = 0.436; // ~25° forward tilt (same as other weapons)
        lAxeGrp.position.set(0, -0.18, 0.06);
        // Handle (dark ash wood, runs along Y — extends upward from hand)
        const lAxeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.70, 6), bkLeatherDark);
        lAxeHandle.position.y = 0.20;
        lAxeGrp.add(lAxeHandle);
        // Leather grip wrap at bottom of handle (where hand grips)
        const lAxeGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 6), bkLeatherMat);
        lAxeGrip.position.y = -0.08;
        lAxeGrp.add(lAxeGrip);
        // Bearded axe head — blade at TOP, extends forward (Z) with cutting edge
        const lAxeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), bkIronMat);
        lAxeBlade.position.set(0, 0.42, 0.08);
        lAxeGrp.add(lAxeBlade);
        // Cutting edge (bright steel, thin, extends further forward)
        const lAxeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.08), bkSteelMat);
        lAxeEdge.position.set(0, 0.42, 0.22);
        lAxeGrp.add(lAxeEdge);
        // Beard extension (the characteristic hook, now upward)
        const lAxeBeard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), bkIronMat);
        lAxeBeard.position.set(0, 0.52, 0.10);
        lAxeGrp.add(lAxeBeard);
        // Back spike (opposite side of blade)
        const lAxeSpike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.10), bkIronMat);
        lAxeSpike.position.set(0, 0.42, -0.10);
        lAxeGrp.add(lAxeSpike);
        // Bronze binding band where head meets handle
        const lAxeBand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 6), bkBronzeMat);
        lAxeBand.position.y = 0.34;
        lAxeGrp.add(lAxeBand);
        // Rune etching on blade face (glowing)
        const lAxeRune = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), bkRuneMat);
        lAxeRune.position.set(0, 0.42, 0.20); lAxeRune.name = 'bk-axe-rune-l';
        lAxeGrp.add(lAxeRune);
        bkElbowL.add(lAxeGrp);
        group.add(bkArmL);

        // RIGHT ARM with BEARDED AXE (mirrored)
        const bkArmR = makeArmGroup('arm-right', 0xd4a574, 0.38, 0.53);
        const bkElbowR = bkArmR.getObjectByName('arm-right-elbow')!;
        // Leather bracer on forearm
        const bkBracerR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.17), bkLeatherMat);
        bkBracerR.position.set(0, -0.12, 0);
        bkElbowR.add(bkBracerR);
        const bkBracerStudR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), bkBronzeMat);
        bkBracerStudR.position.set(0, -0.12, 0.09);
        bkElbowR.add(bkBracerStudR);
        // Right axe in tilted wrapper group
        const rAxeGrp = new THREE.Group();
        rAxeGrp.rotation.x = 0.436; // ~25° forward tilt
        rAxeGrp.position.set(0, -0.18, 0.06);
        // Handle
        const rAxeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.70, 6), bkLeatherDark);
        rAxeHandle.position.y = 0.20;
        rAxeGrp.add(rAxeHandle);
        // Leather grip wrap at bottom (hand position)
        const rAxeGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 6), bkLeatherMat);
        rAxeGrip.position.y = -0.08;
        rAxeGrp.add(rAxeGrip);
        // Bearded axe head at TOP — blade extends forward (Z)
        const rAxeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), bkIronMat);
        rAxeBlade.position.set(0, 0.42, 0.08);
        rAxeGrp.add(rAxeBlade);
        // Cutting edge
        const rAxeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.08), bkSteelMat);
        rAxeEdge.position.set(0, 0.42, 0.22);
        rAxeGrp.add(rAxeEdge);
        // Beard extension (upward hook)
        const rAxeBeard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), bkIronMat);
        rAxeBeard.position.set(0, 0.52, 0.10);
        rAxeGrp.add(rAxeBeard);
        // Back spike
        const rAxeSpike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.10), bkIronMat);
        rAxeSpike.position.set(0, 0.42, -0.10);
        rAxeGrp.add(rAxeSpike);
        // Bronze binding band
        const rAxeBand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 6), bkBronzeMat);
        rAxeBand.position.y = 0.34;
        rAxeGrp.add(rAxeBand);
        // Rune etching on blade
        const rAxeRune = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), bkRuneMat);
        rAxeRune.position.set(0, 0.42, 0.20); rAxeRune.name = 'bk-axe-rune-r';
        rAxeGrp.add(rAxeRune);
        bkElbowR.add(rAxeGrp);
        group.add(bkArmR);

        // ─── PASS 5: BACK DETAIL — wolf pelt cloak, spine tattoo, rear harness ───
        // Wolf pelt mantle across shoulders (thick, ragged)
        const bkMantle = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.30), bkFurMat);
        bkMantle.position.set(0, 0.66, -0.12);
        group.add(bkMantle);
        // Mantle front drape (visible from sides)
        for (const mx of [-0.32, 0.32]) {
          const drape = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.20, 0.14), bkFurMat);
          drape.position.set(mx, 0.60, 0.06);
          group.add(drape);
        }
        // Wolf head trophy on left shoulder (the pelt's head)
        const bkWolfHead = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.14), bkFurDark);
        bkWolfHead.position.set(-0.30, 0.76, -0.06);
        group.add(bkWolfHead);
        const bkWolfSnout = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), bkFurLight);
        bkWolfSnout.position.set(-0.30, 0.74, 0.04);
        group.add(bkWolfSnout);
        // Fur tufts sticking up from mantle
        for (const tx of [-0.20, 0, 0.20]) {
          const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.06), bkFurLight);
          tuft.position.set(tx, 0.78, -0.16);
          tuft.rotation.x = -0.25;
          tuft.rotation.z = tx * 0.15;
          group.add(tuft);
        }
        // Team-color fur mantle trim
        const bkMantleTrim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.03, 0.32), bkTeamMat);
        bkMantleTrim.position.set(0, 0.59, -0.12);
        group.add(bkMantleTrim);
        // Back: wolf pelt hanging down like a short cloak
        const bkPeltBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.06), bkFurMat);
        bkPeltBack.position.set(0, 0.44, -0.26);
        group.add(bkPeltBack);
        // Pelt back ragged hem (darker strip)
        const bkPeltHem = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.07), bkFurDark);
        bkPeltHem.position.set(0, 0.28, -0.26);
        group.add(bkPeltHem);
        // Leather harness visible on back (X crosses)
        const bkBackStrapA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.40, 0.04), bkLeatherDark);
        bkBackStrapA.position.set(0, 0.46, -0.27); bkBackStrapA.rotation.z = 0.30;
        group.add(bkBackStrapA);
        const bkBackStrapB = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.40, 0.04), bkLeatherDark);
        bkBackStrapB.position.set(0, 0.46, -0.27); bkBackStrapB.rotation.z = -0.30;
        group.add(bkBackStrapB);
        // Bronze clasp at strap intersection (back)
        const bkBackClasp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), bkBronzeMat);
        bkBackClasp.position.set(0, 0.46, -0.28);
        group.add(bkBackClasp);

        // ─── PASS 6: AURA — faint rage glow, rune pulse ───
        // No persistent aura objects — the rage-eyes and rune marks pulse via animation
        // (berserkers are physical fighters, not magical — aura is subtle)

        // ─── LEGS — fur-trimmed leather boots ───
        group.add(makeLegGroup('leg-left', 0x5d4037, -0.15, 0));
        group.add(makeLegGroup('leg-right', 0x5d4037, 0.15, 0));
        break;
      }
      case UnitType.BATTLEMAGE: {
        // === BATTLEMAGE — Arcane War-Mage: battle-armored spellcaster ===
        // A heavily armored mage who channels destructive AoE magic through a war-staff.
        // Design: layered plate + enchanted robes, glowing rune channels, ornate helm.

        // --- Shared materials ---
        const bmPlateMat = new THREE.MeshLambertMaterial({ color: 0x263238 }); // dark gunmetal plate
        const bmPlateHighMat = new THREE.MeshLambertMaterial({ color: 0x37474f }); // lighter plate accent
        const bmRobeMat = new THREE.MeshLambertMaterial({ color: 0x1a0066 }); // deep indigo fabric
        const bmRobeDeepMat = new THREE.MeshLambertMaterial({ color: 0x0d0033 }); // darker robe shadow
        const bmGoldMat = new THREE.MeshLambertMaterial({ color: 0xffd700 }); // gold trim
        const bmRuneMat = new THREE.MeshLambertMaterial({ color: 0x7c4dff, emissive: 0x7c4dff, emissiveIntensity: 0.7 }); // glowing arcane purple
        const bmRuneDimMat = new THREE.MeshLambertMaterial({ color: 0x4a148c, emissive: 0x4a148c, emissiveIntensity: 0.3 }); // subtle rune glow
        const bmTeamMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const bmSkinMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });

        // ─── PASS 1: SILHOUETTE — wide robed bottom, armored torso ───
        // Lower robes — flared skirt (wizard silhouette)
        const bmSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.56), bmRobeMat);
        bmSkirt.position.y = 0.16; bmSkirt.castShadow = true;
        group.add(bmSkirt);
        // Robe hem trim (gold band at bottom)
        const bmHem = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.04, 0.58), bmGoldMat);
        bmHem.position.y = 0.02;
        group.add(bmHem);
        // Core torso — armored breastplate over inner robe
        const bmInnerRobe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.42), bmRobeDeepMat);
        bmInnerRobe.position.y = 0.42;
        group.add(bmInnerRobe);
        const bmBreastplate = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.34, 0.46), bmPlateMat);
        bmBreastplate.position.y = 0.44; bmBreastplate.castShadow = true;
        group.add(bmBreastplate);

        // ─── PASS 2: LAYERING — armor plates, robe folds, depth ───
        // Upper chest plate (lighter accent, layered over breastplate)
        const bmChestUpper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.36), bmPlateHighMat);
        bmChestUpper.position.set(0, 0.56, 0.03);
        group.add(bmChestUpper);
        // Segmented tassets hanging from waist (armored skirt plates, L and R)
        for (const tx of [-0.18, 0.18]) {
          const tasset = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.14), bmPlateMat);
          tasset.position.set(tx, 0.24, 0.16);
          group.add(tasset);
          // Gold rivet on each tasset
          const rivet = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.03), bmGoldMat);
          rivet.position.set(tx, 0.28, 0.24);
          group.add(rivet);
        }
        // Robe fabric visible between tassets (front slit)
        const bmFrontSlit = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.04), bmRobeMat);
        bmFrontSlit.position.set(0, 0.22, 0.22);
        group.add(bmFrontSlit);
        // Gorget (throat armor) wrapping neck
        const bmGorget = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 0.36), bmPlateHighMat);
        bmGorget.position.y = 0.66;
        group.add(bmGorget);
        // Raised collar plates (L/R, slightly angled outward)
        for (const cx of [-0.20, 0.20]) {
          const colPlate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.28), bmPlateMat);
          colPlate.position.set(cx, 0.70, -0.02);
          colPlate.rotation.z = cx < 0 ? 0.12 : -0.12;
          group.add(colPlate);
        }
        // Pauldrons (larger, layered shoulder armor)
        for (const px of [-0.30, 0.30]) {
          // Base pauldron
          const paulBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.22), bmPlateMat);
          paulBase.position.set(px, 0.60, 0);
          group.add(paulBase);
          // Upper pauldron (stacked, smaller)
          const paulTop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.18), bmPlateHighMat);
          paulTop.position.set(px, 0.66, 0);
          group.add(paulTop);
          // Gold trim edge on each pauldron
          const paulTrim = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.03, 0.04), bmGoldMat);
          paulTrim.position.set(px, 0.57, 0.10);
          group.add(paulTrim);
        }

        // ─── PASS 3: ORNAMENTATION — runes, buckles, emblems, belt ───
        // Arcane rune belt (glowing purple band with gold buckle)
        const bmBelt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.48), bmRuneDimMat);
        bmBelt.position.y = 0.30;
        group.add(bmBelt);
        const bmBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.06), bmGoldMat);
        bmBuckle.position.set(0, 0.30, 0.25);
        group.add(bmBuckle);
        // Buckle rune gem (glowing center)
        const bmBuckleGem = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xb388ff })
        );
        bmBuckleGem.position.set(0, 0.30, 0.29);
        bmBuckleGem.name = 'bm-buckle-gem';
        group.add(bmBuckleGem);
        // Chest rune channels (glowing lines etched into breastplate)
        const bmRuneH = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.48), bmRuneMat);
        bmRuneH.position.set(0, 0.50, 0);
        group.add(bmRuneH);
        const bmRuneV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.20, 0.48), bmRuneMat);
        bmRuneV.position.set(0, 0.48, 0);
        group.add(bmRuneV);
        // Diagonal rune slashes on upper chest
        for (const dx of [-0.10, 0.10]) {
          const rSlash = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.10, 0.48), bmRuneDimMat);
          rSlash.position.set(dx, 0.54, 0);
          rSlash.rotation.z = dx < 0 ? 0.5 : -0.5;
          group.add(rSlash);
        }
        // Team-colored tabard front panel (hangs below belt)
        const bmTabard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.04), bmTeamMat);
        bmTabard.position.set(0, 0.18, 0.24);
        group.add(bmTabard);
        // Gold tabard border
        const bmTabBorder = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.02, 0.05), bmGoldMat);
        bmTabBorder.position.set(0, 0.26, 0.24);
        group.add(bmTabBorder);
        // Belt pouches (spell components)
        for (const bpx of [-0.22, 0.24]) {
          const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0x3e2723 }));
          pouch.position.set(bpx, 0.28, 0.18);
          group.add(pouch);
          const pouchFlap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
          pouchFlap.position.set(bpx, 0.33, 0.18);
          group.add(pouchFlap);
        }

        // ─── HEAD: Arcane Battle-Helm with visor ───
        const bmHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.30, 0.32), bmSkinMat);
        bmHead.position.y = 0.85;
        group.add(bmHead);
        // Helm shell (covers top/sides, open face)
        const bmHelm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.38), bmPlateMat);
        bmHelm.position.y = 0.94;
        group.add(bmHelm);
        // Helm crest (raised central ridge)
        const bmCrest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.30), bmPlateHighMat);
        bmCrest.position.set(0, 1.06, -0.02);
        group.add(bmCrest);
        // Brow visor (overhanging face, menacing)
        const bmVisor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.12), bmPlateMat);
        bmVisor.position.set(0, 0.96, 0.16);
        group.add(bmVisor);
        // Glowing eye slits (arcane energy visible through visor)
        const bmEyeGlow = new THREE.MeshBasicMaterial({ color: 0xb388ff });
        for (const ex of [-0.07, 0.07]) {
          const eyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), bmEyeGlow);
          eyeSlit.position.set(ex, 0.92, 0.17);
          eyeSlit.name = 'bm-eye';
          group.add(eyeSlit);
        }
        // Cheekguards (hanging plates on sides of helm)
        for (const cgx of [-0.18, 0.18]) {
          const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.10), bmPlateMat);
          guard.position.set(cgx, 0.86, 0.10);
          group.add(guard);
        }
        // Gold rune circlet on helm brow
        const bmCirclet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.04), bmGoldMat);
        bmCirclet.position.set(0, 0.98, 0.17);
        group.add(bmCirclet);
        // Central gem on circlet (glowing arcane)
        const bmCircletGem = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xd500f9 })
        );
        bmCircletGem.position.set(0, 0.98, 0.20);
        bmCircletGem.name = 'bm-circlet-gem';
        group.add(bmCircletGem);
        // Short beard visible below helm (grizzled battlemage)
        const bmBeard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.08), new THREE.MeshLambertMaterial({ color: 0x616161 }));
        bmBeard.position.set(0, 0.76, 0.15);
        group.add(bmBeard);

        // ─── PASS 4: WEAPON — Ornate War-Staff (held vertically) ───
        const bmArmR = makeArmGroup('arm-right', 0x263238, 0.3, 0.52);
        const bmArmRElbow = bmArmR.getObjectByName('arm-right-elbow')!;
        // Staff wrapper group — tilted forward 25° to clear shoulder plates
        const bmStaffGrp = new THREE.Group();
        bmStaffGrp.rotation.x = 0.436; // 25 degrees forward tilt
        bmArmRElbow.add(bmStaffGrp);
        // Staff shaft (dark wood, vertical)
        const bmStaffMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
        const bmStaff = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), bmStaffMat);
        bmStaff.position.set(0, 0.20, 0.08);
        bmStaffGrp.add(bmStaff);
        // Staff grip wrapping (gold spiral bands along shaft)
        for (let gi = 0; gi < 3; gi++) {
          const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), bmGoldMat);
          grip.position.set(0, -0.25 + gi * 0.22, 0.08);
          grip.rotation.y = gi * 0.4;
          bmStaffGrp.add(grip);
        }
        // Staff rune channel (glowing line up the shaft)
        const bmStaffRune = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.9, 0.02), bmRuneMat);
        bmStaffRune.position.set(0.035, 0.20, 0.08);
        bmStaffGrp.add(bmStaffRune);
        // Staff head — arcane cradle (TorusGeometry ring holding the orb)
        const bmCradle = new THREE.Mesh(
          new THREE.TorusGeometry(0.09, 0.02, 6, 8),
          bmGoldMat
        );
        bmCradle.position.set(0, 0.88, 0.08);
        bmStaffGrp.add(bmCradle);
        // Inner cradle cross-bars (structural, holding the orb)
        for (let ci = 0; ci < 4; ci++) {
          const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), bmGoldMat);
          const cAngle = (ci / 4) * Math.PI * 2;
          crossbar.position.set(
            Math.cos(cAngle) * 0.05, 0.92, 0.08 + Math.sin(cAngle) * 0.05
          );
          bmStaffGrp.add(crossbar);
        }
        // Staff orb — large glowing arcane sphere at top
        const bmOrbMat = new THREE.MeshBasicMaterial({ color: 0xb388ff });
        const bmOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 8, 8),
          bmOrbMat
        );
        bmOrb.position.set(0, 0.95, 0.08);
        bmOrb.name = 'battlemage-orb';
        bmStaffGrp.add(bmOrb);
        // Outer orb glow haze
        const bmOrbGlow = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0x7c4dff, transparent: true, opacity: 0.25 })
        );
        bmOrbGlow.position.set(0, 0.95, 0.08);
        bmOrbGlow.name = 'bm-orb-glow';
        bmStaffGrp.add(bmOrbGlow);
        // Staff butt cap (metal endcap at bottom)
        const bmButtCap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), bmPlateHighMat);
        bmButtCap.position.set(0, -0.45, 0.08);
        bmStaffGrp.add(bmButtCap);
        group.add(bmArmR);

        // LEFT ARM — casting hand with palm rune
        const bmArmL = makeArmGroup('arm-left', 0x263238, -0.3, 0.52);
        const bmArmLElbow = bmArmL.getObjectByName('arm-left-elbow')!;
        // Palm rune (small glowing disc on hand)
        const bmPalmRune = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xb388ff })
        );
        bmPalmRune.position.set(0, -0.20, 0.05);
        bmPalmRune.name = 'bm-palm-rune';
        bmArmLElbow.add(bmPalmRune);
        group.add(bmArmL);

        // ─── PASS 5: BACK DETAIL ───
        // Backplate (full back armor, slightly thicker for silhouette)
        const bmBackplate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.30, 0.06), bmPlateMat);
        bmBackplate.position.set(0, 0.46, -0.24);
        group.add(bmBackplate);
        // Spine ridge (raised central strip)
        const bmSpine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.04), bmPlateHighMat);
        bmSpine.position.set(0, 0.46, -0.28);
        group.add(bmSpine);
        // Spine rune channel (glowing line down the back)
        const bmSpineRune = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.22, 0.04), bmRuneDimMat);
        bmSpineRune.position.set(0, 0.46, -0.30);
        group.add(bmSpineRune);
        // Rear robe drape (hanging below backplate, darker)
        const bmRearDrape = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.20, 0.04), bmRobeDeepMat);
        bmRearDrape.position.set(0, 0.18, -0.26);
        group.add(bmRearDrape);
        // Gold trim on rear drape edge
        const bmRearTrim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.05), bmGoldMat);
        bmRearTrim.position.set(0, 0.09, -0.26);
        group.add(bmRearTrim);
        // Team-colored rear tabard panel
        const bmRearTabard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), bmTeamMat);
        bmRearTabard.position.set(0, 0.20, -0.28);
        group.add(bmRearTabard);
        // Arcane sigil on back (cross pattern, glowing faintly)
        const bmBackSigilH = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.05), bmRuneDimMat);
        bmBackSigilH.position.set(0, 0.46, -0.29);
        group.add(bmBackSigilH);
        const bmBackSigilV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.05), bmRuneDimMat);
        bmBackSigilV.position.set(0, 0.46, -0.29);
        group.add(bmBackSigilV);
        // Helm back guard (nape protection)
        const bmNapeGuard = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.06), bmPlateMat);
        bmNapeGuard.position.set(0, 0.86, -0.18);
        group.add(bmNapeGuard);

        // ─── PASS 6: MAGICAL AURA — orbiting arcane motes, staff resonance ───
        // 4 orbiting arcane motes (purple/white alternating, named for animation)
        const moteColors = [0xb388ff, 0xe0e0ff, 0xd500f9, 0xe0e0ff];
        for (let mi = 0; mi < 4; mi++) {
          const moteMat = new THREE.MeshBasicMaterial({ color: moteColors[mi] });
          const mote = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), moteMat);
          const phase = (mi / 4) * Math.PI * 2;
          mote.position.set(Math.cos(phase) * 0.55, 0.60, Math.sin(phase) * 0.55);
          mote.name = `bm-mote-${mi}`;
          group.add(mote);
        }
        // Arcane ground rune circle (ring of small glowing segments under feet)
        const bmGroundAura = new THREE.Group();
        bmGroundAura.name = 'bm-ground-aura';
        const groundSegCount = 12;
        for (let si = 0; si < groundSegCount; si++) {
          const sAngle = (si / groundSegCount) * Math.PI * 2;
          const seg = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.015, 0.03),
            new THREE.MeshBasicMaterial({ color: 0x7c4dff, transparent: true, opacity: 0.5 })
          );
          seg.position.set(Math.cos(sAngle) * 0.50, 0.01, Math.sin(sAngle) * 0.50);
          seg.rotation.y = sAngle + Math.PI / 2;
          bmGroundAura.add(seg);
        }
        group.add(bmGroundAura);

        // ─── LEGS (armored greaves over robe) ───
        group.add(makeLegGroup('leg-left', 0x1a0033, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x1a0033, 0.12, 0));
        // Knee plates (armored over robe legs)
        for (const kx of [-0.12, 0.12]) {
          const kneePlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.10), bmPlateMat);
          kneePlate.position.set(kx, 0.18, 0.06);
          group.add(kneePlate);
        }
        break;
      }
      case UnitType.GREATSWORD: {
        // === GREATSWORD — Towering juggernaut in ornate full plate with massive claymore ===
        // The heaviest melee unit. Wide, imposing silhouette. Every surface is layered plate.

        // --- Shared materials ---
        const gsPlateMat = new THREE.MeshLambertMaterial({ color: 0x455a64 }); // blue-grey steel
        const gsPlateHiMat = new THREE.MeshLambertMaterial({ color: 0x546e7a }); // lighter accent steel
        const gsPlateDkMat = new THREE.MeshLambertMaterial({ color: 0x37474f }); // dark steel
        const gsGoldMat = new THREE.MeshLambertMaterial({ color: 0xb8860b }); // dark gold / brass
        const gsGoldBright = new THREE.MeshLambertMaterial({ color: 0xffd700 }); // bright gold trim
        const gsLeatherMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 }); // dark leather
        const gsTeamMat = new THREE.MeshLambertMaterial({ color: playerColor });
        const gsBladeMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }); // polished steel blade
        const gsEdgeMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); // razor edge highlight
        const gsBlackMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a }); // visor slits

        // ─── PASS 1: SILHOUETTE — wide, tall, heavy ───
        // Core torso (widest of all melee units)
        const gsBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.65, 0.50), gsPlateMat);
        gsBody.position.y = 0.33; gsBody.castShadow = true;
        group.add(gsBody);

        // ─── PASS 2: LAYERING — stacked plates for visual depth ───
        // Upper breastplate (raised over core, lighter accent)
        const gsBreast = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.30, 0.42), gsPlateHiMat);
        gsBreast.position.set(0, 0.50, 0.02);
        group.add(gsBreast);
        // Lower breastplate overlap (muscled cuirass feel)
        const gsBreastLow = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.16, 0.40), gsPlateMat);
        gsBreastLow.position.set(0, 0.32, 0.04);
        group.add(gsBreastLow);
        // Gorget (thick throat guard)
        const gsGorget = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.40), gsPlateDkMat);
        gsGorget.position.y = 0.68;
        group.add(gsGorget);
        // Faulds (armored skirt segments — 3 front panels hanging from waist)
        for (const fx of [-0.18, 0, 0.18]) {
          const fauld = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.10), gsPlateMat);
          fauld.position.set(fx, 0.06, 0.18);
          group.add(fauld);
          // Gold rivet on each fauld
          const fRivet = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.03), gsGoldMat);
          fRivet.position.set(fx, 0.12, 0.24);
          group.add(fRivet);
        }
        // Side faulds (flanking)
        for (const sfx of [-0.28, 0.28]) {
          const sideFauld = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.16), gsPlateMat);
          sideFauld.position.set(sfx, 0.08, 0);
          group.add(sideFauld);
        }
        // Pauldrons — massive, multi-layered (3 tiers each)
        for (const px of [-0.38, 0.38]) {
          // Base pauldron (largest, sits on shoulder)
          const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.28), gsPlateMat);
          p1.position.set(px, 0.60, 0);
          group.add(p1);
          // Middle tier (slightly smaller, stacked)
          const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.08, 0.24), gsPlateHiMat);
          p2.position.set(px, 0.68, 0);
          group.add(p2);
          // Top tier (smallest, peaked)
          const p3 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.18), gsPlateDkMat);
          p3.position.set(px, 0.74, 0);
          group.add(p3);
          // Gold trim band at base of pauldron
          const pTrim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.06), gsGoldMat);
          pTrim.position.set(px, 0.57, 0.12);
          group.add(pTrim);
          // Raised boss (decorative round stud) on each pauldron
          const pBoss = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 6, 6),
            gsGoldBright
          );
          pBoss.position.set(px, 0.65, 0.14);
          group.add(pBoss);
        }

        // ─── PASS 3: ORNAMENTATION — trim, emblems, belt, studs ───
        // Waist belt (thick leather with gold accents)
        const gsBelt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.52), gsLeatherMat);
        gsBelt.position.y = 0.16;
        group.add(gsBelt);
        // Belt buckle (ornate, gold)
        const gsBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), gsGoldBright);
        gsBuckle.position.set(0, 0.16, 0.26);
        group.add(gsBuckle);
        // Buckle gem
        const gsBuckleGem = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 6, 6),
          new THREE.MeshLambertMaterial({ color: 0xb71c1c }) // deep red garnet
        );
        gsBuckleGem.position.set(0, 0.16, 0.30);
        group.add(gsBuckleGem);
        // Chest emblem — team-colored heraldic diamond
        const gsEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.44), gsTeamMat);
        gsEmblem.position.set(0, 0.50, 0);
        gsEmblem.rotation.z = Math.PI / 4; // diamond orientation
        group.add(gsEmblem);
        // Gold border around emblem
        const gsEmblemBorder = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.44), gsGoldMat);
        gsEmblemBorder.position.set(0, 0.50, 0);
        gsEmblemBorder.rotation.z = Math.PI / 4;
        group.add(gsEmblemBorder);
        // (emblem on top of border — add emblem again slightly forward)
        const gsEmblem2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.45), gsTeamMat);
        gsEmblem2.position.set(0, 0.50, 0);
        gsEmblem2.rotation.z = Math.PI / 4;
        group.add(gsEmblem2);
        // Horizontal gold trim across upper chest
        const gsChestTrim = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.03, 0.04), gsGoldMat);
        gsChestTrim.position.set(0, 0.62, 0.20);
        group.add(gsChestTrim);
        // Vertical gold trim down center
        const gsChestTrimV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.04), gsGoldMat);
        gsChestTrimV.position.set(0, 0.44, 0.22);
        group.add(gsChestTrimV);
        // Belt pouches (left and right hip)
        for (const bpx of [-0.28, 0.26]) {
          const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.08), gsLeatherMat);
          pouch.position.set(bpx, 0.14, 0.18);
          group.add(pouch);
          const pFlap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
          pFlap.position.set(bpx, 0.19, 0.18);
          group.add(pFlap);
        }
        // Rivets along breastplate edges (decorative studs)
        for (const ry of [0.38, 0.48, 0.58]) {
          for (const rx of [-0.24, 0.24]) {
            const stud = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), gsGoldMat);
            stud.position.set(rx, ry, 0.22);
            group.add(stud);
          }
        }

        // ─── HEAD: Full Great Helm ───
        // Helm shell (boxy, imposing, flat-topped)
        const gsHelm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.42), gsPlateMat);
        gsHelm.position.y = 0.92;
        group.add(gsHelm);
        // Faceplate (slightly forward, separate piece for depth)
        const gsFace = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.30, 0.06), gsPlateDkMat);
        gsFace.position.set(0, 0.90, 0.20);
        group.add(gsFace);
        // T-visor slit (horizontal)
        const gsVisorH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.07), gsBlackMat);
        gsVisorH.position.set(0, 0.92, 0.21);
        group.add(gsVisorH);
        // T-visor slit (vertical)
        const gsVisorV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.07), gsBlackMat);
        gsVisorV.position.set(0, 0.88, 0.21);
        group.add(gsVisorV);
        // Helm crest (raised central ridge, runs front to back)
        const gsCrest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.36), gsPlateHiMat);
        gsCrest.position.set(0, 1.12, -0.02);
        group.add(gsCrest);
        // Gold crown band around helm
        const gsCrown = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.44), gsGoldMat);
        gsCrown.position.y = 1.02;
        group.add(gsCrown);
        // Breathing holes (small dark squares on cheeks)
        for (const bSide of [-0.20, 0.20]) {
          for (let bi = 0; bi < 3; bi++) {
            const hole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), gsBlackMat);
            hole.position.set(bSide, 0.84 + bi * 0.05, 0.18);
            group.add(hole);
          }
        }
        // Chin guard (extending below faceplate)
        const gsChin = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.08), gsPlateMat);
        gsChin.position.set(0, 0.76, 0.18);
        group.add(gsChin);

        // ─── PASS 4: WEAPON — Massive Ornate Claymore ───
        const gsArmR = makeArmGroup('arm-right', 0x455a64, 0.35, 0.55);
        const gsArmRElbow = gsArmR.getObjectByName('arm-right-elbow')!;
        const gsArmL = makeArmGroup('arm-left', 0x455a64, -0.35, 0.55);
        // --- THE CLAYMORE (held vertically, tilted 25° forward to clear shoulders) ---
        const claymoreGrp = new THREE.Group();
        claymoreGrp.rotation.x = 0.85; // ~49 degrees forward tilt
        claymoreGrp.rotation.y = Math.PI / 2; // 90° along length axis — edges face left/right
        claymoreGrp.position.set(0.06, 0.10, 0.26);
        gsArmRElbow.add(claymoreGrp);
        // Blade — massive, nearly as tall as the unit
        const clayBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.06), gsBladeMat);
        clayBlade.position.set(0, 0.48, 0.08);
        claymoreGrp.add(clayBlade);
        // Fuller groove (recessed channel down blade center)
        const clayFuller = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.07), new THREE.MeshLambertMaterial({ color: 0x999999 }));
        clayFuller.position.set(0, 0.55, 0.08);
        claymoreGrp.add(clayFuller);
        // Blade edges (both sides, razor bright)
        for (const ex of [-0.085, 0.085]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.25, 0.07), gsEdgeMat);
          edge.position.set(ex, 0.50, 0.08);
          claymoreGrp.add(edge);
        }
        // Blade tip (tapers slightly — smaller box at top)
        const clayTip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.05), gsBladeMat);
        clayTip.position.set(0, 1.18, 0.08);
        claymoreGrp.add(clayTip);
        // Crossguard — wide, ornate quillons
        const clayGuard = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.08, 0.08), gsGoldBright);
        clayGuard.position.set(0, -0.20, 0.08);
        claymoreGrp.add(clayGuard);
        // Guard quillon tips (angled down like real claymores)
        for (const gx of [-0.22, 0.22]) {
          const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.06), gsGoldMat);
          tip.position.set(gx, -0.26, 0.08);
          claymoreGrp.add(tip);
        }
        // Guard center boss (decorative)
        const guardBoss = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 6, 6), gsGoldBright
        );
        guardBoss.position.set(0, -0.20, 0.13);
        claymoreGrp.add(guardBoss);
        // Ricasso (long leather-wrapped grip for two-hand hold)
        const clayGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.07), gsLeatherMat);
        clayGrip.position.set(0, -0.35, 0.08);
        claymoreGrp.add(clayGrip);
        // Grip cross-wrap bands (leather lacing)
        for (let wi = 0; wi < 3; wi++) {
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.09), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
          wrap.position.set(0, -0.28 + wi * 0.08, 0.08);
          wrap.rotation.y = wi * 0.3;
          claymoreGrp.add(wrap);
        }
        // Heavy pommel (counterweight, ornate)
        const clayPommel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.14), gsGoldBright);
        clayPommel.position.set(0, -0.50, 0.08);
        claymoreGrp.add(clayPommel);
        // Pommel gem
        const pommelGem = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 6, 6),
          new THREE.MeshLambertMaterial({ color: 0xb71c1c })
        );
        pommelGem.position.set(0, -0.50, 0.16);
        claymoreGrp.add(pommelGem);
        group.add(gsArmR);
        group.add(gsArmL);

        // ─── PASS 5: BACK DETAIL ───
        // Full backplate (thick, slightly convex feel via stacking)
        const gsBackplate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.40, 0.06), gsPlateMat);
        gsBackplate.position.set(0, 0.42, -0.24);
        group.add(gsBackplate);
        // Spine ridge (raised central strip)
        const gsSpine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.04), gsPlateHiMat);
        gsSpine.position.set(0, 0.42, -0.28);
        group.add(gsSpine);
        // Backplate shoulder blades (lateral ridges)
        for (const sbx of [-0.16, 0.16]) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.03), gsPlateDkMat);
          blade.position.set(sbx, 0.50, -0.27);
          group.add(blade);
        }
        // Gold trim at backplate top edge
        const gsBackTrim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.03, 0.05), gsGoldMat);
        gsBackTrim.position.set(0, 0.62, -0.24);
        group.add(gsBackTrim);
        // Team-colored rear tabard (hangs from belt, visible from behind)
        const gsRearTabard = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.22, 0.04), gsTeamMat);
        gsRearTabard.position.set(0, 0.06, -0.26);
        group.add(gsRearTabard);
        // Gold tabard trim
        const gsRearTabTrim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), gsGoldMat);
        gsRearTabTrim.position.set(0, -0.04, -0.26);
        group.add(gsRearTabTrim);
        // Rear faulds (armored skirt segments, back)
        for (const rfx of [-0.16, 0.16]) {
          const rFauld = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.08), gsPlateMat);
          rFauld.position.set(rfx, 0.08, -0.22);
          group.add(rFauld);
        }
        // Helm back guard / aventail (nape protection, layered)
        const gsNape = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), gsPlateMat);
        gsNape.position.set(0, 0.84, -0.20);
        group.add(gsNape);
        // Decorative cross on backplate (gold inlay)
        const gsBackCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.03, 0.05), gsGoldMat);
        gsBackCrossH.position.set(0, 0.46, -0.28);
        group.add(gsBackCrossH);
        const gsBackCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.20, 0.05), gsGoldMat);
        gsBackCrossV.position.set(0, 0.46, -0.28);
        group.add(gsBackCrossV);

        // ─── LEGS (heavy greaves with knee cops) ───
        group.add(makeLegGroup('leg-left', 0x37474f, -0.14, 0));
        group.add(makeLegGroup('leg-right', 0x37474f, 0.14, 0));
        // Knee cops (raised knee armor)
        for (const kx of [-0.14, 0.14]) {
          const kneeCop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), gsPlateHiMat);
          kneeCop.position.set(kx, 0.20, 0.06);
          group.add(kneeCop);
          // Gold stud on each knee cop
          const kneeStud = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), gsGoldMat);
          kneeStud.position.set(kx, 0.20, 0.13);
          group.add(kneeStud);
        }
        // Sabatons (foot armor plates, slightly forward)
        for (const sx of [-0.14, 0.14]) {
          const sabaton = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.10), gsPlateMat);
          sabaton.position.set(sx, 0.02, 0.06);
          group.add(sabaton);
        }
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
        const scoutArmRight = makeArmGroup('arm-right', 0x5D4037, 0.28, 0.50);
        const scoutArmRightElbow = scoutArmRight.getObjectByName('arm-right-elbow')!;
        const scimBlade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.55), new THREE.MeshLambertMaterial({ color: 0xd0d0d0 }));
        scimBlade.position.set(0, -0.16, 0.3);
        scimBlade.rotation.y = 0.15; // slight curve
        scoutArmRightElbow.add(scimBlade);
        // Sharp edge highlight
        const scimEdge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        scimEdge.position.set(0, -0.16, 0.3);
        scimEdge.rotation.y = 0.15;
        scoutArmRightElbow.add(scimEdge);
        const scimGuard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), new THREE.MeshLambertMaterial({ color: 0xB8860B }));
        scimGuard.position.set(0, -0.16, 0.04);
        scoutArmRightElbow.add(scimGuard);
        group.add(scoutArmRight);
        // Left arm — spyglass strapped to belt, hand free
        const scoutArmLeft = makeArmGroup('arm-left', 0x5D4037, -0.28, 0.50);
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
        const mageRightArm = makeArmGroup('arm-right', 0x1565C0, 0.3, 0.52);
        const mageRightArmElbow = mageRightArm.getObjectByName('arm-right-elbow')!;
        // Staff wrapper group — tilted forward 25° to clear shoulder
        const mageStaffGrp = new THREE.Group();
        mageStaffGrp.rotation.x = 0.436;
        mageStaffGrp.add(staffShaft);
        mageRightArmElbow.add(mageStaffGrp);
        group.add(mageRightArm);
        group.add(makeArmGroup('arm-left', 0x1565C0, -0.3, 0.52));
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

        group.add(makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50));
        group.add(makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50));
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
   * Knockback: unit gets hit and hops backward to a new hex position.
   * Smooth arc with a slight upward parabola — NOT a teleport.
   * The unit's logical position is updated immediately but the visual slides.
   */
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

    // If the unit is mid-knockback animation, don't override its position
    if (entry._knockbackUntil > performance.now()) return;

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
   * Visual-only separation pass — pushes unit meshes apart when they overlap.
   * Call once per frame AFTER setWorldPosition for all units.
   * Does NOT modify game-state positions (unit.worldPosition), only mesh group.position.
   */
  applySeparation(): void {
    const MIN_DIST = 0.55;       // minimum distance between unit centers
    const PUSH_STRENGTH = 0.12;  // how hard to push apart per frame
    const entries = Array.from(this.unitMeshes.values());
    const len = entries.length;

    for (let i = 0; i < len; i++) {
      const a = entries[i];
      for (let j = i + 1; j < len; j++) {
        const b = entries[j];
        const dx = a.group.position.x - b.group.position.x;
        const dz = a.group.position.z - b.group.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < MIN_DIST && dist > 0.001) {
          // Push both units away from each other equally
          const overlap = (MIN_DIST - dist) * PUSH_STRENGTH;
          const nx = dx / dist;
          const nz = dz / dist;
          a.group.position.x += nx * overlap;
          a.group.position.z += nz * overlap;
          b.group.position.x -= nx * overlap;
          b.group.position.z -= nz * overlap;
        } else if (dist <= 0.001) {
          // Exactly overlapping — nudge in a random direction
          const angle = Math.random() * Math.PI * 2;
          const nudge = MIN_DIST * PUSH_STRENGTH;
          a.group.position.x += Math.cos(angle) * nudge;
          a.group.position.z += Math.sin(angle) * nudge;
        }
      }
    }
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
        // Bowstring draw and release cycle
        const speed = 0.95;
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
        // Idle: bow arm slightly forward, draw arm relaxed
        if (armLeft) armLeft.rotation.x = armLeft.rotation.x * 0.9 + 0.15 * 0.1;
        if (armRight) armRight.rotation.x *= 0.9;
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
      case UnitType.CATAPULT: {
        // Catapult idle: nothing moves
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

    // Spark particles at impact
    for (let i = 0; i < 8; i++) {
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
