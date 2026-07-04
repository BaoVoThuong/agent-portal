// Shared types + enum whitelists for the Task Board. Imported by access
// helpers, API routes, and UI. Mirrors the columns in supabase/schema.sql.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "cancel",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Columns shown on the Kanban (Backlog is a separate view, not a Kanban column).
export const KANBAN_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
  "cancel",
];

// "Overdue" isn't a stored status — it's an in_progress task past its SLA
// deadline (see lib/tasks/sla.ts). The board still renders it as its own
// column, so this is the UI-level column list, separate from TaskStatus.
export type BoardColumn = "todo" | "in_progress" | "overdue" | "done" | "cancel";
export const KANBAN_COLUMNS: BoardColumn[] = [
  "todo",
  "in_progress",
  "overdue",
  "done",
  "cancel",
];

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
  reporter_email: string;
  in_progress_at: string | null;
  done_reviewed_by_email: string | null;
  done_reviewed_at: string | null;
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
  done: "Done",
  cancel: "Cancel",
};

export const BOARD_COLUMN_LABEL: Record<BoardColumn, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  overdue: "Overdue",
  done: "Done",
  cancel: "Cancel",
};
