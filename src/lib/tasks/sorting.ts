import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export type SortKey =
  | "title"
  | "status"
  | "priority"
  | "agent"
  | "assignee"
  | "category"
  | "due"
  | "updated"
  | "key";
export type SortDir = "asc" | "desc";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};
const STATUS_RANK: Record<TaskStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  waiting: 3,
  done: 4,
};

// Deterministic display key, matching the one shown on cards.
export function taskKey(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) % 900;
  }
  return `TASK-${hash + 100}`;
}

// A comparable value for a task on a given key. `null` => sorts last.
function sortValue(
  task: TaskRow,
  key: SortKey,
  categoryName: (id: string | null) => string | null
): string | number | null {
  switch (key) {
    case "title":
      return task.title.toLowerCase();
    case "status":
      return STATUS_RANK[task.status];
    case "priority":
      return PRIORITY_RANK[task.priority];
    case "agent":
      return task.agent_email?.toLowerCase() ?? null;
    case "assignee":
      return task.assignee_email?.toLowerCase() ?? null;
    case "category":
      return categoryName(task.category_id)?.toLowerCase() ?? null;
    case "due":
      return task.due_date ?? null;
    case "updated":
      return task.updated_at;
    case "key":
      return taskKey(task.id);
  }
}

export function sortTasks(
  tasks: TaskRow[],
  key: SortKey,
  dir: SortDir,
  categoryName: (id: string | null) => string | null = () => null
): TaskRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const av = sortValue(a, key, categoryName);
    const bv = sortValue(b, key, categoryName);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last regardless of direction
    if (bv === null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}
