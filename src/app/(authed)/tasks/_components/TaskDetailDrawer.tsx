"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Circle, ExternalLink, X } from "lucide-react";
import type { TaskPriority, TaskRow, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { formatEmailAsName } from "@/lib/tasks/people";
import type { TaskDetail, TaskDetailMetadata } from "@/lib/tasks/detail";
import {
  getCachedTaskDetail,
  setCachedTaskDetail,
} from "@/lib/tasks/detail-cache";
import { taskKey } from "@/lib/tasks/sorting";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
import { OverdueLog } from "./OverdueLog";
import { StageTimeBreakdown } from "./StageTimeBreakdown";
import { StatusPill } from "./TaskRowItem";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";
import { AvatarStack } from "./board-ui";
import { TaskAssigneeDropdown } from "./TaskAssigneePicker";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";

const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const SIDE_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none border-[#dfe1e6] bg-white";
const CUSTOM_FIELD_DISPLAY_CLASS =
  "h-9 w-full rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] hover:border-[#c1c7d0] hover:bg-white disabled:bg-[#f4f5f7]";
const CUSTOM_FIELD_INPUT_CLASS =
  "h-9 w-full rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4]";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";
// shrink-0: these sit above the comment thread in a flex column, so they must
// keep their natural height and let the thread absorb the leftover space.
const COMPACT_DETAIL_FIELD_CLASS = "block shrink-0 space-y-1";
const COMPACT_DETAIL_INPUT_CLASS = `${INPUT_CLASS} h-9 !px-2 !py-1.5 font-semibold`;
const COMPACT_DESCRIPTION_CLASS = `${INPUT_CLASS} min-h-[72px] resize-none overflow-hidden !px-2 !py-2 leading-6`;
const INVALID_RING_CLASS = "!ring-2 !ring-[#ff5630] !ring-offset-1";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
}

type DetailTab = "comments" | "activity" | "overdue";
type DraftKey = "summary" | "description" | "fub";

export function TaskDetailDrawer({
  task,
  canEdit,
  canAssign,
  canDelete,
  canChangeStatus,
  isOverdue,
  assignees,
  agentMembersByAgent,
  agents,
  mentionMembers,
  categories,
  detailColumns,
  configuredColumnKeys,
  visibleColumnKeys,
  requiredColumnKeys,
  columnByKey,
  tableColumnOptions,
  currentEmail,
  canReviewDone,
  canViewNonCommentDetail,
  highlightCommentId,
  onClose,
  onPatch,
  onReviewDone,
  onAssigneeChange,
  onDelete,
  onReopenRequest,
  onUnlockOverdueRequest,
  onParentUpdatedAt,
  onMetadataUpdated,
}: {
  task: TaskRow;
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
  isOverdue: boolean;
  assignees: TaskAssignee[];
  agentMembersByAgent: Record<string, string[]>;
  agents: TaskAgent[];
  mentionMembers: TaskAssignee[];
  categories: TaskCategory[];
  detailColumns: TableColumn[];
  configuredColumnKeys: ReadonlySet<string>;
  visibleColumnKeys: ReadonlySet<string>;
  requiredColumnKeys: ReadonlySet<string>;
  columnByKey: ReadonlyMap<string, { label: string }>;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  canReviewDone: boolean;
  canViewNonCommentDetail: boolean;
  highlightCommentId?: string | null;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onReviewDone: (reviewed: boolean) => void;
  onAssigneeChange: (email: string, assigned: boolean) => void;
  onDelete: () => Promise<void>;
  onReopenRequest: () => void;
  onUnlockOverdueRequest: () => void;
  onParentUpdatedAt?: (updatedAt: string) => void;
  onMetadataUpdated?: (metadata: TaskDetailMetadata) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [fubLink, setFubLink] = useState(task.fub_link ?? "");
  const draftStateRef = useRef<Record<DraftKey, { dirty: boolean; base: string }>>({
    summary: { dirty: false, base: task.title },
    description: { dirty: false, base: task.description ?? "" },
    fub: { dirty: false, base: task.fub_link ?? "" },
  });
  const [draftConflictKeys, setDraftConflictKeys] = useState<ReadonlySet<DraftKey>>(
    new Set()
  );
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(
    () => getCachedTaskDetail(task.id) ?? null
  );
  const [tab, setTab] = useState<DetailTab>("comments");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const onMetadataUpdatedRef = useRef(onMetadataUpdated);
  useEffect(() => {
    onMetadataUpdatedRef.current = onMetadataUpdated;
  }, [onMetadataUpdated]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/detail`);
      if (!res.ok) return;
      const data = (await res.json()) as TaskDetail;
      setCachedTaskDetail(task.id, data);
      setDetail(data);
      if (data.metadata) onMetadataUpdatedRef.current?.(data.metadata);
    } catch {
      // The next mutation/realtime ping retries.
    }
  }, [task.id]);

  useEffect(() => {
    autosizeTextarea(descriptionRef.current);
  }, [description]);

  useEffect(() => {
    const draft = draftStateRef.current.summary;
    if (draft.dirty) {
      if (draft.base !== task.title) {
        setDraftConflictKeys((current) =>
          current.has("summary") ? current : new Set([...current, "summary"])
        );
      }
      return;
    }
    draft.base = task.title;
    setTitle(task.title);
  }, [task.title]);

  useEffect(() => {
    const nextDescription = task.description ?? "";
    const draft = draftStateRef.current.description;
    if (draft.dirty) {
      if (draft.base !== nextDescription) {
        setDraftConflictKeys((current) =>
          current.has("description")
            ? current
            : new Set([...current, "description"])
        );
      }
      return;
    }
    draft.base = nextDescription;
    setDescription(nextDescription);
  }, [task.description]);

  useEffect(() => {
    const nextFubLink = task.fub_link ?? "";
    const draft = draftStateRef.current.fub;
    if (draft.dirty) {
      if (draft.base !== nextFubLink) {
        setDraftConflictKeys((current) =>
          current.has("fub") ? current : new Set([...current, "fub"])
        );
      }
      return;
    }
    draft.base = nextFubLink;
    setFubLink(nextFubLink);
  }, [task.fub_link]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!highlightCommentId) return;
    const timer = window.setTimeout(() => setTab("comments"), 0);
    return () => window.clearTimeout(timer);
  }, [highlightCommentId]);

  useEffect(() => {
    if (canViewNonCommentDetail || tab === "comments") return;
    const timer = window.setTimeout(() => setTab("comments"), 0);
    return () => window.clearTimeout(timer);
  }, [canViewNonCommentDetail, tab]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const agentOptions = agents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || formatEmailAsName(agent.email),
  }));
  const personLabelByEmail = new Map<string, string>();
  for (const agent of agents) {
    personLabelByEmail.set(
      agent.email,
      agent.name?.trim() || formatEmailAsName(agent.email)
    );
  }
  for (const assignee of assignees) {
    personLabelByEmail.set(
      assignee.email,
      assignee.name?.trim() || formatEmailAsName(assignee.email)
    );
  }
  for (const member of mentionMembers) {
    personLabelByEmail.set(
      member.email,
      member.name?.trim() || formatEmailAsName(member.email)
    );
  }
  if (!personLabelByEmail.has(currentEmail)) {
    personLabelByEmail.set(currentEmail, formatEmailAsName(currentEmail));
  }
  const optionLabelById = new Map(
    tableColumnOptions.map((option) => [option.id, option.label])
  );
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    current.push(option);
    optionsByColumnId.set(option.column_id, current);
  }
  const fubHref = formatExternalLink(fubLink);
  const overdueLog =
    detail?.activity.filter(
      (a) =>
        a.type === "overdue_resolved" ||
        a.type === "overdue_unlocked" ||
        a.type === "task_reopened"
    ) ?? [];
  const canReopen = canChangeStatus && (task.status === "done" || task.status === "cancel");
  const showField = (key: string) =>
    !configuredColumnKeys.has(key) || visibleColumnKeys.has(key);
  const showTitle = showField("summary");
  const showFub = showField("fub");
  const showDescription = showField("description");
  const showStageTime = (["todoTime", "progressTime", "waitingTime"] as const).some(
    showField
  );
  const showPriority = showField("priority");
  const showCategory = showField("category");
  const showAgent = showField("agent");
  const showCreatedBy = showField("reporter");
  const showAssignees = showField("assignee");
  const showQcReview = showField("review");
  const showStage = showField("status");
  const hasBeenInProgress =
    task.status === "in_progress" ||
    Boolean(task.in_progress_at) ||
    task.in_progress_seconds > 0;
  const visibleDetailColumns = detailColumns;

  function markInvalid(key: string) {
    setInvalidKeys((current) => new Set([...current, key]));
  }
  function clearInvalid(key: string) {
    setInvalidKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }
  const isInvalid = (key: string) => invalidKeys.has(key);

  function beginDraft(key: DraftKey, base: string) {
    const draft = draftStateRef.current[key];
    if (draft.dirty) return;
    draft.dirty = true;
    draft.base = base;
  }

  function finishDraft(key: DraftKey) {
    draftStateRef.current[key].dirty = false;
    setDraftConflictKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  const hasDraftConflict = (key: DraftKey) => draftConflictKeys.has(key);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <span className="font-mono text-sm font-bold text-[#97a0af]">
            {taskKey(task.id)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* On wide screens each column owns its scrolling, which is what keeps
            the comment composer docked at the bottom no matter how long the
            thread gets. Narrow screens keep the simpler single-scroll layout. */}
        <div className="flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
              {showTitle ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("summary")?.label ?? "Client Name"}
                    {requiredColumnKeys.has("summary") ? REQUIRED_MARK : null}
                  </span>
                  <input
                    value={title}
                    disabled={!canEdit}
                    onChange={(e) => {
                      beginDraft("summary", task.title);
                      setTitle(e.target.value);
                      clearInvalid("summary");
                    }}
                    onBlur={() => {
                      if (!canEdit) return;
                      const trimmed = title.trim();
                      if (requiredColumnKeys.has("summary") && !trimmed) {
                        setTitle(task.title);
                        finishDraft("summary");
                        markInvalid("summary");
                        return;
                      }
                      if (trimmed && title !== task.title) {
                        onPatch({ title: trimmed });
                      }
                      finishDraft("summary");
                    }}
                    className={`${COMPACT_DETAIL_INPUT_CLASS} ${isInvalid("summary") ? INVALID_RING_CLASS : ""}`}
                  />
                  {hasDraftConflict("summary") ? (
                    <span role="alert" className="text-xs font-semibold text-[#bf2600]">
                      This value changed elsewhere while you were editing. Review before saving.
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("fub")?.label ?? "FUB Link"}
                    {requiredColumnKeys.has("fub") ? REQUIRED_MARK : null}
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      value={fubLink}
                      disabled={!canEdit}
                      onChange={(e) => {
                        beginDraft("fub", task.fub_link ?? "");
                        setFubLink(e.target.value);
                        clearInvalid("fub");
                      }}
                      onBlur={() => {
                        if (!canEdit) return;
                        const next = fubLink.trim();
                        if (requiredColumnKeys.has("fub") && !next) {
                          setFubLink(task.fub_link ?? "");
                          finishDraft("fub");
                          markInvalid("fub");
                          return;
                        }
                        if (next !== (task.fub_link ?? "")) {
                          onPatch({ fub_link: next || null });
                        }
                        finishDraft("fub");
                      }}
                      placeholder="No FUB link"
                      className={`${COMPACT_DETAIL_INPUT_CLASS} ${isInvalid("fub") ? INVALID_RING_CLASS : ""}`}
                    />
                    {fubHref ? (
                      <a
                        href={fubHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open FUB link"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                  {hasDraftConflict("fub") ? (
                    <span role="alert" className="text-xs font-semibold text-[#bf2600]">
                      This value changed elsewhere while you were editing. Review before saving.
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showDescription ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("description")?.label ?? "Description"}
                    {requiredColumnKeys.has("description") ? REQUIRED_MARK : null}
                  </span>
                  <textarea
                    ref={descriptionRef}
                    value={description}
                    disabled={!canEdit}
                    onChange={(e) => {
                      beginDraft("description", task.description ?? "");
                      setDescription(e.target.value);
                      autosizeTextarea(e.currentTarget);
                      clearInvalid("description");
                    }}
                    onBlur={() => {
                      if (!canEdit) return;
                      if (requiredColumnKeys.has("description") && !description.trim()) {
                        setDescription(task.description ?? "");
                        finishDraft("description");
                        markInvalid("description");
                        return;
                      }
                      if (description !== (task.description ?? "")) {
                        onPatch({ description });
                      }
                      finishDraft("description");
                    }}
                    rows={2}
                    placeholder="Add a description…"
                    className={`${COMPACT_DESCRIPTION_CLASS} ${isInvalid("description") ? INVALID_RING_CLASS : ""}`}
                  />
                  {hasDraftConflict("description") ? (
                    <span role="alert" className="text-xs font-semibold text-[#bf2600]">
                      This value changed elsewhere while you were editing. Review before saving.
                    </span>
                  ) : null}
                </label>
              ) : null}

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
                  <DetailTabButton
                    label="Comments"
                    count={detail?.comments.length ?? 0}
                    active={tab === "comments"}
                    onClick={() => setTab("comments")}
                  />
                  {canViewNonCommentDetail ? (
                    <>
                      <DetailTabButton
                        label="Activity"
                        count={detail?.activity.length ?? 0}
                        active={tab === "activity"}
                        onClick={() => setTab("activity")}
                      />
                      <DetailTabButton
                        label="Overdue"
                        count={overdueLog.length}
                        active={tab === "overdue"}
                        onClick={() => setTab("overdue")}
                      />
                    </>
                  ) : null}
                </div>

                {detail === null ? (
                  <DetailSkeleton />
                ) : (
                  <>
                    {tab === "comments" && (
                      <CommentThread
                        taskId={task.id}
                        currentEmail={currentEmail}
                        members={mentionMembers}
                        comments={detail.comments}
                        highlightCommentId={highlightCommentId}
                        onReload={reload}
                        onParentUpdatedAt={onParentUpdatedAt}
                      />
                    )}
                    {tab === "activity" && canViewNonCommentDetail && (
                      <ActivityFeed
                        activity={detail.activity}
                        personLabelByEmail={personLabelByEmail}
                      />
                    )}
                    {tab === "overdue" && canViewNonCommentDetail && (
                      <OverdueLog
                        entries={overdueLog}
                        personLabelByEmail={personLabelByEmail}
                      />
                    )}
                  </>
                )}
              </section>
            </main>

            <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
              {showStageTime ? <StageTimeBreakdown task={task} /> : null}
              <div className="space-y-3">
                {showPriority ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("priority")?.label ?? "Priority"}
                      {requiredColumnKeys.has("priority") ? REQUIRED_MARK : null}
                    </span>
                    <TaskPrioritySelect
                      value={task.priority}
                      disabled={!canEdit}
                      buttonClassName="!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none"
                      onChange={(nextPriority) =>
                        onPatch({ priority: nextPriority as TaskPriority })
                      }
                    />
                  </div>
                ) : null}

                {showCategory ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("category")?.label ?? "Category"}
                      {requiredColumnKeys.has("category") ? REQUIRED_MARK : null}
                    </span>
                    <TaskSelect
                      label={columnByKey.get("category")?.label ?? "Category"}
                      value={task.category_id ?? ""}
                      disabled={!canEdit}
                      options={categoryOptions}
                      placeholder="Select category"
                      buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                      onChange={(nextCategoryId) => onPatch({ category_id: nextCategoryId })}
                    />
                  </div>
                ) : null}

                {showAgent ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("agent")?.label ?? "Agent"}
                      {requiredColumnKeys.has("agent") ? REQUIRED_MARK : null}
                    </span>
                    <TaskSelect
                      label={columnByKey.get("agent")?.label ?? "Agent"}
                      value={task.agent_email ?? ""}
                      disabled={!canEdit}
                      options={agentOptions}
                      placeholder="Select agent"
                      buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                      onChange={(nextAgent) => onPatch({ agent_email: nextAgent })}
                    />
                  </div>
                ) : null}

                {showCreatedBy ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("reporter")?.label ?? "Created by"}
                    </span>
                    <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                      {task.reporter_email
                        ? personLabelByEmail.get(task.reporter_email) ??
                          formatEmailAsName(task.reporter_email)
                        : "—"}
                    </div>
                  </div>
                ) : null}

                {showAssignees ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("assignee")?.label ?? "Assignees"}
                    </span>
                    {canAssign ? (
                      <TaskAssigneeDropdown
                        assignees={assignees}
                        selectedEmails={task.assignees}
                        agentEmail={task.agent_email}
                        agentMembersByAgent={agentMembersByAgent}
                        onToggle={onAssigneeChange}
                      />
                    ) : (
                      <div className="flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-medium text-[#172b4d]">
                        <AvatarStack emails={task.assignees} labelByEmail={personLabelByEmail} />
                        <span className="min-w-0 truncate">
                          {task.assignees.length > 0
                            ? task.assignees
                                .map(
                                  (email) =>
                                    personLabelByEmail.get(email) ??
                                    formatEmailAsName(email)
                                )
                                .join(", ")
                            : "Unassigned"}
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}

                {showStage ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("status")?.label ?? "Stage"}
                    </span>
                    <StatusPill
                      size="field"
                      status={task.status}
                      assigned={task.assignees.length > 0}
                      canChangeStatus={canChangeStatus}
                      hasBeenInProgress={hasBeenInProgress}
                      isOverdueLocked={isOverdue}
                      onChange={(nextStatus) => onPatch({ status: nextStatus })}
                      onUnlockOverdueRequest={onUnlockOverdueRequest}
                      onReopenRequest={onReopenRequest}
                    />
                  </div>
                ) : null}

                {visibleDetailColumns.map((column) => (
                  <div key={column.id} className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {column.label}
                      {column.required ? REQUIRED_MARK : null}
                    </span>
                    <DetailCustomFieldControl
                      column={column}
                      value={task.custom_values?.[column.key]}
                      options={optionsByColumnId.get(column.id) ?? []}
                      people={assignees}
                      optionLabelById={optionLabelById}
                      personLabelByEmail={personLabelByEmail}
                      canEdit={canEdit}
                      onSave={(next) =>
                        onPatch({ custom_values: { [column.key]: next } })
                      }
                    />
                  </div>
                ))}

                {showQcReview ? (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>
                      {columnByKey.get("review")?.label ?? "QC Review"}
                    </span>
                    <DoneReviewPanel
                      task={task}
                      canReviewDone={canReviewDone}
                      onReviewDone={onReviewDone}
                    />
                  </div>
                ) : null}
              </div>

              {canReopen && (
                <div className="border-t border-[#dfe1e6] pt-3">
                  <button
                    type="button"
                    onClick={onReopenRequest}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                  >
                    Reopen (reason required)
                  </button>
                </div>
              )}

              {canDelete && (
                <div className="border-t border-[#dfe1e6] pt-3">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="text-sm font-semibold text-[#bf2600] transition hover:underline"
                  >
                    Delete task
                  </button>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#091e42]/50 p-4"
          onClick={() => setConfirmingDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[#172b4d]">Delete task?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5e6c84]">
              Xoá vĩnh viễn{" "}
              <span className="font-semibold text-[#172b4d]">{task.title}</span> kèm
              toàn bộ comment và file đính kèm. Không thể hoàn tác.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded px-3 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  void onDelete();
                }}
                className="rounded bg-[#ca3521] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ae2a19]"
              >
                Delete task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCustomFieldControl({
  column,
  value,
  options,
  people,
  optionLabelById,
  personLabelByEmail,
  canEdit,
  onSave,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  people: readonly TaskAssignee[];
  optionLabelById: ReadonlyMap<string, string>;
  personLabelByEmail: ReadonlyMap<string, string>;
  canEdit: boolean;
  onSave: (next: unknown) => Promise<void>;
}) {
  const [saveError, setSaveError] = useState(false);

  if (column.type === "checkbox") {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        disabled={!canEdit}
        aria-pressed={checked}
        onClick={async () => {
          setSaveError(false);
          try {
            await onSave(!checked);
          } catch {
            setSaveError(true);
          }
        }}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7] ${
          saveError ? "ring-2 ring-[#ff5630] ring-offset-1" : ""
        }`}
        title={saveError ? "Save failed. Try again." : column.label}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
            checked
              ? "border-[#00875a] bg-[#00875a] text-white"
              : "border-[#c1c7d0] text-transparent"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        <span>{checked ? "Yes" : "No"}</span>
      </button>
    );
  }

  return (
    <EditableCustomCell
      column={column}
      value={value}
      options={options}
      people={people}
      optionLabelById={optionLabelById}
      personLabelByEmail={personLabelByEmail}
      canEdit={canEdit}
      onSave={onSave}
      className={CUSTOM_FIELD_DISPLAY_CLASS}
      inputClassName={CUSTOM_FIELD_INPUT_CLASS}
      emptyLabel={`No ${column.label}`}
    />
  );
}

