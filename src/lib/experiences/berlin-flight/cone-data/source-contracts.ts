export interface BerlinConeSourceManifestEntry {
  path: string;
  sourceUrl?: string;
}

export interface BerlinConeSourceManifest {
  version: 1;
  sources: readonly BerlinConeSourceManifestEntry[];
  center?: {
    x: number;
    z: number;
  };
  radiusMeters?: number;
  bounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  outputDir?: string;
}

export interface BerlinConeSourceMeshRecord {
  positions: readonly number[];
  matrixWorld?: readonly number[];
  sourceUrl?: string;
}

export interface BerlinConeSourceMeshFile {
  version: 1;
  meshes: readonly BerlinConeSourceMeshRecord[];
}
