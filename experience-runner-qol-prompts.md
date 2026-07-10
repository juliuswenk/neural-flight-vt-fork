# Experience Runner QoL Implementation Prompts

Use these prompts in order on one feature branch. Keep the diff small, reuse the existing WebSocket path, and do not add dependencies.

Base branch used for this plan: `upstream/main` from `dweigend/neural-flight-template`.

Target branch: `jw-experience-runner-qol`.

## Prompt 1 - Feasibility Check For Heading Reset

You are working in the SvelteKit ICAROS VR repo. Before editing code, check whether a homepage button can make the current headset direction become the forward flight direction for the active `/vr` experience.

Inspect:

- `src/routes/+page.svelte`
- `src/routes/vr/+page.svelte`
- `src/lib/ws/client.svelte.ts`
- `src/lib/ws/server.ts`
- `src/lib/ws/protocol.ts`
- `src/lib/types/orientation.ts`
- `src/lib/three/player.ts`
- all experience `player.ts` files that call `FlightPlayer`

Answer in a short note inside the implementation summary:

- Is the root page able to directly read headset orientation? Expected: no, not if root and `/vr` are on different devices.
- Can the root page send a command to the VR page? Expected: yes, through the existing WebSocket broadcast path.
- Can `/vr` read headset view direction? Expected: yes while an XR session is presenting, using the renderer XR camera or reference space data inside `/vr`.
- What is the smallest agnostic implementation? Expected: add a generic runner control command, handle it in `/vr`, and add an optional manifest/player lifecycle method only if the shared `FlightPlayer` cannot cover the active experiences cleanly.

Do not implement yet. Do not add dependencies.

## Prompt 2 - Add Runner Control WebSocket Messages

Add a minimal WebSocket message type for runner controls.

Requirements:

- Edit `src/lib/types/orientation.ts`.
- Add:
  - `ExperienceRunnerCommand`
  - `type: "experience-runner"`
  - `action: "reset-heading" | "reset-experience" | "pause" | "play"`
  - `timestamp: number`
- Include it in `ControllerMessage`.
- Edit `src/lib/ws/protocol.ts`.
- Add `isExperienceRunnerCommand(data: unknown): data is ExperienceRunnerCommand`.
- Accept the new type in `parseMessage()`.
- Keep validation simple and explicit. No `any`.
- Do not change `src/lib/ws/server.ts` unless the existing broadcast path fails for the new type.

Verify:

- `bunx svelte-check --threshold warning`

## Prompt 3 - Add Root Page Runner Controls

Add controls to the root page experience panel. These controls send runner commands over the existing WebSocket client.

Requirements:

- Edit `src/routes/+page.svelte`.
- Add three compact controls near the selected experience UI:
  - Reset heading
  - Restart experience
  - Pause / Play toggle
- Use existing `ws.send(...)`.
- Keep state only for the local pause/play button label. Do not create a global store.
- Disable controls when the WebSocket is not connected if that status is easy to read from the existing client.
- Use existing button/panel styling where possible. Add only the CSS needed for layout.
- Keep controls visible on the root route `/`, not `/controller` and not inside `/vr`.
- Use lucide icons already available through `lucide-svelte`.
- Do not add explanatory text blocks in the UI.

Verify:

- Root page still lists and selects experiences.
- Commands are sent as `{ type: "experience-runner", action, timestamp }`.
- `bunx svelte-check --threshold warning`

## Prompt 4 - Handle Pause And Restart In `/vr`

Handle runner commands in `src/routes/vr/+page.svelte`.

Requirements:

- Import `isExperienceRunnerCommand`.
- Track the current `ActiveExperience` in a local variable so commands can affect it.
- Implement `pause` and `play`:
  - While paused, still call `renderer.render(scene, renderCamera)`.
  - While paused, do not call `exp.manifest.updatePlayer(...)`.
  - While paused, do not call `exp.manifest.tick(...)`.
  - Use `clock.getDelta()` in a way that avoids a giant delta after resume.
- Implement `reset-experience`:
  - Keep the selected experience ID.
  - Unload the current experience.
  - Reload the same experience with the same `scene`, `dummyCamera`, and `renderer`.
  - Recreate resize handling without leaking listeners.
  - Reset score/output state as needed.
  - Keep the render loop alive.
- Do not use `location.reload()` unless proper lifecycle reset proves too risky; if you choose reload, document why in a short code comment.
- Preserve cleanup in `onDestroy()`.
- No `any`.

Verify:

- Start `/vr`, pause from `/`, verify movement/experience updates stop while rendering continues.
- Play resumes without a huge jump.
- Restart reloads the selected experience and preserves the selected experience ID.
- `bunx svelte-check --threshold warning`

## Prompt 5 - Implement Heading Reset In The Smallest Safe Place

Implement heading reset after Prompt 1 confirms feasibility.

Preferred path:

- Add a small method to `src/lib/three/player.ts`, such as `resetHeadingTo(yawRadians: number): void`.
- Use it from experiences that use `FlightPlayer` without duplicating heading math.
- If the active experience state does not expose a `FlightPlayer`, add an optional manifest method instead:
  - `resetHeading?: (state: ExperienceState, yawRadians: number) => void`
  - Call it from `/vr` only when present.

In `/vr`:

- On `"reset-heading"`, read the current headset yaw only while `renderer.xr.isPresenting`.
- Use the XR camera/world direction to derive horizontal yaw.
- Ignore pitch when calculating yaw.
- If XR is not presenting, do nothing and optionally log a short warning.
- Do not add a visible VR overlay.

Implementation hints:

- Use `renderer.xr.getCamera(renderCamera)` or `renderer.xr.updateCamera(renderCamera)` plus `getWorldDirection(...)`.
- Horizontal yaw can come from the normalized X/Z direction.
- Keep the sign convention consistent with `FlightPlayer.tick()`, which uses `-Math.sin(heading)` for X and `-Math.cos(heading)` for Z.

Verify:

- In VR, look in a new direction, press Reset heading on `/`, then forward flight follows that direction.
- Existing controller/button reset behavior still works if present.
- `bunx svelte-check --threshold warning`

## Prompt 6 - Final Check

Run the repo checks and do a manual smoke test.

Commands:

```bash
bunx biome check --write .
bunx svelte-check --threshold warning
```

Manual checks:

- Open root page at `https://<server-ip>:5173/`.
- Select an experience.
- Open `/vr` on the Quest.
- Use root page controls:
  - Pause stops as much as possible without blanking VR.
  - Play resumes.
  - Restart reloads the same selected experience.
  - Reset heading uses the current headset look direction as forward while in XR.
- Confirm no new dependency was added.
- Confirm all created Three.js resources are still disposed on destroy/reset.

Commit only after asking the user.
