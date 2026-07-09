export const BERLIN_ONBOARDING_DURATION_MS = 4000;

export interface BerlinOnboardingController {
  readonly durationMs: number;
  progress: number;
  isActive: boolean;
  isComplete: boolean;
  update(deltaSeconds: number): void;
}

export function createBerlinOnboardingController(): BerlinOnboardingController {
  let elapsedMs = 0;

  return {
    durationMs: BERLIN_ONBOARDING_DURATION_MS,
    progress: 0,
    isActive: true,
    isComplete: false,
    update(deltaSeconds: number): void {
      elapsedMs = Math.min(
        BERLIN_ONBOARDING_DURATION_MS,
        elapsedMs + Math.max(0, deltaSeconds) * 1000,
      );
      this.progress = elapsedMs / BERLIN_ONBOARDING_DURATION_MS;
      this.isComplete = this.progress >= 1;
      this.isActive = !this.isComplete;
    },
  };
}

export function runBerlinOnboardingControllerSelfCheck(): void {
  const controller = createBerlinOnboardingController();

  assert(controller.durationMs === 4000);
  assert(controller.progress === 0);
  assert(controller.isActive);
  assert(!controller.isComplete);

  controller.update(2);
  assert(controller.progress === 0.5);
  assert(controller.isActive);
  assert(!controller.isComplete);

  controller.update(10);
  assert(controller.progress === 1);
  assert(!controller.isActive);
  assert(controller.isComplete);

  controller.update(-1);
  assert(controller.progress === 1);
}

function assert(condition: boolean): void {
  if (!condition) {
    throw new Error("Berlin onboarding controller self-check failed");
  }
}
