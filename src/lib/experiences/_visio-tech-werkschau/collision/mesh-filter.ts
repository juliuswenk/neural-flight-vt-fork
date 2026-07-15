import { WERKSCHAU_COLLISION } from "./config";
import type { TrackedTileMesh } from "./tile-mesh-types";

export function shouldTrackMeshForConeMask(mesh: TrackedTileMesh): boolean {
  if (mesh.vertexCount < WERKSCHAU_COLLISION.MIN_TRACKED_VERTICES) return false;
  if (mesh.vertexCount > WERKSCHAU_COLLISION.MAX_TRACKED_VERTICES) return false;

  return (
    mesh.localSphere.radius >= WERKSCHAU_COLLISION.MIN_TRACKED_RADIUS &&
    mesh.localSphere.radius <= WERKSCHAU_COLLISION.MAX_TRACKED_RADIUS
  );
}
