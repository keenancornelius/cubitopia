/**
 * CombatEventHandler — Processes combat events from UnitAI.update().
 * Handles damage visuals, projectiles, unit deaths, special effects (AoE, cleave),
 * experience/level-up, building damage, and worker task events.
 * Extracted from main.ts to reduce central orchestrator size.
 */

import { Unit, UnitType, UnitState, HexCoord, ResourceType, Player, PlacedBuilding, BuildingKind } from '../../types';
import { UnitEvent } from './UnitAI';

/** Slim interface — only what CombatEventHandler needs from the outside */
export interface CombatEventOps {
  // Game state
  getPlayers(): Player[];
  getAllUnits(): Unit[];
  getDebugFlags(): { godMode: boolean; disableCombat: boolean; disableBuild: boolean; disableChop: boolean; disableDeposit: boolean; disableMine: boolean; disableHarvest: boolean };

  // Stockpiles (for HUD resource update)
  getWoodStockpile(): number[];
  getFoodStockpile(): number[];
  getStoneStockpile(): number[];

  // Unit lifecycle
  removeUnitFromGame(unit: Unit, killer?: Unit): void;

  // Visual feedback — UnitRenderer facade
  updateHealthBar(unit: Unit): void;
  showDamageEffect(worldPos: { x: number; y: number; z: number }): void;
  flashUnit(unitId: string, duration: number): void;
  queueDeferredEffect(delayMs: number, callback: () => void): void;
  fireArrow(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireMagicOrb(from: any, to: any, color: number, targetId: string, isSplash: boolean, onImpact: () => void): void;
  fireBoulder(from: any, to: any, onImpact: () => void): void;
  fireProjectile(from: any, to: any, color: number, targetId: string, onImpact: () => void): void;
  showXPText(worldPos: any, xp: number): void;
  showLevelUpEffect(unitId: string, worldPos: any, newLevel: number): void;

  // Audio
  playSound(name: string, volume?: number): void;

  // HUD
  showNotification(message: string, color: string): void;
  updateResources(player: Player, wood: number, food: number, stone: number): void;

  // Hex helpers
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };

  // Building/wall system
  getBuildingAt(position: HexCoord): PlacedBuilding | null;
  damageBarracks(position: HexCoord, damage: number): boolean;
  damageGate(position: HexCoord, damage: number): boolean;
  damageWall(position: HexCoord, damage: number): boolean;
  isGateAt(key: string): boolean;
  /** Called when a structure is destroyed — ejects garrisoned units */
  onStructureDestroyed(structureKey: string): void;

  // Worker event handlers
  handleBuildWall(unit: Unit, position: HexCoord): void;
  handleBuildGate(unit: Unit, position: HexCoord): void;
  handleChopWood(unit: Unit, position: HexCoord): void;
  handleWoodDeposit(unit: Unit): void;
  handleMineTerrain(unit: Unit, position: HexCoord): void;
  handleStoneDeposit(unit: Unit): void;
  handleClayDeposit(unit: Unit): void;
  handleGrassFiberDeposit(unit: Unit): void;
  handleIronDeposit(unit: Unit): void;
  handleCrystalDeposit(unit: Unit): void;
  handleGoldDeposit(unit: Unit): void;
  handleCropHarvest(unit: Unit, position: HexCoord): void;
  handleHarvestGrass(unit: Unit, position: HexCoord): void;
  handleFoodDeposit(unit: Unit): void;
  isPlayerGateBlueprint(key: string): boolean;
}

export default class CombatEventHandler {
  private ops: CombatEventOps;

  constructor(ops: CombatEventOps) {
    this.ops = ops;
  }

