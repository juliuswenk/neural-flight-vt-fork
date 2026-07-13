import * as THREE from "three";
import {
  WERKSCHAU_CONE_DATASET_BASE_URL,
  WERKSCHAU_CONE_MIN_TILT_DEGREES,
} from "../constants";
import type {
  WerkschauConeChunkSnapshot,
  WerkschauConeVolume,
} from "../collision/types";
import {
  getWerkschauConeChunkFileName,
  type WerkschauConeChunkKey,
} from "../runtime/cone-grid-coordinates";
import type {
  WerkschauConeChunkData,
  WerkschauConeDatasetManifest,
} from "./contracts";

export interface WerkschauConeDatasetAssetLoader {
  loadChunk(chunkKey: string): Promise<WerkschauConeChunkSnapshot>;
  loadManifest(): Promise<WerkschauConeDatasetManifest>;
}

export type WerkschauConeDatasetLoadErrorCode =
  | "manifest-missing"
  | "manifest-invalid"
  | "chunk-missing"
  | "chunk-invalid"
  | "load-error";

export class WerkschauConeDatasetLoadError extends Error {
  public readonly code: WerkschauConeDatasetLoadErrorCode;
  public readonly chunkKey: string | null;

  constructor(
    code: WerkschauConeDatasetLoadErrorCode,
    message: string,
    options?: {
      chunkKey?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "WerkschauConeDatasetLoadError";
    this.code = code;
    this.chunkKey = options?.chunkKey ?? null;
  }
}

export function createWerkschauConeDatasetAssetLoader(): WerkschauConeDatasetAssetLoader {
  return {
    async loadManifest(): Promise<WerkschauConeDatasetManifest> {
      try {
        return parseWerkschauConeDatasetManifest(
          await fetchDatasetJson(
            `${WERKSCHAU_CONE_DATASET_BASE_URL}/manifest.json`,
            "manifest-missing",
          ),
        );
      } catch (error: unknown) {
        throw asDatasetLoadError("manifest-invalid", error);
      }
    },
    async loadChunk(chunkKey: string): Promise<WerkschauConeChunkSnapshot> {
      try {
        return createWerkschauConeChunkSnapshot(
          parseWerkschauConeChunkData(
            await fetchDatasetJson(
              `${WERKSCHAU_CONE_DATASET_BASE_URL}/chunks/${getWerkschauConeChunkFileName(chunkKey)}`,
              "chunk-missing",
              chunkKey,
            ),
          ),
        );
      } catch (error: unknown) {
        throw asDatasetLoadError("chunk-invalid", error, chunkKey);
      }
    },
  };
}

async function fetchDatasetJson(
  url: string,
  missingCode: "manifest-missing" | "chunk-missing",
  chunkKey?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    throw new WerkschauConeDatasetLoadError(
      "load-error",
      `[Werkschau] Failed to fetch precomputed cone data at ${url}.`,
      { cause: error, chunkKey },
    );
  }

  if (response.status === 404) {
    throw new WerkschauConeDatasetLoadError(
      missingCode,
      `[Werkschau] Missing precomputed cone data at ${url}.`,
      { chunkKey },
    );
  }

  if (!response.ok) {
    throw new WerkschauConeDatasetLoadError(
      "load-error",
      `[Werkschau] Failed to fetch precomputed cone data at ${url}: ${response.status} ${response.statusText}`,
      { chunkKey },
    );
  }

  return (await response.json()) as unknown;
}

function parseWerkschauConeDatasetManifest(
  value: unknown,
): WerkschauConeDatasetManifest {
  if (!isRecord(value) || !isRecord(value.origin) || !isRecord(value.bounds)) {
    throw new Error("[Werkschau] Malformed cone dataset manifest.");
  }

  return {
    version: getFiniteNumber(value.version, "manifest.version"),
    origin: {
      x: getFiniteNumber(value.origin.x, "manifest.origin.x"),
      z: getFiniteNumber(value.origin.z, "manifest.origin.z"),
    },
    chunkSizeMeters: getFiniteNumber(
      value.chunkSizeMeters,
      "manifest.chunkSizeMeters",
    ),
    bounds: {
      minChunkX: getFiniteNumber(
        value.bounds.minChunkX,
        "manifest.bounds.minChunkX",
      ),
      maxChunkX: getFiniteNumber(
        value.bounds.maxChunkX,
        "manifest.bounds.maxChunkX",
      ),
      minChunkZ: getFiniteNumber(
        value.bounds.minChunkZ,
        "manifest.bounds.minChunkZ",
      ),
      maxChunkZ: getFiniteNumber(
        value.bounds.maxChunkZ,
        "manifest.bounds.maxChunkZ",
      ),
    },
    chunkCount: getFiniteNumber(value.chunkCount, "manifest.chunkCount"),
  };
}

