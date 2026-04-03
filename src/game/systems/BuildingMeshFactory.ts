/**
 * Building Mesh Factory — Pure mesh construction functions for all building types.
 * Each function creates a Three.js Group with the building's visual geometry.
 * Design philosophy: mixed geometry, layered detail, ornamentation, back detail.
 */
import * as THREE from 'three';
import { HexCoord } from '../../types';
// Pathfinder import removed — blockedTiles now managed by BuildingSystem

/** Helper: create a mesh and set its position */
function bm(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Helper: create a positioned + rotated mesh */
function bmr(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** Create a positioned building group at the hex coordinate */
function createBuildingGroup(pos: HexCoord, owner: number, name: string, getElevation: (pos: HexCoord) => number): THREE.Group {
  const worldX = pos.q * 1.5;
  const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
  const baseY = getElevation(pos);
  const group = new THREE.Group();
  group.position.set(worldX, baseY, worldZ);
  group.scale.set(1, 1, 1);
  group.name = `${name}_${owner}`;
  return group;
}

// ====== Shared material factories (reuse across buildings) ======
const _matCache: Map<number, THREE.MeshLambertMaterial> = new Map();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = _matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _matCache.set(color, m); }
  return m;
}
function glow(color: number, intensity = 0.6): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity });
}

