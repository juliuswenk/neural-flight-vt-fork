import * as THREE from "three";
import {
  createBerlinNeutralTileMaterial,
  createBerlinTileMaterial,
  disposeClonedMaterial,
  disposeMaterial,
} from "../runtime/tiles-material";
import { shouldTrackMeshForConeMask } from "./mesh-filter";
import type { BerlinTileMesh, TrackedTileMesh } from "./tile-mesh-types";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import { initializeConeMaskAttributeForMesh } from "./vertex-color-writer";

export class BerlinTileMeshRegistry {
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
      disposeClonedMaterial(registeredMesh.berlinMaterial, disposedMaterials);
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
  berlinMaterial: THREE.Material | THREE.Material[];
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

    const registeredMesh = createRegisteredMesh(child as BerlinTileMesh, sourceUrl);
    if (!registeredMesh) return;

    registeredMeshes.push(registeredMesh);
  });

  return registeredMeshes;
}

function createRegisteredMesh(
  mesh: BerlinTileMesh,
  sourceUrl: string,
): RegisteredTileMesh | null {
  const originalMaterial = mesh.material;
  const berlinMaterial = createBerlinNeutralTileMaterial(originalMaterial);
  const collisionMaterial = createBerlinTileMaterial(originalMaterial);
  const trackedMesh = preprocessTrackedMesh(mesh, collisionMaterial);

  mesh.material = berlinMaterial;

  if (!trackedMesh) {
    disposeClonedMaterial(collisionMaterial);
    return { originalMaterial, berlinMaterial, trackedMesh: null };
  }

  if (!shouldTrackMeshForConeMask(trackedMesh)) {
    disposeClonedMaterial(collisionMaterial);
    return { originalMaterial, berlinMaterial, trackedMesh: null };
  }

  initializeConeMaskAttributeForMesh(trackedMesh);
  trackedMesh.sourceUrl = sourceUrl;
  trackedMesh.neutralMaterial = berlinMaterial;
  return { originalMaterial, berlinMaterial, trackedMesh };
}
