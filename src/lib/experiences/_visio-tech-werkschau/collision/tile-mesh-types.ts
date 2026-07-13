import type * as THREE from "three";

export type WerkschauTileMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;

export interface TrackedTileMesh {
  sourceUrl: string;
  mesh: WerkschauTileMesh;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  worldPositions: Float32Array;
  worldPositionsInitialized: boolean;
  vertexCount: number;
  vertexMask: Uint8Array;
  coneMaskAttribute: THREE.BufferAttribute | null;
  originalMaterial: THREE.Material | THREE.Material[];
  neutralMaterial: THREE.Material | THREE.Material[];
  collisionMaterial: THREE.Material | THREE.Material[];
  hasConeMaskMaterial: boolean;
  localBounds: THREE.Box3;
  localSphere: THREE.Sphere;
  cachedBoundsMatrix: THREE.Matrix4;
  cachedVertexWorldMatrix: THREE.Matrix4;
  worldSphere: THREE.Sphere;
}
