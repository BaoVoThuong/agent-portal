// One vocabulary for task_activity, shared by SQL, mutation routes, and the
// activity renderer. Unknown historical rows remain renderable as unknown.
export const ALLOWED_TASK_ACTIVITY_TYPES = [
  "created",
  "assigned",
  "unassigned",
  "status_changed",
  "reopened",
  "task_reopened",
  "priority_changed",
  "category_changed",
  "agent_changed",
  "done_reviewed",
  "done_review_cleared",
  "edited",
  "comment_added",
  "comment_edited",
  "comment_deleted",
  "attachment_added",
  "attachment_deleted",
  "went_overdue",
  "overdue_unlocked",
] as const;

export type TaskActivityType = (typeof ALLOWED_TASK_ACTIVITY_TYPES)[number];
const ALLOWED = new Set<string>(ALLOWED_TASK_ACTIVITY_TYPES);

export function isKnownActivityType(type: string): type is TaskActivityType {
  return ALLOWED.has(type);
}

export type TaskActivityEvent =
  | { type: "created"; meta: { assignees?: string[] } | null }
  | { type: "assigned"; meta: { to: string | null } }
  | { type: "unassigned"; meta: { removed: string; next_primary: string | null } }
  | { type: "comment_added"; meta: { comment_id: string; parent_id: string | null } }
  | { type: "comment_edited"; meta: { comment_id: string } }
  | { type: "comment_deleted"; meta: { comment_id: string; attachment_count: number } }
  | { type: "attachment_added"; meta: { attachment_id: string; comment_id: string | null } }
  | { type: "attachment_deleted"; meta: { attachment_id: string; comment_id: string | null } }
  | {
      type: Exclude<TaskActivityType,
        | "created"
        | "assigned"
        | "unassigned"
        | "comment_added"
        | "comment_edited"
        | "comment_deleted"
        | "attachment_added"
        | "attachment_deleted">;
      meta: Record<string, unknown> | null;
    };
