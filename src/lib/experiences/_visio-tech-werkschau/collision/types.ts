import type * as THREE from "three";

export interface WerkschauConeVolume {
  tip: THREE.Vector3;
  axisDirection: THREE.Vector3;
  radius: number;
  height: number;
  baseCenter: THREE.Vector3;
  placementPointId: string;
  sourceBuildingId: string;
  chunkKey: string;
  coneIndex: number;
}

export interface WerkschauConeChunkSnapshot {
  key: string;
  cones: readonly WerkschauConeVolume[];
}
