// The ONLY place task-board permission/scope decisions are made. Pure functions
// (no I/O) so they are fully unit-tested. API routes enforce these decisions,
// and the client uses the same resolver to render matching controls.
//
// Mọi quyết định đọc GRANT của actor (`action:scope`, audit 2026-09-25 §9) qua
// `scopeMatches`: có grant ở `all`, hoặc ở một scope mà quan hệ tương ứng đúng
// với task này. Role chưa chuyển sang grant nhận grant tương thích
// (`authz/compat.ts`), nên quyết định giữ nguyên như trước — xem test đối chiếu
// với bản đóng băng `authz/legacy/task-access.ts`.
//
// The company-queue rule that plain-CS see every task is the `shared_queue`
// scope, fed by the `seesAllTasks` flag (resolveTaskQueueScope). Identity is by
// email.
import type { Action } from "@/lib/authz/catalog";
import { hasGrant, scopeMatches, type RelationFacts } from "@/lib/authz/grants";
import type { TaskActor, TaskRow, TaskStatus } from "./types";

export function taskActorFromGrants(email: string, grants: readonly string[]): TaskActor {
  return {
    email,
    grants,
    isManager: hasGrant(grants, "task.read", "all"),
    isWorker: hasGrant(grants, "task.read"),
  };
}

/** Có `action` ở scope `all` — dùng để bỏ qua các truy vấn quan hệ không cần. */
export function holdsTaskScopeAll(actor: TaskActor, action: Action): boolean {
  return hasGrant(actor.grants, action, "all");
}

const TASK_RELATION_ACTIONS: readonly Action[] = [
  "task.read",
  "task.content.update",
  "task.due_date.update",
  "task.status.update",
  "task.assign",
  "task.delete",
  "task.qc_review",
  "task.activity.read",
];

/**
 * Có scope `all` cho MỌI action theo quan hệ, nên mọi capability đều đúng mà
 * không cần tra quan hệ nào. Chỉ dùng cho đường tắt tính capability; role chỉ
 * có một phần `all` phải đi đường tra quan hệ đầy đủ.
 */
export function holdsAllTaskScopes(actor: TaskActor): boolean {
  return TASK_RELATION_ACTIONS.every((action) => holdsTaskScopeAll(actor, action));
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim().toLowerCase() ?? "";
  return left !== "" && left === (b?.trim().toLowerCase() ?? "");
}

// Extra ways a worker relates to one task, resolved by the caller:
//   isAssignee    – caller already resolved assignment externally
//   isAgentMember – worker is a promoted Assistant of the task's agent
//   isAgentOwner  – worker is the task's agent, OR an Assistant of that agent
//                   (isAgentOwnerOrAssistant)
//   isParticipant – worker was @mentioned / added as a participant
//   isReporter    – worker created/reported the task
//   seesAllTasks  – plain-CS company-wide queue (resolveTaskQueueScope). Only
//                   actions granted at `shared_queue` read it (view, due date),
//                   so the queue never grants other edits.
export type TaskMembershipFlags = {
  isAssignee?: boolean;
  isAgentOwner?: boolean;
  isAgentMember?: boolean;
  isReporter?: boolean;
  isParticipant?: boolean;
  seesAllTasks?: boolean;
};

/**
 * `agent_email` tách `isAgentOwner` thành hai scope: chính agent
 * (`agent_owned`) hay assistant của agent (`assistant_for_agent`). Người gọi
 * không truyền `agent_email` thì coi như cả hai — grant tương thích luôn có đủ
 * hai scope nên quyết định cũ không đổi.
 */
export type TaskRef = Pick<TaskRow, "assignee_email"> & { agent_email?: string | null };

export function taskRelationFacts(
  actor: TaskActor,
  task: TaskRef,
  flags: TaskMembershipFlags = {}
): RelationFacts {
  const knowsAgent = task.agent_email !== undefined;
  const isAgentSelf = knowsAgent ? sameEmail(task.agent_email, actor.email) : true;
  const isAssistantOfAgent = knowsAgent ? !isAgentSelf : true;
  const owner = Boolean(flags.isAgentOwner);
  return {
    assigned: Boolean(flags.isAssignee),
    reported: Boolean(flags.isReporter),
    participating: Boolean(flags.isParticipant),
    agent_owned: owner && isAgentSelf,
    assistant_for_agent: (owner && isAssistantOfAgent) || Boolean(flags.isAgentMember),
    shared_queue: Boolean(flags.seesAllTasks),
  };
}

function ownerFacts(isAgentOwner: boolean): RelationFacts {
  return { agent_owned: isAgentOwner, assistant_for_agent: isAgentOwner };
}

export function canAccessBoard(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.read");
}

// Backlog (unassigned work).
export function canSeeBacklog(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.backlog.read");
}

