# Visio Tech Werkschau Berlin Flight Rebuild Manifest

This manifest defines what to cherry-pick from `src/lib/experiences/berlin-flight` into `src/lib/experiences/_visio-tech-werkschau`.

Goal: build a stable exhibition version of the Berlin flight concept for Pico 4 Business Edition + ICAROS + M5 gyro controller. Prefer boring, proven code from `berlin-flight`; skip experiments unless they directly improve stability. Do not just copy the code. Use it as a reference and make changes where you deem them to improve stability or performance after asking the user for approval.

## Non-Negotiables

- Location-based rendering only. Tile loading, cone visibility, collision updates, fallback rendering, and any other runtime visual selection must follow player/rig location, not headset gaze direction.
- Berlin-only flight bounds. The player may fly across all of Berlin, but not outside it.
- Use the same Cesium credentials/env path as `berlin-flight`.
- Interpret the ICAROS host gyro message shape and use it to control player heading.
- Keep neutral solid-color tile material as the default visual style.
- Inside cone/mesh intersections, reveal the original image texture streamed from Cesium.
- Visitors should see the cones themselves, not only their mesh-intersection effect.
- Stream only nearby Berlin tiles. The player is bounded to Berlin, but the runtime must not preload all of Berlin.
- Prefer visual stability over tile-loading performance for position-based tile selection.
- Public flight duration is 3 minutes, then the experience fades back to AR.
- The 3-minute timer starts when the player first moves.
- Keep audio components in the migration; refine them later.
- Include the Berlin Flight radio component.
- Include a browser-based preview mode for desktop testing without a headset.
- If Cesium tiles fail, render only a fallback plane at height `0`.
- Keep the experience reliable before adding richer visuals.

## Rendering Rule

The rebuilt experience must not make rendering decisions from headset gaze direction. This was a major instability source in `berlin-flight`.

Use player/rig location for:

- Cesium tile loading and tile priority cameras. Use stable fixed-direction loader cameras around the player, not gaze direction.
- Cone chunk loading and cone visibility. Visible cones must be capped to nearby cones around the player.
- Cone/mesh collision updates.
- Fallback plane placement.
- Any future visual culling or level-of-detail decisions.

Headset/camera orientation may still affect normal viewing, but must not decide what content exists, loads, unloads, or updates.

## ICAROS Host Input

Reuse the existing host control path instead of adding a second protocol.

Source files:

- `src/lib/ws/icaros-host-control-client.ts`
- `src/routes/vr/+page.svelte`
- `src/lib/experiences/berlin-flight/player.ts`

Expected host message:

```json
{
  "type": "control.orientation",
  "payload": {
    "pitch": 0,
    "roll": 0,
    "yaw": 0,
    "quality": 1,
    "controllerType": "m5"
  },
  "timestamp": 0
}
```

Rules:

- Read from `/ws/control/main` via `PUBLIC_ICAROS_HOST_ORIGIN`.
- Accept only finite `pitch`, `roll`, optional finite `yaw`, finite `quality`, and `controllerType: "m5"`.
- Ignore samples with `quality <= 0`.
- Map the host orientation the same way `/vr` currently does before passing it into the experience player.

## Migration Order

### 1. Minimal Experience Shell

Create the new experience files first, copying only the smallest working shape from `berlin-flight`:

- `manifest.ts`
- `index.ts`
- `types.ts`
- `scene.ts`
- `player.ts`
- `constants.ts`
- `runtime/cleanup.ts`
- `geo/*`

Acceptance:

- Experience registers and loads without Berlin-specific name collisions.
- WebXR loop starts and disposes cleanly.
- Browser-based preview works without a headset.
- Player moves from ICAROS/M5 orientation input.
- ICAROS host gyro messages control player heading through the same player input path.
- No roads, extra debug UI, or experimental overlays yet.

### 2. Cesium Berlin Tiles

Bring over the streaming runtime:

- `runtime/tiles-source.ts`
- `runtime/tiles-runtime.ts`
- `geo/berlin-mitte-origin.ts`
- `geo/coordinates.ts`
- `geo/types.ts`

Use the existing public env variables from `berlin-flight`:

- `PUBLIC_CESIUM_ION_TOKEN`
- `PUBLIC_BERLIN_ION_ASSET_ID`
- `PUBLIC_BERLIN_TILES_URL`

Change for Werkschau:

- Rename exported symbols from `BERLIN_*` to a local prefix only if needed to avoid collisions.
- Keep the adapter shape; do not build a new tile abstraction.
- Tile cameras must be position-based around the rig/player and must not use headset gaze as the only loader signal.
- Keep the four fixed-yaw tile selection cameras unless headset testing proves they are too expensive.
- Load nearby detailed tiles lazily based on closeness to the player; do not preload all Berlin tiles.

Acceptance:

- Tiles stream around the player in desktop preview and XR.
- Player can turn head without causing tile loading/view-dependent visual instability.
- Looking around must not load/unload or otherwise change world content independently of player location.
- Runtime disposes the `TilesRenderer` and tracked meshes.
- If tile source/loading fails, the scene shows a plain, untextured, non-colliding fallback plane at height `0` covering the full Berlin rectangle.

### 3. Neutral Tile Material

Bring over:

- `runtime/tiles-material.ts`
- `BERLIN_TILE_LOOK` constants, renamed or localized if needed.

Default visual target:

