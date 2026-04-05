// ============================================
// CINEMATIC RECORDER - INTEGRATION EXAMPLES
// ============================================
// Quick examples showing how to use the recorder in Cubitopia
// Copy and adapt these snippets into your game code

import { CinematicPath, CinematicRecorder, recordCinematicSequence } from './cinematic-recorder';
import * as THREE from 'three';
import { StrategyCamera } from '../src/engine/Camera';

// ============================================
// EXAMPLE 1: Record a preset path with one line
// ============================================

export async function quickRecordBattleScene(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera
): Promise<void> {
  const path = CinematicPath.battleFlyby();
  await recordCinematicSequence(canvas, camera, path, 'battle-cinematic.webm');
}

// ============================================
// EXAMPLE 2: Record base progression at 60fps
// ============================================

export async function recordBaseTierProgression(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera
): Promise<void> {
  const path = CinematicPath.baseTierUp();
  await recordCinematicSequence(canvas, camera, path, 'base-progression.webm', {
    fps: 60,
    videoBitrate: 8000000, // 8 Mbps for better quality
  });
  console.log('Base progression cinematic saved as base-progression.webm');
}

// ============================================
// EXAMPLE 3: Manual control for complex workflows
// ============================================

export async function recordWithProgressTracking(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera
): Promise<void> {
  const recorder = new CinematicRecorder();

  console.log('Starting recording...');
  await recorder.startRecording(canvas, { fps: 30 });

  const path = CinematicPath.overviewSweep();
  const pathDuration = path.getTotalDuration();

  // Play the path
  recorder.playPath(path, camera, () => {
    console.log('Playback complete');
  });

  // Wait for animation to complete
  await new Promise((resolve) => setTimeout(resolve, (pathDuration + 1) * 1000));

  console.log('Stopping recording...');
  const videoBlob = await recorder.stopRecording();
  console.log(`Video recorded: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

  // Download it
  recorder.downloadRecording('overview-sweep.webm');
}

// ============================================
// EXAMPLE 4: Create a custom cinematic path
// ============================================

export function createCustomBaseShowcase(): CinematicPath {
  const path = new CinematicPath();
  const baseCenter = new THREE.Vector3(15, 0, 15);

  // Far approach
  path.addKeyframe(new THREE.Vector3(50, 40, 50), baseCenter, 3);

  // Closer approach
  path.addKeyframe(new THREE.Vector3(30, 25, 30), baseCenter, 2);

  // Circle left side
  path.addKeyframe(new THREE.Vector3(5, 18, 15), baseCenter, 2.5);

  // Circle right side
  path.addKeyframe(new THREE.Vector3(25, 18, 15), baseCenter, 2.5);

  // Rise up and back out
  path.addKeyframe(new THREE.Vector3(40, 50, 40), baseCenter, 3);

  return path;
}

// ============================================
// EXAMPLE 5: Integration with game UI button
// ============================================

export function setupCinematicButtons(
  gameCanvas: HTMLCanvasElement,
  gameCamera: StrategyCamera
): void {
  // Create a simple button container (you'd integrate this into your UI)
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.zIndex = '1000';
  container.style.display = 'flex';
  container.style.gap = '10px';
  container.style.flexDirection = 'column';

  const styles = {
    padding: '10px 15px',
    background: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'monospace',
  };

  // Battle flyby button
  const btnBattle = document.createElement('button');
  btnBattle.textContent = 'Record Battle';
  Object.assign(btnBattle.style, styles);
  btnBattle.onclick = async () => {
    btnBattle.disabled = true;
    btnBattle.textContent = 'Recording...';
    try {
      await quickRecordBattleScene(gameCanvas, gameCamera);
    } catch (err) {
      console.error('Recording failed:', err);
      alert('Recording failed - check console');
    } finally {
      btnBattle.disabled = false;
      btnBattle.textContent = 'Record Battle';
    }
  };

  // Base progression button
  const btnBase = document.createElement('button');
  btnBase.textContent = 'Record Base Tier';
  Object.assign(btnBase.style, styles);
  btnBase.onclick = async () => {
    btnBase.disabled = true;
    btnBase.textContent = 'Recording...';
    try {
      await recordBaseTierProgression(gameCanvas, gameCamera);
    } catch (err) {
      console.error('Recording failed:', err);
      alert('Recording failed - check console');
    } finally {
      btnBase.disabled = false;
      btnBase.textContent = 'Record Base Tier';
    }
  };

  // Overview sweep button
  const btnOverview = document.createElement('button');
  btnOverview.textContent = 'Record Overview';
  Object.assign(btnOverview.style, styles);
  btnOverview.onclick = async () => {
    btnOverview.disabled = true;
    btnOverview.textContent = 'Recording...';
    try {
      const path = CinematicPath.overviewSweep();
      await recordCinematicSequence(gameCanvas, gameCamera, path, 'overview-sweep.webm');
    } catch (err) {
      console.error('Recording failed:', err);
      alert('Recording failed - check console');
    } finally {
      btnOverview.disabled = false;
      btnOverview.textContent = 'Record Overview';
    }
  };

  // Tribe showcase button
  const btnTribe = document.createElement('button');
  btnTribe.textContent = 'Record Tribe';
  Object.assign(btnTribe.style, styles);
  btnTribe.onclick = async () => {
    btnTribe.disabled = true;
    btnTribe.textContent = 'Recording...';
    try {
      const path = CinematicPath.tribeShowcase();
      await recordCinematicSequence(gameCanvas, gameCamera, path, 'tribe-showcase.webm');
    } catch (err) {
      console.error('Recording failed:', err);
      alert('Recording failed - check console');
    } finally {
      btnTribe.disabled = false;
      btnTribe.textContent = 'Record Tribe';
    }
  };

  container.appendChild(btnBattle);
  container.appendChild(btnBase);
  container.appendChild(btnOverview);
  container.appendChild(btnTribe);

  document.body.appendChild(container);
  console.log('Cinematic recorder buttons added to screen');
}

// ============================================
// EXAMPLE 6: Debug path visualization
// ============================================

export function visualizePathKeyframes(path: CinematicPath, scene: THREE.Scene): void {
  // This is a helper to visualize where keyframes are in the scene
  // Useful for debugging camera paths

  const geometry = new THREE.SphereGeometry(1, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  for (let t = 0; t <= 1; t += 0.05) {
    const frame = path.evaluate(t);
    const sphere = new THREE.Mesh(geometry, material.clone());
    sphere.position.copy(frame.position);
    sphere.scale.multiplyScalar(0.5);
    scene.add(sphere);
  }

  console.log(`Added ${Math.ceil(1 / 0.05) + 1} keyframe markers to scene`);
}

// ============================================
// EXAMPLE 7: Record multiple cinematics in sequence
// ============================================

export async function recordMultipleCinematics(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera
): Promise<void> {
  const paths = [
    { name: 'battle', path: CinematicPath.battleFlyby() },
    { name: 'base-tier', path: CinematicPath.baseTierUp() },
    { name: 'overview', path: CinematicPath.overviewSweep() },
    { name: 'tribe', path: CinematicPath.tribeShowcase() },
  ];

  for (const { name, path } of paths) {
    const filename = `cinematic-${name}.webm`;
    console.log(`Recording ${name}...`);
    try {
      await recordCinematicSequence(canvas, camera, path, filename);
      console.log(`✓ ${filename} complete`);
    } catch (err) {
      console.error(`✗ Failed to record ${filename}:`, err);
    }
  }

  console.log('All cinematics recorded');
}
