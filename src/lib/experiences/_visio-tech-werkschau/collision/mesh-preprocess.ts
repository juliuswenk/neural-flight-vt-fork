import * as THREE from "three";
import type { WerkschauTileMesh, TrackedTileMesh } from "./tile-mesh-types";
import { isValidConeMaskAttribute } from "./vertex-color-writer";

export function preprocessTrackedMesh(
  mesh: WerkschauTileMesh,
  collisionMaterial: THREE.Material | THREE.Material[],
  sourceUrl = "",
): TrackedTileMesh | null {
  const geometry = mesh.geometry;
  const originalMaterial = mesh.material;
  const positionAttribute = geometry.getAttribute("position");

  if (!(positionAttribute instanceof THREE.BufferAttribute)) {
    return null;
  }

  if (positionAttribute.itemSize < 3) {
    return null;
  }

  const positions = getPositions(positionAttribute.array);
  if (!positions) {
    return null;
  }

  const worldPositions = new Float32Array(positions.length);
  const vertexCount = positionAttribute.count;
  const coneMaskAttribute = getConeMaskAttribute(geometry, vertexCount);
  const hasPrebakedConeMask = isValidConeMaskAttribute(
    coneMaskAttribute,
    vertexCount,
  );
  const prebakedBakeSource = hasPrebakedConeMask
    ? readPrebakedBakeSource(geometry.userData) ??
      readPrebakedBakeSource(mesh.userData)
    : null;
  const acceptsPrebakedConeMask =
    hasPrebakedConeMask && isMatchingBakeSource(prebakedBakeSource, sourceUrl);
  const prebakedConeIntersection = acceptsPrebakedConeMask
    ? readPrebakedConeIntersection(geometry.userData) ??
      readPrebakedConeIntersection(mesh.userData)
    : null;

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    sourceUrl,
    mesh,
    geometry,
    positions,
    worldPositions,
    worldPositionsInitialized: false,
    vertexCount,
    vertexMask: new Uint8Array(vertexCount),
    coneMaskAttribute: acceptsPrebakedConeMask ? coneMaskAttribute : null,
    hasPrebakedConeMask: acceptsPrebakedConeMask,
    prebakedConeIntersection,
    originalMaterial,
    neutralMaterial: originalMaterial,
    collisionMaterial,
    hasConeMaskMaterial: false,
    hasSyncedConeActiveSourceMaps: false,
    localBounds: geometry.boundingBox?.clone() ?? new THREE.Box3(),
    localSphere: geometry.boundingSphere?.clone() ?? new THREE.Sphere(),
    cachedBoundsMatrix: mesh.matrixWorld.clone(),
    cachedVertexWorldMatrix: mesh.matrixWorld.clone(),
    worldSphere:
      geometry.boundingSphere?.clone().applyMatrix4(mesh.matrixWorld) ??
      new THREE.Sphere(),
  };
}

function readPrebakedConeIntersection(userData: unknown): boolean | null {
  if (!isRecord(userData)) return null;

  const value = userData.werkschauHasConeIntersection;
  return typeof value === "boolean" ? value : null;
}

function readPrebakedBakeSource(userData: unknown): string | null {
  if (!isRecord(userData)) return null;

  const value = userData.werkschauBakeSource;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isMatchingBakeSource(
  prebakedBakeSource: string | null,
  sourceUrl: string,
): boolean {
  return prebakedBakeSource === null || sourceUrl === "" || prebakedBakeSource === sourceUrl;
}

function getConeMaskAttribute(
  geometry: THREE.BufferGeometry,
  vertexCount: number,
): THREE.BufferAttribute | undefined {
  const attribute = geometry.getAttribute("coneMask");
  if (isValidConeMaskAttribute(attribute, vertexCount)) return attribute;

  const gltfAttribute = geometry.getAttribute("_conemask");
  if (!isValidConeMaskAttribute(gltfAttribute, vertexCount)) return undefined;

  geometry.setAttribute("coneMask", gltfAttribute);
  return gltfAttribute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPositions(array: THREE.TypedArray): Float32Array | null {
  if (array instanceof Float32Array) {
    return array;
  }

  if (ArrayBuffer.isView(array)) {
    return Float32Array.from(array);
  }

  return null;
}
