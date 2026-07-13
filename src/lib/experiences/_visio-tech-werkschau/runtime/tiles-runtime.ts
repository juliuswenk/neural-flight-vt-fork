import { TilesRenderer } from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";
import * as THREE from "three";
import type { Camera, Group, WebGLRenderer } from "three";
import { WERKSCHAU_TILE_RUNTIME } from "../constants";
import { WERKSCHAU_BERLIN_MITTE_ORIGIN } from "../geo/berlin-mitte-origin";
import { getECEFToLocalMatrix } from "../geo/coordinates";
import {
  createWerkschauNeutralTileMaterial,
  disposeClonedMaterial,
  disposeMaterial,
} from "./tiles-material";
import type { WerkschauTilesSource } from "./tiles-source";

export interface TilesRuntimeDebugStats {
  hasRenderer: boolean;
  isDisposed: boolean;
  isVisible: boolean;
  loadProgress: number;
  visibleTiles: number;
  activeTiles: number;
  trackedMeshes: number;
}

interface RegisteredTileMesh {
  mesh: THREE.Mesh;
  neutralMaterial: THREE.Material | THREE.Material[];
  originalMaterial: THREE.Material | THREE.Material[];
}

type TileLoadEvent = {
  scene: THREE.Object3D;
  tile: unknown;
  type: "load-model";
  url: string;
};

type TileDisposeEvent = {
  scene: THREE.Object3D;
  tile: unknown;
  type: "dispose-model";
};

export class TilesRuntimeAdapter {
  private renderer: TilesRenderer | null = null;
  private activeCameras: Camera[] = [];
  private readonly trackedByScene = new Map<
    THREE.Object3D,
    RegisteredTileMesh[]
  >();
  private readonly trackedMeshes = new Set<THREE.Mesh>();
  private readonly resolution = new THREE.Vector2();
  private readonly url: string;
  private readonly token: string;
  private disposed = false;

  private constructor(source: WerkschauTilesSource) {
    this.url = source.url;
    this.token = source.token;
  }

  public static async create(
    group: Group,
    source: WerkschauTilesSource,
    signal?: AbortSignal,
  ): Promise<TilesRuntimeAdapter> {
    const runtime = new TilesRuntimeAdapter(source);
    const renderer = await runtime.initializeTiles(group, signal);
    const localMatrix = getECEFToLocalMatrix(WERKSCHAU_BERLIN_MITTE_ORIGIN);
    renderer.group.matrixAutoUpdate = false;
    renderer.group.matrix.copy(localMatrix);
    renderer.group.updateMatrixWorld(true);
    return runtime;
  }

  private async initializeTiles(
    group: Group,
    signal?: AbortSignal,
  ): Promise<TilesRenderer> {
    this.assertCanLoad(signal);

    let renderer: TilesRenderer | null = null;

    try {
      renderer = new TilesRenderer(this.url);
      this.configureRenderer(renderer);
      this.renderer = renderer;
      group.add(renderer.group);
      return renderer;
    } catch (error) {
      if (renderer) {
        renderer.removeEventListener("load-model", this.handleLoadModel);
        renderer.removeEventListener("dispose-model", this.handleDisposeModel);
        renderer.dispose();
      }

      this.activeCameras = [];
      this.trackedByScene.clear();
      this.trackedMeshes.clear();
      this.renderer = null;
      throw error;
    }
  }

  private assertCanLoad(signal?: AbortSignal): void {
    if (this.disposed) {
      throw new Error("[Werkschau] Cannot load tiles after disposal.");
    }

    if (signal?.aborted === true) {
      throw new Error("[Werkschau] Tile loading was cancelled.");
    }
  }

  private configureRenderer(renderer: TilesRenderer): void {
    const isGoogleTiles = this.registerGoogleTilesPlugin(renderer);

    if (this.token && !isGoogleTiles) {
      renderer.fetchOptions.headers = {
        Authorization: `Bearer ${this.token}`,
      };
    }

    renderer.errorTarget = WERKSCHAU_TILE_RUNTIME.ERROR_TARGET;
    renderer.loadSiblings = WERKSCHAU_TILE_RUNTIME.LOAD_SIBLINGS;
    renderer.downloadQueue.maxJobs = WERKSCHAU_TILE_RUNTIME.DOWNLOAD_JOBS;
    renderer.parseQueue.maxJobs = WERKSCHAU_TILE_RUNTIME.PARSE_JOBS;
    renderer.processNodeQueue.maxJobs =
      WERKSCHAU_TILE_RUNTIME.PROCESS_NODE_JOBS;
    renderer.maxTilesProcessed = WERKSCHAU_TILE_RUNTIME.MAX_TILES_PROCESSED;
    renderer.lruCache.minBytesSize = WERKSCHAU_TILE_RUNTIME.CACHE_MIN_BYTES;
    renderer.lruCache.maxBytesSize = WERKSCHAU_TILE_RUNTIME.CACHE_MAX_BYTES;
    renderer.addEventListener("load-model", this.handleLoadModel);
    renderer.addEventListener("dispose-model", this.handleDisposeModel);
  }

