import { describe, expect, it, vi } from "vitest";
import {
  DETAIL_CACHE_TTL_MS,
  getCachedTaskDetail,
  invalidateTaskDetail,
  setCachedTaskDetail,
} from "@/lib/tasks/detail-cache";

const detail = { comments: [], activity: [], attachments: [] } as never;

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
});
