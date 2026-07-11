import { describe, expect, it } from "vitest";
import { dueAtForStint } from "@/lib/tasks/history";

describe("dueAtForStint", () => {
  const startedAt = "2026-07-05T00:00:00.000Z";

  it("returns a deadline for an SLA-active In Progress stint", () => {
    expect(dueAtForStint("in_progress", startedAt, 60, true)).toBe(
      "2026-07-05T01:00:00.000Z"
    );
  });

  it("returns null for an In Progress stint that is NOT SLA-active (post-Waiting / post-overdue)", () => {
    expect(dueAtForStint("in_progress", startedAt, 60, false)).toBeNull();
  });

  it("returns null for non-In-Progress stages regardless of the flag", () => {
    expect(dueAtForStint("todo", startedAt, 60, true)).toBeNull();
    expect(dueAtForStint("waiting", startedAt, 60, true)).toBeNull();
    expect(dueAtForStint("done", startedAt, 60, true)).toBeNull();
  });

  it("returns null when there is no SLA budget", () => {
    expect(dueAtForStint("in_progress", startedAt, null, true)).toBeNull();
  });
});
