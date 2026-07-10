import type { BerlinConeChunkKey } from "../runtime/cone-grid-coordinates";

export interface BerlinConeDatasetManifest {
  version: number;
  origin: {
    x: number;
    z: number;
  };
  chunkSizeMeters: number;
  bounds: {
    minChunkX: number;
    maxChunkX: number;
    minChunkZ: number;
    maxChunkZ: number;
  };
  chunkCount: number;
}

/**
 * Flat runtime payload for a single world-space chunk of precomputed cones.
 * `tileUrl` is intentionally absent: chunk identity is stable local Berlin space.
 */
export interface BerlinConeChunkData {
  chunkKey: BerlinConeChunkKey;
  chunkWorldMinX: number;
  chunkWorldMinZ: number;
  chunkSizeMeters: number;
  positions: Float32Array;
  scalars: Float32Array;
  coneIndex: Int32Array;
}
