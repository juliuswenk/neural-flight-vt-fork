import * as THREE from "three";
import { Scheduler } from "3d-tiles-renderer";
import type { SetupContext, TickContext } from "../types";
import type { BerlinState } from "./types";
import { setBerlinDebugEnabled } from "./debug/controller";
import {
  BERLIN_DEBUG_FPS_COUNTER_DEFAULT,
  BERLIN_DEBUG_OVERLAY_DEFAULT,
} from "./debug/config";
import { createBerlinFpsCounter } from "./debug/fps-counter";
import { BerlinRadioManager } from "./audio/radio-manager";
import {
  BERLIN_ALTITUDE_SPEED,
  BERLIN_CAMERA_FAR,
  BERLIN_FLIGHT_BASE_SPEED,
  BERLIN_PLAYER_HEIGHT_LIMITS,
  BERLIN_PLAYER_SPAWN_POSITION,
  BERLIN_TILE_SELECTION_FOV,
} from "./constants";
import { BERLIN_PLACEMENT } from "./placement/config";
import { disposeObjectTree } from "./runtime/cleanup";
import { BerlinConeGridRuntime } from "./runtime/cone-grid-runtime";
import { BerlinCollisionController } from "./collision/controller";
import { TilesRuntimeAdapter } from "./runtime/tiles-runtime";
import {
  isBerlinTilesSourceConfigured,
  resolveBerlinTilesSource,
} from "./runtime/tiles-source";
import { createBerlinOnboardingAudio } from "./onboarding/audio";
import { createBerlinOnboardingController } from "./onboarding/controller";
import { FlightPlayer } from "$lib/three/player";
import { createSky } from "$lib/three/sky";
import { CAMERA } from "$lib/config/flight";

const scratchPosition = new THREE.Vector3();
// ponytail: temporary perf/debug switch; restore to true to re-enable scene-tick collisions.
const BERLIN_COLLISION_TICK_ENABLED = true;
const BERLIN_AR_CLEAR_COLOR = 0x79b8d9;
const BERLIN_SKYBOX_COLOR = 0x87ceeb;
const BERLIN_SKYBOX_RADIUS = BERLIN_CAMERA_FAR * 0.85;
const BERLIN_SHUTDOWN_FOG_NEAR = 0.05;
const BERLIN_SHUTDOWN_FOG_FAR = 2;
const BERLIN_TILE_SELECTION_YAWS = [
  0,
  Math.PI * 0.5,
  Math.PI,
  -Math.PI * 0.5,
] as const;
const berlinAudioResumeByContext = new WeakMap<AudioContext, Promise<void>>();

function createBerlinFillLights(): {
  directional: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
} {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa0a0a0, 0.95);

  const directional = new THREE.DirectionalLight(0xffffff, 0.65);
  directional.position.set(-160, 90, -120);

  return { directional, hemisphere };
}

/**
 * Initializes the Berlin scene
 */
