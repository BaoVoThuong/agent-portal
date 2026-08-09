import type { TaskDetail } from "./detail";

// Client-side cache of task detail (comments/activity/attachments), shared by
// the drawer and by hover-prefetch so opening a task feels instant: the network
// round-trip happens while the pointer is on the card, before the click.

// Signed attachment URLs live for one hour. Keep the response substantially
// shorter-lived so a warm drawer never serves links that are close to expiry.
export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { detail: TaskDetail; storedAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();

export function getCachedTaskDetail(id: string): TaskDetail | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return entry.detail;
}

export function setCachedTaskDetail(id: string, detail: TaskDetail): void {
  cache.set(id, { detail, storedAt: Date.now() });
}

export function invalidateTaskDetail(id: string): void {
  cache.delete(id);
}

// Fire-and-forget warm-up (e.g. on card hover). Deduped against the cache and
// in-flight requests; errors are swallowed — opening the drawer will retry.
export function prefetchTaskDetail(id: string): void {
  if (getCachedTaskDetail(id) || inFlight.has(id)) return;
  inFlight.add(id);
  void (async () => {
    try {
      const res = await fetch(`/api/tasks/${id}/detail`);
      if (res.ok) setCachedTaskDetail(id, (await res.json()) as TaskDetail);
    } catch {
      // ignore — opening the drawer will fetch again
    } finally {
      inFlight.delete(id);
    }
  })();
}
