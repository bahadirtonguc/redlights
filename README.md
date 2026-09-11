# HAMBURG — GREEN ROUTE

A live map of Hamburg's traffic lights, with a route drawn through the ones
currently showing **green** — recomputed on every poll, so as lights flip
the route reshapes in real time.

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

The feed is citywide (~20,000 primary-signal datastreams); this app filters
to a central Hamburg bounding box (Altstadt / St. Pauli / Sternschanze /
Speicherstadt / Altona-Ost) to keep polling fast and the map legible.

**No state is ever fabricated.** If the upstream feed is unreachable, the
`/api/signals` route returns an HTTP 502 with an error payload — it never
falls back to random or invented light states.

CORS is undocumented on the upstream feed and full-dataset queries can be
slow, so the browser never talks to Hamburg directly: a server-side adapter
(`src/lib/adapters/hamburg`) does the fetching, and `/api/signals` exposes
only the normalized data the frontend needs, cached for 4 seconds to protect
the upstream feed from being hammered by concurrent clients.

## The "green route"

There is no public routing graph over traffic-signal nodes, so the route is
a geometric heuristic, not an official navigation route:

1. Take every signal currently `green` inside the bbox.
2. Keep the up-to-60 nearest to the city center (`buildGreenRoute`, in
   `src/lib/route/buildGreenRoute.ts`), so the line stays one coherent path
   instead of zig-zagging across the whole city.
3. Walk them in nearest-neighbor order, starting from the one closest to
   the center — a classic greedy TSP heuristic using haversine distance
   (`src/lib/geo/haversine.ts`).

This is recomputed from scratch on every poll (every 5s), so the line
visibly redraws itself as signals change from green to red and back.

## Architecture

```
src/lib/model/types.ts            — city-agnostic NormalizedSignal + CityAdapter contract
src/lib/adapters/hamburg/         — Hamburg-specific SensorThings client + adapter
src/lib/geo/haversine.ts          — great-circle distance helper
src/lib/route/buildGreenRoute.ts  — nearest-neighbor route through currently-green signals
src/app/api/signals/route.ts      — server-side proxy; picks an adapter by ?city=
src/store/                        — Redux Toolkit store + RTK Query (polling every 5s)
src/components/TrafficLightsMap.tsx — MapLibre dark map: red context dots, green
                                       signals, the live route line, and click-to-inspect
```

Normalized shape (`NormalizedSignal`), identical regardless of city:

```ts
{ city, intersectionId, signalId, latitude, longitude, state, lastUpdated }
```

Adding a second city later is: implement `CityAdapter.getSnapshot()` for it
and register it in `ADAPTERS` in `src/app/api/signals/route.ts`. Nothing in
the map, store, or UI layer references Hamburg by name.

## State management (RTK)

- `src/store/store.ts` — Redux Toolkit `configureStore`.
- `src/store/signalsApi.ts` — RTK Query `createApi` endpoint (`useGetSignalsQuery`)
  that polls `/api/signals` every 5 seconds; each response drives the map and
  the route recomputation.
- `src/store/uiSlice.ts` — plain RTK slice for UI-only state (the selected
  signal's info popup, the about dialog).

## Running it

```bash
npm install
npm run dev
```

Requires outbound network access to `tld.iot.hamburg.de` and
`basemaps.cartocdn.com` from wherever it's hosted. On a normal host (Vercel,
etc.) this reaches both with no further configuration; sandboxes with
restricted general egress (like the one this was developed in) will show the
map's "Live signal feed unavailable" state and a blank basemap instead.

## Map basemap

Uses CARTO's free `dark-matter` vector style (OSM-derived, no key required),
with labels stripped and roads dimmed further at runtime so the route reads
clearly against the road network.
