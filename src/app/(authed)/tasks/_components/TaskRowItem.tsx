"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  RotateCcw,
  Tag,
  UserPlus,
} from "lucide-react";
import {
  STATUS_LABEL,
  TASK_STATUSES,
  type TaskCategory,
  type TaskRow,
  type TaskSlaRule,
  type TaskStatus,
} from "@/lib/tasks/types";
import { taskKey } from "@/lib/tasks/sorting";
import { formatEmailAsName } from "@/lib/tasks/people";
import {
  effectiveSlaMinutes,
  formatDurationMinutes,
  formatDurationSeconds,
  formatSlaRemaining,
  isSlaActiveInProgress,
  slaRemainingSeconds,
  stageElapsedSeconds,
} from "@/lib/tasks/sla";
import { prefetchTaskDetail } from "@/lib/tasks/detail-cache";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import {
  taskCategoryBadgePalette,
  taskCategoryPalette,
} from "@/lib/tasks/category-colors";
import type { TableColumnOption } from "@/lib/table-config/types";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";
import { Initials, NewAssignedBadge, PriorityIcon, PRIORITY_META } from "./board-ui";
import { TaskAssigneePicker } from "./TaskAssigneePicker";
import { useAnchoredMenu } from "./use-anchored-menu";
import type { TaskListColumn, TaskListColumnKey } from "./task-list-columns";

// Shared column widths so the List header and the rows line up exactly.
export const LIST_COL = {
  key: "w-[100px]",
  id: "w-64",
  assignee: "w-[190px]",
  primaryAssignee: "w-[190px]",
  assignedAt: "w-28",
  agent: "w-[180px]",
  summary: "w-[300px]",
  description: "w-80",
  category: "w-[260px]",
  reporter: "w-[190px]",
  created: "w-[136px]",
  updated: "w-28",
  activity: "w-[148px]",
  activityBy: "w-36",
  comments: "w-20",
  attachments: "w-16",
  fub: "w-12",
  sla: "w-20",
  slaRemaining: "w-[160px]",
  overdueCount: "w-20",
  todoTime: "w-24",
  progressTime: "w-28",
  waitingTime: "w-24",
  todoStarted: "w-28",
  progressStarted: "w-28",
  waitingStarted: "w-28",
  dueSoonNotified: "w-32",
  todoReminded: "w-32",
  waitingReminded: "w-32",
  overdueFlagged: "w-28",
  overdueReminded: "w-32",
  overdueUnlocked: "w-28",
  staleReminded: "w-32",
  qcReminded: "w-28",
  reopened: "w-28",
  closed: "w-28",
  reviewedBy: "w-36",
  reviewedAt: "w-28",
  position: "w-20",
  priority: "w-[108px]",
  status: "w-[140px]",
  review: "w-12",
  custom: "w-[180px]",
};

export const LIST_COL_WIDTH_PX: Record<string, number> = {
  key: 100,
  id: 256,
  assignee: 190,
  primaryAssignee: 190,
  assignedAt: 112,
  agent: 180,
  summary: 300,
  description: 320,
  category: 260,
  reporter: 190,
  created: 136,
  updated: 112,
  activity: 148,
  activityBy: 144,
  comments: 80,
  attachments: 64,
  fub: 48,
  sla: 80,
  slaRemaining: 160,
  overdueCount: 80,
  todoTime: 96,
  progressTime: 112,
  waitingTime: 96,
  todoStarted: 112,
  progressStarted: 112,
  waitingStarted: 112,
  dueSoonNotified: 128,
  todoReminded: 128,
  waitingReminded: 128,
  overdueFlagged: 112,
  overdueReminded: 128,
  overdueUnlocked: 112,
  staleReminded: 128,
  qcReminded: 112,
  reopened: 112,
  closed: 112,
  reviewedBy: 144,
  reviewedAt: 112,
  position: 80,
  priority: 108,
  status: 140,
  review: 48,
  custom: 180,
};

export function listColumnWidthPx(key: TaskListColumnKey): number {
  return LIST_COL_WIDTH_PX[String(key)] ?? LIST_COL_WIDTH_PX.custom;
}

