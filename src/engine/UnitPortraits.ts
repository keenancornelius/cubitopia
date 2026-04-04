// ============================================
// UNIT PORTRAIT RENDERER
// Renders each unit type to a small offscreen canvas
// and caches the result as a data URL for use in the HUD.
// ============================================

import * as THREE from 'three';
import { UnitType } from '../types';
import { UnitModels } from './UnitModels';

const PORTRAIT_SIZE = 128; // rendered at 2× for retina, displayed at 64×64

// Cached data URLs keyed by unit type
const portraitCache: Map<string, string> = new Map();

// Neutral gold color for portraits (not team-tinted)
const PORTRAIT_PLAYER_COLOR = 0xd4a843;

/**
 * Render a single unit type to a data URL image.
 * Uses an offscreen WebGLRenderer + scene + camera.
 */
function renderPortrait(unitType: UnitType): string {
  const cached = portraitCache.get(unitType);
  if (cached) return cached;

  // Create offscreen renderer
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE);
  renderer.setClearColor(0x000000, 0);

  // Scene + lighting
  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);

  // Build the unit model
  const group = new THREE.Group();
  UnitModels.buildUnitModel(group, unitType, PORTRAIT_PLAYER_COLOR);
  scene.add(group);

  // Compute bounding box to frame the unit
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // Orthographic camera framing the unit with some padding
  const pad = maxDim * 0.25;
  const halfW = (maxDim + pad) / 2;
  const halfH = (maxDim + pad) / 2;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);

  // Position camera at a slight angle for a 3/4 portrait view
  camera.position.set(
    center.x + maxDim * 0.6,
    center.y + maxDim * 0.3,
    center.z + maxDim * 1.2
  );
  camera.lookAt(center);

  // Slight rotation on the model for a more dynamic pose
  group.rotation.y = -0.3;

  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Cleanup GPU resources
  renderer.dispose();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material?.dispose();
      }
    }
  });

  portraitCache.set(unitType, dataUrl);
  return dataUrl;
}

/**
 * Get all unit portrait data URLs. Renders lazily on first call.
 * Returns a Map<UnitType, string> of data URL images.
 */
export function getUnitPortraits(): Map<string, string> {
  const allTypes: UnitType[] = [
    UnitType.WARRIOR, UnitType.ARCHER, UnitType.RIDER, UnitType.SCOUT,
    UnitType.LUMBERJACK, UnitType.BUILDER, UnitType.VILLAGER,
    UnitType.TREBUCHET, UnitType.PALADIN, UnitType.MAGE, UnitType.HEALER,
    UnitType.ASSASSIN, UnitType.SHIELDBEARER, UnitType.BERSERKER,
    UnitType.BATTLEMAGE, UnitType.GREATSWORD, UnitType.OGRE,
  ];

  for (const t of allTypes) {
    if (!portraitCache.has(t)) {
      renderPortrait(t);
    }
  }

  return portraitCache;
}

/**
 * Get a single unit portrait data URL.
 */
export function getUnitPortrait(unitType: UnitType): string {
  const cached = portraitCache.get(unitType);
  if (cached) return cached;
  return renderPortrait(unitType);
}
