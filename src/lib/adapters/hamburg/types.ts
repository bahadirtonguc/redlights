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
