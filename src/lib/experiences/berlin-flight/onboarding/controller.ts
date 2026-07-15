import type { PerspectiveCamera } from "three";
import {
  SEQ,
  SequenceController,
  type StageState,
} from "../lennard/scripts/sequence-controller";

const BERLIN_FULL_EXPERIENCE_STAGE_INDEX = 3;
const BERLIN_ONBOARDING_DURATION_MS =
  SEQ.stages
    .slice(0, BERLIN_FULL_EXPERIENCE_STAGE_INDEX)
    .reduce((total, stage) => total + stage.durationSeconds, 0) * 1000;

export interface BerlinOnboardingController {
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

export function createBerlinOnboardingController(
  camera: PerspectiveCamera,
): BerlinOnboardingController {
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
      shutdownElapsedSeconds = 0;
      shutdownDurationSeconds = stage.duration;
      controller.shutdownProgress = 0;
      controller.isShutdownEffectActive = true;
    }
  });
  let shutdownElapsedSeconds = 0;
  let shutdownDurationSeconds = 1;

  const controller: BerlinOnboardingController = {
    durationMs: BERLIN_ONBOARDING_DURATION_MS,
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
        shutdownElapsedSeconds = Math.min(
          shutdownDurationSeconds,
          shutdownElapsedSeconds + safeDelta,
        );
        this.shutdownProgress = shutdownElapsedSeconds / shutdownDurationSeconds;
        this.isShutdownEffectActive = this.shutdownProgress < 1;
      }
    },
    skip(): void {
      if (this.isComplete || this.hasEnded) return;
      sequence.advanceTo(BERLIN_FULL_EXPERIENCE_STAGE_INDEX);
    },
    dispose(): void {
      sequence.stop();
    },
  };

  return controller;
}

function shouldStartFullExperience(stage: StageState): boolean {
  return stage.index >= BERLIN_FULL_EXPERIENCE_STAGE_INDEX;
}

function shouldStartShutdownEffect(stage: StageState): boolean {
  return stage.factory === "blink";
}
