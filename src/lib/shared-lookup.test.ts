import { describe, expect, it, vi } from "vitest";
import { createSharedLookup } from "@/lib/shared-lookup";

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

describe("createSharedLookup", () => {
  it("shares one load between concurrent callers", async () => {
    const load = vi.fn(async (key: string) => `${key}-value`);
    const lookup = createSharedLookup(load, { ttlMs: 1000 });

    const [a, b] = await Promise.all([lookup.get("k"), lookup.get("k")]);

    expect(a).toBe("k-value");
    expect(b).toBe("k-value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reuses a result until the TTL passes, then loads again", async () => {
    const time = clock();
    let version = 0;
    const lookup = createSharedLookup(async () => ++version, { ttlMs: 1000, now: time.now });

    expect(await lookup.get("k")).toBe(1);
    time.advance(999);
    expect(await lookup.get("k")).toBe(1);
    time.advance(1);
    expect(await lookup.get("k")).toBe(2);
  });

  it("keeps keys separate", async () => {
    const load = vi.fn(async (key: string) => key);
    const lookup = createSharedLookup(load, { ttlMs: 1000 });

    expect(await lookup.get("a")).toBe("a");
    expect(await lookup.get("b")).toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a rejected load", async () => {
    const load = vi
      .fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("ok");
    const lookup = createSharedLookup(load, { ttlMs: 1000 });

    await expect(lookup.get("k")).rejects.toThrow("down");
    expect(await lookup.get("k")).toBe("ok");
  });

  it("does not reuse a result that keep() rejects", async () => {
    const load = vi
      .fn<(key: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("ok");
    const lookup = createSharedLookup(load, { ttlMs: 1000, keep: (value) => value !== null });

    expect(await lookup.get("k")).toBeNull();
    expect(await lookup.get("k")).toBe("ok");
  });

  it("loads again after invalidate, for one key or all", async () => {
    let version = 0;
    const lookup = createSharedLookup(async () => ++version, { ttlMs: 60_000 });

    expect(await lookup.get("a")).toBe(1);
    lookup.invalidate("a");
    expect(await lookup.get("a")).toBe(2);
    lookup.invalidate();
    expect(await lookup.get("a")).toBe(3);
  });
});
