export interface BerlinRadioStationDef {
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

export const BERLIN_RADIO_STATIONS: BerlinRadioStationDef[] = [
  {
    id: "rbbfritz",
    name: "rbb FRITZ",
    url: "https://dispatcher.rndfnk.com/rbb/fritz/live/mp3/mid",
    position: { x: -450, y: 85, z: -450 },
    volume: 0.6,
    refDistance: 35,
    maxDistance: 320,
  },
  {
    id: "rbb888",
    name: "rbb 88.8",
    url: "https://dispatcher.rndfnk.com/rbb/rbb888/live/mp3/mid",
    position: { x: 450, y: 85, z: 450 },
    volume: 0.4,
    refDistance: 35,
    maxDistance: 320,
  },
  {
    id: "bg-city",
    name: "Background City Traffic",
    url: "/audio/city-traffic-noise.mp3",
    position: { x: 0, y: 0, z: 0 },
    volume: 0.15,
    refDistance: 1,
    maxDistance: 1000,
    globalBackground: true,
  },
  {
    id: "bg-wind",
    name: "Background Wind",
    url: "/audio/strong-wind.mp3",
    position: { x: 0, y: 0, z: 0 },
    volume: 0.12,
    refDistance: 1,
    maxDistance: 1000,
    globalBackground: true,
    loop: true,
  },
];

export const BERLIN_RADIO = {
  ROLLOFF_FACTOR: 1,
  DISTANCE_MODEL: "linear" as const,
} as const;
