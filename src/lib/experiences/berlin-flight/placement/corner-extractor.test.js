// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { extractBerlinRoofCornerCandidates } from "./corner-extractor";

test("extractBerlinRoofCornerCandidates keeps highest roof corners and dedupes repeats", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 0, 10, 0, 4, 10, 0, 4, 10, 4, 0, 10, 4, 4, 10, 4, 2, 8, 2],
      3,
    ),
  );

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(10, 5, -3);
  mesh.updateMatrixWorld(true);

  const source = {
    buildingId: "building-a",
    sourceKey: "tile-a:mesh-0",
    mesh,
    geometry,
    metadata: {
      osmId: null,
      featureId: null,
      sourceLayer: null,
    },
  };

  const candidates = extractBerlinRoofCornerCandidates(source);

  expect(candidates).toHaveLength(4);
  expect(candidates.map((candidate) => candidate.cornerIndex)).toEqual([1, 4, 2, 3]);
  expect(candidates.every((candidate) => candidate.elevation === 15)).toBe(true);
});

test("extractBerlinRoofCornerCandidates splits large tile meshes into roof cells", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 20, 0, 4, 20, 0, 0, 20, 4, 4, 20, 4,
        96, 10, 0, 100, 10, 0, 96, 10, 4, 100, 10, 4,
      ],
      3,
    ),
  );

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);

  const candidates = extractBerlinRoofCornerCandidates({
    buildingId: "tile-a",
    sourceKey: "tile-a:mesh-0",
    mesh,
    geometry,
    metadata: {
      osmId: null,
      featureId: null,
      sourceLayer: null,
    },
  });

  expect(new Set(candidates.map((candidate) => candidate.buildingId)).size).toBe(2);
  expect(candidates.some((candidate) => candidate.elevation === 10)).toBe(true);
});
