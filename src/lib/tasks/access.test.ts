import { describe, expect, it } from "vitest";
import {
  buildTaskActor,
  isTaskViewAdmin,
  canAccessBoard,
  canSeeBacklog,
  canCreateTask,
  canCreateTaskWithScope,
  canAssign,
  canAssignToTask,
  canChangeTaskStatus,
  canDeleteTask,
  canManageCategories,
  canMutateTask,
  canReviewDoneTask,
  canViewTask,
  resolveCreateAssignment,
  resolveTaskCapabilities,
} from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com", { isAdmin: true });
const admin = buildTaskActor(["task.manage"], "admin@x.com", { isAdmin: true });
const cs = buildTaskActor(["task.work"], "cs@x.com");
const none = buildTaskActor([], "no@x.com");
const outsider = buildTaskActor(["settings.access"], "out@x.com");
const task = { assignee_email: "cs@x.com" };

describe("buildTaskActor", () => {
  it("flags manager and worker from permissions", () => {
    expect(manager.isManager).toBe(true);
    expect(manager.isWorker).toBe(true);
    expect(cs.isWorker).toBe(true);
    expect(cs.isManager).toBe(false);
    expect(manager.email).toBe("mgr@x.com");
  });

  it("admin account with task.manage is a manager", () => {
    const a = buildTaskActor(["task.manage"], "admin@x.com", { isAdmin: true });
    expect(a.isManager).toBe(true);
    expect(a.isWorker).toBe(true);
  });

  it("agent with legacy task.manage is not a manager but stays a worker", () => {
    const a = buildTaskActor(["task.manage"], "agent@x.com", { isAdmin: false });
    expect(a.isManager).toBe(false);
    expect(a.isWorker).toBe(true);
  });

  it("plain CS with task.work is a worker only", () => {
    const a = buildTaskActor(["task.work"], "cs@x.com");
    expect(a.isManager).toBe(false);
    expect(a.isWorker).toBe(true);
  });
});

describe("isTaskViewAdmin", () => {
  it("true for legacy admin role or the Admin/Super Admin system role", () => {
    expect(isTaskViewAdmin({ role: "admin" })).toBe(true);
    expect(isTaskViewAdmin({ roles: ["Admin"] })).toBe(true);
    expect(isTaskViewAdmin({ roles: ["Super Admin"] })).toBe(true);
  });

  it("false for a plain agent", () => {
    expect(isTaskViewAdmin({ role: "agent", roles: ["Agent"] })).toBe(false);
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
  it("manager can create; plain CS cannot", () => {
    expect(canCreateTask(manager)).toBe(true);
    expect(canCreateTask(cs)).toBe(false);
    expect(canCreateTask(outsider)).toBe(false);
  });
  it("CS can create only with agent owner/Assistant scope", () => {
    expect(canCreateTaskWithScope(manager)).toBe(true);
    expect(canCreateTaskWithScope(cs, true)).toBe(true);
    expect(canCreateTaskWithScope(cs, false)).toBe(false);
    expect(canCreateTaskWithScope(outsider, true)).toBe(false);
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
    // ...but cannot edit content fields — manager, agent owner, or reporter only.
    expect(canMutateTask(cs, { assignee_email: "cs@x.com" }, {})).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canDeleteTask(cs)).toBe(false);
  });
  it("agent owner can edit content and change status even when not the assignee", () => {
    expect(canMutateTask(cs, { assignee_email: "other@x.com" }, { isAgentOwner: true })).toBe(true);
    expect(
      canChangeTaskStatus(cs, { assignee_email: "other@x.com" }, { isAgentOwner: true })
    ).toBe(true);
  });
  it("reporter (creator) can edit content even when not assignee or agent owner", () => {
    expect(canMutateTask(cs, { assignee_email: "other@x.com" }, { isReporter: true })).toBe(true);
  });
  it("CS can view (not mutate) a task they participate in", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isParticipant: true })).toBe(true);
    // participation grants view only — status changes still need assignment or agent ownership
    expect(canChangeTaskStatus(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
  });
  it("CS agent-team member can view without content edit or status control", () => {
    expect(
      canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentMember: true })
    ).toBe(true);
    expect(
      canChangeTaskStatus(
        cs,
        { assignee_email: "other@x.com" },
        { isAgentMember: true } as never
      )
    ).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
  });
  it("task agent owner can view and QC-check through the resolved owner flag", () => {
    expect(
      canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentOwner: true })
    ).toBe(true);
    expect(canReviewDoneTask(cs, { isAgentOwner: true })).toBe(true);
    expect(canReviewDoneTask(cs, {})).toBe(false);
    expect(canReviewDoneTask(manager, {})).toBe(true);
  });
});

