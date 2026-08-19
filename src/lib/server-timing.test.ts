import { describe, expect, it, vi } from "vitest";
import { RouteTiming, shouldLogRouteTiming } from "./server-timing";

describe("RouteTiming", () => {
  it("records measured work in a Server-Timing header without request data", async () => {
    const ticks = [100, 120, 155, 200];
    const timing = new RouteTiming("task-detail", {
      now: () => ticks.shift() ?? 200,
      logEnabled: false,
    });

    await timing.measure("comments", async () => "ok");

    expect(timing.headerValue()).toBe(
      "comments;dur=35.0, route_total;dur=100.0",
    );
  });

  it("emits one structured line with status and durations", () => {
    const logger = vi.fn();
    const ticks = [10, 42];
    const timing = new RouteTiming("task-detail", {
      now: () => ticks.shift() ?? 42,
      logger,
      logEnabled: true,
    });
    timing.record("auth", 12.345);

    timing.log(200);

    expect(logger).toHaveBeenCalledWith(
      "[perf:task-detail] status=200 auth=12.3ms route_total=32.0ms",
    );
  });

  it("rejects invalid metric names instead of generating a malformed header", () => {
    const timing = new RouteTiming("task-detail", { logEnabled: false });
    expect(() => timing.record("task id", 1)).toThrow(
      "Invalid Server-Timing metric name",
    );
  });
});

describe("shouldLogRouteTiming", () => {
  it("logs by default in development only", () => {
    expect(shouldLogRouteTiming({ NODE_ENV: "development" })).toBe(true);
    expect(shouldLogRouteTiming({ NODE_ENV: "test" })).toBe(false);
    expect(shouldLogRouteTiming({ NODE_ENV: "production" })).toBe(false);
  });

  it("supports an explicit production-safe opt in and opt out", () => {
    expect(
      shouldLogRouteTiming({
        NODE_ENV: "production",
        TASK_DETAIL_PERF_LOGS: "1",
      }),
    ).toBe(true);
    expect(
      shouldLogRouteTiming({
        NODE_ENV: "development",
        TASK_DETAIL_PERF_LOGS: "0",
      }),
    ).toBe(false);
  });
});
