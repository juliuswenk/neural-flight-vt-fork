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
}

export const BERLIN_RADIO_STATIONS: BerlinRadioStationDef[] = [
  {
    id: "kexp",
    name: "KEXP 90.3",
    url: "https://kexp-mp3-128.streamguys1.com/kexp128.mp3",
    position: { x: -450, y: 85, z: -450 },
    volume: 0.6,
    refDistance: 35,
    maxDistance: 320,
  },
  {
    id: "nts",
    name: "NTS Radio",
    url: "https://stream-relay-geo.ntslive.net/stream",
    position: { x: 450, y: 85, z: 450 },
    volume: 0.4,
    refDistance: 35,
    maxDistance: 320,
    coneInnerAngle: 120,
    coneOuterAngle: 240,
    coneOuterGain: 0.2,
  },
];

export const BERLIN_RADIO = {
  ROLLOFF_FACTOR: 3,
  DISTANCE_MODEL: "inverse" as const,
} as const;
