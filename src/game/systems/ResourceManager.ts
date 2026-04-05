import * as THREE from 'three';
import { HexCoord, GameContext, Unit, ResourceType } from '../../types';
import { GAME_CONFIG } from '../GameConfig';
import { StockpileResource, RESOURCE_DISPLAY } from '../ResourcePool';

export interface ResourceManagerOps {
  playSound(name: string, volume?: number): void;
}

/** Maps StockpileResource to the legacy stockpile array on GameContext */
const STOCKPILE_ARRAY_KEY: Record<StockpileResource, keyof GameContext> = {
  wood: 'woodStockpile',
  stone: 'stoneStockpile',
  food: 'foodStockpile',
  grass_fiber: 'grassFiberStockpile',
  clay: 'clayStockpile',
  rope: 'ropeStockpile',
  iron: 'ironStockpile',
  charcoal: 'charcoalStockpile',
  steel: 'steelStockpile',
  crystal: 'crystalStockpile',
  gold: 'goldStockpile',
};

class ResourceManager {
  ctx: GameContext;
  ops: ResourceManagerOps;
  stockpileMeshes: Map<string, THREE.Group> = new Map();

  constructor(ctx: GameContext, ops: ResourceManagerOps) {
    this.ctx = ctx;
    this.ops = ops;
  }

  // ── Unified deposit handler ────────────────────────────────
  /**
   * Generic resource deposit — one method for all 11 resource types.
   * Replaces the 8 individual handleXxxDeposit methods.
   */
  handleDeposit(unit: Unit, resource: StockpileResource): void {
    const amount = unit.carryAmount;
    if (amount <= 0) return;

    // Update stockpile array + player resources
    const arrKey = STOCKPILE_ARRAY_KEY[resource];
    (this.ctx[arrKey] as number[])[unit.owner] += amount;
    (this.ctx.players[unit.owner].resources as unknown as Record<string, number>)[resource] += amount;

    this.updateStockpileVisual(unit.owner);
    if (unit.owner === 0) {
      this.updateHUD();
      const display = RESOURCE_DISPLAY[resource];
      this.ctx.hud.showNotification(`${display.emoji} +${amount} ${display.label}`, display.color);
      if (display.soundName) {
        this.ops.playSound(display.soundName, 0.2);
      }
    }
    unit.carryAmount = 0;
    unit.carryType = null;
  }

  // ── Legacy convenience wrappers (delegate to handleDeposit) ──
  handleWoodDeposit(unit: Unit): void { this.handleDeposit(unit, 'wood'); }
  handleStoneDeposit(unit: Unit): void { this.handleDeposit(unit, 'stone'); }
  handleFoodDeposit(unit: Unit): void { this.handleDeposit(unit, 'food'); }
  handleGrassFiberDeposit(unit: Unit): void { this.handleDeposit(unit, 'grass_fiber'); }
  handleClayDeposit(unit: Unit): void { this.handleDeposit(unit, 'clay'); }
  handleGoldDeposit(unit: Unit): void { this.handleDeposit(unit, 'gold'); }
  handleIronDeposit(unit: Unit): void { this.handleDeposit(unit, 'iron'); }
  handleCrystalDeposit(unit: Unit): void { this.handleDeposit(unit, 'crystal'); }

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

    // Offset stockpile visual toward map center from base
    const centerQ = (this.ctx.bases.reduce((s, b) => s + b.position.q, 0) / Math.max(1, this.ctx.bases.length));
    const offsetX = base.position.q < centerQ ? 2.5 : -2.5;
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
