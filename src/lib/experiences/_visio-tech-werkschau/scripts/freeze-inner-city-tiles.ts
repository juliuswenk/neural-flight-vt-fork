import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { WERKSCHAU_BERLIN_MITTE_ORIGIN } from "../geo/berlin-mitte-origin";
import { geoToLocal, getECEFToLocalMatrix } from "../geo/coordinates";

const MANIFEST_FILE = "werkschau-freeze-manifest.json";
const ROOT_TILESET_FILE = "tileset.json";
const SMOKE_CONTENT_LIMIT = 5;
const RENDER_CONTENT_MARGIN_METERS = 1000;
const WERKSCHAU_ION_ASSET_ID = Number(process.env.PUBLIC_BERLIN_ION_ASSET_ID);
const WERKSCHAU_EXHIBITION_BOUNDS = {
  center: {
    x: 0,
    y: 100,
    z: 0,
  },
  sideLengthMeters: 4000,
  minX: -2000,
  maxX: 2000,
  minZ: -2000,
  maxZ: 2000,
} as const;
const ecefToLocalMatrix = getECEFToLocalMatrix(WERKSCHAU_BERLIN_MITTE_ORIGIN);

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface FreezeManifest {
  cesiumIonAssetId: number | null;
  resolvedTilesetUrl: string;
  extractionDate: string;
  sideLengthMeters: number;
  centerLocalPosition: typeof WERKSCHAU_EXHIBITION_BOUNDS.center;
  squareBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  smoke: boolean;
  filesSaved: string[];
  bytesSaved: number;
  skippedRemoteUrls: string[];
  failedRemoteUrls: { url: string; error: string }[];
}

interface FreezeContext {
  outputDir: string;
  token: string;
  googleApiKey: string;
  googleSessionToken: string;
  smoke: boolean;
  resume: boolean;
  contentSaved: number;
  savedFiles: Set<string>;
  skippedRemoteUrls: Set<string>;
  failedRemoteUrls: { url: string; error: string }[];
  bytesSaved: number;
  visitedTilesets: Set<string>;
}

interface ContentRef {
  holder: JsonObject;
  key: "uri" | "url";
  value: string;
}

interface FreezeTilesSource {
  url: string;
  token: string;
}

type CesiumIonEndpointResponse = {
  accessToken?: unknown;
  options?: {
    url?: unknown;
  };
  url?: unknown;
};

await main();

async function main(): Promise<void> {
  const outputArg = process.argv[2];
  const smoke = process.argv.includes("--smoke");
  const resume = process.argv.includes("--resume");

  if (!outputArg) {
    throw new Error(
      "Usage: bun run src/lib/experiences/_visio-tech-werkschau/scripts/freeze-inner-city-tiles.ts <output-dir> [--smoke] [--resume]",
    );
  }

  const outputDir = path.resolve(outputArg);
  const source = await resolveFreezeTilesSource();
  const context: FreezeContext = {
    outputDir,
    token: source.token,
    googleApiKey: getGoogleApiKey(source.url),
    googleSessionToken: "",
    smoke,
    resume,
    contentSaved: 0,
    savedFiles: new Set<string>(),
    skippedRemoteUrls: new Set<string>(),
    failedRemoteUrls: [],
    bytesSaved: 0,
    visitedTilesets: new Set<string>(),
  };

  if (!resume) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  const rootTileset = await fetchJson(source.url, context);
  context.googleSessionToken = getGoogleSessionToken(rootTileset);
  const frozenTileset = await freezeTileset(
    rootTileset,
    source.url,
    ROOT_TILESET_FILE,
    context,
  );

  await saveJson(ROOT_TILESET_FILE, frozenTileset, context);
  await writeManifest(source.url, smoke, context);

  console.log(
    JSON.stringify(
      {
        outputDir,
        smoke,
        filesSaved: context.savedFiles.size,
        bytesSaved: context.bytesSaved,
        skippedRemoteUrls: context.skippedRemoteUrls.size,
        failedRemoteUrls: context.failedRemoteUrls.length,
      },
      null,
      2,
    ),
  );
}

