"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapGeoJSONFeature, GeoJSONSource } from "maplibre-gl";
import { useDispatch, useSelector } from "react-redux";
import { useGetSignalsQuery } from "@/store/signalsApi";
import { selectSignal, clearSelection } from "@/store/uiSlice";
import type { RootState } from "@/store/store";
import type { NormalizedSignal } from "@/lib/model/types";

const HAMBURG_CENTER: [number, number] = [9.9937, 53.5511];
const OVERVIEW_ZOOM = 13.2;
const FOCUS_ZOOM = 17.5;
const FADE_MS = 2600;
const POLL_MS = 5000;

// CARTO dark-matter — free, OSM-derived, no key required. We mute it further
// after load so it reads as an artwork, not a basemap.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

type LiveFeature = NormalizedSignal & { fadingOut?: boolean };

function muteBaseStyle(map: MLMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === "symbol") {
      // Remove almost all labels — this is a cinematic map, not a wayfinding one.
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
        map.setPaintProperty(layer.id, layer.type === "background" ? "background-color" : "fill-opacity", layer.type === "background" ? "#020203" : 0.6);
      } catch {
        /* ignore */
      }
    }
  }
}

function toGeoJSON(features: LiveFeature[]) {
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
        fadingOut: !!s.fadingOut,
      },
    })),
  };
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

