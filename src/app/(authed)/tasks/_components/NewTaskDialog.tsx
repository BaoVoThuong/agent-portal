"use client";

import { useState } from "react";
import { TASK_PRIORITIES, type TaskPriority, type TaskCategory } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";

export type NewTaskPayload = {
  title: string;
  description: string;
  priority: TaskPriority;
  due_date: string;
  assignee_email?: string;
  category_id?: string;
};

export function NewTaskDialog({
  open,
  isManager,
  assignees,
  categories,
  onClose,
  onCreate,
}: {
  open: boolean;
  isManager: boolean;
  assignees: TaskAssignee[];
  categories: TaskCategory[];
  onClose: () => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        due_date: dueDate,
        assignee_email: isManager && assignee ? assignee : undefined,
        category_id: categoryId || undefined,
      });
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueDate("");
      setAssignee("");
      setCategoryId("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-[#0f2849]">New task</h2>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm"
            />
          </div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {isManager && (
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              <option value="">Unassigned (Backlog)</option>
              {assignees.map((a) => (
                <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
