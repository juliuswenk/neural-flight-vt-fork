# Berlin Flight - Position-Based Tile Loading Prompts

Focused coding-agent prompts for removing gaze/head-direction-driven tile loading from Berlin Flight.

Observed issue:

- Cone/image-textured regions appear and disappear based on where the player looks.
- The cone runtime is position-based, but `3d-tiles-renderer` tile selection currently receives cameras derived from the XR view direction.
- Head rotation can therefore trigger tile load/dispose/LOD changes while the player position is unchanged.

Goal:

- Tile loading, unloading, and LOD selection should be driven by player position only.
- Head direction should affect only final rendering of already-selected scene content.

Constraints:

- Keep changes local to `src/lib/experiences/berlin-flight/` unless the VR shell has to be inspected.
- Follow `AGENTS.md`.
- No `any`.
- Do not replace `3d-tiles-renderer`.
- Keep the tile runtime adapter API unless there is a concrete need to change it.
- Prefer fixed synthetic tile-selection cameras over new loading systems.
- Use `apply_patch` for edits.
- Run:
  - `bunx biome check --write .`
  - `bunx svelte-check --threshold warning`
- Do not commit unless asked.

---

## Phase 1 - Replace gaze-derived tile selection with position-fixed cameras

### Objective

Make tile selection independent of headset orientation while keeping `3d-tiles-renderer`'s camera-based API.

### Coding-agent prompt

```text
Remove gaze/head-direction dependency from Berlin Flight tile selection with the smallest working change.

Task:
- inspect `src/lib/experiences/berlin-flight/scene.ts`
- find `syncTileSelectionCameras()`, `syncTileSelectionCamera()`, and `getTileSelectionViewCamera()`
- stop using the XR camera quaternion or player camera quaternion for tile-selection cameras
- create deterministic synthetic tile-selection cameras from `state.player.rig.position`
- use fixed world-facing rotations, for example north/east/south/west, so standing still and turning the head does not change tile selection
- keep using `TilesRuntimeAdapter.update(cameras, renderer)`

Implementation guidance:
- reuse the existing `tileSelectionCamera` and `tilePreloadCamera` only if two fixed directions are enough for a first pass
- if four directions are needed, add the smallest explicit state shape for four `THREE.PerspectiveCamera` instances
- use a wide FOV from Berlin constants rather than copying `state.camera.fov`
- update matrix/projection only when values change

Checks to satisfy:
- while player position is unchanged, tile-selection camera positions and quaternions stay unchanged across head rotation
- no direct call path from XR render camera orientation into tile loading remains
- TypeScript stays strict

Constraints for this task:
- do not add a new tile loader
- do not add a tile radius/cache system yet
- do not change cone runtime behavior
- run the focused tests that cover Berlin scene/types if available
- run `bunx biome check --write .`
- run `bunx svelte-check --threshold warning`
```

---

## Phase 2 - Remove forward-looking preload behavior

### Objective

Delete the remaining head-forward preload coupling. Loading ahead of the player should be based on position coverage, not gaze direction.

### Coding-agent prompt

```text
Remove Berlin Flight's gaze-forward tile preload behavior.

Task:
- inspect `src/lib/experiences/berlin-flight/scene.ts`
- inspect `src/lib/experiences/berlin-flight/constants.ts`
- remove or stop using `BERLIN_TILE_PRELOAD.AHEAD_DISTANCE` if it advances preload based on camera forward direction
- replace it with position-fixed coverage from synthetic cameras
- keep constants minimal; delete unused constants instead of leaving dead config

Implementation guidance:
- prefer a small set of fixed cameras at the player position over offset cameras
- if an offset is still needed, use fixed world-axis offsets, not headset direction
- keep all tile-selection/preload cameras position-derived from `state.player.rig.position`

Checks to satisfy:
- searching for `getWorldDirection`, `scratchForward`, or XR camera quaternion in the tile-loading path shows no gaze-based preload logic
- head rotation alone does not change preload camera transforms

Constraints for this task:
- do not introduce dynamic route prediction
- do not add settings UI
- run `bunx biome check --write .`
- run `bunx svelte-check --threshold warning`
```