// ========================================================================
// FORESTRY — Grand woodland lodge & lumber camp
// Design: Massive log cabin with steep A-frame, exposed half-timber frame,
// attached sawmill lean-to, log stacking yard, chopping station with
// embedded axes, drying rack, sawbuck, chimney with smoke, moss & vines,
// woodland spirit totem, team banners, lantern glow.
// 6-pass: silhouette → layering → ornamentation → weapons → back detail → aura
// ========================================================================
export function buildForestryMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'forestry', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const logBrown = 0x6b4226; const darkLog = 0x4a2a12; const lightLog = 0x8b6a3e;
  const stucco = 0xe0d4b8; const moss = 0x4a7c3a; const slate = 0x5a5a4a;
  const iron = 0x5a5550; const gold = 0xd4a44a; const rope = 0xc9a96e;

  // ── PASS 1: SILHOUETTE — big shapes: main lodge, sawmill lean-to, chimney ──

  // Rough stone & packed earth foundation — organic, uneven
  g.add(bm(new THREE.BoxGeometry(1.75, 0.06, 1.75), mat(0x5a5a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.65, 0.16, 1.65), mat(0x6a6a5a), 0, 0.11, 0));

  // Main lodge body — wide rectangular cabin
  g.add(bm(new THREE.BoxGeometry(1.15, 1.15, 0.95), mat(stucco), 0, 0.77, 0));

  // Steep A-frame roof — two sloped planes + overhang
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 1.1), mat(slate));
    slab.position.set(side * 0.35, 1.58, 0); slab.rotation.z = -side * 0.52; g.add(slab);
    // Second layer — slight offset for depth
    const layer2 = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 1.06), mat(0x4a4a3a));
    layer2.position.set(side * 0.34, 1.52, 0); layer2.rotation.z = -side * 0.52; g.add(layer2);
  }
  // Ridge beam — thick log
  g.add(bm(new THREE.CylinderGeometry(0.05, 0.05, 1.15, 6), mat(darkLog), 0, 1.88, 0));
  // Ridge beam rotation to horizontal
  const ridgeLog = g.children[g.children.length - 1];
  ridgeLog.rotation.x = Math.PI / 2;

  // Sawmill lean-to — attached to right side, open front
  g.add(bm(new THREE.BoxGeometry(0.55, 0.75, 0.65), mat(lightLog), 0.68, 0.57, 0.15));
  // Lean-to sloped roof
  const leanRoof = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.06, 0.75), mat(slate));
  leanRoof.position.set(0.68, 1.0, 0.15); leanRoof.rotation.z = -0.25; g.add(leanRoof);

  // Grand stone chimney — wide, tapering
  g.add(bm(new THREE.BoxGeometry(0.3, 1.6, 0.28), mat(0x7a7a6a), -0.45, 1.0, -0.48));
  g.add(bm(new THREE.BoxGeometry(0.34, 0.08, 0.32), mat(0x6a6a5a), -0.45, 1.84, -0.48)); // cap
  g.add(bm(new THREE.BoxGeometry(0.26, 0.08, 0.24), mat(0x8a8a7a), -0.45, 1.92, -0.48)); // inner rim

  // ── PASS 2: LAYERING — half-timber frame, log courses, structural detail ──

  // Exposed half-timber frame — vertical + horizontal + diagonal beams
  // Front face
  for (const x of [-0.55, -0.18, 0.18, 0.55]) {
    g.add(bm(new THREE.BoxGeometry(0.055, 1.15, 0.04), mat(darkLog), x, 0.77, 0.48));
  }
  // Front horizontal beams
  for (const y of [0.4, 0.75, 1.1]) {
    g.add(bm(new THREE.BoxGeometry(1.17, 0.05, 0.04), mat(darkLog), 0, y, 0.48));
  }
  // Front diagonal braces in panels
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(darkLog), -0.36, 0.58, 0.48, 0, 0, 0.45));
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(darkLog), 0.36, 0.58, 0.48, 0, 0, -0.45));

  // Back face beams
  for (const x of [-0.55, 0, 0.55]) {
    g.add(bm(new THREE.BoxGeometry(0.055, 1.15, 0.04), mat(darkLog), x, 0.77, -0.48));
  }
  for (const y of [0.4, 1.1]) {
    g.add(bm(new THREE.BoxGeometry(1.17, 0.05, 0.04), mat(darkLog), 0, y, -0.48));
  }

  // Side face beams
  for (const z of [-0.45, 0, 0.45]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 1.15, 0.055), mat(darkLog), 0.58, 0.77, z));
    g.add(bm(new THREE.BoxGeometry(0.04, 1.15, 0.055), mat(darkLog), -0.58, 0.77, z));
  }

  // Foundation log courses — stacked logs visible at base
  for (let i = 0; i < 3; i++) {
    g.add(bm(new THREE.BoxGeometry(1.18, 0.05, 0.04), mat(logBrown), 0, 0.22 + i * 0.06, 0.49));
    g.add(bm(new THREE.BoxGeometry(1.18, 0.05, 0.04), mat(logBrown), 0, 0.22 + i * 0.06, -0.49));
  }

  // Chimney stone courses (alternating blocks for masonry texture)
  for (let i = 0; i < 6; i++) {
    const offset = i % 2 === 0 ? 0.01 : -0.01;
    g.add(bm(new THREE.BoxGeometry(0.32, 0.04, 0.3), mat(i % 2 === 0 ? 0x8a8a7a : 0x7a7a6a),
      -0.45 + offset, 0.35 + i * 0.25, -0.48));
  }

  // ── PASS 3: ORNAMENTATION — moss, vines, iron hardware, team color ──

  // Moss patches on roof
  for (const [mx, my, mz, mrz] of [[0.45, 1.42, 0.15, -0.52], [-0.5, 1.45, -0.2, 0.52], [0.3, 1.35, -0.35, -0.52]]) {
    const mstrip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.2), mat(moss));
    mstrip.position.set(mx as number, my as number, mz as number);
    mstrip.rotation.z = mrz as number; g.add(mstrip);
  }
  // Moss at base of chimney
  g.add(bm(new THREE.BoxGeometry(0.12, 0.08, 0.12), mat(moss), -0.38, 0.22, -0.36));

  // Front door — heavy planked with iron strap hinges
  g.add(bm(new THREE.BoxGeometry(0.38, 0.65, 0.06), mat(lightLog), 0, 0.52, 0.5));
  g.add(bm(new THREE.BoxGeometry(0.4, 0.04, 0.04), mat(iron), 0, 0.35, 0.53)); // bottom hinge
  g.add(bm(new THREE.BoxGeometry(0.4, 0.04, 0.04), mat(iron), 0, 0.55, 0.53)); // mid hinge
  g.add(bm(new THREE.BoxGeometry(0.4, 0.04, 0.04), mat(iron), 0, 0.72, 0.53)); // top hinge
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat(gold), 0.14, 0.5, 0.54)); // handle
  // Door arch — carved log lintel
  g.add(bm(new THREE.BoxGeometry(0.46, 0.06, 0.06), mat(darkLog), 0, 0.87, 0.5));

  // Windows — small paned with shutters
  for (const x of [-0.35, 0.35]) {
    g.add(bm(new THREE.BoxGeometry(0.14, 0.12, 0.04), mat(0x667788), x, 0.85, 0.5)); // glass
    g.add(bm(new THREE.BoxGeometry(0.02, 0.12, 0.04), mat(darkLog), x, 0.85, 0.51)); // mullion
    g.add(bm(new THREE.BoxGeometry(0.16, 0.02, 0.04), mat(darkLog), x, 0.85, 0.51)); // transom
    // Shutters
    g.add(bm(new THREE.BoxGeometry(0.07, 0.14, 0.03), mat(logBrown), x - 0.1, 0.85, 0.52));
    g.add(bm(new THREE.BoxGeometry(0.07, 0.14, 0.03), mat(logBrown), x + 0.1, 0.85, 0.52));
  }

  // Antler rack mounted above door (trophy)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat(0xc4a880), 0, 1.02, 0.52)); // mount
  for (const side of [-1, 1]) {
    g.add(bmr(new THREE.CylinderGeometry(0.012, 0.008, 0.2, 4), mat(0xc4a880), side * 0.08, 1.1, 0.52, 0, 0, side * 0.6));
    g.add(bmr(new THREE.CylinderGeometry(0.008, 0.005, 0.1, 4), mat(0xc4a880), side * 0.15, 1.18, 0.52, 0, 0, side * 0.3));
  }

  // ── PASS 4: TOOL/WEAPON PASS — axes, saws, sawbuck, log stacking ──

  // Sawbuck — proper X-frame with bracing
  const sbX = -0.65, sbZ = 0.35;
  for (const s of [-1, 1]) {
    g.add(bmr(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(darkLog), sbX, 0.4, sbZ + s * 0.06, 0, 0, s * 0.3));
  }
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.2), mat(darkLog), sbX, 0.42, sbZ)); // cross brace
  // Log resting on sawbuck
  const restLog2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.6, 6), mat(logBrown));
  restLog2.rotation.z = Math.PI / 2; restLog2.position.set(sbX, 0.52, sbZ); g.add(restLog2);
  // Saw leaning against sawbuck
  g.add(bmr(new THREE.BoxGeometry(0.01, 0.35, 0.12), mat(0x8899aa), sbX + 0.12, 0.4, sbZ, 0, 0, 0.15));
  g.add(bmr(new THREE.BoxGeometry(0.03, 0.08, 0.03), mat(darkLog), sbX + 0.14, 0.6, sbZ, 0, 0, 0.15)); // handle

  // Chopping block with embedded axe (front right)
  g.add(bm(new THREE.BoxGeometry(0.22, 0.25, 0.22), mat(logBrown), 0.55, 0.31, 0.55)); // block
  // Wood grain lines on block
  g.add(bm(new THREE.BoxGeometry(0.23, 0.02, 0.02), mat(darkLog), 0.55, 0.44, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.02, 0.02, 0.23), mat(darkLog), 0.55, 0.44, 0.55));
  // Axe — handle + shaped head embedded in block
  g.add(bmr(new THREE.BoxGeometry(0.03, 0.35, 0.03), mat(darkLog), 0.55, 0.58, 0.55, 0, 0, 0.12));
  g.add(bmr(new THREE.BoxGeometry(0.14, 0.07, 0.025), mat(0x8899aa), 0.58, 0.7, 0.55, 0, 0, 0.12)); // blade
  g.add(bmr(new THREE.BoxGeometry(0.02, 0.04, 0.025), mat(0x667788), 0.64, 0.72, 0.55, 0, 0, 0.12)); // blade edge
  // Wood chips scattered around block
  for (const [cx, cz] of [[0.48, 0.68], [0.63, 0.65], [0.43, 0.5]]) {
    g.add(bmr(new THREE.BoxGeometry(0.04, 0.015, 0.025), mat(lightLog), cx, 0.2, cz, 0.2, 0.5, 0));
  }

  // Log pile — right side, 3 rows deep with proper nesting
  const logMat = mat(logBrown);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < (4 - row); i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.65, 6), logMat);
      log.rotation.x = Math.PI / 2;
      log.position.set(0.7, 0.25 + row * 0.11, -0.35 + i * 0.12 + (row % 2) * 0.06);
      g.add(log);
    }
  }
  // Bark texture — slight color variation on end logs
  g.add(bm(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 6), mat(0x5a3216), 0.7, 0.25, -0.03));
  g.add(bm(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 6), mat(0x5a3216), 0.7, 0.36, 0.03));

  // Drying rack — horizontal poles with hanging strips
  g.add(bm(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(darkLog), -0.72, 0.44, -0.2));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(darkLog), -0.72, 0.44, -0.55));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.38), mat(darkLog), -0.72, 0.68, -0.38)); // crossbar
  // Hanging strips (bark/leather)
  for (const z of [-0.28, -0.38, -0.48]) {
    g.add(bm(new THREE.BoxGeometry(0.02, 0.2, 0.04), mat(0x8a6a4a), -0.72, 0.56, z));
  }

  // ── PASS 5: BACK DETAIL — woodpile, back door, storage lean-to ──

  // Back wall detail — plank-on-plank layered look
  for (let i = 0; i < 5; i++) {
    g.add(bm(new THREE.BoxGeometry(0.23, 1.1, 0.03), mat(i % 2 === 0 ? stucco : 0xd5c8a8), -0.46 + i * 0.23, 0.75, -0.49));
  }

  // Back door — simpler service entrance
  g.add(bm(new THREE.BoxGeometry(0.3, 0.5, 0.05), mat(lightLog), 0.2, 0.44, -0.49));
  g.add(bm(new THREE.BoxGeometry(0.32, 0.04, 0.04), mat(iron), 0.2, 0.38, -0.51));
  g.add(bm(new THREE.BoxGeometry(0.32, 0.04, 0.04), mat(iron), 0.2, 0.58, -0.51));

  // Firewood stack against back wall
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 3; i++) {
      g.add(bm(new THREE.BoxGeometry(0.08, 0.1, 0.15), mat(logBrown), -0.2 + i * 0.1, 0.24 + row * 0.11, -0.6));
    }
  }

  // Rope coil hanging on side wall
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 10), mat(rope));
  coil.position.set(0.58, 0.65, -0.3); coil.rotation.y = Math.PI / 2; g.add(coil);

  // ── PASS 6: MAGICAL/AURA — lantern, chimney smoke, spirit totem ──

  // Chimney smoke puffs (emissive)
  g.add(bm(new THREE.SphereGeometry(0.07, 5, 3), glow(0xaaaaaa, 0.15), -0.45, 2.05, -0.48));
  g.add(bm(new THREE.SphereGeometry(0.05, 5, 3), glow(0x999999, 0.1), -0.42, 2.18, -0.45));

  // Hanging lantern at front door
  g.add(bm(new THREE.BoxGeometry(0.02, 0.08, 0.02), mat(iron), 0.25, 0.95, 0.54)); // bracket arm
  g.add(bm(new THREE.BoxGeometry(0.06, 0.08, 0.06), mat(0x665533), 0.25, 0.88, 0.54)); // lantern cage
  g.add(bm(new THREE.BoxGeometry(0.03, 0.04, 0.03), glow(0xffaa33, 0.5), 0.25, 0.88, 0.54)); // flame

  // Woodland spirit totem — carved log post with face (left side)
  g.add(bm(new THREE.CylinderGeometry(0.06, 0.07, 0.55, 6), mat(darkLog), -0.75, 0.46, 0.6));
  g.add(bm(new THREE.BoxGeometry(0.08, 0.04, 0.04), mat(darkLog), -0.75, 0.65, 0.62)); // brow
  g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 0.02), mat(0x1a1a1a), -0.77, 0.6, 0.64)); // eye L
  g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 0.02), mat(0x1a1a1a), -0.73, 0.6, 0.64)); // eye R
  g.add(bm(new THREE.SphereGeometry(0.02, 4, 3), glow(0x44aa44, 0.3), -0.75, 0.72, 0.64)); // spirit glow

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.6, 0.05, 1.6), mat(tc), 0, 0.2, 0));
  // Team banner draped from roof edge
  g.add(bm(new THREE.BoxGeometry(0.2, 0.3, 0.03), mat(tc), -0.32, 1.2, 0.56));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.02, 0.025), mat(gold), -0.32, 1.04, 0.56)); // fringe

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// BARRACKS — Imposing military fortress compound
// Design: Walled courtyard with gatehouse, twin corner towers, crenellated
// battlements, training yard with dummies & weapon racks, forge corner,
// officer's quarters with balcony, siege equipment storage, team banners.
// 6-pass: silhouette → layering → ornamentation → weapons → back detail → aura
// ========================================================================
export function buildBarracksMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'barracks', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const stone = 0xc8b89a; const darkStone = 0xa09078; const midStone = 0xb4a488;
  const iron = 0x5a5550; const darkIron = 0x3a3530; const gold = 0xd4a44a;
  const plank = 0x6a4a2a; const darkPlank = 0x4a3018;

  // ── PASS 1: SILHOUETTE — large shapes establishing the compound ──

  // Raised stone platform — 2-tier foundation with stepped edges
  g.add(bm(new THREE.BoxGeometry(1.85, 0.08, 1.85), mat(0x6f7c6d), 0, 0.04, 0));
  g.add(bm(new THREE.BoxGeometry(1.78, 0.18, 1.78), mat(0x7f8c8d), 0, 0.13, 0));
  g.add(bm(new THREE.BoxGeometry(1.72, 0.06, 1.72), mat(darkStone), 0, 0.25, 0));

  // Main hall — rectangular keep, the dominant structure
  g.add(bm(new THREE.BoxGeometry(1.1, 1.3, 0.75), mat(stone), 0, 0.93, -0.15));

  // Officer's quarters wing — left side, slightly shorter
  g.add(bm(new THREE.BoxGeometry(0.55, 1.0, 0.55), mat(midStone), -0.45, 0.78, 0.35));

  // Twin corner towers — round, taller than keep (FRONT corners)
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.CylinderGeometry(0.22, 0.25, 2.0, 8), mat(stone), side * 0.72, 1.28, 0.5));
  }
  // Back corner tower — single, tallest (command lookout)
  g.add(bm(new THREE.CylinderGeometry(0.25, 0.28, 2.4, 8), mat(stone), 0.6, 1.48, -0.55));

  // ── PASS 2: LAYERING — stone courses, wall depth, structural stacking ──

  // Keep: horizontal stone band courses (3 levels)
  for (const y of [0.5, 0.85, 1.2]) {
    g.add(bm(new THREE.BoxGeometry(1.12, 0.04, 0.77), mat(darkStone), 0, y, -0.15));
  }
  // Keep: vertical pilaster buttresses on front face (4 pillars)
  for (const x of [-0.45, -0.15, 0.15, 0.45]) {
    g.add(bm(new THREE.BoxGeometry(0.06, 1.3, 0.04), mat(darkStone), x, 0.93, 0.24));
  }
  // Keep: corner stone quoins (alternating offset blocks at corners)
  for (const [cx, cz] of [[0.55, 0.23], [-0.55, 0.23], [0.55, -0.53], [-0.55, -0.53]]) {
    for (let i = 0; i < 5; i++) {
      const offset = i % 2 === 0 ? 0.02 : -0.02;
      g.add(bm(new THREE.BoxGeometry(0.08, 0.12, 0.08), mat(midStone), cx + offset, 0.36 + i * 0.25, cz));
    }
  }

  // Officers wing: stone courses
  g.add(bm(new THREE.BoxGeometry(0.57, 0.04, 0.57), mat(darkStone), -0.45, 0.55, 0.35));
  g.add(bm(new THREE.BoxGeometry(0.57, 0.04, 0.57), mat(darkStone), -0.45, 0.9, 0.35));

  // Tower stone banding (3 rings per tower)
  for (const side of [-1, 1]) {
    for (const y of [0.6, 1.1, 1.6]) {
      g.add(bm(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 8), mat(darkStone), side * 0.72, y, 0.5));
    }
  }
  for (const y of [0.7, 1.3, 1.9]) {
    g.add(bm(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 8), mat(darkStone), 0.6, y, -0.55));
  }

  // ── Crenellated battlements — keep roof ──
  g.add(bm(new THREE.BoxGeometry(1.2, 0.08, 0.85), mat(darkStone), 0, 1.62, -0.15)); // roof slab
  const merlonGeo = new THREE.BoxGeometry(0.1, 0.16, 0.1);
  const merlonMat = mat(stone);
  // Front merlons (7)
  for (let i = 0; i < 7; i++) g.add(bm(merlonGeo, merlonMat, -0.54 + i * 0.18, 1.74, 0.24));
  // Back merlons (7)
  for (let i = 0; i < 7; i++) g.add(bm(merlonGeo, merlonMat, -0.54 + i * 0.18, 1.74, -0.54));
  // Side merlons (4 per side)
  for (let i = 0; i < 4; i++) {
    g.add(bm(merlonGeo, merlonMat, 0.56, 1.74, -0.44 + i * 0.2));
    g.add(bm(merlonGeo, merlonMat, -0.56, 1.74, -0.44 + i * 0.2));
  }

  // Tower tops — machicolation overhang + crenellations
  for (const side of [-1, 1]) {
    const tx = side * 0.72, tz = 0.5;
    // Overhang shelf
    g.add(bm(new THREE.CylinderGeometry(0.28, 0.22, 0.08, 8), mat(darkStone), tx, 2.32, tz));
    // Mini bracket supports under overhang
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(bm(new THREE.BoxGeometry(0.04, 0.08, 0.04), mat(midStone),
        tx + Math.cos(a) * 0.2, 2.26, tz + Math.sin(a) * 0.2));
    }
    // Tower merlons (6 around)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(bm(new THREE.BoxGeometry(0.06, 0.12, 0.06), merlonMat,
        tx + Math.cos(a) * 0.24, 2.42, tz + Math.sin(a) * 0.24));
    }
    // Conical tower roof
    g.add(bm(new THREE.ConeGeometry(0.26, 0.35, 8), mat(0x6a5a4a), tx, 2.55, tz));
  }

  // Back command tower — taller, bigger treatment
  {
    const tx = 0.6, tz = -0.55;
    g.add(bm(new THREE.CylinderGeometry(0.32, 0.25, 0.08, 8), mat(darkStone), tx, 2.72, tz));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.add(bm(new THREE.BoxGeometry(0.04, 0.1, 0.04), mat(midStone),
        tx + Math.cos(a) * 0.24, 2.66, tz + Math.sin(a) * 0.24));
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.add(bm(new THREE.BoxGeometry(0.07, 0.14, 0.07), merlonMat,
        tx + Math.cos(a) * 0.28, 2.84, tz + Math.sin(a) * 0.28));
    }
    g.add(bm(new THREE.ConeGeometry(0.3, 0.45, 8), mat(0x5a4a3a), tx, 3.0, tz));
    // Gold finial + pennant on command tower
    g.add(bm(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4), mat(gold), tx, 3.38, tz));
    g.add(bm(new THREE.BoxGeometry(0.22, 0.12, 0.02), mat(tc), tx + 0.12, 3.42, tz));
  }

  // ── PASS 3: ORNAMENTATION — gold trim, emblems, studs, team color ──

  // Gatehouse entrance — front center with flanking pilasters
  g.add(bm(new THREE.BoxGeometry(0.5, 0.8, 0.12), mat(0x1a1408), 0, 0.68, 0.3)); // dark opening
  // Arch over gate
  const archGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10, 1, false, 0, Math.PI);
  g.add(bmr(archGeo, mat(darkStone), 0, 1.08, 0.32, Math.PI / 2, 0, 0));
  // Flanking pilasters with gold caps
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.1, 0.85, 0.1), mat(darkStone), side * 0.28, 0.7, 0.32));
    g.add(bm(new THREE.BoxGeometry(0.12, 0.06, 0.12), mat(gold), side * 0.28, 1.16, 0.32));
  }
  // Portcullis grate (iron grid over gate)
  for (let i = 0; i < 4; i++) {
    g.add(bm(new THREE.BoxGeometry(0.02, 0.7, 0.02), mat(darkIron), -0.14 + i * 0.095, 0.63, 0.32));
  }
  for (let i = 0; i < 3; i++) {
    g.add(bm(new THREE.BoxGeometry(0.38, 0.02, 0.02), mat(darkIron), 0, 0.4 + i * 0.2, 0.32));
  }
  // Heraldic shield over gate — team colored with gold cross emblem
  g.add(bm(new THREE.BoxGeometry(0.26, 0.3, 0.05), mat(tc), 0, 1.35, 0.3));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.22, 0.03), mat(gold), 0, 1.35, 0.33)); // cross vert
  g.add(bm(new THREE.BoxGeometry(0.18, 0.04, 0.03), mat(gold), 0, 1.37, 0.33)); // cross horiz
  // Gold trim strip below battlements
  g.add(bm(new THREE.BoxGeometry(1.14, 0.03, 0.03), mat(gold), 0, 1.58, 0.24));
  g.add(bm(new THREE.BoxGeometry(1.14, 0.03, 0.03), mat(gold), 0, 1.58, -0.54));

  // Iron door studs (decorative rivets flanking gate)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.add(bm(new THREE.SphereGeometry(0.02, 4, 3), mat(iron), side * 0.22, 0.45 + i * 0.2, 0.37));
    }
  }

  // Arrow slit windows on keep walls (narrow vertical slits)
  const slitMat = mat(0x0a0a0a);
  const slitGeo = new THREE.BoxGeometry(0.04, 0.16, 0.04);
  // Front face slits
  for (const x of [-0.35, 0.35]) g.add(bm(slitGeo, slitMat, x, 1.05, 0.25));
  // Side face slits
  for (const y of [0.7, 1.1]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 0.16, 0.04), slitMat, 0.57, y, -0.15));
    g.add(bm(new THREE.BoxGeometry(0.04, 0.16, 0.04), slitMat, -0.57, y, -0.15));
  }

  // Tower spiral arrow slits (3 per tower, spiraling up)
  for (const side of [-1, 1]) {
    const tx = side * 0.72, tz = 0.5;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + (side > 0 ? 0 : Math.PI / 2);
      const r = 0.21;
      g.add(bm(new THREE.BoxGeometry(0.04, 0.1, 0.03), slitMat,
        tx + Math.cos(a) * r, 0.6 + i * 0.4, tz + Math.sin(a) * r));
    }
  }

  // ── PASS 4: WEAPON PASS — detailed weapon racks, training equipment ──

  // Weapon rack (left exterior wall) — wall-mounted with proper weapons
  g.add(bm(new THREE.BoxGeometry(0.04, 0.55, 0.45), mat(plank), -0.58, 0.58, -0.15)); // backboard
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.48), mat(darkPlank), -0.58, 0.82, -0.15)); // top rail
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.48), mat(darkPlank), -0.58, 0.55, -0.15)); // mid rail
  // Swords — blades with crossguards and pommels
  for (let i = 0; i < 3; i++) {
    const z = -0.32 + i * 0.17;
    g.add(bm(new THREE.BoxGeometry(0.025, 0.35, 0.02), mat(0x9aa8bb), -0.6, 0.62, z)); // blade
    g.add(bm(new THREE.BoxGeometry(0.025, 0.06, 0.02), mat(0x5a3a1a), -0.6, 0.42, z)); // grip
    g.add(bm(new THREE.BoxGeometry(0.06, 0.025, 0.02), mat(gold), -0.6, 0.46, z));       // crossguard
    g.add(bm(new THREE.SphereGeometry(0.015, 4, 3), mat(gold), -0.6, 0.39, z));          // pommel
  }

  // Shield rack (right exterior) — 2 shields leaning against wall
  for (let i = 0; i < 2; i++) {
    const z = 0.1 + i * 0.28;
    g.add(bmr(new THREE.BoxGeometry(0.2, 0.24, 0.04), mat(tc), 0.6, 0.45, z, 0, 0, 0.15));
    g.add(bmr(new THREE.BoxGeometry(0.03, 0.16, 0.03), mat(gold), 0.6, 0.45, z, 0, 0, 0.15)); // boss
    g.add(bmr(new THREE.SphereGeometry(0.025, 6, 4), mat(iron), 0.6, 0.45, z, 0, 0, 0.15)); // center boss
  }

  // Training dummy — detailed with head, body target, scoring marks
  const dummyX = -0.55, dummyZ = 0.62;
  g.add(bm(new THREE.BoxGeometry(0.06, 0.65, 0.06), mat(plank), dummyX, 0.6, dummyZ)); // post
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.12), mat(plank), dummyX, 0.35, dummyZ)); // base cross
  g.add(bm(new THREE.BoxGeometry(0.35, 0.04, 0.04), mat(plank), dummyX, 0.75, dummyZ)); // arms
  g.add(bm(new THREE.BoxGeometry(0.22, 0.22, 0.06), mat(0xc4a472), dummyX, 0.6, dummyZ)); // body target
  g.add(bm(new THREE.BoxGeometry(0.24, 0.03, 0.04), mat(0xaa3030), dummyX, 0.6, dummyZ + 0.04)); // scoring line
  g.add(bm(new THREE.SphereGeometry(0.065, 6, 4), mat(0xc4a472), dummyX, 0.88, dummyZ)); // head
  g.add(bm(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 4), mat(darkPlank), dummyX + 0.06, 0.88, dummyZ)); // peg "ear"

  // Spear stand — 3 spears in a triangular rack near towers
  for (let i = 0; i < 3; i++) {
    const sx = 0.35 + i * 0.06, sz = 0.62;
    g.add(bmr(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), mat(plank), sx, 0.62, sz, 0, 0, -0.08 + i * 0.08));
    g.add(bmr(new THREE.ConeGeometry(0.025, 0.08, 4), mat(iron), sx - 0.04 + i * 0.04, 1.0 + i * 0.02, sz, 0, 0, -0.08 + i * 0.08));
  }

  // ── PASS 5: BACK DETAIL — supply crates, siege gear, officer balcony ──

  // Supply crates (back of keep)
  g.add(bm(new THREE.BoxGeometry(0.2, 0.18, 0.2), mat(plank), -0.35, 0.37, -0.6));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.03, 0.22), mat(darkPlank), -0.35, 0.48, -0.6)); // lid
  g.add(bm(new THREE.BoxGeometry(0.18, 0.15, 0.18), mat(plank), -0.15, 0.36, -0.65));
  g.add(bm(new THREE.BoxGeometry(0.14, 0.2, 0.14), mat(darkPlank), -0.02, 0.38, -0.58)); // tall crate

  // Iron banding on crates
  g.add(bm(new THREE.BoxGeometry(0.22, 0.02, 0.02), mat(iron), -0.35, 0.4, -0.49));
  g.add(bm(new THREE.BoxGeometry(0.02, 0.15, 0.02), mat(iron), -0.24, 0.36, -0.49));

  // Barrel cluster (back-left)
  for (let i = 0; i < 2; i++) {
    g.add(bm(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 6), mat(0x6a4a2a), -0.6 + i * 0.18, 0.39, -0.58));
    g.add(bm(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 6), mat(iron), -0.6 + i * 0.18, 0.35, -0.58)); // band
    g.add(bm(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 6), mat(iron), -0.6 + i * 0.18, 0.44, -0.58)); // band
  }

  // Officer's quarters balcony (second floor overhang on left wing)
  g.add(bm(new THREE.BoxGeometry(0.6, 0.04, 0.2), mat(darkStone), -0.45, 1.04, 0.72)); // balcony slab
  // Balcony railing posts
  for (const x of [-0.68, -0.55, -0.42, -0.28]) {
    g.add(bm(new THREE.BoxGeometry(0.03, 0.15, 0.03), mat(stone), x, 1.12, 0.8));
  }
  g.add(bm(new THREE.BoxGeometry(0.45, 0.025, 0.03), mat(stone), -0.48, 1.19, 0.8)); // railing top
  // Officer window — warm glow
  g.add(bm(new THREE.BoxGeometry(0.12, 0.14, 0.04), glow(0xffaa44, 0.3), -0.45, 0.95, 0.63));

  // Back wall shield display — large heraldic shield
  g.add(bm(new THREE.BoxGeometry(0.28, 0.32, 0.04), mat(tc), 0, 1.2, -0.54));
  g.add(bm(new THREE.BoxGeometry(0.05, 0.24, 0.03), mat(gold), 0, 1.2, -0.52)); // vert bar
  g.add(bm(new THREE.BoxGeometry(0.2, 0.05, 0.03), mat(gold), 0, 1.22, -0.52)); // horiz bar
  g.add(bm(new THREE.SphereGeometry(0.025, 6, 4), mat(gold), 0, 1.2, -0.51)); // boss

  // ── PASS 6: MAGICAL/AURA — torch sconces, warm ambient glow ──

  // Torch sconces on gatehouse pilasters (flanking entrance)
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.03, 0.15, 0.03), mat(plank), side * 0.28, 1.0, 0.38)); // bracket
    g.add(bm(new THREE.ConeGeometry(0.025, 0.06, 5), glow(0xff6622, 0.7), side * 0.28, 1.1, 0.38)); // flame
    g.add(bm(new THREE.SphereGeometry(0.04, 6, 4), glow(0xffaa44, 0.15), side * 0.28, 1.12, 0.38)); // glow orb
  }

  // Command tower beacon light (top of back tower)
  g.add(bm(new THREE.SphereGeometry(0.04, 6, 4), glow(0xff8833, 0.5), 0.6, 3.28, -0.55));

  // Team color base ring (ground level identifier)
  g.add(bm(new THREE.BoxGeometry(1.7, 0.05, 1.7), mat(tc), 0, 0.29, 0));

  // Team banners — draped from keep battlements (front)
  g.add(bm(new THREE.BoxGeometry(0.18, 0.32, 0.03), mat(tc), -0.3, 1.45, 0.25));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.32, 0.03), mat(tc), 0.3, 1.45, 0.25));
  // Banner gold fringe
  g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.025), mat(gold), -0.3, 1.28, 0.25));
  g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.025), mat(gold), 0.3, 1.28, 0.25));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// MASONRY — Grand stoneworker's compound with kiln tower & workshop
