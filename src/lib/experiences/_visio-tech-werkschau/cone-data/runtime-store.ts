import type * as THREE from "three";
import type {
  WerkschauConeChunkSnapshot,
  WerkschauConeVolume,
} from "../collision/types";
import {
  WERKSCHAU_CONE_CHUNK_SIZE_METERS,
  collectWerkschauConeChunkKeys,
  getWerkschauConeChunkCoordinate,
  parseWerkschauConeChunkKey,
} from "../runtime/cone-grid-coordinates";
import { WERKSCHAU_CONE_RUNTIME_GRID } from "../runtime/cone-grid-config";
import { buildWerkschauConeSnapshotState } from "../runtime/cone-grid-snapshots";
import { WERKSCHAU_EXHIBITION_BOUNDS } from "../constants";
import type { WerkschauConeDatasetManifest } from "./contracts";
import {
  WerkschauConeDatasetLoadError,
  type WerkschauConeDatasetLoadErrorCode,
  createWerkschauConeDatasetAssetLoader,
  type WerkschauConeDatasetAssetLoader,
} from "./asset-loader";

export interface WerkschauConeChunkRuntimeDiagnostics {
  playerChunkKey: string | null;
  desiredChunkCount: number;
  inBoundsChunkCount: number;
  loadedDesiredChunkCount: number;
  activeChunkCount: number;
  activeConeCount: number;
  manifestLoaded: boolean;
  outOfBounds: boolean;
  emptyNearby: boolean;
  errorCode: WerkschauConeDatasetLoadErrorCode | null;
  errorChunkKey: string | null;
  errorMessage: string | null;
}

export class WerkschauConeChunkRuntimeStore {
  private readonly assetLoader: WerkschauConeDatasetAssetLoader;
  private manifestPromise: Promise<WerkschauConeDatasetManifest> | null = null;
  private manifest: WerkschauConeDatasetManifest | null = null;
  private readonly loadedChunks = new Map<string, WerkschauConeChunkSnapshot>();
  private activeChunkSnapshots: readonly WerkschauConeChunkSnapshot[] = [];
  private activeCones: readonly WerkschauConeVolume[] = [];
  private snapshotVersion = 0;
  private diagnostics: WerkschauConeChunkRuntimeDiagnostics =
    createEmptyWerkschauConeRuntimeDiagnostics();

  constructor(
    assetLoader: WerkschauConeDatasetAssetLoader = createWerkschauConeDatasetAssetLoader(),
  ) {
    this.assetLoader = assetLoader;
  }

