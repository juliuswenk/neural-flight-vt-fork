import type { TrackedTileMesh } from "./tile-mesh-types";
import type { BerlinConeVolume } from "./types";
import { overlapsConeBounds } from "./cone-mesh-bounds";

export function collectOverlappingConesForMesh(
  cones: readonly BerlinConeVolume[],
  mesh: TrackedTileMesh,
): readonly BerlinConeVolume[] {
  if (cones.length === 0) return [];

  const overlappingCones: BerlinConeVolume[] = [];

  for (const cone of cones) {
    if (!overlapsConeBounds(cone, mesh)) continue;
    overlappingCones.push(cone);
  }

  return overlappingCones;
}
