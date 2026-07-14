import * as THREE from "three";
import { BERLIN_PLACEMENT } from "./config";
import type {
  BerlinPlacementBuildingSource,
  BerlinRoofCornerCandidate,
} from "./types";

const scratchPosition = new THREE.Vector3();
const scratchRoofCenter = new THREE.Vector3();

interface RoofCell {
  cellX: number;
  cellZ: number;
  maxElevation: number;
  vertices: Array<{
    vertexIndex: number;
    worldPosition: THREE.Vector3;
  }>;
}

interface RoofHullPoint {
  vertexIndex: number;
  worldPosition: THREE.Vector3;
}

export function extractBerlinRoofCornerCandidates(
  source: BerlinPlacementBuildingSource,
): readonly BerlinRoofCornerCandidate[] {
  const positionAttribute = source.geometry.getAttribute("position");
  if (!(positionAttribute instanceof THREE.BufferAttribute)) {
    return [];
  }

  if (positionAttribute.itemSize < 3) {
    return [];
  }

  const vertexCount = positionAttribute.count;
  if (vertexCount === 0) {
    return [];
  }

  source.mesh.updateMatrixWorld(true);

  const roofCells = new Map<string, RoofCell>();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    scratchPosition
      .fromBufferAttribute(positionAttribute, vertexIndex)
      .applyMatrix4(source.mesh.matrixWorld);

    const cellX = Math.floor(
      scratchPosition.x / BERLIN_PLACEMENT.TILE_BUILDING_CELL_SIZE,
    );
    const cellZ = Math.floor(
      scratchPosition.z / BERLIN_PLACEMENT.TILE_BUILDING_CELL_SIZE,
    );
    const cellKey = `${cellX}:${cellZ}`;
    const cell = roofCells.get(cellKey);

    if (cell) {
      cell.maxElevation = Math.max(cell.maxElevation, scratchPosition.y);
      cell.vertices.push({
        vertexIndex,
        worldPosition: scratchPosition.clone(),
      });
      continue;
    }

    roofCells.set(cellKey, {
      cellX,
      cellZ,
      maxElevation: scratchPosition.y,
      vertices: [
        {
          vertexIndex,
          worldPosition: scratchPosition.clone(),
        },
      ],
    });
  }

  if (roofCells.size === 0) {
    return [];
  }

  const dedupeDistanceSq =
    BERLIN_PLACEMENT.SAME_BUILDING_DEDUPE_EPSILON *
    BERLIN_PLACEMENT.SAME_BUILDING_DEDUPE_EPSILON;
  const candidates: BerlinRoofCornerCandidate[] = [];

  for (const cell of roofCells.values()) {
    if (!Number.isFinite(cell.maxElevation)) {
      continue;
    }

    const buildingId =
      roofCells.size === 1
        ? source.buildingId
        : `${source.buildingId}:cell:${cell.cellX}:${cell.cellZ}`;
    if (cell.maxElevation < BERLIN_PLACEMENT.MIN_CAMERA_HEIGHT) {
      continue;
    }

    const roofPoints = getDedupedRoofPoints(cell);
    const hull = getConvexHull(roofPoints);
    if (hull.length < 3) {
      continue;
    }

    getRoofCenter(hull, scratchRoofCenter);
    const cellCandidates = hull
      .filter(
        (point) =>
          !hasNearbyCandidate(candidates, point.worldPosition, dedupeDistanceSq),
      )
      .map((point) =>
        createRoofCornerCandidate(
          point,
          buildingId,
          source.sourceKey,
          scratchRoofCenter,
        ),
      );

    candidates.push(...limitCornerCandidates(cellCandidates));
  }

  return candidates.sort(compareCornerCandidates);
}

function getDedupedRoofPoints(cell: RoofCell): RoofHullPoint[] {
  const roofElevationThreshold =
    cell.maxElevation - BERLIN_PLACEMENT.ROOF_ELEVATION_EPSILON;
  const roofPoints = new Map<string, RoofHullPoint>();

  for (const vertex of cell.vertices) {
    if (vertex.worldPosition.y < roofElevationThreshold) {
      continue;
    }

    const key = `${quantize(vertex.worldPosition.x)}:${quantize(vertex.worldPosition.z)}`;
    const existing = roofPoints.get(key);
    if (existing && existing.worldPosition.y >= vertex.worldPosition.y) {
      continue;
    }

    roofPoints.set(key, {
      vertexIndex: vertex.vertexIndex,
      worldPosition: vertex.worldPosition.clone(),
    });
  }

  return Array.from(roofPoints.values()).sort(compareHullPoints);
}

