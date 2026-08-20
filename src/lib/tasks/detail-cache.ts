import type { TaskDetail } from "./detail";

// Client-side cache of task detail (comments/activity/attachments), shared by
// the drawer and by hover-prefetch so opening a task feels instant: the network
// round-trip happens while the pointer is on the card, before the click.

// Signed attachment URLs live for one hour. Keep the response substantially
// shorter-lived so a warm drawer never serves links that are close to expiry.
export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
// A just-finished hover prefetch is already current. Give it a very short
// freshness window so opening the drawer can reuse it without immediately
// issuing the same request again. Once the window elapses the drawer keeps the
// cached UI visible and revalidates in the background.
export const DETAIL_OPEN_FRESH_MS = 5 * 1000;

type CacheEntry = { detail: TaskDetail; storedAt: number };
type InFlightEntry = { promise: Promise<TaskDetail> };
type RefreshState = { queued: boolean; promise: Promise<TaskDetail> };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightEntry>();
const refreshes = new Map<string, RefreshState>();
const generations = new Map<string, number>();
const requestVersions = new Map<string, number>();
let globalGeneration = 0;

export type TaskDetailRequestSource =
  | "prefetch"
  | "open"
  | "revalidate"
  | "mutation"
  | "realtime";

export type TaskDetailFetchOptions = {
  commentId?: string | null;
  commentLimit?: number;
  source?: TaskDetailRequestSource;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function generationOf(id: string): number {
  return globalGeneration + (generations.get(id) ?? 0);
}

function requestVariant(
  commentId?: string | null,
  commentLimit?: number,
): string {
  const comment = commentId ? `comment:${commentId}` : "base";
  return `${comment}|limit:${commentLimit ?? "default"}`;
}

function requestKey(
  id: string,
  commentId: string | null | undefined,
  commentLimit: number | undefined,
  generation: number,
): string {
  return `${id}|${requestVariant(commentId, commentLimit)}|${generation}`;
}

function nextRequestVersion(id: string): number {
  const version = (requestVersions.get(id) ?? 0) + 1;
  requestVersions.set(id, version);
  return version;
}

function detailUrl(
  id: string,
  commentId: string | null | undefined,
  commentLimit: number | undefined,
  source: TaskDetailRequestSource,
): string {
  const params = new URLSearchParams({ request_source: source });
  if (commentId) params.set("comment_id", commentId);
  if (commentLimit) params.set("comments_limit", String(commentLimit));
  return `/api/tasks/${id}/detail?${params.toString()}`;
}

export function getCachedTaskDetail(id: string): TaskDetail | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return entry.detail;
}

export function getCachedTaskDetailAgeMs(id: string): number | null {
  const entry = cache.get(id);
  if (!entry) return null;
  const age = Date.now() - entry.storedAt;
  if (age > DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return Math.max(0, age);
}

// TTL alone only reclaims an entry that happens to be read again. A long-lived
// tab that hovers many distinct tasks and revisits none retains every expired
// payload forever, so bound the map as well. Map preserves insertion order,
// which makes deleting the first key plain FIFO eviction -- sufficient here and
// simpler than tracking access order.
export const MAX_CACHED_TASK_DETAILS = 50;

export function setCachedTaskDetail(id: string, detail: TaskDetail): void {
  if (cache.size >= MAX_CACHED_TASK_DETAILS && !cache.has(id)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, { detail, storedAt: Date.now() });
}

export function invalidateTaskDetail(id: string): void {
  cache.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

export function clearCachedTaskDetails(): void {
  cache.clear();
  globalGeneration += 1;
}

/**
 * Fetch task detail through the shared request coordinator.
 *
 * Matching hover/open requests share the exact Promise. Deep-link requests are
 * separate because `comment_id` changes the payload, and a generation guard
 * prevents an invalidated older response from repopulating the cache.
 */
export function fetchTaskDetail(
  id: string,
  options: TaskDetailFetchOptions = {},
): Promise<TaskDetail> {
  const generation = generationOf(id);
  const key = requestKey(
    id,
    options.commentId,
    options.commentLimit,
    generation,
  );
  const matching = inFlight.get(key);
  if (matching) return matching.promise;

  const fetcher = options.fetcher ?? fetch;
  const source = options.source ?? "open";
  const requestVersion = nextRequestVersion(id);
  const request = (async () => {
    const response = await fetcher(
      detailUrl(id, options.commentId, options.commentLimit, source),
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Could not load task detail (${response.status}).`);
    }
    const detail = (await response.json()) as TaskDetail;
    if (
      generationOf(id) === generation &&
      requestVersions.get(id) === requestVersion
    ) {
      setCachedTaskDetail(id, detail);
    }
    return detail;
  })();
  const clear = () => {
    if (inFlight.get(key)?.promise === request) inFlight.delete(key);
  };
  inFlight.set(key, { promise: request });
  void request.then(clear, clear);
  return request;
}

/**
 * Coalesce bursts of mutation/realtime refreshes without dropping the latest
 * event. Calls arriving during an active request queue exactly one trailing
 * request; calls arriving during that trailing request queue one more.
 */
export function refreshTaskDetail(
  id: string,
  options: Omit<TaskDetailFetchOptions, "source"> & {
    source?: "mutation" | "realtime";
  } = {},
): Promise<TaskDetail> {
  const key = `${id}|${requestVariant(
    options.commentId,
    options.commentLimit,
  )}`;
  const current = refreshes.get(key);
  if (current) {
    current.queued = true;
    return current.promise;
  }

  const state: RefreshState = {
    queued: false,
    promise: undefined as unknown as Promise<TaskDetail>,
  };
  const request = (async () => {
    try {
      let latest: TaskDetail | undefined;
      let latestError: unknown;
      do {
        state.queued = false;
        invalidateTaskDetail(id);
        try {
          latest = await fetchTaskDetail(id, {
            ...options,
            source: options.source ?? "mutation",
          });
          latestError = undefined;
        } catch (error) {
          latestError = error;
        }
      } while (state.queued);

      if (latestError !== undefined) throw latestError;
      if (!latest) throw new Error("Task detail refresh returned no result.");
      return latest;
    } finally {
      // Delete before the outer Promise settles. A new event can never observe
      // a completed state and incorrectly queue work that no loop will consume.
      if (refreshes.get(key) === state) refreshes.delete(key);
    }
  })();
  state.promise = request;
  refreshes.set(key, state);
  return request;
}

// Fire-and-forget warm-up (e.g. on card hover). Errors are swallowed — opening
// the drawer uses the same coordinator and retries after a rejected Promise.
export function prefetchTaskDetail(id: string): void {
  if (getCachedTaskDetail(id)) return;
  void fetchTaskDetail(id, { source: "prefetch" }).catch(() => {});
}
