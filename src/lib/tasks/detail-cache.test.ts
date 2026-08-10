import { describe, expect, it, vi } from "vitest";
import {
  DETAIL_CACHE_TTL_MS,
  getCachedTaskDetail,
  invalidateTaskDetail,
  MAX_CACHED_TASK_DETAILS,
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
