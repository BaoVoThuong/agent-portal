"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import { sortTasks, type SortDir, type SortKey } from "@/lib/tasks/sorting";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { LIST_COL, TaskRowItem } from "./TaskRowItem";

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
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryName = (id: string | null) => categoryById.get(id ?? "")?.name ?? null;
  const rows = sortTasks(tasks, sortKey, sortDir, categoryName);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sp = { sortKey, sortDir, onSort: toggleSort };

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          No tasks match the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <div className="flex items-center gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
            <SortTh label="Key" col="key" widthClass={`flex ${LIST_COL.key} shrink-0`} {...sp} />
            <SortTh label="Summary" col="title" widthClass="flex min-w-0 flex-1" {...sp} />
            <SortTh
              label="Category"
              col="category"
              widthClass={`hidden ${LIST_COL.category} shrink-0 sm:flex`}
              {...sp}
            />
            <SortTh label="Due" col="due" widthClass={`flex ${LIST_COL.due} shrink-0`} {...sp} />
            <SortTh
              label="Created"
              col="created"
              widthClass={`flex ${LIST_COL.created} shrink-0`}
              {...sp}
            />
            <SortTh
              label="Priority"
              col="priority"
              widthClass={`flex ${LIST_COL.priority} shrink-0 justify-center`}
              {...sp}
            />
            <SortTh
              label="Status"
              col="status"
              widthClass={`flex ${LIST_COL.status} shrink-0`}
              {...sp}
            />
            <SortTh
              label="Assignee"
              col="assignee"
              widthClass={`flex ${LIST_COL.assignee} shrink-0 justify-center`}
              {...sp}
            />
          </div>
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
                  openOnDoubleClick
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// A clickable column header that sorts by `col` and shows the active direction.
function SortTh({
  label,
  col,
  widthClass,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  widthClass: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`items-center gap-1 uppercase transition ${widthClass} ${
        active ? "text-[#0c66e4]" : "hover:text-[#172b4d]"
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}
