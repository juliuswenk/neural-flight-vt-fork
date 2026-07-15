import * as THREE from "three";
import type { WerkschauConeVolume } from "../collision/types";
import { WERKSCHAU_CONE_SPATIAL_AUDIO } from "../constants";

interface ActiveSource {
  panner: PannerNode;
  gain: GainNode;
  coneId: string;
}

export class WerkschauConeSpatialAudio {
  private readonly audioContext: AudioContext;
  private readonly buffer: AudioBuffer;
  private readonly activeSources: ActiveSource[] = [];
  private readonly pool: { panner: PannerNode; gain: GainNode }[] = [];
  private disposed = false;
  private started = false;

  private constructor(audioContext: AudioContext, buffer: AudioBuffer) {
    this.audioContext = audioContext;
    this.buffer = buffer;
    for (let i = 0; i < WERKSCHAU_CONE_SPATIAL_AUDIO.MAX_SOURCES; i++) {
      const panner = audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = WERKSCHAU_CONE_SPATIAL_AUDIO.DISTANCE_MODEL;
      panner.refDistance = WERKSCHAU_CONE_SPATIAL_AUDIO.REF_DISTANCE;
      panner.maxDistance = WERKSCHAU_CONE_SPATIAL_AUDIO.MAX_DISTANCE;
      panner.rolloffFactor = WERKSCHAU_CONE_SPATIAL_AUDIO.ROLLOFF_FACTOR;
      panner.connect(audioContext.destination);

      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0, audioContext.currentTime);
      gain.connect(panner);

      this.pool.push({ panner, gain });
    }
  }

  static async create(audioContext: AudioContext): Promise<WerkschauConeSpatialAudio> {
    const response = await fetch(WERKSCHAU_CONE_SPATIAL_AUDIO.SOUND_URL);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    return new WerkschauConeSpatialAudio(audioContext, buffer);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    for (const slot of this.pool) {
      const source = this.audioContext.createBufferSource();
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(slot.gain);
      source.start();
    }
  }

  update(
    cones: readonly WerkschauConeVolume[],
    playerPosition: THREE.Vector3,
  ): void {
    if (!this.started || this.disposed) return;

    const activationRadius = WERKSCHAU_CONE_SPATIAL_AUDIO.ACTIVATION_RADIUS;
    const activationRadiusSq = activationRadius * activationRadius;

    const nearbyCones: { cone: WerkschauConeVolume; distSq: number }[] = [];
    for (const cone of cones) {
      const dx = cone.tip.x - playerPosition.x;
      const dy = cone.tip.y - playerPosition.y;
      const dz = cone.tip.z - playerPosition.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < activationRadiusSq) {
        nearbyCones.push({ cone, distSq });
      }
    }

    nearbyCones.sort((a, b) => a.distSq - b.distSq);
    const maxSources = this.pool.length;
    const toActivate = nearbyCones.slice(0, maxSources);

    const desiredIds = new Set(toActivate.map((e) => e.cone.placementPointId));
    const time = this.audioContext.currentTime;

    for (const active of this.activeSources) {
      if (!desiredIds.has(active.coneId)) {
        active.gain.gain.linearRampToValueAtTime(0, time + 0.15);
        active.coneId = "";
      }
    }

    const freeSlots: typeof this.pool = [];
    for (const slot of this.pool) {
      if (!this.activeSources.some((a) => a.panner === slot.panner)) {
        freeSlots.push(slot);
      }
    }

    for (let i = 0; i < toActivate.length && i < freeSlots.length; i++) {
      const { cone, distSq } = toActivate[i];
      const slot = freeSlots[i];
      const coneId = cone.placementPointId;

      const existing = this.activeSources.find((a) => a.coneId === coneId);
      if (existing) {
        existing.panner.positionX.setValueAtTime(cone.tip.x, time);
        existing.panner.positionY.setValueAtTime(cone.tip.y, time);
        existing.panner.positionZ.setValueAtTime(cone.tip.z, time);
        continue;
      }

      slot.panner.positionX.setValueAtTime(cone.tip.x, time);
      slot.panner.positionY.setValueAtTime(cone.tip.y, time);
      slot.panner.positionZ.setValueAtTime(cone.tip.z, time);

      const normalizedDist = Math.sqrt(distSq) / activationRadius;
      const volume = WERKSCHAU_CONE_SPATIAL_AUDIO.VOLUME * (1 - normalizedDist);
      slot.gain.gain.linearRampToValueAtTime(volume, time + 0.15);

      this.activeSources.push({
        panner: slot.panner,
        gain: slot.gain,
        coneId,
      });
    }

    for (const active of this.activeSources) {
      if (active.coneId === "") {
        const idx = this.activeSources.indexOf(active);
        if (idx !== -1) this.activeSources.splice(idx, 1);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const time = this.audioContext.currentTime;
    for (const slot of this.pool) {
      slot.gain.gain.linearRampToValueAtTime(0, time + 0.1);
      setTimeout(() => {
        slot.gain.disconnect();
        slot.panner.disconnect();
      }, 200);
    }
    this.activeSources.length = 0;
    this.pool.length = 0;
  }
}
