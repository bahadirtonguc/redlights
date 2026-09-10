// Thin client for Hamburg's official "Traffic Lights Data Hamburg" (TLF) feed.
// This is a public OGC SensorThings API (FROST-Server) instance run by the
// Free and Hanseatic City of Hamburg. No API key. Docs:
//   https://daten-hamburg.de/tlf_public/TLD_UsageGuide_V1.2.pdf
// License: Datenlizenz Deutschland – Namensnennung 2.0
// Attribution required: "Freie und Hansestadt Hamburg"

export const HAMBURG_TLF_BASE = "https://tld.iot.hamburg.de/v1.1";

export interface STCollection<T> {
  value: T[];
  "@iot.nextLink"?: string;
}

/**
 * Fetch a SensorThings collection, following @iot.nextLink pagination up to
 * maxPages. Hamburg's mesh has thousands of lane-connection "Things", so
 * every caller must scope with a $filter (layerName + geographic bbox) —
 * never fetch the whole dataset unfiltered.
 */
export async function fetchCollection<T>(
  url: string,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  let page = 0;

  while (next && page < maxPages) {
    const res = await fetch(next, {
      headers: { Accept: "application/json" },
      // Server-side only; this feed has no documented CORS support, which is
      // exactly why this call must happen behind our own API route.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Hamburg TLF request failed: ${res.status} ${res.statusText} (${next})`,
      );
    }
    const body = (await res.json()) as STCollection<T>;
    out.push(...body.value);
    next = body["@iot.nextLink"];
    page += 1;
  }

  return out;
}
