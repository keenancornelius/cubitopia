/**
 * Defense Mesh Factory — Procedural mesh construction for walls and gates.
 *
 * Design: Both walls and gates share a unified medieval stone aesthetic with
 * multi-pass detail (silhouette → structure → ornamentation → lighting).
 *
 * GATE SEGMENT ROLES — gates auto-detect their role from neighbors:
 *  - "tower"   : endpoint of a gate chain (0 or 1 adjacent gates) — full flanking
 *                tower with conical roof, arrow slits, heraldic shield, torch glow
 *  - "passage" : middle of a gate chain (2 adjacent gates) — open archway with
 *                portcullis, machicolations, walkway, murder holes
 *  - "solo"    : isolated gate with no adjacent gates — compact tower+passage hybrid
 *
 * Walls get the same stone palette, arrow slits on junction pillars, stone course
 * banding, merlons with walkway, and elevation ramps.
 *
 * These are pure functions: data in → mesh group out.
 */
import * as THREE from 'three';
import { HexCoord } from '../../types';
import { getPlayerHex } from '../PlayerConfig';
import { Pathfinder } from './Pathfinder';

// ═══════════════════════════════════════════════════════════════════
// Shared types & helpers
// ═══════════════════════════════════════════════════════════════════

export interface TileElevationMap {
  get(key: string): { elevation: number } | undefined;
}

export interface WallBuildConfig {
  pos: HexCoord;
  owner: number;
  tiles: TileElevationMap;
  wallConnectable: Set<string>;
}

export interface GateBuildConfig extends WallBuildConfig {
  gatesBuilt: Set<string>;
}

// Shared stone palette — used by both walls and gates for visual cohesion
const STONE     = 0xc8b89a;
const DARK_STONE = 0xa09078;
const MID_STONE  = 0xb4a488;
const LIGHT_STONE = 0xf0ece0;
const IRON      = 0x5a5550;
const DARK_IRON = 0x3a3530;
const PLANK     = 0x6a4a2a;
const DARK_PLANK = 0x4a3018;
const FOUNDATION = 0x6f7c6d;

/** Per-call material cache to avoid duplicate allocations within a single mesh build */
function makeMaterialCache() {
  const cache = new Map<number, THREE.MeshLambertMaterial>();
  return (c: number) => {
    let v = cache.get(c);
    if (!v) { v = new THREE.MeshLambertMaterial({ color: c }); cache.set(c, v); }
    return v;
  };
}

function emissiveMat(c: number, intensity = 0.5): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: intensity });
}

/** Shorthand: box mesh at position */
function bx(m: (c: number) => THREE.MeshLambertMaterial, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color));
  mesh.position.set(x, y, z);
  return mesh;
}

/** Shorthand: cylinder mesh at position */
function cy(m: (c: number) => THREE.MeshLambertMaterial, rt: number, rb: number, h: number, seg: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m(color));
  mesh.position.set(x, y, z);
  return mesh;
}

/** Compute hex→world position */
function hexWorld(pos: HexCoord) {
  return {
    x: pos.q * 1.5,
    z: pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0),
  };
}

interface NeighborInfo { dx: number; dz: number; dy: number; dist: number }

/** Gather connected neighbors (walls, gates, buildings) with world-space offsets */
function gatherConnections(pos: HexCoord, worldX: number, worldZ: number, baseY: number,
  tiles: TileElevationMap, wallConnectable: Set<string>,
  excludeSet?: Set<string>): NeighborInfo[] {
  const result: NeighborInfo[] = [];
  for (const n of Pathfinder.getHexNeighbors(pos)) {
    const nKey = `${n.q},${n.r}`;
    if (!wallConnectable.has(nKey)) continue;
    if (excludeSet?.has(nKey)) continue;
    const nTile = tiles.get(nKey);
    if (!nTile) continue;
    const hw = hexWorld(n);
    const dx = hw.x - worldX;
    const dz = hw.z - worldZ;
    const dy = nTile.elevation * 0.5 - baseY;
    result.push({ dx, dz, dy, dist: Math.sqrt(dx * dx + dz * dz) });
  }
  return result;
}

