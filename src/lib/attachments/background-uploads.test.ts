import { describe, expect, it, vi } from "vitest";
import { uploadWithConcurrency } from "./background-uploads";

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("uploadWithConcurrency", () => {
  it("never runs more uploads than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const failed = await uploadWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7],
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return true;
      },
      { concurrency: 3 },
    );
    expect(failed).toEqual([]);
    expect(peak).toBe(3);
  });

  it("returns failures in input order, not completion order", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const run = uploadWithConcurrency(["a", "b", "c"], (item) => gates["abc".indexOf(item)].promise, {
      concurrency: 3,
    });
    gates[2].resolve(false);
    gates[0].resolve(false);
    gates[1].resolve(true);
    await expect(run).resolves.toEqual(["a", "c"]);
  });

  it("treats a thrown upload as a failure and keeps going", async () => {
    const failed = await uploadWithConcurrency(["a", "b"], async (item) => {
      if (item === "a") throw new Error("network");
      return true;
    });
    expect(failed).toEqual(["a"]);
  });

  it("runs at least one at a time for a zero or invalid limit", async () => {
    const upload = vi.fn(async () => true);
    await expect(uploadWithConcurrency(["a", "b"], upload, { concurrency: 0 })).resolves.toEqual([]);
    await expect(uploadWithConcurrency(["c"], upload, { concurrency: Number.NaN })).resolves.toEqual([]);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it("returns [] for an empty list and reports progress for every item", async () => {
    await expect(uploadWithConcurrency([], async () => true)).resolves.toEqual([]);
    const onSettled = vi.fn();
    await uploadWithConcurrency(["a", "b"], async (item) => item === "a", { onSettled });
    expect(onSettled).toHaveBeenCalledWith("a", true);
    expect(onSettled).toHaveBeenCalledWith("b", false);
  });
});
