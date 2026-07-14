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

interface ScoredCone {
  cone: WerkschauConeVolume;
  score: number;
}

interface ActiveProjector {
  cone: WerkschauConeVolume;
  strength: number;
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
  private activeProjectors: readonly ActiveProjector[] = [];

  constructor() {
    for (let index = 0; index < this.renderTargets.length; index += 1) {
      const renderTarget = this.renderTargets[index];
      renderTarget.texture.name = `werkschau-texture-reveal-projector-depth-${index}`;
      renderTarget.texture.generateMipmaps = false;
    }
    setWerkschauTileMaterialProjectorReveal({
      cones: [],
      count: 0,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
      strengths: [],
    });
  }

  public update(
    cones: readonly WerkschauConeVolume[],
    observerCamera: THREE.Camera,
    tilesRuntime: TilesRuntimeAdapter | null,
    renderer: THREE.WebGLRenderer,
    deltaSeconds: number,
  ): void {
    if (!WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.ENABLED || !tilesRuntime) {
      this.disable();
      return;
    }

    const selectedCones = this.selectProjectorCones(cones, observerCamera);
    const projectors = this.updateProjectorDecay(selectedCones, deltaSeconds);
    if (projectors.length === 0) {
      this.disable();
      return;
    }

    this.activeCount = projectors.length;
    this.activeProjectors = projectors;

    // Depth passes render with a mono projector camera, which requires briefly
    // disabling renderer.xr so WebGLRenderer doesn't substitute the stereo
    // ArrayCamera (see WebGLRenderer.render / xr.getCamera). Flipping that flag
    // once per projector, up to MAX_PROJECTORS times per frame, immediately
    // ahead of the real stereo render call was found to correlate with tiles
    // dropping out of the right eye only on some WebXR runtimes, so the whole
    // batch is now wrapped in a single enable/disable pair instead.
    const previousXrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    for (let index = 0; index < projectors.length; index += 1) {
      const camera = this.cameras[index];
      this.updateCamera(index, projectors[index].cone);
      tilesRuntime.renderTextureRevealDepth(
        renderer,
        camera,
        this.renderTargets[index],
      );
    }
    renderer.xr.enabled = previousXrEnabled;
    setWerkschauTileMaterialProjectorReveal({
      cones: projectors.map((projector) => projector.cone),
      count: projectors.length,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
      strengths: projectors.map((projector) => projector.strength),
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
    this.activeProjectors = [];
    setWerkschauTileMaterialProjectorReveal({
      cones: [],
      count: 0,
      depthBias: WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DEPTH_BIAS,
      depthMaps: this.getDepthMaps(),
      projectionMatrices: this.projectionMatrices,
      strengths: [],
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

  private selectProjectorCones(
    cones: readonly WerkschauConeVolume[],
    observerCamera: THREE.Camera,
  ): readonly WerkschauConeVolume[] {
    if (cones.length === 0) return [];

    observerCamera.getWorldPosition(scratchCameraPosition);
    const scoredCones = getNearestConeScores(cones, scratchCameraPosition);
    if (scoredCones.length === 0) return [];

    const selected: WerkschauConeVolume[] = [];
    const bestScore = Math.max(scoredCones[0]?.score ?? 0, 1);

    for (const projector of this.activeProjectors) {
      const cone = projector.cone;
      const score = getScoredConeScore(scoredCones, cone);
      if (score === null) continue;
      if (
        score >
        bestScore * WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.KEEP_SCORE_MULTIPLIER
      ) {
        continue;
      }
      selected.push(cone);
      if (selected.length >= WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS) {
        return selected;
      }
    }

    for (const entry of scoredCones) {
      if (selected.some((cone) => isSameCone(cone, entry.cone))) continue;
      selected.push(entry.cone);
      if (selected.length >= WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS) {
        return selected;
      }
    }

    return selected;
  }

  private updateProjectorDecay(
    selectedCones: readonly WerkschauConeVolume[],
    deltaSeconds: number,
  ): readonly ActiveProjector[] {
    const decayStep =
      deltaSeconds / WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.DECAY_SECONDS;
    const fadingProjectors: ActiveProjector[] = [];
    for (const projector of this.activeProjectors) {
      if (selectedCones.some((cone) => isSameCone(cone, projector.cone))) continue;

      const strength = Math.max(0, projector.strength - decayStep);
      if (strength <= 0) continue;
      fadingProjectors.push({
        cone: projector.cone,
        strength,
      });
    }

    const maxSelected =
      fadingProjectors.length > 0
        ? WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS - 1
        : WERKSCHAU_TEXTURE_REVEAL_PROJECTOR.MAX_PROJECTORS;
    const nextProjectors: ActiveProjector[] = selectedCones
      .slice(0, maxSelected)
      .map((cone) => ({
        cone,
        strength: 1,
      }));

    if (fadingProjectors.length > 0) {
      nextProjectors.push(
        fadingProjectors.sort((left, right) => right.strength - left.strength)[0],
      );
    }

    return nextProjectors;
  }
}

// Callers are responsible for disabling renderer.xr.enabled around (potentially
// several) calls to this function — see WerkschauTextureRevealProjector.update.
export function renderDepthScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
): void {
  const previousRenderTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousClearAlpha = renderer.getClearAlpha();
  renderer.getClearColor(scratchClearColor);

  renderer.autoClear = true;
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousRenderTarget);
  renderer.setClearColor(scratchClearColor, previousClearAlpha);
  renderer.autoClear = previousAutoClear;
}

function getNearestConeScores(
  cones: readonly WerkschauConeVolume[],
  position: THREE.Vector3,
): readonly ScoredCone[] {
  return cones
    .map((cone) => ({
      cone,
      score: cone.tip.distanceToSquared(position),
    }))
    .sort((left, right) => left.score - right.score);
}

function getScoredConeScore(
  scoredCones: readonly ScoredCone[],
  cone: WerkschauConeVolume,
): number | null {
  for (const entry of scoredCones) {
    if (isSameCone(entry.cone, cone)) return entry.score;
  }

  return null;
}

function isSameCone(left: WerkschauConeVolume, right: WerkschauConeVolume): boolean {
  return left.chunkKey === right.chunkKey && left.coneIndex === right.coneIndex;
}
