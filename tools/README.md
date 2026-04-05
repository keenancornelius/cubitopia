# Cubitopia Cinematic Recorder Tool

A TypeScript utility for automating camera flythroughs and recording cinematic sequences in Cubitopia. Perfect for creating marketing content, trailers, and gameplay demos.

## Features

- **Smooth Camera Paths**: Define multi-keyframe camera trajectories with easing functions
- **Preset Cinematic Sequences**: Ready-to-use camera paths for common scenarios (battles, base progression, overviews)
- **WebM Recording**: Records gameplay video directly from the canvas using the MediaRecorder API
- **Standalone**: Works without build step changes; uses standard Web APIs

## Installation

The tool is already in `/tools/cinematic-recorder.ts` and can be imported into your game:

```typescript
import { CinematicPath, CinematicRecorder, recordCinematicSequence } from '../tools/cinematic-recorder';
```

## Usage

### Basic Workflow: Record a Preset Path

```typescript
import { CinematicPath, recordCinematicSequence } from '../tools/cinematic-recorder';

// In your game code:
const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const camera = gameInstance.camera; // Your StrategyCamera instance

// Record a battle flyby
const path = CinematicPath.battleFlyby();
await recordCinematicSequence(canvas, camera, path, 'battle-cinematic.webm');
```

### Advanced: Create Custom Paths

```typescript
const customPath = new CinematicPath();

// Add keyframes: (position, lookAt, duration_in_seconds)
customPath.addKeyframe(
  new THREE.Vector3(0, 10, 0),   // camera position
  new THREE.Vector3(15, 5, 15),  // where camera looks
  2                               // take 2 seconds to get here
);

customPath.addKeyframe(
  new THREE.Vector3(30, 20, 30),
  new THREE.Vector3(15, 5, 15),
  3
);

// Use custom easing
import { Easing } from '../tools/cinematic-recorder';
const pathWithEase = new CinematicPath(Easing.easeOutQuart);
```

### Manual Control

For more control, use `CinematicRecorder` directly:

```typescript
const recorder = new CinematicRecorder();

// Start recording at 60 fps
await recorder.startRecording(canvas, { fps: 60 });

// Play your path
const path = CinematicPath.baseTierUp();
recorder.playPath(path, camera, () => {
  console.log('Animation complete');
});

// Wait for animation to finish, then stop
await new Promise(resolve => setTimeout(resolve, path.getTotalDuration() * 1000 + 1000));
const videoBlob = await recorder.stopRecording();

// Download or process the blob
recorder.downloadRecording('my-cinematic.webm');
```

## Preset Paths

### `CinematicPath.battleFlyby()`
Swoops over a battle scene from multiple angles. Shows combat action from various perspectives. Great for battle marketing content.

**Duration**: ~12 seconds
**Best for**: Combat highlights, action demos

### `CinematicPath.baseTierUp()`
Camera rises and zooms out as the base evolves from Camp to Fort to Castle. Shows progression visually.

**Duration**: ~8 seconds
**Best for**: Progression system demos, feature overviews

### `CinematicPath.overviewSweep()`
Pans across the entire map at high altitude in a circular sweep pattern.

**Duration**: ~21 seconds
**Best for**: Map features, scale demonstration, cinematic openings

### `CinematicPath.tribeShowcase()`
Cinematic tour of a player's base and units—approaches from distance, circles the structures, then zooms out.

**Duration**: ~14 seconds
**Best for**: Tribe/clan showcases, base building features, end-game transitions

## Easing Functions

Smooth interpolation between keyframes using built-in easing:

```typescript
const path = new CinematicPath(Easing.easeInOutCubic);
```

Available easing functions:
- `linear` — constant speed
- `easeInQuad`, `easeOutQuad`, `easeInOutQuad` — quadratic curves
- `easeInCubic`, `easeOutCubic`, `easeInOutCubic` — cubic curves
- `easeInQuart`, `easeOutQuart`, `easeInOutQuart` — quartic curves

## Recording Options

```typescript
interface RecordingOptions {
  fps?: number;                    // Default: 30
  videoBitrate?: number;           // Default: 5,000,000 (5 Mbps)
  audioTracks?: MediaStreamAudioTrack[];  // Optional audio
}

await recorder.startRecording(canvas, {
  fps: 60,
  videoBitrate: 8000000, // 8 Mbps for higher quality
});
```

