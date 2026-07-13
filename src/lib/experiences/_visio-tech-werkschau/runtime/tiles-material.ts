import * as THREE from "three";
import { WERKSCHAU_TILE_LOOK } from "../constants";

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

export function createWerkschauNeutralTileMaterial(
  sourceMaterial: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(sourceMaterial)) {
    return sourceMaterial.map((material) => cloneNeutralTileMaterial(material));
  }

  return cloneNeutralTileMaterial(sourceMaterial);
}

export function disposeClonedMaterial(
  material: THREE.Material | THREE.Material[],
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      disposeClonedSingleMaterial(entry, disposedMaterials);
    }
    return;
  }

  disposeClonedSingleMaterial(material, disposedMaterials);
}

export function disposeMaterial(
  material: THREE.Material | THREE.Material[],
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      disposeSingleMaterial(entry, disposedMaterials);
    }
    return;
  }

  disposeSingleMaterial(material, disposedMaterials);
}

function cloneNeutralTileMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const material = new THREE.MeshLambertMaterial({
    color: WERKSCHAU_TILE_LOOK.NEUTRAL_COLOR,
    flatShading: WERKSCHAU_TILE_LOOK.FLAT_SHADING,
    side: sourceMaterial.side,
  });

  material.depthTest = true;
  material.depthWrite = true;
  material.needsUpdate = true;
  return material;
}

function disposeClonedSingleMaterial(
  material: THREE.Material,
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (disposedMaterials?.has(material)) return;

  disposedMaterials?.add(material);
  material.dispose();
}

function disposeSingleMaterial(
  material: THREE.Material,
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (disposedMaterials?.has(material)) return;

  disposedMaterials?.add(material);

  const materialWithMaps = material as MaterialWithTextureMaps;
  materialWithMaps.map?.dispose();
  materialWithMaps.alphaMap?.dispose();
  materialWithMaps.aoMap?.dispose();
  materialWithMaps.bumpMap?.dispose();
  materialWithMaps.displacementMap?.dispose();
  materialWithMaps.emissiveMap?.dispose();
  materialWithMaps.lightMap?.dispose();
  materialWithMaps.metalnessMap?.dispose();
  materialWithMaps.normalMap?.dispose();
  materialWithMaps.roughnessMap?.dispose();
  materialWithMaps.specularMap?.dispose();
  material.dispose();
}
