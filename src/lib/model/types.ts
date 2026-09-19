// City-agnostic, live-only traffic-signal model.
// Any city adapter (Hamburg today, others later) must produce these shapes.
//
// The wire format is split in two because the two halves change at very
// different rates:
//   - geometry (where a signal is) is static -> fetched once, cached for hours
//   - states   (what colour it is)  is live   -> polled every few seconds
// and it is deliberately array-shaped (tuples, not objects) to keep the
// polled payload small.

// A signal that has no trustworthy live observation is never sent at all, so
// the only states that exist on the wire are red and green.
export type LiveState = "r" | "g";

// [id, longitude, latitude]
export type GeometryTuple = [id: number, lon: number, lat: number];

// [id, state, updatedAt] — updatedAt is epoch SECONDS of the last state change
// (clamped so it is never in the future).
export type StateTuple = [id: number, state: LiveState, updatedAt: number];

export interface SourceInfo {
  name: string;
  attribution: string;
  license: string;
}

export interface GeometrySnapshot {
  city: string;
  generatedAt: string; // ISO 8601
  source: SourceInfo;
  signals: GeometryTuple[];
}

export interface StatesSnapshot {
  city: string;
  generatedAt: string; // ISO 8601
  // Age cut-off (seconds) that was applied: a signal whose last state change is
  // older than this is treated as offline and left out.
  maxAgeSeconds: number;
  total: number; // signals we asked the feed about
  live: number; // === signals.length
  excluded: {
    offline: number; // no observation / invalid timestamp / too old
    other: number; // dark, amber, amber-flashing, unknown
  };
  signals: StateTuple[];
}

// A city adapter exposes exactly this contract to the rest of the app.
export interface CityAdapter {
  city: string;
  getGeometry(): Promise<GeometrySnapshot>;
  getStates(): Promise<StatesSnapshot>;
}
