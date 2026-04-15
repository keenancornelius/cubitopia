// ============================================
// CUBITOPIA - Game System Type Stubs
// ============================================
// This module contains forward declarations for major game system classes.
// It breaks the circular dependency: types/index.ts imports these types to define GameContext,
// but the implementation modules (engine/UnitRenderer, ui/HUD, etc.) also need GameContext.
// By separating these declarations, we avoid the circular import.

// Forward declarations for major game systems
export interface HUD {
  // Stub: real type defined in ui/HUD
  [key: string]: any;
}

export interface UnitRenderer {
  // Stub: real type defined in engine/UnitRenderer
  [key: string]: any;
}

export interface SelectionManager {
  // Stub: real type defined in game/systems/SelectionManager
  [key: string]: any;
}

export interface TerrainDecorator {
  // Stub: real type defined in engine/TerrainDecorator
  [key: string]: any;
}

export interface VoxelBuilder {
  // Stub: real type defined in engine/VoxelBuilder
  [key: string]: any;
}
