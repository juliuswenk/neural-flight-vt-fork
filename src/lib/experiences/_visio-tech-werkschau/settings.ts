import type { Scene } from "three";
import type { WerkschauState } from "./types";

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: WerkschauState,
  _scene: Scene,
): void {
  switch (id) {
    case "moveSpeed":
      if (typeof value !== "number") return;
      state.targetSpeed = value;
      break;
    case "debugOverlay":
      if (typeof value !== "boolean") return;
      state.debugEnabled = value;
      state.coneRuntime.setDebugEnabled(value);
      break;
    default:
      break;
  }
}