  /** Process all events from UnitAI.update() */
  processEvents(events: UnitEvent[]): void {
    const ops = this.ops;
    const debugFlags = ops.getDebugFlags();

    for (const event of events) {
      // ─── God mode: prevent player units (owner 0) from dying/taking damage ───
      if (debugFlags.godMode) {
        if (event.type === 'unit:killed' && event.unit && event.unit.owner === 0) {
          event.unit.currentHealth = event.unit.stats.maxHealth;
          continue;
        }
        if (event.type === 'combat' && event.defender && event.defender.owner === 0) {
          event.defender.currentHealth = event.defender.stats.maxHealth;
        }
        if (event.type === 'combat' && event.attacker && event.attacker.owner === 0) {
          event.attacker.currentHealth = event.attacker.stats.maxHealth;
        }
      }

      // ─── Unit killed ───
      if (event.type === 'unit:killed' && event.unit) {
        if (event.killer && event.unit) {
          const killerOwner = event.killer.owner;
          const goldReward = event.unit.type === UnitType.TREBUCHET || event.unit.type === UnitType.CATAPULT ? 5 : 3;
          ops.getPlayers()[killerOwner].resources.gold += goldReward;
          if (killerOwner === 0) {
            ops.showNotification(`💰 +${goldReward} gold`, '#FFD700');
            ops.updateResources(ops.getPlayers()[0], ops.getWoodStockpile()[0], ops.getFoodStockpile()[0], ops.getStoneStockpile()[0]);
          }
        }

        const killerIsRanged = event.killer && event.killer.stats.range > 1;
        if (killerIsRanged) {
          (event.unit as any)._pendingKillVisual = true;
          (event.unit as any)._killer = event.killer;
        } else {
          const unit = event.unit;
          const killer = event.killer;
          ops.queueDeferredEffect(180, () => {
            ops.removeUnitFromGame(unit, killer);
            ops.playSound('death');
          });
        }
      }

      // ─── Combat (melee / ranged) ───
      if (event.type === 'combat' && event.attacker && event.defender && !debugFlags.disableCombat) {
        const isRangedAttack = event.attacker.stats.range > 1;

        // Determine sound
        let hitSound: string = 'hit_melee';
        if (event.attacker.type === UnitType.TREBUCHET || event.attacker.type === UnitType.CATAPULT) {
          hitSound = 'hit_siege';
        } else if (event.attacker.stats.range > 1) {
          hitSound = 'hit_ranged';
        } else if (event.attacker.type === UnitType.ASSASSIN) {
          hitSound = 'assassin_strike';
        } else if (event.attacker.type === UnitType.RIDER || event.attacker.type === UnitType.SCOUT) {
          hitSound = 'hit_pierce';
        } else if (event.attacker.type === UnitType.BERSERKER || event.attacker.type === UnitType.LUMBERJACK
                || event.attacker.type === UnitType.GREATSWORD) {
          hitSound = 'hit_cleave';
        } else if (event.attacker.type === UnitType.SHIELDBEARER || event.attacker.type === UnitType.PALADIN
                || event.attacker.type === UnitType.BATTLEMAGE) {
          hitSound = 'hit_blunt';
        }

        const attacker = event.attacker;
        const defender = event.defender;
        const applyDamageVisuals = () => {
          ops.updateHealthBar(attacker);
          ops.updateHealthBar(defender);
          ops.showDamageEffect(defender.worldPosition);
          ops.flashUnit(defender.id, 0.15);
          ops.playSound(hitSound as any);
          if (hitSound === 'assassin_strike') ops.playSound('hit_pierce');
          if ((defender as any)._pendingKillVisual) {
            (defender as any)._pendingKillVisual = false;
            ops.removeUnitFromGame(defender, (defender as any)._killer);
            ops.playSound('death');
          }
        };

        if (isRangedAttack) {
          const defId = event.defender.id;
          if (event.attacker.type === UnitType.ARCHER) {
            ops.fireArrow(event.attacker.worldPosition, event.defender.worldPosition, defId, applyDamageVisuals);
          } else if (event.attacker.type === UnitType.MAGE) {
            ops.fireMagicOrb(event.attacker.worldPosition, event.defender.worldPosition, 0x2980b9, defId, false, applyDamageVisuals);
          } else if (event.attacker.type === UnitType.BATTLEMAGE) {
            ops.fireMagicOrb(event.attacker.worldPosition, event.defender.worldPosition, 0x7c4dff, defId, true, applyDamageVisuals);
            ops.playSound('splash_aoe');
          } else if (event.attacker.type === UnitType.TREBUCHET || event.attacker.type === UnitType.CATAPULT) {
            ops.fireBoulder(event.attacker.worldPosition, event.defender.worldPosition, applyDamageVisuals);
          } else {
            ops.fireProjectile(event.attacker.worldPosition, event.defender.worldPosition, 0xFF8800, defId, applyDamageVisuals);
          }
          ops.updateHealthBar(event.attacker);
        } else {
          ops.queueDeferredEffect(200, applyDamageVisuals);
        }
      }

      // ─── Battlemage AoE splash ───
      if ((event as any).type === 'combat:splash') {
        const splashEvt = event as any;
        const victim = ops.getAllUnits().find(u => u.id === splashEvt.unitId);
        if (victim) {
          ops.updateHealthBar(victim);
          ops.showDamageEffect(victim.worldPosition);
          ops.flashUnit(victim.id, 0.12);
          if (victim.currentHealth <= 0) {
            ops.removeUnitFromGame(victim, undefined);
            ops.playSound('death');
          }
        }
      }

      // ─── Greatsword cleave knockback ───
      if ((event as any).type === 'combat:cleave') {
        const ce = event as any;
        const victim = ops.getAllUnits().find(u => u.id === ce.unitId);
        if (victim && victim.state !== UnitState.DEAD) {
          victim.position = { q: ce.knockQ, r: ce.knockR };
          const wp = ops.hexToWorld(victim.position);
          victim.worldPosition = { x: wp.x, y: wp.y, z: wp.z };
          ops.updateHealthBar(victim);
          ops.showDamageEffect(victim.worldPosition);
          ops.flashUnit(victim.id, 0.12);
          ops.playSound('hit_cleave');
        }
      }

      // ─── XP gained ───
      if ((event as any).type === 'combat:xp') {
        const xpEvt = event as any;
        const unit = ops.getAllUnits().find(u => u.id === xpEvt.unitId);
        if (unit) {
          ops.showXPText(unit.worldPosition, xpEvt.xp);
        }
      }

      // ─── Level-up ───
      if ((event as any).type === 'combat:levelup') {
        const lvlEvt = event as any;
        const unit = ops.getAllUnits().find(u => u.id === lvlEvt.unitId);
        if (unit) {
          ops.showLevelUpEffect(unit.id, unit.worldPosition, lvlEvt.newLevel);
          ops.updateHealthBar(unit);
          ops.playSound('level_up', 0.5);
        }
      }

      // ─── Heal ───
      if ((event as any).type === 'heal') {
        ops.playSound('heal', 0.4);
      }

      // ─── Builder: place wall ───
      if (event.type === 'builder:place_wall' && event.result && !debugFlags.disableBuild) {
        const key = `${event.result.position.q},${event.result.position.r}`;
        if (ops.isPlayerGateBlueprint(key)) {
          ops.handleBuildGate(event.unit!, event.result.position);
        } else {
          ops.handleBuildWall(event.unit!, event.result.position);
        }
      }
      if (event.type === 'builder:place_gate' && event.result && !debugFlags.disableBuild) {
        ops.handleBuildGate(event.unit!, event.result.position);
      }

      // ─── Lumberjack ───
      if (event.type === 'lumberjack:chop' && event.result && !debugFlags.disableChop) {
        ops.handleChopWood(event.unit!, event.result.position);
      }
      if (event.type === 'lumberjack:deposit' && event.unit && !debugFlags.disableDeposit) {
        ops.handleWoodDeposit(event.unit!);
      }

      // ─── Builder: mine ───
      if (event.type === 'builder:mine' && event.result && !debugFlags.disableMine) {
        ops.handleMineTerrain(event.unit!, event.result.position);
      }
      if (event.type === 'builder:deposit_stone' && event.unit && !debugFlags.disableDeposit) {
        if (event.unit!.carryType === ResourceType.CLAY) {
          ops.handleClayDeposit(event.unit!);
        } else if (event.unit!.carryType === ResourceType.GRASS_FIBER) {
          ops.handleGrassFiberDeposit(event.unit!);
        } else if (event.unit!.carryType === ResourceType.IRON) {
          ops.handleIronDeposit(event.unit!);
        } else if (event.unit!.carryType === ResourceType.CRYSTAL) {
          ops.handleCrystalDeposit(event.unit!);
        } else if (event.unit!.carryType === ResourceType.GOLD) {
          ops.handleGoldDeposit(event.unit!);
        } else {
          ops.handleStoneDeposit(event.unit!);
        }
      }

      // ─── Villager ───
      if (event.type === 'villager:harvest' && event.result && !debugFlags.disableHarvest) {
        ops.handleCropHarvest(event.unit!, event.result.position);
      }
      if (event.type === 'villager:harvest_grass' && event.result && !debugFlags.disableHarvest) {
        ops.handleHarvestGrass(event.unit!, event.result.position);
      }
      if (event.type === 'villager:deposit' && event.unit && !debugFlags.disableDeposit) {
        ops.handleFoodDeposit(event.unit!);
      }

      // ─── Attack building/wall ───
      if (event.type === 'unit:attack_wall' && event.unit && event.result) {
        const key = `${event.result.position.q},${event.result.position.r}`;
        const isSiege = event.unit.isSiege === true;
        const baseDmg = event.unit.stats.attack;
        const pb = ops.getBuildingAt(event.result.position);
        let destroyed = false;
        if (pb) {
          const dmg = isSiege ? baseDmg : Math.max(1, Math.floor(baseDmg * 0.15));
          destroyed = ops.damageBarracks(event.result.position, dmg);
        } else if (ops.isGateAt(key)) {
          if (isSiege) destroyed = ops.damageGate(event.result.position, baseDmg);
        } else {
          if (isSiege) destroyed = ops.damageWall(event.result.position, baseDmg);
        }
        // Eject garrisoned units when structure is destroyed
        if (destroyed) ops.onStructureDestroyed(key);
      }
    }
  }
}
