import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  createWerkschauNeutralTileMaterial,
  disposeMaterial,
} from "../runtime/tiles-material";
import { WERKSCHAU_RADIO, type WerkschauRadioStationDef } from "./radio-config";

const PROXY_BASE = "/api/radio/proxy";
const RADIO_MARKER_MODEL_URL =
  "/experiences/_visio-tech-werkschau/inc3d_comm_tower.obj";

export class WerkschauRadioStation {
  readonly id: string;
  readonly name: string;
  readonly object3D: THREE.Object3D;
  readonly baseVolume: number;
  private audioElement: HTMLAudioElement | null = null;
  private sourceNode:
    | MediaElementAudioSourceNode
    | AudioBufferSourceNode
    | null = null;
  private pannerNode: PannerNode | null = null;
  private gainNode: GainNode | null = null;
  private marker: THREE.Group | null = null;
  private disposed = false;
  private playing = false;
  private volume: number;

  constructor(
    private readonly def: WerkschauRadioStationDef,
    private readonly audioContext: AudioContext,
  ) {
    this.id = def.id;
    this.name = def.name;
    this.baseVolume = def.volume;
    this.volume = def.volume;

    this.object3D = new THREE.Object3D();
    this.object3D.name = `werkschau-radio-${def.id}`;
    this.object3D.position.set(def.position.x, def.position.y, def.position.z);
    if (!def.globalBackground) {
      this.setupPannerSync();
      this.addDebugMarker();
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) return;

    const isCorsFriendly = this.def.url.includes("dispatcher.rndfnk.com");
    const streamUrl = this.def.url.startsWith("/") || isCorsFriendly
      ? this.def.url
      : `${PROXY_BASE}?url=${encodeURIComponent(this.def.url)}`;

    if (this.def.loop && this.def.globalBackground) {
      void this.startLoopingBuffer(streamUrl);
      return;
    }

    const audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.src = streamUrl;
    audioElement.preload = "none";
    this.audioElement = audioElement;

    const sourceNode = this.audioContext.createMediaElementSource(audioElement);
    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);

    if (this.def.globalBackground) {
      sourceNode.connect(gainNode);
    } else {
      const pannerNode = this.audioContext.createPanner();
      pannerNode.panningModel = "HRTF";
      pannerNode.distanceModel = WERKSCHAU_RADIO.DISTANCE_MODEL;
      pannerNode.refDistance = this.def.refDistance;
      pannerNode.maxDistance = this.def.maxDistance;
      pannerNode.rolloffFactor = WERKSCHAU_RADIO.ROLLOFF_FACTOR;
      if (this.def.coneInnerAngle !== undefined) {
        pannerNode.coneInnerAngle = this.def.coneInnerAngle;
        pannerNode.coneOuterAngle = this.def.coneOuterAngle ?? 360;
        pannerNode.coneOuterGain = this.def.coneOuterGain ?? 0;
      }
      sourceNode.connect(pannerNode);
      pannerNode.connect(gainNode);
      this.pannerNode = pannerNode;
    }
    gainNode.connect(this.audioContext.destination);

    this.sourceNode = sourceNode;
    this.gainNode = gainNode;
    this.playing = true;
    this.object3D.updateMatrixWorld(true);

    audioElement.play().catch((error: unknown) => {
      console.warn(`[WerkschauRadio:${this.id}] play failed:`, error);
      this.stop();
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
    if (this.sourceNode instanceof AudioBufferSourceNode) {
      this.sourceNode.stop();
    }
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
    this.disposed = true;
    this.object3D.removeFromParent();
    disposeObject(this.marker);
    this.marker = null;
  }

  private async startLoopingBuffer(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      const audioBuffer = await this.audioContext.decodeAudioData(
        await response.arrayBuffer(),
      );
      const sourceNode = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      sourceNode.buffer = audioBuffer;
      sourceNode.loop = true;
      gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
      sourceNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      this.sourceNode = sourceNode;
      this.gainNode = gainNode;
      this.playing = true;
      sourceNode.start();
    } catch (error: unknown) {
      console.warn(`[WerkschauRadio:${this.id}] loop buffer failed:`, error);
    }
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
    const marker = new THREE.Group();
    this.marker = marker;
    this.object3D.add(marker);

    new OBJLoader().load(RADIO_MARKER_MODEL_URL, (object) => {
      if (this.disposed) {
        disposeObject(object);
        return;
      }

      const disposedSourceMaterials = new WeakSet<THREE.Material>();
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const sourceMaterial = child.material;
          child.material = createWerkschauNeutralTileMaterial(sourceMaterial);
          disposeMaterial(sourceMaterial, disposedSourceMaterials);
        }
      });

      const bounds = new THREE.Box3().setFromObject(object);
      object.position.set(
        -(bounds.min.x + bounds.max.x) / 2,
        -bounds.min.y,
        -(bounds.min.z + bounds.max.z) / 2,
      );
      object.scale.setScalar(0.25);
      marker.add(object);
    });
  }
}

function disposeObject(object: THREE.Object3D | null): void {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else {
      child.material.dispose();
    }
  });
}
