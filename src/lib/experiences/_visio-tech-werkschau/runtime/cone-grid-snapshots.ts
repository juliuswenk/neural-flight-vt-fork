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
  const sourceChunks = Array.from(activeChunks);
  const minimumOriginHeight = getAverageConeOriginHeight(sourceChunks);
  const chunkSnapshots: WerkschauConeChunkSnapshot[] = [];
  const coneVolumes: WerkschauConeVolume[] = [];

  for (const chunk of sourceChunks) {
    const cones = chunk.cones.filter(
      (cone) => cone.tip.y >= minimumOriginHeight,
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

function getAverageConeOriginHeight(
  chunks: readonly ActiveWerkschauConeChunkSnapshotSource[],
): number {
  let sum = 0;
  let count = 0;

  for (const chunk of chunks) {
    for (const cone of chunk.cones) {
      sum += cone.tip.y;
      count += 1;
    }
  }

  return count > 0 ? sum / count : Number.NEGATIVE_INFINITY;
}
