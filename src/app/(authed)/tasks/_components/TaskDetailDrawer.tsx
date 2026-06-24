"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { TaskPriority, TaskRow, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
import { AttachmentPanel } from "./AttachmentPanel";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";

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
  onArchive,
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
  onArchive: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [tab, setTab] = useState<"details" | "comments" | "activity">("details");
  const categoryOptions = [
    { value: "", label: "No category" },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];
  const agentOptions = [
    { value: "", label: "No agent" },
    ...agents.map((agent) => ({
      value: agent.email,
      label: agent.name ?? agent.email,
    })),
  ];
  const assigneeOptions = [
    { value: "", label: "Unassigned (Backlog)" },
    ...assignees.map((assignee) => ({
      value: assignee.email,
      label: assignee.name ?? assignee.email,
    })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-[#0f2849]">Task</span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => canEdit && title.trim() && title !== task.title && onPatch({ title: title.trim() })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:bg-slate-50"
          />
          <textarea
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => canEdit && description !== (task.description ?? "") && onPatch({ description })}
            rows={4}
            placeholder="Description"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <span className="text-xs text-slate-500">Priority</span>
              <TaskPrioritySelect
                value={task.priority}
                disabled={!canEdit}
                onChange={(nextPriority) =>
                  onPatch({ priority: nextPriority as TaskPriority })
                }
              />
            </div>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Due date</span>
              <input
                type="date"
                defaultValue={task.due_date ?? ""}
                disabled={!canEdit}
                onChange={(e) => onPatch({ due_date: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 disabled:bg-slate-50"
              />
            </label>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500">Category</span>
            <TaskSelect
              label="Category"
              value={task.category_id ?? ""}
              disabled={!canEdit}
              options={categoryOptions}
              onChange={(nextCategoryId) =>
                onPatch({ category_id: nextCategoryId || null })
              }
            />
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500">Agent</span>
            <TaskSelect
              label="Agent"
              value={task.agent_email ?? ""}
              disabled={!canEdit}
              options={agentOptions}
              onChange={(nextAgent) =>
                onPatch({ agent_email: nextAgent || null })
              }
            />
          </div>

          {isManager && (
            <div className="block space-y-1 text-sm">
              <span className="text-xs text-slate-500">Assignee</span>
              <TaskSelect
                label="Assignee"
                value={task.assignee_email ?? ""}
                options={assigneeOptions}
                onChange={(nextAssignee) =>
                  onPatch(
                    nextAssignee
                      ? { assignee_email: nextAssignee, status: task.status === "backlog" ? "todo" : task.status }
                      : { assignee_email: null, status: "backlog" }
                  )
                }
              />
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <div className="mb-3 flex gap-1">
              {(["details", "comments", "activity"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                    tab === t ? "bg-slate-100 text-[#0f2849]" : "text-slate-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "comments" && <CommentThread taskId={task.id} currentEmail={currentEmail} />}
            {tab === "activity" && <ActivityFeed taskId={task.id} />}
            {tab === "details" && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-500">Attachments</span>
                <AttachmentPanel taskId={task.id} canEdit={canEdit} />
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <footer className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={onArchive}
              className="text-xs font-medium text-red-500 hover:underline"
            >
              Archive task
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