## Tips for Great Cinematics

1. **Plan Keyframes**: Sketch out your camera path on paper before coding
2. **Timing**: Use realistic durations (2-3 seconds between major waypoints for smooth movement)
3. **Look-At Points**: Keep the camera focused on the action; vary look-at points for dynamic shots
4. **Easing**: Use `easeInOutCubic` or `easeInOutQuart` for cinematic smoothness
5. **Recording**: 60 fps looks smoother but creates larger files; 30 fps is typical for web
6. **Audio**: Use MediaRecorder's audio support to sync with gameplay music or SFX

## API Reference

### `CinematicPath`

```typescript
class CinematicPath {
  constructor(easing?: EasingFunction);
  addKeyframe(position: Vector3, lookAt: Vector3, duration: number): void;
  evaluate(t: number): { position: Vector3; lookAt: Vector3 };
  getTotalDuration(): number;
  getKeyframeCount(): number;
}
```

### `CinematicRecorder`

```typescript
class CinematicRecorder {
  async startRecording(canvas: HTMLCanvasElement, options?: RecordingOptions): Promise<void>;
  async stopRecording(): Promise<Blob>;
  downloadRecording(filename?: string): void;
  playPath(path: CinematicPath, camera: StrategyCamera, onComplete?: () => void): void;
  isCurrentlyRecording(): boolean;
}
```

### Helper Function

```typescript
async function recordCinematicSequence(
  canvas: HTMLCanvasElement,
  camera: StrategyCamera,
  path: CinematicPath,
  filename?: string,
  recordingOptions?: RecordingOptions
): Promise<void>;
```

## Browser Compatibility

- **Chrome/Edge**: Full support (VP9, VP8 codecs)
- **Firefox**: Full support (VP8, VP9)
- **Safari**: Limited (falls back to WebM baseline, may not support all codecs)

Video output is always WebM format (.webm files).

## Performance Notes

- Recording uses canvas.captureStream(), which is GPU-accelerated on supported browsers
- Large resolution or high fps can impact game performance during recording
- Test recording settings on target hardware before creating final assets
- Consider recording at native canvas resolution for best quality

## Examples

### Record a 60fps battle sequence
```typescript
const path = CinematicPath.battleFlyby();
await recordCinematicSequence(canvas, camera, path, 'battle-60fps.webm', { fps: 60 });
```

### Create a custom progression showcase
```typescript
const showcasePath = new CinematicPath(Easing.easeInOutQuart);
showcasePath.addKeyframe(new THREE.Vector3(40, 30, 40), new THREE.Vector3(15, 10, 15), 3);
showcasePath.addKeyframe(new THREE.Vector3(15, 20, 15), new THREE.Vector3(15, 5, 15), 5);
showcasePath.addKeyframe(new THREE.Vector3(0, 50, 0), new THREE.Vector3(15, 15, 15), 3);

await recordCinematicSequence(canvas, camera, showcasePath, 'progression.webm');
```

### Manual recording with progress tracking
```typescript
const recorder = new CinematicRecorder();
await recorder.startRecording(canvas, { fps: 60 });

const path = CinematicPath.overviewSweep();
let isAnimating = true;

recorder.playPath(path, camera, () => {
  isAnimating = false;
});

// You can add progress tracking here if needed
while (isAnimating) {
  await new Promise(resolve => setTimeout(resolve, 100));
}

const blob = await recorder.stopRecording();
console.log(`Video ready: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
```

## Troubleshooting

**Recording is choppy or stutters**
- Lower fps (try 30 instead of 60)
- Reduce video bitrate
- Close other applications to free up CPU/GPU

**Large file sizes**
- Reduce bitrate (lower quality but smaller file)
- Reduce fps
- Trim unnecessary keyframes from your path

**Canvas not recording**
- Ensure canvas has the `captureStream()` method (supported in all modern browsers)
- Check browser console for errors
- Verify the canvas is visible and not obscured

**Video won't play**
- Try a different video player (VLC, MPV, FFmpeg)
- Check that browser supports WebM format
- Verify file wasn't corrupted (check file size > 100KB)

## Future Enhancements

Potential improvements:
- MP4 encoding (via FFmpeg.wasm)
- Camera shake/jitter for dynamic moments
- Automatic path generation from gameplay events
- Keyframe timing optimization
- Real-time preview without recording
