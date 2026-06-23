"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { TaskRow, TaskStatus } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { KanbanBoard } from "./KanbanBoard";
import { BacklogList } from "./BacklogList";
import { NewTaskDialog, type NewTaskPayload } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

type Tab = "board" | "backlog";

export function TaskBoardClient({
  initialTasks,
  isManager,
  currentEmail,
  assignees,
}: {
  initialTasks: TaskRow[];
  isManager: boolean;
  currentEmail: string;
  assignees: TaskAssignee[];
}) {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const openTask = tasks.find((t) => t.id === openId) ?? null;

  function replaceTask(updated: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    const prev = tasks;
    // optimistic
    setTasks((cur) => cur.map((t) => (t.id === id ? ({ ...t, ...patch } as TaskRow) : t)));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setTasks(prev); // rollback
      return;
    }
    const data = await res.json();
    replaceTask(data.task as TaskRow);
  }

  function moveTask(id: string, change: { status: TaskStatus; position: number }) {
    void patchTask(id, change);
  }

  async function createTask(payload: NewTaskPayload) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const data = await res.json();
    setTasks((cur) => [...cur, data.task as TaskRow]);
  }

  async function archiveTask(id: string) {
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    setOpenId(null);
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) setTasks(prev);
  }

  const canEditOpen =
    openTask !== null && (isManager || openTask.assignee_email === currentEmail);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex gap-1">
          <TabButton active={tab === "board"} onClick={() => setTab("board")}>Board</TabButton>
          {isManager && (
            <TabButton active={tab === "backlog"} onClick={() => setTab("backlog")}>Backlog</TabButton>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white"
        >
          <Plus className="h-4 w-4" /> New task
        </button>
      </div>

      {tab === "board" ? (
        <KanbanBoard tasks={tasks} onOpen={setOpenId} onMove={moveTask} />
      ) : (
        <BacklogList
          tasks={tasks}
          assignees={assignees}
          onOpen={setOpenId}
          onAssign={(id, email) =>
            patchTask(id, { assignee_email: email, status: "todo" })
          }
        />
      )}

      <NewTaskDialog
        open={creating}
        isManager={isManager}
        assignees={assignees}
        onClose={() => setCreating(false)}
        onCreate={createTask}
      />

      {openTask && (
        <TaskDetailDrawer
          task={openTask}
          isManager={isManager}
          canEdit={canEditOpen}
          assignees={assignees}
          currentEmail={currentEmail}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onArchive={() => archiveTask(openTask.id)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active ? "bg-slate-100 text-[#0f2849]" : "text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}
