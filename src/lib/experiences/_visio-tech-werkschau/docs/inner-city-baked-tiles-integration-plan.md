# Visio Tech Werkschau Inner-City Baked Tiles Integration Plan

Goal: use a dual tile strategy that gets the collision-bake CPU win where it matters without storing all of Berlin locally.

The chosen approach:

1. Use the currently configured Cesium Ion city asset as the authoritative source.
2. Freeze only the inner city: 4 km radius around `WERKSCHAU_PLAYER_SPAWN_POSITION`.
3. Serve baked local tiles inside that radius.
4. Keep the current remote streamed tile runtime outside that radius.
5. During bake, hide cone-masked mesh parts that are not visible from the cone origin that produced the mask.

## Why This Exists

Full local Berlin tiles are too large. Texture-only download does not help because the collision mask needs mesh vertices and triangles. The smaller useful version is:

- freeze a bounded 8 km wide inner area;
- bake `coneMask` and metadata for that bounded area;
- keep remote fallback for everything else;
- avoid full texture/material baking until profiling proves the shader still matters.

## Non-Negotiables

- Remote streamed tiles must keep working unchanged outside the frozen area.
- The frozen source must record Cesium Ion asset ID, resolved tileset URL, date, and extraction radius.
- Runtime must reject stale baked metadata and fall back to live collision.
- Do not duplicate all Berlin.
- Do not add a rendering abstraction.
- Do not bake texture atlases in this phase.
- Do not use `any`.
- Run `bunx biome check --write .` and `bunx svelte-check --threshold warning` after code changes.

## Target Files

Likely files to touch:

- `src/lib/experiences/_visio-tech-werkschau/runtime/tiles-source.ts`
- `src/lib/experiences/_visio-tech-werkschau/runtime/tiles-runtime.ts`
- `src/lib/experiences/_visio-tech-werkschau/collision/mesh-preprocess.ts`
- `src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts`
- new freeze/export script under `src/lib/experiences/_visio-tech-werkschau/scripts/`
- docs in `src/lib/experiences/_visio-tech-werkschau/docs/`

## Directory Contract

Use these paths so every script and runtime option has one obvious place to look:

```text
static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km/
static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km/
static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km/werkschau-freeze-manifest.json
static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km/cone-mask-bake-report.json
```

The frozen directory is the raw local copy from Cesium Ion. The baked directory is the runtime input after `coneMask` baking. Never bake in place.

Runtime URLs for the baked directory should be rooted at:

```text
/experiences/_visio-tech-werkschau/tiles/baked-inner-4km
```

That value must be the `runtime-source-base` passed to the bake script so `werkschauBakeSource` metadata matches the URLs the runtime reports.

## End-To-End Operator Checklist

After implementation, the intended workflow is:

1. Freeze a tiny smoke subset from the current Cesium Ion source:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts \
  static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km \
  --smoke
```

2. Bake that smoke subset:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts \
  static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km \
  static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km \
  static/experiences/_visio-tech-werkschau/cone-data/generated \
  /experiences/_visio-tech-werkschau/tiles/baked-inner-4km
```

3. Run the app and verify the debug overlay near spawn:

```text
collision: tracked N; prebaked N; processed 0; vertices 0; dirty 0
```

4. If the smoke subset works, freeze the full 4 km radius:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts \
  static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km
```

5. Re-run the bake command from step 2.

6. Run:

```bash
bunx biome check --write .
bunx svelte-check --threshold warning
```

7. Profile:
   - remote-only live collision;
   - local baked inner city plus remote outside;
   - collision disabled.

If `prebaked` stays `0`, the app is still using remote tiles, the baked tiles are missing, or `werkschauBakeSource` does not match runtime URLs.

## Step 1: Define The Inner-City Boundary

Intent: make the frozen area explicit and reproducible.

Implementation:

- Add a small config value for the frozen local area:
  - center: `WERKSCHAU_PLAYER_SPAWN_POSITION`
  - radius: `4000` meters
- Keep this local to Werkschau constants/config.
- Add a helper that tests whether a local world position is inside the frozen radius.
- Use local X/Z distance only; ignore altitude.

Acceptance:

- The 4 km radius is represented in one config location.
- Runtime and export scripts use the same radius value.
- A future radius change does not require editing multiple scripts.

Coding agent prompt:

```text
In _visio-tech-werkschau, add a small frozen inner-city bounds config centered on WERKSCHAU_PLAYER_SPAWN_POSITION with radius 4000m. Add a helper that tests local X/Z positions against it. Keep it scoped to this experience and do not change runtime behavior yet. Run biome and svelte-check.
```

## Step 2: Freeze The Cesium Ion Inner Tile Subset

Intent: create the local source directory that the existing batch baker needs.

Implementation:

- Create `src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts`.
- The CLI shape is:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts \
  static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km \
  [--smoke]
```

