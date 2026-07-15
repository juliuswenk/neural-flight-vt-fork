// @ts-nocheck
import { expect, mock, test } from "bun:test";

mock.module("$env/static/public", () => ({
  PUBLIC_BERLIN_ION_ASSET_ID: "0",
  PUBLIC_BERLIN_TILES_URL: "",
  PUBLIC_CESIUM_ION_TOKEN: "",
}));

const { WERKSCHAU_CONE_MIN_TIP_HEIGHT } = await import("../constants");
const { buildWerkschauConeSnapshotState } = await import(
  "./cone-grid-snapshots"
);

function createCone(coneIndex, tipHeight) {
  return {
    tip: { y: tipHeight },
    coneIndex,
  };
}

test("buildWerkschauConeSnapshotState filters cones by fixed tip height", () => {
  const state = buildWerkschauConeSnapshotState([
    {
      key: "0:0",
      cones: [
        createCone(0, WERKSCHAU_CONE_MIN_TIP_HEIGHT - 1),
        createCone(1, WERKSCHAU_CONE_MIN_TIP_HEIGHT),
        createCone(2, WERKSCHAU_CONE_MIN_TIP_HEIGHT + 1),
      ],
    },
  ]);

  expect(state.coneVolumes.map((cone) => cone.coneIndex)).toEqual([1, 2]);
  expect(state.chunkSnapshots[0].cones.map((cone) => cone.coneIndex)).toEqual([
    1, 2,
  ]);
});

test("buildWerkschauConeSnapshotState does not depend on loaded chunk average", () => {
  const state = buildWerkschauConeSnapshotState([
    {
      key: "low",
      cones: [createCone(1, WERKSCHAU_CONE_MIN_TIP_HEIGHT)],
    },
    {
      key: "high",
      cones: [createCone(2, WERKSCHAU_CONE_MIN_TIP_HEIGHT + 200)],
    },
  ]);

  expect(state.coneVolumes.map((cone) => cone.coneIndex)).toEqual([1, 2]);
});
