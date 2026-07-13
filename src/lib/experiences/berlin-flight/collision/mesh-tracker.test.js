// @ts-nocheck
import { expect, mock, test } from "bun:test";
import * as THREE from "three";

mock.module("$env/static/public", () => ({
  PUBLIC_BERLIN_ION_ASSET_ID: "0",
  PUBLIC_BERLIN_TILES_URL: "",
  PUBLIC_CESIUM_ION_TOKEN: "",
}));

test("filtered-out tile meshes are still swapped to Berlin material", async () => {
  const { BerlinTileMeshRegistry } = await import("./mesh-tracker");
  const registry = new BerlinTileMeshRegistry();
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      3,
    ),
  );
  const sourceMaterial = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, sourceMaterial);
  root.add(mesh);

  registry.trackTileScene(root, "test-url");

  expect(registry.getTrackedMeshCount()).toBe(0);
  expect(mesh.material).not.toBe(sourceMaterial);

  let sourceDisposed = false;
  let berlinMaterialDisposed = false;
  sourceMaterial.addEventListener("dispose", () => {
    sourceDisposed = true;
  });
  mesh.material.addEventListener("dispose", () => {
    berlinMaterialDisposed = true;
  });

  registry.untrackTileScene(root);

  expect(sourceDisposed).toBe(true);
  expect(berlinMaterialDisposed).toBe(true);
});

test("tracked tile meshes get cone material after first mask write", async () => {
  const { BerlinCollisionController } = await import("./controller");
  const { BerlinTileMeshRegistry } = await import("./mesh-tracker");
  const registry = new BerlinTileMeshRegistry();
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        -2, -2, 0,
        2, -2, 0,
        2, 2, 0,
        -2, -2, 0,
        2, 2, 0,
        -2, 2, 0,
        -2, -2, 2,
        2, -2, 2,
        2, 2, 2,
        -2, -2, 2,
        2, 2, 2,
        -2, 2, 2,
      ]),
      3,
    ),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  root.add(mesh);

  registry.trackTileScene(root, "test-url");
  const trackedMesh = registry.getTrackedTileMeshes()[0];

  expect(trackedMesh).toBeDefined();
  expect(mesh.material).toBe(trackedMesh.neutralMaterial);
  expect(mesh.material).not.toBe(trackedMesh.collisionMaterial);

  const controller = new BerlinCollisionController();
  controller.update([], 1, [trackedMesh], registry.getVersion());

  expect(mesh.material).toBe(trackedMesh.collisionMaterial);
  expect(trackedMesh.hasConeMaskMaterial).toBe(true);
});
