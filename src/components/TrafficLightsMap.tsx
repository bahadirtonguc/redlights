"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapGeoJSONFeature, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { useDispatch, useSelector } from "react-redux";
import { useGetSignalsQuery } from "@/store/signalsApi";
import { selectSignal, clearSelection, toggleAbout } from "@/store/uiSlice";
import type { RootState } from "@/store/store";
import type { NormalizedSignal } from "@/lib/model/types";
import { buildGreenRoute } from "@/lib/route/buildGreenRoute";

const HAMBURG_CENTER: [number, number] = [9.9937, 53.5511];
const ZOOM = 13.2;
const FADE_MS = 1600;
const POLL_MS = 5000;

// CARTO dark-matter — free, OSM-derived, no key required. Muted further
// after load so the live route reads clearly against the road network.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Turbopack doesn't emit maplibre-gl's worker chunk at the relative path it
// resolves via import.meta.url, so the module-worker fetch 404s (silently,
// as Next's HTML fallback) and the map never initializes. Point it at a
// static copy in /public instead — see public/maplibre-gl-worker.mjs.
if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
}

type LiveGreen = NormalizedSignal & { fadingOut?: boolean; onRoute?: boolean };

function muteBaseStyle(map: MLMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
    if (layer.type === "line") {
      try {
        map.setPaintProperty(layer.id, "line-opacity", 0.35);
      } catch {
        /* not all line layers support this uniformly; ignore */
      }
    }
    if (layer.type === "fill" || layer.type === "background") {
      try {
        map.setPaintProperty(
          layer.id,
          layer.type === "background" ? "background-color" : "fill-opacity",
          layer.type === "background" ? "#020203" : 0.6,
        );
      } catch {
        /* ignore */
      }
    }
  }
}

// MapLibre feature-state ids must be numeric; derive a stable one from the string id.
function hashId(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function toPointGeoJSON(features: (NormalizedSignal & { onRoute?: boolean; fadingOut?: boolean })[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((s) => ({
      type: "Feature" as const,
      id: hashId(s.signalId),
      geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
      properties: {
        signalId: s.signalId,
        intersectionId: s.intersectionId,
        state: s.state,
        lastUpdated: s.lastUpdated,
        onRoute: !!s.onRoute,
        fadingOut: !!s.fadingOut,
      },
    })),
  };
}

function toRouteGeoJSON(stops: NormalizedSignal[]) {
  return {
    type: "FeatureCollection" as const,
    features:
      stops.length < 2
        ? []
        : [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: stops.map((s) => [s.longitude, s.latitude]),
              },
            },
          ],
  };
}