/** Build gap-free wall curtain segments from center toward each neighbor */
function addWallSegments(
  parent: THREE.Group,
  connections: NeighborInfo[],
  m: (c: number) => THREE.MeshLambertMaterial,
  tc: number,
  wallH: number,
  thickness: number,
) {
  for (const cn of connections) {
    const halfDist = cn.dist / 2;
    const segLen = halfDist + 0.15;
    const angle = Math.atan2(cn.dx, cn.dz);
    const halfDy = cn.dy / 2;
    const midX = cn.dx / 4, midZ = cn.dz / 4;

    // Stone curtain wall
    const seg = new THREE.Mesh(new THREE.BoxGeometry(thickness, wallH, segLen), m(STONE));
    seg.position.set(midX, wallH / 2 + halfDy / 2, midZ);
    seg.rotation.y = -angle;
    seg.castShadow = true;
    parent.add(seg);

    // Stone course band at mid-height
    const band = new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.02, 0.04, segLen), m(DARK_STONE));
    band.position.set(midX, wallH * 0.55 + halfDy / 2, midZ);
    band.rotation.y = -angle;
    parent.add(band);

    // Crenellation overhang
    const cren = new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.14, 0.1, segLen), m(LIGHT_STONE));
    cren.position.set(midX, wallH + 0.05 + halfDy / 2, midZ);
    cren.rotation.y = -angle;
    parent.add(cren);

    // Walkway on top
    const walk = new THREE.Mesh(new THREE.BoxGeometry(thickness - 0.04, 0.05, segLen), m(DARK_STONE));
    walk.position.set(midX, wallH + 0.13 + halfDy / 2, midZ);
    walk.rotation.y = -angle;
    parent.add(walk);

    // Merlons along segment (every 0.4 units)
    const merlonCount = Math.max(2, Math.round(segLen / 0.35));
    const mGeo = new THREE.BoxGeometry(0.08, 0.12, 0.08);
    for (let i = 0; i < merlonCount; i++) {
      const t = (i / (merlonCount - 1)) - 0.5; // -0.5 to 0.5
      const lx = t * segLen;
      for (const faceOff of [-thickness / 2 - 0.03, thickness / 2 + 0.03]) {
        const merlon = new THREE.Mesh(mGeo, m(LIGHT_STONE));
        // Position in segment-local space, then rotate
        const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
        const localZ = lx;
        const localX = faceOff;
        merlon.position.set(
          midX + localX * cosA - localZ * sinA,
          wallH + 0.16 + halfDy / 2,
          midZ + localX * sinA + localZ * cosA,
        );
        parent.add(merlon);
      }
    }

    // Team stripe at base
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.06, 0.1, segLen), m(tc));
    stripe.position.set(midX, 0.05 + halfDy / 2, midZ);
    stripe.rotation.y = -angle;
    parent.add(stripe);

    // Elevation ramp for height transitions
    if (Math.abs(cn.dy) > 0.1) {
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(thickness, Math.abs(halfDy), thickness),
        m(DARK_STONE)
      );
      ramp.position.set(cn.dx / 2 * 0.48, halfDy > 0 ? halfDy / 2 : wallH + halfDy / 2, cn.dz / 2 * 0.48);
      parent.add(ramp);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// WALL MESH — fortress-quality curtain wall
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an adaptive wall mesh with upgraded visuals:
 * Stone pillar with arrow slits at junctions, stone course banding,
 * crenellated walkway with merlons, team stripe, elevation ramps.
 */
