// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { WerkschauCollisionController } from "./controller";
import { preprocessTrackedMesh } from "./mesh-preprocess";
import { initializeConeMaskAttributeForMesh } from "./vertex-color-writer";

function createTrackedMesh() {
  return createTrackedMeshWithGeometry(createTestGeometry());
}

function createTestGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        0, 10, 0,
        1, 0, 0,
      ],
      3,
    ),
  );
  return geometry;
}

function createTrackedMeshWithGeometry(geometry) {
  return createTrackedMeshWithGeometryAndUserData(geometry, {});
}

function createTrackedMeshWithGeometryAndUserData(geometry, userData) {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = userData;
  mesh.updateMatrixWorld(true);

  const trackedMesh = preprocessTrackedMesh(mesh, material);
  if (!trackedMesh) {
    throw new Error("Failed to create tracked mesh for collision test.");
  }

  initializeConeMaskAttributeForMesh(trackedMesh);
  trackedMesh.sourceUrl = "collision-test";
  return trackedMesh;
}

function createCone() {
  return {
    tip: new THREE.Vector3(0, 10, 0),
    axisDirection: new THREE.Vector3(0, -1, 0),
    radius: 10,
    height: 20,
    baseCenter: new THREE.Vector3(0, -10, 0),
    placementPointId: "0:0:0",
    sourceBuildingId: "0:0",
    chunkKey: "0:0",
    coneIndex: 0,
  };
}

test("WerkschauCollisionController invalidates when cone positions change in the same active chunks", () => {
  const controller = new WerkschauCollisionController();
  const trackedMesh = createTrackedMesh();
  const cones = [createCone()];

  controller.update(cones, 1, [trackedMesh], 1);

  expect(Array.from(trackedMesh.vertexMask)).toContain(1);

  controller.update(
    [
      {
        ...createCone(),
        tip: new THREE.Vector3(1000, 10, 0),
        baseCenter: new THREE.Vector3(1000, -10, 0),
      },
    ],
    2,
    [trackedMesh],
    1,
  );

  expect(Array.from(trackedMesh.vertexMask)).toEqual([0, 0, 0]);
});

test("WerkschauCollisionController invalidates tracked meshes when cone stream changes", () => {
  const controller = new WerkschauCollisionController();
  const trackedMesh = createTrackedMesh();
  const cones = [createCone()];

  controller.update(cones, 1, [trackedMesh], 1);

  expect(Array.from(trackedMesh.vertexMask)).toContain(1);

  controller.update([], 2, [trackedMesh], 1);

  expect(Array.from(trackedMesh.vertexMask)).toEqual([0, 0, 0]);
});

test("WerkschauCollisionController lets cones affect meshes across chunk keys", () => {
  const controller = new WerkschauCollisionController();
  const trackedMesh = createTrackedMesh();
  const cone = {
    ...createCone(),
    chunkKey: "neighbor:chunk",
  };

  controller.update([cone], 1, [trackedMesh], 1);

  expect(Array.from(trackedMesh.vertexMask)).toContain(1);
});

test("WerkschauCollisionController skips vertex sampling for prebaked cone masks", () => {
  const controller = new WerkschauCollisionController();
  const geometry = createTestGeometry();
  const bakedMask = new Float32Array([0, 1, 0]);
  geometry.setAttribute("coneMask", new THREE.BufferAttribute(bakedMask, 1));
  const trackedMesh = createTrackedMeshWithGeometry(geometry);
  const stats = {
    activeCones: 0,
    trackedMeshes: 0,
    dirtyMeshes: 0,
    processedMeshesLastTick: 0,
    verticesTestedLastTick: 0,
  };

  controller.update([createCone()], 1, [trackedMesh], 1);
  controller.update([createCone()], 2, [trackedMesh], 1);
  controller.writeDebugStats(stats);

  expect(trackedMesh.hasPrebakedConeMask).toBe(true);
  expect(stats.verticesTestedLastTick).toBe(0);
  expect(Array.from(bakedMask)).toEqual([0, 1, 0]);
});

test("WerkschauCollisionController skips prebaked meshes with resolved cone intersection metadata", () => {
  const controller = new WerkschauCollisionController();
  const geometry = createTestGeometry();
  const bakedMask = new Float32Array([0, 1, 0]);
  geometry.setAttribute("coneMask", new THREE.BufferAttribute(bakedMask, 1));
  geometry.userData.werkschauHasConeIntersection = false;
  const trackedMesh = createTrackedMeshWithGeometry(geometry);
  const stats = {
    activeCones: 0,
    trackedMeshes: 0,
    dirtyMeshes: 0,
    processedMeshesLastTick: 0,
    verticesTestedLastTick: 0,
  };

  controller.update([createCone()], 1, [trackedMesh], 1);
  controller.update([createCone()], 2, [trackedMesh], 1);
  controller.writeDebugStats(stats);

  expect(trackedMesh.prebakedConeIntersection).toBe(false);
  expect(stats.processedMeshesLastTick).toBe(0);
  expect(stats.verticesTestedLastTick).toBe(0);
});

test("prebaked cone intersection metadata can come from mesh userData", () => {
  const geometry = createTestGeometry();
  const bakedMask = new Float32Array([0, 1, 0]);
  geometry.setAttribute("coneMask", new THREE.BufferAttribute(bakedMask, 1));
  const trackedMesh = createTrackedMeshWithGeometryAndUserData(geometry, {
    werkschauHasConeIntersection: true,
  });

  expect(trackedMesh.prebakedConeIntersection).toBe(true);
});