describe("resolveCreateAssignment", () => {
  it("CS without agent scope cannot create tasks", () => {
    const r = resolveCreateAssignment(cs, {
      assignee_email: "someone@x.com",
      status: "backlog",
    });
    expect(r).toEqual({ ok: false, error: "Not allowed to create tasks." });
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
  it("CS with agent scope (owner/Assistant) gets free choice like a manager", () => {
    const r = resolveCreateAssignment(
      cs,
      { assignee_email: "teammate@x.com", status: "backlog" },
      { hasAgentScope: true }
    );
    expect(r).toEqual({ ok: true, assignee_email: "teammate@x.com", status: "todo" });

    const backlogged = resolveCreateAssignment(
      cs,
      { assignee_email: null, status: "backlog" },
      { hasAgentScope: true }
    );
    expect(backlogged).toEqual({ ok: true, assignee_email: null, status: "backlog" });
  });
  it("CS without agent scope is rejected even with a teammate requested", () => {
    const r = resolveCreateAssignment(
      cs,
      { assignee_email: "teammate@x.com", status: "backlog" },
      { hasAgentScope: false }
    );
    expect(r).toEqual({ ok: false, error: "Not allowed to create tasks." });
  });
});

describe("canViewTask with flags", () => {
  it("agent member (not assignee) can view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentMember: true })).toBe(true);
    expect(
      canChangeTaskStatus(
        cs,
        { assignee_email: "other@x.com" },
        { isAgentMember: true } as never
      )
    ).toBe(false);
  });
  it("agent member cannot view an unassigned team task", () => {
    expect(canViewTask(cs, { assignee_email: null }, { isAgentMember: true })).toBe(false);
  });
  it("no flags, not assignee → cannot view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, {})).toBe(false);
  });
  it("assignee flag → view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAssignee: true })).toBe(true);
  });
});

describe("canAssignToTask", () => {
  it("manager or the task's agent owner (not just any agent-team member anymore)", () => {
    expect(canAssignToTask(manager, false)).toBe(true);
    expect(canAssignToTask(cs, true)).toBe(true);
    expect(canAssignToTask(cs, false)).toBe(false);
  });
});

describe("canMutateTask flags", () => {
  it("manager always; CS only when agent owner or reporter", () => {
    expect(canMutateTask(manager, { assignee_email: null }, {})).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, { isAgentOwner: true })).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, { isReporter: true })).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, {})).toBe(false);
  });
});

describe("canDeleteTask with isAgentOwner flag", () => {
  it("manager always; CS only when resolved as the task's agent owner", () => {
    expect(canDeleteTask(manager)).toBe(true);
    expect(canDeleteTask(cs, true)).toBe(true);
    expect(canDeleteTask(cs, false)).toBe(false);
    expect(canDeleteTask(cs)).toBe(false);
  });
});

describe("canChangeTaskStatus (team members can no longer move teammates)", () => {
  it("assignee or agent owner can; a plain team member cannot", () => {
    expect(canChangeTaskStatus(cs, task, { isAssignee: true })).toBe(true);
    expect(canChangeTaskStatus(cs, task, { isAgentOwner: true })).toBe(true);
    expect(canChangeTaskStatus(cs, task, { isAgentMember: true } as never)).toBe(false);
    expect(canChangeTaskStatus(admin, task, {})).toBe(true);
  });
});

describe("canReviewDoneTask (assistant/owner allowed via flag)", () => {
  it("admin and agent-owner/assistant can; plain CS cannot", () => {
    expect(canReviewDoneTask(admin, {})).toBe(true);
    expect(canReviewDoneTask(cs, { isAgentOwner: true })).toBe(true);
    expect(canReviewDoneTask(cs, {})).toBe(false);
  });
});

describe("resolveTaskCapabilities", () => {
  it("admin gets everything", () => {
    expect(resolveTaskCapabilities(admin, task, {})).toEqual({
      canView: true,
      canEditContent: true,
      canChangeStatus: true,
      canAssign: true,
      canDelete: true,
      canReviewQC: true,
      canReopen: true,
    });
  });

  it("agent-level gets everything on the task", () => {
    const c = resolveTaskCapabilities(cs, task, { isAgentOwner: true });
    expect(c).toEqual({
      canView: true,
      canEditContent: true,
      canChangeStatus: true,
      canAssign: true,
      canDelete: true,
      canReviewQC: true,
      canReopen: true,
    });
  });

  it("CS assignee: view + status + reopen only", () => {
    const c = resolveTaskCapabilities(cs, task, { isAssignee: true });
    expect(c.canView).toBe(true);
    expect(c.canChangeStatus).toBe(true);
    expect(c.canReopen).toBe(true);
    expect(c.canEditContent).toBe(false);
    expect(c.canAssign).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(c.canReviewQC).toBe(false);
  });

  it("CS team member (not assignee): can view but not change status", () => {
    const c = resolveTaskCapabilities(
      cs,
      { assignee_email: "other@x.com" },
      { isAgentMember: true }
    );
    expect(c.canView).toBe(true);
    expect(c.canChangeStatus).toBe(false);
  });

  it("no board permission: nothing", () => {
    const c = resolveTaskCapabilities(none, task, {
      isAgentOwner: true,
      isAssignee: true,
    });
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });
});
