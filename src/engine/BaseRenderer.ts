// ============================================
// CUBITOPIA - Base Renderer
// Renders home bases as voxel castle structures
// Three distinct visual tiers: Camp → Fort → Castle
// ============================================

import * as THREE from 'three';
import { Base, BaseTier, HexCoord } from '../types';

const PLAYER_BASE_COLORS = [
  { wall: 0xf0ece0, tower: 0xe8e0d0, flag: 0x3498db, accent: 0xd4cfc0, ring: 0x3498db }, // Off-white + Blue flag
  { wall: 0xf0ece0, tower: 0xe8e0d0, flag: 0xe74c3c, accent: 0xd4cfc0, ring: 0xe74c3c }, // Off-white + Red flag
  { wall: 0x8a8a8a, tower: 0x6a6a6a, flag: 0xd4af37, accent: 0x555555, ring: 0xd4af37 }, // Dark stone + Gold flag (neutral)
];

interface BaseMeshGroup {
  group: THREE.Group;
  baseId: string;
  healthBar: THREE.Mesh;
  healthBarBg: THREE.Mesh;
  flagMesh: THREE.Mesh;
  currentTier: BaseTier;
}

// ====== Shared helpers ======
function bm(geo: THREE.BufferGeometry, matl: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, matl); m.position.set(x, y, z); return m;
}
function bmr(geo: THREE.BufferGeometry, matl: THREE.Material, x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, matl); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}

const _matCache: Map<number, THREE.MeshLambertMaterial> = new Map();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = _matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _matCache.set(color, m); }
  return m;
}
function glow(color: number, intensity = 0.6): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity });
}

export class BaseRenderer {
  private scene: THREE.Scene;
  private baseMeshes: Map<string, BaseMeshGroup> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  hexToWorld(coord: HexCoord, elevation: number): THREE.Vector3 {
    const x = coord.q * 1.5;
    const z = coord.r * 1.5 + (coord.q % 2 === 1 ? 0.75 : 0);
    return new THREE.Vector3(x, elevation, z);
  }

