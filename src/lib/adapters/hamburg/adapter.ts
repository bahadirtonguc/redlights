import { fetchCollection, HAMBURG_TLF_BASE } from "./client";
import { PRIMARY_SIGNAL_CODES, parseConnectionName, type RawDatastream } from "./types";
import type { CityAdapter, NormalizedSignal, SignalState, SignalsSnapshot } from "@/lib/model/types";

// Central Hamburg bounding box (Altstadt / St. Pauli / Sternschanze /
// Speicherstadt / Altona-Ost). The feed itself is citywide (~20,000 primary
// signal heads); we filter client-side to keep this an intimate portrait of
// one city core rather than a sprawling infrastructure dashboard.
const BBOX = { west: 9.93, south: 53.53, east: 10.03, north: 53.585 };

function inBbox(lon: number, lat: number): boolean {
  return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
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

// --- geometry lookup (id -> location), cached separately from live state ---
//
// Asking Hamburg's feed for $expand=Observations is expensive per row —
// citywide (~20,000 datastreams) it takes 20s+, which is why the map used to
// take that long to light up (and effectively polled far slower than the 5s
// UI interval, since each poll waited out the previous one). But the fetch
// WITHOUT the expand is cheap regardless of size (well under a second), and
// signal *locations* don't change — only their live state does. So we fetch
// the citywide geometry once (cached for an hour), filter to our bbox, and
// on every live poll ask only for THOSE ids' latest observation — which,
// filtered by id instead of scanned by property, is also fast.
interface BboxDatastream {
  id: number;
  intersectionId: string;
  connectionId: string;
  longitude: number;
  latitude: number;
}

let geometryCache: { at: number; datastreams: BboxDatastream[] } | null = null;
const GEOMETRY_CACHE_MS = 60 * 60 * 1000; // locations are static; refresh hourly as a safety net

function buildGeometryQueryUrl(): string {
  const params = new URLSearchParams({
    $filter: `properties/layerName eq 'primary_signal'`,
    $select: "id,name,observedArea",
    $top: "10000", // server-enforced max page size; fetchCollection follows nextLink for the rest
  });
  return `${HAMBURG_TLF_BASE}/Datastreams?${params.toString()}`;
}

async function getBboxDatastreams(): Promise<BboxDatastream[]> {
  const now = Date.now();
  if (geometryCache && now - geometryCache.at < GEOMETRY_CACHE_MS) {
    return geometryCache.datastreams;
  }

  const raw = await fetchCollection<RawDatastream>(buildGeometryQueryUrl(), 5);
  const datastreams: BboxDatastream[] = [];
  for (const ds of raw) {
    const coord = firstCoordinate(ds);
    if (!coord || !inBbox(coord[0], coord[1])) continue;
    const { intersectionId, connectionId } = parseConnectionName(ds.name);
    datastreams.push({
      id: ds["@iot.id"],
      intersectionId,
      connectionId,
      longitude: coord[0],
      latitude: coord[1],
    });
  }

  geometryCache = { at: now, datastreams };
  return datastreams;
}

// --- live state lookup, filtered by the exact ids we care about ---

// Kept well under Hamburg's ~8KB request-header limit — a batch of 1000 ids
// (a plain "id eq X or ..." filter) trips it; this leaves comfortable margin.
const STATE_BATCH_SIZE = 200;

function buildStateQueryUrl(ids: number[]): string {
  const filter = ids.map((id) => `id eq ${id}`).join(" or ");
  const params = new URLSearchParams({
    $filter: filter,
    $expand: "Observations($top=1;$orderby=phenomenonTime desc)",
    $select: "id,Observations",
    $top: String(ids.length),
  });
  return `${HAMBURG_TLF_BASE}/Datastreams?${params.toString()}`;
}

async function fetchLatestStates(ids: number[]): Promise<Map<number, RawDatastream>> {
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += STATE_BATCH_SIZE) {
    batches.push(ids.slice(i, i + STATE_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) => fetchCollection<RawDatastream>(buildStateQueryUrl(batch), 2)),
  );

  const byId = new Map<number, RawDatastream>();
  for (const ds of results.flat()) {
    byId.set(ds["@iot.id"], ds);
  }
  return byId;
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

function toNormalized(geo: BboxDatastream, ds: RawDatastream | undefined): NormalizedSignal {
  const obs = ds?.Observations?.[0];
  return {
    city: "hamburg",
    intersectionId: geo.intersectionId,
    signalId: `${geo.intersectionId}_${geo.connectionId}_${geo.id}`,
    longitude: geo.longitude,
    latitude: geo.latitude,
    state: classifyState(obs?.result),
    lastUpdated: obs?.phenomenonTime ?? new Date(0).toISOString(),
  };
}

export const hamburgAdapter: CityAdapter = {
  city: "hamburg",

  async getSnapshot(): Promise<SignalsSnapshot> {
    const bboxDatastreams = await getBboxDatastreams();
    const states = await fetchLatestStates(bboxDatastreams.map((d) => d.id));

    const signals = bboxDatastreams.map((geo) => toNormalized(geo, states.get(geo.id)));

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
