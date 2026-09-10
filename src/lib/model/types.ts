// City-agnostic normalized traffic-signal model.
// Any city adapter (Hamburg today, others later) must produce arrays of this shape.

export type SignalState = "red" | "green" | "other";

export interface NormalizedSignal {
  city: string;
  intersectionId: string;
  signalId: string;
  latitude: number;
  longitude: number;
  state: SignalState;
  lastUpdated: string; // ISO 8601
}

export interface SignalsSnapshot {
  city: string;
  generatedAt: string;
  source: {
    name: string;
    attribution: string;
    license: string;
  };
  signals: NormalizedSignal[];
}

// A city adapter exposes exactly this contract to the rest of the app.
export interface CityAdapter {
  city: string;
  getSnapshot(): Promise<SignalsSnapshot>;
}
