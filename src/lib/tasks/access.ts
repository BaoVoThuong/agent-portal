// The ONLY place task-board permission/scope decisions are made. Pure functions
// (no I/O) so they are fully unit-tested. The company-queue rule that plain-CS
// see every task is a `seesAllTasks` flag here rather than a separate branch in
// each route: it used to live only in actorSeesAllTasks()/fetchTasksForActor(),
// and two of the four read paths (direct GET, search) forgot to apply it. API routes enforce these decisions,
// and the client uses the same resolver to render matching controls. Identity
// is by email (no account id in session).
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import type { TaskActor, TaskRow, TaskStatus } from "./types";

const TASK_ADMIN_ROLE_NAMES = new Set([
  "Admin Health Task",
  "Task Admin",
]);

// Task admin = full Admin/Super Admin, legacy admin, or a task-admin RBAC role.
// Still deliberately NOT the same as holding task.manage alone: an
// agent/assistant can keep manage-like task permissions without getting the
// admin-wide queue/dashboard view unless their role is explicitly listed here.
export function isTaskViewAdmin(user: {
  role?: string | null;
  roles?: readonly string[];
}): boolean {
  const roles = user.roles ?? [];
  return (
    user.role === "admin" ||
    roles.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roles.includes(LEGACY_SUPER_ADMIN_ROLE_NAME) ||
    roles.some((role) => TASK_ADMIN_ROLE_NAMES.has(role))
  );
}

export function buildTaskActor(
  permissions: readonly string[] | undefined,
  email: string,
  opts?: { isAdmin?: boolean }
): TaskActor {
  const hasManage = can(permissions, PERMISSIONS.TASK_MANAGE);
  return {
    email,
    // Admin view requires BOTH the manage permission and the admin role.
    isManager: hasManage && Boolean(opts?.isAdmin),
    // A demoted agent/assistant (manage but not admin) keeps board access.
    isWorker: can(permissions, PERMISSIONS.TASK_WORK) || hasManage,
  };
}

export function canAccessBoard(actor: TaskActor): boolean {
  return actor.isManager || actor.isWorker;
}

// Backlog (unassigned work) is a manager-only view.
export function canSeeBacklog(actor: TaskActor): boolean {
  return actor.isManager;
}

export function canCreateTask(actor: TaskActor): boolean {
  return actor.isManager;
}

export function canCreateTaskWithScope(
  actor: TaskActor,
  hasAgentScope = false
): boolean {
  return actor.isManager || (actor.isWorker && hasAgentScope);
}

export function canAssign(actor: TaskActor): boolean {
  return actor.isManager;
}

export function canManageCategories(actor: TaskActor): boolean {
  return actor.isManager;
}

// Manager: any task. Worker: task access comes from resolved flags.
// `flags` covers additional ways a worker may gain view access:
//   isAssignee    – caller already resolved assignment externally
//   isAgentMember – worker assists the task's agent account
//   isAgentOwner  – worker is the task's customer agent / final QC owner
//   isParticipant – worker was @mentioned / added as a participant
//   isReporter    – worker created/reported the task
//   seesAllTasks  – plain-CS company-wide queue (actorSeesAllTasks). Widens
//                   READ access only; every mutation helper below keeps reading
//                   its own specific flags, so the queue never grants edits.
export function canViewTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: {
    isAssignee?: boolean;
    isAgentMember?: boolean;
    isAgentOwner?: boolean;
    isParticipant?: boolean;
    isReporter?: boolean;
    seesAllTasks?: boolean;
  } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return (
    Boolean(flags.seesAllTasks) ||
    Boolean(flags.isAssignee) ||
    Boolean(flags.isAgentMember) ||
    Boolean(flags.isAgentOwner) ||
    Boolean(flags.isParticipant) ||
    Boolean(flags.isReporter)
  );
}

export function canReviewDoneTask(
  actor: TaskActor,
  flags: { isAgentOwner?: boolean } = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAgentOwner);
}

// Assign/reassign: manager or the task's agent owner (agent themself, or a
// promoted Assistant — see isAgentOwnerOrAssistant) only. CS assignees are a
// company pool, so Agent Groups does not restrict who can be assigned.
export function canAssignToTask(actor: TaskActor, isAgentOwner: boolean): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isAgentOwner;
}

// Content edit (title/description/priority/category/agent/fub_link, plus
// task-level attachment uploads): manager, the task's agent owner, or the
// person who reported (created) the task.
export function canMutateTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: { isAgentOwner?: boolean; isReporter?: boolean } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAgentOwner) || Boolean(flags.isReporter);
}

