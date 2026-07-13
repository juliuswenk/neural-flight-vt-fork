import * as THREE from "three";
import type { BerlinConeVolume } from "./types";
import type { TrackedTileMesh } from "./tile-mesh-types";
import { isVertexInsideCone } from "./vertex-cone-test";

const scratchPosition = new THREE.Vector3();
const scratchTriangleCenter = new THREE.Vector3();

export function updateVertexMask(
  mesh: TrackedTileMesh,
  cones: readonly BerlinConeVolume[],
): void {
  mesh.vertexMask.fill(0);
  if (cones.length === 0) return;

  updateTrackedMeshWorldPositions(mesh);

  for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    scratchPosition.fromArray(mesh.worldPositions, offset);

    for (const cone of cones) {
      if (!isVertexInsideCone(scratchPosition, cone)) continue;

      mesh.vertexMask[vertexIndex] = 1;
      break;
    }
  }

  updateTriangleMask(mesh, cones);
}

function updateTrackedMeshWorldPositions(mesh: TrackedTileMesh): void {
  if (
    mesh.worldPositionsInitialized &&
    mesh.cachedVertexWorldMatrix.equals(mesh.mesh.matrixWorld)
  ) {
    return;
  }

  mesh.cachedVertexWorldMatrix.copy(mesh.mesh.matrixWorld);
  mesh.worldPositionsInitialized = true;

  for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    scratchPosition.fromArray(mesh.positions, offset);
    scratchPosition.applyMatrix4(mesh.cachedVertexWorldMatrix);
    scratchPosition.toArray(mesh.worldPositions, offset);
  }
}

function updateTriangleMask(
  mesh: TrackedTileMesh,
  cones: readonly BerlinConeVolume[],
): void {
  const index = mesh.geometry.index;
  const triangleCount = index ? index.count / 3 : mesh.vertexCount / 3;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertexA = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
    const vertexB = index ? index.getX(triangleIndex * 3 + 1) : vertexA + 1;
    const vertexC = index ? index.getX(triangleIndex * 3 + 2) : vertexA + 2;

    if (
      mesh.vertexMask[vertexA] === 1 &&
      mesh.vertexMask[vertexB] === 1 &&
      mesh.vertexMask[vertexC] === 1
    ) {
      continue;
    }

    setTriangleCenter(mesh, vertexA, vertexB, vertexC);

    for (const cone of cones) {
      if (!isVertexInsideCone(scratchTriangleCenter, cone)) continue;

      mesh.vertexMask[vertexA] = 1;
      mesh.vertexMask[vertexB] = 1;
      mesh.vertexMask[vertexC] = 1;
      break;
    }
  }
}

function setTriangleCenter(
  mesh: TrackedTileMesh,
  vertexA: number,
  vertexB: number,
  vertexC: number,
): void {
  scratchTriangleCenter
    .fromArray(mesh.worldPositions, vertexA * 3)
    .add(scratchPosition.fromArray(mesh.worldPositions, vertexB * 3))
    .add(scratchPosition.fromArray(mesh.worldPositions, vertexC * 3))
    .multiplyScalar(1 / 3);
}
