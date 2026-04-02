import * as THREE from 'three';

type RotationInput = THREE.Euler | THREE.Quaternion | undefined;
type Vec3Input = THREE.Vector3 | { x: number; y: number; z: number } | undefined;

export interface InstancedTypeOptions {
  initialCapacity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  frustumCulled?: boolean;
}

interface InstancedBatch {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  activeCount: number;
  capacity: number;
  nextId: number;
  freeIds: number[];
  idToSlot: Map<number, number>;
  slotToId: number[];
  options: Required<InstancedTypeOptions>;
}

const DEFAULT_OPTIONS: Required<InstancedTypeOptions> = {
  initialCapacity: 64,
  castShadow: false,
  receiveShadow: false,
  frustumCulled: true,
};

export class InstancedObjectManager {
  private scene: THREE.Scene;
  private batches = new Map<string, InstancedBatch>();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempScale = new THREE.Vector3(1, 1, 1);
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempColor = new THREE.Color(1, 1, 1);

  /** Types whose bounding spheres need recomputing (deferred to flushBounds) */
  private dirtyBounds = new Set<string>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Recompute bounding spheres for all types that changed since last flush.
   * Call once per frame from the game loop — replaces per-operation computeBoundingSphere.
   */
  flushBounds(): void {
    if (this.dirtyBounds.size === 0) return;
    for (const type of this.dirtyBounds) {
      const batch = this.batches.get(type);
      if (batch && batch.mesh.frustumCulled) {
        batch.mesh.computeBoundingSphere();
      }
    }
    this.dirtyBounds.clear();
  }

  registerType(
    type: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    options: InstancedTypeOptions = {}
  ): void {
    if (this.batches.has(type)) return;

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const mesh = new THREE.InstancedMesh(geometry, material, mergedOptions.initialCapacity);
    mesh.name = `instanced_${type}`;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mergedOptions.castShadow;
    mesh.receiveShadow = mergedOptions.receiveShadow;
    mesh.frustumCulled = mergedOptions.frustumCulled;

    this.scene.add(mesh);
    this.batches.set(type, {
      mesh,
      geometry,
      material,
      activeCount: 0,
      capacity: mergedOptions.initialCapacity,
      nextId: 0,
      freeIds: [],
      idToSlot: new Map(),
      slotToId: [],
      options: mergedOptions,
    });
  }

  addInstance(
    type: string,
    position: Vec3Input,
    rotation?: RotationInput,
    scale?: Vec3Input,
    color?: THREE.ColorRepresentation
  ): number {
    const batch = this.getBatch(type);
    if (batch.activeCount >= batch.capacity) {
      this.rebuild(type, batch.capacity * 2);
    }

    const liveBatch = this.getBatch(type);
    const slot = liveBatch.activeCount++;
    const id = liveBatch.freeIds.pop() ?? liveBatch.nextId++;

    liveBatch.idToSlot.set(id, slot);
    liveBatch.slotToId[slot] = id;
    liveBatch.mesh.count = liveBatch.activeCount;

    this.composeMatrix(position, rotation, scale);
    liveBatch.mesh.setMatrixAt(slot, this.tempMatrix);

    if (color !== undefined) {
      this.tempColor.set(color);
      liveBatch.mesh.setColorAt(slot, this.tempColor);
    } else if (liveBatch.mesh.instanceColor) {
      this.tempColor.set(0xffffff);
      liveBatch.mesh.setColorAt(slot, this.tempColor);
    }

    liveBatch.mesh.instanceMatrix.needsUpdate = true;
    if (liveBatch.mesh.instanceColor) {
      liveBatch.mesh.instanceColor.needsUpdate = true;
    }
    this.dirtyBounds.add(type);

    return id;
  }

  removeInstance(type: string, instanceId: number): void {
    const batch = this.getBatch(type);
    const slot = batch.idToSlot.get(instanceId);
    if (slot === undefined || batch.activeCount === 0) return;

    const lastSlot = batch.activeCount - 1;
    const removedId = instanceId;

    if (slot !== lastSlot) {
      const movedId = batch.slotToId[lastSlot];
      batch.mesh.getMatrixAt(lastSlot, this.tempMatrix);
      batch.mesh.setMatrixAt(slot, this.tempMatrix);
      if (batch.mesh.instanceColor) {
        batch.mesh.getColorAt(lastSlot, this.tempColor);
        batch.mesh.setColorAt(slot, this.tempColor);
      }
      batch.slotToId[slot] = movedId;
      batch.idToSlot.set(movedId, slot);
    }

    batch.activeCount--;
    batch.mesh.count = batch.activeCount;
    batch.idToSlot.delete(removedId);
    batch.slotToId.pop();
    batch.freeIds.push(removedId);
    batch.mesh.instanceMatrix.needsUpdate = true;
    if (batch.mesh.instanceColor) {
      batch.mesh.instanceColor.needsUpdate = true;
    }
    this.dirtyBounds.add(type);
  }

