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

export const WERKSCHAU_RADIO_STATIONS: WerkschauRadioStationDef[] = [
  {
    id: "rbbfritz",
    name: "rbb FRITZ",
    url: "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid",
    position: { x: -450, y: 85, z: -450 },
    volume: 0.6,
    refDistance: 35,
    maxDistance: 900,
  },
  {
    id: "rbb888",
    name: "rbb 88.8",
    url: "https://dispatcher.rndfnk.com/rbb/rbb888/live/mp3/mid",
    position: { x: 450, y: 85, z: 450 },
    volume: 0.4,
    refDistance: 35,
    maxDistance: 900,
  },
];

export const WERKSCHAU_RADIO = {
  ROLLOFF_FACTOR: 1,
  DISTANCE_MODEL: "linear" as const,
} as const;
