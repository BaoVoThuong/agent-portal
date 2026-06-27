// Pure validation + invariant enforcement for task updates. Returns a clean
// patch object (only the fields that actually change) or an error. The API route
// applies the patch via Supabase. Permission to mutate the task at all is checked
// separately (canMutateTask); this enforces field-level rules + invariants.
import { canAssign } from "./access";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  WAITING_REASONS,
  type TaskActor,
  type TaskRow,
} from "./types";

export type TaskPatchInput = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  category_id?: unknown;
  agent_email?: unknown;
  status?: unknown;
  assignee_email?: unknown;
  waiting_reason?: unknown;
  position?: unknown;
};

type Current = Pick<TaskRow, "status" | "assignee_email">;
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
  opts?: { canAssign?: boolean }
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
  if (r.priority !== undefined) {
    if (!isEnum(r.priority, TASK_PRIORITIES))
      return { ok: false, error: "Invalid priority." };
    patch.priority = r.priority;
  }
  if (r.category_id !== undefined) {
    patch.category_id =
      typeof r.category_id === "string" && r.category_id.trim() !== ""
        ? r.category_id.trim()
        : null;
  }
  if (r.agent_email !== undefined) {
    patch.agent_email =
      typeof r.agent_email === "string" && r.agent_email.trim() !== ""
        ? r.agent_email.trim()
        : null;
  }
  if (r.position !== undefined) {
    if (typeof r.position !== "number" || !Number.isFinite(r.position))
      return { ok: false, error: "Invalid position." };
    patch.position = r.position;
  }

  // --- status / assignee / waiting_reason are interdependent ---
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

  if (nextStatus === "backlog" && nextAssignee !== null) {
    return { ok: false, error: "Unassign the task before moving it to backlog." };
  }
  if (nextStatus !== "backlog" && nextAssignee === null) {
    return { ok: false, error: "Assign someone before moving out of backlog." };
  }

  if (reassigning) patch.assignee_email = nextAssignee;
  if (r.status !== undefined) patch.status = nextStatus;

  // waiting_reason only meaningful in 'waiting'; otherwise force null when status changes.
  if (r.waiting_reason !== undefined || (r.status !== undefined && current.status === "waiting")) {
    if (nextStatus === "waiting") {
      if (r.waiting_reason !== undefined) {
        if (r.waiting_reason === null) {
          patch.waiting_reason = null;
        } else if (isEnum(r.waiting_reason, WAITING_REASONS)) {
          patch.waiting_reason = r.waiting_reason;
        } else {
          return { ok: false, error: "Invalid waiting reason." };
        }
      }
    } else if (r.waiting_reason !== undefined) {
      // User explicitly provided waiting_reason for non-waiting status
      patch.waiting_reason = null;
    } else if (current.status === "waiting" && r.status !== undefined) {
      // Transitioning away from waiting status
      patch.waiting_reason = null;
    }
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