---

## Phase 3 - Tune retention for position-based loading

### Objective

Reduce unload/LOD churn after gaze is removed, without loading the whole city.

### Coding-agent prompt

```text
Tune Berlin tile retention for the new position-based tile-selection model.

Task:
- inspect `src/lib/experiences/berlin-flight/constants.ts`
- inspect `src/lib/experiences/berlin-flight/runtime/tiles-runtime.ts`
- review `BERLIN_TILE_RUNTIME` values, especially `LOAD_SIBLINGS`, cache byte limits, `ERROR_TARGET`, and queue budgets
- make the smallest retention change that reduces visible tile churn when standing still

Implementation guidance:
- consider `LOAD_SIBLINGS: true` first if cache/memory allows
- avoid lowering `ERROR_TARGET` until flicker is fixed
- avoid large cache increases unless there is evidence current cache pressure causes unloads

Checks to satisfy:
- with player position fixed, `activeTiles` and `trackedMeshes` are stable after initial load settles
- Quest memory/performance remains acceptable in manual testing

Constraints for this task:
- do not load the whole city
- do not rewrite `TilesRuntimeAdapter`
- do not tune multiple unrelated performance knobs in the same change
- run `bunx biome check --write .`
- run `bunx svelte-check --threshold warning`
```

---

## Phase 4 - Add debug proof for position-only selection

### Objective

Make it easy to verify that head rotation no longer changes tile loading state.

### Coding-agent prompt

```text
Add minimal Berlin debug overlay proof that tile loading is position-based.

Task:
- inspect `src/lib/experiences/berlin-flight/debug/overlay.ts`
- inspect `src/lib/experiences/berlin-flight/runtime/tiles-runtime.ts`
- expose or display only the minimum useful diagnostics:
  - tile selection mode: `position-fixed`
  - number of tile-selection cameras
  - tracked mesh version or count
- keep existing debug overlay style

Checks to satisfy:
- debug overlay makes it clear that Berlin is no longer using gaze-based tile selection
- while standing still and rotating head 360 degrees, tile counters should not repeatedly churn after loading settles

Constraints for this task:
- debug-only change
- no new UI panel
- no per-frame expensive logging
- run `bunx biome check --write .`
- run `bunx svelte-check --threshold warning`
```

---

## Phase 5 - Clean up old gaze-selection code

### Objective

Remove stale helpers and constants after the position-based path is proven.

### Coding-agent prompt

```text
Clean up obsolete Berlin gaze-based tile-selection code after position-fixed loading is verified.

Task:
- inspect `src/lib/experiences/berlin-flight/scene.ts`
- inspect `src/lib/experiences/berlin-flight/constants.ts`
- delete helpers that only existed to derive tile loading from the XR/render camera, such as `getTileSelectionViewCamera()` if unused
- delete unused scratch vectors/quaternions/constants from the old forward-preload path
- keep the remaining tile-selection code boring and explicit

Checks to satisfy:
- no unused exports or constants remain
- `rg` finds no gaze/head-forward code in the tile loading path
- behavior remains position-based

Constraints for this task:
- cleanup only
- do not combine with renderer/cache tuning
- run `bunx biome check --write .`
- run `bunx svelte-check --threshold warning`
```

---

## Manual validation checklist

Run this after Phase 1 and again after Phase 3:

1. Start Berlin Flight.
2. Wait for city tiles and cone masks to settle.
3. Keep player position fixed.
4. Rotate head/look direction slowly through 360 degrees.
5. Confirm cone/image-textured regions do not appear/disappear based only on gaze.
6. Confirm debug counts for active/tracked tiles do not churn continuously after settling.
7. Move position forward and confirm new tiles still load.

Skipped for now:

- Replacing `3d-tiles-renderer`.
- Building a custom radius-based tile streamer.
- Loading all Berlin tiles at once.
- Splitting cone rendering and cone collision into separate active sets.
