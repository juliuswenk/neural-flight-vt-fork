# Berlin Flight - Tile Material Stability Fix Prompts

Focused coding-agent prompts for fixing the Berlin Flight tile texture artifacts shown in:

- `src/lib/experiences/berlin-flight/debug/Bildschirmaufnahme 2026-07-13 um 16.12.35.mov`

Observed issues:

- Distant low-resolution Cesium image textures appear on some meshes before cone masking is ready.
- Cone/image-textured regions visibly appear and disappear while flying.

Likely root causes:

- Tile meshes that fail `shouldTrackMeshForConeMask()` keep their original tile material instead of the neutral Berlin material.
- Tracked meshes get the cone shader before their first `coneMask` has been computed.
- Cone masks are recomputed from only the currently active cone window, so texture visibility can flip when cones move out of the active radius.

Constraints:

- Keep changes local to `src/lib/experiences/berlin-flight/`.
- Follow `AGENTS.md`.
- No `any`.
- Use existing Berlin runtime/collision patterns before adding structure.
- Use `apply_patch` for edits.
- Run:
  - `bunx biome check --write .`
  - `bunx svelte-check --threshold warning`
- Do not commit unless asked.

---

## Prompt 1 - Keep all loaded tile meshes neutral by default

The Berlin tile registration path lives in:

- `src/lib/experiences/berlin-flight/collision/mesh-tracker.ts`
- `src/lib/experiences/berlin-flight/runtime/tiles-material.ts`
- `src/lib/experiences/berlin-flight/collision/mesh-filter.ts`

Right now, meshes that fail `shouldTrackMeshForConeMask()` can keep their original Cesium tile image material. In the debug video this shows up as low-resolution photo texture patches in the distance.

Task:

1. Trace the tile mesh load path from `TilesRuntimeAdapter.handleLoadModel()` through `BerlinTileMeshRegistry.trackTileScene()`.
2. Make every loaded tile mesh render with the neutral Berlin material by default.
3. Keep cone-mask tracking limited to meshes that pass `shouldTrackMeshForConeMask()`.
4. Dispose cloned and original materials correctly when tiles unload.

Requirements:

- Do not add a new material system.
- Prefer changing `mesh-tracker.ts` over adding guards in callers.
- Do not make untracked meshes participate in collision work.
- Preserve current neutral color/shading from `BERLIN_TILE_LOOK`.

Deliver:

- Low-res original tile textures no longer appear on untracked meshes.
- A focused test or existing test update proving filtered-out meshes do not keep the source material.

---

## Prompt 2 - Apply cone-mask material only after first mask computation

The mask write path lives in:

- `src/lib/experiences/berlin-flight/collision/controller.ts`
- `src/lib/experiences/berlin-flight/collision/vertex-color-writer.ts`
- `src/lib/experiences/berlin-flight/collision/tile-mesh-types.ts`
- `src/lib/experiences/berlin-flight/collision/mesh-tracker.ts`

Tracked meshes currently receive a shader using `coneMask` immediately after load. Because `coneMask` starts empty and collision processing is budgeted by `BERLIN_COLLISION.MAX_MESHES_PER_TICK`, a newly loaded mesh can render the wrong state for several frames.

Task:

1. Keep tracked meshes visually neutral until their first mask has been computed and written.
2. After `BerlinCollisionController` processes a mesh once, switch that mesh to the cone-mask material.
3. Keep the mesh in the dirty queue behavior unchanged except for this first-render material swap.

Requirements:

- Keep the diff small.
- Do not increase `MAX_MESHES_PER_TICK` as the primary fix.
- Do not block tile loading or hide meshes.
- Use explicit TypeScript state if needed, for example a boolean on `TrackedTileMesh`.

Deliver:

- Newly loaded tracked meshes do not briefly expose incorrect source imagery.
- A focused test that fails if the cone material is applied before the first mask write.

---

## Prompt 3 - Prevent cone texture regions from disappearing at active-radius edges

Cone chunk activation and filtering live in:

- `src/lib/experiences/berlin-flight/cone-data/runtime-store.ts`
- `src/lib/experiences/berlin-flight/runtime/cone-grid-config.ts`
- `src/lib/experiences/berlin-flight/runtime/cone-grid-runtime.ts`

The current store filters active cones by `BERLIN_CONE_GRID.VISIBLE_RADIUS_TILES`. When a cone falls outside that active window while its tile mesh is still visible, collision recomputes the mesh mask without that cone and the source imagery disappears.

Task:

1. Trace how active cone chunks are selected in `BerlinConeChunkRuntimeStore.refreshActiveState()`.
2. Make the active cone window cover every cone that can still affect visible tile meshes.
3. Prefer the smallest fix: widen or remove the per-cone visible-radius filter before adding a cache.
4. Keep chunk loading bounded by the existing chunk radius constants.

Requirements:

- Do not build a persistent mask cache unless widening the active cone set is insufficient.
- Do not load the whole city.
- Keep cone rendering and collision using the same active cone source unless there is a measured reason to split them.

Deliver:

- Cone/image-textured regions remain stable while tiles are visible.
- A focused test around `refreshActiveState()` or `BerlinConeGridRuntime` proving cones do not drop out too early.

---

## Prompt 4 - Clean up stale collision invalidation assumptions

The collision invalidation logic lives in:

- `src/lib/experiences/berlin-flight/collision/controller.ts`
- `src/lib/experiences/berlin-flight/collision/controller.test.js`

`BerlinCollisionController` currently skips recomputation when the cone snapshot version changes but the chunk/count signature stays the same. That is only safe if cone positions never change inside the same chunk/count set.

Task:

1. Verify whether `createConeChunkSignature()` is still needed.
2. If it can produce stale masks, remove the signature shortcut and invalidate meshes directly on `coneVersion` changes.
3. Keep the existing per-frame mesh budget.
4. Update or delete tests that lock in the stale behavior.

Requirements:

- Prefer deleting the shortcut over making a more complex signature.
- Do not add deep cone hashing unless a real performance measurement demands it.
- Keep recomputation bounded by the existing dirty queue.

Deliver:

- Collision masks cannot remain stale after a real cone snapshot version change.
- Tests reflect the corrected invalidation behavior.

---

## Prompt 5 - Verify in browser and headset-facing runtime

After implementing the earlier phases, verify the actual Berlin scene.

Task:

1. Run formatting and checks:
   - `bunx biome check --write .`
   - `bunx svelte-check --threshold warning`
2. Start the app with the existing HTTPS dev flow.
3. Open the Berlin Flight VR route in browser preview.
4. Reproduce the path from the debug video as closely as possible.
5. Watch for:
   - distant low-res image texture patches
   - cone/image regions appearing or disappearing
   - debug cone/mask stats getting stuck

Requirements:

- Do not commit.
- Keep any temporary debug toggles clearly marked and remove them before finalizing unless asked.
- If visual verification is inconclusive, report exactly what was checked and what remains uncertain.

Deliver:

- Short verification note with commands run.
- Whether both reported artifacts are fixed.
- Any remaining risk, especially around Quest/WebXR-only behavior.
