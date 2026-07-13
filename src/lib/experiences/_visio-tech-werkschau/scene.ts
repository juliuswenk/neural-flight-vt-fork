import * as THREE from "three";
import { Scheduler } from "3d-tiles-renderer";
import { CAMERA } from "$lib/config/flight";
import { FlightPlayer } from "$lib/three/player";
import { createSky } from "$lib/three/sky";
import type { SetupContext, TickContext } from "../types";
import { WerkschauRadioManager } from "./audio/radio-manager";
import {
  WERKSCHAU_ALTITUDE_SPEED,
  WERKSCHAU_BERLIN_GEO_BOUNDS,
  WERKSCHAU_CAMERA_FAR,
  WERKSCHAU_FLIGHT_BASE_SPEED,
  WERKSCHAU_PLAYER_HEIGHT_LIMITS,
  WERKSCHAU_PLAYER_SPAWN_POSITION,
  WERKSCHAU_TILE_SELECTION_FOV,
} from "./constants";
import { WERKSCHAU_BERLIN_MITTE_ORIGIN } from "./geo/berlin-mitte-origin";
import { geoToLocal } from "./geo/coordinates";
import { createWerkschauOnboardingAudio } from "./onboarding/audio";
import { createWerkschauOnboardingController } from "./onboarding/controller";
import { disposeObjectTree } from "./runtime/cleanup";
import { TilesRuntimeAdapter } from "./runtime/tiles-runtime";
import {
  isWerkschauTilesSourceConfigured,
  resolveWerkschauTilesSource,
} from "./runtime/tiles-source";
import type { WerkschauState } from "./types";

const scratchPosition = new THREE.Vector3();
const WERKSCHAU_SKYBOX_COLOR = 0x87ceeb;
const WERKSCHAU_AR_CLEAR_COLOR = 0x79b8d9;
const WERKSCHAU_SKYBOX_RADIUS = WERKSCHAU_CAMERA_FAR * 0.85;
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

  const skybox = createSky({
    radius: WERKSCHAU_SKYBOX_RADIUS,
    colorTop: 0x79b8d9,
    colorHorizon: 0xd9f1ff,
    colorBottom: WERKSCHAU_SKYBOX_COLOR,
  });
  skybox.name = "VisioTechWerkschauSkybox";
  skybox.renderOrder = -1000;
  if (skybox.material instanceof THREE.Material) {
    skybox.material.depthWrite = false;
  }
  sceneRoot.add(skybox);

  const fillLights = createFillLights();
  sceneRoot.add(fillLights.hemisphere);
  sceneRoot.add(fillLights.directional);

  let state: WerkschauState;
  const onXrSessionStart = (): void => {
    state.onboarding.reset(false);
    updateWerkschauRadioAudio(state, true);
  };

  state = {
    sceneRoot,
    scene: ctx.scene,
    tilesRuntime: null,
    tilesGroup,
    fallbackPlane: null,
    gridHelper,
    skybox,
    skyboxVisible: true,
    fillLights,
    renderer: ctx.renderer,
    camera: player.camera,
    listener,
    radioManager,
    tileSelectionCameras: createTileSelectionCameras(player.camera),
    player,
    onboarding: createWerkschauOnboardingController(player.camera),
    onboardingAudio: createWerkschauOnboardingAudio(),
    worldVisualsVisible: true,
    previewMode: ctx.previewMode ?? false,
    targetSpeed: WERKSCHAU_FLIGHT_BASE_SPEED,
    isLoading: true,
    isDisposed: false,
    abortController: new AbortController(),
    removeAudioResumeListener: () => {
      ctx.renderer.xr.removeEventListener("sessionstart", onXrSessionStart);
    },
  };
  ctx.renderer.xr.addEventListener("sessionstart", onXrSessionStart);
  state.onboarding.reset(ctx.previewMode);
  if (!ctx.previewMode) {
    setWerkschauWorldVisualsVisible(state, false);
    setWerkschauSkyboxVisible(state, false);
  }
  void loadTilesWhenConfigured(state);

  return state;
}

