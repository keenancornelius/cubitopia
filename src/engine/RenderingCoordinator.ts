// ============================================
// CUBITOPIA - Rendering Coordinator
// ============================================
// This module acts as a neutral coordinator for rendering subsystems (animations,
// projectiles, speech bubbles, VFX). It breaks circular dependencies between
// UnitRenderer and its subsystems by providing a shared interface they all reference.

import * as THREE from 'three';
import { HexCoord } from '../types';

/** Callback for animation events */
export type AnimationEventListener = (unitId: string, event: string) => void;

/** Callback for projectile events */
export type ProjectileEventListener = (event: ProjectileEvent) => void;

/** Callback for VFX events */
export type VFXEventListener = (event: VFXEvent) => void;

/** Callback for speech bubble events */
export type SpeechBubbleEventListener = (event: SpeechBubbleEvent) => void;

/** Projectile event for rendering */
export interface ProjectileEvent {
  type: 'spawn' | 'impact' | 'destroy';
  sourceUnitId: string;
  targetPosition: { x: number; y: number; z: number };
  gameFrame: number;
  projectileType?: string;
}

/** VFX event for rendering */
export interface VFXEvent {
  type: string; // 'hit', 'heal', 'status_apply', etc.
  position: { x: number; y: number; z: number };
  unitId?: string;
  intensity: number; // 0.0 to 1.0
  element?: string; // For elemental effects
}

/** Speech bubble event for rendering */
export interface SpeechBubbleEvent {
  unitId: string;
  text: string;
  duration: number; // In game frames
  type?: 'dialogue' | 'taunt' | 'system';
}

/** Global rendering coordinator singleton */
class RenderingCoordinator {
  private animationListeners: AnimationEventListener[] = [];
  private projectileListeners: ProjectileEventListener[] = [];
  private vfxListeners: VFXEventListener[] = [];
  private speechBubbleListeners: SpeechBubbleEventListener[] = [];

  // Cache for animation states by unit
  private animationStates = new Map<string, {
    isPlaying: boolean;
    currentAnimation: string;
    speed: number;
  }>();

  // Cache for active projectiles
  private activeProjectiles = new Map<string, ProjectileEvent>();

  /**
   * Register a listener for animation events
   */
  onAnimationEvent(listener: AnimationEventListener): void {
    this.animationListeners.push(listener);
  }

  /**
   * Register a listener for projectile events
   */
  onProjectileEvent(listener: ProjectileEventListener): void {
    this.projectileListeners.push(listener);
  }

  /**
   * Register a listener for VFX events
   */
  onVFXEvent(listener: VFXEventListener): void {
    this.vfxListeners.push(listener);
  }

  /**
   * Register a listener for speech bubble events
   */
  onSpeechBubbleEvent(listener: SpeechBubbleEventListener): void {
    this.speechBubbleListeners.push(listener);
  }

  /**
   * Emit an animation event
   */
  emitAnimationEvent(unitId: string, event: string): void {
    this.animationListeners.forEach(listener => listener(unitId, event));
  }

  /**
   * Emit a projectile event
   */
  emitProjectileEvent(event: ProjectileEvent): void {
    if (event.type === 'spawn') {
      this.activeProjectiles.set(`${event.sourceUnitId}-${event.gameFrame}`, event);
    } else if (event.type === 'destroy' || event.type === 'impact') {
      Array.from(this.activeProjectiles.entries()).forEach(([key, proj]) => {
        if (proj.sourceUnitId === event.sourceUnitId) {
          this.activeProjectiles.delete(key);
        }
      });
    }
    this.projectileListeners.forEach(listener => listener(event));
  }

  /**
   * Emit a VFX event
   */
  emitVFXEvent(event: VFXEvent): void {
    this.vfxListeners.forEach(listener => listener(event));
  }

  /**
   * Emit a speech bubble event
   */
  emitSpeechBubbleEvent(event: SpeechBubbleEvent): void {
    this.speechBubbleListeners.forEach(listener => listener(event));
  }

  /**
   * Set animation state for a unit
   */
  setAnimationState(unitId: string, animation: string, speed: number = 1.0, playing: boolean = true): void {
    this.animationStates.set(unitId, { isPlaying: playing, currentAnimation: animation, speed });
  }

  /**
   * Get animation state for a unit
   */
  getAnimationState(unitId: string) {
    return this.animationStates.get(unitId);
  }

  /**
   * Get all active projectiles
   */
  getActiveProjectiles(): ProjectileEvent[] {
    return Array.from(this.activeProjectiles.values());
  }

  /**
   * Clear all state (call on game reset)
   */
  clear(): void {
    this.animationListeners = [];
    this.projectileListeners = [];
    this.vfxListeners = [];
    this.speechBubbleListeners = [];
    this.animationStates.clear();
    this.activeProjectiles.clear();
  }
}

// Global singleton instance
export const renderingCoordinator = new RenderingCoordinator();
