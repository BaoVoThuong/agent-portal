// Shared types + enum whitelists for the Task Board. Imported by access
// helpers, API routes, and UI. Mirrors the columns in supabase/schema.sql.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "waiting",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const WAITING_REASONS = [
  "customer",
  "carrier",
  "documents",
  "other",
] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

// Columns shown on the Kanban (Backlog is a separate view, not a Kanban column).
export const KANBAN_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "waiting",
  "done",
];

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  agent_email: string | null;
  assignee_email: string | null;
  reporter_email: string;
  due_date: string | null;
  waiting_reason: WaitingReason | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
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
};
