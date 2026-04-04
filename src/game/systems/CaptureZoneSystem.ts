// ============================================
// CUBITOPIA - Capture Zone System
// Zone-control base capture: hold majority in a
// 5-hex radius zone to capture bases over time.
// ============================================

import * as THREE from 'three';
import { Base, HexCoord, Unit, UnitState } from '../../types';
import { Pathfinder } from './Pathfinder';
import { GAME_CONFIG } from '../GameConfig';
import { getPlayerHex } from '../PlayerConfig';

/** How long (seconds) full-majority capture takes */
const CAPTURE_DURATION = GAME_CONFIG.captureZone.captureDuration;
/** Hex radius of the capture zone */
const ZONE_RADIUS = GAME_CONFIG.captureZone.zoneRadius;
/** Minimum unit advantage to make progress (prevents 1-unit trickle captures) */
const MIN_ADVANTAGE = GAME_CONFIG.captureZone.minAdvantage;
/** Neutral gold color for unowned bases */
const NEUTRAL_COLOR = 0xd4af37;

export interface CaptureZoneState {
  base: Base;
  /** Current controlling team (matches base.owner). -1 = truly neutral (no one has started). */
  controller: number;
  /** Who is actively capturing (the team making progress). -1 = nobody / contested stalemate. */
  capturer: number;
  /** Capture progress 0..1 — reaches 1 to flip ownership */
  progress: number;
  /** Per-team unit counts inside the zone this tick */
  unitCounts: number[];
  /** Is the zone currently contested (both teams present)? */
  contested: boolean;
  /** Is this a main base (instant defeat on capture) vs neutral */
  isMainBase: boolean;
  /** Is underground base? */
  isUnderground: boolean;
  /** Visual: zone ring mesh */
  zoneMesh: THREE.Mesh | null;
  /** Visual: glowing light column */
  lightColumn: THREE.Mesh | null;
  /** Visual: capture progress bar background */
  progressBarBg: THREE.Mesh | null;
  /** Visual: capture progress bar fill */
  progressBarFill: THREE.Mesh | null;
  /** Visual: capture progress bar contested overlay */
  progressBarContested: THREE.Mesh | null;
}

/** Get color for a player/owner — falls back to neutral gold for non-player owners */
function getOwnerColor(owner: number, playerCount: number): number {
  if (owner >= 0 && owner < playerCount) return getPlayerHex(owner);
  return NEUTRAL_COLOR;
}

export class CaptureZoneSystem {
  private scene: THREE.Scene;
  private zones: CaptureZoneState[] = [];
  private playerCount: number;

  constructor(scene: THREE.Scene, playerCount: number = 2) {
    this.scene = scene;
    this.playerCount = playerCount;
  }

  /** Register a base as a capture zone */
  addZone(base: Base, isMainBase: boolean, isUnderground: boolean): void {
    // Remove existing zone for this base if any
    this.removeZone(base.id);

    const state: CaptureZoneState = {
      base,
      controller: base.owner,
      capturer: -1,
      progress: 0,
      unitCounts: new Array(this.playerCount).fill(0),
      contested: false,
      isMainBase,
      isUnderground,
      zoneMesh: null,
      lightColumn: null,
      progressBarBg: null,
      progressBarFill: null,
      progressBarContested: null,
    };

    // Create zone visual ring
    this.createZoneVisuals(state);
    this.zones.push(state);
  }

  /** Remove a zone by base id */
  removeZone(baseId: string): void {
    const idx = this.zones.findIndex(z => z.base.id === baseId);
    if (idx >= 0) {
      this.disposeZoneVisuals(this.zones[idx]);
      this.zones.splice(idx, 1);
    }
  }

  /** Get all zone states (for HUD display) */
  getZones(): readonly CaptureZoneState[] {
    return this.zones;
  }

  /** Get zone for a specific base */
  getZoneForBase(baseId: string): CaptureZoneState | undefined {
    return this.zones.find(z => z.base.id === baseId);
  }

