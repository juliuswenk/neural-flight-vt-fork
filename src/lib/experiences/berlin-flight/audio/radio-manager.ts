import * as THREE from "three";
import { BERLIN_RADIO_STATIONS } from "./radio-config";
import { BerlinRadioStation } from "./radio-station";

export class BerlinRadioManager {
  readonly group = new THREE.Group();
  private readonly stations: BerlinRadioStation[];

  constructor(listener: THREE.AudioListener) {
    this.group.name = "BerlinRadioStations";
    this.stations = BERLIN_RADIO_STATIONS.map((def) => {
      const station = new BerlinRadioStation(def, listener.context);
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
