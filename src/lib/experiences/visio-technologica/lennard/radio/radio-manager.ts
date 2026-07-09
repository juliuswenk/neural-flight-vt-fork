import * as THREE from "three";
import { RadioStation } from "./radio-station";
import { RADIO_STATIONS } from "./radio-config";
import type { RadioStationDef } from "./radio-config";

/**
 * Manages a collection of 3D positional radio stations in the world.
 *
 * Lifecycle:
 *   const mgr = new RadioManager(listener);
 *   world.add(mgr.group);
 *   mgr.start();
 *   // ... tick() each frame ...
 *   mgr.dispose();
 */
export class RadioManager {
  readonly group: THREE.Group;
  private stations: RadioStation[] = [];
  private _started = false;

  constructor(listener: THREE.AudioListener) {
    this.group = new THREE.Group();
    this.group.name = "radio-stations";

    this.stations = RADIO_STATIONS.map((def: RadioStationDef) => {
      const station = new RadioStation(def, listener);
      this.group.add(station.object3D);
      return station;
    });
  }

  get started(): boolean {
    return this._started;
  }

  /**
   * Begin streaming all stations.
   *
   * AudioContext must be in "running" state (user gesture required).
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    for (const station of this.stations) {
      station.start();
    }
  }

  stop(): void {
    for (const station of this.stations) {
      station.stop();
    }
    this._started = false;
  }

  /**
   * Set master volume for all stations (0–1).
   * Individual station volumes are scaled by the master.
   */
  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const station of this.stations) {
      station.volume = station.baseVolume * clamped;
    }
  }

  /**
   * Per-frame update — reserved for future cross-fade / ducking logic.
   * Panner position is synced automatically via custom updateMatrixWorld.
   */
  tick(_delta: number): void {
    // Reserved for future cross-fade / ducking logic
  }

  dispose(): void {
    this.stop();
    for (const station of this.stations) {
      station.dispose();
    }
    this.stations = [];
    const parent = this.group.parent;
    if (parent) {
      parent.remove(this.group);
    }
  }
}