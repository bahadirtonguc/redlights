// Raw shapes returned by Hamburg's SensorThings API — only the fields we use.
// Verified against the live feed at https://tld.iot.hamburg.de/v1.1/

export interface RawObservation {
  "@iot.id": number;
  phenomenonTime: string;
  resultTime: string;
  result: number;
}

export interface RawDatastream {
  "@iot.id": number;
  name: string; // e.g. "Primary signal heads at 353_13"
  properties: {
    layerName?: string;
    signalGroupID?: string;
    [key: string]: unknown;
  };
  // Each primary-signal Datastream carries the lane connection's own
  // location as observedArea — no need to separately expand Thing/Locations.
  observedArea?: {
    type: "LineString" | "Point";
    coordinates: number[][] | number[];
  };
  Observations?: RawObservation[];
}

// Primary-signal result codes, per the TLF usage guide.
export const PRIMARY_SIGNAL_CODES = {
  DARK: 0,
  RED: 1,
  AMBER: 2,
  GREEN: 3,
  RED_AMBER: 4,
  AMBER_FLASHING: 5,
  GREEN_FLASHING: 6,
  UNKNOWN: 9,
} as const;

// "Primary signal heads at 353_13" -> { intersectionId: "353", connectionId: "13" }
export function parseConnectionName(datastreamName: string): {
  intersectionId: string;
  connectionId: string;
} {
  const match = datastreamName.match(/at\s+([0-9]+)_([0-9]+)/);
  if (!match) {
    return { intersectionId: datastreamName, connectionId: datastreamName };
  }
  return { intersectionId: match[1], connectionId: match[2] };
}
