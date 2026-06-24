// Computes activity-log entries from a before-state + a resolved patch.
// Pure + tested. The API route inserts the returned rows into task_activity.
export type ActivityEntry = { type: string; meta: Record<string, unknown> | null };

export function buildActivityEntries(
  before: {
    status: string;
    assignee_email: string | null;
    agent_email?: string | null;
  },
  patch: Record<string, unknown>
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  if (typeof patch.status === "string" && patch.status !== before.status) {
    const type = before.status === "done" ? "reopened" : "status_changed";
    entries.push({ type, meta: { from: before.status, to: patch.status } });
  }
  if ("assignee_email" in patch && patch.assignee_email !== before.assignee_email) {
    entries.push({ type: "assigned", meta: { to: patch.assignee_email ?? null } });
  }
  if (typeof patch.priority === "string") {
    entries.push({ type: "priority_changed", meta: { to: patch.priority } });
  }
  if ("due_date" in patch) {
    entries.push({ type: "due_changed", meta: { to: patch.due_date ?? null } });
  }
  if ("category_id" in patch) {
    entries.push({ type: "category_changed", meta: { to: patch.category_id ?? null } });
  }
  if ("agent_email" in patch && patch.agent_email !== before.agent_email) {
    entries.push({ type: "agent_changed", meta: { to: patch.agent_email ?? null } });
  }
  if ("title" in patch || "description" in patch) {
    entries.push({ type: "edited", meta: null });
  }
  return entries;
}
