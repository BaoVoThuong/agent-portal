"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import { sortTasks, type SortDir, type SortKey } from "@/lib/tasks/sorting";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { TaskSelect } from "./TaskSelect";
import { TaskRowItem } from "./TaskRowItem";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Updated" },
  { value: "key", label: "Key" },
  { value: "title", label: "Summary" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "category", label: "Category" },
  { value: "due", label: "Due date" },
];

export function TaskListView({
  tasks,
  categories,
  assignees,
  isManager,
  currentEmail,
  onOpen,
  onPatch,
}: {
  tasks: TaskRow[];
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  isManager: boolean;
  currentEmail: string;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryName = (id: string | null) => categoryById.get(id ?? "")?.name ?? null;
  const rows = sortTasks(tasks, sortKey, sortDir, categoryName);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <div className="mb-3 flex items-center justify-end gap-2">
        <span className="text-sm font-medium text-[#6b778c]">Sort by</span>
        <TaskSelect
          value={sortKey}
          options={SORT_OPTIONS}
          className="w-40"
          buttonClassName="h-9 border-[#dfe1e6] shadow-none"
          onChange={(v) => setSortKey(v as SortKey)}
        />
        <button
          type="button"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          title={sortDir === "asc" ? "Ascending" : "Descending"}
          className="flex h-9 w-9 items-center justify-center rounded border-2 border-[#dfe1e6] bg-white text-[#42526e] transition hover:border-[#c1c7d0]"
        >
          {sortDir === "asc" ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          No tasks match the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <ul className="divide-y divide-[#ebecf0]">
            {rows.map((task) => (
              <li key={task.id}>
                <TaskRowItem
                  task={task}
                  category={categoryById.get(task.category_id ?? "") ?? null}
                  assignees={assignees}
                  canEdit={isManager || task.assignee_email === currentEmail}
                  canAssign={isManager}
                  onOpen={onOpen}
                  onPatch={onPatch}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
