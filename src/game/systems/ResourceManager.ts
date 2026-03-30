import * as THREE from 'three';
import { HexCoord, GameContext, Unit, ResourceType } from '../../types';

class ResourceManager {
  ctx: GameContext;
  stockpileMeshes: Map<string, THREE.Group> = new Map();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  handleWoodDeposit(unit: Unit): void {
    const woodAmount = unit.carryAmount;
    if (woodAmount <= 0) return;

    this.ctx.woodStockpile[unit.owner] += woodAmount;
    this.ctx.players[unit.owner].resources.wood += woodAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleStoneDeposit(unit: Unit): void {
    const stoneAmount = unit.carryAmount;
    if (stoneAmount <= 0) return;

    this.ctx.stoneStockpile[unit.owner] += stoneAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleFoodDeposit(unit: Unit): void {
    const foodAmount = unit.carryAmount;
    if (foodAmount <= 0) return;

    this.ctx.foodStockpile[unit.owner] += foodAmount;
    this.ctx.players[unit.owner].resources.food += foodAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleGrassFiberDeposit(unit: Unit): void {
    const amount = unit.carryAmount;
    if (amount <= 0) return;
    this.ctx.grassFiberStockpile[unit.owner] += amount;
    this.ctx.players[unit.owner].resources.grass_fiber += amount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleClayDeposit(unit: Unit): void {
    const amount = unit.carryAmount;
    if (amount <= 0) return;
    this.ctx.clayStockpile[unit.owner] += amount;
    this.ctx.players[unit.owner].resources.clay += amount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleIronDeposit(unit: Unit): void {
    const ironAmount = unit.carryAmount;
    if (ironAmount <= 0) return;

    this.ctx.ironStockpile[unit.owner] += ironAmount;
    this.ctx.players[unit.owner].resources.iron += ironAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleCropHarvest(unit: Unit, _farmPos: HexCoord): void {
    const foodYield = 3;
    unit.carryAmount = Math.min(foodYield, unit.carryCapacity);
    unit.carryType = ResourceType.FOOD;
  }

  craftRope(): void {
    const fiberNeeded = 3;
    const clayNeeded = 2;
    if (this.ctx.grassFiberStockpile[0] < fiberNeeded || this.ctx.clayStockpile[0] < clayNeeded) {
      this.ctx.hud.showNotification(
        `⚠️ Need ${fiberNeeded} grass fiber + ${clayNeeded} clay to craft rope! (have ${this.ctx.grassFiberStockpile[0]} fiber, ${this.ctx.clayStockpile[0]} clay)`,
        '#e67e22'
      );
      return;
    }
    this.ctx.grassFiberStockpile[0] -= fiberNeeded;
    this.ctx.players[0].resources.grass_fiber -= fiberNeeded;
    this.ctx.clayStockpile[0] -= clayNeeded;
    this.ctx.players[0].resources.clay -= clayNeeded;
    this.ctx.ropeStockpile[0] += 1;
    this.ctx.players[0].resources.rope += 1;
    this.updateHUD();
    this.ctx.hud.showNotification(`🪢 Crafted 1 rope (${this.ctx.ropeStockpile[0]} total)`, '#2ecc71');
  }

  craftCharcoal(): void {
    const woodNeeded = 3;
    const clayNeeded = 2;
    if (this.ctx.woodStockpile[0] < woodNeeded || this.ctx.clayStockpile[0] < clayNeeded) {
      this.ctx.hud.showNotification(
        `⚠️ Need ${woodNeeded} wood + ${clayNeeded} clay to craft charcoal! (have ${this.ctx.woodStockpile[0]} wood, ${this.ctx.clayStockpile[0]} clay)`,
        '#e67e22'
      );
      return;
    }
    this.ctx.woodStockpile[0] -= woodNeeded;
    this.ctx.players[0].resources.wood -= woodNeeded;
    this.ctx.clayStockpile[0] -= clayNeeded;
    this.ctx.players[0].resources.clay -= clayNeeded;
    this.ctx.charcoalStockpile[0] += 2;
    this.ctx.players[0].resources.charcoal += 2;
    this.updateHUD();
    this.ctx.hud.showNotification(`⚫ Crafted 2 charcoal (${this.ctx.charcoalStockpile[0]} total)`, '#2ecc71');
  }

  smeltSteel(): void {
    const ironNeeded = 2;
    const charcoalNeeded = 1;

    // Check if smelter building exists
    const hasSmelter = this.ctx.hasBuilding('smelter', 0);
    if (!hasSmelter) {
      this.ctx.hud.showNotification(
        `⚠️ You need a smelter building to smelt steel!`,
        '#e67e22'
      );
      return;
    }

    if (this.ctx.ironStockpile[0] < ironNeeded || this.ctx.charcoalStockpile[0] < charcoalNeeded) {
      this.ctx.hud.showNotification(
        `⚠️ Need ${ironNeeded} iron + ${charcoalNeeded} charcoal to smelt steel! (have ${this.ctx.ironStockpile[0]} iron, ${this.ctx.charcoalStockpile[0]} charcoal)`,
        '#e67e22'
      );
      return;
    }
    this.ctx.ironStockpile[0] -= ironNeeded;
    this.ctx.players[0].resources.iron -= ironNeeded;
    this.ctx.charcoalStockpile[0] -= charcoalNeeded;
    this.ctx.players[0].resources.charcoal -= charcoalNeeded;
    this.ctx.steelStockpile[0] += 1;
    this.ctx.players[0].resources.steel += 1;
    this.updateHUD();
    this.ctx.hud.showNotification(`🔨 Smelted 1 steel (${this.ctx.steelStockpile[0]} total)`, '#2ecc71');
  }

  doSellWood(): void {
    if (this.ctx.woodStockpile[0] >= 4) {
      this.ctx.woodStockpile[0] -= 4;
      this.ctx.players[0].resources.wood -= 4;
      this.ctx.players[0].resources.gold += 5;
      this.updateHUD();
      this.updateStockpileVisual(0);
      this.ctx.hud.showNotification('💰 Sold 4 wood → 5 gold', '#2ecc71');
    } else {
      this.ctx.hud.showNotification(`⚠️ Need 4 wood to sell! (have ${this.ctx.woodStockpile[0]})`, '#e67e22');
    }
  }

  updateStockpileVisual(owner: number): void {
    const base = this.ctx.bases.find(b => b.owner === owner);
    if (!base) return;

    const stockKey = `stockpile_${owner}`;
    const oldGroup = this.stockpileMeshes.get(stockKey);
    if (oldGroup) {
      this.ctx.scene.remove(oldGroup);
      oldGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }

    const woodCount = this.ctx.woodStockpile[owner];
    const stoneCount = this.ctx.stoneStockpile[owner];
    const foodCount = this.ctx.foodStockpile[owner];

    if (woodCount <= 0 && stoneCount <= 0 && foodCount <= 0) return;

    const group = new THREE.Group();
    const baseWorldX = base.position.q * 1.5;
    const baseWorldZ = base.position.r * 1.5 + (base.position.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.ctx.getElevation(base.position);

    const offsetX = owner === 0 ? -2.5 : 2.5;
    group.position.set(baseWorldX + offsetX, baseY + 0.5, baseWorldZ);

    const createPile = (count: number, color: number, _label: string, posZ: number) => {
      if (count <= 0) return null;

      const pileGroup = new THREE.Group();
      pileGroup.position.z = posZ;

      const blockCount = Math.min(count, 20);
      for (let i = 0; i < blockCount; i++) {
        const row = i % 4;
        const layer = Math.floor(i / 4);
        const blockGeo = new THREE.BoxGeometry(0.4, 0.2, 0.4);
        const blockMat = new THREE.MeshLambertMaterial({ color });
        const block = new THREE.Mesh(blockGeo, blockMat);
        block.position.set(row * 0.45 - 0.7, 0.15 + layer * 0.22, 0);
        block.castShadow = true;
        pileGroup.add(block);
      }

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.fillStyle = '#fff';
      ctx2d.font = 'bold 20px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.fillText(`${count}`, 32, 24);
      const texture = new THREE.CanvasTexture(canvas);
      const labelGeo = new THREE.PlaneGeometry(1, 0.5);
      const labelMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.y = 1.5;
      labelMesh.renderOrder = 999;
      pileGroup.add(labelMesh);

      return pileGroup;
    };

    const foodPile = createPile(foodCount, 0xdaa520, 'Food', -1.5);
    if (foodPile) group.add(foodPile);

    const woodPile = createPile(woodCount, 0x8b6914, 'Wood', 0);
    if (woodPile) group.add(woodPile);

    const stonePile = createPile(stoneCount, 0x888888, 'Stone', 1.5);
    if (stonePile) group.add(stonePile);

    this.ctx.scene.add(group);
    this.stockpileMeshes.set(stockKey, group);
  }

  updateHUD(): void {
    this.ctx.hud.updateResources(
      this.ctx.players[0],
      this.ctx.woodStockpile[0],
      this.ctx.foodStockpile[0],
      this.ctx.stoneStockpile[0]
    );
  }

  cleanup(): void {
    this.stockpileMeshes.forEach((group) => {
      this.ctx.scene.remove(group);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    });
    this.stockpileMeshes.clear();
  }
}

export default ResourceManager;
