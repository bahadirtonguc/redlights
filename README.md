# RED LIGHTS — Parallel Lives

A live portrait of Hamburg, told only through its real red traffic lights.

## The data (verified, not simulated)

Live signal states come from Hamburg's official open-data feed, **Traffic
Lights Data Hamburg (TLF)**, run by the Free and Hanseatic City of Hamburg on
an OGC SensorThings API (FROST-Server) instance:

- Base URL: `https://tld.iot.hamburg.de/v1.1/`
- No API key required
- License: *Datenlizenz Deutschland – Namensnennung 2.0* — attribution:
  "Freie und Hansestadt Hamburg, zuständige Behörde"
- Docs: https://daten-hamburg.de/tlf_public/TLD_UsageGuide_V1.2.pdf

Each physical signal head is a `Datastream` with `properties.layerName =
"primary_signal"`. Its `observedArea` carries the real WGS84 coordinates of
the lane connection, and its most recent `Observation.result` is the current
state:

```
0 = dark, 1 = red, 2 = amber, 3 = green,
4 = red-amber, 5 = amber-flashing, 6 = green-flashing, 9 = unknown
```

This was queried and confirmed live during development — e.g. Datastream 15
("Primary signal heads at 353_12") returned `result: 1` (red) at
`2026-09-10T19:20:15Z`, seconds before the request was made. The feed is
citywide (~4,000 primary-signal datastreams); this app filters to a central
Hamburg bounding box (Altstadt / St. Pauli / Sternschanze / Speicherstadt /
Altona-Ost) so the piece reads as an intimate portrait rather than a
traffic-management console.

Only `red`/`red-amber` states ever render. Everything else (`green`, `amber`,
`dark`, `unknown`) is treated as "not currently red" and stays invisible —
per the brief, there is no dashboard for every signal state, only for the
ones that are stopped.

**No state is ever fabricated.** If the upstream feed is unreachable, the
`/api/signals` route returns an HTTP 502 with an error payload — it never
falls back to random or invented light states.

CORS is undocumented on the upstream feed and full-dataset queries can be
slow, so the browser never talks to Hamburg directly: a server-side adapter
(`src/lib/adapters/hamburg`) does the fetching and exposes two small,
CDN-cacheable endpoints.

## Live-only filtering

The map only ever shows signals that have a trustworthy live observation. In
the central bounding box the feed lists ~4.9k signal heads, but roughly half of
them are not live, so the API drops:

- signals with **no observation**, an empty / unparseable / epoch-0
  (`1970-01-01`) timestamp — the feed has nothing for them;
- signals whose state is **dark, amber, amber-flashing or unknown** (only red
  and green are meaningful here);
- signals whose **last state change is older than `LIVE_MAX_AGE_SECONDS`**
  (default `3600`, i.e. 1 hour) — offline heads that stopped reporting.

`lastUpdated` is the time of the last *state change*, so a light that has sat
on red for a while legitimately has a large age; the cut-off is only meant to
catch heads that are clearly offline. Measured on 2026-09-19 (a Saturday
evening) over the ~2,900 red/green signals that carry a valid timestamp, the
age of the last state change was bimodal: 2,503 changed within the last 15
minutes (median ≈ 30 s — about one signal cycle; 2,490 of them within 5
minutes), **none** were between 15 minutes and 6 hours old, and the remaining
392 had been silent for 6 hours to ~7 days (offline). Any cut-off between ~15
minutes and 6 hours therefore gives the identical result; 1 hour leaves a wide
margin above healthy behaviour (e.g. a side-street signal held on red at night)
while staying far below the offline cluster. Override it with the `LIVE_MAX_AGE_SECONDS` environment
variable (minimum 30).

Two feed quirks handled on the server:

- **Future timestamps.** Some heads carry an observation whose
  `phenomenonTime` is hours *ahead* of now (a feed-side timezone bug), and it is
  a stale record from the previous day. Sorting by `phenomenonTime` pins that
  record as "latest" and hides the head's real state, so observations are
  ordered by `resultTime` instead, and any remaining future `lastUpdated` is
  clamped to "now" (the signal is kept, not dropped).
- **Slow expands.** The per-signal "latest observation" query is filtered to
  `resultTime > now − LIVE_MAX_AGE_SECONDS` upstream, so Hamburg never scans a
  head's full history and offline heads come back empty (~1 s for all ~4.9k
  heads, down from ~3.5 s).

## API

Signal geometry is static and live state is not, so they are separate
endpoints; both use compact tuple arrays and are joined by `id` on the client.

- `GET /api/signals/geometry?city=hamburg` — `signals: [id, lon, lat][]`.
  Fetched once per page load. Cached in process memory and in Next's Data Cache
  for 6 h; CDN `s-maxage=21600`.
- `GET /api/signals?city=hamburg` — `signals: [id, "r" | "g", updatedAt][]`
  (`updatedAt` = epoch seconds), plus `generatedAt`, `total`, `live`,
  `excluded: { offline, notRedGreen }`. Cached at the CDN for 3 s
  (`s-maxage=3, stale-while-revalidate=10`) so every client shares one upstream
  round; concurrent requests inside one instance also share a single in-flight
  call.

The client polls every 4 s, never overlaps requests, pauses while the tab is
hidden, and backs off exponentially on errors. Lights ease in and out (≈1 s)
instead of popping, and the page shows how old the data is, warning past 30 s.

## Architecture

```
src/lib/model/types.ts            — wire-format types + CityAdapter contract
src/lib/adapters/hamburg/         — SensorThings client, adapter, pure normalisation rules (+ tests)
src/lib/adapters/index.ts         — city registry
src/lib/cache/memo.ts             — TTL memoiser with in-flight de-duplication
src/app/api/signals/route.ts      — live states (short CDN cache)
src/app/api/signals/geometry/     — static locations (long CDN cache)
src/lib/live/useLiveSignals.ts    — geometry-once + polling hook (visibility, backoff)
src/lib/map/SignalFader.ts        — animates lights in/out via MapLibre feature-state
src/components/RedLightsMap.tsx   — MapLibre dark map, interactions, branding
```

Adding a second city later is: implement `CityAdapter` (`getGeometry()` +
`getStates()`) for it and register it in `src/lib/adapters/index.ts`. Nothing
in the map, store, or UI layer references Hamburg by name.

## Tests

```bash
npm test   # node's built-in runner; covers the live/offline/other rules
```

## Running it

```bash
npm install
npm run dev
```

Requires outbound network access to `tld.iot.hamburg.de` from wherever it's
hosted (this was built and verified against the live feed via a sandboxed
tool with restricted general egress, which is why the end-to-end request
couldn't be exercised from inside that build sandbox itself — the query
shape was validated directly against the live API and mirrors it exactly).
On a normal host (Vercel, etc.) this reaches Hamburg's feed with no further
configuration.

## Map basemap

Uses CARTO's free `dark-matter` vector style (OSM-derived, no key required),
with labels stripped and roads dimmed further at runtime so it reads as a
cinematic artwork rather than a standard map product.
