import * as THREE from 'three';
import { HexCoord, PlacedBuilding, BuildingKind, GameContext, TerrainType } from '../../types';
import { Pathfinder } from './Pathfinder';
import { UnitAI } from './UnitAI';

let nextBuildingId = 0;

class BuildingSystem {
  private ctx: GameContext;

  placedBuildings: PlacedBuilding[] = [];
  selectedBuilding: PlacedBuilding | null = null;
  buildingTooltipEl: HTMLElement | null = null;
  buildingSpawnIndex: Record<BuildingKind, number> = {
    barracks: 0,
    forestry: 0,
    masonry: 0,
    farmhouse: 0,
    workshop: 0,
    silo: 0
  };
  wallConnectable: Set<string> = new Set();
  barracksHealth: Map<string, number> = new Map();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  static bm(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }

  getFirstBuilding(kind: BuildingKind, owner = 0): { position: HexCoord; worldPosition: { x: number; y: number; z: number } } | null {
    const building = this.placedBuildings.find(b => b.kind === kind && b.owner === owner);
    if (!building) return null;
    return {
      position: building.position,
      worldPosition: building.worldPosition
    };
  }

  getBuildingsOfKind(kind: BuildingKind, owner = 0): PlacedBuilding[] {
    return this.placedBuildings.filter(b => b.kind === kind && b.owner === owner);
  }

  getNextSpawnBuilding(kind: BuildingKind, owner = 0): PlacedBuilding | null {
    const buildings = this.getBuildingsOfKind(kind, owner);
    if (buildings.length === 0) return null;
    const idx = this.buildingSpawnIndex[kind];
    const building = buildings[idx % buildings.length];
    this.buildingSpawnIndex[kind] = (idx + 1) % buildings.length;
    return building;
  }

  getBuildingAt(pos: HexCoord, owner?: number): PlacedBuilding | null {
    const key = `${pos.q},${pos.r}`;
    const building = this.placedBuildings.find(b => `${b.position.q},${b.position.r}` === key);
    if (!building) return null;
    if (owner !== undefined && building.owner !== owner) return null;
    return building;
  }

  registerBuilding(kind: BuildingKind, owner: number, pos: HexCoord, mesh: THREE.Group, maxHealth = 40): PlacedBuilding {
    const pb: PlacedBuilding = {
      id: `bld_${nextBuildingId++}`,
      kind,
      owner,
      position: pos,
      worldPosition: this.ctx.hexToWorld(pos),
      mesh,
      maxHealth,
      health: maxHealth
    };
    this.placedBuildings.push(pb);
    const key = `${pos.q},${pos.r}`;
    this.wallConnectable.add(key);
    this.barracksHealth.set(pb.id, maxHealth);
    Pathfinder.blockedTiles.add(key);
    return pb;
  }

  unregisterBuilding(pb: PlacedBuilding, rebuildWallMeshCallback?: (pos: HexCoord, owner: number) => void): void {
    const idx = this.placedBuildings.indexOf(pb);
    if (idx !== -1) {
      this.placedBuildings.splice(idx, 1);
    }
    const key = `${pb.position.q},${pb.position.r}`;
    this.wallConnectable.delete(key);
    this.barracksHealth.delete(pb.id);
    Pathfinder.blockedTiles.delete(key);
    if (pb.mesh.parent) {
      pb.mesh.parent.remove(pb.mesh);
    }
    this.ctx.scene.remove(pb.mesh);

    if (rebuildWallMeshCallback) {
      const neighbors = Pathfinder.getHexNeighbors(pb.position);
      for (const neighbor of neighbors) {
        rebuildWallMeshCallback(neighbor, pb.owner);
      }
    }

    if (this.selectedBuilding === pb) {
      this.selectedBuilding = null;
    }
  }

  createBuildingGroup(pos: HexCoord, owner: number, name: string): THREE.Group {
    const g = new THREE.Group();
    const worldX = pos.q * 1.5;
    const worldZ = pos.r * 1.5 + (pos.q % 2 === 1 ? 0.75 : 0);
    g.position.set(worldX, this.ctx.getElevation(pos), worldZ);
    g.name = `${name}_${owner}`;
    return g;
  }

  buildForestryMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'forestry');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xe8dcc8;
    const dark = 0x3a5a28;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.5, 0.25, 1.5), new THREE.MeshLambertMaterial({ color: 0x7f8c8d }), 0, 0.12, 0));
    const hall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.0), new THREE.MeshLambertMaterial({ color: stucco }));
    hall.position.y = 0.85;
    hall.castShadow = true;
    g.add(hall);
    for (const side of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 1.15), new THREE.MeshLambertMaterial({ color: dark }));
      slab.position.set(side * 0.28, 1.65, 0);
      slab.rotation.z = side * 0.45;
      g.add(slab);
    }
    g.add(B(new THREE.BoxGeometry(0.08, 0.08, 1.15), new THREE.MeshLambertMaterial({ color: 0x5a3a1a }), 0, 1.88, 0));
    g.add(B(new THREE.BoxGeometry(0.4, 0.65, 0.12), new THREE.MeshLambertMaterial({ color: 0x2c1810 }), 0, 0.57, 0.52));
    const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), logMat);
      log.position.set(0.62, 0.4 + i * 0.14, 0);
      g.add(log);
    }
    g.add(B(new THREE.BoxGeometry(1.25, 0.1, 1.05), new THREE.MeshLambertMaterial({ color: 0x4a7c3a }), 0, 1.46, 0));
    g.add(B(new THREE.BoxGeometry(1.4, 0.1, 1.4), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.3, 0));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  buildBarracksMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'barracks');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xc8b89a;
    const stone2 = 0xbaa888;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.6, 0.3, 1.6), new THREE.MeshLambertMaterial({ color: 0x7f8c8d }), 0, 0.15, 0));
    const hallA = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.8), new THREE.MeshLambertMaterial({ color: stucco }));
    hallA.position.set(0, 0.95, -0.15);
    hallA.castShadow = true;
    g.add(hallA);
    const hallB = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.7), new THREE.MeshLambertMaterial({ color: stone2 }));
    hallB.position.set(-0.3, 0.85, 0.4);
    hallB.castShadow = true;
    g.add(hallB);
    g.add(B(new THREE.BoxGeometry(1.4, 0.12, 0.9), new THREE.MeshLambertMaterial({ color: 0xa09078 }), 0, 1.66, -0.15));
    const cMat = new THREE.MeshLambertMaterial({ color: stucco });
    for (const [cx, cz] of [
      [-0.6, -0.55],
      [-0.3, -0.55],
      [0, -0.55],
      [0.3, -0.55],
      [0.6, -0.55],
      [-0.6, 0.25],
      [-0.3, 0.25],
      [0, 0.25],
      [0.3, 0.25],
      [0.6, 0.25]
    ]) {
      g.add(B(new THREE.BoxGeometry(0.15, 0.22, 0.15), cMat, cx, 1.82, cz));
    }
    g.add(B(new THREE.BoxGeometry(0.5, 0.7, 0.15), new THREE.MeshLambertMaterial({ color: 0x2c2218 }), 0.15, 0.65, 0.26));
    const sMat = new THREE.MeshLambertMaterial({ color: 0x8899aa });
    const sGeo = new THREE.BoxGeometry(0.04, 0.7, 0.04);
    const s1 = new THREE.Mesh(sGeo, sMat);
    s1.position.set(0.67, 0.9, 0);
    s1.rotation.z = 0.2;
    g.add(s1);
    const s2 = new THREE.Mesh(sGeo, sMat);
    s2.position.set(0.67, 0.9, 0);
    s2.rotation.z = -0.2;
    g.add(s2);
    g.add(B(new THREE.BoxGeometry(0.25, 0.25, 0.05), new THREE.MeshLambertMaterial({ color: tc }), -0.25, 1.2, 0.42));
    g.add(B(new THREE.BoxGeometry(1.5, 0.1, 1.5), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.35, 0));
    const pMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    g.add(B(new THREE.BoxGeometry(0.06, 0.6, 0.06), pMat, 0.5, 0.6, 0.5));
    g.add(B(new THREE.BoxGeometry(0.35, 0.05, 0.05), pMat, 0.5, 0.8, 0.5));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  buildMasonryMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'masonry');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xd5cbb8;
    const stone = 0x9a9080;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.5, 0.25, 1.5), new THREE.MeshLambertMaterial({ color: 0x7f8c8d }), 0, 0.12, 0));
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 1.5, 8), new THREE.MeshLambertMaterial({ color: stucco }));
    tower.position.y = 1.0;
    tower.castShadow = true;
    g.add(tower);
    g.add(B(new THREE.CylinderGeometry(0.7, 0.7, 0.15, 8), new THREE.MeshLambertMaterial({ color: stone }), 0, 1.82, 0));
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), new THREE.MeshLambertMaterial({ color: stucco }));
      m.position.set(Math.cos(angle) * 0.55, 1.98, Math.sin(angle) * 0.55);
      g.add(m);
    }
    g.add(B(new THREE.BoxGeometry(0.18, 0.8, 0.18), new THREE.MeshLambertMaterial({ color: stone }), 0.5, 1.9, 0));
    g.add(B(new THREE.BoxGeometry(0.35, 0.6, 0.15), new THREE.MeshLambertMaterial({ color: 0x2c2218 }), 0, 0.55, 0.6));
    const bMat = new THREE.MeshLambertMaterial({ color: 0xb0a898 });
    for (let i = 0; i < 4; i++) {
      g.add(B(new THREE.BoxGeometry(0.2, 0.2, 0.2), bMat, -0.55 + (i % 2) * 0.22, 0.35 + Math.floor(i / 2) * 0.22, 0.35));
    }
    g.add(B(new THREE.BoxGeometry(1.4, 0.1, 1.4), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.3, 0));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  buildFarmhouseMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'farmhouse');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xe0d0a8;
    const barn = 0x8b3a2a;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.5, 0.2, 1.5), new THREE.MeshLambertMaterial({ color: 0x7f8c8d }), 0, 0.1, 0));
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), new THREE.MeshLambertMaterial({ color: stucco }));
    body.position.y = 0.7;
    body.castShadow = true;
    g.add(body);
    for (const side of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.1), new THREE.MeshLambertMaterial({ color: barn }));
      slab.position.set(side * 0.32, 1.38, 0);
      slab.rotation.z = side * 0.38;
      g.add(slab);
    }
    g.add(B(new THREE.BoxGeometry(0.1, 0.1, 1.1), new THREE.MeshLambertMaterial({ color: 0x5a2a1a }), 0, 1.58, 0));
    g.add(B(new THREE.BoxGeometry(0.55, 0.65, 0.1), new THREE.MeshLambertMaterial({ color: 0x5a3018 }), 0, 0.52, 0.52));
    const hayMat = new THREE.MeshLambertMaterial({ color: 0xd4b45c });
    g.add(B(new THREE.BoxGeometry(0.25, 0.2, 0.25), hayMat, 0.5, 0.3, 0.45));
    g.add(B(new THREE.BoxGeometry(0.25, 0.2, 0.25), hayMat, 0.5, 0.5, 0.45));
    const vaneMat = new THREE.MeshLambertMaterial({ color: 0x9a8a6a });
    const vGeo = new THREE.BoxGeometry(0.03, 0.5, 0.03);
    const v1 = new THREE.Mesh(vGeo, vaneMat);
    v1.position.set(0, 1.9, 0);
    v1.rotation.z = 0.78;
    g.add(v1);
    const v2 = new THREE.Mesh(vGeo, vaneMat);
    v2.position.set(0, 1.9, 0);
    v2.rotation.z = -0.78;
    g.add(v2);
    g.add(B(new THREE.BoxGeometry(1.4, 0.1, 1.4), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.25, 0));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  buildWorkshopMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'workshop');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xc0b098;
    const iron = 0x5a5550;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.6, 0.25, 1.6), new THREE.MeshLambertMaterial({ color: 0x606060 }), 0, 0.12, 0));
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.3), new THREE.MeshLambertMaterial({ color: stucco }));
    body.position.y = 0.85;
    body.castShadow = true;
    g.add(body);
    g.add(B(new THREE.BoxGeometry(1.55, 0.15, 1.45), new THREE.MeshLambertMaterial({ color: iron }), 0, 1.52, 0));
    for (const z of [-0.4, 0, 0.4]) {
      g.add(B(new THREE.BoxGeometry(1.55, 0.06, 0.08), new THREE.MeshLambertMaterial({ color: 0x4a4540 }), 0, 1.62, z));
    }
    g.add(B(new THREE.BoxGeometry(0.22, 1.2, 0.22), new THREE.MeshLambertMaterial({ color: 0x5a5048 }), -0.55, 1.8, -0.45));
    g.add(B(new THREE.BoxGeometry(0.28, 0.1, 0.28), new THREE.MeshLambertMaterial({ color: iron }), -0.55, 2.45, -0.45));
    g.add(B(new THREE.BoxGeometry(0.55, 0.75, 0.12), new THREE.MeshLambertMaterial({ color: 0x2a1c10 }), 0, 0.62, 0.68));
    g.add(B(new THREE.BoxGeometry(0.3, 0.08, 0.2), new THREE.MeshLambertMaterial({ color: 0x404040 }), 0.6, 0.42, 0.5));
    g.add(B(new THREE.BoxGeometry(0.15, 0.3, 0.15), new THREE.MeshLambertMaterial({ color: 0x505050 }), 0.6, 0.23, 0.5));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 12), new THREE.MeshLambertMaterial({ color: 0xc9a96e }));
    coil.position.set(-0.6, 0.6, 0.5);
    coil.rotation.y = Math.PI / 2;
    g.add(coil);
    g.add(B(new THREE.BoxGeometry(1.5, 0.1, 1.5), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.3, 0));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  buildSiloMesh(pos: HexCoord, owner: number): THREE.Group {
    const g = this.createBuildingGroup(pos, owner, 'silo');
    const tc = owner === 0 ? 0x3498db : 0xe74c3c;
    const stucco = 0xe0d8c8;
    const B = BuildingSystem.bm;

    g.add(B(new THREE.BoxGeometry(1.3, 0.2, 1.3), new THREE.MeshLambertMaterial({ color: 0x7f8c8d }), 0, 0.1, 0));
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 2.2, 8), new THREE.MeshLambertMaterial({ color: stucco }));
    tower.position.y = 1.3;
    tower.castShadow = true;
    g.add(tower);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xb8b0a0 });
    for (const y of [0.6, 1.3, 2.0]) {
      g.add(B(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 8), bandMat, 0, y, 0));
    }
    g.add(B(new THREE.ConeGeometry(0.5, 0.6, 8), new THREE.MeshLambertMaterial({ color: 0xc0b098 }), 0, 2.7, 0));
    const slitMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      g.add(B(new THREE.BoxGeometry(0.06, 0.2, 0.06), slitMat, Math.cos(angle) * 0.45, 1.5, Math.sin(angle) * 0.45));
    }
    g.add(B(new THREE.BoxGeometry(1.2, 0.1, 1.2), new THREE.MeshLambertMaterial({ color: tc }), 0, 0.25, 0));

    this.ctx.scene.add(g);
    Pathfinder.blockedTiles.add(`${pos.q},${pos.r}`);
    return g;
  }

  showBuildingTooltip(
    pb: PlacedBuilding,
    screenX: number,
    screenY: number,
    queueCallback: (type: string, building: string) => void,
    rallyCallback: (pb: PlacedBuilding) => void,
    demolishCallback: (pb: PlacedBuilding) => void
  ): void {
    this.hideBuildingTooltip();

    const tooltip = document.createElement('div');
    tooltip.style.position = 'fixed';
    tooltip.style.left = screenX + 'px';
    tooltip.style.top = screenY + 'px';
    tooltip.style.backgroundColor = '#1a1a1a';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '8px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '12px';
    tooltip.style.zIndex = '1000';
    tooltip.style.maxWidth = '200px';
    tooltip.style.border = '1px solid #555';

    const healthPercent = ((pb.health / pb.maxHealth) * 100).toFixed(0);

    let html = `
      <div style="margin-bottom: 8px;">
        <strong>${pb.kind.charAt(0).toUpperCase() + pb.kind.slice(1)}</strong><br/>
        Owner: ${pb.owner}<br/>
        Health: ${pb.health}/${pb.maxHealth} (${healthPercent}%)
      </div>
    `;

    const queueOptions = this.getBuildingQueueOptions(pb.kind);
    if (queueOptions.length > 0) {
      html += '<div style="margin-bottom: 8px;"><strong>Queue:</strong><br/>';
      for (const option of queueOptions) {
        html += `<button style="width: 100%; text-align: left; margin: 2px 0; padding: 4px; background: #333; border: 1px solid #666; color: #fff; cursor: pointer;" data-type="${option.type}" data-building="${pb.id}">${option.label} (${option.costLabel})</button>`;
      }
      html += '</div>';
    }

    html += `
      <button style="width: 100%; margin: 2px 0; padding: 4px; background: #4a7c3a; border: 1px solid #666; color: #fff; cursor: pointer;" data-action="rally" data-building="${pb.id}">Rally Point</button>
      <button style="width: 100%; margin: 2px 0; padding: 4px; background: #c0392b; border: 1px solid #666; color: #fff; cursor: pointer;" data-action="demolish" data-building="${pb.id}">Demolish</button>
    `;

    tooltip.innerHTML = html;

    const queueButtons = tooltip.querySelectorAll('button[data-type]');
    queueButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = (e.target as HTMLElement).getAttribute('data-type');
        if (type) {
          queueCallback(type, pb.id);
          this.hideBuildingTooltip();
        }
      });
    });

    const actionButtons = tooltip.querySelectorAll('button[data-action]');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = (e.target as HTMLElement).getAttribute('data-action');
        if (action === 'rally') {
          rallyCallback(pb);
        } else if (action === 'demolish') {
          demolishCallback(pb);
        }
        this.hideBuildingTooltip();
      });
    });

    document.body.appendChild(tooltip);
    this.buildingTooltipEl = tooltip;
  }

  hideBuildingTooltip(): void {
    if (this.buildingTooltipEl) {
      this.buildingTooltipEl.remove();
      this.buildingTooltipEl = null;
    }
  }

  getBuildingQueueOptions(kind: BuildingKind): { type: string; label: string; costLabel: string }[] {
    switch (kind) {
      case 'barracks':
        return [
          { type: 'warrior', label: 'Warrior', costLabel: '5g' },
          { type: 'archer', label: 'Archer', costLabel: '8g' },
          { type: 'rider', label: 'Rider', costLabel: '10g' },
          { type: 'paladin', label: 'Paladin', costLabel: '6g' }
        ];
      case 'forestry':
        return [
          { type: 'lumberjack', label: 'Lumberjack', costLabel: '3w' },
          { type: 'scout', label: 'Scout', costLabel: '6w' }
        ];
      case 'masonry':
        return [{ type: 'builder', label: 'Builder', costLabel: '3w' }];
      case 'farmhouse':
        return [{ type: 'villager', label: 'Villager', costLabel: '2w' }];
      case 'workshop':
        return [
          { type: 'trebuchet', label: 'Trebuchet', costLabel: '3r+5s+5w' },
          { type: 'catapult', label: 'Catapult', costLabel: '2r+3s+4w' }
        ];
      case 'silo':
        return [];
      default:
        return [];
    }
  }

  aiFindBuildTile(baseQ: number, baseR: number, offsetQ: number, offsetR: number): HexCoord | null {
    const targetQ = baseQ + offsetQ;
    const targetR = baseR + offsetR;

    for (let radius = 0; radius <= 10; radius++) {
      for (let q = targetQ - radius; q <= targetQ + radius; q++) {
        for (let r = targetR - radius; r <= targetR + radius; r++) {
          if (Math.max(Math.abs(q - targetQ), Math.abs(r - targetR), Math.abs(-q - r - (-targetQ - targetR))) !== radius) {
            continue;
          }

          const pos: HexCoord = { q, r };
          const key = `${q},${r}`;

          const tile = this.ctx.currentMap?.tiles.get(key);
          if (!tile || tile.terrain !== TerrainType.PLAINS) {
            continue;
          }
          if (Pathfinder.blockedTiles.has(key)) {
            continue;
          }
          if (this.getBuildingAt(pos)) {
            continue;
          }

          return pos;
        }
      }
    }

    return null;
  }

  cleanup(): void {
    for (const pb of this.placedBuildings) {
      if (pb.mesh.parent) {
        pb.mesh.parent.remove(pb.mesh);
      }
      this.ctx.scene.remove(pb.mesh);
    }
    this.placedBuildings = [];
    this.selectedBuilding = null;
    this.wallConnectable.clear();
    this.barracksHealth.clear();
    nextBuildingId = 0;
    this.hideBuildingTooltip();
  }
}

export default BuildingSystem;
