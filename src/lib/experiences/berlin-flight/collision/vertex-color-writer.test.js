// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import {
  initializeConeMaskAttributeForMesh,
  writeConeMaskAttributeForMesh,
} from "./vertex-color-writer";

function createTrackedMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ],
      3,
    ),
  );

  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);

  const trackedMesh = preprocessTrackedMesh(mesh, material);
  if (!trackedMesh) {
    throw new Error("Failed to create tracked mesh for vertex writer test.");
  }

  initializeConeMaskAttributeForMesh(trackedMesh);
  return trackedMesh;
}

test("writeConeMaskAttributeForMesh only uploads changed masks", () => {
  const trackedMesh = createTrackedMesh();
  const coneMaskAttribute = trackedMesh.coneMaskAttribute;

  expect(coneMaskAttribute).not.toBeNull();
  const initialVersion = coneMaskAttribute.version;

  writeConeMaskAttributeForMesh(trackedMesh);

  expect(coneMaskAttribute.version).toBe(initialVersion);

  trackedMesh.vertexMask[1] = 1;
  writeConeMaskAttributeForMesh(trackedMesh);

  expect(coneMaskAttribute.version).toBe(initialVersion + 1);

  writeConeMaskAttributeForMesh(trackedMesh);

  expect(coneMaskAttribute.version).toBe(initialVersion + 1);
});
