import * as THREE from "three";
import { WERKSCHAU_RADIO_STATIONS } from "./radio-config";
import { WerkschauRadioStation } from "./radio-station";

export class WerkschauRadioManager {
  readonly group = new THREE.Group();
  private readonly stations: WerkschauRadioStation[];

  constructor(listener: THREE.AudioListener) {
    this.group.name = "WerkschauRadioStations";
    this.stations = WERKSCHAU_RADIO_STATIONS.map((def) => {
      const station = new WerkschauRadioStation(def, listener.context);
      this.group.add(station.object3D);
      return station;
    });
  }

  get isStarted(): boolean {
    return this.stations.some((station) => station.isPlaying);
  }

  start(): void {
    for (const station of this.stations) {
      station.start();
    }
  }

  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const station of this.stations) {
      station.setVolume(station.baseVolume * clamped);
    }
  }

  dispose(): void {
    for (const station of this.stations) {
      station.dispose();
    }
    this.group.removeFromParent();
  }
}