  public async update(playerPosition: THREE.Vector3): Promise<void> {
    const center = getWerkschauConeChunkCoordinate(playerPosition);
    const desiredChunkKeys = collectWerkschauConeChunkKeys(
      center,
      WERKSCHAU_CONE_RUNTIME_GRID.LOAD_RADIUS_CHUNKS,
    ).filter(isConeChunkInsideExhibitionBounds);
    let inBoundsChunkKeys: readonly string[] = [];
    this.diagnostics.playerChunkKey = `${center.x}:${center.z}`;
    this.diagnostics.desiredChunkCount = desiredChunkKeys.length;

    try {
      const manifest = await this.loadManifest();
      inBoundsChunkKeys = desiredChunkKeys.filter((chunkKey) =>
        this.isChunkInBounds(manifest, chunkKey),
      );
      this.diagnostics.manifestLoaded = true;
      this.diagnostics.inBoundsChunkCount = inBoundsChunkKeys.length;

      await this.loadMissingChunks(inBoundsChunkKeys);
      this.unloadFarChunks(center);
      if (this.areAllChunksLoaded(inBoundsChunkKeys)) {
        this.refreshActiveState(inBoundsChunkKeys);
      }
      this.clearDiagnosticError();
      this.refreshDiagnostics(inBoundsChunkKeys);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error));
      this.applyDiagnosticError(nextError);
      this.refreshDiagnostics(inBoundsChunkKeys);
      throw nextError;
    }
  }

  public async loadManifest(): Promise<WerkschauConeDatasetManifest> {
    if (this.manifest) return this.manifest;
    if (!this.manifestPromise) this.manifestPromise = this.assetLoader.loadManifest();

    this.manifest = await this.manifestPromise;
    return this.manifest;
  }

  public getActiveConeChunks(): readonly WerkschauConeChunkSnapshot[] {
    return this.activeChunkSnapshots;
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion;
  }

  public getLoadedChunkCount(): number {
    return this.loadedChunks.size;
  }

  public getDiagnostics(): WerkschauConeChunkRuntimeDiagnostics {
    return { ...this.diagnostics };
  }

  private async loadMissingChunks(desiredChunkKeys: readonly string[]): Promise<void> {
    let loadsStarted = 0;

    for (const chunkKey of desiredChunkKeys) {
      if (this.loadedChunks.has(chunkKey)) continue;
      if (loadsStarted >= WERKSCHAU_CONE_RUNTIME_GRID.MAX_CHUNK_LOADS_PER_TICK) return;

      this.loadedChunks.set(chunkKey, await this.loadChunkOrEmpty(chunkKey));
      loadsStarted += 1;
    }
  }

  private async loadChunkOrEmpty(
    chunkKey: string,
  ): Promise<WerkschauConeChunkSnapshot> {
    try {
      return await this.assetLoader.loadChunk(chunkKey);
    } catch (error) {
      if (
        error instanceof WerkschauConeDatasetLoadError &&
        error.code === "chunk-missing"
      ) {
        return { key: chunkKey, cones: [] };
      }

      throw error;
    }
  }

  private unloadFarChunks(center: { x: number; z: number }): void {
    for (const chunkKey of this.loadedChunks.keys()) {
      const coordinate = parseWerkschauConeChunkKey(chunkKey);
      if (
        Math.abs(coordinate.x - center.x) <=
          WERKSCHAU_CONE_RUNTIME_GRID.UNLOAD_RADIUS_CHUNKS &&
        Math.abs(coordinate.z - center.z) <=
          WERKSCHAU_CONE_RUNTIME_GRID.UNLOAD_RADIUS_CHUNKS &&
        isConeChunkInsideExhibitionBounds(chunkKey)
      ) {
        continue;
      }

      this.loadedChunks.delete(chunkKey);
    }
  }

  private refreshActiveState(desiredChunkKeys: readonly string[]): void {
    const nextChunks = desiredChunkKeys
      .map((chunkKey) => this.loadedChunks.get(chunkKey))
      .filter((chunk): chunk is WerkschauConeChunkSnapshot => chunk !== undefined)
      .map((chunk) => ({
        key: chunk.key,
        cones: chunk.cones.filter(isConeInsideExhibitionBounds),
      }));
    const nextState = buildWerkschauConeSnapshotState(nextChunks);
    const nextSignature = createSnapshotSignature(nextState.chunkSnapshots);
    const previousSignature = createSnapshotSignature(this.activeChunkSnapshots);

    if (nextSignature === previousSignature) return;

    this.activeChunkSnapshots = nextState.chunkSnapshots;
    this.activeCones = nextState.coneVolumes;
    this.snapshotVersion += 1;
  }

  private areAllChunksLoaded(chunkKeys: readonly string[]): boolean {
    return chunkKeys.every((chunkKey) => this.loadedChunks.has(chunkKey));
  }

  private isChunkInBounds(
    manifest: WerkschauConeDatasetManifest,
    chunkKey: string,
  ): boolean {
    const coordinate = parseWerkschauConeChunkKey(chunkKey);
    return (
      coordinate.x >= manifest.bounds.minChunkX &&
      coordinate.x <= manifest.bounds.maxChunkX &&
      coordinate.z >= manifest.bounds.minChunkZ &&
      coordinate.z <= manifest.bounds.maxChunkZ
    );
  }

  private refreshDiagnostics(desiredChunkKeys: readonly string[]): void {
    const loadedDesiredChunkCount = desiredChunkKeys.reduce(
      (count, chunkKey) => count + (this.loadedChunks.has(chunkKey) ? 1 : 0),
      0,
    );

    this.diagnostics.loadedDesiredChunkCount = loadedDesiredChunkCount;
    this.diagnostics.activeChunkCount = this.activeChunkSnapshots.length;
    this.diagnostics.activeConeCount = this.activeCones.length;
    this.diagnostics.outOfBounds =
      this.diagnostics.manifestLoaded && this.diagnostics.inBoundsChunkCount === 0;
    this.diagnostics.emptyNearby =
      !this.diagnostics.outOfBounds &&
      this.diagnostics.errorCode === null &&
      this.diagnostics.inBoundsChunkCount > 0 &&
      loadedDesiredChunkCount === this.diagnostics.inBoundsChunkCount &&
      this.activeCones.length === 0;
  }

  private clearDiagnosticError(): void {
    this.diagnostics.errorCode = null;
    this.diagnostics.errorChunkKey = null;
    this.diagnostics.errorMessage = null;
  }

  private applyDiagnosticError(error: Error): void {
    const datasetError =
      error instanceof WerkschauConeDatasetLoadError ? error : null;
    this.diagnostics.errorCode = datasetError?.code ?? "load-error";
    this.diagnostics.errorChunkKey = datasetError?.chunkKey ?? null;
    this.diagnostics.errorMessage = error.message;
    if (
      datasetError?.code === "manifest-missing" ||
      datasetError?.code === "manifest-invalid"
    ) {
      this.diagnostics.manifestLoaded = false;
    }
  }
}

