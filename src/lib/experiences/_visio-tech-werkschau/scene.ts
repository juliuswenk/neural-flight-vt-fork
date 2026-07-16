import * as THREE from "three";
import { Scheduler } from "3d-tiles-renderer";
import { CAMERA } from "$lib/config/flight";
import { FlightPlayer } from "$lib/three/player";
import type { SetupContext, TickContext } from "../types";
import { WerkschauRadioManager } from "./audio/radio-manager";
import { WerkschauConeSpatialAudio } from "./audio/cone-spatial-audio";
import { WERKSCHAU_COLLISION } from "./collision/config";
import { WerkschauCollisionController } from "./collision/controller";
import { WerkschauDroneBoidSystem } from "./drones/boid-system";
import {
  WERKSCHAU_ALTITUDE_SPEED,
  WERKSCHAU_CAMERA_FAR,
  WERKSCHAU_EXHIBITION_BORDER_DAMPING,
  WERKSCHAU_EXHIBITION_BORDER_GRID,
  WERKSCHAU_EXHIBITION_BOUNDS,
  WERKSCHAU_FLIGHT_BASE_SPEED,
  WERKSCHAU_PLAYER_HEIGHT_LIMITS,
  WERKSCHAU_PLAYER_SPAWN_POSITION,
  WERKSCHAU_TILE_SELECTION_FOV,
} from "./constants";
import { createFuturisticSkydome } from "./futuristic-skydome";
import { createWerkschauOnboardingAudio } from "./onboarding/audio";
import { createWerkschauOnboardingController } from "./onboarding/controller";
import { disposeObjectTree } from "./runtime/cleanup";
import { WerkschauConeGridRuntime } from "./runtime/cone-grid-runtime";
import { WerkschauTextureRevealProjector } from "./runtime/texture-reveal-projector";
import { TilesRuntimeAdapter } from "./runtime/tiles-runtime";
import {
  isWerkschauTilesSourceConfigured,
  resolveWerkschauTilesSource,
} from "./runtime/tiles-source";
import type { WerkschauState } from "./types";

const scratchPosition = new THREE.Vector3();
const WERKSCHAU_SHUTDOWN_FADE_COLOR = 0x000000;
const WERKSCHAU_AR_CLEAR_COLOR = 0x79b8d9;
const WERKSCHAU_SKYBOX_RADIUS = WERKSCHAU_CAMERA_FAR * 0.85;
const WERKSCHAU_SHUTDOWN_RENDER_DISTANCE = 0.11;
const WERKSCHAU_TILE_SELECTION_YAWS = [
  0,
  Math.PI * 0.5,
  Math.PI,
  -Math.PI * 0.5,
] as const;
const WERKSCHAU_TILE_SELECTION_DOWN_PITCH = -Math.PI * 0.5;
const werkschauAudioResumeByContext = new WeakMap<AudioContext, Promise<void>>();

