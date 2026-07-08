# Berlin Flight Performance Toggle Test Prompts

Use one prompt at a time. After each performance test, restore the feature in the next step and do a quality pass so visual regressions do not get mistaken for wins.

## Test 1: Disable Collision Mask Updates

Prompt:

```text
In berlin-flight, temporarily disable `collisionController.update(...)` during the scene tick. Keep tiles, cone loading, and cone rendering unchanged. Make the smallest reversible change possible, preferably one commented guard or one config flag. Do not delete collision code.

After implementing, tell me exactly which line/file to restore, then run the focused Berlin checks that still make sense.
```

Performance rating:

- FPS / smoothness before: rough, mostly unplayable in vr
- FPS / smoothness after: much improved, almost perfect
- Improvement rating, 1-10: 9
- Visual issues noticed: no more visible cones
- Keep investigating? yes/no: Y

Reactivation prompt:

```text
Re-enable `collisionController.update(...)` in berlin-flight exactly as it was before the temporary performance test. Run the focused Berlin checks and note any visible quality differences to verify the baseline is restored.
```

## Test 2: Disable Cone Rendering And Debug

Prompt:

```text
In berlin-flight, temporarily disable visible cone rendering and cone debug markers entirely. Keep precomputed cone loading and collision/masking behavior unchanged if possible, so this isolates draw/debug cost. Make the smallest reversible change and do not delete cone runtime code.

After implementing, tell me exactly which line/file to restore, then run the focused Berlin checks that still make sense.
```

Performance rating:

- FPS / smoothness before: rough, mostly unplayable in vr
- FPS / smoothness after: slightly smoother
- Improvement rating, 1-10: 4
- Visual issues noticed: none
- Keep investigating? yes/no: maybe

Reactivation prompt:

```text
Re-enable cone rendering and cone debug visibility behavior in berlin-flight exactly as it was before the temporary performance test. Run the focused Berlin checks and do a visual quality pass with debug enabled and disabled.
```

## Test 3: Disable Texture/Mask Material Effect

Prompt:

```text
In berlin-flight, temporarily disable the texture/mask material effect while keeping 3D tiles visible and streamed normally. Keep cone loading and collision data available if possible, but make the material render as the normal tile look without applying the cone mask/image effect. Make the smallest reversible change.

After implementing, tell me exactly which line/file to restore, then run the focused Berlin material/check tests.
```

Performance rating:

- FPS / smoothness before: rough, unplayable
- FPS / smoothness after: slightly improved
- Improvement rating, 1-10: 6
- Visual issues noticed: No more cone influence
- Keep investigating? yes/no: N

Reactivation prompt:

```text
Re-enable the berlin-flight texture/mask material effect exactly as it was before the temporary performance test. Run the focused Berlin material/check tests and compare visual quality against the expected cone image effect.
```

## Test 4: Lower 3D Tile Quality

Prompt:

```text
In berlin-flight, temporarily lower 3D tile quality by increasing the 3D Tiles `errorTarget` or equivalent existing quality budget. Keep cones, collision, and material effects unchanged. Use an existing config value if one exists; otherwise make the smallest obvious temporary constant change in the tile runtime.

After implementing, tell me exactly which line/file to restore and what quality value changed, then run the focused Berlin checks that still make sense.
```

Performance rating:

- FPS / smoothness before: rough, unplayable
- FPS / smoothness after: very slightly improved even with 10x
- Improvement rating, 1-10: 2
- Visual quality loss, 1-10: 1
- Keep investigating? yes/no: Yes, especially since non cone meshes can be a lot less high res

Reactivation prompt:

```text
Restore the 3D tile quality/error target to its previous berlin-flight value. Run the focused Berlin checks and do a visual pass for tile sharpness, popping, and missing geometry.
```

## Test 5: Reduce Tile Mesh Tracking Or Tile Load Jobs

Prompt:

```text
In berlin-flight, temporarily reduce tracked tile mesh pressure or 3D tile load jobs. Prefer existing tile runtime config knobs such as download, parse, process, max processed tiles, or mesh tracking limits. Keep visual features otherwise unchanged. Make one change at a time so the result is attributable.

After implementing, tell me exactly which value changed and where to restore it, then run the focused Berlin checks that still make sense.
```

Performance rating:

- FPS / smoothness before: rough, unplayable
- FPS / smoothness after: slightly improved
- Improvement rating, 1-10: 3
- Streaming/loading downside noticed: none
- Keep investigating? yes/no: Y

Reactivation prompt:

```text
Restore the tile mesh tracking or tile load job value changed in the temporary performance test. Run the focused Berlin checks and do a quality pass for tile loading speed, popping, missing masks, and missing geometry.
```
