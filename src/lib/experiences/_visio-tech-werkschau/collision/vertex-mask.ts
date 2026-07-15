import * as THREE from "three";
import { WERKSCHAU_COLLISION } from "./config";
import type { WerkschauConeVolume } from "./types";
import type { TrackedTileMesh } from "./tile-mesh-types";
import { isVertexInsideCone } from "./vertex-cone-test";

const scratchPosition = new THREE.Vector3();
const scratchTriangleCenter = new THREE.Vector3();
const scratchTriangleSample = new THREE.Vector3();
const scratchTriangleVertexA = new THREE.Vector3();
const scratchTriangleVertexB = new THREE.Vector3();
const scratchTriangleVertexC = new THREE.Vector3();

// Reveal state is cumulative for the whole session, mirroring prebaked cone
// masks: bits are only ever added, so already-revealed areas survive cone
// chunks streaming out. The mask holds world-space results, so the only valid
// invalidation is a mesh transform change (handled below).
export function updateVertexMask(
  mesh: TrackedTileMesh,
  cones: readonly WerkschauConeVolume[],
): void {
  if (cones.length === 0) return;

  updateTrackedMeshWorldPositions(mesh);

  for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex += 1) {
    if (mesh.vertexMask[vertexIndex] === 1) continue;

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

  // Accumulated mask bits describe world-space cone hits; a transform change
  // invalidates them along with the cached world positions.
  if (mesh.worldPositionsInitialized) {
    mesh.vertexMask.fill(0);
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
  cones: readonly WerkschauConeVolume[],
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

    if (isTriangleInsideAnyCone(mesh, vertexA, vertexB, vertexC, cones)) {
      mesh.vertexMask[vertexA] = 1;
      mesh.vertexMask[vertexB] = 1;
      mesh.vertexMask[vertexC] = 1;
    }
  }
}

function isTriangleInsideAnyCone(
  mesh: TrackedTileMesh,
  vertexA: number,
  vertexB: number,
  vertexC: number,
  cones: readonly WerkschauConeVolume[],
): boolean {
  setTriangleVertices(mesh, vertexA, vertexB, vertexC);
  setTriangleCenter();

  for (const cone of cones) {
    if (isVertexInsideCone(scratchTriangleCenter, cone)) return true;
    if (isSampledTriangleInsideCone(cone)) return true;
  }

  return false;
}

function isSampledTriangleInsideCone(cone: WerkschauConeVolume): boolean {
  const steps = getTriangleSampleSubdivisions();
  if (steps <= 1) return false;

  for (let aStep = 0; aStep <= steps; aStep += 1) {
    for (let bStep = 0; bStep <= steps - aStep; bStep += 1) {
      const cStep = steps - aStep - bStep;
      if (aStep === steps || bStep === steps || cStep === steps) continue;

      const aWeight = aStep / steps;
      const bWeight = bStep / steps;
      const cWeight = cStep / steps;

      scratchTriangleSample
        .copy(scratchTriangleVertexA)
        .multiplyScalar(aWeight)
        .addScaledVector(scratchTriangleVertexB, bWeight)
        .addScaledVector(scratchTriangleVertexC, cWeight);

      if (isVertexInsideCone(scratchTriangleSample, cone)) return true;
    }
  }

  return false;
}

function getTriangleSampleSubdivisions(): number {
  const edgeAB = scratchTriangleVertexA.distanceTo(scratchTriangleVertexB);
  const edgeBC = scratchTriangleVertexB.distanceTo(scratchTriangleVertexC);
  const edgeCA = scratchTriangleVertexC.distanceTo(scratchTriangleVertexA);
  const longestEdge = Math.max(edgeAB, edgeBC, edgeCA);

  return Math.min(
    WERKSCHAU_COLLISION.MAX_TRIANGLE_MASK_SUBDIVISIONS,
    Math.ceil(longestEdge / WERKSCHAU_COLLISION.TRIANGLE_MASK_SAMPLE_SPACING_METERS),
  );
}

function setTriangleVertices(
  mesh: TrackedTileMesh,
  vertexA: number,
  vertexB: number,
  vertexC: number,
): void {
  scratchTriangleVertexA.fromArray(mesh.worldPositions, vertexA * 3);
  scratchTriangleVertexB.fromArray(mesh.worldPositions, vertexB * 3);
  scratchTriangleVertexC.fromArray(mesh.worldPositions, vertexC * 3);
}

function setTriangleCenter(): void {
  scratchTriangleCenter
    .copy(scratchTriangleVertexA)
    .add(scratchTriangleVertexB)
    .add(scratchTriangleVertexC)
    .multiplyScalar(1 / 3);
}