export function createEmptyWerkschauConeRuntimeDiagnostics(): WerkschauConeChunkRuntimeDiagnostics {
  return {
    playerChunkKey: null,
    desiredChunkCount: 0,
    inBoundsChunkCount: 0,
    loadedDesiredChunkCount: 0,
    activeChunkCount: 0,
    activeConeCount: 0,
    manifestLoaded: false,
    outOfBounds: false,
    emptyNearby: false,
    errorCode: null,
    errorChunkKey: null,
    errorMessage: null,
  };
}

function isConeChunkInsideExhibitionBounds(chunkKey: string): boolean {
  const coordinate = parseWerkschauConeChunkKey(chunkKey);
  const minX = coordinate.x * WERKSCHAU_CONE_CHUNK_SIZE_METERS;
  const minZ = coordinate.z * WERKSCHAU_CONE_CHUNK_SIZE_METERS;
  const maxX = minX + WERKSCHAU_CONE_CHUNK_SIZE_METERS;
  const maxZ = minZ + WERKSCHAU_CONE_CHUNK_SIZE_METERS;

  return (
    maxX >= WERKSCHAU_EXHIBITION_BOUNDS.minX &&
    minX <= WERKSCHAU_EXHIBITION_BOUNDS.maxX &&
    maxZ >= WERKSCHAU_EXHIBITION_BOUNDS.minZ &&
    minZ <= WERKSCHAU_EXHIBITION_BOUNDS.maxZ
  );
}

function isConeInsideExhibitionBounds(cone: WerkschauConeVolume): boolean {
  const minX = WERKSCHAU_EXHIBITION_BOUNDS.minX + cone.radius;
  const maxX = WERKSCHAU_EXHIBITION_BOUNDS.maxX - cone.radius;
  const minZ = WERKSCHAU_EXHIBITION_BOUNDS.minZ + cone.radius;
  const maxZ = WERKSCHAU_EXHIBITION_BOUNDS.maxZ - cone.radius;

  return (
    isPointInsideBounds(cone.tip.x, cone.tip.z, minX, maxX, minZ, maxZ) &&
    isPointInsideBounds(
      cone.baseCenter.x,
      cone.baseCenter.z,
      minX,
      maxX,
      minZ,
      maxZ,
    )
  );
}

function isPointInsideBounds(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

function createSnapshotSignature(
  chunks: readonly WerkschauConeChunkSnapshot[],
): string {
  return chunks
    .map((chunk) =>
      `${chunk.key}:${chunk.cones.map((cone) => cone.coneIndex).join(",")}`,
    )
    .join("|");
}
