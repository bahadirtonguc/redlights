import { fetchCollection, HAMBURG_TLF_BASE } from "./client";
import { liveMaxAgeSeconds, normalizeObservation } from "./normalize";
import type { RawDatastream } from "./types";
import { memoTtl } from "@/lib/cache/memo";
import type {
  CityAdapter,
  GeometrySnapshot,
  GeometryTuple,
  SourceInfo,
  StateTuple,
  StatesSnapshot,
} from "@/lib/model/types";

// Central Hamburg bounding box (Altstadt / St. Pauli / Sternschanze /
// Speicherstadt / Altona-Ost). The feed itself is citywide (~20,000 primary
// signal heads); we restrict to this box to keep the piece an intimate portrait
// of one city core rather than a sprawling infrastructure dashboard.
const BBOX = { west: 9.93, south: 53.53, east: 10.03, north: 53.585 };

const BBOX_WKT =
  `POLYGON((${BBOX.west} ${BBOX.south},${BBOX.east} ${BBOX.south},` +
  `${BBOX.east} ${BBOX.north},${BBOX.west} ${BBOX.north},${BBOX.west} ${BBOX.south}))`;

const SOURCE: SourceInfo = {
  name: "Traffic Lights Data Hamburg (TLF) — Freie und Hansestadt Hamburg",
  attribution: "Freie und Hansestadt Hamburg, zuständige Behörde",
  license: "Datenlizenz Deutschland – Namensnennung 2.0",
};

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

// --- geometry (id -> location): static, cached for hours -------------------
//
// Signal locations don't change, so this is fetched once and reused: in
// process memory, and in Next's Data Cache so a freshly booted serverless
// instance doesn't have to ask Hamburg again. The bbox is applied upstream
// (st_within), so we pull ~5k rows instead of the citywide ~20k.
const GEOMETRY_TTL_S = 6 * 60 * 60;

function buildGeometryQueryUrl(): string {
  const params = new URLSearchParams({
    $filter: `properties/layerName eq 'primary_signal' and st_within(observedArea,geography'${BBOX_WKT}')`,
    $select: "id,observedArea",
    $top: "10000", // server-enforced max page size; fetchCollection follows nextLink past it
  });
  return `${HAMBURG_TLF_BASE}/Datastreams?${params.toString()}`;
}

async function loadGeometry(): Promise<GeometrySnapshot> {
  const raw = await fetchCollection<RawDatastream>(buildGeometryQueryUrl(), {
    maxPages: 5,
    revalidateSeconds: GEOMETRY_TTL_S,
  });

  const signals: GeometryTuple[] = [];
  for (const ds of raw) {
    const coord = firstCoordinate(ds);
    if (!coord || !inBbox(coord[0], coord[1])) continue;
    // 6 decimals ≈ 0.1 m — plenty, and keeps the payload small.
    signals.push([ds["@iot.id"], round6(coord[0]), round6(coord[1])]);
  }

  return { city: "hamburg", generatedAt: new Date().toISOString(), source: SOURCE, signals };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const getGeometryCached = memoTtl(GEOMETRY_TTL_S * 1000, loadGeometry);

// --- live state, filtered upstream ------------------------------------------
//
// One query per batch of ids, expanding only each datastream's newest
// observation. Two things make this fast (≈1 s for ~5k signals, vs ≈3.5 s
// before):
//   * The expanded observations are filtered to `resultTime gt <cut-off>`, so
//     the feed never scans a signal's full history and offline signals come back
//     empty instead of costing a sort.
//   * Ordering is by resultTime, not phenomenonTime. The feed contains
//     observations whose phenomenonTime is hours in the FUTURE (a timezone bug
//     on its side); sorting by phenomenonTime pins that stale record as "latest"
//     and hides the signal's real current state.
// `id in (...)` keeps the URL short; ~500 ids stays well under Hamburg's
// ~8 KB request limit (1000 is rejected with 400).
const STATE_BATCH_SIZE = 500;
const STATES_TTL_MS = 2000; // bursts of requests within this window share one upstream round

function buildStateQueryUrl(ids: number[], sinceIso: string): string {
  const params = new URLSearchParams({
    $filter: `id in (${ids.join(",")})`,
    $expand:
      `Observations($select=result,phenomenonTime;$top=1;` +
      `$orderby=resultTime desc;$filter=resultTime gt ${sinceIso})`,
    $select: "id",
    $top: String(ids.length),
  });
  return `${HAMBURG_TLF_BASE}/Datastreams?${params.toString()}`;
}

async function loadStates(): Promise<StatesSnapshot> {
  const geometry = await getGeometryCached();
  const ids = geometry.signals.map((g) => g[0]);

  const maxAgeSeconds = liveMaxAgeSeconds();
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - maxAgeSeconds * 1000).toISOString();

  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += STATE_BATCH_SIZE) {
    batches.push(ids.slice(i, i + STATE_BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      fetchCollection<RawDatastream>(buildStateQueryUrl(batch, sinceIso), { maxPages: 2 }),
    ),
  );

  const signals: StateTuple[] = [];
  const excluded = { offline: 0, notRedGreen: 0 };
  const seen = new Set<number>();

  for (const ds of results.flat()) {
    const id = ds["@iot.id"];
    seen.add(id);
    const n = normalizeObservation(ds.Observations?.[0], nowMs, maxAgeSeconds * 1000);
    if (n.kind === "live") signals.push([id, n.state, n.updatedAt]);
    else if (n.kind === "other") excluded.notRedGreen += 1;
    else excluded.offline += 1;
  }
  // Ids the feed didn't return at all count as offline too.
  excluded.offline += ids.length - seen.size;

  return {
    city: "hamburg",
    generatedAt: new Date(nowMs).toISOString(),
    maxAgeSeconds,
    total: ids.length,
    live: signals.length,
    excluded,
    signals,
  };
}

const getStatesCached = memoTtl(STATES_TTL_MS, loadStates);

export const hamburgAdapter: CityAdapter = {
  city: "hamburg",
  getGeometry: getGeometryCached,
  getStates: getStatesCached,
};
