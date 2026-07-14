import * as THREE from "three";
import {
  createWerkschauNeutralTileMaterial,
  createWerkschauTileMaterial,
  disposeClonedMaterial,
  syncWerkschauTileMaterialSourceMaps,
} from "../runtime/tiles-material";
import { shouldTrackMeshForConeMask } from "./mesh-filter";
import type { WerkschauTileMesh, TrackedTileMesh } from "./tile-mesh-types";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import { initializeConeMaskAttributeForMesh } from "./vertex-color-writer";

export class WerkschauTileMeshRegistry {
  public readonly depthScene = new THREE.Scene();

  private readonly trackedByScene = new Map<THREE.Object3D, readonly RegisteredTileMesh[]>();
  private readonly trackedMeshes = new Set<TrackedTileMesh>();
  private readonly frozenSourceTextures = new Set<THREE.Texture>();
  private version = 0;

  public trackTileScene(root: THREE.Object3D, sourceUrl: string): void {
    if (this.trackedByScene.has(root)) return;

    const registeredMeshes = collectRegisteredMeshes(
      root,
      sourceUrl,
      this.frozenSourceTextures,
    );
    this.trackedByScene.set(root, registeredMeshes);

    for (const registeredMesh of registeredMeshes) {
      this.depthScene.add(registeredMesh.depthMesh);
      if (registeredMesh.trackedMesh) {
        this.trackedMeshes.add(registeredMesh.trackedMesh);
      }
    }

    this.version += 1;
  }

  public setTileSceneVisible(root: THREE.Object3D, visible: boolean): void {
    const registeredMeshes = this.trackedByScene.get(root);
    if (!registeredMeshes) return;

    for (const registeredMesh of registeredMeshes) {
      registeredMesh.tileVisible = visible;
      syncDepthMeshVisibility(registeredMesh);
    }
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
      registeredMesh.depthMesh.removeFromParent();
      disposeClonedMaterial(registeredMesh.depthMesh.material, disposedMaterials);
      freezeMaterialTextures(
        registeredMesh.originalMaterial,
        this.frozenSourceTextures,
      );
      disposeClonedMaterial(registeredMesh.werkschauMaterial, disposedMaterials);
      disposeClonedMaterial(registeredMesh.collisionMaterial, disposedMaterials);
      disposeClonedMaterial(registeredMesh.originalMaterial, disposedMaterials);
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

  public syncDepthMeshes(): void {
    for (const registeredMeshes of this.trackedByScene.values()) {
      for (const registeredMesh of registeredMeshes) {
        registeredMesh.depthMesh.matrix.copy(registeredMesh.sourceMesh.matrixWorld);
        registeredMesh.depthMesh.matrixWorld.copy(
          registeredMesh.sourceMesh.matrixWorld,
        );
      }
    }
  }

  public dispose(): void {
    for (const root of this.trackedByScene.keys()) {
      this.untrackTileScene(root);
    }
    for (const texture of this.frozenSourceTextures) {
      texture.dispose();
    }
    this.frozenSourceTextures.clear();
  }
}

interface RegisteredTileMesh {
  collisionMaterial: THREE.Material | THREE.Material[];
  depthMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  originalMaterial: THREE.Material | THREE.Material[];
  sourceMesh: WerkschauTileMesh;
  tileVisible: boolean;
  werkschauMaterial: THREE.Material | THREE.Material[];
  trackedMesh: TrackedTileMesh | null;
}

type MaterialWithTextureMaps = THREE.Material & {
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  map?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  specularMap?: THREE.Texture | null;
};

const textureMapKeys = [
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "lightMap",
  "map",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "specularMap",
] as const satisfies readonly (keyof MaterialWithTextureMaps)[];

function freezeMaterialTextures(
  material: THREE.Material | THREE.Material[],
  frozenTextures: Set<THREE.Texture>,
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      freezeMaterialTextures(entry, frozenTextures);
    }
    return;
  }

  const materialWithMaps = material as MaterialWithTextureMaps;
  for (const key of textureMapKeys) {
    const texture = materialWithMaps[key];
    if (texture instanceof THREE.Texture) {
      frozenTextures.add(texture);
    }
  }
}