- Resolve the current Cesium Ion source through the existing `resolveWerkschauTilesSource()` path.
- Load the root remote `tileset.json`.
- Recursively visit tiles whose bounding volume intersects the 4 km local radius.
- In `--smoke` mode, stop after a tiny deterministic subset, for example the root plus first 5 intersecting content payloads.
- Download and save:
  - each visited `tileset.json`;
  - each selected tile content payload (`.glb`, `.gltf`, `.b3dm`, `.cmpt`, or whatever the current asset uses);
  - external buffers/images referenced by selected `.gltf` files, if present.
- Rewrite saved JSON URLs so they point to local relative files inside the frozen directory.
- Preserve the source directory structure enough that relative content paths still work.
- Write `werkschau-freeze-manifest.json` next to the frozen local root tileset:
  - Cesium Ion asset ID
  - resolved tileset URL
  - extraction date
  - radius meters
  - center local position
  - smoke mode boolean
  - files saved
  - bytes saved
  - skipped remote URLs
  - failed remote URLs

Keep it boring:

- Start with a small smoke subset before the full 4 km radius.
- Do not attempt full Berlin traversal.
- Do not optimize download concurrency until needed.
- Use sequential fetches first.
- Fail clearly if the asset uses a tile payload format the freeze script cannot copy or rewrite.

Bounding-volume selection:

- Use existing local/ECEF transform helpers where possible.
- For tile bounding volumes:
  - `sphere`: transform/check center distance plus radius.
  - `box`: conservative check is acceptable; include the tile if any doubt.
  - `region`: conservative check is acceptable; include if it overlaps the Berlin local radius bounds.
- Conservative over-inclusion is fine. Missing inner tiles is not.

Output shape:

```text
static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km/
  tileset.json
  werkschau-freeze-manifest.json
  ...
```

Acceptance:

- A local `tileset.json` exists for the frozen inner subset.
- The app or a script can load the local tileset.
- The manifest records the remote source and extraction boundary.
- The source directory is small enough to be practical compared with all Berlin.

Coding agent prompt:

```text
Add src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts. It should resolve the current Cesium Ion source, download a local 4km-radius tile subset around WERKSCHAU_PLAYER_SPAWN_POSITION into static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km, support --smoke for a tiny deterministic subset, preserve/rewrite relative tile payload paths, and write werkschau-freeze-manifest.json with asset ID/source URL/date/radius/files/bytes/skips/failures. Use installed packages only. Run biome and svelte-check.
```

## Step 3: Batch Bake The Frozen Inner Tiles

Intent: apply the existing `coneMask` batch bake to the frozen local subset.

Implementation:

- Use the existing `bake-cone-mask.ts` directory mode.
- Input: frozen source directory from Step 2.
- Output: baked directory, separate from the frozen source directory.
- Runtime source base must match the URL/path the app will use for the baked tiles.
- Keep `cone-mask-bake-report.json`.
- Copy non-mesh files.

Command:

```bash
bun run src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts \
  static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km \
  static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km \
  static/experiences/_visio-tech-werkschau/cone-data/generated \
  /experiences/_visio-tech-werkschau/tiles/baked-inner-4km
```

Path contract:

- input directory: `static/experiences/_visio-tech-werkschau/tiles/frozen-inner-4km`
- output directory: `static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km`
- cone data directory: `static/experiences/_visio-tech-werkschau/cone-data/generated`
- runtime source base: `/experiences/_visio-tech-werkschau/tiles/baked-inner-4km`

The runtime source base is written into mesh metadata as `werkschauBakeSource` plus the mesh-relative path. Runtime tile URLs must use the same base, otherwise preprocessing rejects the baked `coneMask` as stale and falls back to live collision processing.

Expected output:

```text
static/experiences/_visio-tech-werkschau/tiles/baked-inner-4km/
  tileset.json
  cone-mask-bake-report.json
  ...
```

Acceptance:

- Baked output contains a local tileset plus baked mesh payloads.
- `cone-mask-bake-report.json` reports:
  - files processed
  - files copied
  - vertices processed
  - meshes with intersections
  - meshes without intersections
  - failures
- Runtime preprocessing sees `hasPrebakedConeMask === true` for baked inner meshes.

Coding agent prompt:

```text
Wire the existing _visio-tech-werkschau coneMask batch baker into the frozen inner-city source directory. Document exact input/output paths and runtime-source-base usage. Run it on a tiny frozen subset first, then on the 4km-radius subset. Verify runtime preprocessing accepts baked masks and rejects stale source metadata. Run biome and svelte-check.
```

## Step 4: Add Cone-Origin Visibility Occlusion

Intent: do not reveal texture on mesh parts hidden from the cone origin.

Current `coneMask` answers: “is this vertex/triangle inside the cone volume?”  
This step adds: “and is the surface visible from that cone origin?”

Implementation:

- During offline bake only, for each sampled vertex/triangle point inside a cone:
  - cast a ray from `cone.tip` to the sample point;
  - if another triangle is hit before the sample point, mark that sample as occluded;
  - only set `coneMask = 1` when the sample is inside the cone and visible from that cone tip.