  updateInstance(
    type: string,
    instanceId: number,
    position: Vec3Input,
    rotation?: RotationInput,
    scale?: Vec3Input,
    color?: THREE.ColorRepresentation,
    recomputeBounds = false
  ): void {
    const batch = this.getBatch(type);
    const slot = batch.idToSlot.get(instanceId);
    if (slot === undefined) return;

    this.composeMatrix(position, rotation, scale);
    batch.mesh.setMatrixAt(slot, this.tempMatrix);
    if (color !== undefined) {
      this.tempColor.set(color);
      batch.mesh.setColorAt(slot, this.tempColor);
    }

    batch.mesh.instanceMatrix.needsUpdate = true;
    if (color !== undefined && batch.mesh.instanceColor) {
      batch.mesh.instanceColor.needsUpdate = true;
    }
    if (recomputeBounds) {
      this.dirtyBounds.add(type);
    }
  }

  rebuild(type?: string, minCapacity?: number): void {
    if (type) {
      this.rebuildBatch(type, minCapacity);
      return;
    }

    for (const batchType of this.batches.keys()) {
      this.rebuildBatch(batchType, minCapacity);
    }
  }

  setClippingPlanes(planes: THREE.Plane[] | null): void {
    for (const batch of this.batches.values()) {
      const materials = Array.isArray(batch.material) ? batch.material : [batch.material];
      for (const material of materials) {
        material.clippingPlanes = planes;
        material.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      batch.geometry.dispose();
      const materials = Array.isArray(batch.material) ? batch.material : [batch.material];
      for (const material of materials) {
        material.dispose();
      }
    }
    this.batches.clear();
  }

  private rebuildBatch(type: string, minCapacity?: number): void {
    const batch = this.getBatch(type);
    const targetCapacity = Math.max(minCapacity ?? batch.capacity, batch.activeCount, 1);

    if (targetCapacity === batch.capacity) {
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) {
        batch.mesh.instanceColor.needsUpdate = true;
      }
      this.dirtyBounds.add(type);
      return;
    }

    const newMesh = new THREE.InstancedMesh(batch.geometry, batch.material, targetCapacity);
    newMesh.name = batch.mesh.name;
    newMesh.count = batch.activeCount;
    newMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    newMesh.castShadow = batch.options.castShadow;
    newMesh.receiveShadow = batch.options.receiveShadow;
    newMesh.frustumCulled = batch.options.frustumCulled;

    for (let slot = 0; slot < batch.activeCount; slot++) {
      batch.mesh.getMatrixAt(slot, this.tempMatrix);
      newMesh.setMatrixAt(slot, this.tempMatrix);
      if (batch.mesh.instanceColor) {
        batch.mesh.getColorAt(slot, this.tempColor);
        newMesh.setColorAt(slot, this.tempColor);
      }
    }

    newMesh.instanceMatrix.needsUpdate = true;
    if (newMesh.instanceColor) {
      newMesh.instanceColor.needsUpdate = true;
    }
    this.scene.remove(batch.mesh);
    this.scene.add(newMesh);

    batch.mesh = newMesh;
    batch.capacity = targetCapacity;
    this.dirtyBounds.add(type);
  }

  private composeMatrix(position: Vec3Input, rotation?: RotationInput, scale?: Vec3Input): void {
    this.tempPosition.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
    if (rotation instanceof THREE.Quaternion) {
      this.tempQuaternion.copy(rotation);
    } else if (rotation instanceof THREE.Euler) {
      this.tempQuaternion.setFromEuler(rotation);
    } else {
      this.tempQuaternion.identity();
    }
    this.tempScale.set(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1);
    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
  }

  private getBatch(type: string): InstancedBatch {
    const batch = this.batches.get(type);
    if (!batch) {
      throw new Error(`InstancedObjectManager: unregistered type "${type}"`);
    }
    return batch;
  }
}