/**
 * Sửa Due Date: CHỈ agent của task, assistant của agent đó, và admin.
 *
 * Hẹp hơn `canMutateTask` đúng một người: NGƯỜI MỞ TASK. Ai cũng mở được task
 * cho CS, nhưng hạn chót là cam kết vận hành — người mở task không được tự dời
 * deadline của người khác. `isAgentOwner` đã bao gồm assistant (xem
 * isAgentOwnerOrAssistant), nên không cần cờ riêng cho assistant.
 */
export function canEditTaskDueDate(
  actor: TaskActor,
  flags: { isAgentOwner?: boolean } = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAgentOwner);
}

// Status transitions (kanban move, position), overdue-unlock, and reopening
// a Done/Cancel task: manager, the agent owner/Assistant, or whoever is
// actually assigned the work.
export function canChangeTaskStatus(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: {
    isAssignee?: boolean;
    isAgentOwner?: boolean;
  } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAssignee) || Boolean(flags.isAgentOwner);
}

export function canDeleteTask(actor: TaskActor, isAgentOwner = false): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isAgentOwner;
}

export type TaskMembershipFlags = {
  isAssignee?: boolean;
  isAgentOwner?: boolean;
  isAgentMember?: boolean;
  isReporter?: boolean;
  isParticipant?: boolean;
  seesAllTasks?: boolean;
};

export type TaskCapabilities = {
  canView: boolean;
  canEditContent: boolean;
  canChangeStatus: boolean;
  canAssign: boolean;
  canDelete: boolean;
  canReviewQC: boolean;
  canReopen: boolean;
  canEditDueDate: boolean;
};

// Single source of truth: server routes and the client both call this with the
// same resolved membership flags, so capabilities cannot drift between layers.
export function resolveTaskCapabilities(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: TaskMembershipFlags = {}
): TaskCapabilities {
  const canView = canViewTask(actor, task, flags);
  const changeStatus = canChangeTaskStatus(actor, task, {
    isAssignee: flags.isAssignee,
    isAgentOwner: flags.isAgentOwner,
  });

  return {
    canView,
    canEditContent: canMutateTask(actor, task, {
      isAgentOwner: flags.isAgentOwner,
      isReporter: flags.isReporter,
    }),
    canChangeStatus: changeStatus,
    canAssign: canAssignToTask(actor, Boolean(flags.isAgentOwner)),
    canDelete: canDeleteTask(actor, Boolean(flags.isAgentOwner)),
    canReviewQC: canReviewDoneTask(actor, {
      isAgentOwner: flags.isAgentOwner,
    }),
    canReopen: changeStatus,
    canEditDueDate: canEditTaskDueDate(actor, {
      isAgentOwner: flags.isAgentOwner,
    }),
  };
}

export type CreateAssignmentInput = {
  assignee_email: string | null;
  status: TaskStatus;
};

export type CreateAssignmentResult =
  | { ok: true; assignee_email: string | null; status: TaskStatus }
  | { ok: false; error: string };

// Enforces the core invariants at creation time:
//  - A manager, or a worker with agent-scope (owner/Assistant) for the task's
//    agent, gets free choice from the company CS pool, or backlog — same as a
//    manager.
//  - A plain worker cannot create tasks.
//  - A backlog task must have no assignee; assigning forces status -> 'todo'.
//  - A non-backlog task must have an assignee.
export function resolveCreateAssignment(
  actor: TaskActor,
  input: CreateAssignmentInput,
  opts?: { hasAgentScope?: boolean }
): CreateAssignmentResult {
  const elevated = actor.isManager || Boolean(opts?.hasAgentScope);

  if (!elevated) {
    return { ok: false, error: "Not allowed to create tasks." };
  }

  // Manager, or agent owner/Assistant creating for their own agent: free choice.
  const assignee = input.assignee_email?.trim() || null;
  if (assignee === null) {
    // Unassigned -> must be backlog.
    if (input.status !== "backlog") {
      return { ok: false, error: "Non-backlog task must have an assignee." };
    }
    return { ok: true, assignee_email: null, status: "backlog" };
  }
  // Assigned -> cannot be backlog; default backlog request to 'todo'.
  const status = input.status === "backlog" ? "todo" : input.status;
  return { ok: true, assignee_email: assignee, status };
}
