// Pure validation + invariant enforcement for task updates. Returns a clean
// patch object (only the fields that actually change) or an error. The API route
// applies the patch via Supabase. Permission to edit full fields vs. status-only
// is checked separately; this enforces field-level shape + invariants.
import { canAssign } from "./access";
import { resolveSlaMinutes } from "./sla";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskActor,
  type TaskRow,
  type TaskSlaRule,
} from "./types";

export type TaskPatchInput = {
  title?: unknown;
  description?: unknown;
  fub_link?: unknown;
  priority?: unknown;
  category_id?: unknown;
  agent_email?: unknown;
  status?: unknown;
  assignee_email?: unknown;
  done_reviewed?: unknown;
  position?: unknown;
};

type Current = Pick<TaskRow, "status" | "assignee_email" | "in_progress_at"> & {
  priority?: TaskRow["priority"];
  category_id?: TaskRow["category_id"];
  // Stage clock state — needed to bank the leaving stage's seconds and to
  // lock the SLA budget only on the first-ever In Progress entry.
  todo_started_at?: string | null;
  waiting_started_at?: string | null;
  todo_seconds?: number | null;
  in_progress_seconds?: number | null;
  waiting_seconds?: number | null;
  sla_minutes?: number | null;
};
type Result =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

function isEnum<T extends readonly string[]>(v: unknown, allowed: T): v is T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