export function buildAdaptiveWallMesh(config: WallBuildConfig): THREE.Group | null {
  const { pos, owner, tiles, wallConnectable } = config;
  const key = `${pos.q},${pos.r}`;
  const tile = tiles.get(key);
  if (!tile) return null;

  const m = makeMaterialCache();
  const tc = getPlayerHex(owner);
  const hw = hexWorld(pos);
  const baseY = tile.elevation * 0.5;

  const g = new THREE.Group();
  g.position.set(hw.x, baseY, hw.z);
  g.name = `wall_${key}`;

  const connections = gatherConnections(pos, hw.x, hw.z, baseY, tiles, wallConnectable);
  const isJunction = connections.length >= 2;
  const isEndpoint = connections.length === 1;
  const isIsolated = connections.length === 0;

  const wallH = 1.6;
  const wallThick = 0.45;

  // ── Pillar ──
  const pSize = isJunction ? 0.6 : isEndpoint ? 0.52 : 0.48;
  const pH = wallH + (isJunction ? 0.5 : 0.35);

  // Stone foundation ring
  g.add(bx(m, pSize + 0.16, 0.08, pSize + 0.16, FOUNDATION, 0, 0.04, 0));
  g.add(bx(m, pSize + 0.08, 0.1, pSize + 0.08, DARK_STONE, 0, 0.13, 0));

  // Main pillar body
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(pSize, pH, pSize), m(STONE));
  pillar.position.y = pH / 2 + 0.18;
  pillar.castShadow = true;
  g.add(pillar);

  // Stone course bands on pillar
  for (let i = 0; i < 3; i++) {
    const yy = 0.5 + i * (pH / 3);
    g.add(bx(m, pSize + 0.02, 0.04, pSize + 0.02, DARK_STONE, 0, yy, 0));
  }

  // Crenellation cap (wider overhang)
  const capS = pSize + 0.14;
  g.add(bx(m, capS, 0.1, capS, LIGHT_STONE, 0, pH + 0.18 + 0.05, 0));

  // Corner merlons
  const mGeo = new THREE.BoxGeometry(0.1, 0.14, 0.1);
  for (const [ox, oz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const merlon = new THREE.Mesh(mGeo, m(LIGHT_STONE));
    merlon.position.set(ox * (capS / 2 - 0.05), pH + 0.18 + 0.17, oz * (capS / 2 - 0.05));
    g.add(merlon);
  }

  // Arrow slits on junction/endpoint pillars (cruciform on 2 faces)
  if (isJunction || isEndpoint) {
    const slitFaces: [number, number][] = isJunction
      ? [[0, pSize / 2 + 0.01], [0, -(pSize / 2 + 0.01)], [pSize / 2 + 0.01, 0], [-(pSize / 2 + 0.01), 0]]
      : [[0, pSize / 2 + 0.01], [0, -(pSize / 2 + 0.01)]];
    for (const [sx, sz] of slitFaces) {
      const rotY = Math.atan2(sx, sz);
      // Vertical slit
      const vs = bx(m, 0.03, 0.2, 0.02, 0x1a1a1e, sx, pH * 0.55 + 0.18, sz);
      vs.rotation.y = rotY;
      g.add(vs);
      // Cross bar
      const cb = bx(m, 0.09, 0.03, 0.02, 0x1a1a1e, sx, pH * 0.55 + 0.18, sz);
      cb.rotation.y = rotY;
      g.add(cb);
    }
  }

  // Team-colored base stripe
  g.add(bx(m, pSize + 0.06, 0.1, pSize + 0.06, tc, 0, 0.23, 0));

  // ── Wall segments toward neighbors ──
  addWallSegments(g, connections, m, tc, wallH, wallThick);

  return g;
}

// ═══════════════════════════════════════════════════════════════════
// GATE MESH — Procedural segment-role barbican
// ═══════════════════════════════════════════════════════════════════

type GateRole = 'tower' | 'passage' | 'solo';

/** Determine this gate's role based on adjacent gate count */
function getGateRole(pos: HexCoord, gatesBuilt: Set<string>): { role: GateRole; adjGateDirs: { dx: number; dz: number }[] } {
  const hw = hexWorld(pos);
  const adjGateDirs: { dx: number; dz: number }[] = [];
  for (const n of Pathfinder.getHexNeighbors(pos)) {
    const nKey = `${n.q},${n.r}`;
    if (!gatesBuilt.has(nKey)) continue;
    const nhw = hexWorld(n);
    adjGateDirs.push({ dx: nhw.x - hw.x, dz: nhw.z - hw.z });
  }
  const role: GateRole = adjGateDirs.length === 0 ? 'solo'
    : adjGateDirs.length >= 2 ? 'passage'
    : 'tower';
  return { role, adjGateDirs };
}

/**
 * Build a gate mesh. Auto-detects segment role from neighbors:
 * - tower:   flanking tower with conical roof, arrow slits, shield, torches
 * - passage: archway with portcullis, machicolations, walkway overhead
 * - solo:    compact tower+passage hybrid (single isolated gate)
 */
