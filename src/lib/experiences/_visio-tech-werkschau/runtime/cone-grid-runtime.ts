import * as THREE from "three";
import type {
  WerkschauConeChunkSnapshot,
  WerkschauConeVolume,
} from "../collision/types";
import type { WerkschauConeDatasetAssetLoader } from "../cone-data/asset-loader";
import {
  WerkschauConeChunkRuntimeStore,
  type WerkschauConeChunkRuntimeDiagnostics,
} from "../cone-data/runtime-store";
import { WERKSCHAU_CONE_RUNTIME_GRID } from "./cone-grid-config";
import {
  getWerkschauConeChunkCoordinate,
  getWerkschauConeChunkKey,
} from "./cone-grid-coordinates";
import { buildWerkschauConeSnapshotState } from "./cone-grid-snapshots";

const localDownAxis = new THREE.Vector3(0, -1, 0);
const scratchCenter = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const instanceDummy = new THREE.Object3D();

export interface WerkschauConeRuntimeDebugStats {
  activeChunkCount: number;
  activeCones: number;
  diagnostics: WerkschauConeChunkRuntimeDiagnostics;
  hasLoadError: boolean;
  loadedChunkCount: number;
  loading: boolean;
}

export class WerkschauConeGridRuntime {
  public readonly root = new THREE.Group();

  private readonly coneGeometry: THREE.ConeGeometry;
  private readonly coneMaterial: THREE.MeshBasicMaterial;
  private readonly chunkStore: WerkschauConeChunkRuntimeStore;
  private readonly queuedObserverPosition = new THREE.Vector3();
  private mesh: THREE.InstancedMesh | null = null;
  private activeConeChunksSnapshot: readonly WerkschauConeChunkSnapshot[] = [];
  private activeConeVolumes: readonly WerkschauConeVolume[] = [];
  private snapshotVersion = 0;
  private disposed = false;
  private loading = false;
  private loadError: Error | null = null;
  private hasQueuedObserverPosition = false;
  private lastRequestedChunkKey: string | null = null;
  private loadingChunkKey: string | null = null;
  private queuedChunkKey: string | null = null;

  constructor(assetLoader?: WerkschauConeDatasetAssetLoader) {
    this.root.name = "VisioTechWerkschauConeGridRoot";
    this.coneGeometry = new THREE.ConeGeometry(
      WERKSCHAU_CONE_RUNTIME_GRID.CONE_RADIUS,
      WERKSCHAU_CONE_RUNTIME_GRID.CONE_HEIGHT,
      16,
      1,
      true,
    );
    this.coneMaterial = new THREE.MeshBasicMaterial({
      color: WERKSCHAU_CONE_RUNTIME_GRID.COLOR,
      transparent: true,
      opacity: WERKSCHAU_CONE_RUNTIME_GRID.OPACITY,
      wireframe: true,
      depthWrite: false,
    });
    this.chunkStore = new WerkschauConeChunkRuntimeStore(assetLoader);
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (this.mesh) this.mesh.visible = visible;
  }

  public update(observerPosition: THREE.Vector3): void {
    if (this.disposed) return;

    const observerChunkKey = getWerkschauConeChunkKey(
      getWerkschauConeChunkCoordinate(observerPosition),
    );
    if (
      !this.loading &&
      this.loadError === null &&
      observerChunkKey === this.lastRequestedChunkKey &&
      this.isLoadedAroundCurrentChunk()
    ) {
      return;
    }

    if (this.loading) {
      if (observerChunkKey === this.loadingChunkKey) {
        this.hasQueuedObserverPosition = false;
        this.queuedChunkKey = null;
        return;
      }

      if (observerChunkKey === this.queuedChunkKey) return;

      this.queuedObserverPosition.copy(observerPosition);
      this.queuedChunkKey = observerChunkKey;
      this.hasQueuedObserverPosition = true;
      return;
    }

    this.loading = true;
    this.loadingChunkKey = observerChunkKey;
    void this.chunkStore
      .update(observerPosition.clone())
      .then(() => {
        if (this.disposed) return;

        this.loadError = null;
        this.syncFromChunkStore();
      })
      .catch((error: unknown) => {
        const nextError =
          error instanceof Error ? error : new Error(String(error));
        const shouldLog = this.loadError?.message !== nextError.message;
        this.loadError = nextError;
        if (shouldLog) {
          console.error(
            "[Werkschau] Failed to update precomputed cone chunks:",
            error,
          );
        }
      })
      .finally(() => {
        this.loading = false;
        this.lastRequestedChunkKey = this.loadingChunkKey;
        this.loadingChunkKey = null;
        if (this.disposed || !this.hasQueuedObserverPosition) return;

        this.hasQueuedObserverPosition = false;
        this.queuedChunkKey = null;
        this.update(this.queuedObserverPosition);
      });
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.mesh?.removeFromParent();
    this.mesh = null;
    this.activeConeChunksSnapshot = [];
    this.activeConeVolumes = [];
    this.snapshotVersion = 0;
    this.loadError = null;
    this.coneGeometry.dispose();
    this.coneMaterial.dispose();
    this.root.clear();
  }