function collectRegisteredMeshes(
  root: THREE.Object3D,
  sourceUrl: string,
  frozenSourceTextures: Set<THREE.Texture>,
): readonly RegisteredTileMesh[] {
  const registeredMeshes: RegisteredTileMesh[] = [];

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!(child.geometry instanceof THREE.BufferGeometry)) return;

    const registeredMesh = createRegisteredMesh(
      child as WerkschauTileMesh,
      sourceUrl,
      frozenSourceTextures,
    );
    if (!registeredMesh) return;

    registeredMeshes.push(registeredMesh);
  });

  return registeredMeshes;
}

function createRegisteredMesh(
  mesh: WerkschauTileMesh,
  sourceUrl: string,
  frozenSourceTextures: Set<THREE.Texture>,
): RegisteredTileMesh | null {
  const originalMaterial = mesh.material;
  freezeMaterialTextures(originalMaterial, frozenSourceTextures);
  const depthMesh = createDepthMesh(mesh);
  const werkschauMaterial = createWerkschauNeutralTileMaterial(originalMaterial);
  const collisionMaterial = createWerkschauTileMaterial(originalMaterial);
  const trackedMesh = preprocessTrackedMesh(mesh, collisionMaterial, sourceUrl);

  mesh.material = werkschauMaterial;

    if (!trackedMesh) {
      disposeClonedMaterial(collisionMaterial);
      return {
        collisionMaterial: werkschauMaterial,
        depthMesh,
        originalMaterial,
        sourceMesh: mesh,
        tileVisible: true,
        trackedMesh: null,
        werkschauMaterial,
      };
    }

  initializeConeMaskAttributeForMesh(trackedMesh);
  syncWerkschauTileMaterialSourceMaps(
    trackedMesh.originalMaterial,
    trackedMesh.collisionMaterial,
  );
  trackedMesh.neutralMaterial = werkschauMaterial;
  trackedMesh.mesh.material = trackedMesh.collisionMaterial;
  trackedMesh.hasConeMaskMaterial = true;

  if (!shouldTrackMeshForConeMask(trackedMesh)) {
    return {
      collisionMaterial,
      depthMesh,
      originalMaterial,
      sourceMesh: mesh,
      tileVisible: true,
      trackedMesh: null,
      werkschauMaterial,
    };
  }

  applyPrebakedConeIntersectionMaterial(trackedMesh);
  return {
    collisionMaterial,
    depthMesh,
    originalMaterial,
    sourceMesh: mesh,
    tileVisible: true,
    trackedMesh,
    werkschauMaterial,
  };
}

function createDepthMesh(
  sourceMesh: WerkschauTileMesh,
): THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> {
  const depthMesh = new THREE.Mesh(
    sourceMesh.geometry,
    createDepthMaterialSet(sourceMesh.material),
  );
  depthMesh.name = `${sourceMesh.name || "tile-mesh"}-texture-reveal-depth`;
  depthMesh.matrixAutoUpdate = false;
  depthMesh.matrix.copy(sourceMesh.matrixWorld);
  depthMesh.matrixWorld.copy(sourceMesh.matrixWorld);
  depthMesh.frustumCulled = false;
  return depthMesh;
}

function createDepthMaterialSet(
  sourceMaterial: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(sourceMaterial)) {
    return sourceMaterial.map((material) => createDepthMaterial(material));
  }

  return createDepthMaterial(sourceMaterial);
}

function createDepthMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const source = sourceMaterial as MaterialWithTextureMaps & {
    alphaTest?: number;
    opacity?: number;
    transparent?: boolean;
  };
  const material = new THREE.MeshDepthMaterial({
    alphaMap: source.alphaMap ?? null,
    alphaTest:
      source.alphaTest && source.alphaTest > 0
        ? source.alphaTest
        : source.transparent
          ? 0.5
          : 0,
    depthPacking: THREE.RGBADepthPacking,
    map: source.map ?? null,
    side: THREE.DoubleSide,
  });
  material.opacity = source.opacity ?? 1;
  return material;
}

function applyPrebakedConeIntersectionMaterial(mesh: TrackedTileMesh): void {
  if (!mesh.hasPrebakedConeMask || mesh.prebakedConeIntersection === null) return;

  mesh.mesh.material = mesh.collisionMaterial;
  mesh.hasConeMaskMaterial = true;
}

function syncDepthMeshVisibility(registeredMesh: RegisteredTileMesh): void {
  registeredMesh.depthMesh.visible =
    registeredMesh.tileVisible && isObjectTreeVisible(registeredMesh.sourceMesh);
}

function isObjectTreeVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }

  return true;
}
