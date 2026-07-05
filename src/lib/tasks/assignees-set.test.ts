import { describe, expect, it } from "vitest";
import { reconcileAssigneesForNewAgent, resolveAssigneeChange } from "@/lib/tasks/assignees-set";

describe("resolveAssigneeChange", () => {
  it("moves a backlog task to todo when adding the first assignee", () => {
    const r = resolveAssigneeChange(
      { status: "backlog", assignees: [] },
      { add: "a@x.com" }
    );

    expect(r.assignees).toEqual(["a@x.com"]);
    expect(r.status).toBe("todo");
  });

  it("keeps status when adding a second assignee", () => {
    const r = resolveAssigneeChange(
      { status: "in_progress", assignees: ["a@x.com"] },
      { add: "b@x.com" }
    );

    expect(r.assignees.sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(r.status).toBe("in_progress");
  });

  it("moves to backlog when removing the last assignee", () => {
    const r = resolveAssigneeChange(
      { status: "in_progress", assignees: ["a@x.com"] },
      { remove: "a@x.com" }
    );

    expect(r.assignees).toEqual([]);
    expect(r.status).toBe("backlog");
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

describe("reconcileAssigneesForNewAgent", () => {
  it("returns null (no-op) when every current assignee is on the new agent's team", () => {
    const r = reconcileAssigneesForNewAgent(["a@x.com", "b@x.com"], ["a@x.com", "b@x.com", "c@x.com"]);
    expect(r).toEqual({ assignees: null, status: null });
  });

  it("drops assignees not on the new agent's team, keeps status when someone remains", () => {
    const r = reconcileAssigneesForNewAgent(["a@x.com", "b@x.com"], ["b@x.com"]);
    expect(r).toEqual({ assignees: ["b@x.com"], status: null });
  });

  it("falls back to backlog when pruning empties the assignee list", () => {
    const r = reconcileAssigneesForNewAgent(["a@x.com"], ["b@x.com", "c@x.com"]);
    expect(r).toEqual({ assignees: [], status: "backlog" });
  });

  it("no-op when there were no assignees to begin with", () => {
    const r = reconcileAssigneesForNewAgent([], ["b@x.com"]);
    expect(r).toEqual({ assignees: null, status: null });
  });
});
