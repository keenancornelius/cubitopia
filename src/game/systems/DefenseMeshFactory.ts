/**
 * Defense Mesh Factory — Pure mesh construction functions for walls and gates.
 * Each function creates a Three.js Group with the defense structure's visual geometry.
 * Extracted from main.ts to reduce monolith size.
 *
 * These are pure functions: they take data in and return a mesh group.
 * The caller (main.ts) handles scene registration, mesh maps, and cleanup.
 */
import * as THREE from 'three';
import { HexCoord } from '../../types';
import { Pathfinder } from './Pathfinder';

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

/**
 * Build an adaptive wall mesh at a hex position that connects to neighboring walls.
 * Returns the mesh group positioned in world space, or null if the tile doesn't exist.
 */
export function buildAdaptiveWallMesh(config: WallBuildConfig): THREE.Group | null {
  const { pos, owner, tiles, wallConnectable } = config;
  const key = `${pos.q},${pos.r}`;
  const tile = tiles.get(key);
  if (!tile) return null;

  const worldX = pos.q * 1.5;
  const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
  const baseY = tile.elevation * 0.5;

  const wallGroup = new THREE.Group();
  wallGroup.position.set(worldX, baseY, worldZ);
  wallGroup.name = `wall_${key}`;

  const wallColor = 0xf0ece0;
  const darkColor = 0xe8e0d0;
  const accentColor = owner === 0 ? 0x3498db : 0xe74c3c;

  // Find which neighbors have walls, gates, or buildings (anything wall-connectable)
  const neighbors = Pathfinder.getHexNeighbors(pos);
  const connectedNeighbors: { n: HexCoord; dx: number; dz: number; dy: number; dist: number }[] = [];

  for (const n of neighbors) {
    const nKey = `${n.q},${n.r}`;
    if (!wallConnectable.has(nKey)) continue;
    const nTile = tiles.get(nKey);
    if (!nTile) continue;
    const nWorldX = n.q * 1.5;
    const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
    const nBaseY = nTile.elevation * 0.5;
    const dx = nWorldX - worldX;
    const dz = nWorldZ - worldZ;
    const dy = nBaseY - baseY;
    const dist = Math.sqrt(dx * dx + dz * dz);
    connectedNeighbors.push({ n, dx, dz, dy, dist });
  }

  const wallH = 1.6;
  const wallThickness = 0.45;

  // --- Center pillar: larger when it's a junction (2+ connections) or endpoint ---
  const isJunction = connectedNeighbors.length >= 2;
  const pillarSize = isJunction ? 0.6 : 0.5;
  const pillarH = wallH + 0.4;
  const pillarGeo = new THREE.BoxGeometry(pillarSize, pillarH, pillarSize);
  const pillarMat = new THREE.MeshLambertMaterial({ color: darkColor });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.y = pillarH / 2;
  pillar.castShadow = true;
  wallGroup.add(pillar);

  // Crenellation cap on pillar (wider for junction effect)
  const capSize = pillarSize + 0.12;
  const capGeo = new THREE.BoxGeometry(capSize, 0.22, capSize);
  const capMat = new THREE.MeshLambertMaterial({ color: wallColor });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = pillarH + 0.11;
  wallGroup.add(cap);

  // Small merlons on pillar top for junction pillars
  if (isJunction) {
    const mGeo = new THREE.BoxGeometry(0.15, 0.2, 0.15);
    const mMat = new THREE.MeshLambertMaterial({ color: wallColor });
    for (const [ox, oz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const m = new THREE.Mesh(mGeo, mMat);
      m.position.set(ox * (capSize/2 - 0.07), pillarH + 0.32, oz * (capSize/2 - 0.07));
      wallGroup.add(m);
    }
  }

  // Team-colored base stripe on pillar
  const baseStripeGeo = new THREE.BoxGeometry(pillarSize + 0.04, 0.14, pillarSize + 0.04);
  const baseStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
  const baseStripe = new THREE.Mesh(baseStripeGeo, baseStripeMat);
  baseStripe.position.y = 0.07;
  wallGroup.add(baseStripe);

  // --- Wall segments toward each connected neighbor (extend FULL distance to eliminate gaps) ---
  for (const cn of connectedNeighbors) {
    const halfDist = cn.dist / 2;
    const angle = Math.atan2(cn.dx, cn.dz);
    const halfDy = cn.dy / 2;

    // Extend segment length slightly past midpoint to overlap with neighbor's segment
    const segLen = halfDist + 0.15;

    // Wall curtain — positioned from center toward neighbor, length covers to midpoint + overlap
    const segGeo = new THREE.BoxGeometry(wallThickness, wallH, segLen);
    const segMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const seg = new THREE.Mesh(segGeo, segMat);
    seg.position.set(cn.dx / 4, wallH / 2 + halfDy / 2, cn.dz / 4);
    seg.rotation.y = -angle;
    seg.castShadow = true;
    wallGroup.add(seg);

    // Top crenellation along the segment (slightly wider and thicker)
    const crenGeo = new THREE.BoxGeometry(wallThickness + 0.12, 0.22, segLen);
    const crenMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const cren = new THREE.Mesh(crenGeo, crenMat);
    cren.position.set(cn.dx / 4, wallH + 0.11 + halfDy / 2, cn.dz / 4);
    cren.rotation.y = -angle;
    wallGroup.add(cren);

    // Walkway cap on top of crenellation (stone path on wall top)
    const walkGeo = new THREE.BoxGeometry(wallThickness - 0.05, 0.06, segLen);
    const walkMat = new THREE.MeshLambertMaterial({ color: darkColor });
    const walk = new THREE.Mesh(walkGeo, walkMat);
    walk.position.set(cn.dx / 4, wallH + 0.25 + halfDy / 2, cn.dz / 4);
    walk.rotation.y = -angle;
    wallGroup.add(walk);

    // Team stripe along bottom of segment
    const sStripeGeo = new THREE.BoxGeometry(wallThickness + 0.06, 0.12, segLen);
    const sStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
    const sStripe = new THREE.Mesh(sStripeGeo, sStripeMat);
    sStripe.position.set(cn.dx / 4, 0.06 + halfDy / 2, cn.dz / 4);
    sStripe.rotation.y = -angle;
    wallGroup.add(sStripe);

    // Elevation ramp: if there's a height difference, add a stepped transition
    if (Math.abs(cn.dy) > 0.1) {
      const rampGeo = new THREE.BoxGeometry(wallThickness, Math.abs(halfDy), wallThickness);
      const rampMat = new THREE.MeshLambertMaterial({ color: darkColor });
      const ramp = new THREE.Mesh(rampGeo, rampMat);
      ramp.position.set(cn.dx / 2 * 0.48, halfDy > 0 ? halfDy / 2 : wallH + halfDy / 2, cn.dz / 2 * 0.48);
      wallGroup.add(ramp);
    }
  }

  return wallGroup;
}

/**
 * Build a gate mesh at a hex position with passage opening and wall connections.
 * Returns the mesh group positioned in world space, or null if the tile doesn't exist.
 */
export function buildGateMesh(config: GateBuildConfig): THREE.Group | null {
  const { pos, owner, tiles, wallConnectable, gatesBuilt } = config;
  const key = `${pos.q},${pos.r}`;
  const tile = tiles.get(key);
  if (!tile) return null;

  const worldX = pos.q * 1.5;
  const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
  const baseY = tile.elevation * 0.5;

  const gateGroup = new THREE.Group();
  gateGroup.position.set(worldX, baseY, worldZ);
  gateGroup.name = `gate_${key}`;

  const wallColor = 0xf0ece0;
  const darkColor = 0xe8e0d0;
  const accentColor = owner === 0 ? 0x3498db : 0xe74c3c;

  // --- Gatehouse: detect adjacent gates to form wide gatehouse ---
  const neighbors = Pathfinder.getHexNeighbors(pos);
  const connectedDirs: { dx: number; dz: number }[] = [];
  const adjacentGateDirs: { dx: number; dz: number }[] = [];
  for (const n of neighbors) {
    const nKey = `${n.q},${n.r}`;
    const nWorldX = n.q * 1.5;
    const nWorldZ = n.r * 1.5 + (n.q % 2 === 1 ? 0.75 : 0);
    const dx = nWorldX - worldX;
    const dz = nWorldZ - worldZ;
    if (gatesBuilt.has(nKey)) {
      adjacentGateDirs.push({ dx, dz });
    }
    if (wallConnectable.has(nKey) && !gatesBuilt.has(nKey)) {
      connectedDirs.push({ dx, dz });
    }
  }

  // Determine passage orientation: perpendicular to wall/gate line
  let wallAngle = 0;
  const allDirs = [...connectedDirs, ...adjacentGateDirs];
  if (allDirs.length > 0) {
    const avgDx = allDirs.reduce((s, c) => s + c.dx, 0) / allDirs.length;
    const avgDz = allDirs.reduce((s, c) => s + c.dz, 0) / allDirs.length;
    wallAngle = Math.atan2(avgDx, avgDz);
  }

  // Check if this gate has an adjacent gate (wide gate mode)
  const hasAdjacentGate = adjacentGateDirs.length > 0;

  // Gatehouse tower body
  const bodyW = 0.95;
  const bodyH = 2.5;
  const bodyD = 0.95;

  if (hasAdjacentGate) {
    // Wide gate mode: open side toward adjacent gate, tower pillars on non-gate sides
    for (const gd of adjacentGateDirs) {
      const gateAngle = Math.atan2(gd.dx, gd.dz);
      const archW = 0.7;
      const archH = 1.4;
      const archGeo = new THREE.BoxGeometry(archW, archH, bodyD + 0.15);
      const archMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(gd.dx * 0.15, archH / 2, gd.dz * 0.15);
      arch.rotation.y = -gateAngle;
      gateGroup.add(arch);
    }

    // Thinner body since it merges with adjacent gate
    const thinGeo = new THREE.BoxGeometry(bodyW * 0.85, bodyH, bodyD * 0.85);
    const thinMat = new THREE.MeshLambertMaterial({ color: darkColor });
    const thinBody = new THREE.Mesh(thinGeo, thinMat);
    thinBody.position.y = bodyH / 2;
    thinBody.castShadow = true;
    gateGroup.add(thinBody);
  } else {
    // Single gate: full tower with passage
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    const bodyMat = new THREE.MeshLambertMaterial({ color: darkColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = bodyH / 2;
    body.castShadow = true;
    gateGroup.add(body);

    const passageW = 0.6;
    const passageH = 1.3;
    const passageGeo = new THREE.BoxGeometry(passageW, passageH, bodyD + 0.12);
    const passageMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const passage = new THREE.Mesh(passageGeo, passageMat);
    passage.position.y = passageH / 2;
    passage.rotation.y = wallAngle;
    gateGroup.add(passage);
  }

  // Crenellated top (wider than body for fortress look)
  const crenW = bodyW + 0.18;
  const crenD = bodyD + 0.18;
  const crenMat = new THREE.MeshLambertMaterial({ color: wallColor });
  const crenGeo = new THREE.BoxGeometry(crenW, 0.22, crenD);
  const cren = new THREE.Mesh(crenGeo, crenMat);
  cren.position.y = bodyH + 0.11;
  gateGroup.add(cren);

  // Four corner merlons on top
  const merlonGeo = new THREE.BoxGeometry(0.18, 0.28, 0.18);
  const merlonMat = new THREE.MeshLambertMaterial({ color: wallColor });
  for (const [ox, oz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const merlon = new THREE.Mesh(merlonGeo, merlonMat);
    merlon.position.set(ox * (crenW / 2 - 0.09), bodyH + 0.36, oz * (crenD / 2 - 0.09));
    gateGroup.add(merlon);
  }

  // Team-colored band around the base
  const bandGeo = new THREE.BoxGeometry(bodyW + 0.06, 0.15, bodyD + 0.06);
  const bandMat = new THREE.MeshLambertMaterial({ color: accentColor });
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.position.y = 0.08;
  gateGroup.add(band);

  // Team-colored banner flag on top
  const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = bodyH + 0.65;
  gateGroup.add(pole);

  const flagGeo = new THREE.PlaneGeometry(0.4, 0.25);
  const flagMat = new THREE.MeshLambertMaterial({ color: accentColor, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0.22, bodyH + 0.9, 0);
  gateGroup.add(flag);

  // Wall connection segments toward each connected neighbor (gap-free)
  const gWallH = 1.6;
  const gWallThickness = 0.45;
  for (const cn of connectedDirs) {
    const dist = Math.sqrt(cn.dx * cn.dx + cn.dz * cn.dz);
    const halfDist = dist / 2;
    const segLen = halfDist + 0.15;
    const angle = Math.atan2(cn.dx, cn.dz);

    // Look up neighbor elevation for height matching
    const nQ = Math.round(pos.q + cn.dx / 1.5);
    const nR = Math.round(pos.r + (cn.dz - (pos.q % 2 === 1 ? 0.75 : 0)) / 1.5);
    const nTile = tiles.get(`${nQ},${nR}`);
    const nBaseY = nTile ? nTile.elevation * 0.5 : baseY;
    const halfDy = (nBaseY - baseY) / 2;

    // Wall curtain
    const segGeo = new THREE.BoxGeometry(gWallThickness, gWallH, segLen);
    const segMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const seg = new THREE.Mesh(segGeo, segMat);
    seg.position.set(cn.dx / 4, gWallH / 2 + halfDy / 2, cn.dz / 4);
    seg.rotation.y = -angle;
    seg.castShadow = true;
    gateGroup.add(seg);

    // Crenellation
    const sCrenGeo = new THREE.BoxGeometry(gWallThickness + 0.12, 0.22, segLen);
    const sCren = new THREE.Mesh(sCrenGeo, crenMat);
    sCren.position.set(cn.dx / 4, gWallH + 0.11 + halfDy / 2, cn.dz / 4);
    sCren.rotation.y = -angle;
    gateGroup.add(sCren);

    // Team stripe
    const sStripeGeo = new THREE.BoxGeometry(gWallThickness + 0.06, 0.12, segLen);
    const sStripeMat = new THREE.MeshLambertMaterial({ color: accentColor });
    const sStripe = new THREE.Mesh(sStripeGeo, sStripeMat);
    sStripe.position.set(cn.dx / 4, 0.06 + halfDy / 2, cn.dz / 4);
    sStripe.rotation.y = -angle;
    gateGroup.add(sStripe);
  }

  return gateGroup;
}