  public getActiveCones(): readonly WerkschauConeVolume[] {
    return this.activeConeVolumes;
  }

  public getActiveConeChunks(): readonly WerkschauConeChunkSnapshot[] {
    return this.activeConeChunksSnapshot;
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion;
  }

  public getDebugStats(): WerkschauConeRuntimeDebugStats {
    return {
      activeChunkCount: this.activeConeChunksSnapshot.length,
      activeCones: this.activeConeVolumes.length,
      diagnostics: this.chunkStore.getDiagnostics(),
      hasLoadError: this.loadError !== null,
      loadedChunkCount: this.chunkStore.getLoadedChunkCount(),
      loading: this.loading,
    };
  }

  private syncFromChunkStore(): void {
    if (this.snapshotVersion === this.chunkStore.getSnapshotVersion()) return;

    const nextState = buildWerkschauConeSnapshotState(
      this.chunkStore.getActiveConeChunks(),
    );
    this.activeConeChunksSnapshot = nextState.chunkSnapshots;
    this.activeConeVolumes = nextState.coneVolumes
      .slice()
      .sort(compareConeVolumes);
    this.rebuildMesh();
    this.snapshotVersion = this.chunkStore.getSnapshotVersion();
  }

  private isLoadedAroundCurrentChunk(): boolean {
    const diagnostics = this.chunkStore.getDiagnostics();
    return (
      diagnostics.manifestLoaded &&
      diagnostics.errorCode === null &&
      diagnostics.loadedDesiredChunkCount >= diagnostics.inBoundsChunkCount
    );
  }

  private rebuildMesh(): void {
    this.mesh?.removeFromParent();
    this.mesh = null;

    if (this.activeConeVolumes.length === 0) return;

    const mesh = new THREE.InstancedMesh(
      this.coneGeometry,
      this.coneMaterial,
      this.activeConeVolumes.length,
    );
    mesh.name = "VisioTechWerkschauConeInstances";
    mesh.frustumCulled = false;

    for (let index = 0; index < this.activeConeVolumes.length; index += 1) {
      buildConeMatrix(this.activeConeVolumes[index], instanceDummy);
      mesh.setMatrixAt(index, instanceDummy.matrix);
    }

    mesh.count = this.activeConeVolumes.length;
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    this.root.add(mesh);
  }
}

function buildConeMatrix(
  cone: WerkschauConeVolume,
  target: THREE.Object3D,
): void {
  scratchCenter
    .copy(cone.tip)
    .addScaledVector(cone.axisDirection, cone.height * 0.5);
  scratchQuaternion.setFromUnitVectors(localDownAxis, cone.axisDirection);
  scratchScale.set(
    cone.radius / WERKSCHAU_CONE_RUNTIME_GRID.CONE_RADIUS,
    cone.height / WERKSCHAU_CONE_RUNTIME_GRID.CONE_HEIGHT,
    cone.radius / WERKSCHAU_CONE_RUNTIME_GRID.CONE_RADIUS,
  );

  target.position.copy(scratchCenter);
  target.quaternion.copy(scratchQuaternion);
  target.scale.copy(scratchScale);
  target.updateMatrix();
}

function compareConeVolumes(
  left: WerkschauConeVolume,
  right: WerkschauConeVolume,
): number {
  if (left.chunkKey !== right.chunkKey) {
    return left.chunkKey.localeCompare(right.chunkKey);
  }

  if (left.coneIndex !== right.coneIndex) return left.coneIndex - right.coneIndex;

  return left.placementPointId.localeCompare(right.placementPointId);
}
