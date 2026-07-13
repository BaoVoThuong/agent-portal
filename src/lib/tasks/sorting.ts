import { isTaskOverdue, slaRemainingSeconds } from "./sla";
import {
  TASK_PRIORITIES,
  type TaskPriority,
  type TaskRow,
  type TaskSlaRule,
  type TaskStatus,
} from "./types";

export type SortKey =
  | "title"
  | "status"
  | "priority"
  | "agent"
  | "assignee"
  | "category"
  | "created"
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
  cancel: 5,
};
const ATTENTION_PRIORITY_RANK = Object.fromEntries(
  TASK_PRIORITIES.map((priority, index) => [
    priority,
    TASK_PRIORITIES.length - 1 - index,
  ])
) as Record<TaskPriority, number>;

export const RECENT_ACTIVITY_WINDOW_MS = 24 * 3600_000;

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
      return task.assignees[0]?.toLowerCase() ?? null;
    case "category":
      return categoryName(task.category_id)?.toLowerCase() ?? null;
    case "created":
      return task.created_at;
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

function timestamp(iso: string | null | undefined): number {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function rankTuple(
  task: TaskRow,
  rules: TaskSlaRule[],
  now: Date
): [number, number, number] {
  if (isTaskOverdue(task, rules, now)) {
    return [0, slaRemainingSeconds(task, rules, now), 0];
  }

  const lastActivityMs = timestamp(task.last_activity_at);
  if (
    lastActivityMs > 0 &&
    now.getTime() - lastActivityMs <= RECENT_ACTIVITY_WINDOW_MS
  ) {
    return [1, -lastActivityMs, 0];
  }

  return [
    2,
    ATTENTION_PRIORITY_RANK[task.priority],
    timestamp(task.created_at),
  ];
}

export function compareTaskRank(
  a: TaskRow,
  b: TaskRow,
  rules: TaskSlaRule[],
  now: Date
): number {
  const aRank = rankTuple(a, rules, now);
  const bRank = rankTuple(b, rules, now);

  for (let index = 0; index < aRank.length; index += 1) {
    if (aRank[index] !== bRank[index]) return aRank[index] - bRank[index];
  }

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function rankTasks(
  tasks: TaskRow[],
  rules: TaskSlaRule[],
  now: Date
): TaskRow[] {
  return [...tasks].sort((a, b) => compareTaskRank(a, b, rules, now));
}

const OPEN_STATUSES = new Set<TaskStatus>([
  "backlog",
  "todo",
  "in_progress",
  "waiting",
]);

function timeInStateMs(task: TaskRow, now: Date): number {
  const started =
    task.status === "waiting"
      ? task.waiting_started_at
      : task.status === "todo"
        ? task.todo_started_at
        : task.status === "in_progress"
          ? task.in_progress_at
          : null;

  return started ? Math.max(0, now.getTime() - timestamp(started)) : 0;
}

function hasAssignee(task: TaskRow): boolean {
  return task.assignees.length > 0 || Boolean(task.assignee_email);
}

// Manager/oversight rank: surface work that needs a manager's action first.
// Bands (0 = top): overdue -> unassigned -> stalled -> done-awaiting-QC ->
// recently active -> rest -> closed.
function managerRankTuple(
  task: TaskRow,
  rules: TaskSlaRule[],
  now: Date
): [number, number, number] {
  if (isTaskOverdue(task, rules, now)) {
    return [0, slaRemainingSeconds(task, rules, now), 0];
  }

  const open = OPEN_STATUSES.has(task.status);
  if (open && !hasAssignee(task)) {
    return [1, timestamp(task.created_at), 0];
  }

  const stalled =
    task.status === "waiting" ||
    (task.status === "todo" &&
      (task.priority === "urgent" || task.priority === "high"));
  if (stalled) {
    return [
      2,
      ATTENTION_PRIORITY_RANK[task.priority],
      -timeInStateMs(task, now),
    ];
  }

  if (task.status === "done" && !task.done_reviewed_by_email) {
    return [3, timestamp(task.closed_at), 0];
  }

  const lastActivityMs = timestamp(task.last_activity_at);
  if (
    lastActivityMs > 0 &&
    now.getTime() - lastActivityMs <= RECENT_ACTIVITY_WINDOW_MS
  ) {
    return [4, -lastActivityMs, 0];
  }

  if (open) {
    return [
      5,
      ATTENTION_PRIORITY_RANK[task.priority],
      timestamp(task.created_at),
    ];
  }

  return [6, -timestamp(task.closed_at), 0];
}

export function compareManagerRank(
  a: TaskRow,
  b: TaskRow,
  rules: TaskSlaRule[],
  now: Date
): number {
  const aRank = managerRankTuple(a, rules, now);
  const bRank = managerRankTuple(b, rules, now);

  for (let index = 0; index < aRank.length; index += 1) {
    if (aRank[index] !== bRank[index]) return aRank[index] - bRank[index];
  }

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function rankTasksForManager(
  tasks: TaskRow[],
  rules: TaskSlaRule[],
  now: Date
): TaskRow[] {
  return [...tasks].sort((a, b) => compareManagerRank(a, b, rules, now));
}
