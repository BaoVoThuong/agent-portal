import { describe, expect, it } from "vitest";
import { conflictLogFields, toEpochMicros } from "./conflict-log";

describe("toEpochMicros", () => {
  it("retains microsecond differences", () => {
    const a = toEpochMicros("2026-10-14T16:26:55.478159+00:00");
    const b = toEpochMicros("2026-10-14T16:26:55.478160+00:00");
    expect(a).not.toBeNull();
    expect(b! - a!).toBe(1);
  });

  it("accepts Postgres and JSON timestamp formats as the same instant", () => {
    expect(toEpochMicros("2026-10-15T19:41:23.544+00:00")).toBe(
      toEpochMicros("2026-10-15 19:41:23.544+00"),
    );
    expect(toEpochMicros("2026-10-15T19:41:23.544Z")).toBe(
      toEpochMicros("2026-10-15T19:41:23.544+00:00"),
    );
    expect(toEpochMicros("2026-10-14T12:47:47.548922+02:00")).toBe(
      toEpochMicros("2026-10-14T10:47:47.548922Z"),
    );
  });

  it("rejects invalid timestamps", () => {
    expect(toEpochMicros("not a date")).toBeNull();
    expect(toEpochMicros("2026-13-14T12:00:00Z")).toBeNull();
  });
});

describe("conflictLogFields", () => {
  it("reports the server token lag", () => {
    expect(conflictLogFields({
      route: "tasks.update",
      id: "t1",
      stage: "precheck",
      expected: "2026-10-14T12:47:47.548922+00:00",
      current: "2026-10-14T12:47:53.867545+00:00",
    })).toEqual({ route: "tasks.update", id: "t1", stage: "precheck", lag_ms: 6319, same_instant: false });
  });

  it("flags equivalent tokens that differ in string representation", () => {
    expect(conflictLogFields({
      route: "enrollment.update",
      id: "r1",
      stage: "precheck",
      expected: "2026-10-15T19:41:23.544Z",
      current: "2026-10-15T19:41:23.544+00:00",
    })).toMatchObject({ lag_ms: 0, same_instant: true });
  });

  it("leaves write-stage lag unknown", () => {
    expect(conflictLogFields({
      route: "tasks.update", id: "t1", stage: "write", expected: "2026-10-14T12:47:47.548922+00:00",
    })).toEqual({ route: "tasks.update", id: "t1", stage: "write", lag_ms: null, same_instant: null });
  });
});