  /**
   * Main update — call every frame.
   * Returns capture events: { baseId, newOwner, previousOwner }
   */
  update(allUnits: Unit[], delta: number): CaptureEvent[] {
    const events: CaptureEvent[] = [];

    for (const zone of this.zones) {
      if (zone.base.destroyed) continue;

      // Count units per team in the zone
      zone.unitCounts = new Array(this.playerCount).fill(0);
      const baseY = zone.base.worldPosition.y;
      for (const unit of allUnits) {
        if (unit.state === UnitState.DEAD || unit._pendingRangedDeath) continue;
        if (unit._garrisoned) continue; // Garrisoned units don't count for zone capture
        if (unit.owner >= this.playerCount) continue; // Only real players

        // Layer check: unit must be on the same vertical layer as the base.
        // Underground bases sit well below surface — require Y within 3 units
        // to prevent surface units walking above from counting.
        const yDiff = Math.abs(unit.worldPosition.y - baseY);
        if (yDiff > 3) continue;

        const dist = Pathfinder.heuristic(unit.position, zone.base.position);
        if (dist <= ZONE_RADIUS) {
          zone.unitCounts[unit.owner]++;
        }
      }

      // Determine majority: find team with most units, check if contested
      let bestTeam = -1;
      let bestCount = 0;
      let secondBest = 0;
      let teamsPresent = 0;
      for (let i = 0; i < this.playerCount; i++) {
        if (zone.unitCounts[i] > 0) teamsPresent++;
        if (zone.unitCounts[i] > bestCount) {
          secondBest = bestCount;
          bestCount = zone.unitCounts[i];
          bestTeam = i;
        } else if (zone.unitCounts[i] > secondBest) {
          secondBest = zone.unitCounts[i];
        }
      }
      zone.contested = teamsPresent > 1;

      // Advantage is lead over second-best team
      const advantage = bestCount - secondBest;
      const majorityTeam = bestCount > 0 ? bestTeam : -1;

      if (majorityTeam === -1 || advantage < MIN_ADVANTAGE) {
        // Stalemate — no progress either way
        zone.capturer = -1;
      } else if (majorityTeam === zone.controller) {
        // Controlling team has majority — if progress was being made against them, push it back
        if (zone.progress > 0) {
          // Defenders reclaim: progress decays at rate proportional to advantage
          const rate = (advantage / CAPTURE_DURATION) * delta;
          zone.progress = Math.max(0, zone.progress - rate);
          zone.capturer = majorityTeam;
        } else {
          zone.capturer = -1; // Already fully controlled, no action
        }
      } else {
        // Attacking team has majority — advance capture
        zone.capturer = majorityTeam;
        const rate = (advantage / CAPTURE_DURATION) * delta;
        zone.progress = Math.min(1, zone.progress + rate);

        if (zone.progress >= 1) {
          // CAPTURED!
          const previousOwner = zone.controller;
          zone.controller = majorityTeam;
          zone.base.owner = majorityTeam;
          zone.progress = 0;
          zone.capturer = -1;

          events.push({
            baseId: zone.base.id,
            newOwner: majorityTeam,
            previousOwner,
            isMainBase: zone.isMainBase,
          });
        }
      }

      // Update visuals
      this.updateZoneVisuals(zone);
    }

    return events;
  }

  // =========== VISUALS ===========