export async function setup(ctx: SetupContext): Promise<BerlinState> {
  const sceneRoot = new THREE.Group();
  sceneRoot.name = "BerlinFlightRoot";
  ctx.scene.add(sceneRoot);

  const tilesGroup = new THREE.Group();
  tilesGroup.name = "BerlinTilesRoot";
  sceneRoot.add(tilesGroup);

  // Player (creates own camera + rig)
  const player = new FlightPlayer({
    fov: CAMERA.FOV,
    near: CAMERA.NEAR,
    far: BERLIN_CAMERA_FAR,
    spawnPosition: BERLIN_PLAYER_SPAWN_POSITION,
    baseSpeed: BERLIN_FLIGHT_BASE_SPEED,
    terrainSlowdown: 1.0, // No terrain slowdown for tiles yet
  });
  sceneRoot.add(player.rig);
  const listener = new THREE.AudioListener();
  player.camera.add(listener);
  const radioManager = new BerlinRadioManager(listener);
  radioManager.setMasterVolume(0);
  sceneRoot.add(radioManager.group);

  const gridHelper = new THREE.GridHelper(2000, 100);
  gridHelper.position.y = -1;
  sceneRoot.add(gridHelper);

  const skybox = createSky({
    radius: BERLIN_SKYBOX_RADIUS,
    colorTop: 0x79b8d9,
    colorHorizon: 0xd9f1ff,
    colorBottom: BERLIN_SKYBOX_COLOR,
  });
  skybox.name = "BerlinSkybox";
  skybox.renderOrder = -1000;
  if (skybox.material instanceof THREE.Material) {
    skybox.material.depthWrite = false;
  }
  sceneRoot.add(skybox);

  const fillLights = createBerlinFillLights();
  sceneRoot.add(fillLights.hemisphere);
  sceneRoot.add(fillLights.directional);

  const coneRuntime = new BerlinConeGridRuntime();
  sceneRoot.add(coneRuntime.root);
  const collisionController = new BerlinCollisionController();
  let state: BerlinState;
  let removeXrSelectAudioFallback: (() => void) | null = null;
  const resumeAudioFromXr = (): void => {
    resumeBerlinAudioContext(state);
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
  const tileSelectionCameras = createTileSelectionCameras(player.camera);

  // Initial state
  state = {
    sceneRoot,
    scene: ctx.scene,
    baseFog: getBerlinBaseFog(ctx.scene),
    fillLights,
    tilesRuntime: null,
    tilesGroup,
    gridHelper,
    coneRuntime,
    collisionController,
    renderer: ctx.renderer,
    camera: player.camera,
    listener,
    radioManager,
    tileSelectionCameras,
    player,
    onboarding: createBerlinOnboardingController(player.camera),
    onboardingAudio: createBerlinOnboardingAudio(),
    worldVisualsVisible: true,
    skybox,
    skyboxVisible: true,
    targetSpeed: BERLIN_FLIGHT_BASE_SPEED,
    isLoading: true,
    debugEnabled: false,
    debugOverlay: null,
    fpsCounter: BERLIN_DEBUG_FPS_COUNTER_DEFAULT
      ? createBerlinFpsCounter()
      : null,
    isDisposed: false,
    abortController: new AbortController(),
    removeAudioResumeListener: () => {
      ctx.renderer.xr.removeEventListener("sessionstart", resumeAudioFromXr);
      ctx.renderer.xr.removeEventListener("sessionend", onXrSessionEnd);
      removeXrSelectAudioFallback?.();
      removeXrSelectAudioFallback = null;
    },
  };
  ctx.renderer.xr.addEventListener("sessionstart", resumeAudioFromXr);
  ctx.renderer.xr.addEventListener("sessionend", onXrSessionEnd);

  if (ctx.previewMode) {
    state.onboarding.progress = 1;
    state.onboarding.isActive = false;
    state.onboarding.isComplete = true;
  }

  setBerlinDebugEnabled(state, BERLIN_DEBUG_OVERLAY_DEFAULT);
  setBerlinWorldVisualsVisible(state, false);
  setBerlinSkyboxVisible(state, false);
  void loadTilesWhenConfigured(state);

  return state;
}

/**
 * Updates the scene every frame
 */
export function tick(state: BerlinState, ctx: TickContext) {
  const s = state as BerlinState;

  if (s.isDisposed) {
    return { state: s };
  }

  const isXrPresenting = s.renderer.xr.isPresenting;
  if (isXrPresenting) {
    if (s.onboarding.isActive) {
      const session = s.renderer.xr.getSession();
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
          s.onboarding.skip();
        }
      }
    }
    s.onboarding.update(ctx.delta);
  }
  const showVirtualWorld =
    !isXrPresenting || (s.onboarding.isComplete && !s.onboarding.hasEnded);
  const virtualAlpha =
    !isXrPresenting ? 1 : s.onboarding.hasEnded ? 0 : s.onboarding.progress;
  s.renderer.setClearColor(BERLIN_AR_CLEAR_COLOR, virtualAlpha);
  setBerlinWorldVisualsVisible(s, showVirtualWorld);
  setBerlinSkyboxVisible(s, showVirtualWorld);
  updateBerlinShutdownFog(s);
  s.onboardingAudio.update(s.onboarding.progress);
  s.radioManager.setMasterVolume(s.onboardingAudio.fullGain);
  updateBerlinRadioAudio(s);
  s.player.baseSpeed = getAltitudeScaledSpeed(
    s.targetSpeed,
    s.player.rig.position.y,
  );
  s.player.setXRPresenting(isXrPresenting);
  if (s.onboarding.isComplete && !s.onboarding.hasEnded) {
    s.player.tick(ctx.delta);
    clampBerlinPlayerHeight(s);
  }
  if (s.debugEnabled && !s.renderer.xr.isPresenting) {
    applyBerlinDebugCamera(s);
    clampBerlinPlayerHeight(s);
  }
  s.player.rig.updateMatrixWorld(true);
  s.camera.getWorldPosition(s.skybox.position);
  s.coneRuntime.update(s.player.rig.position);

  if (s.tilesRuntime) {
    // Sync the WebXR session with the 3D Tiles scheduler so that requestAnimationFrame callbacks
    // (used for priority queue loading) run on the WebXR render loop rather than getting throttled.
    const xrSession = s.renderer.xr.getSession();
    Scheduler.setXRSession(xrSession as XRSession);

    syncTileSelectionCameras(s);
    s.tilesRuntime.update(s.tileSelectionCameras, s.renderer);
    if (BERLIN_COLLISION_TICK_ENABLED) {
      const trackedTileMeshes = s.tilesRuntime.getTrackedTileMeshes();
      const trackedTileMeshVersion = s.tilesRuntime.getTrackedTileMeshVersion();
      s.collisionController.update(
        s.coneRuntime.getActiveCones(),
        s.coneRuntime.getSnapshotVersion(),
        trackedTileMeshes,
        trackedTileMeshVersion,
      );
    }
  }

  if (s.debugEnabled) {
    s.debugOverlay?.update(s, ctx.elapsed);
  }
  s.fpsCounter?.update(ctx.delta);

  return { state: s };
}

