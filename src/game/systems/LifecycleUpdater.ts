/**
 * LifecycleUpdater — Handles per-frame lifecycle tasks extracted from main.ts updateRTS:
 * 1. Base tier upgrades (check + apply + spawn reward Ogre)
 * 2. Population disband (kill excess combat units when over food cap)
 * 3. Dead unit cleanup (force-remove lingering dead/stale-pending units)
 */

import { UnitType, UnitState, BaseTier, HexCoord, Unit, Base } from '../../types';
import { UnitFactory } from '../entities/UnitFactory';

export interface LifecycleOps {
  // Base upgrade
  getPlayers(): { units: Unit[]; resources: any }[];
  getBases(): Base[];
  checkAllUpgrades(pid: number): Array<{ baseId: string; newTier: BaseTier }>;
  rebuildBaseForTier(base: Base, elevation: number): void;
  getElevation(pos: HexCoord): number;
  findSpawnTile(q: number, r: number): HexCoord;
  hexToWorld(pos: HexCoord): { x: number; y: number; z: number };
  addUnitToWorld(unit: Unit, elevation: number): void;
  setPlayerUnits(allUnits: Unit[], pid: number): void;
  playSound(name: string, volume: number): void;
  showNotification(msg: string, color: string): void;

  // Population disband
  findExcessUnits(pid: number): string[];
  getUnitById(id: string): Unit | undefined;
  removeUnitFromGame(unit: Unit): void;

  // Dead cleanup
  getAllUnits(): Unit[];
}

export default class LifecycleUpdater {
  private ops: LifecycleOps;
  private tierCheckTimer = 0;
  private deadCleanupTimer = 0;

  constructor(ops: LifecycleOps) {
    this.ops = ops;
  }

  /** Run all lifecycle checks. Call once per frame from updateRTS. */
  update(delta: number): void {
    this.updateBaseTiers(delta);
    this.updatePopulationDisband();
    this.cleanupDeadUnits(delta);
  }

  private updateBaseTiers(delta: number): void {
    this.tierCheckTimer += delta;
    if (this.tierCheckTimer < 2) return;
    this.tierCheckTimer = 0;

    const players = this.ops.getPlayers();
    const bases = this.ops.getBases();
    const allUnits = this.ops.getAllUnits();

    for (let pid = 0; pid < players.length; pid++) {
      const upgrades = this.ops.checkAllUpgrades(pid);
      for (const evt of upgrades) {
        const base = bases.find(b => b.id === evt.baseId);
        if (!base) continue;
        base.tier = evt.newTier;
        this.ops.rebuildBaseForTier(base, this.ops.getElevation(base.position));
        const tierNames = ['Camp', 'Fort', 'Castle'];
        const msg = `🏰 Base upgraded to ${tierNames[evt.newTier]}!`;
        if (pid === 0) {
          this.ops.showNotification(msg, '#f1c40f');
          this.ops.playSound('queue_confirm', 0.8);
        }
        console.log(`[BaseUpgrade] Player ${pid} base ${evt.baseId} → ${tierNames[evt.newTier]}`);

        // Spawn reward Ogre at the upgraded base
        const ogresForTier = evt.newTier;
        if (base.ogresSpawned < ogresForTier) {
          const spawnCoord = this.ops.findSpawnTile(base.position.q, base.position.r);
          const ogre = UnitFactory.create(UnitType.OGRE, pid, spawnCoord);
          ogre.worldPosition = this.ops.hexToWorld(spawnCoord);
          ogre.isSiege = true;
          players[pid].units.push(ogre);
          allUnits.push(ogre);
          const elev = this.ops.getElevation(spawnCoord);
          this.ops.addUnitToWorld(ogre, elev);
          base.ogresSpawned = ogresForTier;
          if (pid === 0) {
            this.ops.showNotification('👹 An Ogre has joined your army!', '#4e342e');
            this.ops.setPlayerUnits(allUnits, 0);
          }
          console.log(`[BaseUpgrade] Spawned Ogre for player ${pid} at (${spawnCoord.q},${spawnCoord.r})`);
        }
      }
    }
  }

  private updatePopulationDisband(): void {
    const players = this.ops.getPlayers();
    for (let pid = 0; pid < players.length; pid++) {
      const excessIds = this.ops.findExcessUnits(pid);
      for (const uid of excessIds) {
        const unit = this.ops.getUnitById(uid);
        if (unit) {
          unit.currentHealth = 0;
          unit.state = UnitState.DEAD;
          this.ops.removeUnitFromGame(unit);
          if (pid === 0) {
            this.ops.showNotification(`⚠️ ${unit.type} disbanded — not enough food!`, '#e74c3c');
          }
          console.log(`[PopDisband] Player ${pid} ${unit.type}(${uid}) disbanded (over food cap)`);
        }
      }
    }
  }

  private cleanupDeadUnits(delta: number): void {
    this.deadCleanupTimer += delta;
    if (this.deadCleanupTimer < 1.0) return;
    this.deadCleanupTimer = 0;

    const now = performance.now();
    const allUnits = this.ops.getAllUnits();
    for (let i = allUnits.length - 1; i >= 0; i--) {
      const u = allUnits[i];
      if (u.state === UnitState.DEAD) {
        console.warn(`[DeadCleanup] Force-removing dead unit ${u.type}(${u.id})`);
        this.ops.removeUnitFromGame(u);
      } else if (u._pendingRangedDeath) {
        if (!u._pendingDeathTimestamp) {
          u._pendingDeathTimestamp = now;
        } else if (now - u._pendingDeathTimestamp > 3000) {
          console.warn(`[DeadCleanup] Force-removing stale pending-death unit ${u.type}(${u.id})`);
          u.state = UnitState.DEAD;
          u._pendingRangedDeath = false;
          this.ops.removeUnitFromGame(u);
        }
      }
    }
  }
}
