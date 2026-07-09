import * as THREE from "three";
import type { RadioStationDef } from "./radio-config";
import { RADIO } from "./radio-config";

/**
 * A single live radio stream as a 3D positional audio source.
 *
 * This uses raw Web Audio API nodes instead of Three.js Audio/PositionalAudio
 * because live streams require MediaElementAudioSourceNode (from <audio> tag)
 * rather than AudioBufferSourceNode (for short buffers).
 *
 * Web Audio chain:
 *   <audio> → MediaElementAudioSourceNode → PannerNode → GainNode → destination
 *
 * The panner position is updated via updateMatrixWorld(), called automatically
 * by the Three.js renderer when the parent scene graph changes.
 */
const PROXY_BASE = "/api/radio/proxy";

export class RadioStation {
  readonly id: string;
  readonly name: string;
  readonly object3D: THREE.Object3D;
  readonly streamUrl: string;
  readonly baseVolume: number;
  private audioElement: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private pannerNode: PannerNode | null = null;
  private gainNode: GainNode | null = null;
  private _playing = false;
  private _volume: number;
  private audioContext: AudioContext;
  private def: RadioStationDef;

  constructor(def: RadioStationDef, listener: THREE.AudioListener) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.streamUrl = `${PROXY_BASE}?url=${encodeURIComponent(def.url)}`;
    this.baseVolume = def.volume;
    this._volume = def.volume;
    this.audioContext = listener.context;

    this.object3D = new THREE.Object3D();
    this.object3D.name = `radio-${def.id}`;
    this.object3D.position.set(def.position.x, def.position.y, def.position.z);

    this.setupCustomUpdateMatrixWorld();
    this.addDebugMarker();
  }

  get playing(): boolean {
    return this._playing;
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(v, this.audioContext.currentTime);
    }
  }

  start(): void {
    if (this._playing) return;

    const proxiedUrl = this.streamUrl;

    const audioCtx = this.audioContext;

    const audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    audioEl.src = proxiedUrl;
    audioEl.loop = false;
    audioEl.autoplay = true;
    audioEl.preload = "none";
    this.audioElement = audioEl;

    const sourceNode = audioCtx.createMediaElementSource(audioEl);
    this.sourceNode = sourceNode;

    const pannerNode = audioCtx.createPanner();
    pannerNode.panningModel = "HRTF";
    pannerNode.distanceModel = RADIO.DISTANCE_MODEL;
    pannerNode.refDistance = this.def.refDistance;
    pannerNode.maxDistance = this.def.maxDistance;
    pannerNode.rolloffFactor = RADIO.ROLLOFF_FACTOR;
    if (this.def.coneInnerAngle !== undefined) {
      pannerNode.coneInnerAngle = this.def.coneInnerAngle;
      pannerNode.coneOuterAngle = this.def.coneOuterAngle ?? 360;
      pannerNode.coneOuterGain = this.def.coneOuterGain ?? 0;
    }
    this.pannerNode = pannerNode;

    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(this._volume, audioCtx.currentTime);
    this.gainNode = gainNode;

    sourceNode.connect(pannerNode);
    pannerNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    audioEl.play().catch((err: unknown) => {
      console.warn(`[RadioStation:${this.id}] play failed:`, err);
    });

    this._playing = true;
    this.syncPannerPosition();
  }

  stop(): void {
    if (!this._playing) return;

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
    this._playing = false;
  }

  dispose(): void {
    this.stop();
    const parent = this.object3D.parent;
    if (parent) {
      parent.remove(this.object3D);
    }
  }

  /** Keep panner position in sync with the object's world position each frame */
  private setupCustomUpdateMatrixWorld(): void {
    const original = this.object3D.updateMatrixWorld.bind(this.object3D);
    const self = this;
    this.object3D.updateMatrixWorld = function (force: boolean) {
      original(force);
      if (self._playing && self.pannerNode) {
        const pos = new THREE.Vector3();
        this.getWorldPosition(pos);
        const ctx = self.audioContext;
        const t = ctx.currentTime;
        self.pannerNode.positionX.setValueAtTime(pos.x, t);
        self.pannerNode.positionY.setValueAtTime(pos.y, t);
        self.pannerNode.positionZ.setValueAtTime(pos.z, t);
      }
    };
  }

  private syncPannerPosition(): void {
    this.object3D.updateMatrixWorld(true);
  }

  /** Update panner distance parameters live (after start()) */
  setPannerParams(refDistance: number, maxDistance: number): void {
    if (this.pannerNode) {
      this.pannerNode.refDistance = refDistance;
      this.pannerNode.maxDistance = maxDistance;
    }
  }

  /** Semi-transparent marker sphere so stations are visible in the world */
  private addDebugMarker(): void {
    const geo = new THREE.SphereGeometry(1.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(0, 2, 0);
    this.object3D.add(sphere);
  }
}
