/**
 * CombatEventHandler — Processes combat events from UnitAI.update().
 * Handles damage visuals, projectiles, unit deaths, special effects (AoE, cleave),
 * experience/level-up, building damage, and worker task events.
 * Extracted from main.ts to reduce central orchestrator size.
 */

import { Unit, UnitType, UnitState, HexCoord, ResourceType, Player, PlacedBuilding, BuildingKind, ElementType } from '../../types';
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
  fireDeflectedArrow(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireMagicOrb(from: any, to: any, color: number, targetId: string, isSplash: boolean, onImpact: () => void): void;
  fireBoulder(from: any, to: any, onImpact: () => void): void;
  fireProjectile(from: any, to: any, color: number, targetId: string, onImpact: () => void): void;
  knockbackUnit(unitId: string, targetWorldPos: { x: number; y: number; z: number }): void;
  spawnBlockSparks(worldPos: { x: number; y: number; z: number }): void;
  spawnElementalImpact(worldPos: { x: number; y: number; z: number }, element: ElementType): void;
  getElementOrbColor(element: ElementType): number;
  fireHealOrb(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireAxeThrow(from: any, to: any, targetId: string, onImpact: () => void): void;
  spawnDeflectedAxe(impactPos: { x: number; y: number; z: number }): void;
  applyHeal(healerId: string, targetId: string): void;
  showXPText(worldPos: any, xp: number): void;
  showLevelUpEffect(unitId: string, worldPos: any, newLevel: number): void;

  // Audio
  playSound(name: string, volume?: number): void;

  // HUD
  showNotification(message: string, color: string): void;
  updateResources(player: Player, wood: number, food: number, stone: number): void;

  // Hex helpers
  hexToWorld(pos: HexCoord, underground?: boolean): { x: number; y: number; z: number };

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

  /**
   * Per-unit-type delay (ms) from combat event to damage visuals for melee attacks.
   * Synced to the animation's strike frame so the blade visually connects before
   * damage numbers / hit effects appear. Calculated from:
   *   delay = (strike_cycle_midpoint / anim_speed) * 1000
   */
  static readonly MELEE_STRIKE_DELAY: Partial<Record<UnitType, number>> = {
    [UnitType.WARRIOR]:      420,  // speed=1.1, strike mid ~0.45 → 409ms
    [UnitType.PALADIN]:      390,  // speed=1.2, strike mid ~0.45 → 375ms
    [UnitType.RIDER]:        420,  // speed=1.2, strike mid ~0.50 → 417ms
    [UnitType.SCOUT]:        230,  // speed=1.4, strike mid ~0.30 → 214ms (fast jab)
    [UnitType.ASSASSIN]:     360,  // speed=1.2, strike mid ~0.42 → 350ms
    [UnitType.BERSERKER]:    420,  // speed=1.1, strike mid ~0.45 → 409ms
    [UnitType.SHIELDBEARER]: 460,  // speed=1.0, strike mid ~0.45 → 450ms (heavy tank)
    [UnitType.GREATSWORD]:   510,  // speed=0.85, strike mid ~0.42 → 494ms (massive wind-up)
    [UnitType.LUMBERJACK]:   350,  // speed=1.4, generic melee
  };

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
        const isDeflected = !!event.result?.deflected;
        let hitSound: string = 'hit_melee';
        if (isDeflected) {
          hitSound = 'shield_deflect';
        } else if (event.attacker.type === UnitType.TREBUCHET || event.attacker.type === UnitType.CATAPULT) {
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
        const isBlocked = !!event.result?.blocked;

        // Check if attacker has an elemental affinity (mages)
        const attackerElement = attacker.element;
        const isMageAttacker = attacker.type === UnitType.MAGE || attacker.type === UnitType.BATTLEMAGE;

        const applyDamageVisuals = () => {
          ops.updateHealthBar(attacker);
          ops.updateHealthBar(defender);
          if (isBlocked) {
            // Block: sparks fly from weapon clash, shorter flash, metallic sound
            const midX = (attacker.worldPosition.x + defender.worldPosition.x) / 2;
            const midY = (attacker.worldPosition.y + defender.worldPosition.y) / 2;
            const midZ = (attacker.worldPosition.z + defender.worldPosition.z) / 2;
            ops.spawnBlockSparks({ x: midX, y: midY, z: midZ });
            ops.flashUnit(defender.id, 0.08);
            ops.playSound('shield_deflect');
          } else if (isMageAttacker && attackerElement) {
            // Elemental impact: element-specific particle burst replaces generic red damage
            ops.spawnElementalImpact(defender.worldPosition, attackerElement);
            ops.flashUnit(defender.id, 0.15);
            ops.playSound(hitSound as any);
          } else {
            ops.showDamageEffect(defender.worldPosition);
            ops.flashUnit(defender.id, 0.15);
            ops.playSound(hitSound as any);
            if (hitSound === 'assassin_strike') ops.playSound('hit_pierce');
          }
          if ((defender as any)._pendingKillVisual) {
            (defender as any)._pendingKillVisual = false;
            if ((defender as any)._pendingRangedDeath) {
              defender.state = UnitState.DEAD;
              (defender as any)._pendingRangedDeath = false;
            }
            ops.removeUnitFromGame(defender, (defender as any)._killer);
            ops.playSound('death');
          }
        };

        if (isRangedAttack) {
          const defId = event.defender.id;
          if (event.attacker.type === UnitType.ARCHER) {
            if (isDeflected) {
              ops.fireDeflectedArrow(event.attacker.worldPosition, event.defender.worldPosition, defId, applyDamageVisuals);
            } else {
              ops.fireArrow(event.attacker.worldPosition, event.defender.worldPosition, defId, applyDamageVisuals);
            }
          } else if (event.attacker.type === UnitType.MAGE) {
            // Elemental orb color — falls back to default blue if no element assigned
            const orbColor = attackerElement ? ops.getElementOrbColor(attackerElement) : 0x2980b9;
            ops.fireMagicOrb(event.attacker.worldPosition, event.defender.worldPosition, orbColor, defId, false, applyDamageVisuals);
          } else if (event.attacker.type === UnitType.BATTLEMAGE) {
            const orbColor = attackerElement ? ops.getElementOrbColor(attackerElement) : 0x7c4dff;
            ops.fireMagicOrb(event.attacker.worldPosition, event.defender.worldPosition, orbColor, defId, true, applyDamageVisuals);
            ops.playSound('splash_aoe');
          } else if (event.attacker.type === UnitType.TREBUCHET || event.attacker.type === UnitType.CATAPULT) {
            ops.fireBoulder(event.attacker.worldPosition, event.defender.worldPosition, applyDamageVisuals);
          } else if (event.attacker.type === UnitType.BERSERKER && event.attacker._axeThrowReady) {
            // Berserker axe throw — fire spinning axe, apply slow debuff on impact, then reset to melee
            const bDefender = event.defender;
            const bAttacker = event.attacker;
            const axeDeflected = isDeflected;
            // Reset range IMMEDIATELY so the berserker starts closing to melee this tick
            bAttacker.stats.range = 1;
            bAttacker._axeThrowReady = false;
            // Track this target as thrown-at (once per unique target)
            if (!bAttacker._axeThrowTargets) bAttacker._axeThrowTargets = new Set();
            bAttacker._axeThrowTargets.add(bDefender.id);
            ops.fireAxeThrow(bAttacker.worldPosition, bDefender.worldPosition, defId, () => {
              applyDamageVisuals();
              if (axeDeflected) {
                // Axe bounces off shield — spawn deflected axe visual, NO slow debuff
                ops.spawnDeflectedAxe(bDefender.worldPosition);
              } else {
                // Apply slow debuff — 2 seconds at 35% speed
                bDefender._slowUntil = performance.now() + 2000;
                bDefender._slowFactor = 0.35;
                // Give berserker chase speed boost
                bAttacker._chaseBoostUntil = performance.now() + 2000;
              }
            });
          } else {
            ops.fireProjectile(event.attacker.worldPosition, event.defender.worldPosition, 0xFF8800, defId, applyDamageVisuals);
          }
          ops.updateHealthBar(event.attacker);
        } else {
          // Per-unit-type melee strike delay — synced to when the blade connects
          // in the attack animation (wind-up must complete before damage applies)
          const meleeStrikeDelay = CombatEventHandler.MELEE_STRIKE_DELAY[event.attacker.type] ?? 250;
          ops.queueDeferredEffect(meleeStrikeDelay, applyDamageVisuals);
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
        if (victim && victim.state !== UnitState.DEAD && !victim._pendingRangedDeath) {
          // Update logical position immediately (pathfinding, targeting, etc.)
          victim.position = { q: ce.knockQ, r: ce.knockR };
          const wp = ops.hexToWorld(victim.position, !!victim._underground);
          victim.worldPosition = { x: wp.x, y: wp.y, z: wp.z };
          // Animate the knockback visually — smooth hop arc, not a teleport
          ops.knockbackUnit(victim.id, wp);
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
        const healEvt = event as any;
        const units = ops.getAllUnits();
        const healerUnit = units.find((u: Unit) => u.id === healEvt.healerId);
        const targetUnit = units.find((u: Unit) => u.id === healEvt.targetId);
        if (healerUnit && targetUnit) {
          const fromW = ops.hexToWorld(healerUnit.position);
          const toW = ops.hexToWorld(targetUnit.position);
          // Play cast whoosh sound immediately
          ops.playSound('heal_cast', 0.4);
          // Fire heal orb projectile — HP applied on impact
          ops.fireHealOrb(fromW, toW, targetUnit.id, () => {
            ops.applyHeal(healEvt.healerId, healEvt.targetId);
            ops.playSound('heal', 0.5); // impact heal chime
          });
        }
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
