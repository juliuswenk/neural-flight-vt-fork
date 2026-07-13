<script lang="ts">
    import {
        PUBLIC_ICAROS_EXPERIENCE_ID,
        PUBLIC_ICAROS_EXPERIENCE_TITLE,
        PUBLIC_ICAROS_HOST_ORIGIN,
    } from "$env/static/public";
    import { Trophy } from "lucide-svelte";
    import { onDestroy, onMount } from "svelte";
    import * as THREE from "three";
    import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
    import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
    import { CONTROLS } from "$lib/config/flight";
    import type { ActiveExperience } from "$lib/experiences/loader";
    import {
        getActiveExperienceId,
        loadExperience,
        unloadExperience,
    } from "$lib/experiences/loader";
    import type { PlayerOrientationInput } from "$lib/experiences/types";
    import { EXTERNAL_INPUT_GRACE_MS } from "$lib/experiences/visio-technologica/keyboard-camera-controls";
    import { createWebSocketClient } from "$lib/ws/client.svelte";
    import { createIcarosHostControlClient } from "$lib/ws/icaros-host-control-client";
    import { createIcarosHostRuntimeClient } from "$lib/ws/icaros-host-runtime-client";
    import {
        isOrientationData,
        isSettingsUpdate,
        isSpeedCommand,
    } from "$lib/ws/protocol";

    let canvas: HTMLCanvasElement;
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    const AR_EXPERIENCE_IDS = new Set([
        "berlin-flight",
        "_visio-tech-werkschau",
    ]);
    const AR_UNSUPPORTED_MESSAGE =
        "This experience requires browser AR passthrough support on this device and cannot start here.";

    let xrButton: HTMLElement | null = null;
    let score = $state(0);
    let experienceName = $state("ICAROS VR");
    let hasOutputs = $state(false);
    let blockingError = $state<string | null>(null);
    let isDesktopPreview = false;
    let lastProcessedTimestamp = 0;
    const hostOrigin = PUBLIC_ICAROS_HOST_ORIGIN.trim();
    const useIcarosHost = hostOrigin !== "";
    const ws = useIcarosHost ? null : createWebSocketClient();
    const hostControl = useIcarosHost
        ? createIcarosHostControlClient({ hostOrigin })
        : null;
    const hostRuntime = useIcarosHost
        ? createIcarosHostRuntimeClient({
              hostOrigin,
              experienceId: PUBLIC_ICAROS_EXPERIENCE_ID.trim() || "neural-flight-vr",
              title: PUBLIC_ICAROS_EXPERIENCE_TITLE.trim() || "Neural Flight VR",
          })
        : null;
    const clock = new THREE.Clock();

    let lastOrientation: PlayerOrientationInput = { pitch: 0, roll: 0 };
    let lastSpeed = { accelerate: false, brake: false };
    let lastOrientationReceivedAt = 0;
    let removeResizeListener: (() => void) | null = null;
    let removePreviewKeyboardListeners: (() => void) | null = null;
    let unsubscribeHostOrientation: (() => void) | null = null;

    onMount(() => {
        let mounted = true;

        if (hostControl !== null) {
            unsubscribeHostOrientation = hostControl.onOrientation(
                (orientation) => {
                    lastOrientation =
                        orientation.quality > 0
                            ? {
                                  pitch:
                                      orientation.roll *
                                      CONTROLS.PITCH_RANGE[1],
                                  roll:
                                      orientation.pitch *
                                      CONTROLS.ROLL_RANGE[1],
                                  ...(orientation.yaw !== undefined
                                      ? { yaw: orientation.yaw }
                                      : {}),
                              }
                            : { pitch: 0, roll: 0 };
                    lastOrientationReceivedAt = performance.now();
                },
            );
            hostControl.start();
            hostRuntime?.start();
        }

        scene = new THREE.Scene();
        const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        const experienceId = getActiveExperienceId();
        const isArExperience = AR_EXPERIENCE_IDS.has(experienceId);
        isDesktopPreview = isPreviewEnabled(window.location.search);
        if (isDesktopPreview) {
            removePreviewKeyboardListeners = createPreviewKeyboardInput();
        }

        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: !isArExperience,
            alpha: isArExperience,
        });
        if (isArExperience) {
            renderer.setClearColor(0x000000, 0);
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        void createXrEntryButton(experienceId, isDesktopPreview).then((button) => {
            if (!mounted || button === null) return;
            xrButton = button;
            document.body.appendChild(button);
        });

        // Load whichever experience is selected (persisted in localStorage)
        loadExperience(experienceId, {
            scene,
            camera: dummyCamera,
            renderer,
            previewMode: isDesktopPreview,
        }).then((exp: ActiveExperience) => {
            renderer.shadowMap.enabled = !AR_EXPERIENCE_IDS.has(exp.manifest.id);
            if (isArExperience) {
                scene.background = null;
            }
            experienceName = exp.manifest.name;
            hasOutputs = (exp.manifest.outputs?.length ?? 0) > 0;
            const renderCamera = exp.state.camera as THREE.PerspectiveCamera;

            function onResize(): void {
                renderCamera.aspect = window.innerWidth / window.innerHeight;
                renderCamera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }
            window.addEventListener("resize", onResize);
            removeResizeListener = () =>
                window.removeEventListener("resize", onResize);

            renderer.setAnimationLoop(() => {
                const delta = clock.getDelta();
                updatePreviewInput();

                const msg = ws?.lastMessage;
                if (!useIcarosHost && msg && msg.timestamp > lastProcessedTimestamp) {
                    lastProcessedTimestamp = msg.timestamp;

                    if (isOrientationData(msg)) {
                        lastOrientation = {
                            pitch: msg.pitch,
                            roll: msg.roll,
                            ...(msg.yaw !== undefined ? { yaw: msg.yaw } : {}),
                            ...(msg.rawPitch !== undefined
                                ? { rawPitch: msg.rawPitch }
                                : {}),
                            ...(msg.rawRoll !== undefined
                                ? { rawRoll: msg.rawRoll }
                                : {}),
                        };
                        lastOrientationReceivedAt = performance.now();
                    }
                    if (isSpeedCommand(msg)) {
                        lastSpeed = {
                            accelerate:
                                msg.action === "accelerate" && msg.active,
                            brake: msg.action === "brake" && msg.active,
                        };
                    }
                    if (isSettingsUpdate(msg)) {
                        for (const key of Object.keys(msg.settings)) {
                            exp.manifest.applySettings(
                                key,
                                msg.settings[key] as number | boolean | string,
                                exp.state,
                                scene,
                            );
                        }
                    }
                }

                const isVisioTechnologica =
                    exp.manifest.id === "visio-technologica";
                const orientationIsFresh =
                    performance.now() - lastOrientationReceivedAt <=
                    EXTERNAL_INPUT_GRACE_MS;
                const effectiveOrientation =
                    isVisioTechnologica && !orientationIsFresh
                        ? { pitch: Number.NaN, roll: Number.NaN }
                        : lastOrientation;

                exp.manifest.updatePlayer(
                    effectiveOrientation,
                    lastSpeed,
                    exp.state,
                    delta,
                );
                const result = exp.manifest.tick(exp.state, {
                    delta,
                    elapsed: clock.elapsedTime,
                    camera: renderCamera,
                    playerPosition:
                        renderCamera.parent?.position ?? new THREE.Vector3(),
                    playerRotation:
                        renderCamera.parent?.rotation ?? new THREE.Euler(),
                });
                exp.state = result.state;
                if (result.outputs?.score !== undefined) {
                    score = result.outputs.score as number;
                }

                renderer.render(scene, renderCamera);
            });
        });

        return () => {
            mounted = false;
            removeResizeListener?.();
        };
    });

    async function createXrEntryButton(
        experienceId: string,
        previewMode: boolean,
    ): Promise<HTMLElement | null> {
        if (previewMode) {
            return null;
        }

        if (!AR_EXPERIENCE_IDS.has(experienceId)) {
            return VRButton.createButton(renderer);
        }

        const supportsImmersiveAr =
            navigator.xr !== undefined &&
            navigator.xr.isSessionSupported !== undefined
                ? await navigator.xr
                      .isSessionSupported("immersive-ar")
                      .catch(() => false)
                : false;

        if (!supportsImmersiveAr) {
            blockingError = AR_UNSUPPORTED_MESSAGE;
            return null;
        }

        return ARButton.createButton(renderer);
    }

    const previewKeys = new Set<string>();

    function createPreviewKeyboardInput(): () => void {
        const onKeyDown = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            if (!isPreviewKey(key)) return;
            event.preventDefault();
            previewKeys.add(key);
        };
        const onKeyUp = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            if (!isPreviewKey(key)) return;
            event.preventDefault();
            previewKeys.delete(key);
        };
        const onBlur = (): void => previewKeys.clear();

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);

        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
            previewKeys.clear();
        };
    }

    function updatePreviewInput(): void {
        if (!isDesktopPreview) return;

        const pitch =
            (previewKeys.has("arrowup") ? -1 : 0) +
            (previewKeys.has("arrowdown") ? 1 : 0);
        const roll =
            (previewKeys.has("arrowleft") ? -1 : 0) +
            (previewKeys.has("arrowright") ? 1 : 0);

        lastOrientation = {
            pitch: pitch * CONTROLS.STEP_DEGREES,
            roll: roll * CONTROLS.STEP_DEGREES,
        };
        lastSpeed = {
            accelerate: previewKeys.has("w"),
            brake: previewKeys.has("s"),
        };
        lastOrientationReceivedAt = performance.now();
    }

    function isPreviewKey(key: string): boolean {
        return (
            key === "w" ||
            key === "s" ||
            key === "arrowup" ||
            key === "arrowdown" ||
            key === "arrowleft" ||
            key === "arrowright"
        );
    }

    function isPreviewEnabled(search: string): boolean {
        const preview = new URLSearchParams(search).get("preview");
        return preview !== null && preview !== "0";
    }

    onDestroy(() => {
        renderer?.setAnimationLoop(null);
        if (scene) unloadExperience(scene);
        renderer?.dispose();
        xrButton?.remove();
        removePreviewKeyboardListeners?.();
        unsubscribeHostOrientation?.();
        hostControl?.disconnect();
        hostRuntime?.disconnect();
        ws?.disconnect();
    });
</script>

<svelte:head>
    <title>{experienceName} | ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} class="vr-canvas"></canvas>

{#if blockingError !== null}
    <div class="blocking-error" role="alert">
        {blockingError}
    </div>
{/if}

{#if hasOutputs}
    <div class="score-overlay">
        <Trophy size={20} />
        {score}
    </div>
{/if}
