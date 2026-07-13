export interface WerkschauOnboardingAudio {
  onboardingGain: number;
  fullGain: number;
  update(progress: number): void;
  dispose(): void;
}

export function createWerkschauOnboardingAudio(): WerkschauOnboardingAudio {
  return {
    onboardingGain: 1,
    fullGain: 0,
    update(progress: number): void {
      const fullGain = Math.min(1, Math.max(0, progress));
      this.fullGain = fullGain;
      this.onboardingGain = 1 - fullGain;
    },
    dispose(): void {
      this.onboardingGain = 0;
      this.fullGain = 0;
    },
  };
}
