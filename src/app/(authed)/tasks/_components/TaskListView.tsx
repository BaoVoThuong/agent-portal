"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  KANBAN_STATUSES,
  STATUS_LABEL,
  type TaskCategory,
  type TaskRow,
} from "@/lib/tasks/types";
import {
  sortTasks,
  taskKey,
  type SortDir,
  type SortKey,
} from "@/lib/tasks/sorting";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";
import { DueBadge, Initials } from "./board-ui";

type Column = { key: SortKey; label: string };

const COLUMNS: Column[] = [
  { key: "key", label: "Key" },
  { key: "title", label: "Summary" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "agent", label: "Agent" },
  { key: "assignee", label: "Assignee" },
  { key: "category", label: "Category" },
  { key: "due", label: "Due" },
  { key: "updated", label: "Updated" },
];

export function TaskListView({
  tasks,
  categories,
  assignees,
  agents,
  isManager,
  currentEmail,
  onOpen,
  onPatch,
}: {
  tasks: TaskRow[];
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  isManager: boolean;
  currentEmail: string;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "key",
    dir: "asc",
  });

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? null;
  const rows = sortTasks(tasks, sort.key, sort.dir, categoryName);

  const statusOptions = KANBAN_STATUSES.map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
  }));
  const agentOptions = [
    { value: "", label: "No agent" },
    ...agents.map((a) => ({ value: a.email, label: a.name ?? a.email })),
  ];
  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...assignees.map((a) => ({ value: a.email, label: a.name ?? a.email })),
  ];
  const categoryOptions = [
    { value: "", label: "No category" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 pb-6">
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          No tasks match the current filters.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#f4f5f7]">
            <tr className="border-b border-[#dfe1e6]">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-[#6b778c]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 transition hover:text-[#172b4d] ${
                        active ? "text-[#0c66e4]" : ""
                      }`}
                    >
                      {col.label}
                      {active ? (
                        sort.dir === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ebecf0]">
            {rows.map((task) => {
              const canEdit =
                isManager || task.assignee_email === currentEmail;
              return (
                <tr key={task.id} className="transition hover:bg-[#f4f5f7]">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-bold text-[#97a0af]">
                    {taskKey(task.id)}
                  </td>
                  <td className="max-w-[22rem] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      className="block max-w-full truncate text-left font-medium text-[#253858] hover:text-[#0c66e4]"
                    >
                      {task.title}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <TaskSelect
                      value={task.status}
                      options={statusOptions}
                      disabled={!canEdit}
                      className="w-36"
                      buttonClassName="h-8 border-[#dfe1e6] shadow-none"
                      onChange={(v) => onPatch(task.id, { status: v })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <TaskPrioritySelect
                      value={task.priority}
                      disabled={!canEdit}
                      className="w-36"
                      buttonClassName="h-8"
                      onChange={(v) => onPatch(task.id, { priority: v })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <TaskSelect
                      value={task.agent_email ?? ""}
                      options={agentOptions}
                      disabled={!canEdit}
                      className="w-40"
                      buttonClassName="h-8 border-[#dfe1e6] shadow-none"
                      onChange={(v) =>
                        onPatch(task.id, { agent_email: v || null })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Initials email={task.assignee_email} />
                      <TaskSelect
                        value={task.assignee_email ?? ""}
                        options={assigneeOptions}
                        disabled={!isManager}
                        className="w-40"
                        buttonClassName="h-8 border-[#dfe1e6] shadow-none"
                        onChange={(v) =>
                          onPatch(
                            task.id,
                            v
                              ? {
                                  assignee_email: v,
                                  status:
                                    task.status === "backlog"
                                      ? "todo"
                                      : task.status,
                                }
                              : { assignee_email: null, status: "backlog" }
                          )
                        }
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <TaskSelect
                      value={task.category_id ?? ""}
                      options={categoryOptions}
                      disabled={!canEdit}
                      className="w-40"
                      buttonClassName="h-8 border-[#dfe1e6] shadow-none"
                      onChange={(v) =>
                        onPatch(task.id, { category_id: v || null })
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <DueBadge due={task.due_date} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#6b778c]">
                    {new Date(task.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