// Design: Central round kiln/furnace tower with brick courses, attached
// rectangular cutting shed, stone block yard with neatly stacked product,
// raw quarry stone piles, stonecutter bench with tools, crane/hoist,
// water trough for cooling, decorative carved sample blocks, chimney smoke.
// 6-pass: silhouette → layering → ornamentation → tools → back detail → aura
// ========================================================================
export function buildMasonryMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'masonry', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const stucco = 0xd5cbb8; const stone = 0x9a9080; const block = 0xb8b0a0;
  const darkStone = 0x6a6a5a; const iron = 0x5a5550; const plank = 0x6a4a2a;
  const gold = 0xd4a44a;

  // ── PASS 1: SILHOUETTE — kiln tower, cutting shed, stone yard ──

  // Broad stone foundation — two tiers
  g.add(bm(new THREE.BoxGeometry(1.8, 0.06, 1.8), mat(0x5a5a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.7, 0.16, 1.7), mat(0x7f8c8d), 0, 0.11, 0));

  // Central kiln tower — round, wide base tapering up
  g.add(bm(new THREE.CylinderGeometry(0.5, 0.65, 1.5, 8), mat(stucco), 0, 0.94, -0.1));

  // Kiln dome top — rounded cap
  g.add(bm(new THREE.CylinderGeometry(0.35, 0.5, 0.3, 8), mat(stone), 0, 1.84, -0.1));
  g.add(bm(new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(darkStone), 0, 1.98, -0.1));

  // Cutting shed — rectangular, attached to front-right
  g.add(bm(new THREE.BoxGeometry(0.75, 0.8, 0.6), mat(stucco), 0.55, 0.6, 0.3));
  // Shed flat roof with slight slope
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.7), mat(darkStone));
  shedRoof.position.set(0.55, 1.05, 0.3); shedRoof.rotation.z = -0.08; g.add(shedRoof);

  // Tall chimney stack rising from kiln
  g.add(bm(new THREE.BoxGeometry(0.22, 1.2, 0.22), mat(stone), 0.3, 2.0, -0.35));
  g.add(bm(new THREE.BoxGeometry(0.28, 0.06, 0.28), mat(darkStone), 0.3, 2.63, -0.35)); // cap

  // ── PASS 2: LAYERING — brick courses, tower banding, shed detail ──

  // Kiln: stone band courses (5 rings spiraling up)
  const bandMat = mat(stone);
  for (const y of [0.35, 0.6, 0.85, 1.1, 1.35, 1.6]) {
    const r = 0.65 - (y - 0.35) * 0.1;
    g.add(bm(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.04, 8), bandMat, 0, y, -0.1));
  }

  // Kiln: brick texture — alternating offset blocks around base
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = 0.62;
    g.add(bm(new THREE.BoxGeometry(0.18, 0.1, 0.05), mat(i % 2 === 0 ? 0xc8b8a0 : 0xb0a088),
      Math.cos(angle) * r, 0.3, -0.1 + Math.sin(angle) * r));
  }

  // Shed: horizontal plank layering on walls
  for (const y of [0.35, 0.55, 0.75]) {
    g.add(bm(new THREE.BoxGeometry(0.77, 0.03, 0.04), mat(0xc0b098), 0.55, y, 0.61));
    g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.62), mat(0xc0b098), 0.93, y, 0.3));
  }

  // Shed: corner stone quoins
  for (const [cx, cz] of [[0.18, 0.6], [0.92, 0.6], [0.18, 0.0], [0.92, 0.0]]) {
    for (let i = 0; i < 3; i++) {
      g.add(bm(new THREE.BoxGeometry(0.08, 0.1, 0.08), mat(stone), cx, 0.28 + i * 0.22, cz));
    }
  }

  // Chimney: brick courses
  for (let i = 0; i < 5; i++) {
    const off = i % 2 === 0 ? 0.01 : -0.01;
    g.add(bm(new THREE.BoxGeometry(0.24, 0.04, 0.24), mat(i % 2 === 0 ? darkStone : 0x7a7a6a),
      0.3 + off, 1.5 + i * 0.22, -0.35));
  }

  // ── PASS 3: ORNAMENTATION — arched door, windows, carved keystones ──

  // Kiln front opening — arched furnace mouth with glow
  g.add(bm(new THREE.BoxGeometry(0.3, 0.45, 0.08), mat(0x1a1408), 0, 0.42, 0.55)); // dark opening
  const archGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8, 1, false, 0, Math.PI);
  g.add(bmr(archGeo, mat(stone), 0, 0.66, 0.57, Math.PI / 2, 0, 0)); // arch
  // Keystone — carved block at arch apex
  g.add(bm(new THREE.BoxGeometry(0.08, 0.1, 0.06), mat(gold), 0, 0.76, 0.57));

  // Shed door — plank with iron fittings
  g.add(bm(new THREE.BoxGeometry(0.28, 0.5, 0.05), mat(plank), 0.55, 0.44, 0.62));
  g.add(bm(new THREE.BoxGeometry(0.3, 0.03, 0.04), mat(iron), 0.55, 0.35, 0.64));
  g.add(bm(new THREE.BoxGeometry(0.3, 0.03, 0.04), mat(iron), 0.55, 0.55, 0.64));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat(gold), 0.65, 0.45, 0.66)); // handle

  // Shed windows — small with stone sills
  g.add(bm(new THREE.BoxGeometry(0.1, 0.1, 0.04), mat(0x667788), 0.93, 0.65, 0.2)); // side window
  g.add(bm(new THREE.BoxGeometry(0.14, 0.03, 0.06), mat(stone), 0.93, 0.59, 0.2)); // sill

  // Kiln side windows — arrow slit vents
  for (let i = 0; i < 3; i++) {
    const angle = Math.PI * 0.6 + i * 0.8;
    const r = 0.53;
    g.add(bm(new THREE.BoxGeometry(0.04, 0.14, 0.04), mat(0x0a0a0a),
      Math.cos(angle) * r, 0.9, -0.1 + Math.sin(angle) * r));
  }

  // Decorative carved sample block on display (front)
  g.add(bm(new THREE.BoxGeometry(0.15, 0.15, 0.15), mat(block), -0.45, 0.27, 0.65));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.12, 0.04), mat(gold), -0.45, 0.27, 0.73)); // carved motif

  // ── PASS 4: TOOL PASS — stonecutter bench, chisels, crane/hoist ──

  // Stonecutter bench — heavy slab on stone legs
  const benchX = 0.55, benchZ = 0.3;
  g.add(bm(new THREE.BoxGeometry(0.5, 0.06, 0.35), mat(stone), benchX, 0.38, benchZ + 0.35)); // bench top
  g.add(bm(new THREE.BoxGeometry(0.06, 0.15, 0.06), mat(darkStone), benchX - 0.2, 0.28, benchZ + 0.18)); // leg
  g.add(bm(new THREE.BoxGeometry(0.06, 0.15, 0.06), mat(darkStone), benchX + 0.2, 0.28, benchZ + 0.18)); // leg
  g.add(bm(new THREE.BoxGeometry(0.06, 0.15, 0.06), mat(darkStone), benchX - 0.2, 0.28, benchZ + 0.5)); // leg
  g.add(bm(new THREE.BoxGeometry(0.06, 0.15, 0.06), mat(darkStone), benchX + 0.2, 0.28, benchZ + 0.5)); // leg
  // Chisel (long metal spike)
  g.add(bm(new THREE.BoxGeometry(0.02, 0.02, 0.2), mat(0x8899aa), benchX - 0.1, 0.43, benchZ + 0.35));
  // Hammer — proper head + handle
  g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 0.15), mat(plank), benchX + 0.1, 0.43, benchZ + 0.38)); // handle
  g.add(bm(new THREE.BoxGeometry(0.08, 0.06, 0.04), mat(iron), benchX + 0.1, 0.44, benchZ + 0.28)); // head
  // Stone block being worked on bench
  g.add(bm(new THREE.BoxGeometry(0.12, 0.08, 0.12), mat(block), benchX, 0.45, benchZ + 0.35));

  // Crane/hoist — wooden A-frame with rope and pulley
  g.add(bm(new THREE.BoxGeometry(0.04, 0.9, 0.04), mat(plank), -0.7, 0.64, 0.15)); // main pole
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.55, 0.04), mat(plank), -0.7, 0.95, 0.15, 0, 0, 0.35)); // boom arm
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat(plank), -0.7, 0.85, 0.15, 0, 0, -0.35)); // brace
  // Pulley block
  g.add(bm(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), mat(iron), -0.52, 1.1, 0.15));
  // Rope dangling from boom
  g.add(bm(new THREE.BoxGeometry(0.015, 0.4, 0.015), mat(0xc9a96e), -0.52, 0.88, 0.15));
  // Stone block dangling from rope
  g.add(bm(new THREE.BoxGeometry(0.1, 0.08, 0.1), mat(block), -0.52, 0.66, 0.15));

  // ── PASS 5: BACK DETAIL — stone yard, raw quarry stone, water trough ──

  // Cut stone blocks — neatly stacked product (left side, 4 rows)
  const blkMat = mat(block);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < (4 - row); i++) {
      g.add(bm(new THREE.BoxGeometry(0.16, 0.12, 0.16), blkMat,
        -0.6 + i * 0.18, 0.25 + row * 0.13, 0.5));
    }
  }

  // Raw rough quarry stone (back, irregular shapes)
  g.add(bm(new THREE.BoxGeometry(0.28, 0.22, 0.22), mat(0x8a8878), -0.5, 0.3, -0.6));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.2, 0.25), mat(0x9a9888), -0.28, 0.29, -0.62));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.25, 0.2), mat(0x7a7868), -0.1, 0.31, -0.58));
  g.add(bm(new THREE.SphereGeometry(0.1, 5, 4), mat(0x8a8878), 0.08, 0.28, -0.6)); // boulder

  // Water cooling trough (right-back)
  g.add(bm(new THREE.BoxGeometry(0.35, 0.12, 0.18), mat(darkStone), 0.5, 0.25, -0.55)); // trough shell
  g.add(bm(new THREE.BoxGeometry(0.3, 0.06, 0.13), glow(0x4488aa, 0.12), 0.5, 0.27, -0.55)); // water

  // Back wall of kiln — exhaust vent
  g.add(bm(new THREE.BoxGeometry(0.18, 0.15, 0.06), mat(0x1a1408), 0, 0.7, -0.72)); // vent
  g.add(bm(new THREE.BoxGeometry(0.22, 0.03, 0.06), mat(iron), 0, 0.78, -0.72)); // vent cap

  // ── PASS 6: MAGICAL/AURA — kiln glow, chimney smoke, dust motes ──

  // Kiln furnace mouth glow
  g.add(bm(new THREE.BoxGeometry(0.22, 0.3, 0.04), glow(0xff5500, 0.6), 0, 0.42, 0.52));
  // Inner kiln glow visible through vents
  for (let i = 0; i < 3; i++) {
    const angle = Math.PI * 0.6 + i * 0.8;
    const r = 0.5;
    g.add(bm(new THREE.BoxGeometry(0.03, 0.08, 0.03), glow(0xff4400, 0.3),
      Math.cos(angle) * r, 0.9, -0.1 + Math.sin(angle) * r));
  }

  // Chimney smoke
  g.add(bm(new THREE.SphereGeometry(0.06, 5, 3), glow(0xaaaaaa, 0.15), 0.3, 2.75, -0.35));
  g.add(bm(new THREE.SphereGeometry(0.04, 5, 3), glow(0x999999, 0.1), 0.33, 2.88, -0.32));

  // Stone dust motes near cutting bench (faint)
  g.add(bm(new THREE.SphereGeometry(0.015, 4, 3), glow(0xcccccc, 0.08), 0.5, 0.55, 0.65));
  g.add(bm(new THREE.SphereGeometry(0.012, 4, 3), glow(0xcccccc, 0.06), 0.6, 0.6, 0.7));

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.65, 0.05, 1.65), mat(tc), 0, 0.2, 0));
  // Team banner on kiln front
  g.add(bm(new THREE.BoxGeometry(0.2, 0.28, 0.04), mat(tc), 0.22, 1.35, 0.48));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.02, 0.03), mat(gold), 0.22, 1.2, 0.48)); // fringe

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// FARMHOUSE — Sprawling pastoral barn compound
// Design: Main barn with distinctive gambrel roof, attached grain silo,
// windmill/weather vane, hay loft with visible bales, fenced animal pen,
// water well, pumpkin patch, tool shed lean-to, scarecrow, chicken coop,
// iron hardware throughout, warm lantern glow.
// 6-pass: silhouette → layering → ornamentation → tools → back detail → aura
// ========================================================================
export function buildFarmhouseMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'farmhouse', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const plaster = 0xe0d0a8; const barn = 0x8b3a2a; const darkBarn = 0x5a2a1a;
  const hay = 0xd4b45c; const plank = 0x7a5a3a; const darkPlank = 0x4a3018;
  const iron = 0x5a5550; const gold = 0xd4a44a; const stone = 0x8a8a7a;

  // ── PASS 1: SILHOUETTE — barn, silo, shed, fenced yard ──

  // Packed earth and stone foundation
  g.add(bm(new THREE.BoxGeometry(1.8, 0.06, 1.75), mat(0x5a5a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.7, 0.12, 1.65), mat(0x7f8c8d), 0, 0.09, 0));

  // Main barn — wide, tall, the centerpiece
  g.add(bm(new THREE.BoxGeometry(1.15, 1.0, 0.9), mat(plaster), 0, 0.65, 0));

  // Gambrel roof — proper 4-panel gambrel with overhang
  for (const side of [-1, 1]) {
    // Lower steep section
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.42), mat(barn));
    lower.position.set(side * 0.4, 1.25, 0); lower.rotation.z = -side * 0.65; g.add(lower);
    // Upper shallow section
    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.38), mat(barn));
    upper.position.set(side * 0.2, 1.52, 0); upper.rotation.z = -side * 0.22; g.add(upper);
    // Under-eaves soffit
    const soffit = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.03, 0.08), mat(darkBarn));
    soffit.position.set(side * 0.52, 1.08, 0); g.add(soffit);
  }
  // Ridge beam
  g.add(bm(new THREE.BoxGeometry(0.08, 0.06, 1.05), mat(darkBarn), 0, 1.6, 0));

  // Attached grain silo — tall cylinder on back-left
  g.add(bm(new THREE.CylinderGeometry(0.22, 0.26, 1.2, 8), mat(0xc8c0a8), -0.58, 0.78, -0.42));
  g.add(bm(new THREE.ConeGeometry(0.25, 0.35, 8), mat(0xb0a088), -0.58, 1.55, -0.42));
  // Silo: metal band rings
  for (const y of [0.4, 0.7, 1.0]) {
    g.add(bm(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), mat(iron), -0.58, y, -0.42));
  }
  // Silo: hatch door
  g.add(bm(new THREE.BoxGeometry(0.1, 0.14, 0.04), mat(plank), -0.58, 0.9, -0.2));

  // Tool shed lean-to (right side)
  g.add(bm(new THREE.BoxGeometry(0.45, 0.6, 0.5), mat(plank), 0.72, 0.45, -0.2));
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.6), mat(barn));
  shedRoof.position.set(0.72, 0.8, -0.2); shedRoof.rotation.z = 0.2; g.add(shedRoof);

  // ── PASS 2: LAYERING — plank walls, framing, structural depth ──

  // Barn: horizontal plank courses
  for (let i = 0; i < 5; i++) {
    g.add(bm(new THREE.BoxGeometry(1.17, 0.025, 0.03), mat(plank), 0, 0.22 + i * 0.18, 0.46));
    g.add(bm(new THREE.BoxGeometry(1.17, 0.025, 0.03), mat(plank), 0, 0.22 + i * 0.18, -0.46));
  }
  // Vertical trim boards at corners and center
  for (const x of [-0.58, 0, 0.58]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 1.0, 0.04), mat(darkPlank), x, 0.65, 0.47));
    if (x !== 0) g.add(bm(new THREE.BoxGeometry(0.04, 1.0, 0.04), mat(darkPlank), x, 0.65, -0.47));
  }
  // Side wall planks
  for (let i = 0; i < 5; i++) {
    g.add(bm(new THREE.BoxGeometry(0.03, 0.025, 0.92), mat(plank), 0.58, 0.22 + i * 0.18, 0));
    g.add(bm(new THREE.BoxGeometry(0.03, 0.025, 0.92), mat(plank), -0.58, 0.22 + i * 0.18, 0));
  }

  // Gable end trim (triangular face boards)
  for (const side of [-1, 1]) {
    g.add(bmr(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat(darkBarn), side * 0.2, 1.28, 0.46, 0, 0, -side * 0.55));
  }

  // Roof: shingle texture strips
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.12), mat(0x7a2a1a));
      strip.position.set(side * (0.3 + i * 0.08), 1.35 + i * 0.08, 0);
      strip.rotation.z = -side * 0.22;
      g.add(strip);
    }
  }

  // ── PASS 3: ORNAMENTATION — barn doors, windows, hardware, decor ──

  // Barn doors — large double doors with X-brace pattern
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.28, 0.65, 0.05), mat(darkPlank), side * 0.15, 0.48, 0.48));
    // X-brace on each door
    g.add(bmr(new THREE.BoxGeometry(0.03, 0.7, 0.03), mat(plank), side * 0.15, 0.48, 0.5, 0, 0, 0.4));
    g.add(bmr(new THREE.BoxGeometry(0.03, 0.7, 0.03), mat(plank), side * 0.15, 0.48, 0.5, 0, 0, -0.4));
  }
  // Center bar and iron strap hinges
  g.add(bm(new THREE.BoxGeometry(0.025, 0.67, 0.04), mat(iron), 0, 0.48, 0.5));
  for (const y of [0.3, 0.55, 0.72]) {
    g.add(bm(new THREE.BoxGeometry(0.24, 0.025, 0.03), mat(iron), -0.15, y, 0.51));
    g.add(bm(new THREE.BoxGeometry(0.24, 0.025, 0.03), mat(iron), 0.15, y, 0.51));
  }

  // Hay loft opening (upper gable, shows hay inside)
  g.add(bm(new THREE.BoxGeometry(0.22, 0.18, 0.04), mat(0x1a1408), 0, 1.05, 0.47)); // dark opening
  g.add(bm(new THREE.BoxGeometry(0.18, 0.12, 0.04), mat(hay), 0, 1.02, 0.46)); // visible hay
  // Loading beam with rope
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.18), mat(plank), 0, 1.16, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.015, 0.25, 0.015), mat(0xc9a96e), 0, 1.0, 0.64)); // rope

  // Windows — small paned with shutters on side walls
  for (const z of [-0.2, 0.2]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 0.1, 0.1), mat(0x667788), 0.59, 0.7, z)); // glass
    g.add(bm(new THREE.BoxGeometry(0.03, 0.12, 0.04), mat(darkPlank), 0.6, 0.7, z - 0.06)); // shutter L
    g.add(bm(new THREE.BoxGeometry(0.03, 0.12, 0.04), mat(darkPlank), 0.6, 0.7, z + 0.06)); // shutter R
  }

  // Weather vane / windmill on ridge
  g.add(bm(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4), mat(iron), 0, 1.78, 0.35));
  // Rooster shape (simplified)
  g.add(bm(new THREE.BoxGeometry(0.12, 0.06, 0.02), mat(gold), 0.04, 1.93, 0.35));
  g.add(bm(new THREE.BoxGeometry(0.03, 0.04, 0.02), mat(0xcc3333), 0.1, 1.97, 0.35)); // comb
  // Directional arms
  g.add(bm(new THREE.BoxGeometry(0.2, 0.015, 0.015), mat(iron), 0, 1.88, 0.35));
  g.add(bm(new THREE.BoxGeometry(0.015, 0.015, 0.2), mat(iron), 0, 1.88, 0.35));

  // ── PASS 4: TOOL PASS — pitchfork, hay bales, water well ──

  // Hay bales stacked (right-front)
  const hayMat = mat(hay);
  g.add(bm(new THREE.BoxGeometry(0.22, 0.18, 0.32), hayMat, 0.55, 0.24, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.18, 0.32), hayMat, 0.55, 0.42, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.18, 0.28), hayMat, 0.55, 0.24, 0.22));
  // Hay strands sticking out
  g.add(bmr(new THREE.BoxGeometry(0.02, 0.1, 0.02), hayMat, 0.64, 0.56, 0.6, 0.2, 0, 0.3));
  g.add(bmr(new THREE.BoxGeometry(0.02, 0.08, 0.02), hayMat, 0.6, 0.54, 0.38, -0.15, 0.2, 0));
  // Binding twine on bales
  g.add(bm(new THREE.BoxGeometry(0.24, 0.01, 0.02), mat(0xc9a96e), 0.55, 0.33, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.24, 0.01, 0.02), mat(0xc9a96e), 0.55, 0.33, 0.22));

  // Pitchfork leaning against barn wall
  g.add(bmr(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4), mat(plank), 0.4, 0.55, 0.52, 0, 0, 0.1));
  // Tines
  for (const dx of [-0.025, 0, 0.025]) {
    g.add(bmr(new THREE.BoxGeometry(0.01, 0.08, 0.01), mat(iron), 0.38 + dx, 0.85, 0.52, 0, 0, 0.1));
  }

  // Water well (front-left)
  const wellX = -0.6, wellZ = 0.55;
  g.add(bm(new THREE.CylinderGeometry(0.12, 0.14, 0.28, 8), mat(stone), wellX, 0.28, wellZ)); // stone rim
  g.add(bm(new THREE.CylinderGeometry(0.1, 0.12, 0.04, 8), mat(0x334455), wellX, 0.16, wellZ)); // dark water
  // A-frame with winch
  g.add(bm(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat(plank), wellX - 0.1, 0.52, wellZ));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat(plank), wellX + 0.1, 0.52, wellZ));
  g.add(bm(new THREE.BoxGeometry(0.24, 0.03, 0.04), mat(plank), wellX, 0.72, wellZ)); // crossbar
  g.add(bm(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), mat(plank), wellX, 0.7, wellZ)); // winch
  g.add(bm(new THREE.BoxGeometry(0.015, 0.15, 0.015), mat(0xc9a96e), wellX, 0.56, wellZ)); // rope
  // Bucket
  g.add(bm(new THREE.CylinderGeometry(0.025, 0.03, 0.04, 6), mat(plank), wellX, 0.5, wellZ));

  // ── PASS 5: BACK DETAIL — fenced pen, chicken coop, scarecrow ──

  // Fenced animal pen (back area)
  for (const [fx, fz] of [[-0.2, -0.62], [0.2, -0.62], [-0.2, -0.82], [0.2, -0.82]]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), mat(plank), fx, 0.3, fz));
  }
  // Horizontal rails
  g.add(bm(new THREE.BoxGeometry(0.42, 0.025, 0.03), mat(plank), 0, 0.35, -0.62));
  g.add(bm(new THREE.BoxGeometry(0.42, 0.025, 0.03), mat(plank), 0, 0.25, -0.62));
  g.add(bm(new THREE.BoxGeometry(0.42, 0.025, 0.03), mat(plank), 0, 0.35, -0.82));
  g.add(bm(new THREE.BoxGeometry(0.03, 0.025, 0.22), mat(plank), -0.2, 0.35, -0.72));
  g.add(bm(new THREE.BoxGeometry(0.03, 0.025, 0.22), mat(plank), 0.2, 0.35, -0.72));

  // Chicken coop — small A-frame box
  g.add(bm(new THREE.BoxGeometry(0.2, 0.12, 0.15), mat(plank), 0.52, 0.21, -0.6));
  g.add(bmr(new THREE.BoxGeometry(0.22, 0.04, 0.18), mat(barn), 0.52, 0.3, -0.6, 0, 0, 0.2));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.03), mat(0x1a1408), 0.52, 0.18, -0.52)); // entrance

  // Scarecrow (back-right of pen)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(plank), 0.45, 0.4, -0.72)); // post
  g.add(bm(new THREE.BoxGeometry(0.35, 0.04, 0.04), mat(plank), 0.45, 0.58, -0.72)); // arms
  g.add(bm(new THREE.SphereGeometry(0.05, 6, 4), mat(hay), 0.45, 0.68, -0.72)); // head
  g.add(bm(new THREE.BoxGeometry(0.12, 0.14, 0.06), mat(0x885533), 0.45, 0.5, -0.72)); // shirt
  g.add(bm(new THREE.ConeGeometry(0.06, 0.08, 6), mat(plank), 0.45, 0.76, -0.72)); // hat

  // Pumpkin patch (2 little spheres near fence)
  g.add(bm(new THREE.SphereGeometry(0.04, 6, 4), mat(0xdd7722), -0.05, 0.19, -0.72));
  g.add(bm(new THREE.SphereGeometry(0.035, 6, 4), mat(0xcc6611), 0.08, 0.19, -0.75));
  // Stems
  g.add(bm(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 4), mat(0x3a6a2a), -0.05, 0.24, -0.72));
  g.add(bm(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 4), mat(0x3a6a2a), 0.08, 0.23, -0.75));

  // ── PASS 6: MAGICAL/AURA — warm lantern glow, cozy light ──

  // Hanging lantern by barn door
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.1), mat(iron), -0.35, 0.85, 0.5)); // bracket arm
  g.add(bm(new THREE.BoxGeometry(0.06, 0.08, 0.06), mat(0x665533), -0.35, 0.78, 0.56)); // lantern
  g.add(bm(new THREE.BoxGeometry(0.03, 0.04, 0.03), glow(0xffaa33, 0.5), -0.35, 0.78, 0.56)); // flame

  // Warm window glow from shed
  g.add(bm(new THREE.BoxGeometry(0.04, 0.08, 0.08), glow(0xffcc66, 0.2), 0.95, 0.55, -0.2));

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.65, 0.05, 1.6), mat(tc), 0, 0.16, 0));
  // Team banner on barn front
  g.add(bm(new THREE.BoxGeometry(0.18, 0.26, 0.03), mat(tc), 0.42, 0.85, 0.48));
  g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.025), mat(gold), 0.42, 0.71, 0.48));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// WORKSHOP — Grand blacksmith forge and crafting compound