export async function setup(ctx: SetupContext): Promise<WerkschauState> {
  const sceneRoot = new THREE.Group();
  sceneRoot.name = "VisioTechWerkschauRoot";
  ctx.scene.add(sceneRoot);

  const tilesGroup = new THREE.Group();
  tilesGroup.name = "VisioTechWerkschauTilesRoot";
  sceneRoot.add(tilesGroup);

  const coneRuntime = new WerkschauConeGridRuntime();
  sceneRoot.add(coneRuntime.root);
  const collisionController = new WerkschauCollisionController();
  const textureRevealProjector = new WerkschauTextureRevealProjector();
  const droneBoids = new WerkschauDroneBoidSystem();
  sceneRoot.add(droneBoids.group);

  const player = new FlightPlayer({
    fov: CAMERA.FOV,
    near: CAMERA.NEAR,
    far: WERKSCHAU_CAMERA_FAR,
    spawnPosition: WERKSCHAU_PLAYER_SPAWN_POSITION,
    baseSpeed: WERKSCHAU_FLIGHT_BASE_SPEED,
    terrainSlowdown: 1,
  });
  sceneRoot.add(player.rig);
  const listener = new THREE.AudioListener();
  player.camera.add(listener);
  const radioManager = new WerkschauRadioManager(listener);
  radioManager.setMasterVolume(0);
  sceneRoot.add(radioManager.group);

  const gridHelper = new THREE.GridHelper(2000, 100);
  gridHelper.position.y = 0;
  sceneRoot.add(gridHelper);

  const borderGrid = createExhibitionBorderGrid();
  sceneRoot.add(borderGrid);

  const skybox = createFuturisticSkydome({ radius: WERKSCHAU_SKYBOX_RADIUS });
  skybox.name = "VisioTechWerkschauSkybox";
  sceneRoot.add(skybox);

  const fillLights = createFillLights();
  sceneRoot.add(fillLights.hemisphere);
  sceneRoot.add(fillLights.directional);

  let state: WerkschauState;
  let removeXrSelectAudioFallback: (() => void) | null = null;
  const onXrSessionStart = (): void => {
    resumeWerkschauAudioContext(state);
    removeXrSelectAudioFallback?.();
    removeXrSelectAudioFallback = attachXrSelectAudioFallback(
      state,
      ctx.renderer.xr.getSession(),
    );
  };
  const onXrSessionEnd = (): void => {
    removeXrSelectAudioFallback?.();
    removeXrSelectAudioFallback = null;
  };

  state = {
    sceneRoot,
    scene: ctx.scene,
    baseCameraFar: player.camera.far,
    tilesRuntime: null,
    tilesGroup,
    coneRuntime,
    collisionController,
    textureRevealProjector,
    coneDiagnosticElement: null,
    collisionDiagnosticElement: null,
    fallbackPlane: null,
    gridHelper,
    borderGrid,
    skybox,
    skyboxVisible: true,
    fillLights,
    renderer: ctx.renderer,
    camera: player.camera,
    listener,
    radioManager,
    coneSpatialAudio: null,
    droneBoids,
    tileSelectionCameras: createTileSelectionCameras(player.camera),
    player,
    onboarding: createWerkschauOnboardingController(player.camera),
    onboardingAudio: createWerkschauOnboardingAudio(),
    worldVisualsVisible: true,
    previewMode: ctx.previewMode ?? false,
    targetSpeed: WERKSCHAU_FLIGHT_BASE_SPEED,
    debugEnabled: false,
    isLoading: true,
    isDisposed: false,
    abortController: new AbortController(),
    removeAudioResumeListener: () => {
      ctx.renderer.xr.removeEventListener("sessionstart", onXrSessionStart);
      ctx.renderer.xr.removeEventListener("sessionend", onXrSessionEnd);
      removeXrSelectAudioFallback?.();
      removeXrSelectAudioFallback = null;
    },
  };
  ctx.renderer.xr.addEventListener("sessionstart", onXrSessionStart);
  ctx.renderer.xr.addEventListener("sessionend", onXrSessionEnd);
  if (ctx.previewMode) {
    state.onboarding.progress = 1;
    state.onboarding.isActive = false;
    state.onboarding.isComplete = true;
  }
  setWerkschauWorldVisualsVisible(state, false);
  setWerkschauSkyboxVisible(state, false);
  void loadTilesWhenConfigured(state);
  void loadConeSpatialAudio(state);

  return state;
}

