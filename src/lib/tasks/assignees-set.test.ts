import { describe, expect, it } from "vitest";
import { resolveAssigneeChange } from "@/lib/tasks/assignees-set";

describe("resolveAssigneeChange", () => {
  it("moves a backlog task to todo when adding the first assignee", () => {
    const r = resolveAssigneeChange(
      { status: "backlog", assignees: [] },
      { add: "a@x.com" }
    );

    expect(r.assignees).toEqual(["a@x.com"]);
    expect(r.status).toBe("todo");
    expect(r.clearWaitingReason).toBe(false);
  });

  it("keeps status when adding a second assignee", () => {
    const r = resolveAssigneeChange(
      { status: "in_progress", assignees: ["a@x.com"] },
      { add: "b@x.com" }
    );

    expect(r.assignees.sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(r.status).toBe("in_progress");
  });

  it("moves to backlog and clears waiting when removing the last assignee", () => {
    const r = resolveAssigneeChange(
      { status: "waiting", assignees: ["a@x.com"] },
      { remove: "a@x.com" }
    );

    expect(r.assignees).toEqual([]);
    expect(r.status).toBe("backlog");
    expect(r.clearWaitingReason).toBe(true);
  });

  it("keeps status when removing one of many assignees", () => {
    const r = resolveAssigneeChange(
      { status: "done", assignees: ["a@x.com", "b@x.com"] },
      { remove: "a@x.com" }
    );

    expect(r.assignees).toEqual(["b@x.com"]);
    expect(r.status).toBe("done");
  });
});