// Design: Open-front forge with massive stone hearth, detailed anvil on
// stump, bellows with leather panels, quench trough, tool wall with
// hammers/tongs/files, grinding wheel, coal bin, ingot molds, finished
// goods display, tall brick chimney with smoke, ember glow.
// 6-pass: silhouette → layering → ornamentation → tools → back detail → aura
// ========================================================================
export function buildWorkshopMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'workshop', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const stucco = 0xc0b098; const iron = 0x5a5550; const darkIron = 0x3a3530;
  const stone = 0x808080; const darkStone = 0x606060; const plank = 0x6a4a2a;
  const gold = 0xd4a44a; const brick = 0x8a5a3a;

  // ── PASS 1: SILHOUETTE — forge building, hearth, chimney ──

  // Scorched stone and iron foundation
  g.add(bm(new THREE.BoxGeometry(1.8, 0.06, 1.8), mat(0x4a4a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.72, 0.14, 1.72), mat(darkStone), 0, 0.1, 0));

  // Main building — L-shaped: forge hall + storage wing
  g.add(bm(new THREE.BoxGeometry(1.3, 1.2, 1.0), mat(stucco), 0, 0.78, -0.1));
  // Storage wing — lower, attached right
  g.add(bm(new THREE.BoxGeometry(0.5, 0.8, 0.55), mat(0xb0a080), 0.7, 0.58, 0.25));

  // Flat industrial roof with corrugated ridges
  g.add(bm(new THREE.BoxGeometry(1.45, 0.1, 1.15), mat(iron), 0, 1.43, -0.1));
  for (let z = -0.5; z <= 0.4; z += 0.2) {
    g.add(bm(new THREE.BoxGeometry(1.45, 0.04, 0.05), mat(darkIron), 0, 1.5, z));
  }
  // Storage wing roof
  const wingRoof = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.65), mat(iron));
  wingRoof.position.set(0.7, 1.02, 0.25); wingRoof.rotation.z = -0.12; g.add(wingRoof);

  // Massive stone hearth — the forge's heart (front center)
  g.add(bm(new THREE.BoxGeometry(0.6, 0.7, 0.45), mat(stone), 0, 0.53, 0.38));
  g.add(bm(new THREE.BoxGeometry(0.65, 0.06, 0.5), mat(darkStone), 0, 0.9, 0.38)); // mantle
  // Fire opening
  g.add(bm(new THREE.BoxGeometry(0.35, 0.35, 0.1), mat(0x1a0a00), 0, 0.38, 0.62)); // dark opening
  // Hearth hood — tapers into chimney
  g.add(bm(new THREE.BoxGeometry(0.55, 0.3, 0.4), mat(darkStone), 0, 1.1, 0.38));
  g.add(bm(new THREE.BoxGeometry(0.4, 0.2, 0.3), mat(darkStone), 0, 1.3, 0.35));

  // Tall brick chimney — massive stack
  for (let i = 0; i < 7; i++) {
    const sz = 0.26 - i * 0.01;
    g.add(bm(new THREE.BoxGeometry(sz, 0.22, sz), mat(i % 2 === 0 ? brick : 0x7a4a2a),
      0, 1.45 + i * 0.22, 0.32));
  }
  g.add(bm(new THREE.BoxGeometry(0.24, 0.06, 0.24), mat(iron), 0, 3.0, 0.32)); // cap

  // ── PASS 2: LAYERING — wall courses, soot stains, structural depth ──

  // Stone course lines on walls
  for (const y of [0.4, 0.7, 1.0, 1.3]) {
    g.add(bm(new THREE.BoxGeometry(1.32, 0.04, 0.04), mat(0xa89a82), 0, y, 0.41));
    g.add(bm(new THREE.BoxGeometry(1.32, 0.04, 0.04), mat(0xa89a82), 0, y, -0.6));
  }
  // Side wall detail
  g.add(bm(new THREE.BoxGeometry(0.04, 1.2, 1.02), mat(0xa89a82), 0.66, 0.78, -0.1));
  g.add(bm(new THREE.BoxGeometry(0.04, 1.2, 1.02), mat(0xa89a82), -0.66, 0.78, -0.1));

  // Soot staining near chimney (dark patches)
  g.add(bm(new THREE.BoxGeometry(0.5, 0.4, 0.04), mat(0x3a3028), 0, 1.15, 0.42));
  g.add(bm(new THREE.BoxGeometry(0.3, 0.3, 0.04), mat(0x4a4038), -0.1, 1.25, -0.61));

  // Hearth: brick layering on fire box
  for (let i = 0; i < 4; i++) {
    g.add(bm(new THREE.BoxGeometry(0.62, 0.04, 0.04), mat(brick), 0, 0.25 + i * 0.15, 0.61));
  }

  // ── PASS 3: ORNAMENTATION — iron hardware, signage, team identity ──

  // Front wide opening (no door — open-air forge front)
  g.add(bm(new THREE.BoxGeometry(0.06, 0.75, 0.04), mat(darkIron), -0.4, 0.55, 0.42)); // left post
  g.add(bm(new THREE.BoxGeometry(0.06, 0.75, 0.04), mat(darkIron), 0.4, 0.55, 0.42));  // right post
  g.add(bm(new THREE.BoxGeometry(0.86, 0.06, 0.04), mat(darkIron), 0, 0.96, 0.42));     // lintel

  // Iron-banded sign above entrance — "Workshop" (simplified as iron plate with gold emblem)
  g.add(bm(new THREE.BoxGeometry(0.4, 0.15, 0.04), mat(darkIron), 0, 1.05, 0.44));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.03), mat(gold), -0.1, 1.05, 0.46)); // hammer icon
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.03), mat(gold), 0.1, 1.05, 0.46)); // anvil icon

  // Iron hinges on storage door
  g.add(bm(new THREE.BoxGeometry(0.25, 0.5, 0.05), mat(0x2a1c10), 0.7, 0.43, 0.54)); // storage door
  for (const y of [0.3, 0.5, 0.65]) {
    g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.03), mat(iron), 0.7, y, 0.56));
  }
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat(gold), 0.78, 0.43, 0.57)); // handle

  // ── PASS 4: TOOL PASS — anvil, bellows, hammers, tongs, grinding wheel ──

  // Anvil on stump — detailed
  g.add(bm(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 6), mat(plank), -0.3, 0.28, 0.3)); // stump
  g.add(bm(new THREE.BoxGeometry(0.1, 0.18, 0.1), mat(0x454545), -0.3, 0.42, 0.3)); // waist
  g.add(bm(new THREE.BoxGeometry(0.22, 0.06, 0.14), mat(0x3a3a3a), -0.3, 0.54, 0.3)); // face
  g.add(bm(new THREE.BoxGeometry(0.06, 0.04, 0.18), mat(0x3a3a3a), -0.3, 0.57, 0.3)); // horn
  // Hardy hole
  g.add(bm(new THREE.BoxGeometry(0.03, 0.02, 0.03), mat(0x1a1a1a), -0.25, 0.58, 0.3));

  // Bellows — large leather with wooden handles
  g.add(bm(new THREE.BoxGeometry(0.25, 0.14, 0.35), mat(0x6a4a2a), 0.2, 0.28, 0.2)); // body
  g.add(bm(new THREE.BoxGeometry(0.27, 0.03, 0.37), mat(plank), 0.2, 0.36, 0.2)); // top plate
  g.add(bm(new THREE.BoxGeometry(0.27, 0.03, 0.37), mat(plank), 0.2, 0.2, 0.2));  // bottom plate
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat(plank), 0.2, 0.4, 0.02, 0.4, 0, 0)); // handle
  // Nozzle pointing at hearth
  g.add(bm(new THREE.CylinderGeometry(0.025, 0.04, 0.12, 6), mat(iron), 0.2, 0.28, 0.4));

  // Tool wall (left interior wall) — mounted tools
  g.add(bm(new THREE.BoxGeometry(0.04, 0.6, 0.5), mat(plank), -0.64, 0.6, -0.1)); // backboard
  g.add(bm(new THREE.BoxGeometry(0.04, 0.025, 0.52), mat(iron), -0.64, 0.85, -0.1)); // top rail
  g.add(bm(new THREE.BoxGeometry(0.04, 0.025, 0.52), mat(iron), -0.64, 0.55, -0.1)); // mid rail
  // Hammer 1
  g.add(bm(new THREE.BoxGeometry(0.03, 0.22, 0.03), mat(plank), -0.66, 0.68, -0.28)); // handle
  g.add(bm(new THREE.BoxGeometry(0.07, 0.05, 0.04), mat(iron), -0.66, 0.8, -0.28));   // head
  // Hammer 2 (heavier)
  g.add(bm(new THREE.BoxGeometry(0.03, 0.25, 0.03), mat(plank), -0.66, 0.66, -0.15));
  g.add(bm(new THREE.BoxGeometry(0.09, 0.06, 0.05), mat(darkIron), -0.66, 0.8, -0.15));
  // Tongs (long)
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.35, 0.025), mat(darkIron), -0.66, 0.65, 0.0, 0, 0, -0.05));
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.35, 0.025), mat(darkIron), -0.66, 0.65, 0.04, 0, 0, 0.05));
  // Files
  g.add(bm(new THREE.BoxGeometry(0.02, 0.2, 0.02), mat(0x8899aa), -0.66, 0.62, 0.15));
  g.add(bm(new THREE.BoxGeometry(0.02, 0.18, 0.02), mat(0x8899aa), -0.66, 0.62, 0.2));

  // Grinding wheel (right side, in storage area)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), mat(plank), 0.7, 0.33, -0.1)); // stand A
  g.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), mat(plank), 0.7, 0.33, -0.22)); // stand B
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.16), mat(plank), 0.7, 0.48, -0.16)); // axle mount
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12), mat(stone));
  wheel.position.set(0.7, 0.48, -0.16); wheel.rotation.x = Math.PI / 2; g.add(wheel);
  // Crank handle
  g.add(bm(new THREE.BoxGeometry(0.03, 0.06, 0.03), mat(iron), 0.72, 0.48, -0.05));

  // Water quench trough (front-left)
  g.add(bm(new THREE.BoxGeometry(0.35, 0.14, 0.2), mat(plank), -0.45, 0.24, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.3, 0.06, 0.15), glow(0x4488aa, 0.12), -0.45, 0.27, 0.55));
  // Steam wisp over trough
  g.add(bm(new THREE.SphereGeometry(0.03, 4, 3), glow(0xcccccc, 0.08), -0.45, 0.35, 0.55));

  // ── PASS 5: BACK DETAIL — coal bin, ingot storage, rope coil ──

  // Coal bin (back-left corner)
  g.add(bm(new THREE.BoxGeometry(0.3, 0.2, 0.25), mat(0x2a2a2a), -0.48, 0.27, -0.5));
  g.add(bm(new THREE.BoxGeometry(0.28, 0.06, 0.23), mat(0x1a1a1a), -0.48, 0.3, -0.5)); // coal top
  // Loose coal chunks
  g.add(bm(new THREE.BoxGeometry(0.06, 0.04, 0.06), mat(0x1a1a1a), -0.52, 0.22, -0.38));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.05), mat(0x222222), -0.38, 0.21, -0.42));

  // Ingot molds and cooling ingots (back center)
  g.add(bm(new THREE.BoxGeometry(0.25, 0.04, 0.18), mat(darkStone), 0, 0.2, -0.55)); // mold tray
  g.add(bm(new THREE.BoxGeometry(0.08, 0.03, 0.05), glow(0xdd5500, 0.35), -0.06, 0.23, -0.55)); // hot ingot
  g.add(bm(new THREE.BoxGeometry(0.08, 0.03, 0.05), mat(0x777777), 0.06, 0.23, -0.55)); // cooled ingot

  // Finished ingot stack
  for (let i = 0; i < 3; i++) {
    g.add(bm(new THREE.BoxGeometry(0.08, 0.03, 0.05), mat(0x888888), 0.35, 0.2 + i * 0.04, -0.55));
  }

  // Rope coil on wall
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 10), mat(0xc9a96e));
  coil.position.set(0.66, 0.65, -0.55); coil.rotation.y = Math.PI / 2; g.add(coil);

  // Barrel of quench oil
  g.add(bm(new THREE.CylinderGeometry(0.08, 0.09, 0.25, 6), mat(plank), 0.45, 0.3, -0.5));
  g.add(bm(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6), mat(iron), 0.45, 0.25, -0.5));
  g.add(bm(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6), mat(iron), 0.45, 0.38, -0.5));

  // ── PASS 6: MAGICAL/AURA — forge glow, chimney smoke, ember sparks ──

  // Forge fire glow (inside hearth opening)
  g.add(bm(new THREE.BoxGeometry(0.28, 0.25, 0.06), glow(0xff4400, 0.7), 0, 0.35, 0.6));
  g.add(bm(new THREE.SphereGeometry(0.08, 6, 4), glow(0xff6600, 0.4), 0, 0.45, 0.55)); // glow orb

  // Ember sparks rising (named for potential animation)
  for (let i = 0; i < 3; i++) {
    const spark = bm(new THREE.BoxGeometry(0.015, 0.015, 0.015), glow(0xff8833, 0.6),
      -0.05 + i * 0.05, 0.75 + i * 0.15, 0.45);
    spark.name = `workshop-ember-${i}`;
    g.add(spark);
  }

  // Chimney smoke
  g.add(bm(new THREE.SphereGeometry(0.06, 5, 3), glow(0x888888, 0.15), 0, 3.1, 0.32));
  g.add(bm(new THREE.SphereGeometry(0.045, 5, 3), glow(0x777777, 0.1), 0.04, 3.22, 0.35));

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.68, 0.05, 1.68), mat(tc), 0, 0.18, 0));
  // Team banner on front
  g.add(bm(new THREE.BoxGeometry(0.18, 0.28, 0.03), mat(tc), -0.55, 1.0, 0.43));
  g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.025), mat(gold), -0.55, 0.85, 0.43));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// SILO — Grand granary tower complex with storage annexe