export function tick(
  state: WerkschauState,
  ctx: TickContext,
): { state: WerkschauState } {
  if (state.isDisposed) return { state };

  const isXrPresenting = state.renderer.xr.isPresenting;
  if (isXrPresenting) {
    if (state.onboarding.isActive) {
      const session = state.renderer.xr.getSession();
      if (session) {
        let skipPressed = false;
        for (const source of session.inputSources) {
          const gamepad = source.gamepad;
          if (gamepad) {
            for (const button of gamepad.buttons) {
              if (button.pressed) {
                skipPressed = true;
                break;
              }
            }
          }
          if (skipPressed) break;
        }
        if (skipPressed) {
          state.onboarding.skip();
        }
      }
    }
    state.onboarding.update(ctx.delta);
  }

  const showVirtualWorld =
    !isXrPresenting ||
    (state.onboarding.isComplete && !state.onboarding.hasEnded);
  const virtualAlpha = !isXrPresenting
    ? 1
    : state.onboarding.hasEnded || hasWerkschauShutdownStarted(state)
      ? 0
      : state.onboarding.progress;
  state.renderer.setClearColor(WERKSCHAU_AR_CLEAR_COLOR, virtualAlpha);
  setWerkschauWorldVisualsVisible(state, showVirtualWorld);
  if (
    hasWerkschauShutdownStarted(state) &&
    !state.onboarding.hasEnded
  ) {
    state.skybox.visible = true;
    const fadeProgress = state.onboarding.shutdownProgress;
    state.renderer.setClearColor(
      WERKSCHAU_SHUTDOWN_FADE_COLOR,
      THREE.MathUtils.lerp(virtualAlpha, 1, fadeProgress),
    );
    if (state.skyboxVisible) {
      state.skyboxVisible = false;
    }
  } else {
    setWerkschauSkyboxVisible(
      state,
      showVirtualWorld && !state.onboarding.hasEnded,
    );
  }
  updateWerkschauShutdownRenderDistance(state);
  state.onboardingAudio.update(state.onboarding.isComplete, ctx.delta);
  state.radioManager.setMasterVolume(state.onboardingAudio.fullGain);
  updateWerkschauRadioAudio(state);
  state.coneSpatialAudio?.update(
    state.coneRuntime.getActiveCones(),
    state.player.rig.position,
  );

  state.player.baseSpeed =
    getAltitudeScaledSpeed(state.targetSpeed, state.player.rig.position.y) *
    getExhibitionBorderSpeedMultiplier(state.player.rig.position);
  state.player.setXRPresenting(isXrPresenting);
  if (state.onboarding.isComplete && !state.onboarding.hasEnded) {
    state.player.tick(ctx.delta);
    resetPlayerAtExhibitionBoundary(state);
  }
  state.player.rig.updateMatrixWorld(true);
  updateExhibitionBorderGridVisibility(state);
  state.coneRuntime.update(state.player.rig.position);
  state.droneBoids.update(ctx.delta);
  updateWerkschauConeDiagnostic(state);
  state.camera.getWorldPosition(state.skybox.position);
  if (state.skybox.material instanceof THREE.ShaderMaterial) {
    state.skybox.material.uniforms.uOrigin.value.copy(state.skybox.position);
  }
  if (state.tilesRuntime) {
    Scheduler.setXRSession(state.renderer.xr.getSession() as XRSession);
    syncTileSelectionCameras(state);
    state.tilesRuntime.update(state.tileSelectionCameras, state.renderer);
    state.textureRevealProjector.update(
      state.coneRuntime.getActiveCones(),
      state.camera,
      state.tilesRuntime,
      state.renderer,
      ctx.delta,
    );
    if (WERKSCHAU_COLLISION.ENABLED) {
      state.collisionController.update(
        state.coneRuntime.getActiveCones(),
        state.coneRuntime.getSnapshotVersion(),
        state.tilesRuntime.getTrackedTileMeshes(),
        state.tilesRuntime.getTrackedTileMeshVersion(),
      );
    }
    updateWerkschauCollisionDiagnostic(state);
  } else {
    state.textureRevealProjector.update([], state.camera, null, state.renderer, ctx.delta);
    removeWerkschauCollisionDiagnostic(state);
  }

  return { state };
}

export function dispose(state: WerkschauState, _scene: THREE.Scene): void {
  if (state.isDisposed) return;

  state.isDisposed = true;
  state.isLoading = false;
  state.abortController.abort();
  state.onboarding.dispose();
  state.onboardingAudio.dispose();
  state.removeAudioResumeListener();
  state.radioManager.dispose();
  state.coneSpatialAudio?.dispose();
  state.camera.remove(state.listener);
  state.tilesRuntime?.dispose();
  state.tilesRuntime = null;
  state.textureRevealProjector.dispose();
  state.coneRuntime.dispose();
  state.droneBoids.dispose();
  removeWerkschauConeDiagnostic(state);
  removeWerkschauCollisionDiagnostic(state);
  state.fillLights.hemisphere.removeFromParent();
  state.fillLights.directional.removeFromParent();
  state.sceneRoot.removeFromParent();
  disposeObjectTree(state.sceneRoot);
  state.sceneRoot.clear();
}

function updateWerkschauRadioAudio(state: WerkschauState): void {
  startWerkschauRadioIfAudioRunning(state);
}

