import { describe, expect, it } from "vitest";
import {
  assigneeChangeAlreadyApplied,
  canRetryTaskPatchAfterConflict,
} from "./conflict-retry";

const before = {
  id: "t1",
  status: "todo",
  position: 1,
  closed_at: null,
  priority: "normal",
  title: "Call client",
  done_reviewed_at: null,
  done_reviewed_by_email: null,
  custom_values: { due: "2026-10-03", note: "a" },
  updated_at: "2026-10-02T10:00:00.000Z",
};

describe("canRetryTaskPatchAfterConflict", () => {
  it("retries when only unrelated fields or the timestamp moved", () => {
    const canonical = { ...before, title: "Call client back", updated_at: "2026-10-02T10:01:00.000Z" };
    expect(canRetryTaskPatchAfterConflict({ priority: "urgent" }, before, canonical)).toBe(true);
  });

  it("does not retry when someone else changed the same field", () => {
    const canonical = { ...before, priority: "high" };
    expect(canRetryTaskPatchAfterConflict({ priority: "urgent" }, before, canonical)).toBe(false);
  });

  it("treats a move as status and position together", () => {
    const moved = { ...before, status: "in_progress" };
    expect(canRetryTaskPatchAfterConflict({ position: 3 }, before, moved)).toBe(false);
    expect(canRetryTaskPatchAfterConflict({ status: "done", position: 2 }, before, { ...before, closed_at: "x" })).toBe(false);
  });

  it("compares custom values per key", () => {
    const otherKeyChanged = { ...before, custom_values: { due: "2026-10-03", note: "b" } };
    expect(canRetryTaskPatchAfterConflict({ custom_values: { due: "2026-10-04" } }, before, otherKeyChanged)).toBe(true);
    const sameKeyChanged = { ...before, custom_values: { due: "2026-10-05", note: "a" } };
    expect(canRetryTaskPatchAfterConflict({ custom_values: { due: "2026-10-04" } }, before, sameKeyChanged)).toBe(false);
  });

  it("checks the columns behind the request-only done_reviewed key", () => {
    const reviewed = { ...before, done_reviewed_at: "2026-10-02T10:02:00.000Z" };
    expect(canRetryTaskPatchAfterConflict({ done_reviewed: true }, before, reviewed)).toBe(false);
    expect(canRetryTaskPatchAfterConflict({ done_reviewed: true }, before, { ...before })).toBe(true);
  });

  it("refuses to guess about a field neither version has", () => {
    expect(canRetryTaskPatchAfterConflict({ unknown_field: 1 }, before, { ...before })).toBe(false);
  });
});

describe("assigneeChangeAlreadyApplied", () => {
  it("recognises an assignment that already happened", () => {
    expect(assigneeChangeAlreadyApplied({ assignees: ["CS@Example.com"] }, "cs@example.com", true)).toBe(true);
    expect(assigneeChangeAlreadyApplied({ assignees: [] }, "cs@example.com", true)).toBe(false);
  });

  it("recognises an unassignment that already happened", () => {
    expect(assigneeChangeAlreadyApplied({ assignees: ["other@example.com"] }, "cs@example.com", false)).toBe(true);
    expect(assigneeChangeAlreadyApplied({ assignee_email: "cs@example.com" }, "cs@example.com", false)).toBe(false);
  });
});