function getConvexHull(points: readonly RoofHullPoint[]): RoofHullPoint[] {
  if (points.length <= 3) {
    return [...points];
  }

  const lower: RoofHullPoint[] = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      getCrossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <=
        0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: RoofHullPoint[] = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    while (
      upper.length >= 2 &&
      getCrossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <=
        0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function getRoofCenter(
  points: readonly RoofHullPoint[],
  target: THREE.Vector3,
): THREE.Vector3 {
  target.set(0, 0, 0);

  for (const point of points) {
    target.add(point.worldPosition);
  }

  return target.multiplyScalar(1 / points.length);
}

function createRoofCornerCandidate(
  point: RoofHullPoint,
  buildingId: string,
  sourceKey: string,
  roofCenter: THREE.Vector3,
): BerlinRoofCornerCandidate {
  const roofOutwardDirection = point.worldPosition.clone().sub(roofCenter);
  roofOutwardDirection.y = 0;
  const placementScore = roofOutwardDirection.length();

  if (roofOutwardDirection.lengthSq() > 0) {
    roofOutwardDirection.normalize();
  } else {
    roofOutwardDirection.set(1, 0, 0);
  }

  return {
    buildingId,
    sourceKey,
    cornerIndex: point.vertexIndex,
    elevation: point.worldPosition.y,
    worldPosition: point.worldPosition.clone(),
    roofCenter: roofCenter.clone(),
    roofOutwardDirection,
    placementScore,
  };
}

function limitCornerCandidates(
  candidates: readonly BerlinRoofCornerCandidate[],
): readonly BerlinRoofCornerCandidate[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const sortedCandidates = [...candidates].sort(compareCornerCandidates);
  if (sortedCandidates.length <= BERLIN_PLACEMENT.MAX_CORNERS_PER_BUILDING) {
    return sortedCandidates;
  }

  return sortedCandidates.slice(0, BERLIN_PLACEMENT.MAX_CORNERS_PER_BUILDING);
}

function hasNearbyCandidate(
  candidates: readonly BerlinRoofCornerCandidate[],
  position: THREE.Vector3,
  maxDistanceSq: number,
): boolean {
  for (const candidate of candidates) {
    if (candidate.worldPosition.distanceToSquared(position) <= maxDistanceSq) {
      return true;
    }
  }

  return false;
}

function compareCornerCandidates(
  left: BerlinRoofCornerCandidate,
  right: BerlinRoofCornerCandidate,
): number {
  const leftScore = left.placementScore ?? 0;
  const rightScore = right.placementScore ?? 0;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  if (left.elevation !== right.elevation) {
    return right.elevation - left.elevation;
  }

  if (left.worldPosition.x !== right.worldPosition.x) {
    return left.worldPosition.x - right.worldPosition.x;
  }

  if (left.worldPosition.z !== right.worldPosition.z) {
    return left.worldPosition.z - right.worldPosition.z;
  }

  return left.cornerIndex - right.cornerIndex;
}

function compareHullPoints(left: RoofHullPoint, right: RoofHullPoint): number {
  if (left.worldPosition.x !== right.worldPosition.x) {
    return left.worldPosition.x - right.worldPosition.x;
  }

  if (left.worldPosition.z !== right.worldPosition.z) {
    return left.worldPosition.z - right.worldPosition.z;
  }

  return left.vertexIndex - right.vertexIndex;
}

function getCrossProduct(
  origin: RoofHullPoint,
  left: RoofHullPoint,
  right: RoofHullPoint,
): number {
  const leftX = left.worldPosition.x - origin.worldPosition.x;
  const leftZ = left.worldPosition.z - origin.worldPosition.z;
  const rightX = right.worldPosition.x - origin.worldPosition.x;
  const rightZ = right.worldPosition.z - origin.worldPosition.z;

  return leftX * rightZ - leftZ * rightX;
}

function quantize(value: number): number {
  return Math.round(value / BERLIN_PLACEMENT.SAME_BUILDING_DEDUPE_EPSILON);
}
