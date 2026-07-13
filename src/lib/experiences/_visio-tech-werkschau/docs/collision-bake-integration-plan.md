# Visio Tech Werkschau Collision Bake Integration Plan

Goal: move cone/city collision masking out of the live XR path without building a full asset pipeline first.

The lazy bake path is:

1. Keep the current streamed tile runtime working.
2. Teach runtime code to trust a prebaked `coneMask` attribute when present.
3. Add one small bake script that writes `coneMask` into frozen/local tile meshes.
4. Remove live collision work only for meshes with a valid bake.
5. Profile before baking full materials or rewriting tile textures.

## Current Runtime Cost

The current path is already incremental, but still does runtime work when tiles stream in:

- `mesh-tracker.ts` clones neutral and collision materials for every tracked tile mesh.
- `controller.ts` finds cones overlapping each tracked mesh.
- `vertex-mask.ts` samples vertices and triangle interiors against cones.
- `vertex-color-writer.ts` writes a runtime `coneMask` attribute.
- `tiles-material.ts` uses `coneMask` plus a fragment shader cone test for up to 3 nearby cones.

Because cones and city meshes are static, the per-mesh mask can be baked. Full material/texture baking is optional and should wait until profiling proves the shader is still a bottleneck.

## Non-Negotiables

- Keep the existing runtime fallback for remote streamed tiles.
- Do not add a new rendering abstraction.
- Do not bake against a tile source that can change without recording the source version.
- Do not use `any`.
- Do not add dependencies unless an installed package cannot read/write the chosen asset format.
- Run `bunx biome check --write .` and `bunx svelte-check --threshold warning` after code changes.

## Step 1: Detect Prebaked Cone Masks

Intent: make runtime support the bake before creating the bake.

Implementation:

- Add a tiny helper near `vertex-color-writer.ts` or `mesh-preprocess.ts` that validates a `coneMask` geometry attribute:
  - `THREE.BufferAttribute`
  - `itemSize === 1`
  - `count === vertexCount`
  - `array instanceof Float32Array`
- Add a boolean on `TrackedTileMesh`, for example `hasPrebakedConeMask`.
- In `preprocessTrackedMesh()`, set that boolean from the existing attribute.
- In `controller.ts`, when a mesh has a valid prebaked mask:
  - skip `updateVertexMask()`
  - skip `writeConeMaskAttributeForMesh()`
  - still choose neutral vs collision material based on whether overlapping cones exist, unless Step 2 changes this with a baked flag.

Acceptance:

- Existing remote tile behavior is unchanged for meshes without `coneMask`.
- A mesh with a valid `coneMask` does not run CPU vertex/triangle sampling.
- Debug stats make it obvious that fewer vertices were tested for prebaked meshes.

Coding agent prompt:

```text
In src/lib/experiences/_visio-tech-werkschau, add runtime support for prebaked coneMask geometry attributes. Search the collision subsystem first. Keep the current behavior for meshes without a valid coneMask. Add a hasPrebakedConeMask boolean to TrackedTileMesh, validate the attribute as Float32 BufferAttribute itemSize 1 with vertexCount entries, and skip updateVertexMask/writeConeMaskAttributeForMesh for prebaked meshes. Do not use any. Keep the diff small. Add or update the existing collision test if practical. Run bunx biome check --write . and bunx svelte-check --threshold warning.
```

## Step 2: Store Baked Mesh Collision State

Intent: avoid cone overlap work for baked meshes when the bake already tells us whether the mesh intersects cones.

Implementation:

- Add optional geometry/userData metadata for baked meshes:
  - `werkschauConeMaskVersion`
  - `werkschauHasConeIntersection`
  - `werkschauBakeSource`
- Read this metadata in `preprocessTrackedMesh()`.
- If `hasPrebakedConeMask` and `werkschauHasConeIntersection === true`, assign the collision material immediately.
- If `hasPrebakedConeMask` and `werkschauHasConeIntersection === false`, keep the neutral material and skip collision controller processing for that mesh.
- Keep conservative fallback behavior if metadata is missing: use Step 1 behavior.

Acceptance:

- Baked non-intersecting meshes never enter cone overlap or vertex sampling.
- Baked intersecting meshes render with the collision material without recomputing the mask.
- Missing metadata does not break remote streamed tiles.

Coding agent prompt:

```text
Extend the prebaked coneMask support in _visio-tech-werkschau so baked meshes can declare whether they intersect cones. Use geometry.userData or mesh.userData metadata, whichever is already preserved by the loader path. Add typed metadata parsing with no any. If a baked mesh declares no cone intersection, skip controller processing and keep neutral material. If it declares an intersection, use the collision material without recomputing vertex masks. Missing metadata must fall back to the current runtime path. Keep changes scoped to collision preprocessing/tracking/controller. Run biome and svelte-check.
```

## Step 3: Add A Small Bake Script

Intent: produce the same `coneMask` offline for a frozen local test asset.

Implementation:

- Create a script under the experience, for example:
  - `src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts`
- Input:
  - one local `.glb` or `.gltf` tile mesh file
  - cone chunk data from `static/experiences/_visio-tech-werkschau/cone-data/generated`
- Output:
  - one copied `.glb` or `.gltf` with `coneMask` attribute and metadata
- Reuse existing math where possible:
  - cone volume contracts/types
  - `isVertexInsideCone()`
  - triangle sampling constants
- Do not solve all 3D Tiles yet. Bake one local mesh first.

Acceptance:

- Running the script against one local mesh writes a valid `coneMask`.
- The app loads that mesh and skips runtime vertex sampling.
- The visual result matches the live-computed mask closely enough for headset inspection.