function elapsedSeconds(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

function bankWaitingSeconds(
  currentSeconds: number | null | undefined,
  startedAt: string | null | undefined,
  nowIso: string
): number {
  const base = currentSeconds ?? 0;
  const elapsed = startedAt ? elapsedSeconds(startedAt, nowIso) : 0;
  // Besides elapsed time, this is also the durable marker that the task has
  // entered Waiting at least once. Keep it > 0 even for legacy/null starts or
  // immediate Waiting -> In Progress moves.
  return Math.max(1, base + elapsed);
}

export function resolveTaskPatch(
  actor: TaskActor,
  current: Current,
  raw: unknown,
  opts?: {
    canAssign?: boolean;
    canReviewDone?: boolean;
    nowIso?: string;
    rules?: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[];
  }
): Result {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body." };
  const r = raw as TaskPatchInput;
  const patch: Record<string, unknown> = {};

  if (r.title !== undefined) {
    if (typeof r.title !== "string" || r.title.trim() === "")
      return { ok: false, error: "Title is required." };
    patch.title = r.title.trim();
  }
  if (r.description !== undefined) {
    patch.description =
      typeof r.description === "string" && r.description.trim() !== ""
        ? r.description.trim()
        : null;
  }
  if (r.fub_link !== undefined) {
    patch.fub_link =
      typeof r.fub_link === "string" && r.fub_link.trim() !== ""
        ? r.fub_link.trim()
        : null;
  }
  if (r.priority !== undefined) {
    if (!isEnum(r.priority, TASK_PRIORITIES))
      return { ok: false, error: "Invalid priority." };
    patch.priority = r.priority;
  }
  if (r.category_id !== undefined) {
    if (typeof r.category_id !== "string" || r.category_id.trim() === "") {
      return { ok: false, error: "Category is required." };
    }
    patch.category_id = r.category_id.trim();
  }
  if (r.agent_email !== undefined) {
    if (typeof r.agent_email !== "string" || r.agent_email.trim() === "") {
      return { ok: false, error: "Agent is required." };
    }
    patch.agent_email = r.agent_email.trim();
  }
  if (r.position !== undefined) {
    if (typeof r.position !== "number" || !Number.isFinite(r.position))
      return { ok: false, error: "Invalid position." };
    patch.position = r.position;
  }

  // --- status / assignee are interdependent ---
  const reassigning = r.assignee_email !== undefined;
  const mayAssign = opts?.canAssign ?? canAssign(actor);
  if (reassigning && !mayAssign) {
    return { ok: false, error: "You cannot reassign tasks." };
  }
  if (r.status !== undefined && !isEnum(r.status, TASK_STATUSES)) {
    return { ok: false, error: "Invalid status." };
  }

  const nextAssignee = reassigning
    ? (typeof r.assignee_email === "string" && r.assignee_email.trim() !== ""
        ? r.assignee_email.trim()
        : null)
    : current.assignee_email;
  const nextStatus = (r.status as TaskRow["status"]) ?? current.status;
  const statusChanged = r.status !== undefined && nextStatus !== current.status;
  const isTerminalReopen = current.status === "done" || current.status === "cancel";
  const nowIso = opts?.nowIso ?? new Date().toISOString();

  if (nextStatus === "backlog" && nextAssignee !== null) {
    return { ok: false, error: "Unassign the task before moving it to backlog." };
  }
  if (nextStatus !== "backlog" && nextAssignee === null) {
    return { ok: false, error: "Assign someone before moving out of backlog." };
  }
  // Leaving Done/Cancelled for ANY other status restarts the SLA clock and
  // needs a reason — that only happens through POST /api/tasks/[id]/reopen,
  // never this generic patch. Blocking only the in_progress target would
  // leave Done/Cancel -> To Do (or Cancel -> Done) as an unaudited bypass
  // with no reason and no task_reopened log entry, even though the UI has
  // no button for it.
  if (statusChanged && isTerminalReopen) {
    return {
      ok: false,
      error: "Reopening a Done/Cancelled task needs a reason — use the Reopen action.",
    };
  }
  // Overdue only ever applies to a task that has active In Progress work —
  // skipping straight from To Do/Backlog to Done means no SLA window ever ran,
  // so the task could never be overdue no matter how long it actually sat
  // unworked. Allow Done only once it has spent (or is spending) time In
  // Progress. Cancel is left unrestricted: cancelling
  // something that was never started isn't a completed-work claim.
  const hasBeenInProgress =
    Boolean(current.in_progress_at) || (current.in_progress_seconds ?? 0) > 0;
  if (
    statusChanged &&
    nextStatus === "todo" &&
    current.status !== "todo" &&
    hasBeenInProgress
  ) {
    return {
      ok: false,
      error: "A task that has started cannot move back to To Do.",
    };
  }
  if (statusChanged && nextStatus === "done" && !hasBeenInProgress) {
    return {
      ok: false,
      error: "Move the task to In Progress before marking it Done.",
    };
  }

  if (reassigning) patch.assignee_email = nextAssignee;
  if (r.status !== undefined) patch.status = nextStatus;
  if (statusChanged) {
    patch.done_reviewed_by_email = null;
    patch.done_reviewed_at = null;
  }

  // --- Stage clocks: bank the leaving stage's seconds, then open the new one.
  // Each stage's cumulative time lives in *_seconds; *_started_at marks only
  // the current open stint and is cleared on leave. This is what makes the
  // clocks consistent for history/KPI. Active SLA overdue is measured from the
  // current In Progress stint only until the task first enters Waiting.
  if (statusChanged) {
    if (current.status === "todo" && current.todo_started_at) {
      patch.todo_seconds =
        (current.todo_seconds ?? 0) + elapsedSeconds(current.todo_started_at, nowIso);
      patch.todo_started_at = null;
    } else if (current.status === "in_progress" && current.in_progress_at) {
      patch.in_progress_seconds =
        (current.in_progress_seconds ?? 0) + elapsedSeconds(current.in_progress_at, nowIso);
      patch.in_progress_at = null;
    } else if (current.status === "waiting") {
      patch.waiting_seconds = bankWaitingSeconds(
        current.waiting_seconds,
        current.waiting_started_at,
        nowIso
      );
      patch.waiting_started_at = null;
    }
  }

  if (statusChanged && nextStatus === "todo") {
    patch.todo_started_at = nowIso;
    patch.todo_reminded_at = null;
  }

  if (statusChanged && nextStatus === "in_progress") {
    patch.in_progress_at = nowIso;
    patch.overdue_flagged_at = null;
    patch.overdue_reminded_at = null;
    patch.overdue_unlocked_at = null;
    patch.due_soon_notified_at = null;
    // Lock the SLA budget on the FIRST-ever In Progress entry only. Re-entries
    // keep the original budget so editing priority later can't move work that
    // has already started. After Waiting, In Progress remains plain effort
    // tracking and does not open another active SLA window.
    if (current.sla_minutes == null && opts?.rules && current.priority !== undefined) {
      const nextPriority = (patch.priority as TaskRow["priority"] | undefined) ?? current.priority;
      const nextCategoryId =
        "category_id" in patch
          ? (patch.category_id as string | null)
          : (current.category_id ?? null);
      patch.sla_minutes = resolveSlaMinutes(nextPriority, nextCategoryId, opts.rules);
    }
  }

  if (statusChanged && nextStatus === "waiting") {
    patch.waiting_started_at = nowIso;
    patch.waiting_reminded_at = null;
  } else if (statusChanged && current.status === "waiting") {
    patch.waiting_reminded_at = null;
  }

  if (statusChanged && (nextStatus === "done" || nextStatus === "cancel")) {
    patch.closed_at = nowIso;
  } else if (statusChanged && (current.status === "done" || current.status === "cancel")) {
    patch.closed_at = null;
  }

  if (r.done_reviewed !== undefined) {
    if (typeof r.done_reviewed !== "boolean") {
      return { ok: false, error: "Invalid QC review value." };
    }
    if (!opts?.canReviewDone) {
      return { ok: false, error: "You cannot QC check this task." };
    }
    if (nextStatus !== "done") {
      return { ok: false, error: "Only done tasks can be QC checked." };
    }
    patch.done_reviewed_by_email = r.done_reviewed ? actor.email : null;
    patch.done_reviewed_at = r.done_reviewed ? nowIso : null;
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