// Design: Tall main grain tower (round, tapering) with attached smaller
// secondary silo, ground-level storehouse, loading crane with pulley
// system, detailed ladder, grain sacks, weighing scale, granary cat
// (vermin control!), dove roost at top, iron banding, team banners.
// 6-pass: silhouette → layering → ornamentation → tools → back detail → aura
// ========================================================================
export function buildSiloMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'silo', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const stucco = 0xe0d8c8; const band = 0xb8b0a0; const plank = 0x7a5a3a;
  const darkPlank = 0x4a3018; const iron = 0x5a5550; const gold = 0xd4a44a;
  const stone = 0x8a8a7a;

  // ── PASS 1: SILHOUETTE — main tower, secondary silo, storehouse ──

  // Stone foundation — octagonal feel
  g.add(bm(new THREE.BoxGeometry(1.65, 0.06, 1.65), mat(0x5a5a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.55, 0.12, 1.55), mat(0x7f8c8d), 0, 0.09, 0));

  // Main grain tower — tall, slight taper
  g.add(bm(new THREE.CylinderGeometry(0.38, 0.5, 2.3, 8), mat(stucco), 0, 1.3, 0));

  // Secondary smaller silo — attached left
  g.add(bm(new THREE.CylinderGeometry(0.22, 0.28, 1.4, 8), mat(0xd8d0b8), -0.55, 0.88, 0.1));
  g.add(bm(new THREE.ConeGeometry(0.25, 0.3, 8), mat(0xc0a878), -0.55, 1.73, 0.1));

  // Ground-level storehouse — rectangular, front-right
  g.add(bm(new THREE.BoxGeometry(0.6, 0.55, 0.5), mat(stucco), 0.55, 0.42, 0.35));
  // Storehouse peaked roof
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.3), mat(0xb0a088));
    roof.position.set(0.55, 0.75, 0.35); roof.rotation.z = -side * 0.35; g.add(roof);
  }
  g.add(bm(new THREE.BoxGeometry(0.05, 0.05, 0.55), mat(darkPlank), 0.55, 0.82, 0.35)); // ridge

  // Main tower conical cap — layered
  g.add(bm(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 8), mat(band), 0, 2.5, 0)); // eaves ring
  g.add(bm(new THREE.ConeGeometry(0.45, 0.7, 8), mat(0xc0a878), 0, 2.89, 0));
  // Second cone layer (slightly smaller, different shade)
  g.add(bm(new THREE.ConeGeometry(0.35, 0.5, 8), mat(0xb09868), 0, 2.95, 0));

  // ── PASS 2: LAYERING — metal bands, stone courses, structural rings ──

  // Main tower: iron band rings (6 levels)
  const bandMat = mat(band);
  for (let i = 0; i < 6; i++) {
    const y = 0.4 + i * 0.35;
    const r = 0.5 - i * 0.018;
    g.add(bm(new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.04, 8), bandMat, 0, y, 0));
  }

  // Main tower: rivet dots on bands (4 per band at front)
  for (let i = 0; i < 4; i++) {
    const y = 0.4 + i * 0.7; // every other band
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2;
      const r = 0.5 - (i * 0.7 / 2.3) * 0.05 + 0.04;
      g.add(bm(new THREE.SphereGeometry(0.012, 4, 3), mat(iron),
        Math.cos(a) * r, y, Math.sin(a) * r));
    }
  }

  // Secondary silo: bands
  for (const y of [0.4, 0.7, 1.0, 1.3]) {
    g.add(bm(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 8), bandMat, -0.55, y, 0.1));
  }

  // Storehouse: plank lines
  for (const y of [0.25, 0.45, 0.6]) {
    g.add(bm(new THREE.BoxGeometry(0.62, 0.02, 0.03), mat(plank), 0.55, y, 0.61));
  }

  // ── PASS 3: ORNAMENTATION — finials, ventilation, doors, windows ──

  // Gold finial with weather vane at peak
  g.add(bm(new THREE.SphereGeometry(0.04, 6, 4), mat(gold), 0, 3.28, 0));
  g.add(bm(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 4), mat(iron), 0, 3.38, 0));
  g.add(bm(new THREE.BoxGeometry(0.12, 0.04, 0.02), mat(gold), 0.04, 3.42, 0)); // vane arrow

  // Secondary silo: small gold finial
  g.add(bm(new THREE.SphereGeometry(0.025, 4, 3), mat(gold), -0.55, 1.92, 0.1));

  // Grain loading hatch — upper front
  g.add(bm(new THREE.BoxGeometry(0.16, 0.2, 0.06), mat(darkPlank), 0, 1.85, 0.4));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.03, 0.04), mat(iron), 0, 1.95, 0.42)); // hatch lintel
  // Shuttered lower window
  g.add(bm(new THREE.BoxGeometry(0.12, 0.1, 0.04), mat(0x667788), 0, 1.2, 0.44));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.12, 0.03), mat(plank), -0.06, 1.2, 0.46));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.12, 0.03), mat(plank), 0.06, 1.2, 0.46));

  // Arrow slit vent windows (spiral up tower)
  const slitMat = mat(0x0a0a0a);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.6;
    const r = 0.46 - i * 0.015;
    g.add(bm(new THREE.BoxGeometry(0.04, 0.14, 0.035), slitMat,
      Math.cos(angle) * r, 0.6 + i * 0.35, Math.sin(angle) * r));
  }

  // Storehouse door
  g.add(bm(new THREE.BoxGeometry(0.22, 0.35, 0.05), mat(darkPlank), 0.55, 0.32, 0.61));
  g.add(bm(new THREE.BoxGeometry(0.24, 0.03, 0.04), mat(iron), 0.55, 0.28, 0.63));
  g.add(bm(new THREE.BoxGeometry(0.24, 0.03, 0.04), mat(iron), 0.55, 0.42, 0.63));

  // Dove roost holes near top (white circles)
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 1.0;
    const r = 0.4;
    g.add(bm(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6), mat(0x1a1a1a),
      Math.cos(angle) * r, 2.2, Math.sin(angle) * r));
  }

  // ── PASS 4: TOOL PASS — crane, ladder, grain sacks, weighing scale ──

  // Loading crane — A-frame with pulley and rope
  g.add(bm(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat(plank), 0.12, 2.2, 0.48)); // crane post
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat(plank), 0.12, 2.4, 0.52, 0.55, 0, 0)); // boom
  g.add(bmr(new THREE.BoxGeometry(0.04, 0.35, 0.04), mat(plank), 0.12, 2.3, 0.45, -0.3, 0, 0)); // brace
  // Pulley
  g.add(bm(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 6), mat(iron), 0.22, 2.5, 0.68));
  // Rope + hook
  g.add(bm(new THREE.BoxGeometry(0.015, 0.5, 0.015), mat(0xc9a96e), 0.22, 2.2, 0.68));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.02), mat(iron), 0.22, 1.95, 0.68)); // hook

  // Detailed ladder — rails with rungs
  const railMat = mat(plank);
  g.add(bm(new THREE.BoxGeometry(0.03, 2.0, 0.03), railMat, -0.14, 1.2, 0.48));
  g.add(bm(new THREE.BoxGeometry(0.03, 2.0, 0.03), railMat, 0.14, 1.2, 0.48));
  for (let i = 0; i < 9; i++) {
    g.add(bm(new THREE.BoxGeometry(0.26, 0.025, 0.03), railMat, 0, 0.3 + i * 0.22, 0.48));
  }
  // Ladder: iron brackets attaching to tower
  for (const y of [0.6, 1.2, 1.8]) {
    g.add(bm(new THREE.BoxGeometry(0.06, 0.03, 0.06), mat(iron), 0, y, 0.46));
  }

  // Grain sacks — scattered at base (various sizes)
  const sackMat = mat(0xc4b080);
  g.add(bm(new THREE.BoxGeometry(0.18, 0.22, 0.15), sackMat, 0.4, 0.26, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.15, 0.2, 0.15), sackMat, 0.3, 0.25, 0.62));
  g.add(bmr(new THREE.BoxGeometry(0.16, 0.2, 0.14), sackMat, 0.5, 0.25, 0.6, 0, 0.3, 0.1));
  // Open sack with grain visible
  g.add(bm(new THREE.BoxGeometry(0.14, 0.18, 0.12), sackMat, 0.35, 0.24, 0.45));
  g.add(bm(new THREE.BoxGeometry(0.1, 0.04, 0.08), mat(0xd4c080), 0.35, 0.34, 0.45)); // grain top

  // Weighing scale (front-left)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.3, 0.04), mat(iron), -0.4, 0.3, 0.55)); // post
  g.add(bm(new THREE.BoxGeometry(0.25, 0.02, 0.04), mat(iron), -0.4, 0.45, 0.55)); // beam
  // Hanging pans
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.015, 0.08, 0.015), mat(0xc9a96e), -0.4 + side * 0.1, 0.4, 0.55));
    g.add(bm(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 6), mat(iron), -0.4 + side * 0.1, 0.36, 0.55));
  }

  // ── PASS 5: BACK DETAIL — overflow bins, cat, barrel storage ──

  // Overflow grain bins (back)
  g.add(bm(new THREE.BoxGeometry(0.3, 0.2, 0.25), mat(plank), 0.2, 0.25, -0.55));
  g.add(bm(new THREE.BoxGeometry(0.32, 0.03, 0.27), mat(darkPlank), 0.2, 0.36, -0.55)); // lid
  g.add(bm(new THREE.BoxGeometry(0.25, 0.18, 0.2), mat(plank), -0.1, 0.24, -0.6));

  // Barrels (back-right)
  for (let i = 0; i < 2; i++) {
    g.add(bm(new THREE.CylinderGeometry(0.08, 0.09, 0.25, 6), mat(0x6a4a2a), 0.5 + i * 0.18, 0.27, -0.5));
    g.add(bm(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6), mat(iron), 0.5 + i * 0.18, 0.22, -0.5));
    g.add(bm(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6), mat(iron), 0.5 + i * 0.18, 0.35, -0.5));
  }

  // Granary cat (vermin control — tiny sitting cat shape!)
  const catX = -0.35, catZ = -0.5;
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.08), mat(0x4a3a2a), catX, 0.2, catZ)); // body
  g.add(bm(new THREE.SphereGeometry(0.03, 4, 3), mat(0x4a3a2a), catX, 0.26, catZ + 0.05)); // head
  g.add(bm(new THREE.BoxGeometry(0.015, 0.025, 0.01), mat(0x4a3a2a), catX - 0.015, 0.29, catZ + 0.06)); // ear L
  g.add(bm(new THREE.BoxGeometry(0.015, 0.025, 0.01), mat(0x4a3a2a), catX + 0.015, 0.29, catZ + 0.06)); // ear R
  g.add(bm(new THREE.BoxGeometry(0.015, 0.015, 0.08), mat(0x4a3a2a), catX, 0.19, catZ - 0.06)); // tail

  // ── PASS 6: MAGICAL/AURA — warm interior glow, doves ──

  // Warm glow from grain hatch (interior lit)
  g.add(bm(new THREE.BoxGeometry(0.1, 0.12, 0.04), glow(0xffcc66, 0.2), 0, 1.85, 0.38));

  // Dove on roost (tiny white bird shape)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.025, 0.06), mat(0xeeeeee), 0.15, 2.38, 0.35)); // body
  g.add(bm(new THREE.SphereGeometry(0.015, 4, 3), mat(0xeeeeee), 0.15, 2.4, 0.38)); // head

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.5, 0.05, 1.5), mat(tc), 0, 0.16, 0));
  // Team banner draped from storehouse
  g.add(bm(new THREE.BoxGeometry(0.16, 0.25, 0.03), mat(tc), 0.55, 0.6, 0.63));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.02, 0.025), mat(gold), 0.55, 0.46, 0.63));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// SMELTER — Industrial blast furnace complex