function resumeWerkschauAudioContext(state: WerkschauState): void {
  const audioContext = state.listener.context;
  if (startWerkschauRadioIfAudioRunning(state)) return;

  if (
    audioContext.state === "running" ||
    werkschauAudioResumeByContext.has(audioContext)
  ) {
    return;
  }

  const resume = audioContext
    .resume()
    .catch((error: unknown) => {
      console.warn("[WerkschauRadio] AudioContext resume failed:", error);
    })
    .finally(() => {
      werkschauAudioResumeByContext.delete(audioContext);
    });
  werkschauAudioResumeByContext.set(audioContext, resume);
  void resume.then(() => {
    startWerkschauRadioIfAudioRunning(state);
  });
}

// Some WebXR browsers (notably Quest Browser) don't grant "sticky" user
// activation on the `sessionstart` event, so an AudioContext.resume() call
// made from that handler can silently fail to unlock audio in the headset.
// The session's native `select` event (controller trigger) always carries a
// real user gesture, so it's used as a guaranteed fallback to unlock audio.
function attachXrSelectAudioFallback(
  state: WerkschauState,
  session: XRSession | null,
): (() => void) | null {
  if (!session) return null;

  const onSelect = (): void => {
    resumeWerkschauAudioContext(state);
    if (state.radioManager.isStarted) session.removeEventListener("select", onSelect);
  };
  session.addEventListener("select", onSelect);
  return () => session.removeEventListener("select", onSelect);
}

function startWerkschauRadioIfAudioRunning(state: WerkschauState): boolean {
  if (
    state.isDisposed ||
    !state.onboarding.isComplete ||
    state.radioManager.isStarted ||
    state.listener.context.state !== "running"
  ) {
    return false;
  }

  state.radioManager.start();
  state.coneSpatialAudio?.start();
  return true;
}

function createFillLights(): {
  directional: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
} {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa0a0a0, 0.95);
  const directional = new THREE.DirectionalLight(0xffffff, 0.65);
  directional.position.set(-160, 90, -120);

  return { directional, hemisphere };
}

