import * as THREE from 'three';
import { HexCoord, GameContext, Unit, ResourceType } from '../../types';
import { GAME_CONFIG } from '../GameConfig';

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
      this.ctx.hud.showNotification(`🪵 +${woodAmount} wood`, '#8b6914');
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleStoneDeposit(unit: Unit): void {
    const stoneAmount = unit.carryAmount;
    if (stoneAmount <= 0) return;

    this.ctx.stoneStockpile[unit.owner] += stoneAmount;
    this.ctx.players[unit.owner].resources.stone += stoneAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
      this.ctx.hud.showNotification(`🪨 +${stoneAmount} stone`, '#888888');
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
      this.ctx.hud.showNotification(`🌾 +${foodAmount} food`, '#daa520');
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
      this.ctx.hud.showNotification(`🌿 +${amount} grass fiber`, '#8bc34a');
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
      this.ctx.hud.showNotification(`🧱 +${amount} clay`, '#c2703e');
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleGoldDeposit(unit: Unit): void {
    const goldAmount = unit.carryAmount;
    if (goldAmount <= 0) return;

    this.ctx.goldStockpile[unit.owner] += goldAmount;
    this.ctx.players[unit.owner].resources.gold += goldAmount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
      this.ctx.hud.showNotification(`💰 +${goldAmount} gold`, '#ffd700');
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
      this.ctx.hud.showNotification(`⛏ +${ironAmount} iron`, '#b87333');
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleCrystalDeposit(unit: Unit): void {
    const amount = unit.carryAmount;
    if (amount <= 0) return;

    this.ctx.crystalStockpile[unit.owner] += amount;
    this.ctx.players[unit.owner].resources.crystal += amount;
    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
      this.ctx.hud.showNotification(`💎 +${amount} crystal`, '#9b59b6');
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  handleCropHarvest(unit: Unit, _farmPos: HexCoord): void {
    const foodYield = GAME_CONFIG.economy.harvest.crops.foodYield;
    unit.carryAmount = Math.min(foodYield, unit.carryCapacity);
    unit.carryType = ResourceType.FOOD;
  }

  craftRope(): void {
    const fiberNeeded = GAME_CONFIG.economy.recipes.rope.input.grass_fiber;
    const clayNeeded = GAME_CONFIG.economy.recipes.rope.input.clay;
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
    this.ctx.ropeStockpile[0] += GAME_CONFIG.economy.recipes.rope.output.rope;
    this.ctx.players[0].resources.rope += GAME_CONFIG.economy.recipes.rope.output.rope;
    this.updateHUD();
    this.ctx.hud.showNotification(`🪢 Crafted ${GAME_CONFIG.economy.recipes.rope.output.rope} rope (${this.ctx.ropeStockpile[0]} total)`, '#2ecc71');
  }

  craftCharcoal(): void {
    const woodNeeded = GAME_CONFIG.economy.recipes.charcoal.input.wood;
    const clayNeeded = GAME_CONFIG.economy.recipes.charcoal.input.clay;
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
    this.ctx.charcoalStockpile[0] += GAME_CONFIG.economy.recipes.charcoal.output.charcoal;
    this.ctx.players[0].resources.charcoal += GAME_CONFIG.economy.recipes.charcoal.output.charcoal;
    this.updateHUD();
    this.ctx.hud.showNotification(`⚫ Crafted ${GAME_CONFIG.economy.recipes.charcoal.output.charcoal} charcoal (${this.ctx.charcoalStockpile[0]} total)`, '#2ecc71');
  }

  smeltSteel(): void {
    const ironNeeded = GAME_CONFIG.economy.recipes.steel.input.iron;
    const charcoalNeeded = GAME_CONFIG.economy.recipes.steel.input.charcoal;

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
    this.ctx.steelStockpile[0] += GAME_CONFIG.economy.recipes.steel.output.steel;
    this.ctx.players[0].resources.steel += GAME_CONFIG.economy.recipes.steel.output.steel;
    this.updateHUD();
    this.ctx.hud.showNotification(`🔨 Smelted ${GAME_CONFIG.economy.recipes.steel.output.steel} steel (${this.ctx.steelStockpile[0]} total)`, '#2ecc71');
  }

  doSellWood(): void {
    const woodCost = GAME_CONFIG.economy.trade.sellWood.input.wood;
    const goldGain = GAME_CONFIG.economy.trade.sellWood.output.gold;
    if (this.ctx.woodStockpile[0] >= woodCost) {
      this.ctx.woodStockpile[0] -= woodCost;
      this.ctx.players[0].resources.wood -= woodCost;
      this.ctx.goldStockpile[0] += goldGain;
      this.ctx.players[0].resources.gold += goldGain;
      this.updateHUD();
      this.updateStockpileVisual(0);
      this.ctx.hud.showNotification(`💰 Sold ${woodCost} wood → ${goldGain} gold`, '#2ecc71');
    } else {
      this.ctx.hud.showNotification(`⚠️ Need ${woodCost} wood to sell! (have ${this.ctx.woodStockpile[0]})`, '#e67e22');
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

    // Gather all resource counts
    const resources: { name: string; count: number; color: number }[] = [
      { name: 'Wood',    count: this.ctx.woodStockpile[owner],       color: 0x8b6914 },
      { name: 'Stone',   count: this.ctx.stoneStockpile[owner],      color: 0x888888 },
      { name: 'Food',    count: this.ctx.foodStockpile[owner],       color: 0xdaa520 },
      { name: 'Iron',    count: this.ctx.ironStockpile[owner],       color: 0xb87333 },
      { name: 'Clay',    count: this.ctx.clayStockpile[owner],       color: 0xc2703e },
      { name: 'Fiber',   count: this.ctx.grassFiberStockpile[owner], color: 0x8bc34a },
      { name: 'Rope',    count: this.ctx.ropeStockpile[owner],       color: 0xc2b280 },
      { name: 'Coal',    count: this.ctx.charcoalStockpile[owner],   color: 0x333333 },
      { name: 'Steel',   count: this.ctx.steelStockpile[owner],      color: 0x71797e },
      { name: 'Crystal', count: this.ctx.crystalStockpile[owner],    color: 0x9b59b6 },
      { name: 'Gold',    count: this.ctx.goldStockpile[owner],       color: 0xffd700 },
    ];

    // Only show resources that have > 0
    const active = resources.filter(r => r.count > 0);
    if (active.length === 0) return;

    const group = new THREE.Group();
    const baseWorldX = base.position.q * 1.5;
    const baseWorldZ = base.position.r * 1.5 + (base.position.q % 2 === 1 ? 0.75 : 0);
    const baseY = this.ctx.getElevation(base.position);

    const offsetX = owner === 0 ? -2.5 : 2.5;
    group.position.set(baseWorldX + offsetX, baseY + 0.5, baseWorldZ);

    // Compact grid: 2 columns, rows spaced along Z axis
    const colSpacing = 1.6;
    const rowSpacing = 1.2;

    const createMiniPile = (count: number, color: number, name: string, gridX: number, gridZ: number) => {
      const pileGroup = new THREE.Group();
      pileGroup.position.set(gridX, 0, gridZ);

      // Small block pile — max 8 blocks in a 2x4 grid
      const blockCount = Math.min(Math.ceil(count / 10), 8);
      for (let i = 0; i < blockCount; i++) {
        const col = i % 2;
        const layer = Math.floor(i / 2);
        const blockGeo = new THREE.BoxGeometry(0.25, 0.15, 0.25);
        const blockMat = new THREE.MeshLambertMaterial({ color });
        const block = new THREE.Mesh(blockGeo, blockMat);
        block.position.set(col * 0.3 - 0.15, 0.1 + layer * 0.17, 0);
        block.castShadow = true;
        pileGroup.add(block);
      }

      // Floating label: "Name: count"
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 32;
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.clearRect(0, 0, 128, 32);
      ctx2d.fillStyle = '#ffffff';
      ctx2d.font = 'bold 16px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.fillText(`${name}: ${count}`, 64, 22);
      const texture = new THREE.CanvasTexture(canvas);
      const labelGeo = new THREE.PlaneGeometry(1.2, 0.3);
      const labelMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.y = 1.0;
      labelMesh.renderOrder = 999;
      pileGroup.add(labelMesh);

      return pileGroup;
    };

    active.forEach((res, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const gx = (col - 0.5) * colSpacing;
      const gz = (row - (active.length / 4)) * rowSpacing;
      const pile = createMiniPile(res.count, res.color, res.name, gx, gz);
      group.add(pile);
    });

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
