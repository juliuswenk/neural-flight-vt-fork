import type {
  WerkschauConeChunkSnapshot,
  WerkschauConeVolume,
} from "../collision/types";

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
  const chunkSnapshots: WerkschauConeChunkSnapshot[] = [];
  const coneVolumes: WerkschauConeVolume[] = [];

  for (const chunk of activeChunks) {
    chunkSnapshots.push({
      key: chunk.key,
      cones: chunk.cones,
    });
    coneVolumes.push(...chunk.cones);
  }

  return {
    chunkSnapshots,
    coneVolumes,
  };
}
