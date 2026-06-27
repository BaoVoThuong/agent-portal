"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { TASKS_TOPIC } from "@/lib/tasks/realtime-topics";
import { Plus, Tag, UsersRound } from "lucide-react";
import type { TaskCategory, TaskRow, TaskStatus } from "@/lib/tasks/types";
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
import { AgentGroupsModal } from "./AgentGroupsModal";

export function TaskBoardClient({
  initialTasks,
  isManager,
  currentEmail,
  assignees,
  agents,
  agentCandidates,
  myAgents,
  initialCategories,
}: {
  initialTasks: TaskRow[];
  isManager: boolean;
  currentEmail: string;
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  agentCandidates: TaskAgent[];
  myAgents: string[];
  initialCategories: TaskCategory[];
}) {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [taskAgents, setTaskAgents] = useState<TaskAgent[]>(agents);
  const [view, setView] = useState<BoardView>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [managingCategories, setManagingCategories] = useState(false);
  const [managingAgentGroups, setManagingAgentGroups] = useState(false);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [presets, setPresets] = useState<QuickFilter[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<"" | string>("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
  const [error, setError] = useState<string | null>(null);

  // Auto-dismiss the error toast so it doesn't linger.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // Deep-link from a notification (/tasks?task=<id>). Derived during render (no
  // effect); the param is dropped on open/close so re-clicking re-opens.
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("task");

  // Live board: refetch the role-filtered list when the server pings that tasks
  // changed, plus once on (re)connect to catch anything missed while offline.
  // No polling — the reconnect refetch is the self-heal path.
  const refetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks as TaskRow[]);
    } catch {
      // ignore; the next ping or reconnect retries
    }
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetchTasks(), 300);
    };
    const channel = sb
      .channel(TASKS_TOPIC)
      .on("broadcast", { event: "changed" }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetchTasks();
      });
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [refetchTasks]);

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
    for (const agent of taskAgents) byEmail.set(agent.email, agent);
    for (const task of tasks) {
      if (task.agent_email && !byEmail.has(task.agent_email)) {
        byEmail.set(task.agent_email, { email: task.agent_email, name: null });
      }
    }
    return [...byEmail.values()].sort((a, b) =>
      formatAgentLabel(a).localeCompare(formatAgentLabel(b))
    );
  }, [taskAgents, tasks]);

  const agentLabelByEmail = useMemo(
    () => new Map(agentChoices.map((agent) => [agent.email, formatAgentLabel(agent)])),
    [agentChoices]
  );

  const assigneeLabelByEmail = useMemo(
    () =>
      new Map(
        assignees.map((assignee) => [
          assignee.email,
          assignee.name?.trim() || assignee.email,
        ])
      ),
    [assignees]
  );

  const mentionMembers = useMemo(() => {
    const byEmail = new Map<string, TaskAssignee>();
    for (const person of [...agentCandidates, ...taskAgents, ...assignees]) {
      const existing = byEmail.get(person.email);
      byEmail.set(person.email, {
        email: person.email,
        name: person.name?.trim() || existing?.name || null,
      });
    }
    if (!byEmail.has(currentEmail)) {
      byEmail.set(currentEmail, { email: currentEmail, name: null });
    }

    return [...byEmail.values()].sort((a, b) =>
      (a.name ?? a.email).localeCompare(b.name ?? b.email)
    );
  }, [agentCandidates, taskAgents, assignees, currentEmail]);

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
      if (task.status !== "done" && task.status !== "cancel") stat.active += 1;
      if (task.status === "waiting") stat.waiting += 1;
      if (task.status === "done") stat.done += 1;
      if (task.priority === "urgent" || task.priority === "high") stat.urgent += 1;
    }

    const selectedAgentEmails = new Set(taskAgents.map((agent) => agent.email));
    return [...stats.values()].filter(
      (stat) => stat.total > 0 || selectedAgentEmails.has(stat.key)
    );
  }, [agentChoices, taskAgents, tasks]);

  // Which filters make sense for the current view + role. Hidden filters are also
  // forced inert here so a stale value can't silently filter a view that hides it.
  //  - Agent (customer agent_email): manager-only.
  //  - Assignee: manager-only, and not on Backlog (everything there is unassigned).
  //  - Status: List only (Board columns already are statuses; Backlog is all backlog).
  const showAgentFilter = isManager;
  const showAssigneeFilter = isManager && view !== "backlog";
  const showStatusFilter = view === "list";

  const visibleTasks = useMemo(
    () =>
      filterTasks(tasks, {
        query,
        agent: showAgentFilter ? agentFilter : ALL_AGENTS,
        assignee: showAssigneeFilter ? assigneeFilter : "",
        quick: presets,
        category: categoryFilter,
        status: showStatusFilter ? statusFilter : "",
        currentEmail,
        searchText: (task) => {
          const category = task.category_id ? categoryById.get(task.category_id) : null;
          return [
            task.title,
            task.description,
            task.fub_link,
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
      assigneeFilter,
      presets,
      categoryFilter,
      statusFilter,
      showAgentFilter,
      showAssigneeFilter,
      showStatusFilter,
      currentEmail,
      categoryById,
      agentLabelByEmail,
    ]
  );

  const activeOpenId = deepLinkId ?? openId;
  const openTask = tasks.find((t) => t.id === activeOpenId) ?? null;

  function openTaskById(id: string) {
    if (deepLinkId) router.replace("/tasks", { scroll: false });
    setOpenId(id);
  }
  function closeTask() {
    if (deepLinkId) router.replace("/tasks", { scroll: false });
    setOpenId(null);
  }

  function replaceTask(updated: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function canChangeStatusTask(task: TaskRow): boolean {
    return (
      isManager ||
      task.assignee_email === currentEmail ||
      Boolean(task.agent_email && myAgents.includes(task.agent_email))
    );
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    // Snapshot only the affected task so a failed update reverts just this card,
    // never clobbering other concurrent optimistic moves.
    const before = tasks.find((t) => t.id === id) ?? null;
    const revert = () => {
      if (before) setTasks((cur) => cur.map((t) => (t.id === id ? before : t)));
    };
    setTasks((cur) => cur.map((t) => (t.id === id ? ({ ...t, ...patch } as TaskRow) : t)));

    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      revert();
      setError("Mất kết nối — không lưu được thay đổi.");
      return;
    }
    if (!res.ok) {
      revert();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không cập nhật được task.");
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

  async function deleteTask(id: string) {
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    setOpenId(null);
    let res: Response;
    try {
      res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    } catch {
      setTasks(prev);
      setError("Mất kết nối — không xoá được task.");
      return;
    }
    if (!res.ok) {
      setTasks(prev);
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Không xoá được task.");
    }
  }

  function clearAllFilters() {
    setQuery("");
    setAgentFilter(ALL_AGENTS);
    setAssigneeFilter("");
    setPresets([]);
    setCategoryFilter("");
    setStatusFilter("");
  }

  const canEditOpen = openTask !== null && isManager;
  const canAssignOpen = openTask !== null && isManager;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-[#172b4d]">
      <div className="shrink-0 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold text-[#172b4d]">Tasks</h1>

          <div className="flex items-center gap-2">
            {isManager && (
              <>
                <button
                  type="button"
                  onClick={() => setManagingAgentGroups(true)}
                  className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
                >
                  <UsersRound className="h-4 w-4" />
                  Agent Groups
                </button>
                <button
                  type="button"
                  onClick={() => setManagingCategories(true)}
                  className="inline-flex h-9 items-center gap-2 rounded border border-transparent bg-[#f4f5f7] px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#ebecf0]"
                >
                  <Tag className="h-4 w-4" />
                  Categories
                </button>
              </>
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
          assignees={assignees}
          assigneeFilter={assigneeFilter}
          onAssigneeFilter={setAssigneeFilter}
          presets={presets}
          onPresets={setPresets}
          category={categoryFilter}
          onCategory={setCategoryFilter}
          status={statusFilter}
          onStatus={setStatusFilter}
          showAgent={showAgentFilter}
          showAssignee={showAssigneeFilter}
          showStatus={showStatusFilter}
          categories={categories}
          resultCount={visibleTasks.length}
          totalCount={tasks.length}
          onClearAll={clearAllFilters}
        />
      </div>

      {view === "board" && (
        <KanbanBoard
          tasks={visibleTasks}
          onOpen={openTaskById}
          onMove={moveTask}
          canMoveTask={canChangeStatusTask}
          categories={categories}
          agentLabelByEmail={agentLabelByEmail}
          assigneeLabelByEmail={assigneeLabelByEmail}
        />
      )}

      {view === "list" && (
        <TaskListView
          tasks={visibleTasks}
          categories={categories}
          assignees={assignees}
          isManager={isManager}
          myAgents={myAgents}
          currentEmail={currentEmail}
          onOpen={openTaskById}
          onPatch={patchTask}
        />
      )}

      {view === "backlog" && isManager && (
        <BacklogBoard
          tasks={visibleTasks}
          assignees={assignees}
          categories={categories}
          onOpen={openTaskById}
          onPatch={patchTask}
          onReorder={(id, position) => patchTask(id, { position })}
          onCreate={createTask}
        />
      )}

      <NewTaskDialog
        open={creating}
        isManager={isManager}
        assignees={assignees}
        agents={taskAgents}
        agentCandidates={agentCandidates}
        myAgents={myAgents}
        categories={categories}
        onClose={() => setCreating(false)}
        onCreate={createTask}
      />

      {openTask && (
        <TaskDetailDrawer
          key={openTask.id}
          task={openTask}
          canEdit={canEditOpen}
          canAssign={canAssignOpen}
          assignees={assignees}
          agents={taskAgents}
          mentionMembers={mentionMembers}
          categories={categories}
          currentEmail={currentEmail}
          onClose={closeTask}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => deleteTask(openTask.id)}
        />
      )}

      <CategoryManager
        open={managingCategories}
        onClose={() => setManagingCategories(false)}
        onChanged={reloadCategories}
      />

      <AgentGroupsModal
        open={managingAgentGroups}
        agents={taskAgents}
        candidates={agentCandidates}
        cs={assignees}
        onAgentsChange={setTaskAgents}
        onClose={() => setManagingAgentGroups(false)}
      />

      {error && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-[200] flex max-w-md -translate-x-1/2 items-center gap-3 rounded bg-[#172b4d] px-4 py-2.5 text-sm font-medium text-white shadow-[0_8px_24px_rgba(9,30,66,0.32)]"
        >
          <span className="min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-white/70 transition hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function formatAgentLabel(agent: TaskAgent) {
  return agent.name?.trim() || agent.email;
}
