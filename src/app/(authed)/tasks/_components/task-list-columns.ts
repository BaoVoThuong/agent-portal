import type { SortKey } from "@/lib/tasks/sorting";
import type { TableColumn } from "@/lib/table-config/types";

export type KnownTaskListColumnKey =
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
export type TaskListColumnKey = KnownTaskListColumnKey | (string & {});

export type TaskListColumn = {
  key: TaskListColumnKey;
  label: string;
  sortKey?: SortKey;
  locked?: boolean;
  align?: "center";
  configColumn?: TableColumn;
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
  hiddenKeys: ReadonlySet<TaskListColumnKey>,
  columns: readonly TaskListColumn[] = TASK_LIST_COLUMNS
): TaskListColumn[] {
  return columns.filter(
    (column) => column.locked || !hiddenKeys.has(column.key)
  );
}

export function taskListColumnsFromConfig(
  configuredColumns: readonly TableColumn[] = []
): TaskListColumn[] {
  if (configuredColumns.length === 0) return TASK_LIST_COLUMNS;
  const byKey = new Map(TASK_LIST_COLUMNS.map((column) => [column.key, column]));
  const ordered = configuredColumns
    .filter(
      (column) => column.is_system
        ? byKey.has(column.key as TaskListColumnKey)
        : true
    )
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const next: TaskListColumn[] = [];
  const used = new Set<TaskListColumnKey>();
  for (const configured of ordered) {
    const key = configured.key as TaskListColumnKey;
    const base = byKey.get(key);
    if (configured.is_system) {
      if (!base) continue;
      next.push({ ...base, label: configured.label, configColumn: configured });
    } else {
      next.push({
        key,
        label: configured.label,
        align: configured.type === "checkbox" ? "center" : undefined,
        configColumn: configured,
      });
    }
    used.add(key);
  }
  for (const column of TASK_LIST_COLUMNS) {
    if (!used.has(column.key)) next.push(column);
  }
  return [
    ...next.filter((column) => column.key === "key" || column.key === "summary"),
    ...next.filter((column) => column.key !== "key" && column.key !== "summary"),
  ];
}
