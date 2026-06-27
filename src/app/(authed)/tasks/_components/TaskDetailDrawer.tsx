"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TaskPriority, TaskRow, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import type { TaskDetail } from "@/lib/tasks/detail";
import { taskKey } from "@/lib/tasks/sorting";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
import { AttachmentPanel } from "./AttachmentPanel";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";

const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const SIDE_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none border-[#dfe1e6] bg-white";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";

const detailCache = new Map<string, TaskDetail>();

export function TaskDetailDrawer({
  task,
  canEdit,
  canAssign,
  assignees,
  agents,
  categories,
  currentEmail,
  onClose,
  onPatch,
  onDelete,
}: {
  task: TaskRow;
  canEdit: boolean;
  canAssign: boolean;
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  categories: TaskCategory[];
  currentEmail: string;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [detail, setDetail] = useState<TaskDetail | null>(
    () => detailCache.get(task.id) ?? null
  );
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

  const categoryOptions = [
    { value: "", label: "No category" },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];
  const agentOptions = [
    { value: "", label: "No agent" },
    ...agents.map((agent) => ({ value: agent.email, label: agent.name ?? agent.email })),
  ];
  const assigneeOptions = [
    { value: "", label: "Unassigned (Backlog)" },
    ...assignees.map((assignee) => ({
      value: assignee.email,
      label: assignee.name ?? assignee.email,
    })),
  ];
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
  if (!personLabelByEmail.has(currentEmail)) {
    personLabelByEmail.set(currentEmail, currentEmail);
  }

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
                className="w-full rounded border-2 border-transparent px-2 py-1.5 text-xl font-semibold text-[#172b4d] outline-none transition hover:border-[#dfe1e6] focus:border-[#0c66e4] disabled:cursor-default disabled:border-transparent"
              />

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
                <span className={LABEL_CLASS}>Comments</span>
                <CommentThread
                  taskId={task.id}
                  currentEmail={currentEmail}
                  members={assignees}
                  comments={detail?.comments ?? []}
                  onReload={reload}
                />
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
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextCategoryId) =>
                      onPatch({ category_id: nextCategoryId || null })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Agent</span>
                  <TaskSelect
                    label="Agent"
                    value={task.agent_email ?? ""}
                    disabled={!canEdit}
                    options={agentOptions}
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextAgent) => onPatch({ agent_email: nextAgent || null })}
                  />
                </div>

                {canAssign && (
                  <div className="space-y-1.5">
                    <span className={LABEL_CLASS}>Assignee</span>
                    <TaskSelect
                      label="Assignee"
                      value={task.assignee_email ?? ""}
                      options={assigneeOptions}
                      buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                      onChange={(nextAssignee) =>
                        onPatch(
                          nextAssignee
                            ? {
                                assignee_email: nextAssignee,
                                status: task.status === "backlog" ? "todo" : task.status,
                              }
                            : { assignee_email: null, status: "backlog" }
                        )
                      }
                    />
                  </div>
                )}
              </div>

              <section className="space-y-2 border-t border-[#dfe1e6] pt-3">
                <span className={LABEL_CLASS}>Attachments</span>
                <AttachmentPanel
                  attachments={detail?.attachments ?? []}
                  taskId={task.id}
                  canEdit={canEdit}
                  onReload={reload}
                />
              </section>

              <section className="space-y-2 border-t border-[#dfe1e6] pt-3">
                <span className={LABEL_CLASS}>Activity</span>
                <ActivityFeed
                  activity={detail?.activity ?? []}
                  personLabelByEmail={personLabelByEmail}
                />
              </section>

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
