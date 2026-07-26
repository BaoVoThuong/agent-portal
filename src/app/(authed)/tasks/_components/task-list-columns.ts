import type { SortKey } from "@/lib/tasks/sorting";

export type TaskListColumnKey =
  | "key"
  | "assignee"
  | "summary"
  | "category"
  | "created"
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
  { key: "assignee", label: "Assignee", sortKey: "assignee" },
  { key: "summary", label: "Summary", sortKey: "title", locked: true },
  { key: "category", label: "Category", sortKey: "category" },
  { key: "created", label: "Created", sortKey: "created" },
  { key: "priority", label: "Priority", sortKey: "priority", align: "center" },
  { key: "status", label: "Status", sortKey: "status", align: "center" },
  { key: "review", label: "QC", align: "center" },
];

export const TASK_LIST_COLUMN_KEYS = new Set(
  TASK_LIST_COLUMNS.map((column) => column.key)
);

export const TASK_LIST_LOCKED_COLUMN_KEYS = new Set(
  TASK_LIST_COLUMNS.filter((column) => column.locked).map((column) => column.key)
);

export function visibleTaskListColumns(
  hiddenKeys: ReadonlySet<TaskListColumnKey>
): TaskListColumn[] {
  return TASK_LIST_COLUMNS.filter(
    (column) => column.locked || !hiddenKeys.has(column.key)
  );
}
