// Shared types + enum whitelists for the Task Board. Imported by access
// helpers, API routes, and UI. Mirrors the columns in supabase/schema.sql.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "waiting",
  "billing",
  "done",
  "cancel",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Columns shown on the Kanban (Backlog is a separate view, not a Kanban column).
//
// Cancel is deliberately ABSENT while remaining a perfectly valid TaskStatus.
// It stays reachable from the status dropdown and keeps its own stage history;
// it just no longer earns a permanent column on a board where it was always
// empty. Because BoardColumn is derived from this list, the compiler now
// forces every board-side consumer to say what it does with a cancelled task
// rather than silently assuming one column per status.
export const KANBAN_STATUSES = [
  "todo",
  "in_progress",
  "waiting",
  "billing",
  "done",
] as const satisfies readonly TaskStatus[];

// "Overdue" isn't a stored status or a column — it's an SLA state of an
// In Progress task. The board keeps the card in the In Progress column.
export type BoardColumn = (typeof KANBAN_STATUSES)[number];
export const KANBAN_COLUMNS: BoardColumn[] = [...KANBAN_STATUSES];

export type TaskRow = {
  id: string;
  display_number?: number | null;
  title: string;
  description: string | null;
  fub_link: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  custom_values?: Record<string, unknown>;
  agent_email: string | null;
  assignees: string[];
  assignee_email: string | null;
  assignee_started_at?: string | null;
  viewer_is_participant?: boolean;
  reporter_email: string;
  last_activity_by_email?: string | null;
  comment_count?: number;
  attachment_count?: number;
  todo_started_at: string | null;
  todo_reminded_at: string | null;
  in_progress_at: string | null;
  overdue_flagged_at: string | null;
  waiting_started_at: string | null;
  waiting_reminded_at: string | null;
  billing_started_at: string | null;
  billing_reminded_at: string | null;
  overdue_reminded_at: string | null;
  overdue_unlocked_at: string | null;
  due_soon_notified_at: string | null;
  /** Lần đầu phát hiện vỡ hạn Due Date. Trigger xoá về null khi due_date đổi. */
  due_overdue_flagged_at?: string | null;
  /** Lần nhắc gần nhất; nhắc lại mỗi 24 giờ tới khi task xong. */
  due_overdue_reminded_at?: string | null;
  stale_reminded_at: string | null;
  qc_reminded_at: string | null;
  last_activity_at: string | null;
  reopened_at: string | null;
  sla_minutes: number | null;
  overdue_count: number;
  todo_seconds: number;
  in_progress_seconds: number;
  waiting_seconds: number;
  billing_seconds: number;
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
  /**
   * Nút bật/tắt của tổ hợp category × priority này.
   *
   * BẬT  → chọn được khi tạo/sửa task, và đặt được thời hạn SLA.
   * TẮT  → không đặt được thời hạn, và không chọn được tổ hợp đó.
   *
   * Trước 2026-09-11, "tắt" được ghi bằng cách đặt SLA đúng 5 phút — một quy ước
   * ngầm không chặn được gì (task vẫn tạo được rồi 5 phút sau quá hạn thật).
   *
   * Optional vì bản ghi cũ chưa có cột; thiếu thì hiểu là ĐANG BẬT.
   */
  is_enabled?: boolean;
  updated_at?: string | null;
};

// Dựng từ grant của principal (`taskActorFromGrants`). Mọi quyết định đọc
// `grants`; hai cờ boolean chỉ là tóm tắt cho đường truy vấn và UI.
export type TaskActor = {
  email: string;
  /** Grant hiệu lực `action:scope` — nguồn duy nhất của quyết định. */
  grants: readonly string[];
  /** `task.read:all`: xem mọi task. */
  isManager: boolean;
  /** `task.read` ở bất kỳ scope nào: vào được board. */
  isWorker: boolean;
};

export type TaskCategory = { id: string; name: string; color: string | null };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  billing: "Billing",
  done: "Done",
  cancel: "Cancel",
};

export const BOARD_COLUMN_LABEL: Record<BoardColumn, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  billing: "Billing",
  done: "Done",
};