function buildPinnedTaskOffsetByKey(
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

const DEFAULT_ROW_COLUMN_KEYS = new Set<TaskListColumnKey>([
  "key",
  "assignee",
  "summary",
  "category",
  "created",
  "priority",
  "status",
  "review",
]);

const STATUS_PILL: Record<TaskStatus, { bg: string; fg: string }> = {
  backlog: { bg: "#dfe1e6", fg: "#42526e" },
  todo: { bg: "#dfe1e6", fg: "#42526e" },
  in_progress: { bg: "#deebff", fg: "#0055cc" },
  waiting: { bg: "#fff0b3", fg: "#7f5f01" },
  done: { bg: "#e3fcef", fg: "#006644" },
  cancel: { bg: "#ffebe6", fg: "#bf2600" },
};

export function TaskRowItem({
  task,
  category,
  categories,
  assignees,
  agents,
  labelByEmail,
  agentMembersByAgent,
  canChangeStatus,
  canAssign,
  canEditContent,
  canReviewDone,
  onOpen,
  onPatch,
  onReviewDone,
  onAssigneeChange,
  dragHandle,
  openOnDoubleClick = false,
  isOverdue = false,
  isNewAssigned = false,
  visibleColumnKeys,
  visibleColumns,
  tableColumnOptions,
  rules,
  now,
  onUnlockOverdueRequest,
  onReopenRequest,
}: {
  task: TaskRow;
  category: TaskCategory | null;
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  labelByEmail?: ReadonlyMap<string, string>;
  agentMembersByAgent: Record<string, string[]>;
  canChangeStatus: boolean;
  canAssign: boolean;
  canEditContent: boolean;
  canReviewDone: boolean;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onReviewDone: (reviewed: boolean) => void;
  onAssigneeChange: (id: string, email: string, assigned: boolean) => void;
  dragHandle?: ReactNode;
  openOnDoubleClick?: boolean;
  isOverdue?: boolean;
  isNewAssigned?: boolean;
  visibleColumnKeys?: ReadonlySet<TaskListColumnKey>;
  visibleColumns?: readonly TaskListColumn[];
  tableColumnOptions?: readonly TableColumnOption[];
  rules?: TaskSlaRule[];
  now?: Date;
  onUnlockOverdueRequest?: () => void;
  onReopenRequest?: () => void;
}) {
  const fallbackLabelByEmail = new Map(
    assignees.map((assignee) => [
      assignee.email,
      assignee.name?.trim() || formatEmailAsName(assignee.email),
    ])
  );
  const personLabelByEmail = labelByEmail ?? fallbackLabelByEmail;
  const configuredColumns = Boolean(visibleColumnKeys);
  const hasColumn = (key: TaskListColumnKey) =>
    visibleColumnKeys ? visibleColumnKeys.has(key) : DEFAULT_ROW_COLUMN_KEYS.has(key);
  const columnOrderByKey = visibleColumns
    ? new Map<TaskListColumnKey, number>(
        visibleColumns.map((column, index) => [column.key, index])
      )
    : null;
  const pinnedOffsetByKey = visibleColumns
    ? buildPinnedTaskOffsetByKey(visibleColumns)
    : new Map<TaskListColumnKey, number>();
  const columnStyle = (key: TaskListColumnKey): CSSProperties | undefined => {
    const style: CSSProperties = {};
    if (columnOrderByKey) style.order = columnOrderByKey.get(key) ?? 999;
    const pinnedLeft = pinnedOffsetByKey.get(key);
    if (configuredColumns && pinnedLeft !== undefined) style.left = pinnedLeft;
    return Object.keys(style).length > 0 ? style : undefined;
  };
  const pinnedCellClass = (key: TaskListColumnKey): string =>
    configuredColumns && pinnedOffsetByKey.has(key)
      ? "sticky z-[2] border-r border-[#dfe1e6] bg-white group-hover:bg-[#f7f8f9]"
      : "";
  const cellClassName = (key: TaskListColumnKey, className: string): string =>
    `${className} ${pinnedCellClass(key)}`;
  const customColumns = (visibleColumns ?? []).filter(
    (column) => column.configColumn && !column.configColumn.is_system
  );
  const customOptionLabelById = new Map(
    (tableColumnOptions ?? []).map((option) => [option.id, option.label])
  );
  const customOptionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions ?? []) {
    const list = customOptionsByColumnId.get(option.column_id) ?? [];
    list.push(option);
    customOptionsByColumnId.set(option.column_id, list);
  }
  const personLabel = (email: string | null | undefined) =>
    email ? personLabelByEmail.get(email) ?? formatEmailAsName(email) : "—";
  const primaryAssigneeLabel = personLabel(task.assignee_email);
  const reporterLabel = personLabel(task.reporter_email);
  const activityByLabel = personLabel(task.last_activity_by_email);
  const reviewedByLabel = personLabel(task.done_reviewed_by_email);
  const ruleSet = rules ?? [];
  const liveNow = now ?? null;
  const slaMinutes = effectiveSlaMinutes(task, ruleSet);
  const timeReport = buildTimeReport(task, ruleSet, liveNow);
  const summaryClassName = configuredColumns
    ? `${LIST_COL.summary} shrink-0`
    : "min-w-0 flex-1";
  const categoryClassName = configuredColumns
    ? `${LIST_COL.category} shrink-0 truncate`
    : `hidden ${LIST_COL.category} shrink-0 truncate sm:block`;

  return (
    <div
      onMouseEnter={() => prefetchTaskDetail(task.id)}
      onDoubleClick={() => {
        if (openOnDoubleClick) onOpen(task.id);
      }}
      className={`group flex bg-white transition hover:bg-[#f7f8f9] ${
        configuredColumns
          ? "min-w-max items-stretch gap-0 whitespace-nowrap px-0 py-0 [&>*]:flex [&>*]:items-center [&>*]:whitespace-nowrap [&>*]:px-3 [&>*]:py-2.5"
          : "items-center gap-3 whitespace-nowrap px-4 py-2.5"
      } ${isOverdue && !configuredColumns ? "border-l-4 border-[#f97316]" : ""}`}
    >
      {!configuredColumns ? dragHandle : null}
      {hasColumn("key") ? (
        <span
          style={columnStyle("key")}
          className={cellClassName("key", `${LIST_COL.key} shrink-0 truncate font-mono text-xs font-bold text-[#97a0af] ${
            configuredColumns
              ? `flex items-center gap-1.5 ${isOverdue ? "border-l-4 border-l-[#f97316]" : ""}`
              : ""
          }`)}
        >
          {configuredColumns ? dragHandle : null}
          <span className="min-w-0 truncate">{taskKey(task.id)}</span>
        </span>
      ) : null}

      {configuredColumns && hasColumn("summary") ? (
        <div
          style={columnStyle("summary")}
          className={cellClassName(
            "summary",
            `flex ${summaryClassName} items-center gap-1.5`
          )}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task.id);
            }}
            className="w-full min-w-0 truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
            title={task.title || "Unnamed task"}
          >
            <span className="block truncate">{task.title || "Unnamed task"}</span>
          </button>
          {isNewAssigned ? <NewAssignedBadge /> : null}
          <TaskRowFlags task={task} isOverdue={isOverdue} />
          <TaskFubLink href={task.fub_link} />
        </div>
      ) : null}

      {hasColumn("id") ? (
        <span
          style={columnStyle("id")}
          className={cellClassName(
            "id",
            `${LIST_COL.id} shrink-0 truncate font-mono text-[11px] font-semibold text-[#6b778c]`
          )}
          title={task.id}
        >
          {task.id}
        </span>
      ) : null}

      {hasColumn("assignee") ? (
        <span
          style={columnStyle("assignee")}
          className={cellClassName(
            "assignee",
            `${LIST_COL.assignee} shrink-0 whitespace-normal`
          )}
        >
          <AssigneeMenu
            emails={task.assignees}
            assignees={assignees}
            agentEmail={task.agent_email}
            agentMembersByAgent={agentMembersByAgent}
            labelByEmail={personLabelByEmail}
            canAssign={canAssign}
            onToggle={(email, assigned) => onAssigneeChange(task.id, email, assigned)}
          />
        </span>
      ) : null}

      {hasColumn("primaryAssignee") ? (
        <span
          style={columnStyle("primaryAssignee")}
          className={cellClassName(
            "primaryAssignee",
            `flex ${LIST_COL.primaryAssignee} min-w-0 shrink-0 items-center text-xs font-semibold text-[#42526e]`
          )}
          title={primaryAssigneeLabel}
        >
          <PersonInline email={task.assignee_email} label={primaryAssigneeLabel} />
        </span>
      ) : null}

      {hasColumn("assignedAt") ? (
        <span
          style={columnStyle("assignedAt")}
          className={cellClassName(
            "assignedAt",
            `${LIST_COL.assignedAt} shrink-0 truncate text-[11px] font-medium text-[#6b778c]`
          )}
          title={formatDateTime(task.assignee_started_at)}
        >
          {formatShortDateTime(task.assignee_started_at)}
        </span>
      ) : null}

      {hasColumn("agent") ? (
        <span
          style={columnStyle("agent")}
          className={cellClassName("agent", `${LIST_COL.agent} min-w-0 shrink-0`)}
        >
          <AgentMenu
            email={task.agent_email}
            agents={agents}
            labelByEmail={personLabelByEmail}
            canEdit={canEditContent}
            onChange={(agentEmail) => onPatch(task.id, { agent_email: agentEmail })}
          />
        </span>
      ) : null}

      {!configuredColumns && hasColumn("summary") ? (
        <div className={`flex ${summaryClassName} items-center gap-1.5`}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task.id);
            }}
            className="w-full min-w-0 truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
            title={task.title || "Unnamed task"}
          >
            <span className="block truncate">{task.title || "Unnamed task"}</span>
          </button>
          {isNewAssigned ? <NewAssignedBadge /> : null}
          <TaskRowFlags task={task} isOverdue={isOverdue} />
        </div>
      ) : null}

      {hasColumn("description") ? (
        <span
          style={columnStyle("description")}
          className={cellClassName(
            "description",
            `${LIST_COL.description} shrink-0 truncate text-xs font-medium text-[#6b778c]`
          )}
          title={task.description ?? "No description"}
        >
          {task.description?.trim() || "—"}
        </span>
      ) : null}

      {hasColumn("category") ? (
        <span
          style={columnStyle("category")}
          className={cellClassName("category", categoryClassName)}
        >
          <CategoryMenu
            category={category}
            categories={categories}
            canEdit={canEditContent}
            onChange={(categoryId) => onPatch(task.id, { category_id: categoryId })}
          />
        </span>
      ) : null}

      {hasColumn("reporter") ? (
        <span
          style={columnStyle("reporter")}
          className={cellClassName(
            "reporter",
            `flex ${LIST_COL.reporter} min-w-0 shrink-0 items-center text-xs font-semibold text-[#42526e]`
          )}
          title={reporterLabel}
        >
          <PersonInline email={task.reporter_email} label={reporterLabel} />
        </span>
      ) : null}

      {hasColumn("created") ? (
        <span
          style={columnStyle("created")}
          className={cellClassName(
            "created",
            `${LIST_COL.created} shrink-0 text-[11px] font-medium text-[#6b778c]`
          )}
        >
          {formatShortDate(task.created_at)}
        </span>
      ) : null}

      {hasColumn("updated") ? (
        <span
          style={columnStyle("updated")}
          className={cellClassName(
            "updated",
            `${LIST_COL.updated} shrink-0 truncate text-[11px] font-medium text-[#6b778c]`
          )}
          title={formatDateTime(task.updated_at)}
        >
          {formatShortDateTime(task.updated_at)}
        </span>
      ) : null}

      {hasColumn("activity") ? (
        <span
          style={columnStyle("activity")}
          className={cellClassName(
            "activity",
            `${LIST_COL.activity} shrink-0 truncate text-[11px] font-medium text-[#6b778c]`
          )}
          title={task.last_activity_at ? formatDateTime(task.last_activity_at) : "No activity yet"}
        >
          {task.last_activity_at ? formatShortDateTime(task.last_activity_at) : "—"}
        </span>
      ) : null}

      {hasColumn("activityBy") ? (
        <span
          style={columnStyle("activityBy")}
          className={cellClassName(
            "activityBy",
            `flex ${LIST_COL.activityBy} min-w-0 shrink-0 items-center text-xs font-semibold text-[#42526e]`
          )}
          title={activityByLabel}
        >
          <PersonInline email={task.last_activity_by_email} label={activityByLabel} />
        </span>
      ) : null}

      {hasColumn("comments") ? (
        <span
          style={columnStyle("comments")}
          className={cellClassName(
            "comments",
            `flex ${LIST_COL.comments} shrink-0 justify-center text-xs font-bold text-[#42526e]`
          )}
          title="Comment count"
        >
          {task.comment_count ?? 0}
        </span>
      ) : null}

      {hasColumn("attachments") ? (
        <span
          style={columnStyle("attachments")}
          className={cellClassName(
            "attachments",
            `flex ${LIST_COL.attachments} shrink-0 justify-center text-xs font-bold text-[#42526e]`
          )}
          title="Attachment count"
        >
          {task.attachment_count ?? 0}
        </span>
      ) : null}

      {hasColumn("fub") ? (
        <span
          style={columnStyle("fub")}
          className={cellClassName("fub", `flex ${LIST_COL.fub} shrink-0 justify-center`)}
        >
          <TaskFubLink href={task.fub_link} empty />
        </span>
      ) : null}

      {hasColumn("sla") ? (
        <span
          style={columnStyle("sla")}
          className={cellClassName(
            "sla",
            `${LIST_COL.sla} shrink-0 truncate text-[11px] font-semibold text-[#42526e]`
          )}
          title={`${slaMinutes} SLA minutes`}
        >
          {formatDurationMinutes(slaMinutes)}
        </span>
      ) : null}

      {hasColumn("slaRemaining") ? (
        <span
          style={columnStyle("slaRemaining")}
          className={cellClassName(
            "slaRemaining",
            `${LIST_COL.slaRemaining} shrink-0 truncate text-[11px] font-semibold ${timeReport.className}`
          )}
          title={timeReport.title}
        >
          {timeReport.label}
        </span>
      ) : null}

      {hasColumn("overdueCount") ? (
        <span
          style={columnStyle("overdueCount")}
          className={cellClassName(
            "overdueCount",
            `flex ${LIST_COL.overdueCount} shrink-0 justify-center text-xs font-bold ${
              task.overdue_count > 0 ? "text-[#bf2600]" : "text-[#6b778c]"
            }`
          )}
          title="How many times this task went overdue"
        >
          {task.overdue_count}
        </span>
      ) : null}

      {hasColumn("todoTime") ? (
        <DurationCell
          widthClass={LIST_COL.todoTime}
          style={columnStyle("todoTime")}
          cellClassName={pinnedCellClass("todoTime")}
          seconds={stageElapsedSeconds(task.todo_seconds, task.todo_started_at, liveNow ?? undefined)}
        />
      ) : null}

      {hasColumn("progressTime") ? (
        <DurationCell
          widthClass={LIST_COL.progressTime}
          style={columnStyle("progressTime")}
          cellClassName={pinnedCellClass("progressTime")}
          seconds={stageElapsedSeconds(
            task.in_progress_seconds,
            task.in_progress_at,
            liveNow ?? undefined
          )}
        />
      ) : null}

      {hasColumn("waitingTime") ? (
        <DurationCell
          widthClass={LIST_COL.waitingTime}
          style={columnStyle("waitingTime")}
          cellClassName={pinnedCellClass("waitingTime")}
          seconds={stageElapsedSeconds(task.waiting_seconds, task.waiting_started_at, liveNow ?? undefined)}
        />
      ) : null}

      {hasColumn("todoStarted") ? (
        <DateCell
          widthClass={LIST_COL.todoStarted}
          value={task.todo_started_at}
          style={columnStyle("todoStarted")}
          cellClassName={pinnedCellClass("todoStarted")}
        />
      ) : null}

      {hasColumn("progressStarted") ? (
        <DateCell
          widthClass={LIST_COL.progressStarted}
          value={task.in_progress_at}
          style={columnStyle("progressStarted")}
          cellClassName={pinnedCellClass("progressStarted")}
        />
      ) : null}

      {hasColumn("waitingStarted") ? (
        <DateCell
          widthClass={LIST_COL.waitingStarted}
          value={task.waiting_started_at}
          style={columnStyle("waitingStarted")}
          cellClassName={pinnedCellClass("waitingStarted")}
        />
      ) : null}

      {hasColumn("dueSoonNotified") ? (
        <DateCell
          widthClass={LIST_COL.dueSoonNotified}
          value={task.due_soon_notified_at}
          style={columnStyle("dueSoonNotified")}
          cellClassName={pinnedCellClass("dueSoonNotified")}
        />
      ) : null}

      {hasColumn("todoReminded") ? (
        <DateCell
          widthClass={LIST_COL.todoReminded}
          value={task.todo_reminded_at}
          style={columnStyle("todoReminded")}
          cellClassName={pinnedCellClass("todoReminded")}
        />
      ) : null}

      {hasColumn("waitingReminded") ? (
        <DateCell
          widthClass={LIST_COL.waitingReminded}
          value={task.waiting_reminded_at}
          style={columnStyle("waitingReminded")}
          cellClassName={pinnedCellClass("waitingReminded")}
        />
      ) : null}

      {hasColumn("overdueFlagged") ? (
        <DateCell
          widthClass={LIST_COL.overdueFlagged}
          value={task.overdue_flagged_at}
          style={columnStyle("overdueFlagged")}
          cellClassName={pinnedCellClass("overdueFlagged")}
        />
      ) : null}

      {hasColumn("overdueReminded") ? (
        <DateCell
          widthClass={LIST_COL.overdueReminded}
          value={task.overdue_reminded_at}
          style={columnStyle("overdueReminded")}
          cellClassName={pinnedCellClass("overdueReminded")}
        />
      ) : null}

      {hasColumn("overdueUnlocked") ? (
        <DateCell
          widthClass={LIST_COL.overdueUnlocked}
          value={task.overdue_unlocked_at}
          style={columnStyle("overdueUnlocked")}
          cellClassName={pinnedCellClass("overdueUnlocked")}
        />
      ) : null}

      {hasColumn("staleReminded") ? (
        <DateCell
          widthClass={LIST_COL.staleReminded}
          value={task.stale_reminded_at}
          style={columnStyle("staleReminded")}
          cellClassName={pinnedCellClass("staleReminded")}
        />
      ) : null}

      {hasColumn("qcReminded") ? (
        <DateCell
          widthClass={LIST_COL.qcReminded}
          value={task.qc_reminded_at}
          style={columnStyle("qcReminded")}
          cellClassName={pinnedCellClass("qcReminded")}
        />
      ) : null}

      {hasColumn("reopened") ? (
        <DateCell
          widthClass={LIST_COL.reopened}
          value={task.reopened_at}
          style={columnStyle("reopened")}
          cellClassName={pinnedCellClass("reopened")}
        />
      ) : null}

      {hasColumn("closed") ? (
        <DateCell
          widthClass={LIST_COL.closed}
          value={task.closed_at}
          style={columnStyle("closed")}
          cellClassName={pinnedCellClass("closed")}
        />
      ) : null}

      {hasColumn("reviewedBy") ? (
        <span
          style={columnStyle("reviewedBy")}
          className={cellClassName(
            "reviewedBy",
            `flex ${LIST_COL.reviewedBy} min-w-0 shrink-0 items-center text-xs font-semibold text-[#42526e]`
          )}
          title={reviewedByLabel}
        >
          <PersonInline email={task.done_reviewed_by_email} label={reviewedByLabel} />
        </span>
      ) : null}

      {hasColumn("reviewedAt") ? (
        <DateCell
          widthClass={LIST_COL.reviewedAt}
          value={task.done_reviewed_at}
          style={columnStyle("reviewedAt")}
          cellClassName={pinnedCellClass("reviewedAt")}
        />
      ) : null}

      {hasColumn("position") ? (
        <span
          style={columnStyle("position")}
          className={cellClassName(
            "position",
            `flex ${LIST_COL.position} shrink-0 justify-center text-[11px] font-semibold text-[#6b778c]`
          )}
          title="Manual board position"
        >
          {Number.isFinite(task.position) ? task.position.toFixed(2) : "—"}
        </span>
      ) : null}

      {hasColumn("priority") ? (
        <span
          className={cellClassName(
            "priority",
            `flex ${LIST_COL.priority} shrink-0 justify-start gap-1.5 text-xs font-bold`
          )}
          title={`${PRIORITY_META[task.priority].label} priority`}
          style={{
            ...(columnStyle("priority") ?? {}),
            color: PRIORITY_META[task.priority].color,
          }}
        >
          <PriorityIcon priority={task.priority} className="h-4 w-4" />
          <span>{PRIORITY_META[task.priority].label}</span>
        </span>
      ) : null}

      {hasColumn("status") ? (
        <StatusPill
          status={task.status}
          assigned={task.assignees.length > 0}
          canChangeStatus={canChangeStatus}
          hasBeenInProgress={
            task.status === "in_progress" ||
            Boolean(task.in_progress_at) ||
            task.in_progress_seconds > 0
          }
          isOverdueLocked={isOverdue}
          onChange={(status) => onPatch(task.id, { status })}
          onUnlockOverdueRequest={onUnlockOverdueRequest}
          onReopenRequest={onReopenRequest}
          cellStyle={columnStyle("status")}
          cellClassName={pinnedCellClass("status")}
        />
      ) : null}

      {hasColumn("review") ? (
        <span
          style={columnStyle("review")}
          className={cellClassName("review", `flex ${LIST_COL.review} shrink-0 justify-center`)}
        >
          <DoneReviewPill
            task={task}
            canReviewDone={canReviewDone}
            onReviewDone={onReviewDone}
          />
        </span>
      ) : null}

      {customColumns.map((column) => {
        const configColumn = column.configColumn;
        if (!configColumn) return null;
        return (
          <span
            key={column.key}
            style={columnStyle(column.key)}
            className={`${LIST_COL.custom} flex min-w-0 shrink-0 items-center ${
              configColumn.type === "checkbox" ? "justify-center" : ""
            } ${pinnedCellClass(column.key)}`}
          >
            <EditableCustomCell
              column={configColumn}
              value={task.custom_values?.[configColumn.key]}
              options={customOptionsByColumnId.get(configColumn.id) ?? []}
              people={assignees}
              optionLabelById={customOptionLabelById}
              personLabelByEmail={personLabelByEmail}
              canEdit={canEditContent}
              onSave={(next) =>
                onPatch(task.id, { custom_values: { [configColumn.key]: next } })
              }
              className={configColumn.type === "checkbox" ? "" : "w-full"}
            />
          </span>
        );
      })}

    </div>
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function DateCell({
  widthClass,
  value,
  style,
  cellClassName = "",
}: {
  widthClass: string;
  value: string | null | undefined;
  style?: CSSProperties;
  cellClassName?: string;
}) {
  return (
    <span
      style={style}
      className={`${widthClass} shrink-0 truncate text-[11px] font-medium text-[#6b778c] ${cellClassName}`}
      title={formatDateTime(value)}
    >
      {formatShortDateTime(value)}
    </span>
  );
}