export function TrafficLightsMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const liveGreenRef = useRef<Map<string, LiveGreen>>(new Map());
  const fadeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dispatch = useDispatch();
  const selectedSignalId = useSelector((s: RootState) => s.ui.selectedSignalId);
  const aboutOpen = useSelector((s: RootState) => s.ui.aboutOpen);

  const { data, error } = useGetSignalsQuery(
    { city: "hamburg" },
    { pollingInterval: POLL_MS },
  );

  const [ready, setReady] = useState(false);

  const route = useMemo(
    () => buildGreenRoute(data?.signals ?? [], { longitude: HAMBURG_CENTER[0], latitude: HAMBURG_CENTER[1] }),
    [data],
  );

  const redSignals = useMemo(() => data?.signals.filter((s) => s.state === "red") ?? [], [data]);
  const greenCount = useMemo(() => data?.signals.filter((s) => s.state === "green").length ?? 0, [data]);

  // --- init map ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HAMBURG_CENTER,
      zoom: ZOOM,
      pitch: 0,
      attributionControl: { compact: true },
      dragRotate: false,
      touchPitch: false,
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      muteBaseStyle(map);

      map.addSource("route", { type: "geojson", data: toRouteGeoJSON([]) });
      map.addSource("signals-red", { type: "geojson", data: toPointGeoJSON([]) });
      map.addSource("signals-green", { type: "geojson", data: toPointGeoJSON([]) });

      // the route: soft wide glow underneath a bright core line
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#28ffa0",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 18, 16],
          "line-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#7dffc4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 18, 3.4],
          "line-opacity": 0.9,
        },
      });

      // red lights: dim, static context — what the route is weaving around
      map.addLayer({
        id: "signals-red",
        type: "circle",
        source: "signals-red",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 18, 4.5],
          "circle-color": "#ff3b30",
          "circle-opacity": 0.45,
        },
      });

      // green lights: the route's stops — glow + bright core, fade in/out live
      map.addLayer({
        id: "signal-green-glow",
        type: "circle",
        source: "signals-green",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 10, 18, 24],
          "circle-color": "#22ff9c",
          "circle-blur": 1.3,
          "circle-opacity": ["coalesce", ["feature-state", "opacity"], 0],
          "circle-opacity-transition": { duration: FADE_MS, delay: 0 },
        },
      });
      map.addLayer({
        id: "signal-green-core",
        type: "circle",
        source: "signals-green",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["case", ["get", "onRoute"], 3, 2],
            18,
            ["case", ["get", "onRoute"], 6.5, 4.5],
          ],
          "circle-color": "#e8fff3",
          "circle-stroke-color": "#0aff9e",
          "circle-stroke-width": ["case", ["get", "onRoute"], 1.5, 0],
          "circle-opacity": ["coalesce", ["feature-state", "opacity"], 0],
          "circle-opacity-transition": { duration: FADE_MS, delay: 0 },
        },
      });

      const onClickPoint = (e: MapLayerMouseEvent) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const signalId = f.properties?.signalId as string;
        if (signalId) dispatch(selectSignal(signalId));
      };

      for (const layerId of ["signals-red", "signal-green-core"]) {
        map.on("click", layerId, onClickPoint);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [dispatch]);

  const syncGreenSource = useCallback((map: MLMap, live: Map<string, LiveGreen>) => {
    const src = map.getSource("signals-green") as GeoJSONSource | undefined;
    if (!src) return;
    const features = Array.from(live.values());
    const fc = toPointGeoJSON(features);
    src.setData(fc);
    for (const f of fc.features) {
      map.setFeatureState({ source: "signals-green", id: f.id }, { opacity: f.properties.fadingOut ? 0 : 1 });
    }
  }, []);

  // --- red context dots: just mirror the latest snapshot, no animation needed ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("signals-red") as GeoJSONSource | undefined;
    src?.setData(toPointGeoJSON(redSignals));
  }, [redSignals, ready]);

  // --- route line: redraw on every poll so it reshapes as lights flip ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    src?.setData(toRouteGeoJSON(route.stops));
  }, [route, ready]);

  // --- green markers: fade in newly-green, fade out ones that turned ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;

    const routeIds = new Set(route.stops.map((s) => s.signalId));
    const incoming = new Map(data.signals.filter((s) => s.state === "green").map((s) => [s.signalId, s]));
    const live = liveGreenRef.current;

    for (const [id, sig] of incoming) {
      const existingTimer = fadeTimers.current.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        fadeTimers.current.delete(id);
      }
      live.set(id, { ...sig, fadingOut: false, onRoute: routeIds.has(id) });
    }

    for (const [id, sig] of live) {
      const stillGreen = incoming.has(id);
      if (!stillGreen && !sig.fadingOut) {
        live.set(id, { ...sig, fadingOut: true });
        const t = setTimeout(() => {
          liveGreenRef.current.delete(id);
          fadeTimers.current.delete(id);
          syncGreenSource(map, liveGreenRef.current);
        }, FADE_MS + 200);
        fadeTimers.current.set(id, t);
      }
    }

    syncGreenSource(map, live);
  }, [data, route, ready, syncGreenSource]);

  const selectedSignal = selectedSignalId ? data?.signals.find((s) => s.signalId === selectedSignalId) : undefined;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} />

      {/* branding */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center pt-8 text-center">
        <h1 className="text-[13px] font-light tracking-[0.55em] text-white/90 sm:text-base">
          HAMBURG — GREEN ROUTE
        </h1>
        <p className="mt-2 text-[10px] font-light tracking-[0.3em] text-white/40">
          Live route through the traffic lights currently on green
        </p>
      </div>

      {/* live stats */}
      <div className="pointer-events-none absolute bottom-6 left-6 flex flex-col gap-1 text-[10px] font-light tracking-[0.2em] text-white/50">
        <span>HAMBURG — LIVE</span>
        <span className="text-emerald-300/80">{greenCount} GREEN NOW</span>
        <span>
          ROUTE: {route.stops.length} STOPS · {(route.totalMeters / 1000).toFixed(1)} KM
        </span>
        {data?.generatedAt && (
          <span className="text-white/30">
            UPDATED {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="pointer-events-none absolute bottom-6 right-6 max-w-xs text-right text-[10px] font-light tracking-wide text-red-300/70">
          Live signal feed unavailable.
        </div>
      )}

      {/* selected signal popup */}
      {selectedSignal && (
        <div className="absolute right-6 top-24 max-w-[220px] rounded-lg border border-white/15 bg-black/70 p-4 text-[11px] font-light tracking-wide text-white/80 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <span
              className={
                selectedSignal.state === "green"
                  ? "text-emerald-300"
                  : selectedSignal.state === "red"
                    ? "text-red-300"
                    : "text-white/50"
              }
            >
              {selectedSignal.state.toUpperCase()}
            </span>
            <button
              onClick={() => dispatch(clearSelection())}
              className="text-white/40 transition hover:text-white/80"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 text-white/50">Intersection {selectedSignal.intersectionId}</div>
          <div className="mt-1 text-white/30">
            Updated {new Date(selectedSignal.lastUpdated).toLocaleTimeString()}
          </div>
        </div>
      )}

      <button
        onClick={() => dispatch(toggleAbout())}
        className="absolute left-6 top-8 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-[10px] font-light text-white/40 transition hover:border-white/40 hover:text-white/80"
        aria-label="About"
      >
        i
      </button>
      {aboutOpen && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => dispatch(toggleAbout())}
        >
          <p className="max-w-sm px-8 text-center text-[13px] font-light leading-relaxed tracking-wide text-white/80">
            Every dot is a real Hamburg traffic signal, polled live every {POLL_MS / 1000}s.
            <br />
            <br />
            The green line is not an official route — it&apos;s drawn by
            connecting the traffic lights currently showing green, nearest to
            nearest, closest to the city center. As lights change, it
            redraws.
          </p>
        </div>
      )}
    </div>
  );
}
