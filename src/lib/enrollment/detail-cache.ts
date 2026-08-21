import type { EnrollmentDetail } from "./types";
import { COMMENT_PAGE_SIZE } from "@/lib/collaboration/comment-pagination";
import { indexReactionRows, type ReactionRow } from "@/lib/tasks/reactions";

// Signed URLs are valid for one hour. Keep detail responses shorter-lived so
// a warm drawer does not serve links that are close to expiry.
export const ENROLLMENT_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
export const ENROLLMENT_DETAIL_OPEN_FRESH_MS = 5 * 1000;
export const MAX_CACHED_ENROLLMENT_DETAILS = 50;

type CacheEntry = { detail: EnrollmentDetail; storedAt: number };
type RefreshState = { queued: boolean; promise: Promise<EnrollmentDetail> };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<EnrollmentDetail>>();
const refreshes = new Map<string, RefreshState>();
const generations = new Map<string, number>();
const requestVersions = new Map<string, number>();
let globalGeneration = 0;

export type EnrollmentDetailRequestSource =
  | "prefetch"
  | "open"
  | "revalidate"
  | "mutation"
  | "realtime";

export type EnrollmentDetailFetchOptions = {
  commentId?: string | null;
  commentLimit?: number;
  source?: EnrollmentDetailRequestSource;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function generationOf(id: string): number {
  return globalGeneration + (generations.get(id) ?? 0);
}

function requestVariant(commentId?: string | null, commentLimit?: number): string {
  const normalizedLimit =
    commentLimit === undefined || commentLimit === COMMENT_PAGE_SIZE
      ? undefined
      : commentLimit;
  return `${commentId ? `comment:${commentId}` : "base"}|limit:${normalizedLimit ?? "default"}`;
}

function requestKey(
  id: string,
  commentId: string | null | undefined,
  commentLimit: number | undefined,
  generation: number,
): string {
  return `${id}|${requestVariant(commentId, commentLimit)}|${generation}`;
}

function detailUrl(
  id: string,
  commentId: string | null | undefined,
  commentLimit: number | undefined,
  source: EnrollmentDetailRequestSource,
): string {
  const params = new URLSearchParams({ request_source: source });
  if (commentId) params.set("comment_id", commentId);
  if (commentLimit) params.set("comments_limit", String(commentLimit));
  return `/api/enrollment/${id}/detail?${params.toString()}`;
}

function nextRequestVersion(id: string): number {
  const next = (requestVersions.get(id) ?? 0) + 1;
  requestVersions.set(id, next);
  return next;
}

function preserveCachedReactionRows(
  previous: EnrollmentDetail | undefined,
  detail: EnrollmentDetail,
): EnrollmentDetail {
  if (!previous) return detail;
  const previousByComment = new Map(
    previous.comments
      .filter((comment) => Array.isArray(comment.reactions))
      .map((comment) => [comment.id, comment.reactions as ReactionRow[]]),
  );
  if (previousByComment.size === 0) return detail;
  let changed = false;
  const comments = detail.comments.map((comment) => {
    if (Array.isArray(comment.reactions)) return comment;
    const reactions = previousByComment.get(comment.id);
    if (reactions === undefined) return comment;
    changed = true;
    return { ...comment, reactions };
  });
  return changed ? { ...detail, comments } : detail;
}

export function getCachedEnrollmentDetail(id: string): EnrollmentDetail | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > ENROLLMENT_DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return entry.detail;
}

