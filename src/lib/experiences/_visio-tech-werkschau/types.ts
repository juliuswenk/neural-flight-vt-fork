import type { FlightPlayer } from "$lib/three/player";
import type { ExperienceState } from "../types";
import type * as THREE from "three";

export interface WerkschauState extends ExperienceState {
  sceneRoot: THREE.Group;
  gridHelper: THREE.GridHelper;
  skybox: THREE.Mesh;
  fillLights: {
    hemisphere: THREE.HemisphereLight;
    directional: THREE.DirectionalLight;
  };
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  player: FlightPlayer;
  targetSpeed: number;
  isDisposed: boolean;
}
