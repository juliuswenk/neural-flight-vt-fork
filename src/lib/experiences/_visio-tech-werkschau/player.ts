import type { PlayerOrientationInput } from "../types";
import type { WerkschauState } from "./types";

export function updatePlayer(
  orientation: PlayerOrientationInput,
  speed: { accelerate: boolean; brake: boolean },
  state: WerkschauState,
  _delta: number,
): void {
  if (state.isDisposed) return;

  state.player.updateOrientation({
    type: "orientation",
    pitch: orientation.pitch,
    roll: orientation.roll,
    ...(orientation.yaw !== undefined ? { yaw: orientation.yaw } : {}),
    timestamp: 0,
  });

  state.player.updateSpeed({
    type: "speed",
    action: "accelerate",
    active: speed.accelerate,
    timestamp: 0,
  });
  state.player.updateSpeed({
    type: "speed",
    action: "brake",
    active: speed.brake,
    timestamp: 0,
  });
}
