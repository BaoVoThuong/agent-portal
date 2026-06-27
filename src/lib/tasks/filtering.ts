import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export const ALL_AGENTS = "__all_agents__";
export const NO_AGENT = "__no_agent__";
// Assignee facet (filters by assignee_email). "" = all; this sentinel = unassigned.
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
  currentEmail: string;
  now?: Date;
  searchText?: (task: TaskRow) => string;
};

function defaultSearchText(task: TaskRow): string {
  return [
    task.title,
    task.description,
    task.agent_email,
    task.assignee_email,
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
        task.assignee_email === currentEmail ||
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

  return tasks.filter((task) => {
    if (
      c.agent === NO_AGENT
        ? !!task.agent_email
        : c.agent !== ALL_AGENTS && task.agent_email !== c.agent
    ) {
      return false;
    }
    if (c.assignee) {
      if (c.assignee === NO_ASSIGNEE) {
        if (task.assignee_email) return false;
      } else if (task.assignee_email !== c.assignee) {
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
