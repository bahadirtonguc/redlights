import { NextResponse } from "next/server";
import { hamburgAdapter } from "@/lib/adapters/hamburg/adapter";
import type { SignalsSnapshot } from "@/lib/model/types";

export const dynamic = "force-dynamic";

// Registry of city adapters. Adding a new city is: implement CityAdapter,
// add it here. Nothing in the map/UI layer knows about Hamburg specifically.
const ADAPTERS = {
  hamburg: hamburgAdapter,
} as const;

let cache: { at: number; snapshot: SignalsSnapshot } | null = null;
const CACHE_MS = 4000; // shared across all clients hitting this route

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = (searchParams.get("city") ?? "hamburg") as keyof typeof ADAPTERS;
  const adapter = ADAPTERS[city];

  if (!adapter) {
    return NextResponse.json({ error: `Unknown city: ${city}` }, { status: 404 });
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.snapshot);
  }

  try {
    const snapshot = await adapter.getSnapshot();
    cache = { at: now, snapshot };
    return NextResponse.json(snapshot);
  } catch (err) {
    // Never fall back to fabricated data. Surface the failure instead.
    console.error("Failed to fetch live signal data:", err);
    return NextResponse.json(
      { error: "Live traffic-signal feed unavailable", detail: String(err) },
      { status: 502 },
    );
  }
}