export function buildGateMesh(config: GateBuildConfig): THREE.Group | null {
  const { pos, owner, tiles, wallConnectable, gatesBuilt } = config;
  const key = `${pos.q},${pos.r}`;
  const tile = tiles.get(key);
  if (!tile) return null;

  const m = makeMaterialCache();
  const tc = getPlayerHex(owner);
  const hw = hexWorld(pos);
  const baseY = tile.elevation * 0.5;

  const g = new THREE.Group();
  g.position.set(hw.x, baseY, hw.z);
  g.name = `gate_${key}`;

  // Detect role and neighbors
  const { role, adjGateDirs } = getGateRole(pos, gatesBuilt);
  const wallNeighbors = gatherConnections(pos, hw.x, hw.z, baseY, tiles, wallConnectable, gatesBuilt);

  // Compute orientation: wall line angle (gates+walls combined)
  const allDirs = [...wallNeighbors, ...adjGateDirs.map(d => ({ ...d, dy: 0, dist: Math.sqrt(d.dx * d.dx + d.dz * d.dz) }))];
  let wallAngle = 0;
  if (allDirs.length > 0) {
    const ax = allDirs.reduce((s, c) => s + c.dx, 0) / allDirs.length;
    const az = allDirs.reduce((s, c) => s + c.dz, 0) / allDirs.length;
    wallAngle = Math.atan2(ax, az);
  }

  // Oriented pivot — local Z = along wall line, local X = passage direction
  const pivot = new THREE.Group();
  pivot.rotation.y = -wallAngle;
  g.add(pivot);

  // Dispatch to role-specific builder
  if (role === 'tower') {
    buildGateTower(pivot, m, tc);
  } else if (role === 'passage') {
    buildGatePassage(pivot, m, tc);
  } else {
    buildGateSolo(pivot, m, tc);
  }

  // Wall connection segments (to non-gate neighbors)
  addWallSegments(g, wallNeighbors, m, tc, 1.6, 0.45);

  return g;
}

// ─── TOWER segment ─────────────────────────────────────────────
// Full flanking tower: conical roof, arrow slits, heraldic shield, torches

function buildGateTower(p: THREE.Group, m: (c: number) => THREE.MeshLambertMaterial, tc: number) {
  const tR = 0.32;    // tower radius
  const tH = 3.0;     // tower height
  const bodyW = 0.7;  // body width along wall
  const bodyD = 0.75;  // body depth perpendicular to wall
  const bodyH = 2.3;

  // ── Foundation ──
  p.add(bx(m, bodyW + 0.2, 0.08, bodyD + 0.2, FOUNDATION, 0, 0.04, 0));
  p.add(bx(m, bodyW + 0.1, 0.12, bodyD + 0.1, DARK_STONE, 0, 0.14, 0));

  // ── Main tower body (octagonal) ──
  p.add(cy(m, tR - 0.01, tR + 0.03, tH, 8, STONE, 0, tH / 2 + 0.2, 0));

  // Stone course rings
  for (const yy of [0.65, 1.25, 1.85, 2.45]) {
    p.add(cy(m, tR + 0.02, tR + 0.02, 0.04, 8, DARK_STONE, 0, yy, 0));
  }

  // Arrow slits (4 around, cruciform)
  for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2 + Math.PI / 4;
    const sx = Math.cos(ang) * (tR + 0.01);
    const sz = Math.sin(ang) * (tR + 0.01);
    const vs = bx(m, 0.03, 0.22, 0.02, 0x1a1a1e, sx, 1.6, sz);
    vs.rotation.y = -ang; p.add(vs);
    const cb = bx(m, 0.1, 0.03, 0.02, 0x1a1a1e, sx, 1.6, sz);
    cb.rotation.y = -ang; p.add(cb);
  }

  // Overhang shelf with bracket supports
  p.add(cy(m, tR + 0.08, tR, 0.08, 8, DARK_STONE, 0, tH + 0.16, 0));
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    p.add(bx(m, 0.04, 0.07, 0.04, MID_STONE,
      Math.cos(ang) * (tR + 0.01), tH + 0.1, Math.sin(ang) * (tR + 0.01)));
  }

  // Tower merlons (8 around)
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    p.add(bx(m, 0.06, 0.12, 0.06, LIGHT_STONE,
      Math.cos(ang) * (tR + 0.05), tH + 0.28, Math.sin(ang) * (tR + 0.05)));
  }

  // Conical roof + finial
  p.add(cy(m, 0, tR + 0.05, 0.5, 8, 0x5a4a3a, 0, tH + 0.49, 0));
  p.add(cy(m, 0.01, 0.01, 0.14, 4, IRON, 0, tH + 0.81, 0));

  // Heraldic shield (front face, +Z)
  p.add(bx(m, 0.2, 0.24, 0.03, DARK_IRON, 0, 1.9, tR + 0.02));
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.04), m(tc));
  shield.position.set(0, 1.9, tR + 0.03);
  p.add(shield);
  p.add(cy(m, 0.03, 0.03, 0.02, 6, 0xd4a44a, 0, 1.9, tR + 0.05)); // boss

  // Torch brackets (flanking shield)
  for (const side of [-1, 1]) {
    p.add(bx(m, 0.03, 0.14, 0.03, DARK_IRON, side * 0.18, 1.6, tR + 0.02));
    p.add(bx(m, 0.07, 0.03, 0.03, DARK_IRON, side * 0.18, 1.67, tR + 0.02));
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.06), emissiveMat(0xff8c20, 0.7));
    flame.position.set(side * 0.18, 1.73, tR + 0.02);
    p.add(flame);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshLambertMaterial({ color: 0xffaa44, emissive: 0xffaa44, emissiveIntensity: 0.4, transparent: true, opacity: 0.3 })
    );
    glow.position.set(side * 0.18, 1.75, tR + 0.04);
    p.add(glow);
  }

  // Team band at base
  p.add(cy(m, tR + 0.04, tR + 0.04, 0.1, 8, tc, 0, 0.25, 0));

  // Banner flag
  p.add(cy(m, 0.015, 0.015, 0.5, 4, 0x4a3520, 0, tH + 0.74, 0));
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.18),
    new THREE.MeshLambertMaterial({ color: tc, side: THREE.DoubleSide })
  );
  flag.position.set(0.17, tH + 0.9, 0);
  p.add(flag);
}