async function resolveFreezeTilesSource(): Promise<FreezeTilesSource> {
  const directUrl = process.env.PUBLIC_BERLIN_TILES_URL ?? "";
  const ionToken = process.env.PUBLIC_CESIUM_ION_TOKEN ?? "";

  if (directUrl) {
    return {
      url: directUrl,
      token: ionToken,
    };
  }

  if (!ionToken || !WERKSCHAU_ION_ASSET_ID) {
    throw new Error(
      "[Werkschau] Missing PUBLIC_BERLIN_TILES_URL or PUBLIC_CESIUM_ION_TOKEN + PUBLIC_BERLIN_ION_ASSET_ID.",
    );
  }

  const endpoint = `https://api.cesium.com/v1/assets/${WERKSCHAU_ION_ASSET_ID}/endpoint?access_token=${ionToken}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(
      `[Werkschau] Failed to resolve Cesium Ion asset: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as CesiumIonEndpointResponse;

  return {
    url: getCesiumTilesetUrl(data),
    token: getStringValue(data.accessToken),
  };
}

function getCesiumTilesetUrl(data: CesiumIonEndpointResponse): string {
  const tilesetUrl =
    getStringValue(data.url) || getStringValue(data.options?.url);
  if (tilesetUrl) return tilesetUrl;

  throw new Error(
    `[Werkschau] Cesium Ion response missing tileset URL. Response: ${JSON.stringify(data)}`,
  );
}

function getStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function freezeTileset(
  tileset: JsonObject,
  tilesetUrl: string,
  localTilesetPath: string,
  context: FreezeContext,
): Promise<JsonObject> {
  if (context.visitedTilesets.has(tilesetUrl)) return tileset;
  context.visitedTilesets.add(tilesetUrl);

  const frozen = cloneJsonObject(tileset);
  const root = getObject(frozen.root);
  if (!root) return frozen;

  const frozenRoot = await freezeTile(
    root,
    tilesetUrl,
    path.posix.dirname(localTilesetPath),
    context,
  );
  if (frozenRoot) {
    frozen.root = frozenRoot;
  } else {
    delete frozen.root;
  }

  return frozen;
}

async function freezeTile(
  tile: JsonObject,
  baseUrl: string,
  localDir: string,
  context: FreezeContext,
): Promise<JsonObject | null> {
  if (!intersectsFrozenBounds(getObject(tile.boundingVolume))) {
    collectContentUrls(tile, baseUrl, context.skippedRemoteUrls);
    return null;
  }

  const frozen = cloneJsonObject(tile);
  await freezeTileContent(frozen, baseUrl, localDir, context, isTilesetJson);

  const children = getArray(tile.children)
    .map(getObject)
    .filter((child): child is JsonObject => child !== null);
  const frozenChildren: JsonObject[] = [];

  for (const child of children) {
    if (context.smoke && context.contentSaved >= SMOKE_CONTENT_LIMIT) break;

    const frozenChild = await freezeTile(child, baseUrl, localDir, context);
    if (frozenChild) frozenChildren.push(frozenChild);
  }

  if (frozenChildren.length > 0) {
    frozen.children = frozenChildren;
    deleteTileContent(frozen, baseUrl, (remoteUrl) => !isTilesetJson(remoteUrl));
  } else {
    delete frozen.children;
    if (intersectsRenderContentBounds(getObject(tile.boundingVolume))) {
      await freezeTileContent(
        frozen,
        baseUrl,
        localDir,
        context,
        (remoteUrl) => !isTilesetJson(remoteUrl),
      );
    } else {
      deleteAndCollectTileContent(
        frozen,
        baseUrl,
        context.skippedRemoteUrls,
        (remoteUrl) => !isTilesetJson(remoteUrl),
      );
      if (getContentRefs(frozen).length === 0) return null;
    }
  }

  return frozen;
}

