"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapGeoJSONFeature } from "maplibre-gl";
import { useDispatch, useSelector } from "react-redux";
import { useLiveSignals } from "@/lib/live/useLiveSignals";
import { SignalFader } from "@/lib/map/SignalFader";
import { selectSignal, clearSelection } from "@/store/uiSlice";
import type { RootState } from "@/store/store";
import type { StatesSnapshot } from "@/lib/model/types";

const HAMBURG_CENTER: [number, number] = [9.9937, 53.5511];
const OVERVIEW_ZOOM = 13.2;
const FOCUS_ZOOM = 17.5;
const STALE_WARN_S = 30; // warn once the data is older than this

// CARTO dark-matter — free, OSM-derived, no key required. We mute it further
// after load so it reads as an artwork, not a basemap.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Turbopack doesn't emit maplibre-gl's worker chunk at the relative path it
// resolves via import.meta.url, so the module-worker fetch 404s (silently,
// as Next's HTML fallback) and the map never initializes. Point it at a
// static copy in /public instead — see public/maplibre-gl-worker.mjs.
if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
}

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

export function RedLightsMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const faderRef = useRef<SignalFader | null>(null);

  const dispatch = useDispatch();
  const selectedSignalId = useSelector((s: RootState) => s.ui.selectedSignalId);
  const mode = useSelector((s: RootState) => s.ui.mode);

  const { geometry, states, snapshot, failing } = useLiveSignals("hamburg");

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

    // Belt-and-suspenders: keep the canvas in sync with the container across
    // any future layout changes (viewport resize, mobile chrome show/hide).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      muteBaseStyle(map);

      map.addSource("signals", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
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
        },
      });

      map.on("click", "signal-core", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const signalId = Number(f.properties?.signalId);
        if (Number.isFinite(signalId)) dispatch(selectSignal(signalId));
      });

      map.on("mouseenter", "signal-core", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "signal-core", () => {
        map.getCanvas().style.cursor = "";
      });

      faderRef.current = new SignalFader(map, "signals");
      setReady(true);
    });

    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      faderRef.current?.destroy();
      faderRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [dispatch]);

  // --- merge each live snapshot into the map -------------------------------
  // Only signals that are red *right now* are drawn. Anything else — green, or
  // no longer in the live set — fades out (see SignalFader).
  useEffect(() => {
    const fader = faderRef.current;
    if (!fader || !ready || !states || !geometry) return;

    const reds = new Map<number, [number, number]>();
    for (const [id, state] of states) {
      const pos = geometry.get(id);
      if (state === "r" && pos) reds.set(id, pos);
    }
    fader.update(reds);
  }, [states, geometry, ready]);

  // --- focus interaction: move the camera as a side effect ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (mode === "focused" && selectedSignalId !== null) {
      const pos = geometry?.get(selectedSignalId);
      if (pos) {
        map.flyTo({ center: pos, zoom: FOCUS_ZOOM, duration: 2200, essential: true });
      }
    } else if (mode === "overview") {
      map.flyTo({ center: HAMBURG_CENTER, zoom: OVERVIEW_ZOOM, duration: 1800, essential: true });
    }
  }, [mode, selectedSignalId, ready, geometry]);

  const focusedState =
    mode === "focused" && selectedSignalId !== null ? states?.get(selectedSignalId) : undefined;

  const message =
    mode === "focused" && selectedSignalId !== null
      ? focusedState === "g"
        ? "They're moving again."
        : "Your soulmate might be waiting at this red light right now."
      : null;

  // --- once the focused signal turns green, drift back to the overview ---
  useEffect(() => {
    if (focusedState !== "g") return;
    const t = setTimeout(() => dispatch(clearSelection()), 3400);
    return () => clearTimeout(t);
  }, [focusedState, dispatch]);

  const redCount = states
    ? Array.from(states).filter(([id, st]) => st === "r" && geometry?.has(id)).length
    : 0;

  const takeMeSomewhere = () => {
    if (!states || !geometry) return;
    const reds = Array.from(states)
      .filter(([id, st]) => st === "r" && geometry.has(id))
      .map(([id]) => id);
    if (reds.length === 0) return;
    dispatch(selectSignal(reds[Math.floor(Math.random() * reds.length)]));
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0 }}
      />

      {/* branding */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center pt-8 text-center">
        <h1 className="text-[13px] font-light tracking-[0.55em] text-white/90 sm:text-base">
          RED LIGHTS
        </h1>
        <p className="mt-2 text-[10px] font-light tracking-[0.3em] text-white/40">
          Parallel Lives
        </p>
        <LiveStatus snapshot={snapshot} reds={redCount} />
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 text-[10px] font-light tracking-[0.25em] text-white/30">
        HAMBURG — LIVE
      </div>

      {failing && (
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

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Small, quiet counts + "updated N s ago". Kept in its own component so its
// once-a-second tick doesn't re-render the map component.
function LiveStatus({ snapshot, reds }: { snapshot: StatesSnapshot | null; reds: number }) {
  const now = useNow(1000);
  if (!snapshot) return null;

  const age = Math.max(0, Math.round((now - Date.parse(snapshot.generatedAt)) / 1000));
  const stale = age > STALE_WARN_S;

  return (
    <p
      className={`mt-3 text-[9px] font-light tracking-[0.25em] ${
        stale ? "text-amber-300/80" : "text-white/30"
      }`}
    >
      {reds} RED · {snapshot.live} LIVE ·{" "}
      {stale ? `DATA ${age} S OLD — FEED MAY BE DELAYED` : `UPDATED ${age} S AGO`}
    </p>
  );
}
