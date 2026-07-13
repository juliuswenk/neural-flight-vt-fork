// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import { updateVertexMask } from "./vertex-mask";

function createTrackedTriangleMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -10, 0, 0,
        10, 0, 0,
        0, 10, 0,
      ],
      3,
    ),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);

  const trackedMesh = preprocessTrackedMesh(mesh, mesh.material);
  if (!trackedMesh) {
    throw new Error("Failed to create tracked mesh.");
  }

  return trackedMesh;
}

test("updateVertexMask marks triangles whose center is inside a cone", () => {
  const trackedMesh = createTrackedTriangleMesh();
  const cone = {
    tip: new THREE.Vector3(0, 4, 0),
    axisDirection: new THREE.Vector3(0, -1, 0),
    radius: 1,
    height: 2,
    baseCenter: new THREE.Vector3(0, 2, 0),
    placementPointId: "point-a",
    sourceBuildingId: "building-a",
    chunkKey: "0:0",
    coneIndex: 0,
  };

  updateVertexMask(trackedMesh, [cone]);

  expect(Array.from(trackedMesh.vertexMask)).toEqual([1, 1, 1]);
});

test("updateVertexMask samples large triangle interiors beyond the center", () => {
  const trackedMesh = createTrackedTriangleMesh();
  const cone = {
    tip: new THREE.Vector3(-4, 3, 0),
    axisDirection: new THREE.Vector3(0, -1, 0),
    radius: 0.4,
    height: 2,
    baseCenter: new THREE.Vector3(-4, 1, 0),
    placementPointId: "point-a",
    sourceBuildingId: "building-a",
    chunkKey: "0:0",
    coneIndex: 0,
  };

  updateVertexMask(trackedMesh, [cone]);

  expect(Array.from(trackedMesh.vertexMask)).toEqual([1, 1, 1]);
});
