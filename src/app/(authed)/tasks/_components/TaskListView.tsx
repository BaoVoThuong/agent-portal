"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TaskCategory, TaskRow, TaskSlaRule } from "@/lib/tasks/types";
import { resolveTaskCapabilities } from "@/lib/tasks/access";
import {
  rankTasksForManager,
  rankTasks,
  sortTasks,
  type SortDir,
  type SortKey,
} from "@/lib/tasks/sorting";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { LIST_COL, TaskRowItem } from "./TaskRowItem";

export function TaskListView({
  tasks,
  categories,
  assignees,
  isManager,
  myAssistantAgents,
  agentMembersByAgent,
  currentEmail,
  onOpen,
  onPatch,
  onReviewDone,
  onAssigneeChange,
  overdueIds,
  newAssignedTaskIds,
  rules,
  now,
  managerView,
  onUnlockOverdue,
  onReopenRequest,
}: {
  tasks: TaskRow[];
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  isManager: boolean;
  myAssistantAgents: string[];
  agentMembersByAgent: Record<string, string[]>;
  currentEmail: string;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  onAssigneeChange: (id: string, email: string, assigned: boolean) => void;
  overdueIds: Set<string>;
  newAssignedTaskIds: Set<string>;
  rules: TaskSlaRule[];
  now: Date;
  managerView: boolean;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
}) {
  function isAgentOwnerOrAssistantOf(agentEmail: string | null): boolean {
    if (!agentEmail) return false;
    return agentEmail === currentEmail || myAssistantAgents.includes(agentEmail);
  }
  function isAgentTeamMemberOf(agentEmail: string | null): boolean {
    return Boolean(
      agentEmail && (agentMembersByAgent[agentEmail] ?? []).includes(currentEmail)
    );
  }
  function capabilitiesFor(task: TaskRow) {
    return resolveTaskCapabilities(
      { email: currentEmail, isManager, isWorker: true },
      { assignee_email: task.assignees[0] ?? task.assignee_email },
      {
        isAssignee: task.assignees.includes(currentEmail),
        isAgentOwner: isAgentOwnerOrAssistantOf(task.agent_email),
        isAgentMember: isAgentTeamMemberOf(task.agent_email),
        isReporter: task.reporter_email === currentEmail,
        isParticipant: Boolean(task.viewer_is_participant),
      }
    );
  }
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryName = (id: string | null) => categoryById.get(id ?? "")?.name ?? null;
  const rows =
    sortKey === null
      ? managerView
        ? rankTasksForManager(tasks, rules, now)
        : rankTasks(tasks, rules, now)
      : sortTasks(tasks, sortKey, sortDir, categoryName);

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
            <SortTh
              label="Assignee"
              col="assignee"
              widthClass={`flex ${LIST_COL.assignee} shrink-0`}
              {...sp}
            />
            <SortTh label="Summary" col="title" widthClass="flex min-w-0 flex-1" {...sp} />
            <SortTh
              label="Category"
              col="category"
              widthClass={`hidden ${LIST_COL.category} shrink-0 sm:flex`}
              {...sp}
            />
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
              widthClass={`flex ${LIST_COL.status} shrink-0 justify-center`}
              {...sp}
            />
            <span className={`flex ${LIST_COL.review} shrink-0 justify-center`}>
              QC
            </span>
          </div>
          <ul className="divide-y divide-[#ebecf0]">
            {rows.map((task) => {
              const capabilities = capabilitiesFor(task);
              return (
                <li key={task.id}>
                  <TaskRowItem
                    task={task}
                    category={categoryById.get(task.category_id ?? "") ?? null}
                    assignees={assignees}
                    agentMembersByAgent={agentMembersByAgent}
                    canChangeStatus={capabilities.canChangeStatus}
                    canAssign={capabilities.canAssign}
                    onOpen={onOpen}
                    onPatch={onPatch}
                    canReviewDone={
                      (task.status === "done" || task.status === "cancel") &&
                      capabilities.canReviewQC
                    }
                    onReviewDone={(reviewed) => onReviewDone(task.id, reviewed)}
                    onAssigneeChange={onAssigneeChange}
                    openOnDoubleClick
                    isOverdue={overdueIds.has(task.id)}
                    isNewAssigned={newAssignedTaskIds.has(task.id)}
                    onUnlockOverdueRequest={() => onUnlockOverdue(task.id)}
                    onReopenRequest={() => onReopenRequest(task.id)}
                  />
                </li>
              );
            })}
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
  sortKey: SortKey | null;
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
