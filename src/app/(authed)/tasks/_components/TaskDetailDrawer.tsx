"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, X } from "lucide-react";
import type { TaskPriority, TaskRow, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import type { TaskDetail } from "@/lib/tasks/detail";
import { taskKey } from "@/lib/tasks/sorting";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
import { AttachmentPanel } from "./AttachmentPanel";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";
import { AvatarStack } from "./board-ui";
import { TaskAssigneeDropdown } from "./TaskAssigneePicker";

const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const SIDE_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none border-[#dfe1e6] bg-white";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";

const detailCache = new Map<string, TaskDetail>();
type DetailTab = "comments" | "activity" | "attachments";

export function TaskDetailDrawer({
  task,
  canEdit,
  canAssign,
  assignees,
  agentMembersByAgent,
  agents,
  mentionMembers,
  categories,
  currentEmail,
  canReviewDone,
  onClose,
  onPatch,
  onReviewDone,
  onAssigneeChange,
  onDelete,
}: {
  task: TaskRow;
  canEdit: boolean;
  canAssign: boolean;
  assignees: TaskAssignee[];
  agentMembersByAgent: Record<string, string[]>;
  agents: TaskAgent[];
  mentionMembers: TaskAssignee[];
  categories: TaskCategory[];
  currentEmail: string;
  canReviewDone: boolean;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onReviewDone: (reviewed: boolean) => void;
  onAssigneeChange: (email: string, assigned: boolean) => void;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [fubLink, setFubLink] = useState(task.fub_link ?? "");
  const [detail, setDetail] = useState<TaskDetail | null>(
    () => detailCache.get(task.id) ?? null
  );
  const [tab, setTab] = useState<DetailTab>("comments");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/detail`);
      if (!res.ok) return;
      const data = (await res.json()) as TaskDetail;
      detailCache.set(task.id, data);
      setDetail(data);
    } catch {
      // The next mutation/realtime ping retries.
    }
  }, [task.id]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const agentOptions = agents.map((agent) => ({
    value: agent.email,
    label: agent.name ?? agent.email,
  }));
  const personLabelByEmail = new Map<string, string>();
  for (const agent of agents) {
    personLabelByEmail.set(agent.email, agent.name?.trim() || agent.email);
  }
  for (const assignee of assignees) {
    personLabelByEmail.set(
      assignee.email,
      assignee.name?.trim() || assignee.email
    );
  }
  for (const member of mentionMembers) {
    personLabelByEmail.set(member.email, member.name?.trim() || member.email);
  }
  if (!personLabelByEmail.has(currentEmail)) {
    personLabelByEmail.set(currentEmail, currentEmail);
  }
  const fubHref = formatExternalLink(fubLink);

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

        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="min-w-0 space-y-6 p-5 lg:p-7">
              <label className="block space-y-1.5">
                <span className={LABEL_CLASS}>Ticket</span>
                <input
                  value={title}
                  disabled={!canEdit}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() =>
                    canEdit &&
                    title.trim() &&
                    title !== task.title &&
                    onPatch({ title: title.trim() })
                  }
                  className={`${INPUT_CLASS} h-11 text-base font-semibold`}
                />
              </label>

              <label className="block space-y-1.5">
                <span className={LABEL_CLASS}>Description</span>
                <textarea
                  value={description}
                  disabled={!canEdit}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() =>
                    canEdit &&
                    description !== (task.description ?? "") &&
                    onPatch({ description })
                  }
                  rows={5}
                  placeholder="Add a description…"
                  className={INPUT_CLASS}
                />
              </label>

              <section className="space-y-3 border-t border-[#dfe1e6] pt-5">
                <div className="flex flex-wrap gap-1 rounded bg-[#f4f5f7] p-1">
                  <DetailTabButton
                    label={`Comments (${detail?.comments.length ?? 0})`}
                    active={tab === "comments"}
                    onClick={() => setTab("comments")}
                  />
                  <DetailTabButton
                    label={`Activity (${detail?.activity.length ?? 0})`}
                    active={tab === "activity"}
                    onClick={() => setTab("activity")}
                  />
                  <DetailTabButton
                    label={`Attachments (${detail?.attachments.length ?? 0})`}
                    active={tab === "attachments"}
                    onClick={() => setTab("attachments")}
                  />
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
                        onReload={reload}
                      />
                    )}
                    {tab === "activity" && (
                      <ActivityFeed
                        activity={detail.activity}
                        personLabelByEmail={personLabelByEmail}
                      />
                    )}
                    {tab === "attachments" && (
                      <AttachmentPanel
                        attachments={detail.attachments}
                        taskId={task.id}
                        canEdit={canEdit}
                        onReload={reload}
                      />
                    )}
                  </>
                )}
              </section>
            </main>

            <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Priority</span>
                  <TaskPrioritySelect
                    value={task.priority}
                    disabled={!canEdit}
                    buttonClassName="!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none"
                    onChange={(nextPriority) =>
                      onPatch({ priority: nextPriority as TaskPriority })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Category</span>
                  <TaskSelect
                    label="Category"
                    value={task.category_id ?? ""}
                    disabled={!canEdit}
                    options={categoryOptions}
                    placeholder="Select category"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextCategoryId) => onPatch({ category_id: nextCategoryId })}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>FUB Link</span>
                  <div className="flex gap-1.5">
                    <input
                      value={fubLink}
                      disabled={!canEdit}
                      onChange={(e) => setFubLink(e.target.value)}
                      onBlur={() => {
                        const next = fubLink.trim();
                        if (canEdit && next !== (task.fub_link ?? "")) {
                          onPatch({ fub_link: next || null });
                        }
                      }}
                      placeholder="No FUB link"
                      className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
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
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Agent</span>
                  <TaskSelect
                    label="Agent"
                    value={task.agent_email ?? ""}
                    disabled={!canEdit}
                    options={agentOptions}
                    placeholder="Select agent"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextAgent) => onPatch({ agent_email: nextAgent })}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Assignees</span>
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
                              .map((email) => personLabelByEmail.get(email) ?? email)
                              .join(", ")
                          : "Unassigned"}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>QC Review</span>
                  <DoneReviewPanel
                    task={task}
                    canReviewDone={canReviewDone}
                    reviewerLabel={
                      task.done_reviewed_by_email
                        ? personLabelByEmail.get(task.done_reviewed_by_email) ??
                          task.done_reviewed_by_email
                        : null
                    }
                    onReviewDone={onReviewDone}
                  />
                </div>
              </div>

              {canEdit && (
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

function DoneReviewPanel({
  task,
  canReviewDone,
  reviewerLabel,
  onReviewDone,
}: {
  task: TaskRow;
  canReviewDone: boolean;
  reviewerLabel: string | null;
  onReviewDone: (reviewed: boolean) => void;
}) {
  const reviewed = Boolean(task.done_reviewed_at);
  const disabled = task.status !== "done" || !canReviewDone;

  return (
    <div className="rounded-lg border border-[#dfe1e6] bg-white p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 ${
            reviewed ? "text-[#00875a]" : "text-[#ff991f]"
          }`}
        >
          {reviewed ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <Circle className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#172b4d]">
            {reviewed ? "QC checked" : "Needs agent/admin QC"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[#626f86]">
            {task.status !== "done"
              ? "Available after CS moves this task to Done."
              : reviewed
                ? `Checked by ${reviewerLabel ?? "unknown"}${task.done_reviewed_at ? ` on ${formatReviewTime(task.done_reviewed_at)}` : ""}.`
                : "CS marked this Done. Agent/admin should verify the result."}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onReviewDone(!reviewed)}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#dfe1e6] disabled:text-[#6b778c]"
      >
        {reviewed ? "Clear QC check" : "Mark QC checked"}
      </button>
    </div>
  );
}

function formatReviewTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function DetailTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-white text-[#0c66e4] shadow-sm"
          : "text-[#44546f] hover:text-[#172b4d]"
      }`}
    >
      {label}
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
