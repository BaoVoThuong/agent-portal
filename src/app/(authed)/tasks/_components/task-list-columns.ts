import type { SortKey } from "@/lib/tasks/sorting";

export type TaskListColumnKey =
  | "key"
  | "id"
  | "assignee"
  | "primaryAssignee"
  | "assignedAt"
  | "agent"
  | "summary"
  | "description"
  | "category"
  | "reporter"
  | "created"
  | "updated"
  | "activity"
  | "activityBy"
  | "comments"
  | "attachments"
  | "fub"
  | "sla"
  | "slaRemaining"
  | "overdueCount"
  | "todoTime"
  | "progressTime"
  | "waitingTime"
  | "todoStarted"
  | "progressStarted"
  | "waitingStarted"
  | "dueSoonNotified"
  | "todoReminded"
  | "waitingReminded"
  | "overdueFlagged"
  | "overdueReminded"
  | "overdueUnlocked"
  | "staleReminded"
  | "qcReminded"
  | "reopened"
  | "closed"
  | "reviewedBy"
  | "reviewedAt"
  | "position"
  | "priority"
  | "status"
  | "review";

export type TaskListColumn = {
  key: TaskListColumnKey;
  label: string;
  sortKey?: SortKey;
  locked?: boolean;
  align?: "center";
};

export const TASK_LIST_COLUMNS: TaskListColumn[] = [
  { key: "key", label: "Key", sortKey: "key", locked: true },
  { key: "summary", label: "Task", sortKey: "title", locked: true },
  { key: "assignee", label: "Assignee", sortKey: "assignee" },
  { key: "category", label: "Category", sortKey: "category" },
  { key: "status", label: "Stage", sortKey: "status" },
  { key: "priority", label: "Priority", sortKey: "priority" },
  { key: "slaRemaining", label: "Time Progress" },
  { key: "agent", label: "Agent", sortKey: "agent" },
  { key: "reporter", label: "Opened by", sortKey: "reporter" },
  { key: "created", label: "Created date", sortKey: "created" },
  { key: "activity", label: "Last activity", sortKey: "lastActivity" },
  { key: "review", label: "QC", align: "center" },
];

export const TASK_LIST_DEFAULT_VISIBLE_COLUMN_KEYS = new Set<TaskListColumnKey>([
  "key",
  "summary",
  "assignee",
  "category",
  "status",
  "priority",
  "slaRemaining",
  "agent",
  "reporter",
  "created",
  "activity",
  "review",
]);

export const TASK_LIST_COLUMN_KEYS = new Set(
  TASK_LIST_COLUMNS.map((column) => column.key)
);

export const TASK_LIST_LOCKED_COLUMN_KEYS = new Set(
  TASK_LIST_COLUMNS.filter((column) => column.locked).map((column) => column.key)
);

export const TASK_LIST_DEFAULT_HIDDEN_COLUMN_KEYS = new Set<TaskListColumnKey>(
  TASK_LIST_COLUMNS.filter(
    (column) =>
      !column.locked && !TASK_LIST_DEFAULT_VISIBLE_COLUMN_KEYS.has(column.key)
  ).map((column) => column.key)
);

export function visibleTaskListColumns(
  hiddenKeys: ReadonlySet<TaskListColumnKey>
): TaskListColumn[] {
  return TASK_LIST_COLUMNS.filter(
    (column) => column.locked || !hiddenKeys.has(column.key)
  );
}
