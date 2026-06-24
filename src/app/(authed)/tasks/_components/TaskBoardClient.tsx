"use client";

import { useMemo, useState } from "react";
import { Plus, Tag } from "lucide-react";
import type {
  TaskCategory,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import {
  filterTasks,
  ALL_AGENTS,
  NO_AGENT,
  type QuickFilter,
} from "@/lib/tasks/filtering";
import { KanbanBoard } from "./KanbanBoard";
import { BacklogBoard } from "./BacklogBoard";
import { TaskListView } from "./TaskListView";
import { TaskToolbar, type AgentStat, type BoardView } from "./TaskToolbar";
import { NewTaskDialog, type NewTaskPayload } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { CategoryManager } from "./CategoryManager";

export function TaskBoardClient({
  initialTasks,
  isManager,
  currentEmail,
  assignees,
  agents,
  initialCategories,
}: {
  initialTasks: TaskRow[];
  isManager: boolean;
  currentEmail: string;
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  initialCategories: TaskCategory[];
}) {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [view, setView] = useState<BoardView>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [managingCategories, setManagingCategories] = useState(false);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [quickFilters, setQuickFilters] = useState<QuickFilter[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<"" | TaskPriority>("");
  const [categoryFilter, setCategoryFilter] = useState<"" | string>("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");

  const reloadCategories = async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setCategories((await res.json()).categories as TaskCategory[]);
  };

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  const agentChoices = useMemo(() => {
    const byEmail = new Map<string, TaskAgent>();
    for (const agent of agents) byEmail.set(agent.email, agent);
    for (const task of tasks) {
      if (task.agent_email && !byEmail.has(task.agent_email)) {
        byEmail.set(task.agent_email, { email: task.agent_email, name: null });
      }
    }
    return [...byEmail.values()].sort((a, b) =>
      formatAgentLabel(a).localeCompare(formatAgentLabel(b))
    );
  }, [agents, tasks]);

  const agentLabelByEmail = useMemo(
    () => new Map(agentChoices.map((agent) => [agent.email, formatAgentLabel(agent)])),
    [agentChoices]
  );

  const agentStats = useMemo(() => {
    const stats = new Map<string, AgentStat>();
    const ensure = (key: string, label: string) => {
      const existing = stats.get(key);
      if (existing) return existing;
      const next: AgentStat = {
        key,
        label,
        total: 0,
        active: 0,
        waiting: 0,
        done: 0,
        urgent: 0,
      };
      stats.set(key, next);
      return next;
    };

    for (const agent of agentChoices) ensure(agent.email, formatAgentLabel(agent));
    ensure(NO_AGENT, "No agent");

    for (const task of tasks) {
      const key = task.agent_email ?? NO_AGENT;
      const label =
        key === NO_AGENT
          ? "No agent"
          : formatAgentLabel(
              agentChoices.find((agent) => agent.email === key) ?? {
                email: key,
                name: null,
              }
            );
      const stat = ensure(key, label);
      stat.total += 1;
      if (task.status !== "done") stat.active += 1;
      if (task.status === "waiting") stat.waiting += 1;
      if (task.status === "done") stat.done += 1;
      if (task.priority === "urgent" || task.priority === "high") stat.urgent += 1;
    }

    return [...stats.values()].filter((stat) => stat.total > 0);
  }, [agentChoices, tasks]);

  const visibleTasks = useMemo(
    () =>
      filterTasks(tasks, {
        query,
        agent: agentFilter,
        quick: quickFilters,
        priority: priorityFilter,
        category: categoryFilter,
        status: view === "list" ? statusFilter : "",
        currentEmail,
        searchText: (task) => {
          const category = task.category_id ? categoryById.get(task.category_id) : null;
          return [
            task.title,
            task.description,
            task.agent_email,
            task.agent_email ? agentLabelByEmail.get(task.agent_email) : null,
            task.assignee_email,
            task.reporter_email,
            category?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        },
      }),
    [
      tasks,
      query,
      agentFilter,
      quickFilters,
      priorityFilter,
      categoryFilter,
      statusFilter,
      view,
      currentEmail,
      categoryById,
      agentLabelByEmail,
    ]
  );

  const openTask = tasks.find((t) => t.id === openId) ?? null;

  function replaceTask(updated: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === id ? ({ ...t, ...patch } as TaskRow) : t)));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setTasks(prev);
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

  function clearAllFilters() {
    setQuery("");
    setAgentFilter(ALL_AGENTS);
    setQuickFilters([]);
    setPriorityFilter("");
    setCategoryFilter("");
    setStatusFilter("");
  }

  const canEditOpen =
    openTask !== null && (isManager || openTask.assignee_email === currentEmail);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-[#172b4d]">
      <div className="shrink-0 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold text-[#172b4d]">Tasks</h1>

          <div className="flex items-center gap-2">
            {isManager && (
              <button
                type="button"
                onClick={() => setManagingCategories(true)}
                className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
              >
                <Tag className="h-4 w-4" />
                Categories
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc]"
            >
              <Plus className="h-4 w-4" />
              New task
            </button>
          </div>
        </div>

        <TaskToolbar
          view={view}
          onViewChange={setView}
          isManager={isManager}
          query={query}
          onQuery={setQuery}
          agentStats={agentStats}
          agentFilter={agentFilter}
          onAgentFilter={setAgentFilter}
          quickValue={quickFilters}
          onQuickChange={setQuickFilters}
          priority={priorityFilter}
          onPriority={setPriorityFilter}
          category={categoryFilter}
          onCategory={setCategoryFilter}
          status={statusFilter}
          onStatus={setStatusFilter}
          showStatusFacet={view === "list"}
          categories={categories}
          resultCount={visibleTasks.length}
          totalCount={tasks.length}
          onClearAll={clearAllFilters}
        />
      </div>

      {view === "board" && (
        <KanbanBoard
          tasks={visibleTasks}
          onOpen={setOpenId}
          onMove={moveTask}
          categories={categories}
        />
      )}

      {view === "list" && (
        <TaskListView
          tasks={visibleTasks}
          categories={categories}
          assignees={assignees}
          agents={agents}
          isManager={isManager}
          currentEmail={currentEmail}
          onOpen={setOpenId}
          onPatch={patchTask}
        />
      )}

      {view === "backlog" && isManager && (
        <BacklogBoard
          tasks={tasks}
          assignees={assignees}
          categories={categories}
          onOpen={setOpenId}
          onAssign={(id, email) => patchTask(id, { assignee_email: email, status: "todo" })}
          onReorder={(id, position) => patchTask(id, { position })}
          onCreate={createTask}
        />
      )}

      <NewTaskDialog
        open={creating}
        isManager={isManager}
        assignees={assignees}
        agents={agents}
        categories={categories}
        onClose={() => setCreating(false)}
        onCreate={createTask}
      />

      {openTask && (
        <TaskDetailDrawer
          task={openTask}
          isManager={isManager}
          canEdit={canEditOpen}
          assignees={assignees}
          agents={agents}
          categories={categories}
          currentEmail={currentEmail}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onArchive={() => archiveTask(openTask.id)}
        />
      )}

      <CategoryManager
        open={managingCategories}
        onClose={() => setManagingCategories(false)}
        onChanged={reloadCategories}
      />
    </div>
  );
}

function formatAgentLabel(agent: TaskAgent) {
  return agent.name?.trim() || agent.email;
}