export function RedLightsMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const liveRef = useRef<Map<string, LiveFeature>>(new Map());
  const fadeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dispatch = useDispatch();
  const selectedSignalId = useSelector((s: RootState) => s.ui.selectedSignalId);
  const mode = useSelector((s: RootState) => s.ui.mode);

  const { data, error } = useGetSignalsQuery(
    { city: "hamburg" },
    { pollingInterval: POLL_MS },
  );

  const [ready, setReady] = useState(false);

  // --- init map ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HAMBURG_CENTER,
      zoom: OVERVIEW_ZOOM,
      pitch: 0,
      attributionControl: { compact: true },
      dragRotate: false,
      touchPitch: false,
    });

    map.on("load", () => {
      muteBaseStyle(map);

      map.addSource("signals", {
        type: "geojson",
        data: toGeoJSON([]),
      });

      // outer glow
      map.addLayer({
        id: "signal-glow",
        type: "circle",
        source: "signals",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 18, 34],
          "circle-color": "#ff2b3d",
          "circle-blur": 1.4,
          "circle-opacity": ["coalesce", ["feature-state", "opacity"], 0],
          "circle-opacity-transition": { duration: FADE_MS, delay: 0 },
        },
      });

      // core point
      map.addLayer({
        id: "signal-core",
        type: "circle",
        source: "signals",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.2, 18, 5.5],
          "circle-color": "#ffdede",
          "circle-opacity": ["coalesce", ["feature-state", "opacity"], 0],
          "circle-opacity-transition": { duration: FADE_MS, delay: 0 },
        },
      });

      map.on("click", "signal-core", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const signalId = f.properties?.signalId as string;
        if (signalId) dispatch(selectSignal(signalId));
      });

      map.on("mouseenter", "signal-core", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "signal-core", () => {
        map.getCanvas().style.cursor = "";
      });

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [dispatch]);

  const syncSource = useCallback((map: MLMap, live: Map<string, LiveFeature>) => {
    const src = map.getSource("signals") as GeoJSONSource | undefined;
    if (!src) return;
    const features = Array.from(live.values());
    const fc = toGeoJSON(features);
    src.setData(fc);

    // drive opacity via feature-state so paint transitions animate smoothly
    for (const f of fc.features) {
      map.setFeatureState(
        { source: "signals", id: f.id },
        { opacity: f.properties.fadingOut ? 0 : 1 },
      );
    }
  }, []);

  // --- merge live data into the map, animating red<->not-red as glow fade ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;

    const incoming = new Map(data.signals.map((s) => [s.signalId, s]));
    const live = liveRef.current;

    // signals newly red, or still red: ensure present + glowing
    for (const [id, sig] of incoming) {
      if (sig.state !== "red") continue;
      const existingTimer = fadeTimers.current.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        fadeTimers.current.delete(id);
      }
      live.set(id, { ...sig, fadingOut: false });
    }

    // signals that were red but are no longer: fade out, then remove after FADE_MS
    for (const [id, sig] of live) {
      const current = incoming.get(id);
      const stillRed = current?.state === "red";
      if (!stillRed && !sig.fadingOut) {
        live.set(id, { ...sig, fadingOut: true, state: current?.state ?? sig.state });
        const t = setTimeout(() => {
          liveRef.current.delete(id);
          fadeTimers.current.delete(id);
          syncSource(map, liveRef.current);
        }, FADE_MS + 200);
        fadeTimers.current.set(id, t);
      }
    }

    syncSource(map, live);
  }, [data, ready, syncSource]);

  // --- focus interaction: move the camera as a side effect ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (mode === "focused" && selectedSignalId) {
      const sig = liveRef.current.get(selectedSignalId) ?? data?.signals.find((s) => s.signalId === selectedSignalId);
      if (sig) {
        map.flyTo({ center: [sig.longitude, sig.latitude], zoom: FOCUS_ZOOM, duration: 2200, essential: true });
      }
    } else if (mode === "overview") {
      map.flyTo({ center: HAMBURG_CENTER, zoom: OVERVIEW_ZOOM, duration: 1800, essential: true });
    }
  }, [mode, selectedSignalId, ready, data]);

  const focusedSignal =
    mode === "focused" && selectedSignalId
      ? data?.signals.find((s) => s.signalId === selectedSignalId)
      : undefined;

  const message =
    mode === "focused" && selectedSignalId
      ? focusedSignal && focusedSignal.state !== "red"
        ? "They're moving again."
        : "Your soulmate might be waiting at this red light right now."
      : null;

  // --- once the focused signal turns green, drift back to the overview ---
  useEffect(() => {
    if (!selectedSignalId || !data) return;
    const sig = data.signals.find((s) => s.signalId === selectedSignalId);
    if (sig && sig.state !== "red") {
      const t = setTimeout(() => dispatch(clearSelection()), 3400);
      return () => clearTimeout(t);
    }
  }, [data, selectedSignalId, dispatch]);

  const takeMeSomewhere = () => {
    const reds = data?.signals.filter((s) => s.state === "red") ?? [];
    if (reds.length === 0) return;
    const pick = reds[Math.floor(Math.random() * reds.length)];
    dispatch(selectSignal(pick.signalId));
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />

      {/* branding */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center pt-8 text-center">
        <h1 className="text-[13px] font-light tracking-[0.55em] text-white/90 sm:text-base">
          RED LIGHTS
        </h1>
        <p className="mt-2 text-[10px] font-light tracking-[0.3em] text-white/40">
          Parallel Lives
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 text-[10px] font-light tracking-[0.25em] text-white/30">
        HAMBURG — LIVE
      </div>

      {error && (
        <div className="pointer-events-none absolute bottom-6 right-6 max-w-xs text-right text-[10px] font-light tracking-wide text-red-300/70">
          Live signal feed unavailable.
        </div>
      )}

      {/* poetic message */}
      {message && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-6">
          <p className="max-w-sm text-center text-sm font-light italic tracking-wide text-white/80 transition-opacity duration-700">
            {message}
          </p>
        </div>
      )}

      {/* interactions */}
      <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-6">
        <button
          onClick={takeMeSomewhere}
          className="rounded-full border border-white/15 px-5 py-2 text-[10px] font-light tracking-[0.25em] text-white/60 transition hover:border-white/40 hover:text-white"
        >
          TAKE ME SOMEWHERE
        </button>
      </div>

      {mode === "focused" && (
        <button
          onClick={() => dispatch(clearSelection())}
          className="absolute right-6 top-8 text-[10px] font-light tracking-[0.25em] text-white/40 transition hover:text-white/80"
        >
          ← BACK
        </button>
      )}

      <AboutButton />
    </div>
  );
}

function AboutButton() {
  const dispatch = useDispatch();
  const open = useSelector((s: RootState) => s.ui.aboutOpen);
  return (
    <>
      <button
        onClick={() => dispatch({ type: "ui/toggleAbout" })}
        className="absolute left-6 top-8 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-[10px] font-light text-white/40 transition hover:border-white/40 hover:text-white/80"
        aria-label="About"
      >
        i
      </button>
      {open && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => dispatch({ type: "ui/toggleAbout" })}
        >
          <p className="max-w-xs px-8 text-center text-[13px] font-light leading-relaxed tracking-wide text-white/80">
            Every light you see is a real traffic signal in Hamburg.
            <br />
            <br />
            When Hamburg stops, it appears here.
            <br />
            When Hamburg moves, it disappears.
          </p>
        </div>
      )}
    </>
  );
}
