import type {
  ExperienceManifest,
  ExperienceState,
  ParameterDef,
  PlayerOrientationInput,
  SetupContext,
  TickContext,
} from "../types";
import type * as THREE from "three";
import {
  WERKSCHAU_CAMERA_FAR,
  WERKSCHAU_DEBUG_OVERLAY_DEFAULT,
  WERKSCHAU_FLIGHT_BASE_SPEED,
} from "./constants";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";
import type { WerkschauState } from "./types";

const parameters: ParameterDef[] = [
  {
    id: "moveSpeed",
    label: "Flight Speed",
    group: "Movement",
    min: 0,
    max: 50,
    default: WERKSCHAU_FLIGHT_BASE_SPEED,
    step: 1,
    unit: "m/s",
    icon: "Gauge",
  },
  {
    id: "debugOverlay",
    label: "Debug Overlay",
    group: "Debug",
    type: "boolean",
    min: 0,
    max: 1,
    default: WERKSCHAU_DEBUG_OVERLAY_DEFAULT,
    step: 1,
    icon: "Bug",
  },
];

export const manifest: ExperienceManifest = {
  id: "_visio-tech-werkschau",
  name: "Visio Tech Werkschau",
  description: "Stable exhibition shell for the Berlin flight rebuild.",
  version: "0.1.0",
  author: "Neural Flight",

  parameters,
  interfaces: { orientation: true, speed: true },

  camera: { fov: 75, near: 0.1, far: WERKSCHAU_CAMERA_FAR },
  scene: {
    background: "#87ceeb",
    fogNear: WERKSCHAU_CAMERA_FAR * 0.65,
    fogFar: WERKSCHAU_CAMERA_FAR * 0.95,
    fogColor: "#87ceeb",
    ambientIntensity: 0.5,
    sunIntensity: 1,
    sunColor: "#ffffff",
    sunPosition: { x: 100, y: 200, z: 100 },
  },
  spawn: {
    position: { x: 0, y: 100, z: 0 },
  },

  setup: async (ctx: SetupContext): Promise<ExperienceState> => setup(ctx),
  tick: (state: ExperienceState, ctx: TickContext) =>
    tick(state as WerkschauState, ctx),
  applySettings: (
    id: string,
    value: number | boolean | string,
    state: ExperienceState,
    scene: THREE.Scene,
  ): void => applySettings(id, value, state as WerkschauState, scene),
  updatePlayer: (
    orientation: PlayerOrientationInput,
    speed: { accelerate: boolean; brake: boolean },
    state: ExperienceState,
    delta: number,
  ): void => updatePlayer(orientation, speed, state as WerkschauState, delta),
  dispose: (state: ExperienceState, scene: THREE.Scene): void =>
    dispose(state as WerkschauState, scene),
};
