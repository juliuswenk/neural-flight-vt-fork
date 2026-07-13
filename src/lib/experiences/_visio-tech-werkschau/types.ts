import type { FlightPlayer } from "$lib/three/player";
import type { ExperienceState } from "../types";
import type { TilesRuntimeAdapter } from "./runtime/tiles-runtime";
import type * as THREE from "three";

export interface WerkschauState extends ExperienceState {
  sceneRoot: THREE.Group;
  gridHelper: THREE.GridHelper;
  skybox: THREE.Mesh;
  fillLights: {
    hemisphere: THREE.HemisphereLight;
    directional: THREE.DirectionalLight;
  };
  tilesRuntime: TilesRuntimeAdapter | null;
  tilesGroup: THREE.Group;
  fallbackPlane: THREE.Mesh | null;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  tileSelectionCameras: readonly THREE.PerspectiveCamera[];
  player: FlightPlayer;
  targetSpeed: number;
  isLoading: boolean;
  isDisposed: boolean;
  abortController: AbortController;
}
