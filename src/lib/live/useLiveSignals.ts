"use client";

import { useEffect, useMemo, useState } from "react";
import type { GeometrySnapshot, LiveState, StatesSnapshot } from "@/lib/model/types";

export const POLL_MS = 4000; // 3–5 s: the CDN copy is fresh for 3 s
const BACKOFF_MAX_MS = 60_000;

// Exponential backoff with a little jitter, capped.
function backoffMs(failures: number): number {
  const base = Math.min(BACKOFF_MAX_MS, POLL_MS * 2 ** failures);
  return base * (0.8 + Math.random() * 0.4);
}

export interface LiveSignals {
  // id -> [lon, lat]; null until the (one-off) geometry request has landed.
  geometry: Map<number, [number, number]> | null;
  // id -> state, for live signals only; null until the first poll has landed.
  states: Map<number, LiveState> | null;
  snapshot: StatesSnapshot | null;
  // Set when the latest request failed; the last good data stays on screen.
  failing: boolean;
}

/**
 * Loads static geometry once, then polls live states.
 *  - never starts a request while another is in flight (the next poll is only
 *    scheduled after the previous one settles);
 *  - stops entirely while the tab is hidden and polls immediately on return;
 *  - backs off exponentially on errors.
 */
export function useLiveSignals(city: string): LiveSignals {
  const [geometrySnapshot, setGeometrySnapshot] = useState<GeometrySnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<StatesSnapshot | null>(null);
  const [failing, setFailing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;

    const q = `?city=${encodeURIComponent(city)}`;

    async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return (await res.json()) as T;
    }

    // Geometry is static: load it once, retry with backoff until it lands.
    let geometryLoaded = false;

    function schedule(delay: number) {
      clearTimeout(timer);
      if (!cancelled && !document.hidden) timer = setTimeout(tick, delay);
    }

    async function tick() {
      if (cancelled || document.hidden) return;
      controller = new AbortController();
      const { signal } = controller;
      try {
        if (!geometryLoaded) {
          const g = await getJson<GeometrySnapshot>(`/api/signals/geometry${q}`, signal);
          if (cancelled) return;
          geometryLoaded = true;
          setGeometrySnapshot(g);
        }
        const s = await getJson<StatesSnapshot>(`/api/signals${q}`, signal);
        if (cancelled) return;
        failures = 0;
        setFailing(false);
        setSnapshot(s);
        schedule(POLL_MS);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        failures += 1;
        setFailing(true);
        schedule(backoffMs(failures));
      }
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimeout(timer);
        controller?.abort(); // drop the in-flight request; we poll again on return
      } else {
        clearTimeout(timer);
        void tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [city]);

  const geometry = useMemo(() => {
    if (!geometrySnapshot) return null;
    return new Map(geometrySnapshot.signals.map(([id, lon, lat]) => [id, [lon, lat] as [number, number]]));
  }, [geometrySnapshot]);

  const states = useMemo(() => {
    if (!snapshot) return null;
    return new Map(snapshot.signals.map(([id, state]) => [id, state]));
  }, [snapshot]);

  return { geometry, states, snapshot, failing };
}
