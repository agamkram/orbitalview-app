export interface Constellation {
  id: string;
  name: string;
  color: string;
  group: string;
  /** Off until the viewer turns the layer on. */
  startVisible?: boolean;
}

export const CONSTELLATIONS: Constellation[] = [
  {
    id: "stations",
    name: "Space Stations",
    color: "#ffffff",
    group: "stations",
  },
  {
    id: "starlink",
    name: "Starlink",
    color: "#ff6b6b",
    group: "starlink",
  },
  {
    id: "gps",
    name: "GPS",
    color: "#4dabf7",
    group: "gps-ops",
  },
  {
    id: "oneweb",
    name: "OneWeb",
    color: "#51cf66",
    group: "oneweb",
  },
  {
    id: "iridium",
    name: "Iridium NEXT",
    color: "#748ffc",
    group: "iridium-NEXT",
  },
  {
    id: "kuiper",
    name: "Kuiper",
    color: "#146eb4",
    group: "kuiper",
  },
  {
    id: "galileo",
    name: "Galileo",
    color: "#ffd43b",
    group: "galileo",
  },
  {
    id: "glo",
    name: "GLONASS",
    color: "#da77f2",
    group: "glo-ops",
  },
  {
    id: "beidou",
    name: "BeiDou",
    color: "#ff922b",
    group: "beidou",
  },
  {
    id: "qianfan",
    name: "Qianfan",
    color: "#22d3ee",
    group: "qianfan",
  },
  {
    id: "planet",
    name: "Planet",
    color: "#a3e635",
    group: "planet",
  },
  {
    id: "intelsat",
    name: "Intelsat",
    color: "#e2e8f0",
    group: "intelsat",
  },
  {
    id: "spire",
    name: "Spire",
    color: "#38bdf8",
    group: "spire",
  },
  {
    id: "globalstar",
    name: "Globalstar",
    color: "#fb7185",
    group: "globalstar",
  },
  {
    id: "weather",
    name: "Weather",
    color: "#67e8f9",
    group: "weather",
  },
  {
    id: "debris",
    name: "Debris",
    color: "#94a3b8",
    group: "debris",
    startVisible: false,
  },
  {
    id: "rocket",
    name: "Rocket bodies",
    color: "#d97706",
    group: "rocket",
    startVisible: false,
  },
  {
    id: "unknown",
    name: "Unknown",
    color: "#c4b5fd",
    group: "unknown",
    startVisible: false,
  },
];

export const CONSTELLATION_BY_ID = Object.fromEntries(
  CONSTELLATIONS.map((c) => [c.id, c]),
) as Record<string, Constellation>;