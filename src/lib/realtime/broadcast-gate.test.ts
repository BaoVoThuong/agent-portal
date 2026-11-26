import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROADCAST_REFETCH_MIN_INTERVAL_MS,
  broadcastGateDelay,
  createBroadcastGate,
} from "./broadcast-gate";

type Scope = "partial" | "full";

function mergeScope(pending: Scope | null, incoming: Scope): Scope {
  return pending === "full" || incoming === "full" ? "full" : "partial";
}

describe("broadcastGateDelay", () => {
  it("lets the first event through at once", () => {
    expect(broadcastGateDelay(null, 1_000)).toBe(0);
  });

  it("waits out the rest of the window after a recent fire", () => {
    expect(broadcastGateDelay(1_000, 2_000, 5_000)).toBe(4_000);
  });

  it("never returns a negative delay", () => {
    expect(broadcastGateDelay(1_000, 9_000, 5_000)).toBe(0);
  });

  it("defaults to a five second window", () => {
    expect(BROADCAST_REFETCH_MIN_INTERVAL_MS).toBe(5_000);
    expect(broadcastGateDelay(0, 1_000)).toBe(4_000);
  });
});

describe("createBroadcastGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the first event synchronously", () => {
    const fire = vi.fn();
    const gate = createBroadcastGate<Scope>({ merge: mergeScope, fire });
    gate.push("partial");
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith("partial");
  });

  it("collapses a burst inside the window into one trailing call with the merged value", () => {
    const fire = vi.fn();
    const gate = createBroadcastGate<Scope>({ merge: mergeScope, fire });
    gate.push("partial"); // t = 0: lần 1, chạy ngay

    for (let i = 0; i < 40; i += 1) {
      vi.advanceTimersByTime(100); // t = 100 … 4.000
      gate.push(i === 10 ? "full" : "partial");
    }
    expect(fire).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000); // t = 5.000: hết cửa sổ
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenLastCalledWith("full");

    vi.advanceTimersByTime(60_000);
    expect(fire).toHaveBeenCalledTimes(2); // không còn gì chờ
  });

  it("fires at once again after a quiet window", () => {
    const fire = vi.fn();
    const gate = createBroadcastGate<Scope>({ merge: mergeScope, fire });
    gate.push("partial");
    vi.advanceTimersByTime(BROADCAST_REFETCH_MIN_INTERVAL_MS);
    gate.push("full");
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenLastCalledWith("full");
  });

  it("drops the pending call and ignores later pushes after dispose", () => {
    const fire = vi.fn();
    const gate = createBroadcastGate<Scope>({ merge: mergeScope, fire });
    gate.push("partial");
    vi.advanceTimersByTime(1_000);
    gate.push("full");
    gate.dispose();
    vi.advanceTimersByTime(10_000);
    gate.push("full");
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("honours a custom window and clock", () => {
    let now = 0;
    const fire = vi.fn();
    const gate = createBroadcastGate<Scope>({
      merge: mergeScope,
      fire,
      minIntervalMs: 15_000,
      now: () => now,
    });
    gate.push("partial"); // chạy ngay, lastFiredAt = 0
    now = 1_000;
    gate.push("partial"); // hẹn sau 14.000 ms
    vi.advanceTimersByTime(13_999);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
  });
});
