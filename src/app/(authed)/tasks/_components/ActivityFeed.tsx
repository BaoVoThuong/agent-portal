"use client";

import { useEffect, useState } from "react";

type Activity = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

function describe(a: Activity): string {
  const to = a.meta && "to" in a.meta ? String((a.meta as { to: unknown }).to ?? "—") : "";
  switch (a.type) {
    case "created": return "created the task";
    case "status_changed": return `moved to ${to}`;
    case "reopened": return `reopened (${to})`;
    case "assigned": return `assigned to ${to}`;
    case "priority_changed": return `set priority ${to}`;
    case "due_changed": return `set due date ${to}`;
    case "category_changed": return "changed category";
    case "agent_changed": return `changed agent to ${to}`;
    case "comment_added": return "commented";
    case "edited": return "edited the task";
    case "archived": return "archived the task";
    default: return a.type;
  }
}

export function ActivityFeed({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    void fetch(`/api/tasks/${taskId}/activity`)
      .then((r) => (r.ok ? r.json() : { activity: [] }))
      .then((d) => setItems(d.activity as Activity[]));
  }, [taskId]);

  if (items.length === 0)
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;

  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="text-xs text-[#6b778c]">
          <span className="font-semibold text-[#172b4d]">{a.actor_email}</span> {describe(a)}
          <span className="ml-1 text-[#97a0af]">{new Date(a.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
