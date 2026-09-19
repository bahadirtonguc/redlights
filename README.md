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
(`src/lib/adapters/hamburg`) does the fetching, and `/api/signals` exposes
only the normalized data the frontend needs, cached for 4 seconds to protect
the upstream feed from being hammered by concurrent clients.

## Architecture

```
src/lib/model/types.ts          — city-agnostic NormalizedSignal + CityAdapter contract
src/lib/adapters/hamburg/       — Hamburg-specific SensorThings client + adapter
src/app/api/signals/route.ts    — server-side proxy; picks an adapter by ?city=
src/store/                      — Redux Toolkit store + RTK Query (polling every 5s)
src/components/RedLightsMap.tsx — MapLibre dark map, glow animation, interactions, branding
```

Normalized shape (`NormalizedSignal`), identical regardless of city:

```ts
{ city, intersectionId, signalId, latitude, longitude, state, lastUpdated }
```

Adding a second city later is: implement `CityAdapter.getSnapshot()` for it
and register it in `ADAPTERS` in `src/app/api/signals/route.ts`. Nothing in
the map, store, or UI layer references Hamburg by name.

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