// Design: Massive central furnace with stepped stone dome, twin chimney
// stacks belching smoke, ore processing yard with cart on rails, crucible
// pouring station with glowing molten channel, ingot cooling racks,
// bellows system, coal bunker, slag heap, tongs and molds, intense
// orange glow from furnace openings.
// 6-pass: silhouette → layering → ornamentation → tools → back detail → aura
// ========================================================================
export function buildSmelterMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'smelter', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const grayStone = 0x808080; const darkStone = 0x505050; const midStone = 0x686868;
  const brick = 0x8a5a3a; const darkBrick = 0x6a3a1a; const iron = 0x5a5550;
  const plank = 0x6a4a2a; const gold = 0xd4a44a;

  // ── PASS 1: SILHOUETTE — furnace, chimneys, processing shed ──

  // Scorched and darkened stone foundation
  g.add(bm(new THREE.BoxGeometry(1.8, 0.06, 1.8), mat(0x3a3a3a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.7, 0.14, 1.7), mat(0x4a4a4a), 0, 0.1, 0));

  // Main blast furnace — stepped dome, the dominant structure
  g.add(bm(new THREE.BoxGeometry(0.95, 0.75, 0.95), mat(grayStone), 0, 0.55, 0));
  g.add(bm(new THREE.BoxGeometry(0.8, 0.25, 0.8), mat(midStone), 0, 1.05, 0));
  g.add(bm(new THREE.BoxGeometry(0.6, 0.2, 0.6), mat(darkStone), 0, 1.25, 0));
  g.add(bm(new THREE.BoxGeometry(0.4, 0.15, 0.4), mat(midStone), 0, 1.42, 0));

  // Twin chimney stacks (flanking the furnace top)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const sz = 0.2 - i * 0.008;
      g.add(bm(new THREE.BoxGeometry(sz, 0.2, sz), mat(i % 2 === 0 ? brick : darkBrick),
        side * 0.35, 1.45 + i * 0.2, side * 0.15));
    }
    g.add(bm(new THREE.BoxGeometry(0.22, 0.05, 0.22), mat(iron), side * 0.35, 2.88, side * 0.15)); // cap
  }

  // Processing shed — open-front lean-to on right
  g.add(bm(new THREE.BoxGeometry(0.55, 0.65, 0.55), mat(midStone), 0.65, 0.5, 0.25));
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.05, 0.65), mat(iron));
  shedRoof.position.set(0.65, 0.87, 0.25); shedRoof.rotation.z = -0.1; g.add(shedRoof);

  // ── PASS 2: LAYERING — brick courses, heat staining, structural depth ──

  // Furnace: alternating brick course layers
  for (const y of [0.3, 0.5, 0.7, 0.9]) {
    g.add(bm(new THREE.BoxGeometry(0.97, 0.04, 0.97), mat(y < 0.6 ? darkBrick : 0x707070), 0, y, 0));
  }

  // Heat discoloration — darker/reddish staining near openings
  g.add(bm(new THREE.BoxGeometry(0.5, 0.4, 0.04), mat(0x4a2a1a), 0, 0.55, 0.48));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.35, 0.4), mat(0x4a2a1a), 0.48, 0.55, 0));

  // Chimney: alternating courses with soot staining
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.22, 0.15, 0.04), mat(0x2a2a2a), side * 0.35, 2.2, side * 0.15 + 0.1));
  }

  // Foundation buttresses — heavy stone supports
  for (const [bx, bz] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
    g.add(bm(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat(darkStone), bx, 0.42, bz));
    g.add(bm(new THREE.BoxGeometry(0.15, 0.06, 0.15), mat(grayStone), bx, 0.18, bz)); // base cap
  }

  // ── PASS 3: ORNAMENTATION — furnace mouths, iron hardware ──

  // Main furnace mouth — front (large arched opening)
  g.add(bm(new THREE.BoxGeometry(0.35, 0.35, 0.1), mat(0x0a0500), 0, 0.4, 0.48)); // dark opening
  const archGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 8, 1, false, 0, Math.PI);
  g.add(bmr(archGeo, mat(brick), 0, 0.58, 0.49, Math.PI / 2, 0, 0));
  // Side furnace window
  g.add(bm(new THREE.BoxGeometry(0.1, 0.2, 0.2), mat(0x0a0500), 0.48, 0.45, 0));

  // Iron door frame on furnace mouth
  g.add(bm(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat(iron), -0.18, 0.42, 0.5));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat(iron), 0.18, 0.42, 0.5));
  g.add(bm(new THREE.BoxGeometry(0.4, 0.04, 0.04), mat(iron), 0, 0.64, 0.5));

  // Iron plate signage over furnace
  g.add(bm(new THREE.BoxGeometry(0.3, 0.1, 0.04), mat(iron), 0, 0.78, 0.49));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.03), mat(gold), 0, 0.78, 0.51)); // flame emblem

  // Processing shed door
  g.add(bm(new THREE.BoxGeometry(0.2, 0.4, 0.04), mat(0x2a1c10), 0.65, 0.35, 0.53));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.025, 0.03), mat(iron), 0.65, 0.3, 0.55));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.025, 0.03), mat(iron), 0.65, 0.48, 0.55));

  // ── PASS 4: TOOL PASS — ore cart on rails, tongs, molds, bellows ──

  // Ore cart on rails (front-right)
  // Rails
  g.add(bm(new THREE.BoxGeometry(0.6, 0.02, 0.03), mat(iron), 0.55, 0.17, 0.56));
  g.add(bm(new THREE.BoxGeometry(0.6, 0.02, 0.03), mat(iron), 0.55, 0.17, 0.68));
  // Rail ties
  for (let i = 0; i < 4; i++) {
    g.add(bm(new THREE.BoxGeometry(0.04, 0.02, 0.15), mat(plank), 0.35 + i * 0.15, 0.16, 0.62));
  }
  // Cart body
  g.add(bm(new THREE.BoxGeometry(0.25, 0.12, 0.14), mat(0x5a4a3a), 0.5, 0.24, 0.62));
  g.add(bm(new THREE.BoxGeometry(0.27, 0.03, 0.16), mat(0x4a3a2a), 0.5, 0.3, 0.62)); // rim
  // Wheels (4 small)
  for (const [wx, wz] of [[0.38, 0.56], [0.38, 0.68], [0.62, 0.56], [0.62, 0.68]]) {
    g.add(bm(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6), mat(0x3a3a3a), wx, 0.18, wz));
  }
  // Ore chunks in cart
  g.add(bm(new THREE.BoxGeometry(0.07, 0.05, 0.06), mat(0x8a7a6a), 0.46, 0.34, 0.6));
  g.add(bm(new THREE.BoxGeometry(0.06, 0.05, 0.06), mat(0x9a6a4a), 0.54, 0.33, 0.64));
  g.add(bm(new THREE.BoxGeometry(0.05, 0.04, 0.05), mat(0x7a6a5a), 0.5, 0.35, 0.62));

  // Crucible pouring station (left side)
  g.add(bm(new THREE.BoxGeometry(0.15, 0.2, 0.15), mat(darkStone), -0.55, 0.27, 0.4)); // stand
  g.add(bm(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 6), mat(brick), -0.55, 0.4, 0.4)); // crucible
  // Molten channel — glowing groove from crucible to molds
  g.add(bm(new THREE.BoxGeometry(0.04, 0.02, 0.35), glow(0xff4400, 0.5), -0.55, 0.19, 0.2));
  // Ingot molds along channel
  for (let i = 0; i < 3; i++) {
    g.add(bm(new THREE.BoxGeometry(0.1, 0.03, 0.06), mat(darkStone), -0.55, 0.2, 0.1 - i * 0.12));
    if (i < 2) g.add(bm(new THREE.BoxGeometry(0.08, 0.02, 0.04), glow(0xdd5500, 0.3 - i * 0.1), -0.55, 0.22, 0.1 - i * 0.12));
  }

  // Tongs (near furnace)
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.35, 0.025), mat(iron), -0.25, 0.38, 0.52, 0, 0, 0.15));
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.35, 0.025), mat(iron), -0.22, 0.38, 0.52, 0, 0, 0.18));

  // Bellows system (back side of furnace)
  g.add(bm(new THREE.BoxGeometry(0.3, 0.18, 0.35), mat(0x6a4a2a), 0, 0.26, -0.58));
  g.add(bm(new THREE.BoxGeometry(0.32, 0.04, 0.37), mat(plank), 0, 0.36, -0.58));
  g.add(bm(new THREE.BoxGeometry(0.32, 0.04, 0.37), mat(plank), 0, 0.16, -0.58));
  g.add(bm(new THREE.CylinderGeometry(0.03, 0.05, 0.15, 6), mat(iron), 0, 0.26, -0.38)); // nozzle

  // ── PASS 5: BACK DETAIL — coal bunker, slag heap, ingot racks ──

  // Coal bunker (back-left)
  g.add(bm(new THREE.BoxGeometry(0.35, 0.25, 0.3), mat(0x2a2a2a), -0.55, 0.27, -0.45));
  g.add(bm(new THREE.BoxGeometry(0.3, 0.06, 0.25), mat(0x1a1a1a), -0.55, 0.34, -0.45)); // coal surface
  // Scattered coal
  g.add(bm(new THREE.BoxGeometry(0.05, 0.03, 0.05), mat(0x1a1a1a), -0.42, 0.19, -0.3));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.04), mat(0x222222), -0.65, 0.19, -0.35));

  // Slag heap (back-right — waste pile)
  g.add(bm(new THREE.BoxGeometry(0.25, 0.12, 0.2), mat(0x5a5050), 0.55, 0.2, -0.55));
  g.add(bm(new THREE.SphereGeometry(0.08, 5, 3), mat(0x6a5a50), 0.48, 0.22, -0.5));
  g.add(bm(new THREE.BoxGeometry(0.15, 0.08, 0.12), mat(0x5a4a40), 0.62, 0.19, -0.5));

  // Finished ingot cooling racks (stacked neatly in shed)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      g.add(bm(new THREE.BoxGeometry(0.08, 0.03, 0.05), mat(0x888888),
        0.58 + col * 0.12, 0.2 + row * 0.04, 0.15));
    }
  }
  // One hot ingot still glowing
  g.add(bm(new THREE.BoxGeometry(0.08, 0.03, 0.05), glow(0xcc4400, 0.25), 0.7, 0.2, 0.0));

  // ── PASS 6: MAGICAL/AURA — furnace glow, smoke, heat shimmer ──

  // Furnace mouth intense glow
  g.add(bm(new THREE.BoxGeometry(0.28, 0.28, 0.06), glow(0xff5500, 0.8), 0, 0.4, 0.46));
  g.add(bm(new THREE.SphereGeometry(0.1, 6, 4), glow(0xff6600, 0.4), 0, 0.5, 0.35)); // glow orb

  // Side window glow
  g.add(bm(new THREE.BoxGeometry(0.06, 0.15, 0.15), glow(0xff6600, 0.6), 0.46, 0.45, 0));

  // Crucible top glow
  g.add(bm(new THREE.SphereGeometry(0.05, 6, 4), glow(0xff4400, 0.5), -0.55, 0.48, 0.4));

  // Twin chimney smoke
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.SphereGeometry(0.06, 5, 3), glow(0x888888, 0.15), side * 0.35, 3.0, side * 0.15));
    g.add(bm(new THREE.SphereGeometry(0.04, 5, 3), glow(0x777777, 0.1), side * 0.35 + 0.03, 3.12, side * 0.15));
  }

  // Heat shimmer motes (named for animation)
  for (let i = 0; i < 3; i++) {
    const mote = bm(new THREE.BoxGeometry(0.01, 0.01, 0.01), glow(0xff8833, 0.4),
      -0.1 + i * 0.1, 0.85 + i * 0.2, 0.3);
    mote.name = `smelter-heat-${i}`;
    g.add(mote);
  }

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.65, 0.05, 1.65), mat(tc), 0, 0.18, 0));
  // Team banner
  g.add(bm(new THREE.BoxGeometry(0.16, 0.24, 0.03), mat(tc), 0.4, 0.7, 0.49));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.02, 0.025), mat(gold), 0.4, 0.57, 0.49));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// ARMORY — Fortified military stockade & equipment vault