function DurationCell({
  widthClass,
  seconds,
  style,
  cellClassName = "",
}: {
  widthClass: string;
  seconds: number;
  style?: CSSProperties;
  cellClassName?: string;
}) {
  return (
    <span
      style={style}
      className={`${widthClass} shrink-0 truncate text-[11px] font-semibold text-[#42526e] ${cellClassName}`}
      title={`${Math.max(0, Math.round(seconds))} seconds`}
    >
      {formatDurationSeconds(seconds)}
    </span>
  );
}

function TaskFubLink({
  href,
  empty = false,
}: {
  href: string | null | undefined;
  empty?: boolean;
}) {
  if (!href) {
    return empty ? (
      <span className="text-[11px] font-semibold text-[#97a0af]">—</span>
    ) : null;
  }

  return (
    <a
      href={formatExternalLink(href)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      title="Open FUB"
      aria-label="Open FUB"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:bg-[#cce0ff]"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function buildTimeReport(
  task: TaskRow,
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  now: Date | null
): { label: string; title: string; className: string } {
  if (!now) {
    return {
      label: "—",
      title: "Time report is not available yet.",
      className: "text-[#6b778c]",
    };
  }

  switch (task.status) {
    case "backlog": {
      const elapsed = elapsedSinceSeconds(task.created_at, now);
      return {
        label: `Backlog for ${formatDurationSeconds(elapsed)}`,
        title: "Time since this task was created.",
        className: "text-[#6b778c]",
      };
    }
    case "todo": {
      const elapsed = stageElapsedSeconds(
        task.todo_seconds,
        task.todo_started_at,
        now
      );
      return {
        label: `To do for ${formatDurationSeconds(elapsed)}`,
        title: "Total time spent in To Do, including the current stint.",
        className: "text-[#42526e]",
      };
    }
    case "in_progress": {
      if (isSlaActiveInProgress(task)) {
        const remaining = slaRemainingSeconds(task, rules, now);
        if (remaining <= 0) {
          return {
            label: formatSlaRemaining(remaining),
            title: "Active In Progress SLA is overdue.",
            className: "text-[#bf2600]",
          };
        }

        return {
          label: `SLA left ${formatDurationSeconds(remaining)}`,
          title: "Active In Progress SLA countdown.",
          className: "text-[#0c66e4]",
        };
      }

      const elapsed = stageElapsedSeconds(
        task.in_progress_seconds,
        task.in_progress_at,
        now
      );
      return {
        label: `In progress for ${formatDurationSeconds(elapsed)}`,
        title:
          "Total time spent in In Progress. SLA countdown is no longer active after waiting or an overdue unlock.",
        className: "text-[#42526e]",
      };
    }
    case "waiting": {
      const elapsed = stageElapsedSeconds(
        task.waiting_seconds,
        task.waiting_started_at,
        now
      );
      return {
        label: `Waiting for ${formatDurationSeconds(elapsed)}`,
        title: "Total time spent in Waiting, including the current stint.",
        className: "text-[#7f5f01]",
      };
    }
    case "done": {
      if (!task.closed_at) {
        return {
          label: "Done",
          title: "Task is done.",
          className: "text-[#006644]",
        };
      }
      return {
        label: `Done ${formatDurationSeconds(elapsedSinceSeconds(task.closed_at, now))} ago`,
        title: "Time since this task was marked Done.",
        className: "text-[#006644]",
      };
    }
    case "cancel": {
      if (!task.closed_at) {
        return {
          label: "Canceled",
          title: "Task is canceled.",
          className: "text-[#6b778c]",
        };
      }
      return {
        label: `Canceled ${formatDurationSeconds(elapsedSinceSeconds(task.closed_at, now))} ago`,
        title: "Time since this task was canceled.",
        className: "text-[#6b778c]",
      };
    }
  }
}

function elapsedSinceSeconds(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((now.getTime() - start) / 1000));
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatShortDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatShortDate(value)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")} UTC`;
}

function formatExternalLink(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function TaskRowFlags({
  task,
  isOverdue,
}: {
  task: TaskRow;
  isOverdue: boolean;
}) {
  const wasOverdue = !isOverdue && task.overdue_count > 0;
  if (!isOverdue && !wasOverdue && !task.reopened_at) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label="Task flags">
      {isOverdue ? (
        <RowFlagIcon
          title="Overdue: this task is over its SLA."
          tone="danger"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      ) : null}
      {wasOverdue ? (
        <RowFlagIcon
          title={`Was overdue: this task went over its SLA ${task.overdue_count}x.`}
          tone="warning"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      ) : null}
      {task.reopened_at ? (
        <RowFlagIcon
          title="Reopened: this task was reopened."
          tone="info"
          icon={<RotateCcw className="h-3 w-3" />}
        />
      ) : null}
    </span>
  );
}

function RowFlagIcon({
  icon,
  title,
  tone,
}: {
  icon: ReactNode;
  title: string;
  tone: "danger" | "warning" | "info";
}) {
  const className = {
    danger: "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]",
    warning: "border-[#f8e6a0] bg-[#fff7d6] text-[#7f5f01]",
    info: "border-[#b3d4ff] bg-[#deebff] text-[#0055cc]",
  }[tone];

  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${className}`}
      title={title}
      aria-label={title}
    >
      {icon}
    </span>
  );
}

function DoneReviewPill({
  task,
  canReviewDone,
  onReviewDone,
}: {
  task: TaskRow;
  canReviewDone: boolean;
  onReviewDone: (reviewed: boolean) => void;
}) {
  if (task.status !== "done" && task.status !== "cancel") {
    return <span className="text-[11px] font-semibold text-[#97a0af]">—</span>;
  }

  const reviewed = Boolean(task.done_reviewed_at);
  const className = reviewed
    ? "inline-flex h-5 w-5 items-center justify-center rounded border border-[#36b37e] bg-[#e3fcef] text-[#006644]"
    : "inline-flex h-5 w-5 items-center justify-center rounded border border-[#c1c7d0] bg-white text-transparent";
  const icon = reviewed ? <Check className="h-3.5 w-3.5" /> : null;
  const stopInteractiveEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const stopDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  if (!canReviewDone) {
    return (
      <span className={className} title={reviewed ? "QC checked" : "Waiting for QC"}>
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} transition hover:brightness-95`}
      title={reviewed ? "Clear QC check" : "Mark QC checked"}
      aria-label={reviewed ? "Clear QC check" : "Mark QC checked"}
      aria-pressed={reviewed}
      data-no-dnd="true"
      onPointerDown={stopDragStart}
      onMouseDown={stopInteractiveEvent}
      onTouchStart={stopInteractiveEvent}
      onDoubleClick={stopInteractiveEvent}
      onKeyDown={stopInteractiveEvent}
      onClick={(event) => {
        event.stopPropagation();
        onReviewDone(!reviewed);
      }}
    >
      {icon}
    </button>
  );
}

