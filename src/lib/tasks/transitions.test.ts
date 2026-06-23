import { describe, expect, it } from "vitest";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import { buildTaskActor } from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const assigned = { status: "todo" as const, assignee_email: "cs@x.com" };

describe("resolveTaskPatch", () => {
  it("accepts a simple field edit", () => {
    const r = resolveTaskPatch(manager, assigned, { title: "  New title  " });
    expect(r).toEqual({ ok: true, patch: { title: "New title" } });
  });

  it("rejects empty title", () => {
    const r = resolveTaskPatch(manager, assigned, { title: "   " });
    expect(r.ok).toBe(false);
  });

  it("worker cannot reassign", () => {
    const r = resolveTaskPatch(cs, assigned, { assignee_email: "other@x.com" });
    expect(r.ok).toBe(false);
  });

  it("manager can reassign", () => {
    const r = resolveTaskPatch(manager, assigned, { assignee_email: "other@x.com" });
    expect(r).toEqual({ ok: true, patch: { assignee_email: "other@x.com" } });
  });

  it("moving to backlog while still assigned is rejected", () => {
    const r = resolveTaskPatch(manager, assigned, { status: "backlog" });
    expect(r.ok).toBe(false);
  });

  it("manager can send back to backlog by unassigning in the same patch", () => {
    const r = resolveTaskPatch(manager, assigned, {
      status: "backlog",
      assignee_email: null,
    });
    expect(r).toEqual({
      ok: true,
      patch: { status: "backlog", assignee_email: null },
    });
  });

  it("rejects leaving backlog without an assignee", () => {
    const r = resolveTaskPatch(
      manager,
      { status: "backlog", assignee_email: null },
      { status: "todo" }
    );
    expect(r.ok).toBe(false);
  });

  it("waiting_reason kept only when status is waiting", () => {
    const r1 = resolveTaskPatch(cs, assigned, {
      status: "waiting",
      waiting_reason: "customer",
    });
    expect(r1).toEqual({
      ok: true,
      patch: { status: "waiting", waiting_reason: "customer" },
    });
    const r2 = resolveTaskPatch(cs, assigned, {
      status: "in_progress",
      waiting_reason: "customer",
    });
    expect(r2).toEqual({
      ok: true,
      patch: { status: "in_progress", waiting_reason: null },
    });
  });

  it("validates enums and position", () => {
    expect(resolveTaskPatch(manager, assigned, { priority: "nope" }).ok).toBe(false);
    expect(resolveTaskPatch(manager, assigned, { status: "nope" }).ok).toBe(false);
    expect(
      resolveTaskPatch(manager, assigned, { position: 3.5 })
    ).toEqual({ ok: true, patch: { position: 3.5 } });
    expect(resolveTaskPatch(manager, assigned, { position: "x" }).ok).toBe(false);
  });
});
