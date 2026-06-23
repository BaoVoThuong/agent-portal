"use client";

import { PriorityDot, DueBadge } from "./board-ui";
import type { TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";

export function BacklogList({
  tasks,
  assignees,
  onOpen,
  onAssign,
}: {
  tasks: TaskRow[];
  assignees: TaskAssignee[];
  onOpen: (id: string) => void;
  onAssign: (taskId: string, email: string) => void;
}) {
  const backlog = tasks
    .filter((t) => t.status === "backlog")
    .sort((a, b) => a.position - b.position);

  if (backlog.length === 0) {
    return <p className="p-6 text-sm text-slate-400">Backlog is empty.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 p-4">
      {backlog.map((task) => (
        <li key={task.id} className="flex items-center gap-3 py-2">
          <PriorityDot priority={task.priority} />
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="flex-1 text-left text-sm text-slate-800 hover:underline"
          >
            {task.title}
          </button>
          <DueBadge due={task.due_date} />
          <select
            defaultValue=""
            onChange={(e) => e.target.value && onAssign(task.id, e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">Assign…</option>
            {assignees.map((a) => (
              <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