export function parseWerkschauConeChunkData(
  value: unknown,
): WerkschauConeChunkData {
  if (!isRecord(value) || typeof value.chunkKey !== "string") {
    throw new Error("[Werkschau] Malformed cone chunk payload.");
  }

  const positions = getFiniteNumberArray(value.positions, "chunk.positions");
  const scalars = getFiniteNumberArray(value.scalars, "chunk.scalars");
  const coneIndex = getFiniteIntegerArray(value.coneIndex, "chunk.coneIndex");

  if (positions.length % 6 !== 0) {
    throw new Error(
      `[Werkschau] Cone chunk ${value.chunkKey} has invalid positions length ${positions.length}.`,
    );
  }

  if (scalars.length % 2 !== 0) {
    throw new Error(
      `[Werkschau] Cone chunk ${value.chunkKey} has invalid scalars length ${scalars.length}.`,
    );
  }

  if (
    positions.length / 6 !== scalars.length / 2 ||
    positions.length / 6 !== coneIndex.length
  ) {
    throw new Error(
      `[Werkschau] Cone chunk ${value.chunkKey} has mismatched array lengths.`,
    );
  }

  return {
    chunkKey: parseWerkschauConeChunkKey(value.chunkKey),
    chunkWorldMinX: getFiniteNumber(value.chunkWorldMinX, "chunk.chunkWorldMinX"),
    chunkWorldMinZ: getFiniteNumber(value.chunkWorldMinZ, "chunk.chunkWorldMinZ"),
    chunkSizeMeters: getFiniteNumber(
      value.chunkSizeMeters,
      "chunk.chunkSizeMeters",
    ),
    positions: Float32Array.from(positions),
    scalars: Float32Array.from(scalars),
    coneIndex: Int32Array.from(coneIndex),
  };
}

export function createWerkschauConeChunkSnapshot(
  chunk: WerkschauConeChunkData,
): WerkschauConeChunkSnapshot {
  const cones: WerkschauConeVolume[] = [];

  for (let index = 0; index < chunk.coneIndex.length; index += 1) {
    const positionOffset = index * 6;
    const scalarOffset = index * 2;
    const tip = new THREE.Vector3(
      chunk.positions[positionOffset],
      chunk.positions[positionOffset + 1],
      chunk.positions[positionOffset + 2],
    );
    const storedAxisDirection = new THREE.Vector3(
      chunk.positions[positionOffset + 3],
      chunk.positions[positionOffset + 4],
      chunk.positions[positionOffset + 5],
    );
    const axisDirection = normalizeConeAxisTilt(storedAxisDirection);
    if (!axisDirection) continue;

    const height = chunk.scalars[scalarOffset + 1];

    cones.push({
      tip,
      axisDirection,
      radius: chunk.scalars[scalarOffset],
      height,
      baseCenter: tip.clone().addScaledVector(axisDirection, height),
      placementPointId: `${chunk.chunkKey}:${chunk.coneIndex[index]}`,
      sourceBuildingId: chunk.chunkKey,
      chunkKey: chunk.chunkKey,
      coneIndex: chunk.coneIndex[index],
    });
  }

  return {
    key: chunk.chunkKey,
    cones,
  };
}

function normalizeConeAxisTilt(axisDirection: THREE.Vector3): THREE.Vector3 | null {
  const length = axisDirection.length();
  if (!Number.isFinite(length) || length === 0) return null;

  const normalizedAxis = axisDirection.clone().divideScalar(length);
  if (normalizedAxis.y >= 0) return null;

  const minTiltRadians = THREE.MathUtils.degToRad(
    WERKSCHAU_CONE_MIN_TILT_DEGREES,
  );
  const tiltRadians = Math.acos(
    THREE.MathUtils.clamp(-normalizedAxis.y, -1, 1),
  );

  if (tiltRadians >= minTiltRadians) return normalizedAxis;

  const horizontalDirection = new THREE.Vector3(
    normalizedAxis.x,
    0,
    normalizedAxis.z,
  );
  if (horizontalDirection.lengthSq() === 0) {
    horizontalDirection.set(1, 0, 0);
  } else {
    horizontalDirection.normalize();
  }

  return new THREE.Vector3(0, -Math.cos(minTiltRadians), 0)
    .addScaledVector(horizontalDirection, Math.sin(minTiltRadians))
    .normalize();
}

function getFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`[Werkschau] Expected finite number for ${label}.`);
  }

  return value;
}

function getFiniteNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`[Werkschau] Expected numeric array for ${label}.`);
  }

  return value.map((entry, index) =>
    getFiniteNumber(entry, `${label}[${index}]`),
  );
}

function getFiniteIntegerArray(value: unknown, label: string): number[] {
  return getFiniteNumberArray(value, label).map((entry, index) => {
    if (!Number.isInteger(entry)) {
      throw new Error(`[Werkschau] Expected integer for ${label}[${index}].`);
    }

    return entry;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWerkschauConeChunkKey(value: string): WerkschauConeChunkKey {
  if (!/^-?\d+:-?\d+$/.test(value)) {
    throw new Error(`[Werkschau] Invalid cone chunk key "${value}".`);
  }

  return value as WerkschauConeChunkKey;
}

function asDatasetLoadError(
  code: WerkschauConeDatasetLoadErrorCode,
  error: unknown,
  chunkKey?: string,
): WerkschauConeDatasetLoadError {
  if (error instanceof WerkschauConeDatasetLoadError) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new WerkschauConeDatasetLoadError(code, message, {
    cause: error,
    chunkKey,
  });
}
