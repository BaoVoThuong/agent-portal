import type { TaskActivityType } from "@/lib/tasks/activity-events";

/**
 * Every value accepted by task_activity has one human-readable renderer
 * label. Dynamic values (status, priority, assignment) add their target in
 * ActivityFeed; this map keeps vocabulary coverage testable without JSX.
 */
export const ACTIVITY_LABELS: Record<TaskActivityType, string> = {
  created: "created the task",
  assigned: "assigned to",
  unassigned: "removed from the task",
  status_changed: "moved to",
  reopened: "reopened",
  task_reopened: "reopened this task (with a reason)",
  priority_changed: "set priority",
  category_changed: "changed category",
  agent_changed: "changed agent to",
  done_reviewed: "QC checked the completed task",
  done_review_cleared: "cleared the QC check",
  edited: "edited the task",
  comment_added: "commented",
  comment_edited: "edited a comment",
  comment_deleted: "deleted a comment",
  attachment_added: "attached a file",
  attachment_deleted: "removed a file",
  went_overdue: "task went overdue",
  overdue_unlocked: "unlocked an overdue task",
};