function updateBerlinRadioAudio(state: BerlinState): void {
  startBerlinRadioIfAudioRunning(state);
}

function resumeBerlinAudioContext(state: BerlinState): void {
  const audioContext = state.listener.context;
  if (startBerlinRadioIfAudioRunning(state)) return;

  if (
    audioContext.state === "running" ||
    berlinAudioResumeByContext.has(audioContext)
  ) {
    return;
  }

  const resume = audioContext
    .resume()
    .catch((error: unknown) => {
      console.warn("[BerlinRadio] AudioContext resume failed:", error);
    })
    .finally(() => {
      berlinAudioResumeByContext.delete(audioContext);
    });
  berlinAudioResumeByContext.set(audioContext, resume);
  void resume.then(() => {
    startBerlinRadioIfAudioRunning(state);
  });
}

function attachXrSelectAudioFallback(
  state: BerlinState,
  session: XRSession | null,
): (() => void) | null {
  if (!session) return null;

  const onSelect = (): void => {
    resumeBerlinAudioContext(state);
    if (state.radioManager.isStarted) session.removeEventListener("select", onSelect);
  };
  session.addEventListener("select", onSelect);
  return () => session.removeEventListener("select", onSelect);
}

function startBerlinRadioIfAudioRunning(state: BerlinState): boolean {
  if (
    state.isDisposed ||
    state.radioManager.isStarted ||
    state.listener.context.state !== "running"
  ) {
    return false;
  }

  state.radioManager.start();
  return true;
}

async function loadTilesWhenConfigured(state: BerlinState): Promise<void> {
  if (!isBerlinTilesSourceConfigured()) {
    state.isLoading = false;
    return;
  }

  try {
    const source = await resolveBerlinTilesSource();
    const runtime = await TilesRuntimeAdapter.create(
      state.tilesGroup,
      source,
      state.abortController.signal,
    );
    if (state.isDisposed || state.abortController.signal.aborted) {
      runtime.dispose();
      return;
    }

    state.tilesRuntime = runtime;
    state.isLoading = false;
  } catch (error) {
    if (state.isDisposed || state.abortController.signal.aborted) return;

    console.error("[BerlinFlight] Failed to load tileset:", error);
    state.isLoading = false;
  }
}

function syncTileSelectionCameras(state: BerlinState): void {
  scratchPosition.copy(state.player.rig.position);
  for (const camera of state.tileSelectionCameras) {
    syncTileSelectionCamera(camera, scratchPosition, state);
  }
}

function syncTileSelectionCamera(
  camera: THREE.PerspectiveCamera,
  position: THREE.Vector3,
  state: BerlinState,
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
): BerlinState["tileSelectionCameras"] {
  return [
    createTileSelectionCamera(camera, BERLIN_TILE_SELECTION_YAWS[0]),
    createTileSelectionCamera(camera, BERLIN_TILE_SELECTION_YAWS[1]),
    createTileSelectionCamera(camera, BERLIN_TILE_SELECTION_YAWS[2]),
    createTileSelectionCamera(camera, BERLIN_TILE_SELECTION_YAWS[3]),
  ];
}

function createTileSelectionCamera(
  camera: THREE.PerspectiveCamera,
  yaw: number,
): THREE.PerspectiveCamera {
  const selectionCamera = new THREE.PerspectiveCamera(
    BERLIN_TILE_SELECTION_FOV,
    camera.aspect || 1,
    camera.near,
    camera.far,
  );
  selectionCamera.rotation.set(0, yaw, 0);
  selectionCamera.updateProjectionMatrix();
  selectionCamera.updateMatrixWorld(true);
  return selectionCamera;
}

function applyBerlinDebugCamera(state: BerlinState): void {
  state.player.rig.position.y = BERLIN_PLACEMENT.DEBUG_CAMERA_HEIGHT;
  state.player.cameraMount.rotation.set(-Math.PI * 0.5, 0, 0, "YXZ");
  state.camera.rotation.set(0, 0, 0);
  state.camera.updateMatrixWorld(true);
}