  private createZoneVisuals(zone: CaptureZoneState): void {
    const basePos = zone.base.worldPosition;
    const color = getOwnerColor(zone.controller, this.playerCount);

    // Zone boundary ring — a flat ring at the zone radius
    // Approximate hex radius in world units: each hex is ~1.5 apart
    const worldRadius = ZONE_RADIUS * 1.5;
    const ringGeo = new THREE.RingGeometry(worldRadius - 0.3, worldRadius, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(basePos.x, basePos.y + 0.1, basePos.z);
    this.scene.add(ring);
    zone.zoneMesh = ring;

    // Glowing light column — tall translucent cylinder
    const colHeight = 12;
    const colGeo = new THREE.CylinderGeometry(0.6, 1.2, colHeight, 16, 1, true);
    const colMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const column = new THREE.Mesh(colGeo, colMat);
    column.position.set(basePos.x, basePos.y + colHeight / 2, basePos.z);
    column.renderOrder = 998;
    this.scene.add(column);
    zone.lightColumn = column;

    // Capture progress bar — floating above the base
    const barWidth = 3.0;
    const barHeight = 0.2;

    const bgGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.position.set(basePos.x, basePos.y + 5.5, basePos.z);
    bg.renderOrder = 999;
    bg.visible = false; // Hidden when no capture in progress
    this.scene.add(bg);
    zone.progressBarBg = bg;

    const fillGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x3498db,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(basePos.x, basePos.y + 5.5, basePos.z);
    fill.renderOrder = 1000;
    fill.visible = false;
    this.scene.add(fill);
    zone.progressBarFill = fill;

    // Contested flash overlay
    const contestGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const contestMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthTest: false,
    });
    const contest = new THREE.Mesh(contestGeo, contestMat);
    contest.position.set(basePos.x, basePos.y + 5.55, basePos.z);
    contest.renderOrder = 1001;
    contest.visible = false;
    this.scene.add(contest);
    zone.progressBarContested = contest;
  }

  private updateZoneVisuals(zone: CaptureZoneState): void {
    const controlColor = getOwnerColor(zone.controller, this.playerCount);
    const capturerColor = zone.capturer >= 0 ? getOwnerColor(zone.capturer, this.playerCount) : controlColor;

    // Update zone ring color — blend toward capturer color during capture
    if (zone.zoneMesh) {
      const mat = zone.zoneMesh.material as THREE.MeshBasicMaterial;
      if (zone.progress > 0 && zone.capturer >= 0 && zone.capturer !== zone.controller) {
        // Lerp between controller and capturer color
        const controlC = new THREE.Color(controlColor);
        const capturerC = new THREE.Color(capturerColor);
        mat.color.copy(controlC).lerp(capturerC, zone.progress);
        mat.opacity = 0.25 + zone.progress * 0.2; // Brighten as capture progresses
      } else {
        mat.color.setHex(controlColor);
        mat.opacity = 0.25;
      }
    }

    // Update light column color and intensity
    if (zone.lightColumn) {
      const mat = zone.lightColumn.material as THREE.MeshBasicMaterial;
      const anyUnits = zone.unitCounts.some(c => c > 0);

      if (anyUnits) {
        // Show column when zone is occupied
        if (zone.capturer >= 0 && zone.progress > 0) {
          mat.color.setHex(capturerColor);
          mat.opacity = 0.12 + zone.progress * 0.15;
        } else {
          mat.color.setHex(controlColor);
          mat.opacity = 0.12;
        }
        zone.lightColumn.visible = true;
      } else {
        // Dim when unoccupied
        mat.color.setHex(controlColor);
        mat.opacity = 0.06;
        zone.lightColumn.visible = true;
      }
    }

    // Update progress bar
    const showBar = zone.progress > 0;
    if (zone.progressBarBg) zone.progressBarBg.visible = showBar;
    if (zone.progressBarFill) {
      zone.progressBarFill.visible = showBar;
      if (showBar) {
        const fillMat = zone.progressBarFill.material as THREE.MeshBasicMaterial;
        fillMat.color.setHex(capturerColor);
        // Scale from left
        zone.progressBarFill.scale.x = Math.max(0.01, zone.progress);
        zone.progressBarFill.position.x = zone.base.worldPosition.x - (1 - zone.progress) * 1.5;
      }
    }

    // Contested flash
    if (zone.progressBarContested) {
      zone.progressBarContested.visible = showBar && zone.contested;
      if (zone.contested && showBar) {
        const cMat = zone.progressBarContested.material as THREE.MeshBasicMaterial;
        // Pulsing opacity for contested indicator
        cMat.opacity = 0.2 + Math.sin(Date.now() * 0.005) * 0.15;
      }
    }
  }

  /** Make progress bars face camera */
  updateBillboards(camera: THREE.Camera): void {
    for (const zone of this.zones) {
      if (zone.progressBarBg) zone.progressBarBg.lookAt(camera.position);
      if (zone.progressBarFill) zone.progressBarFill.lookAt(camera.position);
      if (zone.progressBarContested) zone.progressBarContested.lookAt(camera.position);
    }
  }

  /** Called when a base changes hands — refreshes visuals to new team color */
  refreshZoneVisuals(baseId: string): void {
    const zone = this.zones.find(z => z.base.id === baseId);
    if (!zone) return;
    // Rebuild visuals with new color
    this.disposeZoneVisuals(zone);
    this.createZoneVisuals(zone);
  }

  private disposeZoneVisuals(zone: CaptureZoneState): void {
    const disposeMesh = (mesh: THREE.Mesh | null) => {
      if (!mesh) return;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        (mesh.material as THREE.Material).dispose();
      }
    };
    disposeMesh(zone.zoneMesh);
    disposeMesh(zone.lightColumn);
    disposeMesh(zone.progressBarBg);
    disposeMesh(zone.progressBarFill);
    disposeMesh(zone.progressBarContested);
    zone.zoneMesh = null;
    zone.lightColumn = null;
    zone.progressBarBg = null;
    zone.progressBarFill = null;
    zone.progressBarContested = null;
  }

  dispose(): void {
    for (const zone of this.zones) {
      this.disposeZoneVisuals(zone);
    }
    this.zones.length = 0;
  }
}

export interface CaptureEvent {
  baseId: string;
  newOwner: number;
  previousOwner: number;
  isMainBase: boolean;
}
