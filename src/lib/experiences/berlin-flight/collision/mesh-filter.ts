import { BERLIN_COLLISION } from "./config";
import type { TrackedTileMesh } from "./tile-mesh-types";

export function shouldTrackMeshForConeMask(mesh: TrackedTileMesh): boolean {
  if (mesh.vertexCount < BERLIN_COLLISION.MIN_TRACKED_VERTICES) return false;
  if (mesh.vertexCount > BERLIN_COLLISION.MAX_TRACKED_VERTICES) return false;

  return (
    mesh.localSphere.radius >= BERLIN_COLLISION.MIN_TRACKED_RADIUS &&
    mesh.localSphere.radius <= BERLIN_COLLISION.MAX_TRACKED_RADIUS
  );
}
