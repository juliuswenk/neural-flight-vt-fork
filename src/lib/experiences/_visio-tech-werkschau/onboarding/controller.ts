import type { PerspectiveCamera } from "three";
import {
  SEQ,
  SequenceController,
  type StageState,
} from "../lennard/scripts/sequence-controller";

const WERKSCHAU_FULL_EXPERIENCE_STAGE_INDEX = 3;
const WERKSCHAU_ONBOARDING_DURATION_MS =
  SEQ.stages
    .slice(0, WERKSCHAU_FULL_EXPERIENCE_STAGE_INDEX)
    .reduce((total, stage) => total + stage.durationSeconds, 0) * 1000;
const WERKSCHAU_SHUTDOWN_DELAY_SECONDS = 3;

export interface WerkschauOnboardingController {
  readonly durationMs: number;
  progress: number;
  isActive: boolean;
  isComplete: boolean;
  hasEnded: boolean;
  shutdownProgress: number;
  isShutdownEffectActive: boolean;
  update(deltaSeconds: number): void;
  skip(): void;
  dispose(): void;
}

export function createWerkschauOnboardingController(
  camera: PerspectiveCamera,
): WerkschauOnboardingController {
  let started = false;
  const sequence = new SequenceController(camera, (event, stage) => {
    if (event === "complete") {
      controller.hasEnded = true;
    }
    if (event === "stageStart" && shouldStartFullExperience(stage)) {
      controller.progress = 1;
      controller.isActive = false;
      controller.isComplete = true;
    }
    if (event === "stageStart" && shouldStartShutdownEffect(stage)) {
      shutdownDelayRemaining = WERKSCHAU_SHUTDOWN_DELAY_SECONDS;
      shutdownElapsedSeconds = 0;
      shutdownDurationSeconds = stage.duration;
      controller.shutdownProgress = 0;
      controller.isShutdownEffectActive = true;
    }
  });
  let shutdownElapsedSeconds = 0;
  let shutdownDurationSeconds = 1;
  let shutdownDelayRemaining = 0;

  const controller: WerkschauOnboardingController = {
    durationMs: WERKSCHAU_ONBOARDING_DURATION_MS,
    progress: 0,
    isActive: true,
    isComplete: false,
    hasEnded: false,
    shutdownProgress: 0,
    isShutdownEffectActive: false,
    update(deltaSeconds: number): void {
      const safeDelta = Math.max(0, deltaSeconds);
      if (!started) {
        started = true;
        sequence.start();
      }
      sequence.update(safeDelta);
      if (this.isShutdownEffectActive) {
        if (shutdownDelayRemaining > 0) {
          shutdownDelayRemaining = Math.max(
            0,
            shutdownDelayRemaining - safeDelta,
          );
        } else {
          shutdownElapsedSeconds = Math.min(
            shutdownDurationSeconds,
            shutdownElapsedSeconds + safeDelta,
          );
          this.shutdownProgress =
            shutdownElapsedSeconds / shutdownDurationSeconds;
          this.isShutdownEffectActive = this.shutdownProgress < 1;
        }
      }
    },
    skip(): void {
      if (this.isComplete || this.hasEnded) return;
      sequence.advanceTo(WERKSCHAU_FULL_EXPERIENCE_STAGE_INDEX);
    },
    dispose(): void {
      sequence.stop();
    },
  };

  return controller;
}

function shouldStartFullExperience(stage: StageState): boolean {
  return stage.index >= WERKSCHAU_FULL_EXPERIENCE_STAGE_INDEX;
}

function shouldStartShutdownEffect(stage: StageState): boolean {
  return stage.factory === "blink";
}
