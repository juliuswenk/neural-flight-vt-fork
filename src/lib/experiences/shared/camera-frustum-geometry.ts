import * as THREE from "three";

const CAMERA_FRUSTUM_ASPECT = 4 / 3;

export function createCameraFrustumGeometry(input: {
  halfLongSide: number;
  height: number;
}): THREE.BufferGeometry {
  const halfWidth = input.halfLongSide;
  const halfDepth = input.halfLongSide / CAMERA_FRUSTUM_ASPECT;
  const halfHeight = input.height * 0.5;
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0,
        halfHeight,
        0,
        -halfWidth,
        -halfHeight,
        -halfDepth,
        halfWidth,
        -halfHeight,
        -halfDepth,

        0,
        halfHeight,
        0,
        halfWidth,
        -halfHeight,
        -halfDepth,
        halfWidth,
        -halfHeight,
        halfDepth,

        0,
        halfHeight,
        0,
        halfWidth,
        -halfHeight,
        halfDepth,
        -halfWidth,
        -halfHeight,
        halfDepth,

        0,
        halfHeight,
        0,
        -halfWidth,
        -halfHeight,
        halfDepth,
        -halfWidth,
        -halfHeight,
        -halfDepth,
      ],
      3,
    ),
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}