// Design: Squat, heavy, iron-banded stone vault with reinforced door,
// exterior weapon racks with varied weapons (swords, halberds, axes),
// shield wall display, armor mannequin stands, repair anvil, whetstone
// wheel, ammunition crates, catapult bolt bundles, back-wall trophy
// display, watchman's post on roof, team heraldry.
// 6-pass: silhouette → layering → ornamentation → weapons → back detail → aura
// ========================================================================
export function buildArmoryMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'armory', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const darkStone = 0x606060; const midStone = 0x808080; const lightStone = 0x909090;
  const iron = 0x5a5550; const darkIron = 0x3a3530; const plank = 0x6a4a2a;
  const darkPlank = 0x4a3018; const gold = 0xd4a44a;

  // ── PASS 1: SILHOUETTE — main vault, corner buttresses, watchpost ──

  // Heavy reinforced foundation — double-tier
  g.add(bm(new THREE.BoxGeometry(1.8, 0.06, 1.8), mat(0x4a4a4a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.72, 0.16, 1.72), mat(0x5f5f5f), 0, 0.11, 0));

  // Main vault — squat, wide, imposing
  g.add(bm(new THREE.BoxGeometry(1.15, 0.85, 1.05), mat(darkStone), 0, 0.62, 0));

  // Corner buttresses — massive reinforcing pillars (4 corners)
  for (const [bx, bz] of [[0.58, 0.53], [-0.58, 0.53], [0.58, -0.53], [-0.58, -0.53]]) {
    g.add(bm(new THREE.BoxGeometry(0.14, 0.85, 0.14), mat(midStone), bx, 0.62, bz));
    g.add(bm(new THREE.BoxGeometry(0.17, 0.06, 0.17), mat(darkStone), bx, 0.2, bz)); // base cap
    g.add(bm(new THREE.BoxGeometry(0.16, 0.04, 0.16), mat(lightStone), bx, 1.07, bz)); // top cap
  }

  // Armored roof — two slopes with iron ridge
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.15), mat(iron));
    roof.position.set(side * 0.22, 1.18, 0); roof.rotation.z = -side * 0.28; g.add(roof);
    // Under-eaves detail
    const eave = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.03, 1.12), mat(darkIron));
    eave.position.set(side * 0.35, 1.08, 0); g.add(eave);
  }
  g.add(bm(new THREE.BoxGeometry(0.08, 0.06, 1.15), mat(iron), 0, 1.32, 0)); // iron ridge

  // Watchman's post — small raised platform on roof right
  g.add(bm(new THREE.BoxGeometry(0.3, 0.04, 0.3), mat(midStone), 0.35, 1.22, -0.25)); // platform
  g.add(bm(new THREE.BoxGeometry(0.04, 0.25, 0.04), mat(plank), 0.35, 1.35, -0.25)); // post
  g.add(bm(new THREE.BoxGeometry(0.2, 0.02, 0.2), mat(plank), 0.35, 1.48, -0.25)); // shade
  // Post flag
  g.add(bm(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 4), mat(gold), 0.35, 1.58, -0.25));
  g.add(bm(new THREE.BoxGeometry(0.14, 0.08, 0.015), mat(tc), 0.43, 1.62, -0.25));

  // ── PASS 2: LAYERING — iron bands, stone courses, reinforcement ──

  // Horizontal iron banding — heavy straps all around
  for (const y of [0.3, 0.55, 0.8]) {
    g.add(bm(new THREE.BoxGeometry(1.17, 0.03, 0.03), mat(iron), 0, y, 0.53));
    g.add(bm(new THREE.BoxGeometry(1.17, 0.03, 0.03), mat(iron), 0, y, -0.53));
    g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 1.07), mat(iron), 0.58, y, 0));
    g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 1.07), mat(iron), -0.58, y, 0));
  }

  // Vertical iron straps (reinforcing like vault door)
  for (const x of [-0.35, 0, 0.35]) {
    g.add(bm(new THREE.BoxGeometry(0.025, 0.85, 0.03), mat(darkIron), x, 0.62, 0.54));
  }

  // Stone course lines
  for (const y of [0.38, 0.68, 0.95]) {
    g.add(bm(new THREE.BoxGeometry(1.17, 0.03, 1.07), mat(0x555555), 0, y, 0));
  }

  // Rivet studs at band intersections (front face)
  for (const x of [-0.35, 0, 0.35]) {
    for (const y of [0.3, 0.55, 0.8]) {
      g.add(bm(new THREE.SphereGeometry(0.018, 4, 3), mat(darkIron), x, y, 0.55));
    }
  }

  // ── PASS 3: ORNAMENTATION — vault door, shield display, heraldry ──

  // Heavy vault door — iron plate with massive hinges
  g.add(bm(new THREE.BoxGeometry(0.4, 0.6, 0.06), mat(0x404040), 0, 0.5, 0.54));
  // Door bands (5 horizontal straps)
  for (let i = 0; i < 5; i++) {
    g.add(bm(new THREE.BoxGeometry(0.42, 0.025, 0.04), mat(iron), 0, 0.28 + i * 0.1, 0.57));
  }
  // Giant hinge plates
  g.add(bm(new THREE.BoxGeometry(0.08, 0.08, 0.04), mat(darkIron), -0.2, 0.35, 0.58));
  g.add(bm(new THREE.BoxGeometry(0.08, 0.08, 0.04), mat(darkIron), -0.2, 0.65, 0.58));
  // Lock plate
  g.add(bm(new THREE.BoxGeometry(0.06, 0.08, 0.04), mat(darkIron), 0.15, 0.5, 0.58));
  g.add(bm(new THREE.SphereGeometry(0.015, 4, 3), mat(gold), 0.15, 0.5, 0.6)); // keyhole

  // Shield wall display (front face, flanking door)
  for (const side of [-1, 1]) {
    // Large shield
    g.add(bm(new THREE.BoxGeometry(0.2, 0.24, 0.04), mat(tc), side * 0.42, 0.72, 0.54));
    g.add(bm(new THREE.BoxGeometry(0.04, 0.18, 0.03), mat(gold), side * 0.42, 0.72, 0.56)); // cross
    g.add(bm(new THREE.BoxGeometry(0.14, 0.04, 0.03), mat(gold), side * 0.42, 0.72, 0.56));
    g.add(bm(new THREE.SphereGeometry(0.02, 6, 4), mat(gold), side * 0.42, 0.72, 0.57)); // boss
  }

  // Heraldic banner above door
  g.add(bm(new THREE.BoxGeometry(0.3, 0.12, 0.04), mat(darkIron), 0, 0.92, 0.54)); // plate
  g.add(bm(new THREE.BoxGeometry(0.22, 0.08, 0.03), mat(tc), 0, 0.92, 0.56)); // banner
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.025), mat(gold), 0, 0.92, 0.57)); // emblem

  // ── PASS 4: WEAPON PASS — racks, halberds, axes, armor stands ──

  // Exterior weapon rack — LEFT side (swords + halberds)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.6, 0.5), mat(plank), -0.6, 0.5, 0));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.52), mat(darkPlank), -0.6, 0.78, 0));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.52), mat(darkPlank), -0.6, 0.48, 0));
  // Swords
  for (let i = 0; i < 2; i++) {
    const z = -0.15 + i * 0.2;
    g.add(bm(new THREE.BoxGeometry(0.025, 0.35, 0.02), mat(0x9aa8bb), -0.62, 0.55, z));
    g.add(bm(new THREE.BoxGeometry(0.06, 0.025, 0.02), mat(gold), -0.62, 0.4, z)); // guard
  }
  // Halberd (tall, leaning)
  g.add(bmr(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4), mat(plank), -0.64, 0.6, 0.15, 0, 0, 0.05));
  g.add(bmr(new THREE.BoxGeometry(0.08, 0.1, 0.02), mat(0x8899aa), -0.65, 1.02, 0.15, 0, 0, 0.05)); // blade

  // Exterior weapon rack — RIGHT side (axes + maces)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.6, 0.5), mat(plank), 0.6, 0.5, 0));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.03, 0.52), mat(darkPlank), 0.6, 0.78, 0));
  // Axes
  for (let i = 0; i < 2; i++) {
    const z = -0.12 + i * 0.22;
    g.add(bm(new THREE.BoxGeometry(0.025, 0.28, 0.025), mat(plank), 0.62, 0.55, z));
    g.add(bm(new THREE.BoxGeometry(0.1, 0.06, 0.02), mat(0x8899aa), 0.63, 0.72, z)); // axe head
  }
  // Mace (one hanging)
  g.add(bm(new THREE.BoxGeometry(0.025, 0.22, 0.025), mat(plank), 0.62, 0.55, 0.18));
  g.add(bm(new THREE.SphereGeometry(0.035, 6, 4), mat(iron), 0.62, 0.68, 0.18)); // mace head

  // Armor mannequin stands (flanking door interior, visible)
  for (const side of [-1, 1]) {
    const ax = side * 0.25, az = 0.38;
    g.add(bm(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat(plank), ax, 0.42, az)); // pole
    g.add(bm(new THREE.BoxGeometry(0.2, 0.04, 0.04), mat(plank), ax, 0.58, az)); // arms
    g.add(bm(new THREE.BoxGeometry(0.16, 0.2, 0.06), mat(0x7a7a70), ax, 0.5, az)); // chest plate
    g.add(bm(new THREE.BoxGeometry(0.18, 0.03, 0.06), mat(iron), ax, 0.42, az)); // belt
    g.add(bm(new THREE.SphereGeometry(0.04, 6, 4), mat(plank), ax, 0.65, az)); // head form
    // Helmet
    g.add(bm(new THREE.BoxGeometry(0.1, 0.06, 0.1), mat(iron), ax, 0.71, az));
  }

  // ── PASS 5: BACK DETAIL — ammo crates, whetstone, trophy wall ──

  // Ammunition crates (back wall)
  g.add(bm(new THREE.BoxGeometry(0.22, 0.18, 0.2), mat(plank), -0.3, 0.28, -0.58));
  g.add(bm(new THREE.BoxGeometry(0.24, 0.03, 0.22), mat(darkPlank), -0.3, 0.39, -0.58)); // lid
  g.add(bm(new THREE.BoxGeometry(0.2, 0.16, 0.18), mat(plank), -0.06, 0.27, -0.62));
  g.add(bm(new THREE.BoxGeometry(0.18, 0.2, 0.16), mat(darkPlank), 0.15, 0.29, -0.6));

  // Arrow/bolt bundles sticking out of crate
  for (let i = 0; i < 4; i++) {
    g.add(bmr(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 4), mat(plank),
      -0.28 + i * 0.04, 0.45, -0.58, 0, 0, -0.1 + i * 0.05));
  }

  // Whetstone/grinding wheel (back-right)
  g.add(bm(new THREE.BoxGeometry(0.04, 0.25, 0.04), mat(plank), 0.45, 0.3, -0.55));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.25, 0.04), mat(plank), 0.45, 0.3, -0.67));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.16), mat(plank), 0.45, 0.42, -0.61));
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10), mat(0x999999));
  wheel.position.set(0.45, 0.42, -0.61); wheel.rotation.x = Math.PI / 2; g.add(wheel);

  // Trophy wall — crossed weapons on back wall
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.45, 0.025), mat(0x8899aa), 0, 0.65, -0.54, 0, 0, 0.3));
  g.add(bmr(new THREE.BoxGeometry(0.025, 0.45, 0.025), mat(0x8899aa), 0, 0.65, -0.54, 0, 0, -0.3));
  // Decorative shield behind crossed weapons
  g.add(bm(new THREE.BoxGeometry(0.22, 0.26, 0.04), mat(tc), 0, 0.65, -0.55));
  g.add(bm(new THREE.SphereGeometry(0.025, 6, 4), mat(gold), 0, 0.65, -0.53));

  // ── PASS 6: MAGICAL/AURA — torch light, polished steel gleam ──

  // Torch sconces flanking door
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.06), mat(iron), side * 0.3, 0.82, 0.56)); // bracket
    g.add(bm(new THREE.ConeGeometry(0.02, 0.05, 5), glow(0xff6622, 0.6), side * 0.3, 0.88, 0.56));
    g.add(bm(new THREE.SphereGeometry(0.03, 4, 3), glow(0xffaa44, 0.12), side * 0.3, 0.9, 0.56));
  }

  // Steel gleam motes on weapon racks (subtle shimmer)
  g.add(bm(new THREE.BoxGeometry(0.01, 0.01, 0.01), glow(0xccddee, 0.2), -0.62, 0.7, -0.05));
  g.add(bm(new THREE.BoxGeometry(0.01, 0.01, 0.01), glow(0xccddee, 0.2), 0.63, 0.72, 0.1));

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.65, 0.05, 1.65), mat(tc), 0, 0.18, 0));

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}

