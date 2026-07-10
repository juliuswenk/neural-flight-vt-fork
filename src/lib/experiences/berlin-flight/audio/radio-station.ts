import * as THREE from "three";
import { BERLIN_RADIO, type BerlinRadioStationDef } from "./radio-config";

const PROXY_BASE = "/api/radio/proxy";

export class BerlinRadioStation {
  readonly id: string;
  readonly name: string;
  readonly object3D: THREE.Object3D;
  readonly baseVolume: number;
  private audioElement: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private pannerNode: PannerNode | null = null;
  private gainNode: GainNode | null = null;
  private marker: THREE.Mesh | null = null;
  private playing = false;
  private volume: number;

  constructor(
    private readonly def: BerlinRadioStationDef,
    private readonly audioContext: AudioContext,
  ) {
    this.id = def.id;
    this.name = def.name;
    this.baseVolume = def.volume;
    this.volume = def.volume;

    this.object3D = new THREE.Object3D();
    this.object3D.name = `berlin-radio-${def.id}`;
    this.object3D.position.set(def.position.x, def.position.y, def.position.z);
    this.setupPannerSync();
    this.addDebugMarker();
  }

  start(): void {
    if (this.playing) return;

    const audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.src = `${PROXY_BASE}?url=${encodeURIComponent(this.def.url)}`;
    audioElement.preload = "none";
    this.audioElement = audioElement;

    const sourceNode = this.audioContext.createMediaElementSource(audioElement);
    const pannerNode = this.audioContext.createPanner();
    pannerNode.panningModel = "HRTF";
    pannerNode.distanceModel = BERLIN_RADIO.DISTANCE_MODEL;
    pannerNode.refDistance = this.def.refDistance;
    pannerNode.maxDistance = this.def.maxDistance;
    pannerNode.rolloffFactor = BERLIN_RADIO.ROLLOFF_FACTOR;
    if (this.def.coneInnerAngle !== undefined) {
      pannerNode.coneInnerAngle = this.def.coneInnerAngle;
      pannerNode.coneOuterAngle = this.def.coneOuterAngle ?? 360;
      pannerNode.coneOuterGain = this.def.coneOuterGain ?? 0;
    }

    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);

    sourceNode.connect(pannerNode);
    pannerNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    this.sourceNode = sourceNode;
    this.pannerNode = pannerNode;
    this.gainNode = gainNode;
    this.playing = true;
    this.object3D.updateMatrixWorld(true);

    audioElement.play().catch((error: unknown) => {
      console.warn(`[BerlinRadio:${this.id}] play failed:`, error);
    });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.gainNode?.gain.setValueAtTime(volume, this.audioContext.currentTime);
  }

  stop(): void {
    if (!this.playing) return;

    this.sourceNode?.disconnect();
    this.pannerNode?.disconnect();
    this.gainNode?.disconnect();
    this.audioElement?.pause();
    this.audioElement?.removeAttribute("src");
    this.audioElement?.load();

    this.audioElement = null;
    this.sourceNode = null;
    this.pannerNode = null;
    this.gainNode = null;
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    this.object3D.removeFromParent();
    this.marker?.geometry.dispose();
    if (this.marker?.material instanceof THREE.Material) {
      this.marker.material.dispose();
    }
    this.marker = null;
  }

  private setupPannerSync(): void {
    const originalUpdateMatrixWorld =
      this.object3D.updateMatrixWorld.bind(this.object3D);

    this.object3D.updateMatrixWorld = (force: boolean): void => {
      originalUpdateMatrixWorld(force);
      if (!this.playing || !this.pannerNode) return;

      const position = new THREE.Vector3();
      this.object3D.getWorldPosition(position);
      const time = this.audioContext.currentTime;
      this.pannerNode.positionX.setValueAtTime(position.x, time);
      this.pannerNode.positionY.setValueAtTime(position.y, time);
      this.pannerNode.positionZ.setValueAtTime(position.z, time);
    };
  }

  private addDebugMarker(): void {
    const geometry = new THREE.SphereGeometry(1.5, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.marker = new THREE.Mesh(geometry, material);
    this.marker.position.y = 2;
    this.object3D.add(this.marker);
  }
}
