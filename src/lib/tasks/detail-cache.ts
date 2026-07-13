import type { TaskDetail } from "./detail";

// Client-side cache of task detail (comments/activity/attachments), shared by
// the drawer and by hover-prefetch so opening a task feels instant: the network
// round-trip happens while the pointer is on the card, before the click.

const cache = new Map<string, TaskDetail>();
const inFlight = new Set<string>();

export function getCachedTaskDetail(id: string): TaskDetail | undefined {
  return cache.get(id);
}

export function setCachedTaskDetail(id: string, detail: TaskDetail): void {
  cache.set(id, detail);
}

// Fire-and-forget warm-up (e.g. on card hover). Deduped against the cache and
// in-flight requests; errors are swallowed — opening the drawer will retry.
export function prefetchTaskDetail(id: string): void {
  if (cache.has(id) || inFlight.has(id)) return;
  inFlight.add(id);
  void (async () => {
    try {
      const res = await fetch(`/api/tasks/${id}/detail`);
      if (res.ok) cache.set(id, (await res.json()) as TaskDetail);
    } catch {
      // ignore — opening the drawer will fetch again
    } finally {
      inFlight.delete(id);
    }
  })();
}
