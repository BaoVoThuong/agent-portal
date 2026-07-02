// The ONLY place task-board permission/scope decisions are made. Pure functions
// (no I/O) so they are fully unit-tested. API routes call these; the client
// never decides permissions. Identity is by email (no account id in session).
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { TaskActor, TaskRow, TaskStatus } from "./types";

export function buildTaskActor(
  permissions: readonly string[] | undefined,
  email: string
): TaskActor {
  return {
    email,
    isManager: can(permissions, PERMISSIONS.TASK_MANAGE),
    isWorker: can(permissions, PERMISSIONS.TASK_WORK),
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
  return actor.isManager || actor.isWorker;
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
//   isAgentMember – worker belongs to the task's agent team
//   isAgentOwner  – worker is the task's customer agent / final QC owner
//   isParticipant – worker was @mentioned / added as a participant
export function canViewTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: {
    isAssignee?: boolean;
    isAgentMember?: boolean;
    isAgentOwner?: boolean;
    isParticipant?: boolean;
  } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return (
    Boolean(flags.isAssignee) ||
    Boolean(flags.isAgentMember) ||
    Boolean(flags.isAgentOwner) ||
    Boolean(flags.isParticipant)
  );
}

export function canReviewDoneTask(
  actor: TaskActor,
  task: Pick<TaskRow, "agent_email">
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(task.agent_email && task.agent_email === actor.email);
}

export function canAssignToTask(actor: TaskActor, isAgentMember: boolean): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isAgentMember;
}

export function canMutateTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  isAssignee = false
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isAssignee;
}

export function canChangeTaskStatus(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: { isAssignee?: boolean } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAssignee);
}

export function canDeleteTask(actor: TaskActor): boolean {
  return actor.isManager;
}

export type CreateAssignmentInput = {
  assignee_email: string | null;
  status: TaskStatus;
};

export type CreateAssignmentResult =
  | { ok: true; assignee_email: string | null; status: TaskStatus }
  | { ok: false; error: string };

// Enforces the core invariants at creation time:
//  - A worker can only create tasks assigned to themselves, never in backlog.
//  - A backlog task must have no assignee; assigning forces status -> 'todo'.
//  - A non-backlog task must have an assignee.
export function resolveCreateAssignment(
  actor: TaskActor,
  input: CreateAssignmentInput
): CreateAssignmentResult {
  if (!actor.isManager && actor.isWorker) {
    // Worker: always self-assigned, always 'todo'.
    return { ok: true, assignee_email: actor.email, status: "todo" };
  }
  if (!actor.isManager) {
    return { ok: false, error: "Not allowed to create tasks." };
  }

  // Manager.
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