async function freezeTileContent(
  tile: JsonObject,
  baseUrl: string,
  localDir: string,
  context: FreezeContext,
  shouldFreeze: (remoteUrl: string) => boolean,
): Promise<void> {
  const contentRefs = getContentRefs(tile);
  if (contentRefs.length === 0) return;

  for (const ref of contentRefs) {
    if (context.smoke && context.contentSaved >= SMOKE_CONTENT_LIMIT) {
      delete ref.holder[ref.key];
      continue;
    }

    const remoteUrl = resolveRemoteUrl(ref.value, baseUrl);
    if (!shouldFreeze(remoteUrl)) continue;

    const localPath = getLocalPath(ref.value, remoteUrl, localDir);
    const relativePath = path.posix.relative(localDir || ".", localPath);

    ref.holder[ref.key] = relativePath || path.posix.basename(localPath);
    context.contentSaved += 1;

    if (isTilesetJson(remoteUrl)) {
      const nestedTileset = await fetchJson(remoteUrl, context, localPath);
      const frozenTileset = await freezeTileset(
        nestedTileset,
        remoteUrl,
        localPath,
        context,
      );
      await saveJson(localPath, frozenTileset, context);
      continue;
    }

    if (isGltfJson(remoteUrl)) {
      await saveGltf(remoteUrl, localPath, context);
      continue;
    }

    await saveRemoteFile(remoteUrl, localPath, context);
  }
}

async function saveGltf(
  remoteUrl: string,
  localPath: string,
  context: FreezeContext,
): Promise<void> {
  const gltf = await fetchJson(remoteUrl, context, localPath);
  const localDir = path.posix.dirname(localPath);

  await rewriteGltfExternalUris(gltf, "buffers", remoteUrl, localDir, context);
  await rewriteGltfExternalUris(gltf, "images", remoteUrl, localDir, context);
  await saveJson(localPath, gltf, context);
}

async function rewriteGltfExternalUris(
  gltf: JsonObject,
  key: "buffers" | "images",
  baseUrl: string,
  localDir: string,
  context: FreezeContext,
): Promise<void> {
  const entries = getArray(gltf[key]);
  for (const entryValue of entries) {
    const entry = getObject(entryValue);
    if (!entry || typeof entry.uri !== "string" || isDataUri(entry.uri)) {
      continue;
    }

    const remoteUrl = resolveRemoteUrl(entry.uri, baseUrl);
    const localPath = getLocalPath(entry.uri, remoteUrl, localDir);
    entry.uri =
      path.posix.relative(localDir || ".", localPath) ||
      path.posix.basename(localPath);
    await saveRemoteFile(remoteUrl, localPath, context);
  }
}

async function fetchJson(
  url: string,
  context: FreezeContext,
  localPath?: string,
): Promise<JsonObject> {
  if (localPath && context.resume) {
    const cached = await readExistingFile(localPath, context);
    if (cached) {
      return parseJsonObject(cached, localPath);
    }
  }

  const buffer = await fetchBytes(url, context);
  return parseJsonObject(buffer, url);
}

function parseJsonObject(buffer: Buffer, label: string): JsonObject {
  const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`[Werkschau] Expected JSON object at ${label}`);
  }

  return parsed;
}

async function saveRemoteFile(
  url: string,
  localPath: string,
  context: FreezeContext,
): Promise<void> {
  if (context.resume && (await recordExistingFile(localPath, context))) return;

  const bytes = await fetchBytes(url, context);
  await saveBytes(localPath, bytes, context);
}

async function readExistingFile(
  localPath: string,
  context: FreezeContext,
): Promise<Buffer | null> {
  try {
    const outputPath = path.join(context.outputDir, localPath);
    const fileStats = await stat(outputPath);
    if (!fileStats.isFile()) return null;

    const manifestPath = toPosixPath(localPath);
    if (!context.savedFiles.has(manifestPath)) {
      context.savedFiles.add(manifestPath);
      context.bytesSaved += fileStats.size;
    }
    return await readFile(outputPath);
  } catch {
    return null;
  }
}

async function recordExistingFile(
  localPath: string,
  context: FreezeContext,
): Promise<boolean> {
  return (await readExistingFile(localPath, context)) !== null;
}

