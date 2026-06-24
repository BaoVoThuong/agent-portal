"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Search, Tag } from "lucide-react";
import type { TaskRow, TaskStatus, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { KanbanBoard } from "./KanbanBoard";
import { BacklogList } from "./BacklogList";
import { NewTaskDialog, type NewTaskPayload } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { CategoryManager } from "./CategoryManager";
import { Initials } from "./board-ui";

type Tab = "board" | "backlog";
type QuickFilter = "mine" | "priority" | "dueSoon" | "uncategorized";
type AgentStat = {
  key: string;
  label: string;
  total: number;
  active: number;
  waiting: number;
  done: number;
  urgent: number;
};

const ALL_AGENTS = "__all_agents__";
const NO_AGENT = "__no_agent__";

const QUICK_FILTERS: Array<{
  key: QuickFilter;
  label: string;
  description: string;
}> = [
  {
    key: "mine",
    label: "My tasks",
    description: "Assigned to me or reported by me",
  },
  {
    key: "priority",
    label: "High priority",
    description: "High and urgent work",
  },
  {
    key: "dueSoon",
    label: "Due soon",
    description: "Due in the next seven days",
  },
  {
    key: "uncategorized",
    label: "No category",
    description: "Tasks without a label",
  },
];

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
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [managingCategories, setManagingCategories] = useState(false);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [quickFilters, setQuickFilters] = useState<QuickFilter[]>([]);

  const reloadCategories = async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setCategories((await res.json()).categories as TaskCategory[]);
  };

  const categoryById = useMemo(() => {
    return new Map(categories.map((category) => [category.id, category]));
  }, [categories]);

  const agentChoices = useMemo(() => {
    const byEmail = new Map<string, TaskAgent>();

    for (const agent of agents) {
      byEmail.set(agent.email, agent);
    }

    for (const task of tasks) {
      if (task.agent_email && !byEmail.has(task.agent_email)) {
        byEmail.set(task.agent_email, { email: task.agent_email, name: null });
      }
    }

    return [...byEmail.values()].sort((a, b) =>
      formatAgentLabel(a).localeCompare(formatAgentLabel(b))
    );
  }, [agents, tasks]);

  const agentLabelByEmail = useMemo(() => {
    return new Map(
      agentChoices.map((agent) => [agent.email, formatAgentLabel(agent)])
    );
  }, [agentChoices]);

  const agentStats = useMemo(() => {
    const stats = new Map<string, AgentStat>();

    function ensure(key: string, label: string) {
      const existing = stats.get(key);
      if (existing) return existing;

      const next = {
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
    }

    for (const agent of agentChoices) {
      ensure(agent.email, formatAgentLabel(agent));
    }
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
      if (task.priority === "urgent" || task.priority === "high") {
        stat.urgent += 1;
      }
    }

    return [...stats.values()].filter(
      (stat) => stat.key !== NO_AGENT || stat.total > 0
    );
  }, [agentChoices, tasks]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesAgent =
        agentFilter === ALL_AGENTS ||
        (agentFilter === NO_AGENT
          ? !task.agent_email
          : task.agent_email === agentFilter);

      if (!matchesAgent) return false;

      const category = task.category_id
        ? categoryById.get(task.category_id)
        : null;
      const searchableText = [
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

      if (normalizedQuery && !searchableText.includes(normalizedQuery)) {
        return false;
      }

      return quickFilters.every((filter) => {
        if (filter === "mine") {
          return (
            task.assignee_email === currentEmail ||
            task.reporter_email === currentEmail
          );
        }

        if (filter === "priority") {
          return task.priority === "high" || task.priority === "urgent";
        }

        if (filter === "dueSoon") {
          if (!task.due_date || task.status === "done") return false;
          const due = new Date(`${task.due_date}T23:59:59`);
          const now = new Date();
          const nextWeek = new Date(now);
          nextWeek.setDate(now.getDate() + 7);
          return due >= now && due <= nextWeek;
        }

        if (filter === "uncategorized") {
          return !task.category_id;
        }

        return true;
      });
    });
  }, [
    agentFilter,
    agentLabelByEmail,
    categoryById,
    currentEmail,
    query,
    quickFilters,
    tasks,
  ]);

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
    <div className="flex h-full min-h-0 flex-col bg-white text-[#172b4d]">
      <div className="shrink-0 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-[#172b4d]">Board</h1>
            <div className="mt-4 flex gap-1">
              <TabButton active={tab === "board"} onClick={() => setTab("board")}>
                Board
              </TabButton>
              {isManager && (
                <TabButton active={tab === "backlog"} onClick={() => setTab("backlog")}>
                  Backlog
                </TabButton>
              )}
            </div>
          </div>

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

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="relative block h-10 w-[13.5rem]">
            <span className="sr-only">Search tasks</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-full w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
            />
          </label>

          <QuickFilterMenu
            value={quickFilters}
            onChange={setQuickFilters}
          />

          <AgentFilterBar
            stats={agentStats}
            selectedAgent={agentFilter}
            onSelect={setAgentFilter}
          />

          <span className="text-sm font-medium text-[#626f86]">
            {visibleTasks.length} of {tasks.length} tasks
          </span>
        </div>
      </div>

      {tab === "board" ? (
        <KanbanBoard
          tasks={visibleTasks}
          onOpen={setOpenId}
          onMove={moveTask}
          categories={categories}
        />
      ) : (
        <BacklogList
          tasks={visibleTasks}
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

function AgentFilterBar({
  stats,
  selectedAgent,
  onSelect,
}: {
  stats: AgentStat[];
  selectedAgent: string;
  onSelect: (agent: string) => void;
}) {
  if (stats.length === 0) return null;

  const total = stats.reduce(
    (acc, stat) => ({
      total: acc.total + stat.total,
      active: acc.active + stat.active,
      waiting: acc.waiting + stat.waiting,
      done: acc.done + stat.done,
      urgent: acc.urgent + stat.urgent,
    }),
    { total: 0, active: 0, waiting: 0, done: 0, urgent: 0 }
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-sm font-semibold text-[#44546f]">
        Agents
      </span>
      <AgentFilterButton
        stat={{ key: ALL_AGENTS, label: "All", ...total }}
        active={selectedAgent === ALL_AGENTS}
        onClick={() => onSelect(ALL_AGENTS)}
      />
      {stats.map((stat) => (
        <AgentFilterButton
          key={stat.key}
          stat={stat}
          active={selectedAgent === stat.key}
          onClick={() => onSelect(stat.key)}
        />
      ))}
    </div>
  );
}

function AgentFilterButton({
  stat,
  active,
  onClick,
}: {
  stat: AgentStat;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${stat.label}: ${stat.active} open, ${stat.waiting} waiting, ${stat.done} done, ${stat.urgent} high`}
      className={`inline-flex h-8 max-w-[13rem] items-center gap-1.5 rounded border px-2 text-sm font-medium transition ${
        active
          ? "border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]"
          : "border-transparent bg-transparent text-[#42526e] hover:bg-[#f4f5f7]"
      }`}
    >
      {stat.key === NO_AGENT || stat.key === ALL_AGENTS ? (
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            active ? "bg-white text-[#0c66e4]" : "bg-[#dfe1e6] text-[#44546f]"
          }`}
        >
          {stat.key === ALL_AGENTS ? "A" : "?"}
        </span>
      ) : (
        <Initials email={stat.key} />
      )}
      <span className="min-w-0 truncate">{stat.label}</span>
      <span
        className={`rounded-full px-1.5 text-[11px] font-bold leading-5 ${
          active ? "bg-white text-[#0c66e4]" : "bg-[#ebecf0] text-[#42526e]"
        }`}
      >
        {stat.active}
      </span>
      {stat.waiting > 0 ? (
        <span className="rounded-full bg-[#fff0b3] px-1.5 text-[11px] font-bold leading-5 text-[#7f5f01]">
          {stat.waiting}
        </span>
      ) : null}
      {stat.urgent > 0 ? (
        <span className="rounded-full bg-[#ffebe6] px-1.5 text-[11px] font-bold leading-5 text-[#de350b]">
          {stat.urgent}
        </span>
      ) : null}
    </button>
  );
}

