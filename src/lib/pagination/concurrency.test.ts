import { describe, expect, it } from "vitest";
import { LIST_ENRICH_CONCURRENCY, mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("keeps results in input order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);
    await mapWithConcurrency(items, LIST_ENRICH_CONCURRENCY, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(LIST_ENRICH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // vẫn chạy song song, không thành tuần tự
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 6, async (n) => n)).toEqual([]);
  });
});
