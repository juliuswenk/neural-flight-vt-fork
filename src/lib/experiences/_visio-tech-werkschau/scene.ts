import * as THREE from "three";
import { CAMERA } from "$lib/config/flight";
import { FlightPlayer } from "$lib/three/player";
import { createSky } from "$lib/three/sky";
import type { SetupContext, TickContext } from "../types";
import {
  WERKSCHAU_ALTITUDE_SPEED,
  WERKSCHAU_CAMERA_FAR,
  WERKSCHAU_FLIGHT_BASE_SPEED,
  WERKSCHAU_PLAYER_HEIGHT_LIMITS,
  WERKSCHAU_PLAYER_SPAWN_POSITION,
} from "./constants";
import { disposeObjectTree } from "./runtime/cleanup";
import type { WerkschauState } from "./types";

const WERKSCHAU_SKYBOX_COLOR = 0x87ceeb;
const WERKSCHAU_SKYBOX_RADIUS = WERKSCHAU_CAMERA_FAR * 0.85;

export async function setup(ctx: SetupContext): Promise<WerkschauState> {
  const sceneRoot = new THREE.Group();
  sceneRoot.name = "VisioTechWerkschauRoot";
  ctx.scene.add(sceneRoot);

  const player = new FlightPlayer({
    fov: CAMERA.FOV,
    near: CAMERA.NEAR,
    far: WERKSCHAU_CAMERA_FAR,
    spawnPosition: WERKSCHAU_PLAYER_SPAWN_POSITION,
    baseSpeed: WERKSCHAU_FLIGHT_BASE_SPEED,
    terrainSlowdown: 1,
  });
  sceneRoot.add(player.rig);

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

  return {
    sceneRoot,
    gridHelper,
    skybox,
    fillLights,
    renderer: ctx.renderer,
    camera: player.camera,
    player,
    targetSpeed: WERKSCHAU_FLIGHT_BASE_SPEED,
    isDisposed: false,
  };
}

export function tick(
  state: WerkschauState,
  ctx: TickContext,
): { state: WerkschauState } {
  if (state.isDisposed) return { state };

  state.player.baseSpeed = getAltitudeScaledSpeed(
    state.targetSpeed,
    state.player.rig.position.y,
  );
  state.player.setXRPresenting(state.renderer.xr.isPresenting);
  state.player.tick(ctx.delta);
  clampPlayerHeight(state);
  state.player.rig.updateMatrixWorld(true);
  state.camera.getWorldPosition(state.skybox.position);

  return { state };
}

export function dispose(state: WerkschauState, _scene: THREE.Scene): void {
  if (state.isDisposed) return;

  state.isDisposed = true;
  state.fillLights.hemisphere.removeFromParent();
  state.fillLights.directional.removeFromParent();
  state.sceneRoot.removeFromParent();
  disposeObjectTree(state.sceneRoot);
  state.sceneRoot.clear();
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
