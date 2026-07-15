import type * as THREE from "three";
import { WERKSCHAU_CONE_RUNTIME_GRID } from "./cone-grid-config";

export type WerkschauConeChunkKey = `${number}:${number}`;

export type WerkschauConeChunkCoordinate = {
  x: number;
  z: number;
};

export const WERKSCHAU_CONE_CHUNK_SIZE_METERS =
  WERKSCHAU_CONE_RUNTIME_GRID.SPACING *
  WERKSCHAU_CONE_RUNTIME_GRID.CHUNK_CONES_PER_SIDE;

export function getWerkschauConeChunkCoordinate(
  position: THREE.Vector3,
): WerkschauConeChunkCoordinate {
  return {
    x: Math.floor(position.x / WERKSCHAU_CONE_CHUNK_SIZE_METERS),
    z: Math.floor(position.z / WERKSCHAU_CONE_CHUNK_SIZE_METERS),
  };
}

export function collectWerkschauConeChunkKeys(
  center: WerkschauConeChunkCoordinate,
  radius: number,
): WerkschauConeChunkKey[] {
  const chunkKeys: WerkschauConeChunkKey[] = [];

  for (let z = center.z - radius; z <= center.z + radius; z += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      chunkKeys.push(getWerkschauConeChunkKey({ x, z }));
    }
  }

  return chunkKeys;
}

export function getWerkschauConeChunkKey(
  coordinate: WerkschauConeChunkCoordinate,
): WerkschauConeChunkKey {
  return `${coordinate.x}:${coordinate.z}` as WerkschauConeChunkKey;
}

export function getWerkschauConeChunkFileName(chunkKey: string): string {
  return `${chunkKey.replace(":", "_")}.json`;
}

export function parseWerkschauConeChunkKey(
  chunkKey: WerkschauConeChunkKey | string,
): WerkschauConeChunkCoordinate {
  const [x, z] = chunkKey.split(":");

  return {
    x: Number(x),
    z: Number(z),
  };
}
