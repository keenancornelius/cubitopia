// ============================================
// CUBITOPIA - Cinematic Recorder Tool
// ============================================
// Automate camera flythroughs and record them for marketing content
// Import into the game and use to create cinematic sequences

import * as THREE from 'three';
import { StrategyCamera } from '../src/engine/Camera';

// ============================================
// KEYFRAME & INTERPOLATION UTILITIES
// ============================================

interface CinematicKeyframe {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  duration: number;  // seconds
}

type EasingFunction = (t: number) => number;

// Standard easing functions
const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * (t - 2)) * (2 * (t - 2)) + 1,
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
};

// ============================================
// CINEMATIC PATH CLASS
// ============================================

export class CinematicPath {
  private keyframes: CinematicKeyframe[] = [];
  private totalDuration: number = 0;
  private easing: EasingFunction = Easing.easeInOutCubic;

  constructor(easing?: EasingFunction) {
    if (easing) {
      this.easing = easing;
    }
  }

  /**
   * Add a keyframe to the path
   * @param position Camera position
   * @param lookAt Point the camera looks at
   * @param duration Duration to reach this keyframe from the previous one (in seconds)
   */
  addKeyframe(position: THREE.Vector3, lookAt: THREE.Vector3, duration: number): void {
    this.keyframes.push({
      position: position.clone(),
      lookAt: lookAt.clone(),
      duration,
    });
    this.totalDuration += duration;
  }

  /**
   * Evaluate the path at time t (0 to 1)
   * Returns interpolated camera position and lookAt point
   */
  evaluate(t: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    if (this.keyframes.length === 0) {
      return { position: new THREE.Vector3(), lookAt: new THREE.Vector3() };
    }

    if (this.keyframes.length === 1) {
      return {
        position: this.keyframes[0].position.clone(),
        lookAt: this.keyframes[0].lookAt.clone(),
      };
    }

    // Find which segment we're in
    const targetTime = t * this.totalDuration;
    let currentTime = 0;
    let startIndex = 0;

    for (let i = 0; i < this.keyframes.length - 1; i++) {
      if (currentTime + this.keyframes[i].duration >= targetTime) {
        startIndex = i;
        break;
      }
      currentTime += this.keyframes[i].duration;
    }

    const startKeyframe = this.keyframes[startIndex];
    const endKeyframe = this.keyframes[Math.min(startIndex + 1, this.keyframes.length - 1)];

    // If we're at the last keyframe
    if (startIndex === this.keyframes.length - 1) {
      return {
        position: startKeyframe.position.clone(),
        lookAt: startKeyframe.lookAt.clone(),
      };
    }

    // Interpolation factor within this segment (0 to 1)
    const segmentDuration = startKeyframe.duration;
    const elapsedInSegment = targetTime - currentTime;
    let segmentT = segmentDuration > 0 ? elapsedInSegment / segmentDuration : 0;
    segmentT = Math.max(0, Math.min(1, segmentT));

    // Apply easing
    const easedT = this.easing(segmentT);

    // Interpolate position and lookAt
    const position = new THREE.Vector3().lerpVectors(
      startKeyframe.position,
      endKeyframe.position,
      easedT
    );

    const lookAt = new THREE.Vector3().lerpVectors(
      startKeyframe.lookAt,
      endKeyframe.lookAt,
      easedT
    );

    return { position, lookAt };
  }

  getTotalDuration(): number {
    return this.totalDuration;
  }

  getKeyframeCount(): number {
    return this.keyframes.length;
  }

  // ============================================
  // PRESET CINEMATIC PATHS
  // ============================================

  /**
   * Battle flyby: swoops over a battle scene from multiple angles
   * Assumes battle is centered at (15, 0, 15)
   */
  static battleFlyby(): CinematicPath {
    const path = new CinematicPath(Easing.easeInOutCubic);
    const center = new THREE.Vector3(15, 0, 15);

    // Start high and distant
    path.addKeyframe(
      new THREE.Vector3(5, 50, 5),
      new THREE.Vector3(15, 10, 15),
      2
    );

    // Swoop down and around left side
    path.addKeyframe(
      new THREE.Vector3(-5, 25, 15),
      new THREE.Vector3(15, 5, 15),
      3
    );

    // Low pass along one axis
    path.addKeyframe(
      new THREE.Vector3(15, 15, 30),
      new THREE.Vector3(15, 5, 15),
      2
    );

    // Bank around and approach from opposite side
    path.addKeyframe(
      new THREE.Vector3(35, 30, 15),
      new THREE.Vector3(15, 10, 15),
      3
    );

    // Pull back up and out
    path.addKeyframe(
      new THREE.Vector3(25, 45, 25),
      new THREE.Vector3(15, 10, 15),
      2
    );

    return path;
  }

