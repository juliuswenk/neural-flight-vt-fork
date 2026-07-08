import * as THREE from "three";
import { BERLIN_PLACEMENT } from "./config";
import type {
  BerlinPlacementBuildingSource,
  BerlinRoofCornerCandidate,
} from "./types";

const scratchPosition = new THREE.Vector3();

interface RoofCell {
  cellX: number;
  cellZ: number;
  maxElevation: number;
  vertices: Array<{
    vertexIndex: number;
    worldPosition: THREE.Vector3;
  }>;
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
    const roofElevationThreshold =
      cell.maxElevation - BERLIN_PLACEMENT.ROOF_ELEVATION_EPSILON;
    const cellCandidates: BerlinRoofCornerCandidate[] = [];

    for (const vertex of cell.vertices) {
      if (vertex.worldPosition.y < roofElevationThreshold) {
        continue;
      }

      if (
        hasNearbyCandidate(
          cellCandidates,
          vertex.worldPosition,
          dedupeDistanceSq,
        )
      ) {
        continue;
      }

      cellCandidates.push({
        buildingId,
        sourceKey: source.sourceKey,
        cornerIndex: vertex.vertexIndex,
        elevation: vertex.worldPosition.y,
        worldPosition: vertex.worldPosition.clone(),
      });
    }

    candidates.push(...limitCornerCandidates(cellCandidates));
  }

  return candidates.sort(compareCornerCandidates);
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
