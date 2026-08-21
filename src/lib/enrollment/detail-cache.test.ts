import { describe, expect, it, vi } from "vitest";
import type { EnrollmentDetail } from "./types";
import {
  ENROLLMENT_DETAIL_OPEN_FRESH_MS,
  ENROLLMENT_DETAIL_CACHE_TTL_MS,
  clearCachedEnrollmentDetails,
  fetchEnrollmentDetail,
  getCachedEnrollmentDetail,
  getCachedEnrollmentDetailAgeMs,
  invalidateEnrollmentDetail,
  patchCachedEnrollmentReactionRows,
  refreshEnrollmentDetail,
  setCachedEnrollmentDetail,
} from "./detail-cache";

const detail: EnrollmentDetail = {
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

describe("enrollment detail cache", () => {
  it("expires warm detail before signed URLs expire", () => {
    vi.useFakeTimers();
    try {
      setCachedEnrollmentDetail("e1", detail);
      vi.advanceTimersByTime(ENROLLMENT_DETAIL_CACHE_TTL_MS + 1);
      expect(getCachedEnrollmentDetail("e1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports age for stale-while-revalidate", () => {
    vi.useFakeTimers();
    try {
      setCachedEnrollmentDetail("e2", detail);
      vi.advanceTimersByTime(ENROLLMENT_DETAIL_OPEN_FRESH_MS - 1);
      expect(getCachedEnrollmentDetailAgeMs("e2")).toBe(
        ENROLLMENT_DETAIL_OPEN_FRESH_MS - 1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces prefetch/open requests", async () => {
    clearCachedEnrollmentDetails();
    const pending = deferredResponse();
    const fetcher = vi.fn(() => pending.promise);
    const first = fetchEnrollmentDetail("e3", { source: "prefetch", fetcher });
    const second = fetchEnrollmentDetail("e3", {
      source: "open",
      commentLimit: 50,
      fetcher,
    });
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(Response.json(detail));
    await first;
    expect(getCachedEnrollmentDetail("e3")).toEqual(detail);
  });

  it("keeps reaction rows warm across detail revalidation", async () => {
    clearCachedEnrollmentDetails();
    setCachedEnrollmentDetail("e-reactions", {
      ...detail,
      comments: [
        {
          id: "c1",
          attachments: [],
          reactions: [
            { comment_id: "c1", emoji: "👍", reactor_email: "a@x.com" },
          ],
        },
      ],
    });

    const returned = await fetchEnrollmentDetail("e-reactions", {
      fetcher: async () =>
        Response.json({
          ...detail,
          comments: [{ id: "c1", attachments: [] }],
        }),
    });

    expect(returned.comments[0]?.reactions).toEqual([
      { comment_id: "c1", emoji: "👍", reactor_email: "a@x.com" },
    ]);
  });

  it("patches a reaction snapshot without refreshing detail age", () => {
    vi.useFakeTimers();
    try {
      clearCachedEnrollmentDetails();
      setCachedEnrollmentDetail("e-reaction-snapshot", {
        ...detail,
        comments: [{ id: "c1", attachments: [] }],
      });
      vi.advanceTimersByTime(1_234);
      patchCachedEnrollmentReactionRows("e-reaction-snapshot", [
        { comment_id: "c1", emoji: "✅", reactor_email: "a@x.com" },
      ]);

      expect(getCachedEnrollmentDetail("e-reaction-snapshot")?.comments[0]?.reactions).toEqual([
        { comment_id: "c1", emoji: "✅", reactor_email: "a@x.com" },
      ]);
      expect(getCachedEnrollmentDetailAgeMs("e-reaction-snapshot")).toBe(1_234);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an invalidated request repopulate the cache", async () => {
    clearCachedEnrollmentDetails();
    const pending = deferredResponse();
    const request = fetchEnrollmentDetail("e4", {
      fetcher: () => pending.promise,
    });
    invalidateEnrollmentDetail("e4");
    pending.resolve(Response.json(detail));
    await request;
    expect(getCachedEnrollmentDetail("e4")).toBeUndefined();
  });

  it("queues a trailing refresh instead of dropping the latest signal", async () => {
    clearCachedEnrollmentDetails();
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return Response.json(detail);
    });
    const first = refreshEnrollmentDetail("e5", { fetcher });
    const second = refreshEnrollmentDetail("e5", { fetcher });
    await Promise.all([first, second]);
    expect(calls).toBe(2);
  });
});
