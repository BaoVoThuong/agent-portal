"use client";

import { PriorityDot, DueBadge } from "./board-ui";
import type { TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { TaskSelect } from "./TaskSelect";

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
  const assigneeOptions = [
    { value: "", label: "Assign..." },
    ...assignees.map((assignee) => ({
      value: assignee.email,
      label: assignee.name ?? assignee.email,
    })),
  ];

  if (backlog.length === 0) {
    return (
      <div className="px-6 pb-6">
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          Backlog is empty.
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6">
      <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
        <div className="border-b border-[#dfe1e6] bg-[#f4f5f7] px-4 py-3 text-xs font-bold uppercase text-[#6b778c]">
          Backlog {backlog.length}
        </div>
        <ul className="divide-y divide-[#ebecf0]">
          {backlog.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#f4f5f7]"
            >
              <PriorityDot priority={task.priority} />
              <button
                type="button"
                onClick={() => onOpen(task.id)}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#253858] hover:text-[#0c66e4]"
              >
                {task.title}
              </button>
              <DueBadge due={task.due_date} />
              <TaskSelect
                label="Assign"
                value=""
                options={assigneeOptions}
                align="right"
                className="w-44 shrink-0"
                buttonClassName="h-9 border-[#dfe1e6] shadow-none"
                onChange={(email) => email && onAssign(task.id, email)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