// ─── PASSAGE segment ───────────────────────────────────────────
// Open archway with portcullis, machicolations, walkway overhead

function buildGatePassage(p: THREE.Group, m: (c: number) => THREE.MeshLambertMaterial, tc: number) {
  const archW = 0.65;  // passage width (perpendicular to wall)
  const archH = 1.4;
  const bodyW = 0.8;   // total width along wall line
  const bodyD = 0.8;   // depth perpendicular
  const bodyH = 2.0;

  // ── Foundation ──
  p.add(bx(m, bodyW + 0.12, 0.07, bodyD + 0.12, FOUNDATION, 0, 0.035, 0));
  p.add(bx(m, bodyW + 0.04, 0.1, bodyD + 0.04, DARK_STONE, 0, 0.12, 0));

  // ── Main body shell (walls on both sides of passage) ──
  // Left wall slab
  const wallThick = (bodyD - archW) / 2;
  for (const side of [-1, 1]) {
    const zOff = side * (archW / 2 + wallThick / 2);
    p.add(bx(m, bodyW, bodyH, wallThick, STONE, 0, bodyH / 2 + 0.17, zOff));
    // Stone courses
    for (const yy of [0.6, 1.1, 1.6]) {
      p.add(bx(m, bodyW + 0.02, 0.04, wallThick + 0.02, DARK_STONE, 0, yy, zOff));
    }
  }

  // Archway void (dark passage)
  p.add(bx(m, bodyW + 0.04, archH, archW, 0x0e0e12, 0, archH / 2 + 0.17, 0));

  // Lintel stone above arch (both faces)
  for (const fx of [-bodyW / 2, bodyW / 2]) {
    p.add(bx(m, 0.08, 0.14, archW + 0.08, DARK_STONE, fx, archH + 0.24, 0));
  }

  // Portcullis grates (both ends of passage)
  const barCount = 5;
  for (const faceX of [-bodyW / 2 + 0.04, bodyW / 2 - 0.04]) {
    for (let i = 0; i < barCount; i++) {
      const bz = -archW / 2 + 0.06 + i * (archW - 0.12) / (barCount - 1);
      p.add(bx(m, 0.03, archH - 0.1, 0.025, DARK_IRON, faceX, archH / 2 + 0.17, bz));
    }
    // Crossbars
    for (const yy of [0.5, 0.9, 1.3]) {
      p.add(bx(m, 0.03, 0.025, archW - 0.08, IRON, faceX, yy, 0));
    }
    // Portcullis housing
    p.add(bx(m, 0.1, 0.14, archW + 0.1, DARK_STONE, faceX, archH + 0.07 + 0.17, 0));
  }

  // ── Machicolations on both outer faces ──
  for (const faceZ of [-(bodyD / 2), bodyD / 2]) {
    const sign = Math.sign(faceZ);
    for (let i = 0; i < 4; i++) {
      const mx = -bodyW / 2 + 0.15 + i * (bodyW - 0.3) / 3;
      // Corbel bracket
      p.add(bx(m, 0.08, 0.1, 0.08, MID_STONE, mx, bodyH + 0.12, faceZ + sign * 0.05));
      // Murder hole gap
      if (i < 3) {
        p.add(bx(m, 0.06, 0.04, 0.06, 0x0e0e12, mx + (bodyW - 0.3) / 6, bodyH + 0.08, faceZ + sign * 0.06));
      }
    }
  }

  // Crenellated walkway overhead
  p.add(bx(m, bodyW + 0.16, 0.08, bodyD + 0.16, LIGHT_STONE, 0, bodyH + 0.21, 0));
  // Walkway surface
  p.add(bx(m, bodyW - 0.04, 0.04, bodyD - 0.04, DARK_STONE, 0, bodyH + 0.27, 0));

  // Merlons on both outer faces
  const mGeo = new THREE.BoxGeometry(0.08, 0.12, 0.08);
  for (const fz of [-(bodyD / 2 + 0.06), bodyD / 2 + 0.06]) {
    for (let i = 0; i < 5; i++) {
      const merlon = new THREE.Mesh(mGeo, m(LIGHT_STONE));
      merlon.position.set(-bodyW / 2 + 0.1 + i * (bodyW - 0.2) / 4, bodyH + 0.31, fz);
      p.add(merlon);
    }
  }

  // ── Arrow slits on outer walls ──
  for (const side of [-1, 1]) {
    const sz = side * (bodyD / 2 + 0.01);
    const vs = bx(m, 0.03, 0.2, 0.02, 0x1a1a1e, 0, 1.3, sz);
    p.add(vs);
    const cb = bx(m, 0.09, 0.03, 0.02, 0x1a1a1e, 0, 1.3, sz);
    p.add(cb);
  }

  // Team stripe at base
  p.add(bx(m, bodyW + 0.06, 0.08, bodyD + 0.06, tc, 0, 0.21, 0));
}

