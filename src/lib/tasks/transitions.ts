// Pure validation + invariant enforcement for task updates. Returns a clean
// patch object (only the fields that actually change) or an error. The API route
// applies the patch via Supabase. Permission to edit full fields vs. status-only
// is checked separately; this enforces field-level shape + invariants.
import { canAssign } from "./access";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskActor, type TaskRow } from "./types";

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

type Current = Pick<TaskRow, "status" | "assignee_email" | "in_progress_at">;
type Result =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

function isEnum<T extends readonly string[]>(v: unknown, allowed: T): v is T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

export function resolveTaskPatch(
  actor: TaskActor,
  current: Current,
  raw: unknown,
  opts?: { canAssign?: boolean; canReviewDone?: boolean; nowIso?: string }
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

  if (nextStatus === "backlog" && nextAssignee !== null) {
    return { ok: false, error: "Unassign the task before moving it to backlog." };
  }
  if (nextStatus !== "backlog" && nextAssignee === null) {
    return { ok: false, error: "Assign someone before moving out of backlog." };
  }
  // Reopening a Done/Cancelled task restarts the SLA clock, so it always
  // needs a reason — that only happens through POST /api/tasks/[id]/reopen,
  // never this generic patch (otherwise a plain drag-and-drop would silently
  // reset the clock with no audit trail and no permission check beyond
  // canChangeTaskStatus, which includes the assignee).
  if (statusChanged && nextStatus === "in_progress" && isTerminalReopen) {
    return {
      ok: false,
      error: "Reopening a Done/Cancelled task needs a reason — use the Reopen action.",
    };
  }

  if (reassigning) patch.assignee_email = nextAssignee;
  if (r.status !== undefined) patch.status = nextStatus;
  if (statusChanged) {
    patch.done_reviewed_by_email = null;
    patch.done_reviewed_at = null;
  }
  // Stamp the SLA clock only on the very first start. Bouncing through To Do
  // and back does NOT restart it: otherwise the assignee (who is allowed to
  // change status) could reset their own overdue clock for free just by
  // toggling status, which defeats using overdue as a KPI signal. Reopening
  // from Done/Cancel is handled entirely by the /reopen endpoint above.
  if (statusChanged && nextStatus === "in_progress" && !current.in_progress_at) {
    patch.in_progress_at = opts?.nowIso ?? new Date().toISOString();
    patch.overdue_flagged_at = null;
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
    patch.done_reviewed_at = r.done_reviewed
      ? opts.nowIso ?? new Date().toISOString()
      : null;
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
