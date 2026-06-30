import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export const ALL_AGENTS = "__all_agents__";
export const NO_AGENT = "__no_agent__";
// Assignee facet. "" = all; this sentinel = unassigned.
export const NO_ASSIGNEE = "__no_assignee__";

export type QuickFilter =
  | "highPriority"
  | "recentlyUpdated"
  | "mine"
  | "triage";

export type FilterCriteria = {
  query: string;
  agent: string;
  assignee?: string;
  quick: QuickFilter[];
  priority?: "" | TaskPriority;
  category: "" | string;
  status: "" | TaskStatus;
  dateFrom?: string;
  dateTo?: string;
  currentEmail: string;
  now?: Date;
  searchText?: (task: TaskRow) => string;
};

function defaultSearchText(task: TaskRow): string {
  return [
    task.title,
    task.description,
    task.fub_link,
    task.agent_email,
    task.assignees.join(" "),
    task.reporter_email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuick(
  task: TaskRow,
  filter: QuickFilter,
  currentEmail: string,
  now: Date
): boolean {
  switch (filter) {
    case "highPriority":
      return task.priority === "high" || task.priority === "urgent";
    case "recentlyUpdated": {
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 3);
      return new Date(task.updated_at) >= cutoff;
    }
    case "mine":
      return (
        task.assignees.includes(currentEmail) ||
        task.reporter_email === currentEmail
      );
    case "triage":
      return !task.category_id || !task.agent_email;
  }
}

export function filterTasks(tasks: TaskRow[], c: FilterCriteria): TaskRow[] {
  const now = c.now ?? new Date();
  const query = c.query.trim().toLowerCase();
  const searchText = c.searchText ?? defaultSearchText;
  const dateFrom = normalizeDateKey(c.dateFrom);
  const dateTo = normalizeDateKey(c.dateTo);

  return tasks.filter((task) => {
    if (!matchesDateWindow(task, dateFrom, dateTo)) return false;
    if (
      c.agent === NO_AGENT
        ? !!task.agent_email
        : c.agent !== ALL_AGENTS && task.agent_email !== c.agent
    ) {
      return false;
    }
    if (c.assignee) {
      if (c.assignee === NO_ASSIGNEE) {
        if (task.assignees.length > 0) return false;
      } else if (!task.assignees.includes(c.assignee)) {
        return false;
      }
    }
    if (c.priority && task.priority !== c.priority) return false;
    if (c.category && task.category_id !== c.category) return false;
    if (c.status && task.status !== c.status) return false;
    if (query && !searchText(task).includes(query)) return false;
    return c.quick.every((filter) => matchesQuick(task, filter, c.currentEmail, now));
  });
}

function matchesDateWindow(
  task: TaskRow,
  dateFrom: string | null,
  dateTo: string | null
): boolean {
  if (!dateFrom && !dateTo) return true;

  const createdDate = getLocalDateKey(task.created_at);
  const inRange =
    (!dateFrom || createdDate >= dateFrom) && (!dateTo || createdDate <= dateTo);
  if (inRange) return true;

  const isCarryOver =
    dateFrom !== null &&
    createdDate < dateFrom &&
    task.status !== "done" &&
    task.status !== "cancel";

  return isCarryOver;
}

function normalizeDateKey(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function getLocalDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