function createExhibitionBorderGrid(): THREE.LineSegments {
  const bounds = WERKSCHAU_EXHIBITION_BOUNDS;
  const height = WERKSCHAU_EXHIBITION_BORDER_GRID.HEIGHT;
  const step = WERKSCHAU_EXHIBITION_BORDER_GRID.STEP;
  const positions: number[] = [];

  for (let offset = 0; offset <= bounds.sideLengthMeters; offset += step) {
    const x = bounds.minX + offset;
    const z = bounds.minZ + offset;
    addLine(positions, bounds.minX, 0, z, bounds.minX, height, z);
    addLine(positions, bounds.maxX, 0, z, bounds.maxX, height, z);
    addLine(positions, x, 0, bounds.minZ, x, height, bounds.minZ);
    addLine(positions, x, 0, bounds.maxZ, x, height, bounds.maxZ);
  }

  for (let y = 0; y <= height; y += step) {
    addLine(positions, bounds.minX, y, bounds.minZ, bounds.minX, y, bounds.maxZ);
    addLine(positions, bounds.maxX, y, bounds.minZ, bounds.maxX, y, bounds.maxZ);
    addLine(positions, bounds.minX, y, bounds.minZ, bounds.maxX, y, bounds.minZ);
    addLine(positions, bounds.minX, y, bounds.maxZ, bounds.maxX, y, bounds.maxZ);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const material = new THREE.LineBasicMaterial({
    color: WERKSCHAU_EXHIBITION_BORDER_GRID.COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(geometry, material);
  grid.name = "VisioTechWerkschauExhibitionBorderGrid";
  grid.visible = false;
  return grid;
}

function addLine(
  positions: number[],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
): void {
  positions.push(x1, y1, z1, x2, y2, z2);
}

function updateExhibitionBorderGridVisibility(state: WerkschauState): void {
  const distance = getDistanceToExhibitionBorder(state.player.rig.position);
  const alpha = THREE.MathUtils.clamp(
    1 - distance / WERKSCHAU_EXHIBITION_BORDER_GRID.VISIBLE_DISTANCE,
    0,
    1,
  );
  state.borderGrid.visible = state.worldVisualsVisible && alpha > 0;

  if (state.borderGrid.material instanceof THREE.LineBasicMaterial) {
    state.borderGrid.material.opacity = alpha;
  }
}

function getExhibitionBorderSpeedMultiplier(position: THREE.Vector3): number {
  const distance = getDistanceToExhibitionBorder(position);
  const normalizedDistance = THREE.MathUtils.clamp(
    distance / WERKSCHAU_EXHIBITION_BORDER_DAMPING.DISTANCE,
    0,
    1,
  );

  return THREE.MathUtils.lerp(
    WERKSCHAU_EXHIBITION_BORDER_DAMPING.MIN_SPEED_MULTIPLIER,
    1,
    normalizedDistance,
  );
}

function getDistanceToExhibitionBorder(position: THREE.Vector3): number {
  return Math.max(
    0,
    Math.min(
      position.x - WERKSCHAU_EXHIBITION_BOUNDS.minX,
      WERKSCHAU_EXHIBITION_BOUNDS.maxX - position.x,
      position.z - WERKSCHAU_EXHIBITION_BOUNDS.minZ,
      WERKSCHAU_EXHIBITION_BOUNDS.maxZ - position.z,
    ),
  );
}

function resetPlayerAtExhibitionBoundary(state: WerkschauState): void {
  const position = state.player.rig.position;
  const isOutOfBounds =
    position.x < WERKSCHAU_EXHIBITION_BOUNDS.minX ||
    position.x > WERKSCHAU_EXHIBITION_BOUNDS.maxX ||
    position.z < WERKSCHAU_EXHIBITION_BOUNDS.minZ ||
    position.z > WERKSCHAU_EXHIBITION_BOUNDS.maxZ;

  if (isOutOfBounds) {
    position.set(
      WERKSCHAU_PLAYER_SPAWN_POSITION.x,
      WERKSCHAU_PLAYER_SPAWN_POSITION.y,
      WERKSCHAU_PLAYER_SPAWN_POSITION.z,
    );
  }

  position.y = THREE.MathUtils.clamp(
    position.y,
    WERKSCHAU_PLAYER_HEIGHT_LIMITS.MIN,
    WERKSCHAU_PLAYER_HEIGHT_LIMITS.MAX,
  );
}

function setWerkschauWorldVisualsVisible(
  state: WerkschauState,
  visible: boolean,
): void {
  if (state.worldVisualsVisible === visible) return;

  state.worldVisualsVisible = visible;
  state.tilesGroup.visible = visible;
  state.coneRuntime.setVisible(visible);
  state.droneBoids.group.visible = visible;
  if (state.fallbackPlane) state.fallbackPlane.visible = visible;
  state.gridHelper.visible = visible;
  updateExhibitionBorderGridVisibility(state);
  state.fillLights.hemisphere.visible = visible;
  state.fillLights.directional.visible = visible;
}

function setWerkschauSkyboxVisible(
  state: WerkschauState,
  visible: boolean,
): void {
  if (state.skyboxVisible === visible) return;

  state.skyboxVisible = visible;
  state.skybox.visible = visible;
}

function updateWerkschauShutdownRenderDistance(state: WerkschauState): void {
  const progress = hasWerkschauShutdownStarted(state)
    ? state.onboarding.shutdownProgress
    : 0;
  const far = THREE.MathUtils.lerp(
    state.baseCameraFar,
    WERKSCHAU_SHUTDOWN_RENDER_DISTANCE,
    progress,
  );
  if (state.camera.far === far) return;

  state.camera.far = far;
  state.camera.updateProjectionMatrix();
}

function hasWerkschauShutdownStarted(state: WerkschauState): boolean {
  return (
    state.onboarding.isShutdownEffectActive ||
    state.onboarding.shutdownProgress > 0 ||
    state.onboarding.hasEnded
  );
}

function getAltitudeScaledSpeed(baseSpeed: number, altitude: number): number {
  const altitudeRange =
    WERKSCHAU_ALTITUDE_SPEED.MAX_ALTITUDE -
    WERKSCHAU_ALTITUDE_SPEED.MIN_ALTITUDE;
  const normalizedAltitude = THREE.MathUtils.clamp(
    (altitude - WERKSCHAU_ALTITUDE_SPEED.MIN_ALTITUDE) / altitudeRange,
    0,
    1,
  );
  const multiplier = THREE.MathUtils.lerp(
    WERKSCHAU_ALTITUDE_SPEED.MIN_MULTIPLIER,
    WERKSCHAU_ALTITUDE_SPEED.MAX_MULTIPLIER,
    normalizedAltitude,
  );

  return baseSpeed * multiplier;
}

async function loadConeSpatialAudio(state: WerkschauState): Promise<void> {
  if (state.isDisposed) return;

  try {
    const spatialAudio = await WerkschauConeSpatialAudio.create(
      state.listener.context,
    );
    if (state.isDisposed) {
      spatialAudio.dispose();
      return;
    }
    state.coneSpatialAudio = spatialAudio;
  } catch (error) {
    if (state.isDisposed) return;
    console.warn("[Werkschau] Failed to load cone spatial audio:", error);
  }
}

async function loadTilesWhenConfigured(state: WerkschauState): Promise<void> {
  if (!isWerkschauTilesSourceConfigured()) {
    showFallbackPlane(state);
    state.isLoading = false;
    return;
  }

  try {
    const source = await resolveWerkschauTilesSource(
      state.abortController.signal,
    );
    const runtime = await TilesRuntimeAdapter.create(
      state.tilesGroup,
      source,
      state.abortController.signal,
    );
    if (state.isDisposed || state.abortController.signal.aborted) {
      runtime.dispose();
      return;
    }

    removeFallbackPlane(state);
    state.tilesRuntime = runtime;
    state.isLoading = false;
  } catch (error) {
    if (state.isDisposed || state.abortController.signal.aborted) return;

    console.error("[Werkschau] Failed to load tileset:", error);
    showFallbackPlane(state);
    state.isLoading = false;
  }
}

function syncTileSelectionCameras(state: WerkschauState): void {
  scratchPosition.copy(state.player.rig.position);
  for (const camera of state.tileSelectionCameras) {
    syncTileSelectionCamera(camera, scratchPosition, state);
  }
}

function syncTileSelectionCamera(
  camera: THREE.PerspectiveCamera,
  position: THREE.Vector3,
  state: WerkschauState,
): void {
  camera.position.copy(position);

  const nextAspect = state.camera.aspect || 1;
  if (
    camera.near !== state.camera.near ||
    camera.far !== state.camera.far ||
    camera.aspect !== nextAspect
  ) {
    camera.near = state.camera.near;
    camera.far = state.camera.far;
    camera.aspect = nextAspect;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld(true);
}

function createTileSelectionCameras(
  camera: THREE.PerspectiveCamera,
): WerkschauState["tileSelectionCameras"] {
  return [
    createTileSelectionCamera(camera, WERKSCHAU_TILE_SELECTION_YAWS[0]),
    createTileSelectionCamera(camera, WERKSCHAU_TILE_SELECTION_YAWS[1]),
    createTileSelectionCamera(camera, WERKSCHAU_TILE_SELECTION_YAWS[2]),
    createTileSelectionCamera(camera, WERKSCHAU_TILE_SELECTION_YAWS[3]),
    createTileSelectionCamera(camera, 0, WERKSCHAU_TILE_SELECTION_DOWN_PITCH),
  ];
}

function createTileSelectionCamera(
  camera: THREE.PerspectiveCamera,
  yaw: number,
  pitch = 0,
): THREE.PerspectiveCamera {
  const selectionCamera = new THREE.PerspectiveCamera(
    WERKSCHAU_TILE_SELECTION_FOV,
    camera.aspect || 1,
    camera.near,
    camera.far,
  );
  selectionCamera.rotation.set(pitch, yaw, 0, "YXZ");
  selectionCamera.updateProjectionMatrix();
  selectionCamera.updateMatrixWorld(true);
  return selectionCamera;
}

function showFallbackPlane(state: WerkschauState): void {
  if (state.fallbackPlane) return;

  const geometry = new THREE.PlaneGeometry(
    WERKSCHAU_EXHIBITION_BOUNDS.sideLengthMeters,
    WERKSCHAU_EXHIBITION_BOUNDS.sideLengthMeters,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0xb8c0c2,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = "VisioTechWerkschauCesiumFallbackPlane";
  plane.rotation.x = -Math.PI * 0.5;
  plane.visible = state.worldVisualsVisible;
  plane.position.set(
    WERKSCHAU_EXHIBITION_BOUNDS.center.x,
    0,
    WERKSCHAU_EXHIBITION_BOUNDS.center.z,
  );
  state.fallbackPlane = plane;
  state.tilesGroup.add(plane);
}

function removeFallbackPlane(state: WerkschauState): void {
  const plane = state.fallbackPlane;
  if (!plane) return;

  plane.removeFromParent();
  plane.geometry.dispose();
  if (plane.material instanceof THREE.Material) {
    plane.material.dispose();
  }
  state.fallbackPlane = null;
}

function updateWerkschauConeDiagnostic(state: WerkschauState): void {
  const stats = state.coneRuntime.getDebugStats();
  const diagnostics = stats.diagnostics;
  const message = diagnostics.errorCode
    ? `cone data: ${diagnostics.errorCode}${diagnostics.errorChunkKey ? ` ${diagnostics.errorChunkKey}` : ""}`
    : diagnostics.outOfBounds
      ? "cone data: player outside dataset"
      : diagnostics.emptyNearby
        ? "cone data: no nearby cones"
        : null;

  if (!message || typeof document === "undefined") {
    removeWerkschauConeDiagnostic(state);
    return;
  }

  if (!state.coneDiagnosticElement) {
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.left = "12px";
    element.style.bottom = "12px";
    element.style.zIndex = "1000";
    element.style.padding = "6px 8px";
    element.style.border = "1px solid rgba(255,255,255,0.45)";
    element.style.background = "rgba(0,0,0,0.68)";
    element.style.color = "#ffd6f5";
    element.style.font = "12px/1.3 monospace";
    element.style.pointerEvents = "none";
    document.body.append(element);
    state.coneDiagnosticElement = element;
  }

  state.coneDiagnosticElement.textContent =
    `${message}; chunks ${diagnostics.loadedDesiredChunkCount}/${diagnostics.inBoundsChunkCount}; cones ${diagnostics.activeConeCount}`;
}

function removeWerkschauConeDiagnostic(state: WerkschauState): void {
  state.coneDiagnosticElement?.remove();
  state.coneDiagnosticElement = null;
}

function updateWerkschauCollisionDiagnostic(state: WerkschauState): void {
  if (typeof document === "undefined") return;

  if (!state.collisionDiagnosticElement) {
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.left = "12px";
    element.style.bottom = state.coneDiagnosticElement ? "48px" : "12px";
    element.style.zIndex = "1000";
    element.style.padding = "6px 8px";
    element.style.border = "1px solid rgba(255,255,255,0.45)";
    element.style.background = "rgba(0,0,0,0.68)";
    element.style.color = "#d7f8ff";
    element.style.font = "12px/1.3 monospace";
    element.style.pointerEvents = "none";
    document.body.append(element);
    state.collisionDiagnosticElement = element;
  }

  state.collisionDiagnosticElement.style.bottom = state.coneDiagnosticElement
    ? "48px"
    : "12px";

  if (!WERKSCHAU_COLLISION.ENABLED) {
    state.collisionDiagnosticElement.textContent = "collision: disabled";
    return;
  }

  const stats = {
    activeCones: 0,
    trackedMeshes: 0,
    dirtyMeshes: 0,
    processedMeshesLastTick: 0,
    prebakedMeshes: 0,
    verticesTestedLastTick: 0,
  };
  state.collisionController.writeDebugStats(stats);
  state.collisionDiagnosticElement.textContent =
    `collision: tracked ${stats.trackedMeshes}; prebaked ${stats.prebakedMeshes}; processed ${stats.processedMeshesLastTick}; vertices ${stats.verticesTestedLastTick}; dirty ${stats.dirtyMeshes}`;
}

function removeWerkschauCollisionDiagnostic(state: WerkschauState): void {
  state.collisionDiagnosticElement?.remove();
  state.collisionDiagnosticElement = null;
}
