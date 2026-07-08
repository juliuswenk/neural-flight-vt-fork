// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { shouldTrackMeshForConeMask } from "./mesh-filter";

function createTrackedMesh(vertexCount, radius) {
  return {
    vertexCount,
    localSphere: new THREE.Sphere(new THREE.Vector3(), radius),
  };
}

test("shouldTrackMeshForConeMask filters meshes outside cone mask budgets", () => {
  expect(shouldTrackMeshForConeMask(createTrackedMesh(24, 10))).toBe(true);
  expect(shouldTrackMeshForConeMask(createTrackedMesh(3, 10))).toBe(false);
  expect(shouldTrackMeshForConeMask(createTrackedMesh(50_001, 10))).toBe(false);
  expect(shouldTrackMeshForConeMask(createTrackedMesh(24, 0.1))).toBe(false);
  expect(shouldTrackMeshForConeMask(createTrackedMesh(24, 1_000))).toBe(false);
});
