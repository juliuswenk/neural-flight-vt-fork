// @ts-nocheck
import { afterEach, expect, test } from "bun:test";
import {
  BerlinConeDatasetLoadError,
  createBerlinConeDatasetAssetLoader,
} from "./asset-loader";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createBerlinConeDatasetAssetLoader fetches manifest and chunks from static assets", async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));

    if (String(url).endsWith("/manifest.json")) {
      return Response.json({
        version: 1,
        origin: { x: 0, z: 0 },
        chunkSizeMeters: 1920,
        bounds: {
          minChunkX: 0,
          maxChunkX: 0,
          minChunkZ: 0,
          maxChunkZ: 0,
        },
        chunkCount: 1,
      });
    }

    return Response.json({
      chunkKey: "0:0",
      chunkWorldMinX: 0,
      chunkWorldMinZ: 0,
      chunkSizeMeters: 1920,
      positions: [0, 20, 0, 0, -1, 0],
      scalars: [48, 180],
      coneIndex: [0],
    });
  };

  const loader = createBerlinConeDatasetAssetLoader();

  expect(await loader.loadManifest()).toMatchObject({ chunkCount: 1 });
  expect((await loader.loadChunk("0:0")).cones).toHaveLength(1);
  expect(requestedUrls).toEqual([
    "/experiences/berlin-flight/cone-data/generated/manifest.json",
    "/experiences/berlin-flight/cone-data/generated/chunks/0_0.json",
  ]);
});

test("createBerlinConeDatasetAssetLoader reports missing chunk assets", async () => {
  globalThis.fetch = async () => new Response("missing", { status: 404 });

  await expect(
    createBerlinConeDatasetAssetLoader().loadChunk("0:0"),
  ).rejects.toThrow(BerlinConeDatasetLoadError);
});