function formatAgentLabel(agent: TaskAgent) {
  return agent.name?.trim() || agent.email;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-[#e9f2ff] text-[#0c66e4]"
          : "text-[#44546f] hover:bg-[#f4f5f7]"
      }`}
    >
      {children}
    </button>
  );
}

function QuickFilterMenu({
  value,
  onChange,
}: {
  value: QuickFilter[];
  onChange: (value: QuickFilter[]) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeCount = value.length;

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function toggleFilter(filter: QuickFilter) {
    onChange(
      value.includes(filter)
        ? value.filter((item) => item !== filter)
        : [...value, filter]
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-10 items-center gap-2 rounded px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
        aria-expanded={isOpen}
      >
        Quick Filters
        {activeCount > 0 ? (
          <span className="rounded-full bg-[#deebff] px-2 py-0.5 text-xs text-[#0c66e4]">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown
          className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div className="absolute left-0 z-40 mt-2 w-72 rounded border border-[#dfe1e6] bg-white p-2 shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
          {QUICK_FILTERS.map((filter) => {
            const checked = value.includes(filter.key);

            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => toggleFilter(filter.key)}
                className="flex w-full items-start gap-3 rounded px-2 py-2 text-left transition hover:bg-[#f4f5f7]"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                    checked
                      ? "border-[#0c66e4] bg-[#0c66e4]"
                      : "border-[#8590a2] bg-white"
                  }`}
                >
                  {checked ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#172b4d]">
                    {filter.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[#626f86]">
                    {filter.description}
                  </span>
                </span>
              </button>
            );
          })}

          {activeCount > 0 ? (
            <div className="mt-1 border-t border-[#ebecf0] pt-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded px-2 py-1 text-sm font-semibold text-[#0c66e4] transition hover:bg-[#f4f5f7]"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
