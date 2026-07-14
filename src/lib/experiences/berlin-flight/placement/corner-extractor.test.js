// @ts-nocheck
import { expect, test } from "bun:test";
import * as THREE from "three";
import { extractBerlinRoofCornerCandidates } from "./corner-extractor";

test("extractBerlinRoofCornerCandidates keeps roof hull corners and ignores interior peaks", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 100, 0,
        0, 120, 0,
        4, 120, 0,
        4, 120, 4,
        0, 120, 4,
        4, 120, 4,
        2, 121, 2,
      ],
      3,
    ),
  );

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(10, 5, 3);
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
  expect(candidates.map((candidate) => candidate.cornerIndex)).not.toContain(6);
  expect(candidates.every((candidate) => candidate.elevation >= 125)).toBe(true);
  expect(
    candidates.every((candidate) => candidate.roofOutwardDirection.length() > 0),
  ).toBe(true);
});

test("extractBerlinRoofCornerCandidates splits large tile meshes into roof cells", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 130, 0, 4, 130, 0, 0, 130, 4, 4, 130, 4,
        96, 125, 0, 100, 125, 0, 96, 125, 4, 100, 125, 4,
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
  expect(candidates.some((candidate) => candidate.elevation === 125)).toBe(true);
});

test("extractBerlinRoofCornerCandidates rejects low roof cells", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 30, 0, 4, 30, 0, 0, 30, 4, 4, 30, 4],
      3,
    ),
  );

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);

  const candidates = extractBerlinRoofCornerCandidates({
    buildingId: "low-building",
    sourceKey: "tile-a:mesh-0",
    mesh,
    geometry,
    metadata: {
      osmId: null,
      featureId: null,
      sourceLayer: null,
    },
  });

  expect(candidates).toHaveLength(0);
});
