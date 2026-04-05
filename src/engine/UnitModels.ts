import * as THREE from 'three';
import { UnitType } from '../types';
import { UNIT_COLORS } from '../game/entities/UnitFactory';
import { mergeStaticMeshes, getCachedLambert, getCachedBasic } from './MeshMergeUtils';
import {
  SKIN, BOOT_BROWN, BLACK, WHITE_ISH,
  addEyes, addSimpleEyes, addEyebrows, addMouth, addNose,
  addBelt, addTabard, addPauldrons,
  addHead, addTorso, addMirroredPair,
  EyeOpts, BeltOpts, TabardOpts, PauldronOpts,
  TribeSkin, DEFAULT_SKIN, lightenColor, darkenColor,
} from './UnitModelHelpers';

export class UnitModels {
  constructor(_scene: THREE.Scene) {
    void _scene;
  }

  buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number, skin?: TribeSkin): void {
    UnitModels.buildUnitModel(group, type, playerColor, skin);
  }

  static buildUnitModel(group: THREE.Group, type: UnitType, playerColor: number, skin?: TribeSkin): void {
    const s = skin ?? DEFAULT_SKIN;
    // Helper: create an arm group with a mesh inside, so weapons can be children of the arm
    const makeArmGroup = (name: string, color: number, posX: number, posY: number): THREE.Group => {
      const armGroup = new THREE.Group();
      armGroup.name = name;
      armGroup.position.set(posX, posY, 0);
      const mat = getCachedLambert(color);
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
      const handMat = getCachedLambert(0xffdbac); // skin tone
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
      const mat = getCachedLambert(color);
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
      const footMat = getCachedLambert(0x5d4037); // dark brown boot
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

        // --- Shared materials (tribe-skinned) ---
        const wPlateMat = getCachedLambert(s.secondary);
        const wPlateHiMat = getCachedLambert(lightenColor(s.secondary, 0.12));
        const wPlateDkMat = getCachedLambert(darkenColor(s.secondary, 0.25));
        const wGoldMat = getCachedLambert(s.accent);
        const wGoldBright = getCachedLambert(s.trim);
        const wLeatherMat = getCachedLambert(0x5d4037); // dark leather
        const wTeamMat = getCachedLambert(playerColor);
        const wBladeMat = getCachedLambert(0xe0e0e0); // polished blade
        const wBlackMat = getCachedLambert(0x1a1a1a); // visor slits
        const wChainMat = getCachedLambert(0x808080); // chainmail

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
        // Pauldrons — two-tier on each shoulder (tribe-skinned)
        addPauldrons(group, {
          baseColor: s.secondary,
          topColor: lightenColor(s.secondary, 0.12),
          offsetX: 0.32,
          y: 0.58,
          baseSize: [0.20, 0.09, 0.24],
          topSize: [0.16, 0.06, 0.20],
          gap: 0.06,
        });
        // Gold trim on lower edge (custom detail not in helper)
        for (const px of [-0.32, 0.32]) {
          const pTrim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.04), wGoldMat);
          pTrim.position.set(px, 0.55, 0.10);
          group.add(pTrim);
        }

        // ─── PASS 3: ORNAMENTATION — belt, emblem, studs, plume ───
        // Leather belt with buckle (tribe-skinned)
        addBelt(group, {
          color: 0x5d4037,
          y: 0.18,
          width: 0.54,
          height: 0.07,
          depth: 0.48,
          buckleColor: s.trim,
          buckleZ: 0.24,
          buckleSize: [0.10, 0.10, 0.05],
        });
        // Team-color tabard front (hangs from belt)
        addTabard(group, {
          teamColor: playerColor,
          y: 0.08,
          z: 0.22,
          size: [0.16, 0.14, 0.04],
          borderColor: s.accent,
          borderHeight: 0.02,
        });
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
        const armRight = makeArmGroup('arm-right', s.secondary, 0.3, 0.55);
        const wElbowR = armRight.getObjectByName('arm-right-elbow')!;
        const wSwordGrp = new THREE.Group();
        wSwordGrp.name = 'sword-group';
        wSwordGrp.position.set(-0.0100, 0.0100, 0.3000);
        wSwordGrp.rotation.set(0.8684, 1.5584, 0.0000);
        wElbowR.add(wSwordGrp);
        // Blade — broad, imposing
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.05), wBladeMat);
        blade.name = 'sword-blade';
        blade.position.set(0, 0.28, 0);
        wSwordGrp.add(blade);
        // Fuller groove
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 0.06), getCachedLambert(0x999999));
        fuller.position.set(0, 0.30, 0);
        wSwordGrp.add(fuller);
        // Edge highlights
        for (const ex of [-0.065, 0.065]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.80, 0.06), getCachedLambert(0xffffff));
          edge.position.set(ex, 0.28, 0);
          wSwordGrp.add(edge);
        }
        // Blade tip (narrowing)
        const wTip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.04), wBladeMat);
        wTip.position.set(0, 0.73, 0);
        wSwordGrp.add(wTip);
        // Crossguard (gold, ornate)
        const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.06), wGoldBright);
        crossguard.name = 'sword-crossguard';
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
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), getCachedLambert(0x4e342e));
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
        const armLeft = makeArmGroup('arm-left', s.secondary, -0.3, 0.55);
        const wElbowL = armLeft.getObjectByName('arm-left-elbow')!;
        // Buckler face (team color, multi-layered)
        const bucklerMain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.30), wTeamMat);
        bucklerMain.name = 'shield-buckler';
        bucklerMain.position.set(-0.08, -0.12, 0.08);
        wElbowL.add(bucklerMain);
        // Buckler rim (steel edge)
        const bucklerRim = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.32), wPlateDkMat);
        bucklerRim.position.set(-0.07, -0.12, 0.08);
        wElbowL.add(bucklerRim);
        // Inner face plate (slightly smaller, for depth)
        const bucklerInner = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.24), getCachedLambert((playerColor as number) !== 0 ? playerColor : 0x4488cc));
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
        // ════════════════════════════════════════════════════════
        // ARCHER — Elite Forest Ranger
        // Layered studded leather, deep hood, ornate recurve bow,
        // fletched quiver, back cloak, team-color accents
        // ════════════════════════════════════════════════════════

        // Shared materials (tribe-skinned: leather uses secondary, fittings use accent/trim)
        const aLeatherMat = getCachedLambert(s.secondary);
        const aLeatherDkMat = getCachedLambert(darkenColor(s.secondary, 0.15));
        const aLeatherLtMat = getCachedLambert(lightenColor(s.secondary, 0.10));
        const aBrownMat = getCachedLambert(0x6b4226); // rich brown leather (strap/belt — universal)
        const aBrownDkMat = getCachedLambert(0x4a2e1a); // dark brown
        const aBrownLtMat = getCachedLambert(0x8b5e3c); // light brown
        const aTeamMat = getCachedLambert(playerColor);
        const aGoldMat = getCachedLambert(s.accent); // fittings
        const aSkinMat = getCachedLambert(0xffdbac);
        const aBlackMat = getCachedLambert(0x1a1a1a);
        const aBowWoodMat = getCachedLambert(0x8b5a2b); // yew wood
        const aBowDarkMat = getCachedLambert(0x5c3a1e); // bow limb tips
        const aStringMat = getCachedLambert(0xd4c8a0); // bowstring

        // ─── PASS 1: SILHOUETTE — lean, agile build ───
        // Core torso (studded leather vest)
        const aBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.38), aLeatherMat);
        aBody.position.y = 0.30; aBody.castShadow = true;
        group.add(aBody);

        // ─── PASS 2: LAYERING — leather armor layers ───
        // Upper chest plate (hardened leather, raised)
        const aChest = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.22, 0.30), aLeatherDkMat);
        aChest.position.set(0, 0.44, 0.03);
        group.add(aChest);
        // Lower belly guard
        const aBelly = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.28), aLeatherLtMat);
        aBelly.position.set(0, 0.28, 0.04);
        group.add(aBelly);
        // Side leather panels (visible at flanks)
        for (const sx of [-0.21, 0.21]) {
          const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.22), aBrownMat);
          sidePanel.position.set(sx, 0.36, 0);
          group.add(sidePanel);
        }
        // Studded rivets across chest (2 rows of 3)
        for (const sy of [0.38, 0.48]) {
          for (const sx2 of [-0.10, 0, 0.10]) {
            const stud = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), aGoldMat);
            stud.position.set(sx2, sy, 0.20);
            group.add(stud);
          }
        }

        // Belt with buckle
        addBelt(group, {
          color: 0x6b4226,
          y: 0.18,
          width: 0.46,
          height: 0.06,
          depth: 0.40,
          buckleColor: 0xc8a832,
          buckleZ: 0.22,
          buckleSize: [0.08, 0.07, 0.04],
        });
        // Belt pouches (small utility bags on sides)
        for (const px of [-0.20, 0.18]) {
          const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.06), aBrownDkMat);
          pouch.position.set(px, 0.16, 0.16);
          group.add(pouch);
          const pouchFlap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.07), aBrownLtMat);
          pouchFlap.position.set(px, 0.20, 0.16);
          group.add(pouchFlap);
        }

        // Team color sash (diagonal across chest)
        const aSash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.50, 0.42), aTeamMat);
        aSash.position.set(-0.06, 0.38, 0.01);
        aSash.rotation.z = 0.25;
        group.add(aSash);
        // Sash clasp (gold, at shoulder)
        const aClasp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), aGoldMat);
        aClasp.position.set(-0.16, 0.56, 0.10);
        group.add(aClasp);

        // ─── HEAD with deep ranger hood ───
        addHead(group, 0.76, [0.30, 0.30, 0.30], 0xffdbac);
        // Eyes (dark, narrowed — ranger's focus)
        addSimpleEyes(group, 0.06, 0.78, 0.16, [0.05, 0.03, 0.03], 0x1a1a1a);
        // ─── Robin Hood hat — pointed cap with upturned brim & feather ───
        // Hat base / brim (wide, upturned at front)
        const aHatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.44), aLeatherDkMat);
        aHatBrim.position.set(0, 0.90, 0.0);
        aHatBrim.rotation.x = -0.08; // slight forward tilt
        group.add(aHatBrim);
        // Upturned front brim flap
        const aHatFrontFlap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.06), aLeatherDkMat);
        aHatFrontFlap.position.set(0, 0.94, 0.20);
        aHatFrontFlap.rotation.x = 0.35; // flipped up
        group.add(aHatFrontFlap);
        // Hat crown — tall cone shape built from stacked boxes tapering to point
        const aHatBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.34), aLeatherMat);
        aHatBase.position.set(0, 0.96, -0.01);
        group.add(aHatBase);
        const aHatMid = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.10, 0.26), aLeatherMat);
        aHatMid.position.set(0, 1.05, -0.02);
        group.add(aHatMid);
        const aHatUpper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.18), aLeatherMat);
        aHatUpper.position.set(0, 1.14, -0.04);
        group.add(aHatUpper);
        // Pointed tip — leans backward like a classic Robin Hood cap
        const aHatTip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.10), aLeatherMat);
        aHatTip.position.set(0, 1.22, -0.10);
        aHatTip.rotation.x = 0.4; // leans back
        group.add(aHatTip);
        // Hat band — team color ribbon wrapped around base
        const aHatBand = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.36), aTeamMat);
        aHatBand.position.set(0, 0.93, -0.01);
        group.add(aHatBand);
        // Feather — tall, sticking out the side at a jaunty angle
        const aFeatherQuill = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.28, 0.015), getCachedLambert(0xf5f5f0));
        aFeatherQuill.position.set(-0.18, 1.10, -0.02);
        aFeatherQuill.rotation.z = 0.25; // angled outward
        group.add(aFeatherQuill);
        // Feather vane (colored plume)
        const aFeatherVane = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.02), getCachedLambert(0xcc3333));
        aFeatherVane.position.set(-0.20, 1.14, -0.02);
        aFeatherVane.rotation.z = 0.25;
        group.add(aFeatherVane);
        // Feather tip accent
        const aFeatherTip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.015), aTeamMat);
        aFeatherTip.position.set(-0.22, 1.26, -0.02);
        aFeatherTip.rotation.z = 0.25;
        group.add(aFeatherTip);

        // Shoulder guards (hardened leather pauldrons, asymmetric)
        // Left shoulder — larger (bow arm needs protection)
        const aShoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.18), aBrownMat);
        aShoulderL.position.set(-0.28, 0.58, 0);
        group.add(aShoulderL);
        const aShoulderLTrim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.19), aGoldMat);
        aShoulderLTrim.position.set(-0.28, 0.55, 0);
        group.add(aShoulderLTrim);
        // Right shoulder — smaller (draw arm needs range of motion)
        const aShoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.14), aBrownMat);
        aShoulderR.position.set(0.28, 0.58, 0);
        group.add(aShoulderR);

        // ─── PASS 3: QUIVER (detailed, on back-right) ───
        // Main quiver body (tall cylinder shape via box)
        const aQuiver = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, 0.10), aBrownMat);
        aQuiver.position.set(0.14, 0.46, -0.22);
        aQuiver.rotation.z = -0.08; // slight angle
        group.add(aQuiver);
        // Quiver top rim
        const aQuiverRim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), aGoldMat);
        aQuiverRim.position.set(0.14, 0.66, -0.22);
        group.add(aQuiverRim);
        // Quiver bottom cap
        const aQuiverCap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), aBrownDkMat);
        aQuiverCap.position.set(0.14, 0.27, -0.22);
        group.add(aQuiverCap);
        // Quiver strap (crosses chest diagonally)
        const aStrap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.50, 0.04), aBrownLtMat);
        aStrap.position.set(0.04, 0.40, -0.05);
        aStrap.rotation.z = 0.20;
        group.add(aStrap);
        // Arrow fletching tips poking out (3 arrows visible)
        for (let ai = 0; ai < 3; ai++) {
          const fletchX = 0.12 + (ai - 1) * 0.025;
          const fletchZ = -0.20 + (ai - 1) * 0.02;
          const arrowShaft = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.10, 0.015), aBrownLtMat);
          arrowShaft.position.set(fletchX, 0.70, fletchZ);
          group.add(arrowShaft);
          // Fletching (small colored fan)
          const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.005), aTeamMat);
          fletch.position.set(fletchX, 0.73, fletchZ + 0.01);
          group.add(fletch);
        }
        // Quiver decorative emblem (team color)
        const aQuiverEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), aTeamMat);
        aQuiverEmblem.position.set(0.14, 0.50, -0.16);
        group.add(aQuiverEmblem);

        // ─── PASS 4: BACK DETAIL — short ranger cloak ───
        const aCloak = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.06), aLeatherDkMat);
        aCloak.position.set(0, 0.38, -0.22);
        group.add(aCloak);
        // Cloak clasp at neck (gold leaf)
        const aCloakClasp = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.04), aGoldMat);
        aCloakClasp.position.set(0, 0.58, -0.20);
        group.add(aCloakClasp);
        // Cloak hem trim (team color)
        const aCloakHem = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.07), aTeamMat);
        aCloakHem.position.set(0, 0.20, -0.22);
        group.add(aCloakHem);

        // ─── PASS 5: ARMS with detailed recurve bow ───
        // Left arm (bow arm)
        const archerArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.52);
        // Leather vambrace on forearm
        const aVambraceL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.10, 0.11), aBrownMat);
        aVambraceL.position.set(0, -0.10, 0);
        const archerElbowL = archerArmLeft.getObjectByName('arm-left-elbow')!;
        archerElbowL.add(aVambraceL);

        // ─── BIG recurve bow — prominent, curved, held out front ───
        // Bow frame group (so we can name it for animation access)
        const aBowGroup = new THREE.Group();
        aBowGroup.name = 'bow-group';
        aBowGroup.position.set(0.0000, 0.0000, 0.1450);
        aBowGroup.rotation.set(-0.0816, -3.1416, 0.0000);
        archerElbowL.add(aBowGroup);

        // Main bow stave — tall and thick, prominent at game zoom
        const aBowStave = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.80, 0.06), aBowWoodMat);
        aBowStave.position.set(0, 0, 0);
        aBowGroup.add(aBowStave);

        // Upper limb — curves forward (recurve shape)
        const aBowUpperMid = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), aBowWoodMat);
        aBowUpperMid.position.set(0, 0.38, 0.04);
        aBowUpperMid.rotation.x = -0.20;
        aBowGroup.add(aBowUpperMid);
        const aBowUpperTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), aBowDarkMat);
        aBowUpperTip.position.set(0, 0.48, 0.10);
        aBowUpperTip.rotation.x = -0.45; // recurve kick
        aBowGroup.add(aBowUpperTip);
        // Upper nock (string notch)
        const aBowUpperNock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.04), aGoldMat);
        aBowUpperNock.position.set(0, 0.52, 0.12);
        aBowGroup.add(aBowUpperNock);

        // Lower limb — curves forward (recurve shape, mirror)
        const aBowLowerMid = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), aBowWoodMat);
        aBowLowerMid.position.set(0, -0.38, 0.04);
        aBowLowerMid.rotation.x = 0.20;
        aBowGroup.add(aBowLowerMid);
        const aBowLowerTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), aBowDarkMat);
        aBowLowerTip.position.set(0, -0.48, 0.10);
        aBowLowerTip.rotation.x = 0.45; // recurve kick
        aBowGroup.add(aBowLowerTip);
        // Lower nock
        const aBowLowerNock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.04), aGoldMat);
        aBowLowerNock.position.set(0, -0.52, 0.12);
        aBowGroup.add(aBowLowerNock);

        // Grip — wrapped leather at center
        const aBowGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.08), aBrownDkMat);
        aBowGrip.position.set(0, 0, 0);
        aBowGroup.add(aBowGrip);
        // Grip accent bands (gold)
        for (const gy of [-0.05, 0.05]) {
          const gripBand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.02, 0.085), aGoldMat);
          gripBand.position.set(0, gy, 0);
          aBowGroup.add(gripBand);
        }
        // Arrow rest (small shelf above grip)
        const aArrowRest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.06), aBrownLtMat);
        aArrowRest.position.set(0, 0.08, 0.04);
        aBowGroup.add(aArrowRest);

        // Bowstring — connects upper nock to lower nock
        // Resting position: straight line at Z offset behind stave
        const aBowString = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.96, 0.012), aStringMat);
        aBowString.position.set(0.0000, 0.0000, 0.1450);
        aBowString.rotation.set(-0.0816, -3.1416, 0.0000);
        aBowString.name = 'bowstring';
        aBowGroup.add(aBowString);

        // Nocked arrow (hidden by default — shown during attack draw animation)
        const aNockedArrow = new THREE.Group();
        aNockedArrow.name = 'nocked-arrow';
        aNockedArrow.visible = false;
        // Arrow shaft
        const aArrowShaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.55), aBrownLtMat);
        aArrowShaft.position.set(0, 0, -0.10);
        aNockedArrow.add(aArrowShaft);
        // Arrowhead
        const aArrowHead = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.08), getCachedLambert(0xc0c0c0));
        aArrowHead.position.set(0, 0, 0.20);
        aNockedArrow.add(aArrowHead);
        // Fletching
        const aArrowFletch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.06), aTeamMat);
        aArrowFletch.position.set(0, 0, -0.32);
        aNockedArrow.add(aArrowFletch);
        aNockedArrow.position.set(0, 0.04, -0.06); // sits at bowstring
        aBowGroup.add(aNockedArrow);

        group.add(archerArmLeft);

        // Right arm (draw arm) with leather vambrace
        const archerArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.52);
        const archerElbowR = archerArmRight.getObjectByName('arm-right-elbow')!;
        const aVambraceR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.09, 0.10), aBrownMat);
        aVambraceR.position.set(0, -0.10, 0);
        archerElbowR.add(aVambraceR);
        // Finger tab / draw glove
        const aFingerTab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.06), aBrownDkMat);
        aFingerTab.position.set(0, -0.18, 0);
        archerElbowR.add(aFingerTab);
        group.add(archerArmRight);

        // ─── LEGS (leather greaves with knee guards) ───
        const aLegL = makeLegGroup('leg-left', 0x4a6b3a, -0.12, 0);
        const aLegR = makeLegGroup('leg-right', 0x4a6b3a, 0.12, 0);
        // Knee guards
        for (const lg of [aLegL, aLegR]) {
          const kneeName = lg === aLegL ? 'leg-left' : 'leg-right';
          const knee = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.08), aBrownMat);
          knee.position.set(0, 0.02, 0.06);
          const kneeCap = lg.getObjectByName(kneeName);
          if (kneeCap) kneeCap.add(knee);
        }
        group.add(aLegL);
        group.add(aLegR);
        // Boots (dark leather, slightly oversized)
        for (const bx of [-0.12, 0.12]) {
          const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.16), aBrownDkMat);
          boot.position.set(bx, -0.02, 0.02);
          group.add(boot);
        }
        break;
      }
      case UnitType.RIDER: {
        // === ELABORATE MOUNTED KNIGHT — Ornate horse with plate barding, armored rider, lance & shield ===

        // --- Shared Materials (tribe-skinned: armor uses secondary, fittings use accent/trim) ---
        const rHorseBody = getCachedLambert(0x8B4513); // chestnut (horse body — universal)
        const rHorseBarding = getCachedLambert(playerColor); // team color armor
        const rArmorSteel = getCachedLambert(s.secondary); // armor plates
        const rArmorDark = getCachedLambert(darkenColor(s.secondary, 0.20)); // shadow armor
        const rGoldMat = getCachedLambert(s.accent); // brass/decorative trim
        const rSkinMat = getCachedLambert(0xffdbac); // skin
        const rLeatherMat = getCachedLambert(0x5d4037); // dark brown leather
        const rSilverMat = getCachedLambert(s.trim); // polished metallic highlights

        // ─── HORSE: MUSCULAR BODY WITH LAYERED PLATE ARMOR ───
        // Core muscular body
        const horseCore = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.8), rHorseBody);
        horseCore.position.set(0, 0.1, 0);
        horseCore.castShadow = true;
        group.add(horseCore);

        // Chest plate (protective armor layer)
        const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.08), rArmorSteel);
        chestPlate.position.set(0, 0.15, -0.38);
        group.add(chestPlate);

        // Left flank armor
        const flankLeftArmor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.35), rArmorDark);
        flankLeftArmor.position.set(-0.25, 0.12, 0);
        group.add(flankLeftArmor);

        // Right flank armor
        const flankRightArmor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.35), rArmorDark);
        flankRightArmor.position.set(0.25, 0.12, 0);
        group.add(flankRightArmor);

        // Rump armor plate (back detail)
        const rumpArmor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.08), rArmorDark);
        rumpArmor.position.set(0, 0.15, 0.38);
        group.add(rumpArmor);

        // Barding (team color decorative cloth layer)
        const barding = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.75), rHorseBarding);
        barding.position.set(0, 0.32, 0);
        group.add(barding);

        // Horse mane (team color)
        const mane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.15), rHorseBarding);
        mane.position.set(0, 0.28, -0.38);
        group.add(mane);

        // Tail (team color)
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.08), rHorseBarding);
        tail.position.set(0, 0.2, 0.45);
        group.add(tail);

        // Horse head (small box, but detailed)
        const horseHead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.25), rHorseBody);
        horseHead.position.set(0, 0.2, -0.48);
        group.add(horseHead);

        // Chamfron (face armor, polished steel)
        const chamfron = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.08), rSilverMat);
        chamfron.position.set(0, 0.2, -0.52);
        group.add(chamfron);

        // Saddle (brown leather with gold trim)
        const saddleMain = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.32), rLeatherMat);
        saddleMain.position.set(0, 0.32, 0);
        group.add(saddleMain);

        // Saddle seat (higher detail)
        const saddleSeat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.28), rArmorSteel);
        saddleSeat.position.set(0, 0.38, 0);
        group.add(saddleSeat);

        // Left stirrup
        const stirrupLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), rGoldMat);
        stirrupLeft.position.set(-0.2, 0.18, 0.08);
        group.add(stirrupLeft);

        // Right stirrup
        const stirrupRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), rGoldMat);
        stirrupRight.position.set(0.2, 0.18, 0.08);
        group.add(stirrupRight);

        // ─── RIDER: ARMORED KNIGHT IN PLATE ───
        // Core chest plate (layered over torso)
        const riderTorso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.32), rArmorSteel);
        riderTorso.position.set(0, 0.5, 0);
        riderTorso.castShadow = true;
        group.add(riderTorso);

        // Breastplate (bright steel, layered forward)
        const breastplate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.06), rSilverMat);
        breastplate.position.set(0, 0.52, -0.16);
        group.add(breastplate);

        // Back plate (darker steel)
        const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.06), rArmorDark);
        backplate.position.set(0, 0.52, 0.16);
        group.add(backplate);

        // Spine ridge (raised detail on back)
        const spineRidge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.08), rGoldMat);
        spineRidge.position.set(0, 0.52, 0.19);
        group.add(spineRidge);

        // Pauldrons (shoulder armor, team color trim)
        const pauldronLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), rArmorSteel);
        pauldronLeft.position.set(-0.24, 0.68, 0);
        group.add(pauldronLeft);

        const pauldronRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), rArmorSteel);
        pauldronRight.position.set(0.24, 0.68, 0);
        group.add(pauldronRight);

        // Shoulder trim (team color)
        const shoulderTrimLeft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), rHorseBarding);
        shoulderTrimLeft.position.set(-0.24, 0.76, 0);
        group.add(shoulderTrimLeft);

        const shoulderTrimRight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), rHorseBarding);
        shoulderTrimRight.position.set(0.24, 0.76, 0);
        group.add(shoulderTrimRight);

        // Head (face beneath helm — visible through visor)
        addHead(group, 0.88, [0.24, 0.26, 0.24], 0xffdbac);
        // Eyes — fierce and focused, visible through visor slit
        addEyes(group, {
          spacing: 0.06,
          y: 0.90,
          z: 0.13,
          whiteSize: [0.06, 0.035, 0.02],
          pupilSize: [0.035, 0.035, 0.02],
          whiteColor: 0xf0f0f0,
          pupilColor: 0x1a3a5c,
          pupilZOffset: 0.005,
        });
        // Nose bridge (barely visible, hints at face beneath)
        addNose(group, 0.87, 0.14, [0.03, 0.06, 0.03], 0xffdbac);

        // Great helm — full enclosed helm with visor
        // Lower helm shell (jaw/neck protection)
        const helmLower = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), rArmorSteel);
        helmLower.position.set(0, 0.82, 0);
        group.add(helmLower);
        // Upper helm dome
        const helmUpper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), rArmorSteel);
        helmUpper.position.set(0, 1.0, 0);
        group.add(helmUpper);
        // Helm top (narrowing crown)
        const helmTop = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.24), rArmorSteel);
        helmTop.position.set(0, 1.1, 0);
        group.add(helmTop);
        // Faceplate — protruding snout with visor slit
        const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.06), rArmorDark);
        faceplate.position.set(0, 0.92, 0.16);
        group.add(faceplate);
        // Visor slit (horizontal dark gap — eyes visible through here)
        const visorSlit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.07), getCachedLambert(0x0a0a0a));
        visorSlit.position.set(0, 0.90, 0.17);
        group.add(visorSlit);
        // Breathing holes below visor (3 small holes)
        for (let bh = 0; bh < 3; bh++) {
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.06), getCachedLambert(0x0a0a0a));
          hole.position.set(-0.05 + bh * 0.05, 0.85, 0.17);
          group.add(hole);
        }
        // Gold brow band across helm front
        const rBrowBand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.04), rGoldMat);
        rBrowBand.position.set(0, 0.96, 0.16);
        group.add(rBrowBand);
        // Helm crest (team color plume, front-to-back ridge)
        const helmCrest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.3), rHorseBarding);
        helmCrest.position.set(0, 1.18, 0);
        group.add(helmCrest);
        // Crest base mount (gold)
        const crestMount = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), rGoldMat);
        crestMount.position.set(0, 1.08, 0);
        group.add(crestMount);
        // Cheek guards (angled metal plates on sides)
        for (const cgx of [-0.14, 0.14]) {
          const cheekGuard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.1), rArmorSteel);
          cheekGuard.position.set(cgx, 0.84, 0.1);
          group.add(cheekGuard);
        }

        // Cape (dramatic team color drape, back detail)
        const capeBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.08), rHorseBarding);
        capeBack.position.set(0, 0.55, 0.2);
        group.add(capeBack);

        // ─── RIGHT ARM: LANCE WITH DECORATIVE ELEMENTS ───
        const riderArmRight = makeArmGroup('arm-right', 0xa8a8a8, 0.25, 0.62);
        const riderElbowR = riderArmRight.getObjectByName('arm-right-elbow')!;

        // Lance shaft (wood texture, polished)
        const lanceShaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.3), getCachedLambert(0xa0826d));
        lanceShaft.position.set(0, -0.16, 0.65);
        riderElbowR.add(lanceShaft);

        // Lance grip (wrapped leather)
        const lanceGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.18), rLeatherMat);
        lanceGrip.position.set(0, -0.16, 0.05);
        riderElbowR.add(lanceGrip);

        // Vamplate (decorative hand guard, team color)
        const vamplate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), rHorseBarding);
        vamplate.position.set(0, -0.16, -0.02);
        riderElbowR.add(vamplate);

        // Lance tip (sharp steel point)
        const lanceTip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), rSilverMat);
        lanceTip.position.set(0, -0.16, 1.32);
        riderElbowR.add(lanceTip);

        // Pennant (team color flag on shaft)
        const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.02), rHorseBarding);
        pennant.position.set(0.1, -0.16, 1.0);
        riderElbowR.add(pennant);

        group.add(riderArmRight);

        // ─── LEFT ARM: KITE SHIELD WITH EMBLEM ───
        const riderArmLeft = makeArmGroup('arm-left', 0xa8a8a8, -0.25, 0.62);
        const riderElbowL = riderArmLeft.getObjectByName('arm-left-elbow')!;

        // Kite shield (pointed bottom, curved sides)
        const kiteShield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.28), rHorseBarding);
        kiteShield.position.set(-0.08, -0.16, 0.1);
        riderElbowL.add(kiteShield);

        // Shield boss (central metal sphere)
        const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), rGoldMat);
        shieldBoss.position.set(-0.08, -0.16, 0.12);
        riderElbowL.add(shieldBoss);

        // Shield emblem (small horizontal stripe, team color accent)
        const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), rArmorSteel);
        emblem.position.set(-0.08, -0.12, 0.14);
        riderElbowL.add(emblem);

        group.add(riderArmLeft);

        // ─── HORSE LEGS (4 animated legs) ───
        const horseLegPositions = [
          { x: -0.15, z: -0.28, name: 'leg-left' },
          { x: 0.15, z: -0.28, name: 'leg-right' },
          { x: -0.15, z: 0.28, name: 'leg-back-left' },
          { x: 0.15, z: 0.28, name: 'leg-back-right' },
        ];

        for (const pos of horseLegPositions) {
          const legGroup = new THREE.Group();
          legGroup.name = pos.name;
          legGroup.position.set(pos.x, -0.08, pos.z);

          // Thigh
          const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), rHorseBody);
          thigh.position.y = 0.08;
          legGroup.add(thigh);

          // Shin with armor plate
          const shin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.09), rHorseBody);
          shin.position.y = -0.06;
          legGroup.add(shin);

          // Leg armor (bright protection)
          const legArmor = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 0.08), rArmorSteel);
          shin.position.z = -0.02;
          legGroup.add(legArmor);

          // Hoof
          const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.12), getCachedLambert(0x2c1810));
          hoof.position.y = -0.28;
          legGroup.add(hoof);

          group.add(legGroup);
        }

        break;
      }
      case UnitType.PALADIN: {
        // === PALADIN — Holy knight, ornate gilded plate, great mace, tower shield, divine aura ===

        // --- Shared materials (tribe-skinned) ---
        const palPlate = getCachedLambert(s.secondary);
        const palPlateHi = getCachedLambert(lightenColor(s.secondary, 0.10));
        const palPlateXHi = getCachedLambert(lightenColor(s.secondary, 0.18));
        const palPlateDk = getCachedLambert(darkenColor(s.secondary, 0.10));
        const palGold = getCachedLambert(s.trim);
        const palAccent = getCachedLambert(s.accent);

        // --- TORSO: Layered ornate plate armor ---
        const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.65, 0.5), palPlate);
        pBody.position.y = 0.32;
        pBody.castShadow = true;
        group.add(pBody);
        // Polished front breastplate (bright steel, slightly forward)
        const pBreast = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.45, 0.08), palPlateHi);
        pBreast.position.set(0, 0.38, 0.26);
        group.add(pBreast);
        // Gold chest emblem — sunburst cross
        const pEmbV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.02), palGold);
        pEmbV.position.set(0, 0.38, 0.31);
        group.add(pEmbV);
        const pEmbH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.02), palGold);
        pEmbH.position.set(0, 0.38, 0.31);
        group.add(pEmbH);
        // Sunburst rays (4 diagonal)
        for (const rz of [-0.78, 0.78, -2.36, 2.36]) {
          const ray = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.02), palGold);
          ray.position.set(0, 0.38, 0.31);
          ray.rotation.z = rz;
          group.add(ray);
        }
        // Belt with ornate buckle (tribe-skinned)
        addBelt(group, {
          color: 0x6d4c41,
          y: 0.05,
          width: 0.62,
          height: 0.1,
          depth: 0.54,
          buckleColor: s.trim,
          buckleZ: 0.28,
          buckleSize: [0.14, 0.1, 0.06],
        });
        // Gorget (neck armor)
        const pGorget = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.46), palPlate);
        pGorget.position.set(0, 0.68, 0);
        group.add(pGorget);
        // Tabard / battle skirt — front (team color)
        const pTabard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), getCachedLambert(playerColor));
        pTabard.position.set(0, -0.05, 0.22);
        group.add(pTabard);
        // Tabard / battle skirt — back (team color, matching front)
        const pTabardBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.08), getCachedLambert(playerColor));
        pTabardBack.position.set(0, -0.07, -0.22);
        group.add(pTabardBack);

        // --- BACK DECORATIONS: polished backplate, spine ridge, holy symbol ---
        // Polished back plate (bright steel)
        const pBackPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.08), palPlateHi);
        pBackPlate.position.set(0, 0.38, -0.26);
        group.add(pBackPlate);
        // Raised spine ridge (center of back)
        const pSpine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.06), palPlateXHi);
        pSpine.position.set(0, 0.36, -0.30);
        group.add(pSpine);
        // Gold cross emblem on back (matching front sunburst cross)
        const pBackCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), palGold);
        pBackCrossV.position.set(0, 0.38, -0.31);
        group.add(pBackCrossV);
        const pBackCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02), palGold);
        pBackCrossH.position.set(0, 0.40, -0.31);
        group.add(pBackCrossH);
        // Trim lines flanking spine (decorative channels)
        for (const bx of [-0.12, 0.12]) {
          const channel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.02), palGold);
          channel.position.set(bx, 0.36, -0.31);
          group.add(channel);
        }
        // Back of helm — raised guard plate
        const pHelmBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), palPlate);
        pHelmBack.position.set(0, 0.88, -0.24);
        group.add(pHelmBack);
        // Trim on back of helm
        const pHelmBackTrim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.09), palGold);
        pHelmBackTrim.position.set(0, 0.80, -0.24);
        group.add(pHelmBackTrim);

        // --- SHOULDER PAULDRONS: massive ornate layered plates (tribe-skinned) ---
        for (const sx of [-0.36, 0.36]) {
          // Main pauldron
          const ppMain = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), palPlateHi);
          ppMain.position.set(sx, 0.68, 0);
          group.add(ppMain);
          // Trim on bottom edge
          const ppTrim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.4), palGold);
          ppTrim.position.set(sx, 0.60, 0);
          group.add(ppTrim);
          // Raised top ridge
          const ppRidge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.3), palPlateXHi);
          ppRidge.position.set(sx, 0.78, 0);
          group.add(ppRidge);
          // Stud on pauldron face
          const ppStud = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), palGold);
          ppStud.position.set(sx, 0.68, 0.18);
          group.add(ppStud);
        }

        // --- HELMET: Great helm with crown crest, visor, cheek plates (tribe-skinned) ---
        // Main helm
        const pHelm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), palPlateHi);
        pHelm.position.y = 0.96;
        group.add(pHelm);
        // Darker faceplate
        const pFace = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.32, 0.08), palPlateDk);
        pFace.position.set(0, 0.92, 0.24);
        group.add(pFace);
        // Eye slit (dark)
        const pEyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.09), getCachedLambert(0x1a1a1a));
        pEyeSlit.position.set(0, 0.96, 0.26);
        group.add(pEyeSlit);
        // Breathing holes (3 small dots below visor)
        for (let bx = -0.06; bx <= 0.06; bx += 0.06) {
          const hole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.09), getCachedLambert(0x1a1a1a));
          hole.position.set(bx, 0.86, 0.26);
          group.add(hole);
        }
        // Crown crest on top — 5 points like a crown
        for (let ci = -2; ci <= 2; ci++) {
          const h = ci === 0 ? 0.14 : (Math.abs(ci) === 1 ? 0.10 : 0.07);
          const crestPt = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), palGold);
          crestPt.position.set(ci * 0.08, 1.19 + h / 2, 0);
          group.add(crestPt);
        }
        // Crown base band
        const crownBand = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.48), palGold);
        crownBand.position.set(0, 1.19, 0);
        group.add(crownBand);
        // Cheek guards
        for (const cx of [-0.24, 0.24]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), palPlate);
          cheek.position.set(cx, 0.88, 0.2);
          group.add(cheek);
        }

        // --- LEFT ARM + TOWER SHIELD (unique design) — pushed out to avoid body clipping ---
        const pArmL = makeArmGroup('arm-left', s.secondary, -0.36, 0.55);
        // Shield body — tall tower shield (offset further from arm)
        const shZ = 0.32; // shield Z offset — farther out from body
        const shX = 0.18; // shield X offset
        const pShield = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.1), getCachedLambert(playerColor));
        pShield.name = 'shield-tower';
        pShield.position.set(shX, -0.05, shZ);
        pArmL.add(pShield);
        // Steel rim — top
        const pRimT = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.12), palPlate);
        pRimT.position.set(shX, 0.35, shZ);
        pArmL.add(pRimT);
        // Steel rim — bottom
        const pRimB = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.12), palPlate);
        pRimB.position.set(shX, -0.45, shZ);
        pArmL.add(pRimB);
        // Steel rim — sides
        for (const rx of [-0.28, 0.28]) {
          const pRimS = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.12), palPlate);
          pRimS.position.set(shX + rx, -0.05, shZ);
          pArmL.add(pRimS);
        }
        // Large sun boss
        const pBoss = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.14), palGold);
        pBoss.position.set(shX, 0.05, shZ + 0.07);
        pArmL.add(pBoss);
        // Sun rays from boss (8 directions)
        for (let ri = 0; ri < 8; ri++) {
          const angle = (ri / 8) * Math.PI * 2;
          const rayLen = 0.15;
          const sunRay = new THREE.Mesh(new THREE.BoxGeometry(0.04, rayLen, 0.02), palGold);
          sunRay.position.set(
            shX + Math.sin(angle) * 0.16,
            0.05 + Math.cos(angle) * 0.16,
            shZ + 0.08
          );
          sunRay.rotation.z = -angle;
          pArmL.add(sunRay);
        }
        // Vertical tribe-colored stripe on shield
        const pStripeV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.02), palGold);
        pStripeV.position.set(shX, -0.05, shZ + 0.06);
        pArmL.add(pStripeV);
        // Horizontal tribe-colored stripe
        const pStripeH = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.02), palGold);
        pStripeH.position.set(shX, 0.05, shZ + 0.06);
        pArmL.add(pStripeH);
        group.add(pArmL);

        // --- RIGHT ARM + GREAT MACE (ornate holy weapon — held in hand) ---
        const pArmR = makeArmGroup('arm-right', s.secondary, 0.3, 0.55);
        const pElbowR = pArmR.getObjectByName('arm-right-elbow')!;
        // Long mace handle (dark wood with gold wrap)
        const pMHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), getCachedLambert(0x5d4037));
        pMHandle.name = 'mace-shaft';
        pMHandle.position.set(0, -0.16, 0.28);
        pElbowR.add(pMHandle);
        // Grip wrapping (two bands)
        for (const gz of [0.1, 0.2]) {
          const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), palGold);
          grip.position.set(0, -0.16, gz);
          pElbowR.add(grip);
        }
        // Pommel (ball at base)
        const pPommel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), palGold);
        pPommel.position.set(0, -0.16, 0.02);
        pElbowR.add(pPommel);
        // Mace head — large ornate flanged ball (bright steel)
        const pMHead = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), getCachedLambert(0xe0e0e0));
        pMHead.name = 'mace-head';
        pMHead.position.set(0, -0.16, 0.57);
        pElbowR.add(pMHead);
        // 6 big flanges radiating from mace head
        const flMat = palPlate;
        const flangePositions: [number, number][] = [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12], [0.08, 0.08], [-0.08, -0.08]];
        for (const [fx, fy] of flangePositions) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.16), flMat);
          fl.name = 'mace-flange';
          fl.position.set(fx, -0.16 + fy, 0.57);
          pElbowR.add(fl);
        }
        // Cap on mace tip
        const pMTip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), palGold);
        pMTip.name = 'mace-tip';
        pMTip.position.set(0, -0.16, 0.68);
        pElbowR.add(pMTip);
        group.add(pArmR);

        // --- LEGS with ornate greaves (tribe-skinned) ---
        group.add(makeLegGroup('leg-left', s.secondary, -0.12, 0));
        group.add(makeLegGroup('leg-right', s.secondary, 0.12, 0));
        // Knee guards (tribe-trimmed)
        for (const kx of [-0.12, 0.12]) {
          const knee = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), palPlateHi);
          knee.position.set(kx, 0.05, 0.08);
          group.add(knee);
          const kneeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.13), palGold);
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
        // === STURDY CONSTRUCTION WORKER — Detailed craftsman with layered work gear, tools ===

        // --- Shared Materials ---
        const bTunicMat = getCachedLambert(0xc9a876); // tan work tunic
        const bLeatherMat = getCachedLambert(darkenColor(s.secondary, 0.20)); // tribe leather
        const bBeltMat = getCachedLambert(playerColor); // team color accents
        const bSkinMat = getCachedLambert(0xffdbac); // skin tone
        const bGloveMat = getCachedLambert(s.secondary); // tribe reinforced leather
        const bBootMat = getCachedLambert(darkenColor(s.secondary, 0.30)); // tribe boot
        const bMetalMat = getCachedLambert(s.accent); // tribe tool metal
        const bWoodMat = getCachedLambert(0x8B5A3C); // hammer handle wood

        // ─── TORSO: LAYERED WORK TUNIC ───
        // Core tunic body
        const tunicBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.4), bTunicMat);
        tunicBody.position.set(0, 0.3, 0);
        tunicBody.castShadow = true;
        group.add(tunicBody);

        // Tunic detail layer (slightly offset, texture)
        const tunicDetail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.38), bTunicMat);
        tunicDetail.position.set(0, 0.31, 0.01);
        group.add(tunicDetail);

        // Leather apron front (primary tool attachment)
        const apronFront = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), bLeatherMat);
        apronFront.position.set(0, 0.2, -0.2);
        group.add(apronFront);

        // Apron reinforcement (darker leather strips)
        const apronReinforce = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), bLeatherMat);
        apronReinforce.position.set(-0.2, 0.2, -0.22);
        group.add(apronReinforce);

        const apronReinforceRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), bLeatherMat);
        apronReinforceRight.position.set(0.2, 0.2, -0.22);
        group.add(apronReinforceRight);

        // Tool belt (thick leather with team color studs)
        const toolBeltMain = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.42), bLeatherMat);
        toolBeltMain.position.set(0, 0.08, 0);
        group.add(toolBeltMain);

        // Belt trim (team color accent)
        const beltTrimTop = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.42), bBeltMat);
        beltTrimTop.position.set(0, 0.16, 0);
        group.add(beltTrimTop);

        // Tool pouches on belt (multiple small boxes)
        const pouch1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), bLeatherMat);
        pouch1.position.set(-0.2, 0.08, 0.18);
        group.add(pouch1);

        const pouch2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), bLeatherMat);
        pouch2.position.set(0.2, 0.08, 0.18);
        group.add(pouch2);

        // Measuring tape coil (decorative spiral on belt)
        const tapeCoil = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 6), getCachedLambert(0xb8860b));
        tapeCoil.position.set(0, 0.08, -0.2);
        group.add(tapeCoil);

        // Back detail: tool loops and hanging implements
        const toolLoop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.06), bLeatherMat);
        toolLoop.position.set(-0.18, 0.25, 0.2);
        group.add(toolLoop);

        const toolLoopRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.06), bLeatherMat);
        toolLoopRight.position.set(0.18, 0.25, 0.2);
        group.add(toolLoopRight);

        // Hanging saw shape (simple angular tool silhouette)
        const sawBlade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.04), getCachedLambert(0x909090));
        sawBlade.position.set(-0.18, 0.15, 0.24);
        sawBlade.rotation.z = 0.3;
        group.add(sawBlade);

        // Plumb line (hanging vertical from loop)
        const plumbLine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), bMetalMat);
        plumbLine.position.set(0.18, 0.12, 0.24);
        group.add(plumbLine);

        // Back panel (darker leather shield)
        const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.06), bLeatherMat);
        backPanel.position.set(0, 0.28, 0.2);
        group.add(backPanel);

        // ─── HEAD & HAT ───
        // Face with determined expression
        addHead(group, 0.78, [0.32, 0.32, 0.32], 0xffdbac);

        // Eyes — focused, determined (steely blue)
        addEyes(group, {
          spacing: 0.07,
          y: 0.80,
          z: -0.15,
          whiteSize: [0.055, 0.04, 0.03],
          pupilSize: [0.03, 0.04, 0.03],
          whiteColor: 0xf0f0f0,
          pupilColor: 0x3b5998,
          pupilZOffset: -0.01,
        });
        // Thick eyebrows (working man)
        addEyebrows(group, 0.07, 0.835, -0.15, [0.08, 0.025, 0.04], 0x3c2415);
        // Firm mouth
        addMouth(group, 0.71, -0.15, [0.08, 0.02, 0.03], 0xa06050);
        // Stubble/chin detail
        const bldChin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), getCachedLambert(0xe8c8a0));
        bldChin.position.set(0, 0.67, -0.14);
        group.add(bldChin);
        // Nose
        addNose(group, 0.76, -0.18, [0.05, 0.05, 0.06], 0xf0c8a0);

        // Hard hat base (team color)
        const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), bBeltMat);
        hatBrim.position.set(0, 0.95, 0);
        group.add(hatBrim);

        // Hat crown (team color, rounded top)
        const hatCrown = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), bBeltMat);
        hatCrown.position.set(0, 1.06, 0);
        group.add(hatCrown);

        // Hat lamp (small metallic cube on front)
        const lampBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), bMetalMat);
        lampBody.position.set(0, 1.0, -0.21);
        group.add(lampBody);

        // Lamp glow (emissive top)
        const lampGlow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), getCachedLambert(0xffff99));
        lampGlow.position.set(0, 1.04, -0.21);
        group.add(lampGlow);

        // ─── RIGHT ARM: CLAW HAMMER ───
        const bldArmRight = makeArmGroup('arm-right', 0x8B6914, 0.28, 0.52);
        const bldArmRightElbow = bldArmRight.getObjectByName('arm-right-elbow')!;

        // Hammer handle (wood with grip wrapping)
        const hammerHandle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.45), bWoodMat);
        hammerHandle.position.set(0, -0.16, 0.22);
        bldArmRightElbow.add(hammerHandle);

        // Grip wrap (darker leather layers)
        const gripWrap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.12), bLeatherMat);
        gripWrap.position.set(0, -0.16, -0.02);
        bldArmRightElbow.add(gripWrap);

        // Hammer head (claw side — flat face)
        const hammerHeadMain = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.14), bMetalMat);
        hammerHeadMain.position.set(0, -0.16, 0.52);
        bldArmRightElbow.add(hammerHeadMain);

        // Hammer claw (split prongs, curved up)
        const clawLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), getCachedLambert(0x505050));
        clawLeft.position.set(-0.08, -0.08, 0.56);
        clawLeft.rotation.z = 0.4;
        bldArmRightElbow.add(clawLeft);

        const clawRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), getCachedLambert(0x505050));
        clawRight.position.set(0.08, -0.08, 0.56);
        clawRight.rotation.z = -0.4;
        bldArmRightElbow.add(clawRight);

        // Hammer head bright edge (highlighting)
        const hammerShine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.12), getCachedLambert(0xd0d0d0));
        hammerShine.position.set(0, -0.22, 0.52);
        bldArmRightElbow.add(hammerShine);

        group.add(bldArmRight);

        // ─── LEFT ARM: ROLLED BLUEPRINTS ───
        const bldArmLeft = makeArmGroup('arm-left', 0x8B6914, -0.28, 0.52);
        const bldArmLeftElbow = bldArmLeft.getObjectByName('arm-left-elbow')!;

        // Blueprint cylinder (rolled paper)
        const blueprintRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6), getCachedLambert(0xd4d4d4));
        blueprintRoll.rotation.z = 1.57; // horizontal
        blueprintRoll.position.set(0, -0.16, 0.2);
        bldArmLeftElbow.add(blueprintRoll);

        // Blueprint tie (rope detail)
        const blueprintTie = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.32), getCachedLambert(0x8B6914));
        blueprintTie.position.set(-0.06, -0.16, 0.2);
        bldArmLeftElbow.add(blueprintTie);

        group.add(bldArmLeft);

        // ─── LEGS: STURDY BOOTS ───
        // Left leg with reinforcement
        const legLeftGroup = makeLegGroup('leg-left', 0x8B6914, -0.12, 0);
        // Add extra shin guard detail
        const shinGuardLeft = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.08), bMetalMat);
        shinGuardLeft.position.set(-0.12, -0.09, 0.06);
        legLeftGroup.add(shinGuardLeft);
        group.add(legLeftGroup);

        // Right leg with reinforcement
        const legRightGroup = makeLegGroup('leg-right', 0x8B6914, 0.12, 0);
        const shinGuardRight = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.08), bMetalMat);
        shinGuardRight.position.set(0.12, -0.09, 0.06);
        legRightGroup.add(shinGuardRight);
        group.add(legRightGroup);

        break;
      }
      case UnitType.LUMBERJACK: {
        // ═══ LUMBERJACK — Rugged woodsman with character ═══
        const lumbTunic = getCachedLambert(0x558020);
        const lumbBrown = getCachedLambert(darkenColor(s.secondary, 0.15)); // tribe plaid
        const lumbLeather = getCachedLambert(darkenColor(s.secondary, 0.25)); // tribe leather
        const lumbTeam = getCachedLambert(playerColor);
        const lumbFur = getCachedLambert(darkenColor(s.secondary, 0.20)); // tribe fur
        const lumbMetal = getCachedLambert(s.accent); // tribe metal
        const lumbWood = getCachedLambert(0x8B4513);
        const lumbBoot = getCachedLambert(darkenColor(s.secondary, 0.35));

        // Body with plaid pattern
        const bodyBase = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.40), lumbTunic);
        bodyBase.position.y = 0.28;
        group.add(bodyBase);
        for (const px of [-0.12, 0, 0.12]) {
          const plaid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.41), lumbBrown);
          plaid.position.set(px, 0.28, 0.005);
          group.add(plaid);
        }
        for (const pz of [-0.10, 0.10]) {
          const plaid = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.55, 0.06), lumbBrown);
          plaid.position.set(0, 0.28, pz);
          group.add(plaid);
        }

        // Leather belt and holster
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.08, 0.42), lumbLeather);
        belt.position.y = 0.08;
        group.add(belt);
        const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.43), lumbMetal);
        buckle.position.set(0.22, 0.08, 0);
        group.add(buckle);
        const holster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.12), lumbLeather);
        holster.position.set(0.18, 0.05, 0.15);
        group.add(holster);

        // Head with face, beard, and cap
        addHead(group, 0.78, [0.35, 0.35, 0.35], 0xffdbac);

        // Eyes — squinting, rugged focus (front = +Z for lumberjack)
        addEyes(group, {
          spacing: 0.08,
          y: 0.80,
          z: 0.16,
          whiteSize: [0.06, 0.035, 0.03],
          pupilSize: [0.035, 0.035, 0.03],
          whiteColor: 0xf0f0f0,
          pupilColor: 0x4a3728,
          pupilZOffset: 0.01,
        });
        // Bushy eyebrows
        addEyebrows(group, 0.08, 0.83, 0.16, [0.08, 0.025, 0.04], 0x4a3728);
        // Mouth — slight grin
        addMouth(group, 0.72, 0.16, [0.10, 0.025, 0.03], 0x8B4513);
        // Nose
        addNose(group, 0.76, 0.19, [0.05, 0.06, 0.06], 0xf0c8a0);

        const beard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.15), lumbFur);
        beard.position.set(0, 0.65, 0.12);
        group.add(beard);
        const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), lumbFur);
        capBase.position.y = 0.93;
        group.add(capBase);
        const capTrim = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.04, 0.40), lumbTeam);
        capTrim.position.y = 0.99;
        group.add(capTrim);
        for (const ex of [-0.15, 0.15]) {
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.12), lumbTeam);
          flap.position.set(ex, 0.85, 0.14);
          group.add(flap);
        }

        // Right arm with two-handed axe
        const lumArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50);
        const lumArmRightElbow = lumArmRight.getObjectByName('arm-right-elbow')!;
        const axeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.55), lumbWood);
        axeHandle.name = 'axe-shaft';
        axeHandle.position.set(0, -0.16, 0.27);
        lumArmRightElbow.add(axeHandle);
        const gripWrap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.20), lumbLeather);
        gripWrap.position.set(0, -0.16, 0.08);
        lumArmRightElbow.add(gripWrap);
        const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.06), lumbMetal);
        pommel.position.set(0, -0.16, -0.10);
        lumArmRightElbow.add(pommel);
        const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.08), lumbMetal);
        axeHead.name = 'axe-head';
        axeHead.position.set(0, 0.02, 0.52);
        lumArmRightElbow.add(axeHead);
        const axeHeadRim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.09), lumbTeam);
        axeHeadRim.position.set(0, 0.12, 0.52);
        lumArmRightElbow.add(axeHeadRim);
        group.add(lumArmRight);

        // Left arm with log
        const lumArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50);
        const lumArmLeftElbow = lumArmLeft.getObjectByName('arm-left-elbow')!;
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.45, 6), lumbWood);
        log.name = 'log';
        log.position.set(0, -0.16, 0.22);
        lumArmLeftElbow.add(log);
        for (let i = 0; i < 3; i++) {
          const barkRing = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.17), lumbBrown);
          barkRing.position.set(0, -0.16 + (i - 1) * 0.18, 0.22);
          lumArmLeftElbow.add(barkRing);
        }
        group.add(lumArmLeft);

        // Back detail
        for (let ri = 0; ri < 2; ri++) {
          const ropeCoil = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), lumbWood);
          ropeCoil.position.set(-0.18, 0.35 - ri * 0.18, -0.22);
          group.add(ropeCoil);
        }
        const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.40, 0.06), lumbTeam);
        strap1.position.set(-0.12, 0.35, -0.215);
        strap1.rotation.z = 0.3;
        group.add(strap1);

        // Legs with boot buckles
        const legLeft = makeLegGroup('leg-left', 0x2c1810, -0.12, 0);
        for (let bi = 0; bi < 2; bi++) {
          const bBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), lumbMetal);
          bBuckle.position.set(-0.18, -0.06 - bi * 0.15, 0.12);
          legLeft.add(bBuckle);
        }
        group.add(legLeft);

        const legRight = makeLegGroup('leg-right', 0x2c1810, 0.12, 0);
        for (let bi = 0; bi < 2; bi++) {
          const bBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), lumbMetal);
          bBuckle.position.set(0.18, -0.06 - bi * 0.15, 0.12);
          legRight.add(bBuckle);
        }
        group.add(legRight);

        break;
      }

      case UnitType.VILLAGER: {
        // ═══ VILLAGER — Peasant farmer with warmth and personality ═══
        const vilTunic = getCachedLambert(lightenColor(s.secondary, 0.20)); // tribe tunic
        const vilVest = getCachedLambert(darkenColor(s.secondary, 0.10)); // tribe vest
        const vilCloth = getCachedLambert(playerColor);
        const vilStraw = getCachedLambert(0xf5deb3);
        const vilWoven = getCachedLambert(s.secondary); // tribe woven
        const vilWood = getCachedLambert(0x8B4513);
        const vilMetal = getCachedLambert(s.accent); // tribe metal
        const vilGreen = getCachedLambert(0x7cb342);

        // Layered tunic body
        const bodyBase = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.40), vilTunic);
        bodyBase.position.y = 0.28;
        group.add(bodyBase);

        // Vest overlay (darker)
        const vest = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.50, 0.41), vilVest);
        vest.position.y = 0.30;
        group.add(vest);

        // Cloth apron with pockets
        const apron = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.42), vilCloth);
        apron.position.y = 0.20;
        group.add(apron);
        
        // Apron pockets
        for (const px of [-0.08, 0.08]) {
          const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.06), vilCloth);
          pocket.position.set(px, 0.10, 0.22);
          group.add(pocket);
        }

        // Woven belt
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.42), vilWoven);
        belt.position.y = 0.08;
        group.add(belt);

        // Seed pouch on belt
        const seedPouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.10), vilCloth);
        seedPouch.position.set(0.18, 0.05, 0.18);
        group.add(seedPouch);

        // Patched trousers (lower body, offset color for patches)
        const pants = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.25, 0.42), getCachedLambert(0xa0764f));
        pants.position.y = -0.05;
        group.add(pants);
        
        // Patches on pants
        for (let pi = 0; pi < 4; pi++) {
          const patch = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.06), vilWoven);
          patch.position.set(-0.12 + (pi % 2) * 0.24, -0.08 - Math.floor(pi / 2) * 0.10, 0.22);
          group.add(patch);
        }

        // Head: Friendly face with eyes, freckles, and warm smile
        addHead(group, 0.78, [0.35, 0.35, 0.35], 0xffdbac);

        // Eyes — warm, friendly (front = +Z for villager, green eyes for farmer)
        addEyes(group, {
          spacing: 0.08,
          y: 0.80,
          z: 0.16,
          whiteSize: [0.06, 0.04, 0.03],
          pupilSize: [0.035, 0.04, 0.03],
          whiteColor: 0xf0f0f0,
          pupilColor: 0x4a7023,
          pupilZOffset: 0.01,
        });
        // Gentle eyebrows
        addEyebrows(group, 0.08, 0.835, 0.16, [0.07, 0.02, 0.03], 0x8B6914);
        // Warm smile
        addMouth(group, 0.72, 0.16, [0.12, 0.02, 0.03], 0xc47a5a);
        // Rosy cheeks (freckled farmer look)
        for (const cx of [-0.10, 0.10]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), getCachedLambert(0xf0a090));
          cheek.position.set(cx, 0.74, 0.16);
          group.add(cheek);
        }
        // Nose
        addNose(group, 0.76, 0.19, [0.04, 0.05, 0.05], 0xf0c8a0);

        // Wide-brim straw hat with woven texture (layered)
        const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.48), vilStraw);
        hatBrim.position.y = 0.92;
        group.add(hatBrim);
        
        // Hat brim texture (offset rings)
        for (let hi = 0; hi < 2; hi++) {
          const brimRing = new THREE.Mesh(new THREE.BoxGeometry(0.46 - hi * 0.08, 0.02, 0.46 - hi * 0.08), vilWoven);
          brimRing.position.set(0, 0.94 - hi * 0.03, 0);
          group.add(brimRing);
        }

        const hatTop = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.32), vilStraw);
        hatTop.position.y = 1.02;
        group.add(hatTop);

        // Team-color ribbon band
        const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.35), vilCloth);
        ribbon.position.y = 0.96;
        group.add(ribbon);

        // Right arm with elegant scythe
        const vilArmRight = makeArmGroup('arm-right', 0xffdbac, 0.3, 0.50);
        const vilArmRightElbow = vilArmRight.getObjectByName('arm-right-elbow')!;

        const scytheHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.65), vilWood);
        scytheHandle.name = 'scythe-shaft';
        scytheHandle.position.set(0, -0.16, 0.32);
        vilArmRightElbow.add(scytheHandle);

        // Handle wrapping
        const handleWrap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.18), vilCloth);
        handleWrap.position.set(0, -0.16, 0.08);
        vilArmRightElbow.add(handleWrap);

        // Scythe curved blade (approximated with box rotated)
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.10), vilMetal);
        blade.name = 'scythe-blade';
        blade.position.set(0.14, -0.16, 0.68);
        blade.rotation.z = 0.4;
        vilArmRightElbow.add(blade);

        // Blade rim (darker edge)
        const bladeRim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.11), getCachedLambert(0x888888));
        bladeRim.position.set(0.14, -0.12, 0.68);
        vilArmRightElbow.add(bladeRim);

        group.add(vilArmRight);

        // Left arm with wicker basket (shows crops)
        const vilArmLeft = makeArmGroup('arm-left', 0xffdbac, -0.3, 0.50);
        const vilArmLeftElbow = vilArmLeft.getObjectByName('arm-left-elbow')!;

        // Wicker basket (box approximation)
        const basket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), vilWoven);
        basket.name = 'basket';
        basket.position.set(0, -0.16, 0.22);
        vilArmLeftElbow.add(basket);

        // Basket weave pattern (offset boxes)
        for (let bi = 0; bi < 4; bi++) {
          const weave = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), vilCloth);
          weave.position.set(0, -0.16 - 0.06 + bi * 0.04, 0.22);
          vilArmLeftElbow.add(weave);
        }

        // Crops peeking out (green)
        for (let ci = 0; ci < 3; ci++) {
          const crop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), vilGreen);
          crop.position.set(-0.06 + ci * 0.06, -0.06, 0.22 + (ci % 2) * 0.04);
          vilArmLeftElbow.add(crop);
        }

        group.add(vilArmLeft);

        // Back detail: shoulder bag, watering can, and rake
        // Shoulder bag
        const shoulderBag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.10), vilCloth);
        shoulderBag.position.set(-0.20, 0.35, -0.20);
        group.add(shoulderBag);

        // Watering can (cylindrical approximation)
        const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 6), vilMetal);
        canBody.position.set(0.20, 0.12, -0.20);
        group.add(canBody);
        const canSpout = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), vilMetal);
        canSpout.position.set(0.26, 0.18, -0.20);
        group.add(canSpout);
        const canHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), vilWood);
        canHandle.position.set(0.20, 0.22, -0.20);
        canHandle.rotation.x = 0.8;
        group.add(canHandle);

        // Rake/hoe strapped diagonally on back
        const rakeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.40, 0.04), vilWood);
        rakeHandle.position.set(-0.08, 0.25, -0.22);
        rakeHandle.rotation.z = 0.4;
        group.add(rakeHandle);
        const rakeTines = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.04), vilMetal);
        rakeTines.position.set(-0.08, 0.60, -0.22);
        rakeTines.rotation.z = 0.4;
        group.add(rakeTines);

        // Legs
        group.add(makeLegGroup('leg-left', 0xa0764f, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0xa0764f, 0.12, 0));

        break;
      }

      case UnitType.TREBUCHET: {
        // ═══ TREBUCHET — Ornate siege engine with detailed operator ═══
        // Forward = +Z (matches atan2 facing). Operator stands at -Z (rear).
        // Built at 1.6x scale so operator is human-sized relative to other units.
        const trebGroup = new THREE.Group();
        trebGroup.name = 'trebuchet-body';
        trebGroup.scale.set(1.6, 1.6, 1.6);
        trebGroup.position.y = -0.1;

        // ─── Materials ───
        const mWoodDark = getCachedLambert(0x5d4037);
        const mWoodMed = getCachedLambert(0x6d4c2a);
        const mWoodLight = getCachedLambert(0x8B6914);
        const mIron = getCachedLambert(darkenColor(s.secondary, 0.25)); // tribe iron
        const mIronDark = getCachedLambert(darkenColor(s.secondary, 0.35)); // tribe dark iron
        const mRope = getCachedLambert(0xc4a56a);
        const mGold = getCachedLambert(s.accent); // tribe gold trim
        const mTeam = getCachedLambert(playerColor);
        const mSkin = getCachedLambert(0xffdbac);
        const mLeather = getCachedLambert(s.secondary); // tribe leather
        const mLeatherDark = getCachedLambert(darkenColor(s.secondary, 0.20)); // tribe dark leather
        const mBone = getCachedLambert(lightenColor(s.trim, 0.15)); // tribe bone

        const tg = trebGroup;

        // ══════════════════════════════════
        // ── CART BASE (layered platform) ──
        // ══════════════════════════════════

        // Main platform plank
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 1.2), mWoodMed);
        base.position.y = 0.28;
        base.castShadow = true;
        tg.add(base);
        // Top plank layer (slightly offset for depth)
        const baseTop = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 1.16), mWoodDark);
        baseTop.position.y = 0.36;
        tg.add(baseTop);
        // Undercarriage reinforcement beams (2 lengthwise)
        for (const ux of [-0.28, 0.28]) {
          const ubeam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.1), mWoodDark);
          ubeam.position.set(ux, 0.20, 0);
          tg.add(ubeam);
        }
        // Iron corner brackets (8 corners)
        for (const cx of [-0.42, 0.42]) {
          for (const cz of [-0.56, 0.56]) {
            const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.10), mIron);
            bracket.position.set(cx, 0.28, cz);
            tg.add(bracket);
          }
        }
        // Side rail trim (team color)
        for (const sx of [-0.46, 0.46]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 1.0), mTeam);
          rail.position.set(sx, 0.32, 0);
          tg.add(rail);
        }

        // ══════════════════════════
        // ── 4 WHEELS (detailed) ──
        // ══════════════════════════
        const wheelPositions: [number, number, string][] = [
          [-0.5, 0.38, 'wheel-fl'], [0.5, 0.38, 'wheel-fr'],
          [-0.5, -0.38, 'wheel-bl'], [0.5, -0.38, 'wheel-br'],
        ];
        for (const [wx, wz, wn] of wheelPositions) {
          const wg = new THREE.Group();
          wg.name = wn;
          wg.position.set(wx, 0.18, wz);
          // Outer rim
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.36, 0.36), mWoodDark));
          // Inner disc
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.28), mWoodMed));
          // Cross spokes (4-way)
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, 0.05), mWoodDark));
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.30), mWoodDark));
          // Diagonal spokes
          const diagA = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.04), mWoodDark);
          diagA.rotation.x = Math.PI / 4;
          wg.add(diagA);
          const diagB = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.04), mWoodDark);
          diagB.rotation.x = -Math.PI / 4;
          wg.add(diagB);
          // Iron hub (center boss)
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.12), mIron));
          // Hub stud
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), mGold));
          // Iron tire band
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.04), mIron));
          wg.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.38), mIron));
          tg.add(wg);
        }

        // ── AXLES with iron caps ──
        for (const az of [0.38, -0.38]) {
          const axle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), mIron);
          axle.position.set(0, 0.18, az);
          tg.add(axle);
          // Axle cap rings
          for (const acx of [-0.52, 0.52]) {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.10), mIronDark);
            cap.position.set(acx, 0.18, az);
            tg.add(cap);
          }
        }

        // ══════════════════════════════════════════
        // ── A-FRAME UPRIGHTS (reinforced towers) ──
        // ══════════════════════════════════════════
        for (const sx of [-0.25, 0.25]) {
          // Main post
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 0.16), mWoodDark);
          post.position.set(sx, 0.80, 0.1);
          post.rotation.z = sx > 0 ? -0.08 : 0.08;
          tg.add(post);
          // Iron banding on posts (3 bands)
          for (const by of [0.50, 0.80, 1.10]) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.18), mIron);
            band.position.set(sx, by, 0.1);
            band.rotation.z = sx > 0 ? -0.08 : 0.08;
            tg.add(band);
          }
        }
        // Diagonal braces (A-frame cross struts)
        for (const sx of [-0.25, 0.25]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.60, 0.06), mWoodMed);
          brace.position.set(sx, 0.65, 0.30);
          brace.rotation.x = 0.35;
          brace.rotation.z = sx > 0 ? -0.08 : 0.08;
          tg.add(brace);
        }

        // Crossbeam at top (reinforced)
        const xbeam = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.12, 0.14), mWoodDark);
        xbeam.position.set(0, 1.25, 0.1);
        tg.add(xbeam);
        // Iron plates on crossbeam ends
        for (const bx of [-0.30, 0.30]) {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.16), mIron);
          plate.position.set(bx, 1.25, 0.1);
          tg.add(plate);
        }
        // Gold pivot pins
        for (const px of [-0.06, 0.06]) {
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), mGold);
          pin.position.set(px, 1.25, 0.1);
          pin.rotation.z = Math.PI / 2;
          tg.add(pin);
        }

        // ═══════════════════════════════════════
        // ── THROWING ARM (detailed, with rope) ──
        // ═══════════════════════════════════════
        const armPivot = new THREE.Group();
        armPivot.name = 'throw-arm';
        armPivot.position.set(0, 1.25, 0.1);
        armPivot.rotation.x = 0.25;

        // Main beam (tapered look via layering)
        const beamCore = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 1.5), mWoodLight);
        beamCore.position.z = -0.15;
        armPivot.add(beamCore);
        // Beam reinforcement strips
        const beamReinf = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.4), mWoodMed);
        beamReinf.position.z = -0.15;
        armPivot.add(beamReinf);
        // Iron bands along arm (every ~0.3 units)
        for (const bz of [-0.70, -0.40, -0.10, 0.20, 0.50]) {
          const armBand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.03), mIron);
          armBand.position.set(0, 0, bz);
          armPivot.add(armBand);
        }

        // Counterweight on SHORT arm (forward, +Z — heavy iron box with detail)
        const cwBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), mIronDark);
        cwBox.position.set(0, -0.18, 0.50);
        armPivot.add(cwBox);
        // Counterweight iron bands
        const cwBand1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), mIron);
        cwBand1.position.set(0, -0.08, 0.50);
        armPivot.add(cwBand1);
        const cwBand2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), mIron);
        cwBand2.position.set(0, -0.28, 0.50);
        armPivot.add(cwBand2);
        // Counterweight chain links (connecting to arm)
        for (const clz of [0.44, 0.48]) {
          const chain = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), mIron);
          chain.position.set(0, -0.02, clz);
          armPivot.add(chain);
        }

        // Sling basket on LONG arm (behind, -Z)
        const sling = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), mRope);
        sling.position.set(0, -0.08, -0.88);
        armPivot.add(sling);
        // Sling rope strands
        for (const srx of [-0.08, 0.08]) {
          const strand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mRope);
          strand.position.set(srx, -0.02, -0.80);
          strand.rotation.x = 0.3;
          armPivot.add(strand);
        }

        // Boulder in sling
        const boulder = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), getCachedLambert(0x888888));
        boulder.position.set(0, 0.01, -0.88);
        armPivot.add(boulder);

        // Rope lashings at pivot point
        const lashing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), mRope);
        armPivot.add(lashing);
        // Extra rope coils
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), mRope);
        coil.position.set(0, 0.08, 0);
        coil.rotation.z = Math.PI / 2;
        armPivot.add(coil);

        tg.add(armPivot);

        // ══════════════════════════════════════
        // ── TEAM COLOR & DECORATIONS ──
        // ══════════════════════════════════════

        // Banner on right post (cloth with trim)
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.30, 0.22), mTeam);
        banner.position.set(0.32, 1.0, 0.1);
        tg.add(banner);
        // Banner gold trim (top bar)
        const bannerBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.24), mGold);
        bannerBar.position.set(0.32, 1.15, 0.1);
        tg.add(bannerBar);
        // Banner emblem (small rotated square)
        const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.10), mGold);
        emblem.position.set(0.33, 0.98, 0.1);
        emblem.rotation.x = Math.PI / 4;
        tg.add(emblem);

        // Shield on left side (layered)
        const shieldBack = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.22), mWoodDark);
        shieldBack.position.set(-0.47, 0.42, 0);
        tg.add(shieldBack);
        const shieldFace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.20, 0.20), mTeam);
        shieldFace.position.set(-0.48, 0.42, 0);
        tg.add(shieldFace);
        // Shield boss (center)
        const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), mGold);
        shieldBoss.position.set(-0.50, 0.42, 0);
        tg.add(shieldBoss);
        // Shield rim
        const shieldRim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.02), mIron);
        shieldRim.position.set(-0.48, 0.42, 0);
        tg.add(shieldRim);

        // Ammo crate (near rear, stacked boulders)
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.20), mWoodDark);
        crate.position.set(0.30, 0.42, -0.40);
        tg.add(crate);
        const crateRim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.22), mIron);
        crateRim.position.set(0.30, 0.50, -0.40);
        tg.add(crateRim);
        // Spare boulders in crate
        for (const boff of [[-0.04, 0], [0.04, 0], [0, 0.04]] as [number, number][]) {
          const spare = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), getCachedLambert(0x888888));
          spare.position.set(0.30 + boff[0], 0.54, -0.40 + boff[1]);
          tg.add(spare);
        }

        // Rope coil on cart (visual detail)
        const cartRope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8), mRope);
        cartRope.position.set(-0.30, 0.40, -0.35);
        cartRope.rotation.x = Math.PI / 2;
        tg.add(cartRope);
        // Inner rope hole
        const ropeHole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), mWoodDark);
        ropeHole.position.set(-0.30, 0.40, -0.35);
        ropeHole.rotation.x = Math.PI / 2;
        tg.add(ropeHole);

        // Winch mechanism on side
        const winchPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), mWoodDark);
        winchPost.position.set(0.46, 0.48, -0.15);
        tg.add(winchPost);
        const winchDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), mIron);
        winchDrum.position.set(0.46, 0.56, -0.15);
        winchDrum.rotation.z = Math.PI / 2;
        tg.add(winchDrum);
        const winchHandle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), mIron);
        winchHandle.position.set(0.50, 0.56, -0.15);
        tg.add(winchHandle);

        // ══════════════════════════════════════════════
        // ── OPERATOR (detailed artillerist at rear) ──
        // ══════════════════════════════════════════════
        const opZ = -0.85;

        // --- Torso (layered leather armor) ---
        const opBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.40, 0.28), mLeather);
        opBody.position.set(0, 0.46, opZ);
        tg.add(opBody);
        // Chest armor plate
        const opChest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.30, 0.06), mLeatherDark);
        opChest.position.set(0, 0.48, opZ + 0.16);
        tg.add(opChest);
        // Shoulder straps
        for (const stx of [-0.12, 0.12]) {
          const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.04), mLeatherDark);
          strap.position.set(stx, 0.50, opZ + 0.14);
          tg.add(strap);
        }
        // Back armor plate
        const opBack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.30, 0.06), mLeatherDark);
        opBack.position.set(0, 0.48, opZ - 0.16);
        tg.add(opBack);
        // Back spine ridge
        const opSpine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.08), mIron);
        opSpine.position.set(0, 0.48, opZ - 0.18);
        tg.add(opSpine);

        // Belt with team color and buckle
        const opBelt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.30), mTeam);
        opBelt.position.set(0, 0.34, opZ);
        tg.add(opBelt);
        const opBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.04), mGold);
        opBuckle.position.set(0, 0.34, opZ + 0.16);
        tg.add(opBuckle);
        // Belt pouch
        const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.06), mLeather);
        pouch.position.set(-0.14, 0.34, opZ + 0.12);
        tg.add(pouch);
        // Tool loop (hammer handle sticking out)
        const toolHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), mWoodMed);
        toolHandle.position.set(0.14, 0.38, opZ + 0.10);
        toolHandle.rotation.z = 0.2;
        tg.add(toolHandle);
        const toolHead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.06), mIron);
        toolHead.position.set(0.15, 0.46, opZ + 0.10);
        tg.add(toolHead);

        // --- Head (with face, helmet) ---
        const opHead = addHead(tg, 0.78, [0.24, 0.24, 0.24], 0xffdbac);
        opHead.position.z = opZ;

        // Eyes (white surround + brown pupils)
        for (const ex of [-0.05, 0.05]) {
          const eWhite = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), getCachedLambert(0xf0f0f0));
          eWhite.position.set(ex, 0.80, opZ + 0.13);
          tg.add(eWhite);
          const ePupil = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), getCachedLambert(0x3b2507));
          ePupil.position.set(ex, 0.80, opZ + 0.145);
          tg.add(ePupil);
        }
        // Eyebrows (focused/determined — angled inward) — custom rotation
        const browCol = getCachedLambert(0x3e2723);
        const opBrowL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), browCol);
        opBrowL.position.set(-0.05, 0.835, opZ + 0.13);
        opBrowL.rotation.z = -0.15;
        tg.add(opBrowL);
        const opBrowR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), browCol);
        opBrowR.position.set(0.05, 0.835, opZ + 0.13);
        opBrowR.rotation.z = 0.15;
        tg.add(opBrowR);
        // Nose
        addNose(tg, 0.78, 0.14, [0.04, 0.04, 0.04], 0xffdbac);
        // adjust position to trebuchet's opZ offset
        const noseMesh = tg.children[tg.children.length - 1] as THREE.Mesh;
        noseMesh.position.z = opZ;
        // Mouth (thin line, slight grin)
        const opMouth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.02), getCachedLambert(0x8d5524));
        opMouth.position.set(0, 0.745, opZ + 0.13);
        tg.add(opMouth);
        // Chin
        const opChin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.06), getCachedLambert(0xffdbac));
        opChin.position.set(0, 0.72, opZ + 0.08);
        tg.add(opChin);
        // Stubble / beard shadow
        const opStubble = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), getCachedLambert(0xc8a882));
        opStubble.position.set(0, 0.73, opZ + 0.10);
        tg.add(opStubble);

        // Leather helmet (open-face with brow guard)
        const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.26), mLeatherDark);
        helmet.position.set(0, 0.90, opZ);
        tg.add(helmet);
        // Helmet brow guard (iron strip)
        const browGuard = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.04, 0.06), mIron);
        browGuard.position.set(0, 0.86, opZ + 0.12);
        tg.add(browGuard);
        // Helmet crest (team color ridge)
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.22), mTeam);
        crest.position.set(0, 0.98, opZ);
        tg.add(crest);
        // Helmet ear flaps
        for (const efx of [-0.13, 0.13]) {
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.10), mLeatherDark);
          flap.position.set(efx, 0.82, opZ);
          tg.add(flap);
        }
        // Helmet chin strap
        const chinStrap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.03), mLeather);
        chinStrap.position.set(0, 0.72, opZ + 0.06);
        tg.add(chinStrap);

        // Shoulder pauldrons (small, leather with iron studs)
        for (const psx of [-0.22, 0.22]) {
          const pauld = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.14), mLeatherDark);
          pauld.position.set(psx, 0.60, opZ);
          tg.add(pauld);
          // Iron stud on pauldron
          const stud = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), mIron);
          stud.position.set(psx, 0.62, opZ + 0.07);
          tg.add(stud);
        }

        // Operator arms (reaching forward to work the machine)
        const oArmR = makeArmGroup('arm-right', 0xffdbac, 0.24, 0.54);
        oArmR.position.z = opZ;
        oArmR.rotation.x = 0.8;
        tg.add(oArmR);
        const oArmL = makeArmGroup('arm-left', 0xffdbac, -0.24, 0.54);
        oArmL.position.z = opZ;
        oArmL.rotation.x = 0.8;
        tg.add(oArmL);
        // Gloves / gauntlets on hands (cuff detail)
        for (const gx of [-0.24, 0.24]) {
          const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.10), mLeatherDark);
          cuff.position.set(gx, 0.42, opZ + 0.12);
          tg.add(cuff);
        }

        // Operator legs (sturdy, with knee guards)
        const oLegL = makeLegGroup('leg-left', 0x5a4a3a, -0.10, 0.25);
        oLegL.position.z = opZ;
        tg.add(oLegL);
        const oLegR = makeLegGroup('leg-right', 0x5a4a3a, 0.10, 0.25);
        oLegR.position.z = opZ;
        tg.add(oLegR);
        // Knee guards
        for (const kx of [-0.10, 0.10]) {
          const kneeGuard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), mIron);
          kneeGuard.position.set(kx, 0.14, opZ + 0.08);
          tg.add(kneeGuard);
        }
        // Boots (over feet)
        for (const bx of [-0.10, 0.10]) {
          const boot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.12), mLeatherDark);
          boot.position.set(bx, 0.02, opZ + 0.02);
          tg.add(boot);
        }

        // ── BACK DETAIL (cart rear) ──
        // Rear bumper beam
        const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.06), mWoodDark);
        rearBumper.position.set(0, 0.32, -0.62);
        tg.add(rearBumper);
        // Iron reinforcement on rear
        const rearIron = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.06, 0.07), mIron);
        rearIron.position.set(0, 0.32, -0.63);
        tg.add(rearIron);
        // Team color tabard on rear (identifying the siege crew)
        const rearTabard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.03), mTeam);
        rearTabard.position.set(0, 0.42, -0.63);
        tg.add(rearTabard);
        // Gold border on rear tabard
        const tabardBorder = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.04), mGold);
        tabardBorder.position.set(0, 0.50, -0.63);
        tg.add(tabardBorder);

        group.add(trebGroup);
        break;
      }
      case UnitType.HEALER: {
        // === HEALER — Ornate cleric with flowing robes, healing staff, crystal focus ===

        // --- TORSO: layered white/ivory robes with green trim ---
        const hRobe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.65, 0.44), getCachedLambert(0xf5f5f0));
        hRobe.position.y = 0.32;
        hRobe.castShadow = true;
        group.add(hRobe);
        // Inner robe layer (slightly darker, peeks at edges)
        const hInner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.38), getCachedLambert(0xe8e8e0));
        hInner.position.set(0, 0.32, 0.04);
        group.add(hInner);
        // Front robe panel — open collar showing inner layer
        const hFrontPanel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.06), getCachedLambert(0xe0e0d8));
        hFrontPanel.position.set(0, 0.34, 0.24);
        group.add(hFrontPanel);
        // Green trim lines down front opening
        for (const tx of [-0.1, 0.1]) {
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.52, 0.02), getCachedLambert(0x00c853));
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
        addBelt(group, {
          color: playerColor,
          y: 0.06,
          width: 0.52,
          height: 0.08,
          depth: 0.48,
          buckleColor: s.accent,
          buckleZ: 0.25,
          buckleSize: [0.1, 0.08, 0.04],
        });
        // Sash hanging from belt (team color, diagonal)
        const hSash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.04), getCachedLambert(playerColor));
        hSash.position.set(0.12, -0.08, 0.2);
        hSash.rotation.z = -0.15;
        group.add(hSash);
        // Flowing robe skirt (wider at bottom)
        const hSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.5), getCachedLambert(0xf0f0e8));
        hSkirt.position.set(0, -0.08, 0);
        group.add(hSkirt);
        const hSkirtBottom = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.54), getCachedLambert(0xe8e8e0));
        hSkirtBottom.position.set(0, -0.16, 0);
        group.add(hSkirtBottom);
        // Green trim at skirt hem
        const hHemTrim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.03, 0.56), getCachedLambert(0x00c853));
        hHemTrim.position.set(0, -0.19, 0);
        group.add(hHemTrim);

        // --- BACK: robe detail, hood drape, embroidered symbol ---
        const hBackPanel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.06), getCachedLambert(0xe8e8e0));
        hBackPanel.position.set(0, 0.36, -0.24);
        group.add(hBackPanel);
        // Embroidered green vine pattern on back (vertical + leaf accents)
        const hBackVine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.02), getCachedLambert(0x00c853));
        hBackVine.position.set(0, 0.36, -0.28);
        group.add(hBackVine);
        for (const [lx, ly] of [[0.06, 0.48], [-0.06, 0.38], [0.06, 0.28], [-0.06, 0.18]] as [number, number][]) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), getCachedLambert(0x00e676));
          leaf.position.set(lx, ly, -0.28);
          group.add(leaf);
        }

        // --- HEAD: warm, kind face with flowing hood ---
        addHead(group, 0.86, [0.32, 0.32, 0.32], 0xffdbac);
        // Kind eyes — warm brown with white surround, gentle shape
        addEyes(group, {
          spacing: 0.08,
          y: 0.89,
          z: 0.17,
          whiteSize: [0.07, 0.04, 0.02],
          pupilSize: [0.04, 0.04, 0.02],
          whiteColor: 0xf5f5f5,
          pupilColor: 0x5d4037,
          pupilZOffset: 0.005,
        });
        // Gentle eyebrows — slightly raised (kind expression) — custom rotation
        for (const [bx, bz] of [[-0.08, 0.05], [0.08, -0.05]] as [number, number][]) {
          const hBrow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), getCachedLambert(0x8d6e4a));
          hBrow.position.set(bx, 0.92, 0.17);
          hBrow.rotation.z = bz;
          group.add(hBrow);
        }
        // Nose — soft rounded ridge
        addNose(group, 0.86, 0.18, [0.04, 0.06, 0.04], 0xf5d0a0);
        // Mouth — gentle smile (slightly upturned)
        addMouth(group, 0.8, 0.17, [0.1, 0.02, 0.02], 0xc08060);
        // Smile corners (tiny upward ticks)
        for (const mx of [-0.055, 0.055]) {
          const corner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), getCachedLambert(0xc08060));
          corner.position.set(mx, 0.81, 0.17);
          group.add(corner);
        }
        // Chin
        const hChin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), getCachedLambert(0xffdbac));
        hChin.position.set(0, 0.76, 0.14);
        group.add(hChin);

        // Hood — deep cowl shape with box layers
        const hHoodMain = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, 0.4), getCachedLambert(0xf0f0e8));
        hHoodMain.position.set(0, 0.99, 0.02);
        group.add(hHoodMain);
        // Hood peak
        const hHoodPeak = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), getCachedLambert(0xf0f0e8));
        hHoodPeak.position.set(0, 1.08, 0);
        group.add(hHoodPeak);
        // Hood brow overhang (casts shadow on face)
        const hHoodBrow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.12), getCachedLambert(0xe8e8e0));
        hHoodBrow.position.set(0, 0.94, 0.2);
        group.add(hHoodBrow);
        // Hood back drape (falls behind neck)
        const hHoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.1), getCachedLambert(0xe8e8e0));
        hHoodBack.position.set(0, 0.78, -0.22);
        group.add(hHoodBack);
        // Green hood trim (runs around edge)
        const hHoodTrim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), getCachedLambert(0x00c853));
        hHoodTrim.position.y = 0.89;
        group.add(hHoodTrim);

        // --- LEFT ARM: open hand with green glow orb (casting hand) ---
        const hArmL = makeArmGroup('arm-left', 0xf0f0e8, -0.3, 0.52);
        const hArmLElbow = hArmL.getObjectByName('arm-left-elbow')!;
        // Sleeve cuff trim (stays on arm)
        const hCuffL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), getCachedLambert(0x00c853));
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
        const hCuffR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), getCachedLambert(0x00c853));
        hCuffR.position.set(0, -0.08, 0);
        hArmR.add(hCuffR);
        // Staff wrapper group — tilted forward 25° so it doesn't clip shoulder
        const hStaffGrp = new THREE.Group();
        hStaffGrp.rotation.x = 0.436; // 25 degrees forward tilt
        hArmRElbow.add(hStaffGrp);
        // Staff shaft — dark wood
        const hStaff = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6),
          getCachedLambert(0x5d4037)
        );
        hStaff.position.set(0, 0.15, 0.1);
        hStaffGrp.add(hStaff);
        // Staff head — golden cradle/cage holding a crystal
        const hCradleRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.08, 0.015, 6, 8),
          getCachedLambert(s.accent)
        );
        hCradleRing.position.set(0, 0.75, 0.1);
        hCradleRing.rotation.x = Math.PI / 2;
        hStaffGrp.add(hCradleRing);
        // Four gold prongs curving up to hold crystal
        for (let pi = 0; pi < 4; pi++) {
          const pAngle = (pi / 4) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), getCachedLambert(s.accent));
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
            getCachedLambert(s.accent)
          );
          band.position.set(0, gy, 0.1);
          hStaffGrp.add(band);
        }
        group.add(hArmR);

        // --- LEGS (hidden under robe, just peeks of boots) ---
        group.add(makeLegGroup('leg-left', darkenColor(s.secondary, 0.20), -0.12, 0));
        group.add(makeLegGroup('leg-right', darkenColor(s.secondary, 0.20), 0.12, 0));

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
        // Shared skinned materials
        const assBodyColor = darkenColor(s.secondary, 0.40); // very dark version of tribe secondary
        const assStrapColor = darkenColor(s.secondary, 0.25); // slightly lighter straps
        // Slim torso — dark leather armor
        const aBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.35), getCachedLambert(assBodyColor));
        aBody.position.y = 0.28;
        aBody.castShadow = true;
        group.add(aBody);
        // Leather straps across chest (X pattern)
        const strapMat = getCachedLambert(assStrapColor);
        const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.37), strapMat);
        strapL.position.set(0, 0.3, 0);
        strapL.rotation.z = 0.35;
        group.add(strapL);
        const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.37), strapMat);
        strapR.position.set(0, 0.3, 0);
        strapR.rotation.z = -0.35;
        group.add(strapR);
        // Team color belt with poison vials
        addBelt(group, {
          color: playerColor,
          y: 0.05,
          width: 0.4,
          height: 0.06,
          depth: 0.37,
          buckleColor: null,
        });
        // Tiny poison vials on belt
        const vialMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.4 });
        for (const vx of [-0.1, 0.0, 0.1]) {
          const vial = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), vialMat);
          vial.position.set(vx, 0.05, 0.18);
          group.add(vial);
        }
        // Hooded head — deep cowl
        const aHoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.38), getCachedLambert(0x0d001a));
        aHoodBack.position.y = 0.78;
        group.add(aHoodBack);
        // Hood peak (pointed front drape)
        const hoodPeak = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.1), getCachedLambert(0x0d001a));
        hoodPeak.position.set(0, 0.9, 0.2);
        group.add(hoodPeak);
        // Face shadow (dark recessed area under hood)
        const faceShadow = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.04), getCachedLambert(0x050010));
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
          const sPad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.15), getCachedLambert(playerColor));
          sPad.position.set(sx, 0.55, 0);
          group.add(sPad);
        }
        // LEFT ARM with WICKED DAGGER
        const aArmL = makeArmGroup('arm-left', 0x1a0033, -0.24, 0.48);
        const aArmLElbow = aArmL.getObjectByName('arm-left-elbow')!;
        const daggerBladeMat = getCachedLambert(0xd0d0d0);
        const daggerPoisonMat = new THREE.MeshLambertMaterial({ color: 0x76ff03, emissive: 0x76ff03, emissiveIntensity: 0.3 });
        // Left dagger blade (extends forward from hand)
        const ldBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        ldBlade.name = 'dagger-blade-left';
        ldBlade.position.set(0, -0.16, 0.25);
        aArmLElbow.add(ldBlade);
        // Left poison edge
        const ldPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        ldPoison.name = 'dagger-poison-left';
        ldPoison.position.set(-0.03, -0.16, 0.25);
        aArmLElbow.add(ldPoison);
        // Left grip
        const ldGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), getCachedLambert(0x1a0033));
        ldGrip.name = 'dagger-grip-left';
        ldGrip.position.set(0, -0.16, 0.02);
        aArmLElbow.add(ldGrip);
        group.add(aArmL);
        // RIGHT ARM with WICKED DAGGER
        const aArmR = makeArmGroup('arm-right', 0x1a0033, 0.24, 0.48);
        const aArmRElbow = aArmR.getObjectByName('arm-right-elbow')!;
        const rdBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.4), daggerBladeMat);
        rdBlade.name = 'dagger-blade-right';
        rdBlade.position.set(0, -0.16, 0.25);
        aArmRElbow.add(rdBlade);
        const rdPoison = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.35), daggerPoisonMat);
        rdPoison.name = 'dagger-poison-right';
        rdPoison.position.set(0.03, -0.16, 0.25);
        aArmRElbow.add(rdPoison);
        const rdGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), getCachedLambert(0x1a0033));
        rdGrip.name = 'dagger-grip-right';
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

        // --- Shared materials (tribe-skinned) ---
        const sbPlate = getCachedLambert(s.secondary);
        const sbPlateHi = getCachedLambert(lightenColor(s.secondary, 0.08));
        const sbPlateXHi = getCachedLambert(lightenColor(s.secondary, 0.15));
        const sbPlateDk = getCachedLambert(darkenColor(s.secondary, 0.15));
        const sbPlateMd = getCachedLambert(darkenColor(s.secondary, 0.05));
        const sbGoldMat = getCachedLambert(s.trim);

        // --- TORSO: layered plate armor ---
        // Inner breastplate
        const sbChest = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 0.55), sbPlate);
        sbChest.position.y = 0.35;
        sbChest.castShadow = true;
        group.add(sbChest);
        // Front plate overlay (slightly protruding, lighter steel)
        const sbFrontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), sbPlateHi);
        sbFrontPlate.position.set(0, 0.4, 0.28);
        group.add(sbFrontPlate);
        // Belt / waist guard with buckle (tribe-skinned)
        addBelt(group, {
          color: 0x5d4037,
          y: 0.05,
          width: 0.68,
          height: 0.1,
          depth: 0.58,
          buckleColor: s.trim,
          buckleZ: 0.3,
          buckleSize: [0.12, 0.08, 0.05],
        });
        // Gorget (neck guard)
        const sbGorget = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.48), sbPlateMd);
        sbGorget.position.set(0, 0.72, 0);
        group.add(sbGorget);

        // --- SHOULDER PAULDRONS: big blocky layered plates (team color) ---
        for (const sx of [-0.38, 0.38]) {
          // Main pauldron block
          const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.36), getCachedLambert(playerColor));
          pauldron.position.set(sx, 0.68, 0);
          group.add(pauldron);
          // Pauldron top ridge
          const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.28), sbPlateXHi);
          ridge.position.set(sx, 0.77, 0);
          group.add(ridge);
          // Pauldron edge trim
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.03, 0.38), sbGoldMat);
          trim.position.set(sx, 0.62, 0);
          group.add(trim);
        }

        // --- HELMET: Great helm with T-visor, crest, and face plate (tribe-skinned) ---
        // Main helm block
        const sbHelm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.46), sbPlateDk);
        sbHelm.position.y = 0.95;
        group.add(sbHelm);
        // Helm top crest / ridge (raised stripe on top)
        const sbCrest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), getCachedLambert(playerColor));
        sbCrest.position.set(0, 1.2, 0);
        group.add(sbCrest);
        // Face plate (slightly forward, darker)
        const sbFacePlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.08), getCachedLambert(darkenColor(s.secondary, 0.25)));
        sbFacePlate.position.set(0, 0.92, 0.25);
        group.add(sbFacePlate);
        // T-shaped visor slit (horizontal bar + vertical bar)
        const sbVisorH = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.09), getCachedLambert(0x1a1a1a));
        sbVisorH.position.set(0, 0.95, 0.28);
        group.add(sbVisorH);
        const sbVisorV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.09), getCachedLambert(0x1a1a1a));
        sbVisorV.position.set(0, 0.88, 0.28);
        group.add(sbVisorV);
        // Chin guard (protruding lower jaw plate)
        const sbChin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.12), sbPlateDk);
        sbChin.position.set(0, 0.76, 0.24);
        group.add(sbChin);
        // Helm side cheek guards
        for (const hx of [-0.24, 0.24]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), sbPlateDk);
          cheek.position.set(hx, 0.88, 0.22);
          group.add(cheek);
        }

        // --- LEFT ARM + HEATER SHIELD ---
        const sbArmLeft = makeArmGroup('arm-left', s.secondary, -0.35, 0.55);
        const sbArmLeftElbow = sbArmLeft.getObjectByName('arm-left-elbow')!;
        const shieldGroup = new THREE.Group();
        shieldGroup.name = 'shield-group';
        shieldGroup.position.set(0.1450, -0.3750, 0.2900);
        shieldGroup.rotation.set(0.6584, 0.0184, -0.0716);
        // Main shield body — tall rectangle
        const shMain = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), getCachedLambert(playerColor));
        shMain.position.set(0, 0.05, 0);
        shieldGroup.add(shMain);
        // Bottom point — two angled blocks forming the kite point
        const shPointL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), getCachedLambert(playerColor));
        shPointL.position.set(-0.07, -0.32, 0);
        shPointL.rotation.z = -0.25;
        shieldGroup.add(shPointL);
        const shPointR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), getCachedLambert(playerColor));
        shPointR.position.set(0.07, -0.32, 0);
        shPointR.rotation.z = 0.25;
        shieldGroup.add(shPointR);
        // Rim — top edge
        const shTopRim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.1), sbPlateMd);
        shTopRim.position.set(0, 0.35, 0);
        shieldGroup.add(shTopRim);
        // Rim — side edges
        for (const rx of [-0.28, 0.28]) {
          const shRim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.1), sbPlateMd);
          shRim.position.set(rx, 0.05, 0);
          shieldGroup.add(shRim);
        }
        // Center boss (square, raised)
        const shBoss = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.14), sbGoldMat);
        shBoss.position.set(0, 0.05, 0.06);
        shieldGroup.add(shBoss);
        // Boss spike
        const shSpike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), sbPlateHi);
        shSpike.position.set(0, 0.05, 0.15);
        shieldGroup.add(shSpike);
        // Chevron emblem (upper shield)
        const chevron1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.09), sbGoldMat);
        chevron1.position.set(0, 0.2, 0.01);
        shieldGroup.add(chevron1);
        const chevron2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.09), sbGoldMat);
        chevron2.position.set(0, -0.1, 0.01);
        shieldGroup.add(chevron2);
        // Diagonal cross on lower shield
        const diagL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.09), sbGoldMat);
        diagL.position.set(-0.06, -0.08, 0.01);
        diagL.rotation.z = 0.35;
        shieldGroup.add(diagL);
        const diagR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.09), sbGoldMat);
        diagR.position.set(0.06, -0.08, 0.01);
        diagR.rotation.z = -0.35;
        shieldGroup.add(diagR);
        // Position shield in front of arm (move to elbow, change y from -0.1 to -0.12)
        shieldGroup.position.set(0.25, -0.12, 0.3);
        sbArmLeftElbow.add(shieldGroup);
        group.add(sbArmLeft);

        // --- RIGHT ARM (gauntleted fist) ---
        group.add(makeArmGroup('arm-right', s.secondary, 0.35, 0.55));

        // --- LEGS with armored greaves (tribe-skinned) ---
        group.add(makeLegGroup('leg-left', darkenColor(s.secondary, 0.15), -0.15, 0));
        group.add(makeLegGroup('leg-right', darkenColor(s.secondary, 0.15), 0.15, 0));
        // Knee guards
        for (const kx of [-0.15, 0.15]) {
          const knee = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), sbPlateMd);
          knee.position.set(kx, 0.05, 0.08);
          group.add(knee);
        }
        break;
      }
      case UnitType.BERSERKER: {
        // === BERSERKER — Viking Raider: bare-chested Norse berserker with dual bearded axes ===
        // Design: massive bare torso, chainmail skirt, wolf-pelt mantle, horned helm, rune tattoos,
        // dual bearded axes in tilted wrapper groups with blades facing correct chopping direction.

        // --- Shared materials (tribe-skinned: chainmail/iron use secondary, bronze uses accent) ---
        const bkSkinMat = getCachedLambert(0xd4a574); // weathered Norse skin (universal)
        const bkSkinShadow = getCachedLambert(0xb8895a); // muscle shadow
        const bkChainMat = getCachedLambert(s.secondary); // chainmail
        const bkChainDark = getCachedLambert(darkenColor(s.secondary, 0.15)); // chainmail shadow
        const bkFurMat = getCachedLambert(0x4e3b2a); // wolf pelt (universal)
        const bkFurLight = getCachedLambert(0x6d5640); // lighter fur tufts
        const bkFurDark = getCachedLambert(0x3e2d1c); // dark fur underside
        const bkLeatherMat = getCachedLambert(0x5d4037); // leather straps (universal)
        const bkLeatherDark = getCachedLambert(0x3e2723); // dark leather
        const bkIronMat = getCachedLambert(darkenColor(s.secondary, 0.10)); // dark iron/armor
        const bkSteelMat = getCachedLambert(lightenColor(s.secondary, 0.15)); // polished edge
        const bkBronzeMat = getCachedLambert(s.accent); // decorative fittings
        const bkBoneMat = getCachedLambert(0xe8dcc8); // bone/skull
        const bkPaintMat = getCachedLambert(0x1565c0); // woad blue war paint
        const bkRuneMat = new THREE.MeshBasicMaterial({ color: 0x42a5f5, transparent: true, opacity: 0.8 }); // glowing rune
        const bkTeamMat = getCachedLambert(playerColor);
        const bkEyeMat = getCachedBasic(0xff1744); // rage eyes

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
        addBelt(group, {
          color: 0x5d4037,
          y: 0.24,
          width: 0.64,
          height: 0.08,
          depth: 0.52,
          buckleColor: 0xcd7f32,
          buckleZ: 0.26,
          buckleSize: [0.10, 0.10, 0.04],
        });
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
        const bkBeardMat = getCachedLambert(0x8d6e63);
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
        lAxeGrp.name = 'axe-group-left';
        lAxeGrp.rotation.x = 0.436; // ~25° forward tilt (same as other weapons)
        lAxeGrp.position.set(0, -0.18, 0.06);
        // Handle (dark ash wood, runs along Y — extends upward from hand)
        const lAxeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.70, 6), bkLeatherDark);
        lAxeHandle.name = 'axe-shaft-left';
        lAxeHandle.position.y = 0.20;
        lAxeGrp.add(lAxeHandle);
        // Leather grip wrap at bottom of handle (where hand grips)
        const lAxeGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 6), bkLeatherMat);
        lAxeGrip.position.y = -0.08;
        lAxeGrp.add(lAxeGrip);
        // Bearded axe head — blade at TOP, extends forward (Z) with cutting edge
        const lAxeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), bkIronMat);
        lAxeBlade.name = 'axe-head-left';
        lAxeBlade.position.set(0, 0.42, 0.08);
        lAxeGrp.add(lAxeBlade);
        // Cutting edge (bright steel, thin, extends further forward)
        const lAxeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.08), bkSteelMat);
        lAxeEdge.name = 'axe-edge-left';
        lAxeEdge.position.set(0, 0.42, 0.22);
        lAxeGrp.add(lAxeEdge);
        // Beard extension (the characteristic hook, now upward)
        const lAxeBeard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), bkIronMat);
        lAxeBeard.name = 'axe-beard-left';
        lAxeBeard.position.set(0, 0.52, 0.10);
        lAxeGrp.add(lAxeBeard);
        // Back spike (opposite side of blade)
        const lAxeSpike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.10), bkIronMat);
        lAxeSpike.name = 'axe-spike-left';
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
        rAxeGrp.name = 'axe-group-right';
        rAxeGrp.rotation.x = 0.436; // ~25° forward tilt
        rAxeGrp.position.set(0, -0.18, 0.06);
        // Handle
        const rAxeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.70, 6), bkLeatherDark);
        rAxeHandle.name = 'axe-shaft-right';
        rAxeHandle.position.y = 0.20;
        rAxeGrp.add(rAxeHandle);
        // Leather grip wrap at bottom (hand position)
        const rAxeGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 6), bkLeatherMat);
        rAxeGrip.position.y = -0.08;
        rAxeGrp.add(rAxeGrip);
        // Bearded axe head at TOP — blade extends forward (Z)
        const rAxeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), bkIronMat);
        rAxeBlade.name = 'axe-head-right';
        rAxeBlade.position.set(0, 0.42, 0.08);
        rAxeGrp.add(rAxeBlade);
        // Cutting edge
        const rAxeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.08), bkSteelMat);
        rAxeEdge.name = 'axe-edge-right';
        rAxeEdge.position.set(0, 0.42, 0.22);
        rAxeGrp.add(rAxeEdge);
        // Beard extension (upward hook)
        const rAxeBeard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), bkIronMat);
        rAxeBeard.name = 'axe-beard-right';
        rAxeBeard.position.set(0, 0.52, 0.10);
        rAxeGrp.add(rAxeBeard);
        // Back spike
        const rAxeSpike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.10), bkIronMat);
        rAxeSpike.name = 'axe-spike-right';
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
        const bmPlateMat = getCachedLambert(darkenColor(s.secondary, 0.30)); // tribe dark plate
        const bmPlateHighMat = getCachedLambert(darkenColor(s.secondary, 0.15)); // tribe lighter plate
        const bmRobeMat = getCachedLambert(darkenColor(s.secondary, 0.40)); // tribe deep robe
        const bmRobeDeepMat = getCachedLambert(darkenColor(s.secondary, 0.50)); // tribe darker robe shadow
        const bmGoldMat = getCachedLambert(s.accent); // tribe gold trim
        const bmRuneMat = new THREE.MeshLambertMaterial({ color: s.trim, emissive: s.trim, emissiveIntensity: 0.7 }); // tribe glowing rune
        const bmRuneDimMat = new THREE.MeshLambertMaterial({ color: darkenColor(s.trim, 0.30), emissive: darkenColor(s.trim, 0.30), emissiveIntensity: 0.3 }); // tribe subtle rune
        const bmTeamMat = getCachedLambert(playerColor);
        const bmSkinMat = getCachedLambert(0xffdbac);

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
          getCachedBasic(0xb388ff)
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
          const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), getCachedLambert(0x3e2723));
          pouch.position.set(bpx, 0.28, 0.18);
          group.add(pouch);
          const pouchFlap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), getCachedLambert(0x4e342e));
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
        const bmEyeGlow = getCachedBasic(0xb388ff);
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
          getCachedBasic(0xd500f9)
        );
        bmCircletGem.position.set(0, 0.98, 0.20);
        bmCircletGem.name = 'bm-circlet-gem';
        group.add(bmCircletGem);
        // Short beard visible below helm (grizzled battlemage)
        const bmBeard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.08), getCachedLambert(0x616161));
        bmBeard.position.set(0, 0.76, 0.15);
        group.add(bmBeard);

        // ─── PASS 4: WEAPON — Ornate War-Staff (held vertically) ───
        const bmArmR = makeArmGroup('arm-right', 0x263238, 0.3, 0.52);
        const bmArmRElbow = bmArmR.getObjectByName('arm-right-elbow')!;
        // Staff wrapper group — tilted forward 25° to clear shoulder plates
        const bmStaffGrp = new THREE.Group();
        bmStaffGrp.name = 'staff-group';
        bmStaffGrp.rotation.x = 0.436; // 25 degrees forward tilt
        bmArmRElbow.add(bmStaffGrp);
        // Staff shaft (dark wood, vertical)
        const bmStaffMat = getCachedLambert(0x3e2723);
        const bmStaff = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), bmStaffMat);
        bmStaff.name = 'staff-shaft';
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
        const bmOrbMat = getCachedBasic(0xb388ff);
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
          getCachedBasic(0xb388ff)
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
          const moteMat = getCachedBasic(moteColors[mi]);
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
        const gsPlateMat = getCachedLambert(s.secondary); // tribe steel
        const gsPlateHiMat = getCachedLambert(lightenColor(s.secondary, 0.10)); // tribe lighter steel
        const gsPlateDkMat = getCachedLambert(darkenColor(s.secondary, 0.15)); // tribe dark steel
        const gsGoldMat = getCachedLambert(darkenColor(s.accent, 0.15)); // tribe dark brass
        const gsGoldBright = getCachedLambert(s.accent); // tribe bright trim
        const gsLeatherMat = getCachedLambert(darkenColor(s.secondary, 0.30)); // tribe dark leather
        const gsTeamMat = getCachedLambert(playerColor);
        const gsBladeMat = getCachedLambert(lightenColor(s.trim, 0.10)); // tribe polished blade
        const gsEdgeMat = getCachedLambert(lightenColor(s.trim, 0.30)); // tribe razor edge
        const gsBlackMat = getCachedLambert(0x1a1a1a); // visor slits

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
          getCachedLambert(0xb71c1c) // deep red garnet
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
          const pFlap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), getCachedLambert(0x4e342e));
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
        claymoreGrp.name = 'sword-group';
        claymoreGrp.rotation.x = 0.85; // ~49 degrees forward tilt
        claymoreGrp.rotation.y = Math.PI / 2; // 90° along length axis — edges face left/right
        claymoreGrp.position.set(0.06, 0.10, 0.26);
        gsArmRElbow.add(claymoreGrp);
        // Blade — massive, nearly as tall as the unit
        const clayBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.06), gsBladeMat);
        clayBlade.name = 'sword-blade';
        clayBlade.position.set(0, 0.48, 0.08);
        claymoreGrp.add(clayBlade);
        // Fuller groove (recessed channel down blade center)
        const clayFuller = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.07), getCachedLambert(0x999999));
        clayFuller.position.set(0, 0.55, 0.08);
        claymoreGrp.add(clayFuller);
        // Blade edges (both sides, razor bright)
        for (const ex of [-0.085, 0.085]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.25, 0.07), gsEdgeMat);
          edge.name = 'sword-edge';
          edge.position.set(ex, 0.50, 0.08);
          claymoreGrp.add(edge);
        }
        // Blade tip (tapers slightly — smaller box at top)
        const clayTip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.05), gsBladeMat);
        clayTip.name = 'sword-tip';
        clayTip.position.set(0, 1.18, 0.08);
        claymoreGrp.add(clayTip);
        // Crossguard — wide, ornate quillons
        const clayGuard = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.08, 0.08), gsGoldBright);
        clayGuard.name = 'sword-crossguard';
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
          const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.09), getCachedLambert(0x4e342e));
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
          getCachedLambert(0xb71c1c)
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
        // === AGILE RANGER/SCOUT — Hooded cloak with layered armor, studded details, throwing knives ===

        // --- Shared Materials ---
        const sLeatherMat = getCachedLambert(s.secondary); // tribe leather
        const sCloakMat = getCachedLambert(playerColor); // team color cloak
        const sStudMat = getCachedLambert(s.accent); // tribe brass studs
        const sSkinMat = getCachedLambert(0xffdbac); // skin
        const sBootMat = getCachedLambert(darkenColor(s.secondary, 0.25)); // tribe dark boot
        const sMetalMat = getCachedLambert(s.trim); // tribe tool steel
        const sSilverMat = getCachedLambert(lightenColor(s.trim, 0.15)); // tribe blade silver
        const sRibbonMat = getCachedLambert(lightenColor(s.secondary, 0.15)); // tribe tan wrapping

        // ─── TORSO: LAYERED LIGHT LEATHER ARMOR ───
        // Core body (lean, agile frame)
        const scoutCore = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.38), sLeatherMat);
        scoutCore.position.set(0, 0.3, 0);
        scoutCore.castShadow = true;
        group.add(scoutCore);

        // Leather armor layer detail (offset breastplate)
        const armorPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.06), sMetalMat);
        armorPlate.position.set(0, 0.32, -0.16);
        group.add(armorPlate);

        // Studded reinforcement (left side)
        const studsLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.06), sStudMat);
        studsLeft.position.set(-0.22, 0.3, -0.17);
        group.add(studsLeft);

        // Studded reinforcement (right side)
        const studsRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.06), sStudMat);
        studsRight.position.set(0.22, 0.3, -0.17);
        group.add(studsRight);

        // Bandolier (diagonal throwing knife strap, team color)
        const bandolierStrap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.06), sCloakMat);
        bandolierStrap.position.set(-0.12, 0.32, 0.15);
        bandolierStrap.rotation.z = 0.35;
        group.add(bandolierStrap);

        // Throwing knives on bandolier (3 small bright blades)
        for (let i = 0; i < 3; i++) {
          const knife = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.16), sSilverMat);
          knife.position.set(-0.08 + i * 0.08, 0.52 - i * 0.12, 0.18);
          knife.rotation.z = 0.4;
          group.add(knife);
        }

        // Leather belt (primary attachment point)
        const scoutBelt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.4), sLeatherMat);
        scoutBelt.position.set(0, 0.12, 0);
        group.add(scoutBelt);

        // Belt clasp (team color ornament)
        const beltClasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.06), sCloakMat);
        beltClasp.position.set(0, 0.12, -0.2);
        group.add(beltClasp);

        // Back detail: cloak drape (team color flowing fabric)
        const cloakBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.1), sCloakMat);
        cloakBack.position.set(0, 0.35, 0.2);
        group.add(cloakBack);

        // Cloak embroidered emblem (visible team symbol on back)
        const cloakEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.02), sStudMat);
        cloakEmblem.position.set(0, 0.4, 0.24);
        group.add(cloakEmblem);

        // ─── HEAD & HOODED CLOAK ───
        // Head/face (skin visible under hood)
        const scoutFace = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), sSkinMat);
        scoutFace.position.set(0, 0.78, 0);
        group.add(scoutFace);
        // Eyes — sharp, alert (dark brown with white surround)
        for (const ex of [-0.07, 0.07]) {
          const eyeWhite = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), getCachedLambert(0xf0f0f0));
          eyeWhite.position.set(ex, 0.82, 0.16);
          group.add(eyeWhite);
          const eyePupil = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), getCachedLambert(0x2e1a0e));
          eyePupil.position.set(ex, 0.82, 0.165);
          group.add(eyePupil);
        }
        // Eyebrows — furrowed, serious (angled inward)
        const sBrowL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), getCachedLambert(0x3e2723));
        sBrowL.position.set(-0.07, 0.855, 0.16);
        sBrowL.rotation.z = 0.15;
        group.add(sBrowL);
        const sBrowR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), getCachedLambert(0x3e2723));
        sBrowR.position.set(0.07, 0.855, 0.16);
        sBrowR.rotation.z = -0.15;
        group.add(sBrowR);
        // Nose — small angular ridge
        const sNose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), sSkinMat);
        sNose.position.set(0, 0.78, 0.17);
        group.add(sNose);
        // Mouth — thin determined line
        const sMouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), getCachedLambert(0x8d5524));
        sMouth.position.set(0, 0.73, 0.16);
        group.add(sMouth);
        // Chin — slight forward jut
        const sChin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), sSkinMat);
        sChin.position.set(0, 0.7, 0.14);
        group.add(sChin);

        // Hood base (covers top of head, team color)
        const hoodMain = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.36), sCloakMat);
        hoodMain.position.set(0, 0.92, 0.02);
        group.add(hoodMain);
        // Hood peak (pointed top for silhouette)
        const hoodPeak = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), sCloakMat);
        hoodPeak.position.set(0, 1.02, 0.0);
        group.add(hoodPeak);
        // Hood brow shadow (dark overhang above eyes)
        const hoodBrow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.1), getCachedLambert(0x1a1a1a));
        hoodBrow.position.set(0, 0.88, 0.14);
        group.add(hoodBrow);
        // Hood back drape (hangs behind)
        const hoodDrape = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.08), sCloakMat);
        hoodDrape.position.set(0, 0.78, 0.18);
        group.add(hoodDrape);
        // Hood clasp (metal fastener at front of cloak)
        const hoodClasp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), sStudMat);
        hoodClasp.position.set(0, 0.68, 0.2);
        group.add(hoodClasp);

        // ─── QUIVER (back mounted, with visible arrow shafts for signals) ───
        const quiverBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.1), sLeatherMat);
        quiverBody.position.set(0.18, 0.35, 0.22);
        group.add(quiverBody);

        // Arrow shafts (3 visible, different heights)
        const arrow1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.02), getCachedLambert(0xd4a574));
        arrow1.position.set(0.14, 0.45, 0.22);
        group.add(arrow1);

        const arrow2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), getCachedLambert(0xd4a574));
        arrow2.position.set(0.2, 0.42, 0.24);
        group.add(arrow2);

        const arrow3 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), getCachedLambert(0xd4a574));
        arrow3.position.set(0.22, 0.43, 0.2);
        group.add(arrow3);

        // ─── RIGHT ARM: ELEGANT CURVED SCIMITAR ───
        const scoutArmRight = makeArmGroup('arm-right', 0x5d4037, 0.26, 0.50);
        const scoutArmRightElbow = scoutArmRight.getObjectByName('arm-right-elbow')!;

        // Scimitar blade (curved, silver polish)
        const scimBlade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.58), sSilverMat);
        scimBlade.position.set(0, -0.16, 0.32);
        scimBlade.rotation.y = 0.2;
        scoutArmRightElbow.add(scimBlade);

        // Blade edge highlight (sharp gleam)
        const scimEdge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.01, 0.56), getCachedLambert(0xffffff));
        scimEdge.position.set(0, -0.165, 0.32);
        scimEdge.rotation.y = 0.2;
        scoutArmRightElbow.add(scimEdge);

        // Ornate crossguard (curved brass protection)
        const scimGuard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.06), sStudMat);
        scimGuard.position.set(0, -0.16, 0.04);
        scoutArmRightElbow.add(scimGuard);

        // Guard accent (darker shadow)
        const guardAccent = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.08), getCachedLambert(0x8B6914));
        guardAccent.position.set(0, -0.18, 0.04);
        scoutArmRightElbow.add(guardAccent);

        // Wrapped grip (leather-wrapped handle)
        const scimGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.15), sRibbonMat);
        scimGrip.position.set(0, -0.16, -0.08);
        scoutArmRightElbow.add(scimGrip);

        // Pommel (decorative ball end)
        const scimPommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), sStudMat);
        scimPommel.position.set(0, -0.16, -0.18);
        scoutArmRightElbow.add(scimPommel);

        group.add(scoutArmRight);

        // ─── LEFT ARM: BUCKLER (SMALL ROUND SHIELD) ───
        const scoutArmLeft = makeArmGroup('arm-left', 0x5d4037, -0.26, 0.50);
        const scoutArmLeftElbow = scoutArmLeft.getObjectByName('arm-left-elbow')!;

        // Buckler shield (small circle, team color)
        const buckler = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 6), sCloakMat);
        buckler.rotation.x = 1.57;
        buckler.position.set(-0.08, -0.16, 0.12);
        scoutArmLeftElbow.add(buckler);

        // Shield rim (brass reinforcement)
        const bucklerRim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 6), sStudMat);
        bucklerRim.rotation.x = 1.57;
        bucklerRim.position.set(-0.08, -0.16, 0.16);
        scoutArmLeftElbow.add(bucklerRim);

        // Shield boss (center dome, brass)
        const bucklerBoss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), sStudMat);
        bucklerBoss.position.set(-0.08, -0.16, 0.14);
        scoutArmLeftElbow.add(bucklerBoss);

        group.add(scoutArmLeft);

        // ─── SPYGLASS (tucked on belt side) ───
        const spyglass = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 6), sStudMat);
        spyglass.position.set(-0.18, 0.08, 0.06);
        spyglass.rotation.x = 1.3;
        group.add(spyglass);

        // Spyglass lens (small glass detail)
        const spyglassLens = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), getCachedLambert(0x87ceeb));
        spyglassLens.position.set(-0.18, 0.15, 0.2);
        group.add(spyglassLens);

        // ─── BOOTS WITH SHIN GUARDS ───
        const legLeftGroup = makeLegGroup('leg-left', 0x3e2723, -0.1, 0);
        // Add shin guard (metal protection)
        const shinGuardLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.06), sMetalMat);
        shinGuardLeft.position.set(-0.1, -0.08, 0.07);
        legLeftGroup.add(shinGuardLeft);
        group.add(legLeftGroup);

        const legRightGroup = makeLegGroup('leg-right', 0x3e2723, 0.1, 0);
        const shinGuardRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.06), sMetalMat);
        shinGuardRight.position.set(0.1, -0.08, 0.07);
        legRightGroup.add(shinGuardRight);
        group.add(legRightGroup);

        break;
      }
      case UnitType.MAGE: {
        // ═══ ELABORATE ARCANE MAGE — Flowing robed wizard with mystical staff ═══
        // PASS 1 — SILHOUETTE (flowing robed figure)
        const innerRobe = new THREE.Mesh(
          new THREE.BoxGeometry(0.48, 0.68, 0.42),
          getCachedLambert(darkenColor(s.secondary, 0.35)) // tribe dark inner robe
        );
        innerRobe.position.y = 0.32; innerRobe.castShadow = true;
        group.add(innerRobe);
        const outerRobe = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.68, 0.46),
          getCachedLambert(darkenColor(s.secondary, 0.15)) // tribe outer robe
        );
        outerRobe.position.y = 0.32; outerRobe.castShadow = true;
        group.add(outerRobe);
        // Side panels for depth and flowing effect
        for (const sx of [-0.32, 0.32]) {
          const sidePanel = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.65, 0.48),
            getCachedLambert(darkenColor(s.secondary, 0.25)) // tribe darker sides
          );
          sidePanel.position.set(sx, 0.3, 0);
          group.add(sidePanel);
        }
        // Robe hem — wider at bottom with decorative trim, slight taper
        const robeHem = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.18, 0.56),
          getCachedLambert(darkenColor(s.secondary, 0.25)) // tribe darker hem
        );
        robeHem.position.y = 0.05;
        group.add(robeHem);
        // Decorative trim at hem edge
        const hemTrim = new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 0.03, 0.59),
          getCachedLambert(s.accent) // tribe brass trim
        );
        hemTrim.position.y = 0.15;
        group.add(hemTrim);
        // PASS 2 — LAYERING (armor and cloth detail)
        // Leather chest harness
        const chestHarness = new THREE.Mesh(
          new THREE.BoxGeometry(0.48, 0.5, 0.38),
          getCachedLambert(darkenColor(s.secondary, 0.30)) // tribe dark leather
        );
        chestHarness.position.y = 0.45;
        group.add(chestHarness);
        // Brass buckles on harness
        for (let bi = 0; bi < 3; bi++) {
          const buckle = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.06, 0.02),
            getCachedLambert(s.accent) // tribe buckle
          );
          buckle.position.set(0, 0.65 - bi * 0.12, 0.21);
          group.add(buckle);
        }
        // Ornate belt with gold buckle
        const belt = new THREE.Mesh(
          new THREE.BoxGeometry(0.54, 0.08, 0.48),
          getCachedLambert(darkenColor(s.secondary, 0.30)) // tribe dark belt
        );
        belt.position.y = 0.28;
        group.add(belt);
        const beltBuckle = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.08, 0.02),
          getCachedLambert(s.accent) // tribe gold buckle
        );
        beltBuckle.position.set(0, 0.28, 0.25);
        group.add(beltBuckle);
        // Hanging pouches on belt (component bags)
        for (const px of [-0.15, 0.15]) {
          const pouch = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.12, 0.08),
            getCachedLambert(darkenColor(s.secondary, 0.30)) // tribe pouch
          );
          pouch.position.set(px, 0.18, 0.2);
          group.add(pouch);
          const pouchAccent = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.03, 0.08),
            getCachedLambert(s.accent) // tribe pouch accent
          );
          pouchAccent.position.set(px, 0.25, 0.2);
          group.add(pouchAccent);
        }
        // Decorative sash across chest in team color
        const sash = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.08, 0.47),
          getCachedLambert(playerColor)
        );
        sash.position.y = 0.5;
        group.add(sash);
        // Layered collar/cowl around neck area
        const collar = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.12, 0.38),
          getCachedLambert(darkenColor(s.secondary, 0.25)) // tribe collar
        );
        collar.position.y = 0.7;
        group.add(collar);
        const innerCollar = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.08, 0.33),
          getCachedLambert(darkenColor(s.secondary, 0.15)) // tribe inner collar
        );
        innerCollar.position.y = 0.68;
        group.add(innerCollar);
        // Embroidered cuff trim on robe edges (gold)
        for (const cx of [-0.27, 0.27]) {
          const cuff = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.68, 0.02),
            getCachedLambert(s.accent) // tribe gold cuff
          );
          cuff.position.set(cx, 0.32, 0.24);
          group.add(cuff);
        }
        // PASS 3 — HEAD (mysterious wizard)
        const mageHead = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          getCachedLambert(0xffdbac) // skin tone
        );
        mageHead.position.y = 0.82;
        group.add(mageHead);
        // Eyes (tiny dark boxes)
        for (const ex of [-0.08, 0.08]) {
          const eye = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.02),
            getCachedLambert(0x000000)
          );
          eye.position.set(ex, 0.88, 0.16);
          group.add(eye);
        }
        // Short beard — pointed goatee
        const goatee = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.12, 0.06),
          getCachedLambert(0x5d4037) // beard brown
        );
        goatee.position.set(0, 0.72, 0.18);
        group.add(goatee);
        // ELABORATE WIZARD HAT — tall, dramatic, with bends/tilts
        const hatBrim = new THREE.Mesh(
          new THREE.BoxGeometry(0.54, 0.05, 0.54),
          getCachedLambert(darkenColor(s.secondary, 0.25)) // tribe hat brim
        );
        hatBrim.position.y = 0.98;
        group.add(hatBrim);
        // Wide cone base
        const hatConeLower = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.25, 0.32),
          getCachedLambert(darkenColor(s.secondary, 0.15)) // tribe hat
        );
        hatConeLower.position.y = 1.18;
        group.add(hatConeLower);
        // Tall cone upper section
        const hatConeUpper = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.35, 0.22),
          getCachedLambert(darkenColor(s.secondary, 0.15)) // tribe hat
        );
        hatConeUpper.position.y = 1.48;
        group.add(hatConeUpper);
        // Drooping tip (bends/tilts slightly)
        const hatTip = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.18, 0.14),
          getCachedLambert(0x0D47A1)
        );
        hatTip.position.set(0.08, 1.72, 0.06);
        hatTip.rotation.z = 0.3; // slight tilt
        group.add(hatTip);
        // Gold band around hat base
        const hatBand = new THREE.Mesh(
          new THREE.BoxGeometry(0.54, 0.04, 0.54),
          getCachedLambert(0xFFD700)
        );
        hatBand.position.y = 1.02;
        group.add(hatBand);
        // Small star/rune on front of hat
        const hatRune = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.03),
          getCachedBasic(0xFFD700)
        );
        hatRune.position.set(0, 1.2, 0.17);
        group.add(hatRune);
        // PASS 4 — WEAPON (Arcane Staff)
        // Tall staff with twisted/gnarled appearance
        const staffShaft = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 1.0, 0.06),
          getCachedLambert(0x4a2e1a) // dark wood
        );
        staffShaft.name = 'staff-shaft';
        staffShaft.position.set(0, 0.1, 0);
        staffShaft.castShadow = true;
        // Gnarled sections along shaft (twisted appearance)
        for (let gi = 0; gi < 5; gi++) {
          const gnarl = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.08, 0.09),
            getCachedLambert(0x3e2723) // darker wood
          );
          gnarl.position.y = 0.15 + gi * 0.18;
          staffShaft.add(gnarl);
        }
        // Golden bands/rings at intervals
        for (let bi = 0; bi < 4; bi++) {
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.05, 0.08),
            getCachedLambert(0xc8a832)
          );
          band.position.y = 0.2 + bi * 0.25;
          staffShaft.add(band);
        }
        // Rune engravings (small gold boxes along shaft)
        for (let ri = 1; ri < 5; ri++) {
          const rune = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.03, 0.02),
            getCachedBasic(0xFFD700)
          );
          rune.position.set(0.04, 0.2 + ri * 0.2, 0.04);
          staffShaft.add(rune);
        }
        // Crystal orb at top (glowing blue, transparent)
        const crystal = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x42A5F5, transparent: true, opacity: 0.8 })
        );
        crystal.name = 'staff-crystal';
        crystal.position.set(0, 0.65, 0);
        // 4 golden prongs holding the crystal in a cage
        for (let pi = 0; pi < 4; pi++) {
          const prong = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.18, 0.03),
            getCachedLambert(0xFFD700)
          );
          const pAngle = (pi / 4) * Math.PI * 2;
          prong.position.set(Math.cos(pAngle) * 0.08, 0.55, Math.sin(pAngle) * 0.08);
          staffShaft.add(prong);
        }
        // Secondary crystal below main one
        const secondaryCrystal = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0x42A5F5, transparent: true, opacity: 0.6 })
        );
        secondaryCrystal.position.set(0, 0.35, 0);
        staffShaft.add(secondaryCrystal);
        staffShaft.add(crystal);
        // Right arm with staff
        const mageRightArm = makeArmGroup('arm-right', 0x1565C0, 0.32, 0.52);
        const mageRightArmElbow = mageRightArm.getObjectByName('arm-right-elbow')!;
        // Staff wrapper group — tilted forward 25°
        const staffGroup = new THREE.Group();
        staffGroup.name = 'staff-group';
        staffGroup.rotation.x = 0.436;
        staffGroup.add(staffShaft);
        mageRightArmElbow.add(staffGroup);
        group.add(mageRightArm);
        // PASS 5 — LEFT ARM (spell hand)
        const mageLeftArm = makeArmGroup('arm-left', 0x1565C0, -0.32, 0.52);
        const mageLeftArmElbow = mageLeftArm.getObjectByName('arm-left-elbow')!;
        // Open palm gesture positioning
        const leftArmHand = mageLeftArm.getObjectByName('arm-left-hand')!;
        leftArmHand.rotation.z = 0.3; // palm-up gesture
        group.add(mageLeftArm);
        // Glowing orb floating near left hand
        const spellOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x42A5F5, transparent: true, opacity: 0.75 })
        );
        spellOrb.name = 'orb-spell';
        spellOrb.position.set(-0.35, 0.55, 0.1);
        group.add(spellOrb);
        // Arcane bracelet/cuff on forearm (gold)
        const forearmCuff = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.06, 0.1),
          getCachedLambert(0xFFD700)
        );
        forearmCuff.position.set(-0.32, 0.4, 0);
        group.add(forearmCuff);
        // PASS 6 — BACK DETAIL (cape/cloak)
        const capeLayer1 = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.65, 0.08),
          getCachedLambert(0x0D47A1) // dark blue
        );
        capeLayer1.position.set(0, 0.4, -0.28);
        group.add(capeLayer1);
        const capeLayer2 = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.65, 0.06),
          getCachedLambert(0x1565C0)
        );
        capeLayer2.position.set(0, 0.4, -0.34);
        group.add(capeLayer2);
        const capeLayer3 = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.65, 0.05),
          getCachedLambert(0x0D47A1)
        );
        capeLayer3.position.set(0, 0.4, -0.39);
        group.add(capeLayer3);
        // Small scroll/tome strapped to back (brown)
        const backTome = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.16, 0.04),
          getCachedLambert(0x5d4037) // brown
        );
        backTome.position.set(0, 0.45, -0.27);
        group.add(backTome);
        const tomeAccent = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.14, 0.02),
          getCachedLambert(0xFFD700) // gold clasp
        );
        tomeAccent.position.set(0, 0.45, -0.29);
        group.add(tomeAccent);
        // PASS 7 — LEGS
        group.add(makeLegGroup('leg-left', 0x0D47A1, -0.12, 0));
        group.add(makeLegGroup('leg-right', 0x0D47A1, 0.12, 0));
        break;
      }
      case UnitType.OGRE: {
        // ═══ OGRE — Fearsome brute with tribal decorations ═══
        const ogreSkin = getCachedLambert(0x6d4c41);
        const ogreBone = getCachedLambert(lightenColor(s.trim, 0.15)); // tribe bone
        const ogreArmor = getCachedLambert(darkenColor(s.secondary, 0.25)); // tribe armor
        const ogreTeam = getCachedLambert(playerColor);
        const ogreWood = getCachedLambert(0x5d4037);
        const ogreMetal = getCachedLambert(s.accent); // tribe metal
        const ogreTattoo = getCachedLambert(playerColor);

        // --- Core body with scarred skin texture ---
        const oBody = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.75, 0.55), ogreSkin);
        oBody.position.y = 0.45;
        oBody.name = 'body';
        group.add(oBody);

        // Scarred skin detail (offset color strips for texture)
        for (let si = 0; si < 3; si++) {
          const scar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.56), getCachedLambert(0x5a3f36));
          scar.position.y = 0.55 - si * 0.20;
          group.add(scar);
        }

        // Chest armor plate
        const oChest = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.40, 0.58), ogreArmor);
        oChest.position.y = 0.55;
        group.add(oChest);

        // Team-color war paint stripe
        const oPaint = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.59), ogreTeam);
        oPaint.position.y = 0.60;
        group.add(oPaint);

        // War paint pattern (additional stripes)
        for (let wi = 0; wi < 2; wi++) {
          const warpaint = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.57), ogreTeam);
          warpaint.position.set(-0.20 + wi * 0.40, 0.50, 0);
          group.add(warpaint);
        }

        // Chain mail patches on shoulders
        const chainL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.20, 0.20), ogreMetal);
        chainL.position.set(-0.32, 0.62, 0);
        group.add(chainL);
        const chainR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.20, 0.20), ogreMetal);
        chainR.position.set(0.32, 0.62, 0);
        group.add(chainR);

        // Belt with bone buckle and trophy skulls
        const oBelt = new THREE.Mesh(new THREE.BoxGeometry(0.67, 0.08, 0.57), ogreMetal);
        oBelt.position.y = 0.22;
        group.add(oBelt);
        const oBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.58), ogreBone);
        oBuckle.position.y = 0.22;
        group.add(oBuckle);

        // Trophy skulls on belt
        for (let ti = 0; ti < 3; ti++) {
          const skullBase = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), ogreBone);
          skullBase.position.set(-0.20 + ti * 0.20, 0.12, 0.30);
          group.add(skullBase);
          // Skull jaw
          const skullJaw = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.06), ogreBone);
          skullJaw.position.set(-0.20 + ti * 0.20, 0.06, 0.30);
          group.add(skullJaw);
        }

        // --- Head (large, brutish) ---
        const oHead = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.36), ogreSkin);
        oHead.position.y = 0.98;
        oHead.name = 'head';
        group.add(oHead);

        // ─── HEAVY BROW RIDGE ───
        const browRidge = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.07, 0.12), ogreSkin);
        browRidge.position.set(0, 1.04, 0.15);
        group.add(browRidge);
        // Scarred face detail
        const faceScars = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.34), getCachedLambert(0x5a3f36));
        faceScars.position.set(0, 0.95, 0);
        group.add(faceScars);

        // ─── EYE SOCKETS (deep recesses) ───
        const socketMat = getCachedLambert(0x3e2215);
        const oSocketL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.04), socketMat);
        oSocketL.position.set(-0.09, 0.98, 0.17);
        group.add(oSocketL);
        const oSocketR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.04), socketMat);
        oSocketR.position.set(0.09, 0.98, 0.17);
        group.add(oSocketR);

        // ─── EYES (orange glow with dark pupils) ───
        const oEyeMat = getCachedLambert(0xff6f00);
        const oEyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), oEyeMat);
        oEyeL.position.set(-0.09, 0.98, 0.19);
        group.add(oEyeL);
        const oEyeR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), oEyeMat);
        oEyeR.position.set(0.09, 0.98, 0.19);
        group.add(oEyeR);
        // Pupils (dark slits)
        const pupilMat = getCachedLambert(0x1a0800);
        const oPupilL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), pupilMat);
        oPupilL.position.set(-0.09, 0.98, 0.215);
        group.add(oPupilL);
        const oPupilR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), pupilMat);
        oPupilR.position.set(0.09, 0.98, 0.215);
        group.add(oPupilR);
        // Angry eyebrows (thick, angled sharply inward)
        const browMat = getCachedLambert(0x2e1a0e);
        const oBrowL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.04), browMat);
        oBrowL.position.set(-0.09, 1.03, 0.19);
        oBrowL.rotation.z = -0.25;
        group.add(oBrowL);
        const oBrowR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.04), browMat);
        oBrowR.position.set(0.09, 1.03, 0.19);
        oBrowR.rotation.z = 0.25;
        group.add(oBrowR);

        // ─── BROAD SNOUT / NOSE ───
        const oNose = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.08), ogreSkin);
        oNose.position.set(0, 0.92, 0.20);
        group.add(oNose);
        // Nostrils (dark recesses)
        const nostrilMat = getCachedLambert(0x3e2215);
        const nostrilL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), nostrilMat);
        nostrilL.position.set(-0.03, 0.90, 0.24);
        group.add(nostrilL);
        const nostrilR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), nostrilMat);
        nostrilR.position.set(0.03, 0.90, 0.24);
        group.add(nostrilR);

        // ─── WIDE JAW / UNDERBITE ───
        const oJaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.32), ogreSkin);
        oJaw.position.set(0, 0.81, 0.06);
        group.add(oJaw);
        // Lower lip / gum line (darker flesh showing teeth)
        const gumMat = getCachedLambert(0x8b3a3a);
        const gumLine = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.04, 0.06), gumMat);
        gumLine.position.set(0, 0.84, 0.20);
        group.add(gumLine);

        // ─── TEETH (snarling row of jagged teeth) ───
        const toothMat = getCachedLambert(0xe8dcc8);
        // Upper teeth (hanging down from upper jaw)
        for (let ti = -2; ti <= 2; ti++) {
          const uTooth = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.03), toothMat);
          uTooth.position.set(ti * 0.055, 0.86, 0.21);
          group.add(uTooth);
        }
        // Lower teeth (jutting up from underbite jaw, bigger and nastier)
        for (let ti = -2; ti <= 2; ti++) {
          const height = (ti === 0) ? 0.05 : (Math.abs(ti) === 1 ? 0.045 : 0.035);
          const lTooth = new THREE.Mesh(new THREE.BoxGeometry(0.035, height, 0.03), toothMat);
          lTooth.position.set(ti * 0.06, 0.83 + height / 2, 0.22);
          group.add(lTooth);
        }
        // Extra jagged side teeth (visible at jaw corners)
        const sideToothL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), toothMat);
        sideToothL.position.set(-0.15, 0.85, 0.17);
        sideToothL.rotation.z = 0.3;
        group.add(sideToothL);
        const sideToothR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), toothMat);
        sideToothR.position.set(0.15, 0.85, 0.17);
        sideToothR.rotation.z = -0.3;
        group.add(sideToothR);

        // ─── MASSIVE TUSKS (bone, curving upward from lower jaw) ───
        const oTuskL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), ogreBone);
        oTuskL.position.set(-0.13, 0.86, 0.18);
        oTuskL.rotation.z = 0.25;
        group.add(oTuskL);
        // Tusk tips (pointed)
        const tuskTipL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), ogreBone);
        tuskTipL.position.set(-0.15, 0.94, 0.18);
        tuskTipL.rotation.z = 0.25;
        group.add(tuskTipL);
        const oTuskR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), ogreBone);
        oTuskR.position.set(0.13, 0.86, 0.18);
        oTuskR.rotation.z = -0.25;
        group.add(oTuskR);
        const tuskTipR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), ogreBone);
        tuskTipR.position.set(0.15, 0.94, 0.18);
        tuskTipR.rotation.z = -0.25;
        group.add(tuskTipR);

        // ─── CHIN / JAW RIDGE ───
        const chinRidge = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.08), ogreSkin);
        chinRidge.position.set(0, 0.76, 0.12);
        group.add(chinRidge);

        // Pierced ear ring (small torus approximated)
        const earRing = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), ogreBone);
        earRing.position.set(-0.20, 0.98, 0);
        group.add(earRing);
        // Second ear ring on right
        const earRingR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), ogreMetal);
        earRingR.position.set(0.20, 0.96, 0);
        group.add(earRingR);

        // Nose ring (through septum)
        const noseRing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), ogreMetal);
        noseRing.position.set(0, 0.87, 0.24);
        group.add(noseRing);

        // Bone headpiece / crown
        const oHeadBone = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.06, 0.38), ogreBone);
        oHeadBone.position.y = 1.14;
        group.add(oHeadBone);
        // Bone spikes on crown
        for (let si = -1; si <= 1; si++) {
          const spike = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.04), ogreBone);
          spike.position.set(si * 0.14, 1.22, 0);
          group.add(spike);
        }

        // Hair with bones and feathers woven in
        const hairBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.40), getCachedLambert(0x3e2723));
        hairBase.position.y = 1.18;
        group.add(hairBase);
        // Bone ornaments in hair
        for (let bi = 0; bi < 2; bi++) {
          const boneHair = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), ogreBone);
          boneHair.position.set(-0.12 + bi * 0.24, 1.25, 0);
          group.add(boneHair);
        }

        // --- Massive pauldrons (bone + team color) ---
        const oShoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.22), ogreBone);
        oShoulderL.position.set(-0.42, 0.72, 0);
        group.add(oShoulderL);
        const oShoulderLTeam = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.06, 0.24), ogreTeam);
        oShoulderLTeam.position.set(-0.42, 0.80, 0);
        group.add(oShoulderLTeam);

        const oShoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.22), ogreBone);
        oShoulderR.position.set(0.42, 0.72, 0);
        group.add(oShoulderR);
        const oShoulderRTeam = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.06, 0.24), ogreTeam);
        oShoulderRTeam.position.set(0.42, 0.80, 0);
        group.add(oShoulderRTeam);

        // --- Right arm (club arm) ---
        const oArmR = new THREE.Group();
        oArmR.name = 'arm-right';
        oArmR.position.set(0.38, 0.62, 0);
        const oUpperR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), ogreSkin);
        oUpperR.position.y = -0.06;
        oUpperR.name = 'arm-right-upper';
        oArmR.add(oUpperR);

        // Elbow
        const oElbowR = new THREE.Group();
        oElbowR.name = 'arm-right-elbow';
        oElbowR.position.set(0.0000, -0.1800, 0.0000);
        oElbowR.rotation.set(-1.0516, -0.4516, 0.2884);
        const oForearmR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.20, 0.14), ogreSkin);
        oForearmR.position.y = -0.10;
        oForearmR.name = 'arm-right-forearm';
        oElbowR.add(oForearmR);

        // Finger bones as necklace detail on arm
        for (let fi = 0; fi < 3; fi++) {
          const fingerBone = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), ogreBone);
          fingerBone.position.set(-0.06 + fi * 0.06, -0.08, 0.10);
          oElbowR.add(fingerBone);
        }

        const oHandR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.12), ogreSkin);
        oHandR.position.y = -0.22;
        oElbowR.add(oHandR);

        // === THE CLUB — massive crude weapon with embedded stones ===
        const clubGrp = new THREE.Group();
        clubGrp.name = 'club-group';
        clubGrp.position.set(0.0000, -0.1800, 0.0000);
        clubGrp.rotation.set(-1.0516, -0.4516, 0.2884);
        
        // Shaft (thick log with wrapped leather grip)
        const clubShaft = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.60, 0.10), ogreWood);
        clubShaft.name = 'club-shaft';
        clubShaft.position.y = -0.30;
        clubGrp.add(clubShaft);

        // Leather grip wrapping on shaft
        const gripWrap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.12), ogreArmor);
        gripWrap.position.y = -0.10;
        clubGrp.add(gripWrap);

        // Club head (massive block of wood)
        const clubHead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.20), ogreWood);
        clubHead.name = 'club-head';
        clubHead.position.y = -0.62;
        clubGrp.add(clubHead);

        // Iron bands around club head
        const clubBand1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.22), ogreMetal);
        clubBand1.position.y = -0.54;
        clubGrp.add(clubBand1);
        const clubBand2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.22), ogreMetal);
        clubBand2.position.y = -0.70;
        clubGrp.add(clubBand2);

        // Embedded stones in club head
        for (let si = 0; si < 3; si++) {
          const stone = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), getCachedLambert(0x757575));
          stone.position.set(-0.08 + si * 0.08, -0.62, 0);
          clubGrp.add(stone);
        }

        // Bone spikes on club head
        const clubSpike1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.08), ogreBone);
        clubSpike1.name = 'club-spike';
        clubSpike1.position.set(0.12, -0.62, 0);
        clubGrp.add(clubSpike1);
        const clubSpike2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.08), ogreBone);
        clubSpike2.name = 'club-spike';
        clubSpike2.position.set(-0.12, -0.62, 0);
        clubGrp.add(clubSpike2);
        const clubSpike3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), ogreBone);
        clubSpike3.name = 'club-spike';
        clubSpike3.position.set(0, -0.62, 0.12);
        clubGrp.add(clubSpike3);

        oElbowR.add(clubGrp);
        oArmR.add(oElbowR);
        group.add(oArmR);

        // --- Left arm (free arm) ---
        const oArmL = new THREE.Group();
        oArmL.name = 'arm-left';
        oArmL.position.set(-0.38, 0.62, 0);
        const oUpperL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), ogreSkin);
        oUpperL.position.y = -0.06;
        oUpperL.name = 'arm-left-upper';
        oArmL.add(oUpperL);

        // Finger bones detail on left arm
        for (let fi = 0; fi < 3; fi++) {
          const fingerBone = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), ogreBone);
          fingerBone.position.set(-0.06 + fi * 0.06, -0.06, 0.10);
          oArmL.add(fingerBone);
        }

        const oElbowL = new THREE.Group();
        oElbowL.name = 'arm-left-elbow';
        oElbowL.position.y = -0.18;
        const oForearmL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.20, 0.14), ogreSkin);
        oForearmL.position.y = -0.10;
        oForearmL.name = 'arm-left-forearm';
        oElbowL.add(oForearmL);
        const oHandL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.12), ogreSkin);
        oHandL.position.y = -0.22;
        oElbowL.add(oHandL);
        oArmL.add(oElbowL);
        group.add(oArmL);

        // --- Legs (thick, powerful) with toe details ---
        const oLegL = new THREE.Group();
        oLegL.name = 'leg-left';
        oLegL.position.set(-0.16, 0.08, 0);
        const oThighL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), ogreSkin);
        oThighL.position.y = -0.04;
        oLegL.add(oThighL);
        const oShinL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.16), ogreArmor);
        oShinL.position.y = -0.22;
        oLegL.add(oShinL);
        const oFootL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.22), ogreSkin);
        oFootL.position.set(0, -0.36, 0.03);
        oLegL.add(oFootL);

        // Toe details on foot
        for (let to = 0; to < 3; to++) {
          const toe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), ogreSkin);
          toe.position.set(-0.06 + to * 0.06, -0.40, 0.12);
          oLegL.add(toe);
        }

        group.add(oLegL);

        const oLegR = new THREE.Group();
        oLegR.name = 'leg-right';
        oLegR.position.set(0.16, 0.08, 0);
        const oThighR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), ogreSkin);
        oThighR.position.y = -0.04;
        oLegR.add(oThighR);
        const oShinR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.16), ogreArmor);
        oShinR.position.y = -0.22;
        oLegR.add(oShinR);
        const oFootR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.22), ogreSkin);
        oFootR.position.set(0, -0.36, 0.03);
        oLegR.add(oFootR);

        // Toe details on right foot
        for (let to = 0; to < 3; to++) {
          const toe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), ogreSkin);
          toe.position.set(-0.06 + to * 0.06, -0.40, 0.12);
          oLegR.add(toe);
        }

        group.add(oLegR);

        // Back detail: large tribal tattoo pattern + fur pelt + bone trophies
        // Tribal tattoo (team color pattern on back)
        const tattooBase = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.50, 0.04), ogreTattoo);
        tattooBase.position.set(0, 0.40, -0.30);
        group.add(tattooBase);

        // Tattoo pattern details (stripes)
        for (let ti = 0; ti < 3; ti++) {
          const tattooLine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.05), ogreTattoo);
          tattooLine.position.set(-0.10 + ti * 0.10, 0.45, -0.295);
          group.add(tattooLine);
        }

        // Fur pelt draped over one shoulder
        const furPelt = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.25, 0.08), getCachedLambert(0x3e2723));
        furPelt.position.set(-0.28, 0.68, -0.25);
        furPelt.rotation.z = 0.3;
        group.add(furPelt);

        // Bone spine ridge on back
        for (let bi = 0; bi < 3; bi++) {
          const backBone = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), ogreBone);
          backBone.position.set(0, 0.72 - bi * 0.14, -0.30);
          group.add(backBone);
        }

        // Bone trophies hanging from belt loops
        for (let thi = 0; thi < 2; thi++) {
          const trophy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), ogreBone);
          trophy.position.set(-0.20 + thi * 0.40, 0.10, -0.28);
          group.add(trophy);
        }

        // Team-color loincloth / tabard
        const oTabard = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.18, 0.04), ogreTeam);
        oTabard.position.set(0, 0.14, 0.28);
        group.add(oTabard);
        const oTabardBack = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.18, 0.04), ogreTeam);
        oTabardBack.position.set(0, 0.14, -0.28);
        group.add(oTabardBack);

        // Scale the whole group up — Ogre is 1.4x normal unit size
        group.scale.set(1.4, 1.4, 1.4);
        break;
      }

      // ═══════════════════════════════════════════════════════════════
      // CHAMPION — Tier 3 base reward. Over-the-top white/gold plate
      // armor, feathered crew helm, giant war hammer. Comically
      // exaggerated muscular proportions (wide shoulders, thin waist).
      // ═══════════════════════════════════════════════════════════════
      case UnitType.CHAMPION: {
        // ─── PASS 1: BODY — Exaggerated muscular torso ───
        // Wide chest plate — white ornate armor
        const cChestGeo = new THREE.BoxGeometry(0.72, 0.52, 0.44);
        const cChestMat = getCachedLambert(lightenColor(s.secondary, 0.30)); // tribe ornate plate
        const cChest = new THREE.Mesh(cChestGeo, cChestMat);
        cChest.position.set(0, 0.42, 0);
        cChest.castShadow = true;
        group.add(cChest);

        // Gold trim — horizontal line across chest
        const cTrimGeo = new THREE.BoxGeometry(0.74, 0.04, 0.46);
        const cTrimMat = getCachedLambert(s.accent); // tribe gold trim
        const cTrim = new THREE.Mesh(cTrimGeo, cTrimMat);
        cTrim.position.set(0, 0.52, 0);
        group.add(cTrim);

        // Diamond-shaped chest emblem (gold, rotated 45°)
        const cEmblemGeo = new THREE.BoxGeometry(0.12, 0.12, 0.04);
        const cEmblem = new THREE.Mesh(cEmblemGeo, cTrimMat);
        cEmblem.position.set(0, 0.44, 0.23);
        cEmblem.rotation.z = Math.PI / 4;
        group.add(cEmblem);

        // Thin waist — dark under-armor showing through
        const cWaistGeo = new THREE.BoxGeometry(0.40, 0.14, 0.32);
        const cWaistMat = getCachedLambert(darkenColor(s.secondary, 0.30)); // tribe under-armor
        const cWaist = new THREE.Mesh(cWaistGeo, cWaistMat);
        cWaist.position.set(0, 0.14, 0);
        group.add(cWaist);

        // Gold belt buckle
        const cBuckleGeo = new THREE.BoxGeometry(0.14, 0.06, 0.05);
        const cBuckle = new THREE.Mesh(cBuckleGeo, cTrimMat);
        cBuckle.position.set(0, 0.20, 0.17);
        group.add(cBuckle);

        // Team-color shoulder marks
        const cMarkMat = getCachedLambert(playerColor);
        for (const sx of [-0.38, 0.38]) {
          const mark = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.18), cMarkMat);
          mark.position.set(sx, 0.66, 0);
          group.add(mark);
        }

        // ─── PASS 2: MASSIVE PAULDRONS ───
        // Comically oversized shoulder plates
        const cPauldronMat = getCachedLambert(lightenColor(s.secondary, 0.25)); // tribe pauldron
        for (const sx of [-1, 1]) {
          // Main pauldron dome
          const pGeo = new THREE.BoxGeometry(0.28, 0.18, 0.30);
          const p = new THREE.Mesh(pGeo, cPauldronMat);
          p.position.set(sx * 0.44, 0.68, 0);
          p.rotation.z = sx * -0.15; // angled outward
          group.add(p);
          // Gold rim on pauldron
          const rimGeo = new THREE.BoxGeometry(0.30, 0.03, 0.32);
          const rim = new THREE.Mesh(rimGeo, cTrimMat);
          rim.position.set(sx * 0.44, 0.60, 0);
          group.add(rim);
          // Spike on top of each pauldron
          const spikeGeo = new THREE.BoxGeometry(0.05, 0.10, 0.05);
          const spike = new THREE.Mesh(spikeGeo, cTrimMat);
          spike.position.set(sx * 0.44, 0.79, 0);
          group.add(spike);
        }

        // ─── PASS 3: HEAD — Feathered crew helm ───
        // Face (skin)
        const cFaceGeo = new THREE.BoxGeometry(0.30, 0.28, 0.30);
        const cFaceMat = getCachedLambert(0xffdbac);
        const cFace = new THREE.Mesh(cFaceGeo, cFaceMat);
        cFace.position.y = 0.84;
        cFace.name = 'head';
        group.add(cFace);

        // Helm shell — white with gold brim
        const cHelmGeo = new THREE.BoxGeometry(0.34, 0.20, 0.34);
        const cHelm = new THREE.Mesh(cHelmGeo, cPauldronMat);
        cHelm.position.set(0, 0.94, 0);
        cHelm.name = 'helm';
        group.add(cHelm);

        // Gold brim all the way around
        const cBrimGeo = new THREE.BoxGeometry(0.38, 0.04, 0.38);
        const cBrim = new THREE.Mesh(cBrimGeo, cTrimMat);
        cBrim.position.set(0, 0.85, 0);
        group.add(cBrim);

        // Dark visor slit
        const cVisorGeo = new THREE.BoxGeometry(0.22, 0.04, 0.04);
        const cVisorMat = getCachedLambert(0x1a1a1a);
        const cVisor = new THREE.Mesh(cVisorGeo, cVisorMat);
        cVisor.position.set(0, 0.86, 0.16);
        group.add(cVisor);

        // Team-color plume — tall feather crest on top
        const cPlumeGeo = new THREE.BoxGeometry(0.08, 0.22, 0.20);
        const cPlumeMat = getCachedLambert(playerColor);
        const cPlume = new THREE.Mesh(cPlumeGeo, cPlumeMat);
        cPlume.position.set(0, 1.10, -0.04);
        cPlume.rotation.x = 0.15; // slight backward tilt
        cPlume.name = 'plume';
        group.add(cPlume);

        // ─── PASS 4: ARMS + WAR HAMMER ───
        // Arms at wider offset for exaggerated proportions
        const cArmL = makeArmGroup('arm-left', 0xe0e0e0, -0.42, 0.55);
        const cArmR = makeArmGroup('arm-right', 0xe0e0e0, 0.42, 0.55);
        group.add(cArmL);
        group.add(cArmR);

        // Giant war hammer on right arm
        const cElbowR = cArmR.getObjectByName('arm-right-elbow')!;
        const hammerGrp = new THREE.Group();
        hammerGrp.name = 'weapon-group';

        // Shaft — dark wood, long handle
        const shaftGeo = new THREE.BoxGeometry(0.06, 0.70, 0.06);
        const shaftMat = getCachedLambert(0x4e342e);
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.position.set(0, -0.40, 0);
        hammerGrp.add(shaft);

        // Hammer head — massive steel block
        const headBlockGeo = new THREE.BoxGeometry(0.22, 0.16, 0.18);
        const headBlockMat = getCachedLambert(0x9e9e9e);
        const headBlock = new THREE.Mesh(headBlockGeo, headBlockMat);
        headBlock.position.set(0, -0.76, 0);
        hammerGrp.add(headBlock);

        // Gold inlay on hammer head
        const inlayGeo = new THREE.BoxGeometry(0.14, 0.04, 0.20);
        const inlay = new THREE.Mesh(inlayGeo, cTrimMat);
        inlay.position.set(0, -0.76, 0);
        hammerGrp.add(inlay);

        // Spike on back of hammer
        const hamSpikeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.14);
        const hamSpike = new THREE.Mesh(hamSpikeGeo, getCachedLambert(0x757575));
        hamSpike.position.set(0, -0.76, -0.14);
        hammerGrp.add(hamSpike);

        // Grip wrap near hand
        const gripGeo = new THREE.BoxGeometry(0.08, 0.10, 0.08);
        const gripMat = getCachedLambert(0x5d4037);
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.12, 0);
        hammerGrp.add(grip);

        hammerGrp.rotation.x = 0.3; // slight forward tilt at rest
        cElbowR.add(hammerGrp);

        // Left arm — small buckler/gauntlet shield
        const cElbowL = cArmL.getObjectByName('arm-left-elbow')!;
        const gauntletGeo = new THREE.BoxGeometry(0.16, 0.14, 0.10);
        const gauntlet = new THREE.Mesh(gauntletGeo, cPauldronMat);
        gauntlet.position.set(0, -0.10, 0.06);
        cElbowL.add(gauntlet);
        // Gold trim on gauntlet
        const gTrimGeo = new THREE.BoxGeometry(0.17, 0.03, 0.11);
        const gTrim = new THREE.Mesh(gTrimGeo, cTrimMat);
        gTrim.position.set(0, -0.05, 0.06);
        cElbowL.add(gTrim);

        // ─── PASS 5: LEGS — Heavy plate greaves ───
        const cLegL = makeLegGroup('leg-left', 0xe0e0e0, -0.16, 0);
        const cLegR = makeLegGroup('leg-right', 0xe0e0e0, 0.16, 0);
        group.add(cLegL);
        group.add(cLegR);

        // Gold knee guards
        for (const [legName, lx] of [['leg-left', -0.16], ['leg-right', 0.16]] as const) {
          const kneeGeo = new THREE.BoxGeometry(0.14, 0.06, 0.10);
          const knee = new THREE.Mesh(kneeGeo, cTrimMat);
          knee.position.set(lx, 0.02, 0.08);
          group.add(knee);
        }

        // Scale up slightly — Champion is imposing (1.25x)
        group.scale.set(1.25, 1.25, 1.25);
        break;
      }

      default: {
        // Generic unit: simple body + head + limbs + team color shoulder marks
        const unitColor = UNIT_COLORS[type] || 0xffffff;
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
        const bodyMat = getCachedLambert(unitColor);
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        body.castShadow = true;
        group.add(body);

        for (const sx of [-0.27, 0.27]) {
          const markGeo = new THREE.BoxGeometry(0.12, 0.08, 0.2);
          const markMat = getCachedLambert(playerColor);
          const mark = new THREE.Mesh(markGeo, markMat);
          mark.position.set(sx, 0.58, 0);
          group.add(mark);
        }

        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const headMat = getCachedLambert(0xffdbac);
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

    // ═══ POST-PROCESS: Merge static meshes to reduce draw calls ═══
    mergeStaticMeshes(group);
  }
}
