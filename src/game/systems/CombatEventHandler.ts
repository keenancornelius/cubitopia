/**
 * CombatEventHandler — Processes combat events from UnitAI.update().
 * Handles damage visuals, projectiles, unit deaths, special effects (AoE, cleave),
 * experience/level-up, building damage, and worker task events.
 * Extracted from main.ts to reduce central orchestrator size.
 */

import { Unit, UnitType, UnitState, HexCoord, ResourceType, Player, PlacedBuilding, BuildingKind, ElementType } from '../../types';
import { UnitAI, UnitEvent } from './UnitAI';
import { GAME_CONFIG } from '../GameConfig';
import { StatusEffectSystem, StatusEvent } from './StatusEffectSystem';
import { CombatLog } from '../../ui/ArenaDebugConsole';
import { hexDistQR } from '../HexMath';
import type { DialogueContext } from '../../engine/UnitDialogue';

/** Slim interface — only what CombatEventHandler needs from the outside */
export interface CombatEventOps {
  // Game state
  getPlayers(): Player[];
  getAllUnits(): Unit[];
  getDebugFlags(): { godMode: boolean; disableCombat: boolean; disableBuild: boolean; disableChop: boolean; disableDeposit: boolean; disableMine: boolean; disableHarvest: boolean };
  getLocalPlayerIndex(): number;

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
  resetAttackAnim(unitId: string): void;
  fireArrow(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireDeflectedArrow(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireMagicOrb(from: any, to: any, color: number, targetId: string, isSplash: boolean, onImpact: () => void): void;
  fireLightningBolt(from: any, to: any, targetId: string, onImpact: () => void): void;
  fireLightningChain(from: any, to: any, targetId: string): void;
  fireKamehamehaBeam(from: any, to: any, piercedPositions: { x: number; y: number; z: number }[]): void;
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
  spawnOgreGroundPound(centerPos: { x: number; y: number; z: number }): void;
  applyHeal(healerId: string, targetId: string): void;
  showXPText(worldPos: any, xp: number): void;
  showCritText(worldPos: any, combo: string, damage: number, color: string): void;
  showLevelUpEffect(unitId: string, worldPos: any, newLevel: number): void;
  applyBleedTint(unitId: string, healthPercent: number): void;

  // Secondary melee attack VFX
  spawnGreatswordSpin(worldPos: { x: number; y: number; z: number }): void;
  spawnJumpAttackImpact(worldPos: { x: number; y: number; z: number }): void;
  animateJumpAttack(unitId: string): void;
  spawnPaladinChargeField(unitId: string): void;
  spawnPaladinImpactBurst(worldPos: { x: number; y: number; z: number }): void;
  applyLevelUpVisuals(unitId: string, newLevel: number): void;

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

  // Trade routes
  getBases(): { id: string; owner: number; position: HexCoord; destroyed: boolean }[];
  getPrimaryBasePosition(owner: number): HexCoord | undefined;
  addTradeGold(owner: number, amount: number): void;

  // Speech bubbles
  triggerSpeechBubble(unitId: string, unitType: UnitType, context: DialogueContext): void;
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
    [UnitType.CHAMPION]:     560,  // speed=0.8,  hammer slam at cycle ~0.45 → 563ms
    [UnitType.LUMBERJACK]:   180,  // speed=1.4,  swing peak at cycle ~0.25 → 179ms
  };

  constructor(ops: CombatEventOps) {
    this.ops = ops;
  }

  /**
   * Trade route bonus: when a worker deposits resources near an owned base
   * that is NOT their home (primary) base, award bonus gold.
   * Rewards players for capturing and maintaining multiple bases.
   */
  private checkTradeRouteBonus(unit: Unit): void {
    const cfg = GAME_CONFIG.economy.trade.tradeRoute;
    const bases = this.ops.getBases();
    const ownedBases = bases.filter(b => b.owner === unit.owner && !b.destroyed);

    // Need at least minBases to activate trade routes
    if (ownedBases.length < cfg.minBases) return;

    const primaryPos = this.ops.getPrimaryBasePosition(unit.owner);
    if (!primaryPos) return;

    // Check if the worker is near any non-primary owned base
    for (const base of ownedBases) {
      // Skip the primary/home base
      if (base.position.q === primaryPos.q && base.position.r === primaryPos.r) continue;

      // Hex distance check
      const dq = Math.abs(unit.position.q - base.position.q);
      const dr = Math.abs(unit.position.r - base.position.r);
      const ds = Math.abs((-unit.position.q - unit.position.r) - (-base.position.q - base.position.r));
      const dist = Math.max(dq, dr, ds);

      if (dist <= cfg.proximityRadius) {
        // Award trade gold!
        this.ops.addTradeGold(unit.owner, cfg.goldPerDelivery);
        // Show notification only for the local player
        if (unit.owner === this.ops.getLocalPlayerIndex()) {
          this.ops.showNotification(`🔄 +${cfg.goldPerDelivery} trade gold`, '#ffd700');
        }
        return; // only one bonus per delivery
      }
    }
  }

  /** Process all events from UnitAI.update() */
  processEvents(events: UnitEvent[]): void {
    const ops = this.ops;
    const debugFlags = ops.getDebugFlags();

    const localPlayerIndex = ops.getLocalPlayerIndex();
    for (const event of events) {
      // ─── God mode: prevent local player units from dying/taking damage ───
      if (debugFlags.godMode) {
        if (event.type === 'unit:killed' && event.unit && event.unit.owner === localPlayerIndex) {
          event.unit.currentHealth = event.unit.stats.maxHealth;
          continue;
        }
        if (event.type === 'combat' && event.defender && event.defender.owner === localPlayerIndex) {
          event.defender.currentHealth = event.defender.stats.maxHealth;
        }
        if (event.type === 'combat' && event.attacker && event.attacker.owner === localPlayerIndex) {
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
          if (killerOwner === localPlayerIndex) {
            ops.showNotification(`💰 +${goldReward} gold`, '#FFD700');
            ops.updateResources(ops.getPlayers()[localPlayerIndex], ops.getWoodStockpile()[localPlayerIndex], ops.getFoodStockpile()[localPlayerIndex], ops.getStoneStockpile()[localPlayerIndex]);
          }
        }

        // Speech bubbles: death bark for the dying unit, kill bark for the killer
        ops.triggerSpeechBubble(event.unit.id, event.unit.type, 'death');
        if (event.killer) {
          ops.triggerSpeechBubble(event.killer.id, event.killer.type, 'kill');
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
        // Speech bubbles: attacker barks on strike, defender barks on getting hit
        ops.triggerSpeechBubble(event.attacker.id, event.attacker.type, 'attack');
        ops.triggerSpeechBubble(event.defender.id, event.defender.type, 'attacked');

        // Ogre has range 2 for gameplay reach but attacks as melee (club slam, not projectile)
        const isRangedAttack = event.attacker.stats.range > 1 && event.attacker.type !== UnitType.OGRE;

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
          // Persistent red bleed tint on wounded units
          if (defender.currentHealth > 0 && defender.currentHealth < defender.stats.maxHealth) {
            defender._bleedActive = true;
            ops.applyBleedTint(defender.id, defender.currentHealth / defender.stats.maxHealth);
          }
          if (attacker.currentHealth > 0 && attacker.currentHealth < attacker.stats.maxHealth && !attacker._bleedActive) {
            attacker._bleedActive = true;
            ops.applyBleedTint(attacker.id, attacker.currentHealth / attacker.stats.maxHealth);
          }
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
              // Archer level-up bonus: fire a second arrow at level 2+
              if (event.attacker.level >= 2 && event.defender.currentHealth > 0) {
                const archerAtk = event.attacker;
                const atkWp = archerAtk.worldPosition;
                const defWp = event.defender.worldPosition;
                const secondDefId = defId;
                // Slight offset for visual variety + 150ms delay
                const offsetFrom = { x: atkWp.x + 0.15, y: atkWp.y, z: atkWp.z - 0.1 };
                ops.queueDeferredEffect(150, () => {
                  ops.fireArrow(offsetFrom, defWp, secondDefId, () => {
                    // Second arrow deals 50% damage
                    const target = ops.getAllUnits().find(u => u.id === secondDefId);
                    if (target && target.currentHealth > 0) {
                      const bonusDmg = Math.max(1, Math.floor(archerAtk.stats.attack * 0.5));
                      target.currentHealth = Math.max(0, target.currentHealth - bonusDmg);
                      ops.updateHealthBar(target);
                      ops.showDamageEffect(target.worldPosition);
                    }
                  });
                });
              }
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
                // Lightning bolt — chain/electrocute/HV cascade logic extracted to handleLightningImpact
                ops.fireLightningBolt(attackerRef.worldPosition, defenderRef.worldPosition, defId, () => {
                  CombatEventHandler.handleLightningImpact(attackerRef, defenderRef, defId, elem, applyDamageVisuals, ops);
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
            // Cycle element to next in sequence (unless locked to a specific element)
            if (attackerRef._lockedElement) {
              // Spell queue active — stay on locked element
              attackerRef.element = attackerRef._lockedElement;
            } else {
              const ELEMENT_CYCLE = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
              const cycleIdx = attackerRef._elementCycleIndex ?? 0;
              const nextIdx = (cycleIdx + 1) % ELEMENT_CYCLE.length;
              attackerRef._elementCycleIndex = nextIdx;
              attackerRef.element = ELEMENT_CYCLE[nextIdx];
            }
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
            // Cycle Battlemage element to next in sequence (unless locked)
            if (bmAttacker._lockedElement) {
              bmAttacker.element = bmAttacker._lockedElement;
            } else {
              const BM_CYCLE = [ElementType.FIRE, ElementType.WATER, ElementType.LIGHTNING, ElementType.WIND, ElementType.EARTH];
              const bmCycleIdx = bmAttacker._elementCycleIndex ?? 0;
              const bmNextIdx = (bmCycleIdx + 1) % BM_CYCLE.length;
              bmAttacker._elementCycleIndex = bmNextIdx;
              bmAttacker.element = BM_CYCLE[bmNextIdx];
            }
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
                // Apply slow debuff — ~2 seconds (120 frames) at 35% speed
                bDefender._slowUntil = UnitAI.gameFrame + 120;
                bDefender._slowFactor = 0.35;
                // Give berserker chase speed boost — ~2 seconds (120 frames)
                bAttacker._chaseBoostUntil = UnitAI.gameFrame + 120;
              }
            });
          } else {
            ops.fireProjectile(event.attacker.worldPosition, event.defender.worldPosition, 0xFF8800, defId, applyDamageVisuals);
          }
          ops.updateHealthBar(event.attacker);
        } else {
          // Reset attack animation so it starts fresh from wind-up (phase 0).
          // This syncs the animation cycle with our fixed strike delay.
          ops.resetAttackAnim(event.attacker.id);
          // Per-unit-type melee strike delay — synced to when the blade connects
          // in the attack animation (wind-up must complete before damage applies)
          const meleeStrikeDelay = CombatEventHandler.MELEE_STRIKE_DELAY[event.attacker.type] ?? 250;

          // Secondary melee attack VFX
          if (event.attacker._useSecondaryAttack) {
            event.attacker._useSecondaryAttack = false;
            const atkType = event.attacker.type;
            const atkPos = event.attacker.worldPosition;
            const defPos = event.defender.worldPosition;

            if (atkType === UnitType.GREATSWORD) {
              // Green glow charge-up → spin slash ring
              ops.spawnGreatswordSpin(atkPos);
              ops.playSound('hit_slash');
            } else if (atkType === UnitType.WARRIOR) {
              // Jump attack: leap up then slam down
              ops.animateJumpAttack(event.attacker.id);
              ops.queueDeferredEffect(300, () => {
                ops.spawnJumpAttackImpact(defPos);
                ops.playSound('hit_heavy');
              });
            } else if (atkType === UnitType.PALADIN) {
              // Charge: blue force field during approach, white burst on impact
              ops.spawnPaladinChargeField(event.attacker.id);
              ops.queueDeferredEffect(meleeStrikeDelay, () => {
                ops.spawnPaladinImpactBurst(defPos);
                ops.playSound('shield_deflect');
              });
            } else if (atkType === UnitType.CHAMPION) {
              // Hammer slam: ground shockwave on impact
              ops.queueDeferredEffect(meleeStrikeDelay, () => {
                ops.spawnJumpAttackImpact(defPos);
                ops.playSound('hit_heavy');
              });
            }
          }

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

      // ─── Ogre ground pound VFX (synced to end of club slam impact phase) ───
      // Animation phases: wind-up 0–0.35, slam 0.35–0.50, ground-impact 0.50–0.65, recovery 0.65–1.0
      // At speed 0.6: impact hold ends at cycle 0.65 → 0.65/0.6*1000 ≈ 1083ms
      // We fire VFX + whomp at the tail end of the impact-tremor phase + slight delay
      if ((event as any).type === 'combat:ogreSlam') {
        const slamEvt = event as any;
        const aPos = slamEvt.attackerWorldPos;
        const tPos = slamEvt.targetWorldPos;
        // Offset the burst center slightly in front of the ogre (toward target)
        const dx = tPos.x - aPos.x;
        const dz = tPos.z - aPos.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const offset = 1.0; // 1 unit forward
        const burstCenter = {
          x: aPos.x + (dx / len) * offset,
          y: aPos.y,
          z: aPos.z + (dz / len) * offset,
        };
        // Defer VFX to end of impact-tremor phase (cycle 0.65 @ speed 0.6 = 1083ms)
        // Animation now starts from cycle 0 on each attack via resetAttackAnim()
        const ogreImpactEnd = 1083;
        ops.queueDeferredEffect(ogreImpactEnd, () => {
          ops.spawnOgreGroundPound(burstCenter);
        });
        // Whomp sound slightly after visual for cinematic weight
        ops.queueDeferredEffect(ogreImpactEnd + 80, () => {
          ops.playSound('ogre_whomp');
        });
      }

      // ─── Greatsword / Ogre cleave knockback ───
      if ((event as any).type === 'combat:cleave') {
        const ce = event as any;
        const isOgreKnockback = ce.attackerType === UnitType.OGRE;
        const applyCleave = () => {
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
        };
        if (isOgreKnockback) {
          // Defer knockback to just after ground pound VFX (shockwave reaches enemies then they fly)
          // 1083ms (tremor end) + 150ms (shockwave propagation)
          const ogreKnockbackDelay = 1233;
          ops.queueDeferredEffect(ogreKnockbackDelay, applyCleave);
        } else {
          applyCleave();
        }
      }

      // ─── Greatsword Sweep Crit (level 2+ bonus, 4+ enemies hit) ───
      if ((event as any).type === 'combat:sweepCrit') {
        const sc = event as any;
        ops.showCritText(sc.worldPos, `SWEEP x${sc.hitCount}`, sc.hitCount * 2, '#66ff44');
        ops.playSound('hit_heavy');
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
          // Permanent visual upgrades: size, badges, armor trim
          ops.applyLevelUpVisuals(unit.id, lvlEvt.newLevel);
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
        this.checkTradeRouteBonus(event.unit!);
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
        this.checkTradeRouteBonus(event.unit!);
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
        this.checkTradeRouteBonus(event.unit!);
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

  // ── Extracted helpers (reduce callback nesting) ─────────────────────

  /** Check if a unit is dead, and if so mark + remove + play death sound. Returns true if dead. */
  private static checkDeath(unit: Unit, ops: CombatEventOps, killer?: Unit): boolean {
    if (unit.currentHealth <= 0) {
      unit.state = UnitState.DEAD;
      ops.removeUnitFromGame(unit, killer);
      ops.playSound('death');
      return true;
    }
    return false;
  }

  /**
   * Apply High Voltage cascade from a source unit: consume HV status, stun,
   * deal cascade damage, and arc-chain to nearby enemies.
   */
  private static applyHighVoltageCascade(
    source: Unit, attacker: Unit, defender: Unit,
    allUnits: Unit[], ops: CombatEventOps,
  ): void {
    const hvCfg = GAME_CONFIG.combat.statusEffects.highVoltage;
    if (!source._statusHighVoltage || UnitAI.gameFrame >= source._statusHighVoltage || source.currentHealth <= 0) return;

    source._statusHighVoltage = 0; // consume
    source._knockupUntil = UnitAI.gameFrame + Math.round(hvCfg.stunDuration * 60);
    const hvDmg = Math.max(1, Math.round(attacker.stats.attack * hvCfg.cascadeDamageMultiplier));
    source.currentHealth = Math.max(0, source.currentHealth - hvDmg);
    ops.updateHealthBar(source);
    ops.showCritText(source.worldPosition, 'HIGH VOLTAGE', hvDmg, '#44eeff');
    ops.playSound('splash_aoe');
    CombatLog.logCombo(attacker, source, 'high_voltage', hvDmg);

    // Arc cascade to nearby enemies
    const cascadeTargets = allUnits
      .filter(u => u.id !== source.id && u.id !== defender.id && u.owner !== attacker.owner && u.currentHealth > 0 && u.state !== 'dead')
      .map(u => ({ unit: u, dist: hexDistQR(u.position.q, u.position.r, source.position.q, source.position.r) }))
      .filter(e => e.dist <= hvCfg.cascadeChainRadius)
      .sort((a, b) => a.dist - b.dist || a.unit.id.localeCompare(b.unit.id))
      .slice(0, hvCfg.cascadeChainCount);

    for (const ct of cascadeTargets) {
      const cDmg = Math.max(1, Math.round(attacker.stats.attack * hvCfg.cascadeDamageMultiplier));
      ct.unit.currentHealth = Math.max(0, ct.unit.currentHealth - cDmg);
      ct.unit._knockupUntil = UnitAI.gameFrame + Math.round(hvCfg.stunDuration * 60);
      const cascRef = ct.unit;
      ops.queueDeferredEffect(100, () => {
        ops.fireLightningChain(source.worldPosition, cascRef.worldPosition, cascRef.id);
        ops.spawnElectrocuteEffect(cascRef.id);
        ops.flashUnit(cascRef.id, 0.2);
        ops.updateHealthBar(cascRef);
        CombatEventHandler.checkDeath(cascRef, ops, attacker);
      });
    }

    CombatEventHandler.checkDeath(source, ops, attacker);
  }

  /**
   * Lightning bolt impact handler — extracted from the deeply nested inline callback.
   * Handles: damage visuals, electrocute crit chain, HV cascade, normal chain lightning.
   */
  private static handleLightningImpact(
    attackerRef: Unit, defenderRef: Unit, defId: string,
    elem: ElementType, applyDamageVisuals: () => void, ops: CombatEventOps,
  ): void {
    applyDamageVisuals();
    const allUnits = ops.getAllUnits();
    const statusEvents = StatusEffectSystem.applyMageElement(attackerRef, defenderRef, elem, allUnits);
    const hasElectrocute = statusEvents.some(e => e.effect === 'electrocute');

    if (hasElectrocute) {
      ops.playSound('combo_electrocute');
      const ecEvt = statusEvents.find(e => e.effect === 'electrocute');
      if (ecEvt?.spreadTo) {
        for (const sid of ecEvt.spreadTo) {
          const chainUnit = allUnits.find(u => u.id === sid);
          if (chainUnit) {
            ops.queueDeferredEffect(150, () => {
              ops.fireLightningChain(defenderRef.worldPosition, chainUnit.worldPosition, chainUnit.id);
              ops.spawnElectrocuteEffect(chainUnit.id);
              ops.updateHealthBar(chainUnit);
              CombatEventHandler.applyHighVoltageCascade(chainUnit, attackerRef, defenderRef, allUnits, ops);
              if (chainUnit.currentHealth > 0) return; // HV cascade may have killed it
              // If still alive after HV check, see if electrocute itself killed it
              CombatEventHandler.checkDeath(chainUnit, ops, attackerRef);
            });
          }
        }
      }
      // Check if PRIMARY target has High Voltage
      CombatEventHandler.applyHighVoltageCascade(defenderRef, attackerRef, defenderRef, allUnits, ops);
      ops.spawnElectrocuteEffect(defId);
      ops.playSound('hit_ranged');
      const ecDmg = ecEvt?.damage || GAME_CONFIG.combat.statusEffects.electrocuteCrit.damageMultiplier * attackerRef.stats.attack;
      ops.showCritText(defenderRef.worldPosition, 'ELECTROCUTE', ecDmg, '#ffee44');
    } else {
      // Normal chain lightning (no Wet status) — reduced chain
      const chainTargets = allUnits
        .filter(u => u.id !== defenderRef.id && u.owner !== attackerRef.owner && u.state !== 'dead')
        .map(u => ({ unit: u, dist: hexDistQR(u.position.q, u.position.r, defenderRef.position.q, defenderRef.position.r) }))
        .filter(e => e.dist <= 3)
        .sort((a, b) => a.dist - b.dist || a.unit.id.localeCompare(b.unit.id))
        .slice(0, 2);
      for (const ct of chainTargets) {
        const chainDmg = Math.max(1, Math.floor(attackerRef.stats.attack * 0.5));
        ct.unit.currentHealth = Math.max(0, ct.unit.currentHealth - chainDmg);
        ops.queueDeferredEffect(150, () => {
          ops.fireLightningChain(defenderRef.worldPosition, ct.unit.worldPosition, ct.unit.id);
          ops.spawnElectrocuteEffect(ct.unit.id);
          ops.updateHealthBar(ct.unit);
          CombatEventHandler.checkDeath(ct.unit, ops, attackerRef);
        });
      }
      ops.spawnElectrocuteEffect(defId);
    }
    CombatEventHandler.handleStatusEvents(
      statusEvents.filter(e => e.effect !== 'electrocute'), ops, attackerRef
    );
  }

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
            ops.playSound('combo_inferno');
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
            ops.playSound('combo_kamehameha');
            ops.showCritText(unit.worldPosition, 'KAMEHAMEHA', evt.damage || 9, '#aa44ff');

            // Draw dedicated Kamehameha laser beam from caster through all pierced enemies
            if (evt.casterId) {
              const caster = ops.getAllUnits().find(u => u.id === evt.casterId);
              if (caster) {
                // Collect all impact positions along the beam
                const piercedPositions: { x: number; y: number; z: number }[] = [
                  { x: unit.worldPosition.x, y: unit.worldPosition.y, z: unit.worldPosition.z },
                ];
                // Primary target gets electrocute sparks
                ops.spawnElectrocuteEffect(unit.id);

                // Compute beam endpoint (extend beyond last pierced target)
                const dq = unit.position.q - caster.position.q;
                const dr = unit.position.r - caster.position.r;
                const len = Math.max(Math.abs(dq), Math.abs(dr), 1);
                const stepQ = Math.round(dq / len);
                const stepR = Math.round(dr / len);
                // Default endpoint: 4 hexes beyond primary target
                let endX = unit.worldPosition.x + stepQ * 1.5 * 4;
                let endZ = unit.worldPosition.z + stepR * 1.5 * 4;
                let endY = unit.worldPosition.y;

                if (evt.piercedIds) {
                  for (const pid of evt.piercedIds) {
                    const pierced = ops.getAllUnits().find(u => u.id === pid);
                    if (pierced) {
                      piercedPositions.push({
                        x: pierced.worldPosition.x, y: pierced.worldPosition.y, z: pierced.worldPosition.z,
                      });
                      // Extend endpoint beyond the last pierced unit
                      endX = pierced.worldPosition.x + stepQ * 1.5 * 2;
                      endZ = pierced.worldPosition.z + stepR * 1.5 * 2;
                      endY = pierced.worldPosition.y;

                      // Deferred damage visuals for each pierced target
                      ops.queueDeferredEffect(100, () => {
                        ops.spawnElectrocuteEffect(pierced.id);
                        ops.flashUnit(pierced.id, 0.2);
                        ops.updateHealthBar(pierced);
                        if (pierced.currentHealth <= 0) {
                          pierced.state = UnitState.DEAD;
                          ops.removeUnitFromGame(pierced, caster);
                          ops.playSound('death');
                        }
                      });
                    }
                  }
                }

                // Fire the full beam VFX
                ops.fireKamehamehaBeam(
                  caster.worldPosition,
                  { x: endX, y: endY, z: endZ },
                  piercedPositions,
                );
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
}