// ========================================================================
// WIZARD TOWER — Grand arcane spire & sanctum
// Design: Tall hexagonal tower rising in tapered sections with stone
// banding, observation sanctum at top with balcony & railing, layered
// conical spire with glowing crystal orb and orbiting halo rings,
// spiral purple windows, arcane ground circle with rune stones,
// attached library wing with visible bookshelves, alchemy station,
// crystal garden, floating shards (named for animation), mystical
// doorway with carved archway and rune sigils, team banners.
// 6-pass: silhouette → layering → ornamentation → arcane tools → back detail → aura
// ========================================================================
export function buildWizardTowerMesh(pos: HexCoord, owner: number, scene: THREE.Scene, getElevation: (pos: HexCoord) => number): THREE.Group {
  const g = createBuildingGroup(pos, owner, 'wizardtower', getElevation);
  const tc = owner === 0 ? 0x3498db : 0xe74c3c;
  const stoneColor = 0x7a7a7a; const darkStone = 0x5a5a5a; const midStone = 0x6a6a6a;
  const purple = 0x6600aa; const crystal = 0x8844dd; const gold = 0xd4a44a;
  const plank = 0x5a3a2a;

  // ── PASS 1: SILHOUETTE — tower, library wing, spire ──

  // Foundation with arcane circle carved in stone
  g.add(bm(new THREE.BoxGeometry(1.65, 0.06, 1.65), mat(0x5a5a5a), 0, 0.03, 0));
  g.add(bm(new THREE.BoxGeometry(1.55, 0.12, 1.55), mat(midStone), 0, 0.09, 0));
  // Glowing rune circle — outer ring
  const runeRing = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.75, 24), glow(purple, 0.25));
  runeRing.rotation.x = -Math.PI / 2; runeRing.position.y = 0.16; g.add(runeRing);
  // Inner rune ring
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.48, 24), glow(purple, 0.15));
  innerRing.rotation.x = -Math.PI / 2; innerRing.position.y = 0.16; g.add(innerRing);
  // Rune stones on circle (6 small glowing blocks)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    g.add(bm(new THREE.BoxGeometry(0.06, 0.06, 0.06), glow(purple, 0.2),
      Math.cos(angle) * 0.72, 0.18, Math.sin(angle) * 0.72));
  }

  // Tower — 4 hexagonal sections getting narrower
  const baseMat = mat(stoneColor);
  g.add(bm(new THREE.CylinderGeometry(0.52, 0.58, 0.7, 6), baseMat, 0, 0.5, 0));
  g.add(bm(new THREE.CylinderGeometry(0.47, 0.52, 0.7, 6), baseMat, 0, 1.2, 0));
  g.add(bm(new THREE.CylinderGeometry(0.42, 0.47, 0.7, 6), baseMat, 0, 1.9, 0));
  g.add(bm(new THREE.CylinderGeometry(0.38, 0.42, 0.5, 6), baseMat, 0, 2.4, 0));

  // Observation sanctum at top — wider hexagonal room
  g.add(bm(new THREE.BoxGeometry(0.85, 0.5, 0.85), mat(darkStone), 0, 2.9, 0));

  // Library wing — attached rectangular structure at base (left)
  g.add(bm(new THREE.BoxGeometry(0.5, 0.65, 0.55), mat(midStone), -0.55, 0.48, 0.2));
  // Library peaked roof
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), mat(0x4a4a5a));
    roof.position.set(-0.55, 0.86, 0.2); roof.rotation.z = -side * 0.35; g.add(roof);
  }
  g.add(bm(new THREE.BoxGeometry(0.05, 0.05, 0.6), mat(darkStone), -0.55, 0.95, 0.2)); // ridge

  // Grand spire — layered conical roof
  g.add(bm(new THREE.ConeGeometry(0.52, 0.5, 6), mat(0x3a3a5a), 0, 3.4, 0)); // base cone
  g.add(bm(new THREE.ConeGeometry(0.38, 0.5, 6), mat(0x2a2a4a), 0, 3.7, 0)); // mid cone
  g.add(bm(new THREE.ConeGeometry(0.2, 0.4, 6), mat(0x3a3a5a), 0, 3.95, 0)); // tip cone

  // ── PASS 2: LAYERING — stone courses, tower banding, depth ──

  // Stone course rings between tower sections
  const courseMat = mat(darkStone);
  for (const [y, r] of [[0.85, 0.53], [1.55, 0.48], [2.25, 0.43]] as [number, number][]) {
    g.add(bm(new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.06, 6), courseMat, 0, y, 0));
  }

  // Carved stone detail bands (alternating)
  for (const [y, r] of [[0.5, 0.56], [1.2, 0.5], [1.9, 0.45]] as [number, number][]) {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      g.add(bm(new THREE.BoxGeometry(0.08, 0.04, 0.04), mat(midStone),
        Math.cos(angle) * (r + 0.02), y, Math.sin(angle) * (r + 0.02)));
    }
  }

  // Sanctum: stone courses
  g.add(bm(new THREE.BoxGeometry(0.87, 0.04, 0.87), mat(midStone), 0, 2.7, 0));
  g.add(bm(new THREE.BoxGeometry(0.87, 0.04, 0.87), mat(midStone), 0, 3.1, 0));

  // Library wing: stone layering
  for (const y of [0.3, 0.55, 0.72]) {
    g.add(bm(new THREE.BoxGeometry(0.52, 0.03, 0.57), mat(0x5a5a5a), -0.55, y, 0.2));
  }

  // ── PASS 3: ORNAMENTATION — carved doorway, rune sigils, windows ──

  // Grand arched doorway — carved stone with rune border
  g.add(bm(new THREE.BoxGeometry(0.32, 0.55, 0.08), mat(0x0a0508), 0, 0.43, 0.56)); // dark opening
  const archGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8, 1, false, 0, Math.PI);
  g.add(bmr(archGeo, mat(darkStone), 0, 0.72, 0.58, Math.PI / 2, 0, 0));
  // Carved pilasters flanking door
  for (const side of [-1, 1]) {
    g.add(bm(new THREE.BoxGeometry(0.08, 0.6, 0.08), mat(midStone), side * 0.2, 0.46, 0.58));
    g.add(bm(new THREE.BoxGeometry(0.1, 0.04, 0.1), mat(darkStone), side * 0.2, 0.78, 0.58)); // capital
    // Rune sigils on pilasters (small glowing marks)
    g.add(bm(new THREE.BoxGeometry(0.04, 0.04, 0.02), glow(purple, 0.3), side * 0.2, 0.55, 0.63));
    g.add(bm(new THREE.BoxGeometry(0.03, 0.03, 0.02), glow(purple, 0.2), side * 0.2, 0.4, 0.63));
  }
  // Keystone with arcane emblem
  g.add(bm(new THREE.BoxGeometry(0.08, 0.08, 0.06), mat(gold), 0, 0.82, 0.58));
  g.add(bm(new THREE.SphereGeometry(0.025, 6, 4), glow(crystal, 0.5), 0, 0.82, 0.62));

  // Spiral purple windows — ascending the tower
  const windowMat = glow(purple, 0.65);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + i * 0.45;
    const height = 0.4 + i * 0.22;
    const radius = 0.56 - i * 0.016;
    // Pointed arch window (box + triangle)
    const win = bm(new THREE.BoxGeometry(0.08, 0.12, 0.035), windowMat,
      Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    win.lookAt(new THREE.Vector3(0, height, 0));
    g.add(win);
    // Arch top
    const arch = bm(new THREE.BoxGeometry(0.06, 0.04, 0.03), windowMat,
      Math.cos(angle) * radius, height + 0.08, Math.sin(angle) * radius);
    arch.lookAt(new THREE.Vector3(0, height + 0.08, 0));
    g.add(arch);
  }

  // Sanctum windows — large, 4 sides
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(bm(new THREE.BoxGeometry(0.14, 0.2, 0.04), glow(purple, 0.5),
      Math.cos(angle) * 0.44, 2.9, Math.sin(angle) * 0.44));
    // Window frame
    g.add(bm(new THREE.BoxGeometry(0.02, 0.22, 0.04), mat(darkStone),
      Math.cos(angle) * 0.45, 2.9, Math.sin(angle) * 0.45));
    g.add(bm(new THREE.BoxGeometry(0.16, 0.02, 0.04), mat(darkStone),
      Math.cos(angle) * 0.45, 3.01, Math.sin(angle) * 0.45));
  }

  // Library door
  g.add(bm(new THREE.BoxGeometry(0.2, 0.4, 0.04), mat(0x2a1c10), -0.55, 0.35, 0.48));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.03, 0.03), mat(0x5a5550), -0.55, 0.35, 0.5));

  // ── PASS 4: ARCANE TOOL PASS — alchemy, bookshelves, crystal garden ──

  // Bookshelf visible through sanctum window
  g.add(bm(new THREE.BoxGeometry(0.35, 0.25, 0.05), mat(plank), 0, 2.8, 0.4));
  // Individual books (colored spines)
  for (let i = 0; i < 5; i++) {
    const colors = [0x8844aa, 0x2244aa, 0xaa4422, 0x44aa44, 0xaa8822];
    g.add(bm(new THREE.BoxGeometry(0.04, 0.06 + (i % 3) * 0.02, 0.035), mat(colors[i]),
      -0.12 + i * 0.06, 2.84, 0.42));
  }

  // Alchemy table (in library wing)
  g.add(bm(new THREE.BoxGeometry(0.25, 0.04, 0.2), mat(plank), -0.55, 0.42, 0.1)); // table
  g.add(bm(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat(plank), -0.65, 0.3, 0.0));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat(plank), -0.45, 0.3, 0.0));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat(plank), -0.65, 0.3, 0.2));
  g.add(bm(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat(plank), -0.45, 0.3, 0.2));
  // Potions on table
  g.add(bm(new THREE.CylinderGeometry(0.015, 0.02, 0.06, 6), mat(0x667788), -0.6, 0.47, 0.1)); // bottle
  g.add(bm(new THREE.SphereGeometry(0.015, 4, 3), glow(0x44aa44, 0.4), -0.6, 0.51, 0.1)); // potion glow
  g.add(bm(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 6), mat(0x667788), -0.5, 0.48, 0.08)); // bottle
  g.add(bm(new THREE.SphereGeometry(0.018, 4, 3), glow(0xaa2244, 0.4), -0.5, 0.53, 0.08)); // potion glow
  // Mortar & pestle
  g.add(bm(new THREE.CylinderGeometry(0.025, 0.03, 0.03, 6), mat(0x999999), -0.55, 0.46, 0.18));
  g.add(bmr(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), mat(0x888888), -0.55, 0.49, 0.18, 0, 0, 0.3));

  // Crystal garden (right side of tower base — small crystals growing from stone)
  for (let i = 0; i < 4; i++) {
    const cx = 0.5 + i * 0.08, cz = 0.3 - i * 0.12;
    const height = 0.08 + (i % 3) * 0.06;
    g.add(bm(new THREE.BoxGeometry(0.04, height, 0.04), glow(crystal, 0.3 + i * 0.1),
      cx, 0.18 + height / 2, cz));
    // Slight rotation for organic feel
    if (i % 2) {
      const c = g.children[g.children.length - 1];
      c.rotation.set(0.1, i * 0.5, 0.15);
    }
  }
  // Crystal cluster base stone
  g.add(bm(new THREE.BoxGeometry(0.35, 0.06, 0.35), mat(darkStone), 0.55, 0.16, 0.15));

  // ── PASS 5: BACK DETAIL — staff rack, scroll shelf, balcony ──

  // Balcony railing — proper posts with rail
  const railMat = mat(stoneColor);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    g.add(bm(new THREE.BoxGeometry(0.035, 0.18, 0.035), railMat,
      Math.cos(angle) * 0.5, 2.74, Math.sin(angle) * 0.5));
  }
  // Balcony floor ring
  g.add(bm(new THREE.CylinderGeometry(0.54, 0.54, 0.04, 10), railMat, 0, 2.67, 0));
  // Rail top ring
  g.add(bm(new THREE.CylinderGeometry(0.52, 0.52, 0.02, 10), mat(darkStone), 0, 2.84, 0));

  // Staff rack on back of tower (leaning staves)
  for (let i = 0; i < 2; i++) {
    const sz = -0.5 + i * 0.15;
    g.add(bmr(new THREE.CylinderGeometry(0.012, 0.012, 0.65, 4), mat(plank), 0.2 + i * 0.12, 0.5, sz, 0, 0, 0.08));
    g.add(bm(new THREE.SphereGeometry(0.025, 6, 4), glow(crystal, 0.3), 0.2 + i * 0.12, 0.86, sz)); // crystal tip
  }

  // Scroll shelf (back, visible through back window area)
  g.add(bm(new THREE.BoxGeometry(0.2, 0.12, 0.06), mat(plank), 0, 2.82, -0.42));
  // Scroll tubes
  for (const x of [-0.06, 0, 0.06]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6), mat(0xc4b080));
    tube.position.set(x, 2.88, -0.42); tube.rotation.z = Math.PI / 2; g.add(tube);
  }

  // ── PASS 6: MAGICAL/AURA — orb, halos, floating shards, ambient glow ──

  // Crystal orb at spire peak — bright glow
  g.add(bm(new THREE.SphereGeometry(0.09, 8, 6), glow(crystal, 0.9), 0, 4.2, 0));
  // Orbiting halo rings (2, at different angles)
  const halo1 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16), glow(purple, 0.5));
  halo1.position.set(0, 4.2, 0); halo1.rotation.x = Math.PI / 4; g.add(halo1);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16), glow(purple, 0.4));
  halo2.position.set(0, 4.2, 0); halo2.rotation.x = -Math.PI / 4; halo2.rotation.y = Math.PI / 2; g.add(halo2);

  // Floating crystal shards orbiting the tower (named for animation)
  const shardGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);
  const shardMat = glow(crystal, 0.55);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const shard = bm(shardGeo, shardMat,
      Math.cos(angle) * 0.75, 1.8 + i * 0.35, Math.sin(angle) * 0.75);
    shard.rotation.set(0.3, angle, 0.5);
    shard.name = `wizardtower-shard-${i}`;
    g.add(shard);
  }

  // Ambient purple glow at tower base (magical seepage)
  const baseGlow = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 16), glow(purple, 0.1));
  baseGlow.rotation.x = -Math.PI / 2; baseGlow.position.y = 0.17; g.add(baseGlow);

  // Sanctum interior glow (warm magical light through windows)
  g.add(bm(new THREE.SphereGeometry(0.15, 6, 4), glow(0x6644aa, 0.15), 0, 2.9, 0));

  // Potion table glow (subtle)
  g.add(bm(new THREE.SphereGeometry(0.05, 4, 3), glow(0x44aa44, 0.08), -0.55, 0.55, 0.1));

  // Team color base ring
  g.add(bm(new THREE.BoxGeometry(1.5, 0.05, 1.5), mat(tc), 0, 0.16, 0));
  // Team banner draped from balcony
  g.add(bm(new THREE.BoxGeometry(0.2, 0.35, 0.03), mat(tc), 0.15, 2.48, 0.52));
  g.add(bm(new THREE.BoxGeometry(0.22, 0.02, 0.025), mat(gold), 0.15, 2.3, 0.52)); // fringe

  scene.add(g); // blockedTiles managed by BuildingSystem (on construction complete)
  return g;
}
