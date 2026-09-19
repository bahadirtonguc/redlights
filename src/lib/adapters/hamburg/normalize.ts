// Pure normalisation rules for Hamburg observations — no I/O, so they are
// unit-testable (see normalize.test.ts).

import type { RawObservation } from "./types";
import type { LiveState } from "../../model/types";

// Primary-signal result codes, per the TLF usage guide.
const CODE = {
  DARK: 0,
  RED: 1,
  AMBER: 2,
  GREEN: 3,
  RED_AMBER: 4,
  AMBER_FLASHING: 5,
  GREEN_FLASHING: 6,
  UNKNOWN: 9,
} as const;

// Anything before this is not a real observation time (the feed reports
// "no observation" as the Unix epoch once serialised).
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);

export const DEFAULT_LIVE_MAX_AGE_SECONDS = 3600;

// `lastUpdated` is the time of the LAST STATE CHANGE, so a signal that has sat
// on red for a while legitimately has a large age. The cut-off exists only to
// drop signals that have clearly gone offline, not to judge freshness of a
// healthy one. See README ("Live-only filtering") for how the default was chosen.
export function liveMaxAgeSeconds(raw: string | undefined = process.env.LIVE_MAX_AGE_SECONDS): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : DEFAULT_LIVE_MAX_AGE_SECONDS;
}

// red / red-amber -> "r", green / green-flashing -> "g",
// anything else (dark, amber, amber-flashing, unknown) -> null ("other").
export function classifyResult(result: unknown): LiveState | null {
  if (result === CODE.RED || result === CODE.RED_AMBER) return "r";
  if (result === CODE.GREEN || result === CODE.GREEN_FLASHING) {
    return "g";
  }
  return null;
}

// Epoch milliseconds, or null for empty / unparseable / epoch-0 / pre-2000 values.
export function parseObservationTime(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < MIN_PLAUSIBLE_MS) return null;
  return ms;
}

export type Normalized =
  | { kind: "live"; state: LiveState; updatedAt: number } // updatedAt: epoch seconds
  | { kind: "offline" }
  | { kind: "other" };

export function normalizeObservation(
  obs: Pick<RawObservation, "result" | "phenomenonTime"> | undefined,
  nowMs: number,
  maxAgeMs: number,
): Normalized {
  if (!obs) return { kind: "offline" };

  const t = parseObservationTime(obs.phenomenonTime);
  if (t === null) return { kind: "offline" };

  const state = classifyResult(obs.result);
  if (state === null) return { kind: "other" };

  // A timestamp ahead of the server clock is a feed clock error, not a reason
  // to drop the signal: clamp it to "now" and keep it.
  const clamped = Math.min(t, nowMs);
  if (nowMs - clamped > maxAgeMs) return { kind: "offline" };

  return { kind: "live", state, updatedAt: Math.floor(clamped / 1000) };
}