export function StatusPill({
  status,
  assigned,
  canChangeStatus,
  cellStyle,
  cellClassName = "",
  isOverdueLocked = false,
  hasBeenInProgress = false,
  size = "row",
  onChange,
  onUnlockOverdueRequest,
  onReopenRequest,
}: {
  status: TaskStatus;
  assigned: boolean;
  canChangeStatus: boolean;
  cellStyle?: CSSProperties;
  cellClassName?: string;
  isOverdueLocked?: boolean;
  hasBeenInProgress?: boolean;
  /** "row" (default) is the compact list/board pill. "field" is a full-width,
   * detail-drawer-sized control matching the other TaskSelect-style fields. */
  size?: "row" | "field";
  onChange: (status: TaskStatus) => void;
  onUnlockOverdueRequest?: () => void;
  onReopenRequest?: () => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const meta = STATUS_PILL[status];
  const label = STATUS_LABEL[status];
  const isTerminal = status === "done" || status === "cancel";

  // Backlog membership is governed by assignment (the avatar menu), not this
  // dropdown: assigning moves a task to 'todo', unassigning sends it to backlog.
  // So we never offer 'backlog' here, and we lock the pill while a task is
  // unassigned — that avoids emitting a patch the server rejects (the invariant
  // "non-backlog task must have an assignee" / "unassign before backlog").
  const canUnlockOverdue =
    canChangeStatus && assigned && isOverdueLocked && Boolean(onUnlockOverdueRequest);
  const interactive = canChangeStatus && assigned && !isTerminal && !isOverdueLocked;
  const canReopen = canChangeStatus && isTerminal && Boolean(onReopenRequest);
  const options = TASK_STATUSES.filter(
    (s) =>
      s !== "backlog" &&
      !(s === "todo" && hasBeenInProgress && status !== "todo")
  );
  const showChevron = interactive || canReopen || canUnlockOverdue;

  if (size === "field") {
    const badge = (
      <span
        className="inline-flex shrink-0 items-center rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
        style={{ backgroundColor: meta.bg, color: meta.fg }}
      >
        {label}
      </span>
    );
    const onClick = canUnlockOverdue
      ? onUnlockOverdueRequest
      : canReopen
        ? onReopenRequest
        : interactive
          ? toggle
          : undefined;
    const title = canUnlockOverdue
      ? "Enter a reason to unlock this overdue task"
      : canReopen
        ? "Reopen (reason required)"
        : canChangeStatus && !assigned
          ? "Assign someone (avatar) to move it out of backlog"
          : undefined;

    return (
      <div className={`relative ${cellClassName}`} style={cellStyle}>
        <button
          ref={triggerRef}
          type="button"
          disabled={!onClick}
          onClick={onClick}
          title={title}
          aria-expanded={interactive ? isOpen : undefined}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-left transition hover:border-[#c1c7d0] disabled:cursor-not-allowed disabled:bg-[#f4f5f7]"
        >
          {badge}
          {showChevron ? (
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#667085] transition ${isOpen ? "rotate-180" : ""}`}
            />
          ) : null}
        </button>
        {interactive && isOpen
          ? createPortal(
              <div
                ref={menuRef}
                role="listbox"
                style={menuStyle}
                className="z-[100] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
              >
                {options.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={s === status}
                    onClick={() => {
                      onChange(s);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                      s === status
                        ? "bg-[#e9f2ff] text-[#0c66e4]"
                        : "text-[#172b4d] hover:bg-[#f4f5f7]"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                    {s === status ? <Check className="h-4 w-4 text-[#0c66e4]" /> : null}
                  </button>
                ))}
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }

  const pill = (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {label}
      {interactive || canReopen || canUnlockOverdue ? (
        <ChevronDown className="h-3 w-3" />
      ) : null}
    </span>
  );
  const wrapperClassName = `flex ${LIST_COL.status} shrink-0 justify-start ${cellClassName}`;

  if (canUnlockOverdue) {
    return (
      <span className={wrapperClassName} style={cellStyle}>
        <button
          type="button"
          onClick={onUnlockOverdueRequest}
          title="Enter a reason to unlock this overdue task"
        >
          {pill}
        </button>
      </span>
    );
  }

  // Done/Cancel go back to In Progress through the reason-gated Reopen action, so
  // clicking the pill opens the dialog directly instead of a status list.
  if (canReopen) {
    return (
      <span className={wrapperClassName} style={cellStyle}>
        <button type="button" onClick={onReopenRequest} title="Reopen (reason required)">
          {pill}
        </button>
      </span>
    );
  }

  if (!interactive) {
    return (
      <span
        className={wrapperClassName}
        style={cellStyle}
        title={
          canChangeStatus && !assigned
            ? "Assign someone (avatar) to move it out of backlog"
            : undefined
        }
      >
        {pill}
      </span>
    );
  }

  return (
    <span className={wrapperClassName} style={cellStyle}>
      <button ref={triggerRef} type="button" onClick={toggle} aria-expanded={isOpen}>
        {pill}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {options.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={s === status}
                  onClick={() => {
                    onChange(s);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    s === status
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  {STATUS_LABEL[s]}
                  {s === status ? <Check className="h-4 w-4 text-[#0c66e4]" /> : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function CategoryMenu({
  category,
  categories,
  canEdit,
  onChange,
}: {
  category: TaskCategory | null;
  categories: TaskCategory[];
  canEdit: boolean;
  onChange: (categoryId: string) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const currentLabel = category?.name ?? "No category";
  const currentCategoryMissing =
    Boolean(category) && !categories.some((item) => item.id === category?.id);
  const options = [
    ...(currentCategoryMissing && category ? [category] : []),
    ...categories,
  ];

  if (!canEdit) {
    return category ? (
      <CategoryBadge category={category} />
    ) : (
      <span className="min-w-0 truncate text-xs font-semibold text-[#6b778c]">
        No category
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={options.length === 0}
        aria-expanded={isOpen}
        title={options.length === 0 ? "No categories available" : currentLabel}
        className={
          category
            ? "flex min-w-0 items-center rounded text-left transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <>
            <Tag className="h-3 w-3 shrink-0" />
            <span>Category</span>
          </>
        )}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] min-w-[16rem] rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                Category
              </div>
              <div className="max-h-56 overflow-auto">
                {options.map((option) => {
                  const selected = option.id === category?.id;
                  const palette = taskCategoryPalette(option);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        if (!selected) onChange(option.id);
                        setIsOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                        selected
                          ? "bg-[#e9f2ff] text-[#0c66e4]"
                          : "text-[#172b4d] hover:bg-[#f4f5f7]"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: palette.background }}
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {option.name}
                      </span>
                      {selected ? (
                        <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function CategoryBadge({ category }: { category: TaskCategory }) {
  const palette = taskCategoryBadgePalette(category);

  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      title={category.name}
      style={{
        backgroundColor: palette.background,
        color: palette.foreground,
      }}
    >
      <span className="min-w-0 truncate">{category.name}</span>
    </span>
  );
}

function PersonInline({
  email,
  label,
  emptyLabel = "—",
}: {
  email: string | null | undefined;
  label: string;
  emptyLabel?: string;
}) {
  if (!email) {
    return <span className="min-w-0 truncate text-[#97a0af]">{emptyLabel}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Initials email={email} label={label} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function AgentMenu({
  email,
  agents,
  labelByEmail,
  canEdit,
  onChange,
}: {
  email: string | null;
  agents: TaskAgent[];
  labelByEmail: ReadonlyMap<string, string>;
  canEdit: boolean;
  onChange: (email: string) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const currentLabel = email
    ? labelByEmail.get(email) ?? formatEmailAsName(email)
    : "No agent";
  const currentAgentMissing =
    Boolean(email) && !agents.some((agent) => agent.email === email);
  const options = [
    ...(currentAgentMissing && email ? [{ email, name: currentLabel }] : []),
    ...agents,
  ].sort((a, b) =>
    (a.name?.trim() || formatEmailAsName(a.email)).localeCompare(
      b.name?.trim() || formatEmailAsName(b.email)
    )
  );

  if (!canEdit) {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]"
        title={currentLabel}
      >
        {email ? (
          <>
            <Initials email={email} label={currentLabel} />
            <span className="whitespace-nowrap">{currentLabel}</span>
          </>
        ) : (
          <span className="min-w-0 truncate text-[#6b778c]">No agent</span>
        )}
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={options.length === 0}
        aria-expanded={isOpen}
        title={options.length === 0 ? "No agents available" : currentLabel}
        className={
          email
            ? "flex min-w-0 items-center gap-1.5 rounded text-left text-xs font-semibold text-[#42526e] transition hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {email ? (
          <>
            <Initials email={email} label={currentLabel} />
            <span className="whitespace-nowrap">{currentLabel}</span>
          </>
        ) : (
          <>
            <UserPlus className="h-3 w-3 shrink-0" />
            <span>Agent</span>
          </>
        )}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] min-w-[16rem] rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                Agent
              </div>
              <div className="max-h-56 overflow-auto">
                {options.map((agent) => {
                  const label =
                    agent.name?.trim() ||
                    labelByEmail.get(agent.email) ||
                    formatEmailAsName(agent.email);
                  const selected = agent.email === email;
                  return (
                    <button
                      key={agent.email}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        if (!selected) onChange(agent.email);
                        setIsOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                        selected
                          ? "bg-[#e9f2ff] text-[#0c66e4]"
                          : "text-[#172b4d] hover:bg-[#f4f5f7]"
                      }`}
                    >
                      <Initials email={agent.email} label={label} />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {label}
                      </span>
                      {selected ? (
                        <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function AssigneeMenu({
  emails,
  assignees,
  agentEmail,
  agentMembersByAgent,
  labelByEmail,
  canAssign,
  onToggle,
}: {
  emails: string[];
  assignees: TaskAssignee[];
  agentEmail: string | null;
  agentMembersByAgent: Record<string, string[]>;
  labelByEmail: ReadonlyMap<string, string>;
  canAssign: boolean;
  onToggle: (email: string, assigned: boolean) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  const selectedLabel =
    emails.length > 0
      ? emails.map((email) => labelByEmail.get(email) ?? formatEmailAsName(email)).join(", ")
      : "Unassigned";
  const assignedPeople = emails.map((email) => ({
    email,
    label: labelByEmail.get(email) ?? formatEmailAsName(email),
  }));
  const isUnassigned = emails.length === 0;
  const labelClassName = emails.length > 0 ? "text-[#42526e]" : "text-[#97a0af]";

  if (!canAssign) {
    return (
      <span
        className={`flex w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal text-left text-xs font-semibold leading-tight ${labelClassName}`}
        title={selectedLabel}
      >
        {assignedPeople.length > 0 ? (
          assignedPeople.map((person) => (
            <span
              key={person.email}
              className="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
            >
              <Initials email={person.email} label={person.label} />
              <span>{person.label}</span>
            </span>
          ))
        ) : (
          <span className="text-[#97a0af]">Unassigned</span>
        )}
      </span>
    );
  }

  return (
    <span className="block min-w-0 whitespace-normal">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        title={selectedLabel}
        className={
          isUnassigned
            ? "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff]"
            : `flex w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal rounded text-left text-xs font-semibold leading-tight transition hover:text-[#0c66e4] ${labelClassName}`
        }
      >
        {isUnassigned ? (
          <>
            <UserPlus className="h-3 w-3 shrink-0" />
            <span>Assign</span>
          </>
        ) : (
          assignedPeople.map((person) => (
            <span
              key={person.email}
              className="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
            >
              <Initials email={person.email} label={person.label} />
              <span>{person.label}</span>
            </span>
          ))
        )}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] min-w-[18rem] rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <TaskAssigneePicker
                assignees={assignees}
                selectedEmails={emails}
                agentEmail={agentEmail}
                agentMembersByAgent={agentMembersByAgent}
                onToggle={onToggle}
                listClassName="max-h-48"
                autoFocus
              />
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
