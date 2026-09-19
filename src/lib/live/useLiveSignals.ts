"use client";

import { useEffect, useMemo, useState } from "react";
import type { GeometrySnapshot, LiveState, StatesSnapshot } from "@/lib/model/types";

export const POLL_MS = 4000; // 3–5 s: the CDN copy is fresh for 3 s
const BACKOFF_MAX_MS = 30_000;

// Exponential backoff with a little jitter, capped.
function backoffMs(failures: number): number {
  const base = Math.min(BACKOFF_MAX_MS, POLL_MS * 2 ** failures);
  return base * (0.8 + Math.random() * 0.4);
}

// How old the data was when it reached us, so the UI can keep counting from
// there without ever comparing the server's clock with the device's.
export interface Receipt {
  ageMs: number;
  at: number; // performance.now() when it arrived
}

// Age of a response's data: how long it sat between being generated and being
// sent (`Date` is the origin's send time, `generatedAt` the origin's snapshot
// time — same clock) plus how long the CDN held it (`Age`). Falls back to the
// device clock only if the headers are missing.
function dataAgeMs(res: Response, generatedAt: string): number {
  const generated = Date.parse(generatedAt);
  const sent = Date.parse(res.headers.get("date") ?? "");
  const cdnAge = Number(res.headers.get("age") ?? 0);
  if (Number.isFinite(generated) && Number.isFinite(sent)) {
    return Math.max(0, sent - generated) + (Number.isFinite(cdnAge) ? cdnAge : 0) * 1000;
  }
  return Number.isFinite(generated) ? Math.max(0, Date.now() - generated) : 0;
}

export interface LiveSignals {
  // id -> [lon, lat]; null until the (one-off) geometry request has landed.
  geometry: Map<number, [number, number]> | null;
  // id -> state, for live signals only; null until the first poll has landed.
  states: Map<number, LiveState> | null;
  snapshot: StatesSnapshot | null;
  receipt: Receipt | null;
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
  const [latest, setLatest] = useState<{ snapshot: StatesSnapshot; receipt: Receipt } | null>(null);
  const [failing, setFailing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;

    const q = `?city=${encodeURIComponent(city)}`;

    async function getJson<T>(url: string, signal: AbortSignal): Promise<{ body: T; res: Response }> {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return { body: (await res.json()) as T, res };
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
          const { body } = await getJson<GeometrySnapshot>(`/api/signals/geometry${q}`, signal);
          if (cancelled) return;
          geometryLoaded = true;
          setGeometrySnapshot(body);
        }
        const { body, res } = await getJson<StatesSnapshot>(`/api/signals${q}`, signal);
        if (cancelled) return;
        failures = 0;
        setFailing(false);
        setLatest({
          snapshot: body,
          receipt: { ageMs: dataAgeMs(res, body.generatedAt), at: performance.now() },
        });
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

  const snapshot = latest?.snapshot ?? null;
  const receipt = latest?.receipt ?? null;

  const states = useMemo(() => {
    if (!snapshot) return null;
    return new Map(snapshot.signals.map(([id, state]) => [id, state]));
  }, [snapshot]);

  return { geometry, states, snapshot, receipt, failing };
}