  /**
   * Base tier progression: camera rises and zooms out as base evolves
   * Shows progression from Camp -> Fort -> Castle
   */
  static baseTierUp(): CinematicPath {
    const path = new CinematicPath(Easing.easeOutCubic);
    const baseCenter = new THREE.Vector3(15, 0, 15);

    // Start at ground level, close on Camp
    path.addKeyframe(
      new THREE.Vector3(12, 8, 12),
      new THREE.Vector3(15, 2, 15),
      2
    );

    // Rise and pull back for Fort view
    path.addKeyframe(
      new THREE.Vector3(10, 20, 10),
      new THREE.Vector3(15, 5, 15),
      2
    );

    // Further back for Castle view
    path.addKeyframe(
      new THREE.Vector3(5, 35, 5),
      new THREE.Vector3(15, 10, 15),
      2
    );

    // Final majestic view from above
    path.addKeyframe(
      new THREE.Vector3(0, 50, 0),
      new THREE.Vector3(15, 15, 15),
      2
    );

    return path;
  }

  /**
   * Overview sweep: camera pans across the entire map at high altitude
   * Good for showing map features and scale
   */
  static overviewSweep(): CinematicPath {
    const path = new CinematicPath(Easing.linear);

    // Start at one corner
    path.addKeyframe(
      new THREE.Vector3(-10, 60, -10),
      new THREE.Vector3(15, 10, 15),
      3
    );

    // Sweep across map horizontally
    path.addKeyframe(
      new THREE.Vector3(40, 60, -10),
      new THREE.Vector3(15, 10, 15),
      5
    );

    // Pan to opposite corner
    path.addKeyframe(
      new THREE.Vector3(40, 60, 40),
      new THREE.Vector3(15, 10, 15),
      5
    );

    // Final sweep back
    path.addKeyframe(
      new THREE.Vector3(-10, 60, 40),
      new THREE.Vector3(15, 10, 15),
      5
    );

    // Return to center
    path.addKeyframe(
      new THREE.Vector3(15, 50, 15),
      new THREE.Vector3(15, 10, 15),
      3
    );

    return path;
  }

  /**
   * Tribe showcase: cinematic tour of a player's base and units
   * Assumes base is at (15, 0, 15) with units nearby
   */
  static tribeShowcase(): CinematicPath {
    const path = new CinematicPath(Easing.easeInOutQuart);
    const basePos = new THREE.Vector3(15, 0, 15);

    // Opening: approach from distance
    path.addKeyframe(
      new THREE.Vector3(40, 30, 40),
      new THREE.Vector3(15, 0, 15),
      3
    );

    // Close-up on base structures
    path.addKeyframe(
      new THREE.Vector3(18, 15, 12),
      new THREE.Vector3(15, 3, 15),
      2
    );

    // Circle around base
    path.addKeyframe(
      new THREE.Vector3(20, 20, 20),
      new THREE.Vector3(15, 5, 15),
      2
    );

    // Another angle
    path.addKeyframe(
      new THREE.Vector3(8, 20, 20),
      new THREE.Vector3(15, 5, 15),
      2
    );

    // Pull back to mid-range view
    path.addKeyframe(
      new THREE.Vector3(5, 30, 5),
      new THREE.Vector3(15, 8, 15),
      2
    );

    // Zoom out to show scale
    path.addKeyframe(
      new THREE.Vector3(0, 50, 0),
      new THREE.Vector3(15, 15, 15),
      3
    );

    return path;
  }
}

// ============================================
// CINEMATIC RECORDER CLASS
// ============================================

export interface RecordingOptions {
  fps?: number;
  videoBitrate?: number;
  audioTracks?: MediaStreamAudioTrack[];
}

