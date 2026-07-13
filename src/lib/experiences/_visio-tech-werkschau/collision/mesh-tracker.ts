import * as THREE from "three";
import {
  createWerkschauNeutralTileMaterial,
  createWerkschauTileMaterial,
  disposeClonedMaterial,
  disposeMaterial,
} from "../runtime/tiles-material";
import { shouldTrackMeshForConeMask } from "./mesh-filter";
import type { WerkschauTileMesh, TrackedTileMesh } from "./tile-mesh-types";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import { initializeConeMaskAttributeForMesh } from "./vertex-color-writer";

export class WerkschauTileMeshRegistry {
  private readonly trackedByScene = new Map<THREE.Object3D, readonly RegisteredTileMesh[]>();
  private readonly trackedMeshes = new Set<TrackedTileMesh>();
  private version = 0;

  public trackTileScene(root: THREE.Object3D, sourceUrl: string): void {
    if (this.trackedByScene.has(root)) return;

    const registeredMeshes = collectRegisteredMeshes(root, sourceUrl);
    this.trackedByScene.set(root, registeredMeshes);

    for (const registeredMesh of registeredMeshes) {
      if (registeredMesh.trackedMesh) {
        this.trackedMeshes.add(registeredMesh.trackedMesh);
      }
    }

    this.version += 1;
  }

  public untrackTileScene(root: THREE.Object3D): void {
    const registeredMeshes = this.trackedByScene.get(root);
    if (!registeredMeshes) return;

    const disposedMaterials = new WeakSet<THREE.Material>();

    for (const registeredMesh of registeredMeshes) {
      if (registeredMesh.trackedMesh) {
        this.trackedMeshes.delete(registeredMesh.trackedMesh);
        registeredMesh.trackedMesh.coneMaskAttribute = null;
      }
      disposeClonedMaterial(registeredMesh.werkschauMaterial, disposedMaterials);
      if (registeredMesh.trackedMesh) {
        disposeClonedMaterial(
          registeredMesh.trackedMesh.collisionMaterial,
          disposedMaterials,
        );
      }
      disposeMaterial(registeredMesh.originalMaterial, disposedMaterials);
    }

    this.trackedByScene.delete(root);
    this.version += 1;
  }

  public getTrackedTileMeshes(): readonly TrackedTileMesh[] {
    return Array.from(this.trackedMeshes);
  }

  public getTrackedMeshCount(): number {
    return this.trackedMeshes.size;
  }

  public getVersion(): number {
    return this.version;
  }

  public dispose(): void {
    for (const root of this.trackedByScene.keys()) {
      this.untrackTileScene(root);
    }
  }
}

interface RegisteredTileMesh {
  originalMaterial: THREE.Material | THREE.Material[];
  werkschauMaterial: THREE.Material | THREE.Material[];
  trackedMesh: TrackedTileMesh | null;
}

function collectRegisteredMeshes(
  root: THREE.Object3D,
  sourceUrl: string,
): readonly RegisteredTileMesh[] {
  const registeredMeshes: RegisteredTileMesh[] = [];

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!(child.geometry instanceof THREE.BufferGeometry)) return;

    const registeredMesh = createRegisteredMesh(child as WerkschauTileMesh, sourceUrl);
    if (!registeredMesh) return;

    registeredMeshes.push(registeredMesh);
  });

  return registeredMeshes;
}

function createRegisteredMesh(
  mesh: WerkschauTileMesh,
  sourceUrl: string,
): RegisteredTileMesh | null {
  const originalMaterial = mesh.material;
  const werkschauMaterial = createWerkschauNeutralTileMaterial(originalMaterial);
  const collisionMaterial = createWerkschauTileMaterial(originalMaterial);
  const trackedMesh = preprocessTrackedMesh(mesh, collisionMaterial);

  mesh.material = werkschauMaterial;

  if (!trackedMesh) {
    disposeClonedMaterial(collisionMaterial);
    return { originalMaterial, werkschauMaterial, trackedMesh: null };
  }

  if (!shouldTrackMeshForConeMask(trackedMesh)) {
    disposeClonedMaterial(collisionMaterial);
    return { originalMaterial, werkschauMaterial, trackedMesh: null };
  }

  initializeConeMaskAttributeForMesh(trackedMesh);
  trackedMesh.sourceUrl = sourceUrl;
  trackedMesh.neutralMaterial = werkschauMaterial;
  applyPrebakedConeIntersectionMaterial(trackedMesh);
  return { originalMaterial, werkschauMaterial, trackedMesh };
}

function applyPrebakedConeIntersectionMaterial(mesh: TrackedTileMesh): void {
  if (!mesh.hasPrebakedConeMask || mesh.prebakedConeIntersection === null) return;

  if (mesh.prebakedConeIntersection) {
    mesh.mesh.material = mesh.collisionMaterial;
    mesh.hasConeMaskMaterial = true;
    return;
  }

  mesh.mesh.material = mesh.neutralMaterial;
  mesh.hasConeMaskMaterial = false;
}
