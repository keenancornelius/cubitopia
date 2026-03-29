// ============================================
// CUBITOPIA - Strategy Camera Controller
// ============================================

import * as THREE from 'three';
import { CameraConfig } from '../types';

export class StrategyCamera {
  public camera: THREE.PerspectiveCamera;
  private config: CameraConfig;

  // Camera orbit state
  private target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private distance: number = 55;
  private phi: number = Math.PI / 4;     // vertical angle (45 degrees)
  private theta: number = Math.PI / 4;   // horizontal angle

  // Map bounds for camera clamping (set via setMapBounds)
  private mapMin: THREE.Vector2 = new THREE.Vector2(-5, -5);
  private mapMax: THREE.Vector2 = new THREE.Vector2(40, 40);

  // Input state
  private isDragging: boolean = false;
  private isRotating: boolean = false;
  private lastMouse: THREE.Vector2 = new THREE.Vector2();
  private currentMouse: THREE.Vector2 = new THREE.Vector2();
  private canvas: HTMLElement;

  constructor(config: CameraConfig, canvas: HTMLElement) {
    this.config = config;
    this.canvas = canvas;

    this.camera = new THREE.PerspectiveCamera(
      config.fov,
      window.innerWidth / window.innerHeight,
      config.near,
      config.far
    );

    this.updateCameraPosition();
    this.setupInputHandlers();
  }

  private updateCameraPosition(): void {
    const x = this.target.x + this.distance * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.target.y + this.distance * Math.cos(this.phi);
    const z = this.target.z + this.distance * Math.sin(this.phi) * Math.sin(this.theta);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  private setupInputHandlers(): void {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e));

    // Track mouse position for edge panning
    window.addEventListener('mousemove', (e) => {
      this.currentMouse.set(e.clientX, e.clientY);
    });

    // Touch support for mobile
    this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
    this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
    this.canvas.addEventListener('touchend', () => this.onTouchEnd());

    // Keyboard panning
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  /** Call each frame — edge panning disabled (use WASD or middle-click drag instead) */
  update(): void {
    // Edge panning disabled — was annoying during gameplay
  }

  private onMouseDown(e: MouseEvent): void {
    // RTS controls: left-click = select/box-select (handled by SelectionManager)
    // Middle-click (button 1) = pan camera
    // Right-click (button 2) = rotate camera (or issue commands when units selected)
    if (e.button === 1) this.isDragging = true;   // middle click = pan
    if (e.button === 2 && !StrategyCamera.suppressRightClick) this.isRotating = true;
    this.lastMouse.set(e.clientX, e.clientY);
  }

  private onMouseMove(e: MouseEvent): void {
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse.set(e.clientX, e.clientY);

    if (this.isDragging) {
      this.pan(dx, dy);
    }
    if (this.isRotating) {
      this.rotate(dx, dy);
    }
  }

  private onMouseUp(): void {
    this.isDragging = false;
    this.isRotating = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomDelta = e.deltaY * this.config.zoomSpeed * 0.01;
    this.distance = THREE.MathUtils.clamp(
      this.distance + zoomDelta,
      this.config.minZoom,
      this.config.maxZoom
    );
    this.updateCameraPosition();
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.lastMouse.set(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isDragging) {
      const dx = e.touches[0].clientX - this.lastMouse.x;
      const dy = e.touches[0].clientY - this.lastMouse.y;
      this.lastMouse.set(e.touches[0].clientX, e.touches[0].clientY);
      this.pan(dx, dy);
    }
  }

  private onTouchEnd(): void {
    this.isDragging = false;
  }

  /** Set to true to suppress camera keyboard input (e.g. when help overlay is open) */
  static suppressInput = false;

  /** Set to true to suppress right-click rotation (when units are selected for commands) */
  static suppressRightClick = false;

  /** Set to true to suppress left-click dragging/panning (when in harvest/farm paint mode) */
  static suppressLeftDrag = false;

  private onKeyDown(e: KeyboardEvent): void {
    if (StrategyCamera.suppressInput) return;
    const panAmount = this.config.panSpeed;
    switch (e.key) {
      case 'w': case 'ArrowUp':    this.target.z -= panAmount; break;
      case 's': case 'ArrowDown':  this.target.z += panAmount; break;
      case 'a': case 'ArrowLeft':  this.target.x -= panAmount; break;
      case 'd': case 'ArrowRight': this.target.x += panAmount; break;
      case 'q': this.theta -= 0.1; break;
      case 'e': this.theta += 0.1; break;
    }
    this.clampTarget();
    this.updateCameraPosition();
  }

  private pan(dx: number, dy: number): void {
    const panSpeed = this.config.panSpeed * this.distance * 0.002;
    const right = new THREE.Vector3();
    const forward = new THREE.Vector3();

    right.setFromMatrixColumn(this.camera.matrix, 0);
    forward.crossVectors(this.camera.up, right);

    right.multiplyScalar(-dx * panSpeed);
    forward.multiplyScalar(dy * panSpeed);

    this.target.add(right);
    this.target.add(forward);
    this.clampTarget();
    this.updateCameraPosition();
  }

  private rotate(dx: number, dy: number): void {
    this.theta -= dx * this.config.rotateSpeed * 0.01;
    this.phi = THREE.MathUtils.clamp(
      this.phi - dy * this.config.rotateSpeed * 0.01,
      0.01,          // nearly straight down (top view)
      Math.PI - 0.01 // nearly straight up (underside view)
    );
    this.updateCameraPosition();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focusOn(position: THREE.Vector3): void {
    this.target.copy(position);
    this.clampTarget();
    this.updateCameraPosition();
  }

  /** Set the map bounds so the camera can't pan off the map */
  setMapBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.mapMin.set(minX, minZ);
    this.mapMax.set(maxX, maxZ);
  }

  private clampTarget(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.mapMin.x, this.mapMax.x);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.mapMin.y, this.mapMax.y);
  }

  dispose(): void {
    // Remove event listeners if needed
  }
}