export function tick(
  state: WerkschauState,
  ctx: TickContext,
): { state: WerkschauState } {
  if (state.isDisposed) return { state };

  const isXrPresenting = state.renderer.xr.isPresenting;
  if (isXrPresenting || state.previewMode) {
    state.onboarding.update(ctx.delta);
  }

  const showVirtualWorld =
    !isXrPresenting ||
    (state.onboarding.isComplete && !state.onboarding.hasEnded);
  const virtualAlpha = !isXrPresenting
    ? 1
    : state.onboarding.hasEnded
      ? 0
      : state.onboarding.progress;
  state.renderer.setClearColor(WERKSCHAU_AR_CLEAR_COLOR, virtualAlpha);
  setWerkschauWorldVisualsVisible(state, showVirtualWorld);
  setWerkschauSkyboxVisible(state, showVirtualWorld);
  state.onboardingAudio.update(state.onboarding.progress);
  state.radioManager.setMasterVolume(state.onboardingAudio.fullGain);
  updateWerkschauRadioAudio(state, isXrPresenting || state.previewMode);

  state.player.baseSpeed = getAltitudeScaledSpeed(
    state.targetSpeed,
    state.player.rig.position.y,
  );
  state.player.setXRPresenting(isXrPresenting);
  if (
    !isXrPresenting ||
    (state.onboarding.isComplete && !state.onboarding.hasEnded)
  ) {
    scratchPosition.copy(state.player.rig.position);
    state.player.tick(ctx.delta);
    clampPlayerHeight(state);
    state.onboarding.markMoved(
      scratchPosition.distanceToSquared(state.player.rig.position),
    );
  }
  state.player.rig.updateMatrixWorld(true);
  state.camera.getWorldPosition(state.skybox.position);
  if (state.tilesRuntime) {
    Scheduler.setXRSession(state.renderer.xr.getSession() as XRSession);
    syncTileSelectionCameras(state);
    state.tilesRuntime.update(state.tileSelectionCameras, state.renderer);
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
  state.camera.remove(state.listener);
  state.tilesRuntime?.dispose();
  state.tilesRuntime = null;
  state.fillLights.hemisphere.removeFromParent();
  state.fillLights.directional.removeFromParent();
  state.sceneRoot.removeFromParent();
  disposeObjectTree(state.sceneRoot);
  state.sceneRoot.clear();
}

function updateWerkschauRadioAudio(
  state: WerkschauState,
  shouldRun: boolean,
): void {
  const audioContext = state.listener.context;
  if (startWerkschauRadioIfAudioRunning(state)) return;

  if (
    !shouldRun ||
    audioContext.state !== "suspended" ||
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

function startWerkschauRadioIfAudioRunning(state: WerkschauState): boolean {
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

function createFillLights(): {
  directional: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
} {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa0a0a0, 0.95);
  const directional = new THREE.DirectionalLight(0xffffff, 0.65);
  directional.position.set(-160, 90, -120);

  return { directional, hemisphere };
}

function clampPlayerHeight(state: WerkschauState): void {
  state.player.rig.position.y = THREE.MathUtils.clamp(
    state.player.rig.position.y,
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
  if (state.fallbackPlane) state.fallbackPlane.visible = visible;
  state.gridHelper.visible = visible;
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
  state.scene.background = visible
    ? new THREE.Color(WERKSCHAU_SKYBOX_COLOR)
    : null;
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

  const bounds = getBerlinLocalBounds();
  const geometry = new THREE.PlaneGeometry(
    bounds.maxX - bounds.minX,
    bounds.maxZ - bounds.minZ,
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
    (bounds.minX + bounds.maxX) * 0.5,
    0,
    (bounds.minZ + bounds.maxZ) * 0.5,
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

function getBerlinLocalBounds(): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const corners = [
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: WERKSCHAU_BERLIN_GEO_BOUNDS.north,
      lon: WERKSCHAU_BERLIN_GEO_BOUNDS.west,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: WERKSCHAU_BERLIN_GEO_BOUNDS.north,
      lon: WERKSCHAU_BERLIN_GEO_BOUNDS.east,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: WERKSCHAU_BERLIN_GEO_BOUNDS.south,
      lon: WERKSCHAU_BERLIN_GEO_BOUNDS.west,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: WERKSCHAU_BERLIN_GEO_BOUNDS.south,
      lon: WERKSCHAU_BERLIN_GEO_BOUNDS.east,
      height: 0,
    }),
  ];

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minZ: Math.min(...corners.map((corner) => corner.z)),
    maxZ: Math.max(...corners.map((corner) => corner.z)),
  };
}
