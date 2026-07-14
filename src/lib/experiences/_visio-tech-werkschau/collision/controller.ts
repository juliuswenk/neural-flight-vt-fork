import { WERKSCHAU_COLLISION } from "./config";
import { collectOverlappingConesForMesh } from "./cone-query";
import {
  setWerkschauTileMaterialFragmentCones,
  syncWerkschauTileMaterialSourceMaps,
} from "../runtime/tiles-material";
import type { WerkschauConeVolume } from "./types";
import type { TrackedTileMesh } from "./tile-mesh-types";
import { writeConeMaskAttributeForMesh } from "./vertex-color-writer";
import { updateVertexMask } from "./vertex-mask";

export interface WerkschauCollisionDebugStats {
  activeCones: number;
  trackedMeshes: number;
  dirtyMeshes: number;
  processedMeshesLastTick: number;
  prebakedMeshes: number;
  verticesTestedLastTick: number;
}

export class WerkschauCollisionController {
  private readonly dirtyMeshes = new Set<TrackedTileMesh>();
  private readonly trackedMeshes = new Set<TrackedTileMesh>();
  private dirtyQueue: TrackedTileMesh[] = [];
  private lastConeVersion = -1;
  private lastMeshVersion = -1;
  private activeCones = 0;
  private trackedMeshCount = 0;
  private prebakedMeshCount = 0;
  private processedMeshesLastTick = 0;
  private verticesTestedLastTick = 0;

  public update(
    cones: readonly WerkschauConeVolume[],
    coneVersion: number,
    meshes: readonly TrackedTileMesh[],
    meshVersion: number,
  ): void {
    this.activeCones = cones.length;
    if (this.lastConeVersion !== coneVersion) {
      this.lastConeVersion = coneVersion;
      this.markMeshesDirty(Array.from(this.trackedMeshes));
    }

    this.syncTrackedMeshes(cones, meshes, meshVersion);
    this.processDirtyMeshes(cones);
  }

  public writeDebugStats(target: WerkschauCollisionDebugStats): void {
    target.activeCones = this.activeCones;
    target.trackedMeshes = this.trackedMeshCount;
    target.dirtyMeshes = this.dirtyQueue.length;
    target.processedMeshesLastTick = this.processedMeshesLastTick;
    target.prebakedMeshes = this.prebakedMeshCount;
    target.verticesTestedLastTick = this.verticesTestedLastTick;
  }

  private syncTrackedMeshes(
    cones: readonly WerkschauConeVolume[],
    meshes: readonly TrackedTileMesh[],
    meshVersion: number,
  ): void {
    this.trackedMeshCount = meshes.length;
    this.prebakedMeshCount = countPrebakedMeshes(meshes);
    if (this.lastMeshVersion === meshVersion) return;

    this.lastMeshVersion = meshVersion;
    const nextTrackedMeshes = new Set(meshes);

    const previousTrackedMeshes = new Set(this.trackedMeshes);
    this.trackedMeshes.clear();
    for (const mesh of meshes) {
      const isNewMesh = !previousTrackedMeshes.has(mesh);
      this.trackedMeshes.add(mesh);
      if (isNewMesh) {
        this.processMesh(cones, mesh);
      }
    }

    this.dirtyQueue = this.dirtyQueue.filter((mesh) => nextTrackedMeshes.has(mesh));
    for (const mesh of Array.from(this.dirtyMeshes)) {
      if (nextTrackedMeshes.has(mesh)) continue;
      this.dirtyMeshes.delete(mesh);
    }
  }

  private markMeshesDirty(meshes: readonly TrackedTileMesh[]): void {
    for (const mesh of meshes) {
      this.enqueueDirtyMesh(mesh);
    }
  }

  private enqueueDirtyMesh(mesh: TrackedTileMesh): void {
    if (!this.trackedMeshes.has(mesh) && this.lastMeshVersion !== -1) return;
    if (this.dirtyMeshes.has(mesh)) return;

    this.dirtyMeshes.add(mesh);
    this.dirtyQueue.push(mesh);
  }

  private processDirtyMeshes(cones: readonly WerkschauConeVolume[]): void {
    this.processedMeshesLastTick = 0;
    this.verticesTestedLastTick = 0;

    const meshBudget = WERKSCHAU_COLLISION.MAX_MESHES_PER_TICK;

    while (
      this.processedMeshesLastTick < meshBudget &&
      this.dirtyQueue.length > 0
    ) {
      const mesh = this.dirtyQueue.shift();
      if (!mesh) break;
      if (!this.dirtyMeshes.has(mesh)) continue;
      if (hasResolvedPrebakedConeIntersection(mesh)) {
        this.dirtyMeshes.delete(mesh);
        continue;
      }
      if (!this.trackedMeshes.has(mesh)) {
        this.dirtyMeshes.delete(mesh);
        continue;
      }

      if (this.processMesh(cones, mesh)) {
        this.verticesTestedLastTick += mesh.vertexCount;
      }
      this.processedMeshesLastTick += 1;
      this.dirtyMeshes.delete(mesh);
    }
  }

  private processMesh(
    cones: readonly WerkschauConeVolume[],
    mesh: TrackedTileMesh,
  ): boolean {
    if (hasResolvedPrebakedConeIntersection(mesh)) return false;

    const overlappingCones = collectOverlappingConesForMesh(cones, mesh);
    if (overlappingCones.length === 0) {
      if (!mesh.hasPrebakedConeMask) {
        updateVertexMask(mesh, overlappingCones);
        writeConeMaskAttributeForMesh(mesh);
      }
      setWerkschauTileMaterialFragmentCones(mesh.collisionMaterial, []);
      if (mesh.hasConeMaskMaterial) {
        mesh.mesh.material = mesh.neutralMaterial;
        mesh.hasConeMaskMaterial = false;
      }
      return !mesh.hasPrebakedConeMask;
    }

    const fragmentCones = getNearestFragmentCones(mesh, overlappingCones);
    if (!mesh.hasPrebakedConeMask) {
      updateVertexMask(mesh, overlappingCones);
      writeConeMaskAttributeForMesh(mesh);
    }
    syncWerkschauTileMaterialSourceMaps(
      mesh.originalMaterial,
      mesh.collisionMaterial,
    );
    setWerkschauTileMaterialFragmentCones(mesh.collisionMaterial, fragmentCones);
    if (!mesh.hasConeMaskMaterial) {
      mesh.mesh.material = mesh.collisionMaterial;
      mesh.hasConeMaskMaterial = true;
    }
    return !mesh.hasPrebakedConeMask;
  }
}

function hasResolvedPrebakedConeIntersection(mesh: TrackedTileMesh): boolean {
  return mesh.hasPrebakedConeMask && mesh.prebakedConeIntersection !== null;
}

function countPrebakedMeshes(meshes: readonly TrackedTileMesh[]): number {
  let count = 0;
  for (const mesh of meshes) {
    if (mesh.hasPrebakedConeMask) count += 1;
  }
  return count;
}

function getNearestFragmentCones(
  mesh: TrackedTileMesh,
  cones: readonly WerkschauConeVolume[],
): readonly WerkschauConeVolume[] {
  if (cones.length <= WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES) return cones;

  return cones
    .slice()
    .sort(
      (left, right) =>
        getConeDistanceToMeshSphere(left, mesh) -
        getConeDistanceToMeshSphere(right, mesh),
    )
    .slice(0, WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES);
}

function getConeDistanceToMeshSphere(
  cone: WerkschauConeVolume,
  mesh: TrackedTileMesh,
): number {
  return mesh.worldSphere.center.distanceToSquared(cone.tip);
}
