import type { WerkschauConeChunkKey } from "../runtime/cone-grid-coordinates";

export interface WerkschauConeDatasetManifest {
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

export interface WerkschauConeChunkData {
  chunkKey: WerkschauConeChunkKey;
  chunkWorldMinX: number;
  chunkWorldMinZ: number;
  chunkSizeMeters: number;
  positions: Float32Array;
  scalars: Float32Array;
  coneIndex: Int32Array;
}
