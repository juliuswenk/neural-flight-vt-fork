import * as THREE from "three";
import type { TrackedTileMesh } from "./tile-mesh-types";

export function writeConeMaskAttributeForMesh(mesh: TrackedTileMesh): void {
  ensureConeMaskAttribute(mesh);
  writeConeMask(mesh);
}

export function initializeConeMaskAttributeForMesh(mesh: TrackedTileMesh): void {
  ensureConeMaskAttribute(mesh);
}

function ensureConeMaskAttribute(mesh: TrackedTileMesh): void {
  const existingMaskAttribute = mesh.geometry.getAttribute("coneMask");
  if (isValidConeMaskAttribute(existingMaskAttribute, mesh.vertexCount)) {
    mesh.coneMaskAttribute = existingMaskAttribute;
    return;
  }

  const mask = new Float32Array(mesh.vertexCount);
  const maskAttribute = new THREE.BufferAttribute(mask, 1);
  mesh.geometry.setAttribute("coneMask", maskAttribute);
  mesh.coneMaskAttribute = maskAttribute;
}

export function isValidConeMaskAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  vertexCount: number,
): attribute is THREE.BufferAttribute {
  if (!(attribute instanceof THREE.BufferAttribute)) {
    return false;
  }

  return (
    attribute.itemSize === 1 &&
    attribute.count === vertexCount &&
    attribute.array instanceof Float32Array
  );
}

function writeConeMask(mesh: TrackedTileMesh): void {
  const coneMaskAttribute = mesh.coneMaskAttribute;
  if (!coneMaskAttribute) return;

  const maskValues = coneMaskAttribute.array;
  if (!(maskValues instanceof Float32Array)) return;

  let changed = false;
  for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
    const nextValue = mesh.vertexMask[vertexIndex];
    if (maskValues[vertexIndex] === nextValue) continue;

    maskValues[vertexIndex] = nextValue;
    changed = true;
  }

  if (changed) {
    coneMaskAttribute.needsUpdate = true;
  }
}