/** Tạo task cho bất kỳ agent nào. */
export function canCreateTask(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.create", "all");
}

/** Tạo task: mọi agent, hoặc agent mình là chính agent / assistant. */
export function canCreateTaskWithScope(
  actor: TaskActor,
  hasAgentScope = false
): boolean {
  return scopeMatches(actor.grants, "task.create", ownerFacts(hasAgentScope));
}

/** Giao task bất kỳ (hàng đợi, bulk). Giao trên một task cụ thể: canAssignToTask. */
export function canAssign(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.assign", "all");
}

/** Category, SLA, nhắc việc, hàng đợi giao tự động. */
export function canManageTaskConfig(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.config.manage");
}

export function canManageCategories(actor: TaskActor): boolean {
  return canManageTaskConfig(actor);
}

/** Overview workload của mọi người. */
export function canReadTaskOverview(actor: TaskActor): boolean {
  return hasGrant(actor.grants, "task.overview.read");
}

export function canViewTask(
  actor: TaskActor,
  task: TaskRef,
  flags: TaskMembershipFlags = {}
): boolean {
  return scopeMatches(actor.grants, "task.read", taskRelationFacts(actor, task, flags));
}

export function canReviewDoneTask(
  actor: TaskActor,
  flags: { isAgentOwner?: boolean } = {}
): boolean {
  return scopeMatches(actor.grants, "task.qc_review", ownerFacts(Boolean(flags.isAgentOwner)));
}

// Assign/reassign on one task. CS assignees are a company pool, so Agent Groups
// does not restrict who can be assigned.
export function canAssignToTask(actor: TaskActor, isAgentOwner: boolean): boolean {
  return scopeMatches(actor.grants, "task.assign", ownerFacts(isAgentOwner));
}

// Content edit (title/description/priority/category/agent/fub_link, plus
// task-level attachment uploads).
export function canMutateTask(
  actor: TaskActor,
  task: TaskRef,
  flags: { isAgentOwner?: boolean; isReporter?: boolean } = {}
): boolean {
  return scopeMatches(
    actor.grants,
    "task.content.update",
    taskRelationFacts(actor, task, {
      isAgentOwner: flags.isAgentOwner,
      isReporter: flags.isReporter,
    })
  );
}

/**
 * Sửa Due Date. Từ 2026-09-04 ai xem được task thì dời được hạn (grant tương
 * thích cấp `task.due_date.update` ở đúng các scope của `task.read`). Giữ action
 * riêng: chỗ gác trong route và ô nhập trên UI vẫn nói rõ chúng hỏi về Due Date,
 * nên nếu quyền tách ra thì chỉ đổi grant của role.
 */
export function canEditTaskDueDate(
  actor: TaskActor,
  task: TaskRef,
  flags: TaskMembershipFlags = {}
): boolean {
  return scopeMatches(
    actor.grants,
    "task.due_date.update",
    taskRelationFacts(actor, task, flags)
  );
}

// Status transitions (kanban move, position), overdue-unlock, and reopening
// a Done/Cancel task.
export function canChangeTaskStatus(
  actor: TaskActor,
  task: TaskRef,
  flags: {
    isAssignee?: boolean;
    isAgentOwner?: boolean;
  } = {}
): boolean {
  return scopeMatches(
    actor.grants,
    "task.status.update",
    taskRelationFacts(actor, task, {
      isAssignee: flags.isAssignee,
      isAgentOwner: flags.isAgentOwner,
    })
  );
}

export function canDeleteTask(actor: TaskActor, isAgentOwner = false): boolean {
  return scopeMatches(actor.grants, "task.delete", ownerFacts(isAgentOwner));
}

/** Xem activity log của task. */
export function canReadTaskActivity(actor: TaskActor, isAgentOwner: boolean): boolean {
  return scopeMatches(actor.grants, "task.activity.read", ownerFacts(isAgentOwner));
}

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
  task: TaskRef,
  flags: TaskMembershipFlags = {}
): TaskCapabilities {
  const changeStatus = canChangeTaskStatus(actor, task, {
    isAssignee: flags.isAssignee,
    isAgentOwner: flags.isAgentOwner,
  });

  return {
    canView: canViewTask(actor, task, flags),
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
    canEditDueDate: canEditTaskDueDate(actor, task, flags),
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
//  - Whoever may create the task (canCreateTaskWithScope) gets free choice from
//    the company CS pool, or backlog.
//  - A backlog task must have no assignee; assigning forces status -> 'todo'.
//  - A non-backlog task must have an assignee.
export function resolveCreateAssignment(
  actor: TaskActor,
  input: CreateAssignmentInput,
  opts?: { hasAgentScope?: boolean }
): CreateAssignmentResult {
  if (!canCreateTaskWithScope(actor, Boolean(opts?.hasAgentScope))) {
    return { ok: false, error: "Not allowed to create tasks." };
  }

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