- Solid neutral color.
- Textures/maps disabled.
- Basic lightweight shading for depth perception.
- Depth write/test enabled.
- No cone-mask shader as the default path.

Acceptance:

- Buildings read as solid simplified geometry with enough depth.
- No photoreal texture shimmer/flicker.
- Material clones are disposed when tiles unload.

### 4. Exhibition Sequence

Bring over the start/end flow, but cut it down:

- `onboarding/controller.ts`
- `onboarding/audio.ts`
- `audio/radio-config.ts`
- `audio/radio-manager.ts`
- `audio/radio-station.ts`
- The minimum useful parts from `lennard/scripts/sequence-controller.ts`.
- `lennard/scripts/sonar-overlay.ts`
- `lennard/scripts/battery-overlay.ts`
- Minimal text overlay support for:
  - `human perception detected, switching...`
  - `returning to human perception`

Target sequence:

1. Start in AR passthrough / see-through.
2. Show sonar, `human perception detected, switching...`, and battery overlays.
3. Fade into virtual Berlin.
4. Start the 3-minute timer when the player first moves.
5. Run the flight.
6. Show `returning to human perception`.
7. Fade back to AR at the end.

Timer definition:

- Start the 3-minute timer when the AR phase ends, meshes become visible, and flight through the city begins.

Acceptance:

- The operator can restart the experience without reloading the page.
- Onboarding does not block desktop preview.
- Berlin Flight radio starts/stops with the experience and disposes audio resources cleanly.
- Radio code is migrated, but it may default muted/off for the first headset stability test.
- All sprites/textures/materials created by overlays are disposed.
- No `/controller` restart/reset control is required.

### 5. Berlin Flight Bounds

Add bounds before collision/cone visuals:

- Define a Berlin-wide operating area in local coordinates.
- Clamp the player back inside the allowed area.
- Keep altitude limits from `berlin-flight` unless changed.

Preferred first version:

- Rectangular local X/Z bounds around all of Berlin.
- Clamp position after `player.tick()`.

Acceptance:

- Player cannot fly outside Berlin.
- Clamping does not create hard nausea-inducing camera snaps at normal speed.

### 6. Cone Placement And Precomputed Data

Bring over only after tiles are stable:

- `runtime/cone-grid-*`
- `cone-data/*`
- `cone-placement/*`
- `placement/*` only if still needed for generating/refining cone source data.

Use precomputed cone chunks at runtime. Do not recompute expensive placement during the public experience.

Acceptance:

- Nearby precomputed cones load around the player.
- Cone meshes are visible to visitors as less-intrusive wireframes.
- Visible cone rendering is capped to nearby cones only.
- Missing/empty cone data is visible in a small diagnostic path.
- Runtime does not stall flight when moving between chunks.

### 7. Cone Collision

Bring over:

- `collision/*`

Keep the existing broad-phase and per-mesh preprocessing flow:

- Track streamed tile meshes.
- Preprocess geometry once per loaded mesh.
- Test active cones against tracked mesh bounds first.
- Write a vertex mask or equivalent lightweight signal.

Acceptance:

- Collision updates incrementally.
- Tile unload cleans collision state.
- Collision can be disabled with one constant while testing tile stability.

### 8. Cone / Mesh Intersection Visuals

Do this last.

Candidate source:

- Existing `coneMask` shader path in `runtime/tiles-material.ts`.
- Future image/projection work from `berlin-flight` docs only if needed.

Default first version:

- Neutral solid material outside cone intersections.
- Original Cesium streamed image texture inside cone intersections.
- Hard edge between neutral material and original Cesium texture.
- Texture reveal is mandatory for the final exhibition version; a solid-color fallback is not acceptable as the final effect.
- Placeholder/neutral visuals are acceptable only while a tile is partly loaded.
- When the player gets closer and the tile reaches the two highest available detail levels, the original image texture must be drawn inside cone intersections.

Acceptance:

- Cone-covered building regions reveal original city texture in headset with stable rendering.
- Visual mode does not reintroduce texture shimmer.
- Hard edges stay as hard as the streamed mesh/vertex mask allows.

## Explicitly Skip For Now

- `lennard/radio/*`
- `lennard/straßen/*`
- Full debug overlay stack, unless a tiny diagnostic is required.
- Road/cars systems.
- New dependencies.
- Runtime cone placement recomputation during exhibition mode.

Add skipped items only after the stable flight path works in headset.

## Open Questions

No open product decisions right now. Add implementation questions here when migration exposes them.

## First Migration Checklist

- [ ] Copy minimal experience shell.
- [ ] Rename visible identifiers to Werkschau naming.
- [ ] Keep browser-based preview mode working.
- [ ] Wire Cesium tile source.
- [ ] Keep nearby-only lazy tile streaming.
- [ ] Use neutral tile material by default.
- [ ] Add position-based tile selection.
- [x] Add full-Berlin clamp bounds.
- [ ] Verify desktop preview.
- [ ] Verify Pico 4 WebXR.
- [x] Add onboarding sequence and first-movement 3-minute flight timer.
- [x] Add retained audio components.
- [x] Add sonar, battery, and required text overlays.
- [ ] Add Cesium-failure fallback plane at height `0`.
- [ ] Add cone collision.
- [x] Add precomputed cones.
- [x] Cap visible cones to nearby cones.
- [ ] Add stable cone intersection texture reveal on high-detail nearby tiles.
