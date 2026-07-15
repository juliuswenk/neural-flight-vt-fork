import {
  WERKSCHAU_CESIUM_ION_TOKEN,
  WERKSCHAU_ION_ASSET_ID,
  WERKSCHAU_TILES_URL,
} from "../constants";

interface WerkschauTilesSourceBase {
  kind: "remote-tileset";
  url: string;
  token: string;
}

export interface WerkschauRemoteTilesSource extends WerkschauTilesSourceBase {
  kind: "remote-tileset";
}

export type WerkschauTilesSource = WerkschauRemoteTilesSource;

type CesiumIonEndpointResponse = {
  accessToken?: unknown;
  options?: {
    url?: unknown;
  };
  url?: unknown;
};

export function isWerkschauTilesSourceConfigured(): boolean {
  return Boolean(
    WERKSCHAU_TILES_URL ||
      (WERKSCHAU_CESIUM_ION_TOKEN && WERKSCHAU_ION_ASSET_ID),
  );
}

export async function resolveWerkschauTilesSource(
  signal?: AbortSignal,
): Promise<WerkschauTilesSource> {
  if (WERKSCHAU_TILES_URL) {
    return {
      kind: "remote-tileset",
      url: WERKSCHAU_TILES_URL,
      token: WERKSCHAU_CESIUM_ION_TOKEN || "",
    };
  }

  return resolveCesiumIonTilesSource(signal);
}

async function resolveCesiumIonTilesSource(
  signal?: AbortSignal,
): Promise<WerkschauTilesSource> {
  if (!WERKSCHAU_CESIUM_ION_TOKEN || !WERKSCHAU_ION_ASSET_ID) {
    throw new Error("[Werkschau] Missing Cesium Ion credentials in public env.");
  }

  const endpoint = `https://api.cesium.com/v1/assets/${WERKSCHAU_ION_ASSET_ID}/endpoint?access_token=${WERKSCHAU_CESIUM_ION_TOKEN}`;
  const response = await fetch(endpoint, { signal });
  if (!response.ok) {
    throw new Error(
      `[Werkschau] Failed to resolve Cesium Ion asset: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as CesiumIonEndpointResponse;

  return {
    kind: "remote-tileset",
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
