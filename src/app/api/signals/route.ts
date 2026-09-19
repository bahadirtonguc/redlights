import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/adapters";

// Live states only: [id, "r" | "g", updatedAt] for signals with a trustworthy
// current observation. Locations live in ./geometry and are joined by id.
//
// No `dynamic = "force-dynamic"` on purpose: it would also force every upstream
// fetch to no-store. Route Handlers are uncached by default; the CDN behaviour
// below is set explicitly.

// Every client shares one CDN copy: fresh for 3 s, then served stale for up to
// 10 s while a single background request refreshes it. `max-age=0` keeps
// browsers revalidating, so they always go back to the (cheap) CDN.
const STATES_CACHE_CONTROL = "public, max-age=0, s-maxage=3, stale-while-revalidate=10";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city") ?? "hamburg";
  const adapter = getAdapter(city);

  if (!adapter) {
    return NextResponse.json(
      { error: `Unknown city: ${city}` },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const snapshot = await adapter.getStates();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": STATES_CACHE_CONTROL } });
  } catch (err) {
    // Never fall back to fabricated data. Surface the failure instead.
    console.error("Failed to fetch live signal data:", err);
    return NextResponse.json(
      { error: "Live traffic-signal feed unavailable", detail: String(err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