function DoneReviewPanel({
  task,
  canReviewDone,
  onReviewDone,
}: {
  task: TaskRow;
  canReviewDone: boolean;
  onReviewDone: (reviewed: boolean) => void;
}) {
  const reviewed = Boolean(task.done_reviewed_at);
  const inReviewStage = task.status === "done" || task.status === "cancel";
  const disabled = !inReviewStage || !canReviewDone;
  const label = reviewed ? "QC checked" : "Needs QC";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={reviewed}
      aria-label={reviewed ? "Clear QC check" : "Mark QC checked"}
      onClick={() => onReviewDone(!reviewed)}
      className="flex h-9 w-full items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7]"
    >
      <span
        className={`shrink-0 ${
          reviewed
            ? "text-[#00875a]"
            : inReviewStage
              ? "text-[#ff991f]"
              : "text-[#97a0af]"
        }`}
      >
        {reviewed ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function DetailTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group -mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-semibold transition ${
        active
          ? "border-[#0c66e4] text-[#0c66e4]"
          : "border-transparent text-[#5e6c84] hover:border-[#c1c7d0] hover:text-[#172b4d]"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition ${
            active
              ? "bg-[#e9f2ff] text-[#0c66e4]"
              : "bg-[#f1f2f4] text-[#626f86] group-hover:bg-[#dfe1e6]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-1/3 animate-pulse rounded bg-[#f1f2f4]" />
      <div className="h-16 w-full animate-pulse rounded bg-[#f1f2f4]" />
      <div className="h-16 w-5/6 animate-pulse rounded bg-[#f1f2f4]" />
    </div>
  );
}

function formatExternalLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
