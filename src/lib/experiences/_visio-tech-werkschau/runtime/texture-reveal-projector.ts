import * as THREE from "three";
import type { WerkschauConeVolume } from "../collision/types";
import { WERKSCHAU_TEXTURE_REVEAL_PROJECTOR } from "../constants";
import { setWerkschauTileMaterialProjectorReveal } from "./tiles-material";
import type { TilesRuntimeAdapter } from "./tiles-runtime";

const projectionBias = new THREE.Matrix4().set(
  0.5,
  0,
  0,
  0.5,
  0,
  0.5,
  0,
  0.5,
  0,
  0,
  0.5,
  0.5,
  0,
  0,
  0,
  1,
);
const localForward = new THREE.Vector3(0, 0, -1);
const scratchClearColor = new THREE.Color();
const scratchCameraPosition = new THREE.Vector3();
const scratchCameraDirection = new THREE.Vector3();
const scratchConeOffset = new THREE.Vector3();

interface ScoredCone {
  cone: WerkschauConeVolume;
  score: number;
}

export class WerkschauTextureRevealProjector {
  private readonly cameras = Array.from(
    { length: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS },
    () =>
      new THREE.PerspectiveCamera(
        45,
        1,
        WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.NEAR,
        WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.FAR,
      ),
  );
  private readonly projectionMatrices = Array.from(
    { length: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS },
    () => new THREE.Matrix4(),
  );
  private readonly renderTargets = Array.from(
    { length: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS },
    () =>
      new THREE.WebGLRenderTarget(
        WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_SIZE,
        WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_SIZE,
        {
          depthBuffer: true,
          format: THREE.RGBAFormat,
          magFilter: THREE.NearestFilter,
          minFilter: THREE.NearestFilter,
          stencilBuffer: false,
          type: THREE.UnsignedByteType,
        },
      ),
  );
  private activeCount = 0;

  constructor() {
    for (let index = 0; index < this.renderTargets.length; index += 1) {
      const renderTarget = this.renderTargets[index];
      renderTarget.texture.name = `werkschau-texture-reveal-projector-depth-${index}`;
      renderTarget.texture.generateMipmaps = false;
    }
    setWerkschauTileMaterialProjectorReveal({
      count: 0,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
    });
  }

  public update(
    cones: readonly WerkschauConeVolume[],
    observerCamera: THREE.Camera,
    tilesRuntime: TilesRuntimeAdapter | null,
    renderer: THREE.WebGLRenderer,
  ): void {
    if (!WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.ENABLED || !tilesRuntime) {
      this.disable();
      return;
    }

    const projectedCones = getProjectedCones(cones, observerCamera);
    if (projectedCones.length === 0) {
      this.disable();
      return;
    }

    this.activeCount = projectedCones.length;
    for (let index = 0; index < projectedCones.length; index += 1) {
      const camera = this.cameras[index];
      this.updateCamera(index, projectedCones[index]);
      tilesRuntime.renderTextureRevealDepth(
        renderer,
        camera,
        this.renderTargets[index],
      );
    }
    setWerkschauTileMaterialProjectorReveal({
      count: projectedCones.length,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
    });
  }

  public dispose(): void {
    this.disable();
    for (const renderTarget of this.renderTargets) {
      renderTarget.dispose();
    }
  }

  private disable(): void {
    if (this.activeCount === 0) return;

    this.activeCount = 0;
    setWerkschauTileMaterialProjectorReveal({
      count: 0,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
    });
  }

  private getDepthMaps(): readonly THREE.Texture[] {
    return this.renderTargets.map((target) => target.texture);
  }

  private updateCamera(index: number, cone: WerkschauConeVolume): void {
    const camera = this.cameras[index];
    camera.position.copy(cone.tip);
    camera.quaternion.setFromUnitVectors(localForward, cone.axisDirection);
    camera.near = WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.NEAR;
    camera.far = Math.max(
      cone.height,
      WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.NEAR + 1,
    );
    camera.fov =
      THREE.MathUtils.radToDeg(Math.atan2(cone.radius, cone.height)) * 2;
    camera.fov *= WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.FOV_MULTIPLIER;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projectionMatrices[index]
      .copy(projectionBias)
      .multiply(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse);
  }
}

export function renderDepthScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
): void {
  const previousRenderTarget = renderer.getRenderTarget();
  const previousXrEnabled = renderer.xr.enabled;
  const previousAutoClear = renderer.autoClear;
  const previousClearAlpha = renderer.getClearAlpha();
  renderer.getClearColor(scratchClearColor);

  renderer.xr.enabled = false;
  renderer.autoClear = true;
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousRenderTarget);
  renderer.setClearColor(scratchClearColor, previousClearAlpha);
  renderer.autoClear = previousAutoClear;
  renderer.xr.enabled = previousXrEnabled;
}

function getProjectedCones(
  cones: readonly WerkschauConeVolume[],
  observerCamera: THREE.Camera,
): readonly WerkschauConeVolume[] {
  if (cones.length === 0) return [];

  observerCamera.getWorldPosition(scratchCameraPosition);
  observerCamera.getWorldDirection(scratchCameraDirection);

  const visibleCones = getConesNearestViewRay(
    cones,
    scratchCameraPosition,
    scratchCameraDirection,
  );
  if (visibleCones.length > 0) return visibleCones;

  return getNearestCones(cones, scratchCameraPosition);
}

function getConesNearestViewRay(
  cones: readonly WerkschauConeVolume[],
  cameraPosition: THREE.Vector3,
  cameraDirection: THREE.Vector3,
): readonly WerkschauConeVolume[] {
  const scoredCones: ScoredCone[] = [];

  for (const cone of cones) {
    scratchConeOffset.subVectors(cone.tip, cameraPosition);
    const forwardDistance = scratchConeOffset.dot(cameraDirection);
    if (forwardDistance <= 0) continue;

    const distance = scratchConeOffset.lengthSq();
    const rayDistance = Math.max(distance - forwardDistance * forwardDistance, 0);
    const score = rayDistance + forwardDistance * forwardDistance * 0.02;
    scoredCones.push({ cone, score });
  }

  return scoredCones
    .sort((left, right) => left.score - right.score)
    .slice(0, WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS)
    .map((entry) => entry.cone);
}

function getNearestCones(
  cones: readonly WerkschauConeVolume[],
  position: THREE.Vector3,
): readonly WerkschauConeVolume[] {
  return cones
    .map((cone) => ({
      cone,
      score: cone.tip.distanceToSquared(position),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS)
    .map((entry) => entry.cone);
}
