import type { TaskStatus } from "./types";

export type AssigneeChange = { add?: string; remove?: string };

export type AssigneeChangeResult = {
  assignees: string[];
  status: TaskStatus;
};

export function resolveAssigneeChange(
  current: { status: TaskStatus; assignees: string[] },
  change: AssigneeChange
): AssigneeChangeResult {
  const set = new Set(current.assignees);
  const add = change.add?.trim();
  const remove = change.remove?.trim();

  if (add) set.add(add);
  if (remove) set.delete(remove);

  const assignees = [...set];
  let status = current.status;

  if (assignees.length === 0) {
    status = "backlog";
  } else if (current.status === "backlog") {
    status = "todo";
  }

  return { assignees, status };
}
