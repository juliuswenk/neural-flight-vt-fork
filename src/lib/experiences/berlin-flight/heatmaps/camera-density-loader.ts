import type { BerlinCameraDensitySampler } from "./types";

let berlinCameraDensitySampler: BerlinCameraDensitySampler | null = null;

export function getBerlinCameraDensitySampler(): BerlinCameraDensitySampler | null {
  return berlinCameraDensitySampler;
}

export function setBerlinCameraDensitySamplerForTests(
  sampler: BerlinCameraDensitySampler | null,
): void {
  berlinCameraDensitySampler = sampler;
}