Coding agent prompt:

```text
Add the smallest offline bake script for _visio-tech-werkschau that reads one local GLB/GLTF mesh and writes a copy with a Float32 coneMask attribute plus metadata. Reuse existing collision math/constants where possible. Do not build a full 3D Tiles pipeline yet. Use already installed packages only; inspect package.json before adding anything. Add a minimal npm/bun script only if needed. Include a short usage note in docs/collision-bake-integration-plan.md. Run the script on a small local model if available, then run biome and svelte-check.
```

Usage:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts input.glb output.glb [cone-data-dir] [runtime-source-url]
```

Optional third argument: cone data directory. Defaults to `static/experiences/_visio-tech-werkschau/cone-data/generated`.
Optional fourth argument: the source URL the runtime will report for this baked mesh. Defaults to the output path.

## Step 4: Freeze The City Tile Source

Intent: make the bake trustworthy.

Options, in order:

1. Use an existing fixed Cesium Ion asset/version if the source guarantees stable geometry.
2. Export/download the needed Berlin tile subset and serve it locally.
3. Keep remote tiles and only use prebaked masks for local proof assets.

Implementation:

- Record the tile source URL, asset ID, date, and any version/hash in bake metadata.
- Add a local tiles source mode only if a frozen tileset exists.
- Do not preload all Berlin. Keep player-position-based streaming.

Acceptance:

- The baked asset records what source it was baked from.
- Runtime can reject or ignore stale bake metadata if the source does not match.
- Remote unfrozen tiles still use the current runtime fallback.

Coding agent prompt:

```text
Add support for documenting and validating the city tile source used by prebaked cone masks. Keep remote tiles working unchanged. If a local frozen tileset path is already available, add the smallest tiles-source option for it; otherwise only add metadata validation and docs. Baked metadata should include source URL or asset ID plus a bake version/date. Runtime should ignore stale or mismatched bake metadata and fall back safely. No broad refactor. Run biome and svelte-check.
```

## Step 5: Batch Bake Frozen Tiles

Intent: apply the one-mesh bake to the frozen tile subset.

Implementation:

- Extend the bake script to walk a local frozen tiles directory.
- Process only mesh payloads that the app will actually load.
- Preserve original textures/materials.
- Write baked output next to or into a copied tileset directory.
- Emit a small JSON report:
  - files processed
  - vertices processed
  - meshes with intersections
  - meshes without intersections
  - skipped files

Acceptance:

- The app can point at the baked local tileset.
- Runtime vertex sampling drops near zero for baked tiles.
- Visual masking matches the current live path.

Coding agent prompt:

```text
Extend the single-file coneMask bake script into a directory batch bake for a frozen local tileset. Keep it boring: walk files, process supported mesh payloads, copy everything else, and emit a JSON report. Preserve source materials/textures. Do not optimize beyond what the profiler requires. Add docs for input/output paths. Run the batch on a small subset first and verify the app uses prebaked masks instead of runtime sampling.
```

Usage:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts frozen-tiles-in baked-tiles-out [cone-data-dir] [runtime-source-base]
```

Directory mode walks `frozen-tiles-in`, bakes `.glb` and `.gltf` files, copies all other files, and writes `baked-tiles-out/cone-mask-bake-report.json`. Use `runtime-source-base` so `werkschauBakeSource` matches the URLs the runtime reports for the baked tiles.

## Step 6: Profile Before Shader Simplification

Intent: avoid rewriting materials unless there is still measurable GPU cost.

Implementation:

- In headset or desktop preview, compare:
  - current live collision path
  - prebaked mask path with existing shader
  - collision disabled
- Watch:
  - frame time
  - draw calls
  - tile load spikes
  - `verticesTestedLastTick`
  - shader compile stalls

Acceptance:

- There is a measured reason before changing shader code.
- CPU load from vertex sampling is gone or negligible for baked tiles.

Coding agent prompt:

```text
Add the smallest useful debug/profile output for comparing live collision vs prebaked coneMask in _visio-tech-werkschau. Prefer existing debug stats. Show verticesTestedLastTick, processedMeshesLastTick, tracked meshes, and whether prebaked masks are used. Do not add a UI framework or charts. Use this to compare live, prebaked, and collision-disabled modes. Run biome and svelte-check.
```

## Step 7: Optional Baked Material Path

Intent: remove the per-fragment cone loop only if Step 6 proves it matters.

Implementation:

- Add a simpler collision material variant that uses only `coneMask`.
- Remove `werkschauFragmentConeMask()` from that baked-material shader path.
- Keep the existing hybrid shader for unbaked streamed tiles.
- Do not bake full texture atlases unless the simple shader path is still too slow.

Acceptance:

- Baked tiles use the simple `coneMask` material.
- Unbaked streamed tiles still use the current hybrid shader.
- Visual regressions are acceptable only where the baked vertex mask resolution is known to be sufficient.

Coding agent prompt:

```text
Add an optional simple baked-mask material path for _visio-tech-werkschau. For meshes with a valid prebaked coneMask, use a shader/material that reveals texture from coneMask only and does not run the fragment cone loop. Keep the current hybrid material for unbaked streamed tiles. Do not bake texture atlases. Run visual comparison and biome/svelte-check.
```

## Done Criteria

- Frozen/local tiles with baked `coneMask` load in the experience.
- Runtime CPU vertex/triangle collision work is skipped for baked tiles.
- Remote streamed tiles still work with the old live path.
- The bake records its source, so stale geometry can be detected.
- Full material baking remains unimplemented unless profiling proves it is needed.
