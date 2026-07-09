<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { RadioManager } from "$lib/experiences/visio-technologica/lennard/radio/radio-manager";
  import { RADIO_STATIONS } from "$lib/experiences/visio-technologica/lennard/radio/radio-config";
  import { RADIO } from "$lib/experiences/visio-technologica/lennard/radio/radio-config";
  import type { RadioStationDef } from "$lib/experiences/visio-technologica/lennard/radio/radio-config";

  let canvas: HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  let controls: OrbitControls;
  let radioManager: RadioManager;
  let started = $state(false);
  let statusLog = $state<string[]>([]);
  let audioContext: AudioContext | null = null;

  // Per-station editable state
  let stationStates = $state(
    RADIO_STATIONS.map((def) => ({
      id: def.id,
      name: def.name,
      pos: { x: def.position.x, y: def.position.y, z: def.position.z },
      volume: def.volume * RADIO.VOLUME,
      refDistance: def.refDistance,
      maxDistance: def.maxDistance,
    })),
  );

  let updateVisuals: () => void = () => {};

  function log(msg: string) {
    statusLog = [...statusLog.slice(-19), msg];
  }

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      800,
    );
    camera.position.set(0, 5, 30);

    controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.update();

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 100, 30);
    scene.add(dirLight);

    // Ground grid
    const gridHelper = new THREE.GridHelper(500, 50, 0x444466, 0x333355);
    scene.add(gridHelper);

    // Audio listener on camera
    const listener = new THREE.AudioListener();
    audioContext = listener.context;
    log(`AudioContext state: ${audioContext.state}`);
    camera.add(listener);

    // Radio manager
    radioManager = new RadioManager(listener);
    scene.add(radioManager.group);

    // --- visual helpers ---
    function createRadiusRing(
      center: THREE.Vector3,
      radius: number,
      color: number = 0x00ffaa,
    ): THREE.Mesh {
      const segs = 48;
      const geo = new THREE.BufferGeometry();
      const verts: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        verts.push(center.x + Math.cos(theta) * radius, 0.1, center.z + Math.sin(theta) * radius);
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      });
      return new THREE.Line(geo, mat);
    }

    function createAxisLine(
      from: THREE.Vector3,
      to: THREE.Vector3,
      color: number,
    ): THREE.Line {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [from.x, from.y, from.z, to.x, to.y, to.z],
          3,
        ),
      );
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      return new THREE.Line(geo, mat);
    }

    // store references for rebuilding
    const ringGroup = new THREE.Group();
    const axisGroup = new THREE.Group();
    scene.add(ringGroup);
    scene.add(axisGroup);

    const clock = new THREE.Clock();

    updateVisuals = () => {
      // clear old visuals
      while (ringGroup.children.length) {
        const c = ringGroup.children[0];
        ringGroup.remove(c);
        if (c instanceof THREE.Line) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      }
      while (axisGroup.children.length) {
        const c = axisGroup.children[0];
        axisGroup.remove(c);
        if (c instanceof THREE.Line) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      }

      // rebuild visuals per station
      for (const st of stationStates) {
        const pos = new THREE.Vector3(st.pos.x, st.pos.y, st.pos.z);

        // radius ring at ground level (maxDistance)
        const ring = createRadiusRing(pos, st.maxDistance, 0x00ffaa);
        ringGroup.add(ring);

        // refDistance ring (inner)
        const innerRing = createRadiusRing(pos, st.refDistance, 0x44ffcc);
        (innerRing.material as THREE.Material).color = new THREE.Color(0x44ffcc);
        (innerRing.material as THREE.Material).opacity = 0.15;
        (innerRing.material as THREE.Material).transparent = true;
        ringGroup.add(innerRing);

        // X axis line (red)
        const xLine = createAxisLine(
          new THREE.Vector3(pos.x - 8, pos.y, pos.z),
          new THREE.Vector3(pos.x + 8, pos.y, pos.z),
          0xff4444,
        );
        axisGroup.add(xLine);

        // Y axis line (green)
        const yLine = createAxisLine(
          new THREE.Vector3(pos.x, pos.y - 8, pos.z),
          new THREE.Vector3(pos.x, pos.y + 8, pos.z),
          0x44ff44,
        );
        axisGroup.add(yLine);

        // Z axis line (blue)
        const zLine = createAxisLine(
          new THREE.Vector3(pos.x, pos.y, pos.z - 8),
          new THREE.Vector3(pos.x, pos.y, pos.z + 8),
          0x4444ff,
        );
        axisGroup.add(zLine);
      }
    };
    updateVisuals();

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      radioManager.tick(delta);
      controls.update();
      renderer.render(scene, camera);
    });

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);
  });

  onDestroy(() => {
    renderer?.setAnimationLoop(null);
    radioManager?.dispose();
    controls?.dispose();
    renderer?.dispose();
  });

  async function toggleRadio() {
    if (!audioContext) return;
    if (started) {
      radioManager.stop();
      started = false;
      log("Stopped");
      return;
    }
    if (audioContext.state === "suspended") {
      log("Resuming AudioContext...");
      await audioContext.resume();
      log(`AudioContext state: ${audioContext.state}`);
    }
    if (audioContext.state !== "running") {
      log(`Cannot start: AudioContext is ${audioContext.state}`);
      return;
    }
    radioManager.start();
    started = true;
    log("Radio started");
  }

  function applyStation(index: number) {
    const st = stationStates[index];
    const station = radioManager["stations"][index] as unknown as {
      object3D: THREE.Object3D;
      setPannerParams(refDistance: number, maxDistance: number): void;
      volume: number;
    } | undefined;
    if (!station) return;
    station.object3D.position.set(st.pos.x, st.pos.y, st.pos.z);
    station.setPannerParams(st.refDistance, st.maxDistance);
    station.volume = st.volume;
    updateVisuals();
    log(`${st.name}: pos=(${st.pos.x},${st.pos.y},${st.pos.z}) ref=${st.refDistance} max=${st.maxDistance} vol=${st.volume.toFixed(2)}`);
  }

  function clamp(v: number, min: number, max: number) {
    return Math.round(Math.min(max, Math.max(min, v)));
  }
