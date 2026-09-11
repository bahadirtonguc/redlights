// Turns "which signals are currently green" into a drivable-looking path.
//
// Traffic lights aren't nodes on a routing graph we have access to, so this
// is a geometric heuristic, not a real router: take the green signals
// closest to an anchor point, then walk them in nearest-neighbor order.
// Recomputed on every poll, so as signals flip red/green the route
// reshapes live.

import { haversineMeters, type LonLat } from "@/lib/geo/haversine";
import type { NormalizedSignal } from "@/lib/model/types";

// Keeps the route a coherent path through one part of the city, and keeps
// the O(n^2) nearest-neighbor walk cheap, regardless of how many signals in
// the bbox happen to be green at once.
const MAX_ROUTE_STOPS = 60;

export interface GreenRoute {
  stops: NormalizedSignal[];
  totalMeters: number;
}

export function buildGreenRoute(signals: NormalizedSignal[], anchor: LonLat): GreenRoute {
  const greens = signals.filter((s) => s.state === "green");
  if (greens.length === 0) return { stops: [], totalMeters: 0 };

  const nearestToAnchor = [...greens]
    .sort((a, b) => haversineMeters(anchor, a) - haversineMeters(anchor, b))
    .slice(0, MAX_ROUTE_STOPS);

  const remaining = [...nearestToAnchor];
  const stops: NormalizedSignal[] = [remaining.shift()!];
  let totalMeters = 0;

  while (remaining.length > 0) {
    const last = stops[stops.length - 1];
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    totalMeters += bestDist;
    stops.push(remaining.splice(bestIndex, 1)[0]);
  }

  return { stops, totalMeters };
}
