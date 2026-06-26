"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { TaskPriority, TaskRow, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { taskKey } from "@/lib/tasks/sorting";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
import { AttachmentPanel } from "./AttachmentPanel";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";

const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";

export function TaskDetailDrawer({
  task,
  isManager,
  canEdit,
  assignees,
  agents,
  categories,
  currentEmail,
  onClose,
  onPatch,
  onDelete,
}: {
  task: TaskRow;
  isManager: boolean;
  canEdit: boolean;
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
  const [tab, setTab] = useState<"details" | "comments" | "activity">("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#091e42]/40">
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
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

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() =>
              canEdit && title.trim() && title !== task.title && onPatch({ title: title.trim() })
            }
            className="w-full rounded border-2 border-transparent px-2 py-1.5 text-lg font-semibold text-[#172b4d] outline-none transition hover:border-[#dfe1e6] focus:border-[#0c66e4] disabled:cursor-default disabled:border-transparent"
          />

          <label className="block space-y-1.5">
            <span className={LABEL_CLASS}>Description</span>
            <textarea
              value={description}
              disabled={!canEdit}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                canEdit && description !== (task.description ?? "") && onPatch({ description })
              }
              rows={4}
              placeholder="Add a description…"
              className={INPUT_CLASS}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Priority</span>
              <TaskPrioritySelect
                value={task.priority}
                disabled={!canEdit}
                onChange={(nextPriority) => onPatch({ priority: nextPriority as TaskPriority })}
              />
            </div>
            <label className="space-y-1.5">
              <span className={LABEL_CLASS}>Due date</span>
              <input
                type="date"
                defaultValue={task.due_date ?? ""}
                disabled={!canEdit}
                onChange={(e) => onPatch({ due_date: e.target.value })}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Category</span>
              <TaskSelect
                label="Category"
                value={task.category_id ?? ""}
                disabled={!canEdit}
                options={categoryOptions}
                buttonClassName="h-10 border-[#dfe1e6] shadow-none"
                onChange={(nextCategoryId) => onPatch({ category_id: nextCategoryId || null })}
              />
            </div>
            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Agent</span>
              <TaskSelect
                label="Agent"
                value={task.agent_email ?? ""}
                disabled={!canEdit}
                options={agentOptions}
                buttonClassName="h-10 border-[#dfe1e6] shadow-none"
                onChange={(nextAgent) => onPatch({ agent_email: nextAgent || null })}
              />
            </div>
          </div>

          {isManager && (
            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Assignee</span>
              <TaskSelect
                label="Assignee"
                value={task.assignee_email ?? ""}
                options={assigneeOptions}
                buttonClassName="h-10 border-[#dfe1e6] shadow-none"
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

          <div className="border-t border-[#dfe1e6] pt-4">
            <div className="mb-3 inline-flex rounded bg-[#f4f5f7] p-0.5">
              {(["details", "comments", "activity"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded px-3 py-1 text-sm font-semibold capitalize transition ${
                    tab === t
                      ? "bg-white text-[#0c66e4] shadow-sm"
                      : "text-[#44546f] hover:text-[#172b4d]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "comments" && (
              <CommentThread taskId={task.id} currentEmail={currentEmail} />
            )}
            {tab === "activity" && <ActivityFeed taskId={task.id} />}
            {tab === "details" && (
              <div className="space-y-2">
                <span className={LABEL_CLASS}>Attachments</span>
                <AttachmentPanel taskId={task.id} canEdit={canEdit} />
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <footer className="border-t border-[#dfe1e6] p-4">
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-sm font-semibold text-[#bf2600] transition hover:underline"
            >
              Delete task
            </button>
          </footer>
        )}
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
