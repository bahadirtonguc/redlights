import { fetchCollection, HAMBURG_TLF_BASE } from "./client";
import { PRIMARY_SIGNAL_CODES, parseConnectionName, type RawDatastream } from "./types";
import type { CityAdapter, NormalizedSignal, SignalState, SignalsSnapshot } from "@/lib/model/types";

// Central Hamburg bounding box (Altstadt / St. Pauli / Sternschanze /
// Speicherstadt / Altona-Ost). The feed itself is citywide (~4,000 primary
// signal heads); we filter client-side to keep this an intimate portrait of
// one city core rather than a sprawling infrastructure dashboard.
const BBOX = { west: 9.93, south: 53.53, east: 10.03, north: 53.585 };

function inBbox(lon: number, lat: number): boolean {
  return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
}

function buildQueryUrl(): string {
  const filter = `properties/layerName eq 'primary_signal'`;
  const expand = "Observations($top=1;$orderby=phenomenonTime desc)";
  const params = new URLSearchParams({
    $filter: filter,
    $expand: expand,
    $top: "1000",
  });
  return `${HAMBURG_TLF_BASE}/Datastreams?${params.toString()}`;
}

function firstCoordinate(ds: RawDatastream): [number, number] | null {
  const area = ds.observedArea;
  if (!area) return null;

  if (area.type === "LineString") {
    const c = (area.coordinates as number[][])[0];
    return c ? [c[0], c[1]] : null;
  }
  if (area.type === "Point") {
    const c = area.coordinates as number[];
    return c ? [c[0], c[1]] : null;
  }
  return null;
}

function classifyState(result: number | undefined): SignalState {
  if (result === PRIMARY_SIGNAL_CODES.RED || result === PRIMARY_SIGNAL_CODES.RED_AMBER) {
    return "red";
  }
  if (result === PRIMARY_SIGNAL_CODES.GREEN || result === PRIMARY_SIGNAL_CODES.GREEN_FLASHING) {
    return "green";
  }
  // dark / amber / amber-flashing / unknown / missing — never a confirmed
  // red, so it never glows. Treated like green (hidden).
  return "other";
}

function toNormalized(ds: RawDatastream): NormalizedSignal | null {
  const coord = firstCoordinate(ds);
  if (!coord || !inBbox(coord[0], coord[1])) return null;

  const { intersectionId, connectionId } = parseConnectionName(ds.name);
  const obs = ds.Observations?.[0];

  return {
    city: "hamburg",
    intersectionId,
    signalId: `${intersectionId}_${connectionId}_${ds["@iot.id"]}`,
    longitude: coord[0],
    latitude: coord[1],
    state: classifyState(obs?.result),
    lastUpdated: obs?.phenomenonTime ?? new Date(0).toISOString(),
  };
}

export const hamburgAdapter: CityAdapter = {
  city: "hamburg",

  async getSnapshot(): Promise<SignalsSnapshot> {
    // Citywide feed is ~4,000 primary-signal datastreams across ~5 pages;
    // fetchCollection follows @iot.nextLink until exhausted or maxPages hit.
    const raw = await fetchCollection<RawDatastream>(buildQueryUrl(), 10);

    const signals = raw
      .map(toNormalized)
      .filter((s): s is NormalizedSignal => s !== null);

    return {
      city: "hamburg",
      generatedAt: new Date().toISOString(),
      source: {
        name: "Traffic Lights Data Hamburg (TLF) — Freie und Hansestadt Hamburg",
        attribution: "Freie und Hansestadt Hamburg, zuständige Behörde",
        license: "Datenlizenz Deutschland – Namensnennung 2.0",
      },
      signals,
    };
  },
};
