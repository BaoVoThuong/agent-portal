import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MutationError,
  createMutationTracker,
  requestJson,
  runOptimistic,
} from "./optimistic";

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runOptimistic", () => {
  it("applies before the request settles, then commits the server value", async () => {
    const calls: string[] = [];
    const request = deferred<string>();
    const run = runOptimistic({
      apply: () => calls.push("apply"),
      request: () => request.promise,
      commit: (value) => calls.push(`commit:${value}`),
      rollback: () => calls.push("rollback"),
    });
    expect(calls).toEqual(["apply"]);
    request.resolve("server");
    await expect(run).resolves.toEqual({ ok: true, value: "server" });
    expect(calls).toEqual(["apply", "commit:server"]);
  });

  it("rolls back with the conflict error", async () => {
    const rollback = vi.fn();
    const result = await runOptimistic({
      apply: () => undefined,
      request: () => Promise.reject(new MutationError("changed elsewhere", 409)),
      rollback,
    });
    expect(result.ok).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback.mock.calls[0][0].isConflict).toBe(true);
  });

  it("treats unknown failures as network errors", async () => {
    const result = await runOptimistic({
      apply: () => undefined,
      request: () => Promise.reject(new TypeError("Failed to fetch")),
      rollback: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(0);
      expect(result.error.isNetwork).toBe(true);
    }
  });

  it("does not call the API or roll back when apply throws", async () => {
    const request = vi.fn(async () => "never");
    const rollback = vi.fn();
    const result = await runOptimistic({
      apply: () => {
        throw new Error("bad state");
      },
      request,
      rollback,
    });
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("lets a newer mutation decide: an older one neither commits nor rolls back", async () => {
    const tracker = createMutationTracker();
    const older = tracker.begin("row-1");
    const newer = tracker.begin("row-1");
    const commit = vi.fn();
    const rollback = vi.fn();

    await runOptimistic({
      apply: () => undefined,
      request: async () => "old server row",
      commit,
      rollback,
      isLatest: older.isLatest,
    });
    await runOptimistic({
      apply: () => undefined,
      request: () => Promise.reject(new MutationError("nope", 500)),
      commit,
      rollback,
      isLatest: older.isLatest,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    expect(newer.isLatest()).toBe(true);
  });
});

describe("createMutationTracker", () => {
  it("tracks keys independently and forgets finished ones", () => {
    const tracker = createMutationTracker();
    const a = tracker.begin("a");
    const b = tracker.begin("b");
    expect(a.isLatest()).toBe(true);
    expect(b.isLatest()).toBe(true);
    a.end();
    expect(tracker.isPending("a")).toBe(false);
    expect(tracker.isPending("b")).toBe(true);
  });

  it("an older end() does not clear a newer mutation", () => {
    const tracker = createMutationTracker();
    const older = tracker.begin("a");
    tracker.begin("a");
    older.end();
    expect(tracker.isPending("a")).toBe(true);
  });
});

describe("requestJson", () => {
  it("adds a JSON content type for string bodies only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestJson("/api/a", { method: "PATCH", body: JSON.stringify({ a: 1 }) });
    await requestJson("/api/b", { method: "POST", body: new FormData() });

    const jsonHeaders = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    const formHeaders = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(jsonHeaders.get("Content-Type")).toBe("application/json");
    expect(formHeaders.get("Content-Type")).toBeNull();
  });

  it("throws the API error with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Rule changed" }), { status: 409 })),
    );
    await expect(requestJson("/api/rules", { method: "POST", body: "{}" })).rejects.toMatchObject({
      message: "Rule changed",
      status: 409,
    });
  });

  it("throws a network error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(requestJson("/api/x")).rejects.toMatchObject({ status: 0 });
  });
});
