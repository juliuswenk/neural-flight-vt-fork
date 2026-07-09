<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { RadioManager } from "$lib/experiences/visio-technologica/lennard/radio/radio-manager";
  import { RADIO_STATIONS } from "$lib/experiences/visio-technologica/lennard/radio/radio-config";

  let canvas: HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  let controls: OrbitControls;
  let radioManager: RadioManager;
  let started = $state(false);
  let masterVolume = $state(1.0);
  let statusLog = $state<string[]>([]);
  let audioContext: AudioContext | null = null;

  function log(msg: string) {
    statusLog = [...statusLog.slice(-9), msg];
  }

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);

    // Start camera close to KEXP (at origin) so you hear it immediately
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
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
    const gridHelper = new THREE.GridHelper(400, 40, 0x444466, 0x333355);
    scene.add(gridHelper);

    // Station markers
    for (const def of RADIO_STATIONS) {
      const pos = new THREE.Vector3(
        def.position.x,
        def.position.y,
        def.position.z,
      );

      // Base platform
      const platGeo = new THREE.CylinderGeometry(4, 4, 0.5, 16);
      const platMat = new THREE.MeshStandardMaterial({
        color: 0x222244,
        emissive: 0x00ffaa,
        emissiveIntensity: 0.15,
      });
      const plat = new THREE.Mesh(platGeo, platMat);
      plat.position.set(pos.x, pos.y - 0.25, pos.z);
      scene.add(plat);

      // Glowing pillar
      const pillarGeo = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x00ffaa,
        emissive: 0x00ffaa,
        emissiveIntensity: 0.5,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(pos.x, pos.y + 2, pos.z);
      scene.add(pillar);

      // Directional cone indicator
      if (def.coneInnerAngle !== undefined) {
        const coneLen = 20;
        const coneGeo = new THREE.ConeGeometry(6, coneLen, 16, 1, true);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0x00ffaa,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(pos.x, pos.y + 2, pos.z - coneLen / 2);
        cone.rotation.x = Math.PI / 2;
        scene.add(cone);
      }

      // Label sprite
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const ctx = labelCanvas.getContext("2d")!;
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.roundRect(0, 0, 512, 128, 16);
      ctx.fill();
      ctx.fillStyle = "#00ffaa";
      ctx.font = "bold 48px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.name, 256, 64);

      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.needsUpdate = true;
      const labelMat = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        depthWrite: false,
      });
      const label = new THREE.Sprite(labelMat);
      label.position.set(pos.x, pos.y + 8, pos.z);
      label.scale.set(12, 3, 1);
      scene.add(label);
    }

    // Audio listener on camera
    const listener = new THREE.AudioListener();
    audioContext = listener.context;
    log(`AudioContext state: ${audioContext.state}`);

    camera.add(listener);

    // Radio manager
    radioManager = new RadioManager(listener);
    scene.add(radioManager.group);
    radioManager.setMasterVolume(masterVolume);

    const clock = new THREE.Clock();

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

    // Resume AudioContext (required after user gesture)
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
    log("Radio started — playing through Web Audio + PannerNode");
  }

  function onVolumeChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    masterVolume = v;
    radioManager.setMasterVolume(v);
    log(`Master volume: ${Math.round(v * 100)}%`);
  }
</script>

<div class="ui">
  <div class="panel">
    <h2>Radio Test</h2>
    <p class="hint">Orbit to hear 3D positional audio (HRTF)</p>

    <button onclick={toggleRadio} class={started ? "active" : ""}>
      {started ? "⏹ Stop" : "▶ Start"} Radio
    </button>

    <label>
      Master Volume: {Math.round(masterVolume * 100)}%
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={masterVolume}
        oninput={onVolumeChange}
      />
    </label>

    <div class="stations">
      {#each RADIO_STATIONS as station}
        <div class="station">
          <span class="dot" style="background: #00ffaa"></span>
          <span class="name">{station.name}</span>
          <span class="pos"
            >({station.position.x}, {station.position.y}, {station.position.z})</span
          >
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

  <div class="tips">
    <strong>KEXP</strong> is at (0, 3, 0) — omni, 20m refDist, 200m maxDist.<br />
    <strong>NTS</strong> is at (160, 3, 160) — directional cone 120°, 15m refDist.
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
  }

  .panel {
    background: rgba(10, 10, 20, 0.85);
    border: 1px solid #333;
    border-radius: 12px;
    padding: 20px;
    min-width: 280px;
    pointer-events: auto;
    backdrop-filter: blur(8px);
  }

  h2 {
    margin: 0 0 4px;
    font-size: 1.1rem;
    color: #00ffaa;
  }

  .hint {
    margin: 0 0 16px;
    font-size: 0.8rem;
    color: #888;
  }

  button {
    display: block;
    width: 100%;
    padding: 10px 16px;
    border: 1px solid #00ffaa;
    border-radius: 8px;
    background: transparent;
    color: #00ffaa;
    font-size: 0.95rem;
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

  label {
    display: block;
    font-size: 0.85rem;
    color: #aaa;
    margin-bottom: 16px;
  }

  input[type="range"] {
    display: block;
    width: 100%;
    margin-top: 6px;
    accent-color: #00ffaa;
  }

  .stations {
    border-top: 1px solid #333;
    padding-top: 12px;
    margin-bottom: 12px;
  }

  .station {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 0.85rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .name {
    color: #ccc;
    font-weight: 500;
  }

  .pos {
    color: #666;
    font-size: 0.75rem;
    margin-left: auto;
  }

  .log {
    border-top: 1px solid #333;
    padding-top: 8px;
    font-size: 0.75rem;
    font-family: monospace;
    max-height: 120px;
    overflow-y: auto;
  }

  .log-line {
    color: #888;
    padding: 1px 0;
  }

  .tips {
    margin-top: 8px;
    font-size: 0.7rem;
    color: #555;
    line-height: 1.4;
    pointer-events: auto;
  }
</style>
