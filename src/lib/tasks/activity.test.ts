import { describe, expect, it } from "vitest";
import { buildActivityEntries } from "@/lib/tasks/activity";

const before = { status: "todo", assignee_email: "cs@x.com" };

describe("buildActivityEntries", () => {
  it("logs a status change", () => {
    expect(buildActivityEntries(before, { status: "in_progress" })).toEqual([
      { type: "status_changed", meta: { from: "todo", to: "in_progress" } },
    ]);
  });
  it("logs reopened when leaving done", () => {
    expect(
      buildActivityEntries({ status: "done", assignee_email: "cs@x.com" }, { status: "in_progress" })
    ).toEqual([{ type: "reopened", meta: { from: "done", to: "in_progress" } }]);
  });
  it("logs assignment", () => {
    expect(buildActivityEntries(before, { assignee_email: "other@x.com" })).toEqual([
      { type: "assigned", meta: { to: "other@x.com" } },
    ]);
  });
  it("logs priority, due, category, and edits", () => {
    expect(buildActivityEntries(before, { priority: "high" })).toEqual([
      { type: "priority_changed", meta: { to: "high" } },
    ]);
    expect(buildActivityEntries(before, { due_date: "2026-07-01" })).toEqual([
      { type: "due_changed", meta: { to: "2026-07-01" } },
    ]);
    expect(buildActivityEntries(before, { category_id: "c1" })).toEqual([
      { type: "category_changed", meta: { to: "c1" } },
    ]);
    expect(
      buildActivityEntries({ ...before, agent_email: null }, { agent_email: "agent@x.com" })
    ).toEqual([
      { type: "agent_changed", meta: { to: "agent@x.com" } },
    ]);
    expect(buildActivityEntries(before, { title: "x" })).toEqual([
      { type: "edited", meta: null },
    ]);
  });
  it("ignores position-only reorders", () => {
    expect(buildActivityEntries(before, { position: 5 })).toEqual([]);
  });
  it("collapses title+description into a single edited entry", () => {
    expect(buildActivityEntries(before, { title: "x", description: "y" })).toEqual([
      { type: "edited", meta: null },
    ]);
  });
});
