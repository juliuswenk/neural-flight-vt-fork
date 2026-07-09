import type * as THREE from "three";
import type { ExperienceState } from "../types";
import type { VisioTechnologicaState } from "./scene";

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  _scene: THREE.Scene,
): void {
  const s = state as VisioTechnologicaState;

  switch (id) {
    case "radioVolume":
      s.radioManager.setMasterVolume(Number(value));
      break;
  }
}