- Use installed `three-mesh-bvh` if it materially simplifies ray queries.
- Build acceleration once per baked scene or mesh group, not per vertex.
- Add a small epsilon so a point does not occlude itself.
- Keep live runtime unchanged. Remote tiles still use the current non-occluded live path.

Important detail:

- Occlusion must be calculated against the frozen local tile subset, not just the current mesh, otherwise neighboring buildings cannot hide each other.
- If the full 4 km subset is too heavy for one BVH, process spatial batches and accept conservative fallback at batch boundaries.

Acceptance:

- A cone-masked sample behind another mesh from the cone tip is not marked visible.
- A directly visible sample inside the cone is still marked visible.
- Bake report includes occlusion counts:
  - samples inside cone
  - samples occluded
  - samples masked visible
- Visual check shows fewer impossible through-building reveals.

Coding agent prompt:

```text
Extend the _visio-tech-werkschau offline coneMask baker so samples inside a cone are only masked when visible from that cone's tip. Use ray tests against the frozen local tile geometry, preferably with installed three-mesh-bvh. Keep this offline-only and keep remote live collision unchanged. Add bake report counts for inside-cone samples, occluded samples, and final visible masked samples. Run on a tiny subset first, then biome and svelte-check.
```

## Step 5: Local-First Runtime Tile Source

Intent: load baked local tiles inside the frozen area and keep remote streaming outside.

Implementation:

- Add a tiles source mode with two sources:
  - local baked tileset for the frozen inner city;
  - current remote Cesium Ion source for everything else.
- Keep player-position-based streaming.
- Do not preload the whole frozen tileset if the runtime can stream it.
- If a requested tile is inside the frozen radius and exists locally, use local.
- If it is outside the radius, missing locally, or stale, use remote.

Potentially simplest implementation:

- Run two `TilesRenderer` instances:
  - one for local baked tiles;
  - one for remote tiles.
- Update both with the same tile-selection cameras.
- Let collision tracking handle both scenes.
- Use source metadata to ensure baked masks are accepted only for local source URLs.

Concrete runtime config:

- Add local baked tiles URL:

```text
/experiences/_visio-tech-werkschau/tiles/baked-inner-4km/tileset.json
```

- Keep the remote source resolved by `resolveWerkschauTilesSource()`.
- Add a runtime capability to initialize:
  - `innerTilesRuntime` with local baked URL;
  - `remoteTilesRuntime` with current remote URL.
- Update both with existing tile-selection cameras.
- Collision controller receives tracked meshes from both runtimes.
- Source URL matching:
  - local baked tile URLs should start with `/experiences/_visio-tech-werkschau/tiles/baked-inner-4km`;
  - `werkschauBakeSource` written by the bake command must use that same base.

Minimum verification command after runtime wiring:

```bash
bun run dev
```

Then open the Werkschau experience near spawn and watch:

```text
collision: tracked N; prebaked N; processed 0; vertices 0
```

Acceptance:

- Starting area uses local baked tiles.
- Outside the frozen radius still streams remote tiles.
- The debug overlay shows `prebaked > 0` in the inner area.
- `verticesTestedLastTick` stays near zero for baked inner tiles.
- Remote-only areas still behave like today.

Coding agent prompt:

```text
Add local-first tile loading for _visio-tech-werkschau: use a baked local tileset inside the 4km frozen radius around WERKSCHAU_PLAYER_SPAWN_POSITION and keep the current remote Cesium Ion stream outside it. Prefer the smallest change, likely two TilesRenderer-backed runtimes updated with the same cameras. Baked local source URLs must match werkschauBakeSource metadata; remote tiles must keep live collision fallback. Run biome and svelte-check.
```

## Step 6: Profile The Dual Path

Intent: prove this reduced CPU cost without breaking remote fallback.

Compare:

- current remote-only live collision;
- local baked inner city plus remote outside;
- collision disabled.

Watch:

- `tracked`
- `prebaked`
- `processed`
- `vertices`
- frame time
- tile load spikes
- memory pressure
- disk size of frozen and baked directories

Acceptance:

- In the inner city, `prebaked` rises and `vertices` drops near zero after tile load settles.
- Outside the inner city, remote fallback still works.
- Disk size is acceptable for the deployment target.
- Visual occlusion from cone origin removes obvious through-building reveals.

Coding agent prompt:

```text
Profile the _visio-tech-werkschau dual tile path. Compare remote-only live collision, local baked inner city plus remote outside, and collision disabled. Use the existing debug overlay plus browser/headset frame timing. Record disk size for frozen and baked directories. Do not add charts. Summarize whether Step 7 simple shader path is justified.
```

## Done Criteria

- A frozen 4 km radius inner-city tile subset exists from the current Cesium Ion asset.
- A baked copy of that subset exists with `coneMask` and source metadata.
- The bake includes cone-origin visibility occlusion.
- Runtime uses baked local tiles inside the radius.
- Runtime uses remote streamed tiles outside the radius.
- Debug output proves prebaked masks are being used.
- Remote fallback remains intact.
- No full-Berlin local storage requirement is introduced.