  addBase(base: Base, elevation: number): void {
    this.removeBase(base.id);

    const group = new THREE.Group();
    const pos = this.hexToWorld(base.position, elevation);
    group.position.copy(pos);
    group.rotation.y = Math.PI; // Face battlefield

    const colors = PLAYER_BASE_COLORS[base.owner % PLAYER_BASE_COLORS.length];
    const tier = base.tier ?? BaseTier.CAMP;

    // Build the castle geometry based on tier
    let topY: number;
    if (tier === BaseTier.CASTLE) {
      topY = this.buildCastleTier(group, colors, base.owner);
    } else if (tier === BaseTier.FORT) {
      topY = this.buildFortTier(group, colors, base.owner);
    } else {
      topY = this.buildCampTier(group, colors, base.owner);
    }

    // === Health bar (floating above base) ===
    const barWidth = 2.0;
    const barHeight = 0.15;
    const hpBgGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide, depthTest: false });
    const hpBg = new THREE.Mesh(hpBgGeo, hpBgMat);
    hpBg.position.set(0, topY + 1.0, 0); hpBg.renderOrder = 999; group.add(hpBg);

    const hpGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const hpColor = base.owner === 0 ? 0x3498db : 0xe74c3c;
    const hpMat = new THREE.MeshBasicMaterial({ color: hpColor, side: THREE.DoubleSide, depthTest: false });
    const hpBar = new THREE.Mesh(hpGeo, hpMat);
    hpBar.position.set(0, topY + 1.0, 0); hpBar.renderOrder = 1000; group.add(hpBar);

    // === Glow ring around base ===
    const ringGeo = new THREE.RingGeometry(1.3, 1.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colors.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.4,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; group.add(ring);

    this.scene.add(group);
    // Find the main flag (first PlaneGeometry child in group for billboard)
    let flagMesh: THREE.Mesh = hpBar; // fallback
    group.traverse(c => { if (!flagMesh && c instanceof THREE.Mesh && c.name === 'main-flag') flagMesh = c; });

    this.baseMeshes.set(base.id, {
      group,
      baseId: base.id,
      healthBar: hpBar,
      healthBarBg: hpBg,
      flagMesh,
      currentTier: tier,
    });
  }

  // ====================================================================
  //  TIER 0: CAMP — Simple palisade encampment with tent and campfire
  // ====================================================================
  private buildCampTier(group: THREE.Group, colors: typeof PLAYER_BASE_COLORS[0], owner: number): number {
    const flagM = new THREE.MeshLambertMaterial({ color: colors.flag, side: THREE.DoubleSide });
    const wallM = mat(colors.wall);
    const wood = mat(0x7a5a3a); const darkWood = mat(0x5a3a1a);
    const canvas = mat(0xe0d8c0); const rope = mat(0xc9a96e);

    // --- SILHOUETTE: ground platform + palisade ring ---
    group.add(bm(new THREE.BoxGeometry(2.2, 0.12, 2.2), mat(0x6a7a5a), 0, 0.06, 0)); // dirt mound
    group.add(bm(new THREE.BoxGeometry(2.4, 0.06, 2.4), mat(0x5a6a4a), 0, 0.01, 0)); // outer dirt

    // Palisade fence — ring of pointed log stakes
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      // Gap for entrance (front)
      if (i === 4 || i === 12) continue;
      const r = 1.0;
      const stake = bm(new THREE.BoxGeometry(0.1, 0.65 + Math.random() * 0.1, 0.06), darkWood,
        Math.cos(angle) * r, 0.42, Math.sin(angle) * r);
      stake.rotation.y = angle;
      group.add(stake);
      // Pointed top
      const tip = bm(new THREE.ConeGeometry(0.05, 0.12, 4), wood,
        Math.cos(angle) * r, 0.78, Math.sin(angle) * r);
      tip.rotation.y = angle;
      group.add(tip);
    }
    // Horizontal binding beams
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 12) continue;
      const a1 = (i / 16) * Math.PI * 2;
      const a2 = ((i + 1) / 16) * Math.PI * 2;
      if (i + 1 === 4 || i + 1 === 12) continue;
      const mx = (Math.cos(a1) + Math.cos(a2)) * 0.5;
      const mz = (Math.sin(a1) + Math.sin(a2)) * 0.5;
      const len = 0.4;
      const beam = bm(new THREE.BoxGeometry(len, 0.03, 0.03), rope,
        mx, 0.55, mz);
      beam.rotation.y = (a1 + a2) / 2;
      group.add(beam);
    }

    // --- LAYERING: Commander's tent (center) ---
    // Tent poles
    group.add(bm(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), wood, 0, 0.7, 0)); // center pole
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), wood, 0.35, 0.4, 0.25));
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), wood, -0.35, 0.4, 0.25));
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), wood, 0.35, 0.4, -0.25));
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), wood, -0.35, 0.4, -0.25));
    // Tent canvas — 4 sloped panels forming a pyramid
    for (const [rx, rz, px, pz] of [[0.55, 0, 0.18, 0], [-0.55, 0, -0.18, 0], [0, 0.55, 0, 0.18], [0, -0.55, 0, -0.18]] as [number, number, number, number][]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.75), canvas);
      panel.position.set(px, 0.95, pz);
      panel.rotation.set(rx ? rx * 0.6 : 0, 0, rz ? rz * 0.6 : 0);
      group.add(panel);
    }
    // Team color tent peak banner
    const peakBanner = bm(new THREE.BoxGeometry(0.12, 0.2, 0.04), flagM, 0, 1.4, 0);
    group.add(peakBanner);

    // --- ORNAMENTATION ---
    // Campfire (front of tent)
    group.add(bm(new THREE.CylinderGeometry(0.12, 0.15, 0.06, 8), mat(0x4a4a4a), 0, 0.15, 0.55)); // stone ring
    // Fire logs
    group.add(bmr(new THREE.BoxGeometry(0.04, 0.2, 0.04), darkWood, 0.04, 0.2, 0.55, 0, 0, 0.3));
    group.add(bmr(new THREE.BoxGeometry(0.04, 0.2, 0.04), darkWood, -0.04, 0.2, 0.55, 0, 0.5, -0.25));
    // Flame glow
    group.add(bm(new THREE.SphereGeometry(0.06, 6, 4), glow(0xff6600, 0.8), 0, 0.28, 0.55));
    group.add(bm(new THREE.SphereGeometry(0.04, 5, 3), glow(0xffaa00, 0.6), 0.02, 0.32, 0.54));

    // Supply crates
    group.add(bm(new THREE.BoxGeometry(0.2, 0.15, 0.18), mat(0x6a4a2a), -0.55, 0.2, -0.4));
    group.add(bm(new THREE.BoxGeometry(0.18, 0.13, 0.16), mat(0x7a5a3a), -0.5, 0.2, -0.2));
    group.add(bm(new THREE.BoxGeometry(0.16, 0.12, 0.14), mat(0x6a4a2a), -0.6, 0.32, -0.35));

    // Weapon rack — 2 spears leaning
    group.add(bmr(new THREE.BoxGeometry(0.03, 0.7, 0.03), mat(0x6a5a4a), 0.5, 0.45, -0.5, 0, 0, 0.12));
    group.add(bmr(new THREE.BoxGeometry(0.03, 0.7, 0.03), mat(0x6a5a4a), 0.58, 0.45, -0.5, 0, 0.2, 0.1));
    // Spear tips
    group.add(bmr(new THREE.ConeGeometry(0.025, 0.08, 4), mat(0x888888), 0.52, 0.82, -0.5, 0, 0, 0.12));
    group.add(bmr(new THREE.ConeGeometry(0.025, 0.08, 4), mat(0x888888), 0.61, 0.82, -0.5, 0, 0.2, 0.1));

    // Shield propped against crate
    group.add(bmr(new THREE.BoxGeometry(0.2, 0.25, 0.04), flagM, -0.65, 0.3, -0.15, 0, 0.3, 0.1));

    // --- BACK DETAIL ---
    // Log bench
    const benchLog = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), wood);
    benchLog.rotation.z = Math.PI / 2; benchLog.position.set(0, 0.2, -0.6); group.add(benchLog);
    // Stump seats
    group.add(bm(new THREE.CylinderGeometry(0.08, 0.1, 0.15, 6), wood, 0.4, 0.18, -0.55));

    // --- Main flag ---
    group.add(bm(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), mat(0x8B4513), 0, 1.8, 0));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.35), flagM);
    flag.position.set(0.35, 2.1, 0); flag.name = 'main-flag'; group.add(flag);

    return 2.3; // topY for health bar placement
  }

  // ====================================================================
  //  TIER 1: FORT — Walled stone fort with watchtowers and inner keep
  // ====================================================================
  private buildFortTier(group: THREE.Group, colors: typeof PLAYER_BASE_COLORS[0], owner: number): number {
    const flagM = new THREE.MeshLambertMaterial({ color: colors.flag, side: THREE.DoubleSide });
    const wallM = mat(colors.wall); const towerM = mat(colors.tower); const accentM = mat(colors.accent);
    const darkStone = mat(0x7a7a6a); const goldTrim = mat(0xd4a44a); const poleMat = mat(0x8B4513);

    // --- SILHOUETTE: Tiered stone platform ---
    group.add(bm(new THREE.BoxGeometry(2.4, 0.12, 2.4), darkStone, 0, 0.06, 0));
    group.add(bm(new THREE.BoxGeometry(2.2, 0.18, 2.2), mat(0x7f8c8d), 0, 0.18, 0));
    group.add(bm(new THREE.BoxGeometry(2.0, 0.08, 2.0), mat(0x8a8a80), 0, 0.31, 0));

    // --- LAYERING: Four square corner towers ---
    const towerPositions: [number, number][] = [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
    for (const [tx, tz] of towerPositions) {
      // Tower body
      group.add(bm(new THREE.BoxGeometry(0.5, 1.8, 0.5), towerM, tx, 1.25, tz));
      // Stone band at base
      group.add(bm(new THREE.BoxGeometry(0.56, 0.06, 0.56), darkStone, tx, 0.4, tz));
      // Layered crenellation
      group.add(bm(new THREE.BoxGeometry(0.6, 0.08, 0.6), accentM, tx, 2.2, tz));
      for (const [cx, cz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as [number, number][]) {
        group.add(bm(new THREE.BoxGeometry(0.12, 0.18, 0.12), wallM, tx + cx, 2.35, tz + cz));
      }
      // Arrow slit
      group.add(bm(new THREE.BoxGeometry(0.04, 0.15, 0.04), mat(0x1a1a1a),
        tx + (tx > 0 ? 0.26 : -0.26), 1.4, tz));
    }

    // --- Curtain walls ---
    const walls = [
      { p: [0, 1.1, -0.8] as const, s: [1.1, 1.4, 0.22] as const },
      { p: [0, 1.1, 0.8] as const, s: [1.1, 1.4, 0.22] as const },
      { p: [-0.8, 1.1, 0] as const, s: [0.22, 1.4, 1.1] as const },
      { p: [0.8, 1.1, 0] as const, s: [0.22, 1.4, 1.1] as const },
    ];
    for (const w of walls) {
      group.add(bm(new THREE.BoxGeometry(w.s[0], w.s[1], w.s[2]), wallM, w.p[0], w.p[1], w.p[2]));
    }
    // Wall merlons
    for (let i = 0; i < 5; i++) {
      const x = -0.5 + i * 0.25;
      group.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.1), wallM, x, 1.88, -0.8));
      group.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.1), wallM, x, 1.88, 0.8));
    }
    for (let i = 0; i < 5; i++) {
      const z = -0.5 + i * 0.25;
      group.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.1), wallM, -0.8, 1.88, z));
      group.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.1), wallM, 0.8, 1.88, z));
    }

    // --- Gatehouse ---
    group.add(bm(new THREE.BoxGeometry(0.4, 0.65, 0.06), mat(0x1a1408), 0, 0.68, 0.82));
    // Heraldic shield
    group.add(bm(new THREE.BoxGeometry(0.2, 0.22, 0.04), flagM, 0, 1.5, 0.83));
    group.add(bm(new THREE.BoxGeometry(0.04, 0.16, 0.03), goldTrim, 0, 1.5, 0.85));
    group.add(bm(new THREE.BoxGeometry(0.14, 0.04, 0.03), goldTrim, 0, 1.5, 0.85));

    // --- Central keep ---
    group.add(bm(new THREE.BoxGeometry(0.7, 2.2, 0.7), towerM, 0, 1.45, 0));
    // Buttresses
    for (const [bx, bz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      group.add(bm(new THREE.BoxGeometry(0.1, 2.2, 0.1), accentM, bx, 1.45, bz));
    }
    // Keep crenellation
    group.add(bm(new THREE.BoxGeometry(0.8, 0.06, 0.8), accentM, 0, 2.6, 0));
    for (const p of [[-0.3, -0.35], [0, -0.35], [0.3, -0.35], [-0.3, 0.35], [0, 0.35], [0.3, 0.35], [-0.35, 0], [0.35, 0]] as [number, number][]) {
      group.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.1), wallM, p[0], 2.72, p[1]));
    }
    // Roof
    const roof = bm(new THREE.ConeGeometry(0.55, 0.6, 4), accentM, 0, 3.0, 0);
    roof.rotation.y = Math.PI / 4; group.add(roof);

    // --- ORNAMENTATION ---
    // Windows on keep
    const windowM = glow(0xffe8a0, 0.3);
    for (const [wx, wz, wy] of [[0, 0.37, 1.6], [0, 0.37, 2.1], [0.37, 0, 1.85]] as [number, number, number][]) {
      group.add(bm(new THREE.BoxGeometry(Math.abs(wz) > 0.1 ? 0.1 : 0.04, 0.15, Math.abs(wz) > 0.1 ? 0.04 : 0.1), windowM, wx, wy, wz));
    }
    // Torches on gatehouse
    const torchGlow = glow(0xff8800, 0.5);
    for (const tx2 of [-0.3, 0.3]) {
      group.add(bm(new THREE.BoxGeometry(0.03, 0.12, 0.03), poleMat, tx2, 1.15, 0.75));
      group.add(bm(new THREE.SphereGeometry(0.035, 5, 3), torchGlow, tx2, 1.24, 0.75));
    }

    // --- Flags ---
    group.add(bm(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), poleMat, 0, 3.75, 0));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), flagM);
    flag.position.set(0.38, 4.0, 0); flag.name = 'main-flag'; group.add(flag);
    // Corner tower flag
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), poleMat, 0.8, 2.7, 0.8));
    group.add(bm(new THREE.PlaneGeometry(0.3, 0.18), flagM, 0.98, 2.82, 0.8));

    return 4.2;
  }

  // ====================================================================
  //  TIER 2: CASTLE — Grand fortress with round towers, grand hall,
  //  multiple keeps, flying buttresses, stained glass, courtyard life,
  //  massive central spire with beacon flame
  // ====================================================================
  private buildCastleTier(group: THREE.Group, colors: typeof PLAYER_BASE_COLORS[0], owner: number): number {
    const flagM = new THREE.MeshLambertMaterial({ color: colors.flag, side: THREE.DoubleSide });
    const wallM = mat(colors.wall); const towerM = mat(colors.tower); const accentM = mat(colors.accent);
    const darkStone = mat(0x6a6a5a); const goldTrim = mat(0xd4a44a); const poleMat = mat(0x8B4513);
    const ironM = mat(0x5a5a5a); const richWood = mat(0x5a3a1a);

    // ====== PASS 1: SILHOUETTE — Grand multi-tier platform ======
    group.add(bm(new THREE.BoxGeometry(2.8, 0.08, 2.8), mat(0x5a6a4a), 0, 0.04, 0)); // outer earth ring
    group.add(bm(new THREE.BoxGeometry(2.5, 0.12, 2.5), darkStone, 0, 0.1, 0)); // lower stone
    group.add(bm(new THREE.BoxGeometry(2.3, 0.15, 2.3), mat(0x7f8c8d), 0, 0.22, 0)); // main platform
    group.add(bm(new THREE.BoxGeometry(2.1, 0.08, 2.1), mat(0x8a8a80), 0, 0.34, 0)); // upper course
    // Carved stone trim on platform edge
    for (const side of [-1.1, 1.1]) {
      group.add(bm(new THREE.BoxGeometry(2.35, 0.04, 0.04), goldTrim, 0, 0.3, side));
      group.add(bm(new THREE.BoxGeometry(0.04, 0.04, 2.35), goldTrim, side, 0.3, 0));
    }
    // Grand front steps — 3 tiers
    for (let i = 0; i < 3; i++) {
      group.add(bm(new THREE.BoxGeometry(0.7 - i * 0.08, 0.07, 0.12), darkStone, 0, 0.1 + i * 0.08, 1.2 + i * 0.1));
    }

    // ====== PASS 2: LAYERING — Round corner towers with conical roofs ======
    const towerPos: [number, number][] = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
    for (const [tx, tz] of towerPos) {
      // Tower body — cylinder tapering up
      group.add(bm(new THREE.CylinderGeometry(0.28, 0.35, 2.4, 8), towerM, tx, 1.55, tz));
      // Stone banding — 3 courses
      for (const y of [0.6, 1.3, 2.0]) {
        group.add(bm(new THREE.CylinderGeometry(0.32 + (y < 1 ? 0.05 : 0), 0.32 + (y < 1 ? 0.05 : 0), 0.05, 8), darkStone, tx, y, tz));
      }
      // Machicolation shelf (overhanging defensive ledge)
      group.add(bm(new THREE.CylinderGeometry(0.38, 0.3, 0.12, 8), accentM, tx, 2.75, tz));
      // Machicolation support brackets
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        group.add(bm(new THREE.BoxGeometry(0.04, 0.1, 0.04), darkStone,
          tx + Math.cos(a) * 0.31, 2.68, tz + Math.sin(a) * 0.31));
      }
      // Crenellated parapet on top
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        group.add(bm(new THREE.BoxGeometry(0.08, 0.16, 0.08), wallM,
          tx + Math.cos(a) * 0.32, 2.88, tz + Math.sin(a) * 0.32));
      }
      // Conical tower roof with shingles (layered cones)
      group.add(bm(new THREE.ConeGeometry(0.38, 0.5, 8), mat(0x6a4a3a), tx, 3.2, tz));
      group.add(bm(new THREE.ConeGeometry(0.32, 0.35, 8), mat(0x5a3a2a), tx, 3.3, tz)); // inner layer
      // Gold finial + pennant
      group.add(bm(new THREE.SphereGeometry(0.04, 6, 4), goldTrim, tx, 3.48, tz));
      group.add(bm(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6), poleMat, tx, 3.65, tz));
      const pennant = bm(new THREE.PlaneGeometry(0.2, 0.12), flagM, tx + 0.12, 3.75, tz);
      group.add(pennant);
      // Spiral arrow slits going up tower
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2 + (tx > 0 ? 0.5 : 0);
        const h = 0.8 + j * 0.5;
        const r2 = 0.33 - j * 0.015;
        group.add(bm(new THREE.BoxGeometry(0.035, 0.13, 0.035), mat(0x1a1a1a),
          tx + Math.cos(a) * r2, h, tz + Math.sin(a) * r2));
      }
    }

    // ====== Curtain walls — thick with walkways and merlons ======
    const wallDefs = [
      { p: [0, 1.2, -0.9], s: [1.3, 1.6, 0.2] },
      { p: [0, 1.2, 0.9], s: [1.3, 1.6, 0.2] },
      { p: [-0.9, 1.2, 0], s: [0.2, 1.6, 1.3] },
      { p: [0.9, 1.2, 0], s: [0.2, 1.6, 1.3] },
    ];
    for (const w of wallDefs) {
      group.add(bm(new THREE.BoxGeometry(w.s[0], w.s[1], w.s[2]), wallM, w.p[0], w.p[1], w.p[2]));
      // Wall walkway
      const isHoriz = w.s[0] > w.s[2];
      group.add(bm(new THREE.BoxGeometry(
        isHoriz ? w.s[0] : 0.3, 0.05, isHoriz ? 0.3 : w.s[2]
      ), darkStone, w.p[0], w.p[1] + 0.82, w.p[2]));
    }
    // Merlons around all 4 walls
    for (let i = 0; i < 7; i++) {
      const x = -0.6 + i * 0.2;
      group.add(bm(new THREE.BoxGeometry(0.08, 0.14, 0.08), wallM, x, 2.08, -0.9));
      group.add(bm(new THREE.BoxGeometry(0.08, 0.14, 0.08), wallM, x, 2.08, 0.9));
    }
    for (let i = 0; i < 7; i++) {
      const z = -0.6 + i * 0.2;
      group.add(bm(new THREE.BoxGeometry(0.08, 0.14, 0.08), wallM, -0.9, 2.08, z));
      group.add(bm(new THREE.BoxGeometry(0.08, 0.14, 0.08), wallM, 0.9, 2.08, z));
    }

    // ====== Grand gatehouse — double arch with portcullis ======
    // Gatehouse towers (flanking)
    for (const side of [-0.35, 0.35]) {
      group.add(bm(new THREE.BoxGeometry(0.3, 2.0, 0.35), towerM, side, 1.35, 0.95));
      group.add(bm(new THREE.BoxGeometry(0.35, 0.06, 0.4), accentM, side, 2.4, 0.95));
      // Mini crenellations
      group.add(bm(new THREE.BoxGeometry(0.08, 0.12, 0.08), wallM, side - 0.1, 2.5, 0.82));
      group.add(bm(new THREE.BoxGeometry(0.08, 0.12, 0.08), wallM, side + 0.1, 2.5, 0.82));
      group.add(bm(new THREE.BoxGeometry(0.08, 0.12, 0.08), wallM, side, 2.5, 1.08));
    }
    // Gate arch — dark opening
    group.add(bm(new THREE.BoxGeometry(0.35, 0.8, 0.08), mat(0x0a0a08), 0, 0.75, 0.95));
    // Arch top
    const archGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.35, 8, 1, false, 0, Math.PI);
    const arch = new THREE.Mesh(archGeo, towerM);
    arch.position.set(0, 1.16, 1.0); arch.rotation.set(Math.PI / 2, 0, 0); group.add(arch);
    // Portcullis grate — detailed iron
    const grateM = mat(0x4a4a4a);
    for (let i = 0; i < 4; i++) {
      group.add(bm(new THREE.BoxGeometry(0.015, 0.7, 0.015), grateM, -0.1 + i * 0.07, 0.72, 0.97));
    }
    for (const y of [0.55, 0.75, 0.95]) {
      group.add(bm(new THREE.BoxGeometry(0.28, 0.015, 0.015), grateM, 0, y, 0.97));
    }
    // Heraldic shield above gate — large
    group.add(bm(new THREE.BoxGeometry(0.28, 0.32, 0.05), flagM, 0, 1.65, 0.98));
    group.add(bm(new THREE.BoxGeometry(0.05, 0.24, 0.04), goldTrim, 0, 1.65, 1.0));
    group.add(bm(new THREE.BoxGeometry(0.2, 0.05, 0.04), goldTrim, 0, 1.65, 1.0));
    // Crown emblem above shield
    group.add(bm(new THREE.BoxGeometry(0.2, 0.06, 0.04), goldTrim, 0, 1.84, 0.98));
    for (const cx of [-0.06, 0, 0.06]) {
      group.add(bm(new THREE.BoxGeometry(0.03, 0.06, 0.03), goldTrim, cx, 1.9, 0.99));
    }

    // ====== PASS 3: ORNAMENTATION — Central keep complex ======

    // --- Main keep tower — square with stepped buttresses ---
    group.add(bm(new THREE.BoxGeometry(0.85, 3.0, 0.85), towerM, 0, 1.85, 0));
    // Layered stone courses on keep
    for (const y of [0.8, 1.4, 2.0, 2.6, 3.0]) {
      group.add(bm(new THREE.BoxGeometry(0.88, 0.04, 0.88), darkStone, 0, y, 0));
    }
    // Stepped buttresses on all 4 corners
    for (const [bx, bz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
      group.add(bm(new THREE.BoxGeometry(0.14, 3.0, 0.14), accentM, bx, 1.85, bz));
      // Buttress cap
      group.add(bm(new THREE.BoxGeometry(0.16, 0.06, 0.16), darkStone, bx, 3.38, bz));
    }
    // Keep machicolation overhang
    group.add(bm(new THREE.BoxGeometry(1.0, 0.1, 1.0), accentM, 0, 3.4, 0));
    // Bracket supports
    for (const [bx, bz] of [[-0.42, 0], [0.42, 0], [0, -0.42], [0, 0.42]]) {
      group.add(bm(new THREE.BoxGeometry(0.06, 0.1, 0.06), darkStone, bx, 3.32, bz));
    }
    // Keep crenellated parapet
    for (let i = 0; i < 4; i++) {
      for (const v of [-0.4, -0.15, 0.1, 0.35]) {
        const [mx, mz] = i < 2
          ? [v, (i === 0 ? -0.46 : 0.46)]
          : [(i === 2 ? -0.46 : 0.46), v];
        group.add(bm(new THREE.BoxGeometry(0.08, 0.16, 0.08), wallM, mx, 3.53, mz));
      }
    }

    // --- Grand spire on keep ---
    // Multi-stage spire: octagonal base → narrowing cone → beacon
    group.add(bm(new THREE.CylinderGeometry(0.35, 0.45, 0.3, 8), darkStone, 0, 3.6, 0)); // base ring
    group.add(bm(new THREE.ConeGeometry(0.4, 1.2, 8), mat(0x5a3a2a), 0, 4.35, 0)); // main spire
    group.add(bm(new THREE.ConeGeometry(0.25, 0.6, 8), mat(0x4a2a1a), 0, 4.6, 0)); // inner spire layer
    // Gold crown ring on spire
    group.add(bm(new THREE.TorusGeometry(0.2, 0.02, 6, 12), goldTrim, 0, 4.1, 0));
    // Beacon flame at peak
    group.add(bm(new THREE.SphereGeometry(0.08, 8, 6), glow(0xff6600, 0.9), 0, 5.0, 0));
    group.add(bm(new THREE.SphereGeometry(0.05, 6, 4), glow(0xffaa00, 0.7), 0, 5.08, 0));
    group.add(bm(new THREE.SphereGeometry(0.03, 5, 3), glow(0xffdd00, 0.5), 0, 5.14, 0));

    // --- Stained glass windows on keep (emissive colored) ---
    const stainedGlass = glow(0xff8800, 0.4);
    const blueGlass = glow(0x4488ff, 0.4);
    // Front windows — large pointed arches
    for (const [wx, wy] of [[-0.18, 1.6], [0.18, 1.6], [0, 2.3]] as [number, number][]) {
      group.add(bm(new THREE.BoxGeometry(0.1, 0.2, 0.04), wy > 2 ? blueGlass : stainedGlass, wx, wy, 0.44));
      // Pointed arch cap
      group.add(bm(new THREE.ConeGeometry(0.05, 0.06, 4), wy > 2 ? blueGlass : stainedGlass, wx, wy + 0.13, 0.44));
    }
    // Side windows
    group.add(bm(new THREE.BoxGeometry(0.04, 0.18, 0.1), stainedGlass, 0.44, 2.0, 0));
    group.add(bm(new THREE.BoxGeometry(0.04, 0.18, 0.1), blueGlass, -0.44, 2.0, 0));
    // Back window — rose window (circular, torus approximation)
    const roseWindow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), glow(0xaa44ff, 0.4));
    roseWindow.position.set(0, 2.2, -0.44); group.add(roseWindow);
    group.add(bm(new THREE.SphereGeometry(0.04, 6, 4), glow(0xaa44ff, 0.3), 0, 2.2, -0.44)); // rose center

    // --- Secondary keep (smaller, to the side) ---
    group.add(bm(new THREE.BoxGeometry(0.5, 1.8, 0.5), towerM, -0.5, 1.25, -0.35));
    group.add(bm(new THREE.BoxGeometry(0.55, 0.04, 0.55), darkStone, -0.5, 2.18, -0.35));
    for (const [cx, cz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as [number, number][]) {
      group.add(bm(new THREE.BoxGeometry(0.08, 0.12, 0.08), wallM, -0.5 + cx, 2.28, -0.35 + cz));
    }
    const miniRoof = bm(new THREE.ConeGeometry(0.32, 0.45, 4), accentM, -0.5, 2.55, -0.35);
    miniRoof.rotation.y = Math.PI / 4; group.add(miniRoof);
    // Window
    group.add(bm(new THREE.BoxGeometry(0.04, 0.12, 0.08), stainedGlass, -0.76, 1.5, -0.35));

    // --- Chapel wing (right side, with bell tower) ---
    group.add(bm(new THREE.BoxGeometry(0.45, 1.4, 0.55), wallM, 0.48, 1.05, -0.32));
    // Chapel peaked roof
    for (const side of [-1, 1]) {
      const chapRoof = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.6), mat(0x6a4a3a));
      chapRoof.position.set(0.48 + side * 0.12, 1.85, -0.32); chapRoof.rotation.z = side * 0.4; group.add(chapRoof);
    }
    // Bell tower
    group.add(bm(new THREE.BoxGeometry(0.2, 0.8, 0.2), towerM, 0.58, 2.15, -0.45));
    group.add(bm(new THREE.ConeGeometry(0.15, 0.25, 4), accentM, 0.58, 2.67, -0.45));
    // Bell (sphere in arch opening)
    group.add(bm(new THREE.SphereGeometry(0.04, 6, 4), goldTrim, 0.58, 2.4, -0.45));
    // Chapel rose window
    group.add(bm(new THREE.SphereGeometry(0.05, 8, 6), glow(0x8844ff, 0.35), 0.71, 1.4, -0.32));

    // ====== PASS 4: COURTYARD LIFE ======
    // Well with stone rim + wooden frame
    group.add(bm(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 8), darkStone, 0.35, 0.47, 0.35));
    group.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), richWood, 0.35, 0.65, 0.25));
    group.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), richWood, 0.35, 0.65, 0.45));
    group.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.22), richWood, 0.35, 0.82, 0.35)); // crossbeam
    group.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), richWood, 0.35, 0.78, 0.35)); // winch
    group.add(bm(new THREE.BoxGeometry(0.01, 0.12, 0.01), mat(0xc9a96e), 0.35, 0.7, 0.35)); // rope

    // Torch sconces along walls — glow for night ambiance
    const torchGlow = glow(0xff8800, 0.5);
    for (const [tx2, ty2, tz2] of [[0.35, 1.3, 0.78], [-0.35, 1.3, 0.78], [0.78, 1.3, 0.35], [0.78, 1.3, -0.35]] as [number, number, number][]) {
      group.add(bm(new THREE.BoxGeometry(0.025, 0.12, 0.025), poleMat, tx2, ty2, tz2));
      group.add(bm(new THREE.SphereGeometry(0.03, 5, 3), torchGlow, tx2, ty2 + 0.08, tz2));
    }

    // Barrel store
    for (let i = 0; i < 2; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 8), mat(0x6a4a2a));
      barrel.position.set(-0.35 + i * 0.15, 0.45, 0.5); group.add(barrel);
      group.add(bm(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 8), ironM, -0.35 + i * 0.15, 0.42, 0.5));
    }

    // ====== PASS 5: BACK DETAIL ======
    // Back wall garden terrace
    group.add(bm(new THREE.BoxGeometry(0.6, 0.06, 0.15), mat(0x5a7a4a), 0.15, 0.4, -0.75)); // grass strip
    // Buttress on back wall
    group.add(bm(new THREE.BoxGeometry(0.15, 1.0, 0.1), darkStone, 0, 0.85, -0.98));

    // ====== FLAGS — Multiple, grand ======
    // Main keep flag — tallest
    group.add(bm(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), poleMat, 0, 5.3, 0));
    const mainFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), flagM);
    mainFlag.position.set(0.45, 5.4, 0); mainFlag.name = 'main-flag'; group.add(mainFlag);

    // Gatehouse flags
    for (const side of [-0.35, 0.35]) {
      group.add(bm(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6), poleMat, side, 2.6, 0.95));
      group.add(bm(new THREE.PlaneGeometry(0.2, 0.12), flagM, side + 0.12, 2.72, 0.95));
    }

    return 5.6; // topY for health bar
  }

  // ==================================================================
  // Tier upgrade — rebuild mesh when base tier changes
  // ==================================================================
  rebuildForTier(base: Base, elevation: number): void {
    const existing = this.baseMeshes.get(base.id);
    if (existing && existing.currentTier === (base.tier ?? BaseTier.CAMP)) return; // already correct tier
    this.addBase(base, elevation);
  }

  updateHealthBar(base: Base): void {
    const meshGroup = this.baseMeshes.get(base.id);
    if (!meshGroup) return;

    const pct = Math.max(0, base.health / base.maxHealth);
    meshGroup.healthBar.scale.x = pct;
    meshGroup.healthBar.position.x = -(1 - pct) * 1.0; // shift left as health decreases

    // Color changes with damage
    const hpMat = meshGroup.healthBar.material as THREE.MeshBasicMaterial;
    if (pct > 0.5) {
      hpMat.color.setHex(base.owner === 0 ? 0x3498db : 0xe74c3c);
    } else if (pct > 0.25) {
      hpMat.color.setHex(0xf39c12);
    } else {
      hpMat.color.setHex(0xff0000);
    }
  }

  updateBillboards(camera: THREE.Camera): void {
    for (const [, meshGroup] of this.baseMeshes) {
      meshGroup.healthBar.lookAt(camera.position);
      meshGroup.healthBarBg.lookAt(camera.position);
    }
  }

  showDestruction(base: Base): void {
    const meshGroup = this.baseMeshes.get(base.id);
    if (!meshGroup) return;

    // Make the base look destroyed — darken and tilt pieces
    meshGroup.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        child.material.color.multiplyScalar(0.3);
      }
    });

    // Tilt the group slightly
    meshGroup.group.rotation.z = 0.15;
    meshGroup.group.rotation.x = -0.1;
  }

  removeBase(baseId: string): void {
    const meshGroup = this.baseMeshes.get(baseId);
    if (meshGroup) {
      this.scene.remove(meshGroup.group);
      meshGroup.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.baseMeshes.delete(baseId);
    }
  }

  /** Get all base mesh groups for raycasting — returns [baseId, THREE.Group][] */
  getAllBaseMeshGroups(): { baseId: string; group: THREE.Group }[] {
    const result: { baseId: string; group: THREE.Group }[] = [];
    for (const [id, mg] of this.baseMeshes) {
      result.push({ baseId: id, group: mg.group });
    }
    return result;
  }

  dispose(): void {
    for (const [id] of this.baseMeshes) {
      this.removeBase(id);
    }
  }
}
