// Tiny in-memory memoizer for async loaders: a value is reused for `ttlMs`, and
// concurrent callers share one in-flight call instead of each hitting upstream.
// A failed load is never cached (the next caller retries).
export function memoTtl<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;

  return () => {
    if (cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (inflight) return inflight;

    inflight = load()
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
