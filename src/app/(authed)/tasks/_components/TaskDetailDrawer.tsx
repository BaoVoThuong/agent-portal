"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { TASK_PRIORITIES, type TaskPriority, type TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";

export function TaskDetailDrawer({
  task,
  isManager,
  canEdit,
  assignees,
  currentEmail,
  onClose,
  onPatch,
  onArchive,
}: {
  task: TaskRow;
  isManager: boolean;
  canEdit: boolean;
  assignees: TaskAssignee[];
  currentEmail: string;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [tab, setTab] = useState<"details" | "comments" | "activity">("details");

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
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Priority</span>
              <select
                value={task.priority}
                disabled={!canEdit}
                onChange={(e) => onPatch({ priority: e.target.value as TaskPriority })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 disabled:bg-slate-50"
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
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

          {isManager && (
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-slate-500">Assignee</span>
              <select
                value={task.assignee_email ?? ""}
                onChange={(e) =>
                  onPatch(
                    e.target.value
                      ? { assignee_email: e.target.value, status: task.status === "backlog" ? "todo" : task.status }
                      : { assignee_email: null, status: "backlog" }
                  )
                }
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              >
                <option value="">Unassigned (Backlog)</option>
                {assignees.map((a) => (
                  <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
                ))}
              </select>
            </label>
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
              <p className="text-xs text-slate-400">Use the fields above to edit task details.</p>
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
