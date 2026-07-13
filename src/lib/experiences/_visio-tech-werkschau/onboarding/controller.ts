import * as THREE from "three";
import {
  WERKSCHAU_INTRO_DURATION_SECONDS,
  WERKSCHAU_OUTRO_DURATION_SECONDS,
  WERKSCHAU_PUBLIC_FLIGHT_DURATION_MS,
} from "../constants";
import {
  CYBER,
  type CyberOverlay,
  createResponsiveGrid,
  getTexts,
} from "../lennard/scripts/cyber-overlay";
import { BatteryOverlay } from "../lennard/scripts/battery-overlay";
import { SonarOverlay } from "../lennard/scripts/sonar-overlay";

const MOVE_EPSILON_SQ = 0.0001;

type WerkschauSequencePhase = "intro" | "flight" | "outro" | "complete";

export interface WerkschauOnboardingController {
  readonly durationMs: number;
  progress: number;
  isActive: boolean;
  isComplete: boolean;
  hasEnded: boolean;
  shutdownProgress: number;
  isShutdownEffectActive: boolean;
  update(deltaSeconds: number): void;
  markMoved(distanceSq: number): void;
  reset(skipIntro?: boolean): void;
  dispose(): void;
}

export function createWerkschauOnboardingController(
  camera: THREE.PerspectiveCamera,
): WerkschauOnboardingController {
  const sonar = new SonarOverlay();
  const battery = new BatteryOverlay();
  const introText = new CyberTextGrid(
    camera,
    "human perception detected, switching...",
  );
  const outroText = new CyberTextGrid(camera, "returning to human perception");
  let phase: WerkschauSequencePhase = "intro";
  let introElapsed = 0;
  let flightElapsed = 0;
  let outroElapsed = 0;
  let flightStarted = false;

  sonar.attachToCamera(camera);
  battery.attachToCamera(camera);
  outroText.setVisible(false);

  const controller: WerkschauOnboardingController = {
    durationMs: WERKSCHAU_PUBLIC_FLIGHT_DURATION_MS,
    progress: 0,
    isActive: true,
    isComplete: false,
    hasEnded: false,
    shutdownProgress: 0,
    isShutdownEffectActive: false,
    update(deltaSeconds: number): void {
      const delta = Math.max(0, deltaSeconds);
      sonar.update();
      battery.update(performance.now());

      if (phase === "intro") {
        introElapsed = Math.min(
          WERKSCHAU_INTRO_DURATION_SECONDS,
          introElapsed + delta,
        );
        this.progress = introElapsed / WERKSCHAU_INTRO_DURATION_SECONDS;
        if (introElapsed >= WERKSCHAU_INTRO_DURATION_SECONDS) {
          this.isActive = false;
          this.isComplete = true;
          this.progress = 1;
          introText.setVisible(false);
          sonar.startFadeOut();
          phase = "flight";
        }
        return;
      }

      if (phase === "flight") {
        if (!flightStarted) return;
        flightElapsed = Math.min(
          WERKSCHAU_PUBLIC_FLIGHT_DURATION_MS / 1000,
          flightElapsed + delta,
        );
        if (flightElapsed >= WERKSCHAU_PUBLIC_FLIGHT_DURATION_MS / 1000) {
          phase = "outro";
          outroElapsed = 0;
          outroText.setVisible(true);
          this.isShutdownEffectActive = true;
          this.shutdownProgress = 0;
        }
        return;
      }

      if (phase === "outro") {
        outroElapsed = Math.min(
          WERKSCHAU_OUTRO_DURATION_SECONDS,
          outroElapsed + delta,
        );
        this.shutdownProgress = outroElapsed / WERKSCHAU_OUTRO_DURATION_SECONDS;
        this.progress = 1 - this.shutdownProgress;
        if (outroElapsed >= WERKSCHAU_OUTRO_DURATION_SECONDS) {
          phase = "complete";
          this.hasEnded = true;
          this.isShutdownEffectActive = false;
          this.shutdownProgress = 1;
          this.progress = 0;
          outroText.setVisible(false);
        }
      }
    },
    markMoved(distanceSq: number): void {
      if (phase !== "flight" || flightStarted || distanceSq <= MOVE_EPSILON_SQ) {
        return;
      }
      flightStarted = true;
      battery.start();
    },
    reset(skipIntro = false): void {
      phase = skipIntro ? "flight" : "intro";
      introElapsed = skipIntro ? WERKSCHAU_INTRO_DURATION_SECONDS : 0;
      flightElapsed = 0;
      outroElapsed = 0;
      flightStarted = skipIntro;
      this.progress = skipIntro ? 1 : 0;
      this.isActive = !skipIntro;
      this.isComplete = skipIntro;
      this.hasEnded = false;
      this.shutdownProgress = 0;
      this.isShutdownEffectActive = false;
      sonar.setVisible(!skipIntro);
      introText.setVisible(!skipIntro);
      outroText.setVisible(false);
      battery.reset();
      if (skipIntro) battery.start();
    },
    dispose(): void {
      camera.remove(sonar.sprite);
      camera.remove(battery.sprite);
      sonar.dispose();
      battery.dispose();
      introText.dispose();
      outroText.dispose();
    },
  };

  return controller;
}

class CyberTextGrid {
  private readonly overlays: CyberOverlay[];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    message: string,
  ) {
    const previousMessage = CYBER.message;
    CYBER.message = message;
    this.overlays = createResponsiveGrid(getTexts(), camera);
    CYBER.message = previousMessage;
    for (const overlay of this.overlays) {
      camera.add(overlay.sprite);
    }
  }

  setVisible(visible: boolean): void {
    for (const overlay of this.overlays) {
      overlay.sprite.visible = visible;
    }
  }

  dispose(): void {
    for (const overlay of this.overlays) {
      this.camera.remove(overlay.sprite);
      overlay.dispose();
    }
  }
}
