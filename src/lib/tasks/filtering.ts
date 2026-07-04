import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export const ALL_AGENTS = "__all_agents__";
export const NO_AGENT = "__no_agent__";
// Assignee facet. "" = all; this sentinel = unassigned.
export const NO_ASSIGNEE = "__no_assignee__";

export type QuickFilter =
  | "highPriority"
  | "recentlyUpdated"
  | "mine"
  | "triage"
  | "overdue";

export type FilterCriteria = {
  query: string;
  agent: string | string[];
  assignee?: string | string[];
  quick: QuickFilter[];
  priority?: "" | TaskPriority;
  category: string | string[];
  status: "" | TaskStatus | TaskStatus[];
  dateFrom?: string;
  dateTo?: string;
  currentEmail: string;
  now?: Date;
  // Precomputed (needs SLA rules, which live outside this pure module) —
  // required only when quick includes "overdue".
  overdueIds?: Set<string>;
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
  now: Date,
  overdueIds: Set<string> | undefined
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
    case "overdue":
      return overdueIds?.has(task.id) ?? false;
  }
}

export function filterTasks(tasks: TaskRow[], c: FilterCriteria): TaskRow[] {
  const now = c.now ?? new Date();
  const query = c.query.trim().toLowerCase();
  const searchText = c.searchText ?? defaultSearchText;
  const dateFrom = normalizeDateKey(c.dateFrom);
  const dateTo = normalizeDateKey(c.dateTo);
  const agentValues = normalizeFilterValues(c.agent, ALL_AGENTS);
  const assigneeValues = normalizeFilterValues(c.assignee ?? "");
  const categoryValues = normalizeFilterValues(c.category);
  const statusValues = normalizeFilterValues(c.status);

  return tasks.filter((task) => {
    if (!matchesDateWindow(task, dateFrom, dateTo)) return false;
    if (!matchesAgent(task, agentValues)) return false;
    if (!matchesAssignee(task, assigneeValues)) return false;
    if (c.priority && task.priority !== c.priority) return false;
    if (!matchesCategory(task, categoryValues)) return false;
    if (!matchesStatus(task, statusValues)) return false;
    if (query && !searchText(task).includes(query)) return false;
    return c.quick.every((filter) =>
      matchesQuick(task, filter, c.currentEmail, now, c.overdueIds)
    );
  });
}

function normalizeFilterValues(
  value: string | string[] | undefined,
  allValue = ""
): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const selectedValue of values) {
    if (!selectedValue || selectedValue === allValue || seen.has(selectedValue)) {
      continue;
    }
    seen.add(selectedValue);
    normalized.push(selectedValue);
  }

  return normalized;
}

function matchesAgent(task: TaskRow, selectedAgents: string[]): boolean {
  if (selectedAgents.length === 0) return true;
  if (!task.agent_email) return selectedAgents.includes(NO_AGENT);
  return selectedAgents.includes(task.agent_email);
}

function matchesAssignee(task: TaskRow, selectedAssignees: string[]): boolean {
  if (selectedAssignees.length === 0) return true;
  if (
    selectedAssignees.includes(NO_ASSIGNEE) &&
    task.assignees.length === 0
  ) {
    return true;
  }

  return task.assignees.some((assignee) => selectedAssignees.includes(assignee));
}

function matchesCategory(task: TaskRow, selectedCategories: string[]): boolean {
  if (selectedCategories.length === 0) return true;
  return Boolean(task.category_id && selectedCategories.includes(task.category_id));
}

function matchesStatus(task: TaskRow, selectedStatuses: string[]): boolean {
  if (selectedStatuses.length === 0) return true;
  return selectedStatuses.includes(task.status);
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
