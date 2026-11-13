/** Minimal in-memory sliding-window limiter. For multi-instance deployments swap for Redis (same signature). */
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
const buckets: Map<string, number[]> = (g.__rl ??= new Map<string, number[]>());

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, retryAfterSec: 0 };
}
