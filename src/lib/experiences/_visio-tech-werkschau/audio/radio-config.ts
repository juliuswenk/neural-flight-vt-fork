import { WERKSCHAU_EXHIBITION_BOUNDS } from "../constants";

export interface WerkschauRadioStationDef {
  id: string;
  name: string;
  url: string;
  position: { x: number; y: number; z: number };
  volume: number;
  refDistance: number;
  maxDistance: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  globalBackground?: boolean;
  loop?: boolean;
}

const RADIO_STATION_HEIGHT = 85;

// Each station sits at a corner of the playable square. Its max range is set
// to reach just past the center, so the two coverage circles overlap a bit
// in the middle of the map instead of only meeting at the border.
const RADIO_CORNER_TO_CENTER_DISTANCE = Math.hypot(
  WERKSCHAU_EXHIBITION_BOUNDS.sideLengthMeters / 2,
  WERKSCHAU_EXHIBITION_BOUNDS.sideLengthMeters / 2,
);
const RADIO_CENTER_OVERLAP_METERS = 200;
const RADIO_MAX_DISTANCE =
  RADIO_CORNER_TO_CENTER_DISTANCE + RADIO_CENTER_OVERLAP_METERS;
const RADIO_REF_DISTANCE = 200;

export const WERKSCHAU_RADIO_STATIONS: WerkschauRadioStationDef[] = [
  {
    id: "rbbfritz",
    name: "rbb FRITZ",
    url: "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid",
    position: {
      x: WERKSCHAU_EXHIBITION_BOUNDS.minX,
      y: RADIO_STATION_HEIGHT,
      z: WERKSCHAU_EXHIBITION_BOUNDS.minZ,
    },
    volume: 0.6,
    refDistance: RADIO_REF_DISTANCE,
    maxDistance: RADIO_MAX_DISTANCE,
  },
  {
    id: "rbb888",
    name: "rbb 88.8",
    url: "https://dispatcher.rndfnk.com/rbb/rbb888/live/mp3/mid",
    position: {
      x: WERKSCHAU_EXHIBITION_BOUNDS.maxX,
      y: RADIO_STATION_HEIGHT,
      z: WERKSCHAU_EXHIBITION_BOUNDS.maxZ,
    },
    volume: 0.4,
    refDistance: RADIO_REF_DISTANCE,
    maxDistance: RADIO_MAX_DISTANCE,
  },
];

export const WERKSCHAU_RADIO = {
  ROLLOFF_FACTOR: 1.15,
  DISTANCE_MODEL: "exponential" as const,
} as const;
