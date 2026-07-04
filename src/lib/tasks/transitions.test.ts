import { describe, expect, it } from "vitest";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import { buildTaskActor } from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const assigned = {
  status: "todo" as const,
  assignee_email: "cs@x.com",
  in_progress_at: null,
};

describe("resolveTaskPatch", () => {
  it("accepts a simple field edit", () => {
    const r = resolveTaskPatch(manager, assigned, { title: "  New title  " });
    expect(r).toEqual({ ok: true, patch: { title: "New title" } });
  });

  it("accepts changing the customer agent and rejects clearing it", () => {
    expect(
      resolveTaskPatch(manager, assigned, { agent_email: "  agent@x.com  " })
    ).toEqual({ ok: true, patch: { agent_email: "agent@x.com" } });

    expect(resolveTaskPatch(manager, assigned, { agent_email: "" })).toEqual({
      ok: false,
      error: "Agent is required.",
    });
  });

  it("accepts changing the category and rejects clearing it", () => {
    expect(resolveTaskPatch(manager, assigned, { category_id: "  c1  " })).toEqual({
      ok: true,
      patch: { category_id: "c1" },
    });

    expect(resolveTaskPatch(manager, assigned, { category_id: null })).toEqual({
      ok: false,
      error: "Category is required.",
    });
  });

  it("accepts changing or clearing the FUB link", () => {
    expect(
      resolveTaskPatch(manager, assigned, { fub_link: "  https://app.fub.test/people/1  " })
    ).toEqual({
      ok: true,
      patch: { fub_link: "https://app.fub.test/people/1" },
    });

    expect(resolveTaskPatch(manager, assigned, { fub_link: "" })).toEqual({
      ok: true,
      patch: { fub_link: null },
    });
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
      patch: {
        status: "backlog",
        assignee_email: null,
        done_reviewed_by_email: null,
        done_reviewed_at: null,
      },
    });
  });

  it("rejects leaving backlog without an assignee", () => {
    const r = resolveTaskPatch(
      manager,
      { status: "backlog", assignee_email: null, in_progress_at: null },
      { status: "todo" }
    );
    expect(r.ok).toBe(false);
  });

  it("stamps in_progress_at on the very first start (never started before)", () => {
    const r = resolveTaskPatch(
      manager,
      assigned,
      { status: "in_progress" },
      { nowIso: "2026-07-05T00:00:00.000Z" }
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        status: "in_progress",
        done_reviewed_by_email: null,
        done_reviewed_at: null,
        in_progress_at: "2026-07-05T00:00:00.000Z",
        overdue_flagged_at: null,
      },
    });
  });

  it("rejects reopening Done/Cancel straight to in_progress via the generic patch (must use the reason-gated /reopen endpoint)", () => {
    const done = {
      status: "done" as const,
      assignee_email: "cs@x.com",
      in_progress_at: "2026-06-01T00:00:00.000Z",
    };
    const cancelled = { ...done, status: "cancel" as const };
    expect(resolveTaskPatch(manager, done, { status: "in_progress" }).ok).toBe(false);
    expect(resolveTaskPatch(manager, cancelled, { status: "in_progress" }).ok).toBe(false);
  });

  it("does NOT restart the clock bouncing through To Do (anti-gaming: assignee can't free-reset overdue)", () => {
    const alreadyStarted = {
      status: "todo" as const,
      assignee_email: "cs@x.com",
      in_progress_at: "2026-06-01T00:00:00.000Z",
    };
    const r = resolveTaskPatch(
      manager,
      alreadyStarted,
      { status: "in_progress" },
      { nowIso: "2026-07-05T01:00:00.000Z" }
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        status: "in_progress",
        done_reviewed_by_email: null,
        done_reviewed_at: null,
      },
    });
  });

  it("does not restamp in_progress_at when staying in in_progress (e.g. position-only patch)", () => {
    const inProgress = {
      status: "in_progress" as const,
      assignee_email: "cs@x.com",
      in_progress_at: "2026-06-01T00:00:00.000Z",
    };
    const r = resolveTaskPatch(manager, inProgress, { position: 5 });
    expect(r).toEqual({ ok: true, patch: { position: 5 } });
  });

  it("accepts cancel as a terminal task status", () => {
    const r = resolveTaskPatch(manager, assigned, { status: "cancel" });
    expect(r).toEqual({
      ok: true,
      patch: {
        status: "cancel",
        done_reviewed_by_email: null,
        done_reviewed_at: null,
      },
    });
  });

  it("resets QC review whenever status changes", () => {
    const r = resolveTaskPatch(manager, assigned, { status: "done" });
    expect(r).toEqual({
      ok: true,
      patch: {
        status: "done",
        done_reviewed_by_email: null,
        done_reviewed_at: null,
      },
    });
  });

  it("allows final QC only for done tasks when permitted", () => {
    const done = { status: "done" as const, assignee_email: "cs@x.com", in_progress_at: null };
    expect(
      resolveTaskPatch(manager, done, { done_reviewed: true }, {
        canReviewDone: true,
        nowIso: "2026-07-02T00:00:00.000Z",
      })
    ).toEqual({
      ok: true,
      patch: {
        done_reviewed_by_email: "mgr@x.com",
        done_reviewed_at: "2026-07-02T00:00:00.000Z",
      },
    });

    expect(
      resolveTaskPatch(manager, assigned, { done_reviewed: true }, {
        canReviewDone: true,
      }).ok
    ).toBe(false);
    expect(resolveTaskPatch(cs, done, { done_reviewed: true }).ok).toBe(false);
  });

  it("worker cannot reassign when opts.canAssign is false", () => {
    const r = resolveTaskPatch(cs, assigned, { assignee_email: "other@x.com" }, { canAssign: false });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe("You cannot reassign tasks.");
  });

  it("worker can reassign when opts.canAssign is true", () => {
    const r = resolveTaskPatch(cs, assigned, { assignee_email: "other@x.com" }, { canAssign: true });
    expect(r).toEqual({ ok: true, patch: { assignee_email: "other@x.com" } });
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