export function getCachedEnrollmentDetailAgeMs(id: string): number | null {
  const entry = cache.get(id);
  if (!entry) return null;
  const age = Date.now() - entry.storedAt;
  if (age > ENROLLMENT_DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return Math.max(0, age);
}

export function setCachedEnrollmentDetail(
  id: string,
  detail: EnrollmentDetail,
): EnrollmentDetail {
  const existing = cache.get(id);
  const previous =
    existing && Date.now() - existing.storedAt <= ENROLLMENT_DETAIL_CACHE_TTL_MS
      ? existing.detail
      : undefined;
  const merged = preserveCachedReactionRows(previous, detail);
  if (cache.size >= MAX_CACHED_ENROLLMENT_DETAILS && !cache.has(id)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, { detail: merged, storedAt: Date.now() });
  return merged;
}

/** Merge a canonical reaction snapshot without making detail look fresher. */
export function patchCachedEnrollmentReactionRows(
  id: string,
  rows: readonly ReactionRow[],
): void {
  const entry = cache.get(id);
  if (!entry) return;
  const indexed = indexReactionRows(rows);
  cache.set(id, {
    storedAt: entry.storedAt,
    detail: {
      ...entry.detail,
      comments: entry.detail.comments.map((comment) => ({
        ...comment,
        reactions: indexed.get(comment.id) ?? [],
      })),
    },
  });
}

/** Patch one comment after a reaction mutation. */
export function patchCachedEnrollmentCommentReactionRows(
  id: string,
  commentId: string,
  rows: readonly ReactionRow[],
): void {
  const entry = cache.get(id);
  if (!entry) return;
  cache.set(id, {
    storedAt: entry.storedAt,
    detail: {
      ...entry.detail,
      comments: entry.detail.comments.map((comment) =>
        comment.id === commentId
          ? { ...comment, reactions: [...rows] }
          : comment,
      ),
    },
  });
}

export function invalidateEnrollmentDetail(id: string): void {
  cache.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

export function clearCachedEnrollmentDetails(): void {
  cache.clear();
  globalGeneration += 1;
}

export function fetchEnrollmentDetail(
  id: string,
  options: EnrollmentDetailFetchOptions = {},
): Promise<EnrollmentDetail> {
  const generation = generationOf(id);
  const key = requestKey(id, options.commentId, options.commentLimit, generation);
  const current = inFlight.get(key);
  if (current) return current;

  const source = options.source ?? "open";
  const fetcher = options.fetcher ?? fetch;
  const requestVersion = nextRequestVersion(id);
  const request = (async () => {
    const response = await fetcher(
      detailUrl(id, options.commentId, options.commentLimit, source),
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Could not load enrollment detail (${response.status}).`);
    }
    let detail = (await response.json()) as EnrollmentDetail;
    if (
      generationOf(id) === generation &&
      requestVersions.get(id) === requestVersion
    ) {
      detail = setCachedEnrollmentDetail(id, detail);
    }
    return detail;
  })();

  inFlight.set(key, request);
  const clear = () => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

export function refreshEnrollmentDetail(
  id: string,
  options: Omit<EnrollmentDetailFetchOptions, "source"> & {
    source?: "mutation" | "realtime";
  } = {},
): Promise<EnrollmentDetail> {
  const key = `${id}|${requestVariant(options.commentId, options.commentLimit)}`;
  const current = refreshes.get(key);
  if (current) {
    current.queued = true;
    return current.promise;
  }

  const state = {
    queued: false,
    promise: undefined as unknown as Promise<EnrollmentDetail>,
  };
  const request = (async () => {
    try {
      let latest: EnrollmentDetail | undefined;
      let latestError: unknown;
      do {
        state.queued = false;
        invalidateEnrollmentDetail(id);
        try {
          latest = await fetchEnrollmentDetail(id, {
            ...options,
            source: options.source ?? "mutation",
          });
          latestError = undefined;
        } catch (error) {
          latestError = error;
        }
      } while (state.queued);

      if (latestError !== undefined) throw latestError;
      if (!latest) throw new Error("Enrollment detail refresh returned no result.");
      return latest;
    } finally {
      if (refreshes.get(key) === state) refreshes.delete(key);
    }
  })();
  state.promise = request;
  refreshes.set(key, state);
  return request;
}

export function prefetchEnrollmentDetail(id: string): void {
  if (getCachedEnrollmentDetail(id)) return;
  void fetchEnrollmentDetail(id, { source: "prefetch" }).catch(() => {});
}