</script>

<div class="ui">
  <div class="panel">
    <h2>Radio Test — Tuning Tool</h2>
    <p class="hint">Orbit to hear HRTF spatial audio · Adjust sliders live</p>

    <button onclick={toggleRadio} class={started ? "active" : ""}>
      {started ? "⏹ Stop" : "▶ Start"} Radio
    </button>

    <div class="stations">
      {#each stationStates as st, i}
        <div class="station-card">
          <div class="station-header">
            <span class="station-name" style="color:#00ffaa">{st.name}</span>
            <span class="station-id">{st.id}</span>
          </div>

          <!-- Position X -->
          <label>
            X <span class="val">{clamp(st.pos.x, -400, 400)}</span>
            <input
              type="range"
              min="-400"
              max="400"
              step="1"
              bind:value={st.pos.x}
              oninput={() => applyStation(i)}
            />
          </label>

          <!-- Position Y -->
          <label>
            Y <span class="val">{clamp(st.pos.y, -20, 80)}</span>
            <input
              type="range"
              min="-20"
              max="80"
              step="1"
              bind:value={st.pos.y}
              oninput={() => applyStation(i)}
            />
          </label>

          <!-- Position Z -->
          <label>
            Z <span class="val">{clamp(st.pos.z, -400, 400)}</span>
            <input
              type="range"
              min="-400"
              max="400"
              step="1"
              bind:value={st.pos.z}
              oninput={() => applyStation(i)}
            />
          </label>

          <div class="divider"></div>

          <!-- refDistance -->
          <label>
            refDistance <span class="val">{st.refDistance}</span>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              bind:value={st.refDistance}
              oninput={() => applyStation(i)}
            />
          </label>

          <!-- maxDistance (radius) -->
          <label>
            maxDistance (radius) <span class="val">{st.maxDistance}</span>
            <input
              type="range"
              min="10"
              max="400"
              step="1"
              bind:value={st.maxDistance}
              oninput={() => applyStation(i)}
            />
          </label>

          <!-- Volume -->
          <label>
            Volume <span class="val">{st.volume.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              bind:value={st.volume}
              oninput={() => applyStation(i)}
            />
          </label>
        </div>
      {/each}
    </div>

    {#if statusLog.length > 0}
      <div class="log">
        {#each statusLog as msg}
          <div class="log-line">{msg}</div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    display: block;
    width: 100vw;
    height: 100vh;
  }
  :global(body) {
    margin: 0;
    overflow: hidden;
    font-family: system-ui, sans-serif;
  }

  .ui {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 10;
    pointer-events: none;
    max-height: 95vh;
    display: flex;
    flex-direction: column;
  }

  .panel {
    background: rgba(10, 10, 20, 0.88);
    border: 1px solid #333;
    border-radius: 12px;
    padding: 16px;
    min-width: 290px;
    max-width: 320px;
    pointer-events: auto;
    backdrop-filter: blur(8px);
    overflow-y: auto;
    max-height: calc(95vh - 32px);
  }

  ::-webkit-scrollbar {
    width: 4px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 2px;
  }

  h2 {
    margin: 0 0 2px;
    font-size: 1.05rem;
    color: #00ffaa;
  }
  .hint {
    margin: 0 0 12px;
    font-size: 0.75rem;
    color: #666;
  }

  button {
    display: block;
    width: 100%;
    padding: 9px 16px;
    border: 1px solid #00ffaa;
    border-radius: 8px;
    background: transparent;
    color: #00ffaa;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 12px;
    transition: all 0.15s;
  }
  button:hover {
    background: rgba(0, 255, 170, 0.1);
  }
  button.active {
    background: #00ffaa;
    color: #0a0a14;
  }

  .stations {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .station-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #2a2a3a;
    border-radius: 8px;
    padding: 10px;
  }

  .station-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .station-name {
    font-weight: 600;
    font-size: 0.85rem;
  }
  .station-id {
    color: #555;
    font-size: 0.7rem;
    font-family: monospace;
  }

  label {
    display: grid;
    grid-template-columns: 1fr 32px;
    gap: 2px 6px;
    align-items: center;
    font-size: 0.75rem;
    color: #999;
    margin-bottom: 3px;
  }
  label .val {
    text-align: right;
    color: #ccc;
    font-family: monospace;
    font-size: 0.7rem;
  }
  input[type="range"] {
    grid-column: 1 / -1;
    width: 100%;
    margin: 0;
    accent-color: #00ffaa;
    height: 12px;
  }
  input[type="range"]::-webkit-slider-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #00ffaa;
    cursor: pointer;
  }

  .divider {
    border-top: 1px solid #2a2a3a;
    margin: 6px 0;
  }

  .log {
    border-top: 1px solid #333;
    margin-top: 12px;
    padding-top: 8px;
    font-size: 0.7rem;
    font-family: monospace;
    max-height: 100px;
    overflow-y: auto;
  }
  .log-line {
    color: #777;
    padding: 1px 0;
  }
</style>
