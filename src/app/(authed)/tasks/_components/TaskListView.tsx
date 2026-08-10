"use client";

import type { CSSProperties } from "react";
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
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import type { TaskSignalBadges } from "@/lib/tasks/signal-badges";
import { formatEmailAsName } from "@/lib/tasks/people";
import type { TableColumnOption } from "@/lib/table-config/types";
import { LIST_COL, TaskRowItem, listColumnWidthPx } from "./TaskRowItem";
import type {
  TaskListColumn,
  TaskListColumnKey,
} from "./task-list-columns";

export function TaskListView({
  tasks,
  categories,
  assignees,
  agents,
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
  signalBadges,
  rules,
  now,
  managerView,
  onUnlockOverdue,
  onReopenRequest,
  visibleColumns,
  tableColumnOptions,
}: {
  tasks: TaskRow[];
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
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
  signalBadges?: Record<string, TaskSignalBadges>;
  rules: TaskSlaRule[];
  now: Date;
  managerView: boolean;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
  visibleColumns: TaskListColumn[];
  tableColumnOptions: TableColumnOption[];
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
  const labelByEmail = new Map<string, string>();
  for (const person of [...agents, ...assignees]) {
    labelByEmail.set(person.email, person.name?.trim() || formatEmailAsName(person.email));
  }
  if (!labelByEmail.has(currentEmail)) {
    labelByEmail.set(currentEmail, formatEmailAsName(currentEmail));
  }
  const rows =
    sortKey === null
      ? managerView
        ? rankTasksForManager(tasks, rules, now, signalBadges)
        : rankTasks(tasks, rules, now, signalBadges)
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
  const visibleColumnKeys = new Set<TaskListColumnKey>(
    visibleColumns.map((column) => column.key)
  );
  const pinnedOffsetByKey = buildPinnedOffsetByKey(visibleColumns);
  const tableFrameStyle: CSSProperties = {
    maxHeight: "1008px",
  };

  return (
    <div className="min-h-0 flex flex-1 flex-col px-6 pb-6">
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          No tasks match the current filters.
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]"
          style={tableFrameStyle}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-max">
              <div className="sticky top-0 z-20 flex items-stretch whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
                {visibleColumns.map((column) =>
                  column.sortKey ? (
                    <SortTh
                      key={column.key}
                      label={column.label}
                      col={column.sortKey}
                      widthClass={headerWidthClass(
                        column,
                        pinnedOffsetByKey.has(column.key)
                      )}
                      style={headerStyle(column, pinnedOffsetByKey)}
                      {...sp}
                    />
                  ) : (
                    <span
                      key={column.key}
                      style={headerStyle(column, pinnedOffsetByKey)}
                      className={`${headerWidthClass(
                        column,
                        pinnedOffsetByKey.has(column.key)
                      )} items-center px-3 py-2`}
                    >
                      {column.label}
                    </span>
                  )
                )}
              </div>
              <ul>
                {rows.map((task) => {
                  const capabilities = capabilitiesFor(task);
                  return (
                    <li key={task.id} className="border-b border-[#ebecf0]">
                      <TaskRowItem
                        task={task}
                        category={categoryById.get(task.category_id ?? "") ?? null}
                        categories={categories}
                        assignees={assignees}
                        agents={agents}
                        labelByEmail={labelByEmail}
                        agentMembersByAgent={agentMembersByAgent}
                        canChangeStatus={capabilities.canChangeStatus}
                        canAssign={capabilities.canAssign}
                        canEditContent={capabilities.canEditContent}
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
                        badges={signalBadges?.[task.id]}
                        onUnlockOverdueRequest={() => onUnlockOverdue(task.id)}
                        onReopenRequest={() => onReopenRequest(task.id)}
                        visibleColumnKeys={visibleColumnKeys}
                        visibleColumns={visibleColumns}
                        tableColumnOptions={tableColumnOptions}
                        rules={rules}
                        now={now}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function headerWidthClass(column: TaskListColumn, pinned: boolean): string {
  const stickyClass = pinned
    ? "sticky z-[30] border-r border-[#dfe1e6] bg-[#fafbfc]"
    : "";
  const widthClass = headerBaseWidthClass(column);
  return `${widthClass} ${stickyClass}`;
}

function headerBaseWidthClass(column: TaskListColumn): string {
  switch (column.key) {
    case "key":
      return `flex ${LIST_COL.key} shrink-0`;
    case "id":
      return `flex ${LIST_COL.id} shrink-0`;
    case "assignee":
      return `flex ${LIST_COL.assignee} shrink-0`;
    case "primaryAssignee":
      return `flex ${LIST_COL.primaryAssignee} shrink-0`;
    case "assignedAt":
      return `flex ${LIST_COL.assignedAt} shrink-0`;
    case "agent":
      return `flex ${LIST_COL.agent} shrink-0`;
    case "summary":
      return `flex ${LIST_COL.summary} shrink-0`;
    case "description":
      return `flex ${LIST_COL.description} shrink-0`;
    case "category":
      return `flex ${LIST_COL.category} shrink-0`;
    case "reporter":
      return `flex ${LIST_COL.reporter} shrink-0`;
    case "created":
      return `flex ${LIST_COL.created} shrink-0`;
    case "updated":
      return `flex ${LIST_COL.updated} shrink-0`;
    case "activity":
      return `flex ${LIST_COL.activity} shrink-0`;
    case "activityBy":
      return `flex ${LIST_COL.activityBy} shrink-0`;
    case "comments":
      return `flex ${LIST_COL.comments} shrink-0 justify-center`;
    case "attachments":
      return `flex ${LIST_COL.attachments} shrink-0 justify-center`;
    case "fub":
      return `flex ${LIST_COL.fub} shrink-0 justify-center`;
    case "sla":
      return `flex ${LIST_COL.sla} shrink-0`;
    case "slaRemaining":
      return `flex ${LIST_COL.slaRemaining} shrink-0`;
    case "overdueCount":
      return `flex ${LIST_COL.overdueCount} shrink-0 justify-center`;
    case "todoTime":
      return `flex ${LIST_COL.todoTime} shrink-0`;
    case "progressTime":
      return `flex ${LIST_COL.progressTime} shrink-0`;
    case "waitingTime":
      return `flex ${LIST_COL.waitingTime} shrink-0`;
    case "todoStarted":
      return `flex ${LIST_COL.todoStarted} shrink-0`;
    case "progressStarted":
      return `flex ${LIST_COL.progressStarted} shrink-0`;
    case "waitingStarted":
      return `flex ${LIST_COL.waitingStarted} shrink-0`;
    case "dueSoonNotified":
      return `flex ${LIST_COL.dueSoonNotified} shrink-0`;
    case "todoReminded":
      return `flex ${LIST_COL.todoReminded} shrink-0`;
    case "waitingReminded":
      return `flex ${LIST_COL.waitingReminded} shrink-0`;
    case "overdueFlagged":
      return `flex ${LIST_COL.overdueFlagged} shrink-0`;
    case "overdueReminded":
      return `flex ${LIST_COL.overdueReminded} shrink-0`;
    case "overdueUnlocked":
      return `flex ${LIST_COL.overdueUnlocked} shrink-0`;
    case "staleReminded":
      return `flex ${LIST_COL.staleReminded} shrink-0`;
    case "qcReminded":
      return `flex ${LIST_COL.qcReminded} shrink-0`;
    case "reopened":
      return `flex ${LIST_COL.reopened} shrink-0`;
    case "closed":
      return `flex ${LIST_COL.closed} shrink-0`;
    case "reviewedBy":
      return `flex ${LIST_COL.reviewedBy} shrink-0`;
    case "reviewedAt":
      return `flex ${LIST_COL.reviewedAt} shrink-0`;
    case "position":
      return `flex ${LIST_COL.position} shrink-0 justify-center`;
    case "priority":
      return `flex ${LIST_COL.priority} shrink-0`;
    case "status":
      return `flex ${LIST_COL.status} shrink-0`;
    case "review":
      return `flex ${LIST_COL.review} shrink-0 justify-center`;
    default:
      return `flex ${LIST_COL.custom} shrink-0 ${
        column.align === "center" ? "justify-center" : ""
      }`;
  }
}

function buildPinnedOffsetByKey(
  columns: readonly TaskListColumn[]
): Map<TaskListColumnKey, number> {
  const offsets = new Map<TaskListColumnKey, number>();
  let left = 0;
  for (const column of columns) {
    if (!column.pinned) continue;
    offsets.set(column.key, left);
    left += listColumnWidthPx(column.key);
  }
  return offsets;
}

function headerStyle(
  column: TaskListColumn,
  pinnedOffsetByKey: ReadonlyMap<TaskListColumnKey, number>
): CSSProperties | undefined {
  const left = pinnedOffsetByKey.get(column.key);
  return left === undefined ? undefined : { left };
}

// A clickable column header that sorts by `col` and shows the active direction.
function SortTh({
  label,
  col,
  widthClass,
  style,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  widthClass: string;
  style?: CSSProperties;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      style={style}
      className={`items-center gap-1 whitespace-nowrap px-3 py-2 uppercase transition ${widthClass} ${
        active ? "text-[#0c66e4]" : "hover:text-[#172b4d]"
      }`}
    >
      <span className="shrink-0">{label}</span>
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
