/**
 * CombatEventHandler — Processes combat events from UnitAI.update().
 * Handles damage visuals, projectiles, unit deaths, special effects (AoE, cleave),
 * experience/level-up, building damage, and worker task events.
 * Extracted from main.ts to reduce central orchestrator size.
 */

import { Unit, UnitType, UnitState, HexCoord, ResourceType, Player, PlacedBuilding, BuildingKind, ElementType } from '../../types';
import { UnitEvent } from './UnitAI';
import { GAME_CONFIG } from '../GameConfig';
import { StatusEffectSystem, StatusEvent } from './StatusEffectSystem';
import { CombatLog } from '../../ui/ArenaDebugConsole';

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
  getGoldStockpile(): number[];

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
  fireLightningBolt(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireLightningChain(from: any, to: any, targetId: string): void;
  spawnElectrocuteEffect(unitId: string): void;
  fireFlamethrower(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireStoneColumn(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireWaterWave(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireWindTornado(from: any, to: any, targetId: string, onImpact: () => void): void;
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
  showCritText(worldPos: any, combo: string, damage: number, color: string): void;
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

  // Building construction
  handleConstructTick(unit: Unit, buildingId: string, amount: number): void;
}

export default class CombatEventHandler {
  private ops: CombatEventOps;

  /**
   * Per-unit-type delay (ms) from combat event to damage visuals for melee attacks.
   * Synced to the animation's strike frame so the blade visually connects before
   * damage numbers / hit effects appear. Calculated from:
   *   delay = (strike_cycle_midpoint / anim_speed) * 1000
   */
  // Each delay = impactCyclePoint / animSpeed * 1000
  // Syncs damage flash to exact frame where weapon visually connects
  static readonly MELEE_STRIKE_DELAY: Partial<Record<UnitType, number>> = {
    [UnitType.WARRIOR]:      440,  // speed=1.05, strike lands at cycle ~0.46 → 438ms
    [UnitType.PALADIN]:      400,  // speed=1.2,  mace smash at cycle ~0.48 → 400ms
    [UnitType.RIDER]:        335,  // speed=1.2,  lance thrust at cycle ~0.40 → 333ms
    [UnitType.SCOUT]:        215,  // speed=1.4,  stab lands at cycle ~0.30 → 214ms
    [UnitType.ASSASSIN]:     275,  // speed=1.2,  jump-stab at cycle ~0.33 → 275ms
    [UnitType.BERSERKER]:    440,  // speed=1.0,  axe chop at cycle ~0.44 → 440ms
    [UnitType.SHIELDBEARER]: 460,  // speed=1.0,  shield bash at cycle ~0.46 → 460ms
    [UnitType.GREATSWORD]:   550,  // speed=0.8,  cleave at cycle ~0.44 → 550ms
    [UnitType.OGRE]:         830,  // speed=0.6,  club slam at cycle ~0.50 → 833ms
    [UnitType.LUMBERJACK]:   180,  // speed=1.4,  swing peak at cycle ~0.25 → 179ms
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
          const goldReward = event.unit.type === UnitType.TREBUCHET
            ? GAME_CONFIG.economy.trade.combatRewards.siegeKillGold
            : GAME_CONFIG.economy.trade.combatRewards.unitKillGold;
          ops.getGoldStockpile()[killerOwner] += goldReward;
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
        } else if (event.attacker.type === UnitType.TREBUCHET) {
          hitSound = 'hit_siege';
        } else if (event.attacker.stats.range > 1) {
          hitSound = 'hit_ranged';
        } else if (event.attacker.type === UnitType.ASSASSIN) {
          hitSound = 'assassin_strike';
        } else if (event.attacker.type === UnitType.RIDER || event.attacker.type === UnitType.SCOUT) {
          hitSound = 'hit_pierce';
        } else if (event.attacker.type === UnitType.OGRE) {
          hitSound = 'hit_blunt'; // heavy club impact
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
            // Element-specific projectiles — each element has a unique visual
            const elem = attackerElement ?? ElementType.FIRE;
            const attackerRef = event.attacker;
            const defenderRef = event.defender;

            // Status-aware impact callback: applies element status + interaction combos
            const applyMageStatusOnImpact = () => {
              applyDamageVisuals();
              const allUnits = ops.getAllUnits();
              const statusEvents = StatusEffectSystem.applyMageElement(attackerRef, defenderRef, elem, allUnits);
              CombatEventHandler.handleStatusEvents(statusEvents, ops, attackerRef);
            };

            switch (elem) {
              case ElementType.LIGHTNING:
                // Lightning bolt — chain behavior is now driven by status interactions
                // (Wet + Lightning → Electrocute Crit with enhanced chain spread)
                ops.fireLightningBolt(attackerRef.worldPosition, defenderRef.worldPosition, defId, () => {
                  applyDamageVisuals();
                  const allUnits = ops.getAllUnits();
                  const statusEvents = StatusEffectSystem.applyMageElement(attackerRef, defenderRef, elem, allUnits);
                  const hasElectrocute = statusEvents.some(e => e.effect === 'electrocute');

                  if (hasElectrocute) {
                    // Electrocute Crit: enhanced chain driven by status system (already applied damage)
                    // Show chain VFX for each spread target
                    const ecEvt = statusEvents.find(e => e.effect === 'electrocute');
                    const hvCfg = GAME_CONFIG.combat.statusEffects.highVoltage;
                    if (ecEvt?.spreadTo) {
                      for (const sid of ecEvt.spreadTo) {
                        const chainUnit = allUnits.find(u => u.id === sid);
                        if (chainUnit) {
                          ops.queueDeferredEffect(150, () => {
                            ops.fireLightningChain(defenderRef.worldPosition, chainUnit.worldPosition, chainUnit.id);
                            ops.spawnElectrocuteEffect(chainUnit.id);
                            ops.updateHealthBar(chainUnit);

                            // --- HIGH VOLTAGE CASCADE: if chain target has HV, consume it → arc cascade + stun ---
                            if (chainUnit._statusHighVoltage && performance.now() < chainUnit._statusHighVoltage && chainUnit.currentHealth > 0) {
                              chainUnit._statusHighVoltage = 0; // consume
                              // Stun the HV target (knockup)
                              chainUnit._knockupUntil = performance.now() + hvCfg.stunDuration * 1000;
                              // Cascade damage on the HV target itself
                              const cascadeDmg = Math.max(1, Math.round(attackerRef.stats.attack * hvCfg.cascadeDamageMultiplier));
                              chainUnit.currentHealth = Math.max(0, chainUnit.currentHealth - cascadeDmg);
                              ops.updateHealthBar(chainUnit);
                              ops.showCritText(chainUnit.worldPosition, 'HIGH VOLTAGE', cascadeDmg, '#44eeff');
                              ops.playSound('splash_aoe');
                              CombatLog.logCombo(attackerRef, chainUnit, 'high_voltage', cascadeDmg);

                              // Secondary arc cascade from HV target to nearby enemies
                              const cascadeTargets = allUnits
                                .filter(u => u.id !== chainUnit.id && u.id !== defenderRef.id && u.owner !== attackerRef.owner && u.currentHealth > 0 && u.state !== 'dead')
                                .map(u => ({ unit: u, dist: CombatEventHandler.hexDist(u.position.q, u.position.r, chainUnit.position.q, chainUnit.position.r) }))
                                .filter(e => e.dist <= hvCfg.cascadeChainRadius)
                                .sort((a, b) => a.dist - b.dist)
                                .slice(0, hvCfg.cascadeChainCount);

                              for (const ct of cascadeTargets) {
                                const cascadeUnit = ct.unit;
                                const cDmg = Math.max(1, Math.round(attackerRef.stats.attack * hvCfg.cascadeDamageMultiplier));
                                cascadeUnit.currentHealth = Math.max(0, cascadeUnit.currentHealth - cDmg);
                                // Stun cascade targets too
                                cascadeUnit._knockupUntil = performance.now() + hvCfg.stunDuration * 1000;
                                const cascadeRef = cascadeUnit;
                                ops.queueDeferredEffect(100, () => {
                                  ops.fireLightningChain(chainUnit.worldPosition, cascadeRef.worldPosition, cascadeRef.id);
                                  ops.spawnElectrocuteEffect(cascadeRef.id);
                                  ops.flashUnit(cascadeRef.id, 0.2);
                                  ops.updateHealthBar(cascadeRef);
                                  if (cascadeRef.currentHealth <= 0) {
                                    cascadeRef.state = UnitState.DEAD;
                                    ops.removeUnitFromGame(cascadeRef, attackerRef);
                                    ops.playSound('death');
                                  }
                                });
                              }

                              if (chainUnit.currentHealth <= 0) {
                                chainUnit.state = UnitState.DEAD;
                                ops.removeUnitFromGame(chainUnit, attackerRef);
                                ops.playSound('death');
                              }
                            } else if (chainUnit.currentHealth <= 0) {
                              chainUnit.state = UnitState.DEAD;
                              ops.removeUnitFromGame(chainUnit, attackerRef);
                              ops.playSound('death');
                            }
                          });
                        }
                      }
                    }
                    // Also check if PRIMARY target has High Voltage
                    if (defenderRef._statusHighVoltage && performance.now() < defenderRef._statusHighVoltage && defenderRef.currentHealth > 0) {
                      defenderRef._statusHighVoltage = 0;
                      defenderRef._knockupUntil = performance.now() + hvCfg.stunDuration * 1000;
                      const hvDmg = Math.max(1, Math.round(attackerRef.stats.attack * hvCfg.cascadeDamageMultiplier));
                      defenderRef.currentHealth = Math.max(0, defenderRef.currentHealth - hvDmg);
                      ops.updateHealthBar(defenderRef);
                      ops.showCritText(defenderRef.worldPosition, 'HIGH VOLTAGE', hvDmg, '#44eeff');
                      CombatLog.logCombo(attackerRef, defenderRef, 'high_voltage', hvDmg);

                      // Arc cascade from primary target
                      const hvPrimaryTargets = allUnits
                        .filter(u => u.id !== defenderRef.id && u.owner !== attackerRef.owner && u.currentHealth > 0 && u.state !== 'dead')
                        .map(u => ({ unit: u, dist: CombatEventHandler.hexDist(u.position.q, u.position.r, defenderRef.position.q, defenderRef.position.r) }))
                        .filter(e => e.dist <= hvCfg.cascadeChainRadius)
                        .sort((a, b) => a.dist - b.dist)
                        .slice(0, hvCfg.cascadeChainCount);

                      for (const ct of hvPrimaryTargets) {
                        const cDmg = Math.max(1, Math.round(attackerRef.stats.attack * hvCfg.cascadeDamageMultiplier));
                        ct.unit.currentHealth = Math.max(0, ct.unit.currentHealth - cDmg);
                        ct.unit._knockupUntil = performance.now() + hvCfg.stunDuration * 1000;
                        const cascRef = ct.unit;
                        ops.queueDeferredEffect(100, () => {
                          ops.fireLightningChain(defenderRef.worldPosition, cascRef.worldPosition, cascRef.id);
                          ops.spawnElectrocuteEffect(cascRef.id);
                          ops.flashUnit(cascRef.id, 0.2);
                          ops.updateHealthBar(cascRef);
                          if (cascRef.currentHealth <= 0) {
                            cascRef.state = UnitState.DEAD;
                            ops.removeUnitFromGame(cascRef, attackerRef);
                            ops.playSound('death');
                          }
                        });
                      }

                      if (defenderRef.currentHealth <= 0) {
                        defenderRef.state = UnitState.DEAD;
                        ops.removeUnitFromGame(defenderRef, attackerRef);
                        ops.playSound('death');
                      }
                    }
                    ops.spawnElectrocuteEffect(defId);
                    ops.playSound('hit_ranged');
                    // CRIT text for Electrocute combo
                    const ecDmg = ecEvt?.damage || GAME_CONFIG.combat.statusEffects.electrocuteCrit.damageMultiplier * attackerRef.stats.attack;
                    ops.showCritText(defenderRef.worldPosition, 'ELECTROCUTE', ecDmg, '#ffee44');
                  } else {
                    // Normal chain lightning (no Wet status) — reduced chain
                    const chainTargets = allUnits
                      .filter(u => u.id !== defenderRef.id && u.owner !== attackerRef.owner && u.state !== 'dead')
                      .map(u => ({ unit: u, dist: Math.hypot(u.worldPosition.x - defenderRef.worldPosition.x, u.worldPosition.z - defenderRef.worldPosition.z) }))
                      .filter(e => e.dist < 3.0)
                      .sort((a, b) => a.dist - b.dist)
                      .slice(0, 2);
                    for (const ct of chainTargets) {
                      const chainDmg = Math.max(1, Math.floor((event.result?.damage ?? 0) * 0.5));
                      ct.unit.currentHealth = Math.max(0, ct.unit.currentHealth - chainDmg);
                      ops.queueDeferredEffect(150, () => {
                        ops.fireLightningChain(defenderRef.worldPosition, ct.unit.worldPosition, ct.unit.id);
                        ops.spawnElectrocuteEffect(ct.unit.id);
                        ops.updateHealthBar(ct.unit);
                        if (ct.unit.currentHealth <= 0) {
                          ct.unit.state = UnitState.DEAD;
                          ops.removeUnitFromGame(ct.unit, attackerRef);
                          ops.playSound('death');
                        }
                      });
                    }
                    ops.spawnElectrocuteEffect(defId);
                  }
                  // Handle remaining status events (consumed Charged, etc.)
                  CombatEventHandler.handleStatusEvents(
                    statusEvents.filter(e => e.effect !== 'electrocute'), ops, attackerRef
                  );
                });
                break;
              case ElementType.FIRE:
                ops.fireFlamethrower(attackerRef.worldPosition, defenderRef.worldPosition, defId, applyMageStatusOnImpact);
                break;
              case ElementType.EARTH:
                ops.fireStoneColumn(attackerRef.worldPosition, defenderRef.worldPosition, defId, applyMageStatusOnImpact);
                break;
              case ElementType.WATER:
                ops.fireWaterWave(attackerRef.worldPosition, defenderRef.worldPosition, defId, applyMageStatusOnImpact);
                break;
              case ElementType.WIND:
                ops.fireWindTornado(attackerRef.worldPosition, defenderRef.worldPosition, defId, applyMageStatusOnImpact);
                break;
            }
            // Cycle element to next in sequence
            const ELEMENT_CYCLE = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
            const cycleIdx = attackerRef._elementCycleIndex ?? 0;
            const nextIdx = (cycleIdx + 1) % ELEMENT_CYCLE.length;
            attackerRef._elementCycleIndex = nextIdx;
            attackerRef.element = ELEMENT_CYCLE[nextIdx];
          } else if (event.attacker.type === UnitType.BATTLEMAGE) {
            // Battlemage Earth → Arcane, so use purple orb instead of brown
            const orbColor = attackerElement === ElementType.EARTH ? 0x9944ff
              : attackerElement ? ops.getElementOrbColor(attackerElement) : 0x7c4dff;
            const bmAttacker = event.attacker;
            const bmDefender = event.defender;
            const bmElem = attackerElement;
            ops.fireMagicOrb(bmAttacker.worldPosition, bmDefender.worldPosition, orbColor, defId, true, () => {
              applyDamageVisuals();
              // Apply Battlemage elemental status to primary target
              if (bmElem) {
                const statusEvts = StatusEffectSystem.applyBattlemageElement(bmAttacker, bmDefender, bmElem);
                CombatEventHandler.handleStatusEvents(statusEvts, ops, bmAttacker);
              }
            });
            ops.playSound('splash_aoe');
            // Cycle Battlemage element to next in sequence (same cycle as Mage)
            const BM_CYCLE = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
            const bmCycleIdx = bmAttacker._elementCycleIndex ?? 0;
            const bmNextIdx = (bmCycleIdx + 1) % BM_CYCLE.length;
            bmAttacker._elementCycleIndex = bmNextIdx;
            bmAttacker.element = BM_CYCLE[bmNextIdx];
          } else if (event.attacker.type === UnitType.TREBUCHET) {
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
          // Apply Battlemage elemental status to splash victims
          if (splashEvt.attackerId && splashEvt.element) {
            const bmUnit = ops.getAllUnits().find(u => u.id === splashEvt.attackerId);
            if (bmUnit) {
              const statusEvts = StatusEffectSystem.applyBattlemageElement(bmUnit, victim, splashEvt.element);
              CombatEventHandler.handleStatusEvents(statusEvts, ops, bmUnit);
            }
          }
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

      // ─── Mage Synergy: Arcane Convergence AoE burst ───
      if ((event as any).type === 'combat:synergy') {
        const se = event as any;
        const victim = ops.getAllUnits().find(u => u.id === se.unitId);
        if (victim) {
          ops.updateHealthBar(victim);
          ops.showDamageEffect(victim.worldPosition);
          ops.flashUnit(victim.id, 0.15);
          if (victim.currentHealth <= 0) {
            ops.removeUnitFromGame(victim, undefined);
            ops.playSound('death');
          } else {
            ops.playSound('splash_aoe');
          }
        }
      }

      // ─── Battlemage cyclone pull (reverse knockback — pulled toward center) ───
      if ((event as any).type === 'combat:cyclone') {
        const ce = event as any;
        const victim = ops.getAllUnits().find(u => u.id === ce.unitId);
        if (victim && victim.state !== UnitState.DEAD && !victim._pendingRangedDeath) {
          victim.position = { q: ce.knockQ, r: ce.knockR };
          const wp = ops.hexToWorld(victim.position, !!victim._underground);
          victim.worldPosition = { x: wp.x, y: wp.y, z: wp.z };
          ops.knockbackUnit(victim.id, wp);
          ops.updateHealthBar(victim);
          ops.showDamageEffect(victim.worldPosition);
          ops.flashUnit(victim.id, 0.12);
          ops.playSound('splash_aoe');
        }
      }

      // ─── Healer Cleanse ───
      if ((event as any).type === 'status:cleanse') {
        const cleanseEvt = event as any;
        const statusEvts: StatusEvent[] = [{
          type: cleanseEvt.type === 'status:cleanse' ? 'status:interaction' : cleanseEvt.type,
          unitId: cleanseEvt.unitId,
          effect: 'cleanse',
          casterId: cleanseEvt.casterId,
        }];
        CombatEventHandler.handleStatusEvents(statusEvts, ops);
      }

      // ─── Status effect tick (burn damage visuals) ───
      if ((event as any).type === 'status:tick') {
        const tickEvt = event as any;
        const victim = ops.getAllUnits().find(u => u.id === tickEvt.unitId);
        if (victim && victim.currentHealth > 0) {
          ops.spawnElementalImpact(victim.worldPosition, ElementType.FIRE);
          ops.updateHealthBar(victim);
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

      // ─── Builder: construction tick ───
      if (event.type === 'builder:construct_tick' && event.result && event.unit) {
        ops.handleConstructTick(event.unit!, event.result.buildingId, event.result.amount);
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

  // ─── Status Effect VFX Handlers ───

  /**
   * Process StatusEvents from the StatusEffectSystem and trigger appropriate VFX/SFX.
   * Called after mage/battlemage attacks land to show status application, interactions, etc.
   */
  static handleStatusEvents(statusEvents: StatusEvent[], ops: CombatEventOps, attacker?: Unit): void {
    for (const evt of statusEvents) {
      const unit = ops.getAllUnits().find(u => u.id === evt.unitId);
      if (!unit) continue;

      // --- Debug logging for all status events ---
      if (CombatLog.isEnabled()) {
        const casterUnit = evt.casterId ? ops.getAllUnits().find(u => u.id === evt.casterId) : attacker;
        if (evt.type === 'status:applied') {
          CombatLog.logStatusApplied(unit, evt.effect, casterUnit?.type);
        } else if (evt.type === 'status:consumed') {
          CombatLog.logStatusConsumed(unit, evt.effect, casterUnit?.type?.toString() || 'unknown');
        } else if (evt.type === 'status:interaction') {
          if (casterUnit) {
            CombatLog.logCombo(casterUnit, unit, evt.effect, evt.damage);
          }
        }
      }

      switch (evt.effect) {
        case 'wet':
          if (evt.type === 'status:applied') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.WATER);
          }
          break;

        case 'ablaze':
          if (evt.type === 'status:applied') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.FIRE);
          }
          break;

        case 'soothe':
          // Anti-synergy: Water consumed Ablaze → heal effect
          if (evt.type === 'status:interaction') {
            ops.flashUnit(unit.id, 0.2);
            ops.spawnElementalImpact(unit.worldPosition, ElementType.WATER);
            ops.updateHealthBar(unit);
            ops.playSound('heal');
            ops.showCritText(unit.worldPosition, 'SOOTHE', evt.heal || GAME_CONFIG.combat.statusEffects.soothe.healAmount, '#44ddff');
          }
          break;

        case 'inferno':
          // Ablaze + Wind → burst damage + spread
          if (evt.type === 'status:interaction') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.FIRE);
            ops.flashUnit(unit.id, 0.2);
            ops.playSound('splash_aoe');
            ops.updateHealthBar(unit);
            ops.showCritText(unit.worldPosition, 'INFERNO', evt.damage || GAME_CONFIG.combat.statusEffects.inferno.burstDamage, '#ff4422');
            if (evt.spreadTo) {
              for (const sid of evt.spreadTo) {
                const spreadUnit = ops.getAllUnits().find(u => u.id === sid);
                if (spreadUnit) {
                  ops.queueDeferredEffect(200, () => {
                    ops.spawnElementalImpact(spreadUnit.worldPosition, ElementType.FIRE);
                    ops.flashUnit(spreadUnit.id, 0.15);
                  });
                }
              }
            }
            if (unit.currentHealth <= 0) {
              unit.state = UnitState.DEAD;
              ops.removeUnitFromGame(unit, attacker);
              ops.playSound('death');
            }
          }
          break;

        case 'knockup':
          // Battlemage Wind AoE → brief airborne CC
          if (evt.type === 'status:applied') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.WIND);
            // Knockback upward visual — launch the unit mesh into the air briefly
            const upPos = { x: unit.worldPosition.x, y: unit.worldPosition.y + 1.5, z: unit.worldPosition.z };
            ops.knockbackUnit(unit.id, upPos);
            ops.flashUnit(unit.id, 0.2);
            ops.playSound('splash_aoe');
            // Slam back down after the CC duration
            ops.queueDeferredEffect(GAME_CONFIG.combat.statusEffects.knockup.duration * 1000, () => {
              const landPos = { x: unit.worldPosition.x, y: unit.worldPosition.y, z: unit.worldPosition.z };
              ops.knockbackUnit(unit.id, landPos);
            });
          }
          break;

        case 'arcane':
          // Battlemage Earth AoE → purple Arcane orbs around target
          if (evt.type === 'status:applied') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.LIGHTNING);
            ops.flashUnit(unit.id, 0.15);
            ops.playSound('splash_aoe');
          }
          break;

        case 'high_voltage':
          // Battlemage Lightning AoE → High Voltage (cyan sparks)
          if (evt.type === 'status:applied') {
            ops.spawnElementalImpact(unit.worldPosition, ElementType.LIGHTNING);
            ops.flashUnit(unit.id, 0.15);
            ops.playSound('hit_ranged');
          }
          break;

        case 'kamehameha':
          // Arcane consumed by Lightning → piercing laser beam
          if (evt.type === 'status:interaction') {
            ops.flashUnit(unit.id, 0.3);
            ops.updateHealthBar(unit);
            ops.playSound('splash_aoe');
            ops.showCritText(unit.worldPosition, 'KAMEHAMEHA', evt.damage || 9, '#aa44ff');

            // Draw laser VFX from caster through all pierced enemies
            if (evt.casterId) {
              const caster = ops.getAllUnits().find(u => u.id === evt.casterId);
              if (caster) {
                // Fire a chain of lightning bolts along the beam path
                let prevPos = caster.worldPosition;
                // Primary target gets electrocute effect
                ops.spawnElectrocuteEffect(unit.id);
                ops.fireLightningChain(caster.worldPosition, unit.worldPosition, unit.id);

                if (evt.piercedIds) {
                  prevPos = unit.worldPosition;
                  for (const pid of evt.piercedIds) {
                    const pierced = ops.getAllUnits().find(u => u.id === pid);
                    if (pierced) {
                      const pPrev = prevPos;
                      ops.queueDeferredEffect(100, () => {
                        ops.fireLightningChain(pPrev, pierced.worldPosition, pierced.id);
                        ops.spawnElectrocuteEffect(pierced.id);
                        ops.flashUnit(pierced.id, 0.2);
                        ops.updateHealthBar(pierced);
                        if (pierced.currentHealth <= 0) {
                          pierced.state = UnitState.DEAD;
                          ops.removeUnitFromGame(pierced, caster);
                          ops.playSound('death');
                        }
                      });
                      prevPos = pierced.worldPosition;
                    }
                  }
                }
              }
            }
            if (unit.currentHealth <= 0) {
              unit.state = UnitState.DEAD;
              ops.removeUnitFromGame(unit, attacker);
              ops.playSound('death');
            }
          }
          break;

        case 'cleanse':
          // Healer cleanse — golden whoosh + speed trail
          if (evt.type === 'status:interaction') {
            ops.flashUnit(unit.id, 0.3);
            // Golden healing burst at target
            ops.spawnElementalImpact(unit.worldPosition, ElementType.EARTH); // gold-ish particles
            ops.playSound('heal_cast');
            ops.showCritText(unit.worldPosition, 'CLEANSE', 0, '#ffd700');
            // Satisfying whoosh
            ops.queueDeferredEffect(100, () => {
              ops.playSound('heal');
            });
            // Show healer casting
            if (evt.casterId) {
              const healer = ops.getAllUnits().find(u => u.id === evt.casterId);
              if (healer) {
                ops.flashUnit(healer.id, 0.15);
              }
            }
          }
          break;
      }
    }
  }

  /** Hex distance helper for cascade range checks */
  private static hexDist(q1: number, r1: number, q2: number, r2: number): number {
    const dq = q1 - q2;
    const dr = r1 - r2;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
}
