import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";

const FADE_IN_MS = 900; // a light turning red glows up…
const FADE_OUT_MS = 1400; // …and eases out when it turns green or drops off

type Position = [lon: number, lat: number];

// Draws the set of "currently red" signals into a GeoJSON source and eases each
// one's opacity in/out instead of letting it pop. Opacity is driven per feature
// through feature-state from a single requestAnimationFrame loop that only
// touches features that are actually mid-fade, so a steady state costs nothing
// per frame. The layers read it as ["feature-state", "opacity"].
export class SignalFader {
  private features = new Map<number, Position>(); // in the source: red, or still fading out
  private anim = new Map<number, { cur: number; target: number }>();
  private raf: number | null = null;
  private lastTs = 0;

  constructor(
    private readonly map: MLMap,
    private readonly sourceId: string,
  ) {}

  // `reds` is the complete set of signals that are red right now.
  update(reds: Map<number, Position>) {
    let added = false;
    for (const [id, pos] of reds) {
      const a = this.anim.get(id);
      if (a) {
        a.target = 1; // still there, or turned red again mid-fade-out
      } else {
        this.features.set(id, pos);
        this.anim.set(id, { cur: 0, target: 1 });
        added = true;
      }
    }
    for (const [id, a] of this.anim) {
      if (!reds.has(id)) a.target = 0;
    }

    if (added) this.pushData();
    this.start();
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private pushData() {
    const src = this.map.getSource(this.sourceId) as GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: Array.from(this.features, ([id, [lon, lat]]) => ({
        type: "Feature" as const,
        id, // numeric datastream id: stable, and what feature-state keys on
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
        properties: { signalId: id },
      })),
    });
  }

  private start() {
    if (this.raf === null) this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  private frame(ts: number) {
    // Clamp so a long pause (hidden tab) resumes smoothly instead of snapping.
    const dt = this.lastTs ? Math.min(ts - this.lastTs, 100) : 16;
    this.lastTs = ts;

    let active = false;
    let removed = false;
    for (const [id, a] of this.anim) {
      if (a.cur === a.target) continue;
      const step = dt / (a.target > a.cur ? FADE_IN_MS : FADE_OUT_MS);
      a.cur = a.target > a.cur ? Math.min(a.target, a.cur + step) : Math.max(a.target, a.cur - step);
      this.map.setFeatureState({ source: this.sourceId, id }, { opacity: a.cur });

      if (a.cur !== a.target) {
        active = true;
      } else if (a.target === 0) {
        // fully faded out: drop it from the source
        this.features.delete(id);
        this.anim.delete(id);
        this.map.removeFeatureState({ source: this.sourceId, id });
        removed = true;
      }
    }
    if (removed) this.pushData();

    if (active) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else {
      this.raf = null;
      this.lastTs = 0;
    }
  }
}
