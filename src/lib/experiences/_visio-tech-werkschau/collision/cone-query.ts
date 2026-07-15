import type { TrackedTileMesh } from "./tile-mesh-types";
import type { WerkschauConeVolume } from "./types";
import { overlapsConeBounds } from "./cone-mesh-bounds";

export function collectOverlappingConesForMesh(
  cones: readonly WerkschauConeVolume[],
  mesh: TrackedTileMesh,
): readonly WerkschauConeVolume[] {
  if (cones.length === 0) return [];

  const overlappingCones: WerkschauConeVolume[] = [];

  for (const cone of cones) {
    if (!overlapsConeBounds(cone, mesh)) continue;
    overlappingCones.push(cone);
  }

  return overlappingCones;
}
