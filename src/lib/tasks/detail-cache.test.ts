import { describe, expect, it, vi } from "vitest";
import type { TaskDetail } from "@/lib/tasks/detail";
import {
  DETAIL_OPEN_FRESH_MS,
  DETAIL_CACHE_TTL_MS,
  fetchTaskDetail,
  getCachedTaskDetail,
  getCachedTaskDetailAgeMs,
  invalidateTaskDetail,
  MAX_CACHED_TASK_DETAILS,
  refreshTaskDetail,
  setCachedTaskDetail,
} from "@/lib/tasks/detail-cache";

const detail: TaskDetail = {
  comments: [],
  commentsHasMore: false,
  activity: [],
  attachments: [],
};

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("detail cache", () => {
  it("expires well before a signed URL does", () => {
    expect(DETAIL_CACHE_TTL_MS).toBeLessThan(3600_000);
  });

  it("returns undefined once the entry is older than the TTL", () => {
    vi.useFakeTimers();
    try {
      setCachedTaskDetail("t1", detail);
      expect(getCachedTaskDetail("t1")).toBeDefined();
      vi.advanceTimersByTime(DETAIL_CACHE_TTL_MS + 1);
      expect(getCachedTaskDetail("t1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an entry on explicit invalidation", () => {
    setCachedTaskDetail("t2", detail);
    invalidateTaskDetail("t2");
    expect(getCachedTaskDetail("t2")).toBeUndefined();
  });

  it("reports cache age for stale-while-revalidate decisions", () => {
    vi.useFakeTimers();
    try {
      setCachedTaskDetail("age", detail);
      vi.advanceTimersByTime(DETAIL_OPEN_FRESH_MS - 1);
      expect(getCachedTaskDetailAgeMs("age")).toBe(DETAIL_OPEN_FRESH_MS - 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("detail request coordinator", () => {
  it("shares one in-flight request between hover and open", async () => {
    const pending = deferredResponse();
    const fetcher = vi.fn(() => pending.promise);

    const hover = fetchTaskDetail("dedupe", { source: "prefetch", fetcher });
    const open = fetchTaskDetail("dedupe", { source: "open", fetcher });

    expect(open).toBe(hover);
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(Response.json(detail));
    await expect(open).resolves.toEqual(detail);
  });

  it("does not merge a deep-link variant with the base request", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      async () => Response.json(detail),
    );

    await Promise.all([
      fetchTaskDetail("variant", { source: "open", fetcher }),
      fetchTaskDetail("variant", {
        commentId: "comment-1",
        source: "open",
        fetcher,
      }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("comment_id=");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("comment_id=comment-1");
  });

  it("keeps a later-started deep-link response in cache", async () => {
    const basePending = deferredResponse();
    const deepLinkPending = deferredResponse();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => basePending.promise)
      .mockImplementationOnce(() => deepLinkPending.promise);
    const baseDetail = { ...detail, commentsHasMore: true };
    const deepLinkDetail = { ...detail, commentsHasMore: false };

    const base = fetchTaskDetail("variant-order", { source: "prefetch", fetcher });
    const deepLink = fetchTaskDetail("variant-order", {
      commentId: "comment-1",
      source: "open",
      fetcher,
    });
    deepLinkPending.resolve(Response.json(deepLinkDetail));
    basePending.resolve(Response.json(baseDetail));
    await Promise.all([base, deepLink]);

    expect(getCachedTaskDetail("variant-order")).toEqual(deepLinkDetail);
  });

  it("removes a rejected request so opening can retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(detail));

    await expect(
      fetchTaskDetail("retry", { source: "prefetch", fetcher }),
    ).rejects.toThrow("503");
    await expect(
      fetchTaskDetail("retry", { source: "open", fetcher }),
    ).resolves.toEqual(detail);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not let an invalidated response repopulate the cache", async () => {
    const pending = deferredResponse();
    const fetched = { ...detail, commentsHasMore: true };
    const request = fetchTaskDetail("invalidated", {
      source: "open",
      fetcher: () => pending.promise,
    });

    invalidateTaskDetail("invalidated");
    pending.resolve(Response.json(fetched));

    await expect(request).resolves.toEqual(fetched);
    expect(getCachedTaskDetail("invalidated")).toBeUndefined();
  });

  it("supersedes a stale open request and queues one trailing refresh", async () => {
    const staleOpen = deferredResponse();
    const firstRefresh = deferredResponse();
    const trailingRefresh = deferredResponse();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => staleOpen.promise)
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => trailingRefresh.promise);

    const open = fetchTaskDetail("forced", { source: "open", fetcher });
    const mutation = refreshTaskDetail("forced", {
      source: "mutation",
      fetcher,
    });
    const realtime = refreshTaskDetail("forced", {
      source: "realtime",
      fetcher,
    });

    expect(mutation).not.toBe(open);
    expect(realtime).toBe(mutation);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const staleDetail = { ...detail, commentsHasMore: true };
    const firstDetail = { ...detail, commentsHasMore: false };
    const latestDetail = { ...detail, metadata: {
      last_activity_by_email: null,
      comment_count: 1,
      attachment_count: 0,
    } };
    firstRefresh.resolve(Response.json(firstDetail));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    trailingRefresh.resolve(Response.json(latestDetail));
    staleOpen.resolve(Response.json(staleDetail));
    await Promise.all([open, mutation]);

    expect(getCachedTaskDetail("forced")).toEqual(latestDetail);
  });

  it("starts a new refresh cycle after the previous Promise settles", async () => {
    const fetcher = vi.fn(async () => Response.json(detail));

    const first = refreshTaskDetail("refresh-cycle", { fetcher });
    await first;
    const second = refreshTaskDetail("refresh-cycle", { fetcher });

    expect(second).not.toBe(first);
    await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("cache size bound", () => {
  it("evicts the oldest entry once the bound is reached", () => {
    // TTL alone only reclaims an entry that is read again, so a tab that hovers
    // many tasks and revisits none would grow the map forever.
    for (let i = 0; i <= MAX_CACHED_TASK_DETAILS; i += 1) {
      setCachedTaskDetail(`fifo-${i}`, detail);
    }

    expect(getCachedTaskDetail("fifo-0")).toBeUndefined();
    expect(getCachedTaskDetail(`fifo-${MAX_CACHED_TASK_DETAILS}`)).toBeDefined();
  });

  it("keeps re-writing the same id from evicting anything", () => {
    for (let i = 0; i < 200; i += 1) {
      setCachedTaskDetail("stable", detail);
    }
    expect(getCachedTaskDetail("stable")).toBeDefined();
  });
});
