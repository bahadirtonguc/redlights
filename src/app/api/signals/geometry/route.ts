import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/adapters";

// Static signal locations: [id, lon, lat]. They never change, so this is cached
// for hours at the CDN and in the browser; the client fetches it once.
const GEOMETRY_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";

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
    const snapshot = await adapter.getGeometry();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": GEOMETRY_CACHE_CONTROL } });
  } catch (err) {
    console.error("Failed to fetch signal geometry:", err);
    return NextResponse.json(
      { error: "Signal geometry unavailable", detail: String(err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