function clampBerlinPlayerHeight(state: BerlinState): void {
  state.player.rig.position.y = THREE.MathUtils.clamp(
    state.player.rig.position.y,
    BERLIN_PLAYER_HEIGHT_LIMITS.MIN,
    BERLIN_PLAYER_HEIGHT_LIMITS.MAX,
  );
}

function setBerlinWorldVisualsVisible(
  state: BerlinState,
  visible: boolean,
): void {
  if (state.worldVisualsVisible === visible) return;

  state.worldVisualsVisible = visible;
  state.tilesGroup.visible = visible;
  state.coneRuntime.setVisible(visible);
  state.gridHelper.visible = visible;
  state.fillLights.hemisphere.visible = visible;
  state.fillLights.directional.visible = visible;
}

function setBerlinSkyboxVisible(state: BerlinState, visible: boolean): void {
  state.skyboxVisible = visible;
  state.skybox.visible = visible;
  if (!visible) {
    state.scene.background = null;
    return;
  }

  if (state.scene.background instanceof THREE.Color) {
    state.scene.background.set(BERLIN_SKYBOX_COLOR);
    return;
  }

  state.scene.background = new THREE.Color(BERLIN_SKYBOX_COLOR);
}

function updateBerlinShutdownFog(state: BerlinState): void {
  const baseFog = state.baseFog;
  if (!baseFog) return;

  const progress = state.onboarding.shutdownProgress;
  const amount = state.onboarding.isShutdownEffectActive ? progress : 0;

  const fog = getOrCreateBerlinFog(state);
  fog.near = THREE.MathUtils.lerp(
    baseFog.near,
    BERLIN_SHUTDOWN_FOG_NEAR,
    amount,
  );
  fog.far = THREE.MathUtils.lerp(
    baseFog.far,
    BERLIN_SHUTDOWN_FOG_FAR,
    amount,
  );
  fog.color.copy(baseFog.color);
}

function getBerlinBaseFog(scene: THREE.Scene): BerlinState["baseFog"] {
  if (!(scene.fog instanceof THREE.Fog)) return null;

  return {
    color: scene.fog.color.clone(),
    near: scene.fog.near,
    far: scene.fog.far,
  };
}

function getOrCreateBerlinFog(state: BerlinState): THREE.Fog {
  if (state.scene.fog instanceof THREE.Fog) return state.scene.fog;

  const baseFog = state.baseFog;
  const fog = new THREE.Fog(
    baseFog?.color ?? BERLIN_AR_CLEAR_COLOR,
    baseFog?.near ?? BERLIN_SHUTDOWN_FOG_NEAR,
    baseFog?.far ?? BERLIN_SHUTDOWN_FOG_FAR,
  );
  state.scene.fog = fog;
  return fog;
}

/**
 * Cleans up resources
 */
export function dispose(state: BerlinState, _scene: THREE.Scene): void {
  const s = state as BerlinState;

  if (s.isDisposed) return;

  s.isDisposed = true;
  s.isLoading = false;
  s.abortController.abort();

  s.debugOverlay?.dispose();
  s.debugOverlay = null;
  s.fpsCounter?.dispose();
  s.fpsCounter = null;
  s.onboarding.dispose();
  s.onboardingAudio.dispose();
  s.removeAudioResumeListener();
  s.radioManager.dispose();
  s.camera.remove(s.listener);

  s.tilesRuntime?.dispose();
  s.tilesRuntime = null;
  s.coneRuntime.dispose();

  s.fillLights.hemisphere.removeFromParent();
  s.fillLights.directional.removeFromParent();

  s.sceneRoot.removeFromParent();
  disposeObjectTree(s.sceneRoot);
  s.sceneRoot.clear();
}

function getAltitudeScaledSpeed(baseSpeed: number, altitude: number): number {
  const altitudeRange =
    BERLIN_ALTITUDE_SPEED.MAX_ALTITUDE - BERLIN_ALTITUDE_SPEED.MIN_ALTITUDE;
  const normalizedAltitude = THREE.MathUtils.clamp(
    (altitude - BERLIN_ALTITUDE_SPEED.MIN_ALTITUDE) / altitudeRange,
    0,
    1,
  );
  const multiplier = THREE.MathUtils.lerp(
    BERLIN_ALTITUDE_SPEED.MIN_MULTIPLIER,
    BERLIN_ALTITUDE_SPEED.MAX_MULTIPLIER,
    normalizedAltitude,
  );

  return baseSpeed * multiplier;
}
