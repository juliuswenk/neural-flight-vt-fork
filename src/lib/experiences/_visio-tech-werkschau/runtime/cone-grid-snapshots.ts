import type {
  WerkschauConeChunkSnapshot,
  WerkschauConeVolume,
} from "../collision/types";
import { WERKSCHAU_CONE_MIN_TIP_HEIGHT } from "../constants";

export type ActiveWerkschauConeChunkSnapshotSource = {
  key: string;
  cones: readonly WerkschauConeVolume[];
};

export function buildWerkschauConeSnapshotState(
  activeChunks: Iterable<ActiveWerkschauConeChunkSnapshotSource>,
): {
  chunkSnapshots: readonly WerkschauConeChunkSnapshot[];
  coneVolumes: readonly WerkschauConeVolume[];
} {
  const sourceChunks = Array.from(activeChunks);
  const chunkSnapshots: WerkschauConeChunkSnapshot[] = [];
  const coneVolumes: WerkschauConeVolume[] = [];

  for (const chunk of sourceChunks) {
    const cones = chunk.cones.filter(
      (cone) => cone.tip.y >= WERKSCHAU_CONE_MIN_TIP_HEIGHT,
    );
    chunkSnapshots.push({
      key: chunk.key,
      cones,
    });
    coneVolumes.push(...cones);
  }

  return {
    chunkSnapshots,
    coneVolumes,
  };
}
