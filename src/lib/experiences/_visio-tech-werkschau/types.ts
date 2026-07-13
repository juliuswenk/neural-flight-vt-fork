import type { FlightPlayer } from "$lib/three/player";
import type { ExperienceState } from "../types";
import type { WerkschauRadioManager } from "./audio/radio-manager";
import type { WerkschauOnboardingAudio } from "./onboarding/audio";
import type { WerkschauOnboardingController } from "./onboarding/controller";
import type { WerkschauConeGridRuntime } from "./runtime/cone-grid-runtime";
import type { TilesRuntimeAdapter } from "./runtime/tiles-runtime";
import type * as THREE from "three";

export interface WerkschauState extends ExperienceState {
  sceneRoot: THREE.Group;
  scene: THREE.Scene;
  gridHelper: THREE.GridHelper;
  skybox: THREE.Mesh;
  skyboxVisible: boolean;
  fillLights: {
    hemisphere: THREE.HemisphereLight;
    directional: THREE.DirectionalLight;
  };
  tilesRuntime: TilesRuntimeAdapter | null;
  tilesGroup: THREE.Group;
  coneRuntime: WerkschauConeGridRuntime;
  coneDiagnosticElement: HTMLDivElement | null;
  fallbackPlane: THREE.Mesh | null;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  listener: THREE.AudioListener;
  radioManager: WerkschauRadioManager;
  tileSelectionCameras: readonly THREE.PerspectiveCamera[];
  player: FlightPlayer;
  onboarding: WerkschauOnboardingController;
  onboardingAudio: WerkschauOnboardingAudio;
  worldVisualsVisible: boolean;
  previewMode: boolean;
  targetSpeed: number;
  isLoading: boolean;
  isDisposed: boolean;
  abortController: AbortController;
  removeAudioResumeListener: () => void;
}
