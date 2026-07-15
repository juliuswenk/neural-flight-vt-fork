import type { Scene } from "three";
import type { WerkschauState } from "./types";

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: WerkschauState,
  _scene: Scene,
): void {
  if (id !== "moveSpeed" || typeof value !== "number") return;

  state.targetSpeed = value;
}
