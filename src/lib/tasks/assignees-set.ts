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

export type AgentChangeReconciliation = {
  /** null when nothing needed pruning — caller should leave assignees as-is. */
  assignees: string[] | null;
  /** Forced status when pruning empties the assignee list; null otherwise. */
  status: TaskStatus | null;
};

// When a task's agent changes, any assignee who isn't on the new agent's
// team no longer belongs on it — otherwise a task stays assigned to someone
// who has nothing to do with its new agent. Falls back to backlog if that
// empties the list, same invariant resolveAssigneeChange applies when the
// last assignee is removed directly.
export function reconcileAssigneesForNewAgent(
  currentAssignees: string[],
  newAgentTeam: string[]
): AgentChangeReconciliation {
  const teamSet = new Set(newAgentTeam);
  const remaining = currentAssignees.filter((email) => teamSet.has(email));
  if (remaining.length === currentAssignees.length) {
    return { assignees: null, status: null };
  }
  return { assignees: remaining, status: remaining.length === 0 ? "backlog" : null };
}