async function fetchBytes(
  url: string,
  context: FreezeContext,
): Promise<Buffer> {
  try {
    const response = await fetch(getAuthenticatedUrl(url, context), {
      headers: context.token
        ? { Authorization: `Bearer ${context.token}` }
        : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} for ${redactUrl(url)}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (error: unknown) {
    context.failedRemoteUrls.push({
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function saveJson(
  localPath: string,
  value: JsonObject,
  context: FreezeContext,
): Promise<void> {
  await saveBytes(localPath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`), context);
}

async function saveBytes(
  localPath: string,
  bytes: Buffer,
  context: FreezeContext,
): Promise<void> {
  const outputPath = path.join(context.outputDir, localPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  context.savedFiles.add(toPosixPath(localPath));
  context.bytesSaved += bytes.byteLength;
}

async function writeManifest(
  sourceUrl: string,
  smoke: boolean,
  context: FreezeContext,
): Promise<void> {
  const manifest: FreezeManifest = {
    cesiumIonAssetId: Number.isFinite(WERKSCHAU_ION_ASSET_ID)
      ? WERKSCHAU_ION_ASSET_ID
      : null,
    resolvedTilesetUrl: redactUrl(sourceUrl),
    extractionDate: new Date().toISOString(),
    sideLengthMeters: WERKSCHAU_EXHIBITION_BOUNDS.sideLengthMeters,
    centerLocalPosition: WERKSCHAU_EXHIBITION_BOUNDS.center,
    squareBounds: {
      minX: WERKSCHAU_EXHIBITION_BOUNDS.minX,
      maxX: WERKSCHAU_EXHIBITION_BOUNDS.maxX,
      minZ: WERKSCHAU_EXHIBITION_BOUNDS.minZ,
      maxZ: WERKSCHAU_EXHIBITION_BOUNDS.maxZ,
    },
    smoke,
    filesSaved: [...context.savedFiles].sort(),
    bytesSaved: context.bytesSaved,
    skippedRemoteUrls: [...context.skippedRemoteUrls].map(redactUrl).sort(),
    failedRemoteUrls: context.failedRemoteUrls.map((failure) => ({
      url: redactUrl(failure.url),
      error: failure.error,
    })),
  };

  await saveJson(MANIFEST_FILE, manifest as unknown as JsonObject, context);
}

function intersectsFrozenBounds(boundingVolume: JsonObject | null): boolean {
  if (!boundingVolume) return true;

  const sphere = getNumberArray(boundingVolume.sphere, 4);
  if (sphere) {
    const center = new THREE.Vector3(sphere[0], sphere[1], sphere[2]).applyMatrix4(
      ecefToLocalMatrix,
    );
    return isInsideSquare(center.x, center.z, sphere[3]);
  }

  const box = getNumberArray(boundingVolume.box, 12);
  if (box) {
    return boxIntersectsFrozenBounds(box);
  }

  const region = getNumberArray(boundingVolume.region, 6);
  if (region) {
    return regionIntersectsFrozenBounds(region);
  }

  return true;
}

function boxIntersectsFrozenBounds(box: readonly number[]): boolean {
  const center = new THREE.Vector3(box[0], box[1], box[2]).applyMatrix4(
    ecefToLocalMatrix,
  );
  let xzExtent = 0;

  for (let offset = 3; offset <= 9; offset += 3) {
    const endpoint = new THREE.Vector3(
      box[0] + box[offset],
      box[1] + box[offset + 1],
      box[2] + box[offset + 2],
    ).applyMatrix4(ecefToLocalMatrix);
    xzExtent += Math.hypot(endpoint.x - center.x, endpoint.z - center.z);
  }

  return isInsideSquare(center.x, center.z, xzExtent);
}

function regionIntersectsFrozenBounds(region: readonly number[]): boolean {
  const west = radiansToDegrees(region[0]);
  const south = radiansToDegrees(region[1]);
  const east = radiansToDegrees(region[2]);
  const north = radiansToDegrees(region[3]);
  const corners = [
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: south,
      lon: west,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: south,
      lon: east,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: north,
      lon: west,
      height: 0,
    }),
    geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
      lat: north,
      lon: east,
      height: 0,
    }),
  ];
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minZ = Math.min(...corners.map((corner) => corner.z));
  const maxZ = Math.max(...corners.map((corner) => corner.z));

  return squareIntersectsSquare(minX, maxX, minZ, maxZ, 0);
}

function intersectsRenderContentBounds(boundingVolume: JsonObject | null): boolean {
  const center = getBoundingVolumeCenter(boundingVolume);
  if (!center) return true;

  return isInsideSquare(
    center.x,
    center.z,
    RENDER_CONTENT_MARGIN_METERS,
  );
}

function getBoundingVolumeCenter(
  boundingVolume: JsonObject | null,
): THREE.Vector3 | null {
  if (!boundingVolume) return null;

  const sphere = getNumberArray(boundingVolume.sphere, 4);
  if (sphere) {
    return new THREE.Vector3(sphere[0], sphere[1], sphere[2]).applyMatrix4(
      ecefToLocalMatrix,
    );
  }

  const box = getNumberArray(boundingVolume.box, 12);
  if (box) {
    return new THREE.Vector3(box[0], box[1], box[2]).applyMatrix4(
      ecefToLocalMatrix,
    );
  }

  const region = getNumberArray(boundingVolume.region, 6);
  if (region) {
    return new THREE.Vector3(
      geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
        lat: radiansToDegrees((region[1] + region[3]) / 2),
        lon: radiansToDegrees((region[0] + region[2]) / 2),
        height: (region[4] + region[5]) / 2,
      }).x,
      0,
      geoToLocal(WERKSCHAU_BERLIN_MITTE_ORIGIN, {
        lat: radiansToDegrees((region[1] + region[3]) / 2),
        lon: radiansToDegrees((region[0] + region[2]) / 2),
        height: (region[4] + region[5]) / 2,
      }).z,
    );
  }

  return null;
}

function isInsideSquare(x: number, z: number, extraRadius: number): boolean {
  return (
    x >= WERKSCHAU_EXHIBITION_BOUNDS.minX - extraRadius &&
    x <= WERKSCHAU_EXHIBITION_BOUNDS.maxX + extraRadius &&
    z >= WERKSCHAU_EXHIBITION_BOUNDS.minZ - extraRadius &&
    z <= WERKSCHAU_EXHIBITION_BOUNDS.maxZ + extraRadius
  );
}

function squareIntersectsSquare(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  extraRadius: number,
): boolean {
  return (
    maxX >= WERKSCHAU_EXHIBITION_BOUNDS.minX - extraRadius &&
    minX <= WERKSCHAU_EXHIBITION_BOUNDS.maxX + extraRadius &&
    maxZ >= WERKSCHAU_EXHIBITION_BOUNDS.minZ - extraRadius &&
    minZ <= WERKSCHAU_EXHIBITION_BOUNDS.maxZ + extraRadius
  );
}

function getContentRefs(tile: JsonObject): ContentRef[] {
  const refs: ContentRef[] = [];
  const content = getObject(tile.content);
  if (content) addContentRef(content, refs);

  for (const value of getArray(tile.contents)) {
    const childContent = getObject(value);
    if (childContent) addContentRef(childContent, refs);
  }

  return refs;
}

function addContentRef(content: JsonObject, refs: ContentRef[]): void {
  if (typeof content.uri === "string") {
    refs.push({ holder: content, key: "uri", value: content.uri });
  } else if (typeof content.url === "string") {
    refs.push({ holder: content, key: "url", value: content.url });
  }
}

function deleteTileContent(
  tile: JsonObject,
  baseUrl: string,
  shouldDelete: (remoteUrl: string) => boolean,
): void {
  for (const ref of getContentRefs(tile)) {
    if (shouldDelete(resolveRemoteUrl(ref.value, baseUrl))) {
      delete ref.holder[ref.key];
    }
  }
}

function deleteAndCollectTileContent(
  tile: JsonObject,
  baseUrl: string,
  target: Set<string>,
  shouldDelete: (remoteUrl: string) => boolean,
): void {
  for (const ref of getContentRefs(tile)) {
    const remoteUrl = resolveRemoteUrl(ref.value, baseUrl);
    if (shouldDelete(remoteUrl)) {
      target.add(remoteUrl);
      delete ref.holder[ref.key];
    }
  }
}

function collectContentUrls(
  tile: JsonObject,
  baseUrl: string,
  target: Set<string>,
): void {
  for (const ref of getContentRefs(tile)) {
    target.add(resolveRemoteUrl(ref.value, baseUrl));
  }

  for (const childValue of getArray(tile.children)) {
    const child = getObject(childValue);
    if (child) collectContentUrls(child, baseUrl, target);
  }
}

function getLocalPath(ref: string, remoteUrl: string, localDir: string): string {
  if (!isAbsoluteUrl(ref)) {
    if (isHostRootPath(ref)) {
      return normalizeLocalPath(stripQueryHash(ref));
    }

    return normalizeLocalPath(path.posix.join(localDir, stripQueryHash(ref)));
  }

  const url = new URL(remoteUrl);
  return normalizeLocalPath(
    path.posix.join("_remote", url.hostname, stripQueryHash(url.pathname)),
  );
}

function normalizeLocalPath(value: string): string {
  const normalized = path.posix.normalize(value).replace(/^(\.\.\/)+/, "");
  return normalized.replace(/^\/+/, "") || "file";
}

function stripQueryHash(value: string): string {
  return value.split(/[?#]/, 1)[0] || "file";
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function resolveRemoteUrl(ref: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  if (base.hostname === "tile.googleapis.com" && isHostRootPath(ref)) {
    return new URL(`/${ref.replace(/^\/+/, "")}`, base.origin).href;
  }

  return new URL(ref, base).href;
}

function isHostRootPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("v1/3dtiles/");
}

function isTilesetJson(url: string): boolean {
  return new URL(url).pathname.toLowerCase().endsWith(".json");
}

function isGltfJson(url: string): boolean {
  return new URL(url).pathname.toLowerCase().endsWith(".gltf");
}

function isDataUri(value: string): boolean {
  return value.startsWith("data:");
}

function getGoogleApiKey(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  if (url.hostname !== "tile.googleapis.com") return "";

  return url.searchParams.get("key") ?? "";
}

function getAuthenticatedUrl(url: string, context: FreezeContext): string {
  if (!context.googleApiKey) return url;

  const fetchUrl = new URL(url);
  if (fetchUrl.hostname === "tile.googleapis.com") {
    fetchUrl.searchParams.set("key", context.googleApiKey);
    if (context.googleSessionToken) {
      fetchUrl.searchParams.set("session", context.googleSessionToken);
    }
  }

  return fetchUrl.href;
}

function getGoogleSessionToken(tileset: JsonObject): string {
  const root = getObject(tileset.root);
  return root ? getGoogleSessionTokenFromTile(root) : "";
}

function getGoogleSessionTokenFromTile(tile: JsonObject): string {
  for (const ref of getContentRefs(tile)) {
    const session = new URL(ref.value, "https://tile.googleapis.com").searchParams.get(
      "session",
    );
    if (session) return session;
  }

  for (const childValue of getArray(tile.children)) {
    const child = getObject(childValue);
    if (!child) continue;

    const session = getGoogleSessionTokenFromTile(child);
    if (session) return session;
  }

  return "";
}

function redactUrl(value: string): string {
  const url = new URL(value);
  for (const key of ["key", "access_token", "session"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "<redacted>");
  }

  return url.href;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function getNumberArray(
  value: JsonValue | undefined,
  minLength: number,
): number[] | null {
  if (!Array.isArray(value) || value.length < minLength) return null;
  const numbers = value.filter((entry): entry is number => typeof entry === "number");
  return numbers.length >= minLength ? numbers : null;
}

function getArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function getObject(value: JsonValue | undefined): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