export class CinematicRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording: boolean = false;
  private currentStream: MediaStream | null = null;

  /**
   * Start recording the canvas
   * @param canvas The canvas to record
   * @param options Recording options (fps defaults to 30)
   */
  async startRecording(
    canvas: HTMLCanvasElement,
    options: RecordingOptions = {}
  ): Promise<void> {
    if (this.isRecording) {
      console.warn('Recording already in progress');
      return;
    }

    const fps = options.fps || 30;
    const videoBitrate = options.videoBitrate || 5000000; // 5 Mbps

    try {
      // Capture canvas stream
      const stream = canvas.captureStream(fps) as MediaStream;
      this.currentStream = stream;

      // Optional: add audio tracks if provided
      if (options.audioTracks && options.audioTracks.length > 0) {
        for (const audioTrack of options.audioTracks) {
          stream.addTrack(audioTrack);
        }
      }

      // Create MediaRecorder with WebM codec (best browser support)
      const mimeType = 'video/webm;codecs=vp9,opus';
      const mimeTypeAlt = 'video/webm;codecs=vp8,opus';
      const mimeTypeFallback = 'video/webm';

      let selectedMime = mimeTypeFallback;
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMime = mimeType;
      } else if (MediaRecorder.isTypeSupported(mimeTypeAlt)) {
        selectedMime = mimeTypeAlt;
      }

      const options_recorder = {
        mimeType: selectedMime,
        videoBitsPerSecond: videoBitrate,
      };

      this.mediaRecorder = new MediaRecorder(stream, options_recorder);
      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      console.log(`Recording started at ${fps} fps with ${selectedMime}`);
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  /**
   * Stop recording and return the video blob
   */
  async stopRecording(): Promise<Blob> {
    if (!this.mediaRecorder || !this.isRecording) {
      console.warn('No recording in progress');
      return new Blob();
    }

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('MediaRecorder is null'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        this.isRecording = false;

        // Clean up streams
        if (this.currentStream) {
          this.currentStream.getTracks().forEach((track) => track.stop());
          this.currentStream = null;
        }

        console.log(`Recording stopped. Video size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Trigger a browser download of the recorded video
   */
  downloadRecording(filename: string = 'cinematic.webm'): void {
    if (this.recordedChunks.length === 0) {
      console.warn('No recording data available');
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`Download initiated: ${filename}`);
  }

  /**
   * Animate camera along a cinematic path and record it
   * @param path The cinematic path to follow
   * @param camera The StrategyCamera instance
   * @param onComplete Callback when animation completes
   */
  playPath(
    path: CinematicPath,
    camera: StrategyCamera,
    onComplete?: () => void
  ): void {
    const startTime = performance.now();
    const pathDuration = path.getTotalDuration() * 1000; // convert to ms

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / pathDuration, 1);

      // Evaluate path at current progress
      const frame = path.evaluate(progress);

      // Update camera position and look direction
      camera.camera.position.copy(frame.position);
      camera.camera.lookAt(frame.lookAt);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (onComplete) {
          onComplete();
        }
        console.log('Cinematic path playback complete');
      }
    };

    requestAnimationFrame(animate);
    console.log(`Playing cinematic path (${path.getTotalDuration().toFixed(1)}s)`);
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

// ============================================
// HELPER: FULL RECORDING WORKFLOW
// ============================================

/**
 * Complete workflow: play a path, record it, and download
 * Usage:
 *   const path = CinematicPath.battleFlyby();
 *   await recordCinematicSequence(canvas, camera, path, 'battle-scene.webm');
 */
export async function recordCinematicSequence(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera,
  path: CinematicPath,
  filename: string = 'cinematic.webm',
  recordingOptions: RecordingOptions = {}
): Promise<void> {
  const recorder = new CinematicRecorder();

  try {
    // Start recording
    await recorder.startRecording(canvas, recordingOptions);

    // Play the cinematic path
    await new Promise<void>((resolve) => {
      recorder.playPath(path, camera, () => {
        resolve();
      });
    });

    // Add a small delay to ensure the last frame is captured
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Stop recording
    await recorder.stopRecording();

    // Download the video
    recorder.downloadRecording(filename);

    console.log(`Cinematic "${filename}" recorded and downloaded successfully`);
  } catch (error) {
    console.error('Error during cinematic recording:', error);
    throw error;
  }
}