// ─── SOLO segment ──────────────────────────────────────────────
// Compact tower+passage hybrid — single isolated gate

function buildGateSolo(p: THREE.Group, m: (c: number) => THREE.MeshLambertMaterial, tc: number) {
  const towerSpread = 0.38;
  const tR = 0.22;
  const tH = 2.6;
  const archW = 0.48;
  const archH = 1.25;
  const bodyH = 2.0;

  // Foundation
  p.add(bx(m, 1.2, 0.07, 0.95, FOUNDATION, 0, 0.035, 0));
  p.add(bx(m, 1.1, 0.1, 0.85, DARK_STONE, 0, 0.12, 0));

  // Central body
  p.add(bx(m, towerSpread * 2 + tR, bodyH, 0.6, STONE, 0, bodyH / 2 + 0.17, 0));

  // Twin towers (smaller than full tower role)
  for (const side of [-1, 1]) {
    const tx = side * towerSpread;
    p.add(cy(m, tR - 0.01, tR + 0.02, tH, 8, STONE, tx, tH / 2 + 0.17, 0));
    // Stone rings
    for (const yy of [0.6, 1.2, 1.8]) {
      p.add(cy(m, tR + 0.01, tR + 0.01, 0.04, 8, DARK_STONE, tx, yy, 0));
    }
    // Arrow slits (2 per tower)
    for (const fz of [-1, 1]) {
      const sz = fz * (tR + 0.01);
      const vs = bx(m, 0.025, 0.16, 0.02, 0x1a1a1e, tx, 1.4, sz);
      p.add(vs);
      const cb = bx(m, 0.08, 0.025, 0.02, 0x1a1a1e, tx, 1.4, sz);
      p.add(cb);
    }
    // Tower top — small overhang + merlons + cone
    p.add(cy(m, tR + 0.05, tR, 0.06, 8, DARK_STONE, tx, tH + 0.14, 0));
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      p.add(bx(m, 0.05, 0.1, 0.05, LIGHT_STONE,
        tx + Math.cos(ang) * (tR + 0.03), tH + 0.23, Math.sin(ang) * (tR + 0.03)));
    }
    p.add(cy(m, 0, tR + 0.03, 0.38, 8, 0x5a4a3a, tx, tH + 0.36, 0));
    p.add(cy(m, 0.01, 0.01, 0.1, 4, IRON, tx, tH + 0.6, 0));
    // Team ring
    p.add(cy(m, tR + 0.03, tR + 0.03, 0.08, 8, tc, tx, 0.21, 0));
  }

  // Archway void
  p.add(bx(m, archW, archH, 0.68, 0x0e0e12, 0, archH / 2 + 0.17, 0));

  // Portcullis (front)
  const barCount = 4;
  for (let i = 0; i < barCount; i++) {
    const bx_ = -archW / 2 + 0.05 + i * (archW - 0.1) / (barCount - 1);
    p.add(bx(m, 0.025, archH - 0.1, 0.025, DARK_IRON, bx_, archH / 2 + 0.17, 0.32));
  }
  for (const yy of [0.5, 0.85]) {
    p.add(bx(m, archW - 0.06, 0.025, 0.025, IRON, 0, yy, 0.32));
  }

  // Stone courses on body
  for (const yy of [0.6, 1.1, 1.6]) {
    p.add(bx(m, towerSpread * 2 + tR + 0.02, 0.04, 0.62, DARK_STONE, 0, yy, 0));
  }

  // Crenellated top
  p.add(bx(m, towerSpread * 2 + tR + 0.16, 0.08, 0.78, LIGHT_STONE, 0, bodyH + 0.21, 0));
  const mGeo = new THREE.BoxGeometry(0.07, 0.1, 0.07);
  for (const fz of [-0.38, 0.38]) {
    for (let i = 0; i < 5; i++) {
      const merlon = new THREE.Mesh(mGeo, m(LIGHT_STONE));
      merlon.position.set(-0.36 + i * 0.18, bodyH + 0.3, fz);
      p.add(merlon);
    }
  }

  // Heraldic shield above arch (front)
  p.add(bx(m, 0.16, 0.2, 0.03, DARK_IRON, 0, archH + 0.5, 0.32));
  p.add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.035), m(tc)).translateX(0).translateY(archH + 0.5).translateZ(0.33));
  p.add(cy(m, 0.025, 0.025, 0.02, 6, 0xd4a44a, 0, archH + 0.5, 0.35));

  // Torch flanking arch
  for (const side of [-1, 1]) {
    p.add(bx(m, 0.025, 0.12, 0.025, DARK_IRON, side * 0.18, archH + 0.0, 0.33));
    p.add(bx(m, 0.06, 0.025, 0.025, DARK_IRON, side * 0.18, archH + 0.06, 0.33));
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.05), emissiveMat(0xff8c20, 0.7));
    flame.position.set(side * 0.18, archH + 0.12, 0.33);
    p.add(flame);
  }

  // Team stripe at base
  p.add(bx(m, towerSpread * 2 + tR + 0.06, 0.08, 0.66, tc, 0, 0.21, 0));

  // Door planks inside archway
  for (let i = 0; i < 3; i++) {
    const dx = -archW / 2 + 0.07 + i * (archW - 0.14) / 2;
    p.add(bx(m, 0.08, archH - 0.15, 0.04, PLANK, dx, archH / 2 + 0.17, -0.08));
    p.add(bx(m, 0.06, archH - 0.25, 0.005, DARK_PLANK, dx, archH / 2 + 0.17, -0.06));
  }
  // Iron bands
  for (const yy of [0.48, 0.78, 1.08]) {
    p.add(bx(m, archW - 0.04, 0.03, 0.04, IRON, 0, yy, -0.08));
  }

  // Banner flag
  p.add(cy(m, 0.012, 0.012, 0.45, 4, 0x4a3520, 0, tH + 0.55, 0));
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.16),
    new THREE.MeshLambertMaterial({ color: tc, side: THREE.DoubleSide })
  );
  flag.position.set(0.16, tH + 0.7, 0);
  p.add(flag);
}