  private registerGoogleTilesPlugin(renderer: TilesRenderer): boolean {
    if (!this.url.includes("tile.googleapis.com")) {
      return false;
    }

    const apiKey = new URL(this.url).searchParams.get("key");
    if (apiKey) {
      renderer.registerPlugin(
        new GoogleCloudAuthPlugin({
          apiToken: apiKey,
          autoRefreshToken: true,
        }),
      );
    }

    return true;
  }

  private readonly handleLoadModel = (event: TileLoadEvent): void => {
    if (this.trackedByScene.has(event.scene)) return;

    const meshes: RegisteredTileMesh[] = [];
    event.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.trackedMeshes.add(child);
        const originalMaterial = child.material;
        const neutralMaterial =
          createWerkschauNeutralTileMaterial(originalMaterial);
        child.material = neutralMaterial;
        meshes.push({ mesh: child, neutralMaterial, originalMaterial });
      }
    });
    this.trackedByScene.set(event.scene, meshes);
  };

  private readonly handleDisposeModel = (event: TileDisposeEvent): void => {
    const meshes = this.trackedByScene.get(event.scene);
    if (!meshes) return;

    const disposedMaterials = new WeakSet<THREE.Material>();

    for (const registeredMesh of meshes) {
      this.trackedMeshes.delete(registeredMesh.mesh);
      disposeClonedMaterial(registeredMesh.neutralMaterial, disposedMaterials);
      disposeMaterial(registeredMesh.originalMaterial, disposedMaterials);
    }
    this.trackedByScene.delete(event.scene);
  };

  public update(
    cameras: readonly Camera[],
    webglRenderer: WebGLRenderer,
  ): void {
    const renderer = this.getRenderer();
    if (!renderer) return;

    renderer.group.updateMatrixWorld(true);
    this.syncCameras(renderer, cameras, webglRenderer);
    renderer.update();
  }

  private syncCameras(
    renderer: TilesRenderer,
    cameras: readonly Camera[],
    webglRenderer: WebGLRenderer,
  ): void {
    const nextCameras = cameras.filter(
      (camera, index) => cameras.indexOf(camera) === index,
    );

    for (const camera of this.activeCameras) {
      if (!nextCameras.includes(camera)) {
        renderer.deleteCamera(camera);
      }
    }

    for (const camera of nextCameras) {
      camera.updateMatrixWorld(true);
      if (!renderer.hasCamera(camera)) {
        renderer.setCamera(camera);
      }
    }

    webglRenderer.getSize(this.resolution);
    for (const camera of nextCameras) {
      renderer.setResolution(camera, this.resolution);
    }

    this.activeCameras = [...nextCameras];
  }

  public getDebugStats(): TilesRuntimeDebugStats {
    const renderer = this.renderer;

    if (!renderer) {
      return {
        hasRenderer: false,
        isDisposed: this.disposed,
        isVisible: false,
        loadProgress: 0,
        visibleTiles: 0,
        activeTiles: 0,
        trackedMeshes: this.trackedMeshes.size,
      };
    }

    return {
      hasRenderer: true,
      isDisposed: this.disposed,
      isVisible: renderer.group.visible,
      loadProgress: renderer.loadProgress,
      visibleTiles: renderer.visibleTiles.size,
      activeTiles: renderer.activeTiles.size,
      trackedMeshes: this.trackedMeshes.size,
    };
  }

  private getRenderer(): TilesRenderer | null {
    if (this.disposed) return null;
    return this.renderer;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    if (!this.renderer) {
      this.activeCameras = [];
      this.trackedByScene.clear();
      this.trackedMeshes.clear();
      return;
    }

    for (const camera of this.activeCameras) {
      this.renderer.deleteCamera(camera);
    }

    this.renderer.group.removeFromParent();
    this.renderer.removeEventListener("load-model", this.handleLoadModel);
    this.renderer.removeEventListener("dispose-model", this.handleDisposeModel);
    this.renderer.dispose();
    this.renderer = null;
    this.activeCameras = [];
    this.trackedByScene.clear();
    this.trackedMeshes.clear();
  }
}
