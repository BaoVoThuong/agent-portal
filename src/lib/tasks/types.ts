// Shared types + enum whitelists for the Task Board. Imported by access
// helpers, API routes, and UI. Mirrors the columns in supabase/schema.sql.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "waiting",
  "done",
  "cancel",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Columns shown on the Kanban (Backlog is a separate view, not a Kanban column).
export const KANBAN_STATUSES = [
  "todo",
  "in_progress",
  "waiting",
  "done",
  "cancel",
] as const satisfies readonly TaskStatus[];

// "Overdue" isn't a stored status or a column — it's an SLA state of an
// In Progress task. The board keeps the card in the In Progress column.
export type BoardColumn = (typeof KANBAN_STATUSES)[number];
export const KANBAN_COLUMNS: BoardColumn[] = [...KANBAN_STATUSES];

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  fub_link: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  agent_email: string | null;
  assignees: string[];
  assignee_email: string | null;
  assignee_started_at?: string | null;
  viewer_is_participant?: boolean;
  reporter_email: string;
  todo_started_at: string | null;
  todo_reminded_at: string | null;
  in_progress_at: string | null;
  overdue_flagged_at: string | null;
  waiting_started_at: string | null;
  waiting_reminded_at: string | null;
  overdue_reminded_at: string | null;
  overdue_unlocked_at: string | null;
  due_soon_notified_at: string | null;
  stale_reminded_at: string | null;
  qc_reminded_at: string | null;
  last_activity_at: string | null;
  reopened_at: string | null;
  sla_minutes: number | null;
  overdue_count: number;
  todo_seconds: number;
  in_progress_seconds: number;
  waiting_seconds: number;
  done_reviewed_by_email: string | null;
  done_reviewed_at: string | null;
  closed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TaskSlaRule = {
  id: string;
  priority: TaskPriority;
  category_id: string | null;
  duration_minutes: number;
};

// Derived from the session; the only source of truth for permissions.
export type TaskActor = {
  email: string;
  isManager: boolean;
  isWorker: boolean;
};

export type TaskCategory = { id: string; name: string; color: string | null };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
  cancel: "Cancel",
};

export const BOARD_COLUMN_LABEL: Record<BoardColumn, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
  cancel: "Cancel",
};
