This document is the list of things to fix to make the berlin flight experience ready for exhibition. When doing the fixes listed here, make sure everything runs smoothly and still has good performance. These are the final fixes.

After testing the experience, these problems need fixing:

1. No skybox after intro is over -> FIXED & Commited
   - Fix plan: Check `scene.ts` transition logic. The skybox is hidden during onboarding and should become visible when `onboarding.isComplete` is true. Ensure `setBerlinSkyboxVisible(true)` runs after the intro, `scene.background` stays opaque, and AR clear alpha becomes `1`. 

2. No cone textures visible -> FIXED
   - Fix plan: Verify the cone mask path first: active cones, tracked tile meshes, `coneMask` attribute writes, and `BERLIN_COLLISION_TICK_ENABLED`. If masks update but textures still do not show, simplify `tiles-material.ts` so inside-cone pixels use the original tile map and outside-cone pixels use the neutral color.

3. Flashing models in the intro -> FIXED 
   - Fix plan: Stop toggling visibility by traversing every mesh each frame. Put Berlin world visuals under explicit groups and toggle `tilesGroup`, `coneRuntime.root`, debug/grid helpers, and lights directly so newly loaded tile meshes do not flash visible during onboarding.

4. Controller input missing -> FIXED but needs work
   - Fix plan: Check `player.ts`: input is currently ignored while `state.onboarding.isActive`. Decide whether input should work during the intro. If yes, remove or narrow that guard. If no, test `/controller` WebSocket and ICAROS host input after onboarding completes.

5. No radio audible for VR glasses (works in browser) -> FIXED, needs headset retest
   - Fix plan: Resume the `AudioContext` from an XR/user gesture path. In `scene.ts`, when XR is presenting, call `listener.context.resume()` if suspended, then start `radioManager` only after the context state is `running`.

6. Heatmaps work?
   - Fix plan: Treat this as an offline cone-generation check, not runtime display. The sampler exists, but `camera-density-loader.ts` only stores a sampler and the current PNG is a tiny placeholder. Wire heatmap loading into the offline cone dataset build, regenerate cones, and confirm build stats show density-based rejection.

7. Audio tests und placement?
   - Fix plan: Use `/lab/radio` to test station audibility, range, and panning. Add the smallest useful config test for station positions/ranges and global background stations. Copy only confirmed values into `audio/radio-config.ts`.

8. Background Sounds
   - Fix plan: `radio-config.ts` points to `/audio/city-traffic-noise.mp3` and `/audio/strong-wind.mp3`, but `static/audio` is missing. Add those assets under `static/audio/` or remove the background entries until the files exist.

9. Radio Positionen setzen
   - Fix plan: Tune radio station `position`, `refDistance`, `maxDistance`, and `volume` in `/lab/radio`, then persist the final constants in `audio/radio-config.ts`. Skip a new placement system unless fixed positions are not enough.

10. Outro geht noch nicht zurück zu AR
