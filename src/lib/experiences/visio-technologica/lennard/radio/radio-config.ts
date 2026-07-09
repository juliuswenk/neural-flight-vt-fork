export interface RadioStationDef {
  id: string;
  name: string;
  url: string;
  position: { x: number; y: number; z: number };
  volume: number;
  refDistance: number;
  maxDistance: number;
  /** Cone for directional sound (optional; default omni) */
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
}

/**
 * Radio stations positioned in world-space.
 *
 * Positions are relative to the `visio-technologica` world root.
 * Edit `url` to point to any Shoutcast/Icecast stream.
 *
 * The server proxies these URLs at `/api/radio/proxy?url=...` to
 * avoid CORS issues on the Quest browser.
 */
export const RADIO_STATIONS: RadioStationDef[] = [
  {
    id: "rbbfritz",
    name: "rbb FRITZ",
    url: "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid", //http://www.radioeins.de/livemp3_s
    position: { x: 0, y: 3, z: 0 },
    volume: 0.6,
    refDistance: 20,
    maxDistance: 200,
  },
  {
    id: "rbb888",
    name: "rbb 88.8",
    url: "https://dispatcher.rndfnk.com/rbb/rbb888/live/mp3/mid", //https://stream-relay-geo.ntslive.net/stream
    position: { x: 160, y: 3, z: 160 },
    volume: 0.4,
    refDistance: 15,
    maxDistance: 180,
  },
];

export const RADIO = {
  VOLUME: 0.5,
  ROLLOFF_FACTOR: 1,
  DISTANCE_MODEL: "linear" as const,
} as const;
