import type { TrackedTileMesh } from "../collision/tile-mesh-types";
import { BERLIN_MITTE_ORIGIN } from "../geo/berlin-mitte-origin";
import { geoToLocal } from "../geo/coordinates";
import type { BerlinConeSourceMeshFile } from "./source-contracts";
import { createBerlinConeSourceMeshRecord } from "./source-export";

const BERLIN_FULL_CITY_GEO_BOUNDS = {
  north: 52.675,
  south: 52.338,
  west: 13.088,
  east: 13.761,
} as const;

export interface BerlinSweepCell {
  x: number;
  z: number;
}

export interface BerlinFullCitySweepPlan {
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  cells: readonly BerlinSweepCell[];
}

export interface BerlinFullCitySourceExportResult {
  filesBySourceUrl: ReadonlyMap<string, BerlinConeSourceMeshFile>;
  meshesAdded: number;
  sourceUrlsAdded: number;
}

export function createBerlinFullCitySweepPlan(
  stepMeters: number,
): BerlinFullCitySweepPlan {
  if (!Number.isFinite(stepMeters) || stepMeters <= 0) {
    throw new Error("[BerlinFlight] Sweep step must be a positive finite number.");
  }

  const bounds = BERLIN_FULL_CITY_GEO_BOUNDS;
  const corners = [
    geoToLocal(BERLIN_MITTE_ORIGIN, {
      lat: bounds.north,
      lon: bounds.west,
      height: 0,
    }),
    geoToLocal(BERLIN_MITTE_ORIGIN, {
      lat: bounds.north,
      lon: bounds.east,
      height: 0,
    }),
    geoToLocal(BERLIN_MITTE_ORIGIN, {
      lat: bounds.south,
      lon: bounds.west,
      height: 0,
    }),
    geoToLocal(BERLIN_MITTE_ORIGIN, {
      lat: bounds.south,
      lon: bounds.east,
      height: 0,
    }),
  ];

  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minZ = Math.min(...corners.map((corner) => corner.z));
  const maxZ = Math.max(...corners.map((corner) => corner.z));
  const cells: BerlinSweepCell[] = [];

  for (let z = minZ; z <= maxZ + Number.EPSILON; z += stepMeters) {
    for (let x = minX; x <= maxX + Number.EPSILON; x += stepMeters) {
      cells.push({
        x: roundSweepCoordinate(x),
        z: roundSweepCoordinate(z),
      });
    }
  }

  return {
    bounds: { minX, maxX, minZ, maxZ },
    cells,
  };
}

export function buildBerlinSourceFilesBySourceUrl(
  trackedMeshes: readonly TrackedTileMesh[],
  seenSourceUrls: ReadonlySet<string> = new Set<string>(),
): BerlinFullCitySourceExportResult {
  const filesBySourceUrl = new Map<string, BerlinConeSourceMeshFile>();
  const sortedMeshes = trackedMeshes.slice().sort(compareTrackedMeshes);
  let meshesAdded = 0;

  for (const trackedMesh of sortedMeshes) {
    if (seenSourceUrls.has(trackedMesh.sourceUrl)) {
      continue;
    }

    const existing = filesBySourceUrl.get(trackedMesh.sourceUrl);
    const nextMeshes = existing ? [...existing.meshes] : [];
    nextMeshes.push(createBerlinConeSourceMeshRecord(trackedMesh));
    filesBySourceUrl.set(trackedMesh.sourceUrl, {
      version: 1,
      meshes: nextMeshes,
    });
    meshesAdded += 1;
  }

  return {
    filesBySourceUrl,
    meshesAdded,
    sourceUrlsAdded: filesBySourceUrl.size,
  };
}

function compareTrackedMeshes(left: TrackedTileMesh, right: TrackedTileMesh): number {
  if (left.sourceUrl !== right.sourceUrl) {
    return left.sourceUrl.localeCompare(right.sourceUrl);
  }

  if (left.mesh.uuid !== right.mesh.uuid) {
    return left.mesh.uuid.localeCompare(right.mesh.uuid);
  }

  return left.vertexCount - right.vertexCount;
}

function roundSweepCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
