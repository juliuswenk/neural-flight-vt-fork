// How long it takes the radio volume to ramp from silent to full once the
// flight starts, so playback never jumps from 0 to full volume in one frame.
const WERKSCHAU_AUDIO_RAMP_SECONDS = 1.2;

export interface WerkschauOnboardingAudio {
  onboardingGain: number;
  fullGain: number;
  update(isFlightActive: boolean, deltaSeconds: number): void;
  dispose(): void;
}

export function createWerkschauOnboardingAudio(): WerkschauOnboardingAudio {
  return {
    onboardingGain: 1,
    fullGain: 0,
    update(isFlightActive: boolean, deltaSeconds: number): void {
      const target = isFlightActive ? 1 : 0;
      const maxStep = Math.max(0, deltaSeconds) / WERKSCHAU_AUDIO_RAMP_SECONDS;
      this.fullGain =
        this.fullGain < target
          ? Math.min(target, this.fullGain + maxStep)
          : Math.max(target, this.fullGain - maxStep);
      this.onboardingGain = 1 - this.fullGain;
    },
    dispose(): void {
      this.onboardingGain = 0;
      this.fullGain = 0;
    },
  };
}
