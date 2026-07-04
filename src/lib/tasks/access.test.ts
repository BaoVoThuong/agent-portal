import { describe, expect, it } from "vitest";
import {
  buildTaskActor,
  canAccessBoard,
  canSeeBacklog,
  canCreateTask,
  canAssign,
  canAssignToTask,
  canChangeTaskStatus,
  canDeleteTask,
  canManageCategories,
  canMutateTask,
  canReviewDoneTask,
  canViewTask,
  resolveCreateAssignment,
} from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const outsider = buildTaskActor(["settings.access"], "out@x.com");

describe("buildTaskActor", () => {
  it("flags manager and worker from permissions", () => {
    expect(manager.isManager).toBe(true);
    expect(manager.isWorker).toBe(false);
    expect(cs.isWorker).toBe(true);
    expect(cs.isManager).toBe(false);
    expect(manager.email).toBe("mgr@x.com");
  });
});

describe("board access", () => {
  it("manager and CS can access; outsider cannot", () => {
    expect(canAccessBoard(manager)).toBe(true);
    expect(canAccessBoard(cs)).toBe(true);
    expect(canAccessBoard(outsider)).toBe(false);
  });
  it("only manager sees backlog", () => {
    expect(canSeeBacklog(manager)).toBe(true);
    expect(canSeeBacklog(cs)).toBe(false);
  });
});

describe("create / assign / categories", () => {
  it("both roles can create tasks", () => {
    expect(canCreateTask(manager)).toBe(true);
    expect(canCreateTask(cs)).toBe(true);
    expect(canCreateTask(outsider)).toBe(false);
  });
  it("only manager assigns and manages categories", () => {
    expect(canAssign(manager)).toBe(true);
    expect(canAssign(cs)).toBe(false);
    expect(canManageCategories(manager)).toBe(true);
    expect(canManageCategories(cs)).toBe(false);
  });
});

describe("per-task view/mutate scope", () => {
  it("manager can view/mutate/delete any task", () => {
    expect(canViewTask(manager, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canMutateTask(manager, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canMutateTask(manager, { assignee_email: null })).toBe(true);
    expect(canDeleteTask(manager)).toBe(true);
  });
  it("CS can view when assigned, but assignment alone no longer grants content edit", () => {
    expect(canViewTask(cs, { assignee_email: "cs@x.com" }, { isAssignee: true })).toBe(true);
    expect(canViewTask(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canViewTask(cs, { assignee_email: null })).toBe(false);
    // Assignee can change status (progress their own work)...
    expect(canChangeTaskStatus(cs, { assignee_email: "cs@x.com" }, { isAssignee: true })).toBe(true);
    // ...but cannot edit content fields — only manager or agent owner can.
    expect(canMutateTask(cs, { assignee_email: "cs@x.com" }, false)).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canDeleteTask(cs)).toBe(false);
  });
  it("agent owner can edit content and change status even when not the assignee", () => {
    expect(canMutateTask(cs, { assignee_email: "other@x.com" }, true)).toBe(true);
    expect(
      canChangeTaskStatus(cs, { assignee_email: "other@x.com" }, { isAgentOwner: true })
    ).toBe(true);
  });
  it("CS can view (not mutate) a task they participate in", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isParticipant: true })).toBe(true);
    // participation grants view only — status changes still need assignment or agent-team membership
    expect(canChangeTaskStatus(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
  });
  it("task agent owner can view and QC-check their own agent tasks", () => {
    expect(
      canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentOwner: true })
    ).toBe(true);
    expect(canReviewDoneTask(cs, { agent_email: "cs@x.com" })).toBe(true);
    expect(canReviewDoneTask(cs, { agent_email: "other@x.com" })).toBe(false);
    expect(canReviewDoneTask(manager, { agent_email: "other@x.com" })).toBe(true);
  });
});

describe("resolveCreateAssignment", () => {
  it("CS create is forced to self + todo regardless of input", () => {
    const r = resolveCreateAssignment(cs, {
      assignee_email: "someone@x.com",
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: "cs@x.com", status: "todo" });
  });
  it("manager may leave it in backlog (unassigned)", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: null,
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: null, status: "backlog" });
  });
  it("manager assigning forces status out of backlog to todo", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: "cs@x.com",
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: "cs@x.com", status: "todo" });
  });
  it("manager may create directly in a working column with an assignee", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: "cs@x.com",
      status: "in_progress",
    });
    expect(r).toEqual({
      ok: true,
      assignee_email: "cs@x.com",
      status: "in_progress",
    });
  });
  it("manager may create a canceled task with an assignee", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: "cs@x.com",
      status: "cancel",
    });
    expect(r).toEqual({
      ok: true,
      assignee_email: "cs@x.com",
      status: "cancel",
    });
  });
  it("rejects a non-backlog task with no assignee", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: null,
      status: "todo",
    });
    expect(r.ok).toBe(false);
  });
});

describe("canViewTask with flags", () => {
  it("agent member (not assignee) can view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentMember: true })).toBe(true);
    expect(canChangeTaskStatus(cs, { assignee_email: "other@x.com" }, { isAssignee: false })).toBe(false);
  });
  it("no flags, not assignee → cannot view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, {})).toBe(false);
  });
  it("assignee flag → view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAssignee: true })).toBe(true);
  });
});

describe("canAssignToTask", () => {
  it("manager or CS in the task agent", () => {
    expect(canAssignToTask(manager, false)).toBe(true);
    expect(canAssignToTask(cs, true)).toBe(true);
    expect(canAssignToTask(cs, false)).toBe(false);
  });
});

describe("canMutateTask with isAgentOwner flag", () => {
  it("manager always; CS only when resolved as the task's agent owner", () => {
    expect(canMutateTask(manager, { assignee_email: null }, false)).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, true)).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, false)).toBe(false);
  });
});
