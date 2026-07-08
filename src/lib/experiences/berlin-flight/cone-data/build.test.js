// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import {
  createBerlinConeChunkSnapshot,
  parseBerlinConeChunkData,
} from "./asset-loader";
import { BERLIN_CONE_PLACEMENT } from "../cone-placement/config";
import {
  buildBerlinConeDataset,
  createTrackedMeshFromOfflineGeometry,
} from "./build";

function createBoxTrackedMesh(sourceUrl, position) {
  const geometry = new THREE.BoxGeometry(60, 30, 60, 4, 1, 4);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.copy(position);
  mesh.updateMatrixWorld(true);

  const positions = Array.from(geometry.getAttribute("position").array);

  return createTrackedMeshFromOfflineGeometry({
    positions,
    matrixWorld: Array.from(mesh.matrixWorld.elements),
    sourceUrl,
  });
}

test("buildBerlinConeDataset creates chunked cone output from offline meshes", () => {
  const trackedMeshes = [
    createBoxTrackedMesh("mesh-a", new THREE.Vector3(0, 20, 0)),
    createBoxTrackedMesh("mesh-b", new THREE.Vector3(120, 20, 0)),
    createBoxTrackedMesh("mesh-c", new THREE.Vector3(0, 20, 120)),
  ];

  const result = buildBerlinConeDataset({
    trackedMeshes,
    densitySampler: {
      sampleDensity() {
        return 1;
      },
    },
  });

  expect(result.manifest.chunkCount).toBeGreaterThan(0);
  expect(result.stats.scannedBuildings).toBe(3);
  expect(result.stats.rawCandidates).toBeGreaterThan(0);
  expect(result.stats.stagedCandidates).toBeGreaterThan(0);
  expect(result.stats.rejectedByDensity).toBeGreaterThanOrEqual(0);
  expect(result.stats.rejectedBySpacing).toBeGreaterThanOrEqual(0);
  expect(result.stats.generatedCones).toBeGreaterThan(0);

  const firstChunk = Array.from(result.chunks.values())[0];
  expect(firstChunk.positions.length % 6).toBe(0);
  expect(firstChunk.scalars.length % 2).toBe(0);
  expect(firstChunk.coneIndex.length).toBeGreaterThan(0);
});

test("buildBerlinConeDataset can filter buildings by radius around a center", () => {
  const trackedMeshes = [
    createBoxTrackedMesh("near-a", new THREE.Vector3(0, 20, 0)),
    createBoxTrackedMesh("near-b", new THREE.Vector3(900, 20, 0)),
    createBoxTrackedMesh("far-c", new THREE.Vector3(1300, 20, 0)),
  ];

  const result = buildBerlinConeDataset({
    trackedMeshes,
    densitySampler: {
      sampleDensity() {
        return 1;
      },
    },
    radiusFilter: {
      center: { x: 0, z: 0 },
      radiusMeters: 1000,
    },
  });

  expect(result.stats.sourceMeshes).toBe(2);
  expect(result.stats.scannedBuildings).toBe(2);
  expect(result.stats.rawCandidates).toBeGreaterThan(0);
  expect(result.stats.generatedCones).toBeGreaterThan(0);
});

test("buildBerlinConeDataset chunk data round-trips through the runtime loader", () => {
  const trackedMeshes = [
    createBoxTrackedMesh("mesh-a", new THREE.Vector3(0, 20, 0)),
    createBoxTrackedMesh("mesh-b", new THREE.Vector3(120, 20, 0)),
  ];

  const result = buildBerlinConeDataset({
    trackedMeshes,
    densitySampler: {
      sampleDensity() {
        return 1;
      },
    },
  });

  const firstChunk = Array.from(result.chunks.values())[0];
  const parsedChunk = parseBerlinConeChunkData({
    chunkKey: firstChunk.chunkKey,
    chunkWorldMinX: firstChunk.chunkWorldMinX,
    chunkWorldMinZ: firstChunk.chunkWorldMinZ,
    chunkSizeMeters: firstChunk.chunkSizeMeters,
    positions: Array.from(firstChunk.positions),
    scalars: Array.from(firstChunk.scalars),
    coneIndex: Array.from(firstChunk.coneIndex),
  });
  const snapshot = createBerlinConeChunkSnapshot(parsedChunk);

  expect(snapshot.key).toBe(firstChunk.chunkKey);
  expect(snapshot.cones).toHaveLength(firstChunk.coneIndex.length);
  expect(snapshot.cones[0].tip.toArray()).toEqual([
    firstChunk.positions[0],
    firstChunk.positions[1],
    firstChunk.positions[2],
  ]);
  expect(snapshot.cones[0].axisDirection.x).toBeCloseTo(firstChunk.positions[3], 6);
  expect(snapshot.cones[0].axisDirection.y).toBeCloseTo(firstChunk.positions[4], 6);
  expect(snapshot.cones[0].axisDirection.z).toBeCloseTo(firstChunk.positions[5], 6);
});

test("createBerlinConeChunkSnapshot clamps shallow cone tilt without dropping heading", () => {
  const shallowTiltRadians = THREE.MathUtils.degToRad(20);
  const snapshot = createBerlinConeChunkSnapshot({
    chunkKey: "0:0",
    chunkWorldMinX: 0,
    chunkWorldMinZ: 0,
    chunkSizeMeters: 1920,
    positions: Float32Array.from([
      0,
      10,
      0,
      Math.sin(shallowTiltRadians),
      -Math.cos(shallowTiltRadians),
      0,
    ]),
    scalars: Float32Array.from([48, 180]),
    coneIndex: Int32Array.from([0]),
  });

  expect(snapshot.cones).toHaveLength(1);
  expect(snapshot.cones[0].axisDirection.x).toBeGreaterThan(0);
  expect(snapshot.cones[0].axisDirection.z).toBeCloseTo(0, 6);
  expect(
    THREE.MathUtils.radToDeg(
      snapshot.cones[0].axisDirection.angleTo(new THREE.Vector3(0, -1, 0)),
    ),
  ).toBeCloseTo(BERLIN_CONE_PLACEMENT.MIN_TILT_DEGREES, 6);
});